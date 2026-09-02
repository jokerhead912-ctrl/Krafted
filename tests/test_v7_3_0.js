#!/usr/bin/env node
/*
 * test_v7_3_0.js — a dropped folder's name rides along (v7.3.0)
 *
 * WHY THIS SUITE EXISTS
 *   Dragging a folder of references in imported the images but threw the
 *   folder name away, so 200 images from "Head" landed as 200 anonymous
 *   items that the Library could not find.
 *
 *   The path was never missing. _handleEntryDrop() has stamped every dropped
 *   file with `file._kraftedPath` (e.g. "Refs/Head") since v5.5.1 — and
 *   NOTHING ever read it. For the whole life of that line, the folder name
 *   was computed, carried, and dropped on the floor at the last step. So
 *   this release is mostly plumbing: one reader, one writer, nine call
 *   sites.
 *
 *   Three decisions are pinned, because each one has a cheap-looking
 *   alternative that quietly breaks later:
 *
 *   1. The name goes into `tags`, not into `name`, and NOT into a new
 *      `folder` field. tags already round-trips through all three item
 *      serialisers, so this change adds ZERO new persisted state and cannot
 *      break a .kpak written by an older build. A fourth metadata field
 *      would have to be threaded through every serializer, undo and the
 *      Library for no user-visible gain today.
 *   2. Every folder level becomes its own tag, so "Refs/Head" is findable
 *      by either word — the hierarchy is the search index.
 *   3. Commas in a folder name become spaces. The Tags field is
 *      comma-separated, so a folder called "a,b" would silently split into
 *      two tags the first time the user edited any tag on that item.
 *
 *   WHAT IS BEING PINNED
 *   The behaviour of the three helpers (executed, not just grepped), the
 *   fact that all nine import sites funnel through one writer, the absence
 *   of any second hand-written filename assignment, and that no new field
 *   was added to the on-disk format.
 *
 * Usage:  node test_v7_3_0.js
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
function before(first, second, label) {
  const a = HTML.indexOf(first);
  const b = HTML.indexOf(second);
  ok(a >= 0 && b >= 0 && a < b, `${label}  (at ${a} / ${b})`);
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
// Scope an assertion to ONE function. A global indexOf is satisfied by an
// identically-spelled lookalike anywhere in a 2 MB file: `newItem.filename =`
// also appears in the duplicate path, and `window.toast(` appears hundreds of
// times, so both reported "in the right order" against the wrong code.
function fnWindow(sig, len) {
  const i = HTML.indexOf(sig);
  return i < 0 ? null : HTML.slice(i, i + (len || 4000));
}

// ═══ 1. the helpers, executed rather than admired ══════════════════════
// Sliced straight out of the app so there is no second implementation of the
// rule being tested. `scheduleAutoSave` is the only global they touch.
const START = HTML.indexOf('function folderTagsFromPath(path) {');
const END = HTML.indexOf('function libMatches(');
ok(START >= 0, 'folderTagsFromPath is declared');
ok(END > START, 'the helper block sits before libMatches');
const BLOCK = HTML.slice(START, END > START ? END : START);

let saves = 0;
// v7.4.0: the slice now also covers folderGroupKey / addItemToFolderGroup,
// which applyImportMeta calls, so the sandbox has to stand in for the group
// machinery. They are lazy (a function declaration is only resolved when it
// runs), which is why the block still evaluates without them — but an import
// WITH a folder path would throw the moment it tried to join the group.
const api = new Function(
  'scheduleAutoSave', 'state', 'G', 'makeGroupEl', 'GROUP_COLORS', 'updateAllGroupBorders', 'setTimeout',
  BLOCK + '\nreturn { folderTagsFromPath: folderTagsFromPath, mergeTags: mergeTags, applyImportMeta: applyImportMeta };'
)(
  function () { saves++; },
  { groups: [] },
  { nextGroupId: 1 },
  function (gd) { return { id: gd.id, color: gd.color, name: gd.name || '', memberIds: new Set(gd.memberIds || []) }; },
  ['#ffffff'],
  function () {},
  function () { return 0; }
);

(function () {
  const f = api.folderTagsFromPath;
  eq(JSON.stringify(f('')), '[]', 'an empty path yields no tags');
  eq(JSON.stringify(f(null)), '[]', 'a null path yields no tags');
  eq(JSON.stringify(f(undefined)), '[]', 'an undefined path yields no tags');
  eq(JSON.stringify(f('Head')), '["Head"]', 'a single folder yields one tag');
  eq(JSON.stringify(f('Refs/Head')), '["Refs","Head"]', 'two levels yield two tags');
  eq(JSON.stringify(f('Refs/Head/Closeup')), '["Refs","Head","Closeup"]',
    'every level becomes its own tag, so the hierarchy is searchable');
  eq(JSON.stringify(f('a,b/c')), '["a b","c"]',
    'a comma inside a folder name becomes a space, not a tag separator');
  eq(JSON.stringify(f('  Spaced  /  Out  ')), '["Spaced","Out"]', 'segments are trimmed');
  eq(JSON.stringify(f('A  B')), '["A B"]', 'runs of whitespace collapse to one space');
  eq(JSON.stringify(f('a/./b/../c')), '["a","b","c"]', '"." and ".." are not tags');

  // The comma rule stated as a property, not as one example: any folder name
  // the filesystem can produce must round-trip through the comma-separated
  // Tags field without multiplying.
  const nasty = ['x,y', 'a, b, c', ',,,', 'Refs,/Head', '  ,  ', 'A,B/C,D'];
  let commas = 0;
  nasty.forEach(function (p) {
    f(p).forEach(function (t) { if (String(t).indexOf(',') >= 0) commas++; });
  });
  eq(commas, 0, 'no tag ever contains a comma, whatever the folder is called');
})();

(function () {
  const m = api.mergeTags;
  eq(JSON.stringify(m(['A'], ['B'])), '["A","B"]', 'merge appends');
  eq(JSON.stringify(m(['A'], ['a'])), '["A"]',
    'merge is case-insensitive, so two drops of the same folder do not double up');
  eq(JSON.stringify(m(undefined, ['X'])), '["X"]', 'merge works when the item has no tags yet');
  eq(JSON.stringify(m(null, [])), '[]', 'merge of nothing into nothing is empty');

  // Copy, do not mutate: the caller's array is the item's own tags array,
  // and mutating it in place is how an undo snapshot ends up already changed.
  const src = ['keep'];
  m(src, ['added']);
  eq(JSON.stringify(src), '["keep"]', 'merge does not mutate the array it was handed');
})();

(function () {
  const a = api.applyImportMeta;
  function mkItem(over) {
    const it = { filename: '', tags: undefined, el: { badge: null, _setFilenameBadge: function (n) { this.badge = n; } } };
    return Object.assign(it, over || {});
  }
  function mkFile(name, p) {
    const f = { name: name, _kraftedPath: p };
    if (p === undefined) delete f._kraftedPath;
    return f;
  }

  // filename: the drop path never set it for images at all (only video and
  // paste did), so a dragged image showed a blob UUID in the Library.
  saves = 0;
  let it = a(mkItem(), mkFile('shot_01.png', 'Refs/Head'));
  eq(it.filename, 'shot_01.png', 'an import records the file name');
  eq(JSON.stringify(it.tags), '["Refs","Head"]', 'an import records the folder path as tags');
  eq(it.el.badge, 'shot_01.png', 'the media badge is updated with the file name');
  eq(saves, 1, 'a tagged import schedules a save so the tags reach disk');

  // untouched when already known: a paste into an item that already has a
  // name must not be renamed by a later import.
  it = a(mkItem({ filename: 'mine.png' }), mkFile('other.png', 'Refs'));
  eq(it.filename, 'mine.png', 'an existing file name is not overwritten');

  // merge, never overwrite
  it = a(mkItem({ tags: ['lighting'] }), mkFile('x.png', 'Refs/Head'));
  eq(JSON.stringify(it.tags), '["lighting","Refs","Head"]', 'folder tags merge into existing tags');

  // no folder path (a plain file drop, or a paste) -> no tags, no save
  saves = 0;
  it = a(mkItem(), mkFile('loose.png', undefined));
  eq(it.filename, 'loose.png', 'a loose file still gets its file name');
  eq(it.tags, undefined, 'a file with no folder path gains no tags');
  eq(saves, 0, 'an import that adds nothing does not schedule a save');

  // top-level file dropped beside a folder: path is '' -> no tags
  it = a(mkItem(), mkFile('loose2.png', ''));
  eq(it.tags, undefined, 'an empty folder path is not a tag');

  // null-safety: three call sites can hand over a failed addImage().
  // Asserted as "does not throw" rather than left to crash the process: an
  // uncaught TypeError exits non-zero, which a mutation runner would score
  // as a catch while the suite prints no FAIL line and every assertion
  // after this one is silently skipped.
  ok(a(null, mkFile('a.png', 'R')) === null, 'a null item is returned untouched');
  saves = 0;
  it = mkItem();
  let threw = false;
  try { a(it, null); } catch (e) { threw = true; }
  ok(!threw, 'a null file does not throw - the guard hands the item straight back');
  eq(it.filename, '', 'a null file leaves the item alone');
  eq(saves, 0, 'a null file schedules nothing');

  // the return value is the item, so call sites can stay one-liners
  it = mkItem();
  ok(a(it, mkFile('r.png', 'R')) === it, 'applyImportMeta returns the same item it was given');
})();

// ═══ 2. the folder path is read, not just written ══════════════════════
(function () {
  has('file._kraftedPath = path;', '_handleEntryDrop still stamps the folder path onto each file');
  has('folderTagsFromPath(file._kraftedPath)', 'the writer reads the path');
  has('folderTagsFromPath(f._kraftedPath)', 'the import toast reads the path too');
  const reads = (HTML.match(/_kraftedPath/g) || []).length;
  ok(reads >= 3, `the folder path is written once and read at least twice (${reads} occurrences)`);

  // The stamp must live in the folder reader, not somewhere that happens to
  // mention the field. Source order cannot express this (the reader is
  // defined 800 KB further down the file than the helper that consumes it),
  // so the assertion is scoped to the function that owns the behaviour.
  const entryDrop = fnWindow('function _handleEntryDrop(e, entries) {', 2500);
  ok(entryDrop !== null, '_handleEntryDrop is present');
  ok(entryDrop && entryDrop.indexOf('file._kraftedPath = path;') >= 0,
    'the path is stamped inside the folder reader, where the entry tree is walked');
})();

// ═══ 3. one writer, nine call sites ════════════════════════════════════
// Pitfall one: an import rule written once per call site is a rule that will
// drift. Every path that turns a File into an item must go through the same
// function, including the ones that carry no folder (paste, the audio upload
// button) — otherwise the next person adds a tenth site by copying a sibling.
(function () {
  codeCount('function applyImportMeta(item, file) {', 1, 'applyImportMeta is declared exactly once');
  const decl = (CODE.match(/function applyImportMeta\(item, file\) \{/g) || []).length;
  const calls = (CODE.match(/applyImportMeta\(/g) || []).length - decl;
  eq(calls, 9, 'nine import sites funnel through one writer');

  codeCount('applyImportMeta(addImage(', 4,
    'both image branches of the drop and of the paste are wrapped');
  codeCount('applyImportMeta(addAudioItem(', 3,
    'the drop, paste and audio-upload sites are wrapped');
  codeCount('applyImportMeta(newItem, file);', 1, 'the drop video site is wrapped');
  codeCount('applyImportMeta(newItem, f);', 1, 'the paste video site is wrapped');

  // The second-hand-copy detector: if anyone reinstates a hand-rolled
  // filename assignment next to a call site, the one-writer rule is already
  // broken even though every assertion above still passes.
  hasNot('newItem.filename = file.name;', 'no call site assigns item.filename by hand any more');
  hasNot('newItem.filename = f.name;', 'the paste path does not assign item.filename by hand either');

  // Scoped, because `newItem.filename =` also survives in the duplicate path
  // (a copy is named after its original) — which is correct and is not an
  // import. What must be true is that neither IMPORT handler writes it.
  const fileDrop = fnWindow('function _handleFileDrop(e, files) {', 8000);
  ok(fileDrop !== null, '_handleFileDrop is present');
  ok(fileDrop && fileDrop.indexOf('newItem.filename =') < 0,
    'the drop handler does not write item.filename itself');
  const pasteH = fnWindow("document.addEventListener('paste', e => {", 12000);
  ok(pasteH !== null, 'the paste handler is present');
  ok(pasteH && pasteH.indexOf('newItem.filename =') < 0,
    'the paste handler does not write item.filename itself');
  // The one surviving write is the duplicate path, and it is not an import.
  has("newItem.filename = item.filename || '';",
    'the only other newItem.filename write is the duplicate path, which copies an existing name');
})();

// ═══ 4. no new persisted field — this is why tags, not `folder` ═════════
(function () {
  // tags already round-trips through all three item serialisers. That is the
  // entire argument for storing the folder name as a tag: the on-disk format
  // does not change, so a .kpak saved by 7.2.1 still opens and a board saved
  // by 7.3.0 still opens in 7.2.1 (it just shows no folder tags).
  count("name: i.name || '', note: i.note || '', tags: i.tags ? i.tags.slice() : []", 3,
    'all three serialisers still carry name/note/tags, unchanged');
  hasNot('folder: i.folder', 'no fourth metadata field was added to the serialisers');
  hasNot('i.folder ||', 'no restore path reads a folder field');
})();

// ═══ 5. the import toast says where the tags came from ═════════════════
// Silent metadata is metadata the user cannot trust. Dropping a folder must
// name the folder AND say the name was kept, otherwise the tags look like
// something the app invented.
(function () {
  has(' - folder name saved as tag', 'the folder import toast says the name was kept');
  has("' + sorted.length + ' files from folder' + _fLabel", 'the toast names the folder(s) dropped');

  // The label is quote arithmetic, and the first version of it was wrong in
  // an invisible way: a single folder produced  "Head""  (a stray closing
  // quote that only shows up on screen). Executed, not grepped, because
  // "the line is present" is exactly what the broken version passed.
  // Slice ends after the _fLabel line, NOT at the toast: v7.4.0 appended a
  // block-count between them, and pulling that in drags `sorted` and
  // `folderGroupKey` into a sandbox that has neither.
  const at = HTML.indexOf('    var _fShown =');
  const labelAt = HTML.indexOf('var _fLabel = _fNames.length', at);
  const to = labelAt >= 0 ? HTML.indexOf('\n', labelAt) + 1 : -1;
  ok(at >= 0 && to > at, 'the folder label is built by its own three lines');
  const label = new Function('_fNames', HTML.slice(at, to) + '\nreturn _fLabel;');
  eq(label(['Head']), ' "Head"', 'one folder reads "Head"');
  eq(label(['A', 'B']), ' "A", "B"', 'two folders read "A", "B"');
  eq(label(['A', 'B', 'C']), ' "A", "B" +1', 'three folders collapse the tail into a count');
  eq(label(['A', 'B', 'C', 'D']), ' "A", "B" +2', 'four folders report the two that were dropped');
  eq(label([]), '', 'no folder means no label, not a dangling quote');

  // Inside _finishFolderImport the list has to be built before it is used.
  // v7.4.0 added the folder-major sort inside this function, so the window
  // has to be wide enough to still reach the toast at the end of it.
  const fin = fnWindow('function _finishFolderImport(e, allFiles) {', 4000);
  ok(fin !== null, '_finishFolderImport is present');
  const iNames = fin ? fin.indexOf('var _fNames = [];') : -1;
  const iToast = fin ? fin.indexOf('window.toast(') : -1;
  ok(iNames >= 0 && iToast >= 0 && iNames < iToast,
    `the folder list is built before the toast fires (${iNames} / ${iToast})`);
})();

// ═══ 6. the tree still agrees with the recorded version ════════════════
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
  ok(nums[0] === 7 && nums[1] >= 3,
    `this is a minor bump, not a patch: ${STATE.current} is at least ${V(7, 3, 0)}`);
})();

if (fails.length) {
  console.log('');
  fails.forEach(f => console.log('FAIL  ' + f));
  console.log('');
  console.log(`${fails.length} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`ALL PASS (${pass} assertions)`);
