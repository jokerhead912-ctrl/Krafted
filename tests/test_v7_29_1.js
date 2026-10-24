// v7.29.0 group B — the two failure paths that used to say nothing.
//
//   B3  swapProxyMedia had no `error` listener. An undecodable blob URL
//       fails SILENTLY: no exception, the card sits on the proxy's last
//       frame, and the chip still claims ORIG. A conform that lies is worse
//       than no conform — roll back to the proxy and say so.
//   B4  pickSingleFile built a new <input> per call and removed it only
//       inside `change`. Cancelling the dialog leaked the element, and a
//       reused input must be reset or picking the same file twice fires no
//       event at all (reads as a dead menu entry).
//
// The trick worth keeping: both listeners have to be declared as VARIABLES.
// The name of a function expression is bound only inside itself, so two
// inline `function _x() {}` handlers cannot un-register each other.

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

// ── sandbox ──────────────────────────────────────────────────────────────
const api = new Function(`
  var TOASTS = [], RESUMED = [];
  var document = null;                     // swapped per-test via setDoc()
  var URL = {
    createObjectURL: function (f) { return 'blob:' + (f && f.name ? f.name : '?'); },
    revokeObjectURL: function () {},
  };
  function toast(m) { TOASTS.push(String(m)); }
  function boardTextLabel(a, b) { return a; }
  function getSelectedItems() { return []; }
  function resumeMediaEl(v) { RESUMED.push(v); }
  ${LINK}
  return {
    setDoc: function (d) { document = d; },
    pickSingleFile: pickSingleFile,
    applyOriginalLink: applyOriginalLink,
    swapProxyMedia: swapProxyMedia,
    proxyOriginals: proxyOriginals,
    toasts: TOASTS,
    resumed: RESUMED,
  };
`)();

// A promise that never settles has to FAIL the suite, not hang it: an
// unresolved await empties the event loop and node exits silently with no
// summary at all, which reads as "passed" to anything watching the exit code.
function settle(p) {
  return Promise.race([
    p.then(function (f) { return f; }, function () { return 'THREW'; }),
    new Promise(function (r) { setTimeout(function () { r('NEVER'); }, 100); }),
  ]);
}

// ── fixtures ─────────────────────────────────────────────────────────────
function makeDoc() {
  const created = [];
  return {
    created: created,
    body: { appendChild: function (el) { created.push(el); } },
    createElement: function () {
      return {
        type: '', accept: '', value: 'DIRTY', style: {}, files: null,
        _h: {}, clicks: 0, removed: 0, valueAtClick: null,
        addEventListener: function (ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); },
        removeEventListener: function (ev, fn) {
          const a = this._h[ev] || [];
          const i = a.indexOf(fn);
          if (i >= 0) a.splice(i, 1);
        },
        remove: function () { this.removed++; },
        click: function () { this.clicks++; this.valueAtClick = this.value; },
        _fire: function (ev) { (this._h[ev] || []).slice().forEach(function (f) { f(); }); },
        _count: function (ev) { return (this._h[ev] || []).length; },
      };
    },
  };
}
function makeItem(id, opts) {
  const o = opts || {};
  const cls = new Set();
  const chip = { textContent: '', title: '' };
  const bar = {
    classList: {
      toggle: (n, on) => { if (on) cls.add(n); else cls.delete(n); },
      contains: (n) => cls.has(n),
    },
    querySelector: (sel) => (sel === '.ib-proxy') ? chip : null,
  };
  const v = {
    src: 'blob:PROXY',
    paused: o.paused !== false,
    currentTime: o.currentTime || 0,
    duration: 0,
    _h: {},
    load: function () { this.loads = (this.loads || 0) + 1; },
    addEventListener: function (ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); },
    removeEventListener: function (ev, fn) {
      const a = this._h[ev] || [];
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    },
    _fire: function (ev) { (this._h[ev] || []).slice().forEach(function (f) { f(); }); },
    _count: function (ev) { return (this._h[ev] || []).length; },
  };
  return {
    id: id,
    isProxy: true,
    isVideo: true,
    originalName: 'shot01.mov',
    src: 'blob:PROXY',
    el: { querySelector: () => bar },
    video: v,
    _bar: bar,
    _cls: cls,
    _chip: chip,
  };
}

// The picker is cached module-wide, so one document serves every block —
// which is itself the thing under test.
const DOC = makeDoc();
api.setDoc(DOC);

(async function main() {

  await ablock('1. one picker, reused — not one <input> per click', async () => {
    const doc = DOC;
    const p1 = api.pickSingleFile('video/*');
    eq(doc.created.length, 1, 'the first pick creates exactly one input');
    eq(doc.created[0].type, 'file', 'a file input');
    eq(doc.created[0].accept, 'video/*', 'filtered to what we can actually use');
    eq(doc.created[0].removed, 0, 'it is NOT removed on the way out — it is reused');
    eq(doc.created[0].valueAtClick, '', 'and it is reset before the dialog opens');
    eq(doc.created[0].value, '', 'so picking the same file twice still fires change');

    doc.created[0].files = [{ name: 'a.mov' }];
    doc.created[0]._fire('change');

    const f1 = await settle(p1);
    eq(f1 && f1.name, 'a.mov', 'the chosen file comes back');
    eq(doc.created[0]._count('change'), 0, 'the listener is taken off — it cannot resolve twice');
    eq(doc.created[0]._count('cancel'), 0, 'and the cancel listener with it');

    // leave the element dirty, exactly as a real <input> would be
    doc.created[0].value = 'a.mov';
    const p2 = api.pickSingleFile('video/*');
    eq(doc.created.length, 1, 'the second pick reuses the same element');
    eq(doc.created[0].valueAtClick, '', 'and clears the previous choice, or change never fires');
    eq(doc.created[0]._count('change'), 1, 'listening again');
    doc.created[0].files = [{ name: 'b.mov' }];
    doc.created[0]._fire('change');
    const f2 = await settle(p2);
    eq(f2 && f2.name, 'b.mov', 'the second pick resolves with the second file');
  });

  await ablock('2. cancelling the dialog resolves — it does not hang', async () => {
    const doc = DOC;
    const p = api.pickSingleFile('video/*');
    eq(doc.created.length, 1, 'still the one input from before');
    eq(doc.created[0]._count('cancel'), 1, 'a cancel listener is attached');
    doc.created[0]._fire('cancel');
    eq(await settle(p), null, 'Esc resolves null instead of leaving the promise pending forever');
    eq(doc.created[0].removed, 0, 'and the input stays for the next try');
  });

  block('3. a failed swap rolls back instead of lying', () => {
    const link = stripComments(LINK);
    ok(/let _afterSwap = null, _swapFailed = null;/.test(link),
       'both handlers are declared as variables', link.slice(0, 120));
    ok(!/addEventListener\('loadedmetadata', function _afterSwap/.test(link),
       'and NOT as an inline named function expression — its name would not exist outside itself');
    ok(/v\.addEventListener\('error', _swapFailed\);/.test(link), 'the error listener is attached');

    const it = makeItem('e1', { currentTime: 4 });
    api.applyOriginalLink(it, { name: 'shot01.mov', type: 'video/quicktime', size: 99 });
    const linkUrl = api.proxyOriginals.get('e1').url;
    eq(api.swapProxyMedia(it), true, 'the swap starts');
    eq(it.video.src, linkUrl, 'now pointed at the original');
    eq(it._showingOriginal, true, 'and the card says so');
    eq(it._chip.textContent, 'ORIG', 'the chip claims ORIG');

    // The original cannot be decoded: no exception, just an `error` event.
    it.video._fire('error');

    eq(it.video.src, 'blob:PROXY', 'the proxy is put back on the element');
    eq(it._showingOriginal, false, 'the card stops claiming it shows the original');
    eq(it._chip.textContent, 'PROXY', 'and the chip stops lying');
    eq(it._cls.has('has-orig'), false, 'the ORIG state is cleared');
    ok(api.toasts.some(function (t) { return /Could not play the original/.test(t); }),
       'the user is told, instead of silence', api.toasts);

    // The success handler must be off, or a late loadedmetadata would
    // resurrect a playhead for a file that never loaded.
    eq(it.video._count('loadedmetadata'), 0, 'the success listener is un-registered');
    eq(api.resumed.length, 0, 'so nothing is resumed');
  });

  block('4. a successful swap puts the error handler away', () => {
    const it = makeItem('e2', { currentTime: 2 });
    api.applyOriginalLink(it, { name: 'shot01.mov', type: 'video/quicktime', size: 99 });
    api.swapProxyMedia(it);
    eq(it.video._count('error'), 1, 'the error listener is live while the swap is pending');
    it.video.duration = 9;
    it.video._fire('loadedmetadata');
    eq(it.video._count('error'), 0, 'and off once the original actually loaded');
    eq(it.video.currentTime, 2, 'with the playhead where it was');
  });

  console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + '  (' + pass + ' passed' +
              (fail ? ', ' + fail + ' failed' : '') + ')');
  process.exit(fail === 0 ? 0 : 1);
})();
