#!/usr/bin/env node
/*
 * test_v7_6_0.js — v7.6.0: a manual group gets a name.
 *
 * Two halves, one gesture each:
 *
 *   1. Creation opens the rename. groupSelected() used to stamp
 *      `name: ''` and hide the chip — a hand-made group had no way to be
 *      named at all (the chip is display:none when nameless, so there was
 *      nothing to double-click). Now creation ends in beginGroupRename(),
 *      and beginGroupRename() shows + re-places the chip before focus(),
 *      because focus() on a hidden element is a no-op.
 *
 *   2. The Properties panel carries a Group row. It appears only when every
 *      selected item sits in the SAME group (commonGroupForSelection), and
 *      writing it renames the group through setGroupNameFromPanel — which
 *      re-places the chip so clearing the field hides it again.
 *
 * Sections 2-5 EXECUTE the sliced functions; an anchor alone proves the code
 * exists, not that it runs (the v7.4.0 lesson, 6k).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(
  process.env.KRAFTED_HTML ? path.resolve(process.env.KRAFTED_HTML) : path.join(ROOT, 'kraftpub-dev.html'),
  'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(c, m) { if (c) { pass++; } else { fail++; fails.push(m); console.log('  FAIL: ' + m); } }
function eq(a, b, m) { ok(a === b, m + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function has(needle, m) { ok(HTML.indexOf(needle) >= 0, m + '  (missing: ' + JSON.stringify(needle.slice(0, 90)) + ')'); }
function count(needle, n, m) {
  let c = 0, i = -1;
  while ((i = HTML.indexOf(needle, i + 1)) >= 0) c++;
  eq(c, n, m + '  (found ' + c + ', want ' + n + ')');
}
// A throw inside a section costs that section, not the run (6b: the failure
// must be printed, the tally is at the bottom of the file).
function section(body) {
  try { body(); } catch (e) { fail++; fails.push('section threw: ' + e.message); console.log('  FAIL: section threw: ' + e.message); }
}
function slice(start, end) {
  const i = HTML.indexOf(start), j = HTML.indexOf(end, i < 0 ? 0 : i);
  ok(i >= 0 && j > i, 'slice anchors present: ' + start.slice(0, 50));
  return (i >= 0 && j > i) ? HTML.slice(i, j) : '';
}
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]{0,4000}?\*\//g, '')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
}

// A label element that behaves like the DOM: contentEditable flips
// isContentEditable, classList is a real set, style a plain bag.
function makeLabelEl(name) {
  const listeners = {};
  const classes = new Set();
  const el = {
    textContent: name || '',
    offsetHeight: 18,
    style: { display: name ? 'block' : 'none' },
    _focused: 0,
    classList: {
      add: function (c) { classes.add(c); },
      remove: function (c) { classes.delete(c); },
      contains: function (c) { return classes.has(c); }
    },
    addEventListener: function (t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: function (t, fn) {
      const a = listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
    },
    focus: function () { el._focused++; },
    _fire: function (t, ev) { (listeners[t] || []).slice().forEach(function (fn) { fn(ev); }); }
  };
  let editable = false;
  Object.defineProperty(el, 'contentEditable', {
    get: function () { return editable ? 'true' : 'false'; },
    set: function (v) { editable = (v === true || v === 'true'); }
  });
  Object.defineProperty(el, 'isContentEditable', { get: function () { return editable; } });
  return el;
}

// ═══ 1. the panel row exists and is wired ═══════════════════════════════
section(function () {
  has('id="prop-group-row" style="display:none"', 'the Group row starts hidden');
  has('id="prop-group-name" maxlength="120" placeholder="group name" oninput="setGroupNameFromPanel(this.value)"',
    'the Group field writes through setGroupNameFromPanel');
  count("document.getElementById('prop-group-row')", 1,
    'exactly one place decides the row is visible (updatePropsPanel)');
  count("document.getElementById('prop-group-name')", 1,
    'exactly one place fills the field (updatePropsPanel)');
  has("'Group': '群组'", 'the row label has a Chinese translation in the I18N map');
  count('Manual grouping stays nameless', 0,
    'the old "manual groups stay nameless" rule is gone, comment included');
});

// ═══ 2. groupSelected, executed: creation ends in a rename ══════════════
section(function () {
  const BLOCK = slice('function groupSelected() {', 'function ungroupSelected() {');
  ok(BLOCK.length > 300, 'the groupSelected block is present');

  const calls = { undo: 0, save: 0, toast: [], borders: 0, rename: [] };
  let made = null;
  const st = { groups: [] };
  const sel = [{ id: 11 }, { id: 12 }, { id: 13 }];
  const api = new Function(
    'getSelectedItems', 'toast', 'pushUndo', 'state', 'G', 'GROUP_COLORS',
    'makeGroupEl', 'updateAllGroupBorders', 'scheduleAutoSave', 'beginGroupRename',
    BLOCK + '\nreturn { groupSelected: groupSelected };'
  )(
    function () { return sel; },
    function (m) { calls.toast.push(m); },
    function () { calls.undo++; },
    st,
    { nextGroupId: 7 },
    ['#c1', '#c2', '#c3'],
    function (gd) { made = gd; return { id: gd.id, name: gd.name, memberIds: new Set(gd.memberIds) }; },
    function () { calls.borders++; },
    function () { calls.save++; },
    function (g) { calls.rename.push(g); }
  );

  api.groupSelected();
  eq(calls.undo, 1, 'grouping pushes undo first');
  eq(st.groups.length, 1, 'a new group is registered');
  eq(made && made.name, '', 'a hand-made group still starts nameless — the name comes from the rename, not a guess');
  eq(calls.rename.length, 1, 'v7.7.0: creating a group opens the rename exactly once');
  eq(calls.rename[0], st.groups[0], 'the rename opens on the group just created');
  eq(calls.borders, 1, 'the border is drawn before the rename opens (the chip has somewhere to sit)');

  // Adding to an existing group must NOT reopen the rename — the group
  // already has whatever name (or deliberate namelessness) it had.
  calls.rename.length = 0;
  const existing = { id: 1, name: 'Lighting', memberIds: new Set([11]) };
  st.groups.length = 0; st.groups.push(existing);
  api.groupSelected();
  ok(existing.memberIds.has(12) && existing.memberIds.has(13), 'new members join the existing group');
  eq(st.groups.length, 1, 'no second group is made');
  eq(calls.rename.length, 0, 'joining an existing group does not reopen the rename');

  // Fewer than two items: a toast and nothing else.
  sel.length = 0;
  const before = st.groups.length;
  api.groupSelected();
  eq(st.groups.length, before, 'a short selection groups nothing');
  ok(calls.toast.some(function (m) { return m.indexOf('2+') >= 0; }), 'a short selection is told why nothing happened');
});

// ═══ 3. beginGroupRename, executed: a hidden chip is shown first ════════
section(function () {
  const BLOCK = slice('function beginGroupRename(group) {', 'function groupSelected() {');
  ok(BLOCK.length > 300, 'the beginGroupRename block is present');

  let undos = 0, saves = 0, placements = 0, selects = 0;
  global.window = { getSelection: function () { return { removeAllRanges: function () {}, addRange: function () {} }; } };
  const doc = { createRange: function () { return { selectNodeContents: function () { selects++; } }; } };
  const api = new Function('pushUndo', 'scheduleAutoSave', 'updateGroupBorder', 'document',
    BLOCK + '\nreturn { beginGroupRename: beginGroupRename };'
  )(function () { undos++; }, function () { saves++; }, function () { placements++; }, doc);

  // The v7.6.0 case: a NAMELESS group, chip hidden — exactly what creation opens.
  const g = { name: '', labelEl: makeLabelEl('') };
  eq(g.labelEl.style.display, 'none', 'fixture: a nameless chip starts hidden');
  api.beginGroupRename(g);
  eq(g.labelEl.style.display, 'block', 'beginning the rename shows the hidden chip — focus() on display:none is a no-op');
  eq(placements, 1, 'beginning the rename re-places the chip through updateGroupBorder');
  eq(g.labelEl._focused, 1, 'the chip is focused after it is shown, not before');
  eq(g.labelEl.isContentEditable, true, 'the chip is editable');

  // Type a name, commit with Enter.
  g.labelEl.textContent = '  Hero refs  ';
  g.labelEl._fire('keydown', { key: 'Enter', stopPropagation: function () {}, preventDefault: function () {} });
  eq(g.name, 'Hero refs', 'the typed name commits, trimmed');
  eq(g.labelEl.style.display, 'block', 'a named chip stays shown after the commit');

  // Rename back to empty: the chip hides itself again.
  api.beginGroupRename(g);
  g.labelEl.textContent = '   ';
  g.labelEl._fire('keydown', { key: 'Enter', stopPropagation: function () {}, preventDefault: function () {} });
  eq(g.name, 'Hero refs', 'an all-whitespace commit is rejected, the old name survives');
  eq(g.labelEl.style.display, 'block', 'the rejected empty name keeps the named chip shown');

  // Escape from a nameless chip leaves it nameless AND hides it again.
  const g2 = { name: '', labelEl: makeLabelEl('') };
  api.beginGroupRename(g2);
  g2.labelEl._fire('keydown', { key: 'Escape', stopPropagation: function () {}, preventDefault: function () {} });
  eq(g2.name, '', 'Escape on a nameless chip keeps it nameless');
  eq(g2.labelEl.style.display, 'none', 'Escape on a nameless chip hides it again');
});

// ═══ 4. updateGroupBorder, executed: the editing chip stays placed ══════
section(function () {
  const BLOCK = slice('function updateGroupBorder(group) {', 'function setGroupColor(color) {');
  ok(BLOCK.length > 300, 'the updateGroupBorder block is present');

  const st = { zoom: 2, items: [], texts: [], todos: [], mindmaps: [] };
  const canvasRect = { left: 0, top: 0 };
  const canvas = { getBoundingClientRect: function () { return canvasRect; } };
  const api = new Function('state', 'canvasContent',
    BLOCK + '\nreturn { updateGroupBorder: updateGroupBorder };'
  )(st, canvas);

  function itemAt(id, x, y, w, h) {
    return { id: id, el: { getBoundingClientRect: function () { return { left: x * st.zoom, top: y * st.zoom, width: w * st.zoom, height: h * st.zoom }; } } };
  }
  st.items = [itemAt(1, 100, 100, 50, 50), itemAt(2, 200, 200, 50, 50)];

  function run(name, editing) {
    const label = makeLabelEl(name);
    if (editing) label.classList.add('editing');
    const g = { name: name, color: '#c1', memberIds: new Set([1, 2]), borderEl: { style: {} }, labelEl: label };
    api.updateGroupBorder(g);
    return g;
  }

  const named = run('Refs', false);
  eq(named.labelEl.style.display, 'block', 'a named chip is shown');
  eq(named.labelEl.style.left, '92px', 'the named chip is placed at the border edge');

  const midEdit = run('', true);
  eq(midEdit.labelEl.style.display, 'block', 'v7.7.0: a nameless chip MID-RENAME stays shown');
  eq(midEdit.labelEl.style.left, '92px', 'v7.7.0: a nameless chip MID-RENAME is placed, not parked at 0');

  const hidden = run('', false);
  eq(hidden.labelEl.style.display, 'none', 'a nameless chip NOT being renamed stays hidden');

  // Emptied of members: chip and border hide together.
  hidden.memberIds = new Set([99]);
  api.updateGroupBorder(hidden);
  eq(hidden.labelEl.style.display, 'none', 'a group with no members hides its chip with its border');
});

// ═══ 5. commonGroupForSelection + setGroupNameFromPanel, executed ═══════
section(function () {
  // End marker is the next function after the pair — a decorative marker like
  // '\n\n// ═' matches hundreds of KB away and the slice then EXECUTES the
  // whole intervening file at new-Function call time (top-level document
  // references), which reads as an app bug but is a harness bug.
  const BLOCK = slice('function commonGroupForSelection() {', '// Move all group members when one is moved');
  ok(BLOCK.length > 300 && BLOCK.length < 5000, 'the panel helpers block is present and bounded');

  const gA = { id: 1, name: 'Alpha', memberIds: new Set([1, 2, 3]), labelEl: makeLabelEl('Alpha') };
  const gB = { id: 2, name: 'Beta', memberIds: new Set([4, 5]), labelEl: makeLabelEl('Beta') };
  const st = { groups: [gA, gB] };
  let sel = [];
  let saves = 0, placements = 0, placedGroup = null;
  const api = new Function('state', 'getSelectedItems', 'updateGroupBorder', 'scheduleAutoSave',
    BLOCK + '\nreturn { commonGroupForSelection: commonGroupForSelection, setGroupNameFromPanel: setGroupNameFromPanel };'
  )(st,
    function () { return sel; },
    function (g) { placements++; placedGroup = g; },
    function () { saves++; });

  sel = [{ id: 1 }, { id: 2 }];
  eq(api.commonGroupForSelection(), gA, 'a selection inside one group answers that group');

  sel = [{ id: 2 }];
  eq(api.commonGroupForSelection(), gA, 'a subset of a group still answers the group (the name is the whole group’s)');

  sel = [{ id: 1 }, { id: 4 }];
  eq(api.commonGroupForSelection(), null, 'a selection spanning two groups answers null — the row hides');

  sel = [{ id: 1 }, { id: 9 }];
  eq(api.commonGroupForSelection(), null, 'a selection with an ungrouped item answers null — the row hides');

  sel = [];
  eq(api.commonGroupForSelection(), null, 'an empty selection answers null');

  // The writer: trims, reaches the chip text, re-places, autosaves.
  sel = [{ id: 1 }, { id: 3 }];
  api.setGroupNameFromPanel('  Hero refs  ');
  eq(gA.name, 'Hero refs', 'the panel writer trims and stores the name');
  eq(gA.labelEl.textContent, 'Hero refs', 'the chip text follows the panel');
  eq(placements, 1, 'the panel writer re-places the chip');
  eq(placedGroup, gA, 'the chip re-placed is the selection’s group');
  eq(saves, 1, 'the panel writer autosaves');
  eq(gB.name, 'Beta', 'the other group is untouched');

  // Clearing the field stores an empty name (updateGroupBorder then hides the
  // chip — section 4 owns that assertion).
  api.setGroupNameFromPanel('');
  eq(gA.name, '', 'clearing the field clears the name');

  // No common group: a quiet no-op, never a throw.
  sel = [{ id: 1 }, { id: 4 }];
  const savesBefore = saves;
  api.setGroupNameFromPanel('Nope');
  eq(saves, savesBefore, 'a hidden row cannot write (no common group, no save)');
  eq(gA.name, '', 'a hidden row cannot rename anything');
});

// ═══ 6. the versions in the tree still agree ════════════════════════════
section(function () {
  const sw = fs.readFileSync(path.resolve(ROOT, 'Krafted/docs/sw.js'), 'utf8');
  const title = (HTML.match(/<title>Krafted v([\d.]+)<\/title>/) || [])[1];
  const konst = (HTML.match(/var KRAFTED_VERSION = '([\d.]+)';/) || [])[1];
  const appv = (sw.match(/const APP_VERSION = '([\d.]+)';/) || [])[1];
  ok(title && konst && appv, 'title, KRAFTED_VERSION and APP_VERSION are all present');
  eq(konst, title, 'KRAFTED_VERSION matches the title');
  eq(appv, title, 'the service worker matches the app');
});

console.log('');
if (fail) {
  console.log('FAILURES: ' + fail + ' (passed ' + pass + ')');
  process.exit(1);
}
console.log('ALL PASS (' + pass + ' assertions)');
