#!/usr/bin/env node
/*
 * test_v7_10_0.js — Mac + external mouse must behave like Windows.
 *
 *   A. THE REPORT. "mac 用鼠標時, zoom in out, i want it should be same as
 *      window". It was not: on macOS a plain wheel panned, Ctrl+wheel got
 *      the clamped 2-8% pinch ramp instead of zoomStep, Shift+wheel could
 *      never reach horizontal pan, and scroll-up zoomed OUT.
 *
 *   B. THE ROOT CAUSE. v6.8.21 made every unmodified Mac wheel event pan,
 *      because Chrome renders a fast two-finger swipe as a large integer
 *      deltaY with deltaX === 0 — shape-identical to one mouse notch. That
 *      was true of a SINGLE event. _WheelKind already scores the whole
 *      stream and already reached a 'mouse' verdict for this mouse
 *      (integer deltaY, zero drift, exact repeat, ~200ms apart); the pan
 *      gate simply never asked it. The classifier's verdict was thrown
 *      away at the door.
 *
 *   C. THE FIX. The pan gate now consults the verdict, but only when it is
 *      MOUSE_LOCK confident, so one ambiguous event still pans and a
 *      trackpad keeps two-finger panning. Two guards keep a flick honest:
 *      magnitude alone no longer scores as a notch when events stream in
 *      faster than 30ms, and the exact-repeat tell now needs two samples
 *      instead of three.
 *
 *   D. DIRECTION. `state.naturalScroll ? -e.deltaY : e.deltaY` was written
 *      out three times. It is now wheelZoomDelta(), and a mouse ignores
 *      naturalScroll so scroll-up zooms in, exactly as on Windows.
 *
 * Everything below EXECUTES the sliced source against a stub DOM. An anchor
 * proves the code exists, not that it runs (the v7.4.0 lesson).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(
  process.env.KRAFTED_HTML ? path.resolve(process.env.KRAFTED_HTML) : path.join(ROOT, 'kraftpub-dev.html'),
  'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(c, m) { if (c) { pass++; } else { fail++; fails.push(m); console.log('  FAIL: ' + m); } }
function eq(a, b, m) { ok(a === b, m + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function near(a, b, m, tol) {
  const d = Math.abs(a - b);
  ok(d <= (tol === undefined ? 0.01 : tol), m + '  (got ' + a + ', want ' + b + ', diff ' + d.toFixed(4) + ')');
}
function has(needle, m) { ok(HTML.indexOf(needle) >= 0, m + '  (missing: ' + JSON.stringify(needle.slice(0, 90)) + ')'); }
function lacks(needle, m) { ok(HTML.indexOf(needle) < 0, m + '  (still present: ' + JSON.stringify(needle.slice(0, 90)) + ')'); }
function count(needle, n, m) {
  let c = 0, i = -1;
  while ((i = HTML.indexOf(needle, i + 1)) >= 0) c++;
  eq(c, n, m + '  (found ' + c + ', want ' + n + ')');
}
function section(body) {
  try { body(); } catch (e) { fail++; fails.push('section threw: ' + e.message); console.log('  FAIL: section threw: ' + e.message); }
}

// ═══ 0. slice the real source ════════════════════════════════════════════
function slice(start, end, label) {
  const i = HTML.indexOf(start);
  if (i < 0) throw new Error('slice start not found: ' + label);
  const j = HTML.indexOf(end, i);
  if (j < 0) throw new Error('slice end not found: ' + label);
  return HTML.slice(i, j);
}

const CORE = slice('const _WheelKind = (function() {',
  "if (typeof window !== 'undefined') window._WheelKind", '_WheelKind');
const HELPER = slice('function wheelZoomDelta(e) {', '// SCROLL ZOOM / PAN', 'wheelZoomDelta');
const HANDLER_END = '}, { passive: false });';
const HANDLER = (function () {
  const i = HTML.indexOf("viewport.addEventListener('wheel', e => {");
  if (i < 0) throw new Error('slice start not found: wheel handler');
  const j = HTML.indexOf(HANDLER_END, i);
  if (j < 0) throw new Error('slice end not found: wheel handler');
  return HTML.slice(i, j + HANDLER_END.length);
})();

ok(CORE.length > 1500, '_WheelKind slice looks like the real classifier (' + CORE.length + ' chars)');
ok(HELPER.indexOf('return (') >= 0, 'wheelZoomDelta slice has a body');
ok(HANDLER.indexOf('Platform.mac') >= 0, 'wheel handler slice contains the platform router');

// ═══ 1. build an environment that runs the sliced source ═════════════════
function makeEnv(opts) {
  opts = opts || {};
  const log = { zooms: [], canvas: 0, pan: [] };
  const state = {
    pan: { x: 0, y: 0 },
    zoomStep: opts.zoomStep === undefined ? 1.10 : opts.zoomStep,
    naturalScroll: opts.naturalScroll === undefined ? true : opts.naturalScroll,
    wheelMode: opts.wheelMode || 'auto',
    dragging: null,
    reframing: null
  };
  const win = { state: state, innerWidth: 1440, innerHeight: 900 };
  const Platform = { mac: !!opts.mac, win: !!opts.win, trackpad: !!opts.trackpad };
  const zoomBy = function (f, cx, cy) { log.zooms.push({ f: f, cx: cx, cy: cy }); };
  const updateCanvas = function () { log.canvas++; };
  const noop = function () {};

  const src = 'var _twoFingerPan = false;\n'
    + CORE + '\n' + HELPER + '\n'
    + 'var __h = null;\n'
    + 'var viewport = { addEventListener: function (t, fn) { if (t === "wheel") __h = fn; } };\n'
    + HANDLER + '\n'
    + 'return { setTwoFinger: function (v) { _twoFingerPan = !!v; },'
    + '  fire: function (e) { __h(e); },'
    + '  kind: _WheelKind, delta: wheelZoomDelta, state: state, viewport: viewport };';

  const api = new Function('document', 'state', 'Platform', 'zoomBy', 'updateCanvas',
    'scheduleVisibleItemsUpdate', 'updateStatus', 'rfSetZoom', 'rfSyncUI', 'window', src)(
    { fullscreenElement: null, webkitFullscreenElement: null },
    state, Platform, zoomBy, updateCanvas, noop, noop, noop, noop, win);

  api.log = log;
  api.t = 1000;
  return api;
}

function ev(o) {
  return {
    deltaX: o.dx || 0,
    deltaY: o.dy,
    deltaMode: o.mode === undefined ? 0 : o.mode,
    ctrlKey: !!o.ctrl, metaKey: !!o.meta, shiftKey: !!o.shift,
    clientX: o.cx === undefined ? 700 : o.cx,
    clientY: o.cy === undefined ? 400 : o.cy,
    timeStamp: o.t,
    preventDefault: function () {}
  };
}

// One notch of the mouse the report was about: deltaY 4, no drift, ~196ms
// apart. Straight from Krafted wheel probe v7.10.0.
function notch(env, dir, n, gap) {
  n = n || 1; gap = gap || 196; dir = dir || -1;
  for (let i = 0; i < n; i++) { env.t += gap; env.fire(ev({ dy: dir * 4, t: env.t })); }
}
// A real two-finger swipe: ramps up, decays, drifts sideways.
const TRACKPAD = [1.4, 3.2, 6, 9, 13, 16, 14, 11, 8, 5, 3, 1.6, 0.7];
function swipe(env, n) {
  for (let i = 0; i < n; i++) {
    env.t += 16;
    env.fire(ev({ dy: TRACKPAD[i % TRACKPAD.length], dx: (i % 3 === 0 ? 0.7 : 0), t: env.t }));
  }
}
// A fast flick: crosses NOTCH_FLOOR, but streams at frame rate with no
// repeat. This is the case v6.8.21 was protecting.
const FLICK = [1, 3, 8, 20, 45, 70, 62, 48, 33, 21, 12, 6, 2];
function flick(env) {
  for (let i = 0; i < FLICK.length; i++) { env.t += 16; env.fire(ev({ dy: FLICK[i], t: env.t })); }
}
function last(env) { const z = env.log.zooms; return z.length ? z[z.length - 1] : null; }
function reset(env) { env.log.zooms.length = 0; env.log.canvas = 0; env.state.pan.x = 0; env.state.pan.y = 0; }

// ═══ 2. wiring ═══════════════════════════════════════════════════════════
section(function () {
  has('const MOUSE_LOCK = 0.68;', 'the mouse lock threshold is defined');
  has('function wheelZoomDelta(e) {', 'there is one wheel-zoom direction helper');
  count('wheelZoomDelta(e)', 4, 'one definition and three call sites, no fourth copy');
  lacks('state.naturalScroll ? -e.deltaY : e.deltaY',
    'the inlined direction expression is gone from all three branches');
  has('!macWheelLikeMouse && !_WheelKind.isMouse',
    'the pan gate asks the classifier before it pans');
  has('!_WheelKind.isMouse &&\n      (strongTrackpadPinch',
    'a locked mouse is kept out of the pinch ramp');
  has('if (gap > 600) { recent = []; }',
    'a pause clears the cadence history but keeps the verdict');
  has('ady >= NOTCH_FLOOR && gap > 30',
    'magnitude alone cannot score as a notch when events stream in');
  has('if (recent.length >= 2) {', 'the exact-repeat tell needs two samples');
  has('verdict === \'mouse\' && confidence >= MOUSE_LOCK',
    'isMouse is gated on the lock, not on one event');
});

// ═══ 3. the classifier, executed ═════════════════════════════════════════
section(function () {
  const env = makeEnv({ mac: true });
  notch(env, -1, 1);
  ok(env.kind.isMouse === false, 'one notch is not enough to lock (confidence ' + env.kind.confidence.toFixed(2) + ')');
  notch(env, -1, 1);
  ok(env.kind.isMouse === true, 'the second agreeing notch locks as a mouse');
  near(env.kind.confidence, 0.68, 'the lock sits exactly at MOUSE_LOCK', 0.001);
  notch(env, 1, 1);
  ok(env.kind.isMouse === true, 'a notch in the other direction keeps the lock');

  // The pause that used to wipe the verdict (v6.8.21 reset) must not.
  reset(env); env.t += 4000;
  notch(env, -1, 1, 900);
  ok(env.kind.isMouse === true, 'the lock survives a long pause');

  // A trackpad must never lock, however it is swiped.
  const tp = makeEnv({ mac: true });
  let locked = false;
  for (let i = 0; i < 13; i++) { swipe(tp, 1); if (tp.kind.isMouse) locked = true; }
  ok(locked === false, 'a two-finger swipe never locks as a mouse');
  ok(tp.kind.isTrackpad === true, 'a two-finger swipe is classified as a trackpad');

  const fl = makeEnv({ mac: true });
  locked = false;
  for (let i = 0; i < FLICK.length; i++) {
    env.t += 0;
    fl.t += 16; fl.fire(ev({ dy: FLICK[i], t: fl.t }));
    if (fl.kind.isMouse) locked = true;
  }
  ok(locked === false, 'a fast flick never locks as a mouse (the v6.8.21 regression)');
  ok(fl.kind.isTrackpad === true, 'a fast flick is classified as a trackpad');

  // Pinned modes stay authoritative.
  eq(makeEnv({ mac: true, wheelMode: 'mouse' }).kind.isMouse, true, 'pinned mouse is mouse from event one');
  eq(makeEnv({ mac: true, wheelMode: 'trackpad' }).kind.isMouse, false, 'pinned trackpad is never mouse');
});

// ═══ 4. direction: Mac + mouse must equal Windows ════════════════════════
section(function () {
  const mac = makeEnv({ mac: true, naturalScroll: true });   // Mac out of the box
  notch(mac, -1, 2);
  ok(mac.kind.isMouse, 'precondition: the Mac environment is locked on a mouse');
  const win = makeEnv({ win: true, naturalScroll: false });  // Windows out of the box

  // plain wheel up
  reset(mac); notch(mac, -1, 1); const macUp = last(mac).f;
  reset(win); win.t += 120; win.fire(ev({ dy: -100, mode: 1, t: win.t })); const winUp = last(win).f;
  eq(macUp, winUp, 'scroll up zooms by the same factor on Mac and Windows');
  near(macUp, 1.10, 'and that factor is zoomStep, i.e. zoom IN on scroll up', 0.0001);

  // plain wheel down
  reset(mac); notch(mac, 1, 1); const macDown = last(mac).f;
  reset(win); win.t += 120; win.fire(ev({ dy: 100, mode: 1, t: win.t })); const winDown = last(win).f;
  eq(macDown, winDown, 'scroll down zooms by the same factor on Mac and Windows');
  near(macDown, 1 / 1.10, 'and that factor is 1/zoomStep, i.e. zoom OUT on scroll down', 0.0001);

  // Ctrl + wheel: the mouse branch, not the pinch ramp
  reset(mac); mac.t += 196; mac.fire(ev({ dy: -4, ctrl: true, t: mac.t })); const macCtrl = last(mac).f;
  reset(win); win.t += 120; win.fire(ev({ dy: -100, mode: 1, ctrl: true, t: win.t })); const winCtrl = last(win).f;
  eq(macCtrl, winCtrl, 'Ctrl+wheel gives the same step on Mac and Windows');
  near(macCtrl, 1.10, 'Ctrl+wheel uses zoomStep, not the 2-8% pinch ramp', 0.0001);

  // Cmd + wheel (Mac only) uses the same step as Windows Ctrl+wheel
  reset(mac); mac.t += 196; mac.fire(ev({ dy: -4, meta: true, t: mac.t }));
  eq(last(mac).f, winCtrl, 'Cmd+wheel matches the Windows Ctrl+wheel step');

  // An unlocked Mac still honours naturalScroll, so nothing else moved.
  const nat = makeEnv({ mac: true, naturalScroll: true, wheelMode: 'trackpad' });
  nat.t += 196; nat.fire(ev({ dy: -4, meta: true, t: nat.t }));
  near(last(nat).f, 1 / 1.10, 'a trackpad still honours natural scroll', 0.0001);
});

// ═══ 5. routing: what actually happens on a plain wheel ══════════════════
section(function () {
  const env = makeEnv({ mac: true });
  notch(env, -1, 1);
  eq(env.log.zooms.length, 0, 'the very first notch after load still pans (known warm-up)');
  eq(env.log.canvas, 1, 'and that first notch moved the canvas instead of zooming');

  reset(env); notch(env, -1, 1);
  eq(env.log.zooms.length, 1, 'from the second notch on, a plain wheel zooms');
  eq(env.log.canvas, 0, 'and it no longer pans');

  // A locked mouse still loses to a real two-finger gesture.
  const tp = makeEnv({ mac: true });
  notch(tp, -1, 3);
  tp.setTwoFinger(true);
  reset(tp); swipe(tp, 3);
  eq(tp.log.zooms.length, 0, 'two-finger pan still wins over a locked mouse');
  ok(tp.log.canvas >= 3, 'and it pans the canvas, as before');

  // A trackpad-only session never zooms on a plain swipe.
  const tp2 = makeEnv({ mac: true });
  swipe(tp2, 13);
  eq(tp2.log.zooms.length, 0, 'a trackpad never zooms on a two-finger swipe');
  ok(tp2.log.canvas >= 13, 'it pans, every time');

  // Shift + wheel is horizontal pan, the Figma/Photoshop convention.
  const sh = makeEnv({ mac: true });
  notch(sh, -1, 2);
  reset(sh); sh.t += 196; sh.fire(ev({ dy: -4, shift: true, t: sh.t }));
  eq(sh.log.zooms.length, 0, 'Shift+wheel does not zoom');
  ok(Math.abs(sh.state.pan.x) > 0, 'Shift+wheel pans horizontally (pan.x = ' + sh.state.pan.x + ')');
  eq(sh.state.pan.y, 0, 'Shift+wheel does not pan vertically');
});

// ═══ 6. Windows is untouched ═════════════════════════════════════════════
section(function () {
  const win = makeEnv({ win: true, naturalScroll: false });
  win.t += 120; win.fire(ev({ dy: -100, mode: 1, t: win.t }));
  eq(win.log.zooms.length, 1, 'a Windows mouse wheel still zooms');
  eq(win.log.canvas, 0, 'and still does not pan');
  near(last(win).f, 1.10, 'by zoomStep, scroll up = zoom in', 0.0001);

  // The Windows pan gate is `(two-finger && pixel mode)` — unchanged.
  const wt = makeEnv({ win: true, naturalScroll: false });
  wt.setTwoFinger(true);
  wt.t += 120; wt.fire(ev({ dy: 20, mode: 0, t: wt.t }));
  eq(wt.log.zooms.length, 0, 'a Windows precision touchpad still pans');
  ok(wt.log.canvas >= 1, 'via updateCanvas, as before');

  // ...which only works because the gate is an AND. A pixel-mode wheel with
  // no fingers down must still zoom, or every smooth-scroll mouse on Windows
  // would pan instead. (Found by mutation: `&&` -> `||` survived once.)
  const wp = makeEnv({ win: true, naturalScroll: false });
  wt.t += 120;
  wp.t += 120; wp.fire(ev({ dy: 20, mode: 0, t: wp.t }));
  eq(wp.log.zooms.length, 1, 'a pixel-mode wheel with no two-finger gesture still zooms on Windows');
  eq(wp.log.canvas, 0, 'and does not pan');
});

// ═══ 7. the standalone probe must not drift from the source ══════════════
// The probe is a standalone HTML file, so it cannot slice the source and
// carries its own copy of the classifier. An untested copy is a copy that
// lies. Feed both the same three streams and demand the same verdicts.
section(function () {
  const probePath = path.join(__dirname, 'wheel_probe_v7_10_0.html');
  ok(fs.existsSync(probePath), 'the probe is still alongside the suite');
  const probe = fs.readFileSync(probePath, 'utf8');
  const i = probe.indexOf('var K = (function () {');
  const j = probe.indexOf('// _twoFingerPan is false');
  ok(i >= 0 && j > i, 'the probe still carries a classifier copy');
  const probeK = new Function(probe.slice(i, j) + '\nreturn K;')();

  // A fresh environment per stream: the classifier is stateful by design, so
  // reusing one would compare the probe's history against the source's.
  function agree(stream, label) {
    const env = makeEnv({ mac: true });
    probeK.reset();
    let bad = 0;
    for (let k = 0; k < stream.length; k++) {
      const e = ev({ dy: stream[k].dy, dx: stream[k].dx, t: 5000 + k * stream[k].gap });
      probeK.classify(e);
      env.fire(e);
      if (probeK.locked('auto') !== env.kind.isMouse) bad++;
    }
    eq(bad, 0, 'the probe agrees with the source on ' + label
      + ' (' + stream.length + ' events compared)');
    return bad;
  }
  const mouseStream = [];
  for (let k = 0; k < 8; k++) mouseStream.push({ dy: (k % 2 ? 4 : -4), dx: 0, gap: 196 });
  const flickStream = FLICK.map(d => ({ dy: d, dx: 0, gap: 16 }));
  const swipeStream = TRACKPAD.map((d, k) => ({ dy: d, dx: (k % 3 === 0 ? 0.7 : 0), gap: 16 }));

  const total = agree(mouseStream, 'a mouse stream')
    + agree(flickStream, 'a flick')
    + agree(swipeStream, 'a two-finger swipe');
  eq(total, 0, 'the probe and the source agree on every stream');
});

// ═══ 8. the version ══════════════════════════════════════════════════════
section(function () {
  has('<title>Krafted v7.14.0', 'the title carries the new version');
  has("KRAFTED_VERSION = '7.14.0'", 'KRAFTED_VERSION carries the new version');
  const swPath = process.env.KRAFTED_SW
    ? path.resolve(process.env.KRAFTED_SW)
    : path.join(ROOT, 'Krafted', 'docs', 'sw.js');
  const sw = fs.readFileSync(swPath, 'utf8');
  ok(sw.indexOf('7.14.0') >= 0, 'the service worker carries the new version');
});

// ═══ report ══════════════════════════════════════════════════════════════
if (fail) {
  console.log('\n' + fail + ' FAILED of ' + (pass + fail));
  fails.forEach(m => console.log('  - ' + m));
  process.exit(1);
}
console.log('ALL PASS (' + pass + ' assertions)');
