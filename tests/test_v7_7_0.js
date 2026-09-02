#!/usr/bin/env node
/*
 * test_v7_7_0.js — v7.7.0: folder-drop auto-tidy + delete disposes a group.
 *
 * Two independent behaviours shipped together:
 *
 *   A. A folder import now auto-runs tidySelection() over the new items, so a
 *      multi-folder drop packs into a non-overlapping block instead of the
 *      badly-overlapping cascade (each item steps by ~22% of its own size, so
 *      big images land almost on top of each other). Images/videos are added
 *      asynchronously, so the tidy only fires once every expected item has
 *      actually been placed (_armFolderTidy / _maybeTidy / _folderTidy).
 *
 *   B. deleteSelected() now drops the deleted item from its group and dissolves
 *      the group when it falls below 2 members (border + label disposed), so
 *      deleting the last image no longer leaves a stale empty group box on the
 *      board. The <2 rule mirrors ungroupSelected().
 *
 * Sections 2-4 EXECUTE the sliced functions; an anchor alone proves the code
 * exists, not that it runs (the v7.4.0 lesson).
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
function section(body) {
  try { body(); } catch (e) { fail++; fails.push('section threw: ' + e.message); console.log('  FAIL: section threw: ' + e.message); }
}
function slice(start, end) {
  const i = HTML.indexOf(start), j = HTML.indexOf(end, i < 0 ? 0 : i);
  ok(i >= 0 && j > i, 'slice anchors present: ' + start.slice(0, 50));
  return (i >= 0 && j > i) ? HTML.slice(i, j) : '';
}

// ═══ 1. the wiring is present ═══════════════════════════════════════════
section(function () {
  // A — folder import arms the auto-tidy, and every add site reports in.
  has("if (sorted.length) _armFolderTidy(sorted.length);", 'a folder import arms the auto-tidy');
  has("_handleFileDrop(e, sorted);", 'the import still runs after arming');
  count("_maybeTidy(_it.id)", 2, 'both image branches (gif + normalised) report to the tidy counter');
  count("_maybeTidy(newItem.id)", 1, 'the video branch reports to the tidy counter');
  count("_maybeTidy(_a.id)", 1, 'the audio branch reports to the tidy counter');
  count("_maybeTidy(null)", 1, 'a failed image decode still counts toward completion');
  has("function _maybeTidy(id) {", 'the tidy resolver exists');
  has("if (_ids.length >= 2) {", 'the tidy only fires for a multi-item import (a lone drop keeps its size)');
  // B — delete drops the item from its group and dissolves a too-small group.
  has("const _dg = state.groups.find(g => g.memberIds.has(i.id));", 'delete looks up the item’s group');
  has("_dg.memberIds.delete(i.id);", 'delete removes the item from the group’s memberIds');
  has("if (_dg.memberIds.size < 2) {", 'delete dissolves a group that falls below 2 members');
  has("updateAllGroupBorders();", 'surviving group borders are repositioned after a delete');
});

// ═══ 2. _maybeTidy, executed: fires once on the right selection ═════════
section(function () {
  const BLOCK = slice('var _folderTidy = { active: false, ids: [], expected: 0, attempts: 0 };',
                      'function _handleFileDrop(e, files) {');
  ok(BLOCK.length > 300 && BLOCK.length < 4000, 'the auto-tidy block is present and bounded');

  const st = { selected: new Set() };
  let tidyCalls = 0;
  let tidySel = null;
  const api = new Function('state', 'tidySelection',
    BLOCK + '\nreturn { _armFolderTidy: _armFolderTidy, _maybeTidy: _maybeTidy, _folderTidy: _folderTidy };'
  )(st, function () { tidyCalls++; tidySel = Array.from(st.selected); });

  // A single import of three items: tidy fires exactly once, on all three.
  api._armFolderTidy(3);
  api._maybeTidy(11);
  api._maybeTidy(12);
  api._maybeTidy(13);
  eq(tidyCalls, 1, 'v7.7.0: the tidy fires exactly once when the last item lands');
  eq(tidySel && tidySel.length, 3, 'the tidy runs over all three new items');
  ok(tidySel && tidySel.indexOf(11) >= 0 && tidySel.indexOf(12) >= 0 && tidySel.indexOf(13) >= 0,
    'every new item is in the tidy selection');
  ok(api._folderTidy.active === false, 'the resolver resets itself after firing (ready for the next drop)');

  // A decode failure (null) still counts; the two good items still get tidied.
  api._armFolderTidy(3);
  api._maybeTidy(21);
  api._maybeTidy(null);
  api._maybeTidy(22);
  eq(tidyCalls, 2, 'a failed decode still closes the import, tidy fires once more');
  eq(tidySel && tidySel.length, 2, 'the failed image is dropped from the tidy selection');

  // Re-arm for a second, separate drop: the resolver handles sequential drops.
  api._armFolderTidy(2);
  api._maybeTidy(31);
  api._maybeTidy(32);
  eq(tidyCalls, 3, 'a second folder drop arms and fires independently');

  // A lone item never triggers a tidy (would resize a single reference image).
  api._armFolderTidy(1);
  api._maybeTidy(99);
  eq(tidyCalls, 3, 'v7.7.0: a single-item import does NOT auto-tidy');

  // Without arming, reporting in is a no-op (plain drops / pastes).
  api._maybeTidy(123);
  eq(tidyCalls, 3, 'an unarmed report is a no-op — only folder imports tidy');
});

// ═══ 3. deleteSelected, executed: the group follows its last member ═════
section(function () {
  const BLOCK = slice('function deleteSelected() {', '// ==== draw-layer.js ====');
  ok(BLOCK.length > 300 && BLOCK.length < 4000, 'the deleteSelected block is present and bounded');

  function makeItem(id) {
    return {
      id: id, img: true,
      el: { remove: function () {}, classList: { contains: function () { return false; } } }
    };
  }

  function build() {
    const st = {
      selected: new Set(),
      items: [],
      groups: []
    };
    const rec = { disposed: [], borders: 0, save: 0 };
    const api = new Function(
      'getSelectedItems', 'pushUndo', 'maskPickColorActive', 'maskBrushActive', 'activeMaskId',
      'removeBrushCanvas', 'document', 'cleanupVideoItem', 'cleanupImageItem', 'removeAnnoPopoversFor',
      'canvas', 'redrawDrawLayer', 'state', 'refreshSelection', 'scheduleAutoSave',
      'updateMediaBar', 'updateAutoFitPaper', 'updateAllGroupBorders', 'disposeGroupEl',
      BLOCK + '\nreturn { deleteSelected: deleteSelected };'
    )(
      function () { return sel; },
      function () {},
      false, false, null,
      function () {},
      { getElementById: function () { return { classList: { remove: function () {} } }; } },
      function () {}, function () {}, function () {},
      { querySelector: function () { return null; } },
      function () {},
      st,
      function () {},
      function () { rec.save++; },
      function () {},
      function () {},
      function () { rec.borders++; },
      function (g) { rec.disposed.push(g); }
    );
    return { st: st, rec: rec, api: api };
  }

  let sel = [];

  // One-member group, delete its only member: the group is dissolved.
  sel = [makeItem(11)];
  var g1 = { id: 1, name: 'Solo', memberIds: new Set([11]), borderEl: { style: {} }, labelEl: { style: {} } };
  var b = build();
  b.st.groups = [g1];
  b.api.deleteSelected();
  eq(b.rec.disposed.length, 1, 'v7.7.0: deleting the last member dissolves the group');
  eq(b.rec.disposed[0], g1, 'the dissolved group is the one that lost its member');
  eq(b.st.groups.length, 0, 'the dissolved group leaves state.groups');
  eq(b.rec.borders, 1, 'surviving borders are repositioned (runs even with none left)');

  // Three-member group, delete one: kept, member removed, borders refreshed.
  sel = [makeItem(21)];
  var g2 = { id: 2, name: 'Trip', memberIds: new Set([21, 22, 23]), borderEl: { style: {} }, labelEl: { style: {} } };
  b = build();
  b.st.groups = [g2];
  b.api.deleteSelected();
  eq(b.rec.disposed.length, 0, 'a group that stays at 2 members is NOT dissolved');
  eq(b.st.groups.length, 1, 'the group survives');
  ok(g2.memberIds.has(21) === false && g2.memberIds.has(22) && g2.memberIds.has(23),
    'only the deleted member is removed from the group');
  eq(b.rec.borders, 1, 'the surviving group border is repositioned');

  // Delete two of three in one selection: the first keeps it at 2, the second
  // drops it to 1 and dissolves it.
  sel = [makeItem(21), makeItem(22)];
  var g3 = { id: 3, name: 'Trip', memberIds: new Set([21, 22, 23]), borderEl: { style: {} }, labelEl: { style: {} } };
  b = build();
  b.st.groups = [g3];
  b.api.deleteSelected();
  eq(b.rec.disposed.length, 1, 'deleting down to one member dissolves the group in the same call');
  eq(b.st.groups.length, 0, 'the group is gone after the dissolve');

  // An item in no group: delete is a no-op for groups.
  sel = [makeItem(41)];
  b = build();
  b.st.groups = [];
  b.api.deleteSelected();
  eq(b.rec.disposed.length, 0, 'an ungrouped delete leaves no group to dissolve');
});

// ═══ 4. the versions in the tree still agree ════════════════════════════
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
