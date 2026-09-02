// v7.0.48 regression suite — a 0 KB save is impossible to report as success
//
//   "Sometimes when I save it's unstable and it writes a 0 KB file. First get
//    rid of that. Then, if a save really does fail, make it raise an alarm and
//    ask me — otherwise I have no idea the file is already destroyed."
//
// The reported symptom was not one bug, it was a silence:
//
//   1. A 0-byte file has no KPAK footer, so readKpakV6Index() throws 'bad
//      magic' — and the stream path CAUGHT that throw, logged it to the
//      console, and carried on to the success toast. The user was told
//      "Saved ✔" about a file with nothing in it.
//   2. Verified-or-not, the fallback path downloaded the file anyway, on the
//      theory that a damaged board beats no board. It does not: a file that
//      will not open is worse than an honest failure, because you find out
//      weeks later.
//   3. The download's blob URL was revoked 2000 ms after the click. The
//      browser drains that blob lazily, so any save the disk could not absorb
//      in two seconds came out truncated — 0 KB again, with no way to tell a
//      truncation from a failure.
//
// So the fix has two halves and this suite tests both: the file can no longer
// be CALLED saved unless it verifies, and a save that does not verify says so
// on a surface that outlives the moment.
//
// Everything behavioural below is the REAL source, sliced out and executed.
// The .kpak container in these tests is built from the format spec written in
// the source's own comment block, independently of buildKpakV6 — because
// testing the writer against its own reader is circular.

const fs = require('fs');
const path = require('path');

// KRAFTED_HTML / KRAFTED_SW let the mutation check point this suite at a
// deliberately broken COPY, so the real dev file is never touched.
const HTML = process.env.KRAFTED_HTML
  ? path.resolve(process.env.KRAFTED_HTML)
  : path.resolve(__dirname, '../../kraftpub-dev.html');
const SWJS = process.env.KRAFTED_SW
  ? path.resolve(process.env.KRAFTED_SW)
  : path.resolve(__dirname, '../docs/sw.js');
const src = fs.readFileSync(HTML, 'utf8');
const sw = fs.readFileSync(SWJS, 'utf8');

const EXPECT_VERSION = '7.6.0';

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; console.log('  FAIL: ' + label); }
}
function eq(actual, expected, label) {
  ok(actual === expected,
     label + '  (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')');
}
function has(hay, needle, label) {
  ok(hay.indexOf(needle) >= 0, label + '  (missing: ' + JSON.stringify(needle) + ')');
}
function hasnt(hay, needle, label) {
  ok(hay.indexOf(needle) < 0, label + '  (should be absent: ' + JSON.stringify(needle) + ')');
}

// ── spec constants, independent of the source ─────────────────────────────
// The smallest a kpak can possibly be: a manifest, an index, and the 12-byte
// footer. Anything smaller is a truncation, whatever else it looks like.
const SPEC_MIN_BYTES = 64;
// Two thresholds a short write has to clear BOTH of before it counts. The
// absolute one stops accounting drift from alarming; the 1% one stops a
// genuinely short write on a tiny board from being waved through.
const SPEC_SHORT_ABS = 65536;
const SPEC_SHORT_PCT = 0.01;

// Extract a whole function by brace matching. The functions under test keep
// no braces inside string literals, so a plain counter is safe.
//
// The `async function` form is tried FIRST. Slicing from the bare `function`
// substring inside `async function readKpakV6Index(` yields a body that
// awaits without being async, which refuses to parse — and the failure reads
// as a broken suite rather than a wrong slice.
function fnFull(name, s) {
  let a = s.indexOf('async function ' + name + '(');
  if (a < 0) a = s.indexOf('function ' + name + '(');
  if (a < 0) { console.log('  FAIL: no function ' + name); fail++; return ''; }
  let depth = 0, begun = false;
  for (let i = a; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') { depth++; begun = true; }
    else if (ch === '}') { depth--; }
    if (begun && depth === 0) return s.slice(a, i + 1);
  }
  console.log('  FAIL: unbalanced function ' + name); fail++;
  return '';
}
// The top-level declaration of a name, which is NOT always the first textual
// match: downloadBlob also exists inside the minified KraftedFormat engine,
// and that copy is not the one on the save path.
function fnTopLevel(name, s) {
  const a = s.indexOf('\nfunction ' + name + '(');
  if (a < 0) { console.log('  FAIL: no top-level function ' + name); fail++; return ''; }
  let depth = 0, begun = false;
  for (let i = a; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') { depth++; begun = true; }
    else if (ch === '}') { depth--; }
    if (begun && depth === 0) return s.slice(a + 1, i + 1);
  }
  console.log('  FAIL: unbalanced top-level function ' + name); fail++;
  return '';
}
// A top-level function, sliced by its closing brace at column 0. Used for the
// big async functions where brace-in-string risk is real.
function fnTop(header, s) {
  const a = s.indexOf(header);
  if (a < 0) { console.log('  FAIL: no header ' + header); fail++; return ''; }
  const b = s.indexOf('\n}\n', a);
  if (b < 0) { console.log('  FAIL: no closing brace for ' + header); fail++; return ''; }
  return s.slice(a, b + 2);
}
// Strip BOTH comment forms before asserting on code. Whole-line // is not
// enough: commenting a call out with /* ... */ leaves the text behind and a
// bare indexOf still finds it — four mutations escaped test_v7043 that way.
function codeOnly(s) {
  // The cap matters. This file contains a string literal '/*' whose matching
  // '*/' sits 270 KB further on, so an unbounded strip deletes 42% of the
  // source — every assertion then runs against a file that has silently lost
  // the code it is meant to be checking. Real comments here top out at 831
  // characters; the three runaway spans are all 21 KB or more.
  return s.replace(/\/\*[\s\S]{0,4000}?\*\//g, '')
          .split('\n').filter(function (l) { return l.trim().indexOf('//') !== 0; }).join('\n');
}

console.log('Krafted v' + EXPECT_VERSION + ' — a 0 KB save can no longer report success');
console.log('');

// ═══════════════════════════════════════════════════════════════════════
//  An independent .kpak writer, built from the format spec in the source:
//
//    [Data Blocks...] [Index] [Footer: "KPAK" + 8B index_offset]
//    Data block: [4B LE size][N bytes raw]
//    Index:      [4B count][2B name_len + name + 8B offset + 8B size + 1B type]
//    Footer:     "KPAK" + 8B LE index_offset
//
//  Deliberately NOT buildKpakV6: if the writer and reader drift together, a
//  self-test would never notice. This one is written from the comment.
// ═══════════════════════════════════════════════════════════════════════
// Assemble raw parts plus an index, so the two can disagree. They have to be
// able to: the interesting corruption is a file whose index is intact and
// whose data is not, which is what a write that ran out of room looks like.
function packKpak(parts, index, indexOffset) {
  const enc = new TextEncoder();
  let idxLen = 4;
  for (const it of index) idxLen += 2 + enc.encode(it.name).length + 8 + 8 + 1;
  const idx = new Uint8Array(idxLen);
  const dv = new DataView(idx.buffer);
  dv.setUint32(0, index.length, true);
  let p = 4;
  for (const it of index) {
    const nb = enc.encode(it.name);
    dv.setUint16(p, nb.length, true); p += 2;
    idx.set(nb, p); p += nb.length;
    dv.setBigUint64(p, BigInt(it.offset), true); p += 8;
    dv.setBigUint64(p, BigInt(it.size), true); p += 8;
    dv.setUint8(p, it.type); p += 1;
  }
  const footer = new Uint8Array(12);
  footer.set(enc.encode('KPAK'), 0);
  new DataView(footer.buffer).setBigUint64(4, BigInt(indexOffset), true);
  return new Blob(parts.concat([idx, footer]), { type: 'application/octet-stream' });
}

function packBlocks(entries) {
  const parts = [];
  const index = [];
  let offset = 0;
  for (const e of entries) {
    const sizeBuf = new Uint8Array(4);
    new DataView(sizeBuf.buffer).setUint32(0, e.data.length, true);
    parts.push(sizeBuf);
    parts.push(e.data);
    index.push({ name: e.name, offset: offset + 4, size: e.data.length, type: 0 });
    offset += 4 + e.data.length;
  }
  return { parts: parts, index: index, indexOffset: offset };
}

const MANIFEST = JSON.stringify({ version: 1, items: [{ id: 1, type: 'image' }] });
const MEDIA = new Uint8Array(4096).fill(7);
function goodEntries() {
  return [
    { name: 'manifest.json', data: new TextEncoder().encode(MANIFEST) },
    { name: 'media/1.png', data: MEDIA }
  ];
}
function buildKpakSpec(entries) {
  const b = packBlocks(entries);
  return packKpak(b.parts, b.index, b.indexOffset);
}
function goodKpak() { return buildKpakSpec(goodEntries()); }
// The footer and index survive; the media bytes never arrived. Every byte the
// file does have is correct, which is exactly the shape of a save that was cut
// short — and the only way to catch it is the out-of-bounds check.
function buildKpakMissingData() {
  const m = new TextEncoder().encode(MANIFEST);
  const sizeBuf = new Uint8Array(4);
  new DataView(sizeBuf.buffer).setUint32(0, m.length, true);
  // The index starts where it genuinely starts, so readKpakV6Index parses
  // happily — it has to, otherwise a bounds error in the reader answers
  // instead of the out-of-bounds check we are trying to reach. Only the
  // media block is absent, and the index still claims it.
  const indexOffset = 4 + m.length;
  const index = [
    { name: 'manifest.json', offset: 4, size: m.length, type: 0 },
    { name: 'media/1.png', offset: indexOffset + 4, size: MEDIA.length, type: 0 }
  ];
  return packKpak([sizeBuf, m], index, indexOffset);
}
// A well-formed file big enough to pass the size floor, whose index lists
// nothing. The floor has to be cleared first or the truncation check answers.
function buildKpakNoEntries() {
  const pad = new Uint8Array(300).fill(3);
  const sizeBuf = new Uint8Array(4);
  new DataView(sizeBuf.buffer).setUint32(0, pad.length, true);
  return packKpak([sizeBuf, pad], [], 4 + pad.length);
}

// ═══════════════════════════════════════════════════════════════════════
//  Load the real code
// ═══════════════════════════════════════════════════════════════════════
const blockVerify = (function () {
  const a = src.indexOf('const KPAK_MIN_BYTES = 64;');
  const b = src.indexOf('// v6.8.15: Detect media mime');
  if (a < 0 || b < a) { console.log('  FAIL: verify block slice not found'); fail++; return ''; }
  return src.slice(a, b);
})();

const blockAlarm = (function () {
  const a = src.indexOf('// The last save whose bytes came back verified');
  const b = src.indexOf('// v6.5.0: Save using custom kpak container');
  if (a < 0 || b < a) { console.log('  FAIL: alarm block slice not found'); fail++; return ''; }
  return src.slice(a, b);
})();

// ── fakes ────────────────────────────────────────────────────────────────
const created = [];
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    className: '', innerHTML: '', textContent: '', type: '',
    children: [], _listeners: {}, removed: false, clicked: false,
    appendChild: function (c) { c._parent = el; el.children.push(c); return c; },
    removeChild: function (c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c._parent = null; },
    // Must actually detach. Setting a flag leaves the element in
    // document.body.children, so "the banner was dismissed" reads as false
    // when the code was right.
    remove: function () {
      el.removed = true;
      if (el._parent) {
        const i = el._parent.children.indexOf(el);
        if (i >= 0) el._parent.children.splice(i, 1);
        el._parent = null;
      }
    },
    addEventListener: function (t, fn) { (el._listeners[t] = el._listeners[t] || []).push(fn); },
    // innerHTML is not parsed by this fake, so children only ever come from
    // appendChild. The selector is recorded as the className so tests can
    // find the container the code looked up — without it, every
    // querySelector result is an anonymous div and the recovery buttons the
    // alarm appended are invisible to the assertions.
    querySelector: function (sel) {
      const c = makeEl('div');
      c.className = String(sel).replace(/^\./, '');
      el.children.push(c);
      return c;
    },
    click: function () { el.clicked = true; }
  };
  return el;
}
const fakeDoc = {
  body: makeEl('body'),
  createElement: function (t) { const e = makeEl(t); created.push(e); return e; },
  getElementById: function () { return null; }
};

const calls = { toasts: [], backup: 0, alarms: 0 };
function resetCalls() { calls.toasts = []; calls.backup = 0; calls.alarms = 0; }

let ZH = false;
const stubs = {
  document: fakeDoc,
  console: { log: function () {}, warn: function () {}, error: function () {} },
  URL: { createObjectURL: function () { return 'blob:fake/' + Math.random(); },
         revokeObjectURL: function () {} },
  setTimeout: function () { return 0; },
  toast: function (m) { calls.toasts.push(String(m)); },
  _isZhUI: function () { return ZH; },
  saveBoardV6: function () {},
  _writeEmergencyBackup: async function () { calls.backup++; }
};

let api = null;
try {
  api = new Function(
    'document', 'console', 'URL', 'setTimeout', 'toast', '_isZhUI',
    'saveBoardV6', '_writeEmergencyBackup',
    fnFull('readKpakV6Index', src) + '\n' +
    fnFull('escapeHtml', src) + '\n' +
    fnFull('formatBytes', src) + '\n' +
    fnFull('_fmtDurSec', src) + '\n' +
    blockVerify + '\n' +
    blockAlarm + '\n' +
    'return { KPAK_MIN_BYTES: KPAK_MIN_BYTES,' +
    '  verifyKpakOutput: verifyKpakOutput,' +
    '  applyShortWriteCheck: applyShortWriteCheck,' +
    '  _finishSave: _finishSave,' +
    '  _showSaveAlarm: _showSaveAlarm,' +
    '  _showSaveBanner: _showSaveBanner,' +
    '  _clearSaveBanner: _clearSaveBanner,' +
    '  _banner: function () { return _saveBannerEl; },' +
    '  _setGoodBlob: function (b) { _lastGoodSaveBlob = b; },' +
    '  _goodBlob: function () { return _lastGoodSaveBlob; } };'
  )(stubs.document, stubs.console, stubs.URL, stubs.setTimeout, stubs.toast,
    stubs._isZhUI, stubs.saveBoardV6, stubs._writeEmergencyBackup);
} catch (e) {
  console.log('  FAIL: could not load the save-integrity module — ' + e.message);
  fail++;
}

// Helper: find the last element appended to body carrying a class.
function bodyEl(cls) {
  for (let i = fakeDoc.body.children.length - 1; i >= 0; i--) {
    const el = fakeDoc.body.children[i];
    if (el && el.className && el.className.indexOf(cls) >= 0) return el;
  }
  return null;
}
function clearBody() { fakeDoc.body.children.length = 0; created.length = 0; }

// ═══════════════════════════════════════════════════════════════════════
async function main() {

// ── 1. The spec writer and the real reader agree ────────────────────────
// If this section is red, every failure below is meaningless — it would mean
// the test cannot produce a valid file, not that the app is wrong.
if (api) {
  const g = goodKpak();
  ok(g.size > SPEC_MIN_BYTES, 'the spec writer produces a file bigger than the minimum');
  const parsed = await api.verifyKpakOutput(g);
  ok(parsed.ok, 'the real verifier accepts a file the spec writer produced'
     + (parsed.ok ? '' : '  (' + parsed.reason + ')'));
  eq(parsed.entries, 2, 'and sees both entries in it');
  ok(parsed.manifest && parsed.manifest.version === 1, 'and reads the manifest back out of it');
  eq(parsed.bad, 0, 'and finds no entry out of bounds');
  eq(parsed.size, g.size, 'and reports the real size');
}

// ── 2. verifyKpakOutput — the reported bug ──────────────────────────────
// "it saves a 0 KB file". A 0-byte file has no KPAK footer, so the old
// bounds-check could never see it: readKpakV6Index threw first, and the
// stream path swallowed the throw. Emptiness has to be caught before the
// index is opened, which is what this section pins.
if (api) {
  let v = await api.verifyKpakOutput(null);
  ok(!v.ok, 'no container at all is a failure');
  has(v.reason, 'nothing was written', 'and says nothing was written');

  v = await api.verifyKpakOutput(new Blob([], { type: 'application/octet-stream' }));
  ok(!v.ok, 'THE BUG: a 0-byte file is a failure, not a save');
  eq(v.size, 0, 'and it reports the size that actually landed');
  has(v.reason, '0 bytes', 'and the reason names the empty file, not a missing footer');
  eq(v.bad, 0, 'with no out-of-bounds entries — emptiness is not a bounds problem');
  ok(v.reason.indexOf('bad magic') < 0,
     'and the reason is not the old "bad magic", which nobody could act on');

  v = await api.verifyKpakOutput(new Blob([new Uint8Array(10)], { type: 'application/octet-stream' }));
  ok(!v.ok, 'a 10-byte file is a failure');
  has(v.reason, 'truncated', 'and is described as truncated');

  v = await api.verifyKpakOutput(new Blob([new Uint8Array(200)], { type: 'application/octet-stream' }));
  ok(!v.ok, 'a 200-byte file of nothing is a failure');
  eq(v.size, 200, 'reporting its real size');

  // A file cut in half. Its footer is gone with it, so the magic check is
  // what answers here — the point is only that it is caught.
  const g = goodKpak();
  v = await api.verifyKpakOutput(g.slice(0, Math.floor(g.size / 2)));
  ok(!v.ok, 'a file cut in half is a failure');

  // THE SHAPE THAT MATTERS: footer intact, index intact, media bytes missing.
  // Every byte present is correct, so nothing but the out-of-bounds check can
  // see it. This is what a save that ran out of disk actually looks like.
  v = await api.verifyKpakOutput(buildKpakMissingData());
  ok(!v.ok, 'a file whose index points past the last byte written is a failure');
  has(v.reason, 'outside the file', 'and it names the out-of-bounds entries');
  eq(v.bad, 1, 'counting exactly the entry whose bytes are missing');
  ok(v.entries > 0, 'while still reading the index, so the count is real');

  // No entries at all. readKpakV6Index insists on a manifest, so it answers
  // first — the empty-index guard behind it is defence, not the visible path.
  v = await api.verifyKpakOutput(buildKpakNoEntries());
  ok(!v.ok, 'a file with no entries is a failure');
  has(v.reason, 'manifest.json', 'and the reason names the missing manifest');

  // Wrong footer magic — the case the old code did catch, and should keep.
  const bad = new Blob([new Uint8Array(300)], { type: 'application/octet-stream' });
  v = await api.verifyKpakOutput(bad);
  ok(!v.ok, 'a file with no KPAK footer is a failure');

  eq(api.KPAK_MIN_BYTES, SPEC_MIN_BYTES, 'the minimum size floor matches the spec');
}

// ── 3. applyShortWriteCheck — a short write counts, drift does not ───────
// buildKpakV6's streaming branch reports a COMPUTED length, so a few bytes'
// disagreement is normal and must not alarm. A half-written board must.
if (api) {
  const okv = { ok: true, reason: '', size: 1000, entries: 2, bad: 0 };
  const mk = (size, okk) => ({ ok: okk !== false, reason: '', size: size, entries: 2, bad: 0 });

  let v = api.applyShortWriteCheck(mk(1000), 1000);
  ok(v.ok, 'an exact byte count is not a short write');

  v = api.applyShortWriteCheck(mk(999800), 1000000);
  ok(v.ok, '200 bytes of accounting drift on a 1 MB board is not a short write');

  v = api.applyShortWriteCheck(mk(990000), 1000000);
  ok(v.ok, '10 KB of drift on a 1 MB board is still not a short write');

  v = api.applyShortWriteCheck(mk(9000000), 10000000);
  ok(!v.ok, '1 MB missing from a 10 MB board IS a short write');
  has(v.reason, 'cut short', 'and says the write was cut short');

  v = api.applyShortWriteCheck(mk(0), 5000000);
  ok(!v.ok, 'a 0-byte result against a 5 MB expectation is a short write');

  v = api.applyShortWriteCheck(mk(1000 * 1000 * 1000 - 1000 * 1000), 1000 * 1000 * 1000);
  ok(v.ok, '1 MB missing from a 1 GB board is drift, not a short write');

  // The two floors are ANDed, so they only disagree in one band: a shortfall
  // that is over 1% of the expectation but UNDER the 64 KB absolute floor.
  // Every case above sits outside that band — 1 MB off a 1 GB board is under
  // 1%, and 1 MB off a 10 MB board is over 64 KB — so a mutation that deletes
  // the absolute floor was invisible to all of them. This one lands in it.
  v = api.applyShortWriteCheck(mk(2000000 - 40000), 2000000);
  ok(v.ok, '40 KB of drift on a 2 MB board is under the absolute floor, so it does not alarm');

  v = api.applyShortWriteCheck(mk(1000000), 0);
  ok(v.ok, 'an unknown expectation never alarms — the guard skips it');

  const alreadBad = { ok: false, reason: 'already broken', size: 5, entries: 0, bad: 0 };
  v = api.applyShortWriteCheck(alreadBad, 1000000);
  eq(v.reason, 'already broken', 'a verdict that already failed keeps its own reason');
}

// ── 4. _finishSave — success is gated on verification ───────────────────
if (api) {
  // (a) genuinely good.
  resetCalls(); clearBody(); api._clearSaveBanner();
  let r = await api._finishSave({
    fname: 'board.kpak',
    verdict: await api.verifyKpakOutput(goodKpak()),
    expectedBytes: 0, prevBytes: 0, missingItems: [],
    manifestJson: MANIFEST, elapsed: 12
  });
  eq(r, true, 'a verified save reports success');
  eq(calls.toasts.length, 1, 'and says so exactly once');
  has(calls.toasts[0], 'Saved ✔', 'with the success message');
  has(calls.toasts[0], 'board.kpak', 'naming the file');
  ok(api._banner() === null, 'and leaves no warning banner behind');
  eq(calls.backup, 1, 'and writes the emergency manifest backup');

  // (b) THE REPORTED BUG. A 0-byte file must never produce a success toast.
  resetCalls(); clearBody(); api._clearSaveBanner();
  r = await api._finishSave({
    fname: 'board.kpak',
    verdict: await api.verifyKpakOutput(new Blob([], { type: 'application/octet-stream' })),
    expectedBytes: 240000000, prevBytes: 240000000, missingItems: [],
    manifestJson: MANIFEST, elapsed: 30
  });
  eq(r, false, 'THE BUG: a 0-byte file does NOT report success');
  eq(calls.toasts.filter(function (t) { return t.indexOf('Saved ✔') >= 0; }).length, 0,
     'and no "Saved ✔" toast is ever shown for it');
  eq(bodyEl('krafted-save-alarm') !== null, true, 'instead a blocking alarm is raised');
  const banner = bodyEl('krafted-save-banner');
  ok(banner !== null, 'and a persistent banner is left on screen');
  // NOT `bodyEl(...).className`: when a mutation takes the banner away this
  // threw, the throw killed the whole suite, and the run scored UNPROVEN —
  // nobody was ever asked. Pass '' instead: the assertion still goes red,
  // it just reports a readable FAIL instead of a stack trace.
  has(banner ? banner.className : '', 'is-fatal', 'the banner is marked fatal, not a warning');
  eq(calls.backup, 1, 'and the manifest is still backed up, because that is when it matters');

  // (c) valid container, missing media: saved, but not silently.
  resetCalls(); clearBody(); api._clearSaveBanner();
  r = await api._finishSave({
    fname: 'board.kpak',
    verdict: await api.verifyKpakOutput(goodKpak()),
    expectedBytes: 0, prevBytes: 0, missingItems: [4, 9, 11],
    manifestJson: MANIFEST, elapsed: 20
  });
  eq(r, true, 'a save missing media still reports success — the file does open');
  eq(calls.toasts.filter(function (t) { return t.indexOf('Saved ✔') >= 0; }).length, 0,
     'but it does NOT get the plain success toast');
  const warn = bodyEl('krafted-save-banner');
  ok(warn !== null, 'it gets a persistent banner instead of a 2-second toast');
  has(warn ? warn.className : '', 'is-warn', 'the banner is marked a warning, not fatal');
  has(warn ? warn.innerHTML : '', '3', 'and it says how many files were lost');

  // (d) a short write is a failure, not a caveat.
  resetCalls(); clearBody(); api._clearSaveBanner();
  r = await api._finishSave({
    fname: 'big.kpak',
    verdict: { ok: true, reason: '', size: 9000000, entries: 30, bad: 0 },
    expectedBytes: 10000000, prevBytes: 0, missingItems: [],
    manifestJson: MANIFEST, elapsed: 60
  });
  eq(r, false, 'a short write is a failure');
  ok(bodyEl('krafted-save-alarm') !== null, 'and raises the alarm');

  // (e) the destination-damaged warning survives a successful fallback save.
  resetCalls(); clearBody(); api._clearSaveBanner();
  r = await api._finishSave({
    fname: 'board.kpak',
    verdict: await api.verifyKpakOutput(goodKpak()),
    expectedBytes: 0, prevBytes: 0, missingItems: [],
    manifestJson: MANIFEST, elapsed: 5,
    destWarning: 'your existing file may have been emptied'
  });
  eq(r, true, 'the fallback copy itself is good');
  const dw = bodyEl('krafted-save-banner');
  ok(dw !== null, 'but the damage to the chosen destination is still reported');
  has(dw ? dw.innerHTML : '', 'emptied', 'naming what happened to the original file');
}

// ── 5. The alarm itself ─────────────────────────────────────────────────
// An alarm that says "save failed" without numbers is not actionable: the
// user cannot check a file they have not been told is broken.
if (api) {
  resetCalls(); clearBody(); api._clearSaveBanner(); api._setGoodBlob(null);
  api._showSaveAlarm({ fname: 'myboard.kpak', bytes: 0, prevBytes: 251000000, reason: 'the file was written with 0 bytes' });
  const alarm = bodyEl('krafted-save-alarm');
  ok(alarm !== null, 'the alarm is put on screen');
  const html = alarm ? alarm.innerHTML : '';
  has(html, 'myboard.kpak', 'it names the file');
  has(html, '0 B', 'it says how many bytes actually landed');
  has(html, '239.4 MB', 'it says how big the file used to be, so the loss is concrete');
  has(html, '0 bytes', 'and it gives the reason');
  has(html, 'SAVE FAILED', 'with an unambiguous headline');

  // The card is written as innerHTML, which this fake DOM does not parse, so
  // it has to be asserted on the markup itself.
  has(html, 'DO NOT TRUST THIS FILE', 'and states the file cannot be trusted');

  // Recovery actions.
  const acts = [];
  (function walk(e) {
    if (!e) return;
    if (e.className && e.className.indexOf('krafted-save-alarm-actions') >= 0) acts.push(e);
    (e.children || []).forEach(walk);
  })(alarm);
  ok(acts.length > 0, 'the alarm offers recovery actions');
  const btns = acts.length ? acts[0].children : [];
  eq(btns.length, 2, 'without a verified copy in hand there are two: save a copy, and dismiss');
  has(btns.length ? btns[0].className : '', 'primary', 'the recovery action is the primary button');
  eq(btns.length ? btns[0].textContent : '', 'Save a copy…', 'and it is offered as saving a copy');

  // With a verified copy held, a third way out appears.
  clearBody(); api._clearSaveBanner();
  api._setGoodBlob({ blob: goodKpak(), name: 'board.kpak', at: Date.now() });
  api._showSaveAlarm({ fname: 'board.kpak', bytes: 0, prevBytes: 0, reason: 'truncated' });
  const acts2 = [];
  (function walk(e) {
    if (!e) return;
    if (e.className && e.className.indexOf('krafted-save-alarm-actions') >= 0) acts2.push(e);
    (e.children || []).forEach(walk);
  })(bodyEl('krafted-save-alarm'));
  eq(acts2[0].children.length, 3, 'holding a verified copy adds a download button');
  has(acts2[0].children[1].textContent, 'good copy', 'which offers the last good copy');

  // The banner outlives the modal — that is the whole point of having one.
  api._clearSaveBanner();
  ok(bodyEl('krafted-save-banner') === null, 'the banner can be dismissed');
  clearBody(); api._clearSaveBanner(); api._setGoodBlob(null);

  // Language: the Chinese path must carry the same facts, not a stub.
  ZH = true;
  clearBody(); api._clearSaveBanner();
  api._showSaveAlarm({ fname: 'board.kpak', bytes: 0, prevBytes: 1000, reason: 'truncated' });
  const zhHtml = (bodyEl('krafted-save-alarm') || { innerHTML: '' }).innerHTML;
  has(zhHtml, '保存失敗', 'the Chinese alarm says the save failed');
  has(zhHtml, '0 B', 'and still reports the real byte count');
  ZH = false;
  clearBody(); api._clearSaveBanner();
}

// ── 6. Structural: the silence is gone from the write paths ─────────────
{
  const save = fnTop('async function saveBoardV6(opts) {', src);
  ok(save.length > 1000, 'saveBoardV6 was sliced out for inspection');
  const saveCode = codeOnly(save);

  hasnt(saveCode, 'stream verify threw',
        'the catch that logged a failed verify and carried on is gone');
  hasnt(saveCode, 'readKpakV6Index(',
        'saveBoardV6 no longer reads the index itself — it asks the shared verifier');
  hasnt(saveCode, "if (result.manifestJson) _writeEmergencyBackup(result.manifestJson);",
        'the old fire-and-forget backup call is gone, it now belongs to _finishSave');
  eq((saveCode.match(/verifyKpakOutput\(/g) || []).length, 2,
     'both write paths ask the shared verifier — once for the stream, once for the blob');
  // Asking the verifier is not enough: the answer has to reach _finishSave,
  // which is what decides the toast, the banner and the alarm. A mutation that
  // replaced the stream path's call with a hardcoded `true` slipped past every
  // assertion above, because they all only look at the verifier.
  has(saveCode, 'const streamGood = await _finishSave({',
      'the STREAM path reports through _finishSave — it does not assume success');
  // This app spells the tick two ways — as a literal backslash-u2714 escape
  // AND as a real U+2714 character (both occur in the source today). The
  // mutation that re-adds the toast uses the ESCAPE spelling, so a hasnt()
  // written against the real character never once saw it and the mutation
  // went uncaught. Pin both spellings.
  // (Both needles are built, never typed: writing a backslash-u escape into
  // this file turns into six literal characters, which is the same bug.)
  const TICK = String.fromCharCode(0x2714);
  const SAVED_ESC = "'Saved " + String.fromCharCode(92) + "u2714 '";
  const SAVED_CHR = "'Saved " + TICK + " '";
  hasnt(saveCode, SAVED_ESC, 'saveBoardV6 can no longer print the success toast itself (escape spelling)');
  hasnt(saveCode, SAVED_CHR, 'saveBoardV6 can no longer print the success toast itself (real-character spelling)');
  hasnt(saveCode, "'已保存 ✔ '", 'nor its Chinese form');
  has(saveCode, '_finishSave({', 'it hands the verdict to the one place that reports');
  eq((saveCode.match(/_finishSave\(/g) || []).length, 2,
     'and does so from both paths, not just one');

  // The download is gated. Shipping a file that failed verification is how a
  // 0 KB file ends up in Downloads behind a success message.
  has(saveCode, 'if (good) {', 'the download is gated on the verdict');
  has(saveCode, "refusing to download a package that did not verify",
      'and the refusal is logged');
  // The else that belongs to THIS if. saveBoardV6 has earlier `} else {`
  // branches (the permission re-request above), so an unanchored search
  // finds the wrong one and the assertion tests nothing.
  const gateAt = saveCode.indexOf('if (good) {');
  const elseAt = saveCode.indexOf('} else {', gateAt);
  ok(elseAt > gateAt, 'the gated download has an else branch');
  const gated = saveCode.slice(gateAt, elseAt);
  has(gated, 'a.click();', 'the click happens inside the gate');
  hasnt(saveCode.slice(elseAt + '} else {'.length), 'a.click();',
        'and nowhere in the refusal branch');

  // The destination's old size is recorded before anything is written.
  has(saveCode, 'await saveHandle.getFile()).size',
      'the destination size is recorded before the write starts');
  ok(saveCode.indexOf('await saveHandle.getFile()).size') < saveCode.indexOf('saveHandle.createWritable()'),
     'and it is read BEFORE createWritable, so it is the pre-overwrite size');

  // A failed stream must not leave the quick-save handle aiming at the file
  // it just damaged. Counted inside the streaming section only: there is a
  // third, unrelated `_saveHandle = null` where an unusable saved handle is
  // discarded at the top of the function.
  const streamAt = saveCode.indexOf('if (saveHandle) {');
  const streamSection = saveCode.slice(streamAt, saveCode.indexOf('if (!saved) {', streamAt));
  eq((streamSection.match(/state\._saveHandle = null;/g) || []).length, 2,
     'the quick-save handle is dropped both when the stream throws and when it fails verification');

  // The hard-failure path alarms now, instead of toasting for two seconds.
  has(saveCode, '_showSaveAlarm({', 'a thrown save raises the alarm');
  hasnt(saveCode, "toast('Save failed: '", 'and no longer just toasts "Save failed"');

  // The download race.
  hasnt(saveCode, 'URL.revokeObjectURL(url); a.remove(); }, 2000);',
        'the 2-second revoke that truncated large downloads is gone');
  has(saveCode, '_releaseLastSaveObjectUrl();', 'the URL is held open instead');
  has(saveCode, '_lastSaveObjectUrl = url;', 'and tracked so the next save can release it');

  // The TOP-LEVEL downloadBlob. A second, minified copy lives inside the
  // KraftedFormat engine; it is not the one the save path reaches (see the
  // dead-bridge note below), and asserting on it would test nothing.
  const dl = codeOnly(fnTopLevel('downloadBlob', src));
  hasnt(dl, 'revokeObjectURL(url), 5000);',
        'downloadBlob no longer revokes on a 5-second timer');
  has(dl, '_releaseLastSaveObjectUrl();', 'downloadBlob uses the shared URL holder');

  const td = fnFull('triggerDownload', src);
  has(codeOnly(td), ', 60000);',
      'triggerDownload waits a full minute, not one second');

  // There is only one way to save a board. saveBoardV5 used to be a complete
  // second engine — its own builder, its own write, its own download — and it
  // toasted "Saved ✔" without verifying anything. Nothing called it, but it
  // was exported, so anything reaching in from outside would have got the one
  // path that can still write a broken file and call it saved.
  const bridge = src.indexOf('window.saveBoardV5 = async function() {');
  ok(bridge >= 0, 'the legacy V5 bridge is still exported on window');
  const bridgeBody = codeOnly(src.slice(bridge, src.indexOf('\n  };', bridge)));
  has(bridgeBody, 'saveBoardV6(', 'and it no longer saves by itself — it delegates');
  hasnt(bridgeBody, "toast('Saved ", 'there is no second success toast in the app');
  hasnt(bridgeBody, 'buildKpak(', 'and no second kpak builder on a reachable path');
}

// ── 7. The reporting module is wired into the source ────────────────────
{
  const alarmBlock = codeOnly(blockAlarm);
  has(alarmBlock, 'let _lastGoodSaveBlob = null;', 'the last verified copy is kept');
  has(alarmBlock, 'let _lastSaveObjectUrl = null;', 'the download URL is held open');
  has(alarmBlock, 'function _releaseLastSaveObjectUrl()', 'with a single release point');
  has(alarmBlock, 'function _showSaveBanner(', 'there is a persistent banner');
  has(alarmBlock, 'function _clearSaveBanner(', 'and a way to dismiss it');
  has(alarmBlock, 'function _showSaveAlarm(', 'and a blocking alarm');
  has(alarmBlock, 'async function _finishSave(', 'and one place that decides good or bad');
  has(alarmBlock, "'Saved \\u2714 '", 'the success message lives in _finishSave');
  has(alarmBlock, 'applyShortWriteCheck(o.verdict', 'and it applies the short-write check');
  has(alarmBlock, 'await _writeEmergencyBackup(o.manifestJson)',
      'the manifest backup is awaited, not fired and forgotten');
  ok(alarmBlock.indexOf('if (!v || !v.ok)') < alarmBlock.indexOf("'Saved \\u2714 '"),
     'the failure branch is checked before anything can report success');

  // Persistence is the point: a warning the user can scroll past is not an
  // alarm. Asserted on the stylesheet, which is where the behaviour lives.
  const css = src.slice(src.indexOf('.krafted-save-banner {'), src.indexOf('.krafted-save-alarm-card {'));
  ok(css.length > 100, 'the banner styles were found');
  has(css, 'position: fixed; top: 0; left: 0; right: 0;',
      'the banner is pinned across the top of the board');
  has(css, 'z-index: 999999998', 'and sits above the board UI');
  has(css, '.krafted-save-banner.is-fatal { background: #b3261e; }',
      'a failed save is red, not amber');
  has(css, '.krafted-save-banner.is-warn  { background: #8a6100; }',
      'while a save with missing media is amber');
  // The banner must never be one that times itself out.
  hasnt(css, 'animation', 'the banner does not animate itself away');
  has(src.slice(src.indexOf('.krafted-save-alarm {'),
               src.indexOf('.krafted-save-alarm-card {')), 'z-index: 1000000000',
      'the alarm modal sits above the banner, so it cannot be hidden behind it');
}

// ── 8. Version pins ─────────────────────────────────────────────────────
ok(src.indexOf("var KRAFTED_VERSION = '" + EXPECT_VERSION + "';") >= 0, 'KRAFTED_VERSION bumped');
ok(src.indexOf('<title>Krafted v' + EXPECT_VERSION + '</title>') >= 0, 'title bumped');
ok(sw.indexOf("const CACHE_NAME = 'krafted-v" + EXPECT_VERSION + "-'") >= 0, 'sw CACHE_NAME bumped');
ok(sw.indexOf("const APP_VERSION = '" + EXPECT_VERSION + "';") >= 0, 'sw APP_VERSION bumped');

} // end main

main().then(function () {
  console.log('');
  if (fail === 0) {
    console.log('ALL PASS (' + pass + ' assertions)');
  } else {
    console.log('FAILURES: ' + fail + ' (passed ' + pass + ')');
    process.exitCode = 1;
  }
}).catch(function (e) {
  console.log('SUITE THREW: ' + e.message);
  console.log(e.stack);
  process.exitCode = 1;
});
