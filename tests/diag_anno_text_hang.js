#!/usr/bin/env node
/**
 * diag_anno_text_hang.js — READ-ONLY diagnostic for the report:
 *   「我依家喺視頻上面寫咗六七個comment同埋打字之後個視頻就hang住咗用唔到」
 *   ("after 6-7 comments + typing on a video, the video hangs and is unusable")
 *
 * This is NOT a suite. It drives real Chrome through the director's actual
 * sequence — build a real video card, enter text mode, type a comment, commit
 * with Enter, seven times — and then MEASURES what is left behind:
 *
 *   · leftover .media-anno-text-editor elements (an editor that never tore down
 *     eats every keystroke and every click);
 *   · document.activeElement (still the textarea? then typing goes nowhere);
 *   · el._annoDrawState.mode (still 'text'? then the canvas keeps swallowing
 *     pointer events and the video's own controls are unreachable);
 *   · rAF registrations per second (zombie follow-loops);
 *   · whether the <video> can actually be played after the sequence;
 *   · document.elementFromPoint over the video centre (is something on top?);
 *   · per-iteration wall time — growth here means the cost is super-linear.
 *
 * USAGE
 *   node Krafted/tests/diag_anno_text_hang.js            (headless)
 *   node Krafted/tests/diag_anno_text_hang.js --headful
 *   N=12 node Krafted/tests/diag_anno_text_hang.js       (more comments)
 */

'use strict';

const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const http = require('http');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = 'kraftpub-dev.html';
const PORT = 8744;                 // 8741 anno diag · 8742 v7_23_0 · 8743 v7_24_0
const N_COMMENTS = parseInt(process.env.N || '7', 10);

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
  if (!puppeteer) { console.log('SKIP diag_anno_text_hang: puppeteer-core is not installed'); return 0; }

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
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto('http://127.0.0.1:' + PORT + '/' + PAGE, { waitUntil: 'load' });
    await page.waitForFunction(
      'window.state && typeof window.buildMediaControls === "function"', { timeout: 30000 });

    // Instrument BEFORE anything is built, so we count every loop the app makes.
    await page.evaluate(() => {
      state.pan.x = 0; state.pan.y = 0; state.zoom = 1;
      if (typeof hideWelcome === 'function') hideWelcome();
      window.__probe = { raf: 0 };
      const _raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = function (cb) { window.__probe.raf++; return _raf(cb); };
    });

    // ── build a real video card ────────────────────────────────────────────
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
      card.style.cssText = 'position:absolute;left:160px;top:140px;width:400px;height:300px;z-index:9999;';
      host.appendChild(card);
      const it = { id: 'diag-hang', isVideo: true, video: v, el: card,
                   w: 400, h: 246, x: 160, y: 140, z: 9999, rot: 0, src: url };
      card._item = it;
      buildMediaControls(card, v, true, false);
      const wrap = card.querySelector('.media-wrap');
      if (wrap) wrap.style.height = '246px';
      state.items.push(it);
      window.__card = card;
      return { vw: v.videoWidth, vh: v.videoHeight, wrapW: wrap.clientWidth, wrapH: wrap.clientHeight,
               hasCanvas: !!card.querySelector('.media-anno-canvas'),
               hasSpawn: typeof card._spawnTextEditorDirect === 'function' };
    });
    console.log('— the card —');
    console.log('  clip ' + built.vw + 'x' + built.vh + ' · wrap ' + built.wrapW + 'x' + built.wrapH +
                ' · anno canvas: ' + built.hasCanvas + ' · _spawnTextEditorDirect: ' + built.hasSpawn);
    if (!built.hasSpawn) { console.log('  cannot drive text mode — aborting'); return 0; }

    const regPerSec = async (ms) => page.evaluate(async (ms) => {
      const a = window.__probe.raf, t0 = performance.now();
      await new Promise(r => setTimeout(r, ms));
      return Math.round((window.__probe.raf - a) / ((performance.now() - t0) / 1000));
    }, ms);

    console.log('\n— baseline (card built, no annotations yet) —');
    console.log('  rAF registrations/sec: ' + await regPerSec(1200));

    // ── the director's sequence: 7 comments, typed, committed with Enter ────
    console.log('\n— typing ' + N_COMMENTS + ' comments, Enter after each —');
    const perIter = [];
    for (let i = 1; i <= N_COMMENTS; i++) {
      const t0 = Date.now();
      // A fresh point inside the video for each comment.
      const pt = await page.evaluate((i) => {
        const card = window.__card;
        const r = card.getBoundingClientRect();
        return { x: Math.round(r.left + 60 + (i % 4) * 55), y: Math.round(r.top + 50 + Math.floor(i / 4) * 55) };
      }, i);
      await page.evaluate((pt) => {
        window.__card._spawnTextEditorDirect({ clientX: pt.x, clientY: pt.y, pointerId: 1 });
      }, pt);
      await new Promise(r => setTimeout(r, 180));   // the focus() is in a setTimeout
      await page.keyboard.type('comment ' + i, { delay: 12 });
      await page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 200));
      const st = await page.evaluate(() => {
        const card = window.__card;
        const s = card._annoDrawState;
        let strokes = 0, texts = 0;
        Object.keys(s.strokesByFrame || {}).forEach(f => {
          (s.strokesByFrame[f] || []).forEach(st => { strokes++; if (st.type === 'text') texts++; });
        });
        return {
          editors: document.querySelectorAll('.media-anno-text-editor').length,
          textareas: document.querySelectorAll('textarea').length,
          mode: s.mode,
          tool: (window.state && window.state.tool) || null,
          strokes: strokes, texts: texts,
          active: (document.activeElement && document.activeElement.tagName) || null,
          activeCls: (document.activeElement && document.activeElement.className) || '',
        };
      });
      perIter.push({ i: i, ms: Date.now() - t0, ...st });
      console.log('  #' + i + '  ' + String(Date.now() - t0).padStart(4) + ' ms · ' +
                  'editors left: ' + st.editors + ' · text strokes: ' + st.texts +
                  ' · mode: ' + st.mode + ' · tool: ' + st.tool +
                  ' · activeElement: ' + st.active);
    }

    // ── now: is the video still usable? ────────────────────────────────────
    console.log('\n— after ' + N_COMMENTS + ' comments —');
    const after = await page.evaluate(async () => {
      const card = window.__card;
      const v = card._item.video;
      const out = {};
      out.editors = document.querySelectorAll('.media-anno-text-editor').length;
      out.trBtn = document.querySelectorAll('.anno-tr-btn').length;
      out.mirrors = document.querySelectorAll('span[style*="-9999px"]').length;
      out.mode = card._annoDrawState.mode;
      out.tool = (window.state && window.state.tool) || null;
      out.active = (document.activeElement && document.activeElement.tagName) || null;
      out.activeIsEditor = !!(document.activeElement &&
                              document.activeElement.classList &&
                              document.activeElement.classList.contains('media-anno-text-editor'));
      // who is on top of the middle of the video?
      const r = v.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(cx, cy);
      out.topAtVideoCentre = top ? (top.tagName + '.' + (top.className || '').toString().split(' ')[0]) : null;
      out.topIsVideo = top === v;
      // can the video actually play?
      out.pausedBefore = v.paused;
      const t0 = v.currentTime;
      try { await v.play(); } catch (e) { out.playError = String(e && e.message || e); }
      await new Promise(r2 => setTimeout(r2, 700));
      out.pausedAfter = v.paused;
      out.advanced = +(((v.currentTime || 0) - t0).toFixed(3));
      out.readyState = v.readyState;
      return out;
    });
    Object.keys(after).forEach(k => console.log('  ' + k + ': ' + JSON.stringify(after[k])));

    console.log('\n— rAF registrations/sec after the sequence —');
    console.log('  ' + (await regPerSec(1500)) + ' reg/sec');

    // ── THE decisive test: a REAL mouse click on the video ─────────────────
    // The user's complaint is 「用唔到」. A real click is the only thing that
    // proves it: if the anno canvas is still swallowing pointer events, the
    // click spawns yet another text editor and pauses the clip instead of
    // reaching the <video>. Synthetic dispatchEvent would bypass hit-testing
    // entirely and show a false pass.
    const before = await page.evaluate(async () => {
      const v = window.__card._item.video;
      try { await v.play(); } catch (e) {}
      await new Promise(r => setTimeout(r, 300));
      return { paused: v.paused, dimmed: window.__card.classList.contains('draw-mode') };
    });
    const centre = await page.evaluate(() => {
      const r = window.__card._item.video.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    await page.mouse.click(centre.x, centre.y);
    await new Promise(r => setTimeout(r, 250));
    const clicked = await page.evaluate(() => {
      const card = window.__card;
      return {
        spawnedEditor: document.querySelectorAll('.media-anno-text-editor').length,
        paused: card._item.video.paused,
        mode: card._annoDrawState.mode,
      };
    });
    console.log('\n— REAL mouse click on the video centre —');
    console.log('  playing before the click: ' + (!before.paused) + ' · card dimmed by draw-mode: ' + before.dimmed);
    console.log('  after the click → paused: ' + clicked.paused +
                ' · editors spawned: ' + clicked.spawnedEditor +
                ' · mode: ' + clicked.mode);
    console.log('  VERDICT: ' + (clicked.spawnedEditor > 0
      ? 'the click was EATEN — it spawned another editor, the video is unusable'
      : 'the click reached the video — it toggled play/pause, the card is usable'));

    // ── per-iteration cost growth ──────────────────────────────────────────
    if (perIter.length >= 4) {
      const first = perIter.slice(0, 2).reduce((a, b) => a + b.ms, 0) / 2;
      const last = perIter.slice(-2).reduce((a, b) => a + b.ms, 0) / 2;
      console.log('\n— cost growth —');
      console.log('  first two comments avg ' + Math.round(first) + ' ms · last two avg ' +
                  Math.round(last) + ' ms · ratio ' + (last / Math.max(1, first)).toFixed(2) + 'x');
    }

    console.log('\n— page errors (' + errors.length + ') —');
    errors.slice(0, 12).forEach(e => console.log('  ' + e));

    return 0;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
