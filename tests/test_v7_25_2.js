// v7.25.2 — the draw-toolbar follow loop stops when the card is gone.
//
// buildMediaControls() started `_tbFollowLoop()` with no matching
// cancelAnimationFrame anywhere in the file: a 60 Hz callback per media card,
// for the life of the page. Measured with the existing probe
// (Krafted/tests/diag_perf_video_v7_23_0.js, real Chrome, 12 video cards):
//     719 rAF registrations/sec while the cards were alive  (~12 loops)
//     360/sec AFTER all 12 were deleted                     (~6 zombie loops)
// The frame rate never moved (60 fps, 0 frames over 32 ms), so this was never
// a compute problem — the callback closes over the whole buildMediaControls
// scope, so a deleted card's <video> and blob could not be released.
//
// Rule 19: an anchor proves the code exists, a unit test proves it RUNS. So
// the loop is lifted out of the source and driven with a fake requestAnimation
// Frame that counts how many times it re-registers, and the count is what the
// suite asserts — not the presence of a line.

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
function countIn(re, s) { return (s.match(re) || []).length; }

// Rule 20 (no version strings in slice anchors) + rule 21 (the start anchor
// must belong to the function under test, and the slice must not silently
// widen): `let _tbRafId = 0;` immediately followed by the signature is unique.
function slice(a, b, label) {
  const i = HTML.indexOf(a), j = HTML.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('anchor failed: ' + label);
  const s = HTML.slice(i, j);
  if (s.length < 40) throw new Error('slice too short: ' + label);
  if (s.length > 4000) throw new Error('slice suspiciously wide: ' + label);
  return s;
}
const LOOP = slice('    let _tbRafId = 0;\n    function _tbFollowLoop() {',
                   '    // ── helpers used by the toolbar above ──',
                   'the follow loop');

// ── the fake browser ──────────────────────────────────────────────────────
// The frame pump is the whole point: the question is not what the loop does,
// it is HOW MANY TIMES IT COMES BACK. So rAF is a queue we drive by hand.
function makeSandbox(toolbar) {
  const queue = [];
  let registered = 0, cancelled = 0, lastId = 0;
  const positioned = [];
  const el = { _annoDrawState: null };
  const api = new Function(
    'annoToolbar', 'el', 'requestAnimationFrame', 'cancelAnimationFrame', '_positionToolbar',
    LOOP + '\nreturn { start: function () {}, loop: _tbFollowLoop, id: function () { return _tbRafId; } };'
  )(
    toolbar, el,
    function (fn) { registered++; lastId = registered; queue.push({ id: lastId, fn: fn }); return lastId; },
    function (id) { cancelled++; },
    function () { positioned.push(1); }
  );
  return {
    api: api, el: el,
    registered: function () { return registered; },
    cancelled: function () { return cancelled; },
    positioned: positioned,
    frame: function () {           // run exactly one queued callback
      const job = queue.shift();
      if (!job) return false;
      job.fn();
      return true;
    },
    pending: function () { return queue.length; }
  };
}
function toolbarLike(connected) {
  return { style: { display: 'block' }, isConnected: connected };
}

// ── S1 the code ───────────────────────────────────────────────────────────
block('S1 the code lifted (anchor checks)', function () {
  eq(countIn(/function _tbFollowLoop\(/g, HTML), 1, 'S1a exactly one follow loop');
  eq(countIn(/requestAnimationFrame\(_tbFollowLoop\)/g, HTML), 2,
     'S1b it is started once and re-armed once — no third copy');
  ok(HTML.indexOf("if (!annoToolbar || !annoToolbar.isConnected) { _tbRafId = 0; return; }") >= 0,
     'S1c the loop releases itself when the toolbar leaves the DOM');
  ok(countIn(/cancelAnimationFrame\(_tbRafId\)/g, HTML) === 0,
     'S1d no cancelAnimationFrame(_tbRafId) is needed at any teardown site — '
     + 'the single rule inside the loop covers deleteSelected, cleanupAllItems and restoreSnapshot');
  ok(HTML.indexOf('el.appendChild(annoToolbar);') >= 0,
     'S1e the toolbar really is a child of the item, so isConnected tracks the card');
});

// ── S2 alive: it keeps following ──────────────────────────────────────────
block('S2 while the card is on screen the loop keeps working (executed)', function () {
  const tb = toolbarLike(true);
  const sb = makeSandbox(tb);
  // The lifted code ends with the line that STARTS the loop, so building the
  // sandbox has already armed one frame. Everything below is measured against
  // that baseline — the number that matters is the delta per frame.
  eq(sb.registered(), 1, 'S2a building the card arms exactly one frame');
  eq(sb.pending(), 1, 'S2b ...and one callback is waiting');
  sb.frame();
  eq(sb.registered(), 2, 'S2c the first frame re-arms the next one');
  eq(sb.positioned.length, 1, 'S2d ...and it repositioned the toolbar');
  for (let i = 0; i < 9; i++) sb.frame();
  eq(sb.registered(), 11, 'S2e ten frames = one re-arm each (the loop is alive)');
  eq(sb.positioned.length, 10, 'S2f ...and one reposition each');
  eq(sb.pending(), 1, 'S2g still exactly one callback queued — a loop, not a fan-out');
});

// ── S3 gone: it stops ─────────────────────────────────────────────────────
block('S3 once the card leaves the DOM the loop stops (executed)', function () {
  const tb = toolbarLike(true);
  const sb = makeSandbox(tb);
  for (let i = 0; i < 5; i++) sb.frame();
  const before = sb.registered();
  eq(before, 6, 'S3a five frames ran (plus the one armed at build time)');

  tb.isConnected = false;              // the card is deleted
  sb.frame();
  eq(sb.registered(), before,
     'S3b the detached card does NOT arm another frame — this is the leak');
  eq(sb.api.id(), 0, 'S3c ...and the handle is cleared, so nothing holds the closure');
  eq(sb.pending(), 0, 'S3d the queue is empty: the loop is dead, not sleeping');

  // A dead loop cannot be resurrected by another frame arriving.
  for (let i = 0; i < 5; i++) sb.frame();
  eq(sb.registered(), before, 'S3e five more frames, still nothing registered');
});

// ── S4 no toolbar at all ──────────────────────────────────────────────────
block('S4 a missing toolbar does not throw or spin (executed)', function () {
  const sb = makeSandbox(null);
  let threw = false;
  try { for (let i = 0; i < 3; i++) sb.frame(); } catch (e) { threw = true; }
  ok(!threw, 'S4a no toolbar is survivable');
  eq(sb.registered(), 1, 'S4b the start line armed one frame and nothing more');
  eq(sb.pending(), 0, 'S4c ...which died on its first tick');
  eq(sb.api.id(), 0, 'S4d ...and the handle stays clear');
});

// ── S5 hidden toolbar: keep polling, skip the work ────────────────────────
block('S5 a hidden toolbar keeps polling but does no work (executed)', function () {
  const tb = toolbarLike(true);
  const sb = makeSandbox(tb);
  tb.style.display = 'none';
  for (let i = 0; i < 4; i++) sb.frame();
  eq(sb.registered(), 5, 'S5a a hidden toolbar still polls (it must resume when shown)');
  eq(sb.positioned.length, 0, 'S5b ...but it does not reposition while hidden');
  tb.style.display = 'block';
  sb.frame();
  eq(sb.positioned.length, 1, 'S5c ...and it resumes the moment it is shown again');
});

// ── S6 a dragged toolbar is left where the user put it ────────────────────
block('S6 a custom toolbar position is not overwritten (executed)', function () {
  const tb = toolbarLike(true);
  const sb = makeSandbox(tb);
  sb.el._annoDrawState = { toolbarPos: { x: 10, y: 20 } };
  sb.frame();
  eq(sb.registered(), 2, 'S6a the loop still runs');
  eq(sb.positioned.length, 0, 'S6b ...but it leaves the dragged position alone');
});

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES: ' + fail) + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
