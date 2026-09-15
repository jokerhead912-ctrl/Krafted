#!/usr/bin/env node
// v7.21.0 — Snap captures the frame you actually drew on.
//
// THE BUG (one disease, the three symptoms the user reported):
//   fps was resolved from getCurrentFps(), which reads getSelectedImages()[0]
//   — the BOARD SELECTION — and not the video being annotated. Every call site
//   used the idiom
//       (typeof getCurrentFps === 'function') ? getCurrentFps() : (el._kraftedFps || 30)
//   so the per-video fallback was dead code and the SELECTION's fps always
//   won. With two or more clips on the board, strokes were filed under
//   frame = t * fpsA and Snap then seeked to frame / fpsB. The thumbnail
//   landed on another frame ("縮圖係另一格畫面") by an amount that changed
//   with whichever clip happened to be selected ("時近時遠").
//
//   Two more defects rode along:
//   • both Snap implementations stored `time: targetTime` — what they ASKED
//     for — while the snapshot held whatever frame the seek actually reached,
//     so the thumbnail, the drawn frame and the jump target all disagreed;
//   • videoAnnoDeleteComment resolved its item through videoAnnoGetSelected(),
//     which is null whenever two or more videos sit on the board, and then
//     returned WITHOUT A TOAST. The delete button looked dead.
//
// WHAT SHIPPED:
//   1. One fps definition    — videoAnnoFpsForEl / videoAnnoFpsFor.
//   2. One verified seek     — videoAnnoSeekTo, reporting the time ACTUALLY
//      reached and refusing to settle while the drift exceeds maxDrift.
//   3. One batch Snap        — videoAnnoSnapBatch; both UI buttons call it.
//   4. time is the single truth for a comment's anchor; frame is display-only
//      and derived. Pre-v7.21.0 files that only carry `frame` back-fill.
//   5. videoAnnoFindCommentOwner(id) — the comment id knows its own video, so
//      delete / edit / jump no longer depend on the board selection, and every
//      silent return now says something.
//   6. ↻ per-comment re-snap — repair one capture without deleting it.
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = process.env.KRAFTED_HTML
  ? path.resolve(process.env.KRAFTED_HTML)
  : path.resolve(__dirname, '..', '..', 'kraftpub-dev.html');
const src = fs.readFileSync(HTML, 'utf8');

let n = 0; const fails = [];
function ok(cond, msg) { n++; if (!cond) fails.push(msg); }
function eq(got, want, msg) { n++; if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(msg + ' (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')'); }
function near(got, want, tol, msg) { n++; if (!(Math.abs(got - want) <= tol)) fails.push(msg + ' (got ' + got + ', want ' + want + ' ±' + tol + ')'); }
// Rule 10: the /* */ strip needs a cap — this file has a literal '/*' pair
// ~270KB in, and an unbounded strip deletes 42% of the source.
function codeOnly(s) { return s.replace(/\/\*[\s\S]{0,4000}?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); }
// Rule 20: slice anchors must be version-free, or the release scanner rewrites
// them and the slice silently returns ''.
function slice(a, b) { const i = src.indexOf(a); const j = b ? src.indexOf(b, i) : -1; return (i >= 0 && j > i) ? src.slice(i, j) : ''; }

const CO = codeOnly(src);
function countOf(re) { const m = CO.match(re); return m ? m.length : 0; }

// ══════════════════════════════════════════════════════════════════════════
//  S0 — structural: the duplication that caused this is actually gone
// ══════════════════════════════════════════════════════════════════════════
eq(countOf(/function videoAnnoFpsForEl\(/g), 1, 'exactly one fps-per-element definition');
eq(countOf(/function videoAnnoSeekTo\(/g), 1, 'exactly one verified seek');
eq(countOf(/function videoAnnoSnapBatch\(/g), 1, 'exactly one batch Snap');
eq(countOf(/videoAnnoCaptureSnapshot\(mediaEl, SNAP_W/g), 0,
  'the player-bar Snap no longer hand-rolls its own capture loop');
eq(countOf(/mediaEl\.currentTime = targetTime;/g), 0,
  'the popover Snap no longer hand-rolls its own seek');
ok(/function videoAnnoSeekAndCapture\(v, c, maxW\) \{[\s\S]{0,700}?videoAnnoSeekTo\(/.test(CO),
  'videoAnnoSeekAndCapture delegates its seek to the one definition');
// Count the LIVE call, guard included. A looser regex still matched the
// mutated `if (false) await videoAnnoSnapBatch(itm)` and scored a hole.
eq(countOf(/if \(typeof videoAnnoSnapBatch === 'function'\) await videoAnnoSnapBatch\(itm\);/g), 2,
  'both Snap buttons really call the one batch Snap');
ok(/playerSnapBtn\.addEventListener\('click'[\s\S]{0,900}?await videoAnnoSnapBatch\(itm\)/.test(CO),
  'the player-bar Snap button calls it');
ok(/snapBtn\.addEventListener\('click'[\s\S]{0,900}?await videoAnnoSnapBatch\(itm\)/.test(CO),
  'and so does the popover Snap button');
ok(/function _currentFrame\(\) \{[\s\S]{0,400}?videoAnnoFpsForEl\(mediaEl\)/.test(CO),
  '_currentFrame — the KEY strokes are filed under — uses this player\'s fps, not the selection\'s');
// Both must read the SAME source. If the badge disagrees with the key, the
// number shown to the user is not the frame the strokes are stored under.
eq(countOf(/videoAnnoFpsForEl\(mediaEl\)/g), 2,
  'the frame indicator and _currentFrame agree on ONE fps source');
// `frame` is DERIVED from time, so ordering on it re-sorts the list every
// time fps changes underneath the comments — which is exactly what the old
// selection-derived fps did. Every list must order on time.
eq(countOf(/\(a\.frame \|\| 0\) - \(b\.frame \|\| 0\)/g), 0,
  'no comment list orders by the derived frame number any more');
ok(countOf(/return videoAnnoCommentTime\(a, /g) >= 4,
  'at least the four comment lists (popover, export, send-to-board, J/K) order by time');
// Scoped to the export: `const fps = videoAnnoFpsFor(item);` now appears at
// six sites, so asserting it exists SOMEWHERE cannot see the export lose it.
const EXPFN = codeOnly(slice('async function videoAnnoExportComments() {', 'const EXPORT_SNAP_MAX_W = 1920;'));
ok(EXPFN.length > 40, 'the export slice still finds its function (anchor)');
ok(/const fps = videoAnnoFpsFor\(item\);/.test(EXPFN),
  'the export reads fps from the clip being exported, not from the board selection');
ok(!/getCurrentFps/.test(EXPFN),
  'the export does not mention the selection-derived fps at all');
const tmo = src.match(/var VIDEO_ANNO_SEEK_TIMEOUT = (\d+);/);
ok(tmo && Number(tmo[1]) >= 1000,
  'the seek timeout is a real safety net (>=1s), not a hair trigger that gives up on a slow clip');
// The in-player list builds its head from an HTML string; the popover card
// builds real elements, so the two sites look different in the source.
eq(countOf(/<button class="resnap"/g), 1, 'the in-player comment list offers the ↻ re-snap button');
ok(/resnapBtn\.className = 'resnap'/.test(CO), 'the popover comment card offers it too');
eq(countOf(/videoAnnoReSnapComment\(c\.id\)/g), 2, 'and both are wired to it');

// ══════════════════════════════════════════════════════════════════════════
//  the sandbox — Rule 19: an anchor proves the code EXISTS; this EXECUTES it
// ══════════════════════════════════════════════════════════════════════════
const GSEL = slice('function videoAnnoGetSelected() {', '// fps of THIS element. Never the selection.');
const HELP = slice('function videoAnnoFpsForEl(el) {', 'function videoAnnoEnsure(item) {');
const ENSURE = slice('function videoAnnoEnsure(item) {', 'function videoAnnoRedraw(_item) {');
const SEEK = slice('function videoAnnoSeekTo(v, target, maxDrift) {', 'function videoAnnoSeekAndCapture(v, c, maxW) {');
const SNAP = slice('function videoAnnoSnapBatch(item, opts) {', 'async function videoAnnoExportComments() {');
const DEL = slice('function videoAnnoDeleteComment(id) {', '// Stage A: update an existing comment');
const UPD = slice('function videoAnnoUpdateComment(id, newText) {', '// ── Send comments to the canvas');
const JMP = slice('function videoAnnoJumpToComment(id) {', '// ── Review Mode: J/K to jump between comments');
const RCL = slice('function videoAnnoRefreshCommentList(item, highlightId) {', 'function videoAnnoSaveProject() {');

const BLOCKS = [
  ['GSEL', GSEL], ['HELP', HELP], ['ENSURE', ENSURE], ['SEEK', SEEK],
  ['SNAP', SNAP], ['DEL', DEL], ['UPD', UPD], ['JMP', JMP], ['RCL', RCL]
];
BLOCKS.forEach(function (b) {
  ok(b[1] && b[1].length > 40, 'the ' + b[0] + ' slice still finds its function (anchor check, rule 6e-bis)');
});

const PRELUDE = [
  'var VIDEO_ANNO_SEEK_TIMEOUT = 30;',
  'var requestAnimationFrame = function (fn) { fn(); return 1; };',
  'var toast = __g.toast;',
  'var pushUndo = __g.pushUndo;',
  'var scheduleAutoSave = __g.scheduleAutoSave;',
  'var videoAnnoRefreshCommentList = __g.videoAnnoRefreshCommentList;',
  'var videoAnnoCaptureSnapshot = __g.videoAnnoCaptureSnapshot;',
  'var getSelectedImages = __g.getSelectedImages;',
  'var resumeMediaEl = __g.resumeMediaEl;',
  'var document = __g.document;',
  'var state = __g.state;',
  ''
].join('\n');

const EXPORTS = '\nreturn { videoAnnoGetSelected: videoAnnoGetSelected, videoAnnoFpsForEl: videoAnnoFpsForEl,' +
  ' videoAnnoFpsFor: videoAnnoFpsFor, videoAnnoFindCommentOwner: videoAnnoFindCommentOwner,' +
  ' videoAnnoCommentTime: videoAnnoCommentTime, videoAnnoCommentFrame: videoAnnoCommentFrame,' +
  ' videoAnnoSeekTo: videoAnnoSeekTo, videoAnnoSnapBatch: videoAnnoSnapBatch,' +
  ' videoAnnoReSnapComment: videoAnnoReSnapComment, videoAnnoDeleteComment: videoAnnoDeleteComment,' +
  ' videoAnnoUpdateComment: videoAnnoUpdateComment, videoAnnoJumpToComment: videoAnnoJumpToComment,' +
  ' videoAnnoEnsure: videoAnnoEnsure };';

// A fake <video> whose currentTime setter snaps to a keyframe grid, the way a
// real codec does. `snap` is mutable so one object can model both a clean seek
// and a badly-off one.
function mkVideo(opts) {
  opts = opts || {};
  return {
    snap: opts.snap || 0,
    readyState: 4, seeking: false, paused: false, duration: 100,
    _t: 0, _ev: {}, _rvf: null, _rvfUsed: false, _fps: opts.fps || 0,
    get _kraftedFps() { return this._fps; },
    get currentTime() { return this._t; },
    set currentTime(t) { this._t = this.snap ? Math.round(t / this.snap) * this.snap : t; },
    addEventListener(t, f) { (this._ev[t] = this._ev[t] || []).push(f); },
    removeEventListener(t, f) { this._ev[t] = (this._ev[t] || []).filter(function (x) { return x !== f; }); },
    pause() { this.paused = true; },
    requestVideoFrameCallback(fn) { this._rvfUsed = true; this._rvf = fn; return 1; },
    cancelVideoFrameCallback() { this._rvf = null; },
    __fire(t) { (this._ev[t] || []).slice().forEach(function (f) { f(); }); },
    __seek(t) { this.currentTime = t; this.__fire('seeked'); },
    __present() { if (this._rvf) { const f = this._rvf; this._rvf = null; f(); } }
  };
}

function world(over) {
  over = over || {};
  const g = {
    state: over.state || { items: [], selected: new Set() },
    toasts: [], undos: 0, saves: 0, refreshes: 0, resumed: [],
    toast(m) { g.toasts.push(String(m)); },
    pushUndo() { g.undos++; },
    scheduleAutoSave() { g.saves++; },
    videoAnnoRefreshCommentList() { g.refreshes++; },
    // Records the flag AT CAPTURE TIME. Asserting it only after the batch
    // would pass just as happily if it had never been set at all.
    duringSuppress: [],
    videoAnnoCaptureSnapshot(v) { g.duringSuppress.push(v._kraftedSuppressTrimLoop); return 'SNAP@' + v.currentTime; },
    // Bound through the closure, not `this` — the sandbox takes these as bare
    // function references, so `this` would be undefined under 'use strict'.
    getSelectedImages() { return g.state.items.filter(function (i) { return g.state.selected.has(i.id); }); },
    resumeMediaEl(v) { g.resumed.push(v); },
    document: { getElementById: function () { return null; } }
  };
  if (over.state) g.state = over.state;
  let a = null;
  try {
    a = new Function('__g', PRELUDE + GSEL + HELP + ENSURE + SEEK + SNAP + DEL + UPD + JMP + EXPORTS)(g);
  } catch (e) { fails.push('sandbox did not compile: ' + e.message); }
  if (!a) {
    // Rule 19: a mutant that deletes a function under test must turn into a
    // FAILED ASSERTION, not a crash before the tally — the judge scores a
    // suite that dies before printing anything as UNPROVEN, i.e. a hole.
    a = {};
    ['videoAnnoGetSelected', 'videoAnnoFpsForEl', 'videoAnnoFpsFor', 'videoAnnoFindCommentOwner',
      'videoAnnoCommentTime', 'videoAnnoCommentFrame', 'videoAnnoDeleteComment',
      'videoAnnoUpdateComment', 'videoAnnoJumpToComment'].forEach(function (k) {
        a[k] = function () { return null; };
      });
    a.videoAnnoEnsure = function () { return { comments: [] }; };
    a.videoAnnoSeekTo = function () { return Promise.resolve({ ok: false, actual: 0 }); };
    a.videoAnnoSnapBatch = function () { return Promise.resolve({ snapped: 0, skipped: 0 }); };
    a.videoAnnoReSnapComment = function () { return Promise.resolve(false); };
  }
  a.g = g;
  return a;
}

// ══════════════════════════════════════════════════════════════════════════
//  S1 — fps comes from the clip, never from the selection
// ══════════════════════════════════════════════════════════════════════════
const w1 = world();
eq(w1.videoAnnoFpsForEl({ _kraftedFps: 25 }), 25, 'a 25fps element reports 25');
eq(w1.videoAnnoFpsForEl({ _kraftedFps: 30 }), 30, 'a 30fps element reports 30');
eq(w1.videoAnnoFpsForEl(null), 30, 'no element -> the 30 fallback');
eq(w1.videoAnnoFpsForEl({}), 30, 'no fps -> the 30 fallback');
eq(w1.videoAnnoFpsForEl({ _kraftedFps: 0 }), 30, 'a zero fps is rejected (it would divide by zero)');
eq(w1.videoAnnoFpsForEl({ _kraftedFps: NaN }), 30, 'a NaN fps is rejected');
eq(w1.videoAnnoFpsForEl({ _kraftedFps: -5 }), 30, 'a negative fps is rejected');

// THE HEADLINE: two clips, different rates, selection pointing at the other one.
const CLIP_A = { id: 'a', isVideo: true, video: mkVideo({ fps: 25 }), el: { isConnected: true } };
const CLIP_B = { id: 'b', isVideo: true, video: mkVideo({ fps: 30 }), el: { isConnected: true } };
const w1b = world({ state: { items: [CLIP_A, CLIP_B], selected: new Set(['b']) } });
eq(w1b.videoAnnoFpsFor(CLIP_A), 25,
  'fps for clip A is 25 EVEN THOUGH clip B is the selected one — this is the whole bug');
eq(w1b.videoAnnoFpsFor(CLIP_B), 30, 'and clip B still reports its own 30');

// ══════════════════════════════════════════════════════════════════════════
//  S2 — "which video" resolution
// ══════════════════════════════════════════════════════════════════════════
const IMG = { id: 'img', isVideo: false, el: { isConnected: true } };
const THREE = function (sel) { return { items: [CLIP_A, CLIP_B, IMG], selected: new Set(sel) }; };

// Null-safe on purpose: a mutant that breaks the lookup must read as a failed
// assertion, and `null.id` would kill the module before the tally ever prints.
const selOf = function (sel) { const r = world({ state: THREE(sel) }).videoAnnoGetSelected(); return r ? r.id : undefined; };
eq(selOf(['a']), 'a', 'one video selected -> that one');
eq(selOf(['a', 'img']), 'a',
  'a video + an image selected still resolves to the video (v7.24.0; used to fall through to null)');
eq(selOf(['a', 'b']), undefined, 'two videos selected is genuinely ambiguous -> null');
eq(selOf([]), undefined, 'nothing selected and two clips on the board -> null');

// ══════════════════════════════════════════════════════════════════════════
//  S3 — a comment id knows its own video
// ══════════════════════════════════════════════════════════════════════════
const OA = { id: 'a', isVideo: true, anno: { comments: [{ id: 'c1' }, { id: 'c3' }] } };
const OB = { id: 'b', isVideo: true, anno: { comments: [{ id: 'c2' }] } };
const w3 = world({ state: { items: [OA, OB], selected: new Set() } });
const ownerOf = function (id) { const r = w3.videoAnnoFindCommentOwner(id); return r ? r.id : undefined; };
eq(ownerOf('c1'), 'a', 'c1 belongs to clip A');
eq(ownerOf('c2'), 'b', 'c2 belongs to clip B');
eq(ownerOf('c3'), 'a', 'and the second comment on A too');
eq(w3.videoAnnoFindCommentOwner('ghost'), null, 'an unknown id returns null rather than guessing');
eq(world({ state: { items: [{ id: 'x' }], selected: new Set() } }).videoAnnoFindCommentOwner('c1'), null,
  'an item with no anno at all is skipped, not crashed on');

// ══════════════════════════════════════════════════════════════════════════
//  S4 — time is the truth, frame is display-only
// ══════════════════════════════════════════════════════════════════════════
const w4 = world({ state: { items: [CLIP_A], selected: new Set(['a']) } });
eq(w4.videoAnnoCommentTime({ time: 4, frame: 9999 }, CLIP_A), 4,
  'a stored time wins even when the frame field is nonsense');
eq(w4.videoAnnoCommentTime({ frame: 100 }, CLIP_A), 4,
  'a pre-v7.24.0 .kpak carrying only frame back-fills time = frame / THIS clip fps');
eq(w4.videoAnnoCommentFrame({ time: 4 }, CLIP_A), 100, 'frame is derived: time x fps');
eq(w4.videoAnnoCommentFrame({ frame: 100 }, CLIP_A), 100, 'and round-trips through the back-fill');
eq(w4.videoAnnoCommentTime({}, CLIP_A), 0, 'neither field -> 0, not NaN');
eq(w4.videoAnnoCommentFrame({ time: 0 }, CLIP_A), 0, 'and the derived frame floors at 0');

// ══════════════════════════════════════════════════════════════════════════
//  S8 — delete / edit / jump no longer depend on the selection  (sync parts)
// ══════════════════════════════════════════════════════════════════════════
const DA = { id: 'a', isVideo: true, video: mkVideo(), anno: { comments: [{ id: 'c1', time: 1, text: 'x' }] } };
const DB = { id: 'b', isVideo: true, video: mkVideo(), anno: { comments: [{ id: 'c2', time: 2, text: 'y' }] } };
// NOTHING selected, two clips -> videoAnnoGetSelected() is null. Before
// v7.21.0 this returned silently and the button looked dead.
const w8 = world({ state: { items: [DA, DB], selected: new Set() } });
w8.videoAnnoDeleteComment('c1');
eq(DA.anno.comments.length, 0, 'the comment is gone even with nothing selected and two clips on the board');
eq(DB.anno.comments.length, 1, 'and the OTHER clip\'s comment is untouched');
eq(w8.g.toasts[w8.g.toasts.length - 1], 'Comment removed', 'with confirmation');
ok(w8.g.undos > 0, 'and it is undoable');

const w8b = world({ state: { items: [], selected: new Set() } });
w8b.videoAnnoDeleteComment('ghost');
eq(w8b.g.toasts.length, 1, 'a delete that cannot find its owner still toasts (it used to say nothing)');
ok(/select the video/i.test(w8b.g.toasts[0]), 'and the toast says what to do about it');

// el.isConnected is what lets videoAnnoGetSelected() fall back to "the only
// video on the board", so this item resolves and the lookup gets as far as
// searching its comment list.
const EA = { id: 'a', isVideo: true, video: mkVideo(), el: { isConnected: true }, anno: { comments: [{ id: 'c1', text: 'x' }] } };
const w8c = world({ state: { items: [EA], selected: new Set() } });
w8c.videoAnnoDeleteComment('nope');
eq(w8c.g.toasts[w8c.g.toasts.length - 1], 'Comment not found on this video',
  'a comment id that is not on the resolved clip is reported, not swallowed');

const UA = { id: 'a', isVideo: true, video: mkVideo(), anno: { comments: [{ id: 'c1', time: 1, text: 'old' }] } };
const UB = { id: 'b', isVideo: true, video: mkVideo(), anno: { comments: [{ id: 'c2', time: 2, text: 'y' }] } };
const w8d = world({ state: { items: [UA, UB], selected: new Set() } });
w8d.videoAnnoUpdateComment('c1', 'new');
eq(UA.anno.comments[0].text, 'new', 'edit finds its owner too, with nothing selected');
eq(w8d.g.toasts[w8d.g.toasts.length - 1], 'Comment updated', 'with confirmation');

const JV = mkVideo();
// A pre-v7.21.0 .kpak: only `frame`, no `time`.
const JA = { id: 'a', isVideo: true, video: JV, anno: { comments: [{ id: 'c1', frame: 100, text: 'legacy' }] } };
const JB = { id: 'b', isVideo: true, video: mkVideo(), anno: { comments: [] } };
const w8e = world({ state: { items: [JA, JB], selected: new Set() } });
w8e.videoAnnoJumpToComment('c1');
near(JV.currentTime, 100 / 30, 1e-9,
  'a legacy comment back-fills time from its frame (it used to seek to NaN, i.e. frame 0)');
eq(JV.paused, true, 'and playback pauses so the frame stays put');
ok(/Jumped to frame 100/.test(w8e.g.toasts[w8e.g.toasts.length - 1]), 'the toast shows the derived frame');

// ══════════════════════════════════════════════════════════════════════════
//  S9 — the list renders from the derived frame
// ══════════════════════════════════════════════════════════════════════════
ok(/videoAnnoCommentTime\(a, item\) - videoAnnoCommentTime\(b, item\)/.test(RCL),
  'the list sorts by TIME, so comments never reorder when fps changes');
// v7.21.0 release day: the rule now also covers the export, Send-to-Board and
// J/K order — all of them used to sort on the derived `frame` and silently
// reshuffled whenever fps changed. Same rule, more call sites, one definition
// (videoAnnoCommentTime) behind all of them.
eq(countOf(/videoAnnoCommentTime\(a, item\) - videoAnnoCommentTime\(b, item\)/g), 5,
  'the list renderer, the batch Snap, the export, Send-to-Board and J/K all sort by time');
eq(countOf(/videoAnnoCommentTime\(a, _itm\) - videoAnnoCommentTime\(b, _itm\)/g), 1,
  'and so does the popover comment list');
ok(/const _cf = videoAnnoCommentFrame\(c, item\);/.test(RCL),
  'and every displayed frame number is derived from the stored time');
ok(!/sort\(\(a, b\) => a\.frame - b\.frame\)/.test(RCL), 'the old frame-based sort is gone');

// ══════════════════════════════════════════════════════════════════════════
//  ASYNC — the verified seek and the batch Snap
// ══════════════════════════════════════════════════════════════════════════
function main() {
  // ── S5: an exact seek ──
  let v = mkVideo();
  let p = w1.videoAnnoSeekTo(v, 3.5, 0.5);
  v.__seek(3.5); v.__present();
  return p.then(function (r) {
    eq(r.ok, true, '[S5] an exact seek is accepted');
    near(r.actual, 3.5, 1e-9, '[S5] and reports the time reached');

    // ── S5b: a keyframe snap inside tolerance ──
    v = mkVideo({ snap: 0.5 });
    const p2 = w1.videoAnnoSeekTo(v, 2.3, 0.5);
    v.__seek(2.3); v.__present();          // lands on 2.5
    return p2;
  }).then(function (r) {
    eq(r.ok, true, '[S5b] a 0.2s keyframe snap is inside tolerance, so it is accepted');
    near(r.actual, 2.5, 1e-9,
      '[S5b] BUT it reports 2.5, the time ACTUALLY reached — not the 2.3 that was asked for');

    // ── S5c: a seek that has not arrived must NOT settle ──
    v = mkVideo({ snap: 4 });
    let settled = false;
    const p3 = w1.videoAnnoSeekTo(v, 3.3, 0.5).then(function (x) { settled = true; return x; });
    v.__seek(3.3); v.__present();          // snaps to 4.0 — 0.7s away
    return new Promise(function (res) { setTimeout(res, 5); }).then(function () {
      eq(settled, false,
        '[S5c] a seek that landed 0.7s away is REJECTED — this is what used to bake in the wrong frame');
      v.snap = 0;
      v.__seek(3.3); v.__present();
      return p3;
    });
  }).then(function (r) {
    eq(r.ok, true, '[S5c] and it settles once the seek really arrives');
    near(r.actual, 3.3, 1e-9, '[S5c] with the correct actual time');

    // ── S5d: give up rather than hang ──
    v = mkVideo({ snap: 4 });
    const p4 = w1.videoAnnoSeekTo(v, 3.3, 0.5);
    v.__seek(3.3);                          // 4.0, never within tolerance
    return Promise.race([
      p4,
      new Promise(function (res) { setTimeout(function () { res({ ok: 'HUNG' }); }, 500); })
    ]);
  }).then(function (r) {
    eq(r.ok, false, '[S5d] a seek that never lands times out with ok:false instead of hanging forever');

    // ── S5e: rVFC is used when the browser offers it ──
    v = mkVideo();
    const p5 = w1.videoAnnoSeekTo(v, 1.25, 0.5);
    v.__seek(1.25);
    return new Promise(function (res) { setTimeout(res, 2); }).then(function () {
      eq(v._rvfUsed, true, '[S5e] requestVideoFrameCallback is used when available');
      ok(v._rvf !== null, '[S5e] and is still pending — the capture waits for the frame to be PRESENTED');
      v.__present();
      return p5;
    });
  }).then(function (r) {
    eq(r.ok, true, '[S5e] then it settles after the frame is presented');
    near(r.actual, 1.25, 1e-9, '[S5e] at the right time');

    // ── S5f: rVFC missing -> the double-rAF fallback (rAF stub is synchronous) ──
    v = mkVideo();
    v.requestVideoFrameCallback = function () { throw new Error('no rVFC'); };
    const p6 = w1.videoAnnoSeekTo(v, 7.75, 0.5);
    v.__seek(7.75);
    return p6;
  }).then(function (r) {
    eq(r.ok, true, '[S5f] without rVFC the double-rAF fallback still works');
    near(r.actual, 7.75, 1e-9, '[S5f] with the right time');

    // ── S5g: a null element resolves instead of throwing ──
    return w1.videoAnnoSeekTo(null, 1, 0.5);
  }).then(function (r) {
    eq(r.ok, false, '[S5g] a null element resolves ok:false rather than throwing into an unhandled rejection');

    // ══ S6: the batch Snap stores what it actually captured ══
    const sv = mkVideo({ fps: 25, snap: 0.5 });
    const committed = [];
    const SA = {
      id: 'a', isVideo: true, video: sv, anno: null,
      el: {
        _textEditorEl: { marker: true },
        _commitTextEditor: function () { committed.push(1); },
        _annoDrawState: {
          strokesByFrame: {
            '57': [{ type: 'pen', color: '#f00', size: 3, points: [[1, 2], [3, 4]], text: '' }],
            '58': []
          }
        }
      }
    };
    // Selection deliberately points at the OTHER clip (30fps) — the real-world
    // condition that produced the wrong frame.
    const SB = { id: 'b', isVideo: true, video: mkVideo({ fps: 30 }), el: { isConnected: true } };
    const w6 = world({ state: { items: [SA, SB], selected: new Set(['b']) } });
    const p7 = w6.videoAnnoSnapBatch(SA);
    sv.__seek(57 / 25); sv.__present();     // 2.28 -> snaps to 2.5
    return p7.then(function (res) {
      eq(res.snapped, 1, '[S6] one stroked frame, one comment');
      eq(res.skipped, 0, '[S6] nothing skipped');
      const c = w6.videoAnnoEnsure(SA).comments[0];
      ok(!!c, '[S6] a comment was created');
      near(c.time, 2.5, 1e-9,
        '[S6] the stored time is 2.5 — the frame ACTUALLY captured (old code stored 2.28, the requested time)');
      near(c.targetTime, 2.28, 1e-6, '[S6] 57/25 = 2.28 — fps came from clip A, not the selected clip B');
      eq(c.frame, 63, '[S6] the displayed frame is derived from the real time: round(2.5 x 25) = 63');
      near(c.snapDrift, 2.5 - 2.28, 1e-9, '[S6] and the drift is recorded, so a bad capture is visible not silent');
      eq(c.snapshot, 'SNAP@2.5', '[S6] the snapshot was taken at the time that got stored');
      eq(c.annoStrokes.length, 1, '[S6] the strokes for frame 57 travelled with the comment');
      eq(committed.length, 1,
        '[S6] an open text editor is committed BEFORE strokesByFrame is read, so a note typed with T is not lost');
      ok(Math.abs(c.targetTime - 1.9) > 0.1,
        '[S6] had it used the selection\'s 30fps the target would be 1.9s — it is not');
    });
  }).then(function () {
    // ══ S6b: Snap leaves the video as it found it ══
    const sv = mkVideo({ fps: 30 });
    sv._t = 9;
    const SA = {
      id: 'a', isVideo: true, video: sv, anno: null,
      el: { _annoDrawState: { strokesByFrame: { '10': [{ type: 'pen', points: [[0, 0]] }] } } }
    };
    const w6b = world({ state: { items: [SA], selected: new Set(['a']) } });
    const p8 = w6b.videoAnnoSnapBatch(SA);
    sv.__seek(10 / 30); sv.__present();
    return p8.then(function (r) {
      eq(r.snapped, 1, '[S6b] one comment created');
      eq(w6b.g.duringSuppress[0], true,
        '[S6b] the trim loop is suppressed WHILE capturing — a trimmed clip would otherwise yank the playhead home');
      ok(!sv._kraftedSuppressTrimLoop, '[S6b] and it is handed back after the batch');
      near(sv.currentTime, 9, 1e-9, '[S6b] the playhead is restored to where the user parked it');
      ok(w6b.g.saves > 0, '[S6b] the board was saved');
      ok(w6b.g.undos > 0, '[S6b] one undo step covers the whole batch');
      ok(w6b.g.refreshes > 0, '[S6b] the comment list was refreshed');
    });
  }).then(function () {
    // ══ S6c: a second Snap must not duplicate an existing frame ══
    const sv = mkVideo({ fps: 30 });
    const SA = {
      id: 'a', isVideo: true, video: sv, anno: null,
      el: { _annoDrawState: { strokesByFrame: { '10': [{ type: 'pen', points: [[0, 0]] }] } } }
    };
    const w6c = world({ state: { items: [SA], selected: new Set(['a']) } });
    const p9 = w6c.videoAnnoSnapBatch(SA);
    sv.__seek(10 / 30); sv.__present();
    return p9.then(function () {
      const p10 = w6c.videoAnnoSnapBatch(SA);
      return p10.then(function (r2) {
        eq(r2.snapped, 0, '[S6c] snapping the same frame twice does not duplicate it');
        eq(r2.skipped, 1, '[S6c] and says so');
        eq(w6c.videoAnnoEnsure(SA).comments.length, 1, '[S6c] there is still exactly one comment');
      });
    });
  }).then(function () {
    // ══ S6d: the batch sorts by TIME, not by a frame number that can lie ══
    const sv = mkVideo({ fps: 25, snap: 0.5 });
    const SA = {
      id: 'a', isVideo: true, video: sv,
      // A legacy comment whose frame disagrees with its time — exactly what
      // an old .kpak looks like once fps has been re-detected.
      anno: { comments: [{ id: 'seed', time: 5.0, frame: 10, text: 'legacy', snapshot: 'OLD', annoStrokes: [] }] },
      el: { _annoDrawState: { strokesByFrame: { '57': [{ type: 'pen', points: [[0, 0]] }] } } }
    };
    const w6d = world({ state: { items: [SA], selected: new Set(['a']) } });
    const p12 = w6d.videoAnnoSnapBatch(SA);
    sv.__seek(57 / 25); sv.__present();      // 2.28 -> lands on 2.5
    return p12.then(function () {
      const cs = w6d.videoAnnoEnsure(SA).comments;
      eq(cs.length, 2, '[S6d] the seeded comment is kept and the new one added');
      near(cs[0].time, 2.5, 1e-9,
        '[S6d] sorted by TIME the new 2.5s comment comes first, even though its frame (63) is HIGHER than the seeded one (10)');
    });
  }).then(function () {
    // ══ S7: one wrong capture can be repaired without deleting it ══
    // The comment asks for 2.3s; the codec can only land on 2.5s. Re-snap must
    // record what it captured, not what it asked for.
    const rv = mkVideo({ fps: 25, snap: 0.5 });
    const RA = {
      id: 'a', isVideo: true, video: rv,
      anno: { comments: [{ id: 'c1', time: 2.3, frame: 57, text: 'keep me', snapshot: 'OLD', annoStrokes: [] }] }
    };
    const RB = { id: 'b', isVideo: true, video: mkVideo({ fps: 30 }), anno: { comments: [] } };
    // Two clips, NOTHING selected — precisely the state where delete used to die.
    const w7 = world({ state: { items: [RA, RB], selected: new Set() } });
    const p11 = w7.videoAnnoReSnapComment('c1');
    setTimeout(function () { rv.__seek(2.3); rv.__present(); }, 0);
    return p11.then(function (done) {
      const c = w7.videoAnnoEnsure(RA).comments[0];
      eq(done, true, '[S7] re-snap succeeded with NOTHING selected and two clips on the board');
      eq(c.text, 'keep me', '[S7] the comment text survived — nothing was deleted and rebuilt');
      near(c.time, 2.5, 1e-9, '[S7] the stored time is 2.5, the frame ACTUALLY captured — not the 2.3 requested');
      eq(c.snapshot, 'SNAP@2.5', '[S7] and the snapshot matches the stored time');
      eq(c.frame, 63, '[S7] with the frame re-derived from that time');
      eq(w7.g.duringSuppress[0], true, '[S7] the trim loop is suppressed while re-snapping too');
      eq(w7.g.toasts[w7.g.toasts.length - 1], 'Re-snapped f 63', '[S7] the toast reports the derived frame');
    });
  }).then(function () {
    // ══ S8: ordering — frame is DERIVED, so order on TIME ══════════════
    // A legacy comment can carry a frame number that was baked under a
    // different fps — that is precisely what the old selection-derived fps
    // did. Ordering on that frame silently reshuffles the export; ordering
    // on time does not. The two orders below deliberately DISAGREE, so a
    // frame sort and a time sort give different answers.
    const ordSrc = (src.match(
      /const comments = \(anno\.comments \|\| \[\]\)\.slice\(\)\.sort\(function \(a, b\) \{[\s\S]*?\n  \}\);/
    ) || [''])[0];
    ok(ordSrc.length > 60, '[S8] the export / send-to-board sort statement is still in the source (anchor)');
    const w8 = world({ state: { items: [], selected: new Set() } });
    const item8 = { id: 'i8', isVideo: true, video: { _kraftedFps: 25 }, anno: { comments: [] } };
    const ordered = new Function('videoAnnoCommentTime', 'item', 'anno', ordSrc + '\nreturn comments;')(
      w8.videoAnnoCommentTime, item8,
      { comments: [
        { id: 'late', time: 2.5, frame: 10 },   // frame says first…
        { id: 'early', time: 0.4, frame: 63 }   // …time says second
      ] });
    eq(ordered[0].id, 'early',
      '[S8] a comment whose stored frame disagrees with its time is ordered by TIME');
    eq(ordered[1].id, 'late', '[S8] not by the stale frame number');
  });
}

main().catch(function (e) {
  fails.push('async section threw: ' + (e && e.message));
}).then(function () {
  console.log(n + ' assertions');
  if (fails.length) {
    console.log('FAILURES: ' + fails.length);
    fails.forEach(function (f) { console.log('  FAIL: ' + f); });
    process.exit(1);
  } else {
    console.log('ALL PASS (' + n + ' assertions)');
  }
});
