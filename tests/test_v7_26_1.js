// v7.26.1 / A1-c — proxy <-> original mapping (functional core).
//
// A clip named "<base>_proxy.<ext>" stands in for "<base>.<ext>": the board
// plays the proxy (1080p H.264 decodes in hardware, a 4K master does not) and
// the card remembers which original it stands for. Drop both together and only
// the proxy becomes a card.
//
// Two things are asserted, and the second is the one that bites:
//   1. the naming rules, executed on real filenames;
//   2. SYMMETRY. Item state is copied by hand in four places (undo snapshot,
//      .kpak manifest, board serialize, node writer) and read back in one.
//      Miss one and the flag survives a reload but not an undo — or the other
//      way round. That is 病根①, so the suite counts the copies instead of
//      trusting that anybody remembered.

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(
  process.env.KRAFTED_HTML || path.join(__dirname, '..', '..', 'kraftpub-dev.html'),
  'utf8');

let pass = 0, fail = 0;
function clip(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) return 'undefined';
  return s.length > 120 ? s.slice(0, 120) + '...[' + s.length + ' chars]' : s;
}
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  (got ' + clip(extra) + ')' : '')); }
}
function eq(a, b, label) { ok(a === b, label, a); }
function block(n, fn) {
  console.log('\n' + n);
  try { fn(); } catch (e) { fail++; console.log('  FAIL ' + n + ' threw: ' + (e && e.message)); }
}
function countIn(re, s) { return (s.match(re) || []).length; }
function stripComments(s) {
  return s.replace(/\/\*[\s\S]{0,4000}?\*\//g, '').replace(/(?<![:\\'"])\/\/[^\n]*/g, '');
}
// Rule 20 (no version strings in slice anchors) + rule 21 (the start anchor
// belongs to the code under test).
function slice(a, b, label) {
  const i = HTML.indexOf(a), j = HTML.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('anchor failed: ' + label);
  const s = HTML.slice(i, j);
  if (s.length < 40) throw new Error('slice too short: ' + label);
  if (s.length > 20000) throw new Error('slice suspiciously wide: ' + label);
  return s;
}
// The anchor stops before the value: a mutation that changes the suffix
// would break a slice anchored on the literal itself and report UNPROVEN
// instead of failing (same class of mistake as rule 20's version strings).
const HELPERS = slice('const PROXY_SUFFIX =',
                      'function _handleFileDrop(e, files) {',
                      'the proxy helpers');
const DROP = slice('function _handleFileDrop(e, files) {',
                   '// ==== paste-handler.js ====',
                   '_handleFileDrop');

const api = new Function(HELPERS +
  '\nreturn { proxyBaseName: proxyBaseName, mediaBaseName: mediaBaseName,' +
  ' planProxyPairs: planProxyPairs, SUFFIX: PROXY_SUFFIX };')();

block('1. proxyBaseName — the suffix rule', () => {
  eq(api.SUFFIX, '_proxy', 'the suffix is the one the user picked');
  eq(api.proxyBaseName('shot01_proxy.mp4'), 'shot01', 'the plain case');
  eq(api.proxyBaseName('shot01_PROXY.mp4'), 'shot01', 'case-insensitive');
  eq(api.proxyBaseName('My_Shot_Proxy.mov'), 'My_Shot',
     'a capitalised suffix still matches (the rule is case-insensitive)');
  eq(api.proxyBaseName('a_proxy.mov'), 'a', 'a one-character base');
  eq(api.proxyBaseName('shot01_proxy'), 'shot01', 'no extension at all');

  eq(api.proxyBaseName('shot01.mp4'), null, 'a normal file is not a proxy');
  eq(api.proxyBaseName('proxy.mp4'), null, '"proxy" without the underscore is not a proxy');
  eq(api.proxyBaseName('_proxy.mp4'), null, 'a file that is ONLY the suffix is not a proxy');
  eq(api.proxyBaseName('shot01_proxy_v2.mp4'), null, 'only the exact suffix counts');
  eq(api.proxyBaseName(''), null, 'empty name');
  eq(api.proxyBaseName(null), null, 'null name');
  eq(api.proxyBaseName(undefined), null, 'undefined name');
  eq(api.proxyBaseName(1234), null, 'a non-string does not throw');
});

block('2. mediaBaseName — the match key', () => {
  eq(api.mediaBaseName('shot01.mov'), 'shot01', 'strips the last extension');
  eq(api.mediaBaseName('shot01'), 'shot01', 'no extension leaves it alone');
  eq(api.mediaBaseName('a.b.c'), 'a.b', 'only the last dot is the extension');
  eq(api.mediaBaseName(''), '', 'empty in, empty out');
  // String(null || '') is '', so null degrades to empty rather than throwing.
  // planProxyPairs() guards on falsy names, so '' never reaches a comparison.
  eq(api.mediaBaseName(null), '', 'null degrades to empty, does not throw');
  eq(api.mediaBaseName(undefined), '', 'undefined degrades to empty, does not throw');
});

block('3. planProxyPairs — which files become cards', () => {
  let p = api.planProxyPairs(['shot01.mov', 'shot01_proxy.mp4']);
  eq(p['shot01_proxy.mp4'].isProxy, true, 'the proxy is marked');
  eq(p['shot01_proxy.mp4'].originalName, 'shot01.mov', 'and points at the original');
  eq(p['shot01_proxy.mp4'].skip, false, 'the proxy becomes a card');
  eq(p['shot01.mov'].skip, true, 'the original does NOT become a card');

  p = api.planProxyPairs(['shot01_proxy.mp4']);
  eq(p['shot01_proxy.mp4'].isProxy, true, 'a proxy on its own is still a proxy');
  eq(p['shot01_proxy.mp4'].originalName, null, 'but it has no original to point at');
  eq(p['shot01_proxy.mp4'].skip, false, 'and it still becomes a card');

  p = api.planProxyPairs(['shot01.mov']);
  eq(Object.keys(p).length, 0, 'an unpaired original is left completely alone');

  p = api.planProxyPairs(['a.mov', 'b.mov']);
  eq(Object.keys(p).length, 0, 'no proxies, no plan, no surprises');

  // The extension is exactly what differs, so matching has to ignore it.
  p = api.planProxyPairs(['take01.mov', 'take01_proxy.mp4']);
  eq(p['take01_proxy.mp4'].originalName, 'take01.mov', '.mov original pairs with an .mp4 proxy');

  // Non-strings must not throw — a drop can carry odd entries.
  p = api.planProxyPairs(['x_proxy.mp4', null, undefined, '', 7]);
  eq(p['x_proxy.mp4'].isProxy, true, 'junk entries are ignored, not fatal');

  // Two proxies for one original: both claim it, it still yields one card.
  p = api.planProxyPairs(['s.mov', 's_proxy.mp4', 's_proxy.mov']);
  eq(p['s.mov'].skip, true, 'the original is still skipped');
  eq(p['s_proxy.mp4'].originalName, 's.mov', 'first proxy claims it');
  eq(p['s_proxy.mov'].originalName, 's.mov', 'second proxy claims it too');
});

block('4. every item-copy site carries the flag (symmetry)', () => {
  // Four writers + one reader. Anything less means undo or reload loses it.
  const writers = [
    ['undo snapshot', 'function captureSnapshot() {'],
    ['.kpak manifest', 'function buildManifest() {'],
    ['board serialize', 'function serializeBoard() {'],
  ];
  const isProxyTotal = countIn(/\bisProxy:/g, HTML);
  const origNameTotal = countIn(/\boriginalName:/g, HTML);
  ok(isProxyTotal >= 5, 'isProxy appears in at least 5 places (4 writes + 1 read)', isProxyTotal);
  eq(origNameTotal, isProxyTotal,
     'originalName is written/read exactly as many times as isProxy');

  writers.forEach(function (pair) {
    const i = HTML.indexOf(pair[1]);
    const nxt = HTML.indexOf('\nfunction ', i + 10);
    const body = HTML.slice(i, nxt > 0 ? nxt : i + 20000);
    ok(/\bisProxy:/.test(body), pair[0] + ' writes isProxy');
    ok(/\boriginalName:/.test(body), pair[0] + ' writes originalName');
  });
  ok(/isProxy: it\.isProxy \|\| false/.test(HTML), 'the node writer carries the flag');
  ok(/isProxy: n\.isProxy \|\| false/.test(HTML), 'the load reader restores the flag');
});

block('5. the drop path actually uses the plan', () => {
  const code = stripComments(DROP);
  ok(/planProxyPairs\(/.test(code), '_handleFileDrop calls planProxyPairs');
  ok(/videoFiles = videoFiles\.filter/.test(code),
     'the batch is actually filtered — the pairing is applied, not just computed');
  // The original must be dropped BEFORE any card is made, not after.
  // Compare against the VIDEO card creation, not addImage(): the image chain
  // runs first in this handler, so addImage() appears before the plan.
  ok(code.indexOf('planProxyPairs(') < code.indexOf('processNextVideo'),
     'the plan is applied before any video card is created');
  ok(/let videoFiles = \[\]/.test(HTML), 'videoFiles is reassignable (let, not const)');
  // Silently swallowing a file is the worst failure mode here.
  // Tied to the count, not merely present: a `toast(` that still exists
  // inside an `if (false)` would satisfy a plain presence check while never
  // firing, and silently swallowing a file is the worst failure here.
  ok(/if \(_proxySkipped\.length > 0\)[\s\S]{0,400}toast\(/.test(code),
     'the pairing message fires only when something was actually paired away');
  ok(/isProxy = true/.test(code), 'the surviving card is stamped as a proxy');
  ok(/originalName = /.test(code), 'and remembers its original');
});

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
