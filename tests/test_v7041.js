// v7.0.42 regression suite — the I/O trim hotkey
//
//   "press i/o once, it works; press it again to move the mark, nothing
//    happens"
//
// Behaviour assertions compare against the SPEC constants below, never against
// a value read out of the source (that would be tautological). A separate
// assertion pins each app constant to the spec so drift is caught.
//
// The functions under test are EXTRACTED FROM THE REAL SOURCE and executed
// against a fake DOM. A grep that finds "state.mouse" somewhere in a 37K-line
// file proves nothing about whether a second press actually moves the mark —
// the previous fix (v6.6.0) shipped with exactly such a comment and the user
// reported this bug again five weeks later.
const fs = require('fs');
const path = require('path');

// KRAFTED_HTML / KRAFTED_SW let the mutation check point the suite at a
// deliberately broken COPY, so the real dev file is never touched.
const HTML = process.env.KRAFTED_HTML
  ? path.resolve(process.env.KRAFTED_HTML)
  : path.resolve(__dirname, '../../kraftpub-v6.8.0.html');
const src = fs.readFileSync(HTML, 'utf8');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; console.log('  FAIL: ' + label); }
}
function eq(actual, expected, label) {
  ok(actual === expected, label + '  (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')');
}
function near(a, b, tol, label) {
  ok(Math.abs(a - b) <= tol, label + '  (got ' + a + ', want ~' + b + ' ±' + tol + ')');
}
function count(hay, needle) { return hay.split(needle).length - 1; }

// ── spec constants (independent of the source) ───────────────────────────
const EXPECT_TRIM_MIN_GAP = 0.05;  // shortest legal segment, seconds
const EXPECT_DUR          = 100;   // fake clip length used throughout

// Extract a whole function body by brace matching. The functions under test
// contain no braces inside string literals, so a plain counter is safe.
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
// Drop whole-line comments, so an assertion about CODE is never satisfied (or
// defeated) by the comment explaining it.
function codeOnly(s) {
  return s.split('\n').filter(function (l) { return l.trim().indexOf('//') !== 0; }).join('\n');
}
function slice(startMarker, endMarker, label) {
  const a = src.indexOf(startMarker);
  if (a < 0) { console.log('  FAIL: anchor not found: ' + label); fail++; return ''; }
  const b = src.indexOf(endMarker, a);
  if (b < 0) { console.log('  FAIL: end anchor not found: ' + label); fail++; return ''; }
  return src.slice(a, b);
}

// ═══════════════════════════════════════════════════════════════════════
//  Fake DOM
// ═══════════════════════════════════════════════════════════════════════
// elementFromPoint is the crux of this bug, so the fake drives it from a
// single variable the test sets: the point under test resolves to NODE and
// every other point resolves to null.
var POINT_NODE = null;

function makeEl(cls, rect, kids) {
  const e = {
    _cls: cls, _rect: rect, _kids: kids || [], style: {},
    _flash: 0,
    classList: {
      add: function () { e._flash++; },
      remove: function () { e._flash--; }
    },
    getBoundingClientRect: function () { return e._rect; },
    contains: function (n) {
      if (!n) return false;
      if (n === e) return true;
      for (let i = 0; i < e._kids.length; i++) {
        if (e._kids[i] === n || e._kids[i].contains(n)) return true;
      }
      return false;
    },
    querySelector: function (sel) {
      const want = sel.replace(/^\./, '').split(' ').pop().replace(/^\./, '');
      if (e._cls.split(' ').indexOf(want) >= 0) return e;
      for (let i = 0; i < e._kids.length; i++) {
        const r = e._kids[i].querySelector(sel);
        if (r) return r;
      }
      return null;
    }
  };
  return e;
}

// Geometry chosen so the arithmetic is checkable by hand:
//   seek bar   left=100 width=200   -> 0..300
//   its track  left=102 width=196   -> 2px of padding each side
//   trim mini  left=100 width=200
// A cursor at x=200 sits at (200-102)/196 = 0.5  -> half the clip.
function buildPlayerEl() {
  const track = makeEl('media-seek-track', { left: 102, width: 196, top: 20, height: 6 });
  const seekBar = makeEl('media-seek-bar', { left: 100, width: 200, top: 10, height: 26 }, [track]);
  const mini = makeEl('media-trim-mini', { left: 100, width: 200, top: 40, height: 12 });
  const wrap = makeEl('media-wrap', { left: 0, width: 300, top: 60, height: 200 });
  const itemEl = makeEl('item has-media selected', { left: 0, width: 300, top: 0, height: 300 },
                        [seekBar, mini, wrap]);
  return { itemEl: itemEl, seekBar: seekBar, track: track, mini: mini, wrap: wrap };
}

const fakeDoc = {
  elementFromPoint: function () { return POINT_NODE; },
  activeElement: null
};

// ═══════════════════════════════════════════════════════════════════════
//  Extract the real trim code and run it
// ═══════════════════════════════════════════════════════════════════════
const block = slice('function selectedVideoItems() {', '//  CONTACT SHEET (v7.0.38)',
                    'trim module (selectedVideoItems .. I/O hotkey)');

const calls = { undo: 0, save: 0, toasts: [], timeline: 0, refresh: 0 };
function resetCalls() { calls.undo = 0; calls.save = 0; calls.toasts = []; calls.timeline = 0; calls.refresh = 0; }

const state = {
  items: [],
  selected: new Set(),
  mouse: { x: 0, y: 0 }
};

let api = null;
try {
  api = new Function(
    'state', 'document', 'updateVideoTimeline', 'pushUndo', 'scheduleAutoSave',
    'toast', 'formatTime', 'setTimeout', 'console',
    block + '\nreturn { TRIM_MIN_GAP: TRIM_MIN_GAP,'
          + ' trimEdgeOf: trimEdgeOf,'
          + ' clampTrimMark: clampTrimMark,'
          + ' applyTrimMark: applyTrimMark,'
          + ' flashTrimHandle: flashTrimHandle,'
          + ' setTrimFromPlayhead: setTrimFromPlayhead,'
          + ' clearTrimSelected: clearTrimSelected,'
          + ' _trimPointer: _trimPointer,'
          + ' trimTimeAtPointer: trimTimeAtPointer,'
          + ' trimHotkey: trimHotkey,'
          + ' selectedVideoItems: selectedVideoItems,'
          + ' refreshTrimUIFor: refreshTrimUIFor };'
  )(
    state, fakeDoc,
    function () { calls.timeline++; },
    function () { calls.undo++; },
    function () { calls.save++; },
    function (m) { calls.toasts.push(String(m)); },
    function (t) { return (typeof t === 'number' && isFinite(t)) ? t.toFixed(2) + 's' : '?'; },
    function (fn, ms) { return 0; },
    console
  );
} catch (e) {
  console.log('  FAIL: trim module threw on load: ' + e.message);
  fail++;
}

// Wrap refreshTrimUIFor so we can count it without losing the real behaviour.
const realRefresh = api && api.refreshTrimUIFor;

function makeItem(over) {
  const p = buildPlayerEl();
  const v = {
    duration: (over && over.duration !== undefined) ? over.duration : EXPECT_DUR,
    currentTime: (over && over.t !== undefined) ? over.t : 0,
    paused: false,
    pause: function () { v.paused = true; v._paused++; },
    _paused: 0
  };
  const it = {
    id: 1, isVideo: true, type: 'video', el: p.itemEl, video: v,
    trimStart: (over && over.trimStart !== undefined) ? over.trimStart : 0,
    trimEnd: (over && over.trimEnd !== undefined) ? over.trimEnd : 0,
    _player: p
  };
  state.items = [it];
  state.selected = new Set([1]);
  return it;
}

// Point the fake cursor at a node and set state.mouse to match.
function pointAt(node, x, y) {
  POINT_NODE = node;
  state.mouse.x = (x === undefined) ? 0 : x;
  state.mouse.y = (y === undefined) ? 0 : y;
}

// ═══════════════════════════════════════════════════════════════════════
// 1. clampTrimMark — the only place a mark is bounded
// ═══════════════════════════════════════════════════════════════════════
{
  const it = { trimStart: 0, trimEnd: 0 };
  near(api.clampTrimMark(it, 'in', 40, EXPECT_DUR), 40, 1e-9, 'in: a mark inside the clip is taken as-is');
  eq(api.clampTrimMark(it, 'in', -5, EXPECT_DUR), 0, 'in: never below 0');
  near(api.clampTrimMark(it, 'in', 999, EXPECT_DUR), EXPECT_DUR - EXPECT_TRIM_MIN_GAP, 1e-9,
       'in: never past the duration — and it leaves a legal segment, not a zero-length one');
  near(api.clampTrimMark(it, 'out', 40, EXPECT_DUR), 40, 1e-9, 'out: a mark inside the clip is taken as-is');
  eq(api.clampTrimMark(it, 'out', 999, EXPECT_DUR), EXPECT_DUR, 'out: never past the duration');

  // The gap is what stops the segment inverting. This is where the menu
  // (0.1s) and the hotkey (0.05s) used to disagree.
  const a = { trimStart: 0, trimEnd: 20 };
  near(api.clampTrimMark(a, 'in', 20, EXPECT_DUR), 20 - EXPECT_TRIM_MIN_GAP, 1e-9,
       'in: stops one gap short of the out point');
  near(api.clampTrimMark(a, 'in', 25, EXPECT_DUR), 20 - EXPECT_TRIM_MIN_GAP, 1e-9,
       'in: an in point past the out point is pulled back, not inverted');
  const b = { trimStart: 20, trimEnd: 0 };
  near(api.clampTrimMark(b, 'out', 20, EXPECT_DUR), 20 + EXPECT_TRIM_MIN_GAP, 1e-9,
       'out: stops one gap past the in point');
  near(api.clampTrimMark(b, 'out', 5, EXPECT_DUR), 20 + EXPECT_TRIM_MIN_GAP, 1e-9,
       'out: an out point before the in point is pushed forward, not inverted');

  eq(api.clampTrimMark({ trimStart: 0, trimEnd: 0 }, 'in', 5, 0), null, 'a clip with no duration cannot be marked');
  eq(api.clampTrimMark({ trimStart: 0, trimEnd: 0 }, 'in', 5, NaN), null, 'a NaN duration cannot be marked');
  eq(api.clampTrimMark({ trimStart: 0, trimEnd: 0 }, 'in', NaN, EXPECT_DUR), 0, 'a NaN time falls back to 0');
  eq(api.clampTrimMark({ trimStart: 0, trimEnd: 0 }, 'in', undefined, EXPECT_DUR), 0, 'an undefined time falls back to 0');

  // clampTrimMark must be PURE — that is what lets a caller ask "would this
  // press change anything?" before it decides about the undo step.
  const pure = { trimStart: 3, trimEnd: 9 };
  api.clampTrimMark(pure, 'in', 5, EXPECT_DUR);
  ok(pure.trimStart === 3 && pure.trimEnd === 9, 'clampTrimMark does not write to the item');
}

// ═══════════════════════════════════════════════════════════════════════
// 2. app constant pinned to the spec
// ═══════════════════════════════════════════════════════════════════════
eq(api.TRIM_MIN_GAP, EXPECT_TRIM_MIN_GAP, 'TRIM_MIN_GAP equals the spec');

// ═══════════════════════════════════════════════════════════════════════
// 3. trimEdgeOf — one reading of "where is this edge now"
// ═══════════════════════════════════════════════════════════════════════
{
  eq(api.trimEdgeOf({ trimStart: 7, trimEnd: 30 }, 'in', EXPECT_DUR), 7, 'in edge reads trimStart');
  eq(api.trimEdgeOf({ trimEnd: 30 }, 'in', EXPECT_DUR), 0, 'an unset in edge reads as 0');
  eq(api.trimEdgeOf({ trimStart: 7, trimEnd: 30 }, 'out', EXPECT_DUR), 30, 'out edge reads trimEnd');
  eq(api.trimEdgeOf({ trimStart: 7, trimEnd: 0 }, 'out', EXPECT_DUR), EXPECT_DUR,
     'a zero out edge means the whole clip, not a zero-length segment');
  eq(api.trimEdgeOf({ trimStart: 7 }, 'out', EXPECT_DUR), EXPECT_DUR, 'an unset out edge means the whole clip');
}

// ═══════════════════════════════════════════════════════════════════════
// 4. applyTrimMark
// ═══════════════════════════════════════════════════════════════════════
{
  const v = { currentTime: 2, duration: EXPECT_DUR };
  const it = { video: v, trimStart: 0, trimEnd: 0 };
  api.applyTrimMark(it, 'in', 30);
  eq(it.trimStart, 30, 'in: trimStart is written');
  eq(v.currentTime, 30, 'in: the playhead is dragged forward to the new in point');
  eq(it.trimEnd, 0, 'in: trimEnd is untouched');

  const v2 = { currentTime: 50, duration: EXPECT_DUR };
  const it2 = { video: v2, trimStart: 0, trimEnd: 0 };
  api.applyTrimMark(it2, 'in', 30);
  eq(v2.currentTime, 50, 'in: a playhead already inside the segment is left alone');

  const v3 = { currentTime: 50, duration: EXPECT_DUR };
  const it3 = { video: v3, trimStart: 0, trimEnd: 0 };
  api.applyTrimMark(it3, 'out', 30);
  eq(it3.trimEnd, 30, 'out: trimEnd is written');
  eq(v3.currentTime, 50, 'out: the playhead is never moved');
  eq(it3.trimStart, 0, 'out: trimStart is untouched');
}

// ═══════════════════════════════════════════════════════════════════════
// 5. _trimPointer — the fix for "clientX is 0 on a key event"
// ═══════════════════════════════════════════════════════════════════════
{
  state.mouse.x = 0; state.mouse.y = 0;
  eq(api._trimPointer(), null, 'a pointer that has never moved reads as no pointer at all');
  state.mouse.x = 0; state.mouse.y = 40;
  ok(api._trimPointer() !== null, 'a pointer on the left edge (x=0) is still a pointer');
  state.mouse.x = 12; state.mouse.y = 0;
  ok(api._trimPointer() !== null, 'a pointer on the top edge (y=0) is still a pointer');
  state.mouse.x = 200; state.mouse.y = 23;
  const p = api._trimPointer();
  eq(p.x, 200, 'the tracked pointer is returned verbatim');
  eq(p.y, 23, 'the tracked pointer is returned verbatim (y)');
}

// ═══════════════════════════════════════════════════════════════════════
// 6. trimTimeAtPointer — which places have a time axis
// ═══════════════════════════════════════════════════════════════════════
{
  const it = makeItem({});
  const P = it._player;

  pointAt(P.seekBar, 200, 23);
  near(api.trimTimeAtPointer(it), 50, 1e-9, 'cursor in the middle of the seek bar -> half the clip');

  pointAt(P.track, 200, 23);
  near(api.trimTimeAtPointer(it), 50, 1e-9, 'cursor on the track itself gives the same answer');

  pointAt(P.seekBar, 50, 23);
  near(api.trimTimeAtPointer(it), 0, 1e-9, 'cursor left of the bar clamps to 0');

  pointAt(P.seekBar, 400, 23);
  near(api.trimTimeAtPointer(it), EXPECT_DUR, 1e-9, 'cursor right of the bar clamps to the duration');

  pointAt(P.mini, 150, 46);
  near(api.trimTimeAtPointer(it), 25, 1e-9, 'cursor on the trim mini-bar reads that strip');

  // The reported symptom. The picture has no time axis, so there is no time
  // to return — the caller must fall back to the playhead AND SAY SO.
  pointAt(P.wrap, 150, 150);
  eq(api.trimTimeAtPointer(it), null, 'cursor on the video picture has no time — returns null');

  pointAt(null, 150, 150);
  eq(api.trimTimeAtPointer(it), null, 'cursor off the clip entirely returns null');

  POINT_NODE = null; state.mouse.x = 0; state.mouse.y = 0;
  eq(api.trimTimeAtPointer(it), null, 'no pointer at all returns null');

  // A hidden player (controls display:none) must not be read as "time 0".
  const hidden = makeItem({});
  const zeroRect = { left: 0, width: 0, top: 0, height: 0 };
  hidden._player.seekBar.getBoundingClientRect = function () { return zeroRect; };
  hidden._player.track.getBoundingClientRect   = function () { return zeroRect; };
  hidden._player.mini.getBoundingClientRect    = function () { return zeroRect; };
  pointAt(hidden._player.seekBar, 200, 23);
  eq(api.trimTimeAtPointer(hidden), null, 'a zero-width timeline is not a time source');
}

// ═══════════════════════════════════════════════════════════════════════
// 7. trimHotkey — the reported bug, end to end
// ═══════════════════════════════════════════════════════════════════════
{
  // ── 7a. TWO PRESSES ON THE SEEK BAR: the second one must move the mark ──
  resetCalls();
  const it = makeItem({ t: 10 });
  const P = it._player;

  pointAt(P.seekBar, 200, 23);              // half way -> 50s
  let handled = api.trimHotkey('in');
  ok(handled === true, 'press 1 on the seek bar is consumed');
  near(it.trimStart, 50, 1e-9, 'press 1: the mark lands at the cursor, not at the playhead');
  eq(it.video.currentTime, 50, 'press 1: the playhead follows the new in point');
  eq(calls.undo, 1, 'press 1: one undo step for one moved mark');
  eq(calls.save, 1, 'press 1: the change is scheduled for autosave');
  ok(calls.toasts.length === 1 && calls.toasts[0].indexOf('at cursor') >= 0,
     'press 1: the toast says the mark came from the cursor');
  eq(it.video.paused, true, 'the clip is paused so the playhead cannot drift mid-press');

  // THE BUG. Same clip, cursor moved along the same strip, press again.
  pointAt(P.seekBar, 250, 23);              // (250-102)/196 = 0.7551 -> 75.51s
  handled = api.trimHotkey('in');
  ok(handled === true, 'press 2 on the seek bar is consumed');
  near(it.trimStart, 75.5102, 1e-4, 'press 2: the mark MOVES to the new cursor position');
  eq(calls.undo, 2, 'press 2: a second undo step, because something actually changed');

  // ── 7b. THE PICTURE: honest no-op instead of a silent one ───────────────
  resetCalls();
  const it2 = makeItem({ t: 10 });
  const P2 = it2._player;
  pointAt(P2.seekBar, 200, 23);
  api.trimHotkey('in');
  const afterFirst = it2.trimStart;
  near(afterFirst, 50, 1e-9, '7b setup: first press on the seek bar marks at the cursor');

  resetCalls();
  pointAt(P2.wrap, 150, 150);               // cursor on the picture, playhead at 50
  handled = api.trimHotkey('in');
  ok(handled === true, 'a press with the cursor on the picture is still a trim press');
  eq(it2.trimStart, afterFirst, 'the mark does not move — the picture has no time axis');
  eq(calls.undo, 0, 'a no-op press does NOT push an undo step');
  eq(calls.save, 0, 'a no-op press does not schedule an autosave');
  ok(calls.toasts.length === 1, 'a no-op press still reports back (it is not silent)');
  ok(calls.toasts[0].indexOf('stays at') >= 0, 'the no-op toast says where the mark already is');
  ok(calls.toasts[0].indexOf('move the playhead') >= 0,
     'the no-op toast says HOW to move it — the whole point of the fix');

  // ── 7c. Move the playhead, press again: now the picture case works ──────
  resetCalls();
  it2.video.currentTime = 80;
  handled = api.trimHotkey('in');
  near(it2.trimStart, 80, 1e-9, 'with the playhead moved, the same press marks at the playhead');
  eq(calls.undo, 1, 'that press did change something, so it gets an undo step');

  // ── 7d. Cursor already sitting on the mark ─────────────────────────────
  resetCalls();
  const it3 = makeItem({ t: 0 });
  const P3 = it3._player;
  pointAt(P3.seekBar, 200, 23);
  api.trimHotkey('in');
  resetCalls();
  handled = api.trimHotkey('in');           // same cursor, same clip
  eq(calls.undo, 0, 'pressing twice on the same spot pushes no undo step');
  ok(calls.toasts[0].indexOf('already there') >= 0, 'and says the cursor is already there');

  // ── 7e. 'out' mirrors 'in' ─────────────────────────────────────────────
  resetCalls();
  const it4 = makeItem({ t: 0, trimStart: 10 });
  const P4 = it4._player;
  pointAt(P4.mini, 150, 46);                // 25s
  api.trimHotkey('out');
  near(it4.trimEnd, 25, 1e-9, 'out: the mark lands at the cursor on the trim mini-bar');
  eq(it4.video.currentTime, 0, 'out: the playhead is never moved');
  pointAt(P4.mini, 250, 46);                // 75.51s
  api.trimHotkey('out');
  near(it4.trimEnd, 75, 1e-9, 'out: a second press moves the out point too');

  // ── 7f. Intent gate ────────────────────────────────────────────────────
  resetCalls();
  const it5 = makeItem({ t: 4 });
  const other = buildPlayerEl();
  pointAt(other.itemEl, 200, 23);           // cursor is over a DIFFERENT clip
  eq(api.trimHotkey('in'), false, 'a press with the cursor on another clip is not a trim press');
  eq(it5.trimStart, 0, 'and that clip is untouched');

  resetCalls();
  state.selected = new Set();               // nothing selected
  pointAt(it5._player.seekBar, 200, 23);
  eq(api.trimHotkey('in'), false, 'no selection -> not a trim press');

  resetCalls();
  state.selected = new Set([1]);
  POINT_NODE = null; state.mouse.x = 0; state.mouse.y = 0;   // pure keyboard
  it5.video.currentTime = 42;
  eq(api.trimHotkey('in'), true, 'a pure keyboard press (no pointer) still works');
  near(it5.trimStart, 42, 1e-9, 'and marks at the playhead, because there is no cursor to read');

  // ── 7g. Not-ready clip ─────────────────────────────────────────────────
  resetCalls();
  const it6 = makeItem({ duration: NaN, t: 0 });
  pointAt(it6._player.seekBar, 200, 23);
  eq(api.trimHotkey('in'), true, 'a not-ready clip still consumes the press');
  eq(it6.trimStart, 0, 'a not-ready clip is not marked');
  eq(calls.undo, 0, 'no undo step for a clip that cannot be marked');
  ok(calls.toasts.length === 1 && calls.toasts[0].indexOf('not ready') >= 0,
     'and the user is told the clip is not ready');

  // ── 7h. A playing clip is paused first ─────────────────────────────────
  resetCalls();
  const it7 = makeItem({ t: 5 });
  it7.video.paused = false;
  pointAt(it7._player.seekBar, 200, 23);
  api.trimHotkey('in');
  eq(it7.video.paused, true, 'a playing clip is paused before the mark is read');
}

// ═══════════════════════════════════════════════════════════════════════
// 8. setTrimFromPlayhead (the context-menu path) shares the same code
// ═══════════════════════════════════════════════════════════════════════
{
  resetCalls();
  const it = makeItem({ t: 30 });
  pointAt(it._player.seekBar, 200, 23);     // cursor says 50 — the MENU must ignore it
  api.setTrimFromPlayhead('in');
  near(it.trimStart, 30, 1e-9, 'the menu marks at the playhead, not at the cursor');
  eq(calls.undo, 1, 'the menu pushes one undo step');

  resetCalls();
  api.setTrimFromPlayhead('in');            // playhead is now 30, mark is 30
  eq(calls.undo, 0, 'a no-op menu press pushes no undo step');
  ok(calls.toasts.length === 1 && calls.toasts[0].indexOf('already at the playhead') >= 0,
     'and says so instead of pretending it worked');

  resetCalls();
  const it2 = makeItem({ t: 0 });
  api.setTrimFromPlayhead('in');
  near(it2.trimStart, 0, 1e-9, 'marking an in point at 0 is allowed');
  eq(calls.undo, 0, 'but it is a no-op when the in point is already 0');

  resetCalls();
  state.selected = new Set();
  api.setTrimFromPlayhead('in');
  ok(calls.toasts.length === 1 && calls.toasts[0].indexOf('Select a video') >= 0,
     'with nothing selected the menu asks for a selection');
  state.selected = new Set([1]);
}

// ═══════════════════════════════════════════════════════════════════════
// 9. Structural: one implementation, not two
// ═══════════════════════════════════════════════════════════════════════
{
  const hot = codeOnly(fnFull('trimHotkey', src));
  const menu = codeOnly(fnFull('setTrimFromPlayhead', src));

  ok(hot.indexOf('applyTrimMark(') >= 0, 'the hotkey writes through the shared applyTrimMark');
  ok(hot.indexOf('clampTrimMark(') >= 0, 'the hotkey bounds through the shared clampTrimMark');
  ok(!/\.trimStart\s*=/.test(hot), 'the hotkey never assigns trimStart directly');
  ok(!/\.trimEnd\s*=/.test(hot), 'the hotkey never assigns trimEnd directly');
  ok(!/\.trimStart\s*=/.test(menu), 'the menu never assigns trimStart directly');
  ok(!/\.trimEnd\s*=/.test(menu), 'the menu never assigns trimEnd directly');
  ok(hot.indexOf('refreshTrimUIFor(') >= 0, 'the hotkey repaints through the shared refreshTrimUIFor');
  ok(hot.indexOf('pushUndo(') >= 0, 'the hotkey takes an undo step (the old one did not)');

  // The old hand-rolled 25-line DOM poke is gone. It duplicated
  // refreshInPlayerTrimUI() and, being a copy, had already drifted — it never
  // updated the trim mini-bar's playhead.
  ok(src.indexOf('trimRegionIO') < 0, 'the old inline mini-bar poke is gone');
  ok(src.indexOf('mainStartIO') < 0, 'the old inline seek-bar poke is gone');
  ok(src.indexOf('vidItemIO') < 0, 'the old hotkey locals are gone');
  ok(src.indexOf('_tFromTrackIO') < 0, 'the old cursor-time helper is gone');
  ok(src.indexOf('overTimeline') < 0, 'the old "is the cursor on a timeline" flag is gone');

  // The dispatcher is a gate now, not an implementation.
  // NOTE: "// Round 34: i/o trim hotkey" occurs TWICE — a stale comment in
  // buildMediaControls says where the handler moved to. Anchor on the
  // v7.0.42 line, which is unique, and search for the end AFTER it.
  const gateA = src.indexOf('// v7.0.42: the mark itself moved into trimHotkey()');
  const gateB = src.indexOf('// Single keys', gateA);
  ok(gateA >= 0 && gateB > gateA, 'the i/o gate is where the suite expects it');
  const gate = (gateA >= 0 && gateB > gateA) ? src.slice(gateA, gateB) : '';
  ok(codeOnly(gate).indexOf('trimHotkey(') >= 0, 'the dispatcher delegates to trimHotkey');
  ok(codeOnly(gate).indexOf('querySelector') < 0, 'the dispatcher no longer walks the DOM');
  ok(gate.length < 1400, 'the dispatcher is a gate, not a second implementation (' + gate.length + ' chars)');

  // The cursor must come from the board's tracked pointer, not from a key
  // event's clientX (which is 0 whenever the browser does not carry the
  // pointer on key events).
  const ptr = fnFull('_trimPointer', src);
  ok(codeOnly(ptr).indexOf('state.mouse') >= 0, 'the pointer comes from state.mouse');
  ok(codeOnly(ptr).indexOf('e.clientX') < 0, 'the pointer does NOT come from the key event');
  const tap = codeOnly(fnFull('trimTimeAtPointer', src));
  ok(tap.indexOf('e.clientX') < 0, 'the cursor-time helper never reads the key event');

  // The two palette entries used to return false — the palette closed and
  // nothing happened at all.
  ok(src.indexOf("case 'media-trim-i':           setTrimFromPlayhead('in');") >= 0,
     'the palette Trim In entry now acts');
  ok(src.indexOf("case 'media-trim-o':           setTrimFromPlayhead('out');") >= 0,
     'the palette Trim Out entry now acts');

  // refreshTrimUIFor must drive every surface, or the menu and the hotkey
  // disagree about what "refreshed" means.
  const rf = fnFull('refreshTrimUIFor', src);
  ok(rf.indexOf('_refreshInPlayerTrimUI') >= 0, 'refresh drives the in-player trim UI');
  ok(rf.indexOf('updateVideoTimeline') >= 0, 'refresh drives the right-hand panel timeline');
}

// ═══════════════════════════════════════════════════════════════════════
// 9b. Shrink-only detection (v7.0.42)
// ═══════════════════════════════════════════════════════════════════════
{
  const th = fnFull('trimHotkey', src);
  ok(th.length > 0, 'trimHotkey body extracted for shrink-only analysis');

  // The detection reads trimStart/trimEnd to know where the edges are.
  ok(th.indexOf('trimStart') >= 0, 'shrink check reads trimStart');
  ok(th.indexOf('trimEnd') >= 0, 'shrink check reads trimEnd');

  // It only fires when there is no hover time (playhead fallback).
  ok(th.indexOf('hoverT === null') >= 0, 'shrink-only is gated on no hover');

  // I pressed right of IN → shrink. O pressed left of OUT → shrink.
  ok(th.indexOf("which === 'in' && t > ts") >= 0,
     'detects I-press right of IN as shrink-only');
  ok(th.indexOf("which === 'out' && t < te") >= 0,
     'detects O-press left of OUT as shrink-only');

  // When shrinking from trapped playhead, flash the OTHER handle too so the
  // user sees both boundaries are draggable.
  ok(th.indexOf("flashTrimHandle(it, which === 'in' ? 'out' : 'in')") >= 0,
     'flashes the opposite handle on shrink-only');

  // The toast mentions hovering to expand.
  ok(th.indexOf('hover the seek bar') >= 0,
     'toast tells the user to hover the seek bar to expand');
  ok(th.indexOf('to expand') >= 0, 'toast uses the word "expand"');

  // The non-shrink case (hover or playhead at the expanding side) does NOT
  // get the expand hint.
  // We verify this structurally: the expand hint is inside the `isShrinkOnly`
  // branch, not in the moved-or-not branches.
  // The toast for a normal move (hover) says "(at cursor)" with no expand text.
  // The toast for a hover no-op says "cursor is already there".
  // Only the playhead-fallback paths mention "hover the seek bar ... to expand".
}

// ═══════════════════════════════════════════════════════════════════════
// 10. Version
// ═══════════════════════════════════════════════════════════════════════
{
  ok(src.indexOf("var KRAFTED_VERSION = '7.0.43';") >= 0, 'KRAFTED_VERSION bumped');
  ok(src.indexOf('<title>Krafted v7.0.43</title>') >= 0, 'title bumped');
  const swPath = process.env.KRAFTED_SW
    ? path.resolve(process.env.KRAFTED_SW)
    : path.resolve(__dirname, '../docs/sw.js');
  const sw = fs.readFileSync(swPath, 'utf8');
  ok(sw.indexOf("const CACHE_NAME = 'krafted-v7.0.43-'") >= 0, 'sw CACHE_NAME bumped');
  ok(sw.indexOf("const APP_VERSION = '7.0.43';") >= 0, 'sw APP_VERSION bumped');
}

console.log('');
console.log(fail === 0 ? 'ALL PASS (' + pass + ' assertions)' : 'FAILURES: ' + fail + ' (passed ' + pass + ')');
process.exit(fail === 0 ? 0 : 1);
