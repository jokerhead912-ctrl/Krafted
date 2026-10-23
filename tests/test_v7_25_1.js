// v7.25.1 — the crop -> kpak size chain.
//
// A 100MB board saved as 700MB. Three separate bugs sat on one path, and all
// three share one shape: the CROP is the truth the screen shows, but the SAVE
// reads a different truth.
//   1. cropEncodeMime — the crop re-encoded EVERYTHING as PNG, because the old
//      code read the mime out of item.src with /^data:([^;,]+)/ and a dropped
//      file carries a blob: URL. A JPEG board quietly grew 5-10x.
//   2. buildManifest — d.src = i.src copied a data: URL (the whole picture,
//      base64) into manifest.json while the packer wrote the same bytes into
//      media/<id>. +33% on top of the raw copy, for every cropped image.
//   3. applyCrop — the item kept its pre-crop _sourceBlob, and saveBoardV6
//      prefers _sourceBlob over fetch(src), so the zip got the UNCROPPED
//      original. The board looked right until reload.
//
// Rule 19: an anchor proves the code exists, a unit test proves it RUNS. So
// cropEncodeMime / dataUrlByteLength are lifted out and executed, and
// buildManifest is
// executed against a stubbed board, and the tail of applyCrop (the part that
// drops the stale Blob) is executed against a fake item.

const fs = require('fs');
const path = require('path');

// KRAFTED_HTML lets the mutation harness point us at a deliberately broken
// copy. Without it every mutant is tested against the pristine file and the
// whole mutation run is decoration.
const HTML = fs.readFileSync(
  process.env.KRAFTED_HTML || path.join(__dirname, '..', '..', 'kraftpub-dev.html'),
  'utf8');

let pass = 0, fail = 0;
// A failing assertion used to print the WHOLE value. One assertion here
// compares a 400KB base64 string, and Node's stdout to a pipe is buffered:
// process.exit() at the bottom then dropped the tail of the write, so the
// summary line never reached the mutation detector and a real catch was scored
// FRAGILE. Truncate what we print — the label says what was wrong anyway.
function clip(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) return 'undefined';
  return s.length > 120 ? s.slice(0, 120) + '...[' + s.length + ' chars]' : s;
}
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  (got ' + clip(extra) + ')' : '')); }
}
function eq(a, b, label) { ok(a === b, label, a); }

// Rule 22 / 09-02: a suite has to survive its own failure. A throw in the
// middle of the file used to kill it before the tally line, and the detector
// then scored a real catch as a hole. Every block is guarded instead.
function block(n, fn) {
  console.log('\n' + n);
  try { fn(); } catch (e) { fail++; console.log('  FAIL ' + n + ' threw: ' + (e && e.message)); }
}
function countIn(re, s) { return (s.match(re) || []).length; }

// Rule 20: slice anchors carry no version string — the version scanner rides
// along and rewrites bare X.Y.Z in the current release's suites, which would
// silently empty the slice.
function slice(a, b, label) {
  const i = HTML.indexOf(a), j = HTML.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('anchor failed: ' + label);
  const s = HTML.slice(i, j);
  if (s.length < 40) throw new Error('slice too short: ' + label);
  return s;
}

// There is already ONE base64 byte counter in the source (dataUrlByteLength).
// This release briefly added a second one next to applyCrop — 病根一, caught by
// the mutation run — so the suite now asserts the copy is gone and executes
// the original.
const LENFN = slice('function dataUrlByteLength(dataUrl) {',
                    '// The original bytes, whatever shape', 'dataUrlByteLength');
const HELPERS = slice('function cropEncodeMime(item) {', 'function applyCrop() {', 'v7.25.3 helpers');
const CROP_FN = slice('function applyCrop() {', 'function startExportDrag() {', 'applyCrop');
// Rule 21: the start anchor has to be specific to applyCrop. `  item.src =
// newSrc;` alone also matches the GIF editor at 22928, which silently widened
// this slice into unrelated code (closeGifEditor) the first time.
const TAIL = slice('  const newAspect = sw / sh;', "  toast('Image cropped to '", 'applyCrop tail');
const MANIFEST = slice('function buildManifest() {',
                       '// Figure out the filename extension from a blob',
                       'buildManifest');

// ── S1 the code is there, and the old lines are gone ──────────────────────
block('S1 the code lifted (anchor checks)', function () {
  eq(countIn(/function cropEncodeMime\(/g, HTML), 1,
     'S1a exactly one cropEncodeMime (one writer, not one per crop path)');
  eq(countIn(/function dataUrlByteLength\(/g, HTML), 1,
     'S1b exactly one dataUrlByteLength — the second copy is gone');
  eq(countIn(/function dataUrlBytes\(/g, HTML), 0,
     'S1b2 the hand-rolled duplicate does not exist any more');
  ok(/function cropEncodeMime\(/.test(HELPERS), 'S1c cropEncodeMime lifted');
  ok(/function dataUrlByteLength\(/.test(LENFN), 'S1d dataUrlByteLength lifted');
  ok(CROP_FN.indexOf('dataUrlByteLength(newSrc)') >= 0,
     'S1d2 the crop records its size through the one counter');
  // Scoped to applyCrop (rule 21): the old inline mime sniff lived here.
  ok(CROP_FN.indexOf('match(/^data:') < 0,
     'S1e applyCrop no longer sniffs the mime out of item.src itself');
  ok(CROP_FN.indexOf('cropEncodeMime(item)') >= 0,
     'S1f ...it goes through the one writer instead');
  ok(HELPERS.indexOf('match(/^data:') >= 0,
     'S1g cropEncodeMime still reads an ALREADY-inlined data: URL (2nd choice)');
  ok(CROP_FN.indexOf('  const newAspect = sw / sh;') >= 0,
     'S1g2 the tail slice really starts inside applyCrop');
  // Scoped to buildManifest: the unconditional copy is the 2.33x.
  ok(MANIFEST.indexOf('d.src = i.src;') < 0,
     'S1h buildManifest no longer copies src unconditionally');
  ok(MANIFEST.indexOf("i.src.startsWith('data:')") >= 0,
     'S1i ...it drops data: URLs, which the packer already carries');
});

// ── S2 cropEncodeMime runs ────────────────────────────────────────────────
{
  const api = new Function('Blob', HELPERS +
    '\nreturn { cropEncodeMime: cropEncodeMime };')(Blob);
  const apiLen = new Function(LENFN + '\nreturn dataUrlByteLength;')();
  const blobOf = function (type) { return new Blob([new Uint8Array([1, 2, 3])], { type: type }); };

  block('S2 cropEncodeMime (executed)', function () {
    // The actual bug: a JPEG dropped from Finder. src is a blob: URL, so the
    // old /^data:/ sniff was always null and this came back as PNG.
    eq(api.cropEncodeMime({ _sourceBlob: blobOf('image/jpeg'), src: 'blob:http://x/9' }),
       'image/jpeg', 'S2a a JPEG dropped from Finder stays a JPEG (the 5-10x bug)');
    eq(api.cropEncodeMime({ _sourceBlob: blobOf('image/png'), src: 'blob:http://x/9' }),
       'image/png', 'S2b a PNG stays a PNG');
    eq(api.cropEncodeMime({ _sourceBlob: blobOf('image/webp'), src: 'blob:http://x/9' }),
       'image/webp', 'S2c a WebP stays a WebP');
    // 2nd choice: an already-inlined data: URL (crop of a crop).
    eq(api.cropEncodeMime({ src: 'data:image/webp;base64,AAAA' }),
       'image/webp', 'S2d a data: URL still tells us the format');
    eq(api.cropEncodeMime({ src: 'data:image/jpeg;base64,AAAA' }),
       'image/jpeg', 'S2e ...including JPEG');
    // 3rd choice: the file's own extension (set by applyImportMeta).
    eq(api.cropEncodeMime({ src: 'blob:http://x/9', filename: 'photo.JPG' }),
       'image/jpeg', 'S2f the extension is read case-insensitively');
    eq(api.cropEncodeMime({ src: 'blob:http://x/9', filename: 'photo.webp' }),
       'image/webp', 'S2g ...for webp too');
    eq(api.cropEncodeMime({ src: 'blob:http://x/9', name: 'still.jpg' }),
       'image/jpeg', 'S2h item.name works when there is no filename');
    // Nothing knows anything -> PNG, which is the only safe default.
    eq(api.cropEncodeMime({ src: 'blob:http://x/9' }),
       'image/png', 'S2i an unknown source falls back to PNG');
    eq(api.cropEncodeMime({}), 'image/png', 'S2j an empty item does not throw');
    // A canvas cannot encode gif / svg / avif. Claiming it can would hand back
    // a PNG labelled as something else.
    eq(api.cropEncodeMime({ _sourceBlob: blobOf('image/gif') }),
       'image/png', 'S2k a GIF becomes PNG (canvas cannot write GIF)');
    eq(api.cropEncodeMime({ _sourceBlob: blobOf('image/svg+xml') }),
       'image/png', 'S2l an SVG becomes PNG');
    eq(api.cropEncodeMime({ _sourceBlob: blobOf('') }),
       'image/png', 'S2m a Blob with no type does not win over the fallbacks');
  });

  // ── S3 dataUrlByteLength runs ───────────────────────────────────────────
  block('S3 dataUrlByteLength (executed)', function () {
    eq(apiLen('data:image/png;base64,' + 'A'.repeat(4)), 3,
       'S3a 4 base64 chars = 3 bytes');
    eq(apiLen('data:image/png;base64,' + 'abc='), 2,
       'S3b one pad character is one byte we do not have');
    eq(apiLen('data:image/png;base64,' + 'ab=='), 1,
       'S3c two pads, two bytes short');
    eq(apiLen('data:image/png;base64,' + 'A'.repeat(400)), 300,
       'S3d 400 chars = 300 bytes (the size a real crop reports)');
    // The no-comma path is a rough fallback the writer already had; the only
    // caller here is toDataURL(), which always has one. Pin that it stays a
    // number rather than pinning a value nobody depends on.
    ok(Number.isFinite(apiLen('not-a-data-url')), 'S3e a non-data string yields a number, not NaN');
    eq(apiLen(''), 0, 'S3f the empty string is 0');
    ok(Number.isFinite(apiLen(undefined)), 'S3f2 undefined does not throw');
  });
}

// ── S4 buildManifest runs ─────────────────────────────────────────────────
function runManifest(items) {
  const state = {
    items: items,
    texts: [], todos: [], mindmaps: [], groups: [], views: [], relations: [],
    pan: { x: 0, y: 0 }, zoom: 1
  };
  const G = { drawStrokes: [], nextId: 1, nextZ: 1, nextStrokeId: 1, nextViewId: 1, nextGroupId: 1 };
  const paperState = { enabled: false, autoFit: false, width: 100, height: 100, color: '#fff' };
  const document = { documentElement: {} };
  const getComputedStyle = function () { return { getPropertyValue: function () { return '#101010'; } }; };
  const console_ = { log: function () {}, warn: function () {}, error: function () {} };
  const fn = new Function(
    'state', 'G', 'paperState', 'document', 'getComputedStyle', 'console',
    'serializeBoardText', 'serializeGroup', 'serializeView',
    MANIFEST + '\nreturn buildManifest();'
  );
  return fn(state, G, paperState, document, getComputedStyle, console_,
            function (t) { return t; }, function (g) { return g; }, function (v) { return v; });
}

block('S4 buildManifest (executed)', function () {
  const BIG = 'data:image/png;base64,' + 'Q'.repeat(400000);  // ~300 KB of picture
  const m = runManifest([
    { id: 'cropped', src: BIG, w: 100, h: 100 },
    { id: 'fresh', src: 'blob:http://localhost/abc-123', w: 100, h: 100 },
    { id: 'linked', src: 'https://cdn.example.com/a.jpg', isLink: true, w: 100, h: 100 }
  ]);
  eq(m.items[0].src, '', 'S4a a cropped (data:) image leaves no bytes in the manifest');
  eq(m.items[1].src, 'blob:http://localhost/abc-123',
     'S4b a blob: URL is kept (it is a short string and the v6 load remaps it)');
  eq(m.items[2].src, 'https://cdn.example.com/a.jpg',
     'S4c a remote / link image keeps its src — it has no zip entry to remap from');
  const json = JSON.stringify(m);
  ok(json.indexOf('QQQQ') < 0, 'S4d the manifest carries none of the image bytes');
  ok(json.length < 4000, 'S4e ...so a 300KB picture does not make the manifest 300KB',
     json.length);
  // The packer is what carries them; if it did not, S4a would lose the picture.
  ok(countIn(/startsWith\('data:'\)/g, HTML) >= 3,
     'S4f every packer still carries data: srcs (blobItems filter) — else S4a loses media');
});

// ── S5 the tail of applyCrop runs ─────────────────────────────────────────
block('S5 applyCrop tail (executed)', function () {
  const dataUrlByteLength = new Function(LENFN + '\nreturn dataUrlByteLength;')();
  const newSrc = 'data:image/jpeg;base64,' + 'A'.repeat(400);   // 300 bytes
  const oldBlob = { marker: 'pre-crop original' };
  const item = {
    id: 'k1', w: 200, h: 150, cropX: 9, cropY: 8,
    _sourceBlob: oldBlob, _fileSize: 12345,
    img: { src: 'blob:http://x/old' }
  };
  const styled = [], refreshed = [], saved = [], framed = [];
  const state = { cropping: null };
  const run = new Function(
    'item', 'newSrc', 'sw', 'sh', 'rfSetFrameFields', 'updateItemStyle',
    'refreshSelection', 'scheduleAutoSave', 'state', 'toast', 'dataUrlByteLength',
    TAIL
  );
  run(item, newSrc, 400, 300,
      function (it, f) { framed.push(f); },
      function (it) { styled.push(it.id); },
      function () { refreshed.push(1); },
      function () { saved.push(1); },
      state,
      function () {},
      dataUrlByteLength);

  eq(item.src, newSrc, 'S5a the cropped pixels are what the item shows');
  eq(item.natW, 400, 'S5b the natural size follows the crop');
  eq(item.natH, 300, 'S5c ...both axes');
  eq(item.cropX, 0, 'S5d the legacy pan is zeroed (or migrateLegacyCrop reframes it)');
  eq(item.cropY, 0, 'S5e ...both axes');
  eq(item.img.src, newSrc, 'S5f the <img> is repointed too');
  // THE BUG: saveBoardV6 prefers _sourceBlob over fetch(src).
  eq(item._sourceBlob, null,
     'S5g the pre-crop Blob is dropped, so the zip cannot save the UNCROPPED original');
  // ...and the size has to follow, or the save estimate falls back to 5MB/item.
  eq(item._fileSize, 300, 'S5h the new byte size is recorded (not the stale 12345)');
  eq(framed.length, 1, 'S5i the baked frame is reset once');
  ok(framed[0] && framed[0].on === false && framed[0].rot === 0,
     'S5j ...and reset to flat, so the crop is not framed a second time', framed[0]);
  eq(styled.join(','), 'k1', 'S5k the item is restyled');
  eq(refreshed.length, 1, 'S5l the selection is refreshed');
  eq(saved.length, 1, 'S5m autosave is scheduled');
});

block('S6 the tail survives a crop with no <img> and no stale Blob', function () {
  const dataUrlByteLength = new Function(LENFN + '\nreturn dataUrlByteLength;')();
  const item = { id: 'k2', w: 10, h: 10 };
  let threw = false;
  try {
    new Function('item', 'newSrc', 'sw', 'sh', 'rfSetFrameFields', 'updateItemStyle',
      'refreshSelection', 'scheduleAutoSave', 'state', 'toast', 'dataUrlByteLength', TAIL)(
      item, 'data:image/png;base64,AAAA', 2, 2,
      function () {}, function () {}, function () {}, function () {}, { cropping: null },
      function () {}, dataUrlByteLength);
  } catch (e) { threw = true; }
  ok(!threw, 'S6a a bare item does not throw');
  eq(item._sourceBlob, null, 'S6b ...and still ends with no stale Blob');
  eq(item._fileSize, 3, 'S6c ...and a recorded size');
});

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES: ' + fail) + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
