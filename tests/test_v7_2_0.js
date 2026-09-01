#!/usr/bin/env node
/*
 * test_v7_2_0.js — chrome insets (v7.2.0)
 *
 * WHY THIS SUITE EXISTS
 *   v7.2.0 fixes four overlay collisions that were reported as three, and
 *   which were all the same bug: every floating panel hardcoded its own
 *   position:fixed coordinates, so no single place knew what else was already
 *   in that corner. Each new panel pinned itself to an occupied corner:
 *     #props        top12 right12 w250 z9999999  -> covered #library entirely
 *     #library      top12 right12 w248 z9999998  -> invisible behind props
 *     #minimap      bottom12 right12             -> bottom third under media-bar
 *     #status       bottom42 right12             -> sat INSIDE the minimap
 *     #zoom-step    bottom14 left12              -> under media-bar (unreported)
 *   The fix is not four nudges. It is one authority: four CSS variables that
 *   _syncBottomBarOffsets() maintains from measured heights, so a panel that
 *   appears, grows or collapses moves its neighbours instead of covering them.
 *
 *   This suite pins the authority, not the resulting pixel positions. Positions
 *   change with content; what must not change is that there is exactly one
 *   place deciding them.
 *
 *   WHY ruleFor() INSTEAD OF A PLAIN STRING SEARCH
 *   The reasoning for this refactor is written in CSS comments, and those
 *   comments quote the very strings being asserted against ("position:fixed",
 *   "bottom:12px"). A naive hasNot() would fail on the documentation rather
 *   than the code. So each assertion is scoped to a single rule's body.
 *
 * Usage:  node test_v7_2_0.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const TESTS = __dirname;
const ROOT = path.resolve(TESTS, '../..');
const DEV = path.resolve(ROOT, 'kraftpub-dev.html');
const STATE = JSON.parse(fs.readFileSync(path.resolve(TESTS, '.version_state'), 'utf8'));
const HTML = fs.readFileSync(DEV, 'utf8');

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

// The body of one CSS rule, so assertions cannot match the prose in comments.
function ruleFor(selector) {
  const i = HTML.indexOf(selector);
  if (i < 0) return null;
  const open = HTML.indexOf('{', i);
  const close = HTML.indexOf('}', open);
  if (open < 0 || close < 0) return null;
  return HTML.slice(open + 1, close);
}
function ruleHas(selector, re, label) {
  const body = ruleFor(selector);
  ok(body !== null && re.test(body), `${label}  (rule ${JSON.stringify(selector)} not matching ${re})`);
}
function ruleHasNot(selector, re, label) {
  const body = ruleFor(selector);
  ok(body !== null && !re.test(body), `${label}  (rule ${JSON.stringify(selector)} still matches ${re})`);
}

// ═══ 1. one authority, written once ═══════════════════════════════════
// If a panel needs to know how much of an edge is taken, it must read these.
// The moment something measures the media bar for itself, the bug is back.
has(':root { --rail-bottom: 0px; --minimap-h: 0px; --right-top: 0px; --status-h: 0px; }',
  'all four inset variables are declared together');
has("root.style.setProperty('--rail-bottom', (barH + gap) + 'px')",
  'the media bar height is published as --rail-bottom');
has("root.style.setProperty('--minimap-h'", 'the minimap publishes its own height');
has("root.style.setProperty('--right-top'", 'the Library publishes the height beneath it');
has("root.style.setProperty('--status-h'", 'the status strip publishes its own height');
hasNot("zw.style.bottom =", 'the zoom widget is no longer positioned by inline style');
hasNot("st.style.bottom =", 'the status pill is no longer positioned by inline style');
has("function _syncBottomBarOffsets()", 'the single sync function still exists');
eq((HTML.match(/function _syncBottomBarOffsets\(\)/g) || []).length, 1,
  'there is exactly one sync function');

// ═══ 2. positions read the variables, not numbers ═════════════════════
ruleHas('#minimap-panel {', /bottom\s*:\s*calc\([^)]*var\(--rail-bottom/,
  'the minimap clears the media bar by variable');
ruleHas('#minimap-panel {', /transition[^;}]*bottom/, 'the minimap animates its bottom edge');
ruleHas('#props {', /top\s*:\s*calc\([^)]*var\(--right-top/,
  'props sits below the Library by variable');
ruleHas('#props {', /max-height\s*:\s*calc\([^)]*var\(--right-top/,
  'props height budget subtracts the Library');
// [^;]* rather than [^)]* — the value contains var(...) calls, so a [^)]*
// scan stops at the first closing paren inside var() and matches nothing.
ruleHas('#props {', /max-height:[^;]*var\(--minimap-h/,
  'props height budget subtracts the minimap');
ruleHas('#props {', /max-height:[^;]*var\(--rail-bottom/,
  'props height budget subtracts the media bar');
ruleHas('#library-panel {', /max-height\s*:\s*calc\(\(100vh - 24px\) \* 0\.55\)/,
  'the Library is capped so props keeps room');
ruleHas('#view-status-bar {', /bottom\s*:\s*calc\([^)]*var\(--rail-bottom/,
  'the status strip clears the media bar by variable');
ruleHas('#capture-result {', /bottom:[^;]*var\(--status-h/,
  'the capture result clears the status strip by variable');

// ═══ 3. the reported collisions, pinned shut ══════════════════════════
ruleHasNot('#status {', /position\s*:/, 'the status pill is not a fixed overlay any more');
ruleHasNot('#status {', /right\s*:/, 'the status pill no longer pins itself right');
ruleHasNot('#status {', /bottom\s*:/, 'the status pill no longer pins its own bottom');
ruleHasNot('#zoom-step-widget {', /position\s*:/, 'the zoom widget is not a fixed overlay any more');
ruleHasNot('#zoom-step-widget {', /bottom\s*:/, 'the zoom widget no longer pins its own bottom');
ruleHasNot('#zoom-step-widget {', /left\s*:/, 'the zoom widget no longer pins its own left');
ruleHasNot('#minimap-panel {', /bottom\s*:\s*12px/, 'the minimap no longer hardcodes bottom:12px');
ruleHasNot('#props {', /top\s*:\s*12px/, 'props no longer hardcodes top:12px');
// Library and props used to claim the identical corner; the Library won the
// slot (it is the panel you keep open) and props now takes what is left.
ruleHas('#library-panel {', /top\s*:\s*12px/, 'the Library keeps the top-right slot');
// The collision was that both claimed top:12px AND right:12px. Sharing the
// right edge is fine; sharing both coordinates is what hid the Library.
// Scoped to position:fixed because #ab-close also sits at top/right 12px —
// inside a modal, so it is not competing for the corner.
eq((HTML.match(/position:fixed; top:12px; right:12px/g) || []).length, 1,
  'only one fixed panel claims the top-right corner now');

// ═══ 4. the media bar folds, and keeps its controls ═══════════════════
has('function toggleMediaBar()', 'the media bar can be collapsed');
has("localStorage.setItem('kraftedMediaBarCollapsed'", 'the collapsed state is remembered');
has("localStorage.getItem('kraftedMediaBarCollapsed')", 'the collapsed state is restored');
has('#media-bar.collapsed .media-bar-ctrls,', 'collapsing hides the control group');
has('#media-bar.collapsed .media-sep,', 'collapsing hides the separator');
has('#media-bar.collapsed .media-list { display:none; }', 'collapsing hides the media list');
has('#media-bar .media-bar-ctrls { display:flex;', 'the controls are one group');
has('<div class="media-bar-ctrls">', 'the control group exists in the DOM');
has('id="media-bar-toggle"', 'the collapse toggle exists in the DOM');
// "Lots of videos" used to push the buttons off the bar. The list scrolls
// inside a capped width instead, so the controls keep their place.
ruleHas('#media-bar .media-list {', /max-width\s*:\s*55%/, 'the media list is capped at 55%');
ruleHas('#media-bar .media-list {', /overflow-x\s*:\s*auto/, 'the media list still scrolls');
has('onclick="playAllMedia()"', 'Play All survives the restructure');
has('onclick="pauseAllMedia()"', 'Pause All survives the restructure');

// ═══ 5. the strip fits a touch device ═════════════════════════════════
// The readout plus the wheel/zoom controls is wider than a phone viewport.
// Found by scanning for the selector's second occurrence rather than by
// naming a breakpoint: the override lives in the coarse-pointer block
// (max-width:1024px), which covers phones as well as tablets.
(function () {
  const first = HTML.indexOf('#view-status-bar {');
  const second = HTML.indexOf('#view-status-bar {', first + 1);
  ok(second > first, 'the strip has a small-screen override');
  if (second < 0) return;
  const body = HTML.slice(second, HTML.indexOf('}', second));
  ok(/max-width/.test(body), 'the strip is capped on small screens');
  ok(/flex-wrap/.test(body), 'the strip wraps on small screens');
  const media = HTML.lastIndexOf('@media', second);
  ok(media >= 0 && media < second, 'the override sits inside a media query');
  ok(/pointer:\s*coarse/.test(HTML.slice(media, media + 120)),
    'the override targets touch devices, not narrow desktop windows');
})();

// ═══ 6. pitfall one: no second hand-written measurement ═══════════════
// The popover used to measure the media bar itself. Three places measuring the
// same bar is how two of them ended up buried under it.
hasNot('mediaBar.offsetHeight', 'nothing measures the media bar by offsetHeight any more');
has("getPropertyValue('--rail-bottom')", 'the popover reads the shared variable instead');
has("parseFloat(getComputedStyle(document.documentElement)", 'the popover reads it from the root');
// Every observer must call the one function, or the numbers can disagree.
has("new ResizeObserver(function () { _syncBottomBarOffsets(); })", 'one observer callback');
ok(/\['media-bar', 'minimap-panel', 'library-panel', 'view-status-bar'\]/.test(HTML),
  'all four measured panels are observed');

// ═══ 7. the strip really encloses both children ═══════════════════════
// A DOM assertion, not a string one: find where the wrapper's depth returns
// to zero and confirm both widgets fall inside it.
(function () {
  const start = HTML.indexOf('<div id="view-status-bar">');
  ok(start >= 0, 'the status strip wrapper exists');
  eq((HTML.match(/<div id="view-status-bar">/g) || []).length, 1, 'there is exactly one wrapper');
  if (start < 0) return;
  let depth = 0;
  let end = -1;
  const re = /<(\/?)div\b/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(HTML)) !== null) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) { end = m.index; break; }
  }
  ok(end > start, 'the wrapper is closed');
  const status = HTML.indexOf('<div id="status">');
  const zoom = HTML.indexOf('<div id="zoom-step-widget">');
  ok(status > start && status < end, 'the readout is inside the strip');
  ok(zoom > start && zoom < end, 'the wheel/zoom controls are inside the strip');
  ok(status < zoom, 'the readout comes before the controls');
})();

// ═══ 8. the tree still agrees with the recorded version ═══════════════
(function () {
  const sw = fs.readFileSync(path.resolve(ROOT, 'Krafted/docs/sw.js'), 'utf8');
  const title = (HTML.match(/<title>Krafted v([\d.]+)<\/title>/) || [])[1];
  const konst = (HTML.match(/var KRAFTED_VERSION = '([\d.]+)';/) || [])[1];
  const appv = (sw.match(/const APP_VERSION = '([\d.]+)';/) || [])[1];
  eq(title, STATE.current, 'the title matches the recorded current version');
  eq(konst, STATE.current, 'KRAFTED_VERSION matches the recorded current version');
  eq(appv, STATE.current, 'the service worker matches the recorded current version');
  ok(/^\d+\.\d+\.\d+$/.test(STATE.current), 'the recorded version is MAJOR.MINOR.PATCH');
  // This is a MINOR under the policy: the media bar gained a capability
  // (collapsing) and panel positions visibly changed. A patch would be a
  // change the user cannot see.
  ok(STATE.current.split('.')[1] !== '0' || STATE.current.split('.')[0] !== '7',
    'the recorded version is not the pre-policy 7.0.x line');
})();

// ═══ report ═══════════════════════════════════════════════════════════
console.log(`test_v7_2_0.js  (v${STATE.current} — chrome insets: one authority for panel placement)`);
if (fails.length) {
  console.log(`  ${pass} passed, ${fails.length} FAILED`);
  fails.forEach((f) => console.log('    FAIL  ' + f));
  process.exit(1);
} else {
  console.log(`  ALL PASS (${pass} assertions)`);
}
