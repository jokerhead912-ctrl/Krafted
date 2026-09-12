#!/usr/bin/env node
// test_v7_15_1.js — tag quick-bar fixes:
//   (1) a stuck IME composition flag must not silently kill Append/Remove/Replace clicks
//   (2) an explicit tag action that changes nothing must toast, not stay silent
//   (3) the quick bar must clear the Move grip when it parks above the text box
// The suite extracts the REAL functions from the source and executes them (rule 6k:
// an anchor proves code exists, not that it runs).
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = process.env.KRAFTED_HTML ? path.resolve(process.env.KRAFTED_HTML)
  : '/Users/kincheung/WorkBuddy/2026-07-25-10-53-37/kraftpub-dev.html';
const src = fs.readFileSync(HTML, 'utf8');

let passes = 0; const fails = [];
function ok(cond, msg) { if (cond) { passes++; } else { fails.push(msg); console.log('FAIL: ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

function slice(start, end) {
  const i = src.indexOf(start);
  if (i < 0) { fails.push('slice start not found: ' + start); return ''; }
  const j = src.indexOf(end, i);
  if (j < 0) { fails.push('slice end not found: ' + end); return ''; }
  return src.slice(i, j);
}

// codeOnly: strip block comments (BOUNDED — see SKILL §6d) and whole-line // comments
function codeOnly(s) {
  return s.replace(/\/\*[\s\S]{0,4000}?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ── fake DOM helpers ─────────────────────────────────────────────────────
function makeEl(tag) {
  const el = {
    tag: tag || 'div', _h: {}, children: [], dataset: {}, style: {},
    className: '', textContent: '', title: '', type: '', disabled: false, value: '',
    setAttribute() {}, append(...kids) { el.children.push(...kids); },
    appendChild(k) { el.children.push(k); return k; },
    replaceChildren() { el.children.length = 0; },
    addEventListener(type, fn) { el._h[type] = fn; },
    fire(type) { if (el._h[type]) el._h[type]({ target: el }); },
  };
  return el;
}

const state = { calls: { pushUndo: 0, autosave: 0, library: 0, toasts: [], confirms: 0, pos: 0, renderTags: 0 } };
function resetCalls() {
  state.calls = { pushUndo: 0, autosave: 0, library: 0, toasts: [], confirms: 0, pos: 0, renderTags: 0 };
}

function buildTagRoot(item, opts) {
  opts = opts || {};
  const input = makeEl('input');
  const chips = makeEl('div');
  const buttons = ['append', 'remove', 'replace'].map(m => {
    const b = makeEl('button'); b.dataset.tagMode = m; return b;
  });
  const root = {
    dataset: {},
    querySelector(sel) {
      if (sel === '[data-tag-input]') return input;
      if (sel === '[data-tag-chips]') return chips;
      return null;
    },
    querySelectorAll(sel) { return sel === '[data-tag-mode]' ? buttons : []; },
  };
  return { root, input, chips, buttons };
}

function makeHarness(opts) {
  opts = opts || {};
  const item = opts.item || { id: 7, tags: ['a'], locked: false, name: '', note: '' };
  const rootParts = buildTagRoot(item);
  const docQueries = [];
  const document = {
    queries: docQueries,
    getElementById() { return null; },
    querySelectorAll(sel) { return sel === '[data-board-tags]' ? [rootParts.root] : []; },
    querySelector(sel) { docQueries.push(sel); return null; },
    createElement(t) { return makeEl(t); },
  };
  const api = new Function(
    'document', 'window', '_isZhUI', 'splitTags', 'getSelectedItems', 'pushUndo',
    'setBoardControlValue', 'commonBoardValue', 'refreshBoardTextLabels',
    'scheduleAutoSave', 'requestLibraryRefresh', 'toast', 'positionBoardTextUI',
    slice('\nfunction boardTextLabel(en, zh) {', '\nfunction selectedBoardTexts') + '\n' +
    slice('\nfunction boardTagValues(value) {', '\nfunction mutateSelectedTags') + '\n' +
    slice('\nfunction mutateSelectedTags(mode, value) {', '\nfunction setItemMeta') + '\n' +
    slice('\nfunction submitBoardTags(root, mode) {', '\nfunction handleBoardTagKey') + '\n' +
    slice('\nfunction handleBoardTagKey(event, root) {', '\nfunction renderTagControls') + '\n' +
    slice('\nfunction renderTagControls() {', '// 无循环/常驻计时器') + '\n' +
    'return { boardTextLabel, boardTagValues, mutateSelectedTags, submitBoardTags, handleBoardTagKey, renderTagControls, root: ' + 'undefined' + ' };'
  )(
    document,
    { confirm(msg) { state.calls.confirms++; return opts.confirm !== false; } },
    () => false,                                     // _isZhUI → English
    s => String(s || '').split(',').map(t => t.trim()).filter(Boolean),  // splitTags
    () => [item],                                    // getSelectedItems
    () => { state.calls.pushUndo++; },               // pushUndo
    () => {},                                        // setBoardControlValue
    () => null,                                      // commonBoardValue
    () => {},                                        // refreshBoardTextLabels
    () => { state.calls.autosave++; },               // scheduleAutoSave
    () => { state.calls.library++; },                // requestLibraryRefresh
    msg => { state.calls.toasts.push(msg); },        // toast
    () => { state.calls.pos++; },                    // positionBoardTextUI
  );
  api.item = item;
  api.parts = rootParts;
  api.document = document;
  return api;
}

// ═════════════════════════════════════════════════════════════════════════
// S1. harness sanity
const H = makeHarness();
ok(typeof H.mutateSelectedTags === 'function', 'mutateSelectedTags extracted');
ok(typeof H.renderTagControls === 'function', 'renderTagControls extracted');
ok(typeof H.positionBar !== 'function' || true, 'harness built');

// S2. boardTagValues spec
eq(JSON.stringify(H.boardTagValues('a, b ,a,')), JSON.stringify(['a', 'b']), 'boardTagValues trims + dedupes');
eq(JSON.stringify(H.boardTagValues(['x', '', ' y ', 'x'])), JSON.stringify(['x', 'y']), 'boardTagValues array path dedupes');
eq(JSON.stringify(H.boardTagValues('')), JSON.stringify([]), 'boardTagValues empty → []');

// S3. mutateSelectedTags behaviour + no-op toast
resetCalls();
let r = H.mutateSelectedTags('append', 'b');
eq(r, 1, 'append new tag returns 1');
eq(JSON.stringify(H.item.tags), JSON.stringify(['a', 'b']), 'append adds the tag');
eq(state.calls.pushUndo, 1, 'append pushes undo');
eq(state.calls.autosave, 1, 'append schedules autosave');
eq(state.calls.library, 1, 'append refreshes library');
eq(state.calls.toasts.length, 0, 'successful append is silent');

resetCalls();
r = H.mutateSelectedTags('append', 'a');
eq(r, 0, 'append of an existing tag returns 0');
eq(state.calls.toasts.length, 1, 'no-op append toasts once');
eq(state.calls.toasts[0], 'No tag changes', 'no-op toast says No tag changes (en)');
eq(state.calls.pushUndo, 0, 'no-op append does not push undo');
eq(state.calls.autosave, 0, 'no-op append does not autosave');

resetCalls();
r = H.mutateSelectedTags('remove', 'zzz');
eq(r, 0, 'removing an absent tag returns 0');
eq(state.calls.toasts.length, 1, 'removing an absent tag toasts');
eq(state.calls.pushUndo, 0, 'removing an absent tag does not push undo');

resetCalls();
r = H.mutateSelectedTags('remove', 'a');
eq(r, 1, 'remove of a present tag returns 1');
eq(JSON.stringify(H.item.tags), JSON.stringify(['b']), 'remove deletes the tag');

resetCalls();
r = H.mutateSelectedTags('replace', 'b');
eq(state.calls.confirms, 0, 'replace to an identical set never confirms');
eq(state.calls.toasts.length, 1, 'replace to an identical set toasts');
eq(r, 0, 'replace to an identical set returns 0');

resetCalls();
r = H.mutateSelectedTags('replace', 'c,d');
eq(state.calls.confirms, 1, 'a real replace asks for confirmation');
eq(JSON.stringify(H.item.tags), JSON.stringify(['c', 'd']), 'replace rewrites the tag set');

resetCalls();
const H2 = makeHarness({ confirm: false });
r = H2.mutateSelectedTags('replace', 'zz');
eq(r, -1, 'a vetoed replace returns -1');
eq(JSON.stringify(H2.item.tags), JSON.stringify(['a']), 'a vetoed replace changes nothing');
eq(state.calls.pushUndo, 0, 'a vetoed replace does not push undo');

resetCalls();
r = H.mutateSelectedTags('append', '');
eq(r, 0, 'empty append returns 0');
eq(state.calls.toasts.length, 0, 'empty append is silent (programmatic path)');
eq(state.calls.pushUndo, 0, 'empty append does not push undo');

resetCalls();
r = H.mutateSelectedTags('bogus', 'q');
eq(r, 0, 'an invalid mode returns 0');
eq(state.calls.pushUndo, 0, 'an invalid mode does not push undo');

resetCalls();
const H3 = makeHarness({ item: { id: 9, tags: ['a'], locked: true } });
r = H3.mutateSelectedTags('append', 'q');
eq(r, 0, 'a locked item is skipped');
eq(state.calls.toasts.length, 1, 'locked-only selection toasts no-change');
eq(JSON.stringify(H3.item.tags), JSON.stringify(['a']), 'locked item tags untouched');

// S4. submitBoardTags + handleBoardTagKey (Enter path keeps the IME guard)
resetCalls();
H.parts.input.value = '   ';
H.submitBoardTags(H.parts.root, 'append');
eq(state.calls.pushUndo, 0, 'a whitespace-only draft submits nothing');

resetCalls();
H.parts.input.value = 'x';
H.parts.input.dataset.composing = '1';
H.handleBoardTagKey({ key: 'Enter', isComposing: false, keyCode: 13, preventDefault() {}, stopPropagation() {} }, H.parts.root);
eq(state.calls.pushUndo, 0, 'Enter with a stuck composing flag is still guarded');
eq(H.parts.input.value, 'x', 'the guarded draft is preserved');

resetCalls();
H.parts.input.dataset.composing = '';
H.parts.input.value = 'x';
H.handleBoardTagKey({ key: 'Enter', isComposing: false, keyCode: 13, preventDefault() {}, stopPropagation() {} }, H.parts.root);
eq(JSON.stringify(H.item.tags), JSON.stringify(['c', 'd', 'x']), 'a clean Enter appends');
eq(H.parts.input.value, '', 'a clean Enter clears the input');

resetCalls();
H.parts.input.value = 'w';
H.handleBoardTagKey({ key: 'a', isComposing: false, keyCode: 65, preventDefault() {}, stopPropagation() {} }, H.parts.root);
eq(H.parts.input.value, 'w', 'a non-Enter key is left alone');

resetCalls();
H.item.tags = ['b', 'x'];
H.parts.input.value = 'w';
H.handleBoardTagKey({ key: 'Enter', isComposing: true, keyCode: 229, preventDefault() {}, stopPropagation() {} }, H.parts.root);
eq(state.calls.pushUndo, 0, 'keyCode 229 (IME) Enter is guarded');

// S5. renderTagControls binds the click handlers, and a stuck flag is FLUSHED on click
resetCalls();
H.item.tags = ['a'];
H.renderTagControls();
eq(H.parts.root.dataset.ready, '1', 'first render marks the root ready');
ok(typeof H.parts.buttons[0]._h.click === 'function', 'Append button gets a click handler');
ok(typeof H.parts.input._h.keydown === 'function', 'tag input gets a keydown handler');

H.parts.input.value = 'q';
H.parts.input.dataset.composing = '1';   // stuck IME flag, the reported bug
H.parts.buttons[0].fire('click');
ok(H.item.tags.indexOf('q') >= 0, 'a stuck IME flag no longer kills the Append click');
eq(H.parts.input.dataset.composing, '', 'the click flushes the stuck composing flag');

H.parts.input.value = 'a';
H.parts.input.dataset.composing = '1';
H.parts.buttons[1].fire('click');        // Remove 'a' — present, should work too
ok(H.item.tags.indexOf('a') < 0, 'a stuck IME flag no longer kills the Remove click');
eq(H.parts.input.dataset.composing, '', 'Remove click also flushes the flag');

H.parts.input.value = 'z1,z2';
H.parts.input.dataset.composing = '1';
H.parts.buttons[2].fire('click');        // Replace — confirm stub returns true
eq(JSON.stringify(H.item.tags), JSON.stringify(['z1', 'z2']), 'a stuck IME flag no longer kills the Replace click');

// chips render the selected tags
resetCalls();
H.item.tags = ['alpha', 'beta'];
H.parts.chips.dataset.signature = '';
H.renderTagControls();
ok(H.parts.chips.children.length >= 2, 'chips render for the selected tags');

// disabled wiring for locked-only selections
const H4 = makeHarness({ item: { id: 11, tags: ['a'], locked: true } });
H4.renderTagControls();
eq(H4.parts.input.disabled, true, 'a locked selection disables the tag input');
eq(H4.parts.buttons[0].disabled, true, 'a locked selection disables Append');

// ═════════════════════════════════════════════════════════════════════════
// S6. positionBoardTextUI clears the Move grip
function makePosHarness(textRects, grips) {
  const queries = [];
  const bar = {
    classList: { contains: () => true },
    style: {},
    getBoundingClientRect: () => ({ width: 588, height: 111, left: 0, top: 0, right: 588, bottom: 111 }),
  };
  const document = {
    getElementById(id) { return id === 'text-quick-bar' ? bar : null; },
    querySelector(sel) {
      queries.push(sel);
      const m = /data-owner="(\d+)"\]/.exec(sel);
      if (m && grips[m[1]]) return { getBoundingClientRect: () => grips[m[1]] };
      return null;
    },
  };
  const api = new Function(
    'document', 'window', 'selectedBoardTexts',
    slice('\nfunction positionBoardTextUI() {', '\nfunction doneBoardTextUI') + '\n' +
    'return { positionBoardTextUI };'
  )(
    document,
    { innerWidth: 1440, innerHeight: 900 },
    () => textRects.map(t => ({ id: t.id, el: { getBoundingClientRect: () => t.rect } })),
  );
  api.bar = bar; api.queries = queries;
  return api;
}

// D1: grip at 129, text top 160 → bar must park ABOVE the grip: y = 129-10-111 = 8
let P = makePosHarness(
  [{ id: 7, rect: { left: 100, right: 300, top: 160, bottom: 200, width: 200, height: 40 } }],
  { 7: { top: 129, height: 26 } },
);
P.positionBoardTextUI();
eq(P.bar.style.top, '8px', 'bar parks above the Move grip, not above the box top');
eq(P.bar.style.visibility, 'visible', 'bar visible after placement');
ok(P.queries.some(q => q.indexOf('.bt-move') >= 0), 'placement asks for the .bt-move grip');

// D2: no grip (locked/hidden) → falls back to the box top: y = 160-121 = 39
P = makePosHarness(
  [{ id: 7, rect: { left: 100, right: 300, top: 160, bottom: 200, width: 200, height: 40 } }],
  {},
);
P.positionBoardTextUI();
eq(P.bar.style.top, '39px', 'without a grip the bar parks at the box top bound');

// D3: not enough room above → drop below the box: y = 200+10 = 210
P = makePosHarness(
  [{ id: 7, rect: { left: 100, right: 300, top: 100, bottom: 200, width: 200, height: 100 } }],
  { 7: { top: 69, height: 26 } },
);
P.positionBoardTextUI();
eq(P.bar.style.top, '210px', 'with no room above (incl. grip) the bar drops below');

// D4: two selections — the HIGHER grip wins: grips 169/189, texts 200/220 → y = 169-121 = 48
P = makePosHarness(
  [
    { id: 7, rect: { left: 100, right: 300, top: 200, bottom: 240, width: 200, height: 40 } },
    { id: 8, rect: { left: 120, right: 320, top: 220, bottom: 260, width: 200, height: 40 } },
  ],
  { 7: { top: 169, height: 26 }, 8: { top: 189, height: 26 } },
);
P.positionBoardTextUI();
eq(P.bar.style.top, '48px', 'multi-select lifts the bound to the highest grip');

// D5: tall WIDE box near the top — sides are full too (maxX+598>1432, minX-598<8),
// so the vertical fallback runs. above(topBound)=100-18=82 >= below=82 →
// y = 100-121 = -21 → clamped to 8. (Fallback reading minY: above=113 → y=10 ≠ 8.)
P = makePosHarness(
  [{ id: 7, rect: { left: 100, right: 900, top: 131, bottom: 800, width: 800, height: 669 } }],
  { 7: { top: 100, height: 26 } },
);
P.positionBoardTextUI();
eq(P.bar.style.top, '8px', 'the fallback branch also lifts to the grip bound');

// ═════════════════════════════════════════════════════════════════════════
// S7. structural pins (codeOnly — comments must not count)
const code = codeOnly(src);
// two-line anchor: the flush must sit immediately before the submit call inside
// the click handler (the compositionend handler spells the same single line).
eq(code.split("input.dataset.composing = '';\n          submitBoardTags(").length - 1, 1,
  'exactly one IME flush site, immediately before the click submit');
ok(code.indexOf("if (!input || input.dataset.composing === '1') return;") >= 0, 'the Enter path keeps its IME guard');
eq(code.split("toast(boardTextLabel('No tag changes'").length - 1, 1, 'exactly one no-op toast site');
eq(code.split('var topBound = gripTop < minY ? gripTop : minY;').length - 1, 1, 'exactly one grip-bound computation');
const posBlock = codeOnly(slice('\nfunction positionBoardTextUI() {', '\nfunction doneBoardTextUI'));
ok(posBlock.indexOf(".bt-move") >= 0, 'placement actually reads the grip');
eq(posBlock.split('topBound').length - 1 >= 4, true, 'topBound is used in both the main and fallback branches');

console.log(fails.length ? '\nFAILURES: ' + fails.length : 'ALL PASS (' + passes + ' assertions)');
if (fails.length) { process.exit(1); }
