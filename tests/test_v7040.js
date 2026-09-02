// v7.0.40 regression suite
//   1) frame-comment export must capture ONE PICTURE PER COMMENT, not one for
//      the whole batch  (the "zip only has one image" report)
//   2) named views (batch-5 proposal G) — ids not coordinates, camera flights,
//      the Present tape
//   3) A/B compare (batch-5 proposal E) — an overlay, not a second renderer
//
// Behaviour assertions compare against the SPEC constants below, never against
// a value read out of the source (that would be tautological). A separate
// assertion pins each app constant to the spec so drift is caught.
//
// The functions under test are EXTRACTED FROM THE REAL SOURCE and executed —
// a grep that finds "seeked" somewhere in a 36K-line file proves nothing about
// whether the capture actually waits for it.
const fs = require('fs');
const path = require('path');

// KRAFTED_HTML / KRAFTED_SW let the mutation check point the suite at a
// deliberately broken COPY, so the real dev file is never touched.
const HTML = process.env.KRAFTED_HTML
  ? path.resolve(process.env.KRAFTED_HTML)
  : path.resolve(__dirname, '../../kraftpub-dev.html');
const src = fs.readFileSync(HTML, 'utf8');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; console.log('  FAIL: ' + label); }
}
function eq(actual, expected, label) {
  ok(actual === expected, label + '  (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')');
}
function near(a, b, tol, label) {
  ok(Math.abs(a - b) <= tol, label + '  (got ' + a + ', want ~' + b + ' ±' + tol + ')');
}
function count(hay, needle) { return hay.split(needle).length - 1; }

// ── spec constants (independent of the source) ───────────────────────────
const EXPECT_SEEK_TIMEOUT   = 8000;  // safety net for a seek that never lands
const EXPECT_RVFC_FALLBACK  = 600;   // rVFC is not guaranteed on a paused video
const EXPECT_VIEW_MAX_ZOOM  = 1;     // never upscale — magnified pixels kill a pitch
const EXPECT_VIEW_MARGIN    = 64;
const EXPECT_FLIGHT_MS      = 620;
const EXPECT_DWELL_MS       = 4000;
const EXPECT_PRESENT_TIMER  = EXPECT_FLIGHT_MS + EXPECT_DWELL_MS;  // 4620
const EXPECT_SNAP_MAX_W     = 1920;

function slice(startMarker, endMarker, label) {
  const a = src.indexOf(startMarker);
  if (a < 0) { console.log('  FAIL: anchor not found: ' + label); fail++; return ''; }
  const b = src.indexOf(endMarker, a);
  if (b < 0) { console.log('  FAIL: end anchor not found: ' + label); fail++; return ''; }
  return src.slice(a, b);
}
// Drop whole-line comments, so an assertion about CODE is never satisfied (or
// defeated) by the comment explaining it. The alt-digit handler, for instance,
// documents `ev.key >= '0'` as the thing NOT to do.
function codeOnly(s) {
  return s.split('\n').filter(function (l) { return l.trim().indexOf('//') !== 0; }).join('\n');
}

// A fixed window around a marker — for asserting a neighbourhood without
// having to name the next function down (those move).
function around(marker, before, after, label) {
  const a = src.indexOf(marker);
  if (a < 0) { console.log('  FAIL: anchor not found: ' + label); fail++; return ''; }
  return src.slice(Math.max(0, a - before), a + after);
}

// A tiny controllable clock. Real timers would make this suite either slow
// (600ms per rVFC fallback) or flaky; what the capture tests measure is the
// ORDER in which things settle, and only a clock I drive can show that.
function makeScheduler() {
  let tid = 0, timers = [], raf = [], now = 0;
  return {
    setTimeout: function (fn, ms) { const id = ++tid; timers.push({ id: id, ms: ms, fn: fn }); return id; },
    clearTimeout: function (id) { timers = timers.filter(function (t) { return t.id !== id; }); },
    requestAnimationFrame: function (fn) { raf.push(fn); return raf.length; },
    now: function () { return now; },
    setNow: function (t) { now = t; },
    fireTimers: function (pred) {
      const hit = timers.filter(pred || function () { return true; });
      timers = timers.filter(function (t) { return hit.indexOf(t) < 0; });
      hit.forEach(function (t) { t.fn(); });
    },
    pendingTimerDelays: function () { return timers.map(function (t) { return t.ms; }); },
    frame: function () { const q = raf; raf = []; q.forEach(function (f) { f(now); }); },
  };
}
// Animation frames + microtasks. Deliberately NO timers: nothing in the
// capture may settle on its own.
async function flush(sched) {
  for (let i = 0; i < 4; i++) { sched.frame(); await Promise.resolve(); }
  await Promise.resolve(); await Promise.resolve();
}

// ══════════════════════════════════════════════════════════════════════════
//  A fake <video> that obeys the HTML spec the way the bug depends on:
//  assigning currentTime moves the OFFICIAL PLAYBACK POSITION immediately, so
//  reading it back reports the target long BEFORE the decoder has painted that
//  frame. Any capture that trusts currentTime grabs whatever was last on
//  screen — that is the whole bug.
// ══════════════════════════════════════════════════════════════════════════
function makeVideo(opts) {
  opts = opts || {};
  const listeners = {};
  const v = {
    readyState: (opts.readyState === undefined) ? 2 : opts.readyState,
    seeking: false,
    _t: (opts.time === undefined) ? 0 : opts.time,
    videoWidth: 1920, videoHeight: 1080,
    get currentTime() { return this._t; },
    set currentTime(t) { this._t = t; this.seeking = true; },
    addEventListener: function (n, fn) { (listeners[n] = listeners[n] || []).push(fn); },
    removeEventListener: function (n, fn) {
      if (!listeners[n]) return;
      const i = listeners[n].indexOf(fn);
      if (i >= 0) listeners[n].splice(i, 1);
    },
    fire: function (n) { (listeners[n] || []).slice().forEach(function (f) { f(); }); },
    listenerCount: function (n) { return (listeners[n] || []).length; },
  };
  if (opts.rvfc === 'silent') {
    // present, but never calls back — not guaranteed on a paused element
    v.requestVideoFrameCallback = function () { return 1; };
    v.cancelVideoFrameCallback = function () {};
  } else if (opts.rvfc !== 'none') {
    v.requestVideoFrameCallback = function (fn) { v._rvfc = fn; return 1; };
    v.cancelVideoFrameCallback = function () { v._rvfc = null; };
    v.fireRvfc = function () { const f = v._rvfc; v._rvfc = null; if (f) f(); };
  }
  return v;
}

const capBlock = slice(
  'var VIDEO_ANNO_SEEK_TIMEOUT = 8000;',
  'async function videoAnnoExportComments() {',
  'shared seek-and-capture'
);

function buildCaptureApi() {
  const sched = makeScheduler();
  const captured = [];
  const api = new Function(
    'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'videoAnnoCaptureSnapshot',
    capBlock + '\nreturn { seek: videoAnnoSeekAndCapture, TIMEOUT: VIDEO_ANNO_SEEK_TIMEOUT };'
  )(
    sched.setTimeout, sched.clearTimeout, sched.requestAnimationFrame,
    function (vid, maxW, strokes) {
      captured.push({ maxW: maxW, strokes: strokes, at: vid.currentTime });
      return 'data:image/jpeg;base64,FRESH';
    }
  );
  api.captured = captured;
  api.sched = sched;
  return api;
}

// ══════════════════════════════════════════════════════════════════════════
//  1. FRAME-COMMENT CAPTURE
// ══════════════════════════════════════════════════════════════════════════
async function captureTests() {
  console.log('— frame-comment capture —');

  // ── 1a. one behaviour, one implementation ───────────────────────────────
  // The project's recurring failure mode: N hand-rolled copies of the same
  // wait that drift apart. The export was fixed first; Send-to-Board still had
  // the broken poll. Both must now call the same function.
  eq(count(src, 'function videoAnnoSeekAndCapture('), 1, 'exactly ONE seek-and-capture implementation');
  eq(count(src, 'videoAnnoSeekAndCapture('), 3, 'one definition + two call sites (export + Send-to-Board)');
  eq(count(src, 'tryCapture'), 0, 'the hand-rolled retry loop is gone');
  eq(count(src, '0) - (c.time || 0)) < 0.05'), 0, 'the broken currentTime poll is gone');
  ok(capBlock.indexOf("v.addEventListener('seeked', onSeeked)") >= 0, 'the capture waits on the seeked event');
  ok(capBlock.indexOf('v.currentTime = target;') >= 0, 'the capture still performs the seek');
  ok(capBlock.indexOf('requestVideoFrameCallback') >= 0 &&
     capBlock.indexOf('requestAnimationFrame(') >= 0, 'a frame callback is raced against an rAF fallback');

  // ── 1b. THE BUG: currentTime already reads the target, no frame painted ──
  {
    const v = makeVideo({ time: 0 });
    const api = buildCaptureApi();
    let resolved = null, resolveCount = 0;
    api.seek(v, { time: 12.5, snapshot: 'data:image/jpeg;base64,STORED' }, EXPECT_SNAP_MAX_W)
      .then(function (u) { resolved = u; resolveCount++; });

    // Every animation frame and every microtask runs. currentTime says 12.5,
    // so the OLD code resolved right here — and drew whatever was on screen.
    await flush(api.sched);
    eq(resolveCount, 0, 'a seek whose frame has not been painted does not resolve');
    eq(resolved, null, 'nothing is captured before the decoder presents the frame');
    eq(api.captured.length, 0, 'no drawImage before seeked');

    // Now the decoder actually lands the frame.
    v.seeking = false;
    v.fire('seeked');
    ok(v.fireRvfc !== undefined, 'requestVideoFrameCallback is used when available');
    v.fireRvfc();
    await flush(api.sched);

    eq(resolveCount, 1, 'the capture resolves exactly once');
    eq(resolved, 'data:image/jpeg;base64,FRESH', 'the fresh frame is used, not the stale stored snapshot');
    eq(api.captured.length, 1, 'exactly one frame captured');
    eq(api.captured[0].at, 12.5, 'captured at the comment timestamp');
    eq(api.captured[0].maxW, EXPECT_SNAP_MAX_W, 'export captures at the 1920 spec width');
  }

  // ── 1c. the safety net ──────────────────────────────────────────────────
  // A seek that never lands must still settle, and must fall back to the
  // comment's stored snapshot rather than hang the export forever.
  {
    const v = makeVideo({ time: 0 });
    const api = buildCaptureApi();
    let resolved = 'UNSET';
    api.seek(v, { time: 4, snapshot: 'data:image/jpeg;base64,STORED' }, 1280)
      .then(function (u) { resolved = u; });
    await flush(api.sched);
    ok(api.sched.pendingTimerDelays().indexOf(EXPECT_SEEK_TIMEOUT) >= 0, 'a seek timeout is armed');
    api.sched.fireTimers(function (t) { return t.ms === EXPECT_SEEK_TIMEOUT; });
    await flush(api.sched);
    eq(resolved, 'data:image/jpeg;base64,STORED', 'a seek that never lands falls back to the stored snapshot');
    eq(v.listenerCount('seeked'), 0, 'the seeked listener is removed on settle');
  }

  // ── 1d. requestVideoFrameCallback is NOT trusted alone ──────────────────
  // It is not guaranteed to fire on a paused element, so it must be raced
  // against a timer — otherwise a paused export hangs on the first frame.
  {
    const v = makeVideo({ time: 0, rvfc: 'silent' });
    const api = buildCaptureApi();
    let resolved = 'UNSET';
    api.seek(v, { time: 7, snapshot: '' }, 1280).then(function (u) { resolved = u; });
    await flush(api.sched);
    v.seeking = false;
    v.fire('seeked');
    await flush(api.sched);
    eq(resolved, 'UNSET', 'a silent rVFC does not settle the capture on its own');
    api.sched.fireTimers(function (t) { return t.ms === EXPECT_RVFC_FALLBACK; });
    await flush(api.sched);
    eq(resolved, 'data:image/jpeg;base64,FRESH', 'the rVFC timer fallback lands the capture');
  }

  // ── 1e. a seek that lands somewhere else is REJECTED ────────────────────
  // Without this, a codec that snaps to the nearest keyframe silently exports
  // the wrong frame and the reviewer never knows.
  {
    const v = makeVideo({ time: 0 });
    const api = buildCaptureApi();
    let resolved = 'UNSET';
    api.seek(v, { time: 30, snapshot: 'data:image/jpeg;base64,STORED' }, 1280)
      .then(function (u) { resolved = u; });
    await flush(api.sched);
    v.seeking = false;
    v._t = 21.4;                 // a keyframe 8.6s away — clearly not the target
    v.fire('seeked');
    if (v.fireRvfc) v.fireRvfc();
    await flush(api.sched);
    eq(resolved, 'UNSET', 'a seek landing >0.5s away is rejected, not captured');
    eq(api.captured.length, 0, 'no capture from a seek that went elsewhere');
    eq(v.listenerCount('seeked'), 1, 'the listener stays armed for the next seeked');

    v._t = 29.9;                 // now genuinely on the frame
    v.fire('seeked');
    if (v.fireRvfc) v.fireRvfc();
    await flush(api.sched);
    eq(resolved, 'data:image/jpeg;base64,FRESH', 'a seek within tolerance is accepted');
  }

  // ── 1f. already sitting on the frame: no seek, no stall ─────────────────
  {
    const v = makeVideo({ time: 9, rvfc: 'none' });
    const api = buildCaptureApi();
    let resolved = 'UNSET';
    api.seek(v, { time: 9, snapshot: 'data:image/jpeg;base64,STORED' }, 1280)
      .then(function (u) { resolved = u; });
    await flush(api.sched);
    eq(resolved, 'data:image/jpeg;base64,FRESH', 'an already-positioned video captures without a seek');
    eq(api.captured.length, 1, 'and captures exactly once');
  }

  // ── 1g. app constant matches the spec ───────────────────────────────────
  eq(buildCaptureApi().TIMEOUT, EXPECT_SEEK_TIMEOUT, 'seek timeout matches spec');

  // ── 1h. the trim loop must be suspended for the whole batch ─────────────
  // A trimmed clip's timeupdate yanks the playhead back to trimStart, so on a
  // trimmed clip `seeked` NEVER arrives and every frame times out.
  {
    const trim = slice('// v7.0.40: _kraftedSuppressTrimLoop lets a batch capture',
                       'function resetVideoTrim', 'trim loop handlers');
    eq(count(trim, 'if (v._kraftedSuppressTrimLoop) return;'), 2,
       'both timeupdate and play honour the suppression flag');

    const exp = slice('const v = item.video;', 'const EXPORT_SNAP_MAX_W = 1920;', 'export capture setup');
    ok(exp.indexOf('v._kraftedSuppressTrimLoop = true;') >= 0, 'the export suspends the trim loop');
    const after = slice('const results = [];', 'const rawFileName =', 'export capture loop');
    ok(after.indexOf('v._kraftedSuppressTrimLoop = false;') >= 0, 'the export restores the trim loop');
    ok(after.indexOf('v.currentTime = prevTime;') >= 0, 'the export restores the playhead');
    ok(after.indexOf('resumeMediaEl(v);') >= 0, 'the export restores play state via the LRU budget');
    // The flag has to stay set across the playhead restore: the restore itself
    // moves the video, and the loop must not grab it back mid-restore.
    ok(after.indexOf('v.currentTime = prevTime;') < after.indexOf('_kraftedSuppressTrimLoop = false;'),
       'the trim loop stays suspended across the playhead restore');

    const send = slice('const SNAP_MAX_W = 0;',
                       '// ── 4) Collapse intermediate undo snapshots',
                       'send-to-board capture setup');
    ok(send.indexOf('v._kraftedSuppressTrimLoop = true;') >= 0, 'Send-to-Board suspends the trim loop');
    ok(send.indexOf('v._kraftedSuppressTrimLoop = false;') >= 0, 'Send-to-Board restores the trim loop');
    ok(send.indexOf('v.currentTime = prevTime;') >= 0, 'Send-to-Board restores the playhead');
    // The restore used to sit ABOVE the capture loop, so it handed the
    // playhead back and then seeked the video N more times. Assert ordering.
    ok(send.indexOf('v.currentTime = prevTime;') > send.indexOf('_kraftedSuppressTrimLoop = true;'),
       'Send-to-Board restores the playhead AFTER the suspending the loop, not before');
    ok(send.indexOf('videoAnnoSeekAndCapture') >= 0, 'Send-to-Board uses the shared capture');

    // Adding a comment is a DIFFERENT behaviour: capture the frame the user is
    // parked on, right now. It must not start seeking — that would move the
    // playhead out from under them mid-review.
    const add = slice('function videoAnnoAddComment(text, targetItem) {',
                      '// Keep the list sorted by frame', 'add comment');
    ok(add.indexOf('videoAnnoCaptureSnapshot(') >= 0, 'adding a comment captures a snapshot');
    ok(!codeOnly(add).match(/\.currentTime\s*=/), 'adding a comment never moves the playhead');
    ok(add.indexOf('videoAnnoSeekAndCapture') < 0, 'adding a comment does not use the seek path');
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  2. NAMED VIEWS  (batch-5 proposal G)
// ══════════════════════════════════════════════════════════════════════════
const viewsBlock = slice('var VIEW_MAX_ZOOM = 1;', '// Alt+1..9, Alt+0', 'views module');

// The views module reaches for a lot of board machinery. Everything it does not
// own is stubbed here; the functions under test are the real source.
function buildViews() {
  const sched = makeScheduler();
  const up = { count: 0 };
  const toasts = [];
  const el = {
    _cls: {},
    classList: {
      toggle: function (n, on) { if (on === undefined) el._cls[n] = !el._cls[n]; else el._cls[n] = !!on; },
      add: function (n) { el._cls[n] = true; },
      remove: function (n) { el._cls[n] = false; },
      contains: function (n) { return !!el._cls[n]; },
    },
    innerHTML: '', appendChild: function () {}, contains: function () { return false; },
  };
  const doc = {
    getElementById: function (id) { return (id === 'views-panel' || id === 'views-list') ? el : null; },
    // v7.0.48: a row being renamed is a real <input>, so the fake has to
    // accept what the panel does to one — setAttribute, focus, select. It was
    // the fake that was incomplete here, not the panel.
    createElement: function () {
      return { className: '', style: {}, disabled: false, appendChild: function () {},
               addEventListener: function () {},
               setAttribute: function () {},
               focus: function () {}, select: function () {}, scrollIntoView: function () {},
               classList: { add: function () {}, toggle: function () {} },
               set title(v) {}, set textContent(v) {} };
    },
    addEventListener: function () {}, removeEventListener: function () {},
  };
  const st = {
    views: [], _activeViewIndex: -1, _viewFlight: 0, _present: null,
    selected: new Set(), items: [], texts: [], todos: [], mindmaps: [],
    zoom: 1, pan: { x: 0, y: 0 },
  };
  const g = { nextViewId: undefined };
  const win = { innerWidth: 1000, innerHeight: 800 };
  const api = new Function(
    'state', 'G', 'window', 'document', 'performance', 'requestAnimationFrame',
    'setTimeout', 'clearTimeout', 'toast', 'pushUndo', 'scheduleAutoSave',
    'updateCanvas', 'worldBBoxOf', 'localStorage',
    viewsBlock + '\nreturn { viewLiveIds: viewLiveIds, viewBBox: viewBBox, viewCamera: viewCamera,'
             + ' nextViewId: nextViewId, saveViewFromSelection: saveViewFromSelection,'
             + ' gotoView: gotoView, flyToCamera: flyToCamera, presentAdvance: presentAdvance,'
             + ' stopPresent: stopPresent, deleteView: deleteView, moveView: moveView,'
             + ' MAX_ZOOM: VIEW_MAX_ZOOM, MARGIN: VIEW_FIT_MARGIN,'
             + ' FLIGHT: VIEW_FLIGHT_MS, DWELL: PRESENT_DWELL_MS };'
  )(
    st, g, win, doc,
    { now: sched.now },
    sched.requestAnimationFrame,
    sched.setTimeout, sched.clearTimeout,
    function (m) { toasts.push(m); },
    function () {}, function () {},
    function () { up.count++; },
    // worldBBoxOf: the real one unions every node kind; that is not what is
    // under test here, so a faithful union over the same four lists.
    function (ids) {
      const set = ids instanceof Set ? ids : new Set(ids);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, found = false;
      [st.items, st.texts, st.todos, st.mindmaps].forEach(function (list) {
        (list || []).forEach(function (n) {
          if (!set.has(n.id)) return;
          found = true;
          minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
          maxX = Math.max(maxX, n.x + (n.w || 0)); maxY = Math.max(maxY, n.y + (n.h || 0));
        });
      });
      return found ? { minX: minX, minY: minY, maxX: maxX, maxY: maxY } : null;
    },
    { getItem: function () { return null; }, setItem: function () {} }
  );
  api.__state = st; api.__G = g; api.__win = win;
  api.updates = up; api.toasts = toasts; api.sched = sched; api.el = el;
  return api;
}

function viewsTests() {
  console.log('— named views —');

  // ── 2a. spec constants ──────────────────────────────────────────────────
  {
    const a = buildViews();
    eq(a.MAX_ZOOM, EXPECT_VIEW_MAX_ZOOM, 'views never upscale (spec 1)');
    eq(a.MARGIN, EXPECT_VIEW_MARGIN, 'view fit margin matches spec');
    eq(a.FLIGHT, EXPECT_FLIGHT_MS, 'camera flight duration matches spec');
    eq(a.DWELL, EXPECT_DWELL_MS, 'present dwell matches spec');
  }

  // ── 2b. IDs, not coordinates ────────────────────────────────────────────
  // A view remembers WHICH items it frames. A frozen rectangle would point at
  // empty space the moment anything moves — and on a board that gets tidied
  // daily, that is immediately.
  {
    const a = buildViews();
    const st = a.__state;
    st.items = [{ id: 1, x: 0, y: 0, w: 100, h: 100 }, { id: 2, x: 200, y: 0, w: 100, h: 100 }];
    st.views = [{ id: 1, name: 'A', ids: [1, 2], panX: 0, panY: 0, zoom: 1 }];

    eq(a.viewLiveIds(st.views[0]).length, 2, 'a view reports its live ids');
    near(a.viewCamera(st.views[0]).cx, 150, 0.001, 'camera centres on the union bbox');

    // Now rearrange the board — the thing that broke frozen rectangles.
    st.items[0].x = 1000; st.items[0].y = 1000;
    st.items[1].x = 1100; st.items[1].y = 1000;
    const after = a.viewCamera(st.views[0]);
    near(after.cx, 1100, 0.001, 'the camera follows the items, not the saved coordinates');
    near(after.cy, 1050, 0.001, 'the camera follows on Y too');
  }

  // ── 2c. dead ids drop out; pan/zoom is only a fallback ──────────────────
  {
    const a = buildViews();
    const st = a.__state;
    st.items = [{ id: 1, x: 0, y: 0, w: 100, h: 100 }];
    const v = { id: 1, name: 'A', ids: [1, 77, 88], panX: -250, panY: -100, zoom: 0.5 };
    eq(a.viewLiveIds(v).length, 1, 'ids that no longer exist are filtered out');
    st.items = [];
    eq(a.viewLiveIds(v).length, 0, 'a view whose items are all gone frames nothing');
    eq(a.viewBBox(v), null, 'no live ids means no bbox');
    // ...and only then does the saved camera take over.
    const cam = a.viewCamera(v);
    ok(cam !== null, 'a dead view still resolves, from its saved camera');
    near(cam.zoom, 0.5, 1e-9, 'the dead-view fallback uses the saved zoom');
    near(cam.cx, (1000 / 2 - -250) / 0.5, 0.001, 'the dead-view fallback un-projects the saved pan');
  }

  // ── 2d. never upscale ───────────────────────────────────────────────────
  {
    const a = buildViews();
    const st = a.__state;
    st.items = [{ id: 1, x: 0, y: 0, w: 10, h: 10 }];
    eq(a.viewCamera({ id: 1, ids: [1], panX: 0, panY: 0, zoom: 1 }).zoom,
       EXPECT_VIEW_MAX_ZOOM, 'a tiny selection is not magnified past 1:1');
  }

  // ── 2e. the camera flight ───────────────────────────────────────────────
  // Zoom interpolates GEOMETRICALLY: a linear ramp from 1x to 4x reads as a
  // lurch then a crawl, because perceived zoom rate is relative. The WORLD
  // POINT under the screen centre interpolates LINEARLY — interpolating pan
  // with a changing zoom makes the content swing in an arc.
  {
    const a = buildViews();
    const st = a.__state, sched = a.sched;
    const centreX = function () { return (1000 / 2 - st.pan.x) / st.zoom; };
    st.zoom = 1; st.pan.x = 0; st.pan.y = 0;
    a.flyToCamera(1000, 0, 4, 1000);

    sched.setNow(500);            // exactly halfway
    sched.frame();
    near(st.zoom, 2, 1e-6, 'zoom is geometric (1x→4x at halfway is 2x, not 2.5x)');
    near(centreX(), 750, 0.01, 'the centre point interpolates linearly (500 → 1000)');

    sched.setNow(1000);           // arrived
    sched.frame();
    near(st.zoom, 4, 1e-6, 'the flight lands on the target zoom');
    near(centreX(), 1000, 0.01, 'the flight lands on the target centre');
  }

  // ── 2f. a newer flight cancels the older one ────────────────────────────
  {
    const a = buildViews();
    const st = a.__state, sched = a.sched;
    const before = a.updates.count;
    st.zoom = 1; st.pan.x = 0; st.pan.y = 0;
    a.flyToCamera(5000, 0, 1, 1000);   // flight A — superseded immediately
    a.flyToCamera(10, 0, 1, 1000);     // flight B — the one that should win
    sched.setNow(1000);
    sched.frame();
    eq(a.updates.count - before, 1, 'only the newest flight writes the camera');
    near((1000 / 2 - st.pan.x) / st.zoom, 10, 0.01, 'the surviving flight is B');
  }

  // ── 2g. the Present tape ────────────────────────────────────────────────
  {
    const a = buildViews();
    const st = a.__state;
    st.items = [{ id: 1, x: 0, y: 0, w: 100, h: 100 }];
    st.views = [
      { id: 1, name: 'one', ids: [1], panX: 0, panY: 0, zoom: 1 },
      { id: 2, name: 'two', ids: [1], panX: 0, panY: 0, zoom: 1 },
      { id: 3, name: 'three', ids: [1], panX: 0, panY: 0, zoom: 1 },
    ];

    // Stepping back off the first shot CLAMPS — "went back too far" must not
    // end a pitch the director is in the middle of giving.
    st._present = { index: 0, timer: null };
    a.presentAdvance(-1);
    ok(st._present !== null, 'stepping back off the first shot does not end the tape');
    eq(st._present.index, 0, 'stepping back off the first shot clamps to the first shot');

    // Stepping forward off the last shot. v7.0.48: a MANUAL tape HOLDS here.
    // It used to end the tape, which cost the director their place for
    // pressing "next" once too often — the user asked for a tape that waits.
    // Auto-play still ends it, because a reel with nobody at the keyboard has
    // to stop somewhere.
    st._present = { index: 2, timer: null, auto: false };
    a.presentAdvance(1);
    ok(st._present !== null, 'stepping forward off the last shot does not end a manual tape');
    eq(st._present.index, 2, 'a manual tape holds on the last shot');

    st._present = { index: 2, timer: null, auto: true };
    a.presentAdvance(1);
    eq(st._present, null, 'an auto tape ends off the last shot');

    // The advance timer is scheduled UP FRONT as flight + dwell. Arming it in
    // the flight's completion callback means a cancelled flight stalls the
    // tape forever — worse than a tape whose timing is 620ms loose.
    // v7.0.48: the timer is armed only while auto-play is on. A manual tape
    // arms nothing at all — that is the whole point of the change, and the
    // assertion that used to sit here ("the timer is always armed") was
    // pinning the behaviour the user rejected.
    st._present = { index: -1, timer: null, auto: false };
    a.presentAdvance(1);
    eq(st._present.index, 0, 'the first advance lands on the first shot');
    ok(a.sched.pendingTimerDelays().indexOf(EXPECT_PRESENT_TIMER) < 0,
       'a manual tape arms no advance timer at all');

    st._present = { index: -1, timer: null, auto: true };
    a.presentAdvance(1);
    ok(a.sched.pendingTimerDelays().indexOf(EXPECT_PRESENT_TIMER) >= 0,
       'the advance timer is armed for flight + dwell (' + EXPECT_PRESENT_TIMER + 'ms)');
    a.stopPresent();
    eq(st._present, null, 'stopPresent clears the tape');
  }

  // ── 2h. view ids and editing ────────────────────────────────────────────
  {
    const a = buildViews();
    const st = a.__state, g = a.__G;
    g.nextViewId = undefined;
    st.views = [{ id: 4, name: 'x', ids: [], panX: 0, panY: 0, zoom: 1 },
                { id: 9, name: 'y', ids: [], panX: 0, panY: 0, zoom: 1 }];
    eq(a.nextViewId(), 10, 'a board with no counter derives the next id from the max');
    eq(a.nextViewId(), 11, 'and then increments');

    st.selected = new Set([1, 2]);
    const v = a.saveViewFromSelection('Hero shot');
    eq(v.name, 'Hero shot', 'a view keeps its name');
    eq(v.ids.length, 2, 'a view stores the selected ids');
    eq(st.views.length, 3, 'the view is appended to the tape');
    eq(st._activeViewIndex, 2, 'the new view becomes the active one');

    st.selected = new Set();
    eq(a.saveViewFromSelection('empty'), null, 'an empty selection saves nothing');
    eq(st.views.length, 3, 'a rejected save does not extend the tape');
  }

  // ── 2i. Alt+digit must match ev.code, never ev.key ──────────────────────
  // macOS Option layer changes the CHARACTER a key produces: Alt+1 is '¡',
  // Alt+2 is '™'. A test like `ev.key >= '0' && ev.key <= '9'` silently never
  // fires on a Mac — exactly where this shortcut matters most.
  {
    const block = slice('// Alt+1..9, Alt+0', '// Collapsed by default,', 'alt-digit handler');
    const code = codeOnly(block);
    ok(code.indexOf('ev.code') >= 0, 'the shortcut reads ev.code');
    ok(!/ev\.key\s*[=<>]/.test(code), 'the shortcut does not test ev.key');
    ok(block.indexOf("addEventListener('keydown'") >= 0, 'the shortcut binds keydown');
    ok(block.indexOf(', true);') >= 0, 'the shortcut binds on the capture phase');
    ok(/\/\^\(Digit\|Numpad\)\(\[0-9\]\)\$\//.test(block), 'the physical-key regex is present verbatim');

    const re = /^(Digit|Numpad)([0-9])$/;
    ok(re.test('Digit1'), 'Digit1 matches');
    ok(re.test('Digit0'), 'Digit0 matches');
    ok(re.test('Numpad7'), 'Numpad7 matches');
    // ...and the Option-layer CHARACTERS do not — which is the whole point.
    const optionLayer = ['¡', '™', '£', '¢', '∞', '§', '¶', '•', 'ª', 'º'];
    let leaked = 0;
    optionLayer.forEach(function (k) { if (re.test(k)) leaked++; });
    eq(leaked, 0, 'macOS Option-layer characters would never match (so key-matching was the bug)');
  }

  // ── 2j. persistence: views ride along in every snapshot and every .kpak ──
  {
    const snap = slice('function captureSnapshot() {', 'function applySnapshot(snap)', 'captureSnapshot');
    ok(snap.indexOf('views: (state.views || []).map') >= 0, 'undo snapshots carry views');
    ok(snap.indexOf('nextViewId: G.nextViewId') >= 0, 'undo snapshots carry the view id counter');

    const restore = around('G.nextViewId = Number.isFinite(snap.nextViewId)', 700, 300, 'applySnapshot');
    ok(restore.indexOf('state.views = (snap.views || [])') >= 0, 'undo restores views');
    ok(restore.indexOf('renderViewsPanel()') >= 0, 'undo redraws the views panel');
    ok(restore.indexOf('state._activeViewIndex >= state.views.length') >= 0,
       'undo clamps the active index to the restored list');

    // .kpak: one undo writer, two manifest writers (v5 + v5.5.1), one reader,
    // one board restore, one board clear.
    eq(count(src, 'views: (state.views || []).map'), 3, 'undo + both kpak manifests carry views');
    eq(count(src, 'nextViewId: G.nextViewId,'), 3, 'undo + both kpak manifests carry the view counter');
    eq(count(src, 'manifest.views ='), 1, 'the manifest writer emits views');
    eq(count(src, 'data.views = []'), 1, 'the manifest reader consumes views');

    const rb = around('if (!append) state.views = [];', 0, 1500, 'restoreBoard');
    // v7.0.48: the remap is now passed into the shared reader rather than
    // spelled out here. That the remap actually runs is asserted behaviourally
    // in test_v7046; this is the call site it happens at.
    ok(rb.indexOf('deserializeView(vd, _remapId)') >= 0,
       'restore remaps view ids through the same remap as group members');
    ok(rb.indexOf('G.nextViewId = (!append') >= 0,
       'restore trusts the saved counter only on a full load, not on append');

    const cl = around('state.views = [];\n  state._activeViewIndex = -1;', 0, 400, 'board clear');
    ok(cl.indexOf('G.nextViewId = 1;') >= 0, 'clearing the board resets the view counter');
    ok(cl.indexOf('if (state._present) stopPresent();') >= 0, 'clearing the board stops a running tape');
    ok(cl.indexOf('renderViewsPanel()') >= 0, 'clearing the board redraws the panel');
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  3. A/B COMPARE  (batch-5 proposal E)
// ══════════════════════════════════════════════════════════════════════════
const abBlock = slice('var _ab = { a: null', 'function _abEnsureEl() {', 'ab compare module');

function buildAB() {
  const captured = [];
  const toasts = [];
  const st = { selected: new Set(), items: [] };
  const mkFrame = function () { return { style: { width: 'STALE', height: 'STALE' } }; };
  const stage = { clientWidth: 1000, clientHeight: 600 };
  const frames = { '#ab-frame-a': mkFrame(), '#ab-frame-b': mkFrame() };
  const modes = ['wipe', 'side', 'hold'].map(function (m) {
    return { getAttribute: function () { return m; }, classList: { toggle: function () {} } };
  });
  const el = {
    _cls: { open: true }, _attrs: {}, _props: {},
    style: { setProperty: function (k, v) { el._props[k] = v; } },
    classList: {
      contains: function (n) { return !!el._cls[n]; },
      add: function (n) { el._cls[n] = true; },
      remove: function (n) { delete el._cls[n]; },
      toggle: function (n, on) { el._cls[n] = (on === undefined) ? !el._cls[n] : !!on; },
    },
    setAttribute: function (k, v) { el._attrs[k] = v; },
    querySelector: function (s) {
      if (s === '#ab-stage') return stage;
      return frames[s] || null;
    },
    querySelectorAll: function (s) { return (s === '.ab-mode') ? modes : []; },
  };
  const api = new Function(
    'state', 'toast', 'videoAnnoCaptureSnapshot', '__el',
    abBlock + '\n_ab.el = __el;\nreturn { ab: _ab, canOpen: abCanOpen, pair: abSelectedPair,'
             + ' setPos: abSetPos, setMode: abSetMode, layout: abLayout,'
             + ' sourceFor: abSourceFor, comparable: _abItemComparable };'
  )(
    st,
    function (m) { toasts.push(m); },
    function (v, maxW, strokes) { captured.push({ maxW: maxW, strokes: strokes }); return 'data:image/jpeg;base64,FRAME'; },
    el
  );
  api.state = st; api.el = el; api.stage = stage; api.frames = frames;
  api.captured_ = captured; api.toasts = toasts;
  return api;
}

function abTests() {
  console.log('— A/B compare —');

  // ── 3a. it opens on exactly two comparable items ────────────────────────
  {
    const a = buildAB();
    const st = a.state;
    st.items = [
      { id: 1, img: { src: 'data:a' } },
      { id: 2, img: { src: 'data:b' } },
      { id: 3, img: { src: 'data:c' } },
      { id: 4 },
    ];
    st.selected = new Set();               eq(a.canOpen(), false, 'no selection cannot open');
    st.selected = new Set([1]);            eq(a.canOpen(), false, 'one item cannot open');
    st.selected = new Set([1, 2, 3]);      eq(a.canOpen(), false, 'three items cannot open');
    st.selected = new Set([1, 4]);         eq(a.canOpen(), false, 'a non-media item cannot open');
    st.selected = new Set([1, 2]);         eq(a.canOpen(), true,  'two images can open');
  }

  // ── 3b. selection ORDER decides A and B, not board order ────────────────
  {
    const a = buildAB();
    const st = a.state;
    st.items = [{ id: 1, img: { src: 'data:first' } }, { id: 2, img: { src: 'data:second' } }];
    st.selected = new Set([2, 1]);        // clicked 2 first
    const pair = a.pair();
    eq(pair[0].id, 2, 'A is whichever item was selected first');
    eq(pair[1].id, 1, 'B is the second');
  }

  // ── 3c. a video compares on its CURRENT frame, and never seeks ──────────
  // Seeking as a side effect of opening a viewer would move the user's
  // playhead out from under them.
  {
    const a = buildAB();
    let seeks = 0;
    const v = { videoWidth: 1920, videoHeight: 1080,
                get currentTime() { return 3; }, set currentTime(t) { seeks++; } };
    const s = a.sourceFor({ id: 1, video: v, filename: 'shot_v03.mov' });
    ok(s !== null, 'a video yields a compare source');
    eq(seeks, 0, 'reading a video frame never moves the playhead');
    eq(s.w, 1920, 'the frame carries the video width');
    eq(s.h, 1080, 'the frame carries the video height');
    ok(s.name.indexOf('shot_v03.mov') === 0, 'the frame is named after the clip');
    eq(a.captured_[0].maxW, 0, 'the compare frame uses the library default cap, not the export one');
  }

  // ── 3d. the wipe position clamps ────────────────────────────────────────
  {
    const a = buildAB();
    a.setPos(-20);  eq(a.ab.pos, 0,    'the wipe cannot go below 0%');
    a.setPos(150);  eq(a.ab.pos, 100,  'the wipe cannot go above 100%');
    a.setPos(NaN);  eq(a.ab.pos, 50,   'a non-finite wipe position resets to the middle');
    a.setPos(37.5); eq(a.ab.pos, 37.5, 'a valid wipe position is kept');
    eq(a.el._props['--ab-pos'], '37.5%', 'the wipe position reaches CSS');
  }

  // ── 3e. shared frame geometry ───────────────────────────────────────────
  // Both images are fitted to ONE frame derived from A. Fitting them
  // independently means two pictures of different aspect ratios render at
  // different sizes and the wipe slides across content that does not line up.
  {
    const a = buildAB();
    a.ab.a = { src: 'x', w: 1000, h: 1000, name: 'square' };   // 1:1
    a.ab.b = { src: 'y', w: 1920, h: 1080, name: 'wide' };     // 16:9
    a.setMode('wipe');
    a.layout();
    // 1000x600 stage, 1:1 source: bw=1000 -> bh=1000 > 600, so bh=600, bw=600.
    eq(a.frames['#ab-frame-a'].style.width,  '600px', 'wipe frame A is fitted to the stage');
    eq(a.frames['#ab-frame-a'].style.height, '600px', 'wipe frame A keeps the aspect ratio');
    eq(a.frames['#ab-frame-b'].style.width,  '600px', 'wipe frame B shares A geometry, not its own');
    eq(a.frames['#ab-frame-b'].style.height, '600px', 'wipe frame B shares A height');

    // Side by side fits each pane to its own pane, so the shared sizing is let go.
    a.setMode('side');
    a.layout();
    eq(a.frames['#ab-frame-a'].style.width,  '', 'side mode releases the shared width');
    eq(a.frames['#ab-frame-a'].style.height, '', 'side mode releases the shared height');
    eq(a.frames['#ab-frame-b'].style.width,  '', 'side mode releases B too');
  }

  // ── 3f. modes ───────────────────────────────────────────────────────────
  {
    const a = buildAB();
    a.setMode('side');     eq(a.ab.mode, 'side', 'side mode is set');
    a.setMode('hold');     eq(a.ab.mode, 'hold', 'hold mode is set');
    a.setMode('nonsense'); eq(a.ab.mode, 'wipe', 'an unknown mode falls back to wipe');
    eq(a.el._attrs['data-mode'], 'wipe', 'the mode reaches CSS');
  }

  // ── 3g. it is an overlay, not a second renderer ─────────────────────────
  // The duplication that has repeatedly bitten this project was two code paths
  // painting the SAME pixels and drifting apart. This module must paint nothing.
  {
    const painters = ['getContext', 'drawImage', 'createRadialGradient', 'createLinearGradient',
                      'fillRect', 'putImageData', 'paintBoardRegion', 'paintDrawStroke'];
    let painted = 0;
    painters.forEach(function (p) { if (abBlock.indexOf(p) >= 0) painted++; });
    eq(painted, 0, 'the compare module paints nothing at all');
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  4. VERSION
// ══════════════════════════════════════════════════════════════════════════
function versionTests() {
  console.log('— version —');
  const swPath = process.env.KRAFTED_SW
    ? path.resolve(process.env.KRAFTED_SW)
    : path.resolve(__dirname, '../docs/sw.js');
  const sw = fs.readFileSync(swPath, 'utf8');
  ok(src.indexOf("var KRAFTED_VERSION = '7.6.0';") >= 0, 'KRAFTED_VERSION bumped');
  ok(src.indexOf('<title>Krafted v7.6.0</title>') >= 0, 'title bumped');
  ok(sw.indexOf("const CACHE_NAME = 'krafted-v7.6.0-'") >= 0, 'sw CACHE_NAME bumped');
  ok(sw.indexOf("const APP_VERSION = '7.6.0';") >= 0, 'sw APP_VERSION bumped');
}

(async function () {
  try {
    await captureTests();
    viewsTests();
    abTests();
    versionTests();
  } catch (e) {
    fail++;
    console.log('  THREW: ' + ((e && e.stack) || e));
  }
  console.log('');
  console.log(fail === 0 ? 'ALL PASS (' + pass + ' assertions)' : 'FAILURES: ' + fail + ' (passed ' + pass + ')');
  process.exit(fail === 0 ? 0 : 1);
})();
