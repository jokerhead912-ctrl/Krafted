#!/usr/bin/env node
/**
 * smoke_v7_23_0.js — a LIVE browser check that a stroke lands under the pen on
 * a video card that has been rotated, flipped, zoomed or panned.
 *
 * WHY THIS EXISTS
 * --------------
 * test_v7_23_0.js EXECUTES kraftedLocalBasis / kraftedClientToLocal against a
 * fake DOM whose getBoundingClientRect answers come from a known matrix, and
 * every mutant goes red. That proves the inverse-transform maths. It proves
 * nothing about the part that actually mattered: whether a real pointerdown on
 * the real annotation canvas, on a real <video> card carrying a real CSS
 * transform, ends up filing a stroke at the coordinate the user aimed at.
 *
 * So this file drives real Chrome:
 *   · records a real clip in the page (canvas captureStream + MediaRecorder);
 *   · builds a real media card with the real buildMediaControls(), so the real
 *     anno canvas and the real _canvasPoint are in play;
 *   · for each transform case, works out where a content point REALLY is on
 *     screen — with a probe div that carries the same transform as the video,
 *     not with the app's own maths — puts the pointer there, and asserts the
 *     stroke was filed at that content coordinate;
 *   · negative control: shifting the pointer by 10% of the frame really does
 *     move the answer by 10%, so "no offset" is not trivially true;
 *   · and an end-to-end ink check: the same stroke drawn on an unrotated card
 *     and on a 30deg card must paint at the SAME canvas pixels, because
 *     canvas-local pixels do not care how the card is turned.
 *
 * Before the fix this printed: rot 5deg 1.4% off, 15deg 3.9%, 30deg 7.4%,
 * 45deg 10.8%, 90deg 30%, flipH mirrored 0.30 -> 0.70.
 *
 * USAGE
 *   node Krafted/tests/smoke_v7_23_0.js
 *   node Krafted/tests/smoke_v7_23_0.js --headful
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
const PORT = 8742;                  // 8734 = v7_22_0, 8741 = anno diag

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
  if (!puppeteer) { console.log('SKIP smoke_v7_23_0: puppeteer-core is not installed'); return 0; }

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
      'window.state && typeof window.buildMediaControls === "function" && ' +
      'typeof window.kraftedClientToLocal === "function"', { timeout: 30000 });
    await page.evaluate(() => {
      state.pan.x = 0; state.pan.y = 0; state.zoom = 1;
      if (typeof hideWelcome === 'function') hideWelcome();
      if (typeof updateCanvas === 'function') updateCanvas();
    });

    // ── 1. build a real media card ────────────────────────────────────────
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
      await new Promise(r => setTimeout(r, 1200));
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
      card.className = 'item';
      card.style.cssText = 'position:absolute;left:160px;top:160px;width:400px;height:300px;z-index:9999;';
      host.appendChild(card);
      const it = { id: 'smoke-anno', isVideo: true, video: v, el: card,
                   w: 400, h: 246, x: 160, y: 160, z: 9999, rot: 0 };
      card._item = it;
      buildMediaControls(card, v, true, false);
      const wrap = card.querySelector('.media-wrap');
      if (wrap) wrap.style.height = '246px';

      // The ground-truth probe: a sibling of the <video> carrying the SAME
      // transform, holding a zero-size marker. Its rect is where a content
      // point really is on screen, whatever the ancestor transforms are.
      const probeOuter = document.createElement('div');
      probeOuter.className = 'smoke-gt-probe';
      probeOuter.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;' +
                                 'pointer-events:none;transform-origin:center center;';
      wrap.appendChild(probeOuter);
      const marker = document.createElement('div');
      marker.className = 'smoke-gt-marker';
      marker.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;';
      probeOuter.appendChild(marker);

      state.items.push(it);
      return { vw: v.videoWidth, vh: v.videoHeight,
               wrapW: wrap.clientWidth, wrapH: wrap.clientHeight,
               hasCanvas: !!card.querySelector('.media-anno-canvas') };
    });
    ok(built.vw > 0 && built.vh > 0, 'the clip decoded with real dimensions (' + built.vw + 'x' + built.vh + ')');
    ok(built.hasCanvas, 'the real annotation canvas is on the card');
    ok(built.wrapW > 0 && built.wrapH > 0, 'and the frame has real size (' + built.wrapW + 'x' + built.wrapH + ')');

    // ── 2. the inversion, across every transform the user can apply ───────
    console.log('\n— pointer placed at the REAL screen position of content point (0.3, 0.4) —');
    const CASES = [
      { label: 'no transform',        bz: 1,   rot: 0,   flipH: false, flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'board zoom 0.6',      bz: 0.6, rot: 0,   flipH: false, flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'board zoom 2',        bz: 2,   rot: 0,   flipH: false, flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'video pan (alt+mid)', bz: 1,   rot: 0,   flipH: false, flipV: false, z: 1,   px: 60, py: 40 },
      { label: 'video zoom+pan',      bz: 1,   rot: 0,   flipH: false, flipV: false, z: 0.6, px: 40, py: -25 },
      { label: 'card rotated 5deg',   bz: 1,   rot: 5,   flipH: false, flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'card rotated 15deg',  bz: 1,   rot: 15,  flipH: false, flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'card rotated 30deg',  bz: 1,   rot: 30,  flipH: false, flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'card rotated 45deg',  bz: 1,   rot: 45,  flipH: false, flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'card rotated 90deg',  bz: 1,   rot: 90,  flipH: false, flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'card rotated -20deg', bz: 1,   rot: -20, flipH: false, flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'card flipped H',      bz: 1,   rot: 0,   flipH: true,  flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'card flipped V',      bz: 1,   rot: 0,   flipH: false, flipV: true,  z: 1,   px: 0,  py: 0 },
      { label: 'rot 30 + flip H',     bz: 1,   rot: 30,  flipH: true,  flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'rot 15 + video pan',  bz: 1,   rot: 15,  flipH: false, flipV: false, z: 1.5, px: 30, py: 20 },
      { label: 'rot 30 @ board 0.6',  bz: 0.6, rot: 30,  flipH: false, flipV: false, z: 1,   px: 0,  py: 0 }
    ];
    const probe = await page.evaluate((U, V, cases) => {
      const card = document.querySelector('.item.has-media');
      const it = card._item;
      const v = it.video;
      const wrap = card.querySelector('.media-wrap');
      const canvas = card.querySelector('.media-anno-canvas');
      const probeOuter = wrap.querySelector('.smoke-gt-probe');
      const marker = probeOuter.querySelector('.smoke-gt-marker');

      function baseContentRect() {
        const ww = wrap.clientWidth || 1, wh = wrap.clientHeight || 1;
        const vw = v.videoWidth, vh = v.videoHeight;
        if (!vw || !vh) return { left: 0, top: 0, width: ww, height: wh };
        const wa = ww / wh, va = vw / vh;
        if (va > wa) { const h = ww / va; return { left: 0, top: (wh - h) / 2, width: ww, height: h }; }
        const w = wh * va; return { left: (ww - w) / 2, top: 0, width: w, height: wh };
      }

      const out = [];
      for (const c of cases) {
        state.zoom = c.bz; state.pan.x = 0; state.pan.y = 0;
        if (typeof updateCanvas === 'function') updateCanvas();
        it.rot = c.rot; it.flipH = c.flipH; it.flipV = c.flipV;
        const flipS = (c.flipH ? -1 : 1) + ', ' + (c.flipV ? -1 : 1);
        card.style.transform = 'translate3d(' + it.x + 'px,' + it.y + 'px,0) rotate(' +
                               (c.rot || 0) + 'deg) scale(' + flipS + ')';
        it._videoZoom = c.z; it._videoPanX = c.px; it._videoPanY = c.py;
        v.style.transformOrigin = 'center center';
        v.style.transform = 'scale(' + c.z + ') translate(' + c.px + 'px, ' + c.py + 'px)';
        probeOuter.style.transform = v.style.transform;
        probeOuter.style.transformOrigin = 'center center';

        card._perfLastRenderKey = '';
        card._annoDrawState.mode = 'pen';
        try { card._applyDrawMode(); } catch (e) {}
        card._renderAnnoCanvas();

        const base = baseContentRect();
        marker.style.left = (base.left + U * base.width) + 'px';
        marker.style.top = (base.top + V * base.height) + 'px';
        const mr = marker.getBoundingClientRect();

        card._annoDrawState.drawing = null;
        canvas.dispatchEvent(new PointerEvent('pointerdown', {
          clientX: mr.left, clientY: mr.top, button: 0, buttons: 1,
          bubbles: true, cancelable: true, pointerId: 1
        }));
        const got = (card._annoDrawState.drawing && card._annoDrawState.drawing.points[0]) || null;
        card._annoDrawState.drawing = null;
        out.push({ label: c.label, got: got ? [+got[0].toFixed(5), +got[1].toFixed(5)] : null, want: [U, V] });
      }
      return out;
    }, 0.3, 0.4, CASES);

    let worst = 0;
    for (const r of probe) {
      const d = r.got ? Math.max(Math.abs(r.got[0] - r.want[0]), Math.abs(r.got[1] - r.want[1])) : Infinity;
      if (d > worst) worst = d;
      ok(d < 0.005, r.label.padEnd(24) + ' -> ' + JSON.stringify(r.got), d);
    }
    ok(worst < 0.005, 'worst error across all ' + CASES.length + ' transforms is under 0.5% of the frame', worst);

    // ── 3. negative control: the measurement can actually see a difference ─
    console.log('\n— negative control: a deliberate 10% shift must be visible —');
    const shifted = await page.evaluate(() => {
      const card = document.querySelector('.item.has-media');
      const it = card._item;
      const v = it.video;
      const wrap = card.querySelector('.media-wrap');
      const canvas = card.querySelector('.media-anno-canvas');
      const probeOuter = wrap.querySelector('.smoke-gt-probe');
      const marker = probeOuter.querySelector('.smoke-gt-marker');
      state.zoom = 1; updateCanvas();
      it.rot = 0; it.flipH = false; it.flipV = false;
      card.style.transform = 'translate3d(' + it.x + 'px,' + it.y + 'px,0)';
      it._videoZoom = 1; it._videoPanX = 0; it._videoPanY = 0;
      v.style.transform = ''; probeOuter.style.transform = '';
      card._perfLastRenderKey = '';
      card._annoDrawState.mode = 'pen';
      card._applyDrawMode();
      card._renderAnnoCanvas();
      const ww = wrap.clientWidth, wh = wrap.clientHeight;
      const va = v.videoWidth / v.videoHeight;
      const h = ww / va;
      const base = { left: 0, top: (wh - h) / 2, width: ww, height: h };
      function at(u, vv) {
        marker.style.left = (base.left + u * base.width) + 'px';
        marker.style.top = (base.top + vv * base.height) + 'px';
        const mr = marker.getBoundingClientRect();
        card._annoDrawState.drawing = null;
        canvas.dispatchEvent(new PointerEvent('pointerdown', {
          clientX: mr.left, clientY: mr.top, button: 0, buttons: 1,
          bubbles: true, cancelable: true, pointerId: 1
        }));
        const p = card._annoDrawState.drawing.points[0];
        card._annoDrawState.drawing = null;
        return [+p[0].toFixed(4), +p[1].toFixed(4)];
      }
      return { a: at(0.3, 0.4), b: at(0.4, 0.4) };
    });
    ok(Math.abs(shifted.b[0] - shifted.a[0] - 0.1) < 0.01,
       'moving the pointer 10% right moves the stored x by 10% (' +
       JSON.stringify(shifted.a) + ' -> ' + JSON.stringify(shifted.b) + ')',
       shifted.b[0] - shifted.a[0]);

    // ── 4. paper mode must not clamp (strokes may sit on the black margin) ─
    console.log('\n— paper mode: a stroke on the black margin keeps coords outside [0,1] —');
    const margin = await page.evaluate(() => {
      const card = document.querySelector('.item.has-media');
      const it = card._item;
      const v = it.video;
      const wrap = card.querySelector('.media-wrap');
      const canvas = card.querySelector('.media-anno-canvas');
      it._videoZoom = 0.5; it._videoPanX = 0; it._videoPanY = 0;
      v.style.transformOrigin = 'center center';
      v.style.transform = 'scale(0.5)';
      card._perfLastRenderKey = '';
      card._annoDrawState.mode = 'pen';
      card._applyDrawMode();
      card._renderAnnoCanvas();
      const cb = canvas.getBoundingClientRect();
      // top-left corner of the wrap = black paper, well outside the shrunken frame
      card._annoDrawState.drawing = null;
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: cb.left + 4, clientY: cb.top + 4, button: 0, buttons: 1,
        bubbles: true, cancelable: true, pointerId: 1
      }));
      const p = card._annoDrawState.drawing.points[0];
      card._annoDrawState.drawing = null;
      return [+p[0].toFixed(4), +p[1].toFixed(4)];
    });
    ok(margin[0] < 0 || margin[1] < 0,
       'a stroke on the margin is stored outside [0,1] (got ' + JSON.stringify(margin) + ')');

    // ── 5. end to end: the INK lands under the pen, rotated or not ────────
    console.log('\n— the ink: same stroke, unrotated vs 30deg, must paint at the same pixels —');
    const ink = await page.evaluate(() => {
      const card = document.querySelector('.item.has-media');
      const it = card._item;
      const v = it.video;
      const wrap = card.querySelector('.media-wrap');
      const canvas = card.querySelector('.media-anno-canvas');
      const probeOuter = wrap.querySelector('.smoke-gt-probe');
      const marker = probeOuter.querySelector('.smoke-gt-marker');

      function setup(rot) {
        state.zoom = 1; updateCanvas();
        it.rot = rot; it.flipH = false; it.flipV = false;
        it._videoZoom = 1; it._videoPanX = 0; it._videoPanY = 0;
        v.style.transform = ''; probeOuter.style.transform = '';
        card.style.transform = 'translate3d(' + it.x + 'px,' + it.y + 'px,0) rotate(' + rot + 'deg)';
        card._perfLastRenderKey = '';
        card._annoDrawState.mode = 'pen';
        card._annoDrawState.strokesByFrame = {};
        card._annoDrawState.strokes = [];
        card._applyDrawMode();
      }
      function drawStroke(u, vv) {
        const ww = wrap.clientWidth, wh = wrap.clientHeight;
        const va = v.videoWidth / v.videoHeight;
        const h = ww / va;
        const base = { left: 0, top: (wh - h) / 2, width: ww, height: h };
        const pts = [];
        for (const d of [[0, 0], [0.04, 0.04], [0.08, 0.06]]) {
          marker.style.left = (base.left + (u + d[0]) * base.width) + 'px';
          marker.style.top = (base.top + (vv + d[1]) * base.height) + 'px';
          const mr = marker.getBoundingClientRect();
          pts.push([mr.left, mr.top]);
        }
        card._annoDrawState.drawing = null;
        canvas.dispatchEvent(new PointerEvent('pointerdown', {
          clientX: pts[0][0], clientY: pts[0][1], button: 0, buttons: 1,
          bubbles: true, cancelable: true, pointerId: 1
        }));
        for (let i = 1; i < pts.length; i++) {
          canvas.dispatchEvent(new PointerEvent('pointermove', {
            clientX: pts[i][0], clientY: pts[i][1], buttons: 1,
            bubbles: true, cancelable: true, pointerId: 1
          }));
        }
        const drawn = card._annoDrawState.drawing;
        card._perfLastRenderKey = '';
        card._renderAnnoCanvas();
        const ctx = canvas.getContext('2d');
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let sx = 0, sy = 0, n = 0;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            if (img[(y * canvas.width + x) * 4 + 3] > 20) { sx += x; sy += y; n++; }
          }
        }
        card._annoDrawState.drawing = null;
        return { n: n, cx: n ? sx / n : -1, cy: n ? sy / n : -1,
                 pts: drawn ? drawn.points.map(p => [+p[0].toFixed(4), +p[1].toFixed(4)]) : null,
                 w: canvas.width, h: canvas.height };
      }
      setup(0);   const flat = drawStroke(0.5, 0.5);
      setup(30);  const turned = drawStroke(0.5, 0.5);
      return { flat: flat, turned: turned };
    });
    ok(ink.flat.n > 0, 'the unrotated stroke really painted ink (' + ink.flat.n + ' px)');
    ok(ink.turned.n > 0, 'the 30deg stroke really painted ink (' + ink.turned.n + ' px)');
    ok(ink.flat.w === ink.turned.w && ink.flat.h === ink.turned.h,
       'both were painted on the same-sized canvas (' + ink.flat.w + 'x' + ink.flat.h + ')');
    ok(Math.abs(ink.flat.cx - ink.turned.cx) < 3 && Math.abs(ink.flat.cy - ink.turned.cy) < 3,
       'and the ink centroid is in the same place either way (' +
       ink.flat.cx.toFixed(1) + ',' + ink.flat.cy.toFixed(1) + ' vs ' +
       ink.turned.cx.toFixed(1) + ',' + ink.turned.cy.toFixed(1) + ')',
       [ink.flat.cx - ink.turned.cx, ink.flat.cy - ink.turned.cy]);
    ok(ink.turned.pts && Math.abs(ink.turned.pts[0][0] - 0.5) < 0.01 &&
       Math.abs(ink.turned.pts[0][1] - 0.5) < 0.01,
       'the 30deg stroke was filed at (0.5, 0.5)', ink.turned.pts && ink.turned.pts[0]);

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
