/*
 * diag_proxy_swap_v7_28_0.js — browser E2E for Link original + swap.
 *
 * The unit suite proves the machinery. It cannot prove the thing the whole
 * feature exists for: that a board built from proxies can EXPORT THE
 * ORIGINAL. So this probe imports two clips that are deliberately different
 * colours — the proxy is blue, the original is magenta — and reads the pixels
 * back out of the real export renderer before and after the swap.
 *
 *   before  the exported region is blue     (the proxy is on screen)
 *   after   the exported region is magenta  (the original is on screen)
 *
 * "No chip pixels" was never enough on its own — an empty canvas also has no
 * chip pixels — so every sample here also counts how much of the frame was
 * actually painted.
 *
 * Run:
 *   NODE_PATH=/Users/kincheung/.workbuddy/binaries/node/workspace/node_modules \
 *     /Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node \
 *     Krafted/tests/diag_proxy_swap_v7_28_0.js
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

  console.log('Krafted proxy swap probe — ' + path.basename(HTML) + '\n');

  // Two clips, same shape, deliberately different colours.
  await page.evaluate(async () => {
    async function rec(colour) {
      const cv = document.createElement('canvas');
      cv.width = 160; cv.height = 120;
      const c = cv.getContext('2d');
      const stream = cv.captureStream(30);
      const rec2 = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks = [];
      rec2.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      const done = new Promise(r => { rec2.onstop = r; });
      rec2.start();
      let t = 0;
      const iv = setInterval(() => {
        t++;
        c.fillStyle = colour; c.fillRect(0, 0, 160, 120);
        c.fillStyle = '#ffffff'; c.fillRect((t * 7) % 140, 45, 20, 20);
      }, 33);
      await new Promise(r => setTimeout(r, 2400));
      clearInterval(iv);
      rec2.stop();
      await done;
      return new Blob(chunks, { type: 'video/webm' });
    }
    // ~2.4s each: long enough that a clip played from the middle cannot
    // run out while the probe is still measuring whether it survived a swap.
    window.__proxyClip = await rec('#0a2a5a');   // blue
    window.__origClip = await rec('#c81e78');    // magenta
  });
  const sizes = await page.evaluate(() => [window.__proxyClip.size, window.__origClip.size]);
  ok(sizes[0] > 500 && sizes[1] > 500, 'two decodable clips were recorded in-page', sizes);

  const dropPair = () => page.evaluate(async () => {
    window.state.items.slice().forEach(i => { if (i.el && i.el.remove) i.el.remove(); });
    window.state.items.length = 0;
    const dt = new DataTransfer();
    dt.items.add(new File([window.__origClip], 'shot01.webm', { type: 'video/webm' }));
    dt.items.add(new File([window.__proxyClip], 'shot01_proxy.webm', { type: 'video/webm' }));
    const target = document.getElementById('viewport') || document.body;
    target.dispatchEvent(new DragEvent('drop', {
      dataTransfer: dt, bubbles: true, cancelable: true, clientX: 700, clientY: 450,
    }));
    await new Promise(r => setTimeout(r, 2500));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

  // Make sure a frame is really decoded, otherwise drawImage paints nothing
  // and every "colour" assertion below is measuring an empty canvas.
  const ensureFrame = () => page.evaluate(async () => {
    const it = window.state.items[0];
    const v = it && it.video;
    if (!v) return false;
    await new Promise(res => {
      let done = false;
      const fin = () => { if (!done) { done = true; res(); } };
      if (v.readyState >= 2) return fin();
      v.addEventListener('loadeddata', fin, { once: true });
      v.addEventListener('seeked', fin, { once: true });
      setTimeout(fin, 4000);
      try { v.currentTime = 0.2; } catch (e) {}
    });
    await new Promise(r => setTimeout(r, 400));
    return v.readyState >= 2;
  });

  // Paint the board through the real export renderer and classify the pixels
  // inside the card's picture area.
  const sample = () => page.evaluate(() => {
    const it = window.state.items[0];
    if (!it || !it.el) return { err: 'no card' };
    const wrap = it.el.querySelector('.media-wrap');
    const cr = wrap.getBoundingClientRect();
    const vp = document.getElementById('viewport').getBoundingClientRect();
    const cv = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d');
    window.paintBoardRegion(ctx, {
      sx: vp.left, sy: vp.top, sw: cv.width, sh: cv.height, scale: 1, bg: 'transparent',
    });
    // A central block of the picture: away from the info bar and the controls.
    const x0 = Math.round(cr.left - vp.left + cr.width * 0.25);
    const y0 = Math.round(cr.top - vp.top + cr.height * 0.25);
    const w = Math.max(1, Math.round(cr.width * 0.5));
    const h = Math.max(1, Math.round(cr.height * 0.5));
    const d = ctx.getImageData(x0, y0, w, h).data;
    let painted = 0, blue = 0, magenta = 0, total = 0;
    for (let i = 0; i < d.length; i += 4) {
      total++;
      const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (a < 8) continue;
      painted++;
      if (b > 45 && r < 90 && g < 110) blue++;
      else if (r > 110 && b > 50 && g < 110) magenta++;
    }
    return { total: total, painted: painted, blue: blue, magenta: magenta };
  });

  const chipState = () => page.evaluate(() => {
    const it = window.state.items[0];
    const bar = it && it.el ? it.el.querySelector('.media-info-bar') : null;
    const chip = bar ? bar.querySelector('.ib-proxy') : null;
    return {
      isProxy: !!(it && it.isProxy),
      showing: !!(it && it._showingOriginal),
      text: chip ? chip.textContent : null,
      title: chip ? chip.title : null,
      hasOrig: bar ? bar.classList.contains('has-orig') : false,
      src: it && it.video ? String(it.video.src).slice(0, 24) : null,
      itemSrc: it ? String(it.src).slice(0, 24) : null,
    };
  });

  // ── 1. drop, and confirm the board is playing the proxy ────────────────
  console.log('1. drop the pair');
  await dropPair();
  await ensureFrame();
  let c = await chipState();
  ok(c.isProxy === true, 'one card, marked as a proxy', c.isProxy);
  ok(c.text === 'PROXY', 'the chip says PROXY', c.text);
  ok(c.showing === false, 'and it is not showing the original yet', c.showing);

  let before = await sample();
  ok(!before.err && before.painted > 100, 'the export painted a real frame', before);
  ok(before.blue > before.magenta * 2,
     'and that frame is the BLUE proxy (' + before.blue + ' blue vs ' + before.magenta + ' magenta)',
     before);

  // ── 2. link + swap through the menu's own entry points ─────────────────
  console.log('\n2. link original + swap (through the real menu handlers)');
  const menuBefore = await page.evaluate(() => {
    const it = window.state.items[0];
    window.state.selected.clear();
    window.state.selected.add(it.id);
    const vp = document.getElementById('viewport');
    vp.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 700, clientY: 450 }));
    const m = document.getElementById('ctx-menu');
    const html = m ? m.innerHTML : '';
    if (window.hideCtx) window.hideCtx();
    return html;
  });
  ok(/Link original/.test(menuBefore), 'an unlinked card offers "Link original…"',
     menuBefore.slice(-200));

  // NB: `proxyOriginals` is a top-level `const`, so it is NOT a window
  // property — asking for window.proxyOriginals would silently read undefined
  // and look exactly like "the link failed". Assert the USER-VISIBLE effect
  // instead: the menu entry changes from "Link original…" to "Swap to
  // original", which is what the user is actually meant to see.
  const menuAfterLink = await page.evaluate(async () => {
    window.linkOriginalSelected();
    await new Promise(r => setTimeout(r, 400));
    const vp = document.getElementById('viewport');
    vp.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 700, clientY: 450 }));
    const html = document.getElementById('ctx-menu').innerHTML;
    if (window.hideCtx) window.hideCtx();
    return html;
  });
  ok(/Swap to original/.test(menuAfterLink) && !/Link original/.test(menuAfterLink),
     'linking needs no picker — the original came in the same drag',
     menuAfterLink.slice(-200));

  await page.evaluate(async () => {
    window.swapProxySelected();
    await new Promise(r => setTimeout(r, 1500));
  });
  await ensureFrame();
  c = await chipState();
  ok(c.showing === true, 'the card is now showing the original', c.showing);
  ok(c.text === 'ORIG', 'the chip says ORIG', c.text);
  ok(c.hasOrig === true, 'and the bar carries .has-orig', c.hasOrig);
  ok(c.src !== c.itemSrc, 'the video element moved, item.src did not',
     { v: c.src, item: c.itemSrc });

  // ── 3. 導出 — the whole point ──────────────────────────────────────────
  console.log('\n3. 導出 — the export now carries the original');
  let after = await sample();
  ok(!after.err && after.painted > 100, 'the export painted a real frame', after);
  ok(after.magenta > after.blue * 2,
     'and that frame is the MAGENTA original (' + after.magenta + ' magenta vs ' + after.blue + ' blue)',
     after);

  // ── 4. 播放 — a conform must not move the card ─────────────────────────
  console.log('\n4. 播放 — the playhead and the transport survive the swap');
  const play = await page.evaluate(async () => {
    const it = window.state.items[0];
    const v = it.video;
    // The card loops by default and this clip is only ~1.2s — left alone the
    // playhead wraps past the end and every reading looks like "it jumped to
    // zero". The loop is not what is under test here.
    v.loop = false;
    try { v.currentTime = 0.3; } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
    window.playMediaEl(v);
    await new Promise(r => setTimeout(r, 400));
    const t0 = v.currentTime;
    const paused0 = v.paused;
    window.swapProxySelected();                 // back to the proxy
    await new Promise(r => setTimeout(r, 1500));
    return { t0: t0, paused0: paused0, t1: v.currentTime, paused1: v.paused,
             showing: !!it._showingOriginal };
  });
  ok(play.paused0 === false, 'it was playing before the swap', play.paused0);
  ok(play.t0 > 0.25, 'with the playhead away from zero', play.t0);
  ok(play.paused1 === false, 'and it is still playing after the swap', play.paused1);
  ok(play.t1 > play.t0 - 0.1, 'the playhead was not thrown back to the start', play);
  ok(play.showing === false, 'and the swap really went back to the proxy', play.showing);

  // ── 5. undo — a snapshot must not carry the swap ───────────────────────
  console.log('\n5. undo — the proxy comes back, by design');
  const undone = await page.evaluate(async () => {
    const it = window.state.items[0];
    window.state.selected.clear();
    window.state.selected.add(it.id);
    window.swapProxySelected();                 // to the original again
    await new Promise(r => setTimeout(r, 1200));
    const showingBefore = !!window.state.items[0]._showingOriginal;
    window.pushUndo();
    window.undo();
    await new Promise(r => setTimeout(r, 2000));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const it2 = window.state.items.find(i => i.isProxy) || window.state.items[0];
    const bar = it2 && it2.el ? it2.el.querySelector('.media-info-bar') : null;
    const chip = bar ? bar.querySelector('.ib-proxy') : null;
    return {
      showingBefore: showingBefore,
      count: window.state.items.length,
      showing: !!(it2 && it2._showingOriginal),
      text: chip ? chip.textContent : null,
      isProxy: !!(it2 && it2.isProxy),
    };
  });
  ok(undone.showingBefore === true, 'the card was showing the original before undo', undone);
  ok(undone.count === 1, 'undo did not destroy the card', undone.count);
  ok(undone.isProxy === true, 'the restored card is still a proxy', undone.isProxy);
  ok(undone.showing === false, 'and is back on the proxy — item.src never carried the swap',
     undone.showing);
  ok(undone.text === 'PROXY', 'with the chip saying so', undone.text);

  console.log('\nPROXY SWAP ' + (fail === 0 ? 'PASS' : 'FAIL') + '  (' + pass + ' passed' +
              (fail ? ', ' + fail + ' failed' : '') + ')');
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('PROBE FAILED: ' + (e && e.stack || e)); process.exit(1); });
