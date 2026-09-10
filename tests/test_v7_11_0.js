#!/usr/bin/env node
/*
 * test_v7_11_0.js — v7.11.0: C (crop) captures the pixels you were looking at.
 *
 *   A. THE REPORT. "c capture 功能有問題,佢截嘅圖同我真實有啲唔同,當我用了
 *      <Reframe> 呢兩個功能,佢就cap唔到圖出嚟." — after reframe (⇧R), pressing
 *      C and hitting Apply produced an image that was not the region selected.
 *
 *   B. WHAT WAS ACTUALLY WRONG. applyCrop() had its own private capture:
 *
 *          const ratioX = item.natW / item.w;
 *          const sx = Math.round(c.x * ratioX);
 *          ctx2d.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
 *
 *      It cut item.src — the ORIGINAL — using a ratio measured against the
 *      FRAME. Reframe is deliberately NON-DESTRUCTIVE: it is a CSS transform
 *      on the <img> (see the "THE single applier" comment above
 *      applyImageFraming) and item.src still holds the whole picture. So the
 *      two sides of that ratio describe different things, and the crop landed
 *      on the original's top-left corner instead of the region on screen.
 *      Item rotation and flip were ignored for the same reason.
 *
 *      This is 病根① again: v7.9.0 unified cut / lasso / export onto
 *      renderItemRegion() and left this fourth copy of the transform maths
 *      behind.
 *
 *   C. THE FIX. applyCrop() now goes through renderItemRegion() like every
 *      other pixel read, converting its item-local box to screen points with
 *      one new helper (itemLocalToScreen). Because the crop is now baked, the
 *      framing that produced it is reset — v7.8.0's bake-then-reset rule.
 *
 * Sections 3-5 EXECUTE applyCrop() against a stub DOM (the v7.4.0 lesson: an
 * anchor proves the code exists, not that it runs). The expected geometry is
 * re-derived independently in oracle*() — it never calls the implementation's
 * own probe machinery — so a drift in the source cannot rubber-stamp itself.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(
  process.env.KRAFTED_HTML ? path.resolve(process.env.KRAFTED_HTML) : path.join(ROOT, 'kraftpub-dev.html'),
  'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(c, m) { if (c) { pass++; } else { fail++; fails.push(m); console.log('  FAIL: ' + m); } }
function eq(a, b, m) { ok(a === b, m + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function near(a, b, m, tol) {
  const d = Math.abs(a - b);
  ok(d <= (tol === undefined ? 0.01 : tol), m + '  (got ' + a + ', want ' + b + ', diff ' + d.toFixed(4) + ')');
}
function has(needle, m) { ok(HTML.indexOf(needle) >= 0, m + '  (missing: ' + JSON.stringify(needle.slice(0, 90)) + ')'); }
function count(needle, n, m) {
  let c = 0, i = -1;
  while ((i = HTML.indexOf(needle, i + 1)) >= 0) c++;
  eq(c, n, m + '  (found ' + c + ', want ' + n + ')');
}
function hasIn(hay, needle, m) { ok(hay.indexOf(needle) >= 0, m + '  (missing: ' + JSON.stringify(needle.slice(0, 90)) + ')'); }
function lacksIn(hay, needle, m) { ok(hay.indexOf(needle) < 0, m + '  (should be gone: ' + JSON.stringify(needle.slice(0, 90)) + ')'); }
function section(body) {
  try { body(); } catch (e) { fail++; fails.push('section threw: ' + e.message); console.log('  FAIL: section threw: ' + e.message); }
}
function slice(start, end) {
  const i = HTML.indexOf(start), j = HTML.indexOf(end, i < 0 ? 0 : i);
  ok(i >= 0 && j > i, 'slice anchors present: ' + start.slice(0, 50));
  return (i >= 0 && j > i) ? HTML.slice(i, j) : '';
}

// ═══ independent geometry (deliberately NOT the impl) ════════════════════
function rotAbout(p, c, deg) {
  const r = (deg || 0) * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
}
// Where a SOURCE pixel lands on screen, straight from the CSS spec and the
// board transform. Nothing here reads the file's own probe helpers.
//   source px -> img box px   (ox + nx*fx, oy + ny*fy)   [object-fit]
//   -> about the img's own transform-origin O:  O + T(p - O)
//   -> item.el's rotate about the FRAME centre, then translate(item.x/y)
//   -> board: pan + zoom * that
function oracleSourceToScreen(c, nx, ny) {
  const boxW = c.boxW === undefined ? c.w : c.boxW;
  const boxH = c.boxH === undefined ? c.h : c.boxH;
  const O = { x: boxW / 2, y: boxH / 2 };
  let p = { x: (c.ox || 0) + nx * (c.fx === undefined ? 1 : c.fx),
            y: (c.oy || 0) + ny * (c.fy === undefined ? 1 : c.fy) };
  const s = c.s === undefined ? 1 : c.s;
  let q = { x: (p.x - O.x) * s, y: (p.y - O.y) * s };
  q = rotAbout(q, { x: 0, y: 0 }, c.imgRot || 0);
  q = { x: q.x + (c.tx || 0) + O.x + (c.boxL || 0),
        y: q.y + (c.ty || 0) + O.y + (c.boxT || 0) };
  const r = rotAbout(q, { x: c.w / 2, y: c.h / 2 }, c.rot || 0);
  const zoom = c.zoom === undefined ? 1 : c.zoom;
  const panx = c.pan ? c.pan.x : 0, pany = c.pan ? c.pan.y : 0;
  return { x: panx + zoom * (r.x + (c.x || 0)), y: pany + zoom * (r.y + (c.y || 0)) };
}
// Where an ITEM-LOCAL point (the crop box lives here) lands on screen.
function oracleLocalToScreen(c, lx, ly) {
  const r = rotAbout({ x: lx, y: ly }, { x: c.w / 2, y: c.h / 2 }, c.rot || 0);
  const zoom = c.zoom === undefined ? 1 : c.zoom;
  const panx = c.pan ? c.pan.x : 0, pany = c.pan ? c.pan.y : 0;
  return { x: panx + zoom * (r.x + (c.x || 0)), y: pany + zoom * (r.y + (c.y || 0)) };
}
// Affine from three sampled points, with an inverse. Written here, not imported.
function affineFrom(p0, p1, p2, w, h) {
  const m = { a: (p1.x - p0.x) / w, b: (p1.y - p0.y) / w, c: (p2.x - p0.x) / h, d: (p2.y - p0.y) / h, e: p0.x, f: p0.y };
  const det = m.a * m.d - m.b * m.c;
  if (!det || !isFinite(det)) return null;
  m.inv = { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det,
            e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det };
  return m;
}
function appM(m, p) { return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }; }

// ═══ the stub DOM ════════════════════════════════════════════════════════
function makeCanvas() {
  const rec = { width: 0, height: 0, drew: 0, toDataType: null, toDataCalls: 0, clipped: false };
  const ctx = {
    filter: undefined, save() {}, restore() {},
    setTransform() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    clip() { rec.clipped = true; }, stroke() {}, drawImage() { rec.drew++; }
  };
  const cv = {
    _rec: rec,
    get width() { return rec.width; }, set width(v) { rec.width = v; },
    get height() { return rec.height; }, set height(v) { rec.height = v; },
    getContext() { return ctx; },
    toDataURL(t) { rec.toDataType = t || null; rec.toDataCalls++; return 'data:' + (t || 'image/png') + ';base64,AAAA'; }
  };
  return cv;
}

function makeEnv(c) {
  const zoom = c.zoom === undefined ? 1 : c.zoom;
  const pan = c.pan || { x: 0, y: 0 };
  const rot = c.rot || 0;
  const w = c.w || 300, h = c.h || 150;
  const natW = c.natW || 600, natH = c.natH || 300;
  const boxW = c.boxW === undefined ? w : c.boxW;
  const boxH = c.boxH === undefined ? h : c.boxH;
  const centre = { x: w / 2, y: h / 2 };
  const itemTf = affineFrom(rotAbout({ x: 0, y: 0 }, { x: 0, y: 0 }, rot),
    rotAbout({ x: 100, y: 0 }, { x: 0, y: 0 }, rot),
    rotAbout({ x: 0, y: 100 }, { x: 0, y: 0 }, rot), 100, 100);
  const canvases = [];
  const toasts = [];

  function makeNode(tag) {
    const n = { _tag: tag, _kids: [] };
    n.appendChild = function (d) { n._kids.push(d); d._parent = n; return d; };
    n.removeChild = function (d) { const i = n._kids.indexOf(d); if (i >= 0) n._kids.splice(i, 1); d._parent = null; return d; };
    const cls = {};
    n.classList = {
      add() { for (let i = 0; i < arguments.length; i++) cls[arguments[i]] = true; },
      remove() { for (let i = 0; i < arguments.length; i++) cls[arguments[i]] = false; },
      contains(k) { return !!cls[k]; }
    };
    n._cls = cls;
    return n;
  }
  const itemEl = makeNode('item');
  itemEl.offsetWidth = w; itemEl.offsetHeight = h;
  const canvasContent = makeNode('canvas-content');
  const imgEl = {
    tagName: 'IMG', complete: true,
    naturalWidth: natW, naturalHeight: natH,
    offsetLeft: c.boxL || 0, offsetTop: c.boxT || 0,
    offsetWidth: boxW, offsetHeight: boxH,
    _css: '',
    style: { set cssText(v) { imgEl._css = v; }, get cssText() { return imgEl._css; } },
    src: c.src || 'blob:krafted/1'
  };
  itemEl.querySelector = function () { return imgEl; };

  function makeDiv() {
    const d = {
      style: { _css: '', set cssText(v) { this._css = v; }, get cssText() { return this._css; } },
      getBoundingClientRect() {
        const css = d.style._css;
        const left = parseFloat((css.match(/left:\s*(-?[\d.]+)px/) || [])[1] || 0);
        const top = parseFloat((css.match(/top:\s*(-?[\d.]+)px/) || [])[1] || 0);
        const tf = (css.match(/transform:\s*([^;]*)/) || [])[1] || '';
        const local = appM(parseTf(tf), { x: left, y: top });
        if (d._parent === canvasContent) {
          return { left: pan.x + zoom * local.x, top: pan.y + zoom * local.y, width: 0, height: 0 };
        }
        const rel = { x: local.x - centre.x, y: local.y - centre.y };
        const rv = appM(itemTf, rel);
        const world = { x: centre.x + rv.x + (c.x || 0), y: centre.y + rv.y + (c.y || 0) };
        return { left: pan.x + zoom * world.x, top: pan.y + zoom * world.y, width: 0, height: 0 };
      }
    };
    return d;
  }
  const computed = {
    width: boxW + 'px', height: boxH + 'px',
    objectFit: c.fit === undefined ? 'cover' : c.fit,
    objectPosition: c.objPos || '50% 50%',
    transform: c.imgTransform || 'none',
    transformOrigin: (boxW / 2) + 'px ' + (boxH / 2) + 'px'
  };
  const item = {
    id: 1, el: itemEl, img: imgEl, natW: natW, natH: natH,
    x: c.x || 0, y: c.y || 0, w: w, h: h, rot: rot, flipH: false, flipV: false,
    src: c.src || 'blob:krafted/1', filename: 'shot.png',
    frameOn: !!c.frameOn, frameZ: c.frameZ, frameRot: c.frameRot,
    frameX: c.frameX, frameY: c.frameY,
    cropX: c.cropX || 0, cropY: c.cropY || 0
  };
  return {
    item: item, itemEl: itemEl, canvasContent: canvasContent, imgEl: imgEl,
    canvases: canvases, toasts: toasts,
    document: {
      createElement(t) {
        if (t === 'div') return makeDiv();
        if (t === 'canvas') { const cv = makeCanvas(); canvases.push(cv); return cv; }
        return null;
      }
    },
    getComputedStyle: function () { return computed; }
  };
}
// Minimal transform parser: translate / rotate / scale, applied left-to-right
// as CSS does (rightmost first).
function parseTf(str) {
  let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const fns = String(str || '').match(/[a-zA-Z0-9]+\([^)]*\)/g) || [];
  for (const fn of fns) {
    const name = fn.slice(0, fn.indexOf('(')).toLowerCase();
    const a = fn.slice(fn.indexOf('(') + 1, -1).split(',').map(s => parseFloat(s.trim()));
    let t = null;
    if (name === 'translate' || name === 'translate3d') t = { a: 1, b: 0, c: 0, d: 1, e: a[0] || 0, f: a[1] || 0 };
    else if (name === 'rotate') { const r = (a[0] || 0) * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r); t = { a: cs, b: sn, c: -sn, d: cs, e: 0, f: 0 }; }
    else if (name === 'scale') { const sx = isNaN(a[0]) ? 1 : a[0]; const sy = (a.length > 1 && !isNaN(a[1])) ? a[1] : sx; t = { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }; }
    else if (name === 'matrix' && a.length >= 6) t = { a: a[0], b: a[1], c: a[2], d: a[3], e: a[4], f: a[5] };
    if (t) m = mulM(m, t);
  }
  return m;
}
function mulM(A, B) { // A(B(p)) — CSS applies the RIGHTMOST function first
  return { a: A.a * B.a + A.c * B.b, b: A.b * B.a + A.d * B.b,
           c: A.a * B.c + A.c * B.d, d: A.b * B.c + A.d * B.d,
           e: A.a * B.e + A.c * B.f + A.e, f: A.b * B.e + A.d * B.f + A.f };
}

// ═══ the code under test ═════════════════════════════════════════════════
const CORE = slice('var GEO_PROBE_UNIT = 100;', 'async function extractPolyFromItem(item, screenPts, opts) {');
const FRAMING = slice('function itemHasFraming(item) {', 'function rfGuideFractions(kind) {');
const RFSET = slice('function rfSetFrameFields(it, f) {', 'function enterReframe(');
const CROP = slice('function applyCrop() {', '// ==== export.js ====');

const NAMES = ['itemLocalToScreen', 'renderItemRegion', 'applyCrop', 'clearFramingStyles'];

function build(env, cropBox, o) {
  o = o || {};
  const args = ['document', 'getComputedStyle', 'canvasContent', 'state', 'toast',
    'updateItemStyle', 'refreshSelection', 'scheduleAutoSave',
    'console', 'framingResolve', 'framingBounds', 'framingBaseScale', '_isZhUI'];
  const calls = { updateItemStyle: 0, refreshSelection: 0, scheduleAutoSave: 0 };
  const state = { cropping: cropBox ? {
    item: env.item, x: cropBox.x, y: cropBox.y, w: cropBox.w, h: cropBox.h,
    els: { overlay: { parentNode: null }, toolbar: { parentNode: null } }
  } : null };
  const vals = [
    env.document, env.getComputedStyle, env.canvasContent, state,
    function (m) { env.toasts.push(m); },
    function (it) { calls.updateItemStyle++; it._styled = true; },
    function () { calls.refreshSelection++; },
    function () { calls.scheduleAutoSave++; },
    { error() {}, log() {} },
    // framingBounds/framingBaseScale are only reached if the crop forgets to
    // zero cropX/cropY: migrateLegacyCrop() then reads them and re-frames the
    // item. Real enough values make that path actually run, so the negative
    // assertion in §4 can fail.
    function () { return { w: 300, h: 150, natW: 600, natH: 300 }; },
    function () { return 0.5; },
    function () { return null; },
    function () { return false; }
  ];
  const body = CORE + '\n' + FRAMING + '\n' + RFSET + '\n' + CROP + '\nreturn {'
    + NAMES.map(function (n) { return n + ': typeof ' + n + ' === "function" ? ' + n + ' : null'; }).join(', ')
    + ', _state: state, _calls: null };';
  const fn = new Function(args, body).apply(null, vals);
  fn._calls = calls;
  fn._state = state;
  return fn;
}

// ═══ 1. the wiring ═══════════════════════════════════════════════════════
section(function () {
  ok(CORE.length > 2000, 'the geometry core is present');
  ok(CROP.length > 800, 'the crop section is present');
  count('function renderItemRegion(', 1, 'still exactly one region renderer — crop did not add a second');
  count('function itemLocalToScreen(', 1, 'exactly one item-local -> screen mapper');
  has('function itemLocalToScreen(item) {', 'the new helper exists');
  // THE bug: applyCrop must no longer carry its own capture.
  hasIn(CROP, 'renderItemRegion(item, screenPts, {', 'applyCrop reads pixels through the shared renderer');
  lacksIn(CROP, 'new Image()', 'applyCrop no longer re-loads the original into a private <img>');
  lacksIn(CROP, 'item.natW / item.w', 'the wrong natW/item.w ratio is gone from applyCrop');
  lacksIn(CROP, 'ctx2d', 'the private 2d capture is gone from applyCrop');
  // THE bake rule: a baked crop must reset the framing that produced it.
  hasIn(CROP, 'rfSetFrameFields(item, { on: false, z: 1, rot: 0, x: 0, y: 0 });',
    'applyCrop resets framing after baking, through the single writer');
  hasIn(CROP, 'item.cropX = 0; item.cropY = 0;', 'cropX/cropY are zeroed so migrateLegacyCrop cannot re-frame');
});

// ═══ 2. itemLocalToScreen matches an independent oracle ═══════════════════
section(function () {
  [{ rot: 0, zoom: 1 }, { rot: 30, zoom: 1 }, { rot: -17, zoom: 2.5, pan: { x: 40, y: -12 } }]
    .forEach(function (cfg) {
      const c = Object.assign({ w: 300, h: 150, natW: 600, natH: 300 }, cfg);
      const env = makeEnv(c);
      const api = build(env, null);
      const m = api.itemLocalToScreen(env.item);
      ok(!!m, 'itemLocalToScreen returns a mapper for rot=' + c.rot + ' zoom=' + c.zoom);
      [[0, 0], [150, 75], [300, 150], [37, 111]].forEach(function (p) {
        const got = appM(m, { x: p[0], y: p[1] });
        const want = oracleLocalToScreen(c, p[0], p[1]);
        near(got.x, want.x, 'local(' + p + ') -> screen.x  rot=' + c.rot + ' zoom=' + c.zoom, 0.001);
        near(got.y, want.y, 'local(' + p + ') -> screen.y  rot=' + c.rot + ' zoom=' + c.zoom, 0.001);
      });
    });
});

// ═══ 3. a plain crop is unchanged (no regression) ════════════════════════
section(function () {
  const c = { w: 300, h: 150, natW: 600, natH: 300, fx: 0.5, fy: 0.5, ox: 0, oy: 0 };
  const env = makeEnv(c);
  const api = build(env, { x: 0, y: 0, w: 150, h: 75 });
  api.applyCrop();
  // v7.10.1 gave sw = round(150 * 600/300) = 300, sh = round(75 * 300/150) = 150.
  near(env.item.natW, 300, 'plain crop: output width is the v7.13.0 number (unchanged)', 1);
  near(env.item.natH, 150, 'plain crop: output height is the v7.13.0 number (unchanged)', 1);
  // Round trip: the four corners of the captured pixels are the four corners
  // of the box the user drew.
  const s0 = oracleSourceToScreen(c, 0, 0);
  const s2 = oracleSourceToScreen(c, env.item.natW, env.item.natH);
  near(s0.x, 0, 'plain crop: captured source (0,0) sits on the box top-left (x)', 0.5);
  near(s0.y, 0, 'plain crop: captured source (0,0) sits on the box top-left (y)', 0.5);
  near(s2.x, 150, 'plain crop: captured source far corner sits on the box bottom-right (x)', 0.5);
  near(s2.y, 75, 'plain crop: captured source far corner sits on the box bottom-right (y)', 0.5);
  eq(env.item.src.slice(0, 11), 'data:image/', 'the new src is a data URL');
  ok(env.canvases.length >= 1, 'a canvas was actually produced');
  eq(env.canvases[0]._rec.toDataCalls, 1, 'the canvas was serialised exactly once');
  eq(env.canvases[0]._rec.toDataType, 'image/png', 'a non-data src falls back to PNG');
});

// ═══ 4. THE COMPLAINT: crop after reframe ═════════════════════════════════
section(function () {
  // Reframe: the <img> is laid out at NATURAL size and the framing lives in a
  // CSS transform. Here: zoomed 2x, panned 100px left. item.src is untouched.
  const c = { w: 300, h: 150, natW: 600, natH: 300,
    boxW: 600, boxH: 300, fit: '',
    imgTransform: 'translate(-100px,0px) scale(2)',
    s: 2, tx: -100, ty: 0, fx: 1, fy: 1, ox: 0, oy: 0,
    frameOn: true, frameZ: 2, frameRot: 0, frameX: -50, frameY: 0,
    // A legacy pan left over from a pre-v7.0.49 board. Harmless while
    // frameOn is true — but the moment the crop clears frameOn,
    // migrateLegacyCrop() would read it and frame the item AGAIN unless the
    // crop zeroes it first. Pinned here because it is invisible by eye.
    cropX: 120, cropY: 0 };
  const env = makeEnv(c);
  const api = build(env, { x: 0, y: 0, w: 150, h: 75 });
  api.applyCrop();

  // What the OLD maths would have produced — the bug, pinned in the negative.
  // ratioX = natW/w = 2, so it cut source (0,0,300,150).
  const oldW = Math.round(150 * 600 / 300), oldH = Math.round(75 * 300 / 150);
  ok(Math.abs(env.item.natW - oldW) > 20,
    'reframed crop is NOT the old top-left-corner rectangle (old would be ' + oldW + 'x' + oldH + ', got ' + env.item.natW + 'x' + env.item.natH + ')');

  // Round trip: the captured pixels span EXACTLY the box the user drew. (They
  // do not START at source (0,0) — that is the whole point of the pan.)
  const s0 = oracleSourceToScreen(c, 0, 0);
  const s2 = oracleSourceToScreen(c, env.item.natW, env.item.natH);
  near(s2.x - s0.x, 150, 'reframed crop: captured pixels span the drawn box (x)', 1);
  near(s2.y - s0.y, 75, 'reframed crop: captured pixels span the drawn box (y)', 1);
  // And they start where the box started: invert the oracle at the box corner.
  const A = affineFrom(oracleSourceToScreen(c, 0, 0), oracleSourceToScreen(c, 600, 0),
    oracleSourceToScreen(c, 0, 300), 600, 300);
  const want0 = appM(A.inv, oracleLocalToScreen(c, 0, 0));
  const want2 = appM(A.inv, oracleLocalToScreen(c, 150, 75));
  near(want0.x, 200, 'the box top-left is source x=200 in this framing (independent oracle)', 1);
  near(want0.y, 75, 'the box top-left is source y=75 in this framing (independent oracle)', 1);
  near(env.item.natW, want2.x - want0.x, 'reframed crop: width equals the predicted source span', 1);
  near(env.item.natH, want2.y - want0.y, 'reframed crop: height equals the predicted source span', 1);
  // Concretely: 150 screen px of a 2x image is 75 source px, not 300.
  near(env.item.natW, 75, 'reframed crop: 150 screen px at 2x = 75 source px wide', 1);
  near(env.item.natH, 37.5, 'reframed crop: 75 screen px at 2x = 37.5 source px tall', 1);

  // THE BAKE RULE: the framing that produced the crop must be reset.
  eq(env.item.frameOn, false, 'framing is off after the crop was baked');
  eq(env.item.frameZ, 1, 'frameZ reset');
  eq(env.item.frameRot, 0, 'frameRot reset');
  eq(env.item.frameX, 0, 'frameX reset');
  eq(env.item.frameY, 0, 'frameY reset');
  hasIn(env.imgEl._css, 'object-fit:cover', 'the <img> went back to the base css (cover restored, not blanked)');
  ok(env.imgEl._css.indexOf('transform') < 0, 'the reframe transform is gone from the <img>');
  eq(env.item.cropX, 0, 'cropX zeroed');
  eq(env.item.cropY, 0, 'cropY zeroed');
  ok(env.imgEl.src === env.item.src, 'the live <img> was pointed at the new pixels');
  ok(env.itemEl._cls['framed'] === false, 'the .framed class was removed');
  eq(api._calls.updateItemStyle, 1, 'updateItemStyle ran once (it re-applies the colour filter)');
  ok(api._state.cropping === null, 'the crop UI state was torn down');
});

// ═══ 4b. the box position is used, not assumed to be the origin ═══════════
// Every fixture so far starts its box at (0,0), which is exactly the value a
// broken "pin the corner to the item origin" would produce. This one does not.
section(function () {
  const c = { w: 300, h: 150, natW: 600, natH: 300,
    boxW: 600, boxH: 300, fit: '',
    imgTransform: 'translate(-100px,0px) scale(2)',
    s: 2, tx: -100, ty: 0, fx: 1, fy: 1, ox: 0, oy: 0,
    frameOn: true, frameZ: 2, frameRot: 0, frameX: -50, frameY: 0 };
  const env = makeEnv(c);
  const api = build(env, { x: 60, y: 30, w: 150, h: 75 });
  api.applyCrop();
  const A = affineFrom(oracleSourceToScreen(c, 0, 0), oracleSourceToScreen(c, 600, 0),
    oracleSourceToScreen(c, 0, 300), 600, 300);
  const want0 = appM(A.inv, oracleLocalToScreen(c, 60, 30));
  const want2 = appM(A.inv, oracleLocalToScreen(c, 210, 105));
  near(want0.x, 230, 'offset box: predicted source origin x (independent oracle)', 1);
  near(want0.y, 90, 'offset box: predicted source origin y (independent oracle)', 1);
  near(env.item.natW, want2.x - want0.x, 'offset box: width equals the predicted source span', 1);
  near(env.item.natH, want2.y - want0.y, 'offset box: height equals the predicted source span', 1);
  near(env.item.natW, 75, 'offset box: still 150 screen px at 2x = 75 source px', 1);
});

// ═══ 5. rotation is baked too (the ratio ignored it entirely) ═════════════
section(function () {
  const c = { w: 300, h: 150, natW: 600, natH: 300, rot: 30, fx: 0.5, fy: 0.5, ox: 0, oy: 0 };
  const env = makeEnv(c);
  const api = build(env, { x: 0, y: 0, w: 150, h: 75 });
  api.applyCrop();
  // The box is axis-aligned in ITEM space, so on screen it is a rotated
  // rectangle; the capture is its axis-aligned bounding box.
  const r = 30 * Math.PI / 180;
  const wantW = Math.round((150 * Math.abs(Math.cos(r)) + 75 * Math.abs(Math.sin(r))) * 2);
  const wantH = Math.round((150 * Math.abs(Math.sin(r)) + 75 * Math.abs(Math.cos(r))) * 2);
  near(env.item.natW, wantW, 'rotated crop: capture is the screen bounding box, wide', 2);
  near(env.item.natH, wantH, 'rotated crop: capture is the screen bounding box, tall', 2);
  ok(Math.abs(env.item.natW - 300) > 10,
    'rotated crop is not the old axis-aligned 300px (old ignored rotation, got ' + env.item.natW + ')');
});

// ═══ 6. the unhappy paths ════════════════════════════════════════════════
section(function () {
  // No crop in progress -> no-op, no toast storm.
  const env = makeEnv({});
  const api = build(env, null);
  api.applyCrop();
  eq(env.toasts.length, 0, 'applyCrop with nothing in progress does nothing');

  // A too-small box is refused before any canvas is made.
  const env2 = makeEnv({});
  const api2 = build(env2, { x: 0, y: 0, w: 1, h: 1 });
  api2.applyCrop();
  ok(env2.toasts.some(t => /too small/i.test(t)), 'a tiny crop box is refused: ' + JSON.stringify(env2.toasts));
  eq(env2.canvases.length, 0, 'no canvas is produced for a tiny crop');
});

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + '  ' + pass + ' passed, ' + fail + ' failed');
if (fail) { fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
