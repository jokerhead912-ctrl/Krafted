#!/usr/bin/env node
/*
 * test_v7038_tidy.js — runs the REAL tidySelection() against a mocked board.
 *
 * The structural suite (test_v7038.js) can only prove the constants exist.
 * This one proves the layout actually comes out 380px wide when a video is
 * in the selection, because it executes the shipped function body.
 *
 * Usage:  node test_v7038_tidy.js [path-to-kraftpub.html]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2]
  || path.resolve(__dirname, '../../kraftpub-dev.html');
const src = fs.readFileSync(FILE, 'utf8');

let pass = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; } else { fails.push(label); }
}
function eq(a, b, label) {
  ok(a === b, `${label}  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}
const near = (a, b, t) => Math.abs(a - b) <= (t === undefined ? 0.5 : t);

// ── extract the shipped function ───────────────────────────────────────
function fnFull(name, hay) {
  const i = hay.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let d = 0, started = false;
  for (let j = i; j < hay.length; j++) {
    const c = hay[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return hay.slice(i, j + 1); }
  }
  return '';
}
const tidySrc = fnFull('tidySelection', src);
const predSrc = fnFull('_itemHasPlayerControls', src);
if (!tidySrc || !predSrc) {
  console.error('could not extract tidySelection / _itemHasPlayerControls');
  process.exit(2);
}
// The SPEC. These are hardcoded on purpose: this suite asserts behaviour,
// so it must compare the layout it produces against the number we want,
// NOT against a constant read back out of the same source (that is
// circular and passes even when the feature is removed).
const EXPECT_COL_W = 280;
const EXPECT_MEDIA_COL_W = 380;
// The app's own constants, fed into the extracted function. Asserted
// against the spec below so the two can never drift apart unnoticed.
const TIDY_COL_W = Number((src.match(/var TIDY_COL_W = (\d+);/) || [])[1]);
const TIDY_MEDIA_COL_W = Number((src.match(/var TIDY_MEDIA_COL_W = (\d+);/) || [])[1]);
eq(TIDY_COL_W, EXPECT_COL_W, 'the app image column matches the spec');
eq(TIDY_MEDIA_COL_W, EXPECT_MEDIA_COL_W, 'the app media column matches the spec');

// ── board harness ──────────────────────────────────────────────────────
function makeBoard(items) {
  const state = {
    items: items.slice(),
    texts: [], todos: [], mindmaps: [],
    selected: new Set(),
    zoom: 1, pan: { x: 0, y: 0 }
  };
  const calls = { toast: [], undo: 0, style: 0, canvas: 0, save: 0 };
  const run = new Function(
    'state', 'toast', 'pushUndo', 'updateItemStyle', 'updateCanvas', 'scheduleAutoSave',
    'TIDY_COL_W', 'TIDY_MEDIA_COL_W', 'applyTextProps', 'mmUpdateConnectors',
    predSrc + '\n' + tidySrc + '\nreturn tidySelection;'
  );
  const tidy = run(
    state,
    function (m) { calls.toast.push(m); },
    function () { calls.undo++; },
    function () { calls.style++; },
    function () { calls.canvas++; },
    function () { calls.save++; },
    TIDY_COL_W, TIDY_MEDIA_COL_W,
    function () {}, function () {}
  );
  return { state: state, tidy: tidy, calls: calls };
}

const img = (id, w, h) => ({ id: id, x: 0, y: 0, w: w, h: h });
const vid = (id, w, h) => ({ id: id, x: 0, y: 0, w: w, h: h, isVideo: true });

// ═══════════════════════════════════════════════════════════════════════
// 1. A mixed selection gets the media column, not the image column
// ═══════════════════════════════════════════════════════════════════════
(function () {
  const b = makeBoard([img('i1', 1600, 900), img('i2', 1200, 1600), img('i3', 900, 900), vid('v1', 1920, 1080)]);
  b.state.selected = new Set(['i1', 'i2', 'i3', 'v1']);
  b.tidy();
  const widths = b.state.items.map(i => i.w);
  widths.forEach((w, n) => ok(near(w, EXPECT_MEDIA_COL_W), `mixed selection item ${n} is ${EXPECT_MEDIA_COL_W}px`));
  ok(widths.every(w => near(w, EXPECT_MEDIA_COL_W)),
     'one video widens the whole grid — a uniform column is the point of tidy');
  ok(b.calls.toast.join(' ').indexOf('380px') >= 0, 'the toast names the column width actually used');
  ok(b.calls.toast.join(' ').indexOf('media') >= 0, 'the toast says why the column is wider');
  ok(b.calls.undo === 1, 'tidy pushes exactly one undo step');
  ok(b.calls.canvas === 1, 'tidy refreshes the canvas');
})();

// ═══════════════════════════════════════════════════════════════════════
// 2. An image-only selection keeps the dense 280px column
// ═══════════════════════════════════════════════════════════════════════
(function () {
  const b = makeBoard([img('i1', 1600, 900), img('i2', 1200, 1600), img('i3', 900, 900)]);
  b.state.selected = new Set(['i1', 'i2', 'i3']);
  b.tidy();
  b.state.items.forEach((i, n) => ok(near(i.w, EXPECT_COL_W), `image-only item ${n} stays ${EXPECT_COL_W}px`));
  ok(b.calls.toast.join(' ').indexOf('media') < 0, 'an image-only tidy does not claim to be media');
})();

// ═══════════════════════════════════════════════════════════════════════
// 3. A single video is floored even though tidy leaves lone items alone
// ═══════════════════════════════════════════════════════════════════════
(function () {
  const b = makeBoard([vid('v1', 240, 135)]);
  b.state.selected = new Set(['v1']);
  b.tidy();
  const v = b.state.items[0];
  ok(near(v.w, EXPECT_MEDIA_COL_W), `a 240px video is floored up to ${EXPECT_MEDIA_COL_W}px`);
  ok(near(v.h, EXPECT_MEDIA_COL_W * (135 / 240), 1), 'the floor preserves the aspect ratio');
})();

(function () {
  const b = makeBoard([vid('v1', 1920, 1080)]);
  b.state.selected = new Set(['v1']);
  b.tidy();
  ok(near(b.state.items[0].w, 1920), 'a video already wider than the floor is left alone');
})();

(function () {
  const b = makeBoard([img('i1', 200, 200)]);
  b.state.selected = new Set(['i1']);
  b.tidy();
  ok(near(b.state.items[0].w, 200), 'a single image is NOT floored — only players are');
})();

// ═══════════════════════════════════════════════════════════════════════
// 4. The thing the user actually complained about
// ═══════════════════════════════════════════════════════════════════════
(function () {
  // 30 reference images and 3 clips: the mixed board this was built for.
  const items = [];
  for (let i = 0; i < 30; i++) items.push(img('img' + i, 1400 + i, 1000));
  items.push(vid('v1', 1920, 1080), vid('v2', 1920, 1080), vid('v3', 1280, 720));
  const b = makeBoard(items);
  b.state.selected = new Set(items.map(i => i.id));
  b.tidy();

  const vids = b.state.items.filter(i => i.isVideo);
  eq(vids.length, 3, 'all three clips survived the tidy');
  vids.forEach(v => ok(near(v.w, EXPECT_MEDIA_COL_W), `${v.id} lands on the media column`));

  // No two items may share a slot — the v7.0.37 cascade fixed flat 20px
  // offsets; tidy packs by column height, so overlap means a regression.
  let overlaps = 0;
  const all = b.state.items;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], c = all[j];
      const ox = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x);
      const oy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
      if (ox > 1 && oy > 1) overlaps++;
    }
  }
  eq(overlaps, 0, 'no two items in a 33-item tidy overlap');
  ok(new Set(all.map(i => Math.round(i.x) + ':' + Math.round(i.y))).size === all.length,
     'every item occupies its own position');
})();

// ═══════════════════════════════════════════════════════════════════════
// 5. Degenerate input
// ═══════════════════════════════════════════════════════════════════════
(function () {
  const b = makeBoard([]);
  b.state.selected = new Set();
  b.tidy();
  ok(b.calls.toast.join(' ').indexOf('Select items') >= 0, 'an empty selection asks you to select first');
  eq(b.calls.undo, 0, 'an empty selection pushes no undo step');
})();

(function () {
  const b = makeBoard([vid('v1', 0, 0)]);
  b.state.selected = new Set(['v1']);
  b.tidy();
  ok(isFinite(b.state.items[0].w), 'a zero-sized video does not produce NaN geometry');
})();

console.log(`\ntest_v7038_tidy — ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  fails.forEach(f => console.log('  FAIL  ' + f));
  process.exit(1);
}
console.log('ALL PASS');
