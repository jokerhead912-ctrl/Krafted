// Measure, do not guess: does the draw toolbar (.media-anno-toolbar) move
// when the user Alt+middle-drags the video frame to re-frame it?
//
// The user's report: "when i alt mid click to move the video the annotation
// panel is weird it can move" -> "佢郁嘅時候撠住" (when it moves it gets in
// the way). Reading the code says it SHOULD NOT move: the toolbar is
// position:absolute inside .item, and _positionToolbar() derives its offset
// from the WRAP rect, which a video pan does not change. A reading and a
// measurement that disagree are exactly when you measure.
//
// So this records every quantity _positionToolbar() reads — wrap rect, item
// rect, toolbar offsetWidth/Height, the resulting inline left/top and the
// toolbar's own BCR — before and after a real Alt+middle drag, and says which
// one moved.
//
// USAGE  node probe_anno_toolbar.js [fixture.mp4]

const fs = require('fs');
const path = require('path');
const puppeteer = require('/Users/kincheung/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core');

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTML = process.env.KRAFTED_HTML || path.join(__dirname, '..', '..', 'kraftpub-dev.html');
const FIXTURE = process.argv[2] ||
  path.join(__dirname, 'fixtures', 'footage', 'takeA', 'shot01_proxy.mp4');
const OUT = path.join(__dirname, 'results', 'probe_anno_toolbar_' + (process.env.TAG || 'mac') + '.json');

const R = { html: HTML, fixture: FIXTURE, startedAt: new Date().toISOString(), errors: [] };

function writeOut() {
  R.finishedAt = new Date().toISOString();
  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(R, null, 2)); }
  catch (e) { console.error('write failed: ' + e.message); }
}

const snap = () => {
  const item = state.items.find(i => i.isVideo && i.video);
  if (!item || !item.el) return { error: 'no video item' };
  const el = item.el;
  const tb = el.querySelector('.media-anno-toolbar');
  const wrap = el.querySelector('.media-wrap');
  const vid = item.video;
  const rect = r => r ? { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) } : null;
  return {
    wrapRect: rect(wrap && wrap.getBoundingClientRect()),
    itemRect: rect(el.getBoundingClientRect()),
    videoRect: rect(vid && vid.getBoundingClientRect()),
    videoTransform: vid ? (vid.style.transform || '') : null,
    tbPresent: !!tb,
    tbDisplay: tb ? (tb.style.display || getComputedStyle(tb).display) : null,
    tbOffset: tb ? { w: tb.offsetWidth, h: tb.offsetHeight } : null,
    tbInline: tb ? { left: tb.style.left, top: tb.style.top, height: tb.style.height } : null,
    tbRect: rect(tb && tb.getBoundingClientRect()),
    tbVarScale: tb ? tb.style.getPropertyValue('--tb-scale') : null,
    toolbarPos: item.el._annoDrawState ? (item.el._annoDrawState.toolbarPos || null) : null,
    pan: { x: item._videoPanX || 0, y: item._videoPanY || 0 },
    zoom: item._videoZoom === undefined ? null : item._videoZoom,
  };
};

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files',
           '--autoplay-policy=no-user-gesture-required', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
  });
  const page = await browser.newPage();
  page.on('pageerror', e => R.errors.push(String(e && e.message || e).slice(0, 300)));

  await page.goto('file://' + HTML, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction('typeof addImage === "function"', { timeout: 60000 });

  // Real File, never bytes-as-strings (130 MB through page.evaluate OOM-killed
  // the renderer once — a harness that kills the page proves nothing).
  await page.evaluate(() => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.id = '__probe_files'; inp.style.display = 'none';
    document.body.appendChild(inp);
  });
  const eh = await page.$('#__probe_files');
  await eh.uploadFile(FIXTURE);
  const dropped = await page.evaluate(async () => {
    const inp = document.getElementById('__probe_files');
    const dt = new DataTransfer();
    Array.prototype.forEach.call(inp.files, f => dt.items.add(f));
    window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true,
      clientX: 700, clientY: 400, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 9000));
    const v = state.items.filter(i => i.isVideo && i.video);
    return { items: state.items.length, videos: v.length };
  });
  R.dropped = dropped;
  if (!dropped.videos) { R.error = 'no video item was created'; return 'NO VIDEO'; }

  // Show the toolbar the way draw mode does, and let it settle a frame.
  const before = await page.evaluate(async (snapSrc) => {
    const fn = new Function('return (' + snapSrc + ')')();
    const item = state.items.find(i => i.isVideo && i.video);
    const tb = item.el.querySelector('.media-anno-toolbar');
    if (tb) {
      tb.classList.remove('toolbar-hidden');
      tb.style.setProperty('display', 'flex', 'important');
      tb.style.setProperty('visibility', 'visible', 'important');
      tb.style.setProperty('opacity', '1', 'important');
    }
    if (item.el._repositionAnnoToolbar) item.el._repositionAnnoToolbar();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return fn();
  }, snap.toString());
  R.before = before;

  // Real Alt+middle drag on the video frame.
  const box = await page.evaluate(() => {
    const item = state.items.find(i => i.isVideo && i.video);
    const r = item.el.querySelector('.media-wrap').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  R.dragAt = box;
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x, box.y);
  await page.mouse.down({ button: 'middle' });
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(box.x + i * 12, box.y + i * 6);
    await new Promise(r => setTimeout(r, 40));
  }
  const during = await page.evaluate(new Function('return (' + snap.toString() + ')')());
  await page.mouse.up({ button: 'middle' });
  await page.keyboard.up('Alt');
  await new Promise(r => setTimeout(r, 400));
  const after = await page.evaluate(new Function('return (' + snap.toString() + ')')());

  R.during = during; R.after = after;
  await browser.close();

  const dx = (after.tbRect && before.tbRect) ? +(after.tbRect.x - before.tbRect.x).toFixed(1) : null;
  const dy = (after.tbRect && before.tbRect) ? +(after.tbRect.y - before.tbRect.y).toFixed(1) : null;
  const dw = (after.tbRect && before.tbRect) ? +(after.tbRect.w - before.tbRect.w).toFixed(1) : null;
  const dh = (after.tbRect && before.tbRect) ? +(after.tbRect.h - before.tbRect.h).toFixed(1) : null;
  R.delta = { tbX: dx, tbY: dy, tbW: dw, tbH: dh };
  R.moved = !!(dx || dy || dw || dh);
  R.panActuallyChanged = (after.pan.x !== before.pan.x) || (after.pan.y !== before.pan.y);
  return R.moved ? 'MOVED' : 'DID NOT MOVE';
}

main().then(v => {
  R.verdict = v; writeOut();
  console.log('\ntoolbar verdict: ' + v);
  console.log('pan actually changed: ' + R.panActuallyChanged);
  console.log('delta: ' + JSON.stringify(R.delta));
  console.log('before: ' + JSON.stringify(R.before, null, 1));
  console.log('after : ' + JSON.stringify(R.after, null, 1));
  process.exit(0);
}).catch(e => { R.error = String(e && e.message || e); R.verdict = 'CRASH'; writeOut(); console.error('CRASH ' + R.error); process.exit(3); });
