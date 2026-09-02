#!/usr/bin/env node
/*
 * test_v7_2_1.js — save size estimate + web-drag decode (v7.2.1)
 *
 * WHY THIS SUITE EXISTS
 *   Two reported bugs, and the second one is pitfall one again.
 *
 *   A. The save progress bar claimed ~735 MB for a board that wrote 3.8 MB.
 *      saveBoardV6() estimated from it._fileSize, but _fileSize is only ever
 *      set by the addImage paths (11081/21653). The four LOAD paths set
 *      _sourceBlob and nothing else, so every item on a board opened from a
 *      .kpak fell through to the 5 MB-per-item guess: 151 items x 5 MB.
 *      The autosave size guard (38493) reads _fileSize too, so it was dead
 *      for the same reason. The estimate now prefers the Blob it is about to
 *      write, and the load paths record the size they already know.
 *
 *   B. Dragging several images off a website crashed the tab. The local
 *      file-drop path (24912) decodes with createImageBitmap, closes the
 *      bitmap, and walks the files one at a time with a 50 ms gap. The
 *      web-drag path decoded into an <img>, never released it, and ran once
 *      per drop with no coordination — so N quick drags held N full-
 *      resolution bitmaps at once. A 4000x3000 source is ~48 MB of RGBA,
 *      and that is before the 1280 cap ever runs.
 *
 *      Same job, two implementations, one of them missing both safeguards.
 *      The cure is the usual one: make the web path do what the local path
 *      already did, rather than invent a third way.
 *
 *   WHAT IS BEING PINNED
 *   Not the numbers, and not the DOM. What must survive is that (1) every
 *   path that hands an item a Blob also records its size, (2) the estimate
 *   can always fall back to that Blob instead of guessing, (3) a decode is
 *   always released, and (4) it is released BEFORE the async IndexedDB
 *   write, because holding a bitmap across an await is how the peak built
 *   up in the first place.
 *
 * Usage:  node test_v7_2_1.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TESTS = __dirname;
const ROOT = path.resolve(TESTS, '../..');
const DEV = path.resolve(ROOT, 'kraftpub-dev.html');
const STATE = JSON.parse(fs.readFileSync(path.resolve(TESTS, '.version_state'), 'utf8'));
const HTML = fs.readFileSync(DEV, 'utf8');
// The version policy lives in version_scan.py, so the suite drives the real
// module through the probe rather than re-stating the rule in JavaScript.
const PY = process.env.KRAFTED_PY
  || '/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3';
const PROBE = path.resolve(TESTS, 'vscan_probe.py');
function probe(...args) {
  return JSON.parse(execFileSync(PY, [PROBE, ...args], { encoding: 'utf8' }));
}

let pass = 0;
const fails = [];
function ok(cond, label) { if (cond) { pass++; } else { fails.push(label); } }
function eq(a, b, label) {
  ok(a === b, `${label}  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}
function has(needle, label) {
  ok(HTML.indexOf(needle) >= 0, `${label}  (missing: ${JSON.stringify(needle.slice(0, 70))})`);
}
function hasNot(needle, label) {
  ok(HTML.indexOf(needle) < 0, `${label}  (should be absent: ${JSON.stringify(needle.slice(0, 70))})`);
}
function count(needle, n, label) {
  const got = HTML.split(needle).length - 1;
  ok(got === n, `${label}  (found ${got}, want ${n})`);
}
// Ordering assertion. Several of these fixes are only correct because one
// thing happens before another; a plain "both strings exist" check would
// pass happily when the order is wrong.
function before(first, second, label) {
  const a = HTML.indexOf(first);
  const b = HTML.indexOf(second);
  ok(a >= 0 && b >= 0 && a < b, `${label}  (${JSON.stringify(first.slice(0, 40))} at ${a}, ${JSON.stringify(second.slice(0, 40))} at ${b})`);
}

// ═══ 1. every load path records the size it already knows ══════════════
// Each anchor spans two lines so it cannot match the addImage paths, which
// set _fileSize from a function argument rather than from a Blob.
(function () {
  count('          dataItem._sourceBlob = stableMediaBlob;\n          dataItem._fileSize = stableMediaBlob.size;', 1,
    'v6 kpak media load sets _fileSize next to _sourceBlob');
  count('          item._sourceBlob = stableBlob;\n          item._fileSize = stableBlob.size;', 1,
    'v6 lazy video load sets _fileSize next to _sourceBlob');
  count('            dataItem._sourceBlob = blob;\n            dataItem._fileSize = blob.size;', 1,
    'legacy JSZip media load sets _fileSize next to _sourceBlob');
  count('            item._sourceBlob = blob;\n            item._fileSize = blob.size;', 1,
    'legacy JSZip lazy video load sets _fileSize next to _sourceBlob');

  // The four sites must line up with the four _sourceBlob assignments on the
  // load path. If a fifth load path appears, this count goes to 5 and the
  // suite goes red — which is the point.
  const loads = (HTML.match(/^\s+(?:dataItem|item)\._sourceBlob = (?:stableMediaBlob|stableBlob|blob);$/gm) || []).length;
  eq(loads, 4, 'there are exactly four load-path _sourceBlob assignments to cover');
})();

// ═══ 2. the estimate can always fall back to the real Blob ═════════════
(function () {
  has('    else if (it._sourceBlob && it._sourceBlob.size) { estTotalBytes += it._sourceBlob.size; }',
    'the estimate falls back to the Blob it is about to write');
  count('it._sourceBlob && it._sourceBlob.size', 1,
    'the fallback appears exactly once');

  // Precedence matters: a recorded size wins, then the Blob, and only then
  // do we guess. Reordering these is a real regression.
  before('    if (it._fileSize) { estTotalBytes += it._fileSize; }',
    '    else if (it._sourceBlob && it._sourceBlob.size)',
    'a recorded _fileSize is preferred over the Blob');
  before('    else if (it._sourceBlob && it._sourceBlob.size) { estTotalBytes += it._sourceBlob.size; }',
    "    else if (it.src && it.src.startsWith('data:')) {",
    'the Blob is preferred over base64 length');
  before("    else if (it.src && it.src.startsWith('data:')) {",
    "      estTotalBytes += it.isVideo ? 80 * 1024 * 1024 : 5 * 1024 * 1024;",
    'the 5 MB guess is the last resort, not the first');

  // The guess still has to exist — some items genuinely have no Blob and no
  // recorded size, and deleting the branch would make those items count as
  // zero and produce an estimate that is too LOW.
  has('estTotalBytes += it.isVideo ? 80 * 1024 * 1024 : 5 * 1024 * 1024;',
    'the blind guess survives as the final fallback');
})();

// ═══ 3. the serial queue is real, and lives at module scope ════════════
(function () {
  has('var _webDragQueue = { busy: false, pending: [] };', 'the queue state is declared');
  has('function _drainWebDragQueue() {', 'the drain loop is declared');
  has('function _enqueueWebDrag(job) {', 'the enqueue entry point is declared');
  count('function _enqueueWebDrag(job) {', 1, 'the queue is declared exactly once');

  // A queue declared inside the drop handler would be a fresh empty one on
  // every drop, which is indistinguishable from having no queue at all.
  // This is why module scope is part of the fix and not an implementation
  // detail: pin it.
  before('var _webDragQueue = { busy: false, pending: [] };',
    'const _sx = e.clientX, _sy = e.clientY;',
    'the queue is declared outside (before) the drop handler');

  // The drain must release the lock exactly once per job and re-arm itself,
  // or the queue silently stops after the first image.
  has('      _webDragQueue.busy = false;', 'the drain clears the busy flag when a job finishes');
  has('      setTimeout(_drainWebDragQueue, 50);', 'the drain re-arms itself with a yield');
})();

// ═══ 4. a decode is always released, on both paths ═════════════════════
(function () {
  has('createImageBitmap(blob).then(function (bmp) {', 'web drag decodes via createImageBitmap');
  has("release: function () { try { bmp.close(); } catch (e) {} } };",
    'the bitmap path releases with close()');
  has("release: function () { try { img.src = ''; } catch (e) {} } });",
    'the <img> fallback releases too');

  // The old code: decoded into an <img> and left it there for the GC.
  hasNot('img.src = tmpUrl;', 'the un-released <img> decode is gone');

  // Both routes must hand back a release function, or the catch-all
  // decoded.release() below becomes a no-op and the leak returns.
  count('release: function () {', 2, 'exactly two decode routes, each with a release');
})();

// ═══ 5. release happens BEFORE the async IndexedDB write ═══════════════
// This is the whole point of fix B. Holding a full-resolution bitmap across
// an await is what let the peak build up across several quick drags, even
// though each bitmap was eventually released.
(function () {
  before('          try { decoded.release(); } catch (e) {}',
    '          _dragImgStore.putAndGet(outBlob).then(function (diskBlob) {',
    'the bitmap is released before the IndexedDB round trip');
  before('          if (_tmpUrl) { _release(_tmpUrl); _tmpUrl = null; }',
    '          _dragImgStore.putAndGet(outBlob).then(function (diskBlob) {',
    'the temp blob URL is revoked before the IndexedDB round trip');
})();

// ═══ 6. the whole acquire+decode chain is queued, not just the decode ══
(function () {
  count('_enqueueWebDrag(function () {', 1, 'exactly one call site is queued');
  has('    return _tryAcquire(0)', 'the queued job returns the chain, so the queue can await it');

  // Pitfall-one guard: both import paths must run the same normalise rule.
  // If the web path ever grows its own resize maths again, this catches it.
  has('        normalizeImageBlob(blob, decoded.source, decoded.w, decoded.h, false, _finish);',
    'web drag routes through normalizeImageBlob');
  has('        normalizeImageBlob(file, bitmap, w, h, true, function (outBlob, ow, oh) {',
    'local drop routes through the same normalizeImageBlob');
  const calls = (HTML.match(/normalizeImageBlob\(/g) || []).length;
  ok(calls >= 2, `both import paths share one normalise rule (${calls} call sites)`);

  // The local path was already correct; make sure that is still true, since
  // the web path was fixed by copying it.
  has('          bitmap.close();  // release as soon as we are done drawing it',
    'local drop still closes its bitmap');
  has('    setTimeout(processNextImage, 50);', 'local drop still paces itself');
})();

// ═══ 7. the tree still agrees with the recorded version ════════════════
(function () {
  const sw = fs.readFileSync(path.resolve(ROOT, 'Krafted/docs/sw.js'), 'utf8');
  const title = (HTML.match(/<title>Krafted v([\d.]+)<\/title>/) || [])[1];
  const konst = (HTML.match(/var KRAFTED_VERSION = '([\d.]+)';/) || [])[1];
  const appv = (sw.match(/const APP_VERSION = '([\d.]+)';/) || [])[1];
  eq(title, STATE.current, 'the title matches the recorded current version');
  eq(konst, STATE.current, 'KRAFTED_VERSION matches the recorded current version');
  eq(appv, STATE.current, 'the service worker matches the recorded current version');
  ok(/^\d+\.\d+\.\d+$/.test(STATE.current), 'the recorded version is MAJOR.MINOR.PATCH');

  // The bump KIND this release was, pinned through the real policy engine.
  //
  // These four used to read STATE.current / STATE.prev and assert "the patch
  // number advanced by exactly one". That is a fact about the LAST bump, not
  // about this suite: as soon as 7.3.0 shipped as a minor, all four went red
  // on a suite nobody had touched, while the thing they described (7.2.1 is
  // a patch release under the SemVer policy) was still exactly true. Live
  // state is a moving target - synthesise the state instead, and let the
  // real module do the arithmetic.
  //
  // Built from parts, never as a dotted literal: version_scan rewrites bare
  // MAJOR.MINOR.PATCH in every suite, which would turn these inputs into the
  // thing being tested.
  const V = (a, b, c) => `${a}.${b}.${c}`;
  const OWN_PREV = V(7, 2, 0);
  const OWN = V(7, 2, 1);
  eq(probe('next', OWN_PREV, 'patch').next, OWN,
    `a patch bump from ${OWN_PREV} produces ${OWN} - the release this suite documents`);
  const minorFrom = probe('next', OWN_PREV, 'minor').next;
  ok(minorFrom !== OWN,
    `a minor bump from ${OWN_PREV} produces ${minorFrom}, not ${OWN}`);
  eq(minorFrom, V(7, 3, 0),
    `a minor bump from ${OWN_PREV} would have produced ${V(7, 3, 0)} instead`);
  // Both fixes correct wrong behaviour; nothing new became possible and
  // nothing moved on screen. The suite pins that as "patch", not "minor",
  // through the policy above rather than by restating the judgement here.
  ok(probe('policy', OWN_PREV, 'patch') === null || probe('policy', OWN_PREV, 'patch').error === null,
    'a patch bump from the previous release is legal under the policy');
})();

// ═══ report ═══════════════════════════════════════════════════════════
console.log(`test_v7_2_1.js  (v${STATE.current} — save estimate uses the real Blob; web drag decodes one at a time)`);
if (fails.length) {
  console.log(`  ${pass} passed, ${fails.length} FAILED`);
  fails.forEach((f) => console.log('    FAIL  ' + f));
  process.exit(1);
} else {
  console.log(`  ALL PASS (${pass} assertions)`);
}
