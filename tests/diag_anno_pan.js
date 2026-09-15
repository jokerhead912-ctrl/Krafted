#!/usr/bin/env node
/**
 * diag_anno_pan.js — DIAGNOSTIC (not a suite).
 *
 * Question: on a video card, does a stroke drawn at screen point P land at the
 * normalized coordinate that P actually corresponds to in the video content?
 *
 * Method: real Chrome, real buildMediaControls(), real pointerdown on the real
 * anno canvas. Ground truth is INDEPENDENT of the app's own math: a probe div
 * inside .media-wrap carries the SAME transform as the <video> and holds a
 * zero-size marker at the content point (u,v) — so
 * marker.getBoundingClientRect() is where that content point really is on
 * screen, whatever the item rotation / flip / board zoom happens to be.
 *
 * The test is an inversion: put the pointer at the marker's real screen
 * position, then assert _canvasPoint returns (u, v).
 *
 * USAGE
 *   node Krafted/tests/diag_anno_pan.js
 */

'use strict';

const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const http = require('http');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = 'kraftpub-dev.html';
const PORT = 8741;

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
  if (!puppeteer) { console.log('SKIP: puppeteer-core is not installed'); return 0; }

  const server = serve();
  let browser = null;
  try {
    await waitForServer();
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
             '--window-size=1280,800', '--no-first-run', '--no-default-browser-check',
             '--autoplay-policy=no-user-gesture-required']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    page.on('pageerror', e => console.log('  [pageerror] ' + e.message));
    await page.goto('http://127.0.0.1:' + PORT + '/' + PAGE, { waitUntil: 'load' });
    await page.waitForFunction('window.state && typeof window.buildMediaControls === "function"',
                               { timeout: 30000 });
    await page.evaluate(() => {
      state.pan.x = 0; state.pan.y = 0; state.zoom = 1;
      if (typeof hideWelcome === 'function') hideWelcome();
      if (typeof updateCanvas === 'function') updateCanvas();
    });

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
      const it = { id: 'diag-anno', isVideo: true, video: v, el: card,
                   w: 400, h: 246, x: 160, y: 160, z: 9999, rot: 0 };
      card._item = it;
      buildMediaControls(card, v, true, false);
      const wrap = card.querySelector('.media-wrap');
      if (wrap) wrap.style.height = '246px';

      // ── the probe: a sibling of the <video> that carries the same
      //    transform, with a zero-size marker at content point (u,v).
      const probeOuter = document.createElement('div');
      probeOuter.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;' +
                                 'pointer-events:none;transform-origin:center center;';
      wrap.appendChild(probeOuter);
      const marker = document.createElement('div');
      marker.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;';
      probeOuter.appendChild(marker);

      state.items.push(it);
      return { vw: v.videoWidth, vh: v.videoHeight, wrapW: wrap.clientWidth, wrapH: wrap.clientHeight,
               host: host.id || host.tagName };
    });
    console.log('\ncard built:', JSON.stringify(built));

    const CASES = [
      { label: 'baseline',            bz: 1,   rot: 0,   flipH: false, flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'board zoom 0.6',      bz: 0.6, rot: 0,   flipH: false, flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'board zoom 2',        bz: 2,   rot: 0,   flipH: false, flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'video pan (alt+mid)', bz: 1,   rot: 0,   flipH: false, flipV: false, z: 1,   px: 60, py: 40 },
      { label: 'video zoom+pan',      bz: 1,   rot: 0,   flipH: false, flipV: false, z: 0.6, px: 40, py: -25 },
      { label: 'rot 5',               bz: 1,   rot: 5,   flipH: false, flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'rot 15',              bz: 1,   rot: 15,  flipH: false, flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'rot 30',              bz: 1,   rot: 30,  flipH: false, flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'rot 45',              bz: 1,   rot: 45,  flipH: false, flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'rot 90',              bz: 1,   rot: 90,  flipH: false, flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'rot -20',             bz: 1,   rot: -20, flipH: false, flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'flip H',              bz: 1,   rot: 0,   flipH: true,  flipV: false, z: 1,   px: 0,  py: 0 },
      { label: 'flip V',              bz: 1,   rot: 0,   flipH: false, flipV: true,  z: 1,   px: 0,  py: 0 },
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
      const probeOuter = wrap.lastElementChild;
      const marker = probeOuter.firstElementChild;

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
        // board zoom
        state.zoom = c.bz; state.pan.x = 0; state.pan.y = 0;
        if (typeof updateCanvas === 'function') updateCanvas();
        // item transform (mirrors applyItemProps)
        it.rot = c.rot; it.flipH = c.flipH; it.flipV = c.flipV;
        const flipS = (c.flipH ? -1 : 1) + ', ' + (c.flipV ? -1 : 1);
        card.style.transform = 'translate3d(' + it.x + 'px,' + it.y + 'px,0) rotate(' +
                               (c.rot || 0) + 'deg) scale(' + flipS + ')';
        // video transform
        it._videoZoom = c.z; it._videoPanX = c.px; it._videoPanY = c.py;
        v.style.transformOrigin = 'center center';
        v.style.transform = 'scale(' + c.z + ') translate(' + c.px + 'px, ' + c.py + 'px)';
        probeOuter.style.transform = v.style.transform;
        probeOuter.style.transformOrigin = 'center center';

        card._perfLastRenderKey = '';
        card._annoDrawState.mode = 'pen';
        try { card._applyDrawMode(); } catch (e) {}
        card._renderAnnoCanvas();

        // where content point (U,V) really is on screen
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

        out.push({
          label: c.label,
          click: [+mr.left.toFixed(1), +mr.top.toFixed(1)],
          got: got ? [+got[0].toFixed(4), +got[1].toFixed(4)] : null,
          want: [U, V]
        });
      }
      return out;
    }, 0.3, 0.4, CASES);

    console.log('\n  pointer placed at the REAL screen position of content point (0.3, 0.4):');
    let bad = 0;
    for (const r of probe) {
      const d = r.got ? [Math.abs(r.got[0] - r.want[0]), Math.abs(r.got[1] - r.want[1])] : [NaN, NaN];
      const off = r.got ? (d[0] > 0.01 || d[1] > 0.01) : true;
      if (off) bad++;
      console.log('  ' + (off ? 'OFFSET ' : 'ok     ') + r.label.padEnd(22) +
                  ' got=' + JSON.stringify(r.got) + '  err=' +
                  (isNaN(d[0]) ? 'n/a' : d[0].toFixed(4) + ',' + d[1].toFixed(4)));
    }
    console.log('\n  ' + (bad ? bad + ' of ' + probe.length + ' case(s) OFFSET' : 'no offset in any case'));
    return 0;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
