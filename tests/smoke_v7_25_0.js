#!/usr/bin/env node
/**
 * smoke_v7_25_0.js — the LIVE proof for 「視頻寫完 comment 之後 hang 住用唔到」.
 *
 * WHY THIS EXISTS
 * --------------
 * test_v7_25_0.js EXECUTES the lifted auto-exit block and the _exitDrawMode
 * writer, and all 11 mutants go red. That proves the code. It proves nothing
 * about the thing the director actually touches: whether, after typing seven
 * comments on a real clip, a real click on that clip reaches the <video>.
 *
 * The failure mode is a HIT-TESTING failure, so hit-testing is the only way
 * to see it. A synthetic `dispatchEvent` would sail straight through the
 * overlay and show a false pass — this file uses page.mouse.click().
 *
 * WHAT IT DOES
 *   · records a real clip in-page, builds a real media card;
 *   · types seven comments, Enter after each (the reported sequence);
 *   · asserts the card leaves draw mode after EVERY commit;
 *   · asserts the annotation canvas is no longer on top of the video;
 *   · plays the clip and really clicks its centre: the click must reach the
 *     video (pause) and must NOT spawn an eighth editor;
 *   · NEGATIVE CONTROL: puts the card back into text mode and clicks again —
 *     an editor must appear. Without this, "0 editors spawned" could mean
 *     "the click worked" OR "text mode is broken everywhere", and only one
 *     of those is a fix.
 *
 * USAGE
 *   node Krafted/tests/smoke_v7_25_0.js
 *   node Krafted/tests/smoke_v7_25_0.js --headful
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
const PORT = 8745;                 // 8741 anno diag · 8742 v7_23 · 8743 v7_24 · 8744 hang diag

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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const candidates = [
    'puppeteer-core',
    path.join(process.env.HOME || os.homedir(),
              '.workbuddy/binaries/node/workspace/node_modules/puppeteer-core')
  ];
  let puppeteer = null;
  for (const c of candidates) { try { puppeteer = require(c); break; } catch (e) {} }
  if (!puppeteer) { console.log('SKIP smoke_v7_25_0: puppeteer-core is not installed'); return 0; }

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
    await page.goto('http://127.0.0.1:' + PORT + '/' + PAGE, { waitUntil: 'load' });
    await page.waitForFunction(
      'window.state && typeof window.buildMediaControls === "function"', { timeout: 30000 });
    await page.evaluate(() => {
      state.pan.x = 0; state.pan.y = 0; state.zoom = 1;
      if (typeof hideWelcome === 'function') hideWelcome();
    });

    // ── a real video card ─────────────────────────────────────────────────
    console.log('\n— recording a real clip and building a real media card —');
    const built = await page.evaluate(async () => {
      const cv = document.createElement('canvas');
      cv.width = 320; cv.height = 180;
      const ctx = cv.getContext('2d');
      let i = 0;
      const iv = setInterval(() => {
        ctx.fillStyle = 'hsl(' + (i * 20) % 360 + ',70%,50%)'; ctx.fillRect(0, 0, 320, 180);
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
      const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));

      const v = await new Promise((resolve, reject) => {
        const el = document.createElement('video');
        el.muted = true; el.playsInline = true; el.preload = 'auto';
        el._kraftedFps = 25;
        el.onloadeddata = () => resolve(el);
        el.onerror = () => reject(new Error('video failed to load'));
        el.src = url;
      });

      const host = document.getElementById('canvas-content') || document.body;
      const card = document.createElement('div');
      card.className = 'item has-media';
      // left/top stay 0 on purpose. A real .item is positioned purely by
      // `transform: translate3d(x,y,0)` — the CSS class has no left/top.
      // Handing the element a left/top here looked harmless (the card just
      // sat where I put it) until the app synced the item and WROTE the
      // transform on top of it: the card then jumped by (+160,+140) the
      // first time it was clicked, and the second click landed on the board
      // background. That cost an hour of chasing a drag-gate that was never
      // armed. Build the card the way the app builds it.
      card.style.cssText = 'position:absolute;left:0;top:0;width:400px;height:300px;z-index:9999;';
      card.style.transform = 'translate3d(160px, 140px, 0px)';
      host.appendChild(card);
      const it = { id: 'smoke-7250', isVideo: true, video: v, el: card,
                   w: 400, h: 246, x: 160, y: 140, z: 9999, rot: 0, src: url };
      card._item = it;
      buildMediaControls(card, v, true, false);
      const wrap = card.querySelector('.media-wrap');
      if (wrap) wrap.style.height = '246px';
      // The clip is only ~1.5s. Without loop it ENDS on its own mid-test and
      // `paused` goes true with nobody touching it — which made the very
      // first click assertion pass for the wrong reason (measured: FAIL on
      // the second click, because the video had already ended).
      v.loop = true;
      state.items.push(it);
      window.__card = card;
      return { vw: v.videoWidth, vh: v.videoHeight,
               hasCanvas: !!card.querySelector('.media-anno-canvas'),
               hasSpawn: typeof card._spawnTextEditorDirect === 'function' };
    });
    ok(built.vw > 0, 'the clip decoded (' + built.vw + 'x' + built.vh + ')');
    ok(built.hasCanvas, 'the annotation canvas is on the card');
    ok(built.hasSpawn, 'the card exposes _spawnTextEditorDirect');
    if (!built.hasSpawn) { console.log('\n' + (fail ? 'FAILURES' : 'ALL PASS') + ' — ' + pass + ' passed, ' + fail + ' failed'); return fail ? 1 : 0; }

    // ── the reported sequence: seven comments ─────────────────────────────
    console.log('\n— typing 7 comments, Enter after each —');
    for (let i = 1; i <= 7; i++) {
      const pt = await page.evaluate((i) => {
        const r = window.__card.getBoundingClientRect();
        return { x: Math.round(r.left + 60 + (i % 4) * 55),
                 y: Math.round(r.top + 50 + Math.floor(i / 4) * 55) };
      }, i);
      await page.evaluate((pt) => {
        window.__card._spawnTextEditorDirect({ clientX: pt.x, clientY: pt.y, pointerId: 1 });
      }, pt);
      await sleep(180);                       // the focus() is inside a setTimeout
      await page.keyboard.type('comment ' + i, { delay: 12 });
      await page.keyboard.press('Enter');
      await sleep(200);
      const st = await page.evaluate(() => {
        const card = window.__card;
        let texts = 0;
        Object.keys(card._annoDrawState.strokesByFrame || {}).forEach(f => {
          (card._annoDrawState.strokesByFrame[f] || []).forEach(s => { if (s.type === 'text') texts++; });
        });
        return { editors: document.querySelectorAll('.media-anno-text-editor').length,
                 mode: card._annoDrawState.mode, texts: texts };
      });
      ok(st.mode === 'off', '#' + i + ' committed — card left draw mode (mode ' + st.mode + ')', st.mode);
      ok(st.editors === 0, '#' + i + ' no editor left behind', st.editors);
      eq(st.texts, i, '#' + i + ' the comment was stored (' + st.texts + ' text strokes)');
    }

    // ── is the video reachable again? ─────────────────────────────────────
    console.log('\n— is the clip usable again? —');
    const state1 = await page.evaluate(async () => {
      const card = window.__card;
      const v = card._item.video;
      try { await v.play(); } catch (e) {}
      await new Promise(r => setTimeout(r, 350));
      const r = v.getBoundingClientRect();
      const top = document.elementFromPoint(Math.round(r.left + r.width / 2),
                                            Math.round(r.top + r.height / 2));
      return {
        playing: !v.paused,
        dimmed: card.classList.contains('draw-mode'),
        top: top ? (top.tagName + '.' + String(top.className || '').split(' ')[0]) : null,
        topIsCanvas: !!(top && top.classList && top.classList.contains('media-anno-canvas')),
      };
    });
    ok(state1.playing, 'the clip is playing');
    ok(!state1.dimmed, 'the card is no longer dimmed by draw-mode');
    ok(!state1.topIsCanvas, 'the annotation canvas is no longer on top of the video', state1.top);

    // Measured FRESH before every click, and proven to be ON THE CARD before
    // the click is sent. Never reuse a point: a stale point silently tests
    // the board background instead of the clip, and "the click did nothing"
    // then reads as a mystery instead of a failed hit test.
    const centreOf = () => page.evaluate(() => {
      const r = window.__card._item.video.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(x, y);
      return { x: x, y: y,
               rect: [Math.round(r.left), Math.round(r.top),
                      Math.round(r.width), Math.round(r.height)],
               onCard: !!(hit && window.__card.contains(hit)) };
    });
    const c1 = await centreOf();
    ok(c1.onCard, 'the point we are about to click is really on the card', c1.rect);
    await page.mouse.click(c1.x, c1.y);
    await sleep(400);
    const afterClick = await page.evaluate(() => ({
      paused: window.__card._item.video.paused,
      ended: window.__card._item.video.ended,
      editors: document.querySelectorAll('.media-anno-text-editor').length,
    }));
    ok(!afterClick.ended, 'the clip did NOT end on its own (otherwise "paused" proves nothing)');
    ok(afterClick.paused, 'a REAL click on the clip reached the video and paused it');
    eq(afterClick.editors, 0, 'that click spawned no eighth editor');

    // Click again — it must resume, i.e. the clip stays interactive.
    // Far enough away and slow enough that Chrome does NOT synthesise a
    // dblclick: the wrap's dblclick handler requests fullscreen, which is a
    // different feature entirely and would make this assertion meaningless.
    await page.evaluate(() => {
      const v = window.__card._item.video;
      const wrap = window.__card.querySelector('.media-wrap');
      window.__ev = [];
      const rp = v.play.bind(v), rs = v.pause.bind(v);
      v.play = function () { window.__ev.push('play muted=' + v.muted); return rp(); };
      v.pause = function () { window.__ev.push('pause'); return rs(); };
      wrap.addEventListener('click', function (e) {
        window.__ev.push('wrapclick target=' + e.target.tagName + '.' +
                         String(e.target.className || '').split(' ')[0] +
                         ' detail=' + e.detail);
      }, true);   // capture: see the event even if the real handler returns
      window.__hit = null;
    });
    // Long gap before the second click: > 500ms, so Chrome does NOT
    // synthesise a dblclick (the wrap's dblclick handler requests
    // fullscreen — a different feature, and it would make this assertion
    // meaningless). The point is measured fresh either way.
    await sleep(900);
    const c3 = await centreOf();
    ok(c3.onCard, 'the second click is also on the card', c3.rect);
    await page.mouse.click(c3.x, c3.y);
    await sleep(400);
    const afterClick2 = await page.evaluate(() => ({
      paused: window.__card._item.video.paused,
      editors: document.querySelectorAll('.media-anno-text-editor').length,
      ev: window.__ev,
    }));
    ok(!afterClick2.paused, 'a second click plays it again — the clip is genuinely usable', afterClick2.paused);
    // NOTE the recorded order is  pause → wrapclick → play: the wrap pauses
    // on pointerdown and the click handler plays. The net effect the director
    // cares about is "my click reached the clip and it resumed", so the
    // assertion is on play() being CALLED, not on it being first.
    ok(afterClick2.ev.some(function (s) { return s.indexOf('play') === 0; }),
       'and it was the click that called play() (not some other code path)', afterClick2.ev);
    eq(afterClick2.editors, 0, 'and still spawns no editor');

    // ── NEGATIVE CONTROL: text mode must still spawn on click ──────────────
    // Otherwise "0 editors" above could just mean text mode is dead.
    console.log('\n— negative control: back in text mode a click MUST spawn an editor —');
    const negPre = await page.evaluate(() => {
      const card = window.__card;
      card._annoDrawState.mode = 'text';
      card._applyDrawMode();
      if (card._renderAnnoCanvas) card._renderAnnoCanvas();
      const r = card._item.video.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2) + 20, y = Math.round(r.top + r.height / 2) + 12;
      const top = document.elementFromPoint(x, y);
      return { x: x, y: y,
               drawMode: card.classList.contains('draw-mode'),
               top: top ? (top.tagName + '.' + String(top.className || '').split(' ')[0]) : null,
               canvasPE: top ? getComputedStyle(top).pointerEvents : null };
    });
    await sleep(150);
    await page.mouse.click(negPre.x, negPre.y);
    await sleep(300);
    const neg = await page.evaluate(() => ({
      editors: document.querySelectorAll('.media-anno-text-editor').length,
      mode: window.__card._annoDrawState.mode,
    }));
    console.log('    (at the negative-control point: draw-mode ' + negPre.drawMode +
                ' · top ' + negPre.top + ' · pointer-events ' + negPre.canvasPE + ')');
    ok(negPre.drawMode, 'the card is back in draw-mode for the control');
    ok(neg.editors === 1, 'in text mode the same click DOES spawn an editor (so the check above is real)', neg.editors);
    eq(neg.mode, 'text', 'and the card really is back in text mode');

    console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + ' — ' + pass + ' passed, ' + fail + ' failed');
    return fail === 0 ? 0 : 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
