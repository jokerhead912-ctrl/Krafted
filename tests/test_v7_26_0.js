// v7.26.0 / A3-c — the concurrent-video cap is a setting, not a constant.
//
// It was `var MAX_CONCURRENT_VIDEOS = 4;`, read in five places. Two problems:
//   1. 4 is a guess about the machine. The comment right above it says
//      hardware decoders cope with 4-8 and drop to 2-3 with a CSS filter, so
//      the one number that is right depends on hardware the app cannot see.
//   2. It was five copies of one decision waiting for a sixth.
// Now: one persisted setting, one accessor that clamps it, one UI control.
// Default 6 (the middle of the documented 4-8 range) -- the user asked for 6.
//
// What is asserted: the accessor's clamping (executed, not grepped), that no
// bare read site survived, that the UI's min/max cannot drift from the
// constants, and that the widget really clamps and persists (ruke 19: run it).

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

// Rule 20 (no version strings in slice anchors) + rule 21 (the start anchor
// belongs to the code under test): both are unique declaration/signature text.
function slice(a, b, label) {
  const i = HTML.indexOf(a), j = HTML.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('anchor failed: ' + label);
  const s = HTML.slice(i, j);
  if (s.length < 40) throw new Error('slice too short: ' + label);
  if (s.length > 4000) throw new Error('slice suspiciously wide: ' + label);
  return s;
}
const ACCESSOR = slice('function maxConcurrentVideos() {',
                       'function _itemForMediaEl(v) {',
                       'maxConcurrentVideos accessor');
const WIDGET = slice('(function _initMaxVideosWidget(){',
                     '(function _initZoomStepWidget(){',
                     'max videos widget');
const BUDGET = slice('function _enforceVideoBudget(keepItem) {',
                     '// User-initiated play.',
                     'the budget');

block('1. the constants', () => {
  const def = HTML.match(/(?:var|const) DEFAULT_MAX_CONCURRENT_VIDEOS = (\d+);/);
  const min = HTML.match(/(?:var|const) MAX_CONCURRENT_VIDEOS_MIN = (\d+);/);
  const max = HTML.match(/(?:var|const) MAX_CONCURRENT_VIDEOS_MAX = (\d+);/);
  ok(def !== null, 'DEFAULT_MAX_CONCURRENT_VIDEOS is declared');
  // The ratchet counts `var` declarations; these must not add to it.
  ok(/const DEFAULT_MAX_CONCURRENT_VIDEOS = 6;/.test(HTML), 'the default is a const, not a var');
  ok(min !== null, 'MAX_CONCURRENT_VIDEOS_MIN is declared');
  ok(max !== null, 'MAX_CONCURRENT_VIDEOS_MAX is declared');
  if (!def || !min || !max) return;
  eq(Number(def[1]), 6, 'the default the user asked for is 6');
  const lo = Number(min[1]), hi = Number(max[1]), d = Number(def[1]);
  ok(d >= lo && d <= hi, 'the default is inside the clamp range', d + ' not in [' + lo + ',' + hi + ']');
  ok(lo >= 1, 'the floor is at least 1 (0 would pause everything on play)', lo);
  // rule 12: a gate that narrows to nothing is worse than no gate.
  ok(hi > lo, 'the range is not degenerate', lo + '..' + hi);
});

block('2. the accessor actually clamps (executed)', () => {
  const api = new Function('state', 'DEFAULT_MAX_CONCURRENT_VIDEOS',
    'MAX_CONCURRENT_VIDEOS_MIN', 'MAX_CONCURRENT_VIDEOS_MAX',
    ACCESSOR + '\nreturn maxConcurrentVideos;')(
    {}, 6, 1, 12);
  // The closure captured `state` -- but `state` is looked up at call time, so
  // build a version whose `state` object we can mutate.
  const st = {};
  const fn = new Function('state', 'DEFAULT_MAX_CONCURRENT_VIDEOS',
    'MAX_CONCURRENT_VIDEOS_MIN', 'MAX_CONCURRENT_VIDEOS_MAX',
    ACCESSOR + '\nreturn maxConcurrentVideos;')(
    st, 6, 1, 12);

  st.maxConcurrentVideos = 6;   eq(fn(), 6, '6 -> 6');
  st.maxConcurrentVideos = 1;   eq(fn(), 1, '1 -> 1 (floor honoured)');
  st.maxConcurrentVideos = 12;  eq(fn(), 12, '12 -> 12 (ceiling honoured)');
  st.maxConcurrentVideos = 0;   eq(fn(), 1, '0 clamps up to 1 — never "pause on play"');
  st.maxConcurrentVideos = -5;  eq(fn(), 1, 'negative clamps to 1');
  st.maxConcurrentVideos = 99;  eq(fn(), 12, '99 clamps down to 12');
  st.maxConcurrentVideos = '4'; eq(fn(), 4, 'a string from storage still parses');
  st.maxConcurrentVideos = 'abc'; eq(fn(), 6, 'garbage falls back to the default');
  st.maxConcurrentVideos = NaN; eq(fn(), 6, 'NaN falls back to the default');
  delete st.maxConcurrentVideos; eq(fn(), 6, 'missing key falls back to the default');
  ok(api !== undefined, 'the accessor is a value (not a thrown definition)');
});

// Comments must be stripped before any "does this call X" assertion. The
// v7.0.33 comment inside playAllMedia literally names maxConcurrentVideos(),
// so a naive regex stays green after the real call is replaced by a literal --
// that hole is exactly why this helper exists (a comment that keeps a dead
// test alive is 病根② with extra steps).
function stripComments(s) {
  return s.replace(/\/\*[\s\S]{0,4000}?\*\//g, '').replace(/(?<![:\\'"])\/\/[^\n]*/g, '');
}

block('3. no bare read site survived', () => {
  // The old constant name may only survive as part of the three declared
  // names. Anything else is a read that forgot the accessor.
  const scrubbed = HTML
    .split('DEFAULT_MAX_CONCURRENT_VIDEOS').join('')
    .split('MAX_CONCURRENT_VIDEOS_MIN').join('')
    .split('MAX_CONCURRENT_VIDEOS_MAX').join('');
  eq(countIn(/MAX_CONCURRENT_VIDEOS/g, scrubbed), 0,
     'every read goes through maxConcurrentVideos()');

  // And the read sites that matter really call it — comments stripped.
  const budgetCode = stripComments(BUDGET);
  ok(/maxConcurrentVideos\(\)/.test(budgetCode), '_enforceVideoBudget calls the accessor');
  eq(countIn(/maxConcurrentVideos\(\)/g, budgetCode), 2,
     'the budget asks twice (early-out + how many to evict)');
  const playAllCode = stripComments(slice('function playAllMedia() {',
                                          '  // Unfreeze GIFs',
                                          'playAllMedia'));
  ok(/maxConcurrentVideos\(\)/.test(playAllCode), 'playAllMedia calls the accessor');
  // Belt and braces: the old literal must not be sitting in either function.
  ok(!/[<<=]\s*4\b/.test(budgetCode), 'no bare 4 left in the budget');
  ok(!/<\s*4\b/.test(playAllCode), 'no bare 4 left in playAllMedia');
});

block('4. the UI control cannot drift from the constants', () => {
  const m = HTML.match(/<input id="max-videos-input" type="number" min="(\d+)" max="(\d+)"/);
  ok(m !== null, 'the max-videos input exists in the markup');
  if (!m) return;
  const minM = Number(HTML.match(/(?:var|const) MAX_CONCURRENT_VIDEOS_MIN = (\d+);/)[1]);
  const maxM = Number(HTML.match(/(?:var|const) MAX_CONCURRENT_VIDEOS_MAX = (\d+);/)[1]);
  eq(Number(m[1]), minM, 'input min matches MAX_CONCURRENT_VIDEOS_MIN');
  eq(Number(m[2]), maxM, 'input max matches MAX_CONCURRENT_VIDEOS_MAX');
});

block('5. the widget clamps and persists (executed)', () => {
  // Two SEPARATE sinks: the widget writes to both localStorage and
  // KraftedStorage. Sharing one object here would let either write satisfy
  // the assertion, so removing one of them stayed green — a hole.
  const lsStored = {};
  const idbStored = {};
  const handlers = {};
  const input = {
    value: '',
    addEventListener: function (ev, fn) { handlers[ev] = fn; }
  };
  const st = { maxConcurrentVideos: 6 };
  const toasts = [];
  const doc = { getElementById: function (id) { return id === 'max-videos-input' ? input : null; } };
  const store = { setItem: function (k, v) { idbStored[k] = v; return { catch: function () {} }; } };

  new Function('document', 'state', 'localStorage', 'window', 'toast', '_isZhUI',
    'MAX_CONCURRENT_VIDEOS_MIN', 'MAX_CONCURRENT_VIDEOS_MAX',
    WIDGET + '\nreturn 1;')(
    doc, st, { setItem: function (k, v) { lsStored[k] = v; } },
    { KraftedStorage: store },
    function (m) { toasts.push(m); }, function () { return false; },
    1, 12);

  eq(input.value, '6', 'the widget seeds the input from state');
  ok(typeof handlers.change === 'function', 'the widget binds a change handler');

  function type(v) { handlers.change({ target: { value: String(v) } }); }

  type(8);   eq(st.maxConcurrentVideos, 8, '8 accepted');
  eq(input.value, '8', 'the input is rewritten to the accepted value');
  eq(lsStored['krafted_max_videos'], '8', 'persisted to localStorage');
  eq(idbStored['krafted_max_videos'], '8', 'persisted through KraftedStorage too');

  type(0);   eq(st.maxConcurrentVideos, 1, '0 clamps to 1');
  eq(input.value, '1', 'the input shows the clamped value, not what was typed');
  const afterClamp = toasts.length;
  type(999); eq(st.maxConcurrentVideos, 12, '999 clamps to 12');

  // A rejected value must NOT toast: it changes nothing, and telling the user
  // "set to 12" when they typed garbage is worse than silence. It still
  // restores the input, which is the visible feedback.
  const beforeJunk = toasts.length;
  type('abc');
  eq(st.maxConcurrentVideos, 12, 'garbage leaves the last good value');
  eq(input.value, '12', 'the input still shows a legal value');
  eq(toasts.length, beforeJunk, 'a rejected value does not toast');
  ok(toasts.length === 3, 'each of the 3 accepted changes toasted once', toasts.length);
  ok(afterClamp > 0, 'a clamped (not merely echoed) value still toasts');
});

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
