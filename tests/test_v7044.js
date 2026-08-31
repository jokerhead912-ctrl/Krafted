// v7.0.44 regression suite — trim range that can grow, and a reset that exists
//
//   "first i/o works, but the moment I press O again the two handles stick
//    together, and then I have to reset. If you can't make it work, at least
//    give me a reset control. Best would be real-time, and the logic should
//    work like Premiere."
//
// Two separate defects produced that one symptom:
//
//   1. The timeupdate loop snapped the playhead back into [in, out] on EVERY
//      seek, including the ones the user raises by scrubbing. No time
//      outside the range was reachable, so both marks could only move
//      inward.
//   2. A mark landing on the opposite mark was CLAMPED to one minimum gap
//      away instead of being recognised as a contradiction — so asking for
//      an out point at the in point produced a 0.05s segment with both
//      handles touching, and no way out but Clear Trim.
//
// The functions under test are EXTRACTED FROM THE REAL SOURCE and executed.
// A grep that finds "v.paused" in a 37K-line file proves nothing about
// whether a paused playhead can leave the range — that is the mistake the
// v7.0.42 fix made (it detected the trap and told the user to work around
// it) and the bug came back in a worse form one day later.
const fs = require('fs');
const path = require('path');

// KRAFTED_HTML / KRAFTED_SW let the mutation check point the suite at a
// deliberately broken COPY, so the real dev file is never touched.
const HTML = process.env.KRAFTED_HTML
  ? path.resolve(process.env.KRAFTED_HTML)
  : path.resolve(__dirname, '../../kraftpub-v6.8.0.html');
const SWJS = process.env.KRAFTED_SW
  ? path.resolve(process.env.KRAFTED_SW)
  : path.resolve(__dirname, '../docs/sw.js');
const src = fs.readFileSync(HTML, 'utf8');
const sw = fs.readFileSync(SWJS, 'utf8');

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

// ── spec constants (independent of the source) ───────────────────────────
const EXPECT_DUR          = 100;   // fake clip length used throughout
const EXPECT_TRIM_MIN_GAP = 0.05;  // shortest legal segment, seconds
// A segment this short is the "two handles stuck together" state. Anything
// at or below it is the bug, whatever produced it.
const COLLAPSED = EXPECT_TRIM_MIN_GAP + 1e-9;

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
// Strip BOTH comment forms before asserting on code. Whole-line // is not
// enough: commenting a call out with /* ... */ leaves the text behind and a
// bare indexOf still finds it — four mutations escaped test_v7043 that way.
function codeOnly(s) {
  // The cap matters. This file contains a string literal '/*' whose matching
  // '*/' sits 270 KB further on, so an unbounded strip deletes 42% of the
  // source — every assertion then runs against a file that has silently lost
  // the code it is meant to be checking. Real comments here top out at 831
  // characters; the three runaway spans are all 21 KB or more.
  return s.replace(/\/\*[\s\S]{0,4000}?\*\//g, '')
          .split('\n').filter(function (l) { return l.trim().indexOf('//') !== 0; }).join('\n');
}

console.log('Krafted v7.0.44 — trim range that can grow, and a real reset');
console.log('');

// ═══════════════════════════════════════════════════════════════════════
//  Load the real trim module
// ═══════════════════════════════════════════════════════════════════════
const block = (function () {
  const a = src.indexOf('function selectedVideoItems() {');
  const b = src.indexOf('//  CONTACT SHEET (v7.0.38)');
  if (a < 0 || b < a) { console.log('  FAIL: trim module slice not found'); fail++; return ''; }
  return src.slice(a, b);
})();

// updateVideoPlayhead and updateVideoTimeline are counted SEPARATELY. They
// are two different refreshes (the playhead marker vs the whole bar), and
// folding them into one counter made "the UI refreshed once" read as 2 and
// the assertion look broken when the code was right.
const calls = { undo: 0, save: 0, toasts: [], playhead: 0, timeline: 0 };
function resetCalls() {
  calls.undo = 0; calls.save = 0; calls.toasts = [];
  calls.playhead = 0; calls.timeline = 0;
}

const state = { items: [], selected: new Set(), mouse: { x: 0, y: 0 } };

let api = null;
try {
  api = new Function(
    'state', 'document', 'updateVideoTimeline', 'pushUndo', 'scheduleAutoSave',
    'toast', 'formatTime', 'setTimeout', 'console',
    block + '\nreturn { TRIM_MIN_GAP: TRIM_MIN_GAP,'
          + ' trimEdgeOf: trimEdgeOf,'
          + ' clampTrimMark: clampTrimMark,'
          + ' applyTrimMark: applyTrimMark,'
          + ' markIsSet: markIsSet,'
          + ' planTrimMark: planTrimMark,'
          + ' applyTrimPlan: applyTrimPlan,'
          + ' clearTrimMark: clearTrimMark,'
          + ' clearTrimSelected: clearTrimSelected,'
          + ' setTrimFromPlayhead: setTrimFromPlayhead };'
  )(
    state, { elementFromPoint: function () { return null; } },
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

// A clip with no DOM at all: refreshTrimUIFor swallows the missing element.
function makeItem(over) {
  over = over || {};
  const v = {
    duration: (over.duration !== undefined) ? over.duration : EXPECT_DUR,
    currentTime: (over.t !== undefined) ? over.t : 0
  };
  const it = {
    id: 1, isVideo: true, type: 'video', el: null, video: v,
    trimStart: (over.trimStart !== undefined) ? over.trimStart : 0,
    trimEnd: (over.trimEnd !== undefined) ? over.trimEnd : 0
  };
  state.items = [it];
  // `selected` is overridable: the "nothing selected" cases used to be
  // clobbered by this line, so they silently tested a selected item instead.
  state.selected = over.selected ? over.selected : new Set([1]);
  return it;
}
function seg(it) { return (it.trimEnd || EXPECT_DUR) - (it.trimStart || 0); }

// ═══════════════════════════════════════════════════════════════════════
// 1. planTrimMark — a request on the opposite mark is a conflict, not a value
// ═══════════════════════════════════════════════════════════════════════
{
  eq(api.TRIM_MIN_GAP, EXPECT_TRIM_MIN_GAP, 'TRIM_MIN_GAP equals the spec');

  const fresh = { trimStart: 0, trimEnd: 0 };
  let p = api.planTrimMark(fresh, 'in', 40, EXPECT_DUR);
  near(p.val, 40, 1e-9, 'plain request: the value is taken as-is');
  eq(p.clearsOpp, false, 'plain request: nothing is cleared');

  // Asking for an in point at the very end of an UNMARKED clip is not a
  // conflict — there is no out point to contradict. It clamps, as before.
  p = api.planTrimMark(fresh, 'in', 99.98, EXPECT_DUR);
  eq(p.clearsOpp, false, 'an unset out point is not "cleared" — there is nothing there');
  near(p.val, EXPECT_DUR - EXPECT_TRIM_MIN_GAP, 1e-9, 'it still clamps one gap short of the end');

  // THE BUG. In point set at 10, playhead still parked on it, press O.
  const a = { trimStart: 10, trimEnd: 0 };
  p = api.planTrimMark(a, 'out', 10, EXPECT_DUR);
  eq(p.clearsOpp, true, 'out on top of the in point is a conflict, not a value to clamp');
  near(p.val, 10, 1e-9, 'the requested time survives — it is not pushed to 10.05');
  near(p.oppWas, 10, 1e-9, 'the plan reports which mark it is clearing');

  // Just inside the gap still counts: 10 vs 10.05 is not a range anyone wants.
  p = api.planTrimMark({ trimStart: 10, trimEnd: 0 }, 'out', 10.03, EXPECT_DUR);
  eq(p.clearsOpp, true, 'a request inside the minimum gap is still a conflict');

  // A real out point, well past the in point, is an ordinary move.
  p = api.planTrimMark({ trimStart: 10, trimEnd: 30 }, 'out', 25, EXPECT_DUR);
  eq(p.clearsOpp, false, 'an out point inside the range is an ordinary move');
  near(p.val, 25, 1e-9, 'and keeps its value');

  // EXPANDING the range — the thing that used to be impossible.
  p = api.planTrimMark({ trimStart: 10, trimEnd: 40 }, 'out', 60, EXPECT_DUR);
  eq(p.clearsOpp, false, 'pushing the out point later is an ordinary move');
  near(p.val, 60, 1e-9, 'and it grows the range instead of refusing');

  // Out point requested BEFORE the in point: the in point is the stale one.
  p = api.planTrimMark({ trimStart: 10, trimEnd: 40 }, 'out', 5, EXPECT_DUR);
  eq(p.clearsOpp, true, 'an out point before the in point clears the in point');
  near(p.val, 5, 1e-9, 'and lands where it was asked to');
  near(p.oppWas, 10, 1e-9, 'reporting the in point as the one cleared');

  // Mirror image: in point requested past the out point.
  p = api.planTrimMark({ trimStart: 10, trimEnd: 30 }, 'in', 35, EXPECT_DUR);
  eq(p.clearsOpp, true, 'an in point past the out point clears the out point');
  near(p.val, 35, 1e-9, 'and lands where it was asked to');
  near(p.oppWas, 30, 1e-9, 'reporting the out point as the one cleared');

  // An out point at the clip end is the same as unset — do not "clear" it.
  p = api.planTrimMark({ trimStart: 10, trimEnd: EXPECT_DUR }, 'in', 99.99, EXPECT_DUR);
  eq(p.clearsOpp, false, 'an out point sitting on the clip edge is not treated as set');

  eq(api.planTrimMark({ trimStart: 0, trimEnd: 0 }, 'in', 5, NaN), null, 'a NaN duration cannot be planned');
  eq(api.planTrimMark({ trimStart: 0, trimEnd: 0 }, 'in', 5, 0), null, 'a zero duration cannot be planned');
  near(api.planTrimMark({ trimStart: 0, trimEnd: 0 }, 'in', NaN, EXPECT_DUR).val, 0, 1e-9,
       'a NaN time falls back to 0');

  // Purity, same as clampTrimMark: a caller must be able to ask "would this
  // press change anything?" before deciding about the undo step.
  const pure = { trimStart: 10, trimEnd: 30 };
  api.planTrimMark(pure, 'out', 5, EXPECT_DUR);
  ok(pure.trimStart === 10 && pure.trimEnd === 30, 'planTrimMark does not write to the item');
}

// ═══════════════════════════════════════════════════════════════════════
// 2. applyTrimPlan — clearing sets the far edge to the clip boundary
// ═══════════════════════════════════════════════════════════════════════
{
  // "Unset" is spelled as the clip edge everywhere in this app (trimEdgeOf,
  // and the loadedmetadata handler). Clearing must use the same spelling or
  // the two readings drift.
  const a = { trimStart: 10, trimEnd: 0 };
  api.applyTrimPlan(a, api.planTrimMark(a, 'out', 10, EXPECT_DUR), EXPECT_DUR);
  eq(a.trimStart, 0, 'clearing the in point sets it to 0');
  near(a.trimEnd, 10, 1e-9, 'the out point lands where it was asked for');
  ok(seg(a) > COLLAPSED, 'the resulting segment is a real range, not a collapsed one');
  eq(api.trimEdgeOf(a, 'in', EXPECT_DUR), 0, 'and trimEdgeOf reads the cleared in point as unset');

  const b = { trimStart: 10, trimEnd: 30 };
  api.applyTrimPlan(b, api.planTrimMark(b, 'in', 35, EXPECT_DUR), EXPECT_DUR);
  near(b.trimStart, 35, 1e-9, 'clearing the out point leaves the in point where it was asked for');
  eq(b.trimEnd, EXPECT_DUR, 'and sets the out point to the clip end');
  eq(api.trimEdgeOf(b, 'out', EXPECT_DUR), EXPECT_DUR, 'trimEdgeOf reads that as the whole clip');

  const c = { trimStart: 10, trimEnd: 30 };
  api.applyTrimPlan(c, api.planTrimMark(c, 'out', 25, EXPECT_DUR), EXPECT_DUR);
  near(c.trimEnd, 25, 1e-9, 'an ordinary plan delegates to applyTrimMark');
  eq(c.trimStart, 10, 'and leaves the other edge alone');

  api.applyTrimPlan({ trimStart: 0, trimEnd: 0 }, null, EXPECT_DUR);
  ok(true, 'a null plan is ignored instead of throwing');
}

// ═══════════════════════════════════════════════════════════════════════
// 3. The reported sequence, end to end through the real menu path
// ═══════════════════════════════════════════════════════════════════════
{
  // "press I, then press O without moving" — the exact report.
  resetCalls();
  const it = makeItem({ t: 10 });
  api.setTrimFromPlayhead('in');
  near(it.trimStart, 10, 1e-9, 'I at the playhead marks the in point');
  eq(it.video.currentTime, 10, 'and leaves the playhead there');

  resetCalls();
  api.setTrimFromPlayhead('out');
  near(it.trimEnd, 10, 1e-9, 'O at the same place marks the out point there');
  eq(it.trimStart, 0, 'and clears the in point rather than clamping onto it');
  eq(calls.undo, 1, 'the second press is a real change, so it gets an undo step');
  ok(seg(it) > COLLAPSED, 'SEGMENT IS NOT COLLAPSED — the reported symptom is gone');
  ok(calls.toasts.length === 1 && calls.toasts[0].indexOf('cleared') >= 0,
     'and the user is told the other mark was cleared');

  // ── now the range can move in both directions ──
  resetCalls();
  const it2 = makeItem({ t: 10 });
  api.setTrimFromPlayhead('in');                       // IN = 10
  it2.video.currentTime = 40;
  api.setTrimFromPlayhead('out');                      // OUT = 40
  near(seg(it2), 30, 1e-9, 'a normal two-press range works');

  it2.video.currentTime = 25;
  api.setTrimFromPlayhead('out');                      // pull OUT in
  near(it2.trimEnd, 25, 1e-9, 'the out point can still be pulled in');
  eq(it2.trimStart, 10, 'without disturbing the in point');

  it2.video.currentTime = 70;
  api.setTrimFromPlayhead('out');                      // push OUT out again
  near(it2.trimEnd, 70, 1e-9, 'EXPANDING works — the range grows, not just shrinks');
  eq(it2.trimStart, 10, 'and the in point is still where it was');

  it2.video.currentTime = 5;
  api.setTrimFromPlayhead('in');                       // push IN earlier
  near(it2.trimStart, 5, 1e-9, 'the in point can move earlier too');
  near(it2.trimEnd, 70, 1e-9, 'without disturbing the out point');
}

// ═══════════════════════════════════════════════════════════════════════
// 4. The cage — the cause, not the symptom
// ═══════════════════════════════════════════════════════════════════════
{
  let setup = null;
  try {
    setup = new Function('state', 'updateVideoPlayhead', 'updateVideoTimeline',
      fnFull('setupVideoTrim', src) + '\nreturn setupVideoTrim;'
    )(state, function () { calls.playhead++; }, function () { calls.timeline++; });
  } catch (e) {
    console.log('  FAIL: setupVideoTrim threw on load: ' + e.message);
    fail++;
  }

  function makeVideo(over) {
    over = over || {};
    const handlers = {};
    const v = {
      duration: EXPECT_DUR,
      currentTime: (over.currentTime !== undefined) ? over.currentTime : 10,
      paused: (over.paused !== undefined) ? over.paused : true,
      readyState: 1,
      playbackRate: 1,
      _kraftedSuppressTrimLoop: !!over.suppress,
      addEventListener: function (t, fn) { (handlers[t] = handlers[t] || []).push(fn); },
      fire: function (t) { (handlers[t] || []).forEach(function (fn) { fn(); }); }
    };
    return v;
  }

  if (setup) {
    // ── the one-time metadata seed is a DIFFERENT rule, and it is correct ──
    // When a clip first loads with an in point set, Krafted opens on the in
    // point — that is what Premiere's Source Monitor does too. It runs once,
    // when metadata arrives (setupVideoTrim's four call sites are all item
    // lifetime events: create, restore, paste, undo-a-delete — none of them
    // is on the UI refresh path). What made the cage a cage was this same
    // rule running again on EVERY tick. So the two are measured separately:
    // seed first, then park the playhead by hand and fire one tick.
    const vSeed = makeVideo({ currentTime: 2, paused: true });
    setup({ id: 1, video: vSeed, trimStart: 10, trimEnd: 30 });
    near(vSeed.currentTime, 10, 1e-9,
         'on first load the playhead IS seeded onto the in point — once');

    // Everything below: let the seed happen, THEN park the playhead. Testing
    // the tick through the seed lets a broken handler pass for the right
    // reason (v3 below did exactly that on the first run).
    function tick(over) {
      const v = makeVideo(over);
      setup({
        id: 1, video: v,
        trimStart: (over.trimStart !== undefined) ? over.trimStart : 10,
        trimEnd: (over.trimEnd !== undefined) ? over.trimEnd : 30
      });
      v.currentTime = over.park;      // the user parks it, after load
      v.fire('timeupdate');
      return v;
    }

    // THE FIX. A paused playhead outside the range must stay where the user
    // parked it — that is what makes choosing a new range possible at all.
    let v = tick({ paused: true, park: 80 });
    near(v.currentTime, 80, 1e-9,
         'a PAUSED playhead outside [in, out] is left where the user parked it');
    near(v.currentTime, 80, 1e-9, 'it is NOT snapped back to the in point');

    v = tick({ paused: true, park: 2 });
    near(v.currentTime, 2, 1e-9, 'the same holds on the early side of the in point');

    // It holds right at the edge: the old loop had a 0.05s tolerance band,
    // so "just before the in point" is where it bit hardest.
    v = tick({ paused: true, park: 9.9 });
    near(v.currentTime, 9.9, 1e-9, 'a paused playhead just before the in point is not pulled in');
    v = tick({ paused: true, park: 30.1 });
    near(v.currentTime, 30.1, 1e-9, 'and one just past the out point is not pulled back');

    // Board behaviour is untouched: while PLAYING the loop still holds the
    // clip inside the trimmed segment.
    v = tick({ paused: false, park: 80 });
    near(v.currentTime, 10, 1e-9, 'a PLAYING clip past the out point loops to the in point');

    v = tick({ paused: false, park: 2 });
    near(v.currentTime, 10, 1e-9, 'a PLAYING clip before the in point is pulled forward');

    v = tick({ paused: false, park: 20 });
    near(v.currentTime, 20, 1e-9, 'a PLAYING clip inside the range is not touched');

    // The batch-capture escape hatch still wins over both states.
    v = tick({ paused: false, park: 80, suppress: true });
    near(v.currentTime, 80, 1e-9, 'a suppressed capture is never yanked back, playing or not');

    // ── and the two rules live in two different handlers ──
    const svtBody = fnFull('setupVideoTrim', src);
    const tickAt = svtBody.indexOf("addEventListener('timeupdate'");
    ok(tickAt > 0, 'the per-tick handler is where the suite expects it');
    const beforeTick = codeOnly(svtBody.slice(0, tickAt));
    const afterTick = codeOnly(svtBody.slice(tickAt));
    ok(beforeTick.indexOf('v.currentTime = item.trimStart') >= 0,
       'the seed onto the in point lives in the metadata handler');
    ok(afterTick.indexOf('v.currentTime = item.trimStart') < 0,
       'and NOT in the per-tick handler — that duplication was the cage');
    ok(codeOnly(afterTick).indexOf('v.paused') >= 0,
       'the per-tick handler asks whether the clip is playing before it moves anything');

    // The playhead UI must keep painting on a paused clip: the refresh has to
    // sit BEFORE the guard returns, not after it.
    resetCalls();
    const v6 = makeVideo({ currentTime: 80, paused: true });
    state.selected = new Set([1]);
    setup({ id: 1, video: v6, trimStart: 10, trimEnd: 30 });
    resetCalls();                       // drop onMeta's own timeline refresh
    v6.currentTime = 80;
    v6.fire('timeupdate');
    eq(calls.playhead, 1, 'the playhead UI still refreshes on a paused clip');

    resetCalls();
    const v7 = makeVideo({ currentTime: 80, paused: true });
    state.selected = new Set();
    setup({ id: 1, video: v7, trimStart: 10, trimEnd: 30 });
    v7.fire('timeupdate');
    eq(calls.playhead, 0, 'and does not refresh for an unselected clip');
    state.selected = new Set([1]);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 5. clearTrimMark — one end at a time
// ═══════════════════════════════════════════════════════════════════════
{
  resetCalls();
  const it = makeItem({ trimStart: 10, trimEnd: 40 });
  eq(api.clearTrimMark('in'), true, 'clearing the in point reports that it acted');
  eq(it.trimStart, 0, 'the in point is cleared');
  near(it.trimEnd, 40, 1e-9, 'AND THE OUT POINT SURVIVES — half a trim is not thrown away');
  eq(calls.undo, 1, 'clearing is undoable');
  eq(calls.save, 1, 'and is persisted');

  resetCalls();
  const it2 = makeItem({ trimStart: 10, trimEnd: 40 });
  eq(api.clearTrimMark('out'), true, 'clearing the out point reports that it acted');
  near(it2.trimStart, 10, 1e-9, 'the in point survives this time');
  eq(it2.trimEnd, EXPECT_DUR, 'the out point runs to the end of the clip');

  resetCalls();
  makeItem({ trimStart: 10, trimEnd: 40, selected: new Set() });
  eq(api.clearTrimMark('in'), false, 'with nothing selected it reports that it did NOT act');
  eq(calls.undo, 0, 'and pushes no undo step');
  ok(calls.toasts.length === 1 && calls.toasts[0].indexOf('Select a video') >= 0,
     'it says why');
  state.selected = new Set([1]);

  // Clearing is not a silent alias for "reset everything".
  resetCalls();
  const it3 = makeItem({ trimStart: 0, trimEnd: 0 });
  api.clearTrimMark('in');
  eq(calls.undo, 1, 'clearing an already-clear mark still takes an undo step (it is what was asked)');
}

// ═══════════════════════════════════════════════════════════════════════
// 6. Structural: the reset is reachable, and there is one drag, not two
// ═══════════════════════════════════════════════════════════════════════
{
  // ── the reset control itself ──
  const resetClick = (function () {
    const a = src.indexOf("trimResetBtn.addEventListener('click'");
    const b = src.indexOf('\n  });', a);
    return (a >= 0 && b > a) ? src.slice(a, b) : '';
  })();
  ok(resetClick.length > 0, 'the reset control has a handler');
  ok(codeOnly(resetClick).indexOf('pushUndo()') >= 0,
     'RESET IS UNDOABLE — the one control whose job is undoing trim experiments');
  ok(codeOnly(resetClick).indexOf('scheduleAutoSave()') >= 0,
     'RESET IS PERSISTED — otherwise a reload silently brings the old trim back');
  ok(src.indexOf("trimResetBtn.title = 'Reset trim — play the whole clip") >= 0,
     'the reset says what it does, and points at the one-end clears');

  // ── three ways in, so it is findable ──
  const ctx = fnFull('showCtx', src);
  ok(ctx.indexOf("clearTrimMark('in')") >= 0, 'the context menu offers Clear In Point');
  ok(ctx.indexOf("clearTrimMark('out')") >= 0, 'the context menu offers Clear Out Point');
  ok(ctx.indexOf('<kbd>⇧I</kbd>') >= 0, 'and shows the Shift+I shortcut for it');
  ok(ctx.indexOf('<kbd>⇧O</kbd>') >= 0, 'and the Shift+O one');

  const gateA = src.indexOf('  // v7.0.44: Shift+I / Shift+O clear ONE mark.');
  const gateB = src.indexOf('// Single keys', gateA);
  ok(gateA >= 0 && gateB > gateA, 'the i/o dispatcher is where the suite expects it');
  const gate = (gateA >= 0 && gateB > gateA) ? src.slice(gateA, gateB) : '';
  const gateCode = codeOnly(gate);
  ok(gateCode.indexOf('clearTrimMark(') >= 0, 'Shift+I / Shift+O reach clearTrimMark');
  ok(gateCode.indexOf('trimHotkey(') >= 0, 'the bare keys still MARK');
  ok(gateCode.indexOf('e.shiftKey') >= 0, 'and the two are told apart by shiftKey');
  ok(/\.toLowerCase\(\)/.test(gateCode), 'the key is lowercased, so both "i" and Shift+"I" work');
  // The guard has to be the CONDITION, not just a variable that happens to
  // exist nearby — "typingIO" appearing in the block proves nothing.
  ok(/if \(!typingIO\)/.test(gateCode), 'typing in a text box is still excluded');
  ok(/'i'\) \? 'in' : 'out'/.test(gateCode), 'I maps to the in point and O to the out point');

  // ── the reset resets BOTH ends (the one-end clears are the other command) ──
  ok(/trimStart = 0;/.test(codeOnly(resetClick)) && /trimEnd = mediaEl\.duration;/.test(codeOnly(resetClick)),
     'the reset still clears both ends — the one-end commands are a different thing');

  // ── one drag implementation ──
  ok(src.indexOf('function dragHandle(') < 0, 'the old mini-bar drag copy is gone');
  ok(src.indexOf('function dragMainHandle(') < 0, 'the old main-bar drag copy is gone');
  const drags = src.split('buildTrimDrag(').length - 1;
  eq(drags, 5, 'one builder plus four handles, all going through it');
  const bd = fnFull('buildTrimDrag', src);
  const bdCode = codeOnly(bd);
  ok(bdCode.indexOf('planTrimMark(') >= 0, 'dragging plans through the same planner as pressing');
  ok(bdCode.indexOf('applyTrimPlan(') >= 0, 'and applies through the same applier');
  ok(bdCode.indexOf('pushUndo()') >= 0, 'a drag is one undo step for the whole gesture');
  ok(bdCode.indexOf('scheduleAutoSave()') >= 0, 'a drag is persisted');
  // The old main-bar copy serialised the board on every mousemove.
  ok(bdCode.indexOf('scheduleAutoSave()') > bdCode.indexOf('onUp'),
     'the autosave is on mouseup, not on every pixel of the drag');

  // The two hand-rolled minimum gaps are gone: dragging and pressing now
  // agree, because both ask the one constant.
  ok(!/te - 0\.1/.test(bdCode), 'no hand-rolled 0.1s gap survives in the drag path');
  ok(!/ts \+ 0\.1/.test(bdCode), 'no hand-rolled 0.1s gap on the other edge either');

  // ── the fix is not a workaround pasted back on top ──
  const th = codeOnly(fnFull('trimHotkey', src));
  ok(th.indexOf('isShrinkOnly') < 0, 'no shrink-only detection: the trap is gone, not documented');
  const svt = codeOnly(fnFull('setupVideoTrim', src));
  ok(svt.indexOf('v.paused') >= 0, 'the playback loop checks whether the clip is playing');
}

// ═══════════════════════════════════════════════════════════════════════
// 7. Version
// ═══════════════════════════════════════════════════════════════════════
{
  ok(src.indexOf("var KRAFTED_VERSION = '7.0.49';") >= 0, 'KRAFTED_VERSION bumped');
  ok(src.indexOf('<title>Krafted v7.0.49</title>') >= 0, 'title bumped');
  ok(sw.indexOf("const CACHE_NAME = 'krafted-v7.0.49-'") >= 0, 'sw CACHE_NAME bumped');
  ok(sw.indexOf("const APP_VERSION = '7.0.49';") >= 0, 'sw APP_VERSION bumped');
}

console.log('');
console.log(fail === 0 ? 'ALL PASS (' + pass + ' assertions)' : 'FAILURES: ' + fail + ' (passed ' + pass + ')');
process.exit(fail === 0 ? 0 : 1);
