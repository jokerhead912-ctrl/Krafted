#!/usr/bin/env node
/*
 * test_v7_9_0.js — v7.9.0: exported images are the pixels you saw.
 *
 *   A. THE REPORT. "I selected a bunch of images, saved them to disk, and I
 *      cannot tell what format came out / they will not open."
 *
 *   B. WHAT WAS ACTUALLY WRONG — three separate defects, not one:
 *        1. "Save Images to Folder…" lived in the NO-SELECTION branch of the
 *           context menu. Selecting 12 images and right-clicking offered no
 *           bulk export at all.
 *        2. The only reachable per-image export, "Download Source File",
 *           derived its extension with src.split('.').pop(). On a blob: URL
 *           that returns the TAIL OF THE GUID, producing names like
 *           "IMG_2301.blob:http://localhost:8000/550e8400-e29b-41d4-…"
 *           that no OS can open.
 *        3. Export wrote the IMPORTED BYTES. Crop, rotation, flip and colour
 *           grade are stored non-destructively (transforms + a CSS filter),
 *           so an exported board handed back pre-edit originals. Only
 *           lasso/cut/knock-out — which rewrite pixels — ever showed up.
 *
 *   C. THE FIX. One naming rule, one bake rule. The bake reuses v7.8.0's
 *      itemPixelGeometry() through renderItemRegion(), so the PNG on disk is
 *      the same render the board was showing — no fourth copy of the
 *      transform maths. Chrome/Edge write into a picked folder; Safari and
 *      Firefox, which have no File System Access API, get ONE zip instead of
 *      300 download prompts. Progress can be cancelled.
 *
 * Sections 2-5 EXECUTE the sliced functions against a stub DOM. An anchor
 * alone proves the code exists, not that it runs (the v7.4.0 lesson).
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
function lacks(needle, m) { ok(HTML.indexOf(needle) < 0, m + '  (should be gone: ' + JSON.stringify(needle.slice(0, 90)) + ')'); }
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
    else if (name === 'rotatex' || name === 'rotatey') t = IDENT;
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
// Shoelace area. A rotated rectangle keeps its area; the axis-aligned box
// around it does not — which is how this tells a true quad from the AABB the
// old code was measuring.
function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

// ═══ the stub DOM ════════════════════════════════════════════════════════
function makeCanvas() {
  const rec = { width: 0, height: 0, clipFilter: undefined, drew: 0, toBlobType: null, toBlobCalls: 0, blob: null };
  const ctx = {
    filter: undefined,
    save() {}, restore() {},
    setTransform(a, b, c, d, e, f) { rec.setTransform = [a, b, c, d, e, f]; },
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    clip() { rec.clipFilter = ctx.filter; rec.clipped = true; rec.widthAtClip = rec.width; rec.heightAtClip = rec.height; },
    stroke() { rec.stroked = true; },
    drawImage() { rec.drew++; }
  };
  rec.ctx = ctx;
  const cv = {
    _rec: rec,
    get width() { return rec.width; }, set width(v) { rec.width = v; },
    get height() { return rec.height; }, set height(v) { rec.height = v; },
    getContext() { return ctx; },
    toBlob(cb, type) {
      rec.toBlobType = type; rec.toBlobCalls++;
      cb(rec.blob || { type: type || 'image/png', size: 4242 });
    }
  };
  return cv;
}

function makeEnv(c) {
  c = c || {};
  const zoom = (c.zoom === undefined) ? 1 : c.zoom;
  const pan = c.pan || { x: 0, y: 0 };
  const rot = c.rot || 0, w = c.w || 300, h = c.h || 150, x = c.x || 0, y = c.y || 0;
  const natW = c.natW || 600, natH = c.natH || 300;
  const boxW = (c.boxW === undefined) ? w : c.boxW;
  const boxH = (c.boxH === undefined) ? h : c.boxH;
  const centre = { x: w / 2, y: h / 2 };
  const itemTf = parseTransform('translate(' + x + ',' + y + ') rotate(' + rot + ')');
  const canvases = [];

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
  itemEl.offsetWidth = w; itemEl.offsetHeight = h;
  const canvasContent = makeNode('canvas-content');
  const imgEl = {
    tagName: 'IMG', complete: (c.complete === undefined) ? true : c.complete,
    naturalWidth: c.naturalWidth === undefined ? natW : c.naturalWidth,
    naturalHeight: natH,
    offsetLeft: 0, offsetTop: 0, offsetWidth: boxW, offsetHeight: boxH, style: {}
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
        const local = applyM(parseTransform(tf), { x: left, y: top });
        if (d._parent === canvasContent) {
          return { left: pan.x + zoom * local.x, top: pan.y + zoom * local.y, width: 0, height: 0 };
        }
        // item-local -> item transform (rotate about the centre) -> world -> screen
        const v = applyM(itemTf, { x: local.x - centre.x, y: local.y - centre.y });
        const world = { x: centre.x + v.x, y: centre.y + v.y };
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
    x: x, y: y, w: w, h: h, rot: rot, flipH: false, flipV: false,
    src: 'blob:krafted/1', filename: c.filename, name: c.name
  };
  return {
    item: item, itemEl: itemEl, canvasContent: canvasContent, imgEl: imgEl, canvases: canvases,
    document: {
      createElement(t) {
        if (t === 'div') return makeDiv();
        if (t === 'canvas') { const cv = makeCanvas(); canvases.push(cv); return cv; }
        return null;
      }
    },
    getComputedStyle: function () { return computed; },
    // Independent oracle: where a local point of the item box lands on screen.
    localToScreen: function (lx, ly) {
      const q = rotAbout({ x: lx, y: ly }, centre, rot);
      return { x: pan.x + zoom * (x + q.x), y: pan.y + zoom * (y + q.y) };
    }
  };
}

// v7.8.0's mapper + v7.9.0's shared renderer. The renderer is sliced together
// with the mapper because that is the point: export cannot have its own copy.
const CORE = slice('var GEO_PROBE_UNIT = 100;', 'async function extractPolyFromItem(item, screenPts, opts) {');
// The whole v7.9.0 export section: naming rules, quad, bake, both sinks.
const EXP = slice('var EXPORT_MIME_EXT = {', '// R88 — Auto-load .kpak');
const MENU = slice('function exportMenuEntries(n) {', 'function showCtx(x, y) {');

const EXP_NAMES = ['extFromMime', 'extFromName', 'stripExt', 'exportBaseName',
  'dedupeExportNames', 'itemScreenQuad', 'bakeItemToBlob', 'renderItemRegion',
  'exportAllImagesToFolder', 'exportOriginalFilesToFolder'];

function buildExport(env, o) {
  o = o || {};
  const args = ['document', 'getComputedStyle', 'canvasContent', 'mediaFilterString',
    'state', 'getSelectedImages', '_ensureAllImagesLive', '_isZhUI', 'makeProgressUI',
    'hasFileSystemAccess', 'pickSaveFolder', 'dataUrlToBlob', 'uniqueFilename',
    'writeBlobToFolder', 'JSZip', 'kraftedSaveFile', 'sanitizeFilename', 'formatBytes',
    'toast', 'console'];
  const vals = [
    env.document, env.getComputedStyle, env.canvasContent,
    o.mediaFilterString || function (a) {
      a = a || {};
      return 'brightness(' + (a.brightness || 100) + '%) contrast(' + (a.contrast || 100) + '%)';
    },
    o.state || { items: [] },
    o.getSelectedImages || function () { return []; },
    o._ensureAllImagesLive || function () {},
    o._isZhUI || function () { return false; },
    o.makeProgressUI || function () { return { update() {}, cancelled() { return false; }, done() {} }; },
    o.hasFileSystemAccess || function () { return true; },
    o.pickSaveFolder || function () { return Promise.resolve({ name: 'Out' }); },
    o.dataUrlToBlob || function () { return Promise.resolve({ type: 'image/png', size: 10 }); },
    o.uniqueFilename || function (dir, base, ext) { return Promise.resolve(base + '.' + ext); },
    o.writeBlobToFolder || function () { return Promise.resolve('x'); },
    o.JSZip || function () { this.files = {}; this.file = function (n, b) { this.files[n] = b; }; this.generateAsync = function (oo, cb) { if (cb) cb({ percent: 50 }); return Promise.resolve({ size: 999 }); }; },
    o.kraftedSaveFile || function () { return Promise.resolve('saved'); },
    o.sanitizeFilename || function (n) { return n; },
    o.formatBytes || function (n) { return n + ' B'; },
    o.toast || function () {},
    { error() {}, log() {} }
  ];
  const body = CORE + '\n' + EXP + '\nreturn {'
    + EXP_NAMES.map(function (n) { return n + ': ' + n; }).join(', ') + '};';
  return new Function(args, body).apply(null, vals);
}

// ═══ 1. the wiring ════════════════════════════════════════════════════════
section(function () {
  ok(CORE.length > 2000, 'the geometry core is present');
  ok(EXP.length > 6000, 'the export section is present');
  has('function renderItemRegion(item, screenPts, opts) {', 'one shared region renderer exists');
  count('function renderItemRegion(', 1, 'exactly one region renderer — cut, lasso and export share it');
  has('function itemScreenQuad(item) {', 'the item quad helper exists');
  has('function bakeItemToBlob(item) {', 'the bake helper exists');
  has('function exportOriginalFilesToFolder() {', 'the original-files export exists');
  has("function exportMenuEntries(n) {", 'one builder drives both export menu entries');
  count('exportMenuEntries(', 3, 'the menu builder is defined once and used in both branches');
  // The three defects, pinned in the negative.
  lacks('Save Images to Folder', 'the old, selection-blind menu entry is gone');
  has('Save images as PNG', 'the new entry NAMES THE FORMAT');
  has('Save original files', 'the untouched-bytes escape hatch exists');
  has("if (hasImages) html += exportMenuEntries(", 'the export entries appear when images are SELECTED');
  lacks("ext = item.src.split('.').pop().split('?')[0] || 'png';",
    'Download Source File no longer takes an extension from a blob: URL');
  has('ext = extFromName(name, \'png\');', 'Download Source File reads the extension from the real file name');
  has("'Save images as PNG…': '储存为 PNG 图片…',", 'the PNG entry is translated');
  has("'Save original files…': '储存原始档案…',", 'the original entry is translated');
  // Bake must not become a fourth copy of the transform maths.
  count('itemPixelGeometry(item)', 3, 'still one mapper definition + exactly two consumers');
  // Call sites only — "itemPixelGeometry" also appears in a comment here, and
  // a comment is not a second implementation.
  ok(EXP.indexOf('itemPixelGeometry(') < 0, 'the export section never re-derives the geometry itself');
  has('if (opts.filter) ctx.filter = opts.filter;', 'the renderer can bake a colour grade');
  has("r.canvas.width = 0; r.canvas.height = 0;", 'a baked canvas is released instead of stacking up');
  has("cancelled: function() { return _cancelled; },", 'the progress card can report a cancel');
  has('.save-progress .pg-cancel', 'the cancel button is styled (and opts back into pointer events)');
});

// ═══ 2. naming rules, executed ════════════════════════════════════════════
section(function () {
  const env = makeEnv({});
  const api = buildExport(env);
  const E = api.extFromMime;

  eq(E('image/png'), 'png', 'png mime -> png');
  eq(E('image/jpeg'), 'jpg', 'jpeg -> jpg, not "jpeg" (Windows does not know .jpeg)');
  eq(E('image/webp'), 'webp', 'webp mime -> webp');
  eq(E('image/svg+xml'), 'svg', 'svg mime -> svg');
  eq(E('image/jpeg; charset=binary'), 'jpg', 'a mime with parameters still resolves');
  eq(E('application/octet-stream', 'png'), 'png', 'an unknown mime falls back instead of producing .octet-stream');
  eq(E('', 'png'), 'png', 'no mime at all falls back');
  eq(E('nonsense', 'png'), 'png', 'garbage mime falls back');

  eq(api.extFromName('IMG_2301.JPG'), 'jpg', 'file name extension is lower-cased');
  eq(api.extFromName('shot.final.v2.png'), 'png', 'only the last dot group is an extension');
  eq(api.extFromName('noextension'), '', 'a name with no dot yields no extension');
  eq(api.extFromName('noextension', 'png'), 'png', '…and then the caller\'s fallback wins');

  // THE REGRESSION. This is the exact string the old
  // src.split('.').pop().split('?')[0] produced for every image on a board.
  const poisoned = 'IMG_2301.blob:http://localhost:8000/550e8400-e29b-41d4-a716-446655440000';
  const oldWay = poisoned.split('.').pop().split('?')[0];
  ok(oldWay.indexOf('blob:') === 0, 'the old expression really did return a blob: fragment (the bug is real)');
  eq(api.extFromName(poisoned, 'png'), 'png', 'the GUID tail can never become an extension');
  ok(api.extFromName(poisoned, 'png').length <= 5, 'an extension is never longer than 5 characters');

  eq(api.stripExt('IMG_2301.jpg'), 'IMG_2301', 'stripExt removes the extension');
  eq(api.stripExt('a.b.c.png'), 'a.b.c', 'stripExt removes only the last extension');
  eq(api.stripExt('C:\\refs\\head.v1.png'), 'C:\\refs\\head.v1', 'stripExt does not eat a Windows path');

  eq(api.exportBaseName({ filename: 'IMG_2301.jpg' }, 0), 'IMG_2301', 'the original file name is kept');
  eq(api.exportBaseName({ name: 'Hero shot' }, 1), 'Hero shot', 'the item name is the next best thing');
  eq(api.exportBaseName({}, 2), 'image_3', 'and a positional fallback last (1-based)');
  eq(api.exportBaseName({ filename: '   ' }, 4), 'image_5', 'a blank name is not a name');

  eq(JSON.stringify(api.dedupeExportNames(['IMG_1', 'IMG_1', 'IMG_1'])),
    JSON.stringify(['IMG_1', 'IMG_1_2', 'IMG_1_3']), 'duplicate names are numbered, never overwritten');
  eq(JSON.stringify(api.dedupeExportNames(['a', 'A'])),
    JSON.stringify(['a', 'A_2']), 'collision detection is case-insensitive (macOS/Windows are)');
  eq(JSON.stringify(api.dedupeExportNames(['a', 'b'])),
    JSON.stringify(['a', 'b']), 'distinct names are left alone');
});

// ═══ 3. the quad and the bake, executed ═══════════════════════════════════
asection(async function () {
  // ── the quad is the item's own box, ROTATED, not the axis-aligned box ──
  const cfg = { x: 40, y: 60, w: 300, h: 150, rot: 30, natW: 600, natH: 300 };
  const env = makeEnv(cfg);
  const api = buildExport(env);
  const quad = api.itemScreenQuad(env.item);
  ok(Array.isArray(quad) && quad.length === 4, 'the quad has four corners');
  near(quad[0].x, env.localToScreen(0, 0).x, 'corner (0,0) is the ROTATED top-left (x)', 0.02);
  near(quad[0].y, env.localToScreen(0, 0).y, 'corner (0,0) is the ROTATED top-left (y)', 0.02);
  near(quad[2].x, env.localToScreen(300, 150).x, 'corner (w,h) is the ROTATED bottom-right (x)', 0.02);
  near(quad[2].y, env.localToScreen(300, 150).y, 'corner (w,h) is the ROTATED bottom-right (y)', 0.02);
  // A rotated rectangle keeps its area; the AABB around it is far bigger.
  // 300x150 at 30deg -> 45000, AABB -> ~93712. This is the assertion that
  // would have failed on the old getBoundingClientRect() approach.
  near(polyArea(quad), 300 * 150, 'the quad is the item, not the box around it (area preserved)', 1);

  // ── the bake ──
  const baked = await api.bakeItemToBlob(env.item);
  ok(!!baked, 'the bake returns a blob for a decodable item');
  eq(baked.type, 'image/png', 'the baked blob is a PNG');
  const cv = env.canvases[env.canvases.length - 1];
  ok(!!cv, 'the bake created a canvas');
  eq(cv._rec.clipped, true, 'the bake clips to the item box');
  eq(cv._rec.drew, 1, 'the bake draws the source once');
  eq(cv._rec.toBlobType, 'image/png', 'the bake always emits PNG');
  // Rendered at the SOURCE's resolution, not the screen's. The item is 300px
  // wide on a board but 600px of real pixels, so a screen-resolution export
  // would throw away three quarters of it.
  const aabbW = 300 * Math.cos(30 * Math.PI / 180) + 150 * Math.sin(30 * Math.PI / 180);
  const aabbH = 300 * Math.sin(30 * Math.PI / 180) + 150 * Math.cos(30 * Math.PI / 180);
  near(cv._rec.widthAtClip, aabbW * 2, 'the bake renders at source resolution, not screen resolution (w)', 2);
  near(cv._rec.heightAtClip, aabbH * 2, 'the bake renders at source resolution, not screen resolution (h)', 2);

  // The colour grade really reaches the canvas — and an ungraded item does
  // not pay for a filtered draw at all.
  eq(cv._rec.clipFilter, undefined, 'an ungraded item does not set ctx.filter at all');

  const env2 = makeEnv(cfg);
  const api2 = buildExport(env2);
  env2.item.brightness = 150;
  const blob2 = await api2.bakeItemToBlob(env2.item);
  ok(!!blob2, 'a graded item still bakes');
  const cv2 = env2.canvases[env2.canvases.length - 1];
  eq(cv2._rec.clipFilter, 'brightness(150%) contrast(100%)',
    'the colour grade is baked into the pixels (it is a CSS filter — it would otherwise be lost)');

  // Memory: a 6000x4000 canvas is ~96 MB and the loop renders hundreds.
  eq(cv2.width, 0, 'the canvas is released after the blob is taken (width)');
  eq(cv2.height, 0, 'the canvas is released after the blob is taken (height)');

  // ── refusals ──
  const env3 = makeEnv(Object.assign({}, cfg, { complete: false }));
  const api3 = buildExport(env3);
  eq(await api3.bakeItemToBlob(env3.item), null, 'an image that has not decoded is skipped, not crashed on');
  const env4 = makeEnv(Object.assign({}, cfg, { naturalWidth: 0 }));
  const api4 = buildExport(env4);
  eq(await api4.bakeItemToBlob(env4.item), null, 'an image with no natural size is skipped');
  const api5 = buildExport(makeEnv(cfg));
  eq(await api5.bakeItemToBlob(null), null, 'a missing item is skipped');
});

// ═══ 4. the export driver, executed ═══════════════════════════════════════
function runExport(o) {
  const env = makeEnv({});
  const written = [];
  const toasts = [];
  const progress = [];
  const prog = {
    update: function (t) { progress.push(t); },
    cancelled: function () { return !!prog._c; },
    done: function () { prog._done = true; }
  };
  let zipFiles = null, saved = null, unCulled = 0, progOpts = null;
  const opts = {
    state: o.state || { items: o.items || [] },
    getSelectedImages: function () { return o.selected || []; },
    _ensureAllImagesLive: function () { unCulled++; },
    hasFileSystemAccess: function () { return o.fsa !== false; },
    pickSaveFolder: function () { return Promise.resolve({ name: 'Out' }); },
    dataUrlToBlob: function (src) { return Promise.resolve(o.blobFor ? o.blobFor(src) : { type: 'image/png', size: 10 }); },
    writeBlobToFolder: function (dir, fn, blob) {
      written.push({ name: fn, type: blob && blob.type });
      if (o.cancelAfter === written.length) prog._c = true;
      return Promise.resolve(fn);
    },
    JSZip: function () {
      zipFiles = {};
      this.file = function (n, b) { zipFiles[n] = b; };
      this.generateAsync = function (oo, cb) { if (cb) cb({ percent: 50 }); return Promise.resolve({ size: 4321 }); };
    },
    kraftedSaveFile: function (a) { saved = a; return Promise.resolve('saved'); },
    makeProgressUI: function (p) { progOpts = p; return prog; },
    toast: function (m) { toasts.push(m); }
  };
  const api = buildExport(env, opts);
  return api[o.original ? 'exportOriginalFilesToFolder' : 'exportAllImagesToFolder']({ original: !!o.original })
    .then(function () {
      return { written: written, zipFiles: zipFiles, saved: saved, toasts: toasts, progress: progress, prog: prog, unCulled: unCulled, progOpts: progOpts };
    });
}

function mkItem(id, filename, extra) {
  const env = makeEnv({ filename: filename });
  const it = env.item;
  it.id = id;
  it.src = 'blob:krafted/' + id;
  Object.assign(it, extra || {});
  return it;
}

asection(async function () {
  // ── a SELECTION is exported, not the whole board ──
  const a = mkItem(1, 'IMG_2301.jpg');
  const b = mkItem(2, 'IMG_2302.jpg');
  const rest = [mkItem(3, 'not-selected.jpg'), mkItem(4, 'nor-this.jpg'), mkItem(5, 'nor-that.jpg')];
  let r = await runExport({ selected: [a, b], items: [a, b].concat(rest) });
  eq(r.written.length, 2, 'a selection exports the SELECTION, not the whole board');
  eq(r.unCulled, 1, 'off-screen images are un-culled before any pixel is read');
  ok(r.written.every(w => /\.png$/.test(w.name)), 'a baked export is always .png');
  eq(r.written[0].name, 'IMG_2301.png', 'the original file name survives (bake)');
  eq(r.written[1].name, 'IMG_2302.png', '…for every item in the selection');

  // ── nothing selected -> the whole board ──
  r = await runExport({ selected: [], items: [a, b] });
  eq(r.written.length, 2, 'no selection exports every image on the board');

  // ── two folders can both hold IMG_2301.jpg ──
  const dupA = mkItem(1, 'IMG_2301.jpg');
  const dupB = mkItem(2, 'refs/IMG_2301.jpg'.split('/').pop());
  r = await runExport({ selected: [dupA, dupB] });
  eq(r.written[0].name, 'IMG_2301.png', 'the first duplicate keeps the bare name');
  eq(r.written[1].name, 'IMG_2301_2.png', 'the second is numbered — a silent overwrite would lose a picture');

  // ── original mode: untouched bytes, original format ──
  r = await runExport({
    original: true, selected: [mkItem(1, 'IMG_2301.jpg')],
    blobFor: function () { return { type: 'image/webp', size: 10 }; }
  });
  eq(r.written[0].name, 'IMG_2301.webp', 'original mode uses the blob\'s real type');

  r = await runExport({
    original: true, selected: [mkItem(1, 'IMG_2301.jpg')],
    blobFor: function () { return { type: '', size: 10 }; }
  });
  eq(r.written[0].name, 'IMG_2301.jpg', '…and falls back to the file name when the blob has no type');

  // ── Safari / Firefox: ONE zip, not 300 download prompts ──
  r = await runExport({ selected: [a, b], fsa: false });
  eq(r.written.length, 0, 'without File System Access nothing is written file by file');
  ok(!!r.zipFiles, 'the zip sink is used instead');
  eq(Object.keys(r.zipFiles).length, 2, 'every image goes into the one zip');
  ok(!!r.saved, 'the zip is handed to the save helper');
  ok(/\.zip$/.test(r.saved.filename), 'the single download is a .zip');
  eq(r.saved.mime, 'application/zip', 'the zip is labelled with its mime');

  // ── cancel ──
  r = await runExport({ selected: [a, b, mkItem(3, 'c.png')], cancelAfter: 1 });
  eq(r.written.length, 1, 'cancel stops after the item in flight — no half-written second file');
  ok(r.toasts.join(' ').indexOf('Cancelled') >= 0, 'cancel is reported, not swallowed');
  ok(!!r.progOpts && typeof r.progOpts.onCancel === 'function', 'the progress card is built WITH a cancel handler');

  // ── progress is shown ──
  r = await runExport({ selected: [a, b] });
  ok(r.progress.length >= 2, 'the progress card is updated per item');
  ok(r.progress.join(' ').indexOf('1/2') >= 0, 'the progress card counts items');
  eq(r.prog._done, true, 'the progress card is always removed');
});

// ═══ 5. the menu entries, executed ════════════════════════════════════════
section(function () {
  const build = new Function(MENU + '\nreturn { exportMenuEntries: exportMenuEntries };')();
  eq(build.exportMenuEntries(0), '', 'no exportable images -> no menu entries at all');
  const one = build.exportMenuEntries(1);
  const many = build.exportMenuEntries(12);
  eq((many.match(/ctx-item/g) || []).length, 2, 'two entries, not one, not three');
  ok(many.indexOf('Save images as PNG') >= 0, 'the PNG entry is offered');
  ok(many.indexOf('Save original files') >= 0, 'the original-files entry is offered');
  ok(many.indexOf('<kbd style="opacity:.4">12</kbd>') >= 0, 'the count is shown');
  ok(one.indexOf('<kbd style="opacity:.4">1</kbd>') >= 0, '…and it is the real count, not a placeholder');
  ok(many.indexOf('exportAllImagesToFolder()') >= 0, 'the PNG entry is wired up');
  ok(many.indexOf('exportOriginalFilesToFolder()') >= 0, 'the original entry is wired up');
  // The label must stay static so the translation layer can match it whole.
  ok(many.indexOf('Save images as PNG… <kbd') >= 0 || many.indexOf('Save images as PNG…<kbd') >= 0,
    'the label is static and the count sits in a chip (translation matches whole text nodes)');
  ok(many.indexOf('baked in') >= 0, 'the PNG entry explains what "as PNG" means');
});

// ═══ 6. version identities agree ══════════════════════════════════════════
section(function () {
  const m = HTML.match(/var KRAFTED_VERSION = '([0-9]+\.[0-9]+\.[0-9]+)';/);
  ok(!!m, 'KRAFTED_VERSION is readable');
  if (!m) return;
  const v = m[1];
  ok(HTML.indexOf('<title>Krafted v' + v) >= 0, 'the <title> carries the same version (' + v + ')');
  const sw = fs.readFileSync(path.join(ROOT, 'Krafted', 'docs', 'sw.js'), 'utf8');
  ok(sw.indexOf("APP_VERSION = '" + v + "'") >= 0 || sw.indexOf("APP_VERSION = '" + v) >= 0,
    'the service worker carries the same version (' + v + ')');
  ok(v.indexOf('7.9.') === 0 || v.indexOf('7.8.') === 0, 'the version is the one these tests were written for (' + v + ')');
});

Promise.all(asyncs).then(function () {
  console.log('');
  if (fail === 0) {
    console.log('ALL PASS (' + pass + ' assertions)');
  } else {
    console.log('FAILURES: ' + fail + ' (passed ' + pass + ')');
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exitCode = 1;
  }
});
