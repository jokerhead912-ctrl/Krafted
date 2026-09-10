#!/usr/bin/env node
/*
 * test_v7_14_0.js — v7.14.0: collapsible toolbar. The 23-button top bar can
 * hide behind a centred pill so it stops covering the canvas.
 *
 *   - A collapse button (chevron-up, icon-only) at the END of #toolbar calls
 *     setToolbarCollapsed(true); the bar gets .collapsed (display:none) and a
 *     pill (#toolbar-expand, hamburger icon) appears at top centre. Clicking
 *     the pill calls setToolbarCollapsed(false).
 *   - The state persists in localStorage('krafted_toolbar_collapsed') and is
 *     restored on load — same pattern as krafted_props_collapsed /
 *     krafted_library_collapsed / krafted_minimap_collapsed.
 *   - On mobile (coarse pointer) the toolbar lives at the BOTTOM, so the pill
 *     has a media-query override pinning it to the bottom too.
 *   - Both buttons are icon-only: no .tb-label, so no I18N map entry is
 *     needed (toggleLang only translates mapped text nodes).
 *
 * Section 2 EXECUTES setToolbarCollapsed() and the restore IIFE (the v7.4.0
 * lesson: an anchor proves the code exists, not that it runs).
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
function hasIn(hay, needle, m) { ok(hay && hay.indexOf(needle) >= 0, m + '  (missing: ' + JSON.stringify(needle.slice(0, 90)) + ')'); }
function lacksIn(hay, needle, m) { ok(hay && hay.indexOf(needle) < 0, m + '  (should be absent: ' + JSON.stringify(needle.slice(0, 60)) + ')'); }
function count(needle, n, m) {
  let c = 0, i = -1;
  while ((i = HTML.indexOf(needle, i + 1)) >= 0) c++;
  eq(c, n, m + '  (found ' + c + ', want ' + n + ')');
}
// §6i: assert against one rule's body, never a bare selector (the string also
// appears in the HTML element and in JS getElementById calls).
function ruleFor(selector, startAt) {
  const i = HTML.indexOf(selector, startAt || 0);
  if (i < 0) return null;
  const open = HTML.indexOf('{', i), close = HTML.indexOf('}', open);
  return (open < 0 || close < 0) ? null : HTML.slice(open + 1, close);
}

// ═══ 0. version identities agree (derived, survives bumps) ═════════════
console.log('\n[0] version identities agree');
const VER = (HTML.match(/var KRAFTED_VERSION = '([\d.]+)';/) || [])[1];
ok(!!VER, 'dev declares KRAFTED_VERSION');
has('<title>Krafted v' + VER + '</title>', 'title matches KRAFTED_VERSION');

// ═══ 1. structure ═══════════════════════════════════════════════════════
console.log('\n[1] the pieces exist, and there is exactly one of each');
count('function setToolbarCollapsed(collapsed) {', 1, 'one setToolbarCollapsed()');
count('<button id="toolbar-expand" onclick="setToolbarCollapsed(false)"', 1, 'one expand pill, wired to expand');
count('<button onclick="setToolbarCollapsed(true)" id="btn-toolbar-collapse"', 1, 'one collapse button, wired to collapse');
count("localStorage.setItem('krafted_toolbar_collapsed'", 1, 'state is persisted under one key');
count("localStorage.getItem('krafted_toolbar_collapsed') === '1'", 1, 'one restore-on-load read');
count('#toolbar.collapsed { display:none; }', 1, 'the collapsed state hides the bar');
count('#toolbar-expand.show { display:flex; }', 1, 'the pill appears via .show');

// Placement: the collapse button lives INSIDE #toolbar (after Screen); the
// pill lives OUTSIDE it (a hidden bar cannot hold its own restore button).
const iTbOpen = HTML.indexOf('<div id="toolbar">');
const iCollapse = HTML.indexOf('id="btn-toolbar-collapse"');
const iPill = HTML.indexOf('<button id="toolbar-expand"');
const iProps = HTML.indexOf('<!-- PROPERTIES PANEL -->');
ok(iTbOpen > 0 && iCollapse > iTbOpen, 'the collapse button is inside #toolbar');
ok(iPill > iCollapse, 'the pill sits after the toolbar markup');
ok(iProps > 0 && iPill < iProps, 'the pill lands before the properties panel');

// Both controls are icon-only — no .tb-label, so nothing to add to I18N.
const collapseBtn = HTML.slice(HTML.indexOf('<button onclick="setToolbarCollapsed(true)"'), iCollapse + 40);
lacksIn(collapseBtn, 'tb-label', 'the collapse button is icon-only (no I18N entry needed)');
const pillBtn = HTML.slice(iPill, HTML.indexOf('</button>', iPill) + 9);
lacksIn(pillBtn, 'tb-label', 'the pill is icon-only (no I18N entry needed)');

// ═══ 2. CSS rules say the right things ══════════════════════════════════
console.log('\n[2] CSS: hidden by default, revealed by .show, mobile override at the bottom');
const rCollapsed = ruleFor('#toolbar.collapsed');
hasIn(rCollapsed, 'display:none', 'collapsed toolbar is display:none');
const rPill = ruleFor('#toolbar-expand { position:fixed');
hasIn(rPill, 'position:fixed', 'pill is fixed');
hasIn(rPill, 'top:12px', 'pill sits where the toolbar sat');
hasIn(rPill, 'left:50%', 'pill is horizontally centred');
hasIn(rPill, 'display:none', 'pill is hidden by default');
hasIn(rPill, 'z-index:9999999', 'pill shares the toolbar z-index');
const rShow = ruleFor('#toolbar-expand.show');
hasIn(rShow, 'display:flex', '.show reveals the pill');
// Mobile: the toolbar moves to the bottom (coarse pointer), so must the pill.
const iMedia = HTML.indexOf('(pointer: coarse)');
ok(iMedia > 0, 'found the coarse-pointer media query');
const iMobilePill = HTML.indexOf('#toolbar-expand {', iMedia);
ok(iMobilePill > 0, 'the pill has a mobile override');
const rMobilePill = ruleFor('#toolbar-expand {', iMedia);
hasIn(rMobilePill, 'bottom: 8px !important', 'mobile pill follows the toolbar to the bottom');
hasIn(rMobilePill, 'top: auto !important', 'mobile pill unpins from the top');

// ═══ 3. EXECUTE setToolbarCollapsed + the restore IIFE ══════════════════
console.log('\n[3] execution: toggle, persistence, restore, guards');
const A = 'function setToolbarCollapsed(collapsed) {';
const B = '// v6.1.8s: Implement missing toggleProps function';
const a = HTML.indexOf(A);
const b = HTML.indexOf(B, a);
ok(a > 0 && b > a, 'found the toolbar-collapse section to execute');
const CODE = HTML.slice(a, b);

function makeEl() {
  const classes = new Set();
  return {
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c); else classes.delete(c);
        return on;
      },
      contains: (c) => classes.has(c),
    },
    _has: (c) => classes.has(c),
  };
}
// stored: initial localStorage contents; nullEls: ids getElementById misses;
// throwOnSet: localStorage.setItem throws (private mode).
function boot(opts) {
  const store = Object.assign({}, (opts && opts.stored) || {});
  const writes = [];
  const els = { toolbar: makeEl(), 'toolbar-expand': makeEl() };
  const nullEls = (opts && opts.nullEls) || [];
  const documentStub = { getElementById: (id) => nullEls.indexOf(id) >= 0 ? null : (els[id] || null) };
  const lsStub = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { if (opts && opts.throwOnSet) throw new Error('denied'); writes.push([k, v]); store[k] = v; },
  };
  const api = new Function('document', 'localStorage',
    CODE + '\nreturn { setToolbarCollapsed: setToolbarCollapsed };')(documentStub, lsStub);
  return { els, writes, store, api };
}

// 3a. restore: stored '1' re-hides the bar and shows the pill on load.
let env = boot({ stored: { krafted_toolbar_collapsed: '1' } });
ok(env.els.toolbar._has('collapsed'), 'restore: stored 1 re-collapses the toolbar on load');
ok(env.els['toolbar-expand']._has('show'), 'restore: stored 1 re-shows the pill on load');

// 3b. restore: nothing stored -> the bar starts expanded, pill hidden.
env = boot({});
ok(!env.els.toolbar._has('collapsed'), 'restore: empty storage starts expanded');
ok(!env.els['toolbar-expand']._has('show'), 'restore: empty storage hides the pill');

// 3c. collapse: bar hides, pill appears, state persisted.
env = boot({});
env.api.setToolbarCollapsed(true);
ok(env.els.toolbar._has('collapsed'), 'collapse: toolbar gets .collapsed');
ok(env.els['toolbar-expand']._has('show'), 'collapse: pill gets .show');
eq(env.writes.length, 1, 'collapse: one storage write');
eq(env.writes[0] && env.writes[0][0], 'krafted_toolbar_collapsed', 'collapse: persisted under the agreed key');
eq(env.writes[0] && env.writes[0][1], '1', 'collapse: persisted as 1');

// 3d. idempotent: collapsing twice must NOT re-open (force arg, not a bare toggle).
env.api.setToolbarCollapsed(true);
ok(env.els.toolbar._has('collapsed'), 'a second collapse call keeps the bar hidden');
ok(env.els['toolbar-expand']._has('show'), 'a second collapse call keeps the pill shown');

// 3e. expand: bar returns, pill hides, state persisted as 0.
env.api.setToolbarCollapsed(false);
ok(!env.els.toolbar._has('collapsed'), 'expand: toolbar loses .collapsed');
ok(!env.els['toolbar-expand']._has('show'), 'expand: pill loses .show');
eq(env.store.krafted_toolbar_collapsed, '0', 'expand: persisted as 0');

// 3f. guard: a missing element must not throw and must not persist.
env = boot({ nullEls: ['toolbar'] });
let threw = false;
try { env.api.setToolbarCollapsed(true); } catch (e) { threw = true; }
ok(!threw, 'a missing toolbar element does not throw');
eq(env.writes.length, 0, 'a missing toolbar element writes nothing');

// 3g. storage denial is swallowed; the UI still toggles.
env = boot({ throwOnSet: true });
threw = false;
try { env.api.setToolbarCollapsed(true); } catch (e) { threw = true; }
ok(!threw, 'a throwing localStorage does not break the toggle');
ok(env.els.toolbar._has('collapsed'), 'the UI still collapses when storage is denied');

console.log('\n' + (fail ? 'FAILURES: ' + fail + ' (passed ' + pass + ')' : 'ALL PASS (' + pass + ' assertions)'));
if (fail) { console.log(fails.map((f) => '  - ' + f).join('\n')); process.exit(1); }
