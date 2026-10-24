// v7.28.0 — Link original + swap to original (file-level conform).
//
// v7.27.0 paired a proxy with its original but dropped the original on the
// floor: it never became a card, so its bytes were gone. This version keeps
// the File from the same drag, which makes linking instant — the user should
// never be sent back to a file picker for a file they just dragged in.
//
// The four things that can go wrong, and are asserted here:
//   1. the original's File is remembered BEFORE the pairing filters it away;
//   2. swap changes the LIVE video element, not item.src — so a snapshot
//      still says "proxy" and undo puts the proxy back;
//   3. swap keeps the playhead and the play/pause state (a conform that
//      moves the card is not a conform);
//   4. the chip says which file is actually on screen.

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
async function ablock(n, fn) {
  console.log('\n' + n);
  try { await fn(); } catch (e) { fail++; console.log('  FAIL ' + n + ' threw: ' + (e && e.message)); }
}
function countIn(re, s) { return (s.match(re) || []).length; }
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

const LINK = slice('function syncProxyBadgeEl(infoBar, item) {',
                   'function buildMediaControls(el, mediaEl, isVideo, isGif) {',
                   'chip + link machinery');
const DROP_HEAD = slice('function _handleFileDrop(e, files) {',
                        '  const audioFiles = [];',
                        '_handleFileDrop head');
const CTX = slice('function showCtx(x, y) {',
                  'function positionCtxMenu(x, y) {',
                  'showCtx');
const CSS = slice('.item.has-media .media-info-bar .ib-type {',
                  '.item.has-media .media-info-bar .ib-name {',
                  'info bar css');

// ── sandbox: the machinery, with the few globals it touches stubbed ───────
const api = new Function(`
  var TOASTS = [], RESUMED = [], SEL = [];
  // v7.29.0: revokeObjectURL is now part of this machinery's contract
  // (dropOriginalLink), so the stub has to offer it or the sandbox throws.
  var REVOKED = [];
  var URL = {
    createObjectURL: function (f) { return 'blob:' + (f && f.name ? f.name : '?'); },
    revokeObjectURL: function (u) { REVOKED.push(u); },
  };
  function toast(m) { TOASTS.push(String(m)); }
  function boardTextLabel(a, b) { return a; }
  function getSelectedItems() { return SEL; }
  function resumeMediaEl(v) { RESUMED.push(v); }
  ${LINK}
  var __pickResult = null;
  pickSingleFile = function () { return Promise.resolve(__pickResult); };
  return {
    syncProxyBadgeEl: syncProxyBadgeEl,
    noteDroppedFiles: noteDroppedFiles,
    applyOriginalLink: applyOriginalLink,
    linkOriginalForItem: linkOriginalForItem,
    swapProxyMedia: swapProxyMedia,
    proxyCardInSelection: proxyCardInSelection,
    linkOriginalSelected: linkOriginalSelected,
    swapProxySelected: swapProxySelected,
    proxyOriginals: proxyOriginals,
    setPick: function (f) { __pickResult = f; },
    setSel: function (a) { SEL = a; },
    toasts: TOASTS,
    resumed: RESUMED
  };
`)();

// ── fixtures ─────────────────────────────────────────────────────────────
function makeBar(withChip) {
  const cls = new Set();
  const chip = { textContent: '', title: '' };
  return {
    _cls: cls, _chip: chip,
    classList: {
      toggle: (n, on) => { if (on) cls.add(n); else cls.delete(n); },
      contains: (n) => cls.has(n),
    },
    querySelector: (sel) => (withChip && sel === '.ib-proxy') ? chip : null,
  };
}
function makeItem(id, opts) {
  const o = opts || {};
  const bar = makeBar(true);
  const handlers = {};
  const item = {
    id: id,
    isProxy: o.isProxy !== false,
    isVideo: true,
    originalName: o.originalName || '',
    // v7.29.0: the import stamps this; a card without it is treated as "we
    // cannot identify the original", so instant-linking must supply it.
    originalSize: o.originalSize,
    src: 'blob:PROXY',
    el: { querySelector: () => bar },
    video: {
      src: 'blob:PROXY',
      paused: o.paused !== false,
      currentTime: o.currentTime || 0,
      duration: o.duration || 0,
      load: function () { this.loaded = (this.loaded || 0) + 1; },
      addEventListener: function (ev, fn) { handlers[ev] = fn; },
      removeEventListener: function (ev) { delete handlers[ev]; },
    },
    _bar: bar,
    _fire: function (ev) { if (handlers[ev]) handlers[ev](); },
  };
  return item;
}

(async function main() {

  block('1. the original is remembered before the pairing throws it away', () => {
    const head = stripComments(DROP_HEAD);
    ok(/noteDroppedFiles\(files\);/.test(head), 'the drop handler records the files', head);
    ok(head.indexOf('noteDroppedFiles(files);') < head.indexOf('imageFiles'),
       'and does it before any filtering — a paired-away original is still in `files`');

    // v7.29.0: real Files carry a type; noteDroppedFiles is video-only now.
    api.noteDroppedFiles([
      { name: 'shot01.mov', type: 'video/quicktime', size: 4096 },
      { name: 'shot01_proxy.mp4', type: 'video/mp4', size: 512 },
    ]);
  });

  await ablock('2. linking is instant when the original came in the same drag', async () => {
    const it = makeItem('i2', { originalName: 'shot01.mov', originalSize: 4096 });
    api.setPick(null);                       // no picker must be needed
    const okLink = await api.linkOriginalForItem(it);
    eq(okLink, true, 'the link resolves without a picker');
    eq(!!api.proxyOriginals.get('i2'), true, 'the link is recorded');
    eq(api.proxyOriginals.get('i2').name, 'shot01.mov', 'under the original name');
    ok(/^blob:/.test(api.proxyOriginals.get('i2').url), 'with a usable object URL',
       api.proxyOriginals.get('i2').url);

    const alone = makeItem('i3', { originalName: 'never_dropped.mov' });
    api.setPick({ name: 'picked.mov' });
    const okPick = await api.linkOriginalForItem(alone);
    eq(okPick, true, 'a file that never arrived asks instead of failing silently');
    eq(api.proxyOriginals.get('i3').name, 'picked.mov', 'and remembers what was picked');

    api.setPick(null);
    const cancelled = await api.linkOriginalForItem(alone);
    eq(cancelled, false, 'cancelling the picker links nothing');

    const plain = makeItem('i4', { isProxy: false });
    eq(await api.linkOriginalForItem(plain), false, 'a real clip has nothing to link');
  });

  await ablock('3. swap moves the live element and leaves item.src alone', async () => {
    const it = makeItem('i5', { originalName: 'shot01.mov', originalSize: 4096 });
    await api.linkOriginalForItem(it);
    const link = api.proxyOriginals.get('i5');

    eq(it.video.src, 'blob:PROXY', 'starts on the proxy');
    const did = api.swapProxyMedia(it);
    eq(did, true, 'the swap happened');
    eq(it.video.src, link.url, 'the video element now points at the original');
    eq(it._showingOriginal, true, 'and the card knows it');
    eq(it.src, 'blob:PROXY', 'item.src still says PROXY — a snapshot must not carry the swap');

    const did2 = api.swapProxyMedia(it);
    eq(did2, true, 'swapping back works');
    eq(it.video.src, 'blob:PROXY', 'and points at the proxy again');
    eq(it._showingOriginal, false, 'with the flag cleared');

    const unlinked = makeItem('i6', { originalName: 'nope.mov' });
    eq(api.swapProxyMedia(unlinked), false, 'a card with no link cannot swap');
    eq(unlinked.video.src, 'blob:PROXY', 'and is left exactly as it was');
  });

  block('4. a conform must not move the playhead or the transport', () => {
    const it = makeItem('i7', { originalName: 'shot01.mov', currentTime: 3.5, paused: true });
    api.applyOriginalLink(it, { name: 'shot01.mov' });
    api.swapProxyMedia(it);
    it.video.duration = 9;
    it._fire('loadedmetadata');
    eq(it.video.currentTime, 3.5, 'the playhead comes back where it was');
    eq(api.resumed.length, 0, 'a paused clip stays paused');

    const playing = makeItem('i8', { originalName: 'shot01.mov', currentTime: 2, paused: false });
    api.applyOriginalLink(playing, { name: 'shot01.mov' });
    api.swapProxyMedia(playing);
    playing.video.duration = 4.2;
    playing._fire('loadedmetadata');
    eq(api.resumed.length, 1, 'a playing clip is resumed (through resumeMediaEl, not a bare play())');
    eq(api.resumed[0], playing.video, 'and it is the right element');

    const past = makeItem('i9', { originalName: 'shot01.mov', currentTime: 30, paused: true });
    api.applyOriginalLink(past, { name: 'shot01.mov' });
    api.swapProxyMedia(past);
    past.video.duration = 4;
    past._fire('loadedmetadata');
    eq(past.video.currentTime, 4, 'a playhead past the new end is clamped, not thrown away');
  });

  block('5. the chip says which file is on screen', () => {
    const it = makeItem('i10', { originalName: 'shot02.mov' });
    api.applyOriginalLink(it, { name: 'shot02.mov' });
    let st = it._bar;
    eq(st._chip.textContent, 'PROXY', 'linked but still playing the proxy');
    eq(st._cls.has('has-orig'), false, 'so no ORIG state');

    api.swapProxyMedia(it);
    eq(st._chip.textContent, 'ORIG', 'after the swap the chip says ORIG');
    eq(st._cls.has('has-orig'), true, 'and the bar carries the state');
    eq(st._cls.has('has-proxy'), true, 'while still being a proxy card');
    eq(st._chip.title, 'Showing original: shot02.mov', 'and names what is playing');

    api.swapProxyMedia(it);
    eq(st._chip.textContent, 'PROXY', 'and goes back');
    eq(st._chip.title, 'Proxy for shot02.mov', 'with the pairing still intact');
  });

  block('6. the menu offers one entry that says what the click will do', () => {
    const ctx = stripComments(CTX);
    ok(/linkOriginalSelected\(\);hideCtx\(\)/.test(ctx), 'an unlinked card offers Link original…', ctx.slice(0, 120));
    ok(/Swap to original/.test(ctx), 'a linked card offers Swap to original');
    ok(/Back to proxy/.test(ctx), 'and Back to proxy once it is showing the original');
    ok(/proxyCardInSelection\(\)/.test(ctx), 'all three hang off one "which card" helper');
    ok(/proxyOriginals\.has\(/.test(ctx), 'the state is the link registry, not a second flag');

    api.setSel([{ id: 'a', isVideo: true }, { id: 'b', isProxy: true, isVideo: true }]);
    const found = api.proxyCardInSelection();
    eq(found && found.id, 'b', 'the helper picks the proxy video out of a mixed selection');
    api.setSel([{ id: 'a', isVideo: true }]);
    eq(api.proxyCardInSelection(), null, 'and finds nothing when no proxy is selected');
  });

  block('7. CSS — the ORIG state is the same chip, recoloured', () => {
    const css = stripComments(CSS);
    const origRule = css.match(/\.item\.has-media \.media-info-bar\.has-orig \.ib-proxy \{[^}]*\}/);
    ok(!!origRule, 'a .has-orig rule exists', css);
    ok(origRule && /background:/.test(origRule[0]) && !/display:/.test(origRule[0]),
       'the ORIG state only recolours the chip — visibility stays with .has-proxy',
       origRule && origRule[0]);
  });

  console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + '  (' + pass + ' passed' +
              (fail ? ', ' + fail + ' failed' : '') + ')');
  process.exit(fail === 0 ? 0 : 1);
})();
