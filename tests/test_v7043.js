// v7.0.43 regression suite — Restore actually brings the media back
//
//   "I restore and all I get is a pile of empty shells. If the feature
//    can't be made to work, remove the button — if it can, fix it."
//
// Root cause: serializeBoard() cleared every blob:/data: src and set
// videoLost/imageLost, on the strength of a comment claiming "media is
// reloaded from original files/kpak". Nothing on the autosave path ever
// did that reload. A blob: URL is a handle into the document that minted
// it, so after a reload the handle dangles and the item keeps its frame
// but loses its content. That is the empty shell.
//
// Behaviour assertions compare against the SPEC constants below, never
// against a value read out of the source (that would be tautological).
// A separate assertion pins each app constant to the spec.
//
// The functions under test are EXTRACTED FROM THE REAL SOURCE and executed
// against a fake IndexedDB and a fake state. A grep for "getMediaBlob"
// somewhere in a 37K-line file would have passed against every broken
// version of this feature — including the one the user is complaining about.
const fs = require('fs');
const path = require('path');

// KRAFTED_HTML / KRAFTED_SW let the mutation check point the suite at a
// deliberately broken COPY, so the real dev file is never touched.
const HTML = process.env.KRAFTED_HTML
  ? path.resolve(process.env.KRAFTED_HTML)
  : path.resolve(__dirname, '../../kraftpub-v6.8.0.html');
const SW = process.env.KRAFTED_SW
  ? path.resolve(process.env.KRAFTED_SW)
  : path.resolve(__dirname, '../../Krafted/docs/sw.js');
const src = fs.readFileSync(HTML, 'utf8');
const sw = fs.readFileSync(SW, 'utf8');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; console.log('  FAIL: ' + label); }
}
function eq(actual, expected, label) {
  ok(actual === expected, label + '  (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')');
}
function count(hay, needle) { return hay.split(needle).length - 1; }

// ── spec constants (independent of the source) ───────────────────────────
const EXPECT_PREFIX    = 'autosave-media:';   // sentinel written in place of a blob: URL
const EXPECT_MAX_BLOB  = 512 * 1024 * 1024;   // refuse to mirror anything larger
const EXPECT_STORE     = 'KraftedMediaStore'; // IndexedDB object store for the bytes
const EXPECT_DB_VER    = 2;                   // v1 had no media store
const EXPECT_VERSION   = '7.0.47';

// Extract a whole function body by brace matching. None of the functions
// under test contains a brace inside a string literal, so a plain counter
// is safe here.
function fnFull(name, s) {
  const a = s.indexOf('function ' + name + '(');
  if (a < 0) { console.log('  FAIL: no function ' + name); fail++; return ''; }
  let depth = 0, begun = false;
  for (let i = a; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') { depth++; begun = true; }
    else if (ch === '}') { depth--; }
    if (begun && depth === 0) return s.slice(a, i + 1);
  }
  console.log('  FAIL: unbalanced function ' + name); fail++;
  return '';
}
function slice(startMarker, endMarker, label) {
  const a = src.indexOf(startMarker);
  if (a < 0) { console.log('  FAIL: anchor not found: ' + label); fail++; return ''; }
  const b = src.indexOf(endMarker, a);
  if (b < 0) { console.log('  FAIL: end anchor not found: ' + label); fail++; return ''; }
  return src.slice(a, b);
}
// Strip comments, so an assertion about CODE is never satisfied — or
// defeated — by the comment explaining it. Two things forced this:
//   - the note "v5.5 used to set videoLost/imageLost" reads as if the code
//     still sets it;
//   - commenting a call out with /* ... */ leaves the text behind, so a
//     bare indexOf() reports the call is still live. Both were caught by
//     the mutation check, not by reading.
// Block comments go first: dropping a // line can leave an unterminated
// /* .. */ behind, and vice versa.
function codeOnly(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(function (l) { return l.trim().indexOf('//') !== 0; })
    .join('\n');
}

// ═══════════════════════════════════════════════════════════════════════
//  Harness — the shipped functions are lifted out of the source and run
//  verbatim against these doubles.
// ═══════════════════════════════════════════════════════════════════════
function makeStore(initial) {
  const m = new Map();
  (initial || []).forEach(function (kv) { m.set(String(kv[0]), kv[1]); });
  return m;
}

// A fake KraftedStorage that behaves like the real one: keys are coerced to
// strings, a missing key resolves to null, and every call is logged so the
// suite can assert on ORDER (ready() must precede the first read).
function makeFakeKS(opts) {
  opts = opts || {};
  const log = [];
  const store = opts.store || makeStore();
  const KS = {
    _store: store,
    _log: log,
    isReady: function () { return opts.ready !== false; },
    ready: function () {
      log.push('ready');
      return opts.failReady
        ? Promise.reject(new Error('db down'))
        : Promise.resolve(null);
    },
    saveMediaBlob: function (k, b) {
      log.push('put:' + k);
      if (opts.failPut) return Promise.reject(new Error('quota'));
      store.set(String(k), b);
      return Promise.resolve(true);
    },
    getMediaBlob: function (k) {
      log.push('get:' + k);
      if (opts.failGet) return Promise.reject(new Error('read error'));
      return Promise.resolve(store.has(String(k)) ? store.get(String(k)) : null);
    },
    removeMediaBlob: function (k) {
      log.push('del:' + k);
      store.delete(String(k));
      return Promise.resolve(true);
    },
    listMediaKeys: function () {
      log.push('keys');
      return Promise.resolve(Array.from(store.keys()));
    },
  };
  return KS;
}

// Compile the five functions under test, with every free identifier bound
// to a double. Adding a new global dependency to one of them without
// updating this list turns into a ReferenceError, not a silent pass.
const FN_NAMES = [
  'autosaveMediaItems',
  'markAutosaveMediaLost',
  'persistAutosaveMedia',
  'rehydrateAutosaveMedia',
  'probeAutosaveMedia',
];
function buildFns(env) {
  const bodies = FN_NAMES.map(function (n) { return fnFull(n, src); }).join('\n\n');
  const ret = 'return {' + FN_NAMES.map(function (n) { return n + ': ' + n; }).join(', ') + '};';
  const factory = new Function(
    'window', 'state', 'fetch', 'URL', 'AUTOSAVE_MEDIA_PREFIX',
    'AUTOSAVE_MAX_BLOB_BYTES', 'formatBytes', 'console',
    bodies + '\n' + ret
  );
  return factory(
    env.window, env.state, env.fetch, env.URL,
    env.AUTOSAVE_MEDIA_PREFIX, env.AUTOSAVE_MAX_BLOB_BYTES,
    env.formatBytes, env.console || { warn: function () {}, log: function () {} }
  );
}

// A minimal env. Callers override what they need.
function env(over) {
  over = over || {};
  const base = {
    window: { KraftedStorage: over.KS || null },
    state: over.state || { items: [] },
    fetch: over.fetch || function () { return Promise.reject(new Error('no fetch double')); },
    URL: { createObjectURL: function (b) { return 'blob:minted/' + (b && b.__tag ? b.__tag : 'x'); } },
    AUTOSAVE_MEDIA_PREFIX: over.PREFIX !== undefined ? over.PREFIX : EXPECT_PREFIX,
    AUTOSAVE_MAX_BLOB_BYTES: over.MAX !== undefined ? over.MAX : EXPECT_MAX_BLOB,
    formatBytes: function (n) { return String(n) + 'B'; },
    console: { warn: function () {}, log: function () {} },
  };
  if (!base.window.KraftedStorage) delete base.window.KraftedStorage;
  return base;
}

console.log('Krafted v' + EXPECT_VERSION + ' — Restore / autosave media persistence');

// ═══════════════════════════════════════════════════════════════════════
// 1. Constants pinned to the spec
// ═══════════════════════════════════════════════════════════════════════
ok(src.indexOf("const AUTOSAVE_MEDIA_PREFIX = '" + EXPECT_PREFIX + "';") >= 0,
   'sentinel prefix is ' + EXPECT_PREFIX);
ok(src.indexOf('const AUTOSAVE_MAX_BLOB_BYTES = 512 * 1024 * 1024;') >= 0,
   'blob mirror refuses files over 512MB');
ok(src.indexOf("var MEDIA_STORE_NAME = '" + EXPECT_STORE + "';") >= 0,
   'media lives in its own object store, not the string KV store');
ok(src.indexOf('var DB_VERSION = ' + EXPECT_DB_VER + ';') >= 0,
   'DB_VERSION bumped to ' + EXPECT_DB_VER + ' so the store gets created');

// The upgrade branch has to create the store, or every read on an upgraded
// database throws and the whole feature silently no-ops.
{
  const up = slice('req.onupgradeneeded = function(e) {', 'req.onsuccess = function(e) {', 'onupgradeneeded');
  ok(up.indexOf('MEDIA_STORE_NAME') >= 0, 'onupgradeneeded knows about the media store');
  ok(up.indexOf('createObjectStore(MEDIA_STORE_NAME') >= 0, 'onupgradeneeded creates the media store');
  ok(up.indexOf('objectStoreNames.contains(MEDIA_STORE_NAME') >= 0,
     'store creation is guarded, so a v2->v2 open does not throw');
}

// ═══════════════════════════════════════════════════════════════════════
// 2. What serializeBoard actually writes — the shipped expression, executed
// ═══════════════════════════════════════════════════════════════════════
//
// This is the line that produced the empty shells. It used to be
//   d.src = ''; d.imageLost = true;
// so the suite executes the REAL text out of the file rather than trusting
// a comment about it.
function shippedSrcExpr() {
  const marker = 'src: (i.src && i.src.indexOf(';
  const a = src.indexOf(marker);
  if (a < 0) return null;
  const b = src.indexOf(',\n', a);
  if (b < 0) return null;
  return src.slice(a + 'src: '.length, b);
}
{
  const expr = shippedSrcExpr();
  ok(expr !== null, 'serializeBoard src expression located in the source');
  if (expr) {
    // Executing the shipped text means a future edit is TESTED, not merely
    // detected — if someone reverts it to `d.src = ''` this throws or the
    // assertions below fail on behaviour, not on spelling.
    let appFn = null;
    try {
      appFn = new Function('i', 'AUTOSAVE_MEDIA_PREFIX', 'return ' + expr + ';');
    } catch (e) {
      ok(false, 'serializeBoard src expression is executable: ' + e.message);
    }
    if (appFn) {
      const P = EXPECT_PREFIX;
      eq(appFn({ id: 7, src: 'blob:http://x/abc-123' }, P), P + '7',
         'a blob: URL serializes to the sentinel, NOT to an empty string');
      eq(appFn({ id: 7, src: 'https://cdn.example/a.png' }, P), 'https://cdn.example/a.png',
         'a real URL is stored as itself');
      eq(appFn({ id: 9, src: 'data:image/png;base64,AAAA' }, P), 'data:image/png;base64,AAAA',
         'a data: URL stays inline — it already survives a reload on its own');
      eq(appFn({ id: 3, src: '' }, P), '', 'an empty src stays empty');
      eq(appFn({ id: 3 }, P), '', 'a missing src serializes to an empty string');
      // The whole point: the sentinel has to survive the round trip, i.e.
      // the id has to be recoverable from what was written.
      eq((P + '7').slice(P.length), '7', 'the item id is recoverable from the sentinel');
    }
  }
}

// The v5.5 clearing blocks must be gone. If they come back they overwrite
// the sentinel with '' and the shells return.
{
  const sb = codeOnly(slice('function serializeBoard() {', '\n    texts: state.texts.map', 'serializeBoard body'));
  ok(sb.indexOf('videoLost') < 0, 'serializeBoard no longer WRITES videoLost');
  ok(sb.indexOf('imageLost') < 0, 'serializeBoard no longer WRITES imageLost');
  ok(sb.indexOf("d.src = ''") < 0, 'serializeBoard no longer blanks d.src');
  ok(sb.indexOf('AUTOSAVE_MEDIA_PREFIX') >= 0, 'serializeBoard writes the sentinel constant');

  // The comment that caused this bug claimed media was reloaded elsewhere.
  // Pin the absence of that claim so it cannot quietly come back.
  const sbDoc = slice('// Backwards-compatible sync serialize', 'function serializeBoard() {', 'serializeBoard doc');
  ok(sbDoc.indexOf('media is reloaded from original files') < 0,
     'the doc comment no longer claims media is reloaded from the original files');
}

// ...but restoreBoard must still READ the flags, or autosaves written by
// 7.0.42 and earlier lose their grey placeholders and break instead.
{
  // Slice past the forEach opening — the reads live INSIDE the loop body.
  const rb = slice('function restoreBoard(data, append) {', "if (d.type === 'draw') {", 'restoreBoard head');
  ok(rb.indexOf('d.videoLost') >= 0, 'restoreBoard still READS videoLost (old autosaves)');
  ok(rb.indexOf('d.imageLost') >= 0, 'restoreBoard still READS imageLost (old autosaves)');
}

// ═══════════════════════════════════════════════════════════════════════
// 3. markAutosaveMediaLost — the fallback when the bytes really are gone
// ═══════════════════════════════════════════════════════════════════════
{
  const F = buildFns(env());
  const P = EXPECT_PREFIX;

  const v = { id: 1, src: P + '1', isVideo: true };
  F.markAutosaveMediaLost(v);
  eq(v.src, '', 'a lost video has its sentinel cleared');
  ok(v.videoLost === true, 'a lost video is flagged videoLost');
  ok(v.imageLost === undefined, 'a lost video is NOT flagged imageLost');

  const img = { id: 2, src: P + '2' };
  F.markAutosaveMediaLost(img);
  eq(img.src, '', 'a lost image has its sentinel cleared');
  ok(img.imageLost === true, 'a lost image is flagged imageLost');
  ok(img.videoLost === undefined, 'a lost image is NOT flagged videoLost');

  const au = { id: 3, src: P + '3', isAudio: true };
  F.markAutosaveMediaLost(au);
  ok(au.videoLost === true, 'a lost audio clip takes the videoLost branch (not imageLost)');

  // Idempotent + scoped: this runs over the whole item list, so it must not
  // touch anything that is not a sentinel.
  const keep = { id: 4, src: 'https://cdn.example/a.png' };
  F.markAutosaveMediaLost(keep);
  eq(keep.src, 'https://cdn.example/a.png', 'a live URL is left alone');
  ok(keep.imageLost === undefined && keep.videoLost === undefined, 'a live URL gets no lost flag');

  const empty = { id: 5, src: '' };
  F.markAutosaveMediaLost(empty);
  eq(empty.src, '', 'an already-empty src is left alone');
  ok(empty.imageLost === undefined, 'an already-empty src gets no lost flag');

  F.markAutosaveMediaLost(null);
  F.markAutosaveMediaLost(undefined);
  F.markAutosaveMediaLost({ id: 6 });
  ok(true, 'null / undefined / src-less items do not throw');
}

// ═══════════════════════════════════════════════════════════════════════
// 4. autosaveMediaItems — what has to be mirrored
// ═══════════════════════════════════════════════════════════════════════
{
  const st = {
    items: [
      { id: 1, src: 'blob:http://x/a' },
      { id: 2, src: 'https://cdn.example/b.png' },
      { id: 3, src: 'data:image/png;base64,AAAA' },
      { id: 4 },
      { id: 5, src: '' },
      null,
      { id: 6, src: 'blob:http://x/c', isVideo: true },
    ],
  };
  const F = buildFns(env({ state: st }));
  const got = F.autosaveMediaItems().map(function (i) { return i.id; });
  eq(got.length, 2, 'only the two blob: items need mirroring');
  eq(got.join(','), '1,6', 'http / data: / empty / null items are excluded');

  eq(buildFns(env({ state: {} })).autosaveMediaItems().length, 0,
     'a board with no items array mirrors nothing');
}

// ═══════════════════════════════════════════════════════════════════════
// 5. rehydrateAutosaveMedia — turning sentinels back into live media
// ═══════════════════════════════════════════════════════════════════════
(async function asyncSections() {
  const P = EXPECT_PREFIX;

  // 5a. happy path: both blobs are in the store
  {
    const KS = makeFakeKS({ store: makeStore([[7, { __tag: 'seven' }], [8, { __tag: 'eight' }]]) });
    const F = buildFns(env({ KS: KS }));
    const data = {
      items: [
        { id: 7, src: P + '7' },
        { id: 8, src: P + '8', isVideo: true },
      ],
    };
    const res = await F.rehydrateAutosaveMedia(data);
    eq(data.items[0].src, 'blob:minted/seven', 'a stored image rehydrates to a fresh object URL');
    eq(data.items[1].src, 'blob:minted/eight', 'a stored video rehydrates to a fresh object URL');
    eq(res.lost, 0, 'nothing is reported lost when both blobs are present');
    ok(data.items[0].imageLost === undefined, 'a rehydrated image is not flagged lost');
  }

  // 5b. missing bytes -> the old grey placeholder, not a broken element
  {
    const KS = makeFakeKS({ store: makeStore([[7, { __tag: 'seven' }]]) });
    const F = buildFns(env({ KS: KS }));
    const data = {
      items: [
        { id: 7, src: P + '7' },
        { id: 8, src: P + '8', isVideo: true },
      ],
    };
    const res = await F.rehydrateAutosaveMedia(data);
    eq(data.items[0].src, 'blob:minted/seven', 'the item whose bytes survived still rehydrates');
    eq(data.items[1].src, '', 'the item whose bytes are gone is cleared, not left as a sentinel');
    ok(data.items[1].videoLost === true, 'the missing video is flagged so restoreBoard can placeholder it');
    eq(res.lost, 1, 'exactly one file is reported unrecoverable');
  }

  // 5c. THE RACE. IndexedDB opens asynchronously. If the read fires before
  // openDB() settles, every lookup resolves null and Restore hands back the
  // exact empty shells this version exists to eliminate.
  {
    const KS = makeFakeKS({ store: makeStore([[7, { __tag: 'seven' }]]) });
    const F = buildFns(env({ KS: KS }));
    await F.rehydrateAutosaveMedia({ items: [{ id: 7, src: P + '7' }] });
    eq(KS._log[0], 'ready', 'the media store is awaited before anything is read');
    ok(KS._log.indexOf('get:7') > KS._log.indexOf('ready'),
       'the blob read happens strictly after ready() resolves');
  }

  // 5d. no storage at all (private mode, IndexedDB blocked)
  {
    const F = buildFns(env());
    const data = { items: [{ id: 1, src: P + '1' }, { id: 2, src: P + '2', isVideo: true }] };
    const res = await F.rehydrateAutosaveMedia(data);
    eq(res.lost, 2, 'with no storage both files are reported unrecoverable');
    ok(data.items[0].imageLost === true && data.items[1].videoLost === true,
       'with no storage every sentinel degrades to a placeholder');
  }

  // 5e. a read error must not take the whole restore down with it
  {
    const KS = makeFakeKS({ failGet: true });
    const F = buildFns(env({ KS: KS }));
    const data = { items: [{ id: 1, src: P + '1' }] };
    const res = await F.rehydrateAutosaveMedia(data);
    eq(res.lost, 1, 'a failing read counts as lost rather than throwing');
    eq(data.items[0].src, '', 'a failing read still clears the sentinel');
  }

  // 5f. non-sentinel srcs are never touched
  {
    const KS = makeFakeKS({ store: makeStore([[7, { __tag: 'seven' }]]) });
    const F = buildFns(env({ KS: KS }));
    const data = { items: [{ id: 7, src: 'https://cdn.example/a.png' }] };
    await F.rehydrateAutosaveMedia(data);
    eq(data.items[0].src, 'https://cdn.example/a.png', 'a plain URL is not rehydrated');
    eq(KS._log.indexOf('get:7'), -1, 'no store read is issued for a plain URL');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 6. probeAutosaveMedia — the number under the button
  // ═══════════════════════════════════════════════════════════════════════
  {
    const KS = makeFakeKS({ store: makeStore([[1, {}], [3, {}]]) });
    const F = buildFns(env({ KS: KS }));
    const data = { items: [{ id: 1, src: P + '1' }, { id: 2, src: P + '2' }, { id: 3, src: P + '3' }] };
    const snapshot = JSON.stringify(data.items);
    const p = await F.probeAutosaveMedia(data);
    eq(p.sentinels, 3, 'probe counts every sentinel');
    eq(p.found, 2, 'probe counts the blobs that are really there');
    eq(p.lost, 1, 'probe counts the ones that are not');
    eq(JSON.stringify(data.items), snapshot, 'probing does not mutate the autosave data');
  }
  {
    const F = buildFns(env());
    const p = await F.probeAutosaveMedia({ items: [{ id: 1, src: P + '1' }] });
    eq(p.found, 0, 'with no storage the probe finds nothing');
    eq(p.lost, 1, 'with no storage the probe reports everything lost');
  }
  {
    const F = buildFns(env({ KS: makeFakeKS({ store: makeStore() }) }));
    const p = await F.probeAutosaveMedia({ items: [{ id: 1, src: 'https://cdn.example/a.png' }] });
    eq(p.sentinels, 0, 'a plain URL is not a sentinel');
    eq(p.lost, 0, 'a plain URL is not reported lost');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 7. persistAutosaveMedia — getting the bytes onto disk
  // ═══════════════════════════════════════════════════════════════════════
  {
    let fetches = 0;
    const fetchFn = function (u) {
      fetches++;
      return Promise.resolve({ blob: function () { return Promise.resolve({ __tag: u.slice(-1), size: 1234 }); } });
    };
    const KS = makeFakeKS();
    const st = {
      items: [
        { id: 1, src: 'blob:http://x/a', _fileSize: 1234 },
        { id: 2, src: 'blob:http://x/b', _fileSize: 1234, isVideo: true },
        { id: 3, src: 'https://cdn.example/c.png', _fileSize: 1234 },
        // A board loaded from a .kpak keeps whatever ids the file used, and
        // those are not guaranteed to be integers. The key has to survive
        // the round trip through the store for ANY id, or the blob is
        // written under one key and pruned under another.
        { id: 'clip-A', src: 'blob:http://x/d', _fileSize: 1234 },
      ],
    };
    const F = buildFns(env({ KS: KS, state: st, fetch: fetchFn }));

    await F.persistAutosaveMedia();
    eq(fetches, 3, 'only the three blob: items are fetched');
    eq(KS._store.size, 3, 'all three blobs land in the media store');
    ok(KS._store.has('1') && KS._store.has('2'), 'blobs are keyed by String(item id)');
    ok(KS._store.has('clip-A'), 'a non-numeric id keeps its own key (not "NaN")');
    eq(st.items[0]._asMediaSavedFor, 'blob:http://x/a', 'a successful mirror is recorded');

    // Second autosave with nothing changed: re-reading a big clip every 5s
    // would stall the tab, so the mirror must be skipped.
    await F.persistAutosaveMedia();
    eq(fetches, 3, 'an unchanged blob: URL is not re-fetched on the next autosave');
    eq(KS._store.size, 3, 'the store is unchanged on the second pass');

    // Replacing the media on the same item must re-mirror.
    st.items[0].src = 'blob:http://x/a2';
    await F.persistAutosaveMedia();
    eq(fetches, 4, 'a changed blob: URL is re-fetched (the third item is unchanged)');
    eq(st.items[0]._asMediaSavedFor, 'blob:http://x/a2', 'the recorded mirror follows the new URL');
  }

  // 7b. oversize files are refused BEFORE being read into memory — the
  // pre-flight uses _fileSize, because fetch().blob() would already have
  // buffered the whole thing by the time we could say no.
  {
    let fetches = 0;
    const fetchFn = function (u) {
      fetches++;
      return Promise.resolve({ blob: function () { return Promise.resolve({ size: 999999999999 }); } });
    };
    const KS = makeFakeKS();
    const st = { items: [{ id: 1, src: 'blob:http://x/huge', _fileSize: EXPECT_MAX_BLOB + 1 }] };
    const F = buildFns(env({ KS: KS, state: st, fetch: fetchFn }));
    await F.persistAutosaveMedia();
    eq(fetches, 0, 'an oversize file is refused without being fetched into RAM');
    eq(KS._store.size, 0, 'an oversize file is not written to the store');
  }

  // 7c. garbage collection: deleting an item must not leave its blob behind
  // forever. Nothing else in the app knows an item id has gone away.
  {
    const fetchFn = function (u) {
      return Promise.resolve({ blob: function () { return Promise.resolve({ __tag: u.slice(-1), size: 10 }); } });
    };
    const KS = makeFakeKS({ store: makeStore([[99, { __tag: 'orphan' }]]) });
    const st = { items: [{ id: 1, src: 'blob:http://x/a', _fileSize: 10 }] };
    const F = buildFns(env({ KS: KS, state: st, fetch: fetchFn }));
    await F.persistAutosaveMedia();
    ok(!KS._store.has('99'), 'a blob whose item no longer exists is pruned');
    ok(KS._store.has('1'), 'the live item blob is kept');
    ok(KS._log.indexOf('keys') >= 0, 'the prune reads the current key list first');
  }

  // 7d. a failing mirror must not reject — it is fire-and-forget from
  // scheduleAutoSave, and an unhandled rejection there would be worse than
  // losing the mirror.
  {
    const fetchFn = function () { return Promise.reject(new Error('network')); };
    const KS = makeFakeKS();
    const st = { items: [{ id: 1, src: 'blob:http://x/a', _fileSize: 10 }] };
    const F = buildFns(env({ KS: KS, state: st, fetch: fetchFn }));
    let threw = false;
    try { await F.persistAutosaveMedia(); } catch (e) { threw = true; }
    ok(!threw, 'a failed fetch does not reject persistAutosaveMedia');
    eq(st.items[0]._asMediaSavedFor, undefined,
       'a failed mirror is not recorded as done, so the next autosave retries');
  }
  {
    const fetchFn = function () {
      return Promise.resolve({ blob: function () { return Promise.resolve({ size: 10 }); } });
    };
    const KS = makeFakeKS({ failPut: true });
    const st = { items: [{ id: 1, src: 'blob:http://x/a', _fileSize: 10 }] };
    const F = buildFns(env({ KS: KS, state: st, fetch: fetchFn }));
    let threw = false;
    try { await F.persistAutosaveMedia(); } catch (e) { threw = true; }
    ok(!threw, 'a failed store write does not reject persistAutosaveMedia');
    // The guard has to be set only after the write SUCCEEDS. Setting it
    // first means one quota error silently disables the mirror for that
    // item for the rest of the session.
    eq(st.items[0]._asMediaSavedFor, undefined,
       'a failed store write is not recorded as mirrored, so the next autosave retries');
  }
  // 7e. storage not ready yet -> do nothing, do not half-write
  {
    let fetches = 0;
    const fetchFn = function () { fetches++; return Promise.resolve({ blob: function () { return Promise.resolve({ size: 1 }); } }); };
    const KS = makeFakeKS({ ready: false });
    const st = { items: [{ id: 1, src: 'blob:http://x/a', _fileSize: 1 }] };
    const F = buildFns(env({ KS: KS, state: st, fetch: fetchFn }));
    await F.persistAutosaveMedia();
    eq(fetches, 0, 'nothing is fetched while the DB is not ready');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 8. Wiring — the parts that only exist as call sites
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Every slice below goes through codeOnly(). Commenting a call out with
  // /* ... */ leaves the text behind, so a bare indexOf() happily reports
  // the call is still there — the mutation check caught exactly that.
  {
    const sched = codeOnly(fnFull('scheduleAutoSave', src));
    ok(sched.indexOf('persistAutosaveMedia()') >= 0,
       'scheduleAutoSave mirrors the media after writing the layout');
    ok(sched.indexOf('localStorage.setItem') >= 0,
       'scheduleAutoSave still writes the layout (the mirror must not replace it)');
  }
  {
    const load = codeOnly(fnFull('loadAutoSave', src));
    ok(load.indexOf('rehydrateAutosaveMedia(data)') >= 0, 'loadAutoSave rehydrates before restoring');
    ok(load.indexOf('restoreBoard(data, false)') >= 0, 'loadAutoSave still calls restoreBoard');
    ok(load.indexOf('discardAutoSave()') >= 0 && load.indexOf('/* discardAutoSave()') < 0,
       'loadAutoSave consumes the autosave, so the offer stops reappearing every reload');
    // Order matters: rehydrate -> restore -> discard.
    ok(load.indexOf('rehydrateAutosaveMedia') < load.indexOf('restoreBoard'),
       'rehydration happens before the board is rebuilt');
    // lastIndexOf, not indexOf: discardAutoSave() is also called on the
    // "nothing to restore" early return, which is of course before the
    // restore. What matters is the one on the success path.
    ok(load.indexOf('restoreBoard') < load.lastIndexOf('discardAutoSave'),
       'the autosave is discarded only after the restore succeeds');
    ok(load.indexOf("res.lost") >= 0, 'the restore toast admits when files could not be recovered');
  }
  {
    const offer = codeOnly(fnFull('offerAutoSave', src));
    ok(offer.indexOf('probeAutosaveMedia(data)') >= 0, 'offerAutoSave probes before offering');
    ok(offer.indexOf('(data.texts || []).length') >= 0,
       'the offer counts text/todo/mindmap content too, not just items');
    ok(offer.indexOf('p.sentinels > 0 && p.found === 0 && extra === 0') >= 0,
       'an all-shells autosave is retired instead of being offered');
    ok(offer.indexOf('discardAutoSave()') >= 0, 'offerAutoSave can retire a useless autosave');
    ok(/p\.lost\)\s*parts\.push/.test(offer) || /parts\.push\(p\.lost/.test(offer),
       'the label admits how much is unrecoverable');
  }
  {
    const api = codeOnly(slice('window.KraftedStorage = {', '\n  };', 'KraftedStorage API'));
    ok(api.indexOf('saveMediaBlob:') >= 0, 'the API exposes saveMediaBlob');
    ok(api.indexOf('getMediaBlob:') >= 0, 'the API exposes getMediaBlob');
    ok(api.indexOf('removeMediaBlob:') >= 0, 'the API exposes removeMediaBlob');
    ok(api.indexOf('listMediaKeys:') >= 0, 'the API exposes listMediaKeys (needed for GC)');
    ok(api.indexOf('ready:') >= 0, 'the API exposes ready() so callers can await the open');
  }
  {
    const readyFn = slice('ready: function() {', '}\n  };', 'ready()');
    ok(readyFn.indexOf('openDB()') >= 0, 'ready() is built on openDB');
    ok(readyFn.indexOf('catch') >= 0, 'ready() never rejects, so callers need no second guard');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 8b. offerAutoSave, executed against a fake welcome screen
  //
  // This is the user's actual complaint: "if the feature can't be made to
  // work, don't have this button". So the suite does not look for the word
  // "discard" — it builds the welcome bar, feeds the function an autosave,
  // and checks whether the button was put on screen.
  // ═══════════════════════════════════════════════════════════════════════
  function mockDoc() {
    const bar = { style: { display: 'none' } };
    const label = { textContent: '' };
    const els = { 'welcome-autosave': bar, 'welcome-autosave-label': label };
    return {
      _bar: bar, _label: label,
      getElementById: function (id) { return els[id] || null; },
    };
  }
  function buildOffer(o) {
    const bodies = fnFull('offerAutoSave', src) + '\n\n' + fnFull('probeAutosaveMedia', src);
    const factory = new Function(
      'window', 'document', 'readAutoSave', 'discardAutoSave',
      'AUTOSAVE_MEDIA_PREFIX', 'console',
      bodies + '\nreturn { offerAutoSave: offerAutoSave, probeAutosaveMedia: probeAutosaveMedia };'
    );
    return factory(
      { KraftedStorage: o.KS || null }, o.doc, o.data ? function () { return o.data; } : function () { return null; },
      o.discard || function () { o.discardCalls = (o.discardCalls || 0) + 1; },
      EXPECT_PREFIX, { warn: function () {}, log: function () {} }
    );
  }

  // 8b-1. The reported case: three items, none of their bytes survived.
  {
    const o = { discardCalls: 0 };
    const doc = mockDoc();
    const F = buildOffer({
      doc: doc, KS: makeFakeKS({ store: makeStore() }),
      data: { items: [{ id: 1, src: P + '1' }, { id: 2, src: P + '2' }, { id: 3, src: P + '3' }] },
      discard: function () { o.discardCalls++; },
    });
    F.offerAutoSave();
    await new Promise(function (r) { setImmediate(r); });
    await new Promise(function (r) { setImmediate(r); });
    eq(o.discardCalls, 1, 'an all-shells autosave is retired, not offered');
    eq(doc._bar.style.display, 'none', 'the Restore button is NOT shown when nothing can come back');
  }

  // 8b-2. Some bytes survived — offer it, and say how much.
  {
    const o = { discardCalls: 0 };
    const doc = mockDoc();
    const F = buildOffer({
      doc: doc, KS: makeFakeKS({ store: makeStore([[1, {}]]) }),
      data: { items: [{ id: 1, src: P + '1' }, { id: 2, src: P + '2' }] },
      discard: function () { o.discardCalls++; },
    });
    F.offerAutoSave();
    await new Promise(function (r) { setImmediate(r); });
    await new Promise(function (r) { setImmediate(r); });
    eq(o.discardCalls, 0, 'a partly recoverable autosave is kept');
    eq(doc._bar.style.display, 'flex', 'the Restore button IS shown when something can come back');
    ok(doc._label.textContent.indexOf('2 items') >= 0, 'the label counts the items');
    ok(doc._label.textContent.indexOf('1 file recovered') >= 0, 'the label says how much is recoverable');
    ok(doc._label.textContent.indexOf('1 unrecoverable') >= 0, 'the label admits what is not');
  }

  // 8b-3. A board of pure text — the old code counted items only and threw
  // this away even though every character of it was recoverable.
  {
    const o = { discardCalls: 0 };
    const doc = mockDoc();
    const F = buildOffer({
      doc: doc, KS: makeFakeKS({ store: makeStore() }),
      data: { items: [], texts: [{ id: 1 }, { id: 2 }] },
      discard: function () { o.discardCalls++; },
    });
    F.offerAutoSave();
    await new Promise(function (r) { setImmediate(r); });
    await new Promise(function (r) { setImmediate(r); });
    eq(o.discardCalls, 0, 'a text-only board is not thrown away');
    eq(doc._bar.style.display, 'flex', 'a text-only board is offered');
    ok(doc._label.textContent.indexOf('2 text/note') >= 0, 'the label counts text content');
  }

  // 8b-4. Nothing at all.
  {
    const o = { discardCalls: 0 };
    const doc = mockDoc();
    const F = buildOffer({
      doc: doc, KS: makeFakeKS({ store: makeStore() }),
      data: { items: [], texts: [], todos: [], mindmaps: [] },
      discard: function () { o.discardCalls++; },
    });
    F.offerAutoSave();
    await new Promise(function (r) { setImmediate(r); });
    eq(o.discardCalls, 1, 'an empty autosave is discarded');
    eq(doc._bar.style.display, 'none', 'an empty autosave offers nothing');
  }
  {
    const F = buildOffer({ doc: { getElementById: function () { return null; } }, data: { items: [{ id: 1, src: P + '1' }] } });
    let threw = false;
    try { F.offerAutoSave(); await new Promise(function (r) { setImmediate(r); }); } catch (e) { threw = true; }
    ok(!threw, 'a missing welcome bar does not throw');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 9. Version pins
  // ═══════════════════════════════════════════════════════════════════════
  ok(src.indexOf("var KRAFTED_VERSION = '" + EXPECT_VERSION + "';") >= 0, 'KRAFTED_VERSION bumped');
  ok(src.indexOf('<title>Krafted v' + EXPECT_VERSION + '</title>') >= 0, 'title bumped');
  ok(sw.indexOf("const CACHE_NAME = 'krafted-v" + EXPECT_VERSION + "-'") >= 0, 'sw CACHE_NAME bumped');
  ok(sw.indexOf("const APP_VERSION = '" + EXPECT_VERSION + "';") >= 0, 'sw APP_VERSION bumped');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
