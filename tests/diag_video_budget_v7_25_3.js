/*
 * diag_video_budget_v7_25_3.js — READ-ONLY probe (diagnostic, not a suite).
 *
 * Question: with ~10 videos on the board, what actually costs frames?
 *   A. N playing videos, no overlay            -> baseline
 *   B. same, plus a LIVE backdrop-filter panel -> does the blur cost?
 *   C. same, plus a live NON-identity CSS filter on the videos -> cost?
 *
 * Why: `MAX_CONCURRENT_VIDEOS = 4` is justified by a comment claiming
 * "with CSS filter applied drops to 2-3" (kraftpub-dev.html:22531). Nobody has
 * ever measured either half of that sentence. This probe makes it a number.
 *
 * HEADLESS CAVEAT: no GPU raster, software decode. Absolute fps is NOT
 * representative of the user's machine. Only A/B/C deltas are read.
 *
 * Run:
 *   NODE_PATH=/Users/kincheung/.workbuddy/binaries/node/workspace/node_modules \
 *     /Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node \
 *     Krafted/tests/diag_video_budget_v7_25_3.js
 *   (env: CARDS=10 SECONDS=3)
 */
'use strict';

const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTML = process.env.KRAFTED_HTML
  ? path.resolve(process.env.KRAFTED_HTML)
  : path.resolve(__dirname, '../../kraftpub-dev.html');
const CARDS = Number(process.env.CARDS || 10);
const SECONDS = Number(process.env.SECONDS || 3);

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

  // ── 1. manufacture a real video with no ffmpeg ────────────────────────────
  // Canvas -> captureStream -> MediaRecorder -> webm blob -> object URL.
  const srcUrl = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 480; c.height = 270;
    const g = c.getContext('2d');
    const stream = c.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = res; });
    rec.start();
    let f = 0;
    const t0 = performance.now();
    await new Promise((res) => {
      function step() {
        f++;
        g.fillStyle = 'rgb(' + (f * 7 % 255) + ',80,' + ((255 - f * 5 % 255)) + ')';
        g.fillRect(0, 0, 480, 270);
        g.fillStyle = '#fff';
        g.fillRect((f * 6) % 440, 120, 40, 40);
        if (performance.now() - t0 > 2500) return res();
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: 'video/webm' });
    window.__probeUrl = URL.createObjectURL(blob);
    return blob.size;
  });
  console.log('Krafted video-budget probe — ' + path.basename(HTML));
  console.log('synthetic webm: ' + srcUrl + ' bytes, cards: ' + CARDS + '\n');
  if (!srcUrl || srcUrl < 1000) { console.log('ABORT: could not manufacture a video'); await browser.close(); process.exit(2); }

  // ── 2. build the cards ────────────────────────────────────────────────────
  await page.evaluate(async (n) => {
    const url = window.__probeUrl;
    for (let i = 0; i < n; i++) {
      await window.addVideoItem(url, 'probe' + i + '.webm');
    }
  }, CARDS);

  const built = await page.evaluate(() => ({
    videos: document.querySelectorAll('video').length,
    items: window.state.items.length,
  }));
  console.log('built: videos=' + built.videos + ' items=' + built.items);
  if (built.videos < CARDS) { console.log('ABORT: only ' + built.videos + ' video elements'); await browser.close(); process.exit(2); }

  await page.evaluate(() => {
    return Promise.all([...document.querySelectorAll('video')].map(v => {
      v.loop = true; v.muted = true;
      return v.play().catch(() => {});
    }));
  });
  // The budget caps at 4 — for the probe we deliberately force all of them on
  // so the N-cost is visible. (Diagnosing, not shipping.)
  await page.evaluate((n) => {
    const vids = [...document.querySelectorAll('video')];
    vids.forEach(v => { if (v.paused) v.play().catch(() => {}); });
    return vids.filter(v => !v.paused).length;
  }, CARDS);

  // ── 3. measure ────────────────────────────────────────────────────────────
  async function measure(label) {
    const r = await page.evaluate((secs) => new Promise((res) => {
      const vids = [...document.querySelectorAll('video')];
      const before = vids.map(v => {
        try { return v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().droppedVideoFrames : 0; }
        catch (e) { return 0; }
      });
      let frames = 0;
      const t0 = performance.now();
      function step() {
        frames++;
        if (performance.now() - t0 < secs * 1000) requestAnimationFrame(step);
        else {
          const dt = (performance.now() - t0) / 1000;
          const after = vids.map(v => {
            try { return v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().droppedVideoFrames : 0; }
            catch (e) { return 0; }
          });
          const dropped = after.reduce((a, b, i) => a + (b - before[i]), 0);
          const playing = vids.filter(v => !v.paused).length;
          res({ fps: frames / dt, dropped, playing, total: vids.length });
        }
      }
      requestAnimationFrame(step);
    }), SECONDS);
    console.log(label.padEnd(34) + ' fps=' + fmt(r.fps, 1).padStart(6) +
                '  dropped=' + String(r.dropped).padStart(5) +
                '  playing=' + r.playing + '/' + r.total);
    return r;
  }

  const A = await measure('A baseline (no overlay)');

  // B: a live, full-bleed backdrop-filter panel over the playing board.
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'probe-blur';
    d.style.cssText = 'position:fixed;left:200px;top:120px;width:900px;height:600px;' +
      'z-index:999999;background:rgba(20,20,24,0.55);' +
      'backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);';
    document.body.appendChild(d);
  });
  const B = await measure('B + live backdrop-filter panel');
  await page.evaluate(() => { const d = document.getElementById('probe-blur'); if (d) d.remove(); });

  // C: same panel, blur forced off — proves the delta is the blur, not the layer.
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'probe-noblur';
    d.style.cssText = 'position:fixed;left:200px;top:120px;width:900px;height:600px;' +
      'z-index:999999;background:rgba(20,20,24,0.55);backdrop-filter:none;';
    document.body.appendChild(d);
  });
  const C = await measure('C + same panel, blur off');
  await page.evaluate(() => { const d = document.getElementById('probe-noblur'); if (d) d.remove(); });

  // D: a NON-identity CSS filter on every video (the 22531 comment's case).
  await page.evaluate(() => {
    document.querySelectorAll('video').forEach(v => {
      v.style.filter = 'brightness(1.08) contrast(1.06) saturate(1.04)';
    });
  });
  const D = await measure('D + real filter on each video');
  await page.evaluate(() => { document.querySelectorAll('video').forEach(v => { v.style.filter = ''; }); });

  // ── 4. end-to-end: does the class actually appear on real media events? ───
  // The unit test proves the toggle computes the right answer with a fake
  // document. It cannot prove that a document-level listener really receives
  // `play`/`pause`, because those events do not bubble — the capture phase is
  // the whole mechanism. Only a real browser can settle it.
  console.log('\nE2E — body.media-playing on real media events');
  const e2e = await page.evaluate(async () => {
    const vids = [...document.querySelectorAll('video')];
    const has = () => document.body.classList.contains('media-playing');
    const out = {};
    document.getElementById('probe-blur') && document.getElementById('probe-blur').remove();
    // A fresh frosted panel we can read the computed style off.
    const p = document.createElement('div');
    p.className = 'krafted-save-overlay';
    p.style.cssText = 'position:fixed;left:40px;top:40px;width:300px;height:200px;z-index:999998;';
    document.body.appendChild(p);

    vids.forEach(v => { v.muted = true; v.loop = true; });
    await Promise.all(vids.map(v => v.play().catch(() => {})));
    await new Promise(r => setTimeout(r, 300));
    out.playingClassOn = has();
    out.blurWhilePlaying = getComputedStyle(p).backdropFilter;

    vids.forEach(v => v.pause());
    await new Promise(r => setTimeout(r, 300));
    out.pausedClassOff = !has();
    out.blurWhilePaused = getComputedStyle(p).backdropFilter;

    // And back on again — a toggle that only ever turns on is a bug too.
    await Promise.all(vids.map(v => v.play().catch(() => {})));
    await new Promise(r => setTimeout(r, 300));
    out.resumeClassOn = has();
    p.remove();
    return out;
  });
  const e2eOk = e2e.playingClassOn && e2e.pausedClassOff && e2e.resumeClassOn &&
                /none/.test(e2e.blurWhilePlaying) && !/none/.test(e2e.blurWhilePaused);
  console.log('  playing  -> class=' + e2e.playingClassOn + '  backdrop-filter=' + e2e.blurWhilePlaying);
  console.log('  paused   -> classOff=' + e2e.pausedClassOff + '  backdrop-filter=' + e2e.blurWhilePaused);
  console.log('  resumed  -> class=' + e2e.resumeClassOn);
  console.log('  E2E ' + (e2eOk ? 'PASS' : 'FAIL'));

  console.log('');
  console.log('blur cost   (B vs C): ' + fmt((C.fps - B.fps) / (C.fps || 1) * 100, 1) + '% fps');
  console.log('video count (A, playing=' + A.playing + ') at ' + fmt(A.fps, 1) + ' fps');
  console.log('filter cost (D vs A): ' + fmt((A.fps - D.fps) / (A.fps || 1) * 100, 1) + '% fps');

  await browser.close();
})().catch((e) => { console.log('PROBE FAILED: ' + (e && e.message)); process.exit(1); });
