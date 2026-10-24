// v7.27.1 — the PROXY chip on the card face.
//
// v7.27.0 made the pairing real but invisible: isProxy / originalName live on
// the item, and nothing on the board told the user which card was a stand-in.
// This suite pins the chip AND the three things the chip could have broken:
//
//   導出  paintBoardRegion() rasterises the media element, never the DOM, so
//         the chip cannot be baked. Plus the chip is listed in the
//         body.capturing rule like every other piece of media UI.
//   播放  the info bar is pointer-events:none, so the chip cannot eat a click
//         meant for the picture.
//   undo   the chip has to come back on a card that applySnapshot() rebuilt
//         from a snapshot — it is DOM that has to be re-derived, not a field
//         that travels with the item.
//
// The chip is refreshed from ONE place (a rAF inside buildMediaControls) so
// that no caller has to remember it. That is the whole point: if a fourth way
// of creating a card appears, the chip still shows.

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
// Rule 20 (no version strings in slice anchors) + rule 21 (the start anchor is
// the signature of the thing under test).
function slice(a, b, label) {
  const i = HTML.indexOf(a), j = HTML.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('anchor failed: ' + label);
  const s = HTML.slice(i, j);
  if (s.length < 40) throw new Error('slice too short: ' + label);
  if (s.length > 20000) throw new Error('slice suspiciously wide: ' + label);
  return s;
}

// The chip's whole behaviour: one function, no state of its own.
const BADGE = slice('function syncProxyBadgeEl(infoBar, item) {',
                    'function buildMediaControls(el, mediaEl, isVideo, isGif) {',
                    'syncProxyBadgeEl');
// Where it is scheduled from. buildMediaControls is 4000 lines long, so the
// slice ends at the next landmark — the call site is ~80 lines in.
const BUILD_HEAD = slice('function buildMediaControls(el, mediaEl, isVideo, isGif) {',
                         '  // ── Comments button (Round 51',
                         'buildMediaControls head');
// Export: the one renderer every surface shares.
const PAINT = slice('function paintBoardRegion(ctx, opts) {',
                    'function drawTextItemCaptured(',
                    'paintBoardRegion');
const CSS = slice('.item.has-media .media-info-bar .ib-type {',
                  '.item.has-media .media-info-bar .ib-name {',
                  'info bar type + proxy css');

const syncProxyBadgeEl = new Function(BADGE + '\nreturn syncProxyBadgeEl;')();

// ── a fake info bar, because the chip only ever touches three DOM props ────
function makeBar(withChip) {
  const cls = new Set();
  const chip = { textContent: '', title: '' };
  return {
    _cls: cls,
    _chip: chip,
    classList: {
      toggle: (n, on) => { if (on) cls.add(n); else cls.delete(n); },
      contains: (n) => cls.has(n),
    },
    querySelector: (sel) => (withChip && sel === '.ib-proxy') ? chip : null,
  };
}
function chipState(bar) {
  return { on: bar._cls.has('has-proxy'), text: bar._chip.textContent, title: bar._chip.title };
}

block('1. syncProxyBadgeEl runs — the chip says what the item is', () => {
  let bar = makeBar(true);
  syncProxyBadgeEl(bar, { isProxy: true, originalName: 'shot01.mov' });
  let st = chipState(bar);
  eq(st.on, true, 'a proxy card gets the chip');
  eq(st.text, 'PROXY', 'and the chip reads PROXY');
  eq(st.title, 'Proxy for shot01.mov', 'the tooltip names the original it stands for');

  bar = makeBar(true);
  syncProxyBadgeEl(bar, { isProxy: false, originalName: '' });
  eq(chipState(bar).on, false, 'a real clip gets no chip');

  bar = makeBar(true);
  syncProxyBadgeEl(bar, {});
  eq(chipState(bar).on, false, 'an item with no flag at all gets no chip');

  bar = makeBar(true);
  syncProxyBadgeEl(bar, undefined);
  eq(chipState(bar).on, false, 'no item (first frame, el._item not stashed yet) gets no chip');
});

block('2. an unpaired proxy still reads as a proxy', () => {
  const bar = makeBar(true);
  syncProxyBadgeEl(bar, { isProxy: true, originalName: '' });
  eq(chipState(bar).on, true, 'a lone proxy is still marked');
  ok(/no original/.test(chipState(bar).title),
     'and says so instead of showing an empty tooltip', chipState(bar).title);

  const bar2 = makeBar(true);
  syncProxyBadgeEl(bar2, { isProxy: true, originalName: '   ' });
  ok(/no original/.test(chipState(bar2).title),
     'a whitespace-only original counts as none', chipState(bar2).title);

  const bar3 = makeBar(true);
  syncProxyBadgeEl(bar3, { isProxy: true, originalName: '  shot02.mov  ' });
  eq(chipState(bar3).title, 'Proxy for shot02.mov', 'the name is trimmed');
});

block('3. the class is toggled OFF as well as on (undo can un-proxy a card)', () => {
  const bar = makeBar(true);
  syncProxyBadgeEl(bar, { isProxy: true, originalName: 'a.mov' });
  eq(chipState(bar).on, true, 'on first');
  syncProxyBadgeEl(bar, { isProxy: false });
  eq(chipState(bar).on, false, 'and off again — the chip is not a one-way latch');
});

block('4. it survives a card that has no chip element', () => {
  const bar = makeBar(false);
  let threw = false;
  try { syncProxyBadgeEl(bar, { isProxy: true, originalName: 'a.mov' }); } catch (e) { threw = true; }
  eq(threw, false, 'a bar without the span does not throw');
  eq(bar._cls.has('has-proxy'), true, 'and still records the state on the bar');

  let threw2 = false;
  try { syncProxyBadgeEl(null, { isProxy: true }); } catch (e) { threw2 = true; }
  eq(threw2, false, 'a missing bar does not throw either');
});

block('5. one definition, one scheduled call site', () => {
  const stripped = stripComments(HTML);
  eq(countIn(/function syncProxyBadgeEl\b/g, stripped), 1,
     'exactly one definition of the chip logic');
  // v7.28.0 added two more CALLERS (a link and a swap change which file is on
  // screen) and v7.29.0 a fifth (the failed-swap rollback puts the proxy
  // back), but the definition is still one and the build-time schedule is
  // still one. What must not happen is a sixth place quietly re-deriving it.
  eq(countIn(/syncProxyBadgeEl\(/g, stripped), 5,
     'one definition + build + link + swap + rollback — and nothing else');

  const head = stripComments(BUILD_HEAD);
  ok(/requestAnimationFrame\(\s*function\s*\(\)\s*\{\s*syncProxyBadgeEl\(infoBar,\s*_getItem\(\)\);\s*\}\s*\);/
       .test(head),
     'the refresh is scheduled from inside buildMediaControls', head.slice(-200));
  ok(head.indexOf('requestAnimationFrame') < head.indexOf('syncProxyBadgeEl'),
     'scheduled before the call, i.e. it waits for the caller to stash el._item');
  ok(!/el\._syncProxyBadge\s*=/.test(stripped),
     'no second hook for callers to remember — that would be the copy we refused to write');
});

block('6. every card carries the chip element', () => {
  const head = stripComments(BUILD_HEAD);
  ok(/'<span class="ib-proxy"><\/span>'/.test(head),
     'the info bar template includes the chip span', head.slice(-300));
  ok(/'&middot;/.test(head) || /&middot;/.test(head),
     'and the info bar is still the one being built (anchor sanity)');
});

block('7. CSS — hidden by default, shown by the class', () => {
  const css = stripComments(CSS);
  ok(/\.item\.has-media \.media-info-bar \.ib-proxy \{[^}]*display:\s*none/.test(css),
     'the chip is hidden unless the bar says otherwise', css);
  ok(/\.item\.has-media \.media-info-bar\.has-proxy \.ib-proxy \{[^}]*display:\s*inline-flex/.test(css),
     '.has-proxy is what shows it', css);
  ok(/pointer-events:\s*none/.test(stripComments(slice('.item.has-media .media-info-bar {',
                                                       '.item.has-media .media-info-bar .ib-type {',
                                                       'info bar css'))),
     'the info bar never eats a click  (播放: the chip cannot block playback hit-testing)');
});

block('8. 導出 — the chip cannot be baked', () => {
  const paint = stripComments(PAINT);
  ok(/const drawSrc = item\.video \|\| item\.img;/.test(paint),
     'the export draws the media element itself', paint.slice(0, 200));
  ok(/ctx\.drawImage\(drawSrc/.test(paint),
     'and paints from it — no DOM rasterisation, so no chip in the output');
  eq(countIn(/ib-proxy/g, paint), 0, 'the renderer never looks at the chip at all');

  const capStart = HTML.indexOf('body.capturing #media-bar,');
  const capEnd = HTML.indexOf('!important; }', capStart);
  ok(capStart > 0 && capEnd > capStart, 'the capture-hiding rule exists');
  const capRule = stripComments(HTML.slice(capStart, capEnd));
  ok(/\.ib-proxy/.test(capRule),
     'the chip is listed in body.capturing like every other piece of media UI',
     capRule);
});

block('9. the pairing still reaches the item (v7.30.0 did not regress)', () => {
  const stripped = stripComments(HTML);
  ok(/newItem\.isProxy = true;/.test(stripped), 'the drop path still stamps the item');
  ok(/newItem\.originalName = _pp\.originalName/.test(stripped), 'and records the original');
  eq(countIn(/isProxy: [a-zA-Z_]+\.isProxy \|\| false/g, stripped) >= 4, true,
     'and the four persistence writers still carry it');
});

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + '  (' + pass + ' passed' +
            (fail ? ', ' + fail + ' failed' : '') + ')');
process.exit(fail === 0 ? 0 : 1);
