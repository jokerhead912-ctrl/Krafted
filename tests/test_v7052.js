#!/usr/bin/env node
/*
 * test_v7052.js — Library panel: it actually keeps up with the board (v7.0.52).
 *
 * WHY THIS SUITE EXISTS
 *   v7.0.51 shipped P0-2 + P1-1 and every suite went green. It was still not
 *   good, because the suites only pinned that the code EXISTED, never that the
 *   panel stayed correct while the board moved under it. Four real defects:
 *
 *     1. STALE LIST. renderLibraryPanel() ran only on search input, on toggle,
 *        on a metadata edit and on a row click. Nothing re-ran it when items
 *        were added, deleted, pasted, imported, undone or loaded. Delete an
 *        item and it stayed in the list - and clicking it called revealItem()
 *        on a dead object, flying the camera at nothing.
 *     2. NO 'WHERE AM I'. The .active highlight only moved when the list was
 *        rebuilt, so selecting an item on the canvas left the highlight behind.
 *     3. AMNESIA. krafted_library_collapsed was written on toggle but never
 *        read back, so the panel forgot whether you had opened it, every reload.
 *     4. 300 <img> NODES PER KEYSTROKE. Every row holds a full-resolution data
 *        URL, rebuilt on each character typed.
 *
 *   The fix keeps two jobs apart, because they fire at very different rates:
 *     requestLibraryRefresh() = contents changed  -> rebuild, debounced
 *     libSyncActive()         = selection changed -> flip classes, never rebuild
 *
 *   Where a behaviour is CHEAP TO EXECUTE, this suite executes it rather than
 *   grepping for it. "The debounce coalesces three calls into one rebuild" is a
 *   claim about behaviour; asserting on a string cannot tell you whether the
 *   guard flag is actually wired up.
 *
 * Usage:  node test_v7052.js [path-to-kraftpub.html]
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

// An executable block that throws must be recorded as ONE failure, not allowed
// to kill the run. Without this, a mutation that makes the extracted source
// un-instantiable (a stub the code now needs, a brace knocked out of place)
// takes the whole report down with it - and a mutation caught by a crash is a
// mutation caught for the wrong reason, since nothing was actually asserted.
function attempt(label, fn) {
  try { fn(); }
  catch (e) { fails.push(label + '  (threw: ' + ((e && e.message) || e) + ')'); }
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

// Build a real function out of shipped source plus injected module state.
// This is what turns "the code says so" into "the code does so".
function instantiate(body, stateDecls, stubs) {
  const keys = Object.keys(stubs);
  const f = new Function(...keys, stateDecls + '\n' + body + '\nreturn ' + stubs.__ret + ';');
  return f(...keys.map(k => stubs[k]));
}

// ═══ 1. the contents-refresh path ═════════════════════════════════════
const rrfBody = fnFull('requestLibraryRefresh', SRC);
ok(rrfBody.length > 0, 'requestLibraryRefresh exists');

has("if (!p || p.classList.contains('collapsed')) return;",
    'a collapsed panel is never rebuilt', rrfBody);
has('if (_libRefreshPending) return;',
    'a second change inside the same frame does not queue a second rebuild', rrfBody);
has('_libRefreshPending = false; renderLibraryPanel();',
    'the queued run clears the guard before rebuilding', rrfBody);
has("if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);",
    'the rebuild is coalesced into the next frame when rAF exists', rrfBody);
has('else setTimeout(run, 60);',
    'and falls back to a timer where rAF does not', rrfBody);
// Deliberately NOT asserting on how the deferral is formatted. "It is deferred"
// is the behaviour worth pinning, and the executable check below is what proves
// it; a shape assertion here would only fail on a future re-wrap.

// EXECUTE IT: three mutations in one frame must produce exactly one rebuild.
attempt('executable: the refresh debounce', () => {
  let rebuilds = 0;
  const queue = [];
  const panel = { classList: { contains: () => false } };
  const refresh = instantiate(rrfBody, 'var _libRefreshPending = false;', {
    __ret: 'requestLibraryRefresh',
    document: { getElementById: (id) => (id === 'library-panel' ? panel : null) },
    requestAnimationFrame: (fn) => { queue.push(fn); },
    setTimeout: (fn) => { queue.push(fn); },
    renderLibraryPanel: () => { rebuilds++; }
  });
  refresh(); refresh(); refresh();
  eq(rebuilds, 0, 'three changes queue nothing synchronously');
  eq(queue.length, 1, 'three changes queue exactly one rebuild, not three');
  while (queue.length) queue.shift()();
  eq(rebuilds, 1, 'flushing the frame rebuilds once');
  refresh();
  eq(queue.length, 1, 'the guard cleared, so a later change queues again');
});

// EXECUTE IT: a collapsed panel must not even queue, or opening it later
// would pay for rebuilds queued while it was shut.
attempt('executable: a collapsed panel stays quiet', () => {
  let rebuilds = 0;
  const queue = [];
  const panel = { classList: { contains: () => true } };
  const refresh = instantiate(rrfBody, 'var _libRefreshPending = false;', {
    __ret: 'requestLibraryRefresh',
    document: { getElementById: (id) => (id === 'library-panel' ? panel : null) },
    requestAnimationFrame: (fn) => { queue.push(fn); },
    setTimeout: (fn) => { queue.push(fn); },
    renderLibraryPanel: () => { rebuilds++; }
  });
  refresh(); refresh();
  eq(queue.length, 0, 'a collapsed panel queues no rebuild at all');
  eq(rebuilds, 0, 'a collapsed panel never rebuilds');
});

// The funnel. Every board mutation already passes through scheduleAutoSave,
// so hooking it there is what stops the import / delete / paste / undo / load
// paths from each needing their own call they will forget to add.
const sasBody = fnFull('scheduleAutoSave', SRC);
ok(sasBody.length > 0, 'scheduleAutoSave exists');
has('try { requestLibraryRefresh(); } catch (e) {}',
    'every board mutation funnels through scheduleAutoSave into a Library refresh', sasBody);

// ═══ 2. the selection-sync path ═══════════════════════════════════════
const lsaBody = fnFull('libSyncActive', SRC);
ok(lsaBody.length > 0, 'libSyncActive exists');

hasNot('createElement', 'libSyncActive never builds DOM - it only moves a class', lsaBody);
hasNot('innerHTML', 'libSyncActive never wipes the list', lsaBody);
has("var rows = p.querySelectorAll('.lib-row[data-id]');",
    'libSyncActive walks rows by data-id', lsaBody);
has('if (id === _libActiveId) return;',
    'libSyncActive early-outs when the selection has not moved', lsaBody);
has("found.scrollIntoView({ block: 'nearest' });",
    'the newly active row is scrolled into view', lsaBody);

// EXECUTE IT: flipping the highlight must not touch the rows it did not win.
attempt('executable: the highlight follows the selection', () => {
  const log = { add: [], remove: [], scrolls: 0, reads: 0 };
  const mkRow = (id) => ({
    _id: id,
    getAttribute: function () { log.reads++; return this._id; },
    classList: {
      add: function (c) { log.add.push(this.__row + ':' + c); },
      remove: function (c) { log.remove.push(this.__row + ':' + c); }
    },
    scrollIntoView: function () { log.scrolls++; }
  });
  const rows = [mkRow('a'), mkRow('b'), mkRow('c')];
  rows.forEach((r, i) => { r.classList.__row = 'row' + i; r.classList.add = function (c) { log.add.push('row' + i + ':' + c); }; });
  rows.forEach((r, i) => { r.classList.remove = function (c) { log.remove.push('row' + i + ':' + c); }; });

  const panel = { classList: { contains: () => false }, querySelectorAll: () => rows };
  // createElement is stubbed on purpose: if libSyncActive ever starts building
  // DOM, this sandbox lets it run to completion so the assertion reports the
  // regression, instead of a TypeError masking it as an infrastructure crash.
  let built = 0;
  const sync = instantiate(lsaBody, 'var _libActiveId = null;', {
    __ret: 'libSyncActive',
    document: {
      getElementById: (id) => (id === 'library-panel' ? panel : null),
      createElement: () => { built++; return {}; }
    },
    getSelectedItems: () => [{ id: 'b' }]
  });
  sync();
  eq(log.add.length, 1, 'selecting b highlights exactly one row');
  ok(log.add[0] === 'row1:active', 'the highlighted row is the selected item (row1 = b)');
  eq(log.remove.length, 2, 'the other two rows lose the highlight');
  eq(log.scrolls, 1, 'the active row is scrolled into view once');

  const readsAfterFirst = log.reads;
  sync();
  eq(log.reads, readsAfterFirst, 'a repeat call with the same selection does no work at all');
  eq(built, 0, 'syncing the highlight builds no DOM at all');
});

// The hook: refreshSelection is where every select / deselect ends up.
const rs = fnFull('refreshSelection', SRC);
ok(rs.length > 0, 'refreshSelection exists');
has('try { libSyncActive(); } catch (e) {}',
    'refreshSelection keeps the Library highlight in step', rs);
has('updatePropsPanel();', 'refreshSelection still drives the Properties panel', rs);

// ═══ 3. the list itself ═══════════════════════════════════════════════
const rlp = fnFull('renderLibraryPanel', SRC);
ok(rlp.length > 0, 'renderLibraryPanel exists');

has("row.setAttribute('data-id', String(it.id));",
    'each row carries its item id, which libSyncActive depends on', rlp);
has('_libActiveId = activeId ? String(activeId) : null;',
    'a rebuild resets the active-id cache, so the next sync is not skipped', rlp);
has('var shown = items.length > LIB_ROW_CAP ? items.slice(0, LIB_ROW_CAP) : items;',
    'the row count is capped for large boards', rlp);
has('shown.forEach(function (it) {', 'the loop walks the capped slice', rlp);
hasNot('items.forEach(function (it) {',
       'the loop no longer walks the uncapped list', rlp);
has("more.className = 'lib-more';",
    'a cap is announced rather than silently truncating the list', rlp);
has("more.textContent = '+ ' + (items.length - shown.length) + ' more - refine the search';",
    'the footer says how many rows are hidden', rlp);
has('var LIB_ROW_CAP = 150;', 'the cap is a named constant, not a magic number', SRC);

// EXECUTE IT. The cap and its footer are BEHAVIOUR: grep can confirm the
// footer's strings are in the file and still not know whether the footer is
// ever emitted, which is exactly how "silently truncate the list" slips
// through. So build a fake list, render a 200-item board into it, and look at
// what actually came out.
attempt('executable: the row cap and its footer', () => {
  const mkNode = (tag) => ({
    tagName: tag, className: '', textContent: '', innerHTML: '',
    _attrs: {}, _kids: [],
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    appendChild(c) { this._kids.push(c); return c; },
    addEventListener() {},
    classList: { add() {}, remove() {}, contains() { return false; } }
  });
  const listEl = mkNode('div');
  const headEl = mkNode('h3');
  const panel = mkNode('div');
  const searchEl = { value: '' };
  const doc = {
    getElementById: (id) => (id === 'library-panel' ? panel
      : id === 'library-list' ? listEl
      : id === 'library-search' ? searchEl
      : id === 'library-head-text' ? headEl : null),
    createElement: (tag) => mkNode(tag)
  };
  const mkItems = (n) => {
    const a = [];
    for (let i = 0; i < n; i++) a.push({ id: 'i' + i, name: 'Item ' + i, type: 'image', tags: [], note: '' });
    return a;
  };
  // v7.0.53: the filter is no longer inline - it delegates to libMatches. Pull
  // the REAL predicate into the sandbox rather than stubbing it, so this block
  // exercises the shipped matching rule instead of a stand-in.
  const realLibMatches = instantiate(fnFull('libMatches', SRC), '', { __ret: 'libMatches' });
  const render = instantiate(rlp, 'var LIB_ROW_CAP = 150; var _libActiveId = null;', {
    __ret: 'renderLibraryPanel',
    document: doc,
    state: { items: mkItems(200) },
    getSelectedItems: () => [],
    libThumbSrc: () => null,
    libMatches: realLibMatches
  });

  render();
  eq(listEl._kids.length, 151, 'a 200-item board renders 150 rows plus one footer');
  eq(listEl._kids[0]._attrs['data-id'], 'i0', 'the first row carries the first item id');
  const footer = listEl._kids[150];
  eq(footer.className, 'lib-more', 'the hidden rows are announced, not silently dropped');
  eq(footer.textContent, '+ 50 more - refine the search', 'the footer counts the hidden rows');
  eq(headEl.textContent, 'Library 200', 'the header counts every match, not just the drawn ones');

  // Narrow the search below the cap: the footer must disappear on its own.
  searchEl.value = 'Item 15';
  listEl._kids.length = 0;
  render();
  ok(listEl._kids.length > 0 && listEl._kids.length < 150,
     'a narrower search draws fewer rows');
  eq(listEl._kids[listEl._kids.length - 1].className, 'lib-row',
     'no footer once everything already fits');

  // And a miss: an empty panel with no explanation is a dead end.
  searchEl.value = 'zzz-nothing-matches-this';
  listEl._kids.length = 0;
  render();
  eq(listEl._kids.length, 0, 'a search with no match draws no rows');
  has('No items match.', 'a search with no match says so instead of going blank', listEl.innerHTML);
});
eq(count('var LIB_ROW_CAP = 150;', SRC), 1, 'the cap constant is declared exactly once');

// The row click: select + fly there. The rebuild it used to do is now the
// job of libSyncActive, so a click must not pay for a full list rebuild.
const clickRegion = SRC.slice(SRC.indexOf("row.addEventListener('click'"), SRC.indexOf("listEl.appendChild(row);"));
ok(clickRegion.length > 0, 'the Library row click handler exists');
has('selectOnly(it.id);', 'a row click selects the item', clickRegion);
has('revealItem(it);', 'a row click flies the camera to the item', clickRegion);
hasNot('renderLibraryPanel();',
       'a row click no longer rebuilds the whole list', clickRegion);

// ═══ 4. the panel remembers whether you opened it ═════════════════════
has("try { localStorage.setItem('krafted_library_collapsed', p.classList.contains('collapsed') ? '1' : '0'); } catch (e) {}",
    'toggling still writes the choice', SRC);
has("try { collapsed = localStorage.getItem('krafted_library_collapsed') !== '0'; } catch (e) {}",
    'the choice is read back at boot', SRC);

// The boot IIFE must sit in its own scope the way the views panel's does, and
// must tolerate both script positions (parsed early, or deferred).
// NB: anchor on the leading paren. indexOf('function initLibraryPanel()') lands
// one character late and misses the '(' that makes it an IIFE - which is
// exactly what this assertion is checking for.
const bootI = SRC.indexOf('(function initLibraryPanel()');
ok(bootI > 0, 'initLibraryPanel exists');
const bootRegion = SRC.slice(bootI, bootI + 460);
has('(function initLibraryPanel() {', 'the boot restore is an IIFE, not a stray call', bootRegion);
has("if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);",
    'the boot restore waits for the DOM when the parser has not finished', bootRegion);
has('else apply();', 'the boot restore runs immediately when the DOM is ready', bootRegion);
has('renderLibraryPanel();', 'the boot restore primes the list', bootRegion);
// It must run where the element already exists, i.e. after the markup.
ok(bootI > SRC.indexOf('id="library-panel"'),
   'the boot restore is defined after the panel markup it looks up');

// ═══ 5. presenting hides the index ════════════════════════════════════
has('body.presenting #library-panel { display:none; }',
    'a list of everything on the board is hidden while pitching', SRC);
const sp = fnFull('startPresent', SRC);
const stp = fnFull('stopPresent', SRC);
ok(sp.length > 0, 'startPresent exists');
ok(stp.length > 0, 'stopPresent exists');
has("document.body.classList.add('presenting');", 'startPresent marks the body as presenting', sp);
has("document.body.classList.remove('presenting');", 'stopPresent clears it', stp);
has('.lib-more {', 'the hidden-rows footer is styled', SRC);

// ═══ 6. v7.0.51 behaviour must survive the fix ════════════════════════
ok(fnFull('setItemMeta', SRC).length > 0, 'setItemMeta still exists');
ok(fnFull('splitTags', SRC).length > 0, 'splitTags still exists');
ok(fnFull('toggleLibraryPanel', SRC).length > 0, 'toggleLibraryPanel still exists');
ok(fnFull('renderLibraryPanel', SRC).length > 0, 'renderLibraryPanel still exists');
ok(fnFull('libThumbSrc', SRC).length > 0, 'libThumbSrc still exists');
has('id="prop-name"', 'the Name field is still there', SRC);
has('id="prop-note"', 'the Note field is still there', SRC);
has('id="prop-tags"', 'the Tags field is still there', SRC);
eq(count('name: i.name', SRC), 3, 'the three save paths still carry the metadata');
has('name: it.name', 'the kpak manifest still carries it', SRC);
has('name: n.name', 'the load path still carries it', SRC);
has("case 'library-toggle-panel':   toggleLibraryPanel(); return true;",
    'the shortcut still dispatches', SRC);

// ═══ report ═══════════════════════════════════════════════════════════
console.log(`test_v7052.js  (v7.2.0 Library keeps up with the board)`);
if (fails.length) {
  console.log(`  ${pass} passed, ${fails.length} FAILED`);
  fails.forEach(f => console.log('    FAIL  ' + f));
  process.exit(1);
} else {
  console.log(`  ALL PASS (${pass} assertions)`);
}
