// Real-Chrome pixel check for the v7.30.2 lasso border fix.
//
// WHY THIS EXISTS
//   The Node suite proves the lasso ASKS for no border. It cannot prove the
//   PNG that lands on the board is clean: renderItemRegion() is the thing that
//   actually strokes, and it needs a real canvas, a real decode and a real
//   item in a real layout to run. Asking "is the flag false?" and concluding
//   "there is no line" is one inference too many — 病根⑲.
//
//   So this measures the PIXELS, and it measures the same shape THREE ways:
//     1. renderer, default opts        -> what the lasso now asks for
//     2. renderer, border forced on    -> the stroke, as a positive control
//     3. applyLassoExtract() end to end-> the bytes a user actually gets
//   If (2) shows no stroke the instrument is blind, and a green (1) means
//   nothing. That control is why this is evidence and not a screenshot.
//
// USAGE
//   CHROME_PATH=/path/to/Chrome node check_lasso_border.js \
//       [KRAFTED_HTML=/path/to/kraftpub-dev.html]
//   Point KRAFTED_HTML at the pre-fix backup to watch it go red.

const fs = require('fs');
const path = require('path');
const puppeteer = require('/Users/kincheung/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core');

const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTML = process.env.KRAFTED_HTML ||
  path.join(__dirname, '..', '..', 'kraftpub-dev.html');
const OUT = process.env.OUT_JSON ||
  path.join(__dirname, 'results', 'lasso_border_' + (process.env.TAG || 'mac') + '.json');

const RESULT = { file: HTML, url: 'file://' + HTML, startedAt: new Date().toISOString(),
                 errors: [], consoleErrors: [], measured: {} };

function writeOut() {
  RESULT.finishedAt = new Date().toISOString();
  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(RESULT, null, 2)); }
  catch (e) { console.error('could not write ' + OUT + ': ' + e.message); }
}

async function main() {
  if (!fs.existsSync(CHROME)) { console.error('CHROME NOT FOUND: ' + CHROME); process.exit(2); }
  if (!fs.existsSync(HTML)) { console.error('HTML NOT FOUND: ' + HTML); process.exit(2); }

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files',
           '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
  });
  const page = await browser.newPage();
  page.on('pageerror', e => RESULT.errors.push(String(e && e.message || e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error') RESULT.consoleErrors.push(String(m.text()).slice(0, 300)); });

  await page.goto('file://' + HTML, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction('typeof addImage === "function" && typeof renderItemRegion === "function"',
                             { timeout: 60000 });

  const measured = await page.evaluate(async () => {
    // A flat mid-gray plate with a red corner marker. Mid-gray is far enough
    // from the periwinkle stroke in blue (128 vs 240) that the two can never
    // be confused, and the marker proves the pixels came from THIS image.
    const src = document.createElement('canvas');
    src.width = 400; src.height = 300;
    const sc = src.getContext('2d');
    sc.fillStyle = '#808080'; sc.fillRect(0, 0, 400, 300);
    sc.fillStyle = '#ff0000'; sc.fillRect(0, 0, 24, 24);

    // Distance to the stroke colour #7c8cf0 = rgb(124,140,240), per channel.
    function countStroke(canvas) {
      const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;                       // transparent: nothing was drawn
        if (Math.abs(d[i] - 124) <= 48 && Math.abs(d[i + 1] - 140) <= 48 &&
            Math.abs(d[i + 2] - 240) <= 48) n++;
      }
      return n;
    }

    const item = addImage(src.toDataURL('image/png'), 400, 300, 200, 200,
                          false, undefined, 0, false, null);
    if (!item || !item.el) return { error: 'addImage() returned nothing' };
    const imgEl = item.el.querySelector('img');
    if (!imgEl) return { error: 'the new item has no <img>' };
    for (let i = 0; i < 400; i++) {
      if (imgEl.complete && imgEl.naturalWidth) break;
      await new Promise(r => setTimeout(r, 25));
    }
    if (!(imgEl.complete && imgEl.naturalWidth)) return { error: 'the test image never decoded' };

    const geo = itemPixelGeometry(item);
    if (!geo) return { error: 'itemPixelGeometry() refused the item' };

    const natPts = [{ x: 24, y: 24 }, { x: 376, y: 24 }, { x: 376, y: 276 }, { x: 24, y: 276 }];
    const screenPts = natPts.map(p => _geoApply(geo.nat, p.x, p.y));

    // 1 + 2: the renderer itself, asked both ways.
    const plain = renderItemRegion(item, screenPts, {});
    const bordered = renderItemRegion(item, screenPts, { border: true, borderColor: '#7c8cf0' });
    if (!plain || !bordered) return { error: 'renderItemRegion() returned nothing' };

    const out = {
      outW: plain.outW, outH: plain.outH,
      strokeDefaultOpts: countStroke(plain.canvas),
      strokeForcedBorder: countStroke(bordered.canvas),
    };

    // 3: the whole lasso path, exactly as the Extract button runs it.
    lassoState = { itemId: item.id, points: screenPts, closed: true };
    await applyLassoExtract(false);
    const made = state.items[state.items.length - 1];
    if (!made || made === item) { out.e2eError = 'applyLassoExtract() produced no new item'; return out; }
    const im = new Image();
    im.src = made.src;
    try { await im.decode(); } catch (e) { out.e2eError = 'decode failed: ' + e.message; return out; }
    if (!im.naturalWidth) { out.e2eError = 'the extracted item has no pixels'; return out; }
    const cv = document.createElement('canvas');
    cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    cv.getContext('2d').drawImage(im, 0, 0);
    out.e2eW = im.naturalWidth; out.e2eH = im.naturalHeight;
    out.strokeLassoExtract = countStroke(cv);
    return out;
  });

  RESULT.measured = measured;
  await browser.close();

  // ── verdict ─────────────────────────────────────────────────────────
  const m = measured;
  const checks = [];
  const add = (label, ok, detail) => { checks.push({ label: label, ok: !!ok, detail: detail }); };
  add('instrument can see a stroke (positive control)',
      m.strokeForcedBorder > 0, 'forced border: ' + m.strokeForcedBorder + ' px');
  add('renderer with default opts draws no stroke',
      m.strokeDefaultOpts === 0, 'default opts: ' + m.strokeDefaultOpts + ' px');
  add('applyLassoExtract() end to end draws no stroke',
      m.strokeLassoExtract === 0, 'lasso extract: ' + m.strokeLassoExtract + ' px');
  add('no page errors while doing it', RESULT.errors.length === 0, RESULT.errors.join(' | '));
  RESULT.checks = checks;
  RESULT.verdict = checks.every(c => c.ok) ? 'PASS' : 'FAIL';
  return RESULT.verdict;
}

main().then(v => { RESULT.verdict = v; writeOut(); console.log('\nlasso border pixel check: ' + v);
                   console.log(JSON.stringify(RESULT.measured, null, 2));
                   RESULT.checks.forEach(c => console.log((c.ok ? '  ok   ' : '  FAIL ') + c.label + '  (' + c.detail + ')'));
                   process.exit(v === 'PASS' ? 0 : 1); })
      .catch(e => { RESULT.error = String(e && e.message || e); RESULT.verdict = 'CRASH';
                    writeOut(); console.error('CRASH: ' + RESULT.error); process.exit(3); });
