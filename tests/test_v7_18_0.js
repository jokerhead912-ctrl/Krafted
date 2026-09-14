#!/usr/bin/env node
// test_v7_18_0.js — an imported .md renders as markdown, not as flat text:
//   (1) .md/.markdown render; .txt stays plain
//   (2) GFM tables become real tables, with per-column alignment
//   (3) headings get real levels, **bold** is real bold, code/lists/quotes/hr
//   (4) everything is escaped first — a hostile .md cannot inject markup
//   (5) the rendered HTML ROUND-TRIPS: sanitizeTextHtml() keeps table/heading/
//       list/code/link tags and drops script, on* handlers and bad hrefs
//   (6) the card can be flipped rendered <-> source, but only while it still
//       has a source: editing the rendered text drops it on purpose
//   (7) doc-card identity is persisted, so a reload/undo keeps the height cap
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
function has(hay, needle, msg) { ok(hay.indexOf(needle) >= 0, msg + ' — missing ' + JSON.stringify(needle) + ' in ' + JSON.stringify(String(hay).slice(0, 160))); }
function hasnt(hay, needle, msg) { ok(hay.indexOf(needle) < 0, msg + ' — unexpectedly found ' + JSON.stringify(needle)); }
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

const calls = { toasts: [], cards: [], grows: [], saves: 0, confirms: 0, confirmAnswer: true };
function resetCalls() {
  calls.toasts = []; calls.cards = []; calls.grows = []; calls.saves = 0;
  calls.confirms = 0; calls.confirmAnswer = true;
}

function makeEl() {
  const el = {
    _cls: [], style: {}, innerHTML: '', textContent: '', scrollHeight: 0,
    clientHeight: 100, scrollTop: 0, isConnected: true,
    classList: {
      add(c) { if (el._cls.indexOf(c) < 0) el._cls.push(c); },
      remove(c) { const i = el._cls.indexOf(c); if (i >= 0) el._cls.splice(i, 1); },
      contains(c) { return el._cls.indexOf(c) >= 0; },
      toggle(c, on) { const i = el._cls.indexOf(c); if (on) { if (i < 0) el._cls.push(c); } else if (i >= 0) el._cls.splice(i, 1); },
    },
  };
  return el;
}
function fakeCard(el) {
  return { id: calls.cards.length + 1, el: el || makeEl(), name: '', textPreset: 'body' };
}

// ── sandbox: the real doc-text block + the real sanitizer ──────────────────
const DOC_BLOCK = slice('\nvar DOC_TEXT_MAX_H = 600;', '\nfunction addText(x, y, initialText, opts) {');
const SAN_BLOCK = slice('\nfunction sanitizeTextHtml(html) {', '\n// v6.8.4: manual override for the wheel-device heuristic.');

function makeApi(opts) {
  opts = opts || {};
  const zh = !!opts.zh;
  const state = { dragging: opts.dragging || null, pan: { x: 0, y: 0 }, zoom: 1, items: [], texts: [] };
  const api = new Function(
    'state', 'window', 'document', 'boardTextLabel', 'toast', 'addText',
    'autoGrowTextItem', 'requestAnimationFrame', 'FileReader', 'scheduleAutoSave',
    DOC_BLOCK + '\n' + SAN_BLOCK + '\n' +
    'return { isMarkdownFile, renderMarkdownToHtml, stripMarkdownToPlain, readTextFile,' +
    ' importDocTextFiles, handleTextUpload, syncDocCardClasses, docCardSetMode,' +
    ' toggleDocCardSource, sanitizeTextHtml, escMd, safeMdUrl, inlineMd, splitMdRow,' +
    ' mdAlignCell, mdListTree, mdRenderList, DOC_TEXT_MAX_H, DOC_TEXT_W };'
  )(
    state,
    { innerWidth: 1000, innerHeight: 800, confirm() { calls.confirms++; return calls.confirmAnswer; } },
    { createElement: () => makeEl() },
    (en, z) => (zh ? z : en),
    msg => { calls.toasts.push(msg); },
    function (x, y, text, o) {
      const card = fakeCard(makeEl());
      card.x = x; card.y = y; card.text = text; card.initW = o && o.initW;
      card.noFocus = !!(o && o.noFocus);
      if (text) card.el.textContent = text;
      calls.cards.push(card);
      return card;
    },
    function (tx) { calls.grows.push(tx.id); },
    fn => { if (fn) fn(); },
    function () { this.readAsText = () => {}; },
    () => { calls.saves++; },
  );
  api.state = state;
  return api;
}

function fileWith(name, text, size) {
  return { name, size: size === undefined ? text.length : size, text() { return Promise.resolve(text); } };
}

// ── sandbox: the real attachTextListeners, so the input handler really runs ──
// NEVER anchor a slice on a version number. version_scan.py rewrites a bare
// X.Y.Z inside the suite that owns the release (the 'previous version is gone'
// ride-along), so a '7.17.0' anchor silently becomes '7.18.0' at the bump and
// the slice comes back empty - which surfaced as a confusing ReferenceError
// three call sites later instead of a failure that names the anchor.
const ATTACH_BLOCK = slice('\nfunction attachTextListeners(tx) {', '\nvar DOC_TEXT_MAX_H = 600;');
ok(/^function attachTextListeners\(tx\) \{/.test(ATTACH_BLOCK.trim())
  && ATTACH_BLOCK.indexOf('autoGrowTextItem(tx)') > 0,
  'the attachTextListeners slice still finds the real function (anchor check)');
function attachTo(tx, el) {
  const handlers = {};
  el.setAttribute = () => {};
  el.addEventListener = (type, fn) => { handlers[type] = fn; };
  el.blur = () => {};
  el.remove = () => {};
  const state = { selected: new Set(), tool: 'select', texts: [] };
  const fn = new Function(
    'state', 'canvas', 'boardTextLabel', 'beginBoardTextUndo', 'autoGrowTextItem',
    'scheduleAutoSave', 'syncBoardTextUI', 'boardTextIsComposing',
    'finishBoardTextEditing', 'selectOnly', 'clearSelection', 'setTool',
    'updateAutoFitPaper',
    ATTACH_BLOCK + '\nreturn attachTextListeners;'
  )(
    state, { querySelector: () => null }, (en, z) => en,
    () => {}, () => {}, () => {}, () => {}, () => false, () => {},
    () => {}, () => {}, () => {}, () => {},
  );
  fn(tx);
  return handlers;
}

// ── sandbox: the real serialize / normalize pair ───────────────────────────
const SER_BLOCK = slice('\nfunction serializeBoardText(t) {', '\n// Board Text: one edit lifecycle');
function makeSer() {
  return new Function('splitTags', SER_BLOCK + '\nreturn { serializeBoardText, normalizeBoardTextMeta };')(
    s => String(s).split(','));
}

(async function main() {
// ═════════════════════════════════════════════════════════════════════════
// S1. isMarkdownFile — which files render
{
  const A = makeApi();
  eq(A.isMarkdownFile({ name: 'scene.md' }), true, '.md renders');
  eq(A.isMarkdownFile({ name: 'scene.markdown' }), true, '.markdown renders');
  eq(A.isMarkdownFile({ name: 'SCENE.MD' }), true, 'the extension test is case-insensitive');
  eq(A.isMarkdownFile({ name: 'notes.txt' }), false, '.txt stays plain (a .txt is not markdown)');
  eq(A.isMarkdownFile({ name: 'scene.mdx' }), false, '.mdx is not claimed');
  eq(A.isMarkdownFile({}), false, 'a nameless file does not render');
  eq(A.isMarkdownFile(null), false, 'null does not render');
}

// ═════════════════════════════════════════════════════════════════════════
// S2. renderMarkdownToHtml — headings
{
  const A = makeApi();
  eq(A.renderMarkdownToHtml('# 围城'), '<h1>围城</h1>', 'h1');
  eq(A.renderMarkdownToHtml('### 场 3'), '<h3>场 3</h3>', 'h3 keeps its level');
  eq(A.renderMarkdownToHtml('###### deep'), '<h6>deep</h6>', 'h6');
  eq(A.renderMarkdownToHtml('####### too deep'), '<p>####### too deep</p>', 'seven hashes is not a heading');
  eq(A.renderMarkdownToHtml('# 围城 #'), '<h1>围城</h1>', 'closing hashes are trimmed');
  eq(A.renderMarkdownToHtml('#围城'), '<p>#围城</p>', 'no space after the hashes means no heading');
  eq(A.renderMarkdownToHtml('  ## indented'), '<h2>indented</h2>', 'a heading may be indented');
}

// S3. inline markup
{
  const A = makeApi();
  eq(A.renderMarkdownToHtml('**bold**'), '<p><strong>bold</strong></p>', '** is real bold');
  eq(A.renderMarkdownToHtml('__bold__'), '<p><strong>bold</strong></p>', '__ is real bold too');
  eq(A.renderMarkdownToHtml('*em*'), '<p><em>em</em></p>', 'single asterisk is emphasis');
  eq(A.renderMarkdownToHtml('a * b * c'), '<p>a * b * c</p>', 'a lone asterisk is left alone');
  eq(A.renderMarkdownToHtml('`code`'), '<p><code>code</code></p>', 'inline code');
  eq(A.renderMarkdownToHtml('~~gone~~'), '<p><del>gone</del></p>', 'strikethrough');
  eq(A.renderMarkdownToHtml('[t](http://a.b/c)'), '<p><a href="http://a.b/c">t</a></p>', 'a link keeps a safe href');
  const bad = A.renderMarkdownToHtml('[t](javascript:alert(1))');
  hasnt(bad, 'javascript:', 'a javascript: link loses its scheme');
  has(bad, 'href="#"', 'a javascript: link falls back to a harmless href');
  eq(A.renderMarkdownToHtml('![alt](http://x/y.png)'), '<p><span>[alt]</span></p>', 'an image becomes its alt text');
  const hostile = A.renderMarkdownToHtml('<script>alert(1)</script>');
  hasnt(hostile, '<script', 'a script tag in the .md is escaped, not emitted');
  has(hostile, '&lt;script&gt;', 'a script tag survives as visible text');
  hasnt(A.renderMarkdownToHtml('<img src=x onerror=alert(1)>'), '<img', 'an img tag is escaped too');
  eq(A.escMd('a<b>&"c"'), 'a&lt;b&gt;&amp;&quot;c&quot;', 'escMd escapes the four that matter');
  eq(A.escMd(null), '', 'escMd turns null into an empty string');
  eq(A.escMd(undefined), '', 'escMd turns undefined into an empty string');
  eq(A.safeMdUrl('https://a.b'), 'https://a.b', 'https survives');
  eq(A.safeMdUrl('mailto:a@b.c'), 'mailto:a@b.c', 'mailto survives');
  eq(A.safeMdUrl('#anchor'), '#anchor', 'an in-page anchor survives');
  eq(A.safeMdUrl('javascript:alert(1)'), '#', 'javascript: becomes #');
  eq(A.safeMdUrl('data:text/html,x'), '#', 'data: becomes #');
}

// S4. tables — the whole point of this release
{
  const A = makeApi();
  eq(A.renderMarkdownToHtml('| a | b |\n|---|---|\n| 1 | 2 |'),
    '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    'a GFM table becomes a real table');
  has(A.renderMarkdownToHtml('| a |\n|:--|\n| 1 |'), '<th style="text-align:left">a</th>', ':--- aligns the header cell left');
  has(A.renderMarkdownToHtml('| a |\n|--:|\n| 1 |'), '<th style="text-align:right">a</th>', '---: aligns the header cell right');
  has(A.renderMarkdownToHtml('| a |\n|:-:|\n| 1 |'), '<th style="text-align:center">a</th>', ':-: centres the header cell');
  {
    has(A.renderMarkdownToHtml('| 镜 | 焦段 |\n|---|---|\n| 3-1 | 35mm |'), '<td>3-1</td>', 'a row cell carries its text');
    has(A.renderMarkdownToHtml('| a | b |\n|---|---|\n| 1 |'), '<td></td>', 'a short row gets an empty cell, not a missing one');
    has(A.renderMarkdownToHtml('| **b** |\n|---|\n| 1 |'), '<th><strong>b</strong></th>', 'cells render inline markdown');
    const withTail = A.renderMarkdownToHtml('| a |\n|---|\n| 1 |\n\ntail');
    has(withTail, '</table>', 'the table closes');
    has(withTail, '<p>tail</p>', 'text after a blank line is a paragraph again');
    const tight = A.renderMarkdownToHtml('| a |\n|---|\n| 1 |\ntail');
    has(tight, '<p>tail</p>', 'a line straight after a table is a paragraph, not another row');
    eq(tight.split('<tr>').length - 1, 2, 'a tight table keeps only its header row and one body row');
    eq(A.renderMarkdownToHtml('| a |\n|---|\n| 1 |\n| 2 |').split('<tr>').length - 1, 3,
      'two body rows plus the header row is three tr');
  }
  eq(A.mdAlignCell('---'), '', 'a plain delimiter cell carries no alignment');
  eq(A.mdAlignCell(':--'), 'left', ':-- is left');
  eq(A.mdAlignCell('--:'), 'right', '--: is right');
  eq(A.mdAlignCell(':-:'), 'center', ':-: is centre');
  eq(A.mdAlignCell('text'), '', 'a non-delimiter cell carries no alignment');
  eq(JSON.stringify(A.splitMdRow('| a | b |')), '["a","b"]', 'a row splits on pipes');
  eq(JSON.stringify(A.splitMdRow('a | b')), '["a","b"]', 'the outer pipes are optional');
}

// S5. lists
{
  const A = makeApi();
  eq(A.renderMarkdownToHtml('- a\n- b'), '<ul><li>a</li><li>b</li></ul>', 'a bullet list');
  eq(A.renderMarkdownToHtml('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>', 'an ordered list');
  eq(A.renderMarkdownToHtml('* a\n* b'), '<ul><li>a</li><li>b</li></ul>', 'an asterisk list is a ul too');
  eq(A.renderMarkdownToHtml('- a\n  - b'), '<ul><li>a<ul><li>b</li></ul></li></ul>', 'an indented item nests');
  eq(A.renderMarkdownToHtml('- **b**'), '<ul><li><strong>b</strong></li></ul>', 'list items render inline markdown');
  eq(A.renderMarkdownToHtml('- a\n  cont'), '<ul><li>a cont</li></ul>', 'a lazy continuation joins the item');
  eq(A.renderMarkdownToHtml('- a\n\n- b'), '<ul><li>a</li><li>b</li></ul>', 'a blank line inside a list keeps one list');
  eq(A.renderMarkdownToHtml('- a\n\ntail'), '<ul><li>a</li></ul><p>tail</p>', 'a list ends at a paragraph');
}

// S6. blocks
{
  const A = makeApi();
  eq(A.renderMarkdownToHtml('```\nx\n```'), '<pre><code>x</code></pre>', 'a fenced block');
  has(A.renderMarkdownToHtml('```js\nvar a=1;\n```'), '<pre><code>var a=1;', 'the fence language is dropped, body kept');
  eq(A.renderMarkdownToHtml('> q'), '<blockquote><p>q</p></blockquote>', 'a blockquote holds a paragraph');
  has(A.renderMarkdownToHtml('> **q**'), '<strong>q</strong>', 'a blockquote renders inline markdown');
  eq(A.renderMarkdownToHtml('---'), '<hr>', '--- is a rule');
  eq(A.renderMarkdownToHtml('***'), '<hr>', '*** is a rule');
  eq(A.renderMarkdownToHtml('___'), '<hr>', '___ is a rule');
  eq(A.renderMarkdownToHtml('a\nb'), '<p>a\nb</p>', 'a soft break stays in the paragraph');
  eq(A.renderMarkdownToHtml('a\n\nb'), '<p>a</p><p>b</p>', 'a blank line splits paragraphs');
  const mixed = A.renderMarkdownToHtml('# T\n\nbody\n\n- one');
  eq(mixed, '<h1>T</h1><p>body</p><ul><li>one</li></ul>', 'blocks compose');
  hasnt(mixed, '>\n<', 'the renderer emits no whitespace between block tags');
  eq(A.renderMarkdownToHtml(''), '', 'an empty document renders to nothing');
  eq(A.renderMarkdownToHtml(null), '', 'null renders to nothing');
  eq(A.renderMarkdownToHtml('   \n  \n'), '', 'a whitespace-only document renders to nothing');
  eq(A.renderMarkdownToHtml('a\r\nb'), '<p>a\nb</p>', 'CRLF is normalised');
}

// S7. the import path: .md renders, .txt stays plain
{
  resetCalls();
  const A = makeApi();
  A.importDocTextFiles([fileWith('scene.md', '| 镜 | 焦段 |\n|---|---|\n| 3-1 | 35mm |')], () => ({ x: 0, y: 0 }));
  await sleep(10);
  eq(calls.cards.length, 1, 'one .md makes one card');
  const md = calls.cards[0];
  eq(md.docCard, true, 'an imported .md is a doc card');
  eq(md.mdMode, 'rendered', 'an imported .md starts rendered');
  eq(md.mdSrc, '| 镜 | 焦段 |\n|---|---|\n| 3-1 | 35mm |', 'the card keeps the original markdown');
  has(md.el.innerHTML, '<table>', 'the card holds a real table');
  has(md.el.innerHTML, '<td>3-1</td>', 'the table holds the row');
  ok(md.el.classList.contains('doc-card'), 'the card carries the doc-card class');
  ok(md.el.classList.contains('md-rendered'), 'the card carries the md-rendered class');
  eq(md.name, 'scene', 'the card is named after the file');
  eq(md.initW, A.DOC_TEXT_W, 'the card uses the doc width');
  eq(md.noFocus, true, 'an imported card does not steal focus');

  resetCalls();
  const B = makeApi();
  B.importDocTextFiles([fileWith('notes.txt', '## head\n- one')], () => ({ x: 0, y: 0 }));
  await sleep(10);
  eq(calls.cards.length, 1, 'one .txt makes one card');
  const txt = calls.cards[0];
  eq(txt.docCard, true, 'an imported .txt is a doc card too');
  eq(txt.mdMode, '', 'an imported .txt has no render mode');
  eq(txt.mdSrc, '', 'an imported .txt keeps no markdown source');
  // A heading only gains a blank line before it when it is NOT the first line
  // (v7.17.0 behaviour, unchanged here — this suite pins that .txt still goes
  // through the flattener at all).
  eq(txt.text, '▎head\n• one', 'an imported .txt is still flattened to plain text');
  ok(!txt.el.classList.contains('md-rendered'), 'a .txt card is not marked rendered');
}

// S8. the round-trip: sanitizeTextHtml must keep what the renderer emits
{
  const A = makeApi();
  const table = '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>';
  const kept = A.sanitizeTextHtml(table);
  eq(kept, table, 'a table survives sanitisation unchanged');
  eq(A.sanitizeTextHtml('<h2>T</h2>'), '<h2>T</h2>', 'a heading survives');
  eq(A.sanitizeTextHtml('<ul><li>a</li></ul>'), '<ul><li>a</li></ul>', 'a list survives');
  eq(A.sanitizeTextHtml('<ol><li>a</li></ol>'), '<ol><li>a</li></ol>', 'an ordered list survives');
  eq(A.sanitizeTextHtml('<pre><code>x</code></pre>'), '<pre><code>x</code></pre>', 'a code block survives');
  eq(A.sanitizeTextHtml('<hr>'), '<hr>', 'a rule survives');
  eq(A.sanitizeTextHtml('<blockquote><p>q</p></blockquote>'), '<blockquote><p>q</p></blockquote>', 'a quote survives');
  eq(A.sanitizeTextHtml('<del>x</del>'), '<del>x</del>', 'a del survives');
  eq(A.sanitizeTextHtml('<strong>b</strong>'), '<strong>b</strong>', 'bold survives');
  has(A.sanitizeTextHtml('<th style="text-align:center">a</th>'), 'text-align:center', 'a cell keeps its alignment');
  hasnt(A.sanitizeTextHtml('<td style="position:absolute;left:-9999px">a</td>'), 'position:absolute',
    'a positioned style is still dropped on table cells');
  has(A.sanitizeTextHtml('<a href="https://a.b">x</a>'), 'href="https://a.b"', 'a safe link keeps its href');
  hasnt(A.sanitizeTextHtml('<a href="javascript:alert(1)">x</a>'), 'href=', 'a javascript: link loses its href');
  hasnt(A.sanitizeTextHtml('<a href="#" onclick="alert(1)">y</a>'), 'onclick', 'an onclick handler is stripped');
  hasnt(A.sanitizeTextHtml('<script>alert(1)</script>'), 'script', 'a script tag is removed');
  hasnt(A.sanitizeTextHtml('<img src=x onerror=alert(1)>'), '<img', 'an img tag is removed');
  hasnt(A.sanitizeTextHtml('<iframe src="x"></iframe>'), 'iframe', 'an iframe is removed');
  const roundTrip = A.sanitizeTextHtml(A.renderMarkdownToHtml('# T\n\n| a |\n|---|\n| 1 |'));
  has(roundTrip, '<h1>T</h1>', 'a rendered heading survives the save/load round-trip');
  has(roundTrip, '<td>1</td>', 'a rendered table survives the save/load round-trip');
}

// S9. rendered <-> source
{
  const A = makeApi();
  const md = '# T\n\n| a |\n|---|\n| 1 |';
  const tx = { id: 7, el: makeEl(), mdSrc: md, mdMode: 'rendered', docCard: true };
  A.syncDocCardClasses(tx);
  ok(tx.el.classList.contains('md-rendered'), 'a rendered card is classed rendered');
  ok(A.docCardSetMode(tx, 'source'), 'switching to source succeeds while a source exists');
  eq(tx.mdMode, 'source', 'the mode is source');
  eq(tx.el.textContent, md, 'the card shows the raw markdown');
  ok(tx.el.classList.contains('md-source'), 'the card is classed md-source');
  ok(!tx.el.classList.contains('md-rendered'), 'the rendered class is dropped');
  ok(A.docCardSetMode(tx, 'rendered'), 'switching back succeeds');
  eq(tx.mdMode, 'rendered', 'the mode is rendered again');
  has(tx.el.innerHTML, '<table>', 'the card is re-rendered');
  ok(tx.el.classList.contains('md-rendered'), 'the rendered class is back');
  ok(!tx.el.classList.contains('md-source'), 'the source class is dropped');

  A.state.texts.push(tx);
  A.toggleDocCardSource(7);
  eq(tx.mdMode, 'source', 'toggleDocCardSource flips to source by id');
  A.toggleDocCardSource(7);
  eq(tx.mdMode, 'rendered', 'toggleDocCardSource flips back by id');
  A.toggleDocCardSource(999);
  eq(tx.mdMode, 'rendered', 'an unknown id changes nothing');

  const plain = { id: 8, el: makeEl(), mdSrc: '', mdMode: '', docCard: true };
  eq(A.docCardSetMode(plain, 'source'), false, 'a card without a source cannot switch');
  eq(plain.mdMode, '', 'and its mode is untouched');
  eq(A.docCardSetMode(null, 'source'), false, 'a null card is refused');
}

// S10. editing a rendered card invalidates its source (real handler)
{
  const rendered = { id: 1, el: makeEl(), mdSrc: '# T', mdMode: 'rendered', docCard: true };
  rendered.el.classList.add('md-rendered');
  let h = attachTo(rendered, rendered.el);
  ok(typeof h.input === 'function', 'the input handler is attached');
  h.input();
  eq(rendered.mdSrc, '', 'typing in a rendered card drops the stale source');
  eq(rendered.mdMode, '', 'and with it the render mode');

  const inSource = { id: 2, el: makeEl(), mdSrc: '# old', mdMode: 'source', docCard: true };
  inSource.el.classList.add('md-source');
  inSource.el.textContent = '# new';
  h = attachTo(inSource, inSource.el);
  h.input();
  eq(inSource.mdSrc, '# new', 'typing in the source keeps the source in step');
  eq(inSource.mdMode, 'source', 'and the card stays in source mode');

  const plain = { id: 3, el: makeEl(), mdSrc: '', mdMode: '', docCard: false };
  h = attachTo(plain, plain.el);
  h.input();
  eq(plain.mdSrc, '', 'an ordinary card has nothing to invalidate');
}

// S11. persistence
{
  const S = makeSer();
  const el = makeEl();
  el.innerHTML = '<p>x</p>';
  el.textContent = 'x';
  const saved = S.serializeBoardText({ id: 1, el, docCard: true, mdMode: 'rendered', mdSrc: '# T' });
  eq(saved.docCard, true, 'docCard is saved');
  eq(saved.mdMode, 'rendered', 'mdMode is saved');
  eq(saved.mdSrc, '# T', 'mdSrc is saved');

  const old = S.serializeBoardText({ id: 2, el });
  eq(old.docCard, false, 'an older card saves docCard false');
  eq(old.mdMode, '', 'an older card saves an empty mode');
  eq(old.mdSrc, '', 'an older card saves an empty source');

  const tx = { id: 3 };
  S.normalizeBoardTextMeta(tx, { docCard: true, mdMode: 'source', mdSrc: 'abc' });
  eq(tx.docCard, true, 'docCard is restored');
  eq(tx.mdMode, 'source', 'mdMode is restored');
  eq(tx.mdSrc, 'abc', 'mdSrc is restored');

  const tx2 = { id: 4 };
  S.normalizeBoardTextMeta(tx2, {});
  eq(tx2.docCard, false, 'a file without the flags defaults to no doc card');
  eq(tx2.mdMode, '', 'a file without the flags defaults to no mode');
  eq(tx2.mdSrc, '', 'a file without the flags defaults to no source');

  const tx3 = { id: 5 };
  S.normalizeBoardTextMeta(tx3, { docCard: 'yes', mdMode: 'nonsense', mdSrc: 42 });
  eq(tx3.docCard, true, 'a truthy docCard is coerced to a boolean');
  eq(tx3.mdMode, '', 'an unknown mode is rejected, not passed through');
  eq(tx3.mdSrc, '', 'a non-string source is rejected');
}

// S12. syncDocCardClasses re-derives the classes (reload / undo)
{
  const A = makeApi();
  const fresh = { id: 1, el: makeEl(), docCard: true, mdMode: 'rendered', mdSrc: '# T' };
  eq(fresh.el.classList.contains('doc-card'), false, 'a restored element starts bare');
  A.syncDocCardClasses(fresh);
  ok(fresh.el.classList.contains('doc-card'), 'the doc-card class is re-derived');
  ok(fresh.el.classList.contains('md-rendered'), 'the rendered class is re-derived');

  const plainDoc = { id: 2, el: makeEl(), docCard: true, mdMode: '', mdSrc: '' };
  A.syncDocCardClasses(plainDoc);
  ok(plainDoc.el.classList.contains('doc-card'), 'a .txt card is a doc card');
  ok(!plainDoc.el.classList.contains('md-rendered'), 'but not a rendered card');

  const ordinary = { id: 3, el: makeEl(), docCard: false, mdMode: '', mdSrc: '' };
  A.syncDocCardClasses(ordinary);
  ok(!ordinary.el.classList.contains('doc-card'), 'an ordinary text card is untouched');

  const stale = { id: 4, el: makeEl(), docCard: false, mdMode: '', mdSrc: '' };
  stale.el.classList.add('md-rendered');
  A.syncDocCardClasses(stale);
  ok(!stale.el.classList.contains('md-rendered'), 'a stale class is removed, not left behind');
  eq(A.syncDocCardClasses(null), undefined, 'a null card is a no-op');
}

// S13. structural pins
{
  ok(src.indexOf('// v7.19.0:') > 0, 'v7.19.0 provenance comments are present');
  const c = codeOnly(src);
  eq(c.split("el.classList.contains('doc-card') !== wantDoc").length - 1, 1, 'syncDocCardClasses derives doc-card');
  eq(c.split('if (isTextItem) syncDocCardClasses(item);').length - 1, 1,
    'updateItemStyle re-derives the doc-card classes on every style pass');
  eq(c.split('const _docCard = wheelDocCardTarget(e);').length - 1, 1, 'the v7.19.0 wheel gate is still there');
  ok(src.indexOf('toggleDocCardSource(${sel[0].id})') > 0, 'the context menu offers the source toggle');
  ok(src.indexOf('Show markdown source') > 0, 'the toggle is labelled');
  eq(src.split('.text-item.doc-card.md-rendered table').length - 1, 1, 'exactly one rendered-table CSS rule');
  eq(src.split('.text-item.doc-card.md-rendered.editing').length - 1, 1, 'the editing override is present');
  eq(src.split("'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'a'").length - 1, 1,
    'the sanitizer allowlist names the table and link tags exactly once');
  ok(src.indexOf('function renderMarkdownToHtml(raw)') > 0, 'the renderer exists as a function');
  eq(src.split('function renderMarkdownToHtml(raw)').length - 1, 1, 'and only once');
}

console.log('\n' + passes + ' passed, ' + fails.length + ' failed');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
console.log('ALL PASS');
})();
