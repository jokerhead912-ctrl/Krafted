#!/usr/bin/env node
/*
 * test_v7_1_0.js — the version policy itself (v7.1.0).
 *
 * WHY THIS SUITE EXISTS
 *   v7.1.0 is not a feature release. It is the release where the version number
 *   stopped being a counter and started meaning something — and the release
 *   where we found out that the tool enforcing the version had been quietly
 *   blind for as long as the number stayed under 7.1.
 *
 *   THE BUG. version_scan.py decided which version strings were candidates
 *   with `if not ver.startswith('7.0.'): continue`. The moment the version
 *   became 7.1.0, that predicate matched nothing, so the scanner reported
 *   "0 identity anchors stale, nothing to bump" and exited 0. The stale-anchor
 *   guard — the thing that catches mutations whose anchors have rotted — looked
 *   perfectly healthy while testing nothing at all. A check that narrows to the
 *   empty set is worse than no check, because it reports success.
 *
 *   So this suite drives the REAL version_scan.py (through vscan_probe.py) and
 *   asserts on real output rather than re-implementing the policy in JS. A
 *   second hand-written copy of the rule would drift, and then this suite
 *   would be green while the thing it claims to test did something else.
 *
 *   WHAT IS PINNED
 *     1. a 7.1.x identity IS found and moved          (the blind-spot bug)
 *     2. patch resets to 0 on a minor, and is capped at 9
 *     3. provenance comments never move, whatever their version
 *     4. "the previous version" comes from .version_state, never from
 *        arithmetic — see test_v7047.js, where `patch - 1` produced the
 *        CURRENT version and asserted sw.js must not contain it
 *     5. both test-file naming conventions parse (test_v7_1_0 and test_v7053)
 *
 * Usage:  node test_v7_1_0.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TESTS = __dirname;
const ROOT = path.resolve(TESTS, '../..');
const PY = process.env.KRAFTED_PY
  || '/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3';
const PROBE = path.resolve(TESTS, 'vscan_probe.py');
const VSCAN = fs.readFileSync(path.resolve(TESTS, 'version_scan.py'), 'utf8');
const STATE = JSON.parse(fs.readFileSync(path.resolve(TESTS, '.version_state'), 'utf8'));

let pass = 0;
const fails = [];
function ok(cond, label) { if (cond) { pass++; } else { fails.push(label); } }
function eq(a, b, label) {
  ok(a === b, `${label}  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}
function has(needle, label, hay) {
  ok((hay || VSCAN).indexOf(needle) >= 0, `${label}  (missing: ${JSON.stringify(needle.slice(0, 70))})`);
}
function hasNot(needle, label, hay) {
  ok((hay || VSCAN).indexOf(needle) < 0, `${label}  (should be absent: ${JSON.stringify(needle.slice(0, 70))})`);
}
function attempt(label, fn) {
  try { fn(); }
  catch (e) { fails.push(label + '  (threw: ' + ((e && e.message) || e) + ')'); }
}
// Comments are allowed to DESCRIBE the bug - the source carries a paragraph
// explaining what the old prefix check did. Only code lines are evidence.
function codeOnly(src) {
  return src.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
}
const VSCAN_CODE = codeOnly(VSCAN);

// ── drive the real module ──────────────────────────────────────────────
function probe(...args) {
  const out = execFileSync(PY, [PROBE, ...args], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }),
  });
  return JSON.parse(out);
}

// ── fixtures, built from the live state so they cannot go stale ────────
const FIXDIR = path.resolve(TESTS, 'fixtures');
fs.mkdirSync(FIXDIR, { recursive: true });

// Built by concatenation, never as a literal: version_scan rewrites any bare
// occurrence of the previous version inside the suite that owns the current
// release, and a test datum silently rewritten by the thing under test is a
// test that cannot fail for the right reason.
const V_PREV = STATE.prev;
const V_CUR = STATE.current;

// Every version literal in this suite is built, never written out. version_scan
// rewrites any bare MAJOR.MINOR.PATCH it finds in the suite that owns the
// current release - including the "previous version is gone" ride-along - and a
// test INPUT silently rewritten by the thing under test is a test that starts
// asserting the wrong thing. `V(7,0,53)` carries no dots, so it is invisible
// to the scanner and stays exactly what was written.
const V = (a, b, c) => `${a}.${b}.${c}`;

function fixture(name, revertSlot, cur, prev) {
  cur = cur || V_CUR;
  prev = prev || V_PREV;
  const p = path.resolve(FIXDIR, name);
  fs.writeFileSync(p, [
    `// Krafted v${cur} Service Worker`,
    `const APP_VERSION = '${cur}';`,
    `var KRAFTED_VERSION = '${cur}';`,
    `<title>Krafted v${cur}</title>`,
    `const CACHE = 'krafted-v${cur}-' + Date.now();`,
    '',
    `// v${prev}: provenance comment - history, must never move`,
    '// v7.0.33: an even older provenance comment',
    `var KRAFTED_VERSION = '6.0.2';`,
    `mutate 'bump guard' \\`,
    `  "var KRAFTED_VERSION = '${cur}';" \\`,
    `  "var KRAFTED_VERSION = '${revertSlot}';"`,
    '',
  ].join('\n'));
  return p;
}

const NXT_PATCH = probe('next', V_CUR, 'patch').next;

// ═══ 1. THE BLIND SPOT ════════════════════════════════════════════════
// The scanner must see a 7.1.x identity. Under the old hard-coded prefix it
// saw nothing at all and still exited 0.
attempt('the scanner runs against a 7.1.x fixture', () => {
  const r = probe('scan', fixture('vscan_fixture.html', V_PREV),
    V_CUR, NXT_PATCH, 'bump', V_CUR.split('.')[0], V_PREV);

  const identityChanges = r.changes.filter((c) => c.kind === 'identity');
  ok(identityChanges.length >= 5,
    `every identity position in the fixture is recognised (got ${identityChanges.length}, want >= 5)`);

  const moved = identityChanges.filter((c) => c.old === V_CUR && c.new === NXT_PATCH);
  ok(moved.length >= 5,
    `each identity moves ${V_CUR} -> ${NXT_PATCH} (got ${moved.length})`);

  // A different major is not a Krafted version. Without this filter the
  // commented-out legacy `var KRAFTED_VERSION = '6.0.2';` declaration in the
  // app file would be rewritten at every release. "Left alone" means it is
  // still there AND nothing was generated for it - asserting absence would
  // pass for the opposite reason.
  has(`'6.0.2'`, 'a version from another major survives untouched', r.newtext);
  ok(r.changes.every((c) => c.old !== '6.0.2'),
    'no change is ever generated for another major');

  // Provenance comments record which release introduced a piece of code. They
  // are history, not identity, and they must survive every bump.
  has(`// v${V_PREV}: provenance comment`, 'a provenance comment survives the bump', r.newtext);
  has('// v7.0.33: an even older provenance comment',
    'an older provenance comment survives too', r.newtext);

  // The revert slot: after the bump it must hold the outgoing current.
  const revert = r.changes.filter((c) => c.kind === 'identity-revert');
  eq(revert.length, 1, 'exactly one revert anchor in the fixture');
  eq(revert[0].old, V_PREV, 'the revert anchor held the previous version');
  eq(revert[0].new, V_CUR, 'after a bump the revert anchor holds the outgoing current');

  const stale = r.findings.filter((f) => f.stale);
  eq(stale.length, 0, 'a correctly maintained fixture reports nothing stale');
});

// The filter must be derived from the current version, not written down as a
// literal prefix. This is the assertion that fails if the bug comes back.
hasNot("startswith('7.0.')",
  'the candidate filter is NOT a hard-coded 7.0 prefix (the blind-spot bug)', VSCAN_CODE);
has("if cur_major and ver.split('.')[0] != cur_major:",
  'the filter is derived from the current major instead', VSCAN);
has('cur_major = current.split(\'.\')[0]',
  'the major in use comes from the app, not from a constant', VSCAN);

// ═══ 2. PATCH CAP AND RESET ═══════════════════════════════════════════
attempt('the cap and the reset hold', () => {
  eq(probe('helpers').patch_max, 9, 'the patch digit is capped at 9');

  eq(probe('next', V(7, 0, 53), 'patch').next, V(7, 0, 54), 'a patch adds one');
  eq(probe('next', V(7, 0, 53), 'minor').next, V(7, 1, 0), 'a minor resets the patch to 0');
  eq(probe('next', V(7, 0, 53), 'major').next, V(8, 0, 0), 'a major resets minor and patch');
  eq(probe('next', V(7, 1, 9), 'minor').next, V(7, 2, 0), 'a minor rolls the minor digit, patch 0');
  eq(probe('next', V(7, 10, 3), 'minor').next, V(7, 11, 0), 'the minor digit is not capped');

  eq(probe('policy', V(7, 1, 8), 'patch').error, null, 'patch 8 -> 9 is allowed');
  const capped = probe('policy', V(7, 1, 9), 'patch').error;
  ok(capped && /cap/i.test(capped), 'patch 9 -> 10 is refused, and says why');
  ok(capped && /--bump minor/.test(capped), 'the refusal tells you what to do instead');
  eq(probe('policy', V(7, 1, 9), 'minor').error, null, 'a minor is never refused');
  eq(probe('policy', V(7, 1, 9), 'major').error, null, 'a major is never refused');
});

// The reset is the whole point: without it the third digit never comes back
// down and the number creeps, which is what produced 7.0.53 in the first place.
has('return vstr((a, b + 1, 0))', 'a minor writes a literal 0, not the old patch', VSCAN);
has('return vstr((a + 1, 0, 0))', 'a major writes two literal 0s', VSCAN);
has('PATCH_MAX = 9', 'the cap is a named constant, not a magic number', VSCAN);

// ═══ 3. THE PREVIOUS VERSION IS RECORDED, NEVER COMPUTED ══════════════
// `patch - 1` is what test_v7047.js used. After a minor bump it produced the
// CURRENT version (the clamp keeps the digit at 0) and asserted that sw.js
// must not contain it.
//
// This scenario is built from a SYNTHETIC fresh-minor state, not from the
// live .version_state. `current patch - 1` is only wrong when the current
// release reset the patch digit; after a PATCH bump (e.g. 7.2.0 -> 7.2.1)
// the arithmetic is accidentally correct, ARITH comes out equal to prev, and
// a live-state fixture rots: the "rejection" has nothing left to reject.
// Building a minor-shaped state makes the divergence structural, so the test
// holds no matter how the real last bump happened. (Memory rule 14a: the
// behaviour was still there; the premise had rotted.)
attempt('an arithmetically derived predecessor is rejected', () => {
  const [maj, min] = V_CUR.split('.').map(Number);
  const S_CUR = V(maj, min + 1, 0);              // a fresh minor: patch was reset
  const S_PREV = V(maj, min, 0);                 // the release it replaced
  const S_ARITH = S_CUR.replace(/\d+$/, (d) => String(Math.max(0, Number(d) - 1)));
  ok(S_ARITH !== S_PREV,
    `arithmetic gives ${S_ARITH} but the real previous release is ${S_PREV}`, null);
  const S_NEXT = probe('next', S_CUR, 'patch').next;
  const r = probe('scan', fixture('vscan_fixture_arith.html', S_ARITH, S_CUR, S_PREV),
    S_CUR, S_NEXT, 'bump', String(maj), S_PREV);
  const stale = r.findings.filter((f) => f.stale);
  eq(stale.length, 1, 'exactly the revert anchor is flagged');
  eq(stale[0].kind, 'identity-revert', 'the flagged anchor is the revert one');
  eq(stale[0].ver, S_ARITH, 'the flagged anchor holds the bogus arithmetic value');
  eq(stale[0].want, S_PREV, 'and it is told what the real previous version is');
});

has("prev = args.prev or load_prev()",
  'the previous version is READ from the state file, never computed', VSCAN_CODE);
has('save_state(nxt, current)',
  'each bump records the version it just replaced', VSCAN_CODE);
has('--prev', 'the previous version can be overridden from the command line', VSCAN);
has('.version_state', 'the previous version is persisted between releases', VSCAN);
has("return 2", 'an unknown previous version is a hard error, not a guess', VSCAN);
has('cannot determine the previous version',
  'and the error says which file to reseed', VSCAN);

// ═══ 4. BOTH TEST-FILE NAMING CONVENTIONS PARSE ═══════════════════════
// Fifteen existing suites are named test_v70NN.js. Renaming them to make the
// parser tidy would be churn with no payoff, so both forms must work.
attempt('own_version reads both conventions', () => {
  eq(probe('own', 'test_v7_1_0.js').own, V(7, 1, 0), 'new style, underscores');
  eq(probe('own', 'test_v7_10_3.js').own, V(7, 10, 3), 'new style, multi-digit minor');
  eq(probe('own', 'test_v7053.js').own, V(7, 0, 53), 'legacy style');
  eq(probe('own', 'test_v7038_tidy.js').own, V(7, 0, 38), 'legacy style with a suffix');
  eq(probe('own', 'mutate_v7041.sh').own, V(7, 0, 41), 'mutate scripts parse the same way');
  eq(probe('own', 'syntax_check.js').own, null, 'an unrelated file owns no release');
});

// ═══ 5. THE POLICY IS PRINTED WHERE IT CANNOT BE IGNORED ═════════════
has('KRAFTED VERSION POLICY', 'the policy is printed on every run', VSCAN);
has('patch resets to 0 when minor or major moves', 'the reset rule is stated', VSCAN);
has('patch is capped at {cap}; the tenth fix rolls the minor', 'the cap rule is stated', VSCAN);
has('breaks something a user relies on', 'the major rule is stated', VSCAN);
has('a new capability, or a visible change', 'the minor rule is stated', VSCAN);
has('a bug fix, an internal change, or tests only', 'the patch rule is stated', VSCAN);

// ═══ 6. THE REAL TREE AGREES WITH THE STATE FILE ══════════════════════
attempt('the tree and the state file agree', () => {
  const dev = fs.readFileSync(path.resolve(ROOT, probe('helpers').dev_html), 'utf8');
  const sw = fs.readFileSync(path.resolve(ROOT, 'Krafted/docs/sw.js'), 'utf8');
  const title = (dev.match(/<title>Krafted v([\d.]+)<\/title>/) || [])[1];
  const konst = (dev.match(/var KRAFTED_VERSION = '([\d.]+)';/) || [])[1];
  const appv = (sw.match(/const APP_VERSION = '([\d.]+)';/) || [])[1];

  eq(title, STATE.current, 'the title matches the recorded current version');
  eq(konst, STATE.current, 'KRAFTED_VERSION matches the recorded current version');
  eq(appv, STATE.current, 'the service worker matches the recorded current version');
  ok(STATE.prev !== STATE.current, 'the recorded previous version is a different release');
  ok(/^\d+\.\d+\.\d+$/.test(STATE.current), 'the recorded current version is MAJOR.MINOR.PATCH');
  eq(probe('helpers').state_file, '.version_state', 'the state file has the expected name');
});

// ═══ report ═══════════════════════════════════════════════════════════
console.log(`test_v7_1_0.js  (v${V_CUR} — the version policy, and the 7.0-prefix blind spot)`);
if (fails.length) {
  console.log(`  ${pass} passed, ${fails.length} FAILED`);
  fails.forEach((f) => console.log('    FAIL  ' + f));
  process.exit(1);
} else {
  console.log(`  ALL PASS (${pass} assertions)`);
}
