// v7.30.0 — one dialog for the whole batch, and a folder path in the key.
//
// Two things the previous version made the user do by hand:
//
//   P1  Ten proxy cards with no remembered original meant TEN file dialogs,
//       one after another, and cancelling meant ten Escs (v7.29.1's "stop the
//       batch" was a workaround for a dialog count that should never have
//       existed). One <input multiple> and the cards are matched afterwards.
//   P2  `_dropFiles` was keyed by file NAME, so A/shot01.mov and B/shot01.mov
//       collapsed into one entry. The card that lost the collision could not
//       find its own original and was sent to a picker for a file it had
//       already dragged in.
//
// Both go through the same identity rule (`originalFileFor`). The one
// assertion that must never go green by accident is block 4's decoy: a picked
// file with the right name and the WRONG size must not be linked, because
// that is a conform shipping the wrong take.

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(
  process.env.KRAFTED_HTML || path.join(__dirname, '..', '..', 'kraftpub-dev.html'),
  'utf8');

let pass = 0, fail = 0;
function clip(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) return 'undefined';
  return s.length > 160 ? s.slice(0, 160) + '...[' + s.length + ' chars]' : s;
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

const LINK = slice('function syncProxyBadgeEl(infoBar, item) {',
                   'function buildMediaControls(el, mediaEl, isVideo, isGif) {',
                   'chip + link machinery');

// ── sandbox ──────────────────────────────────────────────────────────────
const api = new Function(`
  var TOASTS = [], SEL = [], LOG = [], QUEUE = [], MODES = [];
  var URL = {
    createObjectURL: function (f) { return 'blob:' + (f && f.name ? f.name : '?'); },
    revokeObjectURL: function () {},
  };
  function toast(m) { TOASTS.push(String(m)); }
  function boardTextLabel(a, b) { return a; }
  function getSelectedItems() { return SEL; }
  function resumeMediaEl(v) {}
  ${LINK}
  // One QUEUE entry per dialog: an array is a multi-pick, a bare File is a
  // single pick, a hole is an Esc. MODES records whether 'multiple' was set,
  // which is the only observable difference between the two paths.
  pickFiles = function (accept, multi) {
    var n = LOG.filter(function (x) { return x.indexOf('call') === 0; }).length;
    LOG.push('call' + n);
    MODES.push(!!multi);
    return Promise.resolve().then(function () {
      LOG.push('resolve' + n);
      var q = QUEUE[n];
      if (q === undefined || q === null) return null;
      return Array.isArray(q) ? q : [q];
    });
  };
  pickSingleFile = function (accept) {
    return pickFiles(accept, false).then(function (a) { return (a && a[0]) || null; });
  };
  return {
    dropKeyOf: dropKeyOf,
    originalKeyFor: originalKeyFor,
    originalFileFor: originalFileFor,
    rememberedOriginalFor: rememberedOriginalFor,
    applyOriginalLink: applyOriginalLink,
    noteDroppedFiles: noteDroppedFiles,
    linkOriginalSelected: linkOriginalSelected,
    proxyCardsInSelection: proxyCardsInSelection,
    proxyOriginals: proxyOriginals,
    dropFiles: _dropFiles,
    setSel: function (a) { SEL = a; },
    setQueue: function (a) { QUEUE = a; },
    toasts: TOASTS,
    log: LOG,
    modes: MODES,
  };
`)();

const flush = () => new Promise(function (r) { setTimeout(r, 0); });
function vid(name, size, rel) {
  const f = { name: name, type: 'video/mp4', size: size };
  if (rel) f.webkitRelativePath = rel;
  return f;
}
function makeItem(id, opts) {
  const o = opts || {};
  return {
    id: id, isProxy: true, isVideo: true,
    originalName: o.originalName || '',
    originalPath: o.originalPath || '',
    originalSize: o.originalSize,
    src: 'blob:PROXY',
    el: null,
  };
}

(async function main() {

  block('1. the pool key: a path when there is one, the name when there is not', () => {
    const all = stripComments(HTML);
    eq(countIn(/function dropKeyOf\(/g, all), 1, 'one definition', countIn(/function dropKeyOf\(/g, all));
    // Every reader and writer of the pool must go through it.
    ok(/const key = dropKeyOf\(f\);/.test(all), 'the recorder uses it');
    ok(/pool\.set\(dropKeyOf\(f\), f\)/.test(all), 'and so does the batch pool');

    eq(api.dropKeyOf(vid('shot01.mov', 1, 'A/shot01.mov')), 'A/shot01.mov',
       'a folder drag answers with its path');
    eq(api.dropKeyOf(vid('shot01.mov', 1)), 'shot01.mov',
       'a plain multi-select has no path, so the name is the key');
    eq(api.dropKeyOf(vid('shot01.mov', 1, '   ')), 'shot01.mov',
       'a blank path is not a path');
    eq(api.dropKeyOf(null), '', 'and nothing is not a key either');

    // The card has to be stamped with the same key at import time, or a path
    // in the pool is unreachable. (That it actually RUNS is proved by
    // test_v7_29_0 block 7, which executes the four lines.)
    ok(/newItem\.originalPath = _pp\.originalPath \|\| '';/.test(all),
       'the import stamps the path on the card');
    ok(/_dropFiles\.get\(newItem\.originalPath \|\| newItem\.originalName\)/.test(all),
       'and looks the pool up with it, not the bare name');
  });

  block('2. two takes with the same name are two entries, not one', () => {
    api.dropFiles.clear();
    const aFile = vid('shot01.mov', 1111, 'A/shot01.mov');
    const bFile = vid('shot01.mov', 2222, 'B/shot01.mov');
    api.noteDroppedFiles([aFile, bFile]);
    eq(api.dropFiles.size, 2, 'the second one does not overwrite the first',
       Array.from(api.dropFiles.keys()));

    const a = makeItem('a1', { originalName: 'shot01.mov', originalPath: 'A/shot01.mov', originalSize: 1111 });
    const b = makeItem('b1', { originalName: 'shot01.mov', originalPath: 'B/shot01.mov', originalSize: 2222 });
    eq(api.rememberedOriginalFor(a) === aFile, true, 'A/shot01.mov finds A');
    eq(api.rememberedOriginalFor(b) === bFile, true, 'B/shot01.mov finds B — this is the whole point');

    // The honest fallback: with no path on either side the name IS the key, so
    // a genuine duplicate still collapses. Pinned so nobody reads this file as
    // "duplicate names are solved" — they are solved when a path travels.
    api.dropFiles.clear();
    api.noteDroppedFiles([vid('dup.mov', 1), vid('dup.mov', 2)]);
    eq(api.dropFiles.size, 1, 'with no path at all, the name is still the key and the newest wins');
  });

  block('3. one rule, and `needSize` is the only switch', () => {
    const all = stripComments(HTML);
    eq(countIn(/function originalFileFor\(/g, all), 1, 'one definition');
    eq(countIn(/remembered\.size === want/g, all), 1, 'one size test in the whole file');

    const pool = new Map([['x.mov', vid('x.mov', 500)]]);
    const known = makeItem('k', { originalName: 'x.mov', originalSize: 500 });
    const wrong = makeItem('w', { originalName: 'x.mov', originalSize: 999 });
    const blank = makeItem('b', { originalName: 'x.mov' });          // restored from a save
    const other = makeItem('o', { originalName: 'nope.mov', originalSize: 500 });

    eq(!!api.originalFileFor(known, pool, true), true, 'a card that knows the size matches on it');
    eq(!!api.originalFileFor(wrong, pool, true), false, 'and a different size is refused');
    eq(!!api.originalFileFor(wrong, pool, false), false, 'even when the user picked it themselves');
    eq(!!api.originalFileFor(other, pool, false), false, 'a name that is not there at all matches nothing');
    // The switch: the pool refuses to guess, a hand-picked file is taken.
    eq(!!api.originalFileFor(blank, pool, true), false, 'the pool refuses to guess on an unknown size');
    eq(!!api.originalFileFor(blank, pool, false), true, 'files the user picked are accepted on the name');
    eq(!!api.rememberedOriginalFor(blank), false, 'and rememberedOriginalFor is the strict one');
  });

  await ablock('4. three cards, ONE dialog, picked in any order', async () => {
    api.dropFiles.clear();
    const a = makeItem('m1', { originalName: 'x.mov', originalSize: 11 });
    const b = makeItem('m2', { originalName: 'y.mov', originalSize: 22 });
    const c = makeItem('m3', { originalName: 'z.mov', originalSize: 33 });
    api.setSel([a, b, c]);
    // Deliberately shuffled, plus a decoy called x.mov that is the wrong take.
    api.setQueue([[vid('z.mov', 33), vid('x.mov', 9999), vid('x.mov', 11), vid('y.mov', 22)]]);
    api.log.length = 0; api.modes.length = 0; api.toasts.length = 0;

    api.linkOriginalSelected();
    await flush();

    eq(api.log.filter(function (x) { return x.indexOf('call') === 0; }).length, 1,
       'one dialog, not three', api.log);
    eq(api.modes[0], true, 'and it is a multi-select', api.modes);
    eq(api.proxyOriginals.get('m1').file.size, 11,
       'x.mov took the file whose size agrees, not the decoy that shared its name');
    eq(api.proxyOriginals.get('m2').file.size, 22, 'y.mov linked');
    eq(api.proxyOriginals.get('m3').file.size, 33, 'z.mov linked, even though it was first in the pick');
    ok(api.toasts.some(function (t) { return /Linked 3 originals/.test(t); }),
       'the toast reports all three', api.toasts);
  });

  await ablock('5. what the pick does not cover is reported, not chased', async () => {
    api.dropFiles.clear();
    const a = makeItem('p1', { originalName: 'x.mov', originalSize: 11 });
    const b = makeItem('p2', { originalName: 'y.mov', originalSize: 22 });
    const c = makeItem('p3', { originalName: 'z.mov', originalSize: 33 });
    api.setSel([a, b, c]);
    api.setQueue([[vid('x.mov', 11)]]);      // only one of the three was picked
    api.log.length = 0; api.toasts.length = 0;

    api.linkOriginalSelected();
    await flush();

    eq(api.log.filter(function (x) { return x.indexOf('call') === 0; }).length, 1,
       'still one dialog — no second round of dialogs', api.log);
    eq(api.proxyOriginals.has('p1'), true, 'the one that was picked is linked');
    eq(api.proxyOriginals.has('p2'), false, 'the others are not claimed as linked');
    eq(api.proxyOriginals.has('p3'), false, 'no silent half-conform');
    ok(api.toasts.some(function (t) { return /Linked 1 of 3/.test(t); }),
       'and the count is honest', api.toasts);
    ok(api.toasts.some(function (t) { return /still need the file picked by hand/.test(t); }),
       'with a line that says what to do next', api.toasts);
  });

  await ablock('6. one card still gets a single-file dialog', async () => {
    api.dropFiles.clear();
    const a = makeItem('s1', { originalName: 'solo.mov', originalSize: 7 });
    api.setSel([a]);
    api.setQueue([vid('whatever.mov', 7)]);   // a single pick takes what it is given
    api.log.length = 0; api.modes.length = 0; api.toasts.length = 0;

    api.linkOriginalSelected();
    await flush();

    eq(api.modes[0], false, 'not a multi-select — one card, one file', api.modes);
    eq(api.proxyOriginals.has('s1'), true, 'and the file the user pointed at is taken as-is');
    ok(api.toasts.some(function (t) { return /Linked the original/.test(t); }),
       'reported in the singular', api.toasts);
  });

  await ablock('7. cancelling still stops everything, and says nothing false', async () => {
    api.dropFiles.clear();
    const a = makeItem('c1', { originalName: 'x.mov', originalSize: 11 });
    const b = makeItem('c2', { originalName: 'y.mov', originalSize: 22 });
    api.setSel([a, b]);
    api.setQueue([]);                        // Esc
    api.log.length = 0; api.modes.length = 0; api.toasts.length = 0;

    api.linkOriginalSelected();
    await flush();

    eq(api.log.filter(function (x) { return x.indexOf('call') === 0; }).length, 1,
       'one dialog was opened', api.log);
    eq(api.proxyOriginals.has('c1'), false, 'nothing is linked');
    ok(!api.toasts.some(function (t) { return /Linked/.test(t); }),
       'and nothing claims it was', api.toasts);
    ok(api.toasts.some(function (t) { return /Picking originals for 2 clips/.test(t); }),
       'the line before the dialog still names the size of the job', api.toasts);
  });

  await ablock('10. a folder pick: one name, two folders, both correct', async () => {
    api.dropFiles.clear();
    const a = makeItem('f1', { originalName: 'shot01.mov', originalPath: 'A/shot01.mov', originalSize: 111 });
    const b = makeItem('f2', { originalName: 'shot01.mov', originalPath: 'B/shot01.mov', originalSize: 222 });
    api.setSel([a, b]);
    api.setQueue([[vid('shot01.mov', 222, 'B/shot01.mov'), vid('shot01.mov', 111, 'A/shot01.mov')]]);
    api.log.length = 0; api.toasts.length = 0;

    api.linkOriginalSelected();
    await flush();

    eq(api.proxyOriginals.get('f1').file.size, 111, 'A/shot01.mov got the A take');
    eq(api.proxyOriginals.get('f2').file.size, 222, 'B/shot01.mov got the B take');
  });

  block('8. the picker is still ONE reused input', () => {
    const all = stripComments(HTML);
    eq(countIn(/function pickFiles\(/g, all), 1, 'one definition');
    eq(countIn(/inp\.multiple = !!multi;/g, all), 1, '`multiple` is set from the argument, once');
    ok(/inp\.value = '';/.test(all), 'value is still cleared before every click');
    ok(/inp\.removeEventListener\('change', onChange\);/.test(all), 'and both listeners come off');
    ok(/inp\.removeEventListener\('cancel', onCancel\);/.test(all), 'so a second pick is not stacked');
    eq(countIn(/inp\.remove\(\);/g, all), 0, 'the input is never removed — that was the leak');
    // The single-file wrapper must not grow its own copy of any of that.
    eq(countIn(/function pickSingleFile\(/g, all), 1, 'one wrapper');
    ok(/return pickFiles\(accept, false\)/.test(all), 'and it delegates instead of re-implementing');
  });

  block('9. the plan carries the original\'s path, but only when asked', () => {
    const all = stripComments(HTML);
    eq(countIn(/function planProxyPairs\(names, pathsByName\)/g, all), 1,
       'the optional argument is on the signature');
    ok(/originalPath: \(\(orig && pathsByName\)/.test(all),
       'and it is only consulted when it was passed');
    // Pure and backwards compatible: a caller that never mentions paths gets
    // exactly the plan it always got.
    const PLAN = slice('function planProxyPairs(names, pathsByName) {',
                       'function _handleFileDrop(e, files) {',
                       'planProxyPairs');
    const plan = new Function('proxyBaseName', 'mediaBaseName',
      PLAN + '\nreturn planProxyPairs;')(
      function (n) { return /_proxy\.[^.]+$/i.test(n) ? n.replace(/_proxy\.[^.]+$/i, '') : null; },
      function (n) { return n.replace(/\.[^.]+$/, ''); });
    const plain = plan(['shot01_proxy.mov', 'shot01.mov']);
    eq(plain['shot01_proxy.mov'].originalName, 'shot01.mov', 'name pairing is unchanged');
    eq(plain['shot01_proxy.mov'].originalPath, '', 'and no path is invented');
    const withPaths = plan(['shot01_proxy.mov', 'shot01.mov'], { 'shot01.mov': 'A/shot01.mov' });
    eq(withPaths['shot01_proxy.mov'].originalPath, 'A/shot01.mov', 'when a path is known it travels');
  });

  console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + '  (' + pass + ' passed' +
              (fail ? ', ' + fail + ' failed' : '') + ')');
  process.exit(fail === 0 ? 0 : 1);
})();
