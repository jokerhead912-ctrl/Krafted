/* eslint-disable no-console */
/*
 * diag_filter_cost_v7_25_2.js — READ-ONLY probe (diagnostic, not a suite).
 *
 * Question: does the IDENTITY filter chain that mediaFilterString() always
 * returns actually cost anything per frame?
 *
 *   mediaFilterString({}) -> 'brightness(100%) contrast(100%) saturate(100%)
 *                            hue-rotate(0deg) blur(0px) sepia(0%) grayscale(0%)'
 *
 * Every image AND every <video> gets that string written to el.style.filter in
 * updateItemStyle() (kraftpub-dev.html:12702). It is visually a no-op, but a
 * filter value that is not `none` puts the element on a different compositing
 * path than an unfiltered one.
 *
 * This probe animates N canvas layers and measures how many frames it can
 * actually present per second with filter:none vs the identity chain.
 *
 * HEADLESS CAVEAT: no GPU raster in headless Chrome (SwiftShader), so the
 * ABSOLUTE numbers are pessimistic and the ratio is exaggerated. Treat the
 * result as direction only; the real call has to be made on the director's
 * machine with a GPU.
 *
 * Run:
 *   NODE_PATH=/Users/kincheung/.workbuddy/binaries/node/workspace/node_modules \
 *     /Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node \
 *     Krafted/tests/diag_filter_cost_v7_25_2.js
 */
'use strict';

const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LAYERS = parseInt(process.env.LAYERS || '12', 10);
const W = parseInt(process.env.LAYER_W || '320', 10);
const H = parseInt(process.env.LAYER_H || '180', 10);

// The exact string the app writes for an untouched item.
const IDENTITY = 'brightness(100%) contrast(100%) saturate(100%) '
  + 'hue-rotate(0deg) blur(0px) sepia(0%) grayscale(0%)';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1512,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1512, height: 900 });
  await page.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111"></body>');

  const measure = await page.evaluate(async (layers, identity, w, h) => {
    function build(filter) {
      document.body.innerHTML = '';
      const box = document.createElement('div');
      for (let i = 0; i < layers; i++) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.style.cssText = 'display:block;margin:2px;filter:' + filter;
        box.appendChild(c);
      }
      document.body.appendChild(box);
      return Array.from(box.children);
    }

    // Paint something different every frame so the filter actually has to run
    // each time (a static layer would be cached and prove nothing).
    async function run(filter) {
      const cs = build(filter);
      const ctxs = cs.map(c => c.getContext('2d'));
      let frames = 0;
      const t0 = performance.now();
      await new Promise(resolve => {
        function tick() {
          for (let i = 0; i < ctxs.length; i++) {
            const g = ctxs[i];
            g.fillStyle = 'hsl(' + ((frames * 7 + i * 20) % 360) + ',70%,50%)';
            g.fillRect(0, 0, w, h);
            g.fillStyle = '#000';
            g.fillRect((frames * 3) % (w - 20), h * 0.1, 20, h * 0.8);
          }
          frames++;
          if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
          else resolve();
        }
        requestAnimationFrame(tick);
      });
      const ms = performance.now() - t0;
      return { fps: +(frames / (ms / 1000)).toFixed(1), frames: frames };
    }

    // Warm up, then A/B in both orders so a drifting machine cannot pick the
    // winner for us.
    await run('none');
    const a = await run('none');
    const b = await run(identity);
    const c = await run(identity);
    const d = await run('none');
    return { none1: a, identity1: b, identity2: c, none2: d, identity: identity };
  }, LAYERS, IDENTITY, W, H);

  const noneFps = (measure.none1.fps + measure.none2.fps) / 2;
  const idFps = (measure.identity1.fps + measure.identity2.fps) / 2;
  console.log('\nfilter cost probe — ' + LAYERS + ' layers of ' + W + 'x' + H + ', headless (no GPU)\n');
  console.log('  filter: none                       ' + measure.none1.fps + ' / ' + measure.none2.fps
    + ' fps   -> avg ' + noneFps.toFixed(1));
  console.log('  filter: <identity chain>           ' + measure.identity1.fps + ' / ' + measure.identity2.fps
    + ' fps   -> avg ' + idFps.toFixed(1));
  console.log('  delta                              ' + (idFps - noneFps).toFixed(1) + ' fps  ('
    + (((idFps - noneFps) / noneFps) * 100).toFixed(1) + '%)');
  console.log('\n  the identity chain the app writes: ' + measure.identity);
  console.log('  (headless = software rasteriser: direction only, real GPU needed for the verdict)\n');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
