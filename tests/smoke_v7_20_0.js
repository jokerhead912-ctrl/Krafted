#!/usr/bin/env node
/**
 * smoke_v7_20_0.js — a LIVE browser check that a board text card now behaves
 * like an IMAGE card: one press drags it, double-click edits it, and a corner
 * handle scales the type with the box.
 *
 * WHY THIS EXISTS
 * --------------
 * test_v7_20_0.js EXECUTES scaleBoardTextFontSize and addTextHandles, and it
 * pins the rest of the wiring with structural assertions. That is exactly the
 * coverage shape v7.4.0 shipped with — 148 assertions green, every mutation
 * caught — while the feature had never actually run, because an anchor proves
 * the code EXISTS and a unit test proves it RUNS, and neither proves it is
 * CONNECTED.
 *
 * This file drives real Chrome with a real mouse and asserts on real
 * consequences:
 *   · a single press selects the card and does NOT put it into edit mode
 *   · one drag moves the card (the thing the user said was not working)
 *   · a double-click DOES enter edit mode
 *   · a corner handle drag scales the font proportionally
 *   · a drag on an EDITING card moves nothing (negative control — if this
 *     ever passes while the router is broken, the move assertions above are
 *     vacuous)
 *
 * It also re-verifies the one assumption the whole design rests on: that
 * preventDefault on mousedown does not swallow dblclick. If Chrome ever
 * changes that, this file is the thing that catches it, not a comment.
 *
 * USAGE
 *   node Krafted/tests/smoke_v7_20_0.js
 *   node Krafted/tests/smoke_v7_20_0.js --headful
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
const PORT = 8732;                  // NOT 8731 — smoke_v7_5_0 owns that one

let pass = 0, fail = 0;
const failures = [];

function ok(cond, label) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; failures.push(label); console.log('  FAIL ' + label); }
}
function eq(actual, expected, label) {
  ok(actual === expected, label + ' (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')');
}
function near(actual, expected, tol, label) {
  ok(Math.abs(actual - expected) <= tol,
    label + ' (got ' + actual + ', want ~' + expected + ' ±' + tol + ')');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function serve() {
  const PY = '/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3';
  return spawn(PY, ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', ROOT],
               { stdio: 'ignore' });
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
    'window.state && typeof window.addText === "function" && typeof window.state.texts !== "undefined"',
    { timeout: 30000 });
  // A deterministic board: no pan, no zoom, no welcome overlay.
  await page.evaluate(() => {
    state.pan.x = 0; state.pan.y = 0; state.zoom = 1;
    if (typeof updateCanvas === 'function') updateCanvas();
    if (typeof hideWelcome === 'function') hideWelcome();
    if (typeof clearSelection === 'function') clearSelection();
    if (typeof setTool === 'function') setTool('select');
  });
  page.__errors = errors;
  return page;
}

// Make one text card at world (300,200) and leave it SELECTED but NOT EDITING.
//
// { noFocus: true } is not a nicety. addText defers `el.focus()` into a
// requestAnimationFrame, so a blur() fired straight after the call lands
// BEFORE the focus and the card is editing again one frame later — which
// then makes routeBoardTextMouse take its one-click-edit branch and every
// "press 1 only selects" assertion below measures a card that was never in
// the state under test. Ask the app not to focus instead of racing it.
async function makeCard(page) {
  await page.evaluate(() => {
    addText(300, 200, 'Organise me', { noFocus: true });
  });
  await sleep(120);
  return page.evaluate(() => {
    const tx = state.texts[state.texts.length - 1];
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (tx.el.classList.contains('editing')) tx.el.classList.remove('editing');
    selectOnly(tx.id);
    const r = tx.el.getBoundingClientRect();
    return {
      id: tx.id, x: tx.x, y: tx.y, w: tx.w, h: tx.h, size: tx.size, zoom: state.zoom,
      cx: r.left + r.width / 2, cy: r.top + r.height / 2
    };
  });
}
const snap = (page, id) => page.evaluate((id) => {
  const tx = state.texts.find(t => t.id === id);
  const r = tx.el.getBoundingClientRect();
  return {
    x: tx.x, y: tx.y, w: tx.w, h: tx.h, size: tx.size,
    selected: state.selected.has(tx.id),
    editing: tx.el.classList.contains('editing'),
    focused: document.activeElement === tx.el,
    cx: r.left + r.width / 2, cy: r.top + r.height / 2
  };
}, id);

async function drag(page, fromX, fromY, toX, toY) {
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move((fromX + toX) / 2, (fromY + toY) / 2);
  await page.mouse.move(toX, toY);
  await page.mouse.up();
  await sleep(80);
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
    console.log('SKIP smoke_v7_20_0: puppeteer-core is not installed');
    console.log('  cd /Users/kincheung/.workbuddy/binaries/node/workspace && npm install puppeteer-core');
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
             '--metrics-recording-only',
             '--disable-features=RLZ,Translate,OptimizationHints,MediaRouter,CalculateNativeWinOcclusion']
    });

    // ── 1. one press selects and does NOT edit ────────────────────────────
    console.log('— press 1: select, never edit —');
    let page = await newPage(browser);
    let c0 = await makeCard(page);
    await page.mouse.click(c0.cx, c0.cy);
    await sleep(80);
    let s = await snap(page, c0.id);
    ok(s.selected, 'a single press selects the card');
    ok(!s.editing, 'a single press does NOT put the card into edit mode');
    ok(!s.focused, 'and the contentEditable body never takes focus (that is what used to force edit)');

    // ── 2. one drag moves it — the actual complaint ───────────────────────
    console.log('— drag 1: the card moves like an image —');
    await drag(page, c0.cx, c0.cy, c0.cx + 120, c0.cy + 60);
    s = await snap(page, c0.id);
    near(s.x - c0.x, 120, 6, 'the card moved 120px right in world space');
    near(s.y - c0.y, 60, 6, 'and 60px down');
    ok(!s.editing, 'dragging never drops the card into edit mode');
    ok(!s.focused, 'the drag did not paint a caret either');
    ok(s.selected, 'the card is still selected after the move');

    // ── 3. double-click DOES edit ─────────────────────────────────────────
    console.log('— double-click: the way into edit mode —');
    s = await snap(page, c0.id);
    await page.mouse.click(s.cx, s.cy);
    await sleep(40);
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await sleep(120);
    s = await snap(page, c0.id);
    ok(s.editing, 'double-click puts the card into edit mode');
    ok(s.focused, 'and the body really has focus (a caret you can type at)');

    // ── 4. negative control: an EDITING card keeps native text behaviour ──
    // If this moves, the router is not what is making section 2 work and
    // every assertion above is measuring something else.
    console.log('— negative control: an editing card must NOT be dragged —');
    const beforeEditDrag = s.x;
    await drag(page, s.cx, s.cy, s.cx + 90, s.cy + 40);
    s = await snap(page, c0.id);
    near(s.x, beforeEditDrag, 3, 'a drag inside an EDITING card moves nothing');
    ok(s.editing, 'and the card is still in edit mode afterwards');

    // ── 5. a corner handle scales the type with the box ──────────────────
    console.log('— corner handle: scale like an image —');
    await page.evaluate(() => {
      if (typeof finishBoardTextEditing === 'function') finishBoardTextEditing();
      const tx = state.texts[state.texts.length - 1];
      // Committing the edit can drop the selection, and the handles only
      // exist while the card is selected — re-select, which also rebuilds
      // the .text-handles box.
      selectOnly(tx.id);
    });
    await sleep(120);
    const pre = await snap(page, c0.id);
    const corner = await page.evaluate((id) => {
      const box = document.querySelector('.text-handles[data-owner="' + id + '"]');
      if (!box) return null;
      const h = box.querySelector('.item-handle.se');
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, corners: box.querySelectorAll('.item-handle').length };
    }, c0.id);
    ok(!!corner, 'the card has a .item-handle.se corner handle in its .text-handles box');
    if (corner) {
      eq(corner.corners, 6, 'the box carries 6 handles (4 corners + the original e/w pair)');
      await drag(page, corner.x, corner.y, corner.x + 150, corner.y + 60);
      const post = await snap(page, c0.id);
      ok(post.w > pre.w + 20, 'the corner drag widened the card (got ' + Math.round(post.w) + ', from ' + Math.round(pre.w) + ')');
      const wRatio = post.w / pre.w;
      near(post.size / pre.size, wRatio, Math.max(0.06, wRatio * 0.04),
        'the font scaled by the SAME ratio as the box (box x' + wRatio.toFixed(2) + ')');
      ok(post.h > pre.h, 'and the height followed, so the card kept its shape');
    }

    const errs = page.__errors || [];
    ok(errs.length === 0, 'no uncaught page errors (' + errs.slice(0, 2).join(' | ') + ')');
    await page.close();
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  console.log('');
  console.log('smoke_v7_20_0: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) {
    failures.forEach(f => console.log('  FAILED: ' + f));
    return 1;
  }
  console.log('ALL PASS (' + pass + ' assertions)');
  return 0;
}

main().then(code => process.exit(code)).catch(e => {
  console.log('smoke_v7_20_0 crashed: ' + (e && e.stack || e));
  process.exit(1);
});
