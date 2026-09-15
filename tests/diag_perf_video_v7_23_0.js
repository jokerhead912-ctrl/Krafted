/*
 * diag_perf_video_v7_23_0.js — READ-ONLY probe (diagnostic, not a suite).
 *
 * Question: what does a VIDEO card cost per frame, and how many rAF loops are
 * alive once N media cards exist?
 *
 * Why this file exists: `buildMediaControls()` starts `_tbFollowLoop()`
 * (kraftpub-dev.html:13907) with no matching cancelAnimationFrame anywhere in
 * the file. That is a 60 Hz loop per media card, for the lifetime of the page.
 * This probe counts how many rAF callbacks the page re-registers per frame, so
 * "one loop per card" stops being an inference and becomes a number, and A/Bs
 * the cost of the toolbar actually being visible (which is when the loop calls
 * `_positionToolbar()`: 2x getBoundingClientRect + offsetWidth/offsetHeight).
 *
 * HEADLESS CAVEAT: relative numbers only. No GPU raster in headless Chrome.
 *
 * Run:
 *   NODE_PATH=/Users/kincheung/.workbuddy/binaries/node/workspace/node_modules \
 *     /Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node \
 *     Krafted/tests/diag_perf_video_v7_23_0.js
 */
'use strict';

const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTML = process.env.KRAFTED_HTML
  ? path.resolve(process.env.KRAFTED_HTML)
  : path.resolve(__dirname, '../../kraftpub-dev.html');

const CARDS = Number(process.env.CARDS || 12);

function fmt(n, d = 2) { return Number(n).toFixed(d); }

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files',
           '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 1512, height: 900 },
  });
  const page = await browser.newPage();
  page.on('pageerror', () => {});

  await page.goto('file://' + HTML, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(
    () => typeof window.addVideoItem === 'function' && window.state && window.state.items,
    { timeout: 60000 }
  );

  console.log('Krafted video-perf probe — ' + path.basename(HTML));
  console.log('cards to build: ' + CARDS + '\n');

  // ── count live rAF loops ─────────────────────────────────────────────────
  // A loop that re-registers itself every frame shows up as one registration
  // per frame. Counting registrations per frame therefore counts live loops.
  await page.evaluate(() => {
    const orig = window.requestAnimationFrame.bind(window);
    window.__raf = { count: 0, frames: 0, perFrame: [] };
    window.requestAnimationFrame = function (cb) {
      window.__raf.count++;
      return orig(function (t) {
        window.__raf.frames++;
        return cb(t);
      });
    };
  });

  const measure = (label) => page.evaluate(async (label) => {
    // sample frame delivery
    const frames = [];
    let last = performance.now();
    await new Promise(resolve => {
      const rec = (t) => {
        frames.push(t - last); last = t;
        if (frames.length < 90) requestAnimationFrame(rec); else resolve();
      };
      requestAnimationFrame(rec);
    });
    const f = frames.slice(5);
    const sorted = f.slice().sort((a, b) => a - b);
    // ABSOLUTE counts, not a ratio. (registrations / executions is ~1.0 for
    // any number of self-perpetuating loops — that metric proves nothing.)
    // One self-re-registering loop costs ~60 registrations/sec at 60fps, so:
    //   regPerSec / 60  ==  how many permanent rAF loops are alive.
    const c0 = window.__raf.count;
    const fr0 = window.__raf.frames;
    const t0 = performance.now();
    await new Promise(r => setTimeout(r, 1000));
    const el = (performance.now() - t0) / 1000;
    const regPerSec = (window.__raf.count - c0) / el;
    const framesPerSec = (window.__raf.frames - fr0) / el;
    return {
      label,
      avg: f.reduce((a, b) => a + b, 0) / f.length,
      p95: sorted[Math.floor(sorted.length * 0.95)],
      worst: sorted[sorted.length - 1],
      over32: f.filter(x => x > 32).length,
      regPerSec,
      framesPerSec,
    };
  }, label);

  const report = (r) => {
    console.log('  ' + r.label);
    console.log('    avg ' + fmt(r.avg, 1) + ' ms (' + fmt(1000 / r.avg, 0) + ' fps) · p95 ' +
      fmt(r.p95, 1) + ' · worst ' + fmt(r.worst, 1) + ' · >32ms: ' + r.over32 +
      ' · rAF reg/sec ' + fmt(r.regPerSec, 0) + ' (cb/sec ' + fmt(r.framesPerSec, 0) + ')');
  };

  console.log('— A. baseline (no media card) —');
  report(await measure('empty board'));

  // ── record a real clip in the page ───────────────────────────────────────
  const clipUrl = await page.evaluate(async () => {
    const cv = document.createElement('canvas');
    cv.width = 320; cv.height = 180;
    const ctx = cv.getContext('2d');
    let i = 0;
    const iv = setInterval(() => {
      ctx.fillStyle = 'hsl(' + ((i * 20) % 360) + ',70%,50%)';
      ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = '#000'; ctx.fillRect((i * 7) % 300, 80, 20, 20);
      i++;
    }, 40);
    const stream = cv.captureStream(25);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(r => { rec.onstop = r; });
    rec.start();
    await new Promise(r => setTimeout(r, 1500));
    clearInterval(iv);
    rec.stop();
    await stopped;
    return URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
  });
  console.log('\n  recorded clip: ' + clipUrl.slice(0, 42) + '...');

  // ── build cards ──────────────────────────────────────────────────────────
  const built = await page.evaluate(async (n, url) => {
    const cols = 4;
    for (let i = 0; i < n; i++) {
      try { window.addVideoItem(url, 320, 180, (i % cols) * 340, Math.floor(i / cols) * 200); }
      catch (e) { /* keep going */ }
    }
    await new Promise(r => setTimeout(r, 2500));
    const vids = Array.from(document.querySelectorAll('video'));
    return {
      items: window.state.items.length,
      videos: vids.length,
      withToolbar: window.state.items.filter(it => it.el && it.el._annoToolbar).length,
      domNodes: document.querySelectorAll('*').length,
    };
  }, CARDS, clipUrl);

  console.log('\n— B. ' + built.videos + ' video cards built (' + built.domNodes + ' DOM nodes) —');
  console.log('  cards exposing _annoToolbar: ' + built.withToolbar);
  report(await measure('B1 paused, toolbars hidden'));

  // Isolate the follow-loop BEFORE decode cost swamps everything: paused
  // cards, only difference is whether _positionToolbar() runs each frame.
  await page.evaluate(() => {
    for (const it of window.state.items) {
      const tb = it.el && it.el._annoToolbar;
      if (tb) tb.style.display = 'block';
    }
  });
  report(await measure('B2 paused, toolbars VISIBLE (follow loop doing work)'));

  await page.evaluate(() => {
    for (const it of window.state.items) {
      const tb = it.el && it.el._annoToolbar;
      if (tb) tb.style.display = 'none';
    }
  });

  // ── play them ────────────────────────────────────────────────────────────
  const playing = await page.evaluate(async () => {
    const vids = Array.from(document.querySelectorAll('video'));
    for (const v of vids) { try { v.loop = true; v.muted = true; await v.play(); } catch (e) {} }
    await new Promise(r => setTimeout(r, 600));
    return vids.filter(v => !v.paused).length;
  });
  console.log('\n— C. playing (' + playing + ' decoders live) —');
  report(await measure('playing'));

  // ── make the anno toolbars visible => _positionToolbar() runs every frame ─
  const shown = await page.evaluate(() => {
    let n = 0;
    for (const it of window.state.items) {
      const tb = it.el && it.el._annoToolbar;
      if (tb) { tb.style.display = 'block'; n++; }
    }
    return n;
  });
  console.log('\n— D. ' + shown + ' anno toolbars forced visible (follow loop now does work) —');
  report(await measure('playing + toolbars'));

  // ── hide them again: does the loop stop costing anything? ────────────────
  await page.evaluate(() => {
    for (const it of window.state.items) {
      const tb = it.el && it.el._annoToolbar;
      if (tb) tb.style.display = 'none';
    }
  });
  console.log('\n— E. same ' + shown + ' toolbars hidden again (loops still alive, but idle) —');
  report(await measure('playing, toolbars hidden'));

  // ── and with the cards deleted: do the loops die with them? ──────────────
  const afterDelete = await page.evaluate(async () => {
    const vids = Array.from(document.querySelectorAll('video'));
    for (const v of vids) { try { v.pause(); } catch (e) {} }
    window.state.selected.clear();
    for (const it of window.state.items.slice()) if (it.video) window.state.selected.add(it.id);
    const n = window.state.selected.size;
    try { window.deleteSelected && window.deleteSelected(); } catch (e) {}
    // long settle: if the frame rate recovers only after a while, the 30 fps
    // floor was decoder/GC backlog, not a permanent rAF leak
    await new Promise(r => setTimeout(r, 4000));
    return { deleted: n, remaining: window.state.items.length, videos: document.querySelectorAll('video').length };
  });
  console.log('\n— F. after deleting ' + afterDelete.deleted + ' video cards (4s settle) —');
  console.log('  items left: ' + afterDelete.remaining + ' · <video> in DOM: ' + afterDelete.videos);
  report(await measure('after delete'));

  await browser.close();
  console.log('\nprobe done.');
})().catch(e => { console.error('probe failed:', e && e.message); process.exit(1); });
