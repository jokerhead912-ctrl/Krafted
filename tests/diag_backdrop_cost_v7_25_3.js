/*
 * diag_backdrop_cost_v7_25_3.js — READ-ONLY probe (diagnostic, not a suite).
 *
 * Question: what does a backdrop-filter actually cost, isolated?
 *
 * Why this exists: diag_video_budget_v7_25_3.js tried to measure the blur while
 * 4-10 videos were decoding and got noise (-0.0% / 2.8% / 0.8% fps over three
 * runs, dropped-frame counts with no signal at all). Video decode dominates the
 * frame budget, so the blur's share disappeared under it. This probe removes
 * the decode: the backdrop is one animated <canvas> (still changing every
 * frame, which is the expensive case for a backdrop filter) and nothing else.
 *
 * The two arms are run in both orders and repeated, so drift shows up as
 * disagreement between reps instead of being averaged away.
 *
 * HEADLESS CAVEAT: SwiftShader raster, no GPU. This measures the CPU-side cost
 * of the effect. On a real GPU the absolute number differs; the sign and the
 * order of magnitude of "a changing backdrop + a blur" should carry over.
 *
 * Run:
 *   NODE_PATH=/Users/kincheung/.workbuddy/binaries/node/workspace/node_modules \
 *     /Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node \
 *     Krafted/tests/diag_backdrop_cost_v7_25_3.js
 *   (env: REPS=3 SECONDS=2 W=900 H=600)
 */
'use strict';

const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REPS = Number(process.env.REPS || 3);
const SECONDS = Number(process.env.SECONDS || 2);
const W = Number(process.env.W || 900);
const H = Number(process.env.H || 600);

function fmt(n, d = 2) { return Number(n).toFixed(d); }
function med(a) { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1512, height: 900 },
  });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body style="margin:0;background:#111"></body></html>');

  await page.evaluate((w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.style.cssText = 'position:fixed;left:200px;top:120px;z-index:1';
    document.body.appendChild(c);
    window.__g = c.getContext('2d');
    window.__f = 0;
    let raf = true;
    (function loop() {
      window.__f++;
      const g = window.__g;
      g.fillStyle = 'rgb(' + (window.__f * 7 % 255) + ',80,' + (255 - window.__f * 5 % 255) + ')';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff';
      g.fillRect((window.__f * 6) % (w - 60), h / 2 - 20, 40, 40);
      if (raf) requestAnimationFrame(loop);
    })();
  }, W, H);

  async function measure(blur) {
    return page.evaluate((blurOn, secs, w, h) => new Promise((res) => {
      const old = document.getElementById('arm');
      if (old) old.remove();
      const d = document.createElement('div');
      d.id = 'arm';
      d.style.cssText = 'position:fixed;left:200px;top:120px;width:' + w + 'px;height:' + h + 'px;' +
        'z-index:2;background:rgba(20,20,24,0.55);' +
        (blurOn ? 'backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);'
                : 'backdrop-filter:none;');
      document.body.appendChild(d);
      let frames = 0;
      const t0 = performance.now();
      (function step() {
        frames++;
        if (performance.now() - t0 < secs * 1000) requestAnimationFrame(step);
        else res(frames / ((performance.now() - t0) / 1000));
      })();
    }), blur, SECONDS, W, H);
  }

  const on = [], off = [];
  for (let i = 0; i < REPS; i++) {
    off.push(await measure(false));
    on.push(await measure(true));
    console.log('rep ' + (i + 1) + ':  blur off ' + fmt(off[i], 1) + ' fps   blur on ' + fmt(on[i], 1) + ' fps');
  }

  const mOff = med(off), mOn = med(on);
  console.log('');
  console.log('median blur off: ' + fmt(mOff, 1) + ' fps');
  console.log('median blur on : ' + fmt(mOn, 1) + ' fps');
  console.log('blur cost      : ' + fmt((mOff - mOn) / (mOff || 1) * 100, 1) + '% fps');
  const spread = Math.max(...on) - Math.min(...on);
  console.log('spread on reps : ' + fmt(spread, 1) + ' fps  (noise floor for comparison)');

  await browser.close();
})().catch((e) => { console.log('PROBE FAILED: ' + (e && e.message)); process.exit(1); });
