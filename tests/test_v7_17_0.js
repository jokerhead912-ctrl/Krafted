#!/usr/bin/env node
// test_v7_17_0.js — .md / .txt land on the board as one editable text card:
//   (1) only .md / .markdown / .txt are doc files; everything else is not
//   (2) markdown markers are stripped to plain text (▎ heading, • list, no **)
//   (3) one file becomes one card: name from the filename, capped height,
//       .doc-card class, fanned out to the right of the drop point
//   (4) nothing is silent: empty file, unreadable file and oversized file all
//       end in a toast or a confirm — an unsupported drop says so too
//   (5) the height cap lives in growTextHeightToFit, so editing cannot grow
//       a card past 600 either
//   (6) the wheel gate only fires while the card can still scroll, and never
//       for pinch / Cmd zoom
// The suite extracts the REAL functions and executes them (rule 6k).
//
// v7.18.0: a .md no longer lands as stripped plain text — it renders (tables,
// heading sizes, real bold). So this suite now pins the plain-text contract on
// .txt, the format that still has it, and asserts only that .md takes the render
// path. The renderer's own detail lives in test_v7_18_0.js.
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

// v7.18.0: importDocTextFiles pushes a rendered .md through the sanitizer, so the
// sandbox needs the real one. A stub would hide the whole allowlist question.
const SAN_BLOCK = slice('\nfunction sanitizeTextHtml(html) {',
  '\n// v6.8.4: manual override for the wheel-device heuristic.');
const calls = { toasts: [], cards: [], grows: [], confirms: 0, confirmAnswer: true, exec: 0 };
function resetCalls() {
  calls.toasts = []; calls.cards = []; calls.grows = []; calls.confirms = 0;
  calls.confirmAnswer = true; calls.exec = 0;
}

// A fake text item standing in for what addText() returns.
function fakeCard(el) {
  return { id: calls.cards.length + 1, el: el || makeEl(), name: '', textPreset: 'body' };
}
function makeEl() {
  const el = {
    _cls: [], style: {}, scrollHeight: 0, clientHeight: 100, scrollTop: 0, isConnected: true,
    classList: {
      add(c) { if (el._cls.indexOf(c) < 0) el._cls.push(c); },
      remove(c) { const i = el._cls.indexOf(c); if (i >= 0) el._cls.splice(i, 1); },
      contains(c) { return el._cls.indexOf(c) >= 0; },
      // v7.18.0: syncDocCardClasses toggles rather than adds.
      toggle(c, on) { if (on) el.classList.add(c); else el.classList.remove(c); },
    },
  };
  return el;
}

// ── the sandbox: real source, injected collaborators ──────────────────────
function makeApi(opts) {
  opts = opts || {};
  const zh = !!opts.zh;
  const state = { dragging: opts.dragging || null, pan: { x: 0, y: 0 }, zoom: 1, items: [], texts: [] };
  let FileReaderCtor = opts.FileReader || function () {
    this.readAsText = () => {};
  };
  const api = new Function(
    'state', 'window', 'document', 'boardTextLabel', 'toast', 'addText',
    'autoGrowTextItem', 'requestAnimationFrame', 'FileReader',
    'updateItemStyle', 'updateAutoFitPaper', 'positionBoardTextUI',
    slice('\nvar DOC_TEXT_MAX_H = 600;', '\nfunction addText(x, y, initialText, opts) {') + '\n' +
    SAN_BLOCK + '\n' +
    slice('\nfunction growTextHeightToFit(tx) {', '\nfunction updateItemStyle(') + '\n' +
    'return { isDocTextFile, stripMarkdownToPlain, readTextFile, importDocTextFiles, handleTextUpload, wheelDocCardTarget, docCardCanScroll, growTextHeightToFit, isMarkdownFile, renderMarkdownToHtml, syncDocCardClasses, sanitizeTextHtml, DOC_TEXT_MAX_H, DOC_TEXT_W, DOC_TEXT_MAX_BYTES };'
  )(
    state,
    {
      innerWidth: 1000, innerHeight: 800,
      confirm() { calls.confirms++; return calls.confirmAnswer; },
    },
    { createElement: () => makeEl() },
    (en, z) => (zh ? z : en),
    msg => { calls.toasts.push(msg); },
    function (x, y, text, o) {
      const card = fakeCard(makeEl());
      card.x = x; card.y = y; card.text = text; card.initW = o && o.initW;
      card.noFocus = !!(o && o.noFocus);
      calls.cards.push(card);
      return card;
    },
    function (tx) { calls.grows.push(tx.id); },
    fn => { if (fn) fn(); },
    FileReaderCtor,
    () => {}, () => {}, () => {},
  );
  api.state = state;
  return api;
}

function fileWith(name, text, size) {
  return {
    name,
    size: size === undefined ? text.length : size,
    text() { return Promise.resolve(text); },
  };
}

(async function main() {
// ═════════════════════════════════════════════════════════════════════════
// S1. isDocTextFile — the gate that decides what is board text
{
  const A = makeApi();
  eq(A.isDocTextFile({ name: 'scene.md' }), true, '.md is a doc file');
  eq(A.isDocTextFile({ name: 'notes.txt' }), true, '.txt is a doc file');
  eq(A.isDocTextFile({ name: 'script.markdown' }), true, '.markdown is a doc file');
  eq(A.isDocTextFile({ name: 'SCRIPT.MD' }), true, 'the extension test is case-insensitive');
  eq(A.isDocTextFile({ name: 'board.png' }), false, '.png is not a doc file');
  eq(A.isDocTextFile({ name: 'clip.mov' }), false, '.mov is not a doc file');
  eq(A.isDocTextFile({ name: 'readme' }), false, 'a file with no extension is not a doc file');
  eq(A.isDocTextFile({}), false, 'a nameless file is not a doc file');
  eq(A.isDocTextFile(null), false, 'null is not a doc file');
  eq(A.isDocTextFile({ name: 'a.mdx' }), false, '.mdx is not claimed (leave it to a later version)');
}

// S2. stripMarkdownToPlain — one plain string, no per-line styling
{
  const A = makeApi();
  eq(A.stripMarkdownToPlain('## 场 3 — 围城'), '▎场 3 — 围城', 'a heading keeps its text behind a bar');
  eq(A.stripMarkdownToPlain('intro\n## 场 3'), 'intro\n\n▎场 3', 'a heading gets a blank line before it');
  eq(A.stripMarkdownToPlain('- masked blonde driver'), '• masked blonde driver', 'a dash list becomes a bullet');
  eq(A.stripMarkdownToPlain('* item'), '• item', 'a star list becomes a bullet');
  eq(A.stripMarkdownToPlain('+ item'), '• item', 'a plus list becomes a bullet');
  eq(A.stripMarkdownToPlain('  - nested'), '  • nested', 'indentation survives the list rewrite');
  eq(A.stripMarkdownToPlain('**surveillance motif**'), 'surveillance motif', 'bold markers are stripped');
  eq(A.stripMarkdownToPlain('__bold__'), 'bold', 'underscore-bold markers are stripped');
  eq(A.stripMarkdownToPlain('keep it *cold*'), 'keep it cold', 'single-star italics are stripped');
  eq(A.stripMarkdownToPlain('a * b * c'), 'a * b * c', 'a lone asterisk is not treated as emphasis');
  eq(A.stripMarkdownToPlain('> keep it cold'), '  keep it cold', 'a quote is indented instead of marked');
  eq(A.stripMarkdownToPlain('---'), '————', 'a horizontal rule becomes a plain rule');
  eq(A.stripMarkdownToPlain('a\r\nb'), 'a\nb', 'CRLF is normalised to LF');
  eq(A.stripMarkdownToPlain('plain text'), 'plain text', 'plain text is untouched');
  eq(A.stripMarkdownToPlain('# a\n\n\n\n# b'), '▎a\n\n▎b', 'runs of blank lines collapse to one');
  eq(A.stripMarkdownToPlain('   \n\n'), '', 'a whitespace-only file imports as empty');
  eq(A.stripMarkdownToPlain(''), '', 'an empty file imports as empty');
  eq(A.stripMarkdownToPlain(null), '', 'null imports as empty instead of throwing');
  eq(A.stripMarkdownToPlain('tail   '), 'tail', 'trailing whitespace is trimmed');
  eq(A.stripMarkdownToPlain('\n\n# a'), '▎a', 'leading blank lines are trimmed');
  const long = A.stripMarkdownToPlain('# one\ntext\n## two\nmore');
  eq(long.split('\n')[0], '▎one', 'the first heading leads the card');
  eq(long.indexOf('▎two') > 0, true, 'later headings stay in place');
}

// S3. readTextFile — both the modern and the fallback path end in text
{
  const A = makeApi();
  const t = await A.readTextFile(fileWith('a.md', 'hello'));
  eq(t, 'hello', 'file.text() is used when it exists');
  let rejected = false;
  await A.readTextFile({ name: 'b.md', text: () => Promise.reject(new Error('nope')) })
    .catch(() => { rejected = true; });
  eq(rejected, true, 'a rejected read propagates so the caller can toast');
  let read = null;
  const Legacy = function () {
    this.readAsText = f => { read = f; this.result = 'legacy'; if (this.onload) this.onload({ target: this }); };
  };
  const A2 = makeApi({ FileReader: Legacy });
  const t2 = await A2.readTextFile({ name: 'c.md' });
  eq(t2, 'legacy', 'a file without .text() falls back to FileReader');
  eq(read && read.name, 'c.md', 'the fallback reads the file it was given');
}

// S4. importDocTextFiles — one file, one card
{
  resetCalls();
  const A = makeApi();
  A.importDocTextFiles([fileWith('scene 3.txt', '## 场 3\n- convoy')], i => ({ x: i * 10, y: 5 }));
  await sleep(5);
  eq(calls.cards.length, 1, 'one file makes one card');
  const c = calls.cards[0];
  eq(c.name, 'scene 3', 'the card is named after the file, minus the extension');
  eq(c.initW, 560, 'the card is created at the doc width');
  eq(c.noFocus, true, 'importing does not steal the caret');
  eq(c.el.classList.contains('doc-card'), true, 'the card gets the .doc-card class (cap + scroll)');
  eq(c.text, '▎场 3\n• convoy', 'the card holds the stripped text');
  eq(c.el.classList.contains('md-rendered'), false, 'a .txt is not a rendered markdown card');
  eq(c.mdSrc, '', 'a .txt keeps no markdown source (there is nothing to flip back to)');
  eq(JSON.stringify([c.x, c.y]), '[0,5]', 'the first card lands at the drop point');
  eq(calls.toasts.length, 1, 'a successful import toasts exactly once');
  eq(calls.toasts[0], 'Imported scene 3.txt', 'the toast names the file');
  eq(calls.grows.length, 1, 'the card is auto-grown once the DOM settles');
}

// S4-md (v7.18.0): a .md renders instead of being stripped
{
  resetCalls();
  const A = makeApi();
  A.importDocTextFiles([fileWith('table.md', '| a | b |\n|---|---|\n| 1 | 2 |')], () => ({ x: 0, y: 0 }));
  await sleep(5);
  eq(calls.cards.length, 1, 'a .md still makes one card');
  const c = calls.cards[0];
  eq(c.text, '', 'the rendered card is filled through innerHTML, not the text argument');
  eq(c.el.innerHTML.indexOf('<table>') >= 0, true, 'a markdown table survives as a real table');
  eq(c.el.classList.contains('doc-card'), true, 'the rendered card is still a doc card');
  eq(c.el.classList.contains('md-rendered'), true, 'the rendered card carries .md-rendered');
  eq(c.mdSrc.indexOf('| a | b |') >= 0, true, 'the source markdown is kept so the card can flip back');
  eq(calls.toasts[0], 'Imported table.md', 'a rendered import toasts just like a plain one');
}

// S4b. fan-out, and the oversized / empty / unreadable paths
{
  resetCalls();
  const A = makeApi();
  A.importDocTextFiles(
    [fileWith('a.md', 'a'), fileWith('b.md', 'b'), fileWith('c.md', 'c')],
    i => ({ x: i * (A.DOC_TEXT_W + 24), y: 0 }));
  await sleep(5);
  eq(calls.cards.length, 3, 'three files make three cards');
  eq(calls.cards[1].x - calls.cards[0].x, A.DOC_TEXT_W + 24, 'cards fan out by their own width, never overlapping');
  eq(calls.cards[2].x - calls.cards[1].x, A.DOC_TEXT_W + 24, 'the fan-out step is the same for every card');

  resetCalls();
  const A2 = makeApi();
  A2.importDocTextFiles([fileWith('big.md', 'x', 900 * 1024)], () => ({ x: 0, y: 0 }));
  await sleep(5);
  eq(calls.confirms, 1, 'a file over the byte budget asks before importing');
  eq(calls.cards.length, 1, 'confirming imports it anyway');

  resetCalls(); calls.confirmAnswer = false;
  const A3 = makeApi();
  A3.importDocTextFiles([fileWith('big.md', 'x', 900 * 1024)], () => ({ x: 0, y: 0 }));
  await sleep(5);
  eq(calls.cards.length, 0, 'cancelling the confirm imports nothing');
  calls.confirmAnswer = true;

  resetCalls();
  const A4 = makeApi();
  A4.importDocTextFiles([fileWith('blank.md', '   \n')], () => ({ x: 0, y: 0 }));
  await sleep(5);
  eq(calls.cards.length, 0, 'an empty file makes no card');
  eq(calls.toasts[0], 'Empty file: blank.md', 'an empty file says so instead of failing silently');

  resetCalls();
  const A5 = makeApi();
  A5.importDocTextFiles([{ name: 'broken.md', size: 10, text: () => Promise.reject(new Error('x')) }], () => ({ x: 0, y: 0 }));
  await sleep(5);
  eq(calls.cards.length, 0, 'an unreadable file makes no card');
  eq(calls.toasts[0], 'Could not read broken.md', 'an unreadable file toasts instead of failing silently');

  resetCalls();
  const A6 = makeApi({ zh: true });
  A6.importDocTextFiles([fileWith('scene.md', 'text')], () => ({ x: 0, y: 0 }));
  await sleep(5);
  eq(calls.toasts[0], '已汇入 scene.md', 'the toast is translated in the Chinese UI');

  resetCalls();
  const A7 = makeApi();
  let threw = false;
  try { A7.importDocTextFiles([null], () => ({ x: 0, y: 0 })); } catch (e) { threw = true; }
  await sleep(5);
  eq(calls.cards.length, 0, 'a null entry in the list makes no card');
  eq(threw, false, 'a null entry is skipped without throwing (one bad entry cannot kill the import)');
}

// S4c. the Import Text menu entry lands in the middle of the viewport
{
  resetCalls();
  const A = makeApi();
  A.handleTextUpload({ target: { files: [fileWith('menu.md', 'x')], value: 'menu.md' } });
  await sleep(5);
  eq(calls.cards.length, 1, 'the file input creates the card');
  ok(calls.cards[0].x > 0 && calls.cards[0].x < 1000, 'the card lands inside the viewport, not at 0,0');
  resetCalls();
  A.handleTextUpload({ target: { files: [], value: '' } });
  await sleep(5);
  eq(calls.cards.length, 0, 'an empty file selection creates nothing');
}

// S5. the height cap lives in growTextHeightToFit, so editing honours it too
{
  const A = makeApi();
  function grow(cls, scrollHeight) {
    const el = makeEl();
    if (cls) el.classList.add(cls);
    el.scrollHeight = scrollHeight;
    const tx = { el, w: 560, h: 36 };
    A.growTextHeightToFit(tx);
    return tx.h;
  }
  eq(grow('doc-card', 2000), A.DOC_TEXT_MAX_H, 'a doc card stops at the cap instead of growing 2000px tall');
  eq(grow('doc-card', 300), 302, 'a short doc card keeps its natural height');
  eq(grow('doc-card', 5), 32, 'the 32px floor still applies to a doc card');
  eq(grow(null, 2000), 2002, 'a non-doc text item is still allowed to grow freely');
  eq(grow(null, 300), 302, 'a non-doc text item grows to fit its content');
}

// S6. the wheel gate — scroll only while the card can still move
{
  const A = makeApi();
  const el = makeEl();
  eq(A.wheelDocCardTarget({ target: { closest: () => el } }), el, 'the gate finds the card under the cursor');
  eq(A.wheelDocCardTarget({ target: { closest: () => null } }), null, 'no card under the cursor → board keeps the wheel');
  eq(A.wheelDocCardTarget({ target: null }), null, 'a null target never crashes the gate');
  eq(A.wheelDocCardTarget({ target: {} }), null, 'a target without closest() is not a card');

  const card = { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 };
  eq(A.docCardCanScroll(card, { deltaY: 10 }), true, 'at the top, scrolling down belongs to the card');
  eq(A.docCardCanScroll(card, { deltaY: -10 }), false, 'at the top, scrolling up falls through to the board');
  const mid = { scrollHeight: 1000, clientHeight: 400, scrollTop: 300 };
  eq(A.docCardCanScroll(mid, { deltaY: 10 }), true, 'in the middle, down still belongs to the card');
  eq(A.docCardCanScroll(mid, { deltaY: -10 }), true, 'in the middle, up belongs to the card');
  const bot = { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 };
  eq(A.docCardCanScroll(bot, { deltaY: 10 }), false, 'at the bottom, down falls through to the board');
  eq(A.docCardCanScroll(bot, { deltaY: -10 }), true, 'at the bottom, up belongs to the card');
  eq(A.docCardCanScroll(card, { deltaY: 0 }), false, 'a purely horizontal wheel never hijacks');
  eq(A.docCardCanScroll({ scrollHeight: 400, clientHeight: 400, scrollTop: 0 }, { deltaY: 10 }), false,
    'a card that fits is not scrollable, so the board keeps the wheel');
  eq(A.docCardCanScroll({ scrollHeight: 400, clientHeight: 400, scrollTop: 50 }, { deltaY: -10 }), false,
    'a card whose content fits never scrolls, even if scrollTop is not 0');
  eq(A.docCardCanScroll(card, { deltaY: 10, ctrlKey: true }), false, 'pinch-zoom always wins over card scroll');
  eq(A.docCardCanScroll(card, { deltaY: 10, metaKey: true }), false, 'Cmd+wheel always wins over card scroll');
  const A2 = makeApi({ dragging: { type: 'move' } });
  eq(A2.docCardCanScroll(card, { deltaY: 10 }), false, 'while dragging, the card never steals the wheel');
  eq(A.docCardCanScroll(null, { deltaY: 10 }), false, 'a null card is not scrollable');
  eq(A.docCardCanScroll(card, null), false, 'a null event is not scrollable');
}
// S6b. the gate is EXECUTED, not just present (rule 19: an anchor proves the
// code is there, not that it runs). The line is lifted out of the real source.
{
  const A = makeApi();
  const gi = src.indexOf('if (_docCard && docCardCanScroll(_docCard, e)) return;');
  ok(gi > 0, 'the wheel gate line is found in the source');
  const gateSrc = src.slice(gi, src.indexOf('\n', gi)).replace('return;', 'return true;');
  ok(gateSrc.indexOf('return true;') > 0, 'the gate line was rewritten for the probe');
  const runGate = new Function('e', 'wheelDocCardTarget', 'docCardCanScroll',
    'var _docCard = wheelDocCardTarget(e);\n' + gateSrc + '\nreturn false;');
  const scrollable = { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 };
  const atEnd = { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 };
  const evFor = el => ({ deltaY: 10, target: { closest: () => el } });
  eq(runGate(evFor(scrollable), A.wheelDocCardTarget, A.docCardCanScroll), true,
    'a scrollable card under the cursor takes the wheel');
  eq(runGate(evFor(atEnd), A.wheelDocCardTarget, A.docCardCanScroll), false,
    'a card at its end hands the wheel back to the board');
  eq(runGate(evFor(null), A.wheelDocCardTarget, A.docCardCanScroll), false,
    'no card under the cursor leaves the wheel to the board');
}


// S7. structural pins — the wiring exists exactly once
{
  const code = codeOnly(src);
  eq(code.split('if (_docCard && docCardCanScroll(_docCard, e)) return;').length - 1, 1,
    'the wheel gate is the single place that hands the wheel to a card');
  eq(code.split("const _capH = el.classList.contains('doc-card') ? DOC_TEXT_MAX_H : Infinity;").length - 1, 1,
    'the cap is applied where the height is measured');
  eq(src.split('.text-item.doc-card { overflow-y:auto;').length - 1, 1,
    'the doc card scrolls itself');
  eq(src.split('.text-item.doc-card.editing { overflow-y:auto !important; }').length - 1, 1,
    'the doc card keeps scrolling while you type in it');
  eq(src.split('const _skipped = files.length - (imageFiles.length').length - 1, 1,
    'an unusable drop is counted');
  eq(src.split("toast(boardTextLabel('Skipped '").length - 1, 1,
    'an unusable drop toasts instead of vanishing');
  eq(src.split('file-text-input').length - 1, 2,
    'the Import Text entry and its hidden input are both wired up');
  eq(src.split('importDocTextFiles(_docTextFiles, function (i)').length - 1, 1,
    'the drop path creates the cards');
  // Provenance pin (ride-along with test_v7_8_0): the shipped version must
  // appear in a source comment, and version_scan rewrites this string on bump.
  ok(src.indexOf('// v7.25.0:') > 0, 'the shipped version has provenance comments');
}

// S8. the drop path is EXECUTED, not just present. The expressions that decide
// what a dropped file becomes are lifted out of _handleFileDrop and run.
// Every lift is guarded: if the source stops having the shape we expect that is
// a FAIL, never a crash. An unguarded lift threw a TypeError on two mutants and
// the harness scored them UNPROVEN — the evidence was destroyed by the probe.
{
  const A = makeApi();
  const dm = src.match(/const _docTextFiles = (files\.filter\(function \(f\) \{[^}]*\}\));/);
  ok(!!dm, 'the doc-file filter in the drop handler has the expected shape');
  if (dm) {
    const picked = new Function('files', 'isDocTextFile', 'return ' + dm[1])(
      [{ name: 'a.md' }, { name: 'b.png' }, { name: 'c.txt' }, { name: 'd.mov' }], A.isDocTextFile);
    eq(picked.map(f => f.name).join(','), 'a.md,c.txt',
      'the drop handler pulls .md and .txt out of the dropped list, in order');
  }

  const sm = src.match(/const _skipped = ([^;]+);/);
  ok(!!sm, 'the skipped count in the drop handler has the expected shape');
  if (sm) {
    const countSkipped = new Function(
      'files', 'imageFiles', 'videoFiles', 'audioFiles', '_docTextFiles', 'return ' + sm[1]);
    eq(countSkipped([1, 2, 3, 4, 5], [1], [2], [3], [4]), 1,
      'a drop counts only what it could not use as skipped');
    eq(countSkipped([1, 2, 3], [1], [2], [3], []), 0,
      'when every file is used, nothing is reported as skipped');
    eq(countSkipped([1, 2], [], [], [], [1, 2]), 0,
      'a drop of only .md files reports nothing skipped (they are used, not skipped)');
  }

  const fm = src.match(/importDocTextFiles\(_docTextFiles, function \(i\) \{ return \{ x: ([^,]+), y: (.*?) \}; \}\);/);
  ok(!!fm, 'the fan-out position expression has the expected shape');
  if (fm) {
    const posAt = new Function('dropX0', 'dropY0', 'DOC_TEXT_W', 'i',
      'return { x: ' + fm[1] + ', y: ' + fm[2] + ' };');
    eq(posAt(100, 200, 560, 2).x, 100 + 2 * (560 + 24),
      'the drop fan-out steps by the card width, so cards never overlap');
    eq(posAt(100, 200, 560, 0).x, 100, 'the first card sits exactly at the drop point');
    eq(posAt(100, 200, 560, 3).y, 200, 'the fan-out stays on one row');
  }

  eq(src.split('id="file-text-input" accept=".md,.markdown,.txt"').length - 1, 1,
    'the hidden input offers only text files');

  // The "I could not use that" toast, lifted out and fired for real.
  const bm = src.match(/if \(_skipped > 0\) \{\n[\s\S]*?\n  \}/);
  ok(!!bm, 'the skipped toast in the drop handler has the expected shape');
  if (bm) {
    const fired = [];
    const runToast = new Function('_skipped', 'boardTextLabel', 'toast', bm[0]);
    const enLabel = (en) => en;
    runToast(3, enLabel, m => fired.push(m));
    eq(fired.length, 1, 'an unusable drop toasts (executed, not just present)');
    ok(fired.length > 0 && String(fired[0]).indexOf('unsupported') > 0,
      'the toast says the files were unsupported');
    fired.length = 0;
    runToast(0, enLabel, m => fired.push(m));
    eq(fired.length, 0, 'a fully-used drop toasts nothing');
  }
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n' + (fails.length ? 'FAIL' : 'ALL PASS') + ' — ' + passes + ' passed, ' + fails.length + ' failed');
process.exit(fails.length ? 1 : 0);
})();
