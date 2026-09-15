// v7.24.0 — the Rotate row: one behaviour, two control surfaces.
//
// The director's real loop is recrop -> rotate -> "not it" -> again, and every
// round used to end with hand-dragging the slider back to 0 because there was
// no reset and no way to type an exact angle. Two controls now write the same
// item.rot, so the classic failure (病根一) is two hand-rolled writers drifting
// apart — which is exactly what the old `prop-rotate-val` span was.
//
// Rule 19: an anchor proves the code exists, a unit test proves it RUNS. So
// this suite lifts syncRotationUI / setRotation / resetRotation out of
// kraftpub-dev.html and executes them against a fake DOM, then checks what
// they actually did to the items and to the controls.

const fs = require('fs');
const path = require('path');

// KRAFTED_HTML lets the mutation harness point us at a deliberately broken
// copy. Without it every mutant is tested against the pristine file and the
// whole mutation run is decoration.
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

// Rule 20: slice anchors are version-free (no X.Y.Z anywhere in them) — the
// version scanner rides along and rewrites bare version strings in the suites
// of the current release, which would silently empty the slice.
function slice(a, b, label) {
  const i = HTML.indexOf(a), j = HTML.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('anchor failed: ' + label);
  const s = HTML.slice(i, j);
  if (s.length < 40) throw new Error('slice too short: ' + label);
  return s;
}
function countIn(re, s) { return (s.match(re) || []).length; }

const HELPERS = slice('function syncRotationUI(deg) {', 'function flipH() {', 'rotation helpers');

// ── S1 the code lifted, and only one of each ──────────────────────────────
section('S1 the code lifted (anchor checks)');
ok(/function syncRotationUI\(/.test(HELPERS), 'S1a syncRotationUI lifted');
ok(/function setRotation\(/.test(HELPERS), 'S1b setRotation lifted');
ok(/function resetRotation\(/.test(HELPERS), 'S1c resetRotation lifted');
eq(countIn(/function syncRotationUI\(/g, HTML), 1,
   'S1d exactly one syncRotationUI in the source (one writer, not two)');
eq(countIn(/function resetRotation\(/g, HTML), 1, 'S1e exactly one resetRotation');
eq(countIn(/prop-rotate-val/g, HTML), 0,
   'S1f the old rotate value span is gone — two displays of one number drift');
eq(countIn(/id="prop-rotate-num"/g, HTML), 1, 'S1g the typed box exists exactly once');
eq(countIn(/id="btn-reset-rot"/g, HTML), 1, 'S1h the reset button exists exactly once');
eq(countIn(/onchange="setRotation\(this\.value\)"/g, HTML), 1,
   'S1i the typed box is wired to setRotation');
eq(countIn(/onclick="resetRotation\(\)"/g, HTML), 1, 'S1j the reset button is wired');
eq(countIn(/syncRotationUI\(state\.dragging\.item\.rot\)/g, HTML), 1,
   'S1k the rotate-handle drag end syncs the panel (the handle writes rot directly)');
eq(countIn(/syncRotationUI\(item\.rot\)/g, HTML), 1, 'S1l updatePropsPanel syncs from the item');

// ── the fake browser ──────────────────────────────────────────────────────
function makeSandbox(items, opts) {
  opts = opts || {};
  const els = opts.noEls ? {} : {
    'prop-rotate': { value: 'unset' },
    'prop-rotate-num': { value: 'unset' },
  };
  let active = null;
  const document = {
    getElementById: function (id) { return els[id] || null; }
  };
  Object.defineProperty(document, 'activeElement', { get: function () { return active; } });

  const undo = [], styled = [], saved = [], timers = [];
  const api = new Function(
    'document', 'getSelectedItems', 'updateItemStyle', 'pushUndo', 'scheduleAutoSave',
    'setTimeout', 'clearTimeout',
    HELPERS + '\nreturn { syncRotationUI: syncRotationUI, setRotation: setRotation, resetRotation: resetRotation };'
  )(
    document,
    function () { return items || []; },
    function (i) { styled.push(i.id); },
    function () { undo.push(1); },
    function () { saved.push(1); },
    function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; },
    function () {}
  );
  return {
    api: api, els: els, undo: undo, styled: styled, saved: saved, timers: timers,
    focus: function (el) { active = el; },
    fireTimers: function () { timers.forEach(t => { try { t.fn(); } catch (e) {} }); timers.length = 0; }
  };
}

// ── S2 syncRotationUI runs ────────────────────────────────────────────────
section('S2 syncRotationUI (executed)');
{
  const sb = makeSandbox([]);
  sb.api.syncRotationUI(12.34);
  eq(sb.els['prop-rotate'].value, 12.34, 'S2a the slider is written');
  eq(sb.els['prop-rotate-num'].value, 12.3, 'S2b the typed box is written, rounded to 0.1');
  sb.api.syncRotationUI(-7);
  eq(sb.els['prop-rotate-num'].value, -7, 'S2c a negative angle round-trips');
  // The guard: `change` fires while the typed box still has focus. Overwriting
  // it there fights the caret and eats the value the user just typed.
  sb.focus(sb.els['prop-rotate-num']);
  sb.els['prop-rotate-num'].value = '999';
  sb.api.syncRotationUI(45);
  eq(sb.els['prop-rotate-num'].value, '999', 'S2d the box being typed in is left alone');
  eq(sb.els['prop-rotate'].value, 45, 'S2e ...while the slider still updates');
}
{
  const sb = makeSandbox([], { noEls: true });
  let threw = false;
  try { sb.api.syncRotationUI(90); } catch (e) { threw = true; }
  ok(!threw, 'S2f a missing control does not throw (the panel is optional)');
}

// ── S3 setRotation runs ───────────────────────────────────────────────────
section('S3 setRotation (executed)');
{
  const items = [{ id: 'a', rot: 0 }, { id: 'b', rot: 10 }];
  const sb = makeSandbox(items);
  sb.api.setRotation('45');
  eq(items[0].rot, 45, 'S3a a string from the control is parsed, not concatenated');
  eq(items[1].rot, 45, 'S3b every selected item is rotated');
  eq(sb.styled.join(','), 'a,b', 'S3c every rotated item is restyled');
  eq(sb.undo.length, 1, 'S3d one undo step is pushed');
  eq(sb.els['prop-rotate'].value, 45, 'S3e the slider follows');
  eq(sb.els['prop-rotate-num'].value, 45, 'S3f the typed box follows');
  eq(sb.saved.length, 1, 'S3g autosave is scheduled');

  sb.api.setRotation(90);
  eq(sb.undo.length, 1, 'S3h dragging is ONE undo step, not one per pointer sample');

  sb.fireTimers();
  sb.api.setRotation(120);
  eq(sb.undo.length, 2, 'S3i after the quiet period a new gesture gets its own undo step');

  sb.api.setRotation('abc');
  eq(items[0].rot, 120, 'S3j garbage input does not move the item (NaN guard)');
  sb.api.setRotation('');
  eq(items[0].rot, 120, 'S3k an empty box does not move the item either');

  sb.fireTimers();
  sb.api.setRotation(0);
  eq(items[0].rot, 0, 'S3l 0 is a real angle, not a falsy accident');
}
{
  const sb = makeSandbox([]);
  let threw = false;
  try { sb.api.setRotation(30); } catch (e) { threw = true; }
  ok(!threw, 'S3m an empty selection does not throw');
  eq(sb.undo.length, 0, 'S3n ...and pushes no undo step');
}

// ── S4 resetRotation runs ─────────────────────────────────────────────────
section('S4 resetRotation (executed)');
{
  const items = [{ id: 'a', rot: 33 }, { id: 'b', rot: -12 }];
  const sb = makeSandbox(items);
  sb.api.resetRotation();
  eq(items[0].rot, 0, 'S4a the first item is back to 0');
  eq(items[1].rot, 0, 'S4b the whole selection is back to 0');
  eq(sb.undo.length, 1, 'S4c the reset is undoable');
  eq(sb.styled.join(','), 'a,b', 'S4d every reset item is restyled');
  eq(sb.els['prop-rotate'].value, 0, 'S4e the slider shows 0');
  eq(sb.els['prop-rotate-num'].value, 0, 'S4f the typed box shows 0');
  eq(sb.saved.length, 1, 'S4g autosave is scheduled');
}
{
  const sb = makeSandbox([]);
  let threw = false;
  try { sb.api.resetRotation(); } catch (e) { threw = true; }
  ok(!threw, 'S4h an empty selection does not throw');
  eq(sb.undo.length, 0, 'S4i ...and pushes no undo step');
}

// ── S5 the row is one row ─────────────────────────────────────────────────
section('S5 the markup (structural)');
{
  const iSlider = HTML.indexOf('id="prop-rotate"');
  const iNum = HTML.indexOf('id="prop-rotate-num"');
  const iBtn = HTML.indexOf('id="btn-reset-rot"');
  ok(iSlider >= 0 && iNum > iSlider && iBtn > iNum, 'S5a slider, typed box, reset — in that order');
  ok(iBtn - iSlider < 900, 'S5b all three sit in the same Rotate row', iBtn - iSlider);
  ok(/&#8634;/.test(HTML), 'S5c the reset glyph is an entity, not a raw non-ASCII byte');
  ok(/type="number" id="prop-rotate-num"/.test(HTML),
     'S5f the typed box is a number input (arrow keys, numeric keypad, no text)');
  // The handle-drag branch must do BOTH: restyle the item and tell the panel.
  const blk = HTML.slice(HTML.indexOf("state.dragging.type === 'rotate' && state.dragging.item"));
  ok(/updateItemStyle\(state\.dragging\.item\)/.test(blk.slice(0, 400)),
     'S5d the drag-end block still restyles the item');
  ok(/syncRotationUI\(state\.dragging\.item\.rot\)/.test(blk.slice(0, 400)),
     'S5e ...and now also syncs the Rotate controls');
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES: ' + fail) + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
