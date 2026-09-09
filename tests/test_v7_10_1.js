#!/usr/bin/env node
/*
 * test_v7_10_1.js — right-click "Download Source File" was a duplicate.
 *
 *   A. THE REPORT. "right click: download source file now is double function,
 *      u can remove it". It was: on an image selection the menu offered
 *      "Download Source File" AND v7.9.0's "Save original files…", and both
 *      write the very same untouched bytes. The v7.9.0 one is strictly better
 *      (a picked folder or one zip, de-duplicated names, a cancel button), so
 *      the older one is the redundant half.
 *
 *   B. WHY IT COULD NOT JUST BE DELETED. Video and audio items are BUILT WITH
 *      img: null (kraftpub-dev.html: `img: isVideo ? null : mediaEl`), and
 *      every image export selects on `item.img`. So `Save original files…`
 *      cannot see a clip at all — selecting one and clicking it answers
 *      "No images to export". "Download Source File" was the ONLY way those
 *      bytes could ever leave the board. Deleting it would have taken the
 *      video/audio export with it.
 *
 *   C. THE FIX. The entry survives, narrowed: it is offered only when the
 *      selection actually holds a video or an audio item, it is renamed
 *      "Save media files…", and exportMediaSelected() now refuses images
 *      instead of quietly exporting them a second time. The image entries are
 *      likewise counted on real images, because getSelectedImages() returns
 *      every selected item — so a video-only selection used to be offered two
 *      image entries that both did nothing.
 *
 *   D. ONE PREDICATE, NOT TWO. A .kpak-restored item may carry only
 *      `type: 'video'` and no `isVideo`. The filter accepted that shape while
 *      the branches below only checked `isVideo`, so such an item passed the
 *      filter and then fell through every branch, coming out as .bin. isVid()
 *      / isAud() are now used by the filter AND the branches.
 *
 * Everything below EXECUTES the sliced source. An anchor proves the code
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
function lacks(needle, m) { ok(HTML.indexOf(needle) < 0, m + '  (still present: ' + JSON.stringify(needle.slice(0, 90)) + ')'); }
function count(needle, n, m) {
  let c = 0, i = -1;
  while ((i = HTML.indexOf(needle, i + 1)) >= 0) c++;
  eq(c, n, m + '  (found ' + c + ', want ' + n + ')');
}
function section(body) {
  try { body(); } catch (e) { fail++; fails.push('section threw: ' + e.message); console.log('  FAIL: section threw: ' + e.message); }
}

// ═══ 0. slice the real source ════════════════════════════════════════════
function slice(start, end, label) {
  const i = HTML.indexOf(start);
  if (i < 0) throw new Error('slice start not found: ' + label);
  const j = HTML.indexOf(end, i);
  if (j < 0) throw new Error('slice end not found: ' + label);
  return HTML.slice(i, j);
}
const EXTNAME = slice('function extFromName(name, fallback) {',
  'function dedupeExportNames(names) {', 'extFromName');
const MENU = slice('function exportMenuEntries(n) {', 'function showCtx(x, y) {', 'exportMenuEntries');
const CTX = slice('function showCtx(x, y) {',
  '// Keep the context menu inside the viewport', 'showCtx');
const MEDIAFN = slice('function exportMediaSelected() {', '// ==== save-load.js ====', 'exportMediaSelected');

// ═══ 1. the fixture ══════════════════════════════════════════════════════
const BLOB = 'blob:https://krafted.test/550e8400-e29b-41d4-a716-446655440000';
// img: non-null == an image, exactly as the app builds it.
function image(n) { return { id: 90 + n, filename: 'IMG_' + n + '.jpg', src: BLOB, img: {} }; }
// isVideo items are built with `img: null` — the reason no image export can
// see them, and the reason this entry has to survive.
function video(n, name) { return { id: 80 + n, filename: name || 'clip.mov', src: BLOB, isVideo: true, img: null }; }
function audio(n, name) { return { id: 70 + n, audioName: name || 'ambience.wav', src: BLOB, isAudio: true, img: null }; }

function fakeMenu() { return { innerHTML: '', style: {}, offsetWidth: 200, offsetHeight: 400 }; }

// showCtx(), executed. getSelectedImages() returns EVERY selected item in the
// real app (the name lies), so the stub does too — otherwise the bug this
// release fixes could not be reproduced here.
function ctxFor(sel, boardItems) {
  const menu = fakeMenu();
  const body = EXTNAME + '\n' + MENU + '\n' + CTX + '\nreturn { showCtx: showCtx };';
  const api = new Function('ctxMenu', 'getSelectedItems', 'getSelectedImages', 'Platform',
    'state', 'wheelModeLabel', 'positionCtxMenu', 'abCanOpen', body)(
    menu,
    function () { return sel; },
    function () { return sel; },
    { mac: false },
    { items: boardItems || [], altPanEnabled: false },
    function () { return 'Auto'; },
    function () {},
    undefined);
  api.showCtx(40, 40);
  return menu.innerHTML;
}

// exportMediaSelected(), executed: every <a download> it clicks is recorded.
function mediaFor(sel) {
  const links = [], toasts = [];
  const doc = {
    createElement: function () {
      const a = { href: '', download: '', click: function () { links.push(a.download); } };
      return a;
    }
  };
  const body = EXTNAME + '\n' + MEDIAFN + '\nreturn { exportMediaSelected: exportMediaSelected };';
  const api = new Function('document', 'toast', 'getSelectedItems', 'location', body)(
    doc, function (m) { toasts.push(m); }, function () { return sel; },
    { href: 'https://krafted.test/' });
  api.exportMediaSelected();
  return { links: links, toasts: toasts };
}

// ═══ 2. wiring ═══════════════════════════════════════════════════════════
section(function () {
  ok(MEDIAFN.length > 500, 'the media export is present');
  ok(CTX.length > 2000, 'the context menu builder is present');

  // The duplicate itself.
  lacks('Download Source File', 'the duplicate entry is gone');
  lacks("'Download Source File': '下载原始档',", '…and so is its dictionary entry');
  has('Save media files…', 'the entry that replaced it names what it saves');
  has("'Save media files…': '储存媒体档…',", 'the new label is translated');
  count('Save media files…', 2, 'one menu label and one dictionary key, not a third copy');

  // The gate.
  has('const hasMedia = sel.some(', 'the menu computes a media test');
  has('if (hasMedia) html += ', 'the entry is gated on that test');
  count('if (hasMedia) html += ', 1, 'the gate is written once');
  lacks('>Download Source File</div>', 'no unconditional per-item export is left');

  // The image side: counted on what the export can actually see.
  has('const _selImages = getSelectedImages().filter(i => i && i.img && i.src).length;',
    'the image entries count real images');
  has('if (_selImages) html += exportMenuEntries(_selImages);',
    '…and are offered only when there is one');
  lacks('if (hasImages) html += exportMenuEntries(',
    'the old gate counted every selected item, images or not');

  // The image branch of the media export is gone, not commented out.
  lacks('    } else if (item.src) {', 'the image branch of the media export is deleted');

  // One predicate for the filter and the branches.
  has('const isVid = function (it) {', 'one video test exists');
  has('const isAud = function (it) {', 'one audio test exists');
  count('isVid(item)', 1, 'the video branch uses the shared test');
  count('isAud(item)', 1, 'the audio branch uses the shared test');
  has('return !!(it && it.src && (isVid(it) || isAud(it)));',
    'the filter uses the same tests, so nothing can pass it and fall through');
});

// ═══ 3. the menu, executed ═══════════════════════════════════════════════
section(function () {
  // --- images only: the duplicate is gone, the v7.9.0 pair remains
  const onlyImages = ctxFor([image(1), image(2)]);
  ok(onlyImages.indexOf('Save original files…') >= 0, 'an image selection keeps the v7.9.0 original-files entry');
  ok(onlyImages.indexOf('Save images as PNG…') >= 0, '…and the baked PNG entry');
  ok(onlyImages.indexOf('Save media files…') < 0, 'NO media entry for an image-only selection (the duplicate)');
  ok(onlyImages.indexOf('<kbd style="opacity:.4">2</kbd>') >= 0, 'the chip counts the two real images');

  // --- video only: the entry that has no substitute
  const onlyVideo = ctxFor([video(1)]);
  ok(onlyVideo.indexOf('Save media files…') >= 0, 'a video selection is offered the media entry');
  ok(onlyVideo.indexOf('Save original files…') < 0, '…and no image entry that would answer "No images to export"');
  ok(onlyVideo.indexOf('Save images as PNG…') < 0, '…nor a PNG entry it cannot fill');

  // --- audio only
  const onlyAudio = ctxFor([audio(1)]);
  ok(onlyAudio.indexOf('Save media files…') >= 0, 'an audio selection is offered the media entry');
  ok(onlyAudio.indexOf('Save original files…') < 0, '…and no image entry');

  // --- mixed: each entry handles its own kind, no overlap
  const mixed = ctxFor([image(1), video(1)]);
  ok(mixed.indexOf('Save media files…') >= 0, 'a mixed selection still offers the media entry');
  ok(mixed.indexOf('Save original files…') >= 0, '…and the image entry for the image half');
  ok(mixed.indexOf('<kbd style="opacity:.4">1</kbd>') >= 0, 'the image chip counts the one real image, not the video');

  // --- the empty-canvas branch is untouched
  const empty = ctxFor([], [image(1), video(1)]);
  ok(empty.indexOf('Save Board') >= 0, 'an empty canvas still offers Save Board');
  ok(empty.indexOf('<kbd style="opacity:.4">1</kbd>') >= 0, 'the empty-canvas chip counts board images only');
  ok(empty.indexOf('Save media files…') < 0, 'no media entry with nothing selected');
});

// ═══ 4. exportMediaSelected, executed ════════════════════════════════════
section(function () {
  // The whole point: images must NOT come out here any more.
  const imgs = mediaFor([image(1), image(2)]);
  eq(imgs.links.length, 0, 'an image-only selection produces no download at all');
  ok(imgs.toasts.join('|').indexOf('video or audio') >= 0,
    '…and says why, instead of silently doing nothing');

  // Nothing selected keeps its own message.
  const none = mediaFor([]);
  eq(none.links.length, 0, 'an empty selection produces no download');
  eq(none.toasts[0], 'Select an item first', 'an empty selection keeps its original message');

  // Video.
  const vid = mediaFor([video(1, 'clip.mov')]);
  eq(vid.links.length, 1, 'a video produces one download');
  eq(vid.links[0], 'clip.mov', 'and keeps the extension of its own name, not the GUID');

  // Audio.
  const aud = mediaFor([audio(1, 'ambience.wav')]);
  eq(aud.links.length, 1, 'an audio item produces one download');
  eq(aud.links[0], 'ambience.wav', 'audio keeps its own extension too');

  // The .kpak shape: `type` and no `isVideo`. This used to pass the filter
  // and then fall through every branch, so it came out as export_<ts>.bin.
  const kpak = mediaFor([{ filename: 'restored.mp4', src: BLOB, type: 'video', img: null }]);
  eq(kpak.links.length, 1, 'a type-only video is still recognised');
  eq(kpak.links[0], 'restored.mp4', '…and takes the video branch, not the .bin fallback');

  const kpakAud = mediaFor([{ audioName: 'restored.mp3', src: BLOB, type: 'audio', img: null }]);
  eq(kpakAud.links.length, 1, 'a type-only audio item is still recognised');
  eq(kpakAud.links[0], 'restored.mp3', '…and takes the audio branch, not the .bin fallback');

  // Mixed: the images are skipped, the media come out.
  const mixed = mediaFor([image(1), video(1, 'take1.mp4'), audio(1, 'sfx.mp3'), image(2)]);
  eq(mixed.links.length, 2, 'a mixed selection downloads the media only');
  eq(mixed.links[0], 'take1.mp4', 'the video is first');
  eq(mixed.links[1], 'sfx.mp3', 'the audio follows');
  ok(mixed.links.join('|').indexOf('IMG_') < 0, 'no image name reaches a download');

  // A media item with no bytes is skipped rather than downloading nothing.
  const nosrc = mediaFor([{ isVideo: true, filename: 'gone.mp4', src: '' }]);
  eq(nosrc.links.length, 0, 'a media item with no source produces no download');

  // The count in the toast is what was written, not what was selected.
  const counted = mediaFor([image(1), image(2), image(3), video(1)]);
  eq(counted.links.length, 1, 'three images and a video download one file');
  ok(counted.toasts.join('|').indexOf('Downloading 1 file') >= 0,
    'the toast counts the file written, not the selection');
});

// ═══ 5. report ═══════════════════════════════════════════════════════════
console.log('');
if (fail) {
  console.log('FAILURES: ' + fail + ' (passed ' + pass + ')');
  fails.forEach(function (m) { console.log('  - ' + m); });
  process.exit(1);
}
console.log('ALL PASS (' + pass + ' assertions)');
