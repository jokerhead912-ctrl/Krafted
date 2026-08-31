// v7.0.48 regression suite — the tape waits for you
//
//   "I collect a lot of reference images and clips and organise them into a
//    rough script, then I need it to be easy when a vendor sends a work-in-
//    progress to check, and I present to people. I want to optimise the
//    experience — how do I do this more smoothly, more conveniently?"
//
//   Q: how do you actually present?
//   A: "I talk and press next myself."
//
// That answer is the whole bug. Present advanced on a fixed clock — 620ms of
// camera flight plus a 4000ms dwell, scheduled at the moment a shot was shown
// with no way to cancel it. Presenting means talking about a shot for as long
// as it takes, and the built-in behaviour was: 4.6 seconds, then gone.
//
// The detail that made it worse: pressing "next" by hand went through the
// same code path and simply RESTARTED the clock. So the tape ignored you and
// then, when you took control, it took the shot away anyway.
//
// This suite is built around a fake clock, because the defect is a scheduled
// timeout and reading the source for one is not a test — the assertion that
// matters is "no timer exists", which only a clock can answer.
//
// Everything behavioural below is the REAL source, sliced out and executed.

const fs = require('fs');
const path = require('path');

// KRAFTED_HTML / KRAFTED_SW let the mutation check point this suite at a
// deliberately broken COPY, so the real dev file is never touched.
const HTML = process.env.KRAFTED_HTML
  ? path.resolve(process.env.KRAFTED_HTML)
  : path.resolve(__dirname, '../../kraftpub-v6.8.0.html');
const SWJS = process.env.KRAFTED_SW
  ? path.resolve(process.env.KRAFTED_SW)
  : path.resolve(__dirname, '../docs/sw.js');
const src = fs.readFileSync(HTML, 'utf8');
const sw = fs.readFileSync(SWJS, 'utf8');

const EXPECT_VERSION = '7.0.50';

// The spec. These are what the behaviour is asserted against; the app's own
// constants are pinned to them separately, so a change to the app shows up as
// a failed pin rather than as behaviour that quietly moved.
const SPEC_FLIGHT_MS = 620;
const SPEC_DWELL_MS = 4000;
const SPEC_AUTO_DEFAULT = false;
const SPEC_CYCLE_MS = SPEC_FLIGHT_MS + SPEC_DWELL_MS;

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
function fnTop(header, s) {
  const a = s.indexOf(header);
  if (a < 0) { console.log('  FAIL: no header ' + header); fail++; return ''; }
  const b = s.indexOf('\n}\n', a);
  if (b < 0) { console.log('  FAIL: no closing brace for ' + header); fail++; return ''; }
  return s.slice(a, b + 2);
}
// The cap matters. This file contains a string literal '/*' whose matching
// '*/' sits 270 KB further on, so an unbounded strip deletes 42% of the
// source and every assertion then runs against a file that has silently lost
// the code it is meant to be checking.
function codeOnly(s) {
  return s.replace(/\/\*[\s\S]{0,4000}?\*\//g, '')
          .split('\n').filter(function (l) { return l.trim().indexOf('//') !== 0; }).join('\n');
}

console.log('Krafted v' + EXPECT_VERSION + ' — the tape waits for you');
console.log('');

// ═══════════════════════════════════════════════════════════════════════
//  1. THE CONSTANTS
// ═══════════════════════════════════════════════════════════════════════
// The dwell used to be described as "how long a shot holds" — unconditional,
// because there was no other mode. Rewording it is not cosmetic: the comment
// is where the next person learns whether auto-play is the default.

const APP_FLIGHT = (function () {
  const m = /var VIEW_FLIGHT_MS\s*=\s*(\d+)\s*;/.exec(src); return m ? +m[1] : NaN;
})();
const APP_DWELL = (function () {
  const m = /var PRESENT_DWELL_MS\s*=\s*(\d+)\s*;/.exec(src); return m ? +m[1] : NaN;
})();
const APP_AUTO_DEFAULT = (function () {
  const m = /var PRESENT_AUTO_DEFAULT\s*=\s*(true|false)\s*;/.exec(src);
  return m ? (m[1] === 'true') : null;
})();

eq(APP_FLIGHT, SPEC_FLIGHT_MS, 'the app flight time is still the spec flight time');
eq(APP_DWELL, SPEC_DWELL_MS, 'the app dwell is still the spec dwell');
eq(APP_AUTO_DEFAULT, SPEC_AUTO_DEFAULT, 'auto-play defaults to OFF');
eq(SPEC_CYCLE_MS, 4620, 'one cycle is flight + dwell, 4620ms');

// The comment assertions run against the RAW slice. codeOnly() drops
// whole-line // comments, so asserting on a comment through it passes no
// matter what the comment says — the assertion would be decoration.
const constRaw = src.slice(src.indexOf('var PRESENT_DWELL_MS'),
                           src.indexOf('function _viewsList()'));
const constBlock = codeOnly(constRaw);
has(constBlock, 'var PRESENT_AUTO_DEFAULT = false;', 'the default is stated as a constant');
has(constRaw, 'auto-play', 'the dwell comment now says the dwell is auto-play only');
hasnt(constRaw, 'how long a shot holds before advancing',
      'the dwell is no longer described as unconditional');

console.log('  constants: flight=' + APP_FLIGHT + 'ms dwell=' + APP_DWELL +
            'ms auto-default=' + APP_AUTO_DEFAULT);

// ═══════════════════════════════════════════════════════════════════════
//  2. THE HUD EXISTS AND IS WIRED
// ═══════════════════════════════════════════════════════════════════════
// Presenting from a board 100000px across, the two things you cannot see are
// "where am I in the running order" and "what comes next", so a pitch was
// paced from memory.

const hudIds = ['present-hud', 'present-prev', 'present-play', 'present-next',
                'present-count', 'present-name', 'present-hint'];
hudIds.forEach(function (id) {
  eq(occs(src, 'id="' + id + '"'), 1, 'the HUD node #' + id + ' exists exactly once');
});
has(src, 'onclick="presentAdvance(-1)"', 'the previous button calls presentAdvance(-1)');
has(src, 'onclick="presentAdvance(1)"', 'the next button calls presentAdvance(1)');
has(src, 'onclick="presentToggleAuto()"', 'the play button calls presentToggleAuto()');
has(src, '#present-hud { position:fixed;', 'the HUD is positioned, not in flow');
has(src, '#present-hud.show {', 'the HUD only shows while the tape runs');
has(src, 'font-variant-numeric:tabular-nums', 'the shot counter does not jitter as it changes');

// The HUD is created once in the markup and updated by textContent. innerHTML
// would make a shot name into markup, and shot names are user text.
const hudFn = fnFull('renderPresentHud', src);
const hudCode = codeOnly(hudFn);
has(hudCode, 'textContent', 'the HUD is updated by textContent');
hasnt(hudCode, 'innerHTML', 'the HUD never assigns innerHTML');
has(hudCode, "document.getElementById('present-hud')", 'the HUD renderer finds the HUD');
has(hudCode, "hud.classList.remove('show')", 'the HUD hides when the tape stops');

// ═══════════════════════════════════════════════════════════════════════
//  3. THE HARNESS — a fake clock, a fake DOM, the real Present code
// ═══════════════════════════════════════════════════════════════════════

let TIMERS = [], TID = 1;
function setTimeoutStub(fn, ms) { const id = TID++; TIMERS.push({ id: id, fn: fn, ms: ms }); return id; }
function clearTimeoutStub(id) { TIMERS = TIMERS.filter(function (t) { return t.id !== id; }); }
function fireAll() { const t = TIMERS; TIMERS = []; t.forEach(function (x) { x.fn(); }); }
function fireMs(ms) {
  const hit = TIMERS.filter(function (t) { return t.ms === ms; });
  TIMERS = TIMERS.filter(function (t) { return t.ms !== ms; });
  hit.forEach(function (x) { x.fn(); });
}
// startPresent defers its "the user grabbed the board" handler on a 0ms
// timer, so TIMERS is never empty during a tape. Counting everything would
// make every "no timer" assertion wrong by exactly one, so count only the
// timers that are a full flight+dwell cycle — which also pins the delay.
function advanceCount() {
  return TIMERS.filter(function (t) { return t.ms === SPEC_CYCLE_MS; }).length;
}

let NODES = {}, LISTENERS = {};
function mkNode(id, tagName) {
  const n = { id: id, tagName: tagName || 'DIV', textContent: '', title: '',
              style: {}, kids: [], classes: {}, contentEditable: 'false' };
  n.classList = {
    add: function (c) { n.classes[c] = 1; },
    remove: function (c) { delete n.classes[c]; },
    contains: function (c) { return !!n.classes[c]; },
    toggle: function (c) { if (n.classes[c]) delete n.classes[c]; else n.classes[c] = 1; }
  };
  n.contains = function (t) {
    if (t === n) return true;
    for (let i = 0; i < n.kids.length; i++) if (n.kids[i].contains(t)) return true;
    return false;
  };
  n.appendChild = function (c) { n.kids.push(c); return c; };
  n.setAttribute = function () {};
  return n;
}
function reg(id, kids, tagName) {
  NODES[id] = mkNode(id, tagName);
  if (kids) NODES[id].kids = kids;
  return NODES[id];
}

const VC = (function () {
  const m = /var VIEW_COLORS = (\[[^\]]*\]);/.exec(src);
  return m ? m[1] : '[]';
})();

const presentBlock =
  'var VIEW_FLIGHT_MS = ' + SPEC_FLIGHT_MS + ';\n' +
  'var PRESENT_DWELL_MS = ' + SPEC_DWELL_MS + ';\n' +
  'var PRESENT_AUTO_DEFAULT = ' + SPEC_AUTO_DEFAULT + ';\n' +
  'var VIEW_COLORS = ' + VC + ';\n' +
  fnTop('function viewColor(v) {', src) + '\n' +
  fnFull('_viewsList', src) + '\n' +
  fnFull('startPresent', src) + '\n' +
  fnFull('stopPresent', src) + '\n' +
  fnFull('presentScheduleNext', src) + '\n' +
  fnFull('presentAdvance', src) + '\n' +
  fnFull('presentToggleAuto', src) + '\n' +
  fnFull('presentGoTo', src) + '\n' +
  fnFull('renderPresentHud', src) + '\n';

let P = null;
try {
  P = new Function(
    'document', 'console', 'toast', 'gotoView', 'renderViewsPanel',
    'setTimeout', 'clearTimeout', 'state',
    presentBlock +
    '\nreturn { _viewsList: _viewsList, startPresent: startPresent, stopPresent: stopPresent,' +
    ' presentScheduleNext: presentScheduleNext, presentAdvance: presentAdvance,' +
    ' presentToggleAuto: presentToggleAuto, presentGoTo: presentGoTo,' +
    ' renderPresentHud: renderPresentHud, viewColor: viewColor };'
  );
} catch (e) {
  console.log('  FAIL: could not compile the Present block — ' + e.message); fail++;
}

function build(views) {
  TIMERS = []; TID = 1;
  LISTENERS = {}; NODES = {};
  const kids = ['present-prev', 'present-play', 'present-next',
                'present-count', 'present-name', 'present-hint'].map(function (id) {
    return reg(id);
  });
  reg('present-hud', kids);
  reg('views-panel', []);
  const doc = {
    activeElement: null,
    getElementById: function (id) { return NODES[id] || null; },
    addEventListener: function (t, fn) { (LISTENERS[t] = LISTENERS[t] || []).push(fn); },
    removeEventListener: function (t, fn) {
      const a = LISTENERS[t] || [];
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    }
  };
  const calls = { goto: [], toast: [], renders: 0 };
  const st = { views: views || [], _present: null, _activeViewIndex: -1 };
  const api = P(doc, console,
    function (m) { calls.toast.push(String(m)); },
    function (i) { calls.goto.push(i); },
    function () { calls.renders++; },
    setTimeoutStub, clearTimeoutStub, st);
  return {
    st: st, doc: doc, calls: calls, api: api,
    n: function (id) { return NODES[id]; },
    keyHandler: function () { return (LISTENERS.keydown || [])[0] || null; },
    takeoverHandler: function () { return (LISTENERS.pointerdown || [])[0] || null; },
    press: function (k, mods) {
      const h = (LISTENERS.keydown || [])[0];
      const ev = {
        key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
        defaultPrevented: false, stopped: false,
        preventDefault: function () { ev.defaultPrevented = true; },
        stopPropagation: function () { ev.stopped = true; }
      };
      if (mods) Object.keys(mods).forEach(function (m) { ev[m] = mods[m]; });
      if (h) h(ev);
      return ev;
    }
  };
}

function views(n, named) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = { id: i + 1, ids: [100 + i], panX: 0, panY: 0, zoom: 1, color: '' };
    if (named) v.name = 'Shot ' + (i + 1);
    out.push(v);
  }
  return out;
}

console.log('  harness compiled: ' + (P ? 'ok' : 'FAILED'));
console.log('');

// ═══════════════════════════════════════════════════════════════════════
//  4. MANUAL IS THE DEFAULT — the whole complaint
// ═══════════════════════════════════════════════════════════════════════
{
  const b = build(views(4, true));
  b.api.startPresent();
  ok(!!b.st._present, 'startPresent starts a tape');
  eq(b.st._present.auto, false, 'the tape starts in manual mode');
  eq(advanceCount(), 0, 'NO ADVANCE IS SCHEDULED — the tape does not advance on its own');
  eq(TIMERS.length, 1, 'the only timer is the deferred takeover handler');
  eq(TIMERS[0].ms, 0, 'and that one is the 0ms deferral, not a shot timer');
  eq(b.st._present.index, 0, 'it opens on the first shot');
  eq(b.calls.goto.length, 1, 'it flew to the first shot');
  eq(b.calls.goto[0], 0, 'it flew to shot 0');

  // Advance by hand, the way the user described presenting.
  b.api.presentAdvance(1);
  eq(b.st._present.index, 1, 'pressing next moves to shot 2');
  eq(advanceCount(), 0, 'ADVANCING BY HAND SCHEDULES NO TIMER — the old build restarted the clock here');

  // And it stays put. This is the assertion the whole feature exists for.
  fireAll();
  eq(b.st._present.index, 1, 'firing every pending timer leaves the shot exactly where it was');
  ok(!!b.st._present, 'the tape did not end on its own');
}

// The old behaviour, pinned so it cannot come back.
{
  const advCode = codeOnly(fnFull('presentAdvance', src));
  hasnt(advCode,
    'p.timer = setTimeout(function () { presentAdvance(1); }, VIEW_FLIGHT_MS + PRESENT_DWELL_MS);',
    'presentAdvance no longer schedules the next shot unconditionally');
  has(advCode, 'if (p.auto) presentScheduleNext();',
      'presentAdvance schedules the next shot only when auto-play is on');
  const schedCode = codeOnly(fnFull('presentScheduleNext', src));
  has(schedCode, 'if (!p || !p.auto) return;', 'presentScheduleNext refuses when auto-play is off');
}

// ═══════════════════════════════════════════════════════════════════════
//  5. AUTO-PLAY IS OPT-IN, AND REVERSIBLE WITHOUT LOSING YOUR PLACE
// ═══════════════════════════════════════════════════════════════════════
{
  const b = build(views(4, true));
  b.api.startPresent();
  b.api.presentAdvance(1);              // sitting on shot 2
  const before = b.st._present.index;

  b.api.presentToggleAuto();
  eq(b.st._present.auto, true, 'A turns auto-play on');
  eq(advanceCount(), 1, 'auto-play schedules exactly one advance');
  ok(TIMERS.some(function (t) { return t.ms === SPEC_CYCLE_MS; }),
     'the scheduled delay is a whole flight + dwell (' + SPEC_CYCLE_MS + 'ms)');
  eq(b.st._present.index, before, 'turning auto-play on does not move the tape');

  fireAll();
  eq(b.st._present.index, 2, 'the tape advanced on the clock');
  eq(advanceCount(), 1, 'auto-play keeps going');

  // Taking back control mid-reel must not cost the current shot.
  b.api.presentToggleAuto();
  eq(b.st._present.auto, false, 'A turns auto-play off');
  eq(advanceCount(), 0, 'the pending advance is cancelled');
  eq(b.st._present.index, 2, 'taking back control leaves the tape on the shot it was on');
  fireAll();
  eq(b.st._present.index, 2, 'and it stays there');

  has(b.calls.toast.join(' | '), 'Auto-play off', 'switching auto-play off says so');
}

{
  const b = build(views(3, true));
  b.api.startPresent();
  b.api.presentToggleAuto(true);
  eq(b.st._present.auto, true, 'presentToggleAuto(true) forces auto on');
  b.api.presentToggleAuto(true);
  eq(b.st._present.auto, true, 'forcing it on twice is idempotent');
  b.api.presentToggleAuto(false);
  eq(b.st._present.auto, false, 'presentToggleAuto(false) forces auto off');
  eq(advanceCount(), 0, 'forcing it off clears the clock');
}

// ═══════════════════════════════════════════════════════════════════════
//  6. THE END OF THE TAPE
// ═══════════════════════════════════════════════════════════════════════
// Manual holds on the last shot. Ending a pitch because someone pressed next
// once too often throws away the control the manual tape exists to give.
{
  const b = build(views(3, true));
  b.api.startPresent();
  b.api.presentGoTo(2);
  b.api.presentAdvance(1);
  eq(b.st._present.index, 2, 'a manual tape holds on the last shot');
  ok(!!b.st._present, 'a manual tape does not end at the last shot');
  eq(advanceCount(), 0, 'and it schedules nothing');
  has(b.n('present-hint').textContent, 'Last shot', 'the HUD says it is the last shot');
}

// Auto-play still ends, because a reel with nobody at the keyboard has to
// stop somewhere.
{
  const b = build(views(2, true));
  b.api.startPresent();
  b.api.presentGoTo(1);
  b.api.presentToggleAuto(true);
  fireAll();
  eq(b.st._present, null, 'an auto tape ends after the last shot');
  has(b.calls.toast.join(' | '), 'End of presentation', 'ending the tape says so');
}

// Stepping backwards off the first shot clamps either way.
{
  const b = build(views(3, true));
  b.api.startPresent();
  b.api.presentAdvance(-1);
  eq(b.st._present.index, 0, 'going back from the first shot clamps to the first');
  ok(!!b.st._present, 'and does not end the tape');
}

// ═══════════════════════════════════════════════════════════════════════
//  7. JUMPING
// ═══════════════════════════════════════════════════════════════════════
{
  const b = build(views(5, true));
  b.api.startPresent();
  b.api.presentGoTo(3);
  eq(b.st._present.index, 3, 'presentGoTo jumps to a shot');
  eq(b.calls.goto[b.calls.goto.length - 1], 3, 'and flies there');
  b.api.presentGoTo(99);
  eq(b.st._present.index, 4, 'presentGoTo clamps past the end');
  b.api.presentGoTo(-7);
  eq(b.st._present.index, 0, 'presentGoTo clamps before the start');

  b.api.presentToggleAuto(true);
  b.api.presentGoTo(2);
  eq(advanceCount(), 1, 'jumping while auto is on restarts the clock');
  TIMERS = [];
  b.api.presentToggleAuto(false);
  b.api.presentGoTo(1);
  eq(advanceCount(), 0, 'jumping while auto is off schedules nothing');
}

// ═══════════════════════════════════════════════════════════════════════
//  8. THE KEYS
// ═══════════════════════════════════════════════════════════════════════
{
  const b = build(views(5, true));
  b.api.startPresent();
  ok(!!b.keyHandler(), 'startPresent registers a key handler');

  // Forward, including what a physical presenter remote actually sends.
  [' ', 'ArrowRight', 'ArrowDown', 'PageDown', 'Enter', 'n', 'N'].forEach(function (k) {
    const before = b.st._present.index;
    const ev = b.press(k);
    eq(b.st._present.index, Math.min(4, before + 1),
       JSON.stringify(k) + ' advances the tape');
    ok(ev.defaultPrevented, JSON.stringify(k) + ' is consumed, so the board never sees it');
    ok(ev.stopped, JSON.stringify(k) + ' does not reach any board hotkey');
    b.api.presentGoTo(0);
  });

  // Backward. The first press from shot 1 clamps, so start from the middle.
  // "it moved" is not enough on its own — every one of these keys also has to
  // be CONSUMED, or it reaches the board underneath and does two things at
  // once. The mutation check caught this block asserting only the index.
  ['ArrowLeft', 'ArrowUp', 'PageUp', 'p', 'P'].forEach(function (k) {
    b.api.presentGoTo(3);
    const ev = b.press(k);
    eq(b.st._present.index, 2, JSON.stringify(k) + ' steps back');
    ok(ev.defaultPrevented, JSON.stringify(k) + ' is consumed, so the board never sees it');
    ok(ev.stopped, JSON.stringify(k) + ' does not reach any board hotkey');
  });

  // Auto-play toggle.
  b.api.presentGoTo(0);
  const evA = b.press('a');
  eq(b.st._present.auto, true, 'A turns auto-play on');
  ok(evA.defaultPrevented && evA.stopped, 'A is consumed');
  b.press('A');
  eq(b.st._present.auto, false, 'shift+A also toggles it back off');

  // Jumps.
  const ev3 = b.press('3');
  eq(b.st._present.index, 2, '3 jumps to the third shot');
  ok(ev3.defaultPrevented && ev3.stopped, 'a number key is consumed');
  b.press('5');
  eq(b.st._present.index, 4, '5 jumps to the fifth shot');
  b.press('0');
  eq(b.st._present.index, 4, '0 means the tenth shot, clamped to the last one here');
  const evH = b.press('Home');
  eq(b.st._present.index, 0, 'Home goes to the first shot');
  ok(evH.defaultPrevented && evH.stopped, 'Home is consumed');
  const evE = b.press('End');
  eq(b.st._present.index, 4, 'End goes to the last shot');
  ok(evE.defaultPrevented && evE.stopped, 'End is consumed');

  // Escape ends it.
  const ev = b.press('Escape');
  eq(b.st._present, null, 'Escape stops the tape');
  ok(ev.defaultPrevented && ev.stopped, 'Escape is consumed');
}

// An unbound key must pass straight through — a tape that swallows every
// keypress would break the board underneath it.
{
  const b = build(views(3, true));
  b.api.startPresent();
  b.api.presentGoTo(1);
  const ev = b.press('q');
  eq(b.st._present.index, 1, 'an unbound key does not move the tape');
  ok(!ev.defaultPrevented, 'an unbound key is left alone');
  ok(!ev.stopped, 'an unbound key still reaches the board');
}

// The browser's own shortcuts must survive. Cmd+1 switches tab and Cmd+A
// selects all; a pitch tool that eats those is worse than one that misses a
// keypress. Alt is excluded too, because on macOS the Option layer turns
// "1" into "¡" — ev.key is not even the character shown on the keycap.
{
  const b = build(views(5, true));
  b.api.startPresent();
  b.api.presentGoTo(1);
  [['1', { metaKey: true }], ['1', { ctrlKey: true }], ['1', { altKey: true }],
   ['a', { metaKey: true }], ['a', { ctrlKey: true }],
   [' ', { metaKey: true }], ['ArrowRight', { ctrlKey: true }],
   ['Escape', { metaKey: true }]].forEach(function (pair) {
    const ev = b.press(pair[0], pair[1]);
    eq(b.st._present.index, 1, 'Cmd/Ctrl/Alt+' + JSON.stringify(pair[0]) + ' does not move the tape');
    ok(!ev.defaultPrevented, 'Cmd/Ctrl/Alt+' + JSON.stringify(pair[0]) + ' is left for the browser');
  });
  ok(!!b.st._present, 'the tape survived every browser shortcut');
}

// A text field with the caret owns every key. The rename editor can still be
// open when a tape starts, and without this the tape eats the typing — Space
// advanced the shot instead of typing a space.
{
  const b = build(views(5, true));
  b.api.startPresent();
  b.api.presentGoTo(1);
  const field = reg('some-field', [], 'INPUT');
  b.doc.activeElement = field;
  [' ', '3', 'n', 'a', 'ArrowRight', 'Home', 'End', 'Escape'].forEach(function (k) {
    b.press(k);
    eq(b.st._present.index, 1, 'a focused input keeps ' + JSON.stringify(k) + ' for itself');
  });
  ok(!!b.st._present, 'the tape survived typing');

  const ta = reg('some-area', [], 'TEXTAREA');
  b.doc.activeElement = ta;
  b.press(' ');
  eq(b.st._present.index, 1, 'a focused textarea keeps Space too');

  const ce = reg('some-ce', [], 'DIV');
  ce.contentEditable = 'true';
  b.doc.activeElement = ce;
  b.press(' ');
  eq(b.st._present.index, 1, 'a focused contenteditable keeps Space too');

  b.doc.activeElement = null;
  b.press(' ');
  eq(b.st._present.index, 2, 'with nothing focused the tape advances again');
}

// ═══════════════════════════════════════════════════════════════════════
//  9. THE HUD TELLS YOU WHERE YOU ARE
// ═══════════════════════════════════════════════════════════════════════
{
  const b = build(views(4, true));
  b.api.startPresent();
  ok(b.n('present-hud').classList.contains('show'), 'the HUD shows when the tape starts');
  eq(b.n('present-count').textContent, '1 / 4', 'the counter shows position in the running order');
  eq(b.n('present-name').textContent, 'Shot 1', 'the HUD names the shot');
  has(b.n('present-hint').textContent, 'Next: Shot 2', 'the HUD names the shot that is coming');
  has(b.n('present-hint').textContent, 'Space', 'the HUD says how to advance');
  eq(b.n('present-play').textContent, '▶', 'the play button offers to auto-play');

  b.api.presentAdvance(1);
  eq(b.n('present-count').textContent, '2 / 4', 'the counter tracks the tape');
  eq(b.n('present-name').textContent, 'Shot 2', 'the name tracks the tape');
  has(b.n('present-hint').textContent, 'Next: Shot 3', 'the next-shot preview tracks the tape');

  b.api.presentToggleAuto(true);
  eq(b.n('present-play').textContent, '❚❚', 'the play button becomes a pause button');
  has(b.n('present-hint').textContent, 'Auto', 'the hint says auto-play is running');
  has(b.n('present-hint').textContent, '4s', 'the hint says how long each shot holds');
  has(b.n('present-hint').textContent, 'A to stop', 'the hint says how to take back control');

  b.api.stopPresent();
  ok(!b.n('present-hud').classList.contains('show'), 'the HUD hides when the tape stops');
  eq(b.st._present, null, 'stopPresent ends the tape');
}

// An unnamed shot still needs a label. A blank gap where the audience
// expects the name of what they are looking at is worse than "Shot 3".
{
  const b = build(views(3, false));
  b.api.startPresent();
  b.api.presentGoTo(2);
  eq(b.n('present-name').textContent, 'Shot 3', 'an unnamed shot is labelled by position');
}

// The shot colour carries into the HUD, so a colour-coded running order reads
// the same in the HUD as it does on the rail.
{
  const vs = views(2, true);
  vs[0].color = '#ff6b6b';
  const b = build(vs);
  b.api.startPresent();
  eq(b.n('present-name').style.color, '#ff6b6b', 'the HUD name takes the shot colour');
  b.api.presentGoTo(1);
  eq(b.n('present-name').style.color, '', 'a shot with no colour gets no colour');
}

// A shot name is user text and must never become markup. The HUD writes it
// with textContent, so a name containing a tag stays a name.
{
  const vs = views(2, false);
  vs[0].name = '<img src=x onerror=alert(1)>';
  const b = build(vs);
  b.api.startPresent();
  eq(b.n('present-name').textContent, '<img src=x onerror=alert(1)>',
     'a shot name is stored as text, not parsed');
  ok(typeof b.n('present-name').innerHTML === 'undefined',
     'the HUD never builds markup from a name');
}

// ═══════════════════════════════════════════════════════════════════════
// 10. THE HUD'S OWN BUTTONS MUST NOT END THE TAPE
// ═══════════════════════════════════════════════════════════════════════
// startPresent registers the takeover handler on a 0ms timer, so the click
// that started the tape cannot immediately end it.
{
  const b = build(views(4, true));
  b.api.startPresent();
  eq(TIMERS.length, 1, 'the takeover handler is deferred to the next tick');
  eq(TIMERS[0].ms, 0, 'and deferred by 0ms');
  fireMs(0);
  const take = b.takeoverHandler();
  ok(!!take, 'the takeover handler is registered');

  take({ target: b.n('present-next') });
  ok(!!b.st._present, 'clicking the HUD next button does NOT end the tape');
  take({ target: b.n('present-prev') });
  ok(!!b.st._present, 'clicking the HUD previous button does not end the tape');
  take({ target: b.n('present-play') });
  ok(!!b.st._present, 'clicking the HUD play button does not end the tape');
  take({ target: b.n('present-hud') });
  ok(!!b.st._present, 'clicking the HUD background does not end the tape');
  take({ target: b.n('views-panel') });
  ok(!!b.st._present, 'clicking the views rail does not end the tape');

  // Grabbing the board still means "I am taking over".
  take({ target: b.n('somewhere-else') || mkNode('board') });
  eq(b.st._present, null, 'clicking the board still ends the tape');
}

// ═══════════════════════════════════════════════════════════════════════
// 11. DISCOVERABILITY
// ═══════════════════════════════════════════════════════════════════════
// The previous build taught everyone that the tape advances by itself. A tape
// that now holds forever with no visible instruction reads as a hung app.

{
  const b = build(views(3, true));
  b.api.startPresent();
  const t = b.calls.toast.join(' | ');
  has(t, '3 shots', 'starting the tape says how many shots there are');
  has(t, 'Space', 'starting the tape says how to advance');
  has(t, 'Esc', 'starting the tape says how to stop');
}
{
  const b = build(views(1, true));
  b.api.startPresent();
  has(b.calls.toast.join(' | '), '1 shot —', 'one shot is not pluralised');
}
{
  const b = build(views(0, true));
  b.api.startPresent();
  eq(b.st._present, null, 'a tape with no shots does not start');
  has(b.calls.toast.join(' | '), 'Save a view first', 'and says why');
}

// Every surface the hands actually go to. These are pinned on the FULL row
// text, not on a fragment: "Page Down" also appears in the HUD button's
// tooltip, so asserting on the bare words would stay green while somebody
// deleted the help row that teaches the only key a clicker actually sends.
has(src, 'Space or → for the next one', 'starting the tape says how to advance');
has(src, 'Present the views — you advance it', 'the Present button says the tape waits for you');
has(src, '<b>Space</b> / → / Page Down', 'the help panel documents the presenter-clicker key');
has(src, 'a presenter clicker works', 'the help panel says a clicker works');
has(src, '<b>Home</b> / <b>End</b>', 'the help panel documents Home and End');
has(src, 'Auto-play on a 4s clock', 'the help panel documents A');
has(src, 'title="Next shot (Space / → / Page Down)"', 'the HUD next button names its keys');
has(src, 'title="Previous shot (← / Page Up)"', 'the HUD previous button names its keys');

// ═══════════════════════════════════════════════════════════════════════
// 12. VERSION
// ═══════════════════════════════════════════════════════════════════════
{
  const m = /var KRAFTED_VERSION = '([^']+)'/.exec(src);
  eq(m && m[1], EXPECT_VERSION, 'KRAFTED_VERSION is ' + EXPECT_VERSION);
  has(src, '<title>Krafted v' + EXPECT_VERSION + '</title>', 'the title carries the version');
  eq(occs(sw, EXPECT_VERSION), 3,
     'sw.js carries the version in 3 places (header, cache name, APP_VERSION)');
  has(sw, "CACHE_NAME = 'krafted-v" + EXPECT_VERSION + "-'", 'the cache name is bumped');
  // Derived, not hard-coded. A literal here passes forever once the release
  // moves past it - it reads as "we checked" in the log while checking
  // nothing, which is worse than having no assertion at all. This one was
  // pinned to 7.0.46 for four releases before anyone noticed.
  const prevVersion = EXPECT_VERSION.replace(/\d+$/, d => String(Math.max(0, Number(d) - 1)));
  hasnt(sw, prevVersion, 'the previous version (' + prevVersion + ') is gone from sw.js');
}

console.log('');
console.log((fail === 0 ? 'ALL PASS' : 'FAILURES') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
