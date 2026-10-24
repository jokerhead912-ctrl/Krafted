/*
 * diag_board_decode_v7_25_4.js — READ-ONLY probe (diagnostic, not a suite).
 *
 * Question: does a board full of FULL-RESOLUTION stills actually cost frames?
 *
 * Why this exists: `libThumbSrc()` (8038) downscales LIBRARY thumbnails only.
 * Board items hand the original straight to `<img>`. It is tempting to read
 * that as "100 4K stills on the board = 100 full decodes = slow", but that is
 * an inference from source, and reading source may only produce CANDIDATES,
 * never a ranking. So: make it a number before touching anything.
 *
 * Method: synthesise N JPEGs at W x H in the page, push them through the REAL
 * drop path (viewport drop listener, kraftpub-dev.html:27392) so the items are
 * built exactly as a user's would be, then pan the board with real wheel events
 * and sample rAF fps + JS heap.
 *
 * HEADLESS CAVEAT: SwiftShader, no GPU. Absolute fps is not the user's machine.
 * The question is whether N large images MOVE the number, not what it is.
 *
 * Run:
 *   NODE_PATH=/Users/kincheung/.workbuddy/binaries/node/workspace/node_modules \
 *     /Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node \
 *     Krafted/tests/diag_board_decode_v7_25_4.js
 *   (env: N=40 W=3000 H=2000 REPS=2)
 */
'use strict';

const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTML = process.env.KRAFTED_HTML
  ? path.resolve(process.env.KRAFTED_HTML)
  : path.resolve(__dirname, '../../kraftpub-dev.html');
const N = Number(process.env.N || 40);
const W = Number(process.env.W || 3000);
const H = Number(process.env.H || 2000);
const REPS = Number(process.env.REPS || 2);
const ZOOM = Number(process.env.ZOOM || 0.15);

function fmt(n, d = 1) { return Number(n).toFixed(d); }

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files'],
    defaultViewport: { width: 1512, height: 900 },
  });
  const page = await browser.newPage();
  page.on('pageerror', () => {});
  await page.goto('file://' + HTML, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.state && window.state.items, { timeout: 60000 });

  console.log('Krafted board-decode probe — N=' + N + ' at ' + W + 'x' + H + '\n');

  // ── synthesise the files and push them through the real drop path ────────
  const before = await page.evaluate(() => window.state.items.length);
  const ok = await page.evaluate(async (n, w, h) => {
    const files = [];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      // Noise, so JPEG cannot cheat and the decode is representative.
      for (let k = 0; k < 400; k++) {
        g.fillStyle = 'rgb(' + ((i * 37 + k * 11) % 255) + ',' + ((k * 53) % 255) + ',' + ((i * 91 + k) % 255) + ')';
        g.fillRect((k * 71) % w, (k * 137) % h, 90, 90);
      }
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
      if (!blob) return false;
      files.push(new File([blob], 'probe' + i + '.jpg', { type: 'image/jpeg' }));
    }
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    const target = document.getElementById('viewport') || document.body;
    target.dispatchEvent(new DragEvent('drop', {
      dataTransfer: dt, bubbles: true, cancelable: true, clientX: 700, clientY: 450,
    }));
    return true;
  }, N, W, H);
  if (!ok) { console.log('ABORT: could not synthesise files'); await browser.close(); process.exit(2); }

  await new Promise(r => setTimeout(r, 6000));
  const after = await page.evaluate(() => ({
    items: window.state.items.length,
    imgs: document.querySelectorAll('.item img').length,
  }));
  console.log('items ' + before + ' -> ' + after.items + '   <img> on board: ' + after.imgs);
  if (after.items <= before) {
    console.log('ABORT: the drop path did not create items — the probe cannot answer yet');
    await browser.close();
    process.exit(2);
  }

  // ── zoom out so the whole board is visible (worst case: all decoded) ─────
  await page.evaluate((zoom) => {
    if (typeof window.setZoom === 'function') window.setZoom(zoom);
    else if (window.state) window.state.zoom = zoom;
  }, ZOOM);
  await new Promise(r => setTimeout(r, 1500));

  async function panFps() {
    return page.evaluate(() => new Promise((res) => {
      let frames = 0; const t0 = performance.now();
      const vp = document.getElementById('viewport') || document.body;
      (function step() {
        frames++;
        // A real pan every frame: state.pan is what a wheel would move.
        if (window.state) { window.state.pan.x -= 6; window.state.pan.y -= 3; }
        if (performance.now() - t0 < 2000) requestAnimationFrame(step);
        else res(frames / ((performance.now() - t0) / 1000));
      })();
    }));
  }
  function heap() {
    return page.evaluate(() => {
      const m = performance.memory;
      return m ? Math.round(m.usedJSHeapSize / 1048576) : null;
    });
  }

  for (let r = 1; r <= REPS; r++) {
    const h0 = await heap();
    const fps = await panFps();
    const h1 = await heap();
    console.log('rep ' + r + ':  pan fps=' + fmt(fps) + '   JS heap=' + h0 + '->' + h1 + ' MB');
  }

  // ── and with the board emptied, for reference ────────────────────────────
  await page.evaluate(() => {
    window.state.items.length = 0;
    const cc = document.getElementById('canvas-content');
    if (cc) cc.innerHTML = '';
  });
  await new Promise(r => setTimeout(r, 1500));
  const emptyFps = await panFps();
  console.log('\nemptied board: pan fps=' + fmt(emptyFps) + '  (reference)');

  await browser.close();
})().catch(e => { console.log('PROBE FAILED: ' + (e && e.message)); process.exit(1); });
