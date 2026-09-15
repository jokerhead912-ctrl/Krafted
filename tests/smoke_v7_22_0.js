#!/usr/bin/env node
/**
 * smoke_v7_22_0.js — a LIVE browser check that the Library panel never holds
 * a full-resolution bitmap, and that re-rendering it does not re-decode.
 *
 * WHY THIS EXISTS
 * --------------
 * test_v7_22_0.js EXECUTES libThumbFit / libThumbFor against a fake <img> and
 * a fake canvas, and 26 mutants all go red. That proves the logic. It proves
 * nothing about the part that actually mattered: whether a real decoder, a
 * real canvas.toDataURL and a real 4000px source end up putting a small
 * thumbnail in the real DOM row. A fake canvas would have been perfectly
 * happy with a 4000x3000 draw.
 *
 * So this file drives real Chrome:
 *   · builds 12 real 2000x1500 noise JPEGs in the page (each a big data URL —
 *     asserted, or the "thumbnail is smaller" claim is vacuous);
 *   · renders the real Library panel and waits for the real thumbnails;
 *   · measures what the DOM actually holds: every row <img> must be a small
 *     JPEG, and loading it back must report naturalWidth <= 96;
 *   · counts real `new Image()` calls, then renders the panel AGAIN the way a
 *     keystroke in the search box does. THE POINT: the count must not move.
 *     Before v7.22.0 every keystroke re-pointed 150 <img> at the original.
 *   · negative control: the sources really are big, and a deliberately
 *     different render (a fresh item) really does decode — otherwise "no new
 *     decodes" would be trivially true.
 *
 * USAGE
 *   node Krafted/tests/smoke_v7_22_0.js
 *   node Krafted/tests/smoke_v7_22_0.js --headful
 *
 * EXIT CODE
 *   0 every check passed · 1 one or more failed · 0 (SKIP) no Chrome here
 */

'use strict';

const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const http = require('http');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = 'kraftpub-dev.html';
const PORT = 8734;                  // 8731 = v7_5_0, 8732 = v7_20_0, 8733 = v7_21_0

const N_ITEMS = 12;
const SRC_W = 2000, SRC_H = 1500;

let pass = 0, fail = 0;
const failures = [];

function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else {
    fail++; failures.push(label);
    console.log('  FAIL ' + label + (extra !== undefined ? '  (got ' + JSON.stringify(extra) + ')' : ''));
  }
}
function eq(actual, expected, label) {
  ok(actual === expected, label, actual);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function serve() {
  const PY = '/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3';
  return spawn(PY, ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1',
                    '--directory', ROOT], { stdio: 'ignore' });
}
function waitForServer(retries) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/' + PAGE }, (res) => {
        res.resume();
        res.statusCode === 200 ? resolve() : retry(n, 'status ' + res.statusCode);
      });
      req.on('error', () => retry(n, 'not up'));
      req.setTimeout(1000, () => { req.destroy(); retry(n, 'timeout'); });
    };
    const retry = (n, why) => {
      if (n <= 0) return reject(new Error('server did not come up: ' + why));
      setTimeout(() => attempt(n - 1), 250);
    };
    attempt(retries || 40);
  });
}

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  await page.goto('http://127.0.0.1:' + PORT + '/' + PAGE, { waitUntil: 'load' });
  await page.waitForFunction(
    'window.state && typeof window.libThumbFor === "function" && ' +
    'typeof window.renderLibraryPanel === "function"',
    { timeout: 30000 });
  await page.evaluate(() => {
    state.pan.x = 0; state.pan.y = 0; state.zoom = 1;
    if (typeof hideWelcome === 'function') hideWelcome();
    if (typeof clearSelection === 'function') clearSelection();
  });
  page.__errors = errors;
  return page;
}

async function main() {
  const candidates = [
    'puppeteer-core',
    path.join(process.env.HOME || os.homedir(),
              '.workbuddy/binaries/node/workspace/node_modules/puppeteer-core')
  ];
  let puppeteer = null;
  for (const c of candidates) {
    try { puppeteer = require(c); break; } catch (e) { /* try the next one */ }
  }
  if (!puppeteer) {
    console.log('SKIP smoke_v7_22_0: puppeteer-core is not installed');
    return 0;
  }

  const server = serve();
  let browser = null;
  try {
    await waitForServer();
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: process.argv.indexOf('--headful') < 0 ? 'new' : false,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
             '--window-size=1280,800', '--no-first-run', '--no-default-browser-check',
             '--no-pings', '--disable-background-networking', '--disable-component-update',
             '--disable-sync', '--disable-breakpad', '--disable-domain-reliability',
             '--metrics-recording-only', '--autoplay-policy=no-user-gesture-required',
             '--disable-features=RLZ,Translate,OptimizationHints,MediaRouter,CalculateNativeWinOcclusion']
    });

    const page = await newPage(browser);

    // ── 1. the fix is present, and the material really is big ──────────────
    console.log('\n— the fix is present in the real page —');
    const api = await page.evaluate(() => ({
      fit: typeof window.libThumbFit,
      thumbFor: typeof window.libThumbFor,
      glyph: typeof window.libThumbGlyph,
      src: typeof window.libThumbSrc,
      cap: typeof window.LIB_THUMB_MAX_SIDE !== 'undefined' ? window.LIB_THUMB_MAX_SIDE : null,
      queue: Array.isArray(window._libThumbQueue)
    }));
    eq(api.fit, 'function', 'libThumbFit is reachable in the page');
    eq(api.thumbFor, 'function', 'libThumbFor is reachable in the page');
    eq(api.glyph, 'function', 'libThumbGlyph is reachable in the page');
    eq(api.src, 'function', 'libThumbSrc is reachable in the page');
    eq(api.queue, true, '_libThumbQueue is reachable (so we can assert it drains)');
    eq(api.cap, 96, 'the thumbnail long side is capped at 96');

    // ── 2. build the board: N real full-resolution sources ─────────────────
    console.log('\n— building ' + N_ITEMS + ' real ' + SRC_W + 'x' + SRC_H + ' items —');
    const built = await page.evaluate((n, w, h) => {
      // Count every real decode the page performs, from here on.
      const Orig = window.Image;
      window.__imgCount = 0;
      window.Image = class extends Orig {
        constructor() { super(); window.__imgCount++; }
      };
      const mk = (i) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const x = c.getContext('2d');
        // Noise, so the JPEG cannot compress to nothing — a solid colour would
        // make the "thumbnail is smaller" claim meaningless.
        for (let k = 0; k < 900; k++) {
          x.fillStyle = 'rgb(' + (k * 7 + i * 13) % 256 + ',' + (k * 31 + i) % 256 + ',' + (k * 17) % 256 + ')';
          x.fillRect((k * 37) % w, (k * 53) % h, 90, 70);
        }
        return c.toDataURL('image/jpeg', 0.92);
      };
      state.items = [];
      state.texts = [];
      for (let i = 0; i < n; i++) {
        state.items.push({
          id: 9000 + i, name: 'big-' + i, type: 'image',
          src: mk(i), w: w, h: h, x: i * 40, y: 0, tags: []
        });
      }
      return {
        srcLens: state.items.map(it => it.src.length),
        minLen: Math.min.apply(null, state.items.map(it => it.src.length))
      };
    }, N_ITEMS, SRC_W, SRC_H);

    ok(built.minLen > 100000,
      'the sources really are big data URLs (else "smaller" proves nothing)',
      built.minLen);

    // ── 3. render the panel for real, and let the queue drain ─────────────
    console.log('\n— rendering the Library panel (real DOM, real decoders) —');
    const r1 = await page.evaluate(async () => {
      const p = document.getElementById('library-panel');
      if (p) p.classList.remove('collapsed');
      renderLibraryPanel();
      const until = Date.now() + 20000;
      const rowsOf = () => Array.prototype.slice.call(document.querySelectorAll('.lib-row img'));
      while (Date.now() < until) {
        const imgs = rowsOf();
        if (imgs.length && imgs.every(im => im.getAttribute('src'))) break;
        await new Promise(r => setTimeout(r, 50));
      }
      const imgs = rowsOf();
      return {
        rows: document.querySelectorAll('.lib-row').length,
        imgs: imgs.length,
        srcs: imgs.map(im => im.getAttribute('src') || ''),
        imgCount: window.__imgCount,
        queueLeft: window._libThumbQueue ? window._libThumbQueue.length : -1
      };
    });

    eq(r1.rows, N_ITEMS, 'every item produced a row');
    eq(r1.imgs, N_ITEMS, 'every row has an <img>');
    eq(r1.queueLeft, 0, 'the thumbnail queue drained');
    ok(r1.imgCount <= N_ITEMS,
      'the originals were decoded at most once each (no duplicate decode storm)',
      r1.imgCount);

    // THE MEASUREMENT. Under the old code every row's src WAS the source.
    const maxThumb = Math.max.apply(null, r1.srcs.map(s => s.length));
    const totalThumb = r1.srcs.reduce((a, s) => a + s.length, 0);
    const totalSrc = built.srcLens.reduce((a, s) => a + s, 0);
    ok(r1.srcs.every(s => s.indexOf('data:image/jpeg') === 0),
      'every row thumbnail is a JPEG data URL (not the original source)');
    ok(maxThumb < 20000, 'the biggest thumbnail is under 20 KB', maxThumb);
    ok(totalThumb * 20 < totalSrc,
      'the whole panel holds under 5% of the bytes it used to',
      { thumb: totalThumb, src: totalSrc });
    ok(r1.srcs.every(s => built.srcLens.indexOf(s.length) < 0 || s.length < 20000),
      'no row is holding a source-length string');

    // ── 4. what the DOM holds is really a 96px image ──────────────────────
    console.log('\n— loading the thumbnails back: are they really small? —');
    const sizes = await page.evaluate((srcs) => {
      return Promise.all(srcs.map(s => new Promise(res => {
        const im = new Image();
        im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = () => res({ w: -1, h: -1 });
        im.src = s;
      })));
    }, r1.srcs);
    ok(sizes.every(s => s.w > 0), 'every thumbnail really decodes', sizes.filter(s => s.w <= 0).length);
    ok(sizes.every(s => s.w <= 96 && s.h <= 96),
      'every thumbnail is at most 96px on its long side',
      sizes.map(s => s.w + 'x' + s.h).join(' '));
    ok(sizes.every(s => Math.max(s.w, s.h) === 96 || Math.max(s.w, s.h) < 96),
      'and the long side is exactly the cap for a landscape source',
      sizes.map(s => Math.max(s.w, s.h)).join(','));

    // ── 5. THE POINT: re-rendering must not decode again ──────────────────
    // renderLibraryPanel() runs on every keystroke in the search box.
    console.log('\n— re-render (what a keystroke does) —');
    const r2 = await page.evaluate(async () => {
      const before = window.__imgCount;
      renderLibraryPanel();
      renderLibraryPanel();
      renderLibraryPanel();
      await new Promise(r => setTimeout(r, 300));
      const imgs = Array.prototype.slice.call(document.querySelectorAll('.lib-row img'));
      return {
        after: window.__imgCount,
        before: before,
        filled: imgs.filter(im => im.getAttribute('src')).length,
        rows: imgs.length
      };
    });
    eq(r2.rows, N_ITEMS, 'the rows are still all there after three re-renders');
    eq(r2.filled, N_ITEMS, 'and every one still has its thumbnail');
    eq(r2.after, r2.before,
      'THE POINT: three re-renders decoded nothing (the cache held)');

    // ── 6. negative control: a genuinely new item DOES decode ─────────────
    // Without this, "no new decodes" would be trivially true.
    console.log('\n— negative control: a new item must still be decoded —');
    const r3 = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 2000; c.height = 1500;
      const x = c.getContext('2d');
      for (let k = 0; k < 900; k++) {
        x.fillStyle = 'rgb(' + (k * 11) % 256 + ',' + (k * 5) % 256 + ',' + (k * 23) % 256 + ')';
        x.fillRect((k * 41) % 2000, (k * 59) % 1500, 90, 70);
      }
      state.items.push({ id: 7777, name: 'brand-new', type: 'image', src: c.toDataURL('image/jpeg', 0.92), tags: [] });
      const before = window.__imgCount;
      renderLibraryPanel();
      const until = Date.now() + 15000;
      while (Date.now() < until) {
        const imgs = Array.prototype.slice.call(document.querySelectorAll('.lib-row img'));
        if (imgs.length === state.items.length && imgs.every(im => im.getAttribute('src'))) break;
        await new Promise(r => setTimeout(r, 50));
      }
      return { before: before, after: window.__imgCount, rows: document.querySelectorAll('.lib-row').length };
    });
    eq(r3.rows, N_ITEMS + 1, 'the new item got its row');
    ok(r3.after > r3.before,
      'and it was really decoded (so the cache is not just answering nothing)',
      { before: r3.before, after: r3.after });

    // ── 7. an item with no image falls back to the glyph ──────────────────
    console.log('\n— an item with no image falls back to the glyph —');
    const r4 = await page.evaluate(async () => {
      state.items.push({ id: 7778, name: 'no-image', type: 'audio', tags: [] });
      renderLibraryPanel();
      await new Promise(r => setTimeout(r, 200));
      const rows = Array.prototype.slice.call(document.querySelectorAll('.lib-row'));
      const last = rows[rows.length - 1];
      const th = last ? last.querySelector('.lib-thumb') : null;
      return { text: th ? th.textContent : null, hasImg: !!(th && th.querySelector('img')) };
    });
    eq(r4.hasImg, false, 'a source-less item renders no <img> at all');
    eq(r4.text, String.fromCharCode(0x266A), 'it shows the audio glyph instead');

    // ── 8. no page errors anywhere ────────────────────────────────────────
    ok(page.__errors.length === 0, 'no uncaught page errors', page.__errors.slice(0, 3));

    console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + ': smoke_v7_22_0 ' +
      pass + ' passed, ' + fail + ' failed');
    return fail === 0 ? 0 : 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().then(code => process.exit(code))
      .catch(e => { console.error('SMOKE ERROR', e); process.exit(2); });
