// v7.0.39 regression suite (assertions pinned to the shipped v7.0.42)
//   1) delete a video -> Ctrl+Z -> the clip must come back playable
//   2) right-click near a screen edge -> the whole menu must stay on screen
//
// Behaviour assertions compare against the SPEC constants below, never
// against a value read out of the source (that would be tautological).
// A separate assertion pins each app constant to the spec so drift is caught.
const fs = require('fs');
const path = require('path');

const HTML = path.resolve(__dirname, '../../kraftpub-v6.8.0.html');
const src = fs.readFileSync(HTML, 'utf8');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; console.log('  FAIL: ' + label); }
}
function eq(actual, expected, label) {
  ok(actual === expected, label + '  (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')');
}
function near(a, b, tol, label) {
  ok(Math.abs(a - b) <= tol, label + '  (got ' + a + ', want ~' + b + ')');
}

// ── spec constants (independent of the source) ───────────────────────────
const EXPECT_MAX_ENTRIES = 64;
const EXPECT_MAX_BYTES = 1024 * 1024 * 1024;
const EXPECT_EDGE_MARGIN = 8;

function slice(startMarker, endMarker, label) {
  const a = src.indexOf(startMarker);
  if (a < 0) { console.log('  FAIL: anchor not found: ' + label); fail++; return ''; }
  const b = src.indexOf(endMarker, a);
  if (b < 0) { console.log('  FAIL: end anchor not found: ' + label); fail++; return ''; }
  return src.slice(a, b);
}

// ── 1. blob resurrection helpers ─────────────────────────────────────────
const blobBlock = slice(
  'var _revokedBlobUrls = new Set();',
  '// Clean up video resources for a single item',
  'blob helper block'
);

let seq = 0;
const FakeURL = {
  createObjectURL: function (blob) { return 'blob:mock/' + (++seq); },
  revokeObjectURL: function () {},
};

const blobApi = new Function(
  'state', 'URL', 'Set', 'Map', 'Blob',
  blobBlock + '\nreturn { _cacheMediaBlob: _cacheMediaBlob, _resolveSnapshotMedia: _resolveSnapshotMedia,'
           +  ' _trimMediaBlobCache: _trimMediaBlobCache, _revokedBlobUrls: _revokedBlobUrls,'
           +  ' _mediaBlobByUrl: _mediaBlobByUrl,'
           +  ' getBytes: function(){ return _mediaBlobBytes; },'
           +  ' MAX_ENTRIES: _MEDIA_BLOB_CACHE_MAX_ENTRIES,'
           +  ' MAX_BYTES: _MEDIA_BLOB_CACHE_MAX_BYTES };'
)({ items: [] }, FakeURL, Set, Map, Blob);

console.log('— blob resurrection —');

// The app constant must match the spec, or the behaviour tests below are
// measuring the wrong thing.
eq(blobApi.MAX_ENTRIES, EXPECT_MAX_ENTRIES, 'cache entry cap matches spec');
eq(blobApi.MAX_BYTES, EXPECT_MAX_BYTES, 'cache byte cap matches spec');

// A URL we never touched must pass straight through, unchanged.
const liveUrl = 'blob:live/original-clip';
const liveRes = blobApi._resolveSnapshotMedia(liveUrl);
ok(liveRes !== null, 'an untouched blob URL resolves');
eq(liveRes && liveRes.src, liveUrl, 'an untouched blob URL is returned verbatim');

// data: and http(s) are not ours to manage.
eq(blobApi._resolveSnapshotMedia('data:video/mp4;base64,AAAA').src, 'data:video/mp4;base64,AAAA', 'data: URL passes through');
eq(blobApi._resolveSnapshotMedia('https://cdn.example/clip.mp4').src, 'https://cdn.example/clip.mp4', 'http URL passes through');

// Empty src must not be treated as "gone for good" — the generic item branch
// handles src-less items by building the element anyway.
eq(blobApi._resolveSnapshotMedia(''), null, 'empty src resolves to null (caller guards it)');

// THE BUG: a URL we revoked with no Blob in hand cannot be brought back, and
// the caller must be told so instead of building a black <video>.
const orphanUrl = 'blob:orphan/no-blob-kept';
blobApi._revokedBlobUrls.add(orphanUrl);
eq(blobApi._resolveSnapshotMedia(orphanUrl), null, 'a revoked URL with no cached Blob resolves to null');

// THE FIX: with the Blob in hand, the same URL mints a fresh, live one.
const clipBytes = new Uint8Array([1, 2, 3, 4, 5]);
const clipUrl = 'blob:clip/deleted-then-undone';
ok(blobApi._cacheMediaBlob(clipUrl, new Blob([clipBytes], { type: 'video/mp4' })) === true, 'caching a real Blob succeeds');
blobApi._revokedBlobUrls.add(clipUrl);
const revived = blobApi._resolveSnapshotMedia(clipUrl);
ok(revived !== null, 'a revoked URL with a cached Blob resolves');
ok(!!revived && revived.src !== clipUrl, 'the revived URL is a NEW url, not the dead one');
ok(!!revived && revived.src.indexOf('blob:') === 0, 'the revived URL is still a blob URL');
ok(!!revived && revived.blob instanceof Blob, 'the revived result carries the Blob');

// Undo must keep working on repeat: delete -> undo -> delete -> undo.
const revived2 = blobApi._resolveSnapshotMedia(clipUrl);
ok(revived2 !== null && revived2.src.indexOf('blob:') === 0, 'the same dead URL resolves again on a second undo');

// _cacheMediaBlob rejects things it cannot resurrect from, so cleanupVideoItem
// can decide not to revoke.
eq(blobApi._cacheMediaBlob('data:image/png;base64,AA', new Blob([clipBytes])), false, 'non-blob URL is not cached');
eq(blobApi._cacheMediaBlob('blob:x/y', 'not-a-blob'), false, 'a non-Blob value is not cached');
eq(blobApi._cacheMediaBlob('', new Blob([clipBytes])), false, 'an empty URL is not cached');
eq(blobApi._cacheMediaBlob('blob:x/y', null), false, 'a null Blob is not cached');

// ── cache bounding ───────────────────────────────────────────────────────
console.log('— cache bounding —');
{
  // A Blob a live item still points at must never be evicted: that would
  // break the board the user is looking at, not just their history.
  const st = { items: [] };
  const api2 = new Function(
    'state', 'URL', 'Set', 'Map', 'Blob',
    blobBlock + '\nreturn { _cacheMediaBlob: _cacheMediaBlob, _mediaBlobByUrl: _mediaBlobByUrl,'
             +  ' MAX_ENTRIES: _MEDIA_BLOB_CACHE_MAX_ENTRIES };'
  )(st, FakeURL, Set, Map, Blob);

  const pinnedUrl = 'blob:pinned/on-the-board';
  st.items.push({ src: pinnedUrl });
  api2._cacheMediaBlob(pinnedUrl, new Blob([new Uint8Array([9])]));
  for (let i = 0; i < 200; i++) {
    api2._cacheMediaBlob('blob:filler/' + i, new Blob([new Uint8Array([i & 255])]));
  }
  ok(api2._mediaBlobByUrl.has(pinnedUrl), 'a Blob still referenced by a live item is never evicted');
  ok(api2._mediaBlobByUrl.size <= EXPECT_MAX_ENTRIES, 'cache stays under the entry cap (got ' + api2._mediaBlobByUrl.size + ')');
}

// ── 2. context menu placement ─────────────────────────────────────────────
console.log('— context menu placement —');
const ctxBlock = slice('function positionCtxMenu(x, y) {', 'function hideCtx()', 'positionCtxMenu');

function makeMenu(w, h) {
  return { offsetWidth: w, offsetHeight: h, style: {} };
}
function place(menu, x, y, vw, vh) {
  const fn = new Function('ctxMenu', 'window',
    ctxBlock + '\nreturn positionCtxMenu;')(menu, { innerWidth: vw, innerHeight: vh });
  fn(x, y);
  return {
    left: parseFloat(menu.style.left),
    top: parseFloat(menu.style.top),
    maxHeight: menu.style.maxHeight,
    overflowY: menu.style.overflowY,
  };
}

const VW = 1512, VH = 982;

// Dead centre: no flip, no clamp.
{
  const m = makeMenu(200, 400);
  const p = place(m, 700, 300, VW, VH);
  eq(p.left, 700, 'mid-screen menu keeps its x');
  eq(p.top, 300, 'mid-screen menu keeps its y');
  eq(p.maxHeight, undefined, 'mid-screen menu needs no max-height');
}

// Near the right edge with room to the left: flip.
{
  const m = makeMenu(200, 400);
  const p = place(m, VW - 20, 300, VW, VH);
  ok(p.left + 200 <= VW - EXPECT_EDGE_MARGIN, 'right-edge menu stays inside the right edge');
  ok(p.left >= EXPECT_EDGE_MARGIN, 'right-edge menu stays inside the left edge');
}

// Near the bottom edge with room above: flip upward, and the BOTTOM entry
// (the one the user complained about) must be reachable.
{
  const m = makeMenu(200, 400);
  const p = place(m, 300, VH - 20, VW, VH);
  ok(p.top + 400 <= VH - EXPECT_EDGE_MARGIN, 'bottom-edge menu keeps every entry on screen');
  ok(p.top >= EXPECT_EDGE_MARGIN, 'bottom-edge menu stays inside the top edge');
}

// Bottom-right corner: both flip.
{
  const m = makeMenu(200, 400);
  const p = place(m, VW - 5, VH - 5, VW, VH);
  ok(p.left + 200 <= VW - EXPECT_EDGE_MARGIN, 'corner menu fits horizontally');
  ok(p.top + 400 <= VH - EXPECT_EDGE_MARGIN, 'corner menu fits vertically');
}

// Taller than the window with no room above: clamp and scroll rather than
// hiding the entries off screen.
{
  const m = makeMenu(200, 1400);
  const p = place(m, 300, 400, VW, VH);
  eq(p.maxHeight, (VH - 2 * EXPECT_EDGE_MARGIN) + 'px', 'oversized menu gets a max-height');
  eq(p.overflowY, 'auto', 'oversized menu becomes scrollable');
  eq(p.top, EXPECT_EDGE_MARGIN, 'oversized menu is pinned to the top margin');
}

// THE behaviour test that matters: for every cursor position on the screen,
// the menu must lie inside the viewport.
{
  let outside = 0, worst = '';
  const sizes = [[170, 200], [200, 400], [220, 700], [200, 1400], [400, 300]];
  for (const [w, h] of sizes) {
    for (let x = 0; x <= VW; x += 37) {
      for (let y = 0; y <= VH; y += 41) {
        const m = makeMenu(w, h);
        const p = place(m, x, y, VW, VH);
        const effH = p.maxHeight ? parseFloat(p.maxHeight) : h;
        const bad = (p.left < EXPECT_EDGE_MARGIN - 0.001)
          || (p.top < EXPECT_EDGE_MARGIN - 0.001)
          || (p.left + w > VW - EXPECT_EDGE_MARGIN + 0.001)
          || (p.top + effH > VH - EXPECT_EDGE_MARGIN + 0.001);
        if (bad) { outside++; if (!worst) worst = `x=${x} y=${y} w=${w} h=${h} -> left=${p.left} top=${p.top}`; }
      }
    }
  }
  eq(outside, 0, 'no menu position ever falls outside the viewport (' + worst + ')');
}

// A menu taller than the window must be reachable by scrolling.
{
  const m = makeMenu(200, 1400);
  const p = place(m, 300, 400, VW, VH);
  ok(p.overflowY === 'auto' && parseFloat(p.maxHeight) > 0, 'an oversized menu can be scrolled to reach the bottom');
}

// ── 3. wiring ─────────────────────────────────────────────────────────────
console.log('— wiring —');

const cleanupFn = slice('function cleanupVideoItem(item, revokeBlob) {', '\n}', 'cleanupVideoItem');
ok(cleanupFn.indexOf('_cacheMediaBlob(') >= 0, 'cleanupVideoItem caches the Blob before revoking');
ok(cleanupFn.indexOf('URL.revokeObjectURL(vsrc);\n  }\n}') >= 0 || cleanupFn.indexOf('URL.revokeObjectURL(vsrc);') >= 0,
   'cleanupVideoItem still revokes (now gated)');
// The old unconditional revoke must be gone.
ok(!/\n\s*if \(revokeBlob && vsrc && vsrc\.startsWith\('blob:'\)\) URL\.revokeObjectURL\(vsrc\);/.test(src),
   'the unconditional revoke is gone');
ok(cleanupFn.indexOf('_mediaBlobByUrl.get(vsrc)') >= 0, 'cleanupVideoItem falls back to an already-cached Blob');

const applyFn = slice('function applySnapshot(snap) {', '// Restore texts', 'applySnapshot');
ok(applyFn.indexOf('_resolveSnapshotMedia(data.src)') >= 0, 'undo restores video src through the resolver');
ok(applyFn.indexOf('item._sourceBlob = _rm.blob') >= 0, 'undo puts the Blob back on the live item');
ok(applyFn.indexOf('_audRm') >= 0, 'undo restores audio src through the resolver');

const showCtxFn = slice('function showCtx(x, y) {', '\n// Keep the context menu inside the viewport', 'showCtx');
ok(showCtxFn.indexOf('positionCtxMenu(x, y)') >= 0, 'showCtx places the menu through positionCtxMenu');
ok(showCtxFn.indexOf("ctxMenu.style.maxHeight = ''") >= 0, 'showCtx resets max-height before measuring');

ok(src.indexOf("var KRAFTED_VERSION = '7.0.46';") >= 0, 'KRAFTED_VERSION bumped');
ok(src.indexOf('<title>Krafted v7.0.46</title>') >= 0, 'title bumped');
const sw = fs.readFileSync(path.resolve(__dirname, '../../Krafted/docs/sw.js'), 'utf8');
ok(sw.indexOf("const CACHE_NAME = 'krafted-v7.0.46-'") >= 0, 'sw CACHE_NAME bumped');
ok(sw.indexOf("const APP_VERSION = '7.0.46';") >= 0, 'sw APP_VERSION bumped');

console.log('');
console.log(fail === 0 ? 'ALL PASS (' + pass + ' assertions)' : 'FAILURES: ' + fail + ' (passed ' + pass + ')');
process.exit(fail === 0 ? 0 : 1);
