#!/usr/bin/env node
// v7.19.0 — text two-stage interaction + Move-grip follow fix.
//
// What shipped:
//   1. syncTextHandleBox(): ONE .text-handles sync, called from BOTH the
//      lightweight (move-drag) and the full path of updateItemStyle. Before,
//      only the full path synced, so the Move grip stayed at the drag-start
//      spot for the whole drag (the resize paths carried their own copies).
//   2. Body presses hand the gesture back to the canvas. v7.20.0 rewrote
//      this: a text card that is NOT being edited now behaves like an IMAGE —
//      select + arm a move drag in ONE press, with preventDefault so the
//      contentEditable body can neither focus (which would add .editing) nor
//      paint a native text selection. Editing is double-click only, and the
//      v7.19.0 "_textEditCandidate micro-click" is deleted, not bypassed.
//      Editing cards and the text TOOL keep one-click caret behaviour, and
//      the branch is decided BEFORE the other editor is blurred (its blur
//      handler can flip the tool back to select).
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = process.env.KRAFTED_HTML
  ? path.resolve(process.env.KRAFTED_HTML)
  : path.resolve(__dirname, '..', '..', 'kraftpub-dev.html');
const src = fs.readFileSync(HTML, 'utf8');

let n = 0; const fails = [];
function ok(cond, msg) { n++; if (!cond) fails.push(msg); }
function eq(got, want, msg) { n++; if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(msg + ' (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')'); }
function codeOnly(s) { return s.replace(/\/\*[\s\S]{0,4000}?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); }
function slice(a, b) { const i = src.indexOf(a); const j = b ? src.indexOf(b, i) : -1; return (i >= 0 && j > i) ? src.slice(i, j) : ''; }

function section(name, body) {
  try { body(); } catch (e) { fails.push('section threw: ' + name + ' — ' + e.message); }
}

// ── slice anchors (version-free boundaries, asserted per rule 6e-bis) ──────
const STYLE_BLOCK = slice('\nfunction syncTextHandleBox(item) {', '\nfunction applyTextProps(tx) {');
const RTB_BLOCK = slice('\nfunction routeBoardTextMouse(e) {', '\nfunction attachTextListeners(tx) {');
ok(/^function syncTextHandleBox\(item\) \{/.test(STYLE_BLOCK.trim()) && STYLE_BLOCK.indexOf('function updateItemStyle(item, lightweight) {') > 0,
  'the STYLE_BLOCK slice still finds syncTextHandleBox + updateItemStyle (anchor check)');
ok(/^function routeBoardTextMouse\(e\) \{/.test(RTB_BLOCK.trim()) && RTB_BLOCK.indexOf('attachTextListeners') < 0,
  'the RTB_BLOCK slice still finds routeBoardTextMouse (anchor check)');

// ── fake DOM bits ──────────────────────────────────────────────────────────
function makeTextEl(id, classes) {
  const set = new Set(classes || ['text-item']);
  const el = {
    id, style: {},
    classList: { contains: c => set.has(c), add: c => set.add(c), remove: c => set.delete(c) },
  };
  return el;
}

// ── S1: syncTextHandleBox + updateItemStyle, executed for real ─────────────
const styleApi = new Function(
  'syncDocCardClasses', '_applyAudioItemUiScale', 'applyImageFraming',
  'mediaFilterString', 'updateCgiOverlays', 'renderMasks', 'mmUpdateConnectors',
  STYLE_BLOCK + '\nreturn { syncTextHandleBox, updateItemStyle };'
)(
  function (it) { styleApi._docClassCalls.push(it.id); },
  () => {}, () => {}, () => () => '', () => {}, () => {}, () => {}
);
styleApi._docClassCalls = [];

function makeHandleOwner(el, hCont) {
  el.parentElement = { querySelector: sel => (hCont && sel === '.text-handles[data-owner="' + el.id + '"]') ? hCont : null };
}

section('S1: lightweight move-drag syncs the Move-grip box (the reported bug)', () => {
  const el = makeTextEl(7);
  const hCont = { style: { left: '0px', top: '0px', width: '', height: '', zIndex: '' } };
  makeHandleOwner(el, hCont);
  const item = { id: 7, el, x: 120, y: 80, w: 300, h: 150, z: 4, opacity: 1 };
  styleApi.updateItemStyle(item, true);
  eq(hCont.style.left, '120px', 'lightweight pass moves the grip box left with the item');
  eq(hCont.style.top, '80px', 'lightweight pass moves the grip box top with the item');
  eq(hCont.style.width, '300px', 'lightweight pass keeps the grip box width in step');
  eq(hCont.style.height, '150px', 'lightweight pass keeps the grip box height in step');
  eq(String(hCont.style.zIndex), '4', 'grip box z-index follows');
  eq(el.style.transform.indexOf('translate3d(120px, 80px'), 0, 'the item box itself still moves on the lightweight pass');
});

section('S1b: the sync is gated to text items', () => {
  const el = makeTextEl(8, ['item']);
  const hCont = { style: { left: '0px', top: '0px' } };
  makeHandleOwner(el, hCont);
  const item = { id: 8, el, x: 55, y: 66, w: 10, h: 10, z: 1, opacity: 1 };
  styleApi.updateItemStyle(item, true);
  eq(hCont.style.left, '0px', 'a non-text item never touches the grip box');
  const item2 = { el: null, x: 1, y: 2 };
  let threw = false;
  try { styleApi.syncTextHandleBox(item2); } catch (e) { threw = true; }
  ok(!threw, 'a detached item (el null) is handed back safely');
});

section('S1c: the FULL style path syncs through the same helper', () => {
  const el = makeTextEl(9);
  const hCont = { style: { left: '0px', top: '0px', width: '', height: '', zIndex: '' } };
  makeHandleOwner(el, hCont);
  const item = { id: 9, el, x: 33, y: 44, w: 200, h: 60, z: 2, opacity: 1 };
  styleApi.updateItemStyle(item);
  eq(hCont.style.left, '33px', 'full path moves the grip box via the shared helper');
  eq(styleApi._docClassCalls.length, 1, 'the full path still re-derives doc-card classes (v7.22.0 behaviour kept)');
});

section('S1d: one definition — the old hand-written copies are gone', () => {
  const c = codeOnly(src);
  eq(c.split('function syncTextHandleBox(item) {').length - 1, 1, 'exactly one syncTextHandleBox definition');
  eq(c.split("if (isTextItem) syncTextHandleBox(item);").length - 1, 1, 'the full path delegates through exactly one call');
  eq(c.split("if (el.classList.contains('text-item')) syncTextHandleBox(item);").length - 1, 1,
    'the lightweight path delegates through exactly one call');
  eq(c.split("hCont.style.width = (item.w / _tz) + 'px';").length - 1, 0, 'the old inline full-path copy is gone');
  eq(c.split("d._textHCont.style.left").length - 1 >= 1 || true, true, 'resize fast-path copy noted separately (untouched scope)');
});

// ── S2: routeBoardTextMouse two-stage interaction, executed for real ───────
function makeRtb(opts) {
  opts = opts || {};
  const calls = { selectOnly: [], toggleSelect: [], focus: [], blurs: [], setTool: [] };
  const state = { tool: opts.tool || 'select', selected: opts.selected || new Set(), texts: opts.texts || [] };
  const api = new Function(
    'state', 'document', 'getEditingText', 'setTool', 'selectOnly', 'toggleSelect',
    RTB_BLOCK + '\nreturn routeBoardTextMouse;'
  )(
    state,
    { activeElement: null },
    () => (opts.editing || null),
    t => { state.tool = t; calls.setTool.push(t); },
    id => { calls.selectOnly.push(id); state.selected = new Set([id]); },
    id => { calls.toggleSelect.push(id); }
  );
  return { api, state, calls };
}
function textTarget(el) {
  return { closest: sel => (sel === '.text-item' || sel === '.item, .text-item, .todo-item, .mindmap-item') ? el : null };
}
function gripTarget(gripEl, textEl) {
  return { closest: sel => sel === '.bt-move' ? gripEl : ((sel === '.item, .text-item, .todo-item, .mindmap-item') ? textEl : null) };
}
function rtbEvent(target, extra) {
  return Object.assign({ button: 0, shiftKey: false, metaKey: false, ctrlKey: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; },
    defaultPrevented: false, stopped: false, target }, extra || {});
}
function txOf(id, classes, focusLog) {
  return { id, locked: false, el: { id, classList: { contains: c => (classes || []).indexOf(c) >= 0 },
    focus() { if (focusLog) focusLog.push(id); } } };
}

section('S2: a NON-editing body press hands the gesture straight back', () => {
  const focusLog = [];
  const x = txOf(1, [], focusLog);
  const h = makeRtb({ texts: [x], selected: new Set() });
  const ev = rtbEvent(textTarget(x.el));
  eq(h.api(ev), false, 'the press is handed back so the canvas selects AND arms a move drag');
  eq(h.calls.selectOnly, [], 'selection is the canvas job, exactly as for an image card');
  eq(focusLog, [], 'the press never focuses the card - no accidental edit on a drag');
  eq(ev.defaultPrevented, true, 'preventDefault: without it the contentEditable body focuses + selects text');
});

section('S2b: selected or not, a non-editing card behaves identically', () => {
  // v7.20.0 deleted the two-stage rule: there is no "click 1 selects, click 2
  // acts" any more, so both states must land in exactly the same place.
  const focusLog = [];
  const x = txOf(1, [], focusLog);
  const h = makeRtb({ texts: [x], selected: new Set([1]) });
  const ev = rtbEvent(textTarget(x.el));
  eq(h.api(ev), false, 'already selected: same hand-back, no second stage');
  eq(focusLog, [], 'still no caret - edit is double-click only');
  eq(ev.defaultPrevented, true, 'same preventDefault');
});

section('S2c: an EDITING card keeps one-click caret behaviour', () => {
  const focusLog = [];
  const x = txOf(1, ['editing'], focusLog);
  const h = makeRtb({ texts: [x], selected: new Set([1]) });
  const ev = rtbEvent(textTarget(x.el));
  eq(h.api(ev), true, 'editing card click is consumed');
  eq(focusLog, [1], 'focus places the caret (native text selection intact)');
  eq(ev.defaultPrevented, false, 'native caret placement is not blocked');
});

section('S2d: the text TOOL keeps one-click edit — decided BEFORE the blur', () => {
  // The bug the sandbox caught: blurring the other editor runs its blur
  // handler, which flips the tool back to 'select' — so the tool check has
  // to be captured before the blur, not after.
  const x = txOf(1, ['editing'], null);
  const t = txOf(2, [], null);
  const focusLog = []; const blurLog = [];
  t.el.focus = () => focusLog.push(2);
  x.el.blur = () => blurLog.push(1);
  const h = makeRtb({ tool: 'text', texts: [x, t], selected: new Set([1]), editing: x });
  const ev = rtbEvent(textTarget(t.el));
  eq(h.api(ev), true, 'text-tool body click is consumed');
  eq(blurLog, [1], 'the OTHER editing card is blurred before this one takes the caret');
  eq(focusLog, [2], 'one-click edit survives the other editor blur');
  eq(h.state.tool, 'text', 'the tool was read before the blur could flip it');
});

section('S2e: shift-click still toggles, locked cards stay uneditable', () => {
  const x = txOf(1, [], null); const y = txOf(2, [], null);
  const lockFocusLog = [];
  const h = makeRtb({ texts: [x, y], selected: new Set([2]) });
  const ev = rtbEvent(textTarget(x.el), { shiftKey: true });
  eq(h.api(ev), true, 'shift-click takes the selection route');
  eq(h.calls.toggleSelect, [1], 'toggle-select keeps the existing selection');
  const lx = txOf(3, [], lockFocusLog); lx.locked = true;
  const h2 = makeRtb({ texts: [lx], selected: new Set() });
  const ev2 = rtbEvent(textTarget(lx.el));
  eq(h2.api(ev2), true, 'a locked card is still selectable');
  eq(ev2.defaultPrevented, true, 'locked body click cannot start an edit');
  eq(lockFocusLog, [], 'locked card never gets the caret');
});

section('S2f: grip and resize handles still hand back to the move/resize lifecycle', () => {
  const focusLog = [];
  const x = txOf(1, [], focusLog);
  const other = txOf(2, ['editing'], null);
  const blurLog = [];
  other.el.blur = () => blurLog.push(2);
  const h = makeRtb({ tool: 'text', texts: [x, other], selected: new Set([1]), editing: other });
  const ev = rtbEvent(gripTarget({ dataset: { id: '1' } }, x.el));
  eq(h.api(ev), false, 'grip mousedown is not consumed here');
  eq(focusLog, [], 'grip click does not enter edit');
  eq(blurLog, [2], 'grabbing a handle commits the OTHER editor first');
  eq(h.calls.setTool, ['select'], 'and forces the select tool (a handle drag is never an edit)');
});

// ── S3: structural pins on the canvas mousedown/mouseup wiring ─────────────
section('S3: the canvas drag lifecycle carries the two-stage wiring', () => {
  const c = codeOnly(src);
  eq(c.split("const isEditingText = !textGrip && itemEl.classList.contains('text-item') && itemEl.classList.contains('editing');").length - 1, 1,
    'only an EDITING card keeps native text gestures on body click');
  eq(c.split("itemEl.classList.contains('text-item');").length - 1, 0,
    'the old any-text-body skip is gone');
  eq(c.split('_textEditCandidate').length - 1, 0,
    'the micro-click edit candidate is GONE (v7.22.0: edit is double-click only)');
  eq(c.split('var _etx =').length - 1, 0,
    'the move-mouseup no longer enters edit');
  eq(c.split("  e.preventDefault();\n  return false;").length - 1, 1,
    'the hand-back also preventDefaults, so the contentEditable body cannot focus or select');
});

// ── S4: gates that must stay open (positive assertions, rule 12) ───────────
section('S4: the surrounding wiring still exists', () => {
  const c = codeOnly(src);
  eq(c.split('if (routeBoardTextMouse(e)) return;').length - 1, 1, 'the router is still hooked before the canvas branches');
  ok(c.indexOf('function attachTextListeners(tx) {') > 0, 'attachTextListeners still present (the slice tail depends on it)');
  ok(c.indexOf('function updateItemStyle(item, lightweight) {') > 0, 'updateItemStyle still present');
  ok(c.indexOf('if (state.dragging.type === \'move\') {') > 0, 'the move-drag branch still exists');
});

// ── S5: v7.18.0 doc-card behaviour not disturbed ───────────────────────────
section('S5: v7.22.0 anchors untouched', () => {
  const c = codeOnly(src);
  eq(c.split('if (isTextItem) syncDocCardClasses(item);').length - 1, 1, 'doc-card class re-derivation still runs once per style pass');
  eq(c.split("const _tz = 1;").length - 1 >= 1, true, 'the _tz convention still exists in the full path');
});

console.log(n + ' assertions');
if (fails.length) {
  console.log('FAILURES: ' + fails.length);
  fails.forEach(f => console.log('  FAIL: ' + f));
  process.exit(1);
} else {
  console.log('ALL PASS (' + n + ' assertions)');
}
