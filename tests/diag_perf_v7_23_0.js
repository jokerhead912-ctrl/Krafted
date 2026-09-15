/*
 * diag_perf_v7_23_0.js — READ-ONLY performance probe (diagnostic, not a suite).
 *
 * Question being answered: on a ~300-item board, what actually costs time when
 * the user pans / zooms, and what does a video card cost per frame?
 *
 * Method: real Chrome, real (trusted) wheel events dispatched through CDP so the
 * browser's own event coalescing is in play. `updateCanvas()` and each of its
 * sub-steps are timed individually with a forced layout flush between calls,
 * because that is what happens in practice (every wheel event lands in its own
 * task, so style writes are flushed before the next one).
 *
 * HEADLESS CAVEAT: numbers are relative, not absolute. Headless Chrome has no
 * real GPU raster path. Use the *ratios* (0 items vs 300 items, with vs without
 * strokes), not the milliseconds, to rank the bottlenecks.
 *
 * Run:
 *   NODE_PATH=/Users/kincheung/.workbuddy/binaries/node/workspace/node_modules \
 *     /Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node \
 *     Krafted/tests/diag_perf_v7_23_0.js
 */
'use strict';

const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTML = process.env.KRAFTED_HTML
  ? path.resolve(process.env.KRAFTED_HTML)
  : path.resolve(__dirname, '../../kraftpub-dev.html');

const N_ITEMS = Number(process.env.N_ITEMS || 300);
const N_STROKES = Number(process.env.N_STROKES || 200);

function fmt(n, d = 2) { return Number(n).toFixed(d); }
function pctBar(ms, max, width = 28) {
  const n = Math.max(0, Math.min(width, Math.round((ms / max) * width)));
  return '#'.repeat(n) + '.'.repeat(width - n);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files'],
    defaultViewport: { width: 1512, height: 900 },
  });
  const page = await browser.newPage();
  page.on('pageerror', () => { /* the app logs noise we do not care about */ });

  await page.goto('file://' + HTML, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(
    () => typeof window.addImage === 'function' && window.state && window.state.items,
    { timeout: 60000 }
  );

  console.log('Krafted perf probe — ' + path.basename(HTML));
  console.log('target: ' + N_ITEMS + ' items, ' + N_STROKES + ' draw strokes\n');

  // ── 1. baseline: empty board ─────────────────────────────────────────────
  const baseline = await page.evaluate(() => {
    const flush = () => void document.body.offsetHeight;
    const time = (fn, iters) => {
      fn(); flush();
      const t0 = performance.now();
      for (let i = 0; i < iters; i++) { fn(); flush(); }
      return (performance.now() - t0) / iters;
    };
    return {
      items: window.state.items.length,
      updateCanvas: time(() => window.updateCanvas(), 30),
      domNodes: document.querySelectorAll('*').length,
    };
  });
  console.log('— baseline (empty board) —');
  console.log('  items on board      : ' + baseline.items);
  console.log('  DOM nodes           : ' + baseline.domNodes);
  console.log('  updateCanvas()      : ' + fmt(baseline.updateCanvas) + ' ms/call');

  // ── 2. build N real items through the app's own add path ─────────────────
  const built = await page.evaluate(async (n) => {
    // Four distinct sources so the browser cannot collapse everything into one
    // cached decode; 400x300 is a stand-in for a real reference still.
    const srcs = [];
    for (let k = 0; k < 4; k++) {
      const c = document.createElement('canvas');
      c.width = 400; c.height = 300;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 400, 300);
      grad.addColorStop(0, 'hsl(' + (k * 90) + ',40%,55%)');
      grad.addColorStop(1, 'hsl(' + (k * 90 + 40) + ',30%,20%)');
      g.fillStyle = grad; g.fillRect(0, 0, 400, 300);
      g.fillStyle = 'rgba(255,255,255,.5)';
      for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 400, Math.random() * 300, 8, 8);
      srcs.push(c.toDataURL('image/jpeg', 0.8));
    }
    const before = window.state.items.length;
    const cols = 24;
    for (let i = 0; i < n; i++) {
      const x = (i % cols) * 210;
      const y = Math.floor(i / cols) * 160;
      try { window.addImage(srcs[i % 4], 400, 300, x, y); } catch (e) { /* keep going */ }
    }
    // addImage is async (it waits for load); give it a beat.
    await new Promise(r => setTimeout(r, 1500));
    return { added: window.state.items.length - before, total: window.state.items.length };
  }, N_ITEMS);
  console.log('\n— built board —');
  console.log('  items added         : ' + built.added + ' (total ' + built.total + ')');

  // ── 3. per-step breakdown of updateCanvas() at N items ───────────────────
  const steps = await page.evaluate(() => {
    const flush = () => void document.body.offsetHeight;
    const time = (fn, iters) => {
      try { fn(); } catch (e) { return null; }
      flush();
      const t0 = performance.now();
      for (let i = 0; i < iters; i++) { try { fn(); } catch (e) {} flush(); }
      return (performance.now() - t0) / iters;
    };
    const ITERS = 30;
    return {
      items: window.state.items.length,
      domNodes: document.querySelectorAll('*').length,
      updateCanvas: time(() => window.updateCanvas(), ITERS),
      redrawDrawLayer: time(() => window.redrawDrawLayer(), ITERS),
      renderRelations: time(() => window.renderRelations(), ITERS),
      updateAllGroupBorders: time(() => window.updateAllGroupBorders(), ITERS),
      cullOffscreenItems: time(() => window.cullOffscreenItems(), ITERS),
      btMoveScan: time(() => {
        document.querySelectorAll('.bt-move').forEach(el => {
          el.style.transform = 'scale(' + (1 / Math.max(0.05, window.state.zoom)) + ')';
        });
      }, ITERS),
    };
  });

  console.log('\n— updateCanvas() breakdown @ ' + steps.items + ' items (' + steps.domNodes + ' DOM nodes) —');
  console.log('  updateCanvas()        : ' + fmt(steps.updateCanvas) + ' ms/call');
  const parts = [
    ['redrawDrawLayer', steps.redrawDrawLayer],
    ['renderRelations', steps.renderRelations],
    ['updateAllGroupBorders', steps.updateAllGroupBorders],
    ['cullOffscreenItems', steps.cullOffscreenItems],
    ['.bt-move qsa+write', steps.btMoveScan],
  ].filter(p => p[1] !== null).sort((a, b) => b[1] - a[1]);
  const max = Math.max.apply(null, parts.map(p => p[1]).concat([0.0001]));
  for (const [name, ms] of parts) console.log('  ' + pctBar(ms, max) + '  ' + name.padEnd(24) + fmt(ms) + ' ms');
  const sum = parts.reduce((a, p) => a + p[1], 0);
  console.log('  measured subtotal     : ' + fmt(sum) + ' ms  (of ' + fmt(steps.updateCanvas) + ' total)');

  // ── 4. with draw strokes on the draw layer ───────────────────────────────
  const withStrokes = await page.evaluate(async (n) => {
    const G = window.G || (window.state && window.state.G);
    if (!G) return { skipped: true };
    G.drawStrokes = G.drawStrokes || [];
    for (let i = 0; i < n; i++) {
      const pts = [];
      const bx = (i % 20) * 90, by = Math.floor(i / 20) * 90;
      for (let k = 0; k < 24; k++) pts.push([(bx + k * 3 + Math.random() * 2) / 1512, (by + Math.sin(k / 3) * 12) / 900]);
      G.drawStrokes.push({ id: 'probe' + i, points: pts, color: '#e8e8e8', width: 2, mode: 'draw' });
    }
    const flush = () => void document.body.offsetHeight;
    const time = (fn, iters) => {
      fn(); flush();
      const t0 = performance.now();
      for (let i = 0; i < iters; i++) { fn(); flush(); }
      return (performance.now() - t0) / iters;
    };
    return {
      strokes: G.drawStrokes.length,
      redrawDrawLayer: time(() => window.redrawDrawLayer(), 20),
      updateCanvas: time(() => window.updateCanvas(), 20),
    };
  }, N_STROKES);

  if (withStrokes.skipped) {
    console.log('\n— draw layer — SKIPPED (no window.G.drawStrokes reachable)');
  } else {
    console.log('\n— draw layer @ ' + withStrokes.strokes + ' strokes —');
    console.log('  redrawDrawLayer()     : ' + fmt(withStrokes.redrawDrawLayer) + ' ms/call  (was ' + fmt(steps.redrawDrawLayer) + ' with none)');
    console.log('  updateCanvas()        : ' + fmt(withStrokes.updateCanvas) + ' ms/call  (was ' + fmt(steps.updateCanvas) + ')');
  }

  // ── 5. end-to-end: real trusted wheel events, measure frame delivery ─────
  const swipe = async (label) => {
    await page.evaluate(() => {
      window.__frames = [];
      window.__rec = true;
      let last = performance.now();
      const rec = (t) => {
        if (!window.__rec) return;
        window.__frames.push(t - last); last = t;
        requestAnimationFrame(rec);
      };
      requestAnimationFrame(rec);
    });
    await page.mouse.move(760, 450);
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
      await page.mouse.wheel({ deltaY: 14, deltaX: 6 });
    }
    const wall = Date.now() - t0;
    const res = await page.evaluate(() => {
      window.__rec = false;
      const f = window.__frames.slice(3); // drop warm-up
      if (!f.length) return { frames: 0 };
      const sorted = f.slice().sort((a, b) => a - b);
      return {
        frames: f.length,
        avg: f.reduce((a, b) => a + b, 0) / f.length,
        p95: sorted[Math.floor(sorted.length * 0.95)],
        worst: sorted[sorted.length - 1],
        over32: f.filter(x => x > 32).length,
      };
    });
    console.log('  ' + label);
    if (!res.frames) { console.log('    (no frames recorded)'); return; }
    console.log('    wall ' + wall + ' ms · ' + res.frames + ' frames · avg ' + fmt(res.avg, 1) + ' ms (' + fmt(1000 / res.avg, 0) + ' fps)');
    console.log('    p95 ' + fmt(res.p95, 1) + ' ms · worst ' + fmt(res.worst, 1) + ' ms · frames >32ms: ' + res.over32);
  };

  console.log('\n— end-to-end pan: 60 real wheel events —');
  await swipe('board with ' + steps.items + ' items' + (withStrokes.strokes ? ' + ' + withStrokes.strokes + ' strokes' : ''));

  // ── 6. video: how many <video> elements are live right now ───────────────
  const videoInfo = await page.evaluate(() => {
    const vids = Array.from(document.querySelectorAll('video'));
    return {
      count: vids.length,
      playing: vids.filter(v => !v.paused && !v.ended).length,
      preload: vids.map(v => v.preload),
      maxConcurrent: (typeof window.MAX_CONCURRENT_VIDEOS === 'number') ? window.MAX_CONCURRENT_VIDEOS : null,
    };
  });
  console.log('\n— video —');
  console.log('  <video> live: ' + videoInfo.count + ' · playing: ' + videoInfo.playing +
    ' · MAX_CONCURRENT_VIDEOS: ' + (videoInfo.maxConcurrent === null ? 'not a global' : videoInfo.maxConcurrent));

  // ── 7. HUD: cost of one playback HUD update ──────────────────────────────
  const hud = await page.evaluate(() => {
    const out = {};
    if (typeof window._p0UpdatePlaybackHud === 'function') {
      out.exists = true;
      const t0 = performance.now();
      for (let i = 0; i < 200; i++) { try { window._p0UpdatePlaybackHud(false); } catch (e) { break; } }
      out.ms = (performance.now() - t0) / 200;
    } else { out.exists = false; }
    return out;
  });
  console.log('\n— playback HUD —');
  console.log(hud.exists
    ? '  _p0UpdatePlaybackHud(): ' + fmt(hud.ms, 3) + ' ms/call (no video selected → mostly early-out)'
    : '  _p0UpdatePlaybackHud not reachable as a global (scoped inside buildMediaControls)');

  await browser.close();
  console.log('\nprobe done.');
})().catch(e => { console.error('probe failed:', e && e.message); process.exit(1); });
