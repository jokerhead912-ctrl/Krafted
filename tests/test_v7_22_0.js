// v7.22.0 — Library thumbnails must never decode the full-resolution original.
//
// Rule 19: an anchor proves the code exists, a unit test proves it RUNS. So
// this suite lifts the real functions out of kraftpub-dev.html and executes
// them against a fake <img> / <canvas>, then counts how many times the
// ORIGINAL was decoded. The whole point of the change is that number.

const fs = require('fs');
const path = require('path');

// KRAFTED_HTML lets the mutation harness point us at a deliberately broken
// copy. Without it every mutant would be tested against the pristine file and
// the whole mutation run would be decoration.
const HTML = fs.readFileSync(
  process.env.KRAFTED_HTML || path.join(__dirname, '..', '..', 'kraftpub-dev.html'),
  'utf8');

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  (got ' + JSON.stringify(extra) + ')' : '')); }
}
function eq(a, b, label) { ok(a === b, label, a); }
function deep(a, b, label) {
  ok(JSON.stringify(a) === JSON.stringify(b), label, a);
}
function section(name) { console.log('\n' + name); }

// ── lift the real code out ────────────────────────────────────────────────
// Rule 20: slice anchors are version-free (no X.Y.Z anywhere).
function fnFrom(sig) {
  const i = HTML.indexOf(sig);
  if (i < 0) throw new Error('anchor not found: ' + sig);
  let j = HTML.indexOf('\nfunction ', i + 1);
  if (j < 0) j = HTML.indexOf('\n// P1-1', i + 1);
  if (j < 0) j = HTML.length;
  const s = HTML.slice(i, j);
  if (s.length < 20) throw new Error('slice too short: ' + sig);
  return s;
}

const CONST = (function () {
  // Rule 20's cousin: this anchor must NOT contain the number itself —
  // a mutant that changes LIB_THUMB_MAX_SIDE would then break the anchor
  // instead of breaking a behaviour, and the suite would crash (UNPROVEN)
  // instead of going red.
  const a = HTML.indexOf('var LIB_THUMB_MAX_SIDE =');
  const b = HTML.indexOf('function libThumbFit(');
  if (a < 0 || b < 0 || b <= a) throw new Error('const block anchor failed');
  return HTML.slice(a, b);
})();
const FIT = fnFrom('function libThumbFit(');
const GLYPH = fnFrom('function libThumbGlyph(');
const GETSET = fnFrom('function libThumbGet(') + '\n' + fnFrom('function libThumbSet(');
const FINISH = fnFrom('function _libThumbFinish(');
const DECODE = fnFrom('function _libThumbDecode(');
const PUMP = fnFrom('function _libThumbPump(');
const FOR = fnFrom('function libThumbFor(');

ok(/var LIB_THUMB_MAX_SIDE = 96;/.test(CONST), 'A0 the constant block lifted (anchor check)');
ok(/function libThumbFit\(/.test(FIT), 'A0 libThumbFit lifted (anchor check)');
ok(/function libThumbFor\(/.test(FOR), 'A0 libThumbFor lifted (anchor check)');
ok(/function _libThumbPump\(/.test(PUMP), 'A0 _libThumbPump lifted (anchor check)');

// ── the fake browser ──────────────────────────────────────────────────────
const probes = {
  decodes: 0,          // how many times an ORIGINAL was handed to <img>
  inflight: 0,
  maxInflight: 0,
  canvases: [],        // every canvas actually created
  draws: [],
  quals: []
};

function makeEnv(dimsFor) {
  const p = { decodes: 0, inflight: 0, maxInflight: 0, canvases: [], draws: [], quals: [] };
  const ctx = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: '',
    drawImage: function (img, x, y, w, h) { p.draws.push({ w: w, h: h }); }
  };
  const document = {
    createElement: function (tag) {
      if (tag !== 'canvas') return {};
      return {
        width: 0, height: 0,
        getContext: function () { return ctx; },
        toDataURL: function (q) {
          p.quals.push(q);
          p.canvases.push({ w: this.width, h: this.height });
          return 'data:image/jpeg;base64,THUMB' + p.canvases.length;
        }
      };
    }
  };
  function Image() {
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.onload = null;
    this.onerror = null;
  }
  Object.defineProperty(Image.prototype, 'src', {
    get: function () { return this._src || ''; },
    set: function (v) {
      this._src = v;
      const self = this;
      p.decodes++;
      p.inflight++;
      if (p.inflight > p.maxInflight) p.maxInflight = p.inflight;
      setTimeout(function () {
        const d = dimsFor(v);
        if (!d) {
          p.inflight--;
          if (self.onerror) self.onerror();
          return;
        }
        self.naturalWidth = d.w;
        self.naturalHeight = d.h;
        if (self.onload) self.onload();
        p.inflight--;
      }, 0);
    }
  });
  return { p: p, document: document, Image: Image };
}

function build(env) {
  const src = CONST + '\n' + FIT + '\n' + GLYPH + '\n' + GETSET + '\n' +
    FINISH + '\n' + DECODE + '\n' + PUMP + '\n' + FOR + '\n' +
    'return { fit: libThumbFit, glyph: libThumbGlyph, for: libThumbFor, ' +
    'queue: function(){ return _libThumbQueue; }, ' +
    'busy: function(){ return _libThumbBusy; }, ' +
    'cache: function(it){ return libThumbGet(it); } };';
  return new Function('Image', 'document', 'libThumbSrc', 'setTimeout', src)(
    env.Image, env.document, env.libThumbSrc, setTimeout);
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// ── S1: the sizing rule (pure, so it is cheap to execute) ────────────────
async function main() {
  const env0 = makeEnv(function () { return { w: 4000, h: 3000 }; });
  env0.libThumbSrc = function () { return null; };
  const A = build(env0);

  section('S1 libThumbFit — the sizing rule');
  deep(A.fit(4000, 3000, 96), { w: 96, h: 72 }, 'landscape 4:3 -> long side 96');
  deep(A.fit(3000, 4000, 96), { w: 72, h: 96 }, 'portrait 3:4 -> long side 96');
  deep(A.fit(50, 40, 96), { w: 50, h: 40 }, 'already small -> never upscaled');
  deep(A.fit(96, 96, 96), { w: 96, h: 96 }, 'exactly at the cap -> unchanged');
  deep(A.fit(97, 96, 96), { w: 96, h: 95 }, 'one over the cap gets scaled down');
  deep(A.fit(1, 1000, 96), { w: 1, h: 96 }, 'a 1px-wide image keeps w >= 1');
  deep(A.fit(0, 0, 96), { w: 1, h: 1 }, 'degenerate input never yields 0');
  deep(A.fit(-5, -5, 96), { w: 1, h: 1 }, 'negative input never yields 0');
  eq(A.fit(4000, 3000, 96).w * A.fit(4000, 3000, 96).h < 4000 * 3000, true,
    'the thumbnail is strictly smaller than the source (that is the whole fix)');

  section('S2 libThumbGlyph — one definition for the no-image fallback');
  eq(A.glyph({ type: 'video' }, false), String.fromCharCode(0x25B6), 'video glyph');
  eq(A.glyph({ type: 'audio' }, false), String.fromCharCode(0x266A), 'audio glyph');
  eq(A.glyph({ type: 'link' }, false), String.fromCharCode(0xD83D, 0xDD17), 'link glyph');
  eq(A.glyph({ type: 'image' }, false), String.fromCharCode(0x25A2), 'default glyph');
  eq(A.glyph({ type: 'video' }, true), 'T', 'a text card is a T even if type says video');

  // ── S3: THE POINT — the original is downscaled, once ──────────────────
  section('S3 libThumbFor — downscale + cache (the fix)');
  const env = makeEnv(function (v) {
    if (v.indexOf('BIG') >= 0) return { w: 4000, h: 3000 };
    if (v.indexOf('SMALL') >= 0) return { w: 50, h: 40 };
    return null;                      // unloadable
  });
  env.libThumbSrc = function (it) { return it && it.src ? it.src : null; };
  const B = build(env);

  let got = 'unset';
  const big = { id: 1, src: 'data:BIG-4000x3000' };
  B.for(big, function (u) { got = u; });
  eq(got, 'unset', 'the callback is async — the row is not blocked on the decode');
  await sleep(20);
  ok(/^data:image\/jpeg;base64,THUMB/.test(got), 'the row receives a small JPEG', got);
  eq(env.p.decodes, 1, 'the original was decoded exactly once');
  eq(env.p.canvases.length, 1, 'one canvas was used');
  deep(env.p.canvases[0] || null, { w: 96, h: 72 }, 'the canvas is 96x72, not 4000x3000');
  deep(env.p.draws[0] || null, { w: 96, h: 72 }, 'drawImage used the downscaled size');

  section('S4 cache — re-rendering the panel must not re-decode');
  // renderLibraryPanel() rebuilds every row on each keystroke. Before v7.22.0
  // that was a fresh full-resolution <img> every time.
  let got2 = 'unset';
  B.for(big, function (u) { got2 = u; });
  eq(got2, got, 'a second request is served from the cache synchronously');
  await sleep(20);
  eq(env.p.decodes, 1, 'THE POINT: the original was still decoded only once');
  const bigEntry = B.cache(big);
  eq(bigEntry ? bigEntry.state : 'MISSING', 'done', 'the cache entry is marked done');

  section('S5 a small source is passed through, not re-encoded');
  const small = { id: 2, src: 'data:SMALL-50x40' };
  let got3 = 'unset';
  B.for(small, function (u) { got3 = u; });
  await sleep(20);
  eq(got3, 'data:SMALL-50x40', 'a 50x40 source is handed back untouched');
  eq(env.p.canvases.length, 1, 'no canvas was built for it (no pointless re-encode)');
  eq(env.p.decodes, 2, 'but it was still decoded once, to measure it');

  section('S6 a failed decode is cached as null — no retry storm');
  const bad = { id: 3, src: 'data:BROKEN' };
  let got4 = 'unset';
  B.for(bad, function (u) { got4 = u; });
  await sleep(20);
  eq(got4, null, 'a broken image yields null (the row falls back to the glyph)');
  eq(env.p.decodes, 3, 'it was tried once');
  let got5 = 'unset';
  B.for(bad, function (u) { got5 = u; });
  await sleep(20);
  eq(got5, null, 'the second request is answered from the cache');
  eq(env.p.decodes, 3, 'a broken image is NOT retried (150 broken rows stay at 150)');

  section('S7 no source at all -> null, synchronously');
  let got6 = 'unset';
  B.for({ id: 4 }, function (u) { got6 = u; });
  eq(got6, null, 'an item with no src gets null immediately');

  section('S8 concurrent requests coalesce into one decode');
  const env2 = makeEnv(function () { return { w: 4000, h: 3000 }; });
  env2.libThumbSrc = function (it) { return it.src; };
  const C = build(env2);
  const shared = { id: 5, src: 'data:BIG-shared' };
  const seen = [];
  C.for(shared, function (u) { seen.push('a:' + String(u).slice(-6)); });
  C.for(shared, function (u) { seen.push('b:' + String(u).slice(-6)); });
  C.for(shared, function (u) { seen.push('c:' + String(u).slice(-6)); });
  await sleep(30);
  eq(seen.length, 3, 'all three callbacks fired');
  eq(env2.p.decodes, 1, 'three callers share one decode (pending piggyback)');

  section('S9 concurrency is capped — never 150 originals at once');
  const env3 = makeEnv(function () { return { w: 4000, h: 3000 }; });
  env3.libThumbSrc = function (it) { return it.src; };
  const D = build(env3);
  for (let i = 0; i < 40; i++) D.for({ id: 100 + i, src: 'data:BIG-' + i }, function () {});
  await sleep(60);
  ok(env3.p.maxInflight <= 4, 'at most 4 originals were in flight at any moment',
    env3.p.maxInflight);
  ok(env3.p.maxInflight > 1, 'but it really did run more than one at a time (the cap is not 1)',
    env3.p.maxInflight);
  eq(env3.p.decodes, 40, 'all 40 were eventually decoded');
  eq(env3.p.canvases.length, 40, 'and each produced one 96px canvas');
  eq(env3.p.canvases.length ? env3.p.canvases[0].w : -1, 96,
    'every canvas is the thumbnail size');

  section('S10 a changed source invalidates the cache');
  const env4 = makeEnv(function () { return { w: 4000, h: 3000 }; });
  env4.libThumbSrc = function (it) { return it.src; };
  const E = build(env4);
  const swap = { id: 6, src: 'data:BIG-first' };
  E.for(swap, function () {});
  await sleep(20);
  eq(env4.p.decodes, 1, 'first source decoded');
  swap.src = 'data:BIG-second';
  let got7 = 'unset';
  E.for(swap, function (u) { got7 = u; });
  await sleep(20);
  eq(env4.p.decodes, 2, 'the new source is decoded (stale thumbnail not served)');
  ok(/THUMB2$/.test(String(got7)), 'and the caller gets the fresh thumbnail', got7);

  section('S10b an image with no intrinsic size is passed through, not broken');
  const env5 = makeEnv(function () { return { w: 0, h: 0 }; });
  env5.libThumbSrc = function (it) { return it.src; };
  const F = build(env5);
  let got8 = 'unset';
  F.for({ id: 7, src: 'data:NOSIZE' }, function (u) { got8 = u; });
  await sleep(20);
  eq(got8, 'data:NOSIZE',
    'an unmeasurable image hands the source back (it is not a broken image)');
  eq(env5.p.canvases.length, 0, 'and no canvas is built for it');

  // ── S11: structural — the row must never point at the original ────────
  section('S11 the rendered row never assigns the full-resolution source');
  // Rule 21: scoped to the row builder, not to the whole file.
  const rowBlock = HTML.slice(
    HTML.indexOf('    var src = libThumbSrc(it);'),
    HTML.indexOf('    row.appendChild(meta);'));
  ok(rowBlock.indexOf('var src = libThumbSrc(it);') > 0, 'S11 anchor found (anchor check)');
  ok(!/im\.src\s*=\s*src/.test(rowBlock),
    'the row does NOT assign the raw source to <img>');
  ok(/libThumbFor\(it,/.test(rowBlock), 'the row asks the thumbnail pipeline instead');
  ok(/showGlyph\(\)/.test(rowBlock), 'a failed decode falls back to the glyph');
  // v7.22.0: NOT isConnected. A cached thumbnail is delivered SYNCHRONOUSLY,
  // while the row is still being built — isConnected is false at that moment,
  // so guarding on it dropped every thumbnail on every render but the first
  // (found by the live smoke test: reopening the panel showed empty boxes).
  ok(!/im\.isConnected/.test(rowBlock),
    'the row does NOT guard on isConnected (a cached hit is synchronous)');
  ok(/token !== listEl\._libRenderToken/.test(rowBlock),
    'it guards on the render generation instead');
  ok(/var token = listEl\._libRenderToken;/.test(rowBlock),
    'and the token is captured per row, not per panel');
  ok(!/\nvar _libRenderToken/.test(HTML),
    'the generation is NOT a new global (rule 6m: it would break old suites)');
  eq((HTML.match(/function libThumbSrc\(it\)/g) || []).length, 1,
    'libThumbSrc is still the single definition of "what is this item image"');
  eq((HTML.match(/function libThumbGlyph\(/g) || []).length, 1,
    'the glyph fallback exists once, so the two paths cannot drift');

  section('S12 the decoded original is released (a fake <img> cannot prove GC)');
  // Pure Node has no garbage collector to interrogate, so this is a scoped
  // structural assertion (rule 21) — it is anchored INSIDE _libThumbDecode,
  // not anywhere in the file, so it cannot be satisfied by another copy.
  ok(/done\(\);\s*\n\s*img = null;/.test(DECODE),
    'the decode drops its <img> reference (scoped to _libThumbDecode)');
  ok(/img\.onload = null; img\.onerror = null;/.test(DECODE),
    'and detaches the handlers, so no event keeps the bitmap alive');

  section('S13 a failed decode restores the glyph');
  ok(/removeChild\(im\);\s*\n\s*showGlyph\(\);/.test(rowBlock),
    'the row puts the glyph back when the thumbnail cannot be made (scoped)');
  eq((HTML.match(/showGlyph\(\)/g) || []).length, 2,
    'showGlyph is called from exactly the two paths that need it');

  section('S14 the render generation is the stale-row guard');
  // Scoped to renderLibraryPanel (rule 21): the counter has to be bumped
  // where the list is rebuilt, or every generation looks the same and the
  // guard either never fires or always fires.
  const renderFn = HTML.slice(
    HTML.indexOf('function renderLibraryPanel() {'),
    HTML.indexOf('function libRowClick'));
  ok(renderFn.indexOf('function renderLibraryPanel()') === 0,
    'S14 anchor found (anchor check)');
  ok(/listEl\._libRenderToken = \(listEl\._libRenderToken \| 0\) \+ 1;/.test(renderFn),
    'renderLibraryPanel bumps the generation (scoped to the function)');
  ok(!/im\.isConnected/.test(HTML.slice(
       HTML.indexOf('function renderLibraryPanel() {'),
       HTML.indexOf('function libRowClick'))),
    'and nothing in it reaches for isConnected any more');

  console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + ': ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) { console.error('SUITE ERROR', e); process.exit(2); });
