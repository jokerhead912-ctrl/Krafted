// v7.25.3 — drop every backdrop-filter while a video is decoding.
//
// Why this ships even though the local measurement came back flat:
//   diag_backdrop_cost_v7_25_3.js  (blur isolated, animated backdrop)  -0.1% fps
//   diag_video_budget_v7_25_3.js   (4-10 videos decoding)     -0.0 / 2.8 / 0.8%
// Both inside the noise floor, on a box that rasterises with SwiftShader and
// no GPU. The effect is documented by WebKit / web.dev as an extra compositor
// pass; this machine is the one configuration that cannot show it. So the
// change is cheap insurance, and the comment in the source says so.
//
// Two things are asserted here, and the second is the one that matters:
//   1. the toggle runs and computes the right answer (rule 19: executed, not
//      merely present);
//   2. a DRIFT GATE — every selector in the file that owns a blur is listed in
//      the override. Add a frosted panel in six months and this goes red
//      (病根⑫: a diagnostic list nobody maintains quietly starts lying).

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
// belongs to the function under test): `function mediaPlayingCount() {` is
// unique and the slice ends on the line that follows the block in the source.
function slice(a, b, label) {
  const i = HTML.indexOf(a), j = HTML.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('anchor failed: ' + label);
  const s = HTML.slice(i, j);
  if (s.length < 40) throw new Error('slice too short: ' + label);
  if (s.length > 4000) throw new Error('slice suspiciously wide: ' + label);
  return s;
}
const CODE = slice('function mediaPlayingCount() {',
                   'var MAX_CONCURRENT_VIDEOS = 4;',
                   'mediaPlayingCount + syncMediaPlayingClass + listeners');

// ── 1. the drift gate: every blurred selector is covered ──────────────────
// Walk back from each blur declaration to the `{` that opens its rule and take
// whatever sits in front of it as the selector. Handles rules nested inside
// @media by taking the text after the innermost `{`.
function selectorFor(idx) {
  const head = HTML.slice(0, idx);
  const open = head.lastIndexOf('{');
  if (open < 0) return null;
  let start = Math.max(head.lastIndexOf('}', open), head.lastIndexOf('{', open - 1));
  let sel = head.slice(start + 1, open);
  const nested = sel.lastIndexOf('{');
  if (nested >= 0) sel = sel.slice(nested + 1);   // inside an @media block
  return sel.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim();
}

function blurredSelectors() {
  const out = [];
  const re = /(?:-webkit-)?backdrop-filter:\s*([^;}]+)/g;
  let m;
  while ((m = re.exec(HTML)) !== null) {
    if (m[1].trim() === 'none') continue;
    // One rule can own several comma-separated selectors (`#mobile-toolbar-left,
    // #mobile-toolbar-right` does). Each has to be covered on its own.
    selectorFor(m.index).split(',').forEach(part => {
      const sel = part.replace(/\s+/g, ' ').trim();
      if (sel && out.indexOf(sel) < 0) out.push(sel);
    });
  }
  return out;
}

function overrideSelectors() {
  const i = HTML.indexOf('body.media-playing .media-anno-toolbar,');
  if (i < 0) return null;
  const open = HTML.indexOf('{', i);
  const close = HTML.indexOf('}', open);
  if (open < 0 || close < 0) return null;
  return {
    list: HTML.slice(i, open).split(',').map(s => s.replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\s+/g, ' ').trim()).filter(Boolean),
    body: HTML.slice(open + 1, close)
  };
}

block('1. the drift gate', () => {
  const blurred = blurredSelectors();
  const over = overrideSelectors();

  // rule 12: a gate that narrows to the empty set is worse than no gate.
  ok(blurred.length >= 5, 'found the blurred selectors (>=5)', blurred.length);
  ok(over !== null, 'the body.media-playing override exists');
  if (!over) return;

  // Compare on the bare selector: the override entries carry the
  // `body.media-playing ` prefix, the source rules do not.
  const PREFIX = 'body.media-playing ';
  const covered = over.list.map(s => s.slice(PREFIX.length));

  const missing = blurred.filter(s => covered.indexOf(s) < 0);
  ok(missing.length === 0, 'every blurred selector is listed in the override', missing.join(' | '));

  const dead = covered.filter(s => blurred.indexOf(s) < 0);
  ok(dead.length === 0, 'no dead selector in the override', dead.join(' | '));

  ok(over.list.every(s => s.indexOf(PREFIX) === 0),
     'every override selector is scoped under body.media-playing',
     over.list.filter(s => s.indexOf(PREFIX) !== 0).join(' | '));

  // `[^-]` so the -webkit- twin is not counted twice.
  eq(countIn(/(^|[^-\w])backdrop-filter:\s*none/g, over.body), 1,
     'the override sets backdrop-filter:none');
  eq(countIn(/-webkit-backdrop-filter:\s*none/g, over.body), 1,
     'the override sets the -webkit- twin too (Safari)');
  ok(!/!\s*important/.test(over.body),
     'no !important needed (body.x + same selector already wins on specificity)');
});

block('2. the toggle actually runs', () => {
  function makeSandbox(vids) {
    const listeners = [];
    const classes = {};
    const doc = {
      querySelectorAll: function () { return vids; },
      addEventListener: function (ev, fn, cap) { listeners.push({ ev: ev, fn: fn, cap: cap }); },
      body: { classList: { toggle: function (n, on) { classes[n] = !!on; } } }
    };
    const api = new Function('document',
      CODE + '\nreturn { count: mediaPlayingCount, sync: syncMediaPlayingClass };')(doc);
    return { api: api, listeners: listeners, classes: classes, doc: doc };
  }

  function v(o) {
    return Object.assign({ paused: true, ended: false }, o || {});
  }

  // all paused
  let s = makeSandbox([v(), v(), v()]);
  eq(s.api.count(), 0, 'nothing playing -> 0');
  s.api.sync();
  eq(s.classes['media-playing'], false, 'all paused -> class off');

  // one playing
  s = makeSandbox([v(), v({ paused: false }), v()]);
  eq(s.api.count(), 1, 'one playing -> 1');
  s.api.sync();
  eq(s.classes['media-playing'], true, 'one playing -> class on');

  // ended but not paused: the browser leaves paused=false on a finished clip,
  // and an ended clip is not decoding, so it must not hold the class on.
  s = makeSandbox([v({ paused: false, ended: true })]);
  eq(s.api.count(), 0, 'ended clip is not counted');
  s.api.sync();
  eq(s.classes['media-playing'], false, 'ended clip -> class off');

  // empty board
  s = makeSandbox([]);
  s.api.sync();
  eq(s.classes['media-playing'], false, 'no videos at all -> class off');

  // ── the listeners: the whole mechanism, so they get asserted, not assumed ─
  const evs = s.listeners.map(l => l.ev);
  ['play', 'playing', 'pause', 'ended', 'emptied'].forEach(e => {
    ok(evs.indexOf(e) >= 0, 'listens for "' + e + '"', evs.join(','));
  });
  // Media events do not bubble. Capture is the only reason one document-level
  // listener can see them, so a false here silently breaks the entire feature.
  ok(s.listeners.every(l => l.cap === true), 'every listener uses the capture phase',
     s.listeners.filter(l => l.cap !== true).map(l => l.ev + ':cap=' + l.cap).join(' | '));
  ok(s.listeners.every(l => l.fn === s.api.sync), 'every listener calls the same sync fn');
});

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
