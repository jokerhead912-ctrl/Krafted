// v7.25.0 — committing a text annotation must actually LEAVE draw mode.
//
// THE REPORT
//   「我依家喺視頻上面寫咗六七個comment同埋打字之後個視頻就hang住咗用唔到」
//   After typing a handful of comments on a clip, the clip can no longer be
//   played: every click on it spawns another text editor and pauses it.
//
// THE CAUSE (measured, diag_anno_text_hang.js)
//   _commitTextEditor() ended with `setTool('select')` and a comment claiming
//   that auto-exits text mode. setTool() is the BOARD tool — it writes
//   state.tool and never touches the card's own el._annoDrawState. So the card
//   stayed in draw mode and:
//     · CSS .item.has-media.draw-mode .media-anno-canvas { pointer-events:auto }
//       puts the annotation canvas ON TOP of the <video> — it eats the click;
//     · the pointerdown handler is still in text mode → new editor + pause();
//     · .media-wrap::after dims the frame.
//   Measured before the fix, after 7 comments: mode 'text', element at the
//   video centre = CANVAS.media-anno-canvas, a real click spawned editor #8
//   and paused a playing clip. After: mode 'off', 0 editors, click reached it.
//
// Rule 19: an anchor proves the code exists; a unit test proves it RUNS. So
// this suite lifts the auto-exit block and the _exitDrawMode writer straight
// out of kraftpub-dev.html and executes them against spies.

const fs = require('fs');
const path = require('path');

// KRAFTED_HTML lets the mutation harness point us at a deliberately broken
// copy — without it every mutant is tested against the pristine file.
const HTML = fs.readFileSync(
  process.env.KRAFTED_HTML || path.join(__dirname, '..', '..', 'kraftpub-dev.html'),
  'utf8');

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  (got ' + JSON.stringify(extra) + ')' : '')); }
}
function eq(a, b, label) { ok(a === b, label, a); }
function section(n) { console.log('\n' + n); }
function countIn(re, s) { return (s.match(re) || []).length; }

// Rule 20: slice anchors are version-free (no X.Y.Z anywhere in them) — the
// version scanner rides along and rewrites bare version strings in the
// suites of the current release, which would silently empty the slice.
// Rule 22: the suite must FAIL CLEANLY. A missing anchor used to call
// process.exit() mid-file, which printed a hand-made "FAIL 0 passed" and no
// tally — mutlib scored that FRAGILE (real evidence, dead suite) instead of a
// plain catch. So a failed slice is recorded, not thrown: every dependent
// assertion below then reports a normal FAIL and the summary still prints.
let SLICE_ERR = null;
function slice(a, b, label) {
  const i = HTML.indexOf(a), j = HTML.indexOf(b);
  if (i < 0 || j < 0 || j <= i) { SLICE_ERR = label; return ''; }
  const s = HTML.slice(i, j);
  if (s.length < 40) { SLICE_ERR = label + ' (too short)'; return ''; }
  return s;
}

const EXIT_LINE = "if (typeof _exitDrawMode === 'function') _exitDrawMode();";
const BLOCK = slice('      if (!skipExitTextMode) {',
                    '\n    }\n    function _cancelTextEditor() {',
                    'auto-exit block');
const EXIT = slice('    function _exitDrawMode() {',
                   '    function _refreshDrawBtnBadge() {',
                   '_exitDrawMode writer');

// ── S1 the wiring exists, and the lie is gone ─────────────────────────────
section('S1 the wiring (anchor checks)');
ok(SLICE_ERR === null, 'S1z both source slices lifted', SLICE_ERR);
eq(countIn(/function _commitTextEditor\(/g, HTML), 1, 'S1a one _commitTextEditor');
eq(countIn(/function _exitDrawMode\(/g, HTML), 1,
   'S1b one _exitDrawMode (one writer for "leave draw mode")');
eq(countIn(/el\._exitDrawMode = _exitDrawMode;/g, HTML), 1,
   'S1c the writer is exposed on the item once (Esc / clean mode reuse it)');
// The whole bug: the exit call must be in the commit path.
eq(countIn(new RegExp(EXIT_LINE.replace(/[()' ]/g, m => '\\' + m), 'g'), HTML), 1,
   'S1d the commit path calls the exit writer exactly once');
eq(countIn(/Auto-exit text mode after committing/g, HTML), 0,
   'S1e the comment that claimed setTool() exits text mode is gone (病根②: a comment that lies)');
// 病根一: the fix must not add a FOURTH hand-rolled copy of "leave draw mode".
eq(countIn(/mode = 'off'/g, BLOCK), 0,
   'S1f the commit block does not hand-write mode="off" — it calls the writer');
ok(/typeof _exitDrawMode/.test(BLOCK),
   'S1j the call is typeof-guarded (a build without the writer must not brick a commit)');
ok(/_applyDrawMode\(\);/.test(EXIT), 'S1g the writer re-applies draw mode UI');
ok(/el\._annoDrawState\.mode = 'off';/.test(EXIT), 'S1h the writer zeroes the mode');
// and it must be the commit block, not some other one
const iCommit = HTML.indexOf('function _commitTextEditor(');
const iBlock = HTML.indexOf('      if (!skipExitTextMode) {');
const iCancel = HTML.indexOf('    function _cancelTextEditor() {');
ok(iCommit > 0 && iBlock > iCommit && iBlock < iCancel,
   'S1i the auto-exit block sits inside _commitTextEditor, before _cancelTextEditor');

// ── S2 EXECUTE the lifted auto-exit block ─────────────────────────────────
section('S2 the block actually runs');
function runBlock(opts) {
  const log = [];
  const setTool = opts.setTool || function (t) { log.push('setTool:' + t); };
  const exit = opts.exit === undefined
    ? function () { log.push('exit'); }
    : opts.exit;
  try {
    // eslint-disable-next-line no-new-func
    const f = new Function('setTool', '_exitDrawMode', 'skipExitTextMode', BLOCK);
    f(setTool, exit, opts.skip);
  } catch (e) { log.push('THREW:' + e.message); }
  return log;
}

let log = runBlock({ skip: false });
ok(log.indexOf('setTool:select') >= 0, 'S2a committing resets the board tool to select', log);
ok(log.indexOf('exit') >= 0, 'S2b committing calls the exit writer', log);
ok(log.indexOf('THREW') < 0, 'S2c the block does not throw', log);

log = runBlock({ skip: true });
eq(log.length, 0,
   'S2d placing another text (skipExitTextMode) does NOT exit — chaining still works');

// A missing writer must not brick the commit (typeof guard).
log = runBlock({ skip: false, exit: undefined });
ok(log.indexOf('THREW') < 0, 'S2e a missing writer is guarded, not fatal', log);
ok(log.indexOf('setTool:select') >= 0, 'S2f and setTool still runs when the writer is missing', log);

// setTool throwing must not swallow the exit (separate try/catch).
log = runBlock({ skip: false, setTool: function () { throw new Error('board busy'); } });
ok(log.indexOf('THREW') < 0, 'S2g a throwing setTool is contained', log);
ok(log.indexOf('exit') >= 0, 'S2h and the card STILL leaves draw mode (independent try/catch)', log);

// ── S3 EXECUTE the writer itself ──────────────────────────────────────────
section('S3 the writer really leaves draw mode');
function runExit(opts) {
  const el = { _annoDrawState: { mode: opts.startMode || 'text' } };
  let applied = 0;
  const apply = function () { applied++; };
  const ring = opts.ring === undefined ? { style: {} } : opts.ring;
  let threw = null;
  try {
    // eslint-disable-next-line no-new-func
    const f = new Function('el', '_applyDrawMode', 'cursorRing',
                           EXIT + '\nreturn _exitDrawMode;');
    f(el, apply, ring)();
  } catch (e) { threw = e.message; }
  return { mode: el._annoDrawState.mode, applied: applied, ring: ring, threw: threw };
}

let r = runExit({ startMode: 'text' });
ok(r.threw === null, 'S3a the writer runs clean', r.threw);
eq(r.mode, 'off', 'S3b it sets _annoDrawState.mode to off');
eq(r.applied, 1, 'S3c it calls _applyDrawMode exactly once');
eq(r.ring.style.display, 'none', 'S3d it hides the cursor ring');

r = runExit({ startMode: 'pen' });
eq(r.mode, 'off', 'S3e it leaves pen mode too, not just text');

r = runExit({ startMode: 'text', ring: undefined });
ok(r.threw === null, 'S3f a missing cursor ring is guarded (typeof check)', r.threw);
eq(r.mode, 'off', 'S3g and the mode is still cleared');

// ── S4 the CSS that made this bug visible ─────────────────────────────────
// Without these two rules the whole fix would be cosmetic, so they are pinned
// here: the canvas must be inert unless draw mode is on, otherwise it covers
// the <video> and eats every click even when the user is NOT annotating.
section('S4 the overlay is inert outside draw mode');
eq(countIn(/\.item\.has-media\.draw-mode \.media-anno-canvas/g, HTML), 1,
   'S4a one rule gates the annotation canvas on draw-mode');
ok(/\.item\.has-media \.media-anno-canvas \{[^}]*pointer-events: none/s.test(HTML),
   'S4b the canvas is pointer-events:none by default');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
