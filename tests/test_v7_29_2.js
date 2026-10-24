// v7.29.0 group C — every selected proxy, and the numbers that belong to the file.
//
//   C5  proxyCardInSelection() returned the FIRST proxy in the selection, so
//       right-clicking three proxy cards and choosing "Link original" linked
//       one, toasted success, and left the other two looking linked (same
//       chip, same menu). Only the plural helper exists now.
//   C6  a swap changes the clip under the card: the trim was set against the
//       PROXY's timeline, and the frame rate was auto-detected from the
//       proxy. Both have to follow the file.
//
// The sequential pick (block 3) is asserted by LOG ORDER, not by absence:
// Promise.all would open three dialogs against one reused <input>, and the
// only observable difference is whether call N+1 waits for resolve N.

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
// The menu fragment, executed rather than read: it is the only place the
// count reaches the user.
const MENU = slice('    const _proxyCards = proxyCardsInSelection();',
                   '    // v7.0.40: A/B compare',
                   'proxy menu block');

// ── sandbox ──────────────────────────────────────────────────────────────
const api = new Function(`
  var TOASTS = [], RESUMED = [], SEL = [], LOG = [], QUEUE = [];
  var URL = {
    createObjectURL: function (f) { return 'blob:' + (f && f.name ? f.name : '?'); },
    revokeObjectURL: function () {},
  };
  function toast(m) { TOASTS.push(String(m)); }
  function boardTextLabel(a, b) { return a; }
  function getSelectedItems() { return SEL; }
  function resumeMediaEl(v) { RESUMED.push(v); }
  ${LINK}
  // The picker logs its own call/resolve order so the test can tell
  // sequential from parallel.
  pickSingleFile = function () {
    var n = LOG.filter(function (x) { return x.indexOf('call') === 0; }).length;
    LOG.push('call' + n);
    return Promise.resolve().then(function () {
      LOG.push('resolve' + n);
      return QUEUE[n] || null;
    });
  };
  return {
    fitTrimToDuration: fitTrimToDuration,
    proxyCardsInSelection: proxyCardsInSelection,
    linkOriginalSelected: linkOriginalSelected,
    swapProxySelected: swapProxySelected,
    swapProxyMedia: swapProxyMedia,
    applyOriginalLink: applyOriginalLink,
    noteDroppedFiles: noteDroppedFiles,
    proxyOriginals: proxyOriginals,
    dropFiles: _dropFiles,
    setSel: function (a) { SEL = a; },
    setQueue: function (a) { QUEUE = a; },
    toasts: TOASTS,
    log: LOG,
  };
`)();

const flush = () => new Promise(function (r) { setTimeout(r, 0); });
function vid(name, size) { return { name: name, type: 'video/mp4', size: size || 1024 }; }

function makeItem(id, opts) {
  const o = opts || {};
  const cls = new Set();
  const chip = { textContent: '', title: '' };
  const bar = {
    classList: {
      toggle: (n, on) => { if (on) cls.add(n); else cls.delete(n); },
      contains: (n) => cls.has(n),
    },
    querySelector: (sel) => (sel === '.ib-proxy') ? chip : null,
  };
  const v = {
    src: 'blob:PROXY',
    paused: true,
    currentTime: o.currentTime || 0,
    duration: 0,
    _h: {},
    load: function () {},
    addEventListener: function (ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); },
    removeEventListener: function (ev, fn) {
      const a = this._h[ev] || [];
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    },
    _fire: function (ev) { (this._h[ev] || []).slice().forEach(function (f) { f(); }); },
  };
  return {
    id: id, isProxy: true, isVideo: true,
    originalName: o.originalName || '',
    originalSize: o.originalSize,
    src: 'blob:PROXY',
    el: { querySelector: () => bar },
    video: v,
    _bar: bar, _cls: cls, _chip: chip,
  };
}
function menuFor(cards, linkedIds) {
  const reg = new Set(linkedIds || []);
  return new Function('proxyCardsInSelection', 'proxyOriginals',
    'var html = "";\n' + MENU + '\n return html;')(
    function () { return cards; },
    { has: function (id) { return reg.has(id); } });
}

(async function main() {

  block('1. the singular helper is gone, the plural one sees every card', () => {
    const all = stripComments(HTML);
    eq(countIn(/proxyCardInSelection\b/g, all), 0,
       'the singular helper no longer exists anywhere — two near-identical names is how it came back');
    eq(countIn(/function proxyCardsInSelection\(/g, all), 1, 'one plural definition');

    api.setSel([
      { id: 'x', isVideo: true },
      { id: 'p1', isProxy: true, isVideo: true },
      { id: 'p2', isProxy: true, isVideo: true },
      { id: 'p3', isProxy: true, isVideo: false },   // a proxy IMAGE is not a clip
    ]);
    const found = api.proxyCardsInSelection();
    eq(found.length, 2, 'every proxy VIDEO in the selection, not just the first', found.map(function (i) { return i.id; }));
    eq(found[0].id, 'p1', 'in selection order');
    eq(found[1].id, 'p2', 'including the ones after it');
    api.setSel([]);
    eq(api.proxyCardsInSelection().length, 0, 'nothing selected, nothing returned');
  });

  block('2. the menu says how many cards the click will act on', () => {
    const one = menuFor([{ id: 'a' }], []);
    ok(/Link original…/.test(one) && !/\(1\)/.test(one),
       'one card: no count — a count of one is noise', one);

    const three = menuFor([{ id: 'a' }, { id: 'b' }, { id: 'c' }], []);
    ok(/Link original… \(3\)/.test(three), 'three cards: the label carries the count', three);

    const linked = menuFor([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['a', 'b', 'c']);
    ok(/Swap to original \(3\)/.test(linked), 'all linked: swap all three, and say three', linked);

    const back = menuFor([{ id: 'a', _showingOriginal: true }, { id: 'b' }], ['a', 'b']);
    ok(/Back to proxy \(2\)/.test(back), 'once one is showing the original, the entry offers the way back', back);

    const mixed = menuFor([{ id: 'a' }, { id: 'b' }], ['a']);
    ok(/Link original… \(2\)/.test(mixed),
       'only SOME linked: the menu offers Link, not a swap that would silently miss one', mixed);
    ok(!/Swap to original/.test(mixed), 'and definitely not a swap that only moves half of them');
  });

  await ablock('3. linking three cards opens one picker at a time', async () => {
    api.dropFiles.clear();
    api.noteDroppedFiles([vid('a.mov', 11), vid('b.mov', 22), vid('c.mov', 33)]);
    const a = makeItem('m1', { originalName: 'a.mov', originalSize: 11 });
    const b = makeItem('m2', { originalName: 'b.mov', originalSize: 22 });
    const c = makeItem('m3', { originalName: 'c.mov', originalSize: 33 });
    api.setSel([a, b, c]);
    api.setQueue([]);
    api.toasts.length = 0;

    api.linkOriginalSelected();
    await flush();

    eq(api.proxyOriginals.has('m1'), true, 'the first card is linked');
    eq(api.proxyOriginals.has('m2'), true, 'and the second — not silently skipped');
    eq(api.proxyOriginals.has('m3'), true, 'and the third');
    ok(api.toasts.some(function (t) { return /Linked 3 originals/.test(t); }),
       'the toast reports all three', api.toasts);
  });

  await ablock('4. two of three need a picker: the count is honest, and it waits', async () => {
    api.dropFiles.clear();
    api.noteDroppedFiles([vid('a.mov', 11)]);            // only a.mov is in hand
    const a = makeItem('q1', { originalName: 'a.mov', originalSize: 11 });
    const b = makeItem('q2', { originalName: 'b.mov', originalSize: 22 });
    const c = makeItem('q3', { originalName: 'c.mov', originalSize: 33 });
    api.setSel([a, b, c]);
    api.setQueue([vid('b.mov', 22)]);                    // b is picked, c is cancelled
    api.toasts.length = 0;
    api.log.length = 0;

    api.linkOriginalSelected();
    await flush();

    eq(api.proxyOriginals.has('q1'), true, 'the one we already had is linked instantly');
    eq(api.proxyOriginals.has('q2'), true, 'the one that was picked is linked');
    eq(api.proxyOriginals.has('q3'), false, 'the cancelled one is NOT claimed as linked');
    ok(api.toasts.some(function (t) { return /Linked 2 of 3/.test(t); }),
       'the toast says two of three, not "linked"', api.toasts);

    // Sequential vs Promise.all: with all three queued in parallel the log
    // would read call0,call1,resolve0,resolve1. It must read call,resolve,…
    eq(api.log.join(','), 'call0,resolve0,call1,resolve1',
       'each dialog closes before the next opens — one picker, reused', api.log);
  });

  await ablock('5. swap moves every selected card, and none of them alone', async () => {
    api.dropFiles.clear();
    const a = makeItem('s1'), b = makeItem('s2'), c = makeItem('s3');
    [a, b, c].forEach(function (it) { api.applyOriginalLink(it, vid('x.mov')); });
    api.setSel([a, b, c]);
    api.toasts.length = 0;

    api.swapProxySelected();
    await flush();

    eq(a._showingOriginal, true, 'the first card moved');
    eq(b._showingOriginal, true, 'the second moved too');
    eq(c._showingOriginal, true, 'and the third');
    ok(api.toasts.some(function (t) { return /Now showing the original \(3\)/.test(t); }),
       'the toast says three cards moved', api.toasts);

    // and back, all of them
    api.swapProxySelected();
    await flush();
    eq(a._showingOriginal, false, 'swapping back moves all three as well');
    eq(b._showingOriginal, false, 'not just the first');
  });

  await ablock('6. a selection with an unlinked card is linked, not half-swapped', async () => {
    api.dropFiles.clear();
    const a = makeItem('h1'), b = makeItem('h2');
    api.applyOriginalLink(a, vid('x.mov'));          // a is linked, b is not
    api.setSel([a, b]);
    api.setQueue([]);
    api.toasts.length = 0;

    api.swapProxySelected();
    await flush();

    eq(a._showingOriginal, undefined, 'the linked card is NOT swapped behind the others back');
    eq(b._showingOriginal, undefined, 'the unlinked one could not be swapped anyway');
    ok(!api.toasts.some(function (t) { return /showing the original/.test(t); }),
       'and nothing claims a conform happened', api.toasts);
  });

  block('7. the trim follows the clip', () => {
    const v = { duration: 10 };
    const over = { trimStart: 1, trimEnd: 40 };
    eq(api.fitTrimToDuration(over, v), true, 'a trimEnd past the end is reported as moved');
    eq(over.trimEnd, 10, 'and pulled back to the end of the clip');

    const startPast = { trimStart: 30, trimEnd: 40 };
    api.fitTrimToDuration(startPast, v);
    eq(startPast.trimStart, 0, 'a trimStart the clip does not have is zeroed');
    eq(startPast.trimEnd, 10, 'and the end follows the clip, not the old number');

    const fine = { trimStart: 2, trimEnd: 8 };
    eq(api.fitTrimToDuration(fine, v), false, 'a trim that fits is left completely alone');
    eq(fine.trimEnd, 8, 'end untouched');
    eq(fine.trimStart, 2, 'start untouched');

    const unset = { trimStart: 0, trimEnd: 0 };
    eq(api.fitTrimToDuration(unset, v), false, 'an unset trimEnd means "the whole clip"');
    eq(unset.trimEnd, 0, 'so it must NOT be filled in with the duration — 0 is a meaning, not a hole');

    const noDur = { trimStart: 3, trimEnd: 9 };
    eq(api.fitTrimToDuration(noDur, { duration: NaN }), false, 'no duration yet: do not guess');
    eq(noDur.trimEnd, 9, 'nothing moves');
    eq(api.fitTrimToDuration(null, v), false, 'and no item is not an error');
  });

  block('8. a swap refits the trim and drops a stale frame rate', () => {
    const it = makeItem('c1');
    it.trimStart = 2; it.trimEnd = 40;
    it.video._kraftedFps = 24;                 // auto-detected from the PROXY
    api.applyOriginalLink(it, vid('a.mov'));

    eq(api.swapProxyMedia(it), true, 'the swap happens');
    eq('_kraftedFps' in it.video, false,
       'the auto-detected rate is dropped — it belongs to the file, not the card');

    it.video.duration = 9;                     // the original is shorter than the proxy
    it.video._fire('loadedmetadata');
    eq(it.trimEnd, 9, 'the trim is refitted once the real duration is known');
    eq(it.trimStart, 2, 'an in-range in-point survives');

    // ...but a rate the user typed by hand is a decision about the shot.
    const manual = makeItem('c2');
    manual.video._kraftedFps = 25;
    manual.video._kraftedFpsManual = true;
    api.applyOriginalLink(manual, vid('a.mov'));
    api.swapProxyMedia(manual);
    eq(manual.video._kraftedFps, 25, 'a manually set frame rate survives the swap');
  });

  block('9. one call site for the refit, in the swap', () => {
    const link = stripComments(LINK);
    eq(countIn(/fitTrimToDuration\(/g, link), 2,
       'one definition + one call — and the call is the swap, not a second place', link.slice(0, 80));
    ok(link.indexOf('function fitTrimToDuration(') < link.indexOf('    fitTrimToDuration(item, v);'),
       'the call comes after the definition; it is not a forward reference to something else');
  });

  console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + '  (' + pass + ' passed' +
              (fail ? ', ' + fail + ' failed' : '') + ')');
  process.exit(fail === 0 ? 0 : 1);
})();
