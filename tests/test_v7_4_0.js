#!/usr/bin/env node
/*
 * test_v7_4_0.js — a dropped folder becomes a named block (v7.4.0)
 *
 * WHY THIS SUITE EXISTS
 *   v7.3.0 carried the folder name in as tags. That is invisible. Dropping
 *   three folders still produced one undifferentiated shingle of 200 images
 *   with no way to see where one folder ended and the next began.
 *
 *   The group machinery was already there — `state.groups` had borders,
 *   colours, undo, load and drag-follow since long before this release. What
 *   it did NOT have was a name. So the feature is one field plus one label
 *   element, and the risk is entirely in how many places a group is built:
 *
 *       serialisers:  captureSnapshot, buildManifest, serializeBoard, (+1 dead)
 *       rebuilders:   groupSelected, undo restore, load restore
 *
 *   SEVEN hand-written copies of `{ id, color, memberIds }`. That is pitfall
 *   one in its purest form, and it is why this release starts with a refactor:
 *   serializeGroup / makeGroupEl / disposeGroupEl are now the only three
 *   places that know what a group is. Adding `name` is one line, not seven.
 *
 *   Three decisions are pinned, because each has a cheap-looking alternative
 *   that quietly breaks later:
 *
 *   1. The block key is the FULL path, so "Refs/Head" and "Refs/Body" are two
 *      blocks. Keying on the leaf alone would merge two different parents'
 *      "Head" folders into one block.
 *   2. `folderKey` is NOT serialised. It is a hint for the session that made
 *      the drop. Persisting it would make an appended board's "Head" group
 *      silently absorb a later drop meant for the other board — the exact
 *      thing the existing id-renumbering on append exists to prevent.
 *   3. The import order becomes folder-major. images→videos→audio interleaved
 *      folders, so a two-folder drop produced two bounding boxes covering
 *      almost the same area and the borders came out as spaghetti.
 *
 *   WHAT IS BEING PINNED
 *   The three shared builders (executed), that no hand-written group literal
 *   survives anywhere, the block-key and reuse rules (executed), the
 *   folder-major sort (executed), and the chip's counter-scale arithmetic —
 *   the chip must be the same size on screen at every zoom level.
 *
 * Usage:  node test_v7_4_0.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const TESTS = __dirname;
const ROOT = path.resolve(TESTS, '../..');
const DEV = path.resolve(ROOT, 'kraftpub-dev.html');
const STATE = JSON.parse(fs.readFileSync(path.resolve(TESTS, '.version_state'), 'utf8'));
const HTML = fs.readFileSync(DEV, 'utf8');

let pass = 0;
const fails = [];
function ok(cond, label) { if (cond) { pass++; } else { fails.push(label); } }
function eq(a, b, label) {
  ok(a === b, `${label}  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}
function near(a, b, label, tol) {
  const d = Math.abs(a - b);
  ok(d <= (tol === undefined ? 1e-9 : tol),
    `${label}  (got ${a}, want ${b}, off by ${d})`);
}
function has(needle, label) {
  ok(HTML.indexOf(needle) >= 0, `${label}  (missing: ${JSON.stringify(needle.slice(0, 70))})`);
}
function hasNot(needle, label) {
  ok(HTML.indexOf(needle) < 0, `${label}  (should be absent: ${JSON.stringify(needle.slice(0, 70))})`);
}
function count(needle, n, label) {
  const got = HTML.split(needle).length - 1;
  ok(got === n, `${label}  (found ${got}, want ${n})`);
}
// A comment that merely MENTIONS a call must not be counted as the call.
// Block-comment strip is bounded: the source holds a string literal '/*'
// whose partner sits 270 KB further on, so an unbounded lazy match deletes
// 42% of the file before any assertion runs.
function codeOnly() {
  return HTML
    .replace(/\/\*[\s\S]{0,4000}?\*\//g, '')
    .split('\n')
    .filter(function (l) { return l.trim().indexOf('//') !== 0; })
    .join('\n');
}
const CODE = codeOnly();
function codeCount(needle, n, label) {
  const got = CODE.split(needle).length - 1;
  ok(got === n, `${label}  (found ${got} in code, want ${n})`);
}
// An executed section slices code out of the app and runs it. If the slice
// anchor has moved, that throws — and an uncaught throw exits the process
// BEFORE the report prints, so every assertion in the file is silently lost
// and a mutation runner scores it as a catch with "0 assertion(s)". Wrapping
// turns the crash into a FAIL line that survives to the report.
function section(body) {
  try { body(); } catch (e) { fails.push(`section threw: ${e.message}`); }
}

// Slice a region straight out of the app so there is no second implementation
// of the rule being tested.
function slice(from, to) {
  const i = HTML.indexOf(from);
  const j = HTML.indexOf(to, i);
  if (i < 0) { fails.push(`slice start missing: ${JSON.stringify(from.slice(0, 60))}`); return ''; }
  if (j <= i) { fails.push(`slice end missing after start: ${JSON.stringify(to.slice(0, 60))}`); return ''; }
  return HTML.slice(i, j);
}

// ═══ 1. pitfall one: no hand-written group literal survives ═════════════
// This is the section that earns the release. Every one of these used to be
// a `{ id, color, memberIds }` object literal sitting in a different function;
// any one of them left behind is a group that loses its name on the next
// save, or a label element that never gets removed from the DOM.
(function () {
  codeCount('function serializeGroup(g) {', 1, 'serializeGroup is declared exactly once');
  codeCount('function makeGroupEl(gd) {', 1, 'makeGroupEl is declared exactly once');
  codeCount('function disposeGroupEl(g) {', 1, 'disposeGroupEl is declared exactly once');

  count('groups: state.groups.map(serializeGroup),', 3,
    'all three live serialisers share one writer');
  count('manifest.groups.push(serializeGroup(groups[k]));', 1,
    'the legacy v4 export shares it too');
  hasNot('groups: state.groups.map(g => ({',
    'no serialiser hand-writes the group shape any more');

  codeCount('state.groups.push({ id: gd.id', 0, 'the undo rebuild literal is gone');
  codeCount('state.groups.push({ id: _gid', 0, 'the load rebuild literal is gone');
  codeCount('const group = { id: gid, color, memberIds:', 0, 'the groupSelected literal is gone');
  // v7.6.0: groupSelected now holds the made group in `newGroup` (so it can
  // open the rename chip). The no-hand-written-shape rule follows the code:
  // a literal under EITHER variable name is the same bug.
  codeCount('newGroup = { id: gid, color, memberIds:', 0, 'the v7.6.0 newGroup literal is gone too');

  count("borderEl.className = 'group-border';", 1,
    'the border element is built in exactly one place');
  codeCount('g.borderEl.remove();', 1,
    'the border element is destroyed in exactly one place (inside disposeGroupEl)');
  count('state.groups.forEach(disposeGroupEl);', 4,
    'undo, load, clear-board and the emergency restore all dispose the same way');
  codeCount('disposeGroupEl(g);', 1, 'ungroup disposes through the shared helper too');

  // The landmine: this dead path called Set.prototype.slice(), which does not
  // exist. It never ran, but reviving it would have thrown.
  codeCount('g.memberIds.slice()', 0,
    'the dead v4 serialiser no longer calls .slice() on a Set');
  // ...and the live mirror of it is fine, because a manifest on disk really
  // does hold arrays.
  codeCount('groups[j].memberIds ? groups[j].memberIds.slice() : []', 1,
    'the live v4 upgrade path still slices an array, which is correct');

  // The name has to travel both ways or it is not saved at all.
  count("name: gd.name, memberIds: gd.memberIds }", 1, 'undo restore carries the name');
  count("name: gd.name, memberIds: (gd.memberIds || []).map(_remapId)", 1,
    'load restore carries the name through the id remap');
  has("name: gd.name || ''", 'a group with no name loads as the empty string, not undefined');
})();

// ═══ 2. the three builders, executed ════════════════════════════════════
section(function () {
  const BLOCK = slice('function serializeGroup(g) {', 'function groupSelected() {');
  ok(BLOCK.length > 500, 'the shared group block is present');

  let appended = 0;
  let undos = 0;
  let saves = 0;
  let selects = 0;
  function makeEl() {
    const listeners = {};
    const el = {
      className: '', textContent: '', style: {}, offsetHeight: 18,
      _removed: false,
      classList: { add: function () {}, remove: function () {} },
      addEventListener: function (t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
      removeEventListener: function (t, fn) {
        const a = listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
      },
      remove: function () { this._removed = true; },
      focus: function () {},
      _fire: function (t, ev) { (listeners[t] || []).slice().forEach(function (fn) { fn(ev); }); },
      _count: function (t) { return (listeners[t] || []).length; }
    };
    // A plain `isContentEditable: false` property is not a DOM: writing
    // `contentEditable` has to be what flips it, because beginGroupRename
    // reads isContentEditable as its "am I already editing?" latch. With a
    // flat property the latch never closes and finish() bails out, so every
    // rename silently does nothing.
    let editable = false;
    Object.defineProperty(el, 'contentEditable', {
      get: function () { return editable ? 'true' : 'false'; },
      set: function (v) { editable = (v === true || v === 'true'); }
    });
    Object.defineProperty(el, 'isContentEditable', { get: function () { return editable; } });
    return el;
  }
  const doc = {
    createElement: function () { return makeEl(); },
    createRange: function () { return { selectNodeContents: function () { selects++; } }; }
  };
  const canvas = { appendChild: function () { appended++; } };
  global.window = { getSelection: function () { return { removeAllRanges: function () {}, addRange: function () {} }; } };

  // v7.6.0 — beginGroupRename now re-places the chip through updateGroupBorder
  // (a nameless chip is display:none, and focus() on one is a no-op). The stub
  // records the call so the rename below can pin it.
  let borderPlacements = 0;
  const api = new Function('canvasContent', 'document', 'pushUndo', 'scheduleAutoSave', 'updateGroupBorder',
    BLOCK + '\nreturn { serializeGroup: serializeGroup, makeGroupEl: makeGroupEl, disposeGroupEl: disposeGroupEl, beginGroupRename: beginGroupRename };'
  )(canvas, doc, function () { undos++; }, function () { saves++; }, function () { borderPlacements++; });

  // --- serializeGroup: what actually reaches disk -------------------------
  (function () {
    const out = api.serializeGroup({
      id: 1, color: '#f00', name: 'Refs/Head',
      memberIds: new Set([3, 1, 2]),
      folderKey: 'Refs/Head', borderEl: {}, labelEl: {}
    });
    eq(JSON.stringify(Object.keys(out).sort()), '["color","id","memberIds","name"]',
      'only the four plain fields reach disk — not folderKey, not the DOM nodes');
    eq(out.name, 'Refs/Head', 'the name is written');
    eq(out.id, 1, 'the id is written');
    eq(out.color, '#f00', 'the colour is written');
    ok(Array.isArray(out.memberIds), 'memberIds is written as an ARRAY — a Set serialises to {}');
    eq(out.memberIds.length, 3, 'every member survives');

    const bare = api.serializeGroup({ id: 2, color: '#0f0', memberIds: new Set() });
    eq(bare.name, '', 'a group with no name still writes an empty name, not undefined');
    eq(bare.memberIds.length, 0, 'an empty group writes an empty member list');
    // The whole .kpak contract: this has to be JSON-round-trippable.
    ok(JSON.parse(JSON.stringify(out)).name === 'Refs/Head',
      'a serialised group survives a JSON round trip');
  })();

  // --- makeGroupEl ---------------------------------------------------------
  (function () {
    appended = 0;
    const g = api.makeGroupEl({ id: 3, color: '#00f', name: 'Refs/Head', memberIds: [7, 8] });
    eq(appended, 2, 'a group appends exactly two elements: the border and the chip');
    eq(g.borderEl.className, 'group-border', 'the border carries its class');
    eq(g.labelEl.className, 'group-label', 'the chip carries its class');
    eq(g.name, 'Refs/Head', 'the group keeps its name');
    eq(g.memberIds.size, 2, 'memberIds comes back as a Set of the ids it was handed');
    ok(g.memberIds.has(7) && g.memberIds.has(8), 'the Set holds the right ids');
    eq(g.labelEl.textContent, 'Refs/Head', 'the chip shows the name');
    eq(g.labelEl.style.display, 'block', 'a named group shows its chip');
    eq(g.labelEl.style.background, '#00f', 'the chip is tinted with the group colour');

    // A manual Ctrl+G group is nameless and must STAY invisible — otherwise
    // every hand-made group on every existing board sprouts an empty label.
    appended = 0;
    const m = api.makeGroupEl({ id: 4, color: '#0ff', memberIds: [1, 2] });
    eq(m.name, '', 'a manual group has no name');
    eq(m.labelEl.style.display, 'none', 'a nameless group hides its chip');
    eq(appended, 2, 'a manual group still builds both elements');

    // A group loaded from a pre-7.4.0 .kpak has no name either.
    const old = api.makeGroupEl({ id: 5, color: '#fff', memberIds: [] });
    eq(old.labelEl.style.display, 'none',
      'a group restored from an old board stays unlabelled instead of showing "undefined"');

    // The chip must not start a marquee when you click it to rename.
    let stopped = 0;
    g.labelEl._fire('mousedown', { stopPropagation: function () { stopped++; } });
    eq(stopped, 1, 'a mousedown on the chip does not reach the canvas');
    eq(g.labelEl._count('dblclick'), 1, 'the chip listens for a double-click');

    // --- rename -----------------------------------------------------------
    undos = 0; saves = 0; selects = 0;
    g.labelEl._fire('dblclick', { stopPropagation: function () {}, preventDefault: function () {} });
    eq(undos, 1, 'renaming pushes undo first, so an accidental edit is undoable');
    eq(g.labelEl.isContentEditable, true, 'a double-click makes the chip editable');
    eq(selects, 1, 'the existing name is selected, so typing replaces it');
    eq(g.labelEl.style.display, 'block', 'v7.6.0: beginning a rename shows the chip (a nameless one starts hidden)');
    ok(borderPlacements >= 1, 'v7.6.0: beginning a rename re-places the chip through updateGroupBorder');

    const key = function (k) { return { key: k, stopPropagation: function () {}, preventDefault: function () {} }; };
    g.labelEl.textContent = '  Faces  ';
    g.labelEl._fire('keydown', key('Enter'));
    eq(g.name, 'Faces', 'Enter commits, with the whitespace collapsed and trimmed');
    eq(g.labelEl.textContent, 'Faces', 'the chip shows the committed name');
    eq(g.labelEl.isContentEditable, false, 'committing leaves edit mode');

    g.labelEl._fire('dblclick', { stopPropagation: function () {}, preventDefault: function () {} });
    g.labelEl.textContent = 'Junk';
    g.labelEl._fire('keydown', key('Escape'));
    eq(g.name, 'Faces', 'Escape reverts, so a mistyped name is not forced on you');

    g.labelEl._fire('dblclick', { stopPropagation: function () {}, preventDefault: function () {} });
    g.labelEl.textContent = '   ';
    g.labelEl._fire('keydown', key('Enter'));
    eq(g.name, 'Faces', 'an empty rename is ignored — the block would vanish otherwise');
    eq(g.labelEl.style.display, 'block', 'the chip is still shown after a rejected empty name');

    g.labelEl._fire('dblclick', { stopPropagation: function () {}, preventDefault: function () {} });
    g.labelEl.textContent = 'Lighting';
    g.labelEl._fire('blur', {});
    eq(g.name, 'Lighting', 'clicking away commits');
    eq(saves, 4, 'every committed rename schedules a save');
    // A second dblclick while already editing must not stack a second undo.
    // Set through contentEditable, like the browser does — isContentEditable
    // is read-only there too.
    g.labelEl.contentEditable = 'true';
    undos = 0;
    g.labelEl._fire('dblclick', { stopPropagation: function () {}, preventDefault: function () {} });
    eq(undos, 0, 'double-clicking while already editing does nothing');
  })();

  // --- disposeGroupEl ------------------------------------------------------
  (function () {
    const g = api.makeGroupEl({ id: 6, color: '#f0f', name: 'X', memberIds: [1] });
    api.disposeGroupEl(g);
    ok(g.borderEl._removed, 'dispose removes the border');
    ok(g.labelEl._removed, 'dispose removes the chip too — the border-only version leaked one');
    let threw = false;
    try { api.disposeGroupEl(null); } catch (e) { threw = true; }
    ok(!threw, 'dispose tolerates a missing group');
    threw = false;
    try { api.disposeGroupEl({}); } catch (e) { threw = true; }
    ok(!threw, 'dispose tolerates a group whose elements were already dropped');
  })();
});

// ═══ 3. the block key, executed ═════════════════════════════════════════
section(function () {
  const TAGS = slice('function folderTagsFromPath(path) {', 'function mergeTags(');
  const HELPER = slice('function folderGroupKey(path) {', 'function libMatches(');
  ok(TAGS.length > 100, 'folderTagsFromPath is present');
  ok(HELPER.length > 500, 'the folder-group helper block is present');

  let timerFn = null, timerMs = -1, timerCalls = 0, borderUpdates = 0, timerId = 0;
  const fakeSetTimeout = function (fn, ms) { timerCalls++; timerFn = fn; timerMs = ms; return ++timerId; };

  function build(state, G) {
    return new Function(
      'folderTagsFromPath', 'state', 'G', 'makeGroupEl', 'GROUP_COLORS', 'updateAllGroupBorders', 'setTimeout',
      TAGS + '\n' + HELPER +
      '\nreturn { folderTagsFromPath: folderTagsFromPath, folderGroupKey: folderGroupKey, addItemToFolderGroup: addItemToFolderGroup, scheduleFolderGroupUpdate: scheduleFolderGroupUpdate };'
    )(
      null, state, G,
      function (gd) { return { id: gd.id, color: gd.color, name: gd.name || '', memberIds: new Set(gd.memberIds || []) }; },
      ['#c0', '#c1', '#c2'],
      function () { borderUpdates++; },
      fakeSetTimeout
    );
  }

  // `folderTagsFromPath` is declared inside the sandbox (TAGS is prepended),
  // so the null argument above is shadowed by the real one.
  const k = build({ groups: [] }, { nextGroupId: 1 }).folderGroupKey;

  eq(k(''), '', 'a loose file has no block key');
  eq(k(null), '', 'a null path has no block key');
  eq(k(undefined), '', 'an undefined path has no block key');
  eq(k('Head'), 'Head', 'a top-level folder keys on its own name');
  eq(k('Refs/Head/Closeup'), 'Refs/Head/Closeup',
    'the key is the FULL path, so two parents can each have a "Head"');
  eq(k('a,b/c'), 'a b/c', 'a comma in a folder name becomes a space, as in the tags');
  eq(k('.'), '', 'a lone dot is not a block');
  eq(k('A/./B'), 'A/B', 'dot segments are dropped from the key');
  eq(k('  Refs / Head  '), 'Refs/Head', 'the key is trimmed segment by segment');

  // --- one block per folder, and the block is reused -----------------------
  (function () {
    const state = { groups: [] };
    const G = { nextGroupId: 1 };
    const api = build(state, G);

    api.addItemToFolderGroup({ id: 1 }, 'A/Head');
    eq(state.groups.length, 1, 'the first file of a folder makes one block');
    eq(state.groups[0].name, 'A/Head', 'the block is named after the full path');
    eq(state.groups[0].folderKey, 'A/Head', 'the block remembers the key it came from');
    eq(state.groups[0].memberIds.size, 1, 'the first file is in it');

    api.addItemToFolderGroup({ id: 2 }, 'A/Head');
    eq(state.groups.length, 1, 'a second file from the same folder JOINS the block');
    eq(state.groups[0].memberIds.size, 2, 'it does not open a second block');

    api.addItemToFolderGroup({ id: 3 }, 'A/Body');
    eq(state.groups.length, 2, 'a second folder opens a second block');
    eq(state.groups[0].memberIds.size, 2, 'the first block is untouched');
    eq(state.groups[1].name, 'A/Body', 'the second block is named after its own path');

    api.addItemToFolderGroup({ id: 4 }, 'B');
    eq(state.groups.length, 3, 'a third folder opens a third block');
    eq(state.groups[0].color, '#c0', 'block colours rotate through the palette');
    eq(state.groups[1].color, '#c1', 'the second block takes the next colour');
    eq(state.groups[2].color, '#c2', 'the third block takes the next colour');

    // Guards: a failed addImage() and a loose file must not conjure a block.
    api.addItemToFolderGroup(null, 'C');
    api.addItemToFolderGroup({ id: 5 }, '');
    api.addItemToFolderGroup({ id: 6 }, null);
    eq(state.groups.length, 3, 'a null item, an empty key or a null key creates nothing');

    // Renaming must not orphan the block: the key still matches, so a later
    // drop of the same folder lands in the block the user renamed.
    const rstate = { groups: [{ id: 9, color: '#c0', name: '第一場', memberIds: new Set([1]), folderKey: 'A/Head' }] };
    const rapi = build(rstate, { nextGroupId: 10 });
    rapi.addItemToFolderGroup({ id: 2 }, 'A/Head');
    eq(rstate.groups.length, 1, 'a renamed block still accepts its folder');
    eq(rstate.groups[0].name, '第一場', 'joining does not overwrite the name the user chose');
    eq(rstate.groups[0].memberIds.size, 2, 'the new file lands in the renamed block');

    // ...but a group with no key (restored from disk, or appended from another
    // board) is never adopted, which is what keeps an appended board's blocks
    // separate from this session's drops.
    const astate = { groups: [{ id: 9, color: '#c0', name: 'A/Head', memberIds: new Set([1]) }] };
    const aapi = build(astate, { nextGroupId: 10 });
    aapi.addItemToFolderGroup({ id: 2 }, 'A/Head');
    eq(astate.groups.length, 2,
      'a keyless group with the same name is NOT adopted — appended boards stay separate');
  })();

  // --- the border refresh is coalesced, not run per file -------------------
  (function () {
    timerFn = null; timerCalls = 0; borderUpdates = 0;
    const api = build({ groups: [] }, { nextGroupId: 1 });
    api.scheduleFolderGroupUpdate();
    api.scheduleFolderGroupUpdate();
    api.scheduleFolderGroupUpdate();
    eq(timerCalls, 1, 'three arrivals in a row schedule one refresh, not three');
    eq(borderUpdates, 0, 'nothing is measured before the timer fires');
    eq(timerMs, 120, 'the refresh is debounced by 120ms');
    ok(typeof timerFn === 'function', 'the debounce carries the work');
    timerFn();
    eq(borderUpdates, 1, 'the deferred pass measures every group once');
    // The latch resets, or a later drop would never refresh again.
    api.scheduleFolderGroupUpdate();
    eq(timerCalls, 2, 'the latch resets once the timer has fired');
  })();
});

// ═══ 4. folder-major import order, executed ═════════════════════════════
// The borders are bounding boxes. If two folders' files interleave, the two
// boxes cover almost the same area and the result is spaghetti — so the ONE
// property that matters is contiguity: every folder occupies one unbroken run.
section(function () {
  const TAGS = slice('function folderTagsFromPath(path) {', 'function mergeTags(');
  const SORT = slice('  function _importTypeRank(f) {', "console.log('[FileDrop] Folder import: '");
  ok(SORT.length > 200, 'the folder-major sort block is present');

  const sort = new Function('folderGroupKey', 'images', 'videos', 'audios',
    SORT + '\nreturn sorted;'
  );

  const tagsFn = new Function(TAGS + '\nreturn folderTagsFromPath;')();
  const key = function (p) { return tagsFn(p).join('/'); };

  const F = function (name, type, p) {
    const f = { name: name, type: type };
    if (p !== undefined) f._kraftedPath = p;
    return f;
  };
  function names(list) { return list.map(function (f) { return f.name; }).join(','); }
  function contiguous(keys) {
    const lastAt = {}, bad = [];
    keys.forEach(function (k, i) {
      if (lastAt[k] !== undefined && lastAt[k] !== i - 1) bad.push(k);
      lastAt[k] = i;
    });
    return bad;
  }

  (function () {
    // Deliberately interleaved: the old images→videos→audio order would emit
    // b.png, a1.png, a2.png, b.mp4, a.mp4, b.mp3, a.mp3.
    const out = sort(key,
      [F('b.png', 'image/png', 'B'), F('a1.png', 'image/png', 'A'), F('a2.png', 'image/png', 'A')],
      [F('b.mp4', 'video/mp4', 'B'), F('a.mp4', 'video/mp4', 'A')],
      [F('b.mp3', 'audio/mpeg', 'B'), F('a.mp3', 'audio/mpeg', 'A')]
    );
    eq(names(out), 'a1.png,a2.png,a.mp4,a.mp3,b.png,b.mp4,b.mp3',
      'everything from A lands before anything from B');
    eq(contiguous(out.map(function (f) { return key(f._kraftedPath); })).length, 0,
      'every folder occupies one unbroken run — this is what stops the spaghetti');
  })();

  (function () {
    const out = sort(key,
      [F('z.png', 'image/png', 'Z'), F('m.png', 'image/png', 'M')], [], []);
    eq(names(out), 'm.png,z.png', 'folders sort by name, not by the order the disk handed them over');
  })();

  (function () {
    // sort() is stable, so inside one (folder, type) bucket the directory
    // traversal order survives. A reference shoot is usually numbered.
    const out = sort(key,
      [F('shot_03.png', 'image/png', 'A'), F('shot_01.png', 'image/png', 'A'), F('shot_02.png', 'image/png', 'A')],
      [], []);
    eq(names(out), 'shot_03.png,shot_01.png,shot_02.png',
      'within one folder and type the original order is preserved');
  })();

  (function () {
    // A loose file dropped alongside a folder has no key, sorts first, and
    // gets no block — so it must not be stranded in the middle of one.
    const out = sort(key,
      [F('z.png', 'image/png', 'Z'), F('loose.png', 'image/png')], [], []);
    eq(names(out), 'loose.png,z.png', 'loose files sort ahead of any folder');
    eq(contiguous(out.map(function (f) { return key(f._kraftedPath); })).length, 0,
      'loose files form their own run at the front');
  })();

  (function () {
    // One folder only: the ordering must be exactly what it was before this
    // release, or every single-folder drop in the product changes shape.
    const out = sort(key,
      [F('i2.png', 'image/png', 'A'), F('i1.png', 'image/png', 'A')],
      [F('v.mp4', 'video/mp4', 'A')],
      [F('a.mp3', 'audio/mpeg', 'A')]);
    eq(names(out), 'i2.png,i1.png,v.mp4,a.mp3',
      'a single-folder drop keeps the old images-then-videos-then-audio order');
  })();

  (function () {
    // Type rank must fall through for the extension-based audio match, which
    // arrives with an empty or non-audio MIME type on some systems.
    const out = sort(key, [], [], [F('a.wav', '', 'A'), F('b.wav', '', 'A')]);
    eq(names(out), 'a.wav,b.wav', 'an unrecognised MIME type still sorts as audio, not before images');
    const mixed = sort(key,
      [F('i.png', 'image/png', 'A')], [], [F('a.wav', '', 'A')]);
    eq(names(mixed), 'i.png,a.wav', 'a typeless audio file still sorts after the images');
  })();
});

// ═══ 5. the chip stays the same size at every zoom ══════════════════════
// The chip lives inside #canvas, which is transformed by state.zoom. Left
// alone it would shrink to nothing at 8% — exactly the zoom at which a
// 300-image board is read. It counter-scales by 1/zoom instead, so its
// on-screen size and its gap above the border have to be CONSTANT.
section(function () {
  const START = '      const _z = Math.max(0.02, Math.min(10, state.zoom || 1));';
  const END = "group.labelEl.style.top = (minY - pad - _lh - 4 / _z) + 'px';";
  const i = HTML.indexOf(START);
  const j = HTML.indexOf(END, i);
  ok(i >= 0 && j > i, 'the chip placement lines are present');
  // Missing anchor -> a harmless stub, NOT 'return null'. Returning null made
  // the caller throw on `r.top`, which killed the run before the
  // "placement lines are present" FAIL could ever be printed.
  const BLOCK = (i >= 0 && j > i)
    ? HTML.slice(i, j + END.length)
    : 'return { transform: "", left: "0px", top: "0px" };';

  const place = new Function('state', 'group', 'minX', 'minY', 'pad',
    BLOCK + '\nreturn { transform: group.labelEl.style.transform, left: group.labelEl.style.left, top: group.labelEl.style.top };'
  );

  const LH = 18;
  function at(zoom) {
    const group = { labelEl: { style: {}, offsetHeight: LH } };
    const r = place({ zoom: zoom }, group, 100, 200, 8);
    const top = parseFloat(r.top);
    const z = Math.max(0.02, Math.min(10, zoom || 1));
    // transform-origin is `left bottom`, so the box scales about its own
    // bottom edge: the layout box is [top, top + LH] and the VISUAL box after
    // scale(1/z) is [top + LH - LH/z, top + LH].
    return {
      z: z,
      transform: r.transform,
      left: parseFloat(r.left),
      visualBottom: top + LH,
      visualTop: top + LH - LH / z
    };
  }

  [0.08, 0.25, 1, 2.5, 8].forEach(function (zoom) {
    const r = at(zoom);
    const borderTop = 200 - 8;
    eq(r.transform, 'scale(' + (1 / r.z) + ')', `at ${zoom}x the chip counter-scales by 1/zoom`);
    near((borderTop - r.visualBottom) * r.z, 4, `at ${zoom}x the gap above the border is 4 screen px`, 1e-9);
    near((r.visualBottom - r.visualTop) * r.z, LH, `at ${zoom}x the chip is ${LH} screen px tall`, 1e-9);
    near((borderTop - r.visualTop) * r.z, 4 + LH, `at ${zoom}x the chip sits ${4 + LH} screen px above the border`, 1e-9);
    eq(r.left, 92, `at ${zoom}x the chip is left-aligned with the border`);
  });

  // The whole point, stated as one property across the range: identical.
  const onScreen = [0.08, 0.25, 1, 2.5, 8].map(function (z) {
    const r = at(z);
    return Math.round((r.visualBottom - r.visualTop) * r.z * 1e6) / 1e6;
  });
  eq(JSON.stringify(onScreen), JSON.stringify(onScreen.map(function () { return LH; })),
    'the chip renders at the same on-screen height from 8% to 800%');

  // A group with no name never gets placed at all — unless it is mid-rename.
  // v7.6.0: creation opens the rename on a nameless chip, so the guard is
  // nameless AND not-editing; an editing chip stays visible and placed.
  has("      group.labelEl.style.display = 'none';",
    'a nameless group hides its chip rather than placing an empty one');
  has("const editing = group.labelEl.classList.contains('editing');\n    if (!group.name && !editing) {",
    'v7.6.0: the guard is nameless AND not-editing, so a mid-rename chip stays placed');
  has("if (group.labelEl) group.labelEl.style.display = 'none';",
    'a group emptied of members hides its chip with its border');
});

// ═══ 6. the chip is wired to the canvas, and only where it matters ══════
(function () {
  has(".group-label { position:absolute;", 'the chip has its own CSS rule');
  has('transform-origin:left bottom;', 'the chip scales about its bottom-left corner');
  has("labelEl.addEventListener('mousedown', function (e) { e.stopPropagation(); });",
    'the chip swallows mousedown so a click cannot start a marquee');
  has("labelEl.addEventListener('dblclick', function (e) {", 'the chip renames on double-click');
  has("if (g.labelEl) g.labelEl.style.background = color;",
    'recolouring a group recolours its chip too');
  has("labelEl.textContent = gd.name || '';", 'the chip text comes from the group name');
  // z-index: the border is deliberately BEHIND the items (z-index 0), but a
  // title sitting behind a picture is not a title.
  has('z-index:9998', 'the chip sits above the items, unlike the border behind them');
  has('pointer-events:auto', 'the chip is clickable, unlike the border it belongs to');
  count('addItemToFolderGroup(', 2,
    'the folder block is joined from exactly one place (declared once, called once)');
})();

// ═══ 7. the tree still agrees with the recorded version ════════════════
(function () {
  const sw = fs.readFileSync(path.resolve(ROOT, 'Krafted/docs/sw.js'), 'utf8');
  const title = (HTML.match(/<title>Krafted v([\d.]+)<\/title>/) || [])[1];
  const konst = (HTML.match(/var KRAFTED_VERSION = '([\d.]+)';/) || [])[1];
  const appv = (sw.match(/const APP_VERSION = '([\d.]+)';/) || [])[1];
  eq(title, STATE.current, 'the title matches the recorded current version');
  eq(konst, STATE.current, 'KRAFTED_VERSION matches the recorded current version');
  eq(appv, STATE.current, 'the service worker matches the recorded current version');
  ok(/^\d+\.\d+\.\d+$/.test(STATE.current), 'the recorded version is MAJOR.MINOR.PATCH');

  // Built from parts, never as a dotted literal: version_scan rewrites every
  // bare MAJOR.MINOR.PATCH it finds in a suite, which would turn a test
  // INPUT into the thing being tested.
  const V = (a, b, c) => `${a}.${b}.${c}`;
  const nums = STATE.current.split('.').map(Number);
  ok(nums[0] === 7 && nums[1] >= 4,
    `this is a minor bump, not a patch: ${STATE.current} is at least ${V(7, 4, 0)}`);
})();

if (fails.length) {
  console.log('');
  fails.forEach(f => console.log('FAIL  ' + f));
  console.log('');
  console.log(`${fails.length} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`ALL PASS (${pass} assertions)`);
