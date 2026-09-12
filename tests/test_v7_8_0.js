#!/usr/bin/env node
/*
 * test_v7_8_0.js — v7.8.0: cut / lasso read the pixels they were actually
 * drawn on, and both gain Knock out.
 *
 *   A. THE BUG. extractPolyFromItem measured the source with
 *          const r = item.el.getBoundingClientRect();
 *          const kx = natW / r.width;
 *      getBoundingClientRect() returns the AXIS-ALIGNED box of a rotated
 *      element, so for a rotated source it read the size of the box AROUND
 *      the image instead of the image. Every cut from a rotated item was
 *      offset and mis-scaled, and because the extracted copy used to inherit
 *      the rotation, a second cut read an already-rotated image through a
 *      second rotation — the error compounded on every pass.
 *
 *   B. THE FIX. One mapper, itemPixelGeometry(), measures the real affine by
 *      probing the live DOM (so the browser composes zoom, pan, item
 *      rotate/flip, reframe's transform on the inner <img> and object-fit).
 *      The crop is now axis-aligned in SCREEN space — what you see is what
 *      you get — and the result is baked upright: rot = 0, no flip.
 *
 *   C. KNOCK OUT. The same shape can punch a transparent hole out of the
 *      item's own pixels. Natural size is unchanged on purpose, so reframe
 *      framing and the item box stay valid.
 *
 * Sections 2-5 EXECUTE the sliced functions against a stub DOM whose
 * getBoundingClientRect() composes CSS transforms from first principles
 * (rightmost transform applied first, transform-origin 0 + T(p - O)). An
 * anchor alone proves the code exists, not that it runs (the v7.4.0 lesson).
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
function section(body) {
  try { body(); } catch (e) { fail++; fails.push('section threw: ' + e.message); console.log('  FAIL: section threw: ' + e.message); }
}
const asyncs = [];
function asection(body) {
  asyncs.push(Promise.resolve().then(body).catch(e => {
    fail++; const m = 'async section threw: ' + e.message;
    fails.push(m); console.log('  FAIL: ' + m);
  }));
}
function slice(start, end) {
  const i = HTML.indexOf(start), j = HTML.indexOf(end, i < 0 ? 0 : i);
  ok(i >= 0 && j > i, 'slice anchors present: ' + start.slice(0, 50));
  return (i >= 0 && j > i) ? HTML.slice(i, j) : '';
}

// ═══ independent geometry primitives (deliberately NOT the impl) ══════════
// Written from the CSS spec / plain trigonometry so a bug in the code under
// test cannot be mirrored by the oracle.
function rotAbout(p, c, deg) {
  const r = (deg || 0) * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
}
function mul(A, B) { // A(B(p)) — CSS applies the RIGHTMOST function first
  return [
    A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]
  ];
}
const IDENT = [1, 0, 0, 1, 0, 0];
function parseTransform(str) {
  let m = IDENT;
  const fns = String(str || '').match(/[a-zA-Z0-9]+\([^)]*\)/g) || [];
  for (const fn of fns) {
    const name = fn.slice(0, fn.indexOf('(')).toLowerCase();
    const a = fn.slice(fn.indexOf('(') + 1, -1).split(',').map(s => parseFloat(s.trim()));
    let t = null;
    if (name === 'translate' || name === 'translate3d') t = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (name === 'translatex') t = [1, 0, 0, 1, a[0] || 0, 0];
    else if (name === 'translatey') t = [1, 0, 0, 1, 0, a[0] || 0];
    else if (name === 'rotate') {
      const r = (a[0] || 0) * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
      t = [cs, sn, -sn, cs, 0, 0];
    } else if (name === 'scale') {
      const sx = (a[0] === undefined || isNaN(a[0])) ? 1 : a[0];
      const sy = (a.length > 1 && !isNaN(a[1])) ? a[1] : sx;
      t = [sx, 0, 0, sy, 0, 0];
    } else if (name === 'matrix' && a.length >= 6) t = a.slice(0, 6);
    if (t) m = mul(m, t);
  }
  return m;
}
function applyM(m, p) { return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }; }

// ═══ the stub DOM ════════════════════════════════════════════════════════
// Mirrors exactly what the browser does for the three layers that matter:
//   #canvas          transform translate(pan + OFF - OFF*zoom) scale(zoom), origin 0 0
//   #canvas-content  left/top 50000  (cancels the 50000 above)
//   .item            translate3d(x,y) rotate(rot) scale(flip), origin = its centre
function makeEnv(c) {
  const zoom = (c.zoom === undefined) ? 1 : c.zoom;
  const pan = c.pan || { x: 0, y: 0 };
  const rot = c.rot || 0, w = c.w, h = c.h, x = c.x || 0, y = c.y || 0;
  const flipH = !!c.flipH, flipV = !!c.flipV;
  const boxW = (c.boxW === undefined) ? w : c.boxW;
  const boxH = (c.boxH === undefined) ? h : c.boxH;
  const fit = (c.fit === undefined) ? 'cover' : c.fit;
  const imgTf = c.imgTransform || 'none';

  function worldToScreen(wx, wy) { return { x: pan.x + zoom * wx, y: pan.y + zoom * wy }; }
  const itemTf = parseTransform('translate(' + x + ',' + y + ') rotate(' + rot + ') scale('
    + (flipH ? -1 : 1) + ',' + (flipV ? -1 : 1) + ')');
  const centre = { x: w / 2, y: h / 2 };

  function makeNode(tag) {
    const n = { _tag: tag, _kids: [] };
    n.appendChild = function (d) { n._kids.push(d); d._parent = n; return d; };
    n.removeChild = function (d) {
      const i = n._kids.indexOf(d); if (i >= 0) n._kids.splice(i, 1);
      d._parent = null; return d;
    };
    return n;
  }
  const itemEl = makeNode('item');
  const canvasContent = makeNode('canvas-content');
  const imgEl = {
    tagName: 'IMG', complete: true,
    naturalWidth: c.natW, naturalHeight: c.natH,
    offsetLeft: (c.imgLeft === undefined) ? 0 : c.imgLeft,
    offsetTop: (c.imgTop === undefined) ? 0 : c.imgTop,
    offsetWidth: boxW, offsetHeight: boxH,
    style: {}
  };
  itemEl.querySelector = function () { return imgEl; };

  let probes = 0;
  function makeDiv() {
    const d = {
      style: { _css: '', set cssText(v) { this._css = v; }, get cssText() { return this._css; } },
      getBoundingClientRect() {
        const css = d.style._css;
        const left = parseFloat((css.match(/left:\s*(-?[\d.]+)px/) || [])[1] || 0);
        const top = parseFloat((css.match(/top:\s*(-?[\d.]+)px/) || [])[1] || 0);
        const tf = (css.match(/transform:\s*([^;]*)/) || [])[1] || '';
        // transform-origin is 0 0 on every probe the impl creates, and the
        // probe is zero-sized, so its rect IS the transformed origin point.
        const local = applyM(parseTransform(tf), { x: left, y: top });
        if (d._parent === canvasContent) {
          const s = worldToScreen(local.x, local.y);
          return { left: s.x, top: s.y, width: 0, height: 0 };
        }
        const v = applyM(itemTf, { x: local.x - centre.x, y: local.y - centre.y });
        const world = { x: centre.x + v.x, y: centre.y + v.y };
        const s = worldToScreen(world.x, world.y);
        return { left: s.x, top: s.y, width: 0, height: 0 };
      }
    };
    return d;
  }
  const computed = {
    width: boxW + 'px', height: boxH + 'px',
    objectFit: fit, objectPosition: c.objPos || '50% 50%',
    transform: imgTf,
    transformOrigin: c.imgOrigin || ((boxW / 2) + 'px ' + (boxH / 2) + 'px')
  };
  const item = {
    id: 7, el: itemEl, img: imgEl, natW: c.natW, natH: c.natH,
    x: x, y: y, w: w, h: h, rot: rot, flipH: flipH, flipV: flipV,
    src: 'blob:original', _sourceBlob: null, filename: 'ref.png'
  };
  return {
    item: item, itemEl: itemEl, canvasContent: canvasContent, imgEl: imgEl,
    document: { createElement: function (t) { if (t === 'div') { probes++; return makeDiv(); } return null; } },
    getComputedStyle: function () { return computed; },
    probeCount: function () { return probes; },
    worldToScreen: worldToScreen
  };
}

// ═══ 1. the wiring is present ═════════════════════════════════════════════
section(function () {
  has('function itemPixelGeometry(item) {', 'the shared mapper exists');
  // Neither consumer may measure the element itself: getBoundingClientRect()
  // on a rotated element returns the axis-aligned box AROUND the image, which
  // is exactly where the bug came from. (Counts include this comment's text.)
  count('itemPixelGeometry(item)', 3, 'one definition + exactly two consumers, no third copy');
  has("  newItem.rot = 0;", 'the extracted copy is baked UPRIGHT (rot cleared)');
  has("  newItem.flipH = false;", 'flip is baked into the pixels too');
  has("  newItem.flipV = false;", 'vertical flip is baked into the pixels too');
  has("async function knockOutPolyFromItem(item, screenPts) {", 'knock out exists');
  has("ctx.globalCompositeOperation = 'destination-out';", 'knock out SUBTRACTS alpha, it does not paint over');
  // Two-line anchor on purpose. `  item._sourceBlob = blob;` on its own is a
  // SUBSTRING of the 12-space legacy JSZip line, so a one-line has() would stay
  // green even if the knock-out line were deleted outright.
  has("  item._sourceBlob = blob;\n  item._fileSize = blob.size;", 'knock out hands the new pixels to KPAK save and records their size');
  has("  scheduleAutoSave();", 'knock out persists');
  // UI: both tools, one helper each, no per-site display poking.
  has('id="cut-knock-btn" onclick="applyCutKnockOut()"', 'the cut panel has a Knock out button');
  has('id="lasso-knock-btn" onclick="applyLassoKnockOut()"', 'the lasso panel has a Knock out button');
  has('function setCutActions(show) {', 'one helper drives the cut action buttons');
  has('function setLassoActions(show) {', 'one helper drives the lasso action buttons');
  count('cutExtractBtn.style.display =', 1, 'cut display poking lives in exactly one place (the helper)');
  count('lassoExtractBtn.style.display =', 1, 'lasso display poking lives in exactly one place (the helper)');
  has('  cutKnockBtn.style.display = v;', 'the helper drives the cut Knock out button too');
  has('  lassoKnockBtn.style.display = v;', 'the helper drives the lasso Knock out button too');
  has("'Knock out': '挖空',", "Knock out is translated");
  // Provenance comments in this file must not be mutated by a version bump.
  ok(HTML.indexOf('// v7.16.0:') > 0, 'v7.16.0 provenance comments are present');
});

// ═══ 2. itemPixelGeometry, executed against the stub DOM ══════════════════
const GEO_BLOCK = slice('var GEO_PROBE_UNIT = 100;', 'async function extractPolyFromItem(item, screenPts, opts) {');
function buildGeo(env) {
  return new Function('document', 'getComputedStyle', 'canvasContent',
    GEO_BLOCK + '\nreturn { itemPixelGeometry: itemPixelGeometry, _geoApply: _geoApply };'
  )(env.document, env.getComputedStyle, env.canvasContent);
}
// Independent expectation for an EXACT-FIT cover source (nat aspect == item
// aspect): source pixel (nx,ny) sits at item-local (nx*w/natW, ny*h/natH).
function expectedScreen(c, nx, ny) {
  const p = { x: (c.x || 0) + nx * c.w / c.natW, y: (c.y || 0) + ny * c.h / c.natH };
  const q = rotAbout(p, { x: (c.x || 0) + c.w / 2, y: (c.y || 0) + c.h / 2 }, c.rot || 0);
  const z = (c.zoom === undefined) ? 1 : c.zoom;
  const pan = c.pan || { x: 0, y: 0 };
  return { x: pan.x + z * q.x, y: pan.y + z * q.y };
}

section(function () {
  // v7.11.0: the upper bound moved 9000 -> 12000. It is a tripwire against
  // unrelated code being swept into the mapper, not a budget; v7.11.0 added
  // itemLocalToScreen() (crop's item-local -> screen mapper) to this block on
  // purpose, because it is the same probe machinery and must drift with it.
  ok(GEO_BLOCK.length > 1500 && GEO_BLOCK.length < 12000, 'the mapper block is present and bounded');

  // ── the case that was broken: a ROTATED source ──
  let c = { x: 100, y: 200, w: 300, h: 150, rot: 30, natW: 600, natH: 300 };
  let env = makeEnv(c), geo = buildGeo(env);
  let g = geo.itemPixelGeometry(env.item);
  ok(!!g, 'the mapper returns geometry for a rotated item');
  let p00 = geo._geoApply(g.nat, 0, 0), e00 = expectedScreen(c, 0, 0);
  near(p00.x, e00.x, 'v7.16.0: source pixel (0,0) lands on the rotated item’s top-left corner (x)', 0.02);
  near(p00.y, e00.y, 'source pixel (0,0) lands on the rotated item’s top-left corner (y)', 0.02);
  let p11 = geo._geoApply(g.nat, 600, 300), e11 = expectedScreen(c, 600, 300);
  near(p11.x, e11.x, 'source pixel (natW,natH) lands on the rotated item’s bottom-right corner (x)', 0.02);
  near(p11.y, e11.y, 'source pixel (natW,natH) lands on the rotated item’s bottom-right corner (y)', 0.02);
  // Prove it is NOT the axis-aligned box: at 30deg the AABB is much wider than
  // the image, so the old kx would have put (0,0) somewhere else entirely.
  let aabbW = 300 * Math.cos(30 * Math.PI / 180) + 150 * Math.sin(30 * Math.PI / 180);
  ok(Math.abs(aabbW - 300) > 30, 'the 30deg AABB really is wider than the item (' + aabbW.toFixed(1) + ' vs 300)');
  near(p00.x, 100 + 300 / 2 + (rotAbout({ x: 100, y: 200 }, { x: 250, y: 275 }, 30).x - 250), 'corner is the ROTATED corner, not the AABB corner (x)', 0.02);

  // ── rot = 0 must stay exactly right (no regression for the common case) ──
  c = { x: 100, y: 200, w: 300, h: 150, rot: 0, natW: 600, natH: 300 };
  env = makeEnv(c); geo = buildGeo(env); g = geo.itemPixelGeometry(env.item);
  p00 = geo._geoApply(g.nat, 0, 0);
  near(p00.x, 100, 'an upright source still maps (0,0) to the item origin (x)');
  near(p00.y, 200, 'an upright source still maps (0,0) to the item origin (y)');
  p11 = geo._geoApply(g.nat, 600, 300);
  near(p11.x, 400, 'an upright source maps (natW,natH) to the far corner (x)');
  near(p11.y, 350, 'an upright source maps (natW,natH) to the far corner (y)');

  // ── round trip: screen -> source -> screen at any rotation ──
  c = { x: 40, y: -60, w: 321, h: 187, rot: 37, natW: 900, natH: 524 };
  env = makeEnv(c); geo = buildGeo(env); g = geo.itemPixelGeometry(env.item);
  [[0, 0], [900, 0], [0, 524], [450, 262], [123, 456]].forEach(function (n) {
    const s = geo._geoApply(g.nat, n[0], n[1]);
    const back = geo._geoApply(g.nat.inv, s.x, s.y);
    near(back.x, n[0], 'round trip recovers source x for (' + n + ') at 37deg', 0.01);
    near(back.y, n[1], 'round trip recovers source y for (' + n + ') at 37deg', 0.01);
  });

  // ── flip: a mirrored image reads the mirrored pixels ──
  c = { x: 100, y: 200, w: 300, h: 150, rot: 0, flipH: true, natW: 600, natH: 300 };
  env = makeEnv(c); geo = buildGeo(env); g = geo.itemPixelGeometry(env.item);
  p00 = geo._geoApply(g.nat, 0, 0);
  near(p00.x, 400, 'flipH: source (0,0) appears at the TOP-RIGHT, not the top-left');
  near(p00.y, 200, 'flipH: source (0,0) stays on the top edge');
  p11 = geo._geoApply(g.nat, 600, 0);
  near(p11.x, 100, 'flipH: source (natW,0) appears at the top-left');

  // ── zoom + pan ride along, they are not re-derived ──
  c = { x: 100, y: 200, w: 300, h: 150, rot: 0, natW: 600, natH: 300, zoom: 2.5, pan: { x: 30, y: -10 } };
  env = makeEnv(c); geo = buildGeo(env); g = geo.itemPixelGeometry(env.item);
  p00 = geo._geoApply(g.nat, 0, 0);
  near(p00.x, 30 + 2.5 * 100, 'zoom+pan: source (0,0) is pan + zoom*world (x)');
  near(p00.y, -10 + 2.5 * 200, 'zoom+pan: source (0,0) is pan + zoom*world (y)');

  // ── object-fit:cover crops, so the source is TALLER than the frame ──
  // item 300x150 (2:1) showing a 400x400 (1:1) image: cover scales by 0.75 and
  // pushes 75px of the image off the top and bottom of the frame.
  c = { x: 100, y: 200, w: 300, h: 150, rot: 0, natW: 400, natH: 400 };
  env = makeEnv(c); geo = buildGeo(env); g = geo.itemPixelGeometry(env.item);
  p00 = geo._geoApply(g.nat, 0, 0);
  near(p00.x, 100, 'cover: the cropped source still starts at the left edge (x)');
  near(p00.y, 200 - 75, 'cover: 75px of the source sits ABOVE the frame (y)');
  const mid = geo._geoApply(g.nat, 200, 200);
  near(mid.x, 250, 'cover: the source centre is the frame centre (x)');
  near(mid.y, 275, 'cover: the source centre is the frame centre (y)');

  // ── reframe: the inner <img> carries its own translate/rotate/scale ──
  // Box is the natural size, object-fit cleared, transform translate(13,-7)
  // about the image centre (which IS the frame centre).
  c = {
    x: 0, y: 0, w: 300, h: 150, rot: 0, natW: 600, natH: 300,
    boxW: 600, boxH: 300, fit: 'fill',
    imgLeft: 150 - 300, imgTop: 75 - 150,
    imgTransform: 'translate(13px, -7px) rotate(0deg) scale(1)',
    imgOrigin: '300px 150px'
  };
  env = makeEnv(c); geo = buildGeo(env); g = geo.itemPixelGeometry(env.item);
  const rmid = geo._geoApply(g.nat, 300, 150);
  near(rmid.x, 150 + 13, 'reframe: the source centre follows the reframe pan (x)');
  near(rmid.y, 75 - 7, 'reframe: the source centre follows the reframe pan (y)');

  // ── the world mapping is measured too, not recomputed from pan/zoom ──
  c = { x: 0, y: 0, w: 10, h: 10, rot: 0, natW: 10, natH: 10, zoom: 3, pan: { x: 17, y: -4 } };
  env = makeEnv(c); geo = buildGeo(env); g = geo.itemPixelGeometry(env.item);
  const w0 = geo._geoApply(g.world, 0, 0);
  near(w0.x, 17, 'world (0,0) is measured as the pan origin (x)');
  near(w0.y, -4, 'world (0,0) is measured as the pan origin (y)');
  const w1 = geo._geoApply(g.world, 10, 0);
  near(w1.x, 17 + 30, 'world (10,0) is scaled by the zoom, not hardcoded (x)');
});

// ═══ 3. extractPolyFromItem, executed ═════════════════════════════════════
// v7.9.0: the renderer (renderItemRegion) and the item-maker
// (extractPolyFromItem) are now two functions, and export reads the same
// renderer. Slice BOTH so a second, private renderer cannot grow next to them.
const EXTRACT_BLOCK = slice('function renderItemRegion(item, screenPts, opts) {',
  "// Punch the drawn shape out of the item's OWN pixels");
asection(async function () {
  ok(EXTRACT_BLOCK.length > 2500, 'the extract block is present');
  // The whole point: NOTHING in the extract measures the element box any
  // more. getBoundingClientRect() on a rotated element returns the
  // axis-aligned box AROUND the image, which is where the bug came from.
  // v7.11.0: the needle is a METHOD CALL, not any mention of the name.
  // v7.11.0's itemLocalToScreen() documents why it does NOT use
  // getBoundingClientRect(), and a bare-substring gate cannot tell an
  // explanation from a measurement — it went red on its own comment. The
  // reverse assertion right after keeps the narrower needle honest: a gate
  // that matches nothing at all is worse than no gate.
  ok(EXTRACT_BLOCK.indexOf('.getBoundingClientRect(') < 0,
    'the extract never measures the element box itself (the AABB bug cannot come back)');
  ok(EXTRACT_BLOCK.indexOf('itemPixelGeometry(item)') >= 0,
    '...and the block really is the extract, so that needle is not vacuous');
  // One renderer for cut, lasso and export. A second copy of this maths is
  // the oldest root cause on the project, so pin the call instead of trusting
  // that nobody adds one.
  ok(EXTRACT_BLOCK.indexOf('renderItemRegion(item, screenPts, {') >= 0,
    'extractPolyFromItem renders through the shared renderItemRegion');
  count('function renderItemRegion(', 1, 'there is exactly one region renderer');

  const c = { x: 100, y: 200, w: 300, h: 150, rot: 30, natW: 600, natH: 300 };
  const env = makeEnv(c);
  const geo = buildGeo(env);

  // Three screen points, derived INDEPENDENTLY from the source triangle
  // (100,50) (400,50) (250,250) — no use of the impl's own mapper.
  const natTri = [[100, 50], [400, 50], [250, 250]];
  const scr = natTri.map(n => expectedScreen(c, n[0], n[1]));
  const sL = Math.min(scr[0].x, scr[1].x, scr[2].x);
  const sR = Math.max(scr[0].x, scr[1].x, scr[2].x);
  const sT = Math.min(scr[0].y, scr[1].y, scr[2].y);
  const sB = Math.max(scr[0].y, scr[1].y, scr[2].y);

  const created = [];
  const log = { setTransform: [], drawImage: [], cop: [], clip: 0, stroke: 0, fill: [], path: [], addImage: null, canvas: null };
  function makeCanvas() {
    const ctx = {
      _cop: 'source-over',
      set globalCompositeOperation(v) { ctx._cop = v; log.cop.push(v); },
      get globalCompositeOperation() { return ctx._cop; },
      setTransform(a, b, cc, d, e, f) { log.setTransform.push([a, b, cc, d, e, f]); },
      save() {}, restore() {}, beginPath() {}, closePath() {},
      moveTo(x, y) { log.path.push(['M', x, y]); }, lineTo(x, y) { log.path.push(['L', x, y]); },
      clip() { log.clip++; }, drawImage() { log.drawImage.push(Array.prototype.slice.call(arguments)); },
      fill() { log.fill.push(ctx._cop); }, stroke() { log.stroke++; },
      set strokeStyle(v) {}, set lineWidth(v) { log.lineWidth = v; }, set lineJoin(v) {}
    };
    const cv = { width: 0, height: 0, getContext() { return ctx; }, toBlob(cb) { cb({ size: 4242 }); } };
    log.canvas = cv;
    return cv;
  }
  const doc = {
    createElement(t) {
      if (t === 'canvas') return makeCanvas();
      if (t === 'div') return env.document.createElement('div');
      return null;
    }
  };
  const api = new Function('document', 'getComputedStyle', 'canvasContent', 'itemPixelGeometry', '_geoApply',
    'toast', 'addImage', 'updateItemStyle', 'selectOnly', 'URL', 'state',
    EXTRACT_BLOCK + '\nreturn { extractPolyFromItem: extractPolyFromItem };'
  )(doc, env.getComputedStyle, env.canvasContent, geo.itemPixelGeometry, geo._geoApply,
    function () {}, function (src, nw, nh, x, y) {
      log.addImage = { src: src, nw: nw, nh: nh, x: x, y: y };
      // addImage places the item at (x,y) and caps the display width at 720
      // world px; the impl overwrites w/h afterwards for an in-place crop.
      const it = { id: 99, w: Math.min(nw, 720), h: Math.min(nh, 720), x: x, y: y, rot: 0, natW: nw, natH: nh };
      created.push(it); return it;
    },
    function () {}, function () {}, { createObjectURL: function () { return 'blob:new'; } }, { zoom: 1 });

  const newItem = await api.extractPolyFromItem(env.item, scr, { place: 'inplace' });
  ok(!!newItem, 'the extract runs on a rotated source and returns an item');

  // Resolution: 1 output px per source px. Item is 300 wide for 600 source px
  // at zoom 1, so k = 2.
  const k = 2;
  near(log.canvas.width, Math.round((sR - sL) * k), 'the output canvas is the SCREEN bbox at source resolution (w)', 1);
  near(log.canvas.height, Math.round((sB - sT) * k), 'the output canvas is the SCREEN bbox at source resolution (h)', 1);

  // THE assertion that would have caught the bug: the transform handed to the
  // canvas must put source pixel (100,50) at output pixel (0,0) — i.e. exactly
  // where that source pixel was on screen, inside the drawn bbox.
  const T = log.setTransform[0];
  ok(!!T, 'a source->output transform was installed');
  const o0 = { x: T[0] * 100 + T[2] * 50 + T[4], y: T[1] * 100 + T[3] * 50 + T[5] };
  near(o0.x, (scr[0].x - sL) * k, 'source (100,50) renders where it was drawn (output x)', 0.02);
  near(o0.y, (scr[0].y - sT) * k, 'source (100,50) renders where it was drawn (output y)', 0.02);
  const o1 = { x: T[0] * 400 + T[2] * 50 + T[4], y: T[1] * 400 + T[3] * 50 + T[5] };
  near(o1.x, (scr[1].x - sL) * k, 'source (400,50) renders where it was drawn (output x)', 0.02);
  near(o1.y, (scr[1].y - sT) * k, 'source (400,50) renders where it was drawn (output y)', 0.02);

  // The clip path is in SOURCE pixels — the inverse mapper's output.
  near(log.path[0][1], 100, 'the clip path is traced in source pixels (first x)');
  near(log.path[0][2], 50, 'the clip path is traced in source pixels (first y)');
  eq(log.clip, 1, 'the clip is applied');
  ok(log.drawImage.length === 1 && log.drawImage[0][0] === env.imgEl, 'the source image is drawn once, from the live <img>');

  // The result is upright: rot and flip are baked into the pixels, so leaving
  // them on the item is what made the NEXT cut drift.
  eq(newItem.rot, 0, 'v7.16.0: the extracted copy is upright (rot = 0)');
  eq(newItem.flipH, false, 'the extracted copy carries no horizontal flip');
  eq(newItem.flipV, false, 'the extracted copy carries no vertical flip');
  near(newItem.w, (sR - sL), 'the copy covers exactly the drawn width, in world px', 0.02);
  near(newItem.h, (sB - sT), 'the copy covers exactly the drawn height, in world px', 0.02);
  near(newItem.x, sL, 'the copy lands on the drawn pixels (x)', 0.02);
  near(newItem.y, sT, 'the copy lands on the drawn pixels (y)', 0.02);
  ok(log.addImage && log.addImage.nw === log.canvas.width && log.addImage.nh === log.canvas.height,
    'addImage is told the output canvas is the new natural size');

  // A shape drawn off the picture must not produce an all-transparent item.
  const off = await api.extractPolyFromItem(env.item, [{ x: -900, y: -900 }, { x: -800, y: -900 }, { x: -850, y: -800 }], { place: 'inplace' });
  eq(off, null, 'a shape drawn entirely off the image is refused, not turned into an empty item');

  // ── beside: the other placement branch, still in world coordinates ──
  log.setTransform.length = 0; log.path.length = 0; log.stroke = 0;
  const beside = await api.extractPolyFromItem(env.item, scr, { place: 'beside' });
  near(beside.x, 100 + 300 + 20, 'beside: the copy sits 20 world px right of the source', 0.02);
  near(beside.y, 200, 'beside: the copy lines up with the source’s top edge', 0.02);
  eq(beside.rot, 0, 'beside: the copy is upright too');

  // ── beside at zoom 2: the 20px gap is a SCREEN gap, so it must be divided
  //    by the zoom. Skipping the division is invisible at zoom 1 and drifts
  //    the copy further away the more you zoom in. ──
  const cz = { x: 100, y: 200, w: 300, h: 150, rot: 0, natW: 600, natH: 300, zoom: 2 };
  const envz = makeEnv(cz);
  const geoz = buildGeo(envz);
  const scrz = natTri.map(n => expectedScreen(cz, n[0], n[1]));
  const api2 = new Function('document', 'getComputedStyle', 'canvasContent', 'itemPixelGeometry', '_geoApply',
    'toast', 'addImage', 'updateItemStyle', 'selectOnly', 'URL', 'state',
    EXTRACT_BLOCK + '\nreturn { extractPolyFromItem: extractPolyFromItem };'
  )({
    createElement(t) { if (t === 'canvas') return makeCanvas(); if (t === 'div') return envz.document.createElement('div'); return null; }
  }, envz.getComputedStyle, envz.canvasContent, geoz.itemPixelGeometry, geoz._geoApply,
    function () {}, function (src, nw, nh, x, y) {
      return { id: 100, w: Math.min(nw, 720), h: Math.min(nh, 720), x: x, y: y, rot: 0, natW: nw, natH: nh };
    },
    function () {}, function () {}, { createObjectURL: function () { return 'blob:new'; } }, { zoom: 2 });
  const bz = await api2.extractPolyFromItem(envz.item, scrz, { place: 'beside' });
  near(bz.x, 100 + 300 + 10, 'beside at zoom 2: the 20px SCREEN gap is 10 world px', 0.02);

  // ── border: stroked in OUTPUT px, so zoom and file size do not matter ──
  log.stroke = 0; log.lineWidth = 0;
  await api.extractPolyFromItem(env.item, scr, { place: 'inplace', border: true, borderColor: '#ff0000' });
  eq(log.stroke, 1, 'the border is stroked once when asked for');
  ok(log.lineWidth >= 2, 'the border has a visible minimum thickness (' + log.lineWidth + 'px)');
  const bx = log.path[log.path.length - 3][1];
  ok(bx >= 0 && bx <= log.canvas.width + 1, 'the border path is traced in output pixels, inside the canvas');
});

// ═══ 4. knockOutPolyFromItem, executed ════════════════════════════════════
const KNOCK_BLOCK = slice('async function knockOutPolyFromItem(item, screenPts) {',
  '// Punch the drawn shape out of the source image instead');
asection(async function () {
  ok(KNOCK_BLOCK.length > 1000, 'the knock-out block is present');

  const c = { x: 100, y: 200, w: 300, h: 150, rot: 30, natW: 600, natH: 300 };
  const env = makeEnv(c);
  const geo = buildGeo(env);
  const natTri = [[100, 50], [400, 50], [250, 250]];
  const scr = natTri.map(n => expectedScreen(c, n[0], n[1]));

  const order = [];
  const log = { drawImage: [], cop: [], fill: [], path: [], canvas: null };
  function makeCanvas() {
    const ctx = {
      _cop: 'source-over',
      set globalCompositeOperation(v) { ctx._cop = v; log.cop.push(v); },
      get globalCompositeOperation() { return ctx._cop; },
      setTransform() {}, save() {}, restore() {}, beginPath() {}, closePath() {},
      moveTo(x, y) { log.path.push(['M', x, y]); }, lineTo(x, y) { log.path.push(['L', x, y]); },
      clip() {}, drawImage() { log.drawImage.push(Array.prototype.slice.call(arguments)); },
      fill() { log.fill.push(ctx._cop); }, stroke() {},
      set strokeStyle(v) {}, set lineWidth(v) {}, set lineJoin(v) {}
    };
    const cv = { width: 0, height: 0, getContext() { return ctx; }, toBlob(cb) { cb({ size: 777 }); } };
    log.canvas = cv;
    return cv;
  }
  const doc = {
    createElement(t) {
      if (t === 'canvas') return makeCanvas();
      if (t === 'div') return env.document.createElement('div');
      return null;
    }
  };
  const api = new Function('document', 'getComputedStyle', 'canvasContent', 'itemPixelGeometry', '_geoApply',
    'toast', 'pushUndo', 'updateItemStyle', 'scheduleAutoSave', 'URL',
    KNOCK_BLOCK + '\nreturn { knockOutPolyFromItem: knockOutPolyFromItem };'
  )(doc, env.getComputedStyle, env.canvasContent, geo.itemPixelGeometry, geo._geoApply,
    function () {}, function () { order.push('undo'); }, function () {},
    function () { order.push('autosave'); }, { createObjectURL: function () { return 'blob:knocked'; } });

  const srcBefore = env.item.src;
  const res = await api.knockOutPolyFromItem(env.item, scr);
  ok(res === env.item, 'knock out edits the item in place');

  eq(log.canvas.width, 600, 'the knock-out canvas is the source’s full natural width');
  eq(log.canvas.height, 300, 'the knock-out canvas is the source’s full natural height');
  ok(log.drawImage.length === 1 && log.drawImage[0].length === 5, 'the whole source is drawn with an explicit source rect');
  eq(log.drawImage[0][3], 600, 'the source rect is the natural width');
  eq(log.drawImage[0][4], 300, 'the source rect is the natural height');
  eq(log.fill[0], 'destination-out', 'v7.16.0: the hole is SUBTRACTED (destination-out), not painted over');
  // The path is in SOURCE pixels: on a 30deg source, screen and source coords
  // differ, so a wrong mapper cannot land on these exact numbers.
  near(log.path[0][1], 100, 'the hole is cut in source pixels (first x)');
  near(log.path[0][2], 50, 'the hole is cut in source pixels (first y)');
  near(log.path[1][1], 400, 'the hole is cut in source pixels (second x)');
  near(log.path[2][2], 250, 'the hole is cut in source pixels (third y)');

  eq(order[0], 'undo', 'undo is captured BEFORE the pixels are replaced');
  ok(env.item.src !== srcBefore, 'the item points at the new pixels');
  eq(env.item.img.src, 'blob:knocked', 'the on-screen <img> is swapped too, not just the model');
  ok(env.item._sourceBlob && env.item._sourceBlob.size === 777, 'KPAK save gets the new Blob');
  eq(env.item._fileSize, 777, 'the save estimate reads _fileSize, so knock out records the re-encoded size');
  ok(order.indexOf('autosave') > 0, 'the change is persisted');
  eq(env.item.natW, 600, 'the natural width is unchanged, so reframe framing stays valid');
  eq(env.item.natH, 300, 'the natural height is unchanged, so reframe framing stays valid');

  // Off-image shapes are refused rather than silently doing nothing.
  const off = await api.knockOutPolyFromItem(env.item, [{ x: -900, y: -900 }, { x: -800, y: -900 }, { x: -850, y: -800 }]);
  eq(off, null, 'a hole drawn entirely off the image is refused');
});

// ═══ 5. the versions in the tree still agree ══════════════════════════════
section(function () {
  const sw = fs.readFileSync(path.resolve(ROOT, 'Krafted/docs/sw.js'), 'utf8');
  const title = (HTML.match(/<title>Krafted v([\d.]+)<\/title>/) || [])[1];
  const konst = (HTML.match(/var KRAFTED_VERSION = '([\d.]+)';/) || [])[1];
  const appv = (sw.match(/const APP_VERSION = '([\d.]+)';/) || [])[1];
  ok(title && konst && appv, 'title, KRAFTED_VERSION and APP_VERSION are all present');
  eq(konst, title, 'KRAFTED_VERSION matches the title');
  eq(appv, title, 'the service worker matches the app');
});

Promise.all(asyncs).then(function () {
  console.log('');
  if (fail) {
    console.log('FAILURES: ' + fail + ' (passed ' + pass + ')');
    process.exit(1);
  }
  console.log('ALL PASS (' + pass + ' assertions)');
});
