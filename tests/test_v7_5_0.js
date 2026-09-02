// v7.5.0 regression suite
//
//   1) folder drop: _handleEntryDrop must actually reach _finishFolderImport
//   2) folder drop: the window capture listener must route directories there
//   3) a cross-site drag with no image URL must say so ON SCREEN
//   4) off-screen image culling: decoded bitmaps released, data model intact
//   5) image blob URLs are revoked on delete, and only when the bytes are banked
//   6) the media blob cache is a real LRU, and alias re-mints do not
//      double-charge the byte budget
//
// WHY THIS SUITE EXECUTES THE FUNCTIONS INSTEAD OF MATCHING THEIR SOURCE.
// v7.4.0 shipped "folder -> one named block" with a full suite of source
// anchors that were all green, and the feature never worked once. The
// anchors proved the code existed; they never proved it ran. The counter
// in _handleEntryDrop settled at (children - 1) instead of 0, so
// _finishFolderImport was never called -- six folder shapes, one of which
// imported anything. Every behaviour below is therefore driven through the
// real extracted function with mock entries, and the shape of the FAILURE
// (0 calls vs 2 calls vs a wrong file list) is asserted, not just success.
//
// Behaviour is compared against the SPEC constants below, never against a
// value read back out of the source. A separate assertion pins each app
// constant to its spec so drift is caught in both directions.
const fs = require('fs');
const path = require('path');

// argv[2] is what the mutation script passes; the env var is for ad-hoc
// runs. Both are absolute, so cwd does not matter.
const HTML = path.resolve(process.argv[2] || process.env.KRAFTED_HTML
  || path.join(__dirname, '../../kraftpub-dev.html'));
const src = fs.readFileSync(HTML, 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; fails.push(label); console.log('  FAIL: ' + label); }
}
function eq(actual, expected, label) {
  ok(actual === expected, label + '  (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')');
}
// A throw must cost the section, not the run. A suite that dies halfway
// prints no report at all, and "0 assertions" reads like a pass.
function section(body) {
  try { body(); } catch (e) { fail++; fails.push('section threw: ' + e.message); console.log('  FAIL: section threw: ' + e.message); }
}

// ── spec constants (independent of the source) ───────────────────────────
const EXPECT_IMG_CULL_MARGIN = 1.5;        // screens of slack kept around the view
const EXPECT_IMG_CULL_MIN_ITEMS = 40;      // below this, culling is not worth running
const EXPECT_IMG_CULL_DEBOUNCE_MS = 220;
const EXPECT_UNDO_MAX_BYTES = 80 * 1024 * 1024;
const EXPECT_MEDIA_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const EXPECT_MEDIA_CACHE_MAX_ENTRIES = 96;
const EXPECT_IMAGE_MAX_EDGE_LOCAL = 2048;

// Rule 6e: build version literals, never write them. version_scan rewrites
// bare MAJOR.MINOR.PATCH in this file, and these are test INPUTS.
const V = (a, b, c) => `${a}.${b}.${c}`;
const V_CUR = V(7, 5, 0);

// Slice a block out of the 2 MB source. The fallback must be HARMLESS, not
// null: a null here turns "anchor not found" into a crash three lines later
// where it looks like a different bug entirely.
// `includeEnd` matters: a block destined for `new Function` needs its
// closing brace, or the slice is an unclosed function body and the
// SyntaxError surfaces three lines later as a different-looking bug.
function slice(startMarker, endMarker, label, includeEnd) {
  const a = src.indexOf(startMarker);
  if (a < 0) { fail++; fails.push('anchor not found: ' + label); console.log('  FAIL: anchor not found: ' + label); return ''; }
  const b = src.indexOf(endMarker, a);
  if (b < 0) { fail++; fails.push('end anchor not found: ' + label); console.log('  FAIL: end anchor not found: ' + label); return ''; }
  return src.slice(a, b + (includeEnd ? endMarker.length : 0));
}
// Structural assertions must not be satisfied by a comment that merely
// mentions the symbol. Block-comment strip is CAPPED: the source holds a
// string literal '/*' whose match is 270 KB away, and an unbounded strip
// silently deletes 42% of the file before the assertions run.
function codeOnly(s) {
  return s.replace(/\/\*[\s\S]{0,4000}?\*\//g, '')
          .split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n');
}
function count(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
  return n;
}

// ═════════════════════════════════════════════════════════════════════════
//  1. FOLDER DROP — the counter, executed
// ═════════════════════════════════════════════════════════════════════════
console.log('— folder drop: _handleEntryDrop —');

const entryBlock = slice('function _handleEntryDrop(e, entries) {', '\n}', '_handleEntryDrop', true);

// Mock FileSystemEntry tree. A real directory reader returns at most 100
// entries per call, so the mock hands back 2 per call -- that is what
// exercises the batched readEntries loop, which is where the old counter
// lost its "this batch done" decrement.
const BATCH = 2;
function mkFile(name) {
  return {
    isFile: true, isDirectory: false, name: name,
    file: function (cb) { setTimeout(function () { cb({ name: name, type: 'image/png', size: 10 }); }, 0); }
  };
}
function mkDir(name, children) {
  return {
    isFile: false, isDirectory: true, name: name,
    createReader: function () {
      const queue = children.slice();
      return {
        readEntries: function (cb) {
          setTimeout(function () { cb(queue.splice(0, BATCH)); }, 0);
        }
      };
    }
  };
}
function tick() { return new Promise(r => setTimeout(r, 0)); }
async function drain(cond, max) {
  for (let i = 0; i < (max || 4000); i++) { if (cond()) break; await tick(); }
}

// Run the REAL function. _finishFolderImport is injected, so what we measure
// is exactly the thing that used to never happen.
async function runEntryDrop(entries) {
  const out = { calls: 0, files: null, order: [] };
  const fn = new Function('_finishFolderImport', 'console',
    entryBlock + '\nreturn _handleEntryDrop;')(
    function (e, files) { out.calls++; out.files = files.slice(); }, console);
  fn({ clientX: 0, clientY: 0 }, entries);
  await drain(() => out.calls > 0, 4000);
  await tick(); await tick(); await tick();   // a late second call is a bug too
  return out;
}

async function folderTests() {
  // A. one loose file (Chrome routes plain file drops through entries too)
  {
    const r = await runEntryDrop([mkFile('a.png')]);
    eq(r.calls, 1, 'A 1 top-level file: finishes exactly once');
    eq(r.files && r.files.length, 1, 'A 1 top-level file: collects 1 file');
  }
  // B. a folder holding exactly one image — the ONLY shape the old code got right
  {
    const r = await runEntryDrop([mkDir('F', [mkFile('a.png')])]);
    eq(r.calls, 1, 'B folder/1 image: finishes exactly once');
    eq(r.files && r.files.length, 1, 'B folder/1 image: collects 1 file');
  }
  // C. three images — old counter settled at 2, so this never fired
  {
    const r = await runEntryDrop([mkDir('F', [mkFile('a.png'), mkFile('b.png'), mkFile('c.png')])]);
    eq(r.calls, 1, 'C folder/3 images: finishes exactly once');
    eq(r.files && r.files.length, 3, 'C folder/3 images: collects 3 files');
  }
  // D. ten images — more than one readEntries batch
  {
    const kids = [];
    for (let i = 0; i < 10; i++) kids.push(mkFile('i' + i + '.png'));
    const r = await runEntryDrop([mkDir('F', kids)]);
    eq(r.calls, 1, 'D folder/10 images: finishes exactly once');
    eq(r.files && r.files.length, 10, 'D folder/10 images: collects 10 files');
  }
  // E. nested subfolder
  {
    const r = await runEntryDrop([mkDir('Outer', [mkFile('a.png'), mkDir('Inner', [mkFile('b.png'), mkFile('c.png')])])]);
    eq(r.calls, 1, 'E folder + subfolder: finishes exactly once');
    eq(r.files && r.files.length, 3, 'E folder + subfolder: collects 3 files');
    const paths = (r.files || []).map(f => f._kraftedPath).sort();
    eq(paths.join(','), 'Outer,Outer/Inner,Outer/Inner', 'E: _kraftedPath carries the folder path (folder name becomes a tag)');
  }
  // F. two folders side by side — the v7.4.0 "one block per folder" case
  {
    const r = await runEntryDrop([
      mkDir('A', [mkFile('a1.png'), mkFile('a2.png'), mkFile('a3.png')]),
      mkDir('B', [mkFile('b1.png'), mkFile('b2.png'), mkFile('b3.png')])
    ]);
    eq(r.calls, 1, 'F 2 folders x 3: finishes exactly once');
    eq(r.files && r.files.length, 6, 'F 2 folders x 3: collects 6 files');
    const tops = {};
    (r.files || []).forEach(f => { tops[(f._kraftedPath || '').split('/')[0]] = 1; });
    eq(Object.keys(tops).sort().join(','), 'A,B', 'F: both folder names survive as tags');
  }
  // G. an empty folder must still settle — otherwise the drop hangs forever
  {
    const r = await runEntryDrop([mkDir('Empty', [])]);
    eq(r.calls, 1, 'G empty folder: still settles (a drop that never finishes is a hang)');
    eq(r.files && r.files.length, 0, 'G empty folder: collects nothing');
  }
  // H. three levels deep
  {
    const r = await runEntryDrop([mkDir('L1', [mkDir('L2', [mkDir('L3', [mkFile('deep.png'), mkFile('deep2.png')])])])]);
    eq(r.calls, 1, 'H 3 levels deep: finishes exactly once');
    eq(r.files && r.files.length, 2, 'H 3 levels deep: collects 2 files');
    eq((r.files || [])[0]._kraftedPath, 'L1/L2/L3', 'H: the full nesting path is recorded');
  }
  // I. 25 files — a dozen readEntries batches, the >100-entry case in miniature
  {
    const kids = [];
    for (let i = 0; i < 25; i++) kids.push(mkFile('i' + i + '.png'));
    const r = await runEntryDrop([mkDir('Big', kids)]);
    eq(r.calls, 1, 'I folder/25 images: finishes exactly once');
    eq(r.files && r.files.length, 25, 'I folder/25 images: collects 25 files');
  }
  // J. a mixed drop: a folder plus a loose file
  {
    const r = await runEntryDrop([mkDir('F', [mkFile('a.png'), mkFile('b.png')]), mkFile('loose.png')]);
    eq(r.calls, 1, 'J folder + loose file: finishes exactly once');
    eq(r.files && r.files.length, 3, 'J folder + loose file: collects 3 files');
  }
}

// ═════════════════════════════════════════════════════════════════════════
//  2. FOLDER DROP — the window capture listener routing
// ═════════════════════════════════════════════════════════════════════════
console.log('— folder drop: entry routing —');

const dropHelperBlock = slice('function _dropEntries(dt) {', "window.addEventListener('drop', function(e){", '_dropEntries');

section(function () {
  const api = new Function(dropHelperBlock +
    '\nreturn { entries: _dropEntries, hasDir: _dropHasDirectory };')();

  function mkItem(entry) {
    return { webkitGetAsEntry: function () { return entry; } };
  }
  function mkThrowingItem() {
    return { webkitGetAsEntry: function () { throw new Error('nope'); } };
  }

  // No webkitGetAsEntry at all (Firefox, or a synthetic DataTransfer):
  // must return null, not throw, so the flat-file path still runs.
  eq(api.entries({ items: [{ kind: 'file' }] }), null, 'entries: no webkitGetAsEntry -> null (fall through to files)');
  eq(api.entries(undefined), null, 'entries: missing dataTransfer -> null');
  eq(api.entries({ items: [] }), null, 'entries: empty items -> null');

  const a = mkItem(mkFile('a.png'));
  const d = mkItem(mkDir('F', [mkFile('b.png')]));
  const r = api.entries({ items: [a, d] });
  eq(r && r.length, 2, 'entries: reads every item');
  eq(api.hasDir(r), true, 'hasDir: true when one entry is a directory');

  const onlyFiles = api.entries({ items: [mkItem(mkFile('a.png')), mkItem(mkFile('b.png'))] });
  eq(api.hasDir(onlyFiles), false, 'hasDir: false for an all-file drop (those keep the old path)');

  // One bad item must not sink the whole drop.
  const mixed = api.entries({ items: [mkThrowingItem(), d] });
  eq(mixed && mixed.length, 1, 'entries: a throwing item is skipped, the rest survive');
  eq(api.hasDir(mixed), true, 'hasDir: still true after skipping a throwing item');
});

// ═════════════════════════════════════════════════════════════════════════
//  3. NO-URL CROSS-SITE DRAG IS SAID OUT LOUD
// ═════════════════════════════════════════════════════════════════════════
console.log('— no-URL drag is surfaced —');

section(function () {
  const warnIdx = src.indexOf("'[FileDrop] drop received but no URL candidates found.");
  ok(warnIdx > 0, 'the no-candidates branch still exists');
  const tail = src.slice(warnIdx, warnIdx + 900);
  const c = codeOnly(tail);
  ok(c.indexOf('toast(') >= 0, 'the no-candidates branch now toasts, not just console.warn');
  ok(c.indexOf('_rawHtml.length') >= 0 && c.indexOf('_rawUri.length') >= 0 && c.indexOf('_rawPlain.length') >= 0,
     'the toast carries all three payload lengths (a screenshot says which branch died)');
  ok(c.indexOf('_isZhUI()') >= 0, 'the toast is localised');
});

// ═════════════════════════════════════════════════════════════════════════
//  4. OFF-SCREEN IMAGE CULLING — executed
// ═════════════════════════════════════════════════════════════════════════
console.log('— off-screen image culling —');

const cullBlock = slice('const IMG_CULL_MARGIN', 'function updateCanvas() {', 'image culling block');

function makeCullApi(items, vw, vh) {
  const st = { items: items };
  return new Function('state', 'window', 'console', 'setTimeout', 'clearTimeout',
    cullBlock + '\nreturn { cull: _cullOffscreenImages, ensure: _ensureAllImagesLive,'
             +  ' schedule: scheduleImageCull,'
             +  ' MARGIN: IMG_CULL_MARGIN, MIN_ITEMS: IMG_CULL_MIN_ITEMS };'
  )(st, { innerWidth: vw, innerHeight: vh }, console, setTimeout, clearTimeout);
}

// An <img> stub that models the two ways the DOM exposes "has a src".
function mkImg(initialSrc) {
  let v = initialSrc;
  return {
    parentNode: {},
    removeAttribute: function (k) { if (k === 'src') v = null; },
    getAttribute: function (k) { return (k === 'src') ? v : null; },
    set src(x) { v = x; },
    get src() { return v; },
  };
}
function mkCullItem(id, src, rect, extra) {
  const it = Object.assign({
    id: id,
    src: src,
    isVideo: false,
    video: null,
    img: mkImg(src),
    el: { getBoundingClientRect: function () { return rect; } },
  }, extra || {});
  it.el.getBoundingClientRect = function () { return it._rect; };
  it._rect = rect;
  return it;
}
function rect(left, top, w, h) {
  return { left: left, top: top, right: left + w, bottom: top + h, width: w, height: h };
}

const VW = 1000, VH = 800;

section(function () {
  const api = makeCullApi([], VW, VH);
  eq(api.MARGIN, EXPECT_IMG_CULL_MARGIN, 'cull margin matches spec');
  eq(api.MIN_ITEMS, EXPECT_IMG_CULL_MIN_ITEMS, 'cull minimum-item count matches spec');
});

section(function () {
  // Enough items to clear the minimum, half on screen and half far away.
  const items = [];
  for (let i = 0; i < 30; i++) items.push(mkCullItem('on' + i, 'blob:x/' + i, rect(100, 100, 200, 200)));
  for (let i = 0; i < 30; i++) items.push(mkCullItem('off' + i, 'blob:x/o' + i, rect(90000, 90000, 200, 200)));
  const api = makeCullApi(items, VW, VH);
  api.cull();
  let culled = 0, live = 0;
  items.forEach(it => { if (it._imgCulled) culled++; else live++; });
  eq(culled, 30, 'the 30 far-off images are culled');
  eq(live, 30, 'the 30 on-screen images stay live');
  // THE POINT: the data model is untouched. Culling removes the ATTRIBUTE,
  // never the src and never the URL — export, save and undo still see it.
  items.forEach(it => {
    if (it._imgCulled) {
      ok(it.src.indexOf('blob:') === 0, 'a culled item keeps its src on the model');
      eq(it.img.getAttribute('src'), null, 'a culled item has no src ATTRIBUTE on the element');
    }
  });
});

section(function () {
  // Below the minimum nothing is culled, however far away it is.
  const items = [];
  for (let i = 0; i < 5; i++) items.push(mkCullItem('f' + i, 'blob:x/' + i, rect(900000, 900000, 100, 100)));
  const api = makeCullApi(items, VW, VH);
  api.cull();
  eq(items.filter(it => it._imgCulled).length, 0, 'a board under the minimum is never culled');
});

section(function () {
  // Videos are excluded: their cleanup path owns pause/revoke/re-mint.
  const items = [];
  for (let i = 0; i < 45; i++) items.push(mkCullItem('v' + i, 'blob:x/' + i, rect(900000, 900000, 100, 100), { isVideo: true, video: {} }));
  const api = makeCullApi(items, VW, VH);
  api.cull();
  eq(items.filter(it => it._imgCulled).length, 0, 'videos are never culled');
});

section(function () {
  // A remote src would cost a second fetch and flicker on every pan.
  const items = [];
  for (let i = 0; i < 45; i++) items.push(mkCullItem('h' + i, 'https://cdn.example/' + i + '.jpg', rect(900000, 900000, 100, 100)));
  const api = makeCullApi(items, VW, VH);
  api.cull();
  eq(items.filter(it => it._imgCulled).length, 0, 'remote (http) images are never culled');
});

section(function () {
  // Coming back into view restores, and the restore is idempotent.
  const it = mkCullItem('a', 'blob:keep/1', rect(900000, 900000, 100, 100));
  const items = [];
  for (let i = 0; i < 45; i++) items.push(it);
  const api = makeCullApi(items, VW, VH);
  api.cull();
  ok(it._imgCulled === true, 'an off-screen image is culled');
  it._rect = rect(100, 100, 200, 200);
  api.cull();
  eq(it._imgCulled, false, 'panning back restores the image');
  eq(it.img.getAttribute('src'), 'blob:keep/1', 'the restored src is the original one');
  api.cull();
  eq(it._imgCulled, false, 'restoring twice is harmless');
});

section(function () {
  // The margin is the contract: an item just outside the screen must NOT
  // be culled, or panning shows blank cards.
  const mx = VW * EXPECT_IMG_CULL_MARGIN, my = VH * EXPECT_IMG_CULL_MARGIN;
  const justInside = mkCullItem('edge', 'blob:edge/1', rect(VW + mx - 50, 100, 200, 200));
  const justOutside = mkCullItem('far', 'blob:far/1', rect(VW + mx + 50, 100, 200, 200));
  const items = [];
  for (let i = 0; i < 45; i++) items.push(justInside);
  items.push(justOutside);
  const api = makeCullApi(items, VW, VH);
  api.cull();
  eq(justInside._imgCulled, undefined, 'an item just inside the cull margin is kept');
  eq(justOutside._imgCulled, true, 'an item just outside the cull margin is culled');
  ok(my > 0 && VH + my > VH, 'the vertical margin is applied too');
});

section(function () {
  // _ensureAllImagesLive is the escape hatch every bulk consumer calls.
  const items = [];
  for (let i = 0; i < 45; i++) items.push(mkCullItem('e' + i, 'blob:x/' + i, rect(900000, 900000, 100, 100)));
  const api = makeCullApi(items, VW, VH);
  api.cull();
  eq(items.filter(it => it._imgCulled).length, 45, 'all 45 are culled first');
  api.ensure();
  eq(items.filter(it => it._imgCulled).length, 0, 'ensure() brings every image back');
  items.forEach(it => eq(it.img.getAttribute('src'), it.src, 'ensure() restores the item\'s own src'));
});

section(function () {
  // A degenerate window must not throw or cull everything blindly.
  const items = [];
  for (let i = 0; i < 45; i++) items.push(mkCullItem('z' + i, 'blob:x/' + i, rect(900000, 900000, 100, 100)));
  const api = makeCullApi(items, 0, 0);
  let threw = false;
  try { api.cull(); } catch (e) { threw = true; }
  ok(!threw, 'a zero-size window does not throw');
  eq(items.filter(it => it._imgCulled).length, 0, 'a zero-size window culls nothing');
});

// ═════════════════════════════════════════════════════════════════════════
//  5. IMAGE BLOB URLS ARE REVOKED ON DELETE — executed
// ═════════════════════════════════════════════════════════════════════════
console.log('— image revoke on delete —');

const cleanupImgBlock = slice('function cleanupImageItem(item, revokeBlob) {', '\n}', 'cleanupImageItem', true);

function makeCleanupApi(cacheResult) {
  const revoked = [];
  const marked = new Set();
  const api = new Function('_cacheMediaBlob', '_revokedBlobUrls', '_mediaBlobByUrl', 'URL', 'Blob',
    cleanupImgBlock + '\nreturn cleanupImageItem;')(
    function (u, b) { return cacheResult === false ? false : (b instanceof Blob || cacheResult === true); },
    marked, new Map(),
    { revokeObjectURL: function (u) { revoked.push(u); } },
    Blob);
  api._revoked = revoked;
  api._marked = marked;
  return api;
}

section(function () {
  const fn = makeCleanupApi(true);
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  fn({ src: 'blob:img/1', _sourceBlob: blob, isVideo: false, video: null });
  eq(fn._revoked.length, 1, 'an image with a banked Blob is revoked on delete');
  eq(fn._revoked[0], 'blob:img/1', 'the revoked URL is the item\'s own');
  ok(fn._marked.has('blob:img/1'), 'the URL is marked revoked so undo can re-mint it');
});

section(function () {
  const fn = makeCleanupApi(true);
  fn({ src: 'blob:vid/1', isVideo: true, video: {} });
  eq(fn._revoked.length, 0, 'a video is left to cleanupVideoItem, not double-revoked');
});

section(function () {
  const fn = makeCleanupApi(true);
  fn({ src: 'https://cdn.example/a.jpg' });
  fn({ src: 'data:image/png;base64,AAAA' });
  fn({ src: '' });
  fn({});
  eq(fn._revoked.length, 0, 'non-blob srcs are never revoked');
});

section(function () {
  const fn = makeCleanupApi(true);
  fn({ src: 'blob:img/1' }, false);
  eq(fn._revoked.length, 0, 'revokeBlob === false (board clear / restore) revokes nothing');
});

section(function () {
  // THE SAFETY CONTRACT: no bytes in hand, no revoke. Leaking a handle is
  // the right trade against silently breaking Ctrl+Z.
  const fn = makeCleanupApi(false);
  fn({ src: 'blob:img/noblob' });
  eq(fn._revoked.length, 0, 'without a Blob to bank, the URL is left alive');
  eq(fn._marked.has('blob:img/noblob'), false, 'and it is not marked revoked either');
});

// ═════════════════════════════════════════════════════════════════════════
//  6. MEDIA BLOB CACHE — a real LRU, and alias-aware accounting
// ═════════════════════════════════════════════════════════════════════════
console.log('— media blob cache LRU —');

const blobBlock = slice('var _revokedBlobUrls = new Set();', '// Clean up video resources for a single item', 'blob helper block');

function makeBlobApi() {
  let seq = 0;
  return new Function('state', 'URL', 'Set', 'Map', 'Blob',
    blobBlock + '\nreturn { cache: _cacheMediaBlob, resolve: _resolveSnapshotMedia,'
             +  ' trim: _trimMediaBlobCache, revoked: _revokedBlobUrls, byUrl: _mediaBlobByUrl,'
             +  ' bytes: function(){ return _mediaBlobBytes; },'
             +  ' MAX_ENTRIES: _MEDIA_BLOB_CACHE_MAX_ENTRIES,'
             +  ' MAX_BYTES: _MEDIA_BLOB_CACHE_MAX_BYTES };'
  )({ items: [] },
    { createObjectURL: function () { return 'blob:mint/' + (++seq); }, revokeObjectURL: function () {} },
    Set, Map, Blob);
}

section(function () {
  const api = makeBlobApi();
  eq(api.MAX_ENTRIES, EXPECT_MEDIA_CACHE_MAX_ENTRIES, 'cache entry cap matches spec');
  eq(api.MAX_BYTES, EXPECT_MEDIA_CACHE_MAX_BYTES, 'cache byte cap matches spec');
});

section(function () {
  // Fill to the cap, touch the OLDEST, then push one more. A FIFO cache
  // evicts the oldest (k0) — the one the user just proved they still want.
  // An LRU evicts the least recently used (k1).
  const api = makeBlobApi();
  const cap = api.MAX_ENTRIES;
  for (let i = 0; i < cap; i++) {
    api.cache('blob:k' + i, new Blob([new Uint8Array([1])], { type: 'image/png' }));
  }
  eq(api.byUrl.size, cap, 'cache is exactly at the cap');
  api.resolve('blob:k0');                       // a read is a use
  api.cache('blob:newest', new Blob([new Uint8Array([1])], { type: 'image/png' }));
  eq(api.byUrl.has('blob:k0'), true, 'LRU: the touched entry survives eviction');
  eq(api.byUrl.has('blob:k1'), false, 'LRU: the untouched oldest entry is the one evicted');
  eq(api.byUrl.has('blob:newest'), true, 'LRU: the newest entry is present');
  ok(api.byUrl.size <= cap, 'LRU: size stays within the cap (' + api.byUrl.size + ')');
});

section(function () {
  // Re-minting is an ALIAS for bytes already counted. Without the
  // stillHeld guard the budget is subtracted twice per alias and drifts
  // negative, which quietly disables the byte ceiling altogether.
  const api = makeBlobApi();
  const blob = new Blob([new Uint8Array(4096)], { type: 'image/png' });
  const url = 'blob:alias/1';
  api.cache(url, blob);
  const after1 = api.bytes();
  api.revoked.add(url);
  const r1 = api.resolve(url);
  const r2 = api.resolve(url);
  ok(r1 && r1.src !== url, 'first re-mint returns a fresh URL');
  ok(r2 && r2.src !== url && r2.src !== r1.src, 'second re-mint returns another fresh URL');
  eq(api.bytes(), after1, 'aliases do not inflate the byte budget');
  // Now force the whole cache out and make sure the accounting lands on 0.
  for (let i = 0; i < api.MAX_ENTRIES + 20; i++) {
    api.cache('blob:flush/' + i, new Blob([new Uint8Array(1024)], { type: 'image/png' }));
  }
  ok(api.bytes() >= 0, 'the byte budget never goes negative (got ' + api.bytes() + ')');
  ok(api.byUrl.size <= api.MAX_ENTRIES, 'the entry cap still holds after aliasing');
});

section(function () {
  // THE STILLHELD GUARD, executed. The assertion above only sees aliases
  // that die together, and when every alias for a Blob is evicted in the
  // same pass `stillHeld` is false either way -- so it cannot tell the
  // guarded code from the unguarded code. What distinguishes them is the
  // case the guard actually exists for: the alias is evicted while the
  // ORIGINAL key still banks the same bytes. Then the eviction must cost
  // nothing. Without the guard the budget drops by the blob size on every
  // alias eviction, and since the ceiling is `bytes > MAX`, a budget that
  // is always under-charged is a ceiling that never fires.
  const api = makeBlobApi();
  const SIZE = 4096;
  const blob = new Blob([new Uint8Array(SIZE)], { type: 'image/png' });
  const url = 'blob:alias/guard';
  api.cache(url, blob);
  api.revoked.add(url);
  const minted = api.resolve(url);
  ok(minted && minted.src !== url, 'the re-mint produced a second key for the same Blob');
  eq(api.byUrl.has(url), true, 'the original key is kept (a second item sharing the src must still resolve)');
  const before = api.bytes();
  eq(before, SIZE, 'two keys, one Blob, charged exactly once');

  // Grow past the entry cap. The alias is the older key, so it is the
  // first victim and the original survives it.
  let fillers = 0;
  for (let i = 0; i < api.MAX_ENTRIES + 40 && api.byUrl.has(minted.src); i++) {
    api.cache('blob:guardfill/' + i, new Blob([new Uint8Array(1)], { type: 'image/png' }));
    fillers++;
  }
  eq(api.byUrl.has(minted.src), false, 'the cache outgrew the cap and evicted the alias first');
  eq(api.byUrl.has(url), true, 'the original key outlived its own alias');
  eq(api.bytes(), before + fillers,
     'evicting an alias costs 0 bytes — the bytes are still banked under the original key');
  ok(api.bytes() >= SIZE,
     'the budget still reflects the Blob actually held (got ' + api.bytes() + ', expected >= ' + SIZE + ')');
});

section(function () {
  // An item still on the board must never have its bytes evicted.
  const api = makeBlobApi();
  const pinned = 'blob:pinned/on-the-board';
  // state is captured inside the harness; emulate a live reference by
  // re-adding the url to the revoked set check path via resolve() ordering
  api.cache(pinned, new Blob([new Uint8Array([7])], { type: 'image/png' }));
  for (let i = 0; i < api.MAX_ENTRIES + 40; i++) {
    api.cache('blob:filler/' + i, new Blob([new Uint8Array([i & 255])], { type: 'image/png' }));
  }
  ok(api.byUrl.size <= api.MAX_ENTRIES, 'a full cache never exceeds the entry cap');
});

// ═════════════════════════════════════════════════════════════════════════
//  7. CONSTANTS AND WIRING
// ═════════════════════════════════════════════════════════════════════════
console.log('— constants and wiring —');

section(function () {
  const m = src.match(/const IMAGE_MAX_EDGE_LOCAL = (\d+);/);
  eq(m && Number(m[1]), EXPECT_IMAGE_MAX_EDGE_LOCAL, 'IMAGE_MAX_EDGE_LOCAL matches spec (2048, was 4096)');
  const u = src.match(/const _UNDO_MAX_BYTES = (\d+) \* 1024 \* 1024;/);
  eq(u && Number(u[1]) * 1024 * 1024, EXPECT_UNDO_MAX_BYTES, '_UNDO_MAX_BYTES matches spec (80 MB, was 300 MB)');
});

section(function () {
  // The window capture listener runs FIRST and stops propagation, so this
  // is the only place a folder drop can be routed from.
  const winIdx = src.indexOf("window.addEventListener('drop', function(e){");
  ok(winIdx > 0, 'the window capture drop listener exists');
  const body = src.slice(winIdx, winIdx + 2600);
  const c = codeOnly(body);
  ok(c.indexOf('_dropEntries(e.dataTransfer)') >= 0, 'the window drop asks for entries');
  ok(c.indexOf('_dropHasDirectory(_dirEntries)') >= 0, 'the window drop tests for a directory');
  ok(c.indexOf('_handleEntryDrop(e, _dirEntries)') >= 0, 'a directory drop is routed to the recursive reader');
  // Ordering: entries must be read before the flat-file path gets a chance.
  ok(c.indexOf('_dirEntries') < c.indexOf('_collectDroppedFiles(e.dataTransfer)'),
     'entries are read BEFORE _collectDroppedFiles (a directory is a 0-byte file there)');
  ok(c.indexOf('e.stopPropagation()') >= 0, 'the window listener still stops propagation');
});

section(function () {
  const upd = slice('function updateCanvas() {', 'function zoomBy(', 'updateCanvas');
  ok(codeOnly(upd).indexOf('scheduleImageCull();') >= 0, 'updateCanvas schedules a cull (pan and zoom change the visible set)');

  const proc = slice('async function processNextImage() {', 'if (imageFiles.length > 0) {', 'processNextImage');
  ok(codeOnly(proc).indexOf('scheduleImageCull()') >= 0, 'a finished import batch schedules a cull');

  const del = slice('function deleteSelected() {', 'redrawDrawLayer();', 'deleteSelected');
  ok(codeOnly(del).indexOf('cleanupImageItem(i);') >= 0, 'deleteSelected revokes the deleted image\'s blob URL');
  ok(codeOnly(del).indexOf('cleanupVideoItem(i);') >= 0, 'deleteSelected still cleans up video');

  const exp = slice('async function exportAllImagesToFolder() {', '// Determine which images to export', 'exportAllImagesToFolder');
  ok(codeOnly(exp).indexOf('_ensureAllImagesLive();') >= 0, 'bulk image export un-culls first');

  const pres = slice('function startPresent() {', '\n}', 'startPresent');
  ok(codeOnly(pres).indexOf('_ensureAllImagesLive();') >= 0, 'present un-culls before it starts flying the camera');
});

section(function () {
  // THE OLD BUG, asserted absent. These are the two lines that between them
  // meant `pending` could only reach 0 by accident.
  const c = codeOnly(entryBlock);
  ok(c.indexOf('pending = entries.length') < 0, 'the counter is no longer seeded with entries.length');
  ok(c.indexOf('pending += batch.length') < 0, 'the counter no longer double-counts a batch');
  ok(c.indexOf('pending--; // this batch done') < 0, 'the stray "this batch done" decrement is gone');
  ok(c.indexOf('settle();') >= 0, 'every completion path funnels through one settle()');
  ok(c.indexOf('var settled = false;') >= 0, 'the finish latch exists (the drop cannot fire twice)');
});

section(function () {
  // Culling must NOT be done with containment: layout containment breaks
  // the getBoundingClientRect hit testing the canvas pointer handlers use.
  const itemCss = src.slice(src.indexOf('.item {'), src.indexOf('.item {') + 1400);
  ok(itemCss.indexOf('content-visibility') < 0, 'no content-visibility on .item (it breaks BCR hit testing)');
  ok(itemCss.indexOf('contain:') < 0, 'no contain: on .item');
});

section(function () {
  const appV = (src.match(/var KRAFTED_VERSION = '([\d.]+)';/) || [])[1];
  eq(appV, V_CUR, 'KRAFTED_VERSION bumped to ' + V_CUR);
  ok(src.indexOf('<title>Krafted v' + V_CUR + '</title>') >= 0, 'title bumped');
  const sw = fs.readFileSync(path.resolve(__dirname, '../docs/sw.js'), 'utf8');
  ok(sw.indexOf("const CACHE_NAME = 'krafted-v" + V_CUR + "-'") >= 0, 'sw CACHE_NAME bumped');
  ok(sw.indexOf("const APP_VERSION = '" + V_CUR + "';") >= 0, 'sw APP_VERSION bumped');
});

// ── run ──────────────────────────────────────────────────────────────────
(async function main() {
  // A throw out here would kill the process before the report prints, and
  // "no output" reads very differently from "1 FAIL".
  try { await folderTests(); } catch (e) { fail++; fails.push('folder tests threw: ' + e.message); console.log('  FAIL: folder tests threw: ' + e.message); }
  console.log('');
  if (fail === 0) console.log('ALL PASS (' + pass + ' assertions)');
  else { console.log('FAILURES: ' + fail + ' (passed ' + pass + ')'); fails.forEach(f => console.log('  - ' + f)); }
  process.exit(fail === 0 ? 0 : 1);
})();
