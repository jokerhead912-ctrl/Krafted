// v7.0.48 regression suite — naming a view, and one view shape instead of six
//
//   "The Present stuff from the last couple of times: renaming is really
//    inconvenient, right now they're all called View 1 2 3 4 and I have to
//    rename every single one. Can the renaming logic be better? And maybe a
//    simple colour so I can find what I want quickly — my end goal is just
//    convenience. Like, after I add a Present step it should just open the
//    rename field for me to type in. ... Or a hotkey that would be handy —
//    say I've selected this image, then some key drops it straight into
//    Present and I can rename it immediately."
//
// Four separate complaints, one root cause each:
//
//   1. Renaming went through window.prompt() — a native dialog, reached only
//      by double-clicking a row. Styleless, interruptive, and on macOS it
//      reads as the app having crashed.
//   2. Every new view was named "View 4". A name you have to replace every
//      single time is not a name, it is a tax the feature charges you.
//   3. There was no colour, so a rail of twelve identical rows was a rail you
//      had to read.
//   4. Adding a shot had NO KEY AT ALL. The action existed in the registry
//      bound to `keys: []`, so every shot had to be started from a 236px rail
//      — the feature was keyboard-only in the one place where a mouse is
//      slowest and the board is biggest.
//
// And one defect found while fixing them, which is the reason this suite
// exists in the shape it does: the view shape was spelled out by hand in SIX
// places. Adding a colour field meant finding six lines, and any one of them
// missed would have produced a view that silently lost its colour on reload —
// exactly the class of bug that is invisible until it is expensive. That is
// collapsed to one writer and one reader first, so the rest of the change has
// a single place to live.
//
// Everything behavioural below is the REAL source, sliced out and executed.

const fs = require('fs');
const path = require('path');

// KRAFTED_HTML / KRAFTED_SW let the mutation check point this suite at a
// deliberately broken COPY, so the real dev file is never touched.
const HTML = process.env.KRAFTED_HTML
  ? path.resolve(process.env.KRAFTED_HTML)
  : path.resolve(__dirname, '../../kraftpub-dev.html');
const SWJS = process.env.KRAFTED_SW
  ? path.resolve(process.env.KRAFTED_SW)
  : path.resolve(__dirname, '../docs/sw.js');
const src = fs.readFileSync(HTML, 'utf8');
const sw = fs.readFileSync(SWJS, 'utf8');

const EXPECT_VERSION = '7.2.0';

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; console.log('  FAIL: ' + label); }
}
function eq(actual, expected, label) {
  ok(actual === expected,
     label + '  (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')');
}
function has(hay, needle, label) {
  ok(hay.indexOf(needle) >= 0, label + '  (missing: ' + JSON.stringify(needle) + ')');
}
function hasnt(hay, needle, label) {
  ok(hay.indexOf(needle) < 0, label + '  (should be absent: ' + JSON.stringify(needle) + ')');
}
function occs(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
  return n;
}

// Extract a whole function by brace matching.
//
// The `async function` form is tried FIRST. Slicing from the bare `function`
// substring inside `async function foo(` yields a body that awaits without
// being async, which refuses to parse — and the failure reads as a broken
// suite rather than a wrong slice.
//
// Brace matching is a plain counter, so a BRACE INSIDE A REGEX breaks it:
// /^#([0-9a-fA-F]{6})$/ opens and closes, so depth returns to 0 mid-function
// and the slice ends early. Those functions are taken with fnTop instead.
function fnFull(name, s) {
  let a = s.indexOf('async function ' + name + '(');
  if (a < 0) a = s.indexOf('function ' + name + '(');
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
// A top-level function, sliced by its closing brace at column 0. Safe for the
// functions whose braces inside regex literals defeat fnFull.
function fnTop(header, s) {
  const a = s.indexOf(header);
  if (a < 0) { console.log('  FAIL: no header ' + header); fail++; return ''; }
  const b = s.indexOf('\n}\n', a);
  if (b < 0) { console.log('  FAIL: no closing brace for ' + header); fail++; return ''; }
  return s.slice(a, b + 2);
}
// Strip BOTH comment forms before asserting on code. Whole-line // is not
// enough: commenting a call out with /* ... */ leaves the text behind and a
// bare indexOf still finds it — four mutations escaped an earlier suite that
// way.
function codeOnly(s) {
  // The cap matters. This file contains a string literal '/*' whose matching
  // '*/' sits 270 KB further on, so an unbounded strip deletes 42% of the
  // source — every assertion then runs against a file that has silently lost
  // the code it is meant to be checking. Real comments here top out at 831
  // characters; the three runaway spans are all 21 KB or more.
  return s.replace(/\/\*[\s\S]{0,4000}?\*\//g, '')
          .split('\n').filter(function (l) { return l.trim().indexOf('//') !== 0; }).join('\n');
}

console.log('Krafted v' + EXPECT_VERSION + ' — naming a view, and one view shape instead of six');
console.log('');

// ═══════════════════════════════════════════════════════════════════════
//  1. ONE WRITER, ONE READER
// ═══════════════════════════════════════════════════════════════════════
// The view shape used to be hand-spelled in six places: the V5 manifest
// builder, both .kpak save paths, the undo snapshot, the undo restore, and
// the .kpak load. Each of those is asserted by its own line below, because
// "the shape is now defined once" is only true if none of them is left.
const code = codeOnly(src);

ok(occs(code, 'map(serializeView)') === 4,
   'every save path calls serializeView — manifest + 2 kpak + undo snapshot (got ' +
   occs(code, 'map(serializeView)') + ', want 4)');
has(code, 'manifest.views = (state.views || []).map(serializeView);',
    'the V5 manifest path uses the shared writer');
has(code, 'state.views = (snap.views || []).map(function (v) { return deserializeView(v); });',
    'the undo restore uses the shared reader');
has(code, 'state.views.push(deserializeView(vd, _remapId));',
    'the .kpak load passes its id remapper to the shared reader');

// The strongest form of "defined once": each field is spelled exactly once
// per direction. Two occurrences of a field means a second place to forget.
eq(occs(code, "name: v.name || ''"), 1, 'a view name is written in exactly one place');
eq(occs(code, "name: vd.name || ''"), 1, 'a view name is read in exactly one place');
eq(occs(code, '(v.ids || []).slice()'), 1, 'a view id list is copied in exactly one place');
eq(occs(code, "createdAt: v.createdAt || ''"), 1, 'createdAt is written in exactly one place');
eq(occs(code, "createdAt: vd.createdAt || ''"), 1, 'createdAt is read in exactly one place');
eq(occs(code, "updatedAt: v.updatedAt || ''"), 1, 'updatedAt is written in exactly one place');
eq(occs(code, "color: v.color || ''"), 1, 'the colour is written in exactly one place');
eq(occs(code, "color: vd.color || ''"), 1, 'the colour is read in exactly one place');
// The old six-line loads, in the exact shapes they were written in.
hasnt(code, "name: v.name || '', ids: (v.ids || []).slice()",
      'no save path spells the view shape out by hand any more');
hasnt(code, "return { id: vd.id,", 'no load path spells the view shape out by hand any more');
hasnt(code, "panX: v.panX, panY: v.panY, zoom: v.zoom, createdAt: v.createdAt || ''",
      'the combined field list is gone from every call site');

// ── the shared pair, executed ───────────────────────────────────────────
const paletteMatch = /var VIEW_COLORS = (\[[^\]]*\]);/.exec(src);
if (!paletteMatch) { console.log('  FAIL: no VIEW_COLORS palette in the source'); fail++; }
const pairSrc =
  fnFull('serializeView', src) + '\n' +
  fnFull('deserializeView', src) + '\n' +
  fnTop('function viewColor(v) {', src) + '\n' +
  fnTop('function viewTint(hex) {', src) + '\n' +
  'var VIEW_COLORS = ' + (paletteMatch ? paletteMatch[1] : '[]') + ';\n';
const PALETTE = ['', '#00e5ff', '#ffdd44', '#ff6b6b', '#51cf66', '#cc5de8', '#ff922b', '#74c0fc', '#ffffff'];
let S = null;
try {
  S = new Function(pairSrc + '\nreturn { serializeView: serializeView, deserializeView: deserializeView,' +
    ' viewColor: viewColor, viewTint: viewTint, VIEW_COLORS: VIEW_COLORS };')();
} catch (e) {
  console.log('  FAIL: could not load the serializer pair — ' + e.message); fail++;
}

if (S) {
  const full = { id: 7, name: 'Act 2', ids: [1, 2, 3], panX: -40, panY: 90, zoom: 0.5,
                 createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z',
                 color: '#ff6b6b' };
  const out = S.serializeView(full);
  eq(JSON.stringify(Object.keys(out).sort()),
     JSON.stringify(['color', 'createdAt', 'id', 'ids', 'name', 'panX', 'panY', 'updatedAt', 'zoom'].sort()),
     'serializeView writes exactly the nine fields a view has');
  eq(out.name, 'Act 2', 'serializeView keeps the name');
  eq(out.color, '#ff6b6b', 'serializeView keeps the colour');
  eq(out.updatedAt, '2026-08-30T01:00:00.000Z',
     'serializeView keeps updatedAt — every save path used to drop it on the floor');
  ok(out.ids !== full.ids, 'serializeView copies the id list rather than aliasing it');
  out.ids.push(99);
  eq(full.ids.length, 3, 'mutating the serialized copy cannot reach back into the view');

  // A .kpak saved by v7.0.45 has neither colour nor updatedAt. It has to load
  // as a perfectly ordinary uncoloured view, not as a view with undefined
  // fields that then get written back out.
  const legacy = S.deserializeView({ id: 3, name: 'Old', ids: [5], panX: 1, panY: 2, zoom: 1, createdAt: 'x' });
  eq(legacy.color, '', 'a v7.0.45 view with no colour loads as uncoloured, not undefined');
  eq(legacy.updatedAt, '', 'a v7.0.45 view with no updatedAt loads as empty, not undefined');
  eq(legacy.name, 'Old', 'a legacy view keeps its name');
  eq(JSON.stringify(S.serializeView(legacy).ids), '[5]', 'a legacy view round-trips back out cleanly');
  ok(!('undefined' in JSON.parse(JSON.stringify(legacy))), 'a legacy view carries no undefined fields');

  // The remap is what lets a .kpak import renumber every id on the board.
  const remapped = S.deserializeView({ id: 1, name: 'n', ids: [10, 20] }, function (x) { return x * 100; });
  eq(JSON.stringify(remapped.ids), '[1000,2000]', 'deserializeView runs the id remapper over the id list');
  const plain = S.deserializeView({ id: 1, name: 'n', ids: [10, 20] });
  eq(JSON.stringify(plain.ids), '[10,20]', 'without a remapper the ids pass through untouched');
  eq(JSON.stringify(S.deserializeView(full).ids), '[1,2,3]', 'deserializeView keeps the id list');

  // Round trip: a view that survives save/load is unchanged.
  const back = S.deserializeView(S.serializeView(full));
  eq(JSON.stringify(Object.keys(back).sort()), JSON.stringify(Object.keys(out).sort()),
     'a round trip neither gains nor loses a field');
  eq(back.color, '#ff6b6b', 'the colour survives a save/load round trip');
  eq(back.updatedAt, '2026-08-30T01:00:00.000Z', 'updatedAt survives a save/load round trip');

  // ── the palette ──
  eq(S.VIEW_COLORS.length, 9, 'nine chips: eight colours and a way to clear one');
  eq(S.VIEW_COLORS[0], '', 'the first chip is "no colour", so a chip can always be cleared');
  ok(S.VIEW_COLORS.indexOf('#00e5ff') > 0,
     'the accent cyan is in the palette, so a coloured view speaks the board language');
  eq(new Set(S.VIEW_COLORS).size, 9, 'no duplicate chips');

  // ── colour hygiene: only a palette value is trusted ──
  eq(S.viewColor({ color: '#ff6b6b' }), '#ff6b6b', 'a palette colour is accepted');
  eq(S.viewColor({ color: '#123456' }), '', 'a colour that is not in the palette is rejected');
  eq(S.viewColor({ color: 'red' }), '', 'a CSS keyword is rejected');
  eq(S.viewColor({ color: "'; background:url(x)" }), '', 'an injection attempt is rejected');
  eq(S.viewColor({}), '', 'a view with no colour reads as uncoloured');
  eq(S.viewColor(null), '', 'viewColor tolerates a null view');

  // ── the tint wash keeps the number inside the chip readable ──
  eq(S.viewTint('#00e5ff'), 'rgba(0,229,255,0.20)', 'cyan washes to a 20% fill');
  eq(S.viewTint('#ffffff'), 'rgba(255,255,255,0.20)', 'white washes to a 20% fill');
  eq(S.viewTint('red'), 'transparent', 'a named colour produces no wash rather than a broken one');
  eq(S.viewTint(''), 'transparent', 'no colour produces no wash');
  eq(S.viewTint('#fff'), 'transparent', 'a 3-digit hex produces no wash rather than a wrong one');
}

// ═══════════════════════════════════════════════════════════════════════
//  2. THE HARNESS
// ═══════════════════════════════════════════════════════════════════════
let created = [];
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    className: '', textContent: '', value: '', type: '', title: '',
    maxLength: 0, disabled: false, clicked: false,
    style: {}, children: [], _listeners: {}, _attrs: {}, _parent: null,
    _focused: 0, _selected: 0, _scrolled: 0,
    _cls: function () { return String(el.className || '').split(/\s+/).filter(Boolean); },
    appendChild: function (c) { c._parent = el; el.children.push(c); return c; },
    removeChild: function (c) {
      const i = el.children.indexOf(c);
      if (i >= 0) el.children.splice(i, 1);
      c._parent = null;
    },
    // Must actually detach: a flag alone leaves the row in the list, so
    // "the strip closed" reads as false when the code was right.
    remove: function () {
      if (el._parent) {
        const i = el._parent.children.indexOf(el);
        if (i >= 0) el._parent.children.splice(i, 1);
        el._parent = null;
      }
    },
    setAttribute: function (k, v) { el._attrs[k] = v; },
    getAttribute: function (k) { return (k in el._attrs) ? el._attrs[k] : null; },
    addEventListener: function (t, fn) { (el._listeners[t] = el._listeners[t] || []).push(fn); },
    focus: function () { el._focused++; },
    select: function () { el._selected++; },
    scrollIntoView: function () { el._scrolled++; },
    click: function () { el.clicked = true; },
    querySelector: function (sel) { return null; }
  };
  // innerHTML has to behave like the real thing: assigning to it REPLACES the
  // children. Leaving it as a plain string means a second render appends to
  // the first one's rows, so every "there is exactly one row" assertion counts
  // two and the test blames the code for something the fake did.
  let _html = '';
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return _html; },
    set: function (v) { _html = String(v); el.children = []; }
  });
  el.classList = {
    add: function (c) { if (el._cls().indexOf(c) < 0) el.className = (el._cls().concat([c])).join(' '); },
    remove: function (c) { el.className = el._cls().filter(function (x) { return x !== c; }).join(' '); },
    contains: function (c) { return el._cls().indexOf(c) >= 0; },
    toggle: function (c, on) {
      const want = (on === undefined) ? !el.classList.contains(c) : !!on;
      if (want) el.classList.add(c); else el.classList.remove(c);
    }
  };
  return el;
}
function fire(el, type, ev) {
  (el._listeners[type] || []).forEach(function (fn) { fn(ev || {}); });
}
// Document order, not stack order. A DFS that pops the last-pushed child
// returns siblings reversed, so "the first chip" is actually the last row and
// every index into the result is off by one.
function findEl(pred, root) {
  const all = [];
  (function walk(node) {
    if (!node) return;
    if (pred(node)) all.push(node);
    (node.children || []).forEach(walk);
  })(root || doc.body);
  return all;
}
function byClass(name, root) {
  return findEl(function (e) { return e._cls().indexOf(name) >= 0; }, root);
}

const doc = {
  body: makeEl('body'),
  createElement: function (t) { const e = makeEl(t); created.push(e); return e; },
  getElementById: function (id) { return domIds[id] || null; }
};
let domIds = {};
function setupDom() {
  domIds = {
    'views-panel': makeEl('div'),
    'views-list': makeEl('div'),
    'views-present-btn': makeEl('button'),
    'views-head-text': makeEl('h3')
  };
  created = [];
}

let rafQueue = [];
function requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; }
function flushRaf() {
  const q = rafQueue; rafQueue = [];
  q.forEach(function (f) { f(0); });
}

const calls = { undo: 0, autosave: 0, toasts: [], renders: 0, goto: [], stopPresent: 0 };
function resetCalls() {
  calls.undo = 0; calls.autosave = 0; calls.toasts = []; calls.renders = 0;
  calls.goto = []; calls.stopPresent = 0;
}

// The live-id set the stubbed viewLiveIds counts against, so the count badge
// can be exercised without building real board items.
let LIVE = new Set();
const stubs = {
  document: doc,
  console: { log: function () {}, warn: function () {}, error: function () {} },
  requestAnimationFrame: requestAnimationFrame,
  toast: function (m) { calls.toasts.push(String(m)); },
  pushUndo: function () { calls.undo++; },
  scheduleAutoSave: function () { calls.autosave++; },
  stopPresent: function () { calls.stopPresent++; },
  gotoView: function (i) { calls.goto.push(i); },
  moveView: function () {},
  updateViewFromCurrent: function () {},
  viewLiveIds: function (v) { return (v.ids || []).filter(function (id) { return LIVE.has(id); }); },
  renderViewsPanel: function () { calls.renders++; }
};

// ── the whole views editing block, executed ─────────────────────────────
const viewBlock =
  fnFull('_viewsList', src) + '\n' +
  fnFull('nextViewId', src) + '\n' +
  pairSrc + '\n' +
  fnTop('function suggestViewName(ids) {', src) + '\n' +
  fnTop('function nextViewNameInSequence() {', src) + '\n' +
  fnFull('beginViewRename', src) + '\n' +
  fnFull('commitViewRename', src) + '\n' +
  fnFull('renameViewAt', src) + '\n' +
  fnFull('setViewColor', src) + '\n' +
  fnFull('deleteView', src) + '\n' +
  fnFull('saveViewFromSelection', src) + '\n' +
  fnFull('renderViewsPanel', src) + '\n';

let V = null, harnessState = null;
try {
  V = new Function(
    'document', 'console', 'requestAnimationFrame', 'toast', 'pushUndo',
    'scheduleAutoSave', 'stopPresent', 'gotoView', 'moveView',
    'updateViewFromCurrent', 'viewLiveIds',
    'var state = arguments[arguments.length - 2];' +
    'var G = arguments[arguments.length - 1];' +
    viewBlock +
    // renderViewsPanel is defined above; the stubs above are only for the
    // functions the panel calls that are not under test here.
    '\nreturn { _viewsList: _viewsList, nextViewId: nextViewId, serializeView: serializeView,' +
    ' deserializeView: deserializeView, viewColor: viewColor, viewTint: viewTint,' +
    ' VIEW_COLORS: VIEW_COLORS, suggestViewName: suggestViewName,' +
    ' nextViewNameInSequence: nextViewNameInSequence,' +
    ' beginViewRename: beginViewRename, commitViewRename: commitViewRename,' +
    ' renameViewAt: renameViewAt, setViewColor: setViewColor, deleteView: deleteView,' +
    ' saveViewFromSelection: saveViewFromSelection, renderViewsPanel: renderViewsPanel };'
  );
} catch (e) {
  console.log('  FAIL: could not compile the views block — ' + e.message); fail++;
}

function freshState(views) {
  return {
    views: views || [],
    selected: new Set(),
    texts: [],
    _activeViewIndex: -1,
    _viewEditingId: 0,
    _viewSwatchId: 0,
    _present: null,
    pan: { x: 0, y: 0 },
    zoom: 1
  };
}
function build(views) {
  setupDom();
  resetCalls();
  LIVE = new Set();
  rafQueue = [];
  const st = freshState(views);
  const g = {};
  const api = V(stubs.document, stubs.console, stubs.requestAnimationFrame, stubs.toast,
                stubs.pushUndo, stubs.scheduleAutoSave, stubs.stopPresent, stubs.gotoView,
                stubs.moveView, stubs.updateViewFromCurrent, stubs.viewLiveIds, st, g);
  return { st: st, G: g, api: api };
}

// ═══════════════════════════════════════════════════════════════════════
//  3. NAMING
// ═══════════════════════════════════════════════════════════════════════
// window.prompt is gone from the views module entirely. This is asserted on
// the source as well as the behaviour, because a prompt left behind on some
// other entry point is the exact regression that is invisible in a unit test.
hasnt(codeOnly(fnFull('renameViewAt', src)), 'window.prompt', 'renameViewAt no longer opens a native dialog');
hasnt(codeOnly(fnFull('saveViewFromSelection', src)), 'window.prompt', 'saving a view never prompts');
hasnt(code, "window.prompt('Name this view'", 'the old prompt call site is gone from the file');

if (V) {
  // ── suggestViewName: use the words the user actually wrote ──
  {
    const h = build([]);
    h.st.texts = [
      { id: 11, el: { textContent: 'Act 2 — the chase' } },
      { id: 12, el: { textContent: 'lighting ref' } }
    ];
    eq(h.api.suggestViewName([11, 12]), 'Act 2 — the chase',
       'a view framing a text box takes its name from that text');
    eq(h.api.suggestViewName([12]), 'lighting ref',
       'the name comes from the text in THIS selection, not the first one on the board');
    h.st.texts = [{ id: 11, el: { textContent: '\n\n   Mood board  \nsecond line' } }];
    eq(h.api.suggestViewName([11]), 'Mood board',
       'a leading blank line and padding are stripped — the first line with words wins');
    h.st.texts = [{ id: 11, el: { textContent: 'a   very    spaced\nout label' } }];
    eq(h.api.suggestViewName([11]), 'a very spaced',
       'internal runs of whitespace collapse, so the chip does not print a gap');
    h.st.texts = [{ id: 11, el: { textContent: 'x'.repeat(80) } }];
    eq(h.api.suggestViewName([11]).length, 40, 'a runaway label is cut to 40 characters');
    h.st.texts = [{ id: 11, el: { textContent: '   \n  \n' } }];
    eq(h.api.suggestViewName([11]), '', 'a blank text box suggests nothing rather than whitespace');
    h.st.texts = [{ id: 11, el: { textContent: 'Act 2' } }];
    eq(h.api.suggestViewName([99]), '', 'a selection with no text suggests nothing');
    eq(h.api.suggestViewName([]), '', 'an empty selection suggests nothing');
    h.st.texts = [{ id: 11, el: null }];
    eq(h.api.suggestViewName([11]), '', 'a text item with no element suggests nothing, and does not throw');
  }

  // ── saving a view opens the name field with the suggestion selected ──
  // This is the request, verbatim: "after I add a Present step it should just
  // open the rename field for me to type in."
  {
    const h = build([]);
    h.st.texts = [{ id: 11, el: { textContent: 'Act 2 — the chase' } }];
    h.st.selected = new Set([11, 21]);
    LIVE = new Set([11, 21]);
    const v = h.api.saveViewFromSelection();
    ok(!!v, 'saving a selection returns the view');
    eq(v.name, 'Act 2 — the chase', 'a new view is named after what it frames, not "View 1"');
    eq(h.st._viewEditingId, v.id, 'the new view opens straight into edit mode');
    h.api.renderViewsPanel();
    flushRaf();
    const inputs = byClass('view-name-edit', domIds['views-list']);
    eq(inputs.length, 1, 'the row renders a name field instead of a label');
    eq(inputs[0].value, 'Act 2 — the chase', 'the field holds the suggested name');
    eq(inputs[0]._focused, 1, 'the field takes focus on its own — no second click to start typing');
    eq(inputs[0]._selected, 1,
       'the suggestion is pre-selected, so the first keystroke replaces it outright');
    eq(calls.toasts.length, 1, 'saving still says it saved');
    has(calls.toasts[0], 'Act 2 — the chase', 'the toast names the view it saved');
  }

  // ── a selection with no text falls back to View N, not to a filename ──
  {
    const h = build([]);
    h.st.selected = new Set([21, 22]);
    LIVE = new Set([21, 22]);
    const a = h.api.saveViewFromSelection();
    eq(a.name, 'View 1', 'with nothing written on the board the fallback is still View N');
    const b = h.api.saveViewFromSelection();
    eq(b.name, 'View 2', 'the fallback counts up');
    eq(calls.undo, 2, 'each save is its own undo step');
  }

  // ── an explicit name still wins ──
  {
    const h = build([]);
    h.st.selected = new Set([21]);
    LIVE = new Set([21]);
    eq(h.api.saveViewFromSelection('Cold open').name, 'Cold open',
       'a name passed in is used as given');
  }

  // ── no selection, no view, no toast claiming otherwise ──
  {
    const h = build([]);
    eq(h.api.saveViewFromSelection(), null, 'saving with nothing selected does nothing');
    eq(calls.undo, 0, 'a refused save takes no undo step');
    // The refusal has to name the key. "Select the items this view should
    // frame first" was true and useless: it left the user hunting through a
    // 236px rail, which is the thing the hotkey exists to remove.
    has(calls.toasts[0] || '', 'press P', 'a refused save says which key to press');
  }

  // ── adding a shot mid-pitch is refused outright ──
  // It used to be half-refused: the view was created and only the rename was
  // skipped, so an unnamed "View 7" landed in the running order of a live
  // presentation with no way to fix it before the meeting moved on.
  {
    const h = build([{ id: 1, name: 'One', ids: [1] }]);
    h.st._present = { index: 0, timer: null };
    h.st.selected = new Set([21]);
    LIVE = new Set([21]);
    eq(h.api.saveViewFromSelection(), null, 'adding a shot while presenting does nothing');
    eq(h.st.views.length, 1, 'the tape does not gain an unnamed row');
    eq(calls.undo, 0, 'a refused save takes no undo step');
    has(calls.toasts[0] || '', 'Stop the presentation', 'the refusal says how to get unstuck');
  }

  // ── nextViewNameInSequence: stop re-typing the running order ──
  // "全部都係 view 1234 我每次都要重新改" — the number was never the problem,
  // having to supply it every single time was.
  {
    const h = build([]);
    const seq = function (names) {
      h.st.views = names.map(function (n, i) { return { id: i + 1, name: n, ids: [i + 1] }; });
      return h.api.nextViewNameInSequence();
    };
    eq(seq([]), '', 'no views yet, so nothing to continue from');
    eq(seq(['Cold open']), '', 'a last view with no number offers nothing');
    eq(seq(['CU 1']), 'CU 2', '"CU 1" offers "CU 2"');
    eq(seq(['CU 1', 'CU 2', 'CU 3']), 'CU 4', 'the last view is the one continued, not the first');
    eq(seq(['CU 1', 'Finale']), '', 'only the last view is consulted — an unrelated name stops it');
    eq(seq(['Beat 07']), 'Beat 08', 'zero padding is preserved, or a padded list stops sorting');
    eq(seq(['Beat 009']), 'Beat 010', 'padding survives carrying into a new digit');
    eq(seq(['Shot 9']), 'Shot 10', 'reaching ten just works');
    // The dedupe path only fires when the number being offered is one the tape
    // ALREADY holds — i.e. the last shot is not the highest. ['CU 2', 'CU 1']
    // offers "CU 2" first and has to step over it.
    eq(seq(['CU 2', 'CU 1']), 'CU 3',
       'a name the tape already has is skipped rather than offered as a duplicate');
    eq(seq(['CU 1', 'CU 2', 'CU 2']), 'CU 3',
       'a duplicate sitting on the last row does not confuse the starting point');
    eq(seq(['View 1']), 'View 2', 'the plain fallback chains too, so it counts up on its own');
    eq(seq(['Act 2 — the chase 5']), 'Act 2 — the chase 6',
       'a stem with punctuation in it carries over intact');
    h.st.views = [{ id: 1, name: 'x'.repeat(70) + ' 5', ids: [1] }];
    ok(h.api.nextViewNameInSequence().length <= 60, 'a runaway suggestion is still capped at 60');
    h.st.views = [{ id: 1, name: '', ids: [1] }, { id: 2, name: null, ids: [2] }];
    eq(h.api.nextViewNameInSequence(), '', 'a nameless view offers nothing, and does not throw');
  }

  // ── the sequence is what the name field opens with ──
  {
    const h = build([{ id: 1, name: 'CU 1', ids: [1] }]);
    h.st.selected = new Set([21]);
    LIVE = new Set([21]);
    const v = h.api.saveViewFromSelection();
    eq(v.name, 'CU 2', 'a shot added after "CU 1" opens as "CU 2", not "View 2"');
    eq(h.st._viewEditingId, v.id, 'and it opens in edit mode, so the suggestion can be typed over');
  }

  // ── text in the selection still beats the sequence ──
  {
    const h = build([{ id: 1, name: 'CU 1', ids: [1] }]);
    h.st.texts = [{ id: 11, el: { textContent: 'Lighting ref' } }];
    h.st.selected = new Set([11]);
    LIVE = new Set([11]);
    eq(h.api.saveViewFromSelection().name, 'Lighting ref',
       'words the user actually wrote outrank a number carried forward');
  }

  // ── beginViewRename ──
  {
    const h = build([{ id: 1, name: 'One', ids: [1] }, { id: 2, name: 'Two', ids: [2] }]);
    domIds['views-panel'].classList.add('collapsed');
    ok(h.api.beginViewRename(1), 'beginViewRename succeeds on a real row');
    eq(h.st._viewEditingId, 2, 'editing is keyed on the view ID, not its position');
    ok(!domIds['views-panel'].classList.contains('collapsed'),
       'renaming un-collapses the rail — you cannot type into a hidden field');
    eq(h.api.beginViewRename(9), false, 'renaming a row that is not there fails quietly');
    h.st._present = { index: 0 };
    eq(h.api.beginViewRename(0), false, 'renaming is refused while the tape is running');
  }

  // ── commitViewRename ──
  {
    const h = build([{ id: 1, name: 'One', ids: [1] }]);
    h.api.beginViewRename(0);
    h.api.commitViewRename(1, 'Cold open', false);
    eq(h.api._viewsList()[0].name, 'Cold open', 'committing writes the new name');
    eq(calls.undo, 1, 'committing takes exactly one undo step');
    eq(calls.autosave, 1, 'committing schedules a save');
    eq(h.st._viewEditingId, 0, 'committing closes the editor');
  }
  {
    const h = build([{ id: 1, name: 'One', ids: [1] }]);
    h.api.commitViewRename(1, 'Renamed', true);
    eq(h.api._viewsList()[0].name, 'One', 'cancelling leaves the name alone');
    eq(calls.undo, 0, 'cancelling takes no undo step');
  }
  {
    const h = build([{ id: 1, name: 'One', ids: [1] }]);
    h.api.commitViewRename(1, 'One', false);
    eq(calls.undo, 0, 'committing an unchanged name takes no undo step — no junk history');
    eq(calls.autosave, 0, 'committing an unchanged name does not schedule a save');
  }
  {
    const h = build([{ id: 1, name: 'One', ids: [1] }]);
    h.api.commitViewRename(1, '   ', false);
    eq(h.api._viewsList()[0].name, 'One', 'a name of only whitespace is refused');
    eq(calls.undo, 0, 'a refused name takes no undo step');
  }
  {
    const h = build([{ id: 1, name: 'One', ids: [1] }]);
    h.api.commitViewRename(1, '  Padded  ', false);
    eq(h.api._viewsList()[0].name, 'Padded', 'a name is trimmed');
    h.api.commitViewRename(1, 'y'.repeat(200), false);
    eq(h.api._viewsList()[0].name.length, 60, 'a name is cut at 60 characters');
  }
  {
    const h = build([{ id: 1, name: 'One', ids: [1] }]);
    h.api.commitViewRename(999, 'Nope', false);
    eq(calls.undo, 0, 'committing against a view that is gone does not throw or dirty history');
  }
  // The blur guard: _viewEditingId has to be cleared BEFORE anything that can
  // re-enter. Enter commits, commit re-renders, the render removes the input,
  // removing the input fires blur, and blur commits again. Without the clear
  // happening first, that second pass takes a second undo step.
  // Checking "it appears somewhere before pushUndo" is not enough: deleting
  // the line entirely leaves indexOf at -1, which is still "before". It has to
  // be the first statement.
  // codeOnly drops whole-line comments only, so a trailing one has to go too.
  const commitLines = codeOnly(fnFull('commitViewRename', src)).trim().split('\n');
  eq(commitLines[1].split('//')[0].trim(), 'state._viewEditingId = 0;',
     'closing the editor is the FIRST statement of commit, so the blur that follows cannot commit twice');
}

// ═══════════════════════════════════════════════════════════════════════
//  4. COLOUR
// ═══════════════════════════════════════════════════════════════════════
if (V) {
  {
    const h = build([{ id: 1, name: 'One', ids: [1] }]);
    h.api.setViewColor(1, '#ff6b6b');
    eq(h.api._viewsList()[0].color, '#ff6b6b', 'a colour is stored on the view');
    eq(calls.undo, 1, 'colouring takes one undo step');
    eq(calls.autosave, 1, 'colouring schedules a save');
    eq(h.st._viewSwatchId, 0, 'picking a colour closes the swatch strip');
  }
  {
    const h = build([{ id: 1, name: 'One', ids: [1], color: '#ff6b6b' }]);
    h.api.setViewColor(1, '#ff6b6b');
    eq(calls.undo, 0, 're-picking the colour it already has takes no undo step');
  }
  {
    const h = build([{ id: 1, name: 'One', ids: [1], color: '#ff6b6b' }]);
    h.api.setViewColor(1, '');
    eq(h.api._viewsList()[0].color, '', 'the first chip clears the colour');
    eq(calls.undo, 1, 'clearing a colour is undoable');
  }
  {
    const h = build([{ id: 1, name: 'One', ids: [1] }]);
    h.api.setViewColor(1, '#123456');
    ok(h.api._viewsList()[0].color !== '#123456',
       'a colour outside the palette is normalised away rather than stored raw');
    eq(calls.undo, 0, 'refusing an off-palette colour takes no undo step');
    h.api.setViewColor(999, '#ff6b6b');
    eq(calls.undo, 0, 'colouring a view that is gone does nothing');
  }

  // ── the chip is the number, so a narrow rail stays narrow ──
  {
    const h = build([{ id: 1, name: 'One', ids: [1], color: '#ff6b6b' },
                     { id: 2, name: 'Two', ids: [2] }]);
    h.api.renderViewsPanel();
    const nums = byClass('view-num', domIds['views-list']);
    eq(nums.length, 2, 'every row has a number chip');
    ok(nums[0]._cls().indexOf('tinted') >= 0, 'a coloured view tints its chip');
    eq(nums[0].style.color, '#ff6b6b', 'the number takes the view colour');
    eq(nums[0].style.background, 'rgba(255,107,107,0.20)', 'the chip gets a wash of the colour');
    ok(nums[1]._cls().indexOf('tinted') < 0, 'an uncoloured view leaves its chip plain');
    eq(nums[0].textContent, '1', 'the chip still shows the Alt+N shortcut');
  }
  {
    const h = build([{ id: 1, name: 'One', ids: [1] }]);
    h.api.renderViewsPanel();
    const nums = byClass('view-num', domIds['views-list']);
    has(nums[0].title, 'colour', 'the chip says it is clickable for a colour');
    has(nums[0].title, 'Alt+1', 'the chip keeps advertising its shortcut');
    eq(byClass('view-swatches', domIds['views-list']).length, 0,
       'no swatch strip until one is asked for');
    fire(nums[0], 'click', { stopPropagation: function () {} });
    const strip = byClass('view-swatches', domIds['views-list']);
    eq(strip.length, 1, 'clicking the chip opens the swatch strip');
    eq(byClass('view-swatch', domIds['views-list']).length, 9, 'the strip offers nine chips');
    eq(byClass('on', domIds['views-list']).length, 1, 'exactly one chip reads as selected');
    fire(byClass('view-swatch', domIds['views-list'])[2], 'click', { stopPropagation: function () {} });
    eq(h.api._viewsList()[0].color, '#ffdd44', 'clicking a chip colours the view');
    eq(byClass('view-swatches', domIds['views-list']).length, 0, 'the strip closes once picked');
    // A second click on the same chip closes it again.
    fire(byClass('view-num', domIds['views-list'])[0], 'click', { stopPropagation: function () {} });
    eq(byClass('view-swatches', domIds['views-list']).length, 1, 'the chip toggles the strip open');
    fire(byClass('view-num', domIds['views-list'])[0], 'click', { stopPropagation: function () {} });
    eq(byClass('view-swatches', domIds['views-list']).length, 0, 'the chip toggles the strip shut');
  }

  // ── deleting must not leave the editor or the strip dangling ──
  {
    const h = build([{ id: 1, name: 'One', ids: [1], color: '#ff6b6b' }, { id: 2, name: 'Two', ids: [2] }]);
    h.api.beginViewRename(0);
    eq(h.st._viewEditingId, 1, 'the first row is being renamed');
    h.api.deleteView(0);
    eq(h.st._viewEditingId, 0, 'deleting the row being renamed closes the editor');
    h.st._viewSwatchId = 2;
    h.api.deleteView(0);
    eq(h.st._viewSwatchId, 0, 'deleting the row whose strip is open closes the strip');
    eq(h.api._viewsList().length, 0, 'both rows are gone');
  }
  {
    const h = build([{ id: 1, name: 'One', ids: [1] }, { id: 2, name: 'Two', ids: [2] }]);
    h.st._viewEditingId = 2;
    h.api.deleteView(0);
    eq(h.st._viewEditingId, 2, 'deleting a DIFFERENT row leaves the editor alone');
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  5. THE PANEL ITSELF
// ═══════════════════════════════════════════════════════════════════════
if (V) {
  {
    const h = build([{ id: 1, name: 'One', ids: [1] }, { id: 2, name: 'Two', ids: [2] }]);
    h.api.renderViewsPanel();
    eq(byClass('view-row', domIds['views-list']).length, 2, 'one row per view');
    eq(domIds['views-head-text'].textContent, 'Views 2', 'the rail header counts the views');
    eq(domIds['views-present-btn'].textContent, '▶ Present', 'the button reads Present when idle');
    h.st._present = { index: 0 };
    h.api.renderViewsPanel();
    eq(domIds['views-present-btn'].textContent, '■ Stop', 'the button reads Stop while presenting');
    ok(domIds['views-panel']._cls().indexOf('presenting') >= 0, 'the rail knows it is presenting');
    eq(byClass('active', domIds['views-list']).length, 1, 'the shot on screen is marked active');
  }
  {
    const h = build([]);
    h.api.renderViewsPanel();
    eq(domIds['views-head-text'].textContent, 'Views', 'an empty rail drops the count');
    has(domIds['views-list'].innerHTML, 'views-empty', 'an empty rail explains itself');
  }
  // A tape of twenty views is taller than the rail; the shot being presented
  // has to follow the tape, or "present" means "watch a highlight scroll away".
  {
    const views = [];
    for (let i = 0; i < 20; i++) views.push({ id: i + 1, name: 'V' + i, ids: [i] });
    const h = build(views);
    h.st._present = { index: 14 };
    h.api.renderViewsPanel();
    const active = byClass('active', domIds['views-list']);
    eq(active.length, 1, 'the presented row is the active one');
    eq(active[0]._scrolled, 1, 'the presented row is scrolled into view');
  }
  // The number dot for views past the first ten carries no shortcut.
  {
    const views = [];
    for (let i = 0; i < 12; i++) views.push({ id: i + 1, name: 'V' + i, ids: [i] });
    const h = build(views);
    h.api.renderViewsPanel();
    const nums = byClass('view-num', domIds['views-list']);
    eq(nums[9].textContent, '0', 'the tenth view is Alt+0');
    eq(nums[10].textContent, '·', 'the eleventh has no shortcut, and says so with a dot');
    hasnt(nums[10].title, 'Alt+', 'the eleventh chip does not advertise a shortcut it has not got');
  }
  // Clicking a name flies there and closes any open strip.
  {
    const h = build([{ id: 1, name: 'One', ids: [1] }]);
    h.st._viewSwatchId = 1;
    h.api.renderViewsPanel();
    fire(byClass('view-name', domIds['views-list'])[0], 'click', { stopPropagation: function () {} });
    eq(JSON.stringify(calls.goto), '[0]', 'clicking a name flies to that view');
    eq(h.st._viewSwatchId, 0, 'flying somewhere closes the swatch strip');
  }
  // The count badge still flags a view whose items have all been deleted.
  {
    const h = build([{ id: 1, name: 'One', ids: [7] }]);
    LIVE = new Set();
    h.api.renderViewsPanel();
    const cnt = byClass('view-count', domIds['views-list'])[0];
    ok(cnt._cls().indexOf('stale') >= 0, 'a view framing nothing is marked stale');
    eq(cnt.textContent, '0', 'the count reads zero');
  }

  // ── the field's keyboard contract ──
  {
    const h = build([{ id: 1, name: 'One', ids: [1] }, { id: 2, name: 'Two', ids: [2] }]);
    h.api.beginViewRename(0);
    h.api.renderViewsPanel();
    const inp = byClass('view-name-edit', domIds['views-list'])[0];
    inp.value = 'Cold open';
    fire(inp, 'keydown', { key: 'Enter', preventDefault: function () {}, stopPropagation: function () {} });
    eq(h.api._viewsList()[0].name, 'Cold open', 'Enter commits');
    eq(h.st._viewEditingId, 0, 'Enter closes the editor');
    eq(calls.undo, 1, 'Enter takes one undo step, not two — the blur after it does not re-commit');
  }
  {
    const h = build([{ id: 1, name: 'One', ids: [1] }]);
    h.api.beginViewRename(0);
    h.api.renderViewsPanel();
    const inp = byClass('view-name-edit', domIds['views-list'])[0];
    inp.value = 'Thrown away';
    fire(inp, 'keydown', { key: 'Escape', preventDefault: function () {}, stopPropagation: function () {} });
    eq(h.api._viewsList()[0].name, 'One', 'Escape discards the edit');
    eq(calls.undo, 0, 'Escape takes no undo step');
  }
  // Tab walks the whole running order, so naming twelve shots never once
  // requires reaching for the mouse.
  {
    const h = build([{ id: 1, name: 'One', ids: [1] }, { id: 2, name: 'Two', ids: [2] }]);
    h.api.beginViewRename(0);
    h.api.renderViewsPanel();
    const inp = byClass('view-name-edit', domIds['views-list'])[0];
    inp.value = 'Cold open';
    fire(inp, 'keydown', { key: 'Tab', preventDefault: function () {}, stopPropagation: function () {} });
    eq(h.api._viewsList()[0].name, 'Cold open', 'Tab commits the name being left');
    eq(h.st._viewEditingId, 2, 'Tab opens the next view for naming');
    const inp2 = byClass('view-name-edit', domIds['views-list'])[0];
    fire(inp2, 'keydown', { key: 'Tab', shiftKey: true, preventDefault: function () {}, stopPropagation: function () {} });
    eq(h.st._viewEditingId, 1, 'Shift+Tab steps back to the previous view');
  }
  {
    const h = build([{ id: 1, name: 'One', ids: [1] }]);
    h.api.beginViewRename(0);
    h.api.renderViewsPanel();
    const inp = byClass('view-name-edit', domIds['views-list'])[0];
    inp.value = 'Typed then clicked away';
    fire(inp, 'blur', {});
    eq(h.api._viewsList()[0].name, 'Typed then clicked away',
       'clicking away commits — losing a name you typed is worse than a stray commit');
  }
  // A row being renamed shows a field, not a label, and only that row.
  {
    const h = build([{ id: 1, name: 'One', ids: [1] }, { id: 2, name: 'Two', ids: [2] }]);
    h.api.beginViewRename(1);
    h.api.renderViewsPanel();
    eq(byClass('view-name-edit', domIds['views-list']).length, 1, 'only the row being edited grows a field');
    eq(byClass('view-name', domIds['views-list']).length, 1, 'the other row stays a label');
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  6. F2
// ═══════════════════════════════════════════════════════════════════════
{
  const a = src.indexOf("if (ev.key !== 'F2'");
  ok(a > 0, 'F2 is bound');
  const block = src.slice(a - 120, a + 620);
  has(block, "addEventListener('keydown'", 'F2 is a key handler');
  has(block, ', true);', 'F2 is registered on the capture phase, so no board hotkey eats it');
  has(block, "tagName === 'INPUT'", 'F2 stays out of the way while you are typing in a field');
  has(block, 'isContentEditable', 'F2 stays out of the way of a text box on the board');
  has(block, 'ev.preventDefault()', 'F2 does not also trigger whatever the browser had it bound to');
  has(block, 'beginViewRename(i)', 'F2 opens the same inline editor, not a second one');
  eq(occs(code, "if (ev.key !== 'F2'"), 1, 'F2 is bound exactly once');
}

// ═══════════════════════════════════════════════════════════════════════
//  7. ONE RENAME PATH, NOT TWO
// ═══════════════════════════════════════════════════════════════════════
// The recurring disease in this codebase is one behaviour with N hand-written
// copies. Every rename entry point has to funnel through beginViewRename.
has(codeOnly(fnFull('renameViewAt', src)), 'return beginViewRename(index);',
    'renameViewAt delegates rather than carrying a second copy of the logic');
eq(occs(code, 'beginViewRename('), 1 + 5,
   'beginViewRename has one definition and five callers: dblclick, F2, save, Tab, renameViewAt (got ' +
   occs(code, 'beginViewRename(') + ')');
has(codeOnly(fnFull('saveViewFromSelection', src)), 'beginViewRename(',
    'saving a view opens the editor');
has(codeOnly(fnFull('saveViewFromSelection', src)), 'suggestViewName(ids)',
    'saving a view asks for a suggested name before falling back to View N');
// v7.0.48: the guard moved from "skip the rename" to "refuse the whole save".
// Half-refusing it built an unnamed row into a live running order, which is
// worse than the keypress doing nothing. Asserted here as a shape and above,
// in section 3, as behaviour.
{
  const svCode = codeOnly(fnFull('saveViewFromSelection', src));
  has(svCode, 'if (state._present) {',
      'a save is refused outright while the tape is running');
  ok(svCode.indexOf('if (state._present) {') < svCode.indexOf('if (!ids.length) {'),
     'the present check comes first — no view is built before it is refused');
  has(svCode, 'Stop the presentation before adding a shot',
      'the refusal says how to get unstuck');
  hasnt(svCode, 'if (!state._present) beginViewRename',
      'the old half-guard — build the view, skip only the rename — is gone');
}
// The editor is rendered from one place: the panel. No second code path
// builds a name field.
eq(occs(code, "className = 'view-name-edit'"), 1, 'exactly one place creates the name field');
// One definition and one call site. The four ways out of the field (Enter,
// Escape, Tab, blur) all go through the local `finish`, so there is exactly
// one place that decides what committing means.
eq(occs(code, 'commitViewRename('), 2,
   'commitViewRename has one definition and one call site (got ' +
   occs(code, 'commitViewRename(') + ')');
const panelCode = codeOnly(fnFull('renderViewsPanel', src));
eq(occs(panelCode, 'finish = function'), 1, 'the field has exactly one definition of what finishing means');
eq(occs(panelCode, 'finish('), 4,
   'the field has four ways out — Enter, Escape, Tab, blur — and all four use `finish` (got ' +
   occs(panelCode, 'finish(') + ')');

// ═══════════════════════════════════════════════════════════════════════
//  8. THE SURFACE
// ═══════════════════════════════════════════════════════════════════════
{
  const a = src.indexOf('.view-num {');
  const b = src.indexOf('.view-name {');
  ok(a > 0 && b > a, 'the chip rule and the name rule are both in the stylesheet');
  const css = src.slice(a, b);
  has(css, 'cursor:pointer', 'the chip reads as clickable');
  has(css, 'border:1px solid transparent', 'an uncoloured chip keeps its box so nothing shifts');
  const c = src.indexOf('.view-name-edit {');
  ok(c > 0, 'the name field has a style of its own');
  has(src.slice(c, c + 240), 'border:1px solid var(--accent)',
      'the field is outlined in the accent so it is obviously the live thing');
  const d = src.indexOf('.view-swatches {');
  ok(d > 0, 'the swatch strip has a style of its own');
  const e = src.indexOf('.view-swatch {');
  ok(e > 0, 'a swatch has a style of its own');
  has(src.slice(e, src.indexOf('#views-foot', e)), '.view-swatch.on',
      'the selected swatch is marked');
  has(src.slice(e, src.indexOf('#views-foot', e)), '.view-swatch.none',
      'the clear chip is styled distinctly from the colours');
  hasnt(src.slice(a, b), 'width:13px', 'the old static chip rule is gone');
}

// ── the help panel has to describe what the thing now does ──
{
  // Bounded from the heading onwards: "A/B compare" also appears in the
  // toolbar, well before the help panel, and slicing to that earlier hit
  // yields an empty window that every assertion then quietly passes against.
  const hFrom = src.indexOf('Named views &amp; presenting');
  const h = src.slice(hFrom, src.indexOf('A/B compare', hFrom));
  has(h, 'F2', 'the help mentions F2 for renaming');
  has(h, 'Colour', 'the help mentions colour-coding');
  has(h, 'Tab while naming', 'the help mentions Tab walking the names');
  has(h, 'ready to type', 'the help says the name field opens ready to type');
  // The bare "<b>P</b>" is no longer a test. v7.0.48 added a second row that
  // names P as the previous-shot key while a tape runs, so asserting on the
  // tag alone stays green even with the row that teaches ADDING a shot
  // deleted. The mutation check proved it: it went green on that deletion.
  has(h, '<b>P</b></td><td style="padding:4px 0;">Add what is selected to Present',
      'the help names the key that adds a shot');
  has(h, '<b>Shift+P</b>', 'the help names the key that plays the tape');
  has(h, 'CU 1', 'the help explains that a numbered name carries forward');
}

// ═══════════════════════════════════════════════════════════════════════
//  9. THE HOTKEY — "揀咗呢張圖，某個快捷鍵就自動加咗落 present，即刻改名"
// ═══════════════════════════════════════════════════════════════════════
// The whole request, in one gesture. The action existed, but it was bound to
// no key at all, so every shot had to be started from a 236px rail.
{
  const a = src.indexOf('const DEFAULT_SHORTCUTS = [');
  const b = src.indexOf('\n];', a);
  ok(a > 0 && b > a, 'the default shortcut table is present');
  let defs = [];
  try { defs = new Function('return ' + src.slice(src.indexOf('[', a), b + 2))(); }
  catch (e) { fail++; console.log('  FAIL: could not parse DEFAULT_SHORTCUTS — ' + e.message); }

  const byId = {};
  defs.forEach(function (d) { byId[d.id] = d; });

  const sig = function (k) {
    return [k.ctrl ? 'ctrl' : '', k.meta ? 'meta' : '', k.shift ? 'shift' : '',
            k.alt ? 'alt' : '', String(k.key).toLowerCase()].filter(Boolean).join('+');
  };

  // ── P adds, Shift+P plays ──
  ok(!!byId['view-save'], 'the add-shot action is in the registry at all');
  ok(!!byId['view-present'], 'the play-tape action is in the registry at all');
  const saveKeys = (byId['view-save'] && byId['view-save'].keys) || [];
  const playKeys = (byId['view-present'] && byId['view-present'].keys) || [];
  eq(saveKeys.map(sig).join(','), 'p',
     'adding a shot is bound to bare P — one keystroke, no modifier (got ' +
     saveKeys.map(sig).join(',') + ')');
  eq(playKeys.map(sig).join(','), 'shift+p',
     'playing the tape is bound to Shift+P, the other end of the same letter (got ' +
     playKeys.map(sig).join(',') + ')');
  has(byId['view-save'].label, 'Present',
      'the palette label says what it does in the user\'s own words');

  // ── nothing else may claim either combo ──
  // A second binding on the same combo is decided by iteration order, which is
  // invisible in the UI: whichever entry happens to come first wins, and the
  // other one silently never fires.
  const owner = {};
  const clashes = [];
  defs.forEach(function (d) {
    (d.keys || []).forEach(function (k) {
      const s = sig(k);
      if (owner[s]) clashes.push(s + ': ' + owner[s] + ' vs ' + d.id);
      else owner[s] = d.id;
    });
  });
  eq(clashes.length, 0, 'no two default shortcuts claim the same key combo (' +
     clashes.join('; ') + ')');

  // ── the registry actually routes it ──
  has(code, "case 'view-save':", 'the dispatcher has a case for adding a shot');
  has(code, "case 'view-present':", 'the dispatcher has a case for playing the tape');
  {
    const c = src.indexOf("case 'view-save':");
    has(src.slice(c, c + 120), 'saveViewFromSelection()',
        'the dispatcher calls the one function that opens the name field');
  }

  // ── THE SAFETY LOCK ──
  // A bare letter is only safe because the typing guard runs BEFORE the
  // registry is consulted. Move `_dispatchShortcut` above the guard and every
  // word containing a "p" — "present", "shot", "stop" — starts creating views
  // while the user types a board caption. This pins that ordering.
  {
    const dispatchAt = code.indexOf('if (_dispatchShortcut(e)) return;');
    ok(dispatchAt > 0, 'the registry is consulted from the main keydown handler');
    // Search BACKWARD from the dispatch call, inside one handler-sized window.
    // A plain global indexOf finds the lookalike guard in the F-key handler
    // ~250 lines earlier, which spells the same test for the same reason — so
    // a mutation that narrows the REAL guard still passes on the strength of
    // that one. Anchoring on the dispatch and looking up is the only way to
    // prove the guard that actually protects this key is still there.
    const winFrom = Math.max(0, dispatchAt - 1500);
    const win = code.slice(winFrom, dispatchAt + 60);
    const guardAt = win.indexOf("ae.contentEditable === 'true'");
    ok(guardAt >= 0,
       'the typing guard sits in the same handler, immediately above the registry');
    const g = win.slice(guardAt);
    has(g, 'return;', 'the guard leaves the handler outright rather than falling through');
    has(g, 'INPUT', 'the guard covers input fields');
    has(g, 'TEXTAREA', 'the guard covers textareas');
    has(g, 'contentEditable', 'the guard covers board text boxes');
    has(g, '_dispatchShortcut',
        'the registry is consulted right after the guard, so nothing slips between them');
  }

  // ── discoverability: the key is where the work is ──
  has(src, 'title="Add the selected items to Present (P)',
      'the ＋ button names the key, so the rail teaches the shortcut');
  has(src, 'then press <b>P</b> to add it to Present',
      'an empty rail tells you the key instead of pointing at the ＋ button');
  // v7.0.48 rewrote this tooltip: the tape no longer plays itself, so the
  // button has to say that you drive it. Assert the part that teaches the
  // shortcut, not the whole sentence — the wording will change again.
  has(src, 'title="Present the views', 'the Present button still describes itself');
  has(src, 'Space or → for the next shot (Shift+P)"',
      'the Present button names its key too');
}

// ═══════════════════════════════════════════════════════════════════════
//  10. VERSION
// ═══════════════════════════════════════════════════════════════════════
eq((src.match(/<title>Krafted v([\d.]+)<\/title>/) || [])[1], EXPECT_VERSION,
   'the document title carries the version');
has(src, "var KRAFTED_VERSION = '" + EXPECT_VERSION + "';",
    'KRAFTED_VERSION is pinned to ' + EXPECT_VERSION);
has(sw, '// Krafted v' + EXPECT_VERSION + ' Service Worker', 'sw.js header comment bumped');
has(sw, "const CACHE_NAME = 'krafted-v" + EXPECT_VERSION + "-'", 'sw.js cache name bumped');
has(sw, "const APP_VERSION = '" + EXPECT_VERSION + "';", 'sw.js APP_VERSION bumped');

console.log('');
if (fail === 0) {
  console.log('ALL PASS (' + pass + ' assertions)');
} else {
  console.log(fail + ' FAILED, ' + pass + ' passed');
}
process.exit(fail === 0 ? 0 : 1);
