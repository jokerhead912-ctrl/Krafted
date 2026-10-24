// v7.29.0 group A — the original-link lifecycle.
//
// v7.28.0 could CREATE a link but never destroyed one. Three leaks, all of
// them invisible until the tab dies:
//   A1a  deleting a proxy card left proxyOriginals[id] behind, holding a File
//        and a live blob URL — nothing in the app pointed at it any more, so
//        nothing could ever free it.
//   A1b  linking the same card twice overwrote the entry and orphaned the
//        first URL (same leak, reachable in two clicks).
//   A2   _dropFiles remembered EVERY dropped file, keyed by name, forever —
//        whole PSDs and WAVs pinned for a session, and two different takes
//        both called "shot01.mov" linked the wrong one silently.
//
// The one assertion that must never go green by accident is block 3's
// "cleanupVideoItem(item, false) must NOT drop the link": that flag is the
// restore/undo path, and dropping there is exactly what turned Delete ->
// Ctrl+Z into an unplayable black card (v7.0.39).

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(
  process.env.KRAFTED_HTML || path.join(__dirname, '..', '..', 'kraftpub-dev.html'),
  'utf8');

let pass = 0, fail = 0;
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
function block(n, fn) {
  console.log('\n' + n);
  try { fn(); } catch (e) { fail++; console.log('  FAIL ' + n + ' threw: ' + (e && e.message)); }
}
async function ablock(n, fn) {
  console.log('\n' + n);
  try { await fn(); } catch (e) { fail++; console.log('  FAIL ' + n + ' threw: ' + (e && e.message)); }
}
function countIn(re, s) { return (s.match(re) || []).length; }
function stripComments(s) {
  return s.replace(/\/\*[\s\S]{0,4000}?\*\//g, '').replace(/(?<![:\\'"])\/\/[^\n]*/g, '');
}
function slice(a, b, label) {
  const i = HTML.indexOf(a), j = HTML.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('anchor failed: ' + label);
  const s = HTML.slice(i, j);
  if (s.length < 40) throw new Error('slice too short: ' + label);
  if (s.length > 20000) throw new Error('slice suspiciously wide: ' + label);
  return s;
}

// v7.28.0's own suite slices the same region; the anchors are the function
// boundaries so neither suite can drift into the other's code.
const LINK = slice('function syncProxyBadgeEl(infoBar, item) {',
                   'function buildMediaControls(el, mediaEl, isVideo, isGif) {',
                   'chip + link machinery');
const CLEANUP = slice('function cleanupVideoItem(item, revokeBlob) {',
                      'function cleanupImageItem(item, revokeBlob) {',
                      'cleanupVideoItem');
// v7.30.0: starts at the name stamp, not the size lookup — the path stamp
// sits between the two, and slicing past it made `originalName` undefined
// inside the runner, so the lookup read '' and every size assertion went red
// for a reason that had nothing to do with what they were testing.
const RECORD = slice("      newItem.originalName = _pp.originalName || '';",
                     '    _maybeTidy(newItem.id);',
                     'originalSize record');

// ── sandbox: the real source, with the few globals it touches stubbed ────
const api = new Function(`
  var TOASTS = [], RESUMED = [], SEL = [], REVOKED = [], MADE = [], CACHED = true;
  var URL = {
    createObjectURL: function (f) { var u = 'blob:' + (f && f.name ? f.name : '?') + '#' + (MADE.length); MADE.push(u); return u; },
    revokeObjectURL: function (u) { REVOKED.push(u); },
  };
  function toast(m) { TOASTS.push(String(m)); }
  function boardTextLabel(a, b) { return a; }
  function getSelectedItems() { return SEL; }
  function resumeMediaEl(v) { RESUMED.push(v); }
  var _revokedBlobUrls = new Set();
  var _mediaBlobByUrl = new Map();
  function _cacheMediaBlob(u, b) { return CACHED; }
  ${LINK}
  ${CLEANUP}
  var __pickResult = null;
  pickSingleFile = function () { return Promise.resolve(__pickResult); };
  return {
    syncProxyBadgeEl: syncProxyBadgeEl,
    noteDroppedFiles: noteDroppedFiles,
    dropOriginalLink: dropOriginalLink,
    applyOriginalLink: applyOriginalLink,
    linkOriginalForItem: linkOriginalForItem,
    swapProxyMedia: swapProxyMedia,
    cleanupVideoItem: cleanupVideoItem,
    proxyOriginals: proxyOriginals,
    dropFiles: _dropFiles,
    setPick: function (f) { __pickResult = f; },
    setCached: function (b) { CACHED = b; },
    revoked: REVOKED,
    made: MADE,
  };
`)();

// ── fixtures ─────────────────────────────────────────────────────────────
function makeBar() {
  const cls = new Set();
  const chip = { textContent: '', title: '' };
  return {
    _cls: cls, _chip: chip,
    classList: {
      toggle: (n, on) => { if (on) cls.add(n); else cls.delete(n); },
      contains: (n) => cls.has(n),
    },
    querySelector: (sel) => (sel === '.ib-proxy') ? chip : null,
  };
}
function makeItem(id, opts) {
  const o = opts || {};
  const bar = makeBar();
  const handlers = {};
  const item = {
    id: id,
    isProxy: o.isProxy !== false,
    isVideo: true,
    originalName: o.originalName || '',
    src: 'blob:PROXY',
    el: { querySelector: () => bar },
    video: {
      src: 'blob:PROXY',
      paused: true,
      currentTime: 0,
      duration: 0,
      pause: function () { this.paused = true; },
      removeAttribute: function () { this.src = ''; },
      load: function () { this.loaded = (this.loaded || 0) + 1; },
      addEventListener: function (ev, fn) { handlers[ev] = fn; },
      removeEventListener: function (ev) { delete handlers[ev]; },
    },
    _bar: bar,
  };
  // v7.29.0: only set it when asked — "absent" is a real state under test.
  if (typeof o.originalSize === 'number') item.originalSize = o.originalSize;
  return item;
}
function vid(name, size) { return { name: name, type: 'video/mp4', size: size || 1024 }; }

(async function main() {

  block('1. one definition of "drop a link", and it takes the URL with it', () => {
    const link = stripComments(LINK);
    eq(countIn(/function dropOriginalLink\(/g, link), 1, 'dropOriginalLink is defined once');
    eq(countIn(/proxyOriginals\.delete\(/g, link), 1,
       'and it is the ONLY place an entry leaves the registry (a bare delete leaks the URL)');
    eq(countIn(/URL\.revokeObjectURL\(/g, link), 1, 'one revoke, in the same function');
    ok(link.indexOf('function dropOriginalLink(') < link.indexOf('proxyOriginals.delete('),
       'the revoke belongs to the drop, not to a caller');

    eq(api.dropOriginalLink('never-linked'), false, 'dropping nothing is a no-op');

    const it = makeItem('d1');
    api.applyOriginalLink(it, vid('a.mov', 11));
    const url = api.proxyOriginals.get('d1').url;
    eq(api.dropOriginalLink('d1'), true, 'dropping a real link reports it');
    eq(api.proxyOriginals.has('d1'), false, 'the entry is gone');
    eq(api.revoked.indexOf(url) >= 0, true, 'and its blob URL was released', api.revoked);
  });

  block('2. linking the same card twice must not orphan the first URL', () => {
    const it = makeItem('d2');
    api.applyOriginalLink(it, vid('a.mov', 11));
    const first = api.proxyOriginals.get('d2').url;
    api.applyOriginalLink(it, vid('b.mov', 22));
    const second = api.proxyOriginals.get('d2');
    eq(second.name, 'b.mov', 'the card points at the newest file');
    eq(api.revoked.indexOf(first) >= 0, true, 'and the previous URL was released, not orphaned');
    eq(api.proxyOriginals.size, 1, 'one entry per card, not a growing list');
  });

  block('3. a real delete releases the link — a restore does NOT', () => {
    // deleteSelected() calls cleanupVideoItem(i) with no argument.
    const gone = makeItem('d3');
    api.applyOriginalLink(gone, vid('a.mov', 11));
    const goneUrl = api.proxyOriginals.get('d3').url;
    api.cleanupVideoItem(gone);
    eq(api.proxyOriginals.has('d3'), false, 'deleting the card drops the link');
    eq(api.revoked.indexOf(goneUrl) >= 0, true, 'and releases the bytes');

    // cleanupAllItems() calls cleanupVideoItem(i, false) in the middle of a
    // snapshot restore. The snapshot coming back still holds the same URL.
    const back = makeItem('d4');
    api.applyOriginalLink(back, vid('a.mov', 11));
    const backUrl = api.proxyOriginals.get('d4').url;
    const revokedBefore = api.revoked.length;
    api.cleanupVideoItem(back, false);
    eq(api.proxyOriginals.has('d4'), true, 'a restore KEEPS the link');
    eq(api.revoked.length, revokedBefore, 'and revokes nothing (this is the Ctrl+Z black-card guard)');
    eq(api.proxyOriginals.get('d4').url, backUrl, 'same URL, still usable after Ctrl+Z');

    // and the flag is honoured explicitly too
    const explicit = makeItem('d5');
    api.applyOriginalLink(explicit, vid('a.mov', 11));
    api.cleanupVideoItem(explicit, true);
    eq(api.proxyOriginals.has('d5'), false, 'revokeBlob === true is a real discard');
  });

  block('4. _dropFiles only remembers what can ever be an original', () => {
    api.dropFiles.clear();
    api.noteDroppedFiles([
      { name: 'poster.psd', type: 'image/vnd.adobe.photoshop', size: 900000000 },
      { name: 'voiceover.wav', type: 'audio/wav', size: 300000000 },
      { name: 'notes.txt', type: 'text/plain', size: 10 },
      { name: 'no-type.mov', size: 4096 },
    ]);
    eq(api.dropFiles.size, 0,
       'images, audio, text and untyped files are not remembered — a proxy original is always a video',
       Array.from(api.dropFiles.keys()));

    api.noteDroppedFiles([vid('shot01.mov', 999)]);
    eq(api.dropFiles.size, 1, 'a video is');
  });

  block('5. _dropFiles is bounded, and a re-drop moves to the back', () => {
    // v7.29.1: read the cap off the source instead of hardcoding it. The
    // number is a judgement call (raised to fit one board in a single drag),
    // and a literal 200 would go red the day that judgement changes.
    const CAP = parseInt((stripComments(HTML).match(/const _DROP_FILES_MAX = (\d+);/) || [])[1], 10);
    ok(CAP >= 600, 'the cap fits a whole board in one drag (300 proxies + 300 originals)', CAP);

    api.dropFiles.clear();
    const many = [];
    const N = CAP + 10;
    for (let i = 0; i < N; i++) many.push(vid('v' + i + '.mov', 1000 + i));
    api.noteDroppedFiles(many);
    eq(api.dropFiles.size, CAP, 'the registry cannot grow without limit', api.dropFiles.size);
    eq(api.dropFiles.has('v0.mov'), false, 'the oldest is evicted first (FIFO)');
    eq(api.dropFiles.has('v' + (N - 1) + '.mov'), true, 'the newest survives');

    // After the flood the queue holds v10..v(N-1), so v10 is the oldest.
    // Re-dropping IT must refresh its place, or a file the user just dragged
    // in would be the very first thing evicted.
    eq(api.dropFiles.has('v10.mov'), true, 'v10 is the oldest entry right now');
    api.noteDroppedFiles([vid('v10.mov', 1010)]);   // re-drop the oldest
    api.noteDroppedFiles([vid('vnew.mov', 7)]);     // and push one over the cap
    eq(api.dropFiles.size, CAP, 'still bounded');
    eq(api.dropFiles.has('v10.mov'), true, 'a re-dropped file moves to the back of the queue');
    eq(api.dropFiles.has('v11.mov'), false, 'so the eviction takes the entry that was next in line');
  });

  block('5b. one board in one drag: 300 proxies + 300 originals all survive', () => {
    // v7.29.1: at a cap of 200 the first-dropped originals were evicted
    // BEFORE their own cards could read their size, so a file the user had
    // literally just dragged in still sent them to a picker.
    api.dropFiles.clear();
    const many = [];
    for (let i = 0; i < 300; i++) {
      many.push(vid('shot' + i + '.mov', 1000 + i), vid('shot' + i + '_proxy.mp4', 10 + i));
    }
    api.noteDroppedFiles(many);
    eq(api.dropFiles.size, 600, '600 files in one drag are all remembered', api.dropFiles.size);
    eq(api.dropFiles.has('shot0.mov'), true, 'the FIRST original of the drag is still known');
    eq(api.dropFiles.has('shot299.mov'), true, 'and so is the last');
  });

  await ablock('6. a remembered file must agree on size, or we ask', async () => {
    api.dropFiles.clear();
    api.noteDroppedFiles([vid('shot01.mov', 5000)]);

    const right = makeItem('s1', { originalName: 'shot01.mov', originalSize: 5000 });
    api.setPick(null);                      // no picker may be needed
    eq(await api.linkOriginalForItem(right), true, 'same name AND same size links instantly');
    eq(api.proxyOriginals.get('s1').name, 'shot01.mov', 'to the file we remembered');

    const wrong = makeItem('s2', { originalName: 'shot01.mov', originalSize: 4999 });
    eq(await api.linkOriginalForItem(wrong), false, 'a different size is NOT silently linked');
    eq(api.proxyOriginals.has('s2'), false, 'nothing is recorded — better to ask than to conform the wrong take');

    const unknown = makeItem('s3', { originalName: 'shot01.mov' });
    eq(await api.linkOriginalForItem(unknown), false, 'a card with no recorded size is not guessed either');
    eq(api.proxyOriginals.has('s3'), false, 'it goes to the picker');

    api.setPick(vid('picked.mov', 3));
    eq(await api.linkOriginalForItem(unknown), true, 'and the picker still works');
    eq(api.proxyOriginals.get('s3').name, 'picked.mov', 'recording what was chosen');
    api.setPick(null);
  });

  block('7. the import records how big the original it paired away was', () => {
    const rec = stripComments(RECORD);
    ok(/newItem\.originalSize = _of\.size;/.test(rec), 'the size is stamped on the card', rec);
    ok(/typeof _of\.size === 'number'/.test(rec), 'only when the File actually reports one');

    // Run the real four lines instead of only reading them: an anchor proves
    // the code exists, only executing it proves it behaves.
    // RECORD ends with the closing brace of the `if (_pp && _pp.isProxy)`
    // block, so the runner has to supply that block's opening.
    const run = new Function('_proxyPlan', 'file', 'newItem', '_dropFiles',
      'const _pp = _proxyPlan[file.name];\nif (_pp && _pp.isProxy) {\n' + RECORD + '\nreturn newItem;\n');
    const plan = { 'shot01_proxy.mp4': { isProxy: true, originalName: 'shot01.mov' } };
    const got = run(plan, { name: 'shot01_proxy.mp4' }, {}, new Map([['shot01.mov', { size: 4242 }]]));
    eq(got.originalSize, 4242, 'a paired-away original leaves its size behind');

    // v7.30.0: a folder drag gives the original a path, and the pool is keyed
    // by that path — so the card has to remember it or it can never find the
    // file again. Two takes called shot01.mov in different folders is exactly
    // the case this exists for.
    ok(/newItem\.originalPath = _pp\.originalPath \|\| '';/.test(rec),
       'the card also remembers WHERE the original came from', rec);
    const pathed = run({ 'shot01_proxy.mp4': { isProxy: true, originalName: 'shot01.mov', originalPath: 'A/shot01.mov' } },
                       { name: 'shot01_proxy.mp4' }, {}, new Map([['A/shot01.mov', { size: 777 }]]));
    eq(pathed.originalPath, 'A/shot01.mov', 'the path is stamped', pathed.originalPath);
    eq(pathed.originalSize, 777, 'and the lookup uses it — a name-keyed miss would fail here');

    const miss = run(plan, { name: 'shot01_proxy.mp4' }, {}, new Map());
    ok(!('originalSize' in miss), 'no File in hand means no size, not a zero', miss);

    const zero = run(plan, { name: 'shot01_proxy.mp4' }, {}, new Map([['shot01.mov', {}]]));
    ok(!('originalSize' in zero), 'and a File with no size reports nothing rather than 0');
  });

  block('8. nothing else reaches into the registry', () => {
    const all = stripComments(HTML);
    // Every writer/eraser of proxyOriginals must be in the LINK block.
    const outside = countIn(/proxyOriginals\.(set|delete|clear)\(/g, all) -
                    countIn(/proxyOriginals\.(set|delete|clear)\(/g, stripComments(LINK));
    eq(outside, 0, 'no other file writes or erases a link', outside);
    ok(/proxyOriginals\.get\(/.test(all), 'readers are fine, and still exist');
  });

  block('9. the "do we already hold this original?" test has one home', () => {
    const all = stripComments(HTML);
    // v7.29.1: the batch action needs this up front to PLAN (how many dialogs,
    // whether a cancel stops the batch) and the single-card action needs it to
    // link. Two copies of the same test is how a card links the wrong take.
    eq(countIn(/function rememberedOriginalFor\(/g, all), 1,
       'one definition', countIn(/function rememberedOriginalFor\(/g, all));
    eq(countIn(/function originalFileFor\(/g, all), 1,
       'one rule underneath it', countIn(/function originalFileFor\(/g, all));
    eq(countIn(/remembered\.size === want/g, all), 1,
       'and the size agreement is decided in exactly one place',
       countIn(/remembered\.size === want/g, all));
    // v7.30.0: the batch planner used to ask once to plan and again to link,
    // which is two chances to fork. Now one pass does both. Three hits is the
    // definition plus exactly two callers — the single-card linker and the
    // batch planner — and a fourth is a third copy smelling of a rename.
    eq(countIn(/rememberedOriginalFor\(/g, all), 3,
       'the definition plus exactly two callers', countIn(/rememberedOriginalFor\(/g, all));
    // A bare pool read is only allowed where a size is STAMPED at import time
    // (no comparison there), never where a link is made: every link goes
    // through the helper, which takes the pool as an argument.
    eq(countIn(/_dropFiles\.get\(/g, all), 1,
       'only the import stamp reads the pool directly', countIn(/_dropFiles\.get\(/g, all));
  });

  console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + '  (' + pass + ' passed' +
              (fail ? ', ' + fail + ' failed' : '') + ')');
  process.exit(fail === 0 ? 0 : 1);
})();
