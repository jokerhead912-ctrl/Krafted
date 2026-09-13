#!/usr/bin/env node
/*
 * test_v7_12_0.js — v7.12.0: export a selection of images as a notes report.
 *
 *   A. THE REQUEST. "i want add funtion whne i selection couples of image and
 *      i can 好似放喺 comment 度嘅一個欄可以打意見，然之後好似comment咁樣 export
 *      html,咁樣我就可以圖片連埋說明發送給別人 .因為而家呢個功能，淨係可以喺視頻
 *      裏面,我只係想調用出嚟，譬如我選擇啲圖片right click 撳個掣"
 *
 *      The frame-comments report already did exactly this — for a video. This
 *      makes the same document for a selection of images.
 *
 *   B. WHAT IT READS. Each image's existing `note` (the Note field in the
 *      properties panel). No new field, no new storage, so .kpak round-trips
 *      without touching the schema. Images with no note still export, marked
 *      "(no comment)" — dropping them would silently shrink someone's review.
 *
 *   C. THE ONE NEW PIECE OF UI. The overall comment. There is nowhere on the
 *      board to put "a note about these four images together", and inventing
 *      one would mean a new schema, so it is typed once in a small dialog and
 *      lives only in the exported file.
 *
 *   D. THE 病根① GATE. The stylesheet and the lightbox are now ONE array each,
 *      spread by both builders. Section 5 extracts the <style> block from a
 *      real frame-comments report and a real image-notes report and asserts
 *      they are byte-identical — because "two copies that happen to agree
 *      today" is how the fourth copy of the crop maths survived v7.9.0.
 *
 * Sections 2-7 EXECUTE the functions (the v7.4.0 lesson: an anchor proves the
 * code exists, not that it runs).
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
function hasIn(hay, needle, m) { ok(hay.indexOf(needle) >= 0, m + '  (missing: ' + JSON.stringify(needle.slice(0, 90)) + ')'); }
function lacksIn(hay, needle, m) { ok(hay.indexOf(needle) < 0, m + '  (should be absent: ' + JSON.stringify(needle.slice(0, 60)) + ')'); }
function count(needle, n, m) {
  let c = 0, i = -1;
  while ((i = HTML.indexOf(needle, i + 1)) >= 0) c++;
  eq(c, n, m + '  (found ' + c + ', want ' + n + ')');
}

// ═══ 1. structure ═══════════════════════════════════════════════════════
console.log('\n[1] the pieces exist, and there is exactly one of each');
has('const REPORT_SHARED_CSS = [', 'REPORT_SHARED_CSS exists');
has('const REPORT_LIGHTBOX_JS = [', 'REPORT_LIGHTBOX_JS exists');
count('const REPORT_SHARED_CSS = [', 1, 'exactly one shared stylesheet');
count('const REPORT_LIGHTBOX_JS = [', 1, 'exactly one lightbox script');
has('function buildNotesExportHtml(', 'buildNotesExportHtml() exists');
has('function notesReadingOrder(', 'notesReadingOrder() exists');
has('async function exportNotesAsHtml(', 'exportNotesAsHtml() exists');
has('function openNotesExportDialog(', 'openNotesExportDialog() exists');
has('function notesExportableImages(', 'notesExportableImages() exists');
has('📝 Export notes as HTML…', 'context-menu entry exists');
has('📝 匯出圖文備註 HTML…', 'zh dictionary carries the entry');
has('openNotesExportDialog();hideCtx()', 'the menu entry opens the dialog');

// The shared bits are spread by BOTH builders — one spread would mean the
// other report still owns a private copy.
count('...REPORT_SHARED_CSS,', 2, 'two builders spread the stylesheet');
count('...REPORT_LIGHTBOX_JS,', 2, 'two builders spread the lightbox');
// And the originals are gone from where they used to live inline.
count("'  :root { --accent: #00e5ff;", 1, 'the accent rule appears once (inside the shared array)');
count("'    function exLbOpen(src) {',", 1, 'exLbOpen appears once (inside the shared array)');

// ═══ build a sandbox that EXECUTES the real code ════════════════════════
const A = 'function escapeHtml(s) {';
const B = '\nfunction videoAnnoDeleteComment(';
const a = HTML.indexOf(A);
const b = HTML.indexOf(B, a);
ok(a > 0 && b > a, 'found the report section to execute');
const CODE = HTML.slice(a, b);

// Stubs for everything the section reaches for. The two async helpers are
// declared inside CODE, so they are rebound AFTER the declarations.
globalThis.__notesSrcStub = async function (src) { return String(src || ''); };
globalThis.__notesDownStub = async function (url) { return url + '#shrunk'; };
globalThis.getSelectedImages = function () { return []; };
globalThis.toast = function (m) { globalThis.__toasts.push(m); };
globalThis.__toasts = [];
globalThis.confirm = function () { return globalThis.__confirmAnswer; };
globalThis.__confirmAnswer = false;
globalThis.kraftedSaveFile = async function (opts) {
  globalThis.__saved = opts;
  return 'saved';
};
globalThis.__saved = null;

const mod = new Function(
  CODE + '\n' +
  'notesSrcToDataUrl = globalThis.__notesSrcStub;\n' +
  'notesDownscale = globalThis.__notesDownStub;\n' +
  'return { escapeHtml: escapeHtml, REPORT_SHARED_CSS: REPORT_SHARED_CSS,' +
  ' REPORT_LIGHTBOX_JS: REPORT_LIGHTBOX_JS, buildExportHtml: buildExportHtml,' +
  ' buildNotesExportHtml: buildNotesExportHtml, notesReadingOrder: notesReadingOrder,' +
  ' dataUrlByteLength: dataUrlByteLength, notesExportableImages: notesExportableImages,' +
  ' exportNotesAsHtml: exportNotesAsHtml, openNotesExportDialog: openNotesExportDialog,' +
  ' submitNotesExportDialog: submitNotesExportDialog, closeNotesExportDialog: closeNotesExportDialog,' +
  ' NOTES_MAX_BYTES: NOTES_MAX_BYTES, NOTES_DOWNSCALE_SIDE: NOTES_DOWNSCALE_SIDE };')();

// ═══ 2. reading order ═══════════════════════════════════════════════════
console.log('\n[2] reading order: top-to-bottom, then left-to-right');
function img(id, x, y, extra) {
  return Object.assign({ id: id, x: x, y: y, w: 100, h: 80, src: 'data:image/png;base64,' + id, img: {} }, extra || {});
}
// Two visual rows. The y values inside a row are deliberately jittered the way
// a hand-arranged board jitters them — a plain (y, x) sort gets these wrong.
const jitter = [img('A', 0, 3), img('B', 200, 0), img('C', 400, 5),
                img('D', 0, 300), img('E', 200, 297), img('F', 400, 302)];
eq(mod.notesReadingOrder(jitter).map(i => i.id).join(''), 'ABCDEF',
   'jittered rows still read left-to-right, top-to-bottom');
// Reverse insertion order must not change the answer.
eq(mod.notesReadingOrder(jitter.slice().reverse()).map(i => i.id).join(''), 'ABCDEF',
   'order is a property of the board, not of the selection order');
// A tall item spans two rows: it joins the first band it overlaps and stays there.
const spanned = [img('A', 0, 0, { h: 400 }), img('B', 200, 10), img('C', 200, 300)];
eq(mod.notesReadingOrder(spanned).map(i => i.id).join(''), 'ABC',
   'a tall item does not push later rows above it');
eq(mod.notesReadingOrder([]).length, 0, 'empty selection -> empty order');
eq(mod.notesReadingOrder([img('A', 5, 5)]).map(i => i.id).join(''), 'A', 'single image survives');
// It must not mutate the caller's array.
const frozen = [img('B', 200, 0), img('A', 0, 0)];
mod.notesReadingOrder(frozen);
eq(frozen.map(i => i.id).join(''), 'BA', 'notesReadingOrder does not reorder in place');

// ═══ 3. byte counting ═══════════════════════════════════════════════════
console.log('\n[3] data URL size');
// 4 base64 chars -> 3 bytes. Padding must be discounted or every image is
// over-counted by up to 2 bytes — small, but the gate is a threshold.
eq(mod.dataUrlByteLength('data:image/png;base64,AAAA'), 3, 'four chars = three bytes');
eq(mod.dataUrlByteLength('data:image/png;base64,AAA='), 2, 'one pad char');
eq(mod.dataUrlByteLength('data:image/png;base64,AA=='), 1, 'two pad chars');
eq(mod.dataUrlByteLength(''), 0, 'empty data URL is zero bytes');
eq(mod.dataUrlByteLength(null), 0, 'null is zero bytes, not a crash');
const kb64 = 'A'.repeat(4096);
eq(mod.dataUrlByteLength('data:image/png;base64,' + kb64), 3072, '4k chars = 3k bytes');
eq(mod.NOTES_MAX_BYTES, 25 * 1024 * 1024, 'the gate is 25 MB');
eq(mod.NOTES_DOWNSCALE_SIDE, 1600, 'the shrink target is 1600px on the long edge');

// ═══ 4. the document ════════════════════════════════════════════════════
console.log('\n[4] buildNotesExportHtml');
const row1 = '<div class="row">one</div>';
const notes = mod.buildNotesExportHtml({
  title: 'My Board', imageCount: 3, commentCount: 2,
  exportedAt: '2026-09-09 21:30:00', rows: row1, overComment: 'tighten the lighting'
});
hasIn(notes, '--accent: #00e5ff', 'the shared stylesheet is in the document');
hasIn(notes, 'function exLbOpen', 'the shared lightbox is in the document');
hasIn(notes, '<title>My Board — Image Notes</title>', 'title in the <title>');
hasIn(notes, '<h1>My Board</h1>', 'title in the header');
hasIn(notes, '<b>3</b> image', 'image count');
hasIn(notes, '<b>2</b> with a note', 'comment count');
hasIn(notes, 'tighten the lighting', 'overall comment is rendered');
hasIn(notes, '<div class="over-block">', 'overall comment uses the frame report markup');
hasIn(notes, row1, 'rows are placed verbatim');
hasIn(notes, '2026-09-09 21:30:00', 'export timestamp');
hasIn(notes, 'Generated by <b>Krafted</b>', 'footer');

// No overall comment -> no block at all (an empty gradient card looks broken).
// Match the MARKUP, not the class name: "over-block" is also a CSS selector
// in the shared stylesheet, so a bare-substring gate can never go green
// (§6y-2 — this is the same trap the v7.8.0 AABB gate fell into).
const noOver = mod.buildNotesExportHtml({ title: 'X', imageCount: 1, commentCount: 1, rows: 'r', exportedAt: 't', overComment: '   ' });
lacksIn(noOver, '<div class="over-block">', 'a blank overall comment renders no block');

// Escaping. A board named after a script tag must not become one.
const evil = mod.buildNotesExportHtml({ title: '<script>alert(1)</script>', imageCount: 1, commentCount: 0, rows: 'r', exportedAt: 't', overComment: '<b>bold</b>' });
lacksIn(evil, '<script>alert(1)</script>', 'title is escaped');
hasIn(evil, '&lt;script&gt;', 'title is escaped into entities');
lacksIn(evil, '<b>bold</b>', 'overall comment is escaped');

// ═══ 5. the two reports really do share one stylesheet ═══════════════════
console.log('\n[5] one stylesheet, two reports (病根① gate)');
function styleBlock(doc) {
  const i = doc.indexOf('<style>');
  const j = doc.indexOf('</style>', i);
  return (i < 0 || j < 0) ? '' : doc.slice(i, j);
}
const frameReport = mod.buildExportHtml({
  videoName: 'clip.mp4', videoBase: 'clip', fileExt: '.mp4', durStr: '0:30',
  commentsCount: 1, fps: 30, exportedAt: '2026-09-09 21:30:00',
  rows: '<div class="row">x</div>', overComment: ''
});
const sFrame = styleBlock(frameReport);
const sNotes = styleBlock(notes);
ok(sFrame.length > 2000, 'the frame report carries a real stylesheet (' + sFrame.length + ' chars)');
eq(sNotes, sFrame, 'the two reports emit an identical <style> block');
// And the lightbox, which is the part most likely to be copy-pasted.
const lbCount = (d) => (d.match(/function exLbOpen/g) || []).length;
eq(lbCount(frameReport), 1, 'frame report has one lightbox');
eq(lbCount(notes), 1, 'notes report has one lightbox');
ok(mod.REPORT_SHARED_CSS.length > 40, 'the shared stylesheet is a real array (' + mod.REPORT_SHARED_CSS.length + ' lines)');
ok(mod.REPORT_LIGHTBOX_JS.length > 8, 'the shared lightbox is a real array (' + mod.REPORT_LIGHTBOX_JS.length + ' lines)');

// ═══ 6. exportNotesAsHtml end to end ═════════════════════════════════════
console.log('\n[6] exportNotesAsHtml runs');
function reset() { globalThis.__toasts = []; globalThis.__saved = null; globalThis.__confirmAnswer = false; }

const board = [
  // The note carries markup on purpose: it proves the report escapes what it
  // is given rather than trusting it (and makes the "rendered raw" mutation
  // observable — a fixture the mutation cannot change is not a test).
  Object.assign(img('right', 400, 0), { name: 'right.png', note: 'warm <this> up & fix' }),
  Object.assign(img('left', 0, 4), { name: 'left.png', note: '' }),
  Object.assign(img('below', 0, 300), { name: 'below.png', note: '  ' }),
  // Four that must NOT appear. v7.10.1 established that media items are built
  // with img: null, so the pixel check already catches those two — which is
  // exactly why 'vid2' is here: a video-shaped item that DOES carry a poster
  // image is the only shape that can tell the media filter apart from the
  // pixel filter. 'lbl' does the same job for the pixel filter.
  { id: 'vid', x: 900, y: 0, w: 100, h: 80, src: 'data:x,video', img: null, isVideo: true, name: 'clip.mp4', note: 'nope' },
  { id: 'aud', x: 900, y: 300, w: 100, h: 80, src: 'data:x,audio', img: null, isAudio: true, name: 'sfx.wav', note: 'nope' },
  { id: 'vid2', x: 900, y: 600, w: 100, h: 80, src: 'data:x,vid2', img: {}, isVideo: true, name: 'clip2.mp4', note: 'nope' },
  { id: 'lbl', x: 500, y: 300, w: 100, h: 40, name: 'a text label' },
];
reset();
globalThis.getSelectedImages = function () { return board; };
eq(mod.notesExportableImages().map(i => i.id).join(','), 'left,right,below',
   'the report sees the three images and neither piece of media');
(async () => {
  await mod.exportNotesAsHtml('overall note here');
  const saved = globalThis.__saved;
  ok(!!saved, 'a file was handed to the save helper');
  ok(/^krafted-image-notes-\d{14}\.html$/.test(saved.filename),
     'filename carries a timestamp (got ' + (saved && saved.filename) + ')');
  eq(saved.mime, 'text/html', 'saved as text/html');
  const body = await saved.blob.text();
  // Reading order, not selection order: "left" was second in the array.
  ok(body.indexOf('left.png') < body.indexOf('right.png'), 'left comes before right (reading order)');
  ok(body.indexOf('right.png') < body.indexOf('below.png'), 'right comes before below (row order)');
  hasIn(body, 'warm &lt;this&gt; up &amp; fix', 'the note is escaped, not trusted');
  lacksIn(body, '<this>', 'raw markup from a note never reaches the document');
  hasIn(body, '(no comment)', 'images without a note are marked, not dropped');
  hasIn(body, 'overall note here', 'the overall comment is in the document');
  lacksIn(body, 'clip.mp4', 'the video is not in the report');
  lacksIn(body, 'sfx.wav', 'the audio item is not in the report');
  lacksIn(body, 'clip2.mp4', 'a video that carries a poster image is still not an image');
  lacksIn(body, 'a text label', 'an item with no pixels is not in the report');
  hasIn(body, '#1 of 3', 'rows are numbered');
  eq((body.match(/class="row"/g) || []).length, 3, 'exactly three cards');
  ok(globalThis.__toasts.join('|').indexOf('3 images') >= 0, 'the toast reports the export');

  // ── the 25 MB gate ──
  console.log('\n[6b] the size gate only shrinks when asked');
  // The gate counts DECODED bytes: 4 base64 chars carry 3 bytes, so 36M
  // characters is 27 MB — over the 25 MB gate. (30M chars would be 22.5 MB,
  // i.e. under it, which is exactly how this assertion went green for the
  // wrong reason on the first run.)
  const big = 'data:image/png;base64,' + 'A'.repeat(36 * 1024 * 1024);
  const oneBig = [Object.assign(img('big', 0, 0), { name: 'big.png', note: 'n', src: big })];
  globalThis.getSelectedImages = function () { return oneBig; };
  reset();
  globalThis.__confirmAnswer = false;
  await mod.exportNotesAsHtml('');
  let b2 = await globalThis.__saved.blob.text();
  lacksIn(b2, '#shrunk', 'answering Cancel keeps the originals');
  reset();
  globalThis.__confirmAnswer = true;
  await mod.exportNotesAsHtml('');
  b2 = await globalThis.__saved.blob.text();
  hasIn(b2, '#shrunk', 'answering OK shrinks every image');
  ok(globalThis.__toasts.join('|').indexOf('Shrinking to 1600px') >= 0, 'the user is told why it is slow');

  // A small export must never trigger the question at all.
  globalThis.getSelectedImages = function () { return [Object.assign(img('s', 0, 0), { name: 's.png', note: 'n' })]; };
  reset();
  let asked = false;
  globalThis.confirm = function () { asked = true; return false; };
  await mod.exportNotesAsHtml('');
  eq(asked, false, 'a small report never asks about shrinking');
  globalThis.confirm = function () { return globalThis.__confirmAnswer; };

  // ── nothing selected ──
  reset();
  globalThis.getSelectedImages = function () { return []; };
  await mod.exportNotesAsHtml('x');
  eq(globalThis.__saved, null, 'no selection writes nothing');
  ok(globalThis.__toasts.join('|').indexOf('Select at least one image') >= 0, 'and says so');

  // ═══ 7. the dialog ════════════════════════════════════════════════════
  console.log('\n[7] the dialog hands its textarea to the export');
  const nodes = {};
  function fakeEl(id) {
    const el = {
      id: id || '', innerHTML: '', value: '', _attrs: {},
      setAttribute: function (k, v) { this._attrs[k] = v; },
      addEventListener: function () {},
      appendChild: function () {}, remove: function () { el._removed = true; },
      focus: function () {}, querySelector: function () { return null; },
    };
    if (id) nodes[id] = el;
    return el;
  }
  const appended = [];
  globalThis.document = {
    createElement: function () { return fakeEl(''); },
    body: { appendChild: function (n) { appended.push(n); } },
    getElementById: function (id) { return nodes[id] || null; },
    addEventListener: function () {},
  };
  globalThis.__docNodes = nodes;
  // openNotesExportDialog() builds its markup as a string, then reads the
  // textarea back by id — so the stub has to answer for that id.
  const ta = fakeEl('notes-export-overlay');
  ta.remove = function () { nodes['notes-export-overlay'] = null; };
  nodes['notes-export-overlay'] = ta;
  const ta2 = fakeEl('notes-export-overall');
  ta2.value = 'typed in the box';
  nodes['notes-export-overall'] = ta2;

  globalThis.getSelectedImages = function () { return board; };
  reset();
  mod.openNotesExportDialog();
  const overlay = appended[appended.length - 1];
  ok(!!overlay, 'the dialog was added to the page');
  hasIn(overlay.innerHTML, '3 images', 'the dialog says how many images');
  // v7.13.0 changed the dialog: one textarea PER IMAGE, written back onto the
  // items. The old subtitle ("1 already carry a note") went with the old
  // one-textarea design; the new subtitle states the write-back instead.
  hasIn(overlay.innerHTML, 'saved back onto each image', 'the dialog says typing is written back (v7.17.0)');
  hasIn(overlay.innerHTML, 'notes-export-rows', 'there is a per-image rows host (v7.17.0)');
  hasIn(overlay.innerHTML, 'notes-export-overall', 'it has a textarea to type in');
  hasIn(overlay.innerHTML, 'closeNotesExportDialog()', 'cancel is wired');
  hasIn(overlay.innerHTML, 'submitNotesExportDialog()', 'export is wired');

  mod.submitNotesExportDialog();
  await new Promise(r => setTimeout(r, 60));
  const b3 = await globalThis.__saved.blob.text();
  hasIn(b3, 'typed in the box', 'what was typed becomes the overall comment');

  // ═══ summary ══════════════════════════════════════════════════════════
  console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + ' — ' + pass + ' passed, ' + fail + ' failed');
  if (fail) { fails.forEach(m => console.log('  · ' + m)); process.exit(1); }
})();
