#!/usr/bin/env node
// v7.20.0 — a board text card behaves like an IMAGE card.
//
// What shipped:
//   1. A body press on a text card that is NOT being edited hands straight
//      back to the canvas (select + arm a move drag in ONE gesture) and calls
//      preventDefault. The body is contentEditable even when it is not being
//      edited, so without preventDefault the press FOCUSES the card (the
//      focus listener adds .editing) and a drag paints a native text
//      selection. Machine-verified in Chrome: preventDefault on mousedown
//      suppresses focus + text selection, and dblclick still fires.
//   2. Editing is DOUBLE-CLICK only. The v7.19.0 3px micro-click edit
//      (_textEditCandidate) is deleted, not disabled.
//   3. Text cards get 4 CORNER handles, so a corner drag scales the card like
//      an image: aspect-locked, with the font scaling through the single
//      definition scaleBoardTextFontSize().
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
const FONT_BLOCK = slice('\nfunction applyTextProps(tx) {', '\n// ==== media-player.js ====');
const ATH_BLOCK = slice('\nfunction addTextHandles(tx, moveOnly) {', '\nfunction initVideoLazyLoad() {');
ok(/^function applyTextProps\(tx\) \{/.test(FONT_BLOCK.trim()) && FONT_BLOCK.indexOf('function scaleBoardTextFontSize(') > 0,
  'the FONT_BLOCK slice still finds applyTextProps + scaleBoardTextFontSize (anchor check)');
ok(/^function addTextHandles\(tx, moveOnly\) \{/.test(ATH_BLOCK.trim()) && ATH_BLOCK.indexOf('initVideoLazyLoad') < 0,
  'the ATH_BLOCK slice still finds addTextHandles (anchor check)');

// ── S1: scaleBoardTextFontSize, executed for real ──────────────────────────
// A mutation that renames or deletes the function under test used to throw
// here, at module top level, BEFORE the tally at the bottom of the file - the
// suite died without ever printing a number, and the judge scored it UNPROVEN
// (a hole) instead of caught. Catch it and let the sections report instead.
let fontApi = null;
try { fontApi = new Function(FONT_BLOCK + '\nreturn { applyTextProps, scaleBoardTextFontSize };')(); }
catch (e) { fails.push('FONT_BLOCK did not compile: ' + e.message); }

section('S1: the font scales from the ORIGINAL size, never compounds', () => {
  const tx = { size: 20, el: { style: {} } };
  fontApi.scaleBoardTextFontSize(tx, 20, 2);
  eq(tx.size, 40, 'a 2x box gives a 2x font');
  eq(tx.el.style.fontSize, '40px', 'and the DOM is repainted through the one applyTextProps definition');
  fontApi.scaleBoardTextFontSize(tx, 20, 1);
  eq(tx.size, 20, 'back to 1x lands on the EXACT start size (proves no per-frame compounding)');
  fontApi.scaleBoardTextFontSize(tx, 20, 0.5);
  eq(tx.size, 10, 'shrinking works too');
  fontApi.scaleBoardTextFontSize(tx, 20, 0.0001);
  eq(tx.size, 4, 'clamped to a 4px floor so the text can never vanish');
  fontApi.scaleBoardTextFontSize(tx, 20, 9999);
  eq(tx.size, 800, 'clamped to an 800px ceiling so the card cannot swallow the board');
  fontApi.scaleBoardTextFontSize(tx, 20, 0);
  eq(tx.size, 800, 'a zero / negative scale is ignored, not written');
  fontApi.scaleBoardTextFontSize(tx, 20, NaN);
  eq(tx.size, 800, 'a NaN scale is ignored');
  fontApi.scaleBoardTextFontSize(tx, undefined, 2);
  eq(tx.size, 800, 'a missing base size is ignored');
  fontApi.scaleBoardTextFontSize(tx, 20, 1);
  eq(tx.size, 20, 'and a real scale still works after the junk calls');
});

section('S1b: a detached card is handed back safely', () => {
  const det = { size: 12 };
  let threw = false;
  try { fontApi.scaleBoardTextFontSize(det, 12, 2); } catch (e) { threw = true; }
  ok(!threw, 'no el: the helper must not crash calling applyTextProps');
  eq(det.size, 24, 'and the size still scales');
});

// ── S2: addTextHandles builds the corner handles, executed for real ────────
function mkEl() {
  const e = {
    className: '', dataset: {}, style: {}, children: [], title: '', textContent: '', type: '',
    classList: { contains(c) { return String(e.className).split(' ').indexOf(c) >= 0; } },
    appendChild(c) { e.children.push(c); c.parentElement = e; return c; },
    replaceChildren() { e.children.length = 0; return e; },
    setAttribute() {},
    querySelector(sel) {
      const m = /data-owner="(\d+)"/.exec(sel);
      if (!m) return null;
      return e.children.find(c => c.className === 'text-handles' && String(c.dataset.owner) === m[1]) || null;
    },
  };
  return e;
}
let athApi = null;
try {
  athApi = new Function('boardTextLabel', 'state', 'document',
    ATH_BLOCK + '\nreturn addTextHandles;')(
    en => en, { zoom: 1 }, { createElement: () => mkEl() });
} catch (e) { fails.push('ATH_BLOCK did not compile: ' + e.message); }

function buildHandles(id, moveOnly) {
  const parent = mkEl();
  const txEl = mkEl(); txEl.className = 'text-item';
  parent.appendChild(txEl);
  const tx = { id, x: 10, y: 20, w: 300, h: 120, z: 1, rot: 0, el: txEl };
  athApi(tx, moveOnly);
  return parent.children.find(c => c.className === 'text-handles');
}
const isHandle = c => /(^| )item-handle( |$)/.test(c.className);

section('S2: a text card gets corner handles, so it scales like an image', () => {
  const box = buildHandles(5);
  ok(!!box, 'a .text-handles sibling container is created');
  const all = box.children.filter(isHandle);
  eq(all.map(h => h.dataset.dir).sort(), ['e', 'ne', 'nw', 'se', 'sw', 'w'],
    '6 resize handles: the 4 new corners plus the original e/w width pair');
  const corners = all.filter(h => h.dataset.dir.length === 2);
  eq(corners.map(h => h.dataset.dir).sort(), ['ne', 'nw', 'se', 'sw'], 'the corners are nw ne sw se');
  eq(corners.every(h => h.dataset.textHandle === '1'), true,
    'every corner carries the text-handle marker, so routeBoardTextMouse sends it to the resize lifecycle');
  eq(corners.every(h => String(h.dataset.id) === '5'), true, 'each corner points back at the card id');
  eq(all.filter(h => h.dataset.dir.length === 1).map(h => h.dataset.dir).sort(), ['e', 'w'],
    'the width-only e/w handles are untouched (box resize, font untouched)');
  eq(box.children.filter(c => c.className === 'bt-move').length, 1, 'the Move grip survives as a fallback');
});

section('S2b: moveOnly (multi-select) still gets the grip and nothing else', () => {
  const box = buildHandles(6, true);
  eq(box.children.filter(isHandle).length, 0, 'a multi-selected card shows no per-card resize handles');
  eq(box.children.filter(c => c.className === 'bt-move').length, 1, 'just the grip');
});

// ── S3: structural pins on the resize wiring (rule 19 caveat: these prove
//       the wiring EXISTS; scaleBoardTextFontSize above is executed for real)
section('S3: the resize path wires the font scale in one place per branch', () => {
  const c = codeOnly(src);
  eq(c.split('function scaleBoardTextFontSize(tx, baseSize, scale) {').length - 1, 1,
    'exactly one definition of the font-scale rule (never a second copy of the maths)');
  eq(c.split('scaleBoardTextFontSize(d.item, d._textScale0.size, w / d.origW);').length - 1, 1,
    'the single-card resize path scales the font');
  ok(c.indexOf('.text-item { position:absolute; cursor:grab;') > 0,
    'a text card shows the GRAB cursor, like an image card - not the text I-beam (the affordance has to match the behaviour)');
  eq(c.split('scaleBoardTextFontSize(s.item, s.size0, scaleX);').length - 1, 1,
    'the multi-select resize path scales the font');
  eq(c.split("isText: !!(s.el && s.el.classList.contains('text-item')),").length - 1, 1,
    'each multi-select snap knows whether it is a text card');
  eq(c.split('size0: s.size,').length - 1, 1, 'and carries its start font size');
  eq(c.split("_textScale0: (item.el && item.el.classList.contains('text-item') && dir.length === 2 && !multiData) ? { size: item.size, w: item.w } : null };").length - 1, 1,
    'the corner snapshot is taken for ONE text card only (multi drags scale the union box, not the card)');
  eq(c.split('if (d._textScale0 && !e.shiftKey && dir.length === 2) {').length - 1, 1,
    'a text corner drag is aspect-locked, like an image');
  eq(c.split('h = w / (d.origW / d.origH);').length - 1, 1, 'and the lock preserves the card ratio');
});

// ── S4: the v7.19.0 two-stage machinery is GONE, not merely bypassed ───────
section('S4: editing is double-click only', () => {
  const c = codeOnly(src);
  eq(c.split('_textEditCandidate').length - 1, 0, 'the micro-click edit candidate is deleted');
  eq(c.split('var _etx =').length - 1, 0, 'the move-mouseup no longer enters edit');
  ok(/viewport\.addEventListener\('dblclick'/.test(c), 'the viewport dblclick handler is still the way in');
  ok(c.indexOf("textEl.classList.add('editing')") > 0, 'and double-click puts the card into edit mode');
  ok(c.indexOf("const tx = state.texts.find(t => t.el === textEl);") > 0, 'resolving the card from the DOM element');
  eq(c.split("boardTextLabel('Drag to move; double-click text to edit'").length - 1, 1,
    'the Move grip tooltip now teaches double-click');
});

// ── S5: the surrounding wiring must stay open (positive assertions, rule 12)
section('S5: gates that must stay open', () => {
  const c = codeOnly(src);
  eq(c.split('if (routeBoardTextMouse(e)) return;').length - 1, 1, 'the text router still runs before the canvas branches');
  ok(c.indexOf("const resize = e.target.closest('.item-handle[data-text-handle]');") > 0,
    'the resize-handle branch still exists for the new corners to route through');
  ok(c.indexOf("const isEditingText = !textGrip && itemEl.classList.contains('text-item') && itemEl.classList.contains('editing');") > 0,
    'only an EDITING card keeps native text gestures on body click');
  ok(c.indexOf('function growTextHeightToFit(tx) {') > 0, 'auto-grow still refits the box after a scale');
});

// ── S6: the press itself, executed for real ─────────────────────────────────
// Rule 19: an anchor proves the router EXISTS, a unit test proves it RUNS.
// Nothing above executes routeBoardTextMouse, so without this section the
// headline promise of v7.20.0 ("a text card behaves like an image card") is
// only pinned by a comment and by the live browser smoke test.
// test_v7_19_0.js S2 pins the SAME function from its own angle; this copy is
// deliberately narrower - just the two branches v7.20.0 changed.
const RTB_BLOCK = slice('\nfunction routeBoardTextMouse(e) {', '\nfunction attachTextListeners(tx) {');
ok(/^function routeBoardTextMouse\(e\) \{/.test(RTB_BLOCK.trim()) && RTB_BLOCK.indexOf('attachTextListeners') < 0,
  'the RTB_BLOCK slice still finds routeBoardTextMouse (anchor check)');

function txOf(id, classes, focusLog) {
  return { id, locked: false, el: { id,
    classList: { contains: c => (classes || []).indexOf(c) >= 0 },
    focus() { if (focusLog) focusLog.push(id); } } };
}
function bodyTarget(el) { return { closest: sel => (sel === '.text-item') ? el : null }; }
function pressEv(target, extra) {
  return Object.assign({ button: 0, shiftKey: false, metaKey: false, ctrlKey: false,
    defaultPrevented: false, target,
    preventDefault() { this.defaultPrevented = true; } }, extra || {});
}
function makeRtb(opts) {
  const state = { tool: opts.tool || 'select', selected: opts.selected || new Set(), texts: opts.texts || [] };
  const calls = { selectOnly: [], setTool: [] };
  let api = null;
  try {
    api = new Function('state', 'document', 'getEditingText', 'setTool', 'selectOnly', 'toggleSelect',
      RTB_BLOCK + '\nreturn routeBoardTextMouse;')(
      state, { activeElement: null }, () => (opts.editing || null),
      t => calls.setTool.push(t), id => calls.selectOnly.push(id), id => {});
  } catch (e) { fails.push('RTB_BLOCK did not compile: ' + e.message); }
  return { api, state, calls };
}

section('S6: one press on a text card behaves like a press on an image', () => {
  const focusLog = [];
  const x = txOf(1, [], focusLog);
  const h = makeRtb({ texts: [x] });
  const ev = pressEv(bodyTarget(x.el));
  eq(h.api(ev), false, 'the press is handed back, so the canvas selects AND arms a move drag in ONE gesture');
  eq(h.calls.selectOnly, [], 'selection stays the canvas job - byte for byte the image-card route');
  eq(focusLog, [], 'no caret: a drag must never turn into an edit');
  eq(ev.defaultPrevented, true,
    'preventDefault is the load-bearing half - without it the contentEditable body focuses and paints a text selection');
});

section('S6b: an EDITING card is the one exception - it keeps the caret', () => {
  const focusLog = [];
  const x = txOf(1, ['editing'], focusLog);
  const h = makeRtb({ texts: [x], selected: new Set([1]) });
  const ev = pressEv(bodyTarget(x.el));
  eq(h.api(ev), true, 'inside an editing card the press is consumed');
  eq(focusLog, [1], 'and places the caret');
  eq(ev.defaultPrevented, false, 'native drag-to-select stays intact while you are typing');
});

console.log(n + ' assertions');
if (fails.length) {
  console.log('FAILURES: ' + fails.length);
  fails.forEach(f => console.log('  FAIL: ' + f));
  process.exit(1);
} else {
  console.log('ALL PASS (' + n + ' assertions)');
}
