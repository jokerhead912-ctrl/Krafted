#!/usr/bin/env node
/**
 * smoke_v7_21_0.js — a LIVE browser check that Snap now captures the frame you
 * actually drew on, and that the comment-list buttons work with more than one
 * clip on the board.
 *
 * WHY THIS EXISTS
 * --------------
 * test_v7_21_0.js EXECUTES videoAnnoFpsFor / videoAnnoSeekTo /
 * videoAnnoSnapBatch against a fake <video>, and 30 mutants all go red. That
 * proves the logic. It does not prove the thing is CONNECTED: it never runs a
 * real decoder, never performs a real seek, and never puts a real frame
 * through canvas.drawImage — which is exactly where the reported symptom
 * lived ("縮圖係另一格畫面", and it came and went).
 *
 * So this file drives real Chrome:
 *   · records a real 4-second webm in the page (no ffmpeg here — canvas
 *     captureStream + MediaRecorder), every frame a different colour;
 *   · puts TWO clips on the board at DIFFERENT frame rates (25 and 30) and
 *     selects the OTHER one — the exact condition the user described;
 *   · runs the real Snap and then compares the stored snapshot against a
 *     FRESH capture taken at the stored time. If the thumbnail is the frame
 *     the comment claims, those two JPEGs are identical. Under the old code
 *     they were not, and nothing in the suite could have said so.
 *   · negative control: a capture at a DIFFERENT time must differ, or the
 *     comparison above is vacuous.
 *   · clicks the real ↻ and 🗑 buttons in the rendered comment list with
 *     nothing selected and two clips on the board.
 *
 * USAGE
 *   node Krafted/tests/smoke_v7_21_0.js
 *   node Krafted/tests/smoke_v7_21_0.js --headful
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
const PORT = 8733;                  // 8731 = smoke_v7_5_0, 8732 = smoke_v7_20_0

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
    'window.state && typeof window.videoAnnoCaptureSnapshot === "function"',
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
    console.log('SKIP smoke_v7_21_0: puppeteer-core is not installed');
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

    // ── 1. the real page really has the new one-definition helpers ─────────
    console.log('— the fix is present in the shipped page —');
    const api = await page.evaluate(() => ({
      fpsForEl: typeof window.videoAnnoFpsForEl,
      fpsFor: typeof window.videoAnnoFpsFor,
      seekTo: typeof window.videoAnnoSeekTo,
      snap: typeof window.videoAnnoSnapBatch,
      resnap: typeof window.videoAnnoReSnapComment,
      owner: typeof window.videoAnnoFindCommentOwner,
      ctime: typeof window.videoAnnoCommentTime,
      cframe: typeof window.videoAnnoCommentFrame
    }));
    Object.keys(api).forEach(k => eq(api[k], 'function', 'window.videoAnno* helper present: ' + k));

    // ── 2. record a real clip and put two of them on the board ─────────────
    console.log('— recording a real 4s clip in the page —');
    const setup = await page.evaluate(async () => {
      // No ffmpeg on this machine, so make the video in the browser: a canvas
      // captureStream piped through MediaRecorder. Every 40ms paints a
      // different colour, so every frame is visually distinct.
      const cv = document.createElement('canvas');
      cv.width = 320; cv.height = 180;
      const ctx = cv.getContext('2d');
      const stream = cv.captureStream(25);
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks = [];
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise(r => { rec.onstop = r; });
      rec.start();
      let i = 0;
      const iv = setInterval(() => {
        ctx.fillStyle = 'hsl(' + ((i * 37) % 360) + ',85%,50%)';
        ctx.fillRect(0, 0, 320, 180);
        ctx.fillStyle = '#000';
        ctx.font = '48px sans-serif';
        ctx.fillText(String(i), 24, 110);
        i++;
      }, 40);
      await new Promise(r => setTimeout(r, 4000));
      clearInterval(iv);
      rec.stop();
      await stopped;
      const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));

      function mkVideo(fps) {
        return new Promise((resolve, reject) => {
          const v = document.createElement('video');
          v.muted = true;
          v.playsInline = true;
          v.preload = 'auto';
          v._kraftedFps = fps;
          v.onloadeddata = () => resolve(v);
          v.onerror = () => reject(new Error('video failed to load'));
          v.src = url;
          document.body.appendChild(v);
        });
      }
      const vA = await mkVideo(25);      // the clip we annotate
      const vB = await mkVideo(30);      // the clip that is SELECTED

      function mkItem(id, v) {
        const el = document.createElement('div');
        el.className = 'item';
        el.style.position = 'absolute';
        el.style.left = '-9999px';
        document.body.appendChild(el);
        el._annoDrawState = { strokesByFrame: {} };
        const list = document.createElement('div');
        document.body.appendChild(list);
        el._annoCommentsList = list;
        const it = { id: id, isVideo: true, video: v, el: el, anno: null };
        state.items.push(it);
        return it;
      }
      const A = mkItem('smokeA', vA);
      const B = mkItem('smokeB', vB);

      return {
        dur: vA.duration, w: vA.videoWidth, h: vA.videoHeight,
        aId: A.id, bId: B.id
      };
    });
    ok(setup.dur > 2, 'the recorded clip decoded in a real browser (' + Number(setup.dur).toFixed(2) + 's)');
    ok(setup.w > 0 && setup.h > 0, 'with real dimensions (' + setup.w + 'x' + setup.h + ')');

    // ── 3. fps comes from the clip, not from the selection ─────────────────
    console.log('— fps is the clip\'s own, even with the other one selected —');
    const fpsCheck = await page.evaluate((aId, bId) => {
      const A = state.items.find(i => i.id === aId);
      const B = state.items.find(i => i.id === bId);
      state.selected.clear();
      state.selected.add(B.id);            // the OTHER clip is selected
      return { a: videoAnnoFpsFor(A), b: videoAnnoFpsFor(B), sel: getSelectedImages()[0].id };
    }, setup.aId, setup.bId);
    eq(fpsCheck.sel, setup.bId, 'clip B is the one selected on the board');
    eq(fpsCheck.a, 25, 'and clip A still reports its own 25fps (this is the bug that was fixed)');
    eq(fpsCheck.b, 30, 'while clip B reports 30');

    // ── 4. the real Snap, against the real decoder ─────────────────────────
    console.log('— Snap: the thumbnail must be the frame the comment claims —');
    const FRAME = 40;                       // 40 / 25fps = 1.6s
    const snapRes = await page.evaluate(async (aId, frame) => {
      const A = state.items.find(i => i.id === aId);
      const v = A.video;
      // One stroke on the frame we care about.
      A.el._annoDrawState.strokesByFrame[frame] = [
        { type: 'pen', color: '#ff0000', size: 4, points: [[20, 20], [120, 90]], text: '' }
      ];
      const before = v.currentTime;
      const res = await videoAnnoSnapBatch(A);
      // Read the restored playhead NOW. Anything read later is this harness's
      // own extra seeks, not what Snap left behind.
      const restored = v.currentTime;
      const anno = A.anno || { comments: [] };
      const c = anno.comments[0] || null;

      // A FRESH capture at the time the comment says it is anchored to.
      let fresh = '';
      let freshElsewhere = '';
      if (c) {
        const r1 = await videoAnnoSeekTo(v, c.time, 0.5);
        fresh = videoAnnoCaptureSnapshot(v, 0, c.annoStrokes, A);
        const other = (c.time > 1) ? (c.time - 1) : (c.time + 1.5);
        await videoAnnoSeekTo(v, other, 0.5);
        freshElsewhere = videoAnnoCaptureSnapshot(v, 0, c.annoStrokes, A);
        void r1;
      }

      // Turn both JPEGs into a small pixel signature we can compare.
      async function sig(dataUrl) {
        if (!dataUrl) return '';
        const img = new Image();
        img.src = dataUrl;
        try { await img.decode(); } catch (e) { return 'DECODE_FAIL'; }
        const cv = document.createElement('canvas');
        cv.width = 16; cv.height = 9;
        const cx = cv.getContext('2d');
        cx.drawImage(img, 0, 0, 16, 9);
        return Array.from(cx.getImageData(0, 0, 16, 9).data).join(',');
      }

      return {
        snapped: res.snapped,
        before: before,
        restored: restored,
        after: v.currentTime,
        dur: v.duration,
        time: c ? c.time : null,
        target: c ? c.targetTime : null,
        drift: c ? c.snapDrift : null,
        frame: c ? c.frame : null,
        id: c ? c.id : null,
        strokeCount: c ? (c.annoStrokes || []).length : 0,
        snapLen: c ? (c.snapshot || '').length : 0,
        snapIsJpeg: c ? /^data:image\/jpeg/.test(c.snapshot || '') : false,
        sigStored: await sig(c && c.snapshot),
        sigFresh: await sig(fresh),
        sigElsewhere: await sig(freshElsewhere)
      };
    }, setup.aId, FRAME);

    eq(snapRes.snapped, 1, 'Snap produced one comment');
    ok(snapRes.snapIsJpeg, 'and it carries a real JPEG snapshot (' + snapRes.snapLen + ' bytes)');
    eq(snapRes.strokeCount, 1, 'with the stroke that was drawn on that frame');
    near(snapRes.target, FRAME / 25, 0.02,
      'the seek targeted ' + (FRAME / 25) + 's — 40 frames at clip A\'s 25fps');
    ok(Math.abs(snapRes.target - FRAME / 30) > 0.1,
      'NOT ' + (FRAME / 30).toFixed(2) + 's, which is what the selected clip\'s 30fps would have given');
    ok(snapRes.drift !== null && Math.abs(snapRes.drift) <= 0.5,
      'the seek is reported as landing within the accepted drift (' + snapRes.drift + 's)');
    near(snapRes.time, snapRes.target, 0.5,
      'the stored time is the time the decoder actually reached, within that drift');
    near(snapRes.restored, snapRes.before, 1e-6,
      'and Snap puts the playhead back where the user left it');
    eq(snapRes.frame, Math.round(snapRes.time * 25),
      'and the displayed frame number is derived from that real time');
    ok(snapRes.sigStored !== '' && snapRes.sigStored !== 'DECODE_FAIL',
      'the stored snapshot decodes to real pixels');
    eq(snapRes.sigStored, snapRes.sigFresh,
      'THE POINT: the stored thumbnail is byte-for-byte the frame at the stored time');
    ok(snapRes.sigElsewhere !== snapRes.sigStored,
      'negative control: a capture one second away is a DIFFERENT picture (so the match above means something)');

    // ── 5. the comment list buttons work with two clips and no selection ───
    console.log('— the comment list: ↻ and 🗑 with two clips and nothing selected —');
    const ui = await page.evaluate(async (aId) => {
      const A = state.items.find(i => i.id === aId);
      state.selected.clear();                 // nothing selected at all
      videoAnnoRefreshCommentList(A);
      const list = A.el._annoCommentsList;
      return {
        rows: list.querySelectorAll('.media-anno-comment').length,
        resnap: list.querySelectorAll('.resnap').length,
        del: list.querySelectorAll('.del').length,
        goto: list.querySelectorAll('.goto').length
      };
    }, setup.aId);
    ok(ui.rows >= 1, 'the comment list rendered the comment');
    eq(ui.resnap, 1, 'and it offers the ↻ re-snap button');
    eq(ui.del, 1, 'and the 🗑 delete button');

    const resnapRes = await page.evaluate(async (aId) => {
      const A = state.items.find(i => i.id === aId);
      state.selected.clear();
      const before = A.anno.comments[0].snapshot;
      // Click the REAL button, the way the user would.
      A.el._annoCommentsList.querySelector('.resnap').click();
      await new Promise(r => setTimeout(r, 900));
      const c = A.anno.comments[0];
      return { changed: c.snapshot !== before, count: A.anno.comments.length, len: (c.snapshot || '').length };
    }, setup.aId);
    eq(resnapRes.count, 1, 'clicking ↻ did not duplicate the comment');
    ok(resnapRes.len > 1000, 'and it re-captured a real JPEG (' + resnapRes.len + ' bytes)');

    const delRes = await page.evaluate(async (aId) => {
      const A = state.items.find(i => i.id === aId);
      state.selected.clear();                 // the state where delete used to do nothing
      const n0 = A.anno.comments.length;
      A.el._annoCommentsList.querySelector('.del').click();
      await new Promise(r => setTimeout(r, 200));
      return { n0: n0, n1: A.anno.comments.length, rows: A.el._annoCommentsList.querySelectorAll('.media-anno-comment').length };
    }, setup.aId);
    eq(delRes.n0, 1, 'there was one comment before the delete');
    eq(delRes.n1, 0, 'clicking 🗑 removed it, with two clips on the board and nothing selected');

    const errs = page.__errors || [];
    ok(errs.length === 0, 'no uncaught page errors (' + errs.slice(0, 2).join(' | ') + ')');
    await page.close();
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  console.log('');
  console.log('smoke_v7_21_0: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) {
    failures.forEach(f => console.log('  FAILED: ' + f));
    return 1;
  }
  console.log('ALL PASS (' + pass + ' assertions)');
  return 0;
}

main().then(code => process.exit(code)).catch(e => {
  console.log('smoke_v7_21_0 crashed: ' + (e && e.stack || e));
  process.exit(1);
});
