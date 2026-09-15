#!/usr/bin/env node
/**
 * smoke_v7_24_0.js — a LIVE browser check that the Rotate row actually turns
 * the card.
 *
 * WHY THIS EXISTS
 * --------------
 * test_v7_24_0.js EXECUTES syncRotationUI / setRotation / resetRotation against
 * a fake DOM and every one of the 20 mutants goes red. That proves the code.
 * It proves nothing about the part the director will actually touch: that the
 * new number box and the new reset button are in the real panel, are not
 * hidden or clipped by CSS, are wired to the real handlers, and that a rotation
 * typed into a box ends up as a real `rotate(Ndeg)` on the real item element.
 *
 * So this file drives real Chrome, adds a real item through the real addImage,
 * and then:
 *   · types an angle into #prop-rotate-num and fires a real `change`;
 *   · asserts the item's rot, the DOM transform, the slider AND the box agree;
 *   · drags the slider (real `input` event) and asserts the box follows;
 *   · clicks #btn-reset-rot and asserts the card is visibly back to 0deg;
 *   · asserts a real undo step landed on state.undoStack (so a mistyped angle
 *     is recoverable, which is the whole reason for the guard);
 *   · negative control: the row must be VISIBLE and wide enough to hit — a
 *     control that exists in the markup but is clipped to 0px is not a feature.
 *
 * USAGE
 *   node Krafted/tests/smoke_v7_24_0.js
 *   node Krafted/tests/smoke_v7_24_0.js --headful
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
const PORT = 8743;                  // 8734 = v7_22_0, 8741 = anno diag, 8742 = v7_23_0

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else {
    fail++; failures.push(label);
    console.log('  FAIL ' + label + (extra !== undefined ? '  (got ' + JSON.stringify(extra) + ')' : ''));
  }
}
function eq(a, b, label) { ok(a === b, label, a); }

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

async function main() {
  const candidates = [
    'puppeteer-core',
    path.join(process.env.HOME || os.homedir(),
              '.workbuddy/binaries/node/workspace/node_modules/puppeteer-core')
  ];
  let puppeteer = null;
  for (const c of candidates) { try { puppeteer = require(c); break; } catch (e) {} }
  if (!puppeteer) { console.log('SKIP smoke_v7_24_0: puppeteer-core is not installed'); return 0; }

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
             '--metrics-recording-only', '--autoplay-policy=no-user-gesture-required']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    await page.goto('http://127.0.0.1:' + PORT + '/' + PAGE, { waitUntil: 'load' });
    await page.waitForFunction(
      'window.state && typeof window.addImage === "function" && ' +
      'typeof window.syncRotationUI === "function"', { timeout: 30000 });
    await page.evaluate(() => {
      state.pan.x = 0; state.pan.y = 0; state.zoom = 1;
      if (typeof hideWelcome === 'function') hideWelcome();
      if (document.getElementById('props') && document.getElementById('props').classList.contains('collapsed')) {
        const t = document.getElementById('props-toggle');
        if (t) t.click();
      }
      if (typeof updateCanvas === 'function') updateCanvas();
    });

    // ── 1. a real item, selected ──────────────────────────────────────────
    console.log('\n— adding a real item —');
    const added = await page.evaluate(() => {
      const cv = document.createElement('canvas');
      cv.width = 200; cv.height = 120;
      const c = cv.getContext('2d');
      c.fillStyle = '#c33'; c.fillRect(0, 0, 200, 120);
      c.fillStyle = '#fff'; c.fillRect(0, 0, 40, 40);
      const before = state.items.length;
      addImage(cv.toDataURL('image/png'), 200, 120, 120, 120);
      const it = state.items[state.items.length - 1];
      if (typeof updatePropsPanel === 'function') updatePropsPanel();
      return { before: before, after: state.items.length, id: it && it.id,
               rot: it && it.rot, hasEl: !!(it && it.el) };
    });
    ok(added.after === added.before + 1, 'the item was added');
    ok(added.hasEl, 'the item has a DOM element');

    // ── 0. the control is really there and really reachable ───────────────
    console.log('\n— the Rotate row is on screen —');
    const geom = await page.evaluate(() => {
      const n = document.getElementById('prop-rotate-num');
      const b = document.getElementById('btn-reset-rot');
      const s = document.getElementById('prop-rotate');
      const r = n && n.getBoundingClientRect();
      const rb = b && b.getBoundingClientRect();
      return {
        num: !!n, btn: !!b, slider: !!s,
        numW: r ? Math.round(r.width) : 0,
        numH: r ? Math.round(r.height) : 0,
        btnW: rb ? Math.round(rb.width) : 0,
        numType: n ? n.type : null,
        btnText: b ? b.textContent : null,
        sliderStep: s ? s.step : null,
      };
    });
    ok(geom.num, 'the typed box exists in the real DOM');
    ok(geom.btn, 'the reset button exists in the real DOM');
    ok(geom.numType === 'number', 'the typed box is a number input', geom.numType);
    ok(geom.numW >= 30 && geom.numH >= 12,
       'the typed box is big enough to hit (' + geom.numW + 'x' + geom.numH + ')');
    ok(geom.btnW >= 18, 'the reset button is big enough to click (' + geom.btnW + 'px)');
    ok(geom.btnText && geom.btnText.trim().length === 1,
       'the reset button carries the glyph', geom.btnText);
    eq(geom.sliderStep, '0.5', 'the slider steps by 0.5deg, not 1deg');

    // ── 2. type an angle, fire a real change ──────────────────────────────
    console.log('\n— typing an exact angle —');
    const typed = await page.evaluate(() => {
      const it = state.items[state.items.length - 1];
      const n = document.getElementById('prop-rotate-num');
      const undoBefore = state.undoStack.length;
      n.value = '37.5';
      n.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        rot: it.rot,
        transform: it.el.style.transform,
        slider: document.getElementById('prop-rotate').value,
        num: n.value,
        undoBefore: undoBefore,
        undoAfter: state.undoStack.length,
      };
    });
    eq(typed.rot, 37.5, 'the item really rotated to 37.5');
    ok(/rotate\(37\.5deg\)/.test(typed.transform),
       'the DOM transform really says rotate(37.5deg)', typed.transform);
    eq(typed.slider, '37.5', 'the slider followed the typed value');
    eq(typed.num, '37.5', 'the box kept what was typed');
    eq(typed.undoAfter, typed.undoBefore + 1, 'exactly one undo step was pushed');

    // ── 3. drag the slider: the box must follow ───────────────────────────
    console.log('\n— dragging the slider —');
    const slid = await page.evaluate(() => {
      const it = state.items[state.items.length - 1];
      const s = document.getElementById('prop-rotate');
      s.value = '-90';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      return { rot: it.rot, num: document.getElementById('prop-rotate-num').value };
    });
    eq(slid.rot, -90, 'the slider drives the item');
    eq(slid.num, '-90', 'the typed box follows the slider (one writer, no drift)');

    // ── 4. the reset button ───────────────────────────────────────────────
    console.log('\n— the reset button —');
    const reset = await page.evaluate(() => {
      const it = state.items[state.items.length - 1];
      const undoBefore = state.undoStack.length;
      document.getElementById('btn-reset-rot').click();
      return {
        rot: it.rot,
        transform: it.el.style.transform,
        num: document.getElementById('prop-rotate-num').value,
        slider: document.getElementById('prop-rotate').value,
        undoBefore: undoBefore,
        undoAfter: state.undoStack.length,
      };
    });
    eq(reset.rot, 0, 'one click puts the card back to 0deg');
    ok(/rotate\(0deg\)/.test(reset.transform),
       'the DOM transform really says rotate(0deg)', reset.transform);
    eq(reset.num, '0', 'the typed box shows 0');
    eq(reset.slider, '0', 'the slider shows 0');
    eq(reset.undoAfter, reset.undoBefore + 1, 'the reset is undoable');

    // ── 5. selecting a rotated item fills the row from the item ───────────
    console.log('\n— selecting a card that was rotated by the HANDLE —');
    const handle = await page.evaluate(() => {
      const it = state.items[state.items.length - 1];
      // The rotate handle writes item.rot directly; the panel must read it back
      // rather than keep whatever was in the box before.
      it.rot = -22.5;
      if (typeof updateItemStyle === 'function') updateItemStyle(it);
      if (typeof syncRotationUI === 'function') syncRotationUI(it.rot);
      return { num: document.getElementById('prop-rotate-num').value,
               slider: document.getElementById('prop-rotate').value };
    });
    eq(handle.num, '-22.5', 'the row shows the angle the handle produced');
    eq(handle.slider, '-22.5', 'the slider shows it too');

    // ── 6. garbage in the box moves nothing ───────────────────────────────
    console.log('\n— garbage input —');
    const junk = await page.evaluate(() => {
      const it = state.items[state.items.length - 1];
      const n = document.getElementById('prop-rotate-num');
      n.value = '';
      n.dispatchEvent(new Event('change', { bubbles: true }));
      return { rot: it.rot, num: n.value };
    });
    eq(junk.rot, -22.5, 'an empty box does not move the card');
    eq(junk.num, '-22.5', 'the box is refilled with the real angle');

    eq(errors.length, 0, 'no uncaught page errors');

    console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + ' — ' + pass + ' passed, ' + fail + ' failed');
    if (failures.length) { console.log('failed:'); failures.forEach(f => console.log('  · ' + f)); }
    return fail === 0 ? 0 : 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
