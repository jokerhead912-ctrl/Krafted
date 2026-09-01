#!/usr/bin/env node
/*
 * test_v7051.js — P0-2 (item Reference metadata) + P1-1 (searchable Library) (v7.0.51).
 *
 * WHY THIS SUITE EXISTS
 *   The locked roadmap (krafted-proposals-2026-08.md, order law P0-2 -> P1-1 ->
 *   minimap) added two things in one change:
 *
 *     P0-2  every item gets name / note / tags, edited in a new Reference
 *           section of the Properties panel that sits ABOVE Transform, and
 *           round-tripped through every save/load path.
 *     P1-1  a searchable Library sidebar: a thumbnail + name + tags per item,
 *           filtered live by name / note / tag, and clicking a row flies to
 *           and selects that item.
 *
 *   The two are coupled: the Library is fed by the Reference metadata, so this
 *   suite pins the SHAPE of both, not just today's strings. The recurring
 *   root cause on this project is "one behaviour, N hand-written copies" — so
 *   where a value is written in several places (the five persistence paths,
 *   the three meta writers), the suite pins the count as well as the presence.
 *
 * Usage:  node test_v7051.js [path-to-kraftpub.html]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2]
  || path.resolve(__dirname, '../../kraftpub-dev.html');
const SRC = fs.readFileSync(FILE, 'utf8');

let pass = 0;
const fails = [];
function ok(cond, label) { if (cond) { pass++; } else { fails.push(label); } }
function eq(a, b, label) {
  ok(a === b, `${label}  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}
function has(needle, label, hay) {
  ok((hay || SRC).indexOf(needle) >= 0, `${label}  (missing: ${JSON.stringify(needle.slice(0, 70))})`);
}
function hasNot(needle, label, hay) {
  ok((hay || SRC).indexOf(needle) < 0, `${label}  (should be absent: ${JSON.stringify(needle.slice(0, 70))})`);
}
function count(needle, hay) {
  let n = 0, i = 0;
  for (;;) { const j = (hay || SRC).indexOf(needle, i); if (j < 0) break; n++; i = j + 1; }
  return n;
}

// ── extract a shipped top-level function by brace matching ─────────────
function fnFull(name, hay) {
  const i = (hay || SRC).indexOf('function ' + name + '(');
  if (i < 0) return '';
  let d = 0, started = false;
  for (let j = i; j < (hay || SRC).length; j++) {
    const c = (hay || SRC)[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return (hay || SRC).slice(i, j + 1); }
  }
  return '';
}

// ═══ 1. the item model — three metadata fields, one writer ═══════════
ok(fnFull('setItemMeta', SRC).length > 0, 'setItemMeta exists');
ok(fnFull('splitTags', SRC).length > 0, 'splitTags exists');
const sim = fnFull('setItemMeta', SRC);
has("if (field === 'name') it.name = value || '';", 'setItemMeta writes the name field', sim);
has("else if (field === 'note') it.note = value || '';", 'setItemMeta writes the note field', sim);
has("else if (field === 'tags') it.tags = splitTags(value);", 'setItemMeta writes tags through splitTags', sim);
has("try { scheduleAutoSave(); } catch (e) {}", 'setItemMeta triggers an auto-save', sim);
has('renderLibraryPanel()', 'setItemMeta refreshes the Library while it is open', sim);

// splitTags is pure — execute it and check the actual comma/trim/drop-empty maths.
const st = fnFull('splitTags', SRC);
has("String(s).split(',').map(function (t) { return t.trim(); })", 'splitTags splits on commas and trims', st);
has(".filter(function (t) { return t.length; })", 'splitTags drops empty tags', st);
let stApi = null;
try { stApi = new Function(st + '\nreturn { splitTags };')(); } catch (e) {}
if (stApi) {
  eq(stApi.splitTags('a, b ,, c').join('|'), 'a|b|c', 'splitTags: comma + trim + drop-empty');
  eq(stApi.splitTags('').length, 0, 'splitTags: empty string -> []');
  eq(stApi.splitTags('  one  ').join('|'), 'one', 'splitTags: a single value is trimmed');
}

// ═══ 2. the Reference section sits ABOVE Transform ═══════════════════
// Locked order law: Reference must be above Transform in the Properties panel.
// If a future edit swaps them, the metadata the Library/script export depend on
// is no longer where the user expects it.
const refMarker = '<!-- REFERENCE (P0-2';
const tfMarker = '<!-- TRANSFORM';
const iRef = SRC.indexOf(refMarker);
const iTf = SRC.indexOf(tfMarker);
ok(iRef >= 0 && iTf >= 0, 'both the Reference and Transform section markers exist');
ok(iRef < iTf, 'the Reference section is placed ABOVE Transform (locked order)');

// The three inputs wire to the single writer with the correct field name.
has("oninput=\"setItemMeta('name', this.value)\"", 'the Name input writes the name field');
has("oninput=\"setItemMeta('note', this.value)\"", 'the Note input writes the note field');
has("oninput=\"setItemMeta('tags', this.value)\"", 'the Tags input writes the tags field');
has("id=\"prop-name\"", 'the Name input has a stable id (updatePropsPanel targets it)');
has("id=\"prop-note\"", 'the Note input has a stable id');
has("id=\"prop-tags\"", 'the Tags input has a stable id');

// ═══ 3. updatePropsPanel fills all three back in ═════════════════════
// Selecting an item must repopulate the Reference fields, or the panel lies
// about what the item currently holds.
const upp = SRC.slice(SRC.indexOf("var pn = document.getElementById('prop-name')"),
                       SRC.indexOf("var pn = document.getElementById('prop-name')") + 400);
has("pn.value = item.name || ''", 'updatePropsPanel fills the Name field', upp);
has("pnote.value = item.note || ''", 'updatePropsPanel fills the Note field', upp);
has("ptags.value = (item.tags && item.tags.length) ? item.tags.join(', ') : '';",
    'updatePropsPanel fills the Tags field (comma-joined)', upp);

// ═══ 4. the Library panel DOM + CSS ═════════════════════════════════
has('id="library-panel"', 'the Library panel element exists');
const libHtml = SRC.slice(SRC.indexOf('id="library-panel"'),
                          SRC.indexOf('id="library-panel"') + 440);
has('class="collapsed"', 'the Library panel starts collapsed', libHtml);
has('onclick="toggleLibraryPanel()"', 'the library toggle button calls toggleLibraryPanel', libHtml);
has('id="library-search"', 'the library search box exists', libHtml);
has("oninput=\"renderLibraryPanel()\"", 'typing in the search re-renders the Library', libHtml);
has('id="library-list"', 'the library list container exists', libHtml);

has('#library-panel { position:fixed;', 'the Library panel is a fixed overlay (not clipped by the board)');
has('z-index:9999998', 'the Library panel sits above the canvas and reframe overlay');
has('.lib-row', 'library rows carry a clickable class');
has('.prop-row.note-row', 'the Note row uses the multiline (textarea) layout');

// ═══ 5. the Library functions ═══════════════════════════════════════
ok(fnFull('toggleLibraryPanel', SRC).length > 0, 'toggleLibraryPanel exists');
ok(fnFull('libThumbSrc', SRC).length > 0, 'libThumbSrc exists');
ok(fnFull('renderLibraryPanel', SRC).length > 0, 'renderLibraryPanel exists');
ok(fnFull('revealItem', SRC).length > 0, 'revealItem exists (the row-click target)');
ok(fnFull('selectOnly', SRC).length > 0, 'selectOnly exists (the row-click target)');

const rlp = fnFull('renderLibraryPanel', SRC);
has("it.type === 'draw' || it.isDraw", 'renderLibraryPanel skips draw items', rlp);
has("var q = ((document.getElementById('library-search').value) || '').toLowerCase().trim();",
    'renderLibraryPanel reads the live search query', rlp);
// v7.0.53: the filter now DELEGATES to libMatches so the minimap can tint the
// same set of items. Re-pointed, not relaxed: the list must call the shared
// predicate, and the shared predicate must still match all three fields.
has('return libMatches(it, q);',
    'renderLibraryPanel filters through the shared libMatches predicate', rlp);
const lm = fnFull('libMatches', SRC);
ok(lm.length > 0, 'libMatches exists (shared by the list and the minimap)');
has("var hay = [it.name, it.note, (it.tags || []).join(' ')].join(' ').toLowerCase();",
    'libMatches searches name + note + tags', lm);
has("hay.indexOf(q) >= 0", 'libMatches uses a substring match, not an exact equal', lm);
has('if (!q) return true;', 'libMatches treats an empty query as "everything matches"', lm);
has('selectOnly(it.id)', 'clicking a row selects only that item', rlp);
has('revealItem(it)', 'clicking a row flies to / reveals the item', rlp);

const lts = fnFull('libThumbSrc', SRC);
has('it.isVideo', 'libThumbSrc prefers the video poster for video items', lts);
has('it.img && it.img.src', 'libThumbSrc falls back to the item <img> src', lts);

const tlp = fnFull('toggleLibraryPanel', SRC);
has("p.classList.toggle('collapsed')", 'toggleLibraryPanel flips the collapsed state', tlp);
has("localStorage.setItem('krafted_library_collapsed'", 'toggleLibraryPanel remembers the state', tlp);

// ═══ 6. persistence — all five paths carry name / note / tags ═══════
// The metadata is worthless if a save or a reload drops it. There are three
// in-app save paths, one kpak manifest, and one load path. The COUNT is pinned
// because the whole point of the regression is "a copy got missed".
eq(count("name: i.name || '', note: i.note || '', tags: i.tags ? i.tags.slice() : [],"),
   3, 'all three save paths persist name / note / tags');
has("name: it.name || '', note: it.note || '', tags: it.tags ? it.tags.slice() : [],",
    'the kpak manifest carries name / note / tags');
has("name: n.name || '', note: n.note || '', tags: n.tags ? n.tags.slice() : [],",
    'the load path reads name / note / tags back');

// ═══ 7. registry + dispatch ════════════════════════════════════════
has("{ id: 'library-toggle-panel', category: 'View',  label: 'Toggle Library Panel',     keys: [] },",
    'the Library toggle is registered in the shortcut registry');
has("case 'library-toggle-panel':   toggleLibraryPanel(); return true;",
    'the Library toggle is dispatched through the registry');

// ═══ report ═══════════════════════════════════════════════════════
console.log(`\ntest_v7051.js — Reference metadata + Library (v7.2.1)`);
console.log(`${'-'.repeat(46)}`);
if (fails.length) {
  fails.forEach(f => console.log(`  FAIL  ${f}`));
  console.log(`${'-'.repeat(46)}`);
  console.log(`${pass} passed, ${fails.length} FAILED`);
  process.exit(1);
}
console.log(`${pass} passed, 0 failed`);
