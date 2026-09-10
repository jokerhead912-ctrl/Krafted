#!/usr/bin/env node
/*
 * test_v7_13_0.js — v7.13.0: per-image typing in the notes dialog, a Download
 * all (.zip) button on the image report, and Cmd+C that copies what the board
 * shows (single image baked through renderItemRegion, several images composed
 * into one contact sheet) so it can be pasted into WeChat.
 *
 *   A. PER-IMAGE TYPING. The v7.12.0 dialog had ONE textarea (the overall
 *      comment); per-image text had to be pre-typed in the properties panel,
 *      one item at a time. The dialog now has one row per image (thumbnail +
 *      textarea prefilled from item.note) and the typed text is WRITTEN BACK
 *      onto the items — one undo step for the whole dialog, nothing pushed
 *      when nothing changed.
 *
 *   B. ZIP ON THE IMAGE REPORT. The frame report already had an in-page zip
 *      writer. It is now in REPORT_LIGHTBOX_JS — ONE copy spread by both
 *      builders (病根①: the same writer in two reports is how the fourth copy
 *      of the crop maths survived v7.9.0). Section 2 executes buildZip and
 *      parses the bytes; section 4 asserts both reports carry the button and
 *      emit byte-identical <script> blocks.
 *
 *   C. COPY WHAT YOU SEE. copySelected() used to write item.src — the
 *      ORIGINAL file — to the system clipboard, so a cropped/reframed image
 *      pasted into WeChat uncropped (the same 病根① hole as v7.11.0). It now
 *      bakes through renderItemRegion(), exactly like cut/lasso/export, and
 *      composes a contact sheet for a multi-selection (ceil(sqrt(n)) grid,
 *      4096px long edge, board background colour).
 *
 * Sections 2-9 EXECUTE the functions (the v7.4.0 lesson: an anchor proves the
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
// A — the dialog
has('function notesWriteBack(', 'notesWriteBack() exists');
has('function notesDialogRow(', 'notesDialogRow() exists');
has('function submitNotesExportDialog(', 'submitNotesExportDialog() exists');
count('function notesWriteBack(', 1, 'one write-back helper');
count("getElementById('notes-row-' + i)", 1, 'per-image textareas are read back by row id');
has("ta.id = 'notes-row-' + i;", 'each row textarea carries its row id');
has('saved back onto each image', 'the dialog tells the user typing is written back');
// B — the zip writer is shared
count('function buildZip(files)', 1, 'exactly one zip writer in the whole file');
count('var CRC_TABLE', 1, 'exactly one CRC table');
count('id="zipBtn" type="button"', 2, 'both reports carry the zip button');
count('data-prefix="image"', 1, 'the image report names its entries image-*');
count('data-prefix="frame"', 1, 'the frame report still names its entries frame-*');
// C — copy what you see
has('const COPY_SHEET_MAX_SIDE = 4096;', 'the sheet is capped at 4096 on the long edge');
has('const COPY_SHEET_CELL = 900;', 'each cell is 900px');
has('function contactSheetGrid(', 'contactSheetGrid() exists');
has('function composeContactSheet(', 'composeContactSheet() exists');
has('function shrinkCanvas(', 'shrinkCanvas() exists');
has('function copyCanvasFromItem(', 'copyCanvasFromItem() exists');
has('async function copySelectionAsImage(', 'copySelectionAsImage() exists');
has('function writeBlobToSystemClipboard(', 'writeBlobToSystemClipboard() exists');
count('function copySelectionAsImage(', 1, 'one copy-to-system-image path');
// The single-renderer gate: the copy path must go through the ONE renderer,
// not read item.src directly (that is the v7.11.0 hole all over again).
has('const r = renderItemRegion(item, [', 'copy bakes through renderItemRegion()');
has('const aff = itemLocalToScreen(item);', 'copy derives geometry through itemLocalToScreen()');
// copySelected hands image selections to the new path.
has('    copySelectionAsImage()', 'copySelected() calls copySelectionAsImage()');
has('Copied ', 'the user is told what landed on the clipboard');

// ═══ build the two sandboxes that EXECUTE the real code ═════════════════
// Slice A: the report section (same boundaries as test_v7_12_0).
const A = 'function escapeHtml(s) {';
const B = '\nfunction videoAnnoDeleteComment(';
const a = HTML.indexOf(A);
const b = HTML.indexOf(B, a);
ok(a > 0 && b > a, 'found the report section to execute');
const CODE_A = HTML.slice(a, b);

globalThis.__notesSrcStub = async function (src) { return String(src || ''); };
globalThis.__notesDownStub = async function (url) { return url + '#shrunk'; };
globalThis.getSelectedImages = function () { return []; };
globalThis.toast = function (m) { globalThis.__toasts.push(m); };
globalThis.__toasts = [];
globalThis.confirm = function () { return globalThis.__confirmAnswer; };
globalThis.__confirmAnswer = false;
globalThis.kraftedSaveFile = async function (opts) { globalThis.__saved = opts; return 'saved'; };
globalThis.__saved = null;
globalThis.__undoCount = 0;
globalThis.__saveCount = 0;
globalThis.pushUndo = function () { globalThis.__undoCount++; };
globalThis.scheduleAutoSave = function () { globalThis.__saveCount++; };

const mod = new Function(
  CODE_A + '\n' +
  'notesSrcToDataUrl = globalThis.__notesSrcStub;\n' +
  'notesDownscale = globalThis.__notesDownStub;\n' +
  'return { escapeHtml: escapeHtml, REPORT_SHARED_CSS: REPORT_SHARED_CSS,' +
  ' REPORT_LIGHTBOX_JS: REPORT_LIGHTBOX_JS, buildExportHtml: buildExportHtml,' +
  ' buildNotesExportHtml: buildNotesExportHtml, notesReadingOrder: notesReadingOrder,' +
  ' notesExportableImages: notesExportableImages, exportNotesAsHtml: exportNotesAsHtml,' +
  ' openNotesExportDialog: openNotesExportDialog, submitNotesExportDialog: submitNotesExportDialog,' +
  ' closeNotesExportDialog: closeNotesExportDialog, notesWriteBack: notesWriteBack,' +
  ' notesDialogRow: notesDialogRow };')();

// Slice B: the clipboard section, from the blob writer to just before the
// Round 31 blob-URL comment. navigator/ClipboardItem are passed as PARAMETERS
// because Node 22 exposes a getter-only global navigator that cannot be
// overwritten from outside.
const A2 = 'function writeBlobToSystemClipboard(blob, type) {';
const B2 = '\n// Round 31: a blob: URL stays valid';
const a2 = HTML.indexOf(A2);
const b2 = HTML.indexOf(B2, a2);
ok(a2 > 0 && b2 > a2, 'found the clipboard section to execute');
const CODE_B = HTML.slice(a2, b2);

const clip = {
  writes: [],
  navigator: null, // built below
  created: [],     // every canvas document.createElement produced, in order
};
function ClipboardItemStub(obj) { this.obj = obj; }
clip.navigator = {
  clipboard: {
    write: function (items) { clip.writes.push(items); return Promise.resolve(); },
  },
};
// A canvas stub whose 2d context records everything drawn on it.
function fakeCanvas(w, h) {
  const cv = { width: w || 0, height: h || 0, _ctx: null, _blob: null, _toBlob: 0 };
  cv.getContext = function () {
    if (cv._ctx) return cv._ctx;
    const ctx = {
      fillStyle: '', fills: [], draws: [], scales: [], saves: 0, restores: 0,
      fillRect: function (x, y, w2, h2) { ctx.fills.push({ x: x, y: y, w: w2, h: h2, style: ctx.fillStyle }); },
      drawImage: function (img, x, y, w2, h2) { ctx.draws.push({ img: img, x: x, y: y, w: w2, h: h2 }); },
      scale: function (sx, sy) { ctx.scales.push([sx, sy]); },
      save: function () { ctx.saves++; },
      restore: function () { ctx.restores++; },
    };
    cv._ctx = ctx;
    return ctx;
  };
  cv.toBlob = function (cb, type) { cv._toBlob++; cv._blob = new Blob(['png-bytes'], { type: type }); cb(cv._blob); };
  return cv;
}
const clipDoc = {
  createElement: function (tag) {
    if (tag === 'canvas') { const cv = fakeCanvas(0, 0); clip.created.push(cv); return cv; }
    return {};
  },
};
const geoStub = {
  calls: [],
  itemLocalToScreen: function (item) { return item.__aff || null; },
  renderItemRegion: function (item, pts, opts) {
    geoStub.calls.push({ item: item, pts: pts });
    return item.__cv ? { canvas: item.__cv } : null;
  },
  apply: function (m, x, y) { return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }; },
};
const fetchStub = {
  calls: [],
  fetch: function (src) {
    fetchStub.calls.push(src);
    return Promise.resolve({ blob: function () { return Promise.resolve({ type: 'image/png', _src: src }); } });
  },
};
const gcss = { getPropertyValue: function () { return ' #101014 '; } };
let clipSel = [];
const modB = new Function(
  'navigator', 'ClipboardItem', 'document', 'getComputedStyle', 'fetch',
  'notesExportableImages', 'itemLocalToScreen', 'renderItemRegion', '_geoApply',
  CODE_B + '\nreturn { writeBlobToSystemClipboard: writeBlobToSystemClipboard,' +
  ' writeImageToSystemClipboard: writeImageToSystemClipboard,' +
  ' contactSheetGrid: contactSheetGrid, contactSheetSize: contactSheetSize,' +
  ' contactSheetCellRect: contactSheetCellRect, contactSheetFit: contactSheetFit,' +
  ' composeContactSheet: composeContactSheet, shrinkCanvas: shrinkCanvas,' +
  ' copyCanvasFromItem: copyCanvasFromItem, copySelectionAsImage: copySelectionAsImage,' +
  ' COPY_SHEET_MAX_SIDE: COPY_SHEET_MAX_SIDE, COPY_SHEET_CELL: COPY_SHEET_CELL,' +
  ' COPY_SHEET_GAP: COPY_SHEET_GAP };'
)(
  clip.navigator, ClipboardItemStub, clipDoc, gcss, fetchStub.fetch,
  function () { return clipSel; },
  geoStub.itemLocalToScreen, geoStub.renderItemRegion, geoStub.apply
);

// ═══ 2. the zip writer, byte by byte ════════════════════════════════════
console.log('\n[2] buildZip produces a parseable STORED zip');
// Eval the shared lightbox script — it is an array of source lines, and the
// zip writer lives inside it. The trailing IIFE looks up the button, so the
// document stub has to answer getElementById.
const lbDoc = { getElementById: function () { return null; }, addEventListener: function () {} };
const lb = new Function('document', 'atob', 'TextEncoder',
  mod.REPORT_LIGHTBOX_JS.join('\n') +
  '\nreturn { buildZip: buildZip, crc32: crc32, dataUrlToBytes: dataUrlToBytes,' +
  ' zipEntryExt: zipEntryExt, zipEntryDataUrl: zipEntryDataUrl };'
)(lbDoc, atob, TextEncoder);

// An INDEPENDENT crc32, bitwise, no table — if both are wrong the same way
// this oracle cannot agree with them by accident.
function crcOracle(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}
const f1 = { name: 'image-00001-01.png', data: new Uint8Array([1, 2, 3, 4, 5]) };
const f2 = { name: 'image-00002-02.jpg', data: new Uint8Array([9, 8, 7]) };
const zip = lb.buildZip([f1, f2]);
ok(zip instanceof Uint8Array, 'buildZip returns bytes');
const dv = new DataView(zip.buffer);
// Entry 1: local header.
eq(dv.getUint32(0, true), 0x04034b50, 'local header signature PK\\x03\\x04');
eq(dv.getUint16(8, true), 0, 'method is STORED (no compression)');
eq(dv.getUint32(14, true), crcOracle(f1.data), 'local header carries the real crc32');
eq(dv.getUint32(18, true), f1.data.length, 'compressed size == data length (STORED)');
eq(dv.getUint32(22, true), f1.data.length, 'uncompressed size == data length');
eq(dv.getUint16(26, true), f1.name.length, 'name length in the header');
const name1 = Buffer.from(zip.slice(30, 30 + f1.name.length)).toString('utf8');
eq(name1, f1.name, 'the file name is in the header');
const dataOff1 = 30 + f1.name.length;
ok(zip.slice(dataOff1, dataOff1 + 5).join(',') === '1,2,3,4,5', 'raw file bytes follow the header');
// Entry 2 starts right after entry 1's header + data.
const off2 = dataOff1 + f1.data.length;
eq(dv.getUint32(off2, true), 0x04034b50, 'second local header follows the first file');
const dataOff2 = off2 + 30 + f2.name.length;
ok(zip.slice(dataOff2, dataOff2 + 3).join(',') === '9,8,7', 'second file carries its own bytes');
eq(dv.getUint32(off2 + 14, true), crcOracle(f2.data), 'second file has its own crc');
// Central directory + EOCD.
const centralOff = dataOff2 + f2.data.length;
eq(dv.getUint32(centralOff, true), 0x02014b50, 'central directory starts after the data');
eq(dv.getUint32(centralOff + 42, true), 0, 'first central entry points at offset 0');
eq(dv.getUint32(centralOff + 46 + f1.name.length + 42, true), off2, 'second central entry points at the second header');
const eocdOff = zip.length - 22;
eq(dv.getUint32(eocdOff, true), 0x06054b50, 'the file ends with an EOCD record');
eq(dv.getUint16(eocdOff + 8, true), 2, 'EOCD counts two entries');
eq(dv.getUint16(eocdOff + 10, true), 2, 'EOCD counts two entries (total)');
eq(dv.getUint32(eocdOff + 16, true), centralOff, 'EOCD points at the central directory');
eq(lb.crc32(f1.data), crcOracle(f1.data), 'the table crc32 agrees with the bitwise oracle');
// Helpers.
eq(lb.zipEntryExt('data:image/jpeg;base64,x'), 'jpg', 'jpeg data URL -> .jpg');
eq(lb.zipEntryExt('data:image/png;base64,x'), 'png', 'png data URL -> .png');
eq(lb.zipEntryExt('data:image/webp;base64,x'), 'webp', 'webp data URL -> .webp');
const elSnap = { getAttribute: function () { return 'data:image/png;base64,SNAP'; }, querySelector: function () { return null; } };
eq(lb.zipEntryDataUrl(elSnap), 'data:image/png;base64,SNAP', 'the frame report reads data-snap');
const elImg = { getAttribute: function () { return null; }, querySelector: function () { return { src: 'data:image/png;base64,IMG' }; } };
eq(lb.zipEntryDataUrl(elImg), 'data:image/png;base64,IMG', 'the image report reads img.snap src');
eq(lb.dataUrlToBytes('data:image/png;base64,AQID').join(','), '1,2,3', 'base64 decodes to bytes');

// ═══ 3. one script block, two reports (病根① gate) ═══════════════════════
console.log('\n[3] both reports carry the button and the SAME script');
function scriptBlock(doc) {
  const i = doc.indexOf('<script>');
  const j = doc.indexOf('</script>', i);
  return (i < 0 || j < 0) ? '' : doc.slice(i, j);
}
const frameReport = mod.buildExportHtml({
  videoName: 'clip.mp4', videoBase: 'clip', fileExt: '.mp4', durStr: '0:30',
  commentsCount: 1, fps: 30, exportedAt: '2026-09-10 13:00:00',
  rows: '<div class="row">x</div>', overComment: ''
});
const notesReport = mod.buildNotesExportHtml({
  title: 'Board', imageCount: 2, commentCount: 1,
  exportedAt: '2026-09-10 13:00:00', rows: '<div class="row">y</div>', overComment: ''
});
hasIn(frameReport, 'id="zipBtn"', 'the frame report has the zip button');
hasIn(notesReport, 'id="zipBtn"', 'the image report has the zip button');
hasIn(frameReport, 'data-prefix="frame"', 'the frame report prefixes frame');
hasIn(notesReport, 'data-prefix="image"', 'the image report prefixes image');
hasIn(notesReport, 'Download all images (.zip)', 'the image report says what the button does');
const scFrame = scriptBlock(frameReport);
const scNotes = scriptBlock(notesReport);
ok(scFrame.length > 3000, 'the frame report carries a real script (' + scFrame.length + ' chars)');
eq(scNotes, scFrame, 'the two reports emit a byte-identical <script> block');
eq((scNotes.match(/function buildZip/g) || []).length, 1, 'the shared script carries the zip writer once');

// ═══ 4. notesWriteBack executes ═════════════════════════════════════════
console.log('\n[4] the write-back: one undo, nothing pushed when nothing changed');
// notesWriteBack looks up the library panel — the document stub just says no.
globalThis.document = { getElementById: function () { return null; } };
function wbReset() { globalThis.__undoCount = 0; globalThis.__saveCount = 0; }

wbReset();
const wb1 = [{ note: 'keep me' }, { note: '' }];
mod.notesWriteBack(wb1, ['keep me', '']);
eq(globalThis.__undoCount, 0, 'no change -> no undo entry');
eq(globalThis.__saveCount, 0, 'no change -> no autosave');
eq(wb1[0].note, 'keep me', 'no change -> notes untouched');

wbReset();
const wb2 = [{ note: 'old' }, { note: '' }, {}];
mod.notesWriteBack(wb2, ['new', 'typed', 'first']);
eq(globalThis.__undoCount, 1, 'one undo entry for the WHOLE dialog');
eq(wb2[0].note, 'new', 'first note written back');
eq(wb2[1].note, 'typed', 'second note written back');
eq(wb2[2].note, 'first', 'a missing note field is created');
ok(globalThis.__saveCount >= 1, 'a change schedules an autosave');

wbReset();
const wb3 = [{ note: 'same' }];
mod.notesWriteBack(wb3, null);
eq(globalThis.__undoCount, 0, 'a null notes array means keep everything');
eq(wb3[0].note, 'same', 'null notes array writes nothing');
wbReset();
mod.notesWriteBack([], ['x']);
eq(globalThis.__undoCount, 0, 'no items -> no undo');
mod.notesWriteBack(null, ['x']);
eq(globalThis.__undoCount, 0, 'null items -> no crash, no undo');

// Clearing a note is a change too — an erased comment must be undoable and
// must reach the autosave, or the board silently keeps the old words.
wbReset();
const wb4 = [{ note: 'was here' }];
mod.notesWriteBack(wb4, ['']);
eq(globalThis.__undoCount, 1, 'clearing a note is a change');
eq(wb4[0].note, '', 'the note is really cleared');

// ═══ 5. notesDialogRow executes ═════════════════════════════════════════
console.log('\n[5] each dialog row is prefilled from the item');
const rowDoc = {
  createElement: function () {
    return {
      _attrs: {}, children: [],
      setAttribute: function (k, v) { this._attrs[k] = v; },
      appendChild: function (c) { this.children.push(c); },
    };
  },
};
const savedDoc = globalThis.document;
globalThis.document = rowDoc;
const rowItem = { note: 'prefill <me> & "quotes"', name: 'shot.png', src: 'data:image/png;base64,THUMB' };
const row = mod.notesDialogRow(rowItem, 3);
globalThis.document = savedDoc;
const ta5 = row.children[1].children[1];
eq(ta5.id, 'notes-row-3', 'the textarea carries its row id');
eq(ta5.value, rowItem.note, 'the textarea is prefilled with the existing note');
eq(ta5.maxLength, 600, 'same 600-char cap as the properties panel');
const thumb5 = row.children[0];
eq(thumb5.src, 'data:image/png;base64,THUMB', 'the row shows the image itself');
// Built as DOM nodes, not innerHTML: markup in a note must survive as text.
eq(ta5.value.indexOf('<me>') >= 0, true, 'markup in a note is assigned, never parsed');

// ═══ 6. contact sheet maths ═════════════════════════════════════════════
console.log('\n[6] the contact sheet grid');
eq(modB.COPY_SHEET_MAX_SIDE, 4096, 'long edge cap is 4096');
eq(modB.COPY_SHEET_CELL, 900, 'cell is 900');
eq(modB.COPY_SHEET_GAP, 24, 'gap is 24');
function gridStr(g) { return g.cols + 'x' + g.rows; }
eq(gridStr(modB.contactSheetGrid(1)), '1x1', 'one image is a single cell');
eq(gridStr(modB.contactSheetGrid(2)), '2x1', 'two images sit side by side');
eq(gridStr(modB.contactSheetGrid(3)), '2x2', 'three images fill a 2x2');
eq(gridStr(modB.contactSheetGrid(4)), '2x2', 'four images fill a 2x2');
eq(gridStr(modB.contactSheetGrid(5)), '3x2', 'five images need three columns');
eq(gridStr(modB.contactSheetGrid(9)), '3x3', 'nine images fill a 3x3');
eq(gridStr(modB.contactSheetGrid(10)), '4x3', 'ten images need four columns');

// Sizing: under the cap the canvas is exact; over it the whole sheet scales.
const s3 = modB.contactSheetSize({ cols: 3, rows: 3 });
eq(s3.w, 3 * 900 + 4 * 24, 'a 3x3 sheet is exact under the cap');
eq(s3.scale, 1, 'a 3x3 sheet needs no scaling');
const s5 = modB.contactSheetSize({ cols: 5, rows: 5 });
const raw5 = 5 * 900 + 6 * 24;
ok(raw5 > 4096, 'the 5x5 fixture really is over the cap (' + raw5 + ')');
eq(s5.w, 4096, 'an over-cap sheet is scaled down to the cap');
ok(Math.abs(s5.scale - 4096 / raw5) < 1e-9, 'the scale factor is the cap ratio');

// Cells tile with a gap on every side.
const r0 = modB.contactSheetCellRect(0, { cols: 2, rows: 2 });
eq([r0.x, r0.y, r0.w, r0.h].join(','), '24,24,900,900', 'first cell starts at one gap');
const r1 = modB.contactSheetCellRect(1, { cols: 2, rows: 2 });
eq(r1.x, 24 + 900 + 24, 'second column starts after cell + gap');
const r2 = modB.contactSheetCellRect(2, { cols: 2, rows: 2 });
eq(r2.y, 24 + 900 + 24, 'second row starts after cell + gap');
eq(r2.x, 24, 'second row starts back at the left');

// Fit: contain, never crop (and small images are allowed to upscale — the
// alternative is a tiny thumbnail floating in a 900px cell).
const fWide = modB.contactSheetFit({ width: 1800, height: 900 }, { x: 24, y: 24, w: 900, h: 900 });
eq([fWide.w, fWide.h].join(','), '900,450', 'a wide image is letterboxed, not cropped');
eq(fWide.y, 24 + 225, 'a wide image is centred vertically');
// A 450x1800 image into a 900x900 cell: the height is the binding constraint
// (900/1800 = 0.5 beats 900/450 = 2), so it lands at 225x900 — not 450x900,
// which is what you get if you fit by width alone.
const fTall = modB.contactSheetFit({ width: 450, height: 1800 }, { x: 24, y: 24, w: 900, h: 900 });
eq([fTall.w, fTall.h].join(','), '225,900', 'a tall image fits by its binding edge, not cropped');
eq(fTall.x, 361.5, 'a tall image is centred horizontally');
const fSmall = modB.contactSheetFit({ width: 100, height: 100 }, { x: 0, y: 0, w: 900, h: 900 });
eq(fSmall.w, 900, 'a small image fills its cell (upscale is intended)');

// ═══ 7. composeContactSheet + shrinkCanvas execute ══════════════════════
console.log('\n[7] the sheet is really composed');
clip.created.length = 0;
const imgs7 = [fakeCanvas(1800, 1350), fakeCanvas(1800, 1350), fakeCanvas(1800, 1350)];
const sheet7 = modB.composeContactSheet(imgs7, { bg: '#101014' });
ok(!!sheet7, 'a sheet came back');
eq(sheet7.width, 1872, 'three images -> 2x2 sheet, 1872px wide');
eq(sheet7.height, 1872, '2x2 sheet, 1872px tall');
const ctx7 = sheet7._ctx;
eq(ctx7.fills.length, 1, 'the background is painted exactly once');
// Guarded: a mutation that deletes the fill leaves fills empty, and an
// unguarded fills[0] would crash the suite before its own summary (fragile).
const fill0 = ctx7.fills[0] || {};
eq(fill0.style, '#101014', 'the background uses the board colour');
eq([fill0.w, fill0.h].join(','), '1872,1872', 'the background covers the whole sheet');
eq(ctx7.draws.length, 3, 'every image is drawn');
eq([ctx7.draws[0].x, ctx7.draws[0].y, ctx7.draws[0].w, ctx7.draws[0].h].join(','),
   '24,136.5,900,675', 'first image is fitted into the first cell');
eq([ctx7.draws[2].x, ctx7.draws[2].y].join(','), '24,1060.5', 'third image wraps to the second row');
ok(ctx7.draws.every(d => imgs7.indexOf(d.img) >= 0), 'the draws reference the given images');

// The cap is applied to the finished sheet.
const sheetBig = modB.composeContactSheet(
  [fakeCanvas(100, 100), fakeCanvas(100, 100), fakeCanvas(100, 100),
   fakeCanvas(100, 100), fakeCanvas(100, 100), fakeCanvas(100, 100),
   fakeCanvas(100, 100), fakeCanvas(100, 100), fakeCanvas(100, 100),
   fakeCanvas(100, 100), fakeCanvas(100, 100), fakeCanvas(100, 100),
   fakeCanvas(100, 100), fakeCanvas(100, 100), fakeCanvas(100, 100),
   fakeCanvas(100, 100), fakeCanvas(100, 100), fakeCanvas(100, 100),
   fakeCanvas(100, 100), fakeCanvas(100, 100), fakeCanvas(100, 100),
   fakeCanvas(100, 100), fakeCanvas(100, 100), fakeCanvas(100, 100),
   fakeCanvas(100, 100)], {});
eq(sheetBig.width, 4096, 'a 5x5 sheet is capped at 4096');
ok(sheetBig._ctx.scales.length === 1 && sheetBig._ctx.scales[0][0] < 1, 'the cap is applied as a canvas scale');

// shrinkCanvas only shrinks.
const big7 = fakeCanvas(2000, 1000);
const shrunk = modB.shrinkCanvas(big7, 1000);
ok(shrunk !== big7, 'an over-limit canvas is replaced');
eq([shrunk.width, shrunk.height].join(','), '1000,500', 'the shrink keeps the aspect ratio');
// Guarded: a mutation that neuters the shrink returns the input, whose _ctx
// is null — an unguarded .draws would crash the suite before its summary.
eq(shrunk._ctx && shrunk._ctx.draws[0] && shrunk._ctx.draws[0].img, big7, 'the shrink draws the original');
const kept = modB.shrinkCanvas(big7, 4096);
ok(kept === big7, 'an under-limit canvas is returned as-is');

// ═══ 8-9. async: the dialog submit and the clipboard path ═══════════════
(async () => {
  // ═══ 8. submitNotesExportDialog: typed text wins, and is written back ═
  console.log('\n[8] the dialog hands every row to the export AND the board');
  const nodes = {};
  function fakeEl(id) {
    const el = {
      id: id || '', innerHTML: '', value: '', _attrs: {},
      setAttribute: function (k, v) { this._attrs[k] = v; },
      addEventListener: function () {},
      appendChild: function () {}, remove: function () { nodes[id] = null; },
      focus: function () {},
    };
    if (id) nodes[id] = el;
    return el;
  }
  globalThis.document = {
    createElement: function () { return fakeEl(''); },
    body: { appendChild: function () {} },
    getElementById: function (id) { return nodes[id] || null; },
    addEventListener: function () {},
  };
  fakeEl('notes-export-overlay');
  const overallTa = fakeEl('notes-export-overall');
  overallTa.value = '  overall with whitespace  ';
  const rowTa = fakeEl('notes-row-0');
  rowTa.value = 'fresh note for A';
  // notes-row-1 deliberately absent: the export must fall back to the note
  // already on the item, the way it did before the dialog existed.
  const boardA = Object.assign(
    { id: 'A', x: 0, y: 0, w: 100, h: 80, src: 'data:image/png;base64,AAAA', img: {}, name: 'a.png', note: 'OLD note for A' }, {});
  const boardB = Object.assign(
    { id: 'B', x: 200, y: 0, w: 100, h: 80, src: 'data:image/png;base64,BBBB', img: {}, name: 'b.png', note: 'note for B' }, {});
  globalThis.getSelectedImages = function () { return [boardA, boardB]; };
  globalThis.__saved = null;
  globalThis.__undoCount = 0;
  mod.submitNotesExportDialog();
  await new Promise(r => setTimeout(r, 60));
  ok(!!globalThis.__saved, 'submitting the dialog produces a file');
  const doc8 = await globalThis.__saved.blob.text();
  hasIn(doc8, 'fresh note for A', 'what was typed in the row reaches the document');
  lacksIn(doc8, 'OLD note for A', 'the typed text REPLACES the stored note in the document');
  hasIn(doc8, 'note for B', 'a row nobody typed in falls back to the stored note');
  hasIn(doc8, 'overall with whitespace', 'the overall comment survives (trimmed by the builder)');
  eq(boardA.note, 'fresh note for A', 'the typed text is written back onto the item');
  eq(boardB.note, 'note for B', 'the untouched row keeps its note');
  eq(globalThis.__undoCount, 1, 'the whole submit is one undo step');
  eq(nodes['notes-export-overlay'], null, 'the dialog closed itself');

  // ═══ 9. copySelectionAsImage: bake, sheet, fallback ═══════════════════
  console.log('\n[9] Cmd+C copies what the board shows');
  function clipReset() { clip.writes.length = 0; clip.created.length = 0; geoStub.calls.length = 0; fetchStub.calls.length = 0; }
  const AFF = { a: 1, b: 0, c: 0, d: 1, e: 5, f: 7 };

  // Single image: baked through the renderer, written as PNG.
  clipReset();
  const cvSingle = fakeCanvas(200, 100);
  const item1 = { el: {}, w: 200, h: 100, src: 'ORIGINAL-SRC', __aff: AFF, __cv: cvSingle };
  clipSel = [item1];
  const n1 = await modB.copySelectionAsImage();
  eq(n1, 1, 'one image copied');
  eq(geoStub.calls.length, 1, 'the renderer ran once');
  // Guarded: a mutation that deletes the render call leaves calls empty, and
  // an unguarded calls[0].pts would crash the suite before its summary.
  const pts = (geoStub.calls[0] || {}).pts;
  eq(JSON.stringify(pts), JSON.stringify([{ x: 5, y: 7 }, { x: 205, y: 7 }, { x: 205, y: 107 }, { x: 5, y: 107 }]),
     'the renderer is given the four item-local corners mapped to screen');
  eq(clip.writes.length, 1, 'one system clipboard write');
  eq(clip.writes[0] && clip.writes[0][0].obj['image/png'], cvSingle._blob, 'the BAKED canvas is what was written');
  eq(cvSingle._toBlob, 1, 'the bake was encoded as a blob');
  eq(fetchStub.calls.length, 0, 'the original file is never fetched on the bake path');

  // Multi: shrunk to cell size, composed into one sheet, written once.
  clipReset();
  const cvA = fakeCanvas(4000, 3000);   // over the 1800 keep-limit -> replaced
  const cvB = fakeCanvas(2000, 2000);   // over -> replaced
  const cvC = fakeCanvas(1000, 500);    // under -> kept as-is
  clipSel = [
    { el: {}, w: 400, h: 300, src: 'A', __aff: AFF, __cv: cvA },
    { el: {}, w: 200, h: 200, src: 'B', __aff: AFF, __cv: cvB },
    { el: {}, w: 100, h: 50, src: 'C', __aff: AFF, __cv: cvC },
  ];
  const n3 = await modB.copySelectionAsImage();
  eq(n3, 3, 'three images copied');
  eq(clip.writes.length, 1, 'a multi-selection is ONE clipboard write');
  // The sheet is the canvas composeContactSheet created — the last one the
  // document produced before toBlob ran. Guarded: a mutation that kills the
  // bake leaves created empty, and unguarded derefs would crash the suite
  // before its own summary.
  const sheetCv = clip.created[clip.created.length - 1] || null;
  eq(sheetCv && sheetCv._toBlob, 1, 'the sheet is what got encoded');
  eq(clip.writes[0] && clip.writes[0][0].obj['image/png'], sheetCv && sheetCv._blob, 'the sheet blob is on the clipboard');
  eq(sheetCv && sheetCv.width, 1872, 'the sheet is a 2x2 at 1872px');
  const draws9 = (sheetCv && sheetCv._ctx) ? sheetCv._ctx.draws : [];
  eq(draws9.length, 3, 'all three images made the sheet');
  ok(draws9.length > 0 && draws9[0].img !== cvA, 'the 4000px bake was shrunk before composing (memory)');
  ok(draws9.length > 1 && draws9[1].img !== cvB, 'the 2000px bake was shrunk before composing');
  ok(draws9.length > 2 && draws9[2].img === cvC, 'the small bake is composed directly');
  eq(fetchStub.calls.length, 0, 'no fallback fetch on the sheet path');

  // Single image the renderer cannot read (cross-origin): the copy still
  // lands, on the original bytes — a degraded copy beats no copy.
  clipReset();
  clipSel = [{ el: {}, w: 10, h: 10, src: 'data:image/png;base64,ORIG', __aff: AFF, __cv: null }];
  const nF = await modB.copySelectionAsImage();
  eq(nF, 1, 'the fallback still reports a copy');
  eq(fetchStub.calls.join(','), 'data:image/png;base64,ORIG', 'the fallback writes the ORIGINAL src');
  eq(clip.writes.length, 1, 'the fallback reaches the system clipboard');

  // Multi where nothing renders: no fallback (which original would it even
  // be?) — a clean zero.
  clipReset();
  clipSel = [
    { el: {}, w: 10, h: 10, src: 'X', __aff: AFF, __cv: null },
    { el: {}, w: 10, h: 10, src: 'Y', __aff: AFF, __cv: null },
  ];
  const n0 = await modB.copySelectionAsImage();
  eq(n0, 0, 'a multi-selection that cannot render copies nothing');
  eq(clip.writes.length, 0, 'and never touches the clipboard');

  // Nothing selected: nothing happens.
  clipReset();
  clipSel = [];
  const nE = await modB.copySelectionAsImage();
  eq(nE, 0, 'empty selection -> zero');
  eq(clip.writes.length, 0, 'empty selection -> no clipboard write');

  // ═══ summary ══════════════════════════════════════════════════════════
  console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + ' — ' + pass + ' passed, ' + fail + ' failed');
  if (fail) { fails.forEach(m => console.log('  · ' + m)); process.exit(1); }
})().catch(e => { console.log('HARNESS ERROR: ' + (e && e.stack || e)); process.exit(2); });
