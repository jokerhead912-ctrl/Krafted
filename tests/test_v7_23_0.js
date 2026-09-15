// v7.23.0 — a stroke drawn on a video card must land under the pen even when
// that card is rotated or flipped.
//
// Rule 19: an anchor proves the code exists, a unit test proves it RUNS. So
// this suite lifts kraftedLocalBasis / kraftedClientToLocal out of
// kraftpub-dev.html and executes them against a fake DOM whose
// getBoundingClientRect answers are produced by a KNOWN affine matrix. Then it
// asks the inverse for the local point and checks it comes back.
//
// The bug this pins: _canvasPoint() used annoCanvas.getBoundingClientRect(),
// which is the AXIS-ALIGNED bounding box. On a rotated card that box is bigger
// than the canvas and its top-left is not the canvas's origin; on a flipped
// card the x axis is mirrored outright. Measured in a real browser before the
// fix: 5deg 1.4% off, 15deg 3.9%, 30deg 7.4%, 45deg 10.8%, 90deg 30%,
// flipH 0.30 -> 0.70.

const fs = require('fs');
const path = require('path');

// KRAFTED_HTML lets the mutation harness point us at a deliberately broken
// copy. Without it every mutant would be tested against the pristine file and
// the whole mutation run would be decoration.
const HTML = fs.readFileSync(
  process.env.KRAFTED_HTML || path.join(__dirname, '..', '..', 'kraftpub-dev.html'),
  'utf8');

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  (got ' + JSON.stringify(extra) + ')' : '')); }
}
function eq(a, b, label) { ok(a === b, label, a); }
function near(a, b, label) {
  ok(a !== null && a !== undefined && Math.abs(a - b) < 1e-6, label, a);
}
function section(n) { console.log('\n' + n); }

// ── lift the real code out ────────────────────────────────────────────────
// Rule 20: slice anchors are version-free (no X.Y.Z anywhere in them).
function slice(a, b, label) {
  const i = HTML.indexOf(a), j = HTML.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('anchor failed: ' + label);
  const s = HTML.slice(i, j);
  if (s.length < 40) throw new Error('slice too short: ' + label);
  return s;
}
const HELPERS = slice('var KRAFTED_PROBE_BASIS =', 'function makeVideoElement(', 'helpers');
const CANVAS_POINT = slice('    function _canvasPoint(ev) {',
                           "    annoCanvas.addEventListener('pointerdown'",
                           '_canvasPoint');

section('S1 the code lifted (anchor checks)');
ok(/var KRAFTED_PROBE_BASIS =/.test(HELPERS), 'S1a the constant block lifted');
ok(/function kraftedLocalBass?y?\(/.test(HELPERS) || /function kraftedLocalBasis\(/.test(HELPERS),
   'S1b kraftedLocalBasis lifted');
ok(/function kraftedClientToLocal\(/.test(HELPERS), 'S1c kraftedClientToLocal lifted');
ok(/function _canvasPoint\(/.test(CANVAS_POINT), 'S1d _canvasPoint lifted');
eq((HTML.match(/function kraftedClientToLocal\(/g) || []).length, 1,
   'S1e exactly one kraftedClientToLocal in the source (one definition)');
eq((HTML.match(/function kraftedLocalBasis\(/g) || []).length, 1,
   'S1f exactly one kraftedLocalBasis in the source');

// ── the fake browser ──────────────────────────────────────────────────────
function makeSandbox() {
  const created = [];
  const document = {
    createElement: function () {
      const d = {
        className: '',
        style: { cssText: '' },
        attrs: {},
        setAttribute: function (k, v) { this.attrs[k] = v; },
        getBoundingClientRect: function () { return { left: 0, top: 0, width: 0, height: 0 }; }
      };
      created.push(d);
      return d;
    }
  };
  const api = new Function('document',
    HELPERS + '\nreturn { basis: kraftedLocalBasis, toLocal: kraftedClientToLocal, BASIS: KRAFTED_PROBE_BASIS };'
  )(document);
  return { api: api, created: created, document: document };
}

// A host whose children report their screen position through a known affine
// matrix m = [m0, m1, m2, m3] plus origin o — the stand-in for "the card is
// rotated / flipped / scaled / moved, or any combination".
//   screen.x = o[0] + m0*lx + m2*ly
//   screen.y = o[1] + m1*lx + m3*ly
function makeHost(m, o, zero) {
  const host = { _kraftedProbes: undefined, appends: 0, kids: [] };
  host.appendChild = function (d) {
    host.appends++;
    host.kids.push(d);
    const mm = /left:(-?[0-9.]+)px;top:(-?[0-9.]+)px;/.exec(d.style.cssText);
    const lx = mm ? parseFloat(mm[1]) : 0;
    const ly = mm ? parseFloat(mm[2]) : 0;
    d.getBoundingClientRect = function () {
      if (zero) return { left: 0, top: 0, width: 0, height: 0 };
      return {
        left: o[0] + m[0] * lx + m[2] * ly,
        top: o[1] + m[1] * lx + m[3] * ly,
        width: 0, height: 0
      };
    };
    return d;
  };
  return host;
}
function rot(deg, s) {
  const r = deg * Math.PI / 180, c = Math.cos(r), n = Math.sin(r);
  s = s === undefined ? 1 : s;
  return [s * c, s * n, -s * n, s * c];
}
function mul(A, B) {   // 2x2, layout [a,b,c,d] = [[a,c],[b,d]]
  return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
          A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3]];
}

const SB = makeSandbox();
const BASIS = SB.api.BASIS;

section('S2 the basis itself');
ok(BASIS > 0 && isFinite(BASIS), 'S2a the probe basis is a positive, finite number of px', BASIS);
ok(BASIS >= 4, 'S2b the basis is big enough to measure sub-pixel-accurately (>=4px)', BASIS);

const host0 = makeHost([1, 0, 0, 1], [0, 0]);
const b0 = SB.api.basis(host0);
eq(host0.appends, 3, 'S2c one basis call creates exactly three probes');
const bAgain = SB.api.basis(host0);
eq(host0.appends, 3, 'S2d a second basis call reuses them (no probe leak)');
ok(bAgain === b0 || JSON.stringify(bAgain) === JSON.stringify(b0),
   'S2e and returns the same numbers');
(function () {
  const offs = host0.kids.map(function (d) {
    const mm = /left:(-?[0-9.]+)px;top:(-?[0-9.]+)px;/.exec(d.style.cssText);
    return [parseFloat(mm[1]), parseFloat(mm[2])];
  });
  eq(JSON.stringify(offs), JSON.stringify([[0, 0], [BASIS, 0], [0, BASIS]]),
     'S2f the probes sit at the local origin and on both axes');
  ok(host0.kids.every(function (d) { return /width:0;height:0/.test(d.style.cssText); }),
     'S2g and they are zero-size, so they cannot affect layout');
  ok(host0.kids.every(function (d) { return /pointer-events:none/.test(d.style.cssText); }),
     'S2h nor swallow a pointer event');
})();

section('S3 the inverse, against known transforms');
const CASES = [
  ['identity',            [1, 0, 0, 1],                 [0, 0]],
  ['translated',          [1, 0, 0, 1],                 [137, -64]],
  ['board zoom 2x',       [2, 0, 0, 2],                 [10, 20]],
  ['board zoom 0.5x',     [0.5, 0, 0, 0.5],             [-5, 7]],
  ['rotated 5deg',        rot(5),                       [300, 200]],
  ['rotated 15deg',       rot(15),                      [0, 0]],
  ['rotated 30deg',       rot(30),                      [411, 97]],
  ['rotated 45deg',       rot(45),                      [-20, 15]],
  ['rotated 90deg',       rot(90),                      [80, 240]],
  ['rotated -20deg',      rot(-20),                     [12, 34]],
  ['rotated 137deg',      rot(137),                     [7, 7]],
  ['flipped H',           [-1, 0, 0, 1],                [500, 300]],
  ['flipped V',           [1, 0, 0, -1],                [500, 300]],
  ['flipped both',        [-1, 0, 0, -1],               [1, 2]],
  ['rot45 + scale2',      rot(45, 2),                   [33, 44]],
  ['rot45 + scale2 + flipH', mul(rot(45), mul([2, 0, 0, 2], [-1, 0, 0, 1])), [5, 6]],
  ['rot30 + flipV',       mul(rot(30), [1, 0, 0, -1]),  [60, 70]]
];
const PTS = [[0, 0], [BASIS, 0], [0, BASIS], [123.5, 47.25], [-30, 90], [7.5, -2.25]];
CASES.forEach(function (c) {
  const name = c[0], m = c[1], o = c[2];
  let worst = 0;
  PTS.forEach(function (p) {
    const X = o[0] + m[0] * p[0] + m[2] * p[1];
    const Y = o[1] + m[1] * p[0] + m[3] * p[1];
    const got = SB.api.toLocal(makeHost(m, o), X, Y);
    if (!got) { worst = Infinity; return; }
    worst = Math.max(worst, Math.abs(got[0] - p[0]), Math.abs(got[1] - p[1]));
  });
  ok(worst < 1e-6, 'S3 ' + name.padEnd(24) + ' inverts exactly (worst err ' +
     (worst === Infinity ? 'null!' : worst.toExponential(1)) + ')');
});

section('S4 the numbers that mattered, stated as coordinates');
(function () {
  // A 400x227 frame whose card is rotated 30deg, at 30%/40% of the content.
  const m = rot(30), o = [411, 97];
  const h = makeHost(m, o);
  const X = o[0] + m[0] * 120 + m[2] * 90;    // content-local (120, 90)
  const Y = o[1] + m[1] * 120 + m[3] * 90;
  // A degenerate basis answers null; read it as an off-scale point so the
  // section FAILS instead of throwing (a thrown suite prints no tally).
  const got = SB.api.toLocal(h, X, Y) || [-9999, -9999];
  near(got[0], 120, 'S4a rotated 30deg: local x comes back as 120, not ~149');
  near(got[1], 90, 'S4b rotated 30deg: local y comes back as 90, not ~74');
})();
(function () {
  const m = [-1, 0, 0, 1], o = [500, 300];
  const h = makeHost(m, o);
  const X = o[0] + m[0] * 120 + m[2] * 90;
  const Y = o[1] + m[1] * 120 + m[3] * 90;
  // A degenerate basis answers null; read it as an off-scale point so the
  // section FAILS instead of throwing (a thrown suite prints no tally).
  const got = SB.api.toLocal(h, X, Y) || [-9999, -9999];
  near(got[0], 120, 'S4c flipped H: local x is 120, not mirrored to -120');
  near(got[1], 90, 'S4d flipped H: local y is unaffected');
})();

section('S5 the degenerate cases return null instead of lying');
(function () {
  const h = makeHost([1, 0, 0, 1], [0, 0], true);   // every rect is 0,0,0,0
  eq(SB.api.toLocal(h, 10, 10), null, 'S5a a display:none host has no invertible basis -> null');
})();
eq(SB.api.toLocal(null, 1, 2), null, 'S5b no element at all -> null');
(function () {
  // A FRESH host: the whole point is that supplying a basis must not make it
  // grow probes of its own.
  const src = makeHost(rot(30), [5, 6]);
  const b = SB.api.basis(src);
  const fresh = makeHost(rot(30), [5, 6]);
  const X = 5 + rot(30)[0] * 3 + rot(30)[2] * 4;
  const Y = 6 + rot(30)[1] * 3 + rot(30)[3] * 4;
  const got = SB.api.toLocal(fresh, X, Y, b);
  ok(got !== null && Math.abs(got[0] - 3) < 1e-6 && Math.abs(got[1] - 4) < 1e-6,
     'S5c an explicitly supplied basis is used as-is', got);
  eq(fresh.appends, 0, 'S5d and passing one creates no probes on the host');
})();

section('S6 _canvasPoint is wired to it (structural)');
ok(!/getBoundingClientRect/.test(CANVAS_POINT),
   'S6a _canvasPoint no longer touches any getBoundingClientRect');
ok(/kraftedClientToLocal\(wrap, ev\.clientX, ev\.clientY\)/.test(CANVAS_POINT),
   'S6b it maps the pointer into wrap-local space');
ok(/if \(!p\) return \[0, 0\];/.test(CANVAS_POINT),
   'S6c and it has a defined answer when there is no basis');
ok(/_getZoomedContentRect\(\)/.test(CANVAS_POINT),
   'S6d paper mode (video zoom/pan) still resolves against the zoomed rect');
ok(/_getVideoContentRect\(\)/.test(CANVAS_POINT),
   'S6e and the plain path against the content rect');
(function () {
  // Clamping: allowed in the plain path, forbidden in paper mode (strokes on
  // the black margin must keep coords outside [0,1]).
  const iPaper = CANVAS_POINT.indexOf('if (R) {');
  const iPlain = CANVAS_POINT.indexOf('const r = _getVideoContentRect();');
  ok(iPaper > 0 && iPlain > iPaper, 'S6f both branches are present and in order');
  const paper = CANVAS_POINT.slice(iPaper, iPlain);
  const plain = CANVAS_POINT.slice(iPlain);
  ok(!/Math\.min\(1/.test(paper), 'S6g paper mode does NOT clamp to [0,1]');
  ok(/Math\.min\(1/.test(plain) && /Math\.max\(0/.test(plain),
     'S6h the plain path DOES clamp to [0,1]');
})();

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
