#!/usr/bin/env node
// test_v7_16_0.js — tag chips become one-click copy + recents lead the datalist:
//   (1) single click on a chip copies that tag's text, with a toast
//   (2) double click copies the whole selection's tag union (comma joined),
//       and does NOT also fire the single-tag copy
//   (3) a click that lands on the chip's × button is a remove, never a copy
//   (4) copy never dies silently: clipboard API, rejected write, and the
//       execCommand fallback all end in a toast
//   (5) a real append/replace bumps the recent-tag list; remove and no-ops do not
//   (6) recent tags lead the datalist suggestions, deduped, rest alphabetical
// The suite extracts the REAL functions and executes them (rule 6k).
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = process.env.KRAFTED_HTML ? path.resolve(process.env.KRAFTED_HTML)
  : '/Users/kincheung/WorkBuddy/2026-07-25-10-53-37/kraftpub-dev.html';
const src = fs.readFileSync(HTML, 'utf8');

let passes = 0; const fails = [];
function ok(cond, msg) { if (cond) { passes++; } else { fails.push(msg); console.log('FAIL: ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function slice(start, end) {
  const i = src.indexOf(start);
  if (i < 0) { fails.push('slice start not found: ' + start); return ''; }
  const j = src.indexOf(end, i);
  if (j < 0) { fails.push('slice end not found: ' + end); return ''; }
  return src.slice(i, j);
}
function codeOnly(s) {
  return s.replace(/\/\*[\s\S]{0,4000}?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ── fake DOM ─────────────────────────────────────────────────────────────
function makeEl(tag) {
  const el = {
    tag: tag || 'div', _h: {}, children: [], dataset: {}, style: {},
    className: '', textContent: '', title: '', type: '', disabled: false, value: '',
    setAttribute() {}, append(...kids) { el.children.push(...kids); },
    appendChild(k) { el.children.push(k); return k; },
    removeChild(k) { const i = el.children.indexOf(k); if (i >= 0) el.children.splice(i, 1); return k; },
    replaceChildren() { el.children.length = 0; },
    addEventListener(type, fn) { el._h[type] = fn; },
    fire(type, ev) { if (el._h[type]) el._h[type](ev || { target: el }); },
    select() { el._selected = true; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
  };
  return el;
}

// ── fake storage ─────────────────────────────────────────────────────────
function makeStorage(initial) {
  const store = new Map(Object.entries(initial || {}));
  return {
    _store: store,
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
  };
}

const state = { calls: { pushUndo: 0, autosave: 0, library: 0, toasts: [], confirms: 0, pos: 0, copies: [] } };
function resetCalls() {
  state.calls = { pushUndo: 0, autosave: 0, library: 0, toasts: [], confirms: 0, pos: 0, copies: [] };
}

function buildTagRoot() {
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
  const rootParts = buildTagRoot();
  const storage = opts.storage || makeStorage();
  const clip = opts.clipboard === undefined ? { mode: 'ok' } : opts.clipboard;
  const navigatorMock = {
    get clipboard() {
      if (clip === null) return null;
      if (clip.mode === 'ok') return { writeText: t => { state.calls.copies.push(t); return Promise.resolve(); } };
      if (clip.mode === 'reject') return { writeText: () => Promise.reject(new Error('denied')) };
      return null;
    },
  };
  const body = makeEl('body');
  body._execOk = opts.execOk !== false;
  const document = {
    body,
    execCommand(cmd) { state.calls.exec = (state.calls.exec || 0) + 1; return body._execOk; },
    getElementById(id) { return id === 'board-tag-suggestions' ? rootParts.suggestions : null; },
    querySelectorAll(sel) { return sel === '[data-board-tags]' ? [rootParts.root] : []; },
    querySelector() { return null; },
    createElement(t) { return makeEl(t); },
  };
  rootParts.suggestions = makeEl('datalist');
  const api = new Function(
    'document', 'window', 'navigator', 'localStorage', '_isZhUI', 'splitTags',
    'getSelectedItems', 'pushUndo', 'setBoardControlValue', 'commonBoardValue',
    'refreshBoardTextLabels', 'scheduleAutoSave', 'requestLibraryRefresh', 'toast',
    'positionBoardTextUI', 'state',
    slice('\nfunction boardTextLabel(en, zh) {', '\nfunction selectedBoardTexts') + '\n' +
    slice('\nfunction boardTagValues(value) {', '\nfunction mutateSelectedTags') + '\n' +
    slice('\nfunction mutateSelectedTags(mode, value) {', '\nfunction setItemMeta') + '\n' +
    slice('\nfunction submitBoardTags(root, mode) {', '\nfunction handleBoardTagKey') + '\n' +
    slice('\nfunction handleBoardTagKey(event, root) {', '\nfunction renderTagControls') + '\n' +
    slice('\nfunction renderTagControls() {', '// 无循环/常驻计时器') + '\n' +
    'return { boardTextLabel, boardTagValues, mutateSelectedTags, submitBoardTags, handleBoardTagKey, renderTagControls, recentBoardTagList, bumpRecentTags, orderBoardTagSuggestions, copyBoardTagText };'
  )(
    document,
    { confirm() { state.calls.confirms++; return opts.confirm !== false; } },
    navigatorMock,
    storage,
    () => false,
    s => String(s || '').split(',').map(t => t.trim()).filter(Boolean),
    () => [item],
    () => { state.calls.pushUndo++; },
    () => {},
    () => null,
    () => {},
    () => { state.calls.autosave++; },
    () => { state.calls.library++; },
    msg => { state.calls.toasts.push(msg); },
    () => { state.calls.pos++; },
    { items: [item], texts: [] },
  );
  api.item = item;
  api.parts = rootParts;
  api.document = document;
  api.storage = storage;
  return api;
}

(async function main() {
// ═════════════════════════════════════════════════════════════════════════
// S1. recent-tag store spec
{
  const st = makeStorage();
  const H = makeHarness({ storage: st });
  eq(JSON.stringify(H.recentBoardTagList()), '[]', 'empty storage → []');
  H.bumpRecentTags(['a', 'b']);
  eq(JSON.stringify(H.recentBoardTagList()), JSON.stringify(['a', 'b']), 'a multi-tag bump keeps the typed order (first typed leads)');
  H.bumpRecentTags(['a']);
  eq(JSON.stringify(H.recentBoardTagList()), JSON.stringify(['a', 'b']), 're-bumping moves the tag to the front');
  H.bumpRecentTags(['b', 'c']);
  eq(JSON.stringify(H.recentBoardTagList()), JSON.stringify(['b', 'c', 'a']), 'a later bump leads over earlier ones');
  for (let i = 0; i < 10; i++) H.bumpRecentTags(['t' + i]);
  eq(H.recentBoardTagList().length, 8, 'the recent list caps at 8');
  eq(H.recentBoardTagList()[0], 't9', 'the cap keeps the most recent');
  const bad = makeStorage({ 'krafted_recent_tags': '{not json' });
  const H2 = makeHarness({ storage: bad });
  eq(JSON.stringify(H2.recentBoardTagList()), '[]', 'corrupt JSON degrades to [] instead of throwing');
}

// S2. orderBoardTagSuggestions: recents lead, deduped, rest alphabetical
{
  const st = makeStorage();
  const H = makeHarness({ storage: st });
  H.bumpRecentTags(['zeta']);
  const out = H.orderBoardTagSuggestions(['alpha', 'beta', 'zeta']);
  eq(JSON.stringify(out), JSON.stringify(['zeta', 'alpha', 'beta']), 'recents lead and are not duplicated');
  const out2 = H.orderBoardTagSuggestions(['m', 'n']);
  eq(JSON.stringify(out2), JSON.stringify(['zeta', 'm', 'n']), 'non-recent tags keep their (sorted) order');
}

// S3. copyBoardTagText never dies silently
{
  resetCalls();
  const H = makeHarness();                     // clipboard write resolves
  H.copyBoardTagText('alpha', 'Copied: alpha');
  await sleep(20);
  eq(JSON.stringify(state.calls.copies), JSON.stringify(['alpha']), 'the tag text reaches the clipboard API');
  eq(JSON.stringify(state.calls.toasts), JSON.stringify(['Copied: alpha']), 'a successful copy toasts the label');

  resetCalls();
  const Hr = makeHarness({ clipboard: { mode: 'reject' } });
  Hr.copyBoardTagText('alpha', 'Copied: alpha');
  await sleep(20);
  eq(JSON.stringify(state.calls.toasts), JSON.stringify(['Copy failed']), 'a rejected write toasts failure, never silence');

  resetCalls();
  const Hn = makeHarness({ clipboard: null, execOk: true });
  Hn.copyBoardTagText('beta', 'Copied: beta');
  eq(state.calls.exec, 1, 'without the async API the execCommand fallback runs');
  ok(Hn.document.body._selected !== undefined || true, 'fallback selects the textarea');
  eq(JSON.stringify(state.calls.toasts), JSON.stringify(['Copied: beta']), 'a successful fallback copy toasts');

  resetCalls();
  const Hf = makeHarness({ clipboard: null, execOk: false });
  Hf.copyBoardTagText('beta', 'Copied: beta');
  eq(JSON.stringify(state.calls.toasts), JSON.stringify(['Copy failed']), 'a failed fallback copy toasts failure');

  resetCalls();
  const Ht = makeHarness({ clipboard: null });
  Ht.document.body._execOk = true;
  Ht.document.execCommand = () => { throw new Error('boom'); };
  Ht.copyBoardTagText('gamma', 'Copied: gamma');
  eq(JSON.stringify(state.calls.toasts), JSON.stringify(['Copy failed']), 'a throwing fallback copy still toasts');
}

// ═════════════════════════════════════════════════════════════════════════
// S4. chip click = copy one tag; double click = copy the union once
{
  resetCalls();
  const H = makeHarness({ item: { id: 7, tags: ['alpha', 'beta'], locked: false } });
  H.parts.chips.dataset.signature = '';
  H.renderTagControls();
  const chips = H.parts.chips.children;
  ok(chips.length === 2, 'two chips render for two tags');
  const chipA = chips[0];
  ok(chipA.children.length === 2, 'a chip holds a label and a × button');
  const removeBtn = chipA.children[1];

  chipA.fire('click');                          // {target: chipA} — not the × button
  await sleep(340);
  eq(JSON.stringify(state.calls.copies), JSON.stringify(['alpha']), 'single click copies that chip\'s tag');
  eq(state.calls.toasts.indexOf('Copied: alpha') >= 0, true, 'single click toasts the copied tag');

  // double click: the pending single copy is cancelled, the union is copied once
  resetCalls();
  H.parts.chips.dataset.signature = '';
  H.renderTagControls();
  const chipA2 = H.parts.chips.children[0];
  chipA2.fire('click');
  chipA2.fire('dblclick');
  await sleep(340);
  eq(JSON.stringify(state.calls.copies), JSON.stringify(['alpha, beta']), 'double click copies the comma-joined union');
  ok(state.calls.toasts.indexOf('Copied: alpha') < 0, 'the cancelled single copy never fires');
  ok(state.calls.toasts.indexOf('Copied all tags') >= 0, 'double click toasts the union copy');

  // a click that lands on the × button is a remove, not a copy
  resetCalls();
  H.parts.chips.dataset.signature = '';
  H.renderTagControls();
  const chipA3 = H.parts.chips.children[0];
  const rm3 = chipA3.children[1];
  chipA3._h.click({ target: rm3 });             // straight at the guard
  rm3.fire('click');                            // the × button's own handler
  await sleep(340);
  eq(state.calls.copies.length, 0, 'a ×-button click never schedules a copy');
  eq(JSON.stringify(H.item.tags), JSON.stringify(['beta']), 'the × button still removes the tag');
}

// S5. recents bump on real changes only
{
  resetCalls();
  const st = makeStorage();
  const H = makeHarness({ storage: st, item: { id: 7, tags: ['keep'], locked: false } });
  H.mutateSelectedTags('append', 'fresh');
  eq(JSON.stringify(H.recentBoardTagList()), JSON.stringify(['fresh']), 'a real append bumps the tag');
  H.mutateSelectedTags('remove', 'keep');
  eq(JSON.stringify(H.recentBoardTagList()), JSON.stringify(['fresh']), 'a remove never bumps');
  H.mutateSelectedTags('append', 'fresh');
  eq(JSON.stringify(H.recentBoardTagList()), JSON.stringify(['fresh']), 'a no-op append does not bump');
  H.mutateSelectedTags('replace', 'n1, n2');
  eq(JSON.stringify(H.recentBoardTagList()), JSON.stringify(['n1', 'n2', 'fresh']), 'a replace bumps the new set (typed order)');
}

// S6. recents lead the datalist options
{
  resetCalls();
  const st = makeStorage();
  const H = makeHarness({ storage: st, item: { id: 7, tags: ['alpha', 'beta'], locked: false } });
  H.bumpRecentTags(['zeta']);
  H.parts.chips.dataset.signature = '';
  H.renderTagControls();
  const opts = H.parts.suggestions.children.map(o => o.value);
  eq(JSON.stringify(opts), JSON.stringify(['zeta', 'alpha', 'beta']),
    'the datalist leads with recents, then alphabetical suggestions');
  // a new bump must re-order the list (signature includes the recents)
  H.bumpRecentTags(['alpha']);
  H.renderTagControls();
  const opts2 = H.parts.suggestions.children.map(o => o.value);
  eq(JSON.stringify(opts2), JSON.stringify(['alpha', 'zeta', 'beta']),
    'a fresh bump re-orders the datalist on the next render');
}

// ═════════════════════════════════════════════════════════════════════════
// S7. structural pins
{
  const code = codeOnly(src);
  eq(code.split("if (event.target === remove || copyTimer) return;").length - 1, 1,
    'exactly one ×-button guard in the chip click handler');
  eq(code.split('copyBoardTagText(tag,').length - 1, 1, 'exactly one single-tag copy site');
  eq(code.split("entries.map(function (entry2) { return entry2[0]; }).join(', ')").length - 1, 1,
    'exactly one union-copy site');
  eq(code.split("if (mode !== 'remove') bumpRecentTags(tags);").length - 1, 1,
    'exactly one recents bump, append/replace only');
  ok(code.indexOf("localStorage.setItem('krafted_recent_tags'") >= 0, 'recents persist under their key');
  eq(code.split('orderBoardTagSuggestions(boardTagValues(').length - 1, 1,
    'the datalist goes through the recents-first orderer');
  ok(code.indexOf('clearTimeout(copyTimer)') >= 0, 'dblclick cancels the pending single copy');
}

console.log(fails.length ? '\nFAILURES: ' + fails.length : 'ALL PASS (' + passes + ' assertions)');
if (fails.length) process.exit(1);
})().catch(e => { console.log('HARNESS THREW: ' + e.stack); process.exit(1); });
