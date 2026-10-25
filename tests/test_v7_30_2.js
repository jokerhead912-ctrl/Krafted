// v7.30.2 — the lasso stops baking a border into the pixels.
//
// THE BUG
//   renderItemRegion() strokes the selection outline onto the OUTPUT CANVAS
//   when `opts.border` is set. v7.9.0 gave cut, lasso and export one shared
//   renderer, and that stroke came along inside it. Only ONE caller ever set
//   the flag: the lasso, because its panel carried a "Border" checkbox that
//   shipped CHECKED. Cut, C crop and export all passed no border at all.
//
//   So the same shape came out clean from Cut and walked out of the lasso
//   wearing a periwinkle outline — and because the stroke lives in the PIXELS
//   rather than in the DOM, nothing after the extract could take it off again.
//
// WHY THIS SUITE EXECUTES INSTEAD OF GREP
//   An anchor on the word `checked` would prove the attribute is absent from
//   the markup; it would not prove the extractor ever reads it. 病根⑲: an
//   anchor proves the code exists, a run proves it runs. So block 2 builds a
//   DOM stub FROM THE REAL MARKUP and calls applyLassoExtract() for real, then
//   inspects the opts object it hands to extractPolyFromItem(). Put `checked`
//   back in the markup and the stub's .checked flips with it, and the
//   assertion goes red — no separate anchor to keep in sync.
//
//   Block 3 does the same for Cut, which is the behaviour the fix is copying:
//   Cut must not merely pass border:false, it must not mention border at all.

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(
  process.env.KRAFTED_HTML || path.join(__dirname, '..', '..', 'kraftpub-dev.html'),
  'utf8');

let pass = 0, fail = 0;
function clip(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) return 'undefined';
  return s.length > 160 ? s.slice(0, 160) + '...[' + s.length + ' chars]' : s;
}
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  (got ' + clip(extra) + ')' : '')); }
}
function eq(a, b, label) { ok(a === b, label, a); }
function has(needle, haystack, label) { ok(haystack.indexOf(needle) >= 0, label); }
function block(n, fn) {
  console.log('\n' + n);
  try { fn(); } catch (e) { fail++; console.log('  FAIL ' + n + ' threw: ' + (e && e.message)); } }
function ablock(n, fn) { return fn().catch(e => { fail++; console.log('  FAIL ' + n + ' threw: ' + (e && e.message)); }); }
function stripComments(s) {
  return s.replace(/\/\*[\s\S]{0,4000}?\*\//g, '').replace(/(?<![:\\'"])\/\/[^\n]*/g, '');
}
function slice(a, b, label) {
  const i = HTML.indexOf(a), j = HTML.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('anchor failed: ' + label);
  const s = HTML.slice(i, j);
  if (s.length < 40) throw new Error('slice too short: ' + label);
  if (s.length > 20000) throw new Error('slice suspiciously wide: ' + label);
  return s;
}

// Walk `name(` call sites and return the raw text of each argument list.
// Brace/paren depth is counted rather than regexed so a nested call such as
// `_geoApply(aff, w, h)` cannot cut the argument list short.
function callArgTexts(src, name) {
  const out = [];
  const needle = name + '(';
  let i = 0;
  for (;;) {
    const at = src.indexOf(needle, i);
    if (at < 0) break;
    let depth = 0, j = at + name.length;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) break; }
    }
    out.push(src.slice(at + name.length + 1, j));
    i = j + 1;
  }
  return out;
}

// ── the markup ──────────────────────────────────────────────────────────
const TOGGLE_RE = /<input\b[^>]*\bid="lasso-border-toggle"[^>]*>/g;

function toggleTags() { return HTML.match(TOGGLE_RE) || []; }

// A DOM stub whose .checked is DERIVED from the real markup, so this test can
// never disagree with what the browser will actually build.
function domWith(checkedOverride) {
  const tag = toggleTags()[0] || '';
  const real = /\bchecked\b/.test(tag);
  return {
    getElementById(id) {
      if (id === 'lasso-border-toggle') return { checked: checkedOverride === undefined ? real : checkedOverride };
      if (id === 'lasso-border-color') return { value: '#7c8cf0' };
      return null;   // lasso-inplace-toggle absent -> 'inplace', which is fine
    }
  };
}

(async function main() {
  await ablock('1  the Border toggle ships unchecked', async () => {
    const tags = toggleTags();
    eq(tags.length, 1, 'exactly one lasso Border toggle exists in the markup');
    ok(tags.length === 1 && !/\bchecked\b/.test(tags[0]),
       'the lasso Border toggle ships UNCHECKED (a lasso cut-out matches a Cut cut-out)');
    has('id="lasso-border-color"', HTML, 'the border colour picker is still there (the option is off, not gone)');
  });

  const LASSO_SRC = slice('async function applyLassoExtract(beside) {',
                          'function addTodo(x, y) {', 'lasso extract');

  async function runLasso(checkedOverride) {
    let captured = null;
    const fn = new Function(
      'getLassoItem', 'lassoState', 'extractPolyFromItem', 'knockOutPolyFromItem',
      'toast', 'cancelLasso', 'enterLassoMode', 'setTool', 'document',
      LASSO_SRC + '\nreturn applyLassoExtract;')(
      () => ({ id: 1 }),
      { itemId: 1, closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
      async (item, pts, opts) => { captured = opts; return { id: 2 }; },
      async () => true,
      () => {}, () => {}, () => {}, () => {},
      domWith(checkedOverride));
    await fn(false);
    return captured;
  }

  await ablock('2  running applyLassoExtract() — the default', async () => {
    const opts = await runLasso();
    ok(opts !== null, 'applyLassoExtract() actually reached extractPolyFromItem()');
    eq(opts && opts.border, false, 'it asks for NO border — the same result Cut gives');
  });

  await ablock('3  running applyLassoExtract() — box ticked', async () => {
    const opts = await runLasso(true);
    eq(opts && opts.border, true, 'ticking Border still gets a border (the option is off, not removed)');
    eq(opts && opts.borderColor, '#7c8cf0', 'and the picked colour still travels with it');
  });

  const CUT_SRC = slice('async function applyCutExtract(beside) {',
                        'async function applyLassoExtract(beside) {', 'cut extract');

  await ablock('4  running applyCutExtract() — the behaviour being copied', async () => {
    let captured = null;
    const fn = new Function(
      'getCutItem', 'cutState', 'extractPolyFromItem', 'toast', 'clearCutPath',
      'setTool', 'document',
      CUT_SRC + '\nreturn applyCutExtract;')(
      () => ({ id: 1 }),
      { itemId: 1, closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
      async (item, pts, opts) => { captured = opts; return { id: 2 }; },
      () => {}, () => {}, () => {},
      { getElementById: () => null });
    await fn(false);
    ok(captured !== null, 'applyCutExtract() actually reached extractPolyFromItem()');
    ok(captured && !('border' in captured),
       'Cut does not mention border at all — that is the shape the lasso now matches',
       captured && Object.keys(captured).join(','));
  });

  block('5  no direct renderer caller asks for a border', () => {
    // Cut, C crop, clipboard-copy and export all call renderItemRegion()
    // directly. If any of them ever starts baking a stroke it is the same
    // bug wearing a different hat, so the invariant is stated once here
    // instead of being re-asserted per caller.
    const args = callArgTexts(stripComments(HTML), 'renderItemRegion');
    ok(args.length >= 4, 'found the renderItemRegion() call sites', args.length);
    const bordered = args.filter(a => /\bborder\b/.test(a));
    // Exactly one is allowed, and it has to be the shared forwarder:
    // extractPolyFromItem() passes on whatever its caller asked for. A second
    // one means somebody decided to bake a stroke on their own — the bug this
    // release is removing, wearing a different hat.
    eq(bordered.length, 1, 'exactly one renderItemRegion() caller passes a border',
       bordered.join(' | '));
    ok(bordered.length === 1 && /opts\.border/.test(bordered[0]),
       'and that one caller only forwards the flag, it never decides for itself',
       bordered[0]);
  });

  block('6  the border flag is still wired end to end', () => {
    // Delete the stroke and the checkbox becomes a control that lies: it says
    // "Border" and nothing is ever drawn. 病根⑫ — a judgement nobody consumes.
    const R = slice('function renderItemRegion(item, screenPts, opts) {',
                    'function itemLocalToScreen(item) {', 'renderItemRegion');
    has('if (opts.border) {', R, 'the stroke is gated on opts.border (not on a constant)');
    has('ctx.stroke();', R, 'and it really strokes');
    const E = slice('async function extractPolyFromItem(item, screenPts, opts) {',
                    'async function knockOutPolyFromItem(item, screenPts) {', 'extractPolyFromItem');
    has('border: opts.border', E, 'extractPolyFromItem() forwards the flag to the renderer');
    has('borderColor: opts.borderColor', E, 'and forwards the colour');
  });

  console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + '  (' + pass + ' passed' +
              (fail ? ', ' + fail + ' failed' : '') + ')');
  process.exit(fail === 0 ? 0 : 1);
})();
