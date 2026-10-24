/*
 * diag_proxy_badge_v7_27_1.js — browser E2E for the PROXY chip.
 *
 * Unit tests can prove syncProxyBadgeEl() runs and that the CSS is there.
 * They cannot prove the chip actually appears on a card that undo rebuilt,
 * that it survives playback, or that the export does not bake it. Those four
 * are DOM/CSS/pixel questions, so they get answered in a real browser.
 *
 *   1. 卡面      the chip is visible on a proxy card and on no other card
 *   2. 播放      the card still plays with the chip on it
 *   3. undo      applySnapshot() rebuilds the card and the chip comes back
 *   4. 導出      paintBoardRegion() paints no chip pixels; body.capturing
 *                hides the chip
 *
 * Run:
 *   NODE_PATH=/Users/kincheung/.workbuddy/binaries/node/workspace/node_modules \
 *     /Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node \
 *     Krafted/tests/diag_proxy_badge_v7_27_1.js
 */
'use strict';

const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTML = process.env.KRAFTED_HTML
  ? path.resolve(process.env.KRAFTED_HTML)
  : path.resolve(__dirname, '../../kraftpub-dev.html');

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  (' + JSON.stringify(extra) + ')' : '')); }
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files',
           '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 1512, height: 900 },
  });
  const page = await browser.newPage();
  page.on('pageerror', () => {});
  await page.goto('file://' + HTML, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.state && window.state.items, { timeout: 60000 });

  console.log('Krafted PROXY chip probe — ' + path.basename(HTML) + '\n');

  // A real decodable webm, made in-page (there is no ffmpeg on this machine).
  // Solid dark blue + a white box, so an amber chip pixel is unambiguous.
  await page.evaluate(async () => {
    window.__clip = await (async () => {
      const cv = document.createElement('canvas');
      cv.width = 160; cv.height = 120;
      const c = cv.getContext('2d');
      const stream = cv.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks = [];
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      const done = new Promise(r => { rec.onstop = r; });
      rec.start();
      let t = 0;
      const iv = setInterval(() => {
        t++;
        c.fillStyle = '#0a2a5a'; c.fillRect(0, 0, 160, 120);
        c.fillStyle = '#ffffff'; c.fillRect((t * 7) % 140, 45, 20, 20);
      }, 33);
      await new Promise(r => setTimeout(r, 1200));
      clearInterval(iv);
      rec.stop();
      await done;
      return new Blob(chunks, { type: 'video/webm' });
    })();
  });
  const clipSize = await page.evaluate(() => window.__clip.size);
  ok(clipSize > 500, 'a real webm was recorded in-page (' + clipSize + ' bytes)', clipSize);

  // ── helpers ────────────────────────────────────────────────────────────
  const drop = (names) => page.evaluate(async (names) => {
    const dt = new DataTransfer();
    for (const n of names) {
      dt.items.add(new File([window.__clip], n, { type: 'video/webm' }));
    }
    const target = document.getElementById('viewport') || document.body;
    target.dispatchEvent(new DragEvent('drop', {
      dataTransfer: dt, bubbles: true, cancelable: true, clientX: 700, clientY: 450,
    }));
    await new Promise(r => setTimeout(r, 2500));
    // one more frame so the rAF-scheduled chip refresh has definitely run
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, names);

  const clearBoard = () => page.evaluate(() => {
    window.state.items.slice().forEach(i => { if (i.el && i.el.remove) i.el.remove(); });
    window.state.items.length = 0;
  });

  // Everything we can observe about the chip, from the live DOM.
  const readCards = () => page.evaluate(() => {
    return window.state.items.map(it => {
      const el = it.el;
      const bar = el ? el.querySelector('.media-info-bar') : null;
      const chip = bar ? bar.querySelector('.ib-proxy') : null;
      return {
        filename: it.filename || '',
        isProxy: !!it.isProxy,
        originalName: it.originalName || '',
        hasBar: !!bar,
        hasProxyClass: bar ? bar.classList.contains('has-proxy') : false,
        chipText: chip ? chip.textContent : null,
        chipTitle: chip ? chip.title : null,
        chipDisplay: chip ? getComputedStyle(chip).display : null,
        chipPointer: chip ? getComputedStyle(chip).pointerEvents : null,
        barPointer: bar ? getComputedStyle(bar).pointerEvents : null,
      };
    });
  });

  // ── 1. 卡面 ────────────────────────────────────────────────────────────
  console.log('1. 卡面 — the chip');
  await clearBoard();
  await drop(['shot01.webm', 'shot01_proxy.webm']);
  let cards = await readCards();
  ok(cards.length === 1, 'original + proxy -> one card', cards.length);
  const c = cards[0] || {};
  ok(c.isProxy === true, 'the card is stamped as a proxy', c.isProxy);
  ok(c.originalName === 'shot01.webm', 'and remembers its original', c.originalName);
  ok(c.hasProxyClass === true, 'the info bar carries .has-proxy', c.hasProxyClass);
  ok(c.chipDisplay !== 'none', 'so the chip is actually rendered', c.chipDisplay);
  ok(c.chipText === 'PROXY', 'and reads PROXY', c.chipText);
  ok(c.chipTitle === 'Proxy for shot01.webm', 'the tooltip names the original', c.chipTitle);
  ok(c.barPointer === 'none', 'the bar never eats a click', c.barPointer);

  await clearBoard();
  await drop(['plain.webm']);
  cards = await readCards();
  const p = cards[0] || {};
  ok(cards.length === 1 && p.isProxy !== true, 'a plain clip is not a proxy', p.isProxy);
  ok(p.hasProxyClass === false, 'so no .has-proxy on the bar', p.hasProxyClass);
  ok(p.chipDisplay === 'none', 'and the chip is not rendered', p.chipDisplay);

  await clearBoard();
  await drop(['lone_proxy.webm']);
  cards = await readCards();
  const l = cards[0] || {};
  ok(l.isProxy === true && l.hasProxyClass === true, 'a lone proxy is still marked', l);
  ok(/no original/.test(l.chipTitle || ''), 'and says it has no original', l.chipTitle);

  // ── 2. 播放 ────────────────────────────────────────────────────────────
  console.log('\n2. 播放 — the card still plays with the chip on it');
  const playState = await page.evaluate(async () => {
    const it = window.state.items[0];
    if (!it || !it.video) return { err: 'no video on the card' };
    if (typeof window.playMediaEl !== 'function') return { err: 'playMediaEl not exposed' };
    window.playMediaEl(it.video);
    await new Promise(r => setTimeout(r, 900));
    const chip = it.el.querySelector('.ib-proxy');
    return {
      paused: it.video.paused,
      playing: document.body.classList.contains('media-playing'),
      chipDisplay: chip ? getComputedStyle(chip).display : null,
      currentTime: it.video.currentTime,
    };
  });
  ok(!playState.err, 'the probe could reach the player', playState.err);
  ok(playState.paused === false, 'the proxy clip is playing', playState.paused);
  ok(playState.playing === true, 'body.media-playing is on (the budget path was used)', playState.playing);
  ok(playState.chipDisplay !== 'none', 'the chip stays visible while playing', playState.chipDisplay);
  ok(playState.currentTime > 0, 'and the clock actually advanced', playState.currentTime);

  // ── 3. undo ────────────────────────────────────────────────────────────
  console.log('\n3. undo — a rebuilt card brings its chip back');
  await clearBoard();
  await drop(['shot02.webm', 'shot02_proxy.webm']);   // pushes undo, one proxy card
  let before = (await readCards())[0] || {};
  ok(before.hasProxyClass === true, 'chip on before undo', before.hasProxyClass);
  await drop(['extra.webm']);                          // pushes undo again
  const undoOk = await page.evaluate(async () => {
    if (typeof window.undo !== 'function') return { err: 'undo not exposed' };
    window.undo();
    await new Promise(r => setTimeout(r, 1500));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const it = window.state.items.find(i => i.isProxy) || window.state.items[0];
    if (!it) return { err: 'no card after undo' };
    const bar = it.el && it.el.querySelector('.media-info-bar');
    const chip = bar && bar.querySelector('.ib-proxy');
    return {
      count: window.state.items.length,
      isProxy: !!it.isProxy,
      originalName: it.originalName || '',
      hasProxyClass: bar ? bar.classList.contains('has-proxy') : false,
      chipDisplay: chip ? getComputedStyle(chip).display : null,
      chipTitle: chip ? chip.title : null,
    };
  });
  ok(!undoOk.err, 'undo ran', undoOk.err);
  ok(undoOk.count === 1, 'the extra card is gone again', undoOk.count);
  ok(undoOk.isProxy === true, 'the restored card is still a proxy', undoOk.isProxy);
  ok(undoOk.originalName === 'shot02.webm', 'and still remembers its original', undoOk.originalName);
  ok(undoOk.hasProxyClass === true, 'the rebuilt info bar carries .has-proxy', undoOk.hasProxyClass);
  ok(undoOk.chipDisplay !== 'none', 'so the chip came back after undo — this is the one that bites',
     undoOk.chipDisplay);
  ok(undoOk.chipTitle === 'Proxy for shot02.webm', 'and still names the original', undoOk.chipTitle);

  // ── 4. 導出 ────────────────────────────────────────────────────────────
  console.log('\n4. 導出 — the chip is not in the output');
  const exportCheck = await page.evaluate(() => {
    const it = window.state.items.find(i => i.isProxy);
    if (!it || !it.el) return { err: 'no proxy card' };
    const chip = it.el.querySelector('.ib-proxy');
    const cr = chip.getBoundingClientRect();
    if (typeof window.paintBoardRegion !== 'function') return { err: 'paintBoardRegion not exposed' };
    const vp = document.getElementById('viewport').getBoundingClientRect();
    const cv = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d');
    window.paintBoardRegion(ctx, {
      sx: vp.left, sy: vp.top, sw: cv.width, sh: cv.height, scale: 1, bg: 'transparent',
    });
    // Sample a grid across the chip's own rectangle: amber (#ffb020) anywhere
    // in there means the chip was baked.
    const x0 = Math.round(cr.left - vp.left), y0 = Math.round(cr.top - vp.top);
    const w = Math.max(1, Math.round(cr.width)), h = Math.max(1, Math.round(cr.height));
    let amber = 0, sampled = 0;
    const d = ctx.getImageData(x0, y0, w, h).data;
    for (let i = 0; i < d.length; i += 4) {
      sampled++;
      const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (a > 8 && r > 200 && g > 140 && g < 210 && b < 90) amber++;
    }
    return { amber: amber, sampled: sampled, chipW: w, chipH: h };
  });
  ok(!exportCheck.err, 'the export renderer could be driven', exportCheck.err);
  ok(exportCheck.sampled > 0, 'the chip rect was actually sampled', exportCheck);
  ok(exportCheck.amber === 0,
     'no amber chip pixel in the painted region (' + exportCheck.amber + '/' + exportCheck.sampled + ')',
     exportCheck);

  const capCheck = await page.evaluate(() => {
    const it = window.state.items.find(i => i.isProxy);
    const chip = it.el.querySelector('.ib-proxy');
    const before = getComputedStyle(chip).display;
    document.body.classList.add('capturing');
    const during = getComputedStyle(chip).display;
    document.body.classList.remove('capturing');
    const after = getComputedStyle(chip).display;
    return { before: before, during: during, after: after };
  });
  ok(capCheck.before !== 'none', 'chip visible normally', capCheck);
  ok(capCheck.during === 'none', 'chip hidden under body.capturing (cannot bleed into a capture)', capCheck);
  ok(capCheck.after !== 'none', 'and comes back afterwards', capCheck);

  console.log('\nPROXY CHIP ' + (fail === 0 ? 'PASS' : 'FAIL') + '  (' + pass + ' passed' +
              (fail ? ', ' + fail + ' failed' : '') + ')');
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('PROBE FAILED: ' + (e && e.stack || e)); process.exit(1); });
