#!/usr/bin/env node
/*
 * test_v7038.js — Tidy minimum width, responsive control-bar densities,
 * trim discoverability, and the video contact sheet.
 *
 * Usage:  node test_v7038.js [path-to-kraftpub.html]
 *
 * Lives in the repo (not /tmp) on purpose. The v7.0.37 suites were written
 * to /tmp and silently vanished with the next reboot, taking 630 assertions
 * with them.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2]
  || path.resolve(__dirname, '../../kraftpub-v6.8.0.html');
const src = fs.readFileSync(FILE, 'utf8');

let pass = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; } else { fails.push(label); }
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label}  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

// ── helpers ────────────────────────────────────────────────────────────
function decomment(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1 ');
}
// Count occurrences outside comments.
function countOf(re, hay) {
  const m = decomment(hay).match(re);
  return m ? m.length : 0;
}
// Extract `function name(...) { ... }` by brace matching.
function fnFull(name, hay) {
  const i = hay.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let d = 0, started = false;
  for (let j = i; j < hay.length; j++) {
    const c = hay[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') {
      d--;
      if (started && d === 0) return hay.slice(i, j + 1);
    }
  }
  return '';
}
// Strip a leading `function name(` so the body can be run standalone.
function toExpr(fnSrc) {
  return fnSrc.replace(/^function\s+[A-Za-z0-9_$]+\s*\(/, 'function (');
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Tidy column width
// ═══════════════════════════════════════════════════════════════════════
// Read the constants out of the source, never restate them. An assertion
// that compares a hardcoded 380 against a hardcoded 343 passes no matter
// what the app actually does.
const TIDY_COL_W = Number((src.match(/var TIDY_COL_W = (\d+);/) || [])[1]);
const TIDY_MEDIA_COL_W = Number((src.match(/var TIDY_MEDIA_COL_W = (\d+);/) || [])[1]);
eq(TIDY_COL_W, 280, 'TIDY_COL_W is 280');
eq(TIDY_MEDIA_COL_W, 380, 'TIDY_MEDIA_COL_W is 380');

// The whole point of 380: measured intrinsic width of the controls row at
// its "micro" density. Every component is read straight off the CSS.
//   row padding ............ 10 + 10                       =  20
//   4 flex gaps @8px ....... (5 children - 1) x 8          =  32
//   left group ............. play 28 + gap 5 + draw 28+4   =  65
//   2 separators @1px ......                               =   2
//   center group (compact).. 30 + 5 + 60 + 5 + 30          = 130
//   right group (micro) .... comments 41 + snap 25 + mute 18 + 2 gaps 10 = 94
const MICRO_INTRINSIC = 20 + 32 + 65 + 2 + 130 + 94;   // = 343
eq(MICRO_INTRINSIC, 343, 'micro density intrinsic width still measures 343');
ok(TIDY_MEDIA_COL_W >= MICRO_INTRINSIC,
   `the media column (${TIDY_MEDIA_COL_W}) is at least as wide as the micro bar (${MICRO_INTRINSIC})`);
ok(TIDY_MEDIA_COL_W - MICRO_INTRINSIC >= 20,
   `media column keeps >= 20px of slack over the micro bar (has ${TIDY_MEDIA_COL_W - MICRO_INTRINSIC})`);
ok(TIDY_MEDIA_COL_W > TIDY_COL_W, 'the media column is genuinely wider than the image column');

ok(!/var COL_W = 280;/.test(src), 'tidySelection no longer hardcodes a 280 column');
ok(/var COL_W = TIDY_COL_W;/.test(src), 'tidySelection reads the named constant');
ok(/if \(_hasPlayer && COL_W < TIDY_MEDIA_COL_W\) COL_W = TIDY_MEDIA_COL_W;/.test(src),
   'tidySelection widens the column when the selection carries players');

const tidyBody = fnFull('tidySelection', src);
ok(tidyBody.length > 0, 'tidySelection body extracted');
ok(/selItems\.length === 1/.test(tidyBody) && /newW < TIDY_MEDIA_COL_W/.test(tidyBody),
   'a single media item also gets the controls-bar floor');
ok(/Math\.round\(COL_W\)/.test(tidyBody), 'the toast reports the column width it actually used');

// _itemHasPlayerControls, executed for real
const hasPlayerSrc = fnFull('_itemHasPlayerControls', src);
ok(hasPlayerSrc.length > 0, '_itemHasPlayerControls body extracted');
const hasPlayer = new Function('return ' + toExpr(hasPlayerSrc))();
ok(hasPlayer({ isVideo: true }), 'recognises isVideo');
ok(hasPlayer({ isAudio: true }), 'recognises isAudio');
ok(hasPlayer({ type: 'video' }), 'recognises a kpak-rebuilt video (type only)');
ok(hasPlayer({ type: 'audio' }), 'recognises a kpak-rebuilt audio (type only)');
ok(!hasPlayer({ natW: 800 }), 'a plain image is not a player');
ok(!hasPlayer({ type: 'draw' }), 'a board-pen item is not a player');
ok(!hasPlayer(null), 'null is not a player');
ok(!hasPlayer(undefined), 'undefined is not a player');

// ═══════════════════════════════════════════════════════════════════════
// 2. Responsive control-bar densities
// ═══════════════════════════════════════════════════════════════════════
const roSrc = src.slice(src.indexOf('const _ctrlsRO'), src.indexOf('_ctrlsRO.observe'));
ok(/classList\.toggle\('compact', w < 660\)/.test(roSrc), 'compact switches on below 660px');
ok(/classList\.toggle\('micro', w < 440\)/.test(roSrc), 'micro switches on below 440px');
ok(!/classList\.toggle\('compact', w < 420\)/.test(src), 'the old single 420px threshold is gone');
ok(/const w0 = ctrlsRow\.clientWidth/.test(roSrc),
   'density is applied once up front so there is no first-paint flicker');

ok(/\.media-controls-row\.micro \.media-volume-slider/.test(src), 'micro hides the volume slider');
ok(/\.media-controls-row\.micro \.media-volume-label/.test(src), 'micro hides the volume percent label');
ok(!/\.media-controls-row\.micro \.media-volume-btn[\s\S]{0,80}display:\s*none/.test(src),
   'micro keeps the mute button — hiding it would strand the user');

// The 440 threshold has to actually clear the compact bar, otherwise the
// bar would scroll in the band just under the switch.
const COMPACT_INTRINSIC = 20 + 32 + 65 + 2 + 130 + (41 + 25 + 136 + 5 + 26 + 5 + 28 + 3 * 5);
ok(COMPACT_INTRINSIC > 440, 'compact really does need more than 440px — micro is not premature');

// ═══════════════════════════════════════════════════════════════════════
// 3. Trim discoverability
// ═══════════════════════════════════════════════════════════════════════
['selectedVideoItems', 'refreshTrimUIFor', 'setTrimFromPlayhead', 'clearTrimSelected']
  .forEach(n => ok(new RegExp('function ' + n + '\\(').test(src), `${n}() is defined`));

ok(/el\._refreshInPlayerTrimUI = refreshInPlayerTrimUI;/.test(src),
   'the in-player trim repaint is published so out-of-closure callers can repaint');
const setTrimBody = fnFull('setTrimFromPlayhead', src);
ok(setTrimBody.length > 0, 'setTrimFromPlayhead body extracted');
// v7.0.42: the clamp is no longer written inline in this function — the menu and
// the i/o hotkey both route through the shared clampTrimMark(). Pinning a literal
// `te - 0.1` here would only re-assert the copy that used to live here, and would
// have kept the menu (0.1s) and the hotkey (0.05s) disagreeing. The bounds
// themselves are now executed for real in test_v7041.
//
// v7.0.44: one more hop. Both doors now go through planTrimMark(), and
// planTrimMark() is what asks clampTrimMark() — because a request can also
// be a CONFLICT (a mark landing across the opposite one), which is not a
// number to clamp at all. Pinning /clampTrimMark\(/ here would pin the
// pre-.44 shape and go red every time the planning layer is touched; the
// behaviour it was guarding is executed for real in test_v7044.
ok(/planTrimMark\(/.test(setTrimBody),
   'the menu plans through the shared planTrimMark, not a private copy');
ok(/clampTrimMark\(/.test(fnFull('planTrimMark', src)),
   'planTrimMark is the layer that asks clampTrimMark, so the menu still gets the shared bounds');
ok(!/Math\.min\(t, te -[\s\S]{0,12}\)/.test(setTrimBody),
   'no hand-rolled in-point clamp survives in the menu path');
ok(!/Math\.max\(t, ts \+[\s\S]{0,12}\)/.test(setTrimBody),
   'no hand-rolled out-point clamp survives in the menu path');
ok(/TRIM_MIN_GAP/.test(fnFull('clampTrimMark', src)),
   'the minimum segment gap lives in one named constant, not a literal');
ok(/pushUndo\(\)/.test(setTrimBody), 'setting a trim is undoable');
ok(/plan\.length/.test(setTrimBody),
   'an undo step is only pushed when a clip actually moves');
// Relaxed from refreshTrimUIFor(vids): it now repaints only the clips that moved.
// A clip that did not move needs no repaint, and refreshTrimUIFor is still the one
// function that drives both strips (asserted by execution in test_v7041).
ok(/refreshTrimUIFor\(/.test(setTrimBody), 'setting a trim repaints both strips');
ok(/scheduleAutoSave\(\)/.test(setTrimBody), 'setting a trim is persisted');

const ctxSrc = fnFull('showCtx', src);
ok(/const hasVideos = sel\.some/.test(ctxSrc), 'context menu detects videos');
ok(/setTrimFromPlayhead\('in'\)/.test(ctxSrc), 'context menu offers Set Trim In');
ok(/setTrimFromPlayhead\('out'\)/.test(ctxSrc), 'context menu offers Set Trim Out');
ok(/clearTrimSelected\(\);hideCtx\(\)/.test(ctxSrc), 'context menu offers Clear Trim');
ok(/openContactSheetDialog\(\);hideCtx\(\)/.test(ctxSrc), 'context menu offers Contact Sheet');

const guideSrc = fnFull('_guideHTML', src);
ok(/Video segment \(trim\)/.test(guideSrc), 'the help guide has a video trim section');
ok(/Trim in — start looping here/.test(guideSrc), 'the guide documents the I key');
ok(/Trim out — jump back from here/.test(guideSrc), 'the guide documents the O key');
ok(/cursor on seek bar/.test(guideSrc),
   'the guide says the I/O keys are scoped to the seek bar — that scoping is the whole trap');
ok(/Contact sheet — filmstrip of stills/.test(guideSrc), 'the guide documents the contact sheet');

ok(/case 'media-contact-sheet':\s+openContactSheetDialog\(\); return true;/.test(src),
   'the command palette can launch the contact sheet');
ok(/case 'media-trim-clear':\s+clearTrimSelected\(\); return true;/.test(src),
   'the command palette can clear a trim');
ok(/id: 'media-contact-sheet'[\s\S]{0,160}keys: \[\]/.test(src),
   'contact sheet is palette-only — a bare hotkey would fire while typing in a text box');

// ═══════════════════════════════════════════════════════════════════════
// 4. Contact sheet — pure logic
// ═══════════════════════════════════════════════════════════════════════
const colsFn = new Function('return ' + toExpr(fnFull('contactSheetColumns', src)))();
eq(colsFn(4), 4,  '4 frames lay out as one row of 4');
eq(colsFn(6), 3,  '6 frames lay out 3 across');
eq(colsFn(9), 3,  '9 frames lay out 3 across');
eq(colsFn(12), 4, '12 frames lay out 4 across');
eq(colsFn(24), 6, '24 frames lay out 6 across');
[4, 6, 9, 12, 24].forEach(n => {
  const c = colsFn(n);
  const r = Math.ceil(n / c);
  ok(c * r >= n, `${n} frames fit in the ${c}x${r} grid`);
  ok(n <= 9 ? c === 3 || c === n : true, `${n} frames stay close to the source aspect`);
});

const tcFn = new Function('return ' + toExpr(fnFull('contactSheetTimecode', src)))();
eq(tcFn(0), '0:00.00', 'timecode of 0');
eq(tcFn(62.5), '1:02.50', 'timecode carries hundredths, not just seconds');
eq(tcFn(3725.25), '62:05.25', 'timecode handles past an hour');
eq(tcFn(NaN), '0:00.00', 'timecode of a bad value does not render NaN on the sheet');
ok(!/videoTimeMode/.test(fnFull('contactSheetTimecode', src)),
   'sheet timecodes ignore the frame/time toggle — it is baked into pixels');

const rangeFn = new Function('return ' + toExpr(fnFull('_csRange', src)))();
(function () {
  const item = { video: { duration: 100 }, trimStart: 20, trimEnd: 40 };
  eq(rangeFn(item, 'trim').lo, 20, 'trim scope starts at trimStart');
  eq(rangeFn(item, 'trim').hi, 40, 'trim scope ends at trimEnd');
  eq(rangeFn(item, 'all').lo, 0, 'whole-clip scope starts at 0');
  eq(rangeFn(item, 'all').hi, 100, 'whole-clip scope ends at the duration');

  const untrimmed = { video: { duration: 100 }, trimStart: 0, trimEnd: 0 };
  eq(rangeFn(untrimmed, 'trim').hi, 100, 'an untrimmed clip falls back to the full duration');
  ok(rangeFn(untrimmed, 'trim').hi - rangeFn(untrimmed, 'trim').lo > 0,
     'an untrimmed clip still yields a positive range');

  const inverted = { video: { duration: 100 }, trimStart: 90, trimEnd: 90 };
  ok(rangeFn(inverted, 'trim').hi > rangeFn(inverted, 'trim').lo,
     'a degenerate trim range is widened rather than dividing by zero');

  const noVideo = { trimStart: 5, trimEnd: 10 };
  eq(rangeFn(noVideo, 'all').hi, 0, 'a clip with no loaded element reports a zero duration');
})();

// ═══════════════════════════════════════════════════════════════════════
// 5. Contact sheet — structure and safety
// ═══════════════════════════════════════════════════════════════════════
['buildContactSheet', 'openContactSheetDialog', 'renderContactSheet', 'syncContactSheetUI',
 'setContactSheetCount', 'setContactSheetScope', 'contactSheetToBoard',
 'downloadContactSheet', 'closeContactSheet'].forEach(n => {
  ok(new RegExp('function ' + n + '\\(').test(src), `${n}() is defined`);
});
ok(/id="contact-sheet-modal"/.test(src), 'the contact sheet modal exists in the markup');

const csBody = fnFull('buildContactSheet', src);
ok(csBody.length > 0, 'buildContactSheet body extracted');
ok(/makeVideoElement\(/.test(csBody), 'frames come from the shared video builder (v7.0.37 P2)');
ok(countOf(/createElement\('video'\)/g, csBody) === 0,
   'buildContactSheet does not hand-roll another video element');
ok(csBody.indexOf('live.currentTime') === -1,
   'the contact sheet never moves the on-board player playhead');
ok(/v\.currentTime = t;/.test(csBody), 'the probe element is the one being seeked');
ok(/try \{\s*url = cv\.toDataURL/.test(csBody), 'toDataURL is guarded — a tainted canvas throws');
ok(/fail\('cors'\)/.test(csBody), 'a cross-origin clip reports cors instead of dying silently');
ok(/setTimeout\(function \(\) \{[\s\S]{0,200}fail\('seek-timeout'\)/.test(csBody),
   'a seek that never completes times out instead of hanging the progress line');
ok(/exportPixelBudget\(sheetW, sheetH, 1\)/.test(csBody),
   'the sheet canvas respects the same pixel ceiling as board export');
ok(/fail\('no-frame'\)/.test(csBody), 'a clip with no decodable frame yet fails loudly');
ok(/onError: false/.test(csBody),
   'the shared builder toast is suppressed here — the dialog reports the error instead');

const addBody = fnFull('contactSheetToBoard', src);
ok(/it\.el\.getBoundingClientRect/.test(addBody),
   'the strip is placed using the measured element, clear of the controls bar');
ok(/addImage\(url, img\.width, img\.height, it\.x, belowY\)/.test(addBody),
   'the strip is added through the normal item path so it serialises');
ok(/newItem\.w = w;/.test(addBody), 'the strip is sized to the video width');

const openBody = fnFull('openContactSheetDialog', src);
ok(/selectedVideoItems\(\)/.test(openBody), 'the dialog needs a selected video');
ok(/ev\.key === 'Escape'/.test(openBody), 'escape closes the dialog');
ok(/true\);\s*\n?\s*\}\);?\s*\n?\s*\}/.test(openBody) || /\}, true\);/.test(openBody),
   'escape is captured so it does not also deselect the board');
ok(/ev\.target === modal/.test(openBody), 'clicking the backdrop closes the dialog');

const closeBody = fnFull('closeContactSheet', src);
ok(/_cs\.token\+\+/.test(closeBody), 'closing cancels any in-flight frame read');
const renderBody = fnFull('renderContactSheet', src);
ok(/if \(cancelled\(\)\) return;/.test(renderBody),
   'a stale render (user changed the count mid-read) cannot overwrite the fresh one');

// ═══════════════════════════════════════════════════════════════════════
// 6. Version
// ═══════════════════════════════════════════════════════════════════════
// One place to edit per bump. Everything below compares against this,
// never against a value read out of another version site.
const EXPECT_VERSION = '7.0.47';
eq((src.match(/<title>Krafted v([\d.]+)<\/title>/) || [])[1], EXPECT_VERSION, 'title carries the version');
eq((src.match(/var KRAFTED_VERSION = '([\d.]+)';/) || [])[1], EXPECT_VERSION, 'KRAFTED_VERSION is bumped');
const swPath = path.resolve(__dirname, '../docs/sw.js');
if (fs.existsSync(swPath)) {
  const sw = fs.readFileSync(swPath, 'utf8');
    eq((sw.match(/const APP_VERSION = '([\d.]+)';/) || [])[1], EXPECT_VERSION, 'service worker version matches');
  // Derived, not hardcoded: this assertion used to carry a literal escaped
  // version (/krafted-v7\.0\.39-/) and every bump missed it, because
  // s/7\.0\.39/7.0.40/g does not match the text "7\.0\.39".
  const appV = (src.match(/var KRAFTED_VERSION = '([\d.]+)';/) || [])[1];
  ok(new RegExp('krafted-v' + String(appV).replace(/\./g, '\\.') + '-').test(sw),
     'service worker cache name matches the app version');
}

// ═══════════════════════════════════════════════════════════════════════
console.log(`\ntest_v7038 — ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  fails.forEach(f => console.log('  FAIL  ' + f));
  process.exit(1);
}
console.log('ALL PASS');
