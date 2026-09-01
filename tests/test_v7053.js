#!/usr/bin/env node
/*
 * test_v7053.js — Minimap: a draggable radar for a 300-item board (v7.0.53).
 *
 * WHY THIS SUITE EXISTS
 *   The minimap was deferred from the earlier roadmap on the objection that
 *   "300 images on a minimap is just a pile of dots". It is unblocked now that
 *   items carry name/note/tags and the Library can search them — so this build
 *   is the rectangle radar: every object drawn at board scale, a viewport box
 *   you can grab and drag to pan, click anywhere else to jump, and Library
 *   search hits tinted on the map.
 *
 *   The failure mode that matters here is WRONG GEOMETRY. A minimap that draws
 *   beautifully and flies the camera somewhere else is worse than no minimap:
 *   it costs a click and it destroys trust in the one control meant to orient
 *   you. So the maths is executed, not described:
 *
 *     - world -> screen is  screen = pan + zoom * world
 *     - centring on a world point, then reading the viewport back, must
 *       return that same point in the middle (a round trip)
 *     - the fit is a union of content AND viewport, so the viewport box must
 *       always land inside the canvas — otherwise there is nothing to grab
 *     - dragging must move the camera by exactly the cursor's delta
 *
 *   The other thing pinned here is ONE predicate. The minimap tints whatever
 *   the Library search matches, so "matches" must have a single definition
 *   (libMatches) rather than a second hand-written copy that drifts.
 *
 * Usage:  node test_v7053.js [path-to-kraftpub.html]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2]
  || path.resolve(__dirname, '../../kraftpub-dev.html');
const SRC = fs.readFileSync(FILE, 'utf8');

let pass = 0;
const fails = [];
function ok(cond, label) { if (cond) { pass++; } else { fails.push(label); } }
function eq(a, b, label) {
  ok(a === b, `${label}  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}
function near(a, b, tol, label) {
  ok(Math.abs(a - b) <= tol, `${label}  (got ${a}, want ~${b})`);
}
function has(needle, label, hay) {
  ok((hay || SRC).indexOf(needle) >= 0, `${label}  (missing: ${JSON.stringify(needle.slice(0, 70))})`);
}
function hasNot(needle, label, hay) {
  ok((hay || SRC).indexOf(needle) < 0, `${label}  (should be absent: ${JSON.stringify(needle.slice(0, 70))})`);
}
// An executable block that throws must be recorded as ONE failure, not allowed
// to kill the run — a mutation caught by a crash is caught for the wrong reason.
function attempt(label, fn) {
  try { fn(); }
  catch (e) { fails.push(label + '  (threw: ' + ((e && e.message) || e) + ')'); }
}
function fnFull(name, hay) {
  const i = (hay || SRC).indexOf('function ' + name + '(');
  if (i < 0) return '';
  let d = 0, started = false;
  for (let j = i; j < (hay || SRC).length; j++) {
    const c = (hay || SRC)[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return (hay || SRC).slice(i, j + 1); }
  }
  return '';
}
function instantiate(body, stateDecls, stubs) {
  const keys = Object.keys(stubs);
  const f = new Function(...keys, stateDecls + '\n' + body + '\nreturn ' + stubs.__ret + ';');
  return f(...keys.map(k => stubs[k]));
}
const near1 = (a, b, label) => near(a, b, 1e-6, label);

// ═══ 1. the camera maths — the thing that must not be wrong ═══════════
ok(fnFull('miniViewportRect', SRC).length > 0, 'miniViewportRect exists');
ok(fnFull('miniCenterOn', SRC).length > 0, 'miniCenterOn exists');
has('x0: (0 - state.pan.x) / z', 'miniViewportRect inverts screen = pan + zoom * world', fnFull('miniViewportRect', SRC));
has('x1: (sw - state.pan.x) / z', 'miniViewportRect spans the whole window', fnFull('miniViewportRect', SRC));
has('state.pan.x = (window.innerWidth || 0) / 2 - z * wx;',
    'miniCenterOn solves pan for "world point at screen centre"', fnFull('miniCenterOn', SRC));

// EXECUTE IT: centre on a world point, read the viewport back, and the point
// must be in the middle. This is the round trip the whole control rests on.
attempt('executable: centre -> viewport round trip', () => {
  const st = { zoom: 1.7, pan: { x: 123, y: -45 } };
  const win = { innerWidth: 1440, innerHeight: 900 };
  const vrect = instantiate(fnFull('miniViewportRect', SRC), '',
    { __ret: 'miniViewportRect', state: st, window: win });
  const centerOn = instantiate(fnFull('miniCenterOn', SRC), '',
    { __ret: 'miniCenterOn', state: st, window: win, updateCanvas: () => {} });

  centerOn(500, 300);
  const v = vrect();
  near1((v.x0 + v.x1) / 2, 500, 'centring on world x=500 puts 500 at the middle of the view');
  near1((v.y0 + v.y1) / 2, 300, 'centring on world y=300 puts 300 at the middle of the view');
  near1(v.x1 - v.x0, 1440 / 1.7, 'the view is exactly one window wide in world units');
  near1(v.y1 - v.y0, 900 / 1.7, 'the view is exactly one window tall in world units');

  // And again at another zoom, because a factor that only works at zoom 1
  // would be the single most expensive possible bug to ship.
  st.zoom = 0.25;
  centerOn(-800, 2400);
  const v2 = vrect();
  near1((v2.x0 + v2.x1) / 2, -800, 'the round trip holds when zoomed out to 25%');
  near1((v2.y0 + v2.y1) / 2, 2400, 'the round trip holds off-origin and zoomed out');
  near1(v2.x1 - v2.x0, 1440 / 0.25, 'a 25% zoom shows four windows wide');
});

// ═══ 2. the fit — a union of content and viewport ═════════════════════
const cmap = fnFull('miniComputeMap', SRC);
ok(cmap.length > 0, 'miniComputeMap exists');
has('minX = Math.min(bb.minX, v.x0);', 'the fit unions the content with the viewport', cmap);
has('maxX = Math.max(bb.maxX, v.x1);', 'the fit unions the far corner too', cmap);
has('var s = Math.min(W / bw, H / bh);', 'the fit preserves aspect ratio (it takes the tighter axis)', cmap);
has('ox: (W - bw * s) / 2', 'the map is centred in the canvas, not pinned to a corner', cmap);
// The viewport rect must NOT be baked into the mapping: miniPaint recomputes
// it every frame so the box can still move while the mapping is frozen.
hasNot('view:', 'the mapping does not carry a frozen viewport rect', cmap);
has('var v = miniViewportRect();', 'miniPaint recomputes the viewport every paint', fnFull('miniPaint', SRC));

// EXECUTE IT: after the union fit, the viewport box has to be fully inside the
// canvas. If it can fall outside, the user pans somewhere and the control they
// need in order to get back is no longer on screen.
attempt('executable: the viewport box always lands inside the canvas', () => {
  const win = { innerWidth: 1440, innerHeight: 900 };
  const bbox = { minX: 0, minY: 0, maxX: 2000, maxY: 1000, count: 3 };
  const mkVR = (st) => instantiate(fnFull('miniViewportRect', SRC), '',
    { __ret: 'miniViewportRect', state: st, window: win });
  const st1 = { zoom: 1, pan: { x: 0, y: 0 } };
  const compute = instantiate(cmap, '', {
    __ret: 'miniComputeMap', worldBBoxOf: () => bbox, window: win,
    state: st1, miniViewportRect: mkVR(st1)
  });
  const m = compute(220, 145);
  ok(!!m, 'a fit is produced for a non-empty board');

  const vx0 = m.ox + (0 - m.minX) * m.s, vx1 = m.ox + (1440 - m.minX) * m.s;
  const vy0 = m.oy + (0 - m.minY) * m.s, vy1 = m.oy + (900 - m.minY) * m.s;
  ok(vx0 >= -0.001, `the viewport left edge is on-canvas (got ${vx0})`);
  ok(vy0 >= -0.001, `the viewport top edge is on-canvas (got ${vy0})`);
  ok(vx1 <= 220.001, `the viewport right edge is on-canvas (got ${vx1})`);
  ok(vy1 <= 145.001, `the viewport bottom edge is on-canvas (got ${vy1})`);

  // Same board, panned far away: the fit must grow to keep the box visible.
  const st2 = { zoom: 1, pan: { x: -6000, y: -4000 } };
  const compute2 = instantiate(cmap, '', {
    __ret: 'miniComputeMap', worldBBoxOf: () => bbox, window: win, state: st2,
    miniViewportRect: mkVR(st2)
  });
  const m2 = compute2(220, 145);
  const w2x0 = (0 - st2.pan.x) / 1, w2x1 = (1440 - st2.pan.x) / 1;
  const gx0 = m2.ox + (w2x0 - m2.minX) * m2.s, gx1 = m2.ox + (w2x1 - m2.minX) * m2.s;
  ok(gx0 >= -0.001 && gx1 <= 220.001,
     'panned 6000px away, the viewport box is still on-canvas');
  ok(m2.s < m.s, 'panning away zooms the map out, because the union grew');
});

// ═══ 3. the drag: freeze the mapping, move by the cursor delta ════════
const tw = fnFull('miniToWorld', SRC);
ok(tw.length > 0, 'miniToWorld exists');
has('var m = (_miniDrag && _miniDrag.map) ? _miniDrag.map : _miniMap;',
    'a live drag uses the FROZEN mapping, not the live one', tw);

attempt('executable: the drag freezes the mapping', () => {
  const map = { minX: 0, minY: 0, s: 1, ox: 0, oy: 0 };
  const frozen = { minX: 0, minY: 0, s: 2, ox: 0, oy: 0 };
  const withDrag = instantiate(tw,
    'var _miniMap = ' + JSON.stringify(map) + '; var _miniDrag = { map: ' + JSON.stringify(frozen) + ' };',
    { __ret: 'miniToWorld' });
  eq(withDrag(10, 10).x, 5, 'mid-drag the frozen scale is the one that maps the cursor (10 / s=2)');
  const noDrag = instantiate(tw,
    'var _miniMap = ' + JSON.stringify(map) + '; var _miniDrag = null;',
    { __ret: 'miniToWorld' });
  eq(noDrag(10, 10).x, 10, 'with no drag the live mapping is used (10 / s=1)');
  const empty = instantiate(tw, 'var _miniMap = null; var _miniDrag = null;', { __ret: 'miniToWorld' });
  eq(empty(10, 10), null, 'with no map at all the cursor maps to nothing, not to NaN');
});

const mv = fnFull('miniOnMove', SRC);
ok(mv.length > 0, 'miniOnMove exists');
has('miniCenterOn(_miniDrag.cx + (w.x - _miniDrag.wx), _miniDrag.cy + (w.y - _miniDrag.wy));',
    'the camera moves by the cursor delta, not to the cursor position', mv);
has('_miniDrag.moved = true;', 'a drag records that it actually moved', mv);

attempt('executable: dragging pans by exactly the cursor delta', () => {
  const st = { zoom: 1, pan: { x: 0, y: 0 } };
  const win = { innerWidth: 1000, innerHeight: 800 };
  const map = { minX: 0, minY: 0, s: 1, ox: 0, oy: 0 };  // 1 canvas px = 1 world unit
  const cv = {
    width: 220, height: 145,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 220, height: 145 }),
    addEventListener: () => {}
  };
  const doc = {
    getElementById: (id) => (id === 'minimap-canvas' ? cv
      : id === 'minimap-panel' ? { classList: { contains: () => false } } : null),
    addEventListener: () => {}
  };
  const move = instantiate(mv,
    'var _miniMap = ' + JSON.stringify(map) + ';' +
    'var _miniDrag = { wx: 0, wy: 0, cx: 100, cy: 100, map: ' + JSON.stringify(map) + ', moved: false };',
    {
      __ret: 'miniOnMove',
      document: doc, window: win, state: st, updateCanvas: () => {},
      miniPoint: instantiate(fnFull('miniPoint', SRC), '', { __ret: 'miniPoint', document: doc }),
      miniToWorld: instantiate(tw,
        'var _miniMap = ' + JSON.stringify(map) +
        '; var _miniDrag = { map: ' + JSON.stringify(map) + ' };', { __ret: 'miniToWorld' }),
      miniCenterOn: instantiate(fnFull('miniCenterOn', SRC), '',
        { __ret: 'miniCenterOn', state: st, window: win, updateCanvas: () => {} })
    });

  // Grabbed with the camera centred on world (100,100); cursor travels 50 right
  // and 20 down, so the centre must travel the same, to (150,120).
  move({ clientX: 50, clientY: 20 });
  eq(st.pan.x, 350, 'pan.x is solved for a centre of 150 (1000/2 - 150)');
  eq(st.pan.y, 280, 'pan.y is solved for a centre of 120 (800/2 - 120)');

  // Negative delta, and a grab that started somewhere other than the centre.
  const st3 = { zoom: 2, pan: { x: 0, y: 0 } };
  const move3 = instantiate(mv,
    'var _miniMap = ' + JSON.stringify(map) + ';' +
    'var _miniDrag = { wx: 40, wy: 60, cx: 300, cy: 200, map: ' + JSON.stringify(map) + ', moved: false };',
    {
      __ret: 'miniOnMove', document: doc, window: win, state: st3, updateCanvas: () => {},
      miniPoint: instantiate(fnFull('miniPoint', SRC), '', { __ret: 'miniPoint', document: doc }),
      miniToWorld: instantiate(tw,
        'var _miniMap = ' + JSON.stringify(map) +
        '; var _miniDrag = { map: ' + JSON.stringify(map) + ' };', { __ret: 'miniToWorld' }),
      miniCenterOn: instantiate(fnFull('miniCenterOn', SRC), '',
        { __ret: 'miniCenterOn', state: st3, window: win, updateCanvas: () => {} })
    });
  move3({ clientX: 10, clientY: 40 });   // delta = (-30, -20)
  eq(st3.pan.x, 500 - 2 * 270, 'a leftward drag at 200% zoom pans the right amount');
  eq(st3.pan.y, 400 - 2 * 180, 'an upward drag at 200% zoom pans the right amount');
});

const md = fnFull('miniOnDown', SRC);
ok(md.length > 0, 'miniOnDown exists');
has('_miniDrag = { wx: w.x, wy: w.y, cx: cx, cy: cy, map: m, moved: false };',
    'pointerdown captures the grab point, the camera centre and the mapping', md);
has('if (!inside) miniCenterOn(w.x, w.y);',
    'clicking outside the box jumps; grabbing inside it does not', md);
has("document.addEventListener('pointermove', miniOnMove);",
    'the gesture listens on the document, so it survives leaving the canvas', md);
// Scoped to the minimap rule. `touch-action:none` appears on five different
// elements in this file; an unscoped `has()` would stay green no matter which
// one of them lost it.
const miniRule = SRC.slice(SRC.indexOf('#minimap-canvas {'),
                           SRC.indexOf('#minimap-canvas {') + 320);
has('touch-action:none;',
    'the minimap canvas opts out of touch scrolling (or a drag scrolls the page)', miniRule);
has('cursor:crosshair;', 'the minimap canvas shows a crosshair, so it reads as a target', miniRule);
const mu = fnFull('miniOnUp', SRC);
ok(mu.length > 0, 'miniOnUp exists');
has('requestMinimapRefresh();',
    'releasing recomputes the fit, which the gesture will have changed', mu);
has("document.removeEventListener('pointermove', miniOnMove);",
    'the gesture unbinds on release', mu);

// ═══ 4. one predicate, two readers ════════════════════════════════════
const lm = fnFull('libMatches', SRC);
ok(lm.length > 0, 'libMatches exists');
has("var hay = [it.name, it.note, (it.tags || []).join(' ')].join(' ').toLowerCase();",
    'libMatches searches name, note and tags', lm);
has('if (!q) return true;', 'an empty query matches everything', lm);
has('return libMatches(it, q);', 'the Library list filters through libMatches',
    fnFull('renderLibraryPanel', SRC));
hasNot("var hay = [it.name, it.note, (it.tags || []).join(' ')].join(' ').toLowerCase();",
       'the Library list keeps no second copy of the filter',
       fnFull('renderLibraryPanel', SRC));
eq((SRC.match(/var hay = \[it\.name, it\.note/g) || []).length, 1,
   'exactly one hand-written copy of the search filter exists in the whole file');

attempt('executable: the minimap tints exactly what the list shows', () => {
  const items = [
    { id: 'a', name: 'Neon alley', note: '', tags: ['night', 'rain'] },
    { id: 'b', name: 'Desert highway', note: 'from Blade Runner', tags: [] },
    { id: 'c', name: 'Alley cat', note: '', tags: ['neon'] }
  ];
  const searchEl = { value: 'neon' };
  const doc = { getElementById: (id) => (id === 'library-search' ? searchEl : null) };
  const matchIds = instantiate(fnFull('libMatchIds', SRC), '', {
    __ret: 'libMatchIds', document: doc, state: { items: items },
    libMatches: instantiate(lm, '', { __ret: 'libMatches' })
  });
  const hits = matchIds();
  ok(hits instanceof Set, 'a search returns a Set of ids');
  eq(hits.size, 2, 'two of the three items match "neon"');
  ok(hits.has('a'), 'a name match is a hit');
  ok(hits.has('c'), 'a tag match is a hit');
  ok(!hits.has('b'), 'a non-match is excluded even though its note is long');

  searchEl.value = '   ';
  eq(matchIds(), null, 'a blank query means "no search", not "match nothing"');
  searchEl.value = 'blade';
  const noteHit = matchIds();
  ok(noteHit.has('b'), 'a note match is a hit (the field is searched, not just the name)');
});

// ═══ 5. paint: canvas, not DOM ════════════════════════════════════════
const paint = fnFull('miniPaint', SRC);
ok(paint.length > 0, 'miniPaint exists');
hasNot('createElement', 'miniPaint builds no DOM nodes', paint);
hasNot('innerHTML', 'miniPaint rewrites no markup', paint);
has('ctx.fillRect(', 'miniPaint draws with canvas fillRect', paint);
has('ctx.strokeRect(', 'the viewport box is outlined', paint);
has("else if (hits) ctx.fillStyle = 'rgba(0,229,255,0.9)';", 'search hits are tinted', paint);
has("if (hits && !hits.has(id)) ctx.fillStyle = 'rgba(125,135,150,0.16)';",
    'non-matches are dimmed while a search is active', paint);
has("else if (id === selId) ctx.fillStyle = 'rgba(255,255,255,0.95)';",
    'the selected item is picked out', paint);
has('Math.max(1.5, r.w * m.s)', 'a rectangle never collapses to invisible', paint);
has('_miniView = { x: vx, y: vy, w: vw, h: vh };',
    'the box is published so pointerdown can hit-test it', paint);

attempt('executable: everything drawn stays inside the canvas', () => {
  const drawn = [];
  const ctx = {
    clearRect: () => {}, strokeRect: (x, y, w, h) => drawn.push({ x, y, w, h }),
    fillRect: (x, y, w, h) => drawn.push({ x, y, w, h }),
    set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}
  };
  const m = { minX: 0, minY: 0, s: 0.05, ox: 10, oy: 20 };
  const st = { zoom: 1, pan: { x: -200, y: -100 }, items: [{ id: 'i1', x: 0, y: 0, w: 1000, h: 800 }], texts: [], todos: [] };
  const win = { innerWidth: 1000, innerHeight: 800 };
  const p = instantiate(paint, '', {
    __ret: 'miniPaint', state: st, window: win,
    libMatchIds: () => null,
    getSelectedItems: () => [],
    miniRects: instantiate(fnFull('miniRects', SRC), '', { __ret: 'miniRects', state: st }),
    miniViewportRect: instantiate(fnFull('miniViewportRect', SRC), '', { __ret: 'miniViewportRect', state: st, window: win })
  });
  p(ctx, m, 220, 145);
  ok(drawn.length >= 3, `something was drawn (${drawn.length} rects)`);
  const bg = drawn[0];
  eq(bg.w, 220, 'the first rect is the full-canvas background');
});

const mr = fnFull('miniRects', SRC);
ok(mr.length > 0, 'miniRects exists');
has('[state.texts, state.todos].forEach', 'text and to-dos are mapped too, so a text board is not blank', mr);
has('if (!(it.w > 0) || !(it.h > 0)) return;', 'zero-size objects are skipped', mr);

// ═══ 6. refresh, hooks, chrome ════════════════════════════════════════
const rmr = fnFull('requestMinimapRefresh', SRC);
ok(rmr.length > 0, 'requestMinimapRefresh exists');
has("if (!p || p.classList.contains('collapsed')) return;",
    'a collapsed minimap never paints', rmr);
has('if (_miniRaf) return;', 'two changes in one frame paint once', rmr);
has('drawMinimap();', 'the queued run paints', rmr);
has('try { requestMinimapRefresh(); } catch (e) {}',
    'every camera tick repaints the map', fnFull('updateCanvas', SRC));
has('try { requestMinimapRefresh(); } catch (e) {}',
    'every board mutation repaints the map', fnFull('scheduleAutoSave', SRC));
has('try { requestMinimapRefresh(); } catch (e) {}',
    'a selection change repaints the map', fnFull('refreshSelection', SRC));
has('try { requestMinimapRefresh(); } catch (e) {}',
    'a new Library query repaints the map', fnFull('renderLibraryPanel', SRC));

const dm = fnFull('drawMinimap', SRC);
ok(dm.length > 0, 'drawMinimap exists');
has('var m = (_miniDrag && _miniDrag.map) ? _miniDrag.map : miniComputeMap(W, H);',
    'a live drag repaints with the frozen mapping', dm);
has('_miniMap = m;', 'the last mapping is published for hit-testing', dm);

has("localStorage.setItem('krafted_minimap_collapsed'", 'the open/closed choice is written', SRC);
has("localStorage.getItem('krafted_minimap_collapsed') !== '0'", 'and read back at boot', SRC);
has('(function initMinimapPanel() {', 'the boot restore is an IIFE', SRC);
// Two short assertions rather than one exact line. The registry is a
// hand-aligned table; pinning the inter-column padding makes the assertion
// fail on a cosmetic re-wrap instead of on a real change.
has("id: 'minimap-toggle-panel', category: 'View',",
    'the minimap toggle is in the shortcut registry', SRC);
has("label: 'Toggle Minimap'", 'the registry entry is labelled for the shortcut panel', SRC);
has("case 'minimap-toggle-panel':   toggleMinimapPanel(); return true;",
    'the registry dispatches the minimap toggle', SRC);
has('body.presenting #minimap-panel { display:none; }', 'the map is hidden while pitching', SRC);
has('@media (max-width: 720px) { #minimap-panel { display:none; } }',
    'the map is hidden on phones, where it would only cover content', SRC);
has('#minimap-canvas {', 'the map has a canvas to paint into', SRC);
has('id="minimap-canvas"', 'the canvas is in the markup', SRC);
has('miniBindInput();', 'the pointer handlers are bound before the first paint', SRC);

// ═══ report ═══════════════════════════════════════════════════════════
console.log('test_v7053.js  (v7.2.1 Minimap - draggable board radar)');
if (fails.length) {
  console.log(`  ${pass} passed, ${fails.length} FAILED`);
  fails.forEach(f => console.log('    FAIL  ' + f));
  process.exit(1);
} else {
  console.log(`  ALL PASS (${pass} assertions)`);
}
