#!/usr/bin/env node
/*
 * test_v7049.js — Reframe: non-destructive zoom / pan / rotate (v7.0.49).
 *
 * WHY THIS SUITE EXISTS
 *   Reframe showed one framing while you dragged and produced a different one
 *   when you pressed Enter, and a long enough drag ended on a blank frame.
 *   Root cause: the preview, the drag and the applied result each wrote their
 *   own transform in a different coordinate system — the preview laid the
 *   image out at natural size and translated it in natural px, the result
 *   switched to object-fit:cover (which RESCALES the image) and then applied
 *   the same natural-px number as object-position without multiplying by that
 *   scale. Dragging 300px previewed source 300-1020 and produced 800-1920; the
 *   clamp allowed 1200, and past 720 the frame was empty.
 *
 *   Three hand-written copies of one behaviour is this file's recurring root
 *   cause, so the suite pins the SHAPE of the fix, not just today's numbers:
 *
 *     1. one applier, and the old mechanism is actually gone
 *     2. the frame can never be uncovered - checked by independent geometry,
 *        not by re-running the app's own formula against itself
 *     3. screen px are converted to world px (the old drag ignored state.zoom)
 *     4. the framing survives a reload, and legacy cropX migrates
 *
 * WHY THE GEOMETRY CHECK IS WRITTEN TWICE
 *   framingResolve derives its bounds from the rotated frame's bounding box.
 *   Asserting "panMax >= 0" with those same numbers would be circular - it
 *   would pass even if the derivation were wrong. So covers() below inverts the
 *   transform the way a browser would and tests the four frame corners for
 *   containment. Two derivations, one answer.
 *
 * Usage:  node test_v7049.js [path-to-kraftpub.html]
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
function near(a, b, label, tol) {
  ok(Math.abs(a - b) <= (tol || 1e-9), `${label}  (got ${a}, want ~${b})`);
}
function has(needle, label, hay) {
  ok((hay || SRC).indexOf(needle) >= 0, `${label}  (missing: ${JSON.stringify(needle.slice(0, 70))})`);
}
function hasNot(needle, label, hay) {
  ok((hay || SRC).indexOf(needle) < 0, `${label}  (should be absent: ${JSON.stringify(needle.slice(0, 70))})`);
}
function count(needle, hay) {
  let n = 0, i = 0;
  for (;;) { const j = (hay || SRC).indexOf(needle, i); if (j < 0) break; n++; i = j + 1; }
  return n;
}

// ── extract a shipped top-level function by brace matching ─────────────
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

// ═══ 1. one applier, and the old mechanism is gone ═════════════════════
// The whole point of the refactor. If any of the old writers survive, the bug
// survives too — so these are asserted as ABSENCES, not presences.
ok(fnFull('applyImageFraming', SRC).length > 0, 'applyImageFraming exists');
ok(fnFull('framingBounds', SRC).length > 0, 'framingBounds exists');
ok(fnFull('framingResolve', SRC).length > 0, 'framingResolve exists');

// object-fit:cover + object-position was the broken applied path. It has to be
// gone from the file entirely — `objectFit = 'contain'` elsewhere is unrelated
// (frame-comment thumbnails), so pin the exact broken value.
eq(count("objectFit = 'cover'"), 0, "nothing sets object-fit:cover any more");
hasNot("imgEl.style.objectPosition", 'exitReframe no longer writes object-position');
hasNot('dragCropX', 'the old drag-crop state fields are gone');
// Crop still legitimately uses cropX/cropY (it bakes pixels), so this must be
// scoped — a file-wide absence check would be satisfied by nothing at all.
const enterSrc = fnFull('enterReframe', SRC);
ok(enterSrc.length > 0, 'enterReframe exists');
hasNot('cropX', 'reframe no longer reads or snapshots bare cropX', enterSrc);

// The drag must delegate, not hand-roll a transform.
const mmBlock = SRC.slice(SRC.indexOf('// REFRAME DRAG'),
                          SRC.indexOf('// v7.0.12: VIDEO INTERNAL ZOOM/PAN'));
ok(mmBlock.length > 0, 'the reframe drag block is locatable');
hasNot('.style.transform', 'the reframe drag does not write a transform itself', mmBlock);
has('rfSetPan(it, nx, ny)', 'the reframe drag delegates to rfSetPan', mmBlock);

// ═══ 2. screen px -> world px ═════════════════════════════════════════
// The canvas is scaled by state.zoom and the old drag ignored that, so at 50%
// board zoom the image lagged the cursor by half. The divide is the fix.
has('const z = state.zoom || 1;', 'the drag reads state.zoom', mmBlock);
has('(e.clientX - rf.startX) / z', 'horizontal drag delta is divided by board zoom', mmBlock);
has('(e.clientY - rf.startY) / z', 'vertical drag delta is divided by board zoom', mmBlock);

// ═══ 3. execute the real maths ════════════════════════════════════════
const boundsSrc = fnFull('framingBounds', SRC);
const baseSrc = fnFull('framingBaseScale', SRC);
const resolveSrc = fnFull('framingResolve', SRC);
const minSrc = fnFull('framingMinZoom', SRC);
const maxSrc = fnFull('framingMaxZoom', SRC);
const geomSrc = fnFull('framingGeom', SRC);
const clampSrc = fnFull('framingClampPan', SRC);
const migSrc = fnFull('migrateLegacyCrop', SRC);
ok(boundsSrc && baseSrc && resolveSrc && minSrc && maxSrc && geomSrc && clampSrc && migSrc,
   'all framing helpers exist');

let api = null;
if (boundsSrc && baseSrc && resolveSrc && minSrc && maxSrc && geomSrc && clampSrc && migSrc) {
  api = new Function(`
    ${boundsSrc}
    ${baseSrc}
    ${minSrc}
    ${maxSrc}
    ${geomSrc}
    ${clampSrc}
    ${resolveSrc}
    ${migSrc}
    return { framingBounds, framingBaseScale, framingMinZoom, framingMaxZoom,
             framingGeom, framingClampPan, framingResolve, migrateLegacyCrop };
  `)();
}

// The reference still: 1920x1080 source in a 720x405 frame (16:9 both, so the
// cover scale is exactly 0.375 and every number below is checkable by hand).
const REF = { natW: 1920, natH: 1080, w: 720, h: 405 };

if (api) {
  // ── 3a. the zoom-1 baseline IS object-fit:cover ──
  const r0 = api.framingResolve({ ...REF, frameOn: true, frameZ: 1, frameRot: 0, frameX: 0, frameY: 0 });
  near(api.framingBaseScale(api.framingBounds(REF, 0)), 0.375, 'cover scale of a 16:9 still in a 16:9 frame is 0.375');
  near(r0.s, 0.375, 'zoom 1 / rot 0 resolves to the cover scale');
  near(r0.tx, 0, 'no pan at rest means no translation (X)');
  near(r0.ty, 0, 'no pan at rest means no translation (Y)');

  // ── 3b. rotation grows the scale so the frame stays covered ──
  // 90 deg: the 1920x1080 image has to span the 405px frame height with its
  // 1080px width -> 1080*s >= 405 -> s >= 0.375; the binding axis is the frame
  // width 720 spanned by the image height 1080 -> s >= 0.6667.
  const r90 = api.framingResolve({ ...REF, frameOn: true, frameZ: 1, frameRot: 90, frameX: 0, frameY: 0 });
  near(r90.s, 720 / 1080, 'rotating 90 deg scales the image up to keep the frame covered');
  ok(r90.s > r0.s, 'rotation never lets the image shrink below its zero-rotation size');

  // ── 3c. the zoom floor ──
  eq(api.framingMinZoom(), 1, 'minimum zoom is 1 (fill the frame, never less)');
  const rUnder = api.framingResolve({ ...REF, frameOn: true, frameZ: 0.25, frameRot: 0, frameX: 0, frameY: 0 });
  near(rUnder.z, 1, 'a stored zoom below 1 is clamped back to 1');
  near(rUnder.s, 0.375, 'a clamped zoom resolves to the cover scale, not to a smaller one');
  const rOver = api.framingResolve({ ...REF, frameOn: true, frameZ: 99, frameRot: 0, frameX: 0, frameY: 0 });
  eq(rOver.z, api.framingMaxZoom(), 'a stored zoom above the cap is clamped to the cap');

  // ── 3d. pan is clamped, and clamping is idempotent ──
  // At zoom 1 with a matching aspect the image fits the frame exactly, so the
  // budget is genuinely 0 and there is nothing to pan to — that is the correct
  // answer, not a clamp failure.
  const rFit = api.framingResolve({ ...REF, frameOn: true, frameZ: 1, frameRot: 0, frameX: 99999, frameY: -99999 });
  eq(rFit.panMaxX, 0, 'a 16:9 still at zoom 1 in a 16:9 frame has no horizontal pan budget');
  near(rFit.tx, 0, 'so an absurd pan clamps to 0 rather than sliding the image out');

  // Zoomed in there IS slack, and it must clamp exactly to the budget.
  const rZoom = api.framingResolve({ ...REF, frameOn: true, frameZ: 2, frameRot: 0, frameX: 99999, frameY: -99999 });
  // s = 0.75 -> image half-width 720, frame half-width 360 -> budget 360.
  near(rZoom.s, 0.75, 'zoom 2 doubles the cover scale');
  near(rZoom.panMaxX, 360, 'zoom 2 leaves a 360px horizontal pan budget');
  near(rZoom.tx, -360, 'an absurd positive panX clamps to the budget edge');
  near(rZoom.ty, 202.5, 'an absurd negative panY clamps to the budget edge');

  // Clamping twice must equal clamping once, or a drag that keeps pushing at
  // the wall would creep the framing further out on every mouse move.
  const rotated = { ...REF, frameOn: true, frameZ: 2, frameRot: 33, frameX: 0, frameY: 0 };
  const once = api.framingClampPan(rotated, 8000, -5000);
  const twice = api.framingClampPan({ ...rotated, frameX: once.x, frameY: once.y }, once.x, once.y);
  near(twice.x, once.x, 'clamping an already-clamped pan is a no-op (X)');
  near(twice.y, once.y, 'clamping an already-clamped pan is a no-op (Y)');
}

// ═══ 4. THE INVARIANT: the frame is always covered ═════════════════════
// Independent geometry. framingResolve derives Ax/By from the rotated frame's
// bounding box; covers() instead inverts the transform the way a renderer
// would and tests the four frame corners. Same answer by a different route —
// if the derivation is wrong, these disagree.
function covers(it, r) {
  const a = it.natW * r.s / 2, b = it.natH * r.s / 2;
  const A = it.w / 2, B = it.h / 2;
  const rad = r.rot * Math.PI / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      // corner relative to the image centre after the translate
      const qx = sx * A - r.tx, qy = sy * B - r.ty;
      // inverse-rotate into the image's own axis-aligned space
      const px = c * qx + s * qy;
      const py = -s * qx + c * qy;
      if (Math.abs(px) > a + 1e-9 || Math.abs(py) > b + 1e-9) return false;
    }
  }
  return true;
}

if (api) {
  const shapes = [
    { natW: 1920, natH: 1080, w: 720, h: 405 },   // 16:9 still, 16:9 frame
    { natW: 1920, natH: 1080, w: 400, h: 400 },   // 16:9 still, square frame
    { natW: 1080, natH: 1920, w: 720, h: 405 },   // portrait still, landscape frame
    { natW: 640, natH: 480, w: 900, h: 200 },     // upscaled, extreme frame
    { natW: 4000, natH: 3000, w: 300, h: 700 },   // tall narrow frame
  ];
  const zooms = [1, 1.4, 2, 3.75, 8];
  const rots = [0, 0.1, 7, 33, 45, 90, 137, 180, -23, -90];
  const pans = [0, 1, -1, 250, -250, 99999, -99999];

  let cases = 0, uncovered = 0, negativeBudget = 0;
  for (const shp of shapes) {
    for (const z of zooms) {
      for (const rot of rots) {
        for (const px of pans) {
          for (const py of pans) {
            const it = { ...shp, frameOn: true, frameZ: z, frameRot: rot, frameX: px, frameY: py };
            const r = api.framingResolve(it);
            cases++;
            if (!covers(shp, r)) uncovered++;
            if (r.panMaxX < -1e-9 || r.panMaxY < -1e-9) negativeBudget++;
          }
        }
      }
    }
  }
  ok(cases > 10000, `the invariant sweep actually ran (${cases} cases)`);
  eq(uncovered, 0, 'EVERY framing leaves the frame fully covered - no blank frames');
  eq(negativeBudget, 0, 'the pan budget is non-negative for every shape, zoom and rotation');
}

// ═══ 5. persistence ═══════════════════════════════════════════════════
// A reframe used to vanish on reload, because only exitReframe ever wrote the
// transform. updateItemStyle is called on load, so that is where it belongs.
const uisSrc = fnFull('updateItemStyle', SRC);
ok(uisSrc.length > 0, 'updateItemStyle exists');
has('applyImageFraming(item)', 'updateItemStyle re-applies the framing (so reload keeps it)', uisSrc);

// All five fields must round-trip, on every save path there is.
eq(count('frameOn: i.frameOn || false, frameZ: i.frameZ || 1, frameRot: i.frameRot || 0, frameX: i.frameX || 0, frameY: i.frameY || 0,'),
   3, 'all three save paths persist the framing fields');
has('frameOn: n.frameOn || false, frameZ: n.frameZ || 1, frameRot: n.frameRot || 0, frameX: n.frameX || 0, frameY: n.frameY || 0,',
    'the load path reads the framing fields back');
has('frameOn: it.frameOn, frameZ: it.frameZ, frameRot: it.frameRot, frameX: it.frameX, frameY: it.frameY,',
    'the kpak manifest carries the framing fields');

// ═══ 6. legacy cropX migration ════════════════════════════════════════
if (api) {
  // Old boards stored cropX as the window's LEFT EDGE in natural px. Convert
  // edge -> centre, then centre -> offset from the image centre, which is what
  // frameX means. For a 16:9 still in a 16:9 frame the window half-width is
  // exactly natW/2, so the two conversions cancel and frameX == cropX — a handy
  // hand-checkable case.
  const legacy = { natW: 1920, natH: 1080, w: 720, h: 405, cropX: 300, cropY: 0 };
  api.migrateLegacyCrop(legacy);
  eq(legacy.frameOn, true, 'migration turns framing on for a board that had a crop');
  near(legacy.frameX, 300, 'cropX 300 migrates to frameX 300 on a 16:9-in-16:9 still');
  near(legacy.frameY, 0, 'cropY 0 migrates to frameY 0 on a 16:9-in-16:9 still');
  near(legacy.frameZ, 1, 'a migrated framing starts at zoom 1');
  near(legacy.frameRot, 0, 'a migrated framing starts level');

  // And whatever it produces must still cover the frame.
  const lr = api.framingResolve(legacy);
  ok(covers(legacy, lr), 'a migrated legacy framing still leaves the frame covered');

  // cropX 0 / cropY 0 is indistinguishable from "never reframed" — the old
  // code wrote those as the default. Migrating them would silently reframe
  // EVERY image on every existing board, which is worse than leaving them be.
  const untouched = { natW: 1920, natH: 1080, w: 720, h: 405, cropX: 0, cropY: 0 };
  api.migrateLegacyCrop(untouched);
  ok(!untouched.frameOn, 'cropX 0 / cropY 0 is treated as never-reframed, not migrated');

  // No crop fields at all — same story.
  const virgin = { natW: 1920, natH: 1080, w: 720, h: 405 };
  api.migrateLegacyCrop(virgin);
  ok(!virgin.frameOn, 'an item with no crop fields is left in the default rendering');
}

// ═══ 7. entry points ══════════════════════════════════════════════════
has('enterReframe(getSelectedImages())', 'the context menu reframes every selected image');
hasNot('enterReframe(getSelectedImages()[0])', 'the context menu no longer silently drops the rest of the selection');
has("<kbd>⇧R</kbd>", 'the menu hint names the key that OPENS reframe, not the one that confirms it');
has("case 'edit-reframe':           enterReframe(getSelectedImages()); return true;",
    'Shift+R is dispatched through the shortcut registry');
has("{ id: 'edit-reframe',    category: 'Edit',  label: 'Reframe Image',              keys: [{ key: 'r', shift: true }] },",
    'reframe is registered, so it shows in the palette and can be rebound');

// ═══ 7b. Esc restores, and it restores ALL FOUR fields ═════════════════
// The old cancel only put back cropX/cropY. If a cancel misses the zoom or the
// rotation, "Esc" silently keeps half the edit — which is worse than not
// offering a cancel, because the user believes they backed out.
const exitSrc = fnFull('exitReframe', SRC);
ok(exitSrc.length > 0, 'exitReframe exists');
has('var s = rf.snap[i];', 'exitReframe reads the per-item snapshot', exitSrc);
has('rfSetFrameFields(it, s)', 'exitReframe restores through the single field writer', exitSrc);
has("snap: list.map(function (it) {", 'enterReframe snapshots the framing per item', enterSrc);
has("return { on: !!it.frameOn, z: it.frameZ || 1, rot: it.frameRot || 0, x: it.frameX || 0, y: it.frameY || 0 };",
    'the snapshot covers frameOn, zoom, rotation and both pan axes', enterSrc);

// ═══ 8. the wheel owns zoom while reframing ═══════════════════════════
const wheelBlock = SRC.slice(SRC.indexOf('if (state.reframing) {\n    e.preventDefault();'),
                             SRC.indexOf('if (state.reframing) {\n    e.preventDefault();') + 600);
ok(wheelBlock.length > 0, 'the reframe wheel branch is locatable');
has('rfSetZoom(', 'the wheel zooms through the shared setter', wheelBlock);
has('return;', 'the reframe wheel branch returns before the canvas zoom can fire', wheelBlock);

// ═══ 9. input paths all funnel through the shared setters ══════════════
[['rfSetZoom', 'zoom'], ['rfSetRotation', 'rotation'], ['rfSetPan', 'pan']].forEach(function (pair) {
  const body = fnFull(pair[0], SRC);
  has('applyImageFraming(item)', pair[0] + ' repaints through the single applier', body);
});
const rfSetPanSrc = fnFull('rfSetPan', SRC);
// rfSetPan must delegate the clamp, not re-derive it. A second clamp written
// by hand is exactly how the preview and the result drifted apart in the first
// place — and it would be a rotated-rectangle clamp done wrong again.
has('framingClampPan(item, x, y)', 'rfSetPan clamps through the shared clamp', rfSetPanSrc);
// No Math.* at all, rather than the literal shape of one hand-rolled clamp:
// an assertion pinned to a variable name is satisfied by any clamp spelled
// differently, and a second clamp is exactly how the preview and the result
// drifted apart in the first place.
hasNot('Math.max', 'rfSetPan does not hand-roll its own clamp', rfSetPanSrc);
hasNot('Math.min', 'rfSetPan does not hand-roll its own clamp (min)', rfSetPanSrc);

// ═══ 9b. a press on the toolbar never becomes a board drag ═════════════
// The toolbar lives INSIDE the item, so without this guard every slider grab
// also starts a board drag and throws the framing about — the same
// accidental-drag family the A/B compare lock was built for.
const pdAnchor = '// REFRAME MODE — drag pans, Alt+drag rotates';
const pdBlock = SRC.slice(SRC.indexOf(pdAnchor), SRC.indexOf(pdAnchor) + 900);
ok(SRC.indexOf(pdAnchor) >= 0, 'the reframe pointerdown block is locatable');
has("e.target.closest('.rf-toolbar')", 'a press on the toolbar never starts a board drag', pdBlock);
has('rf.mode = e.altKey ?', 'one gesture carries one meaning: Alt selects rotate, plain drag pans', pdBlock);

// ═══ 10. the toolbar is a FIXED overlay on body — never clipped ═════════
has('.item.framed { overflow:hidden; }', 'a framed item clips its image');
// v7.0.50: the reframe toolbar used to be position:absolute INSIDE .item,
// which has overflow:hidden while reframing and is itself inside a transformed
// canvas. Safari does not repaint / clips an absolutely-positioned descendant
// of a transformed + overflow:hidden ancestor, so on macOS the whole control
// strip vanished and left a blank gap at the frame bottom (Chrome was fine).
// Lock the fix: the toolbar is now position:fixed on <body>, positioned from
// the frame's getBoundingClientRect, so it cannot be clipped by .item.
has('.rf-toolbar { position:fixed;', 'the reframe toolbar is a fixed body overlay, not clipped by .item');
hasNot('.rf-toolbar { position:absolute;', 'the clipped-inside-.item layout is gone (Safari fix)');
has('document.body.appendChild(tb)', 'the toolbar is parked on body, not inside the clipped frame', fnFull('rfBuildToolbar', SRC));
hasNot('el.appendChild(tb)', 'reframe no longer appends the toolbar to .item', fnFull('rfBuildToolbar', SRC));
has('rfPositionToolbar()', 'the toolbar is positioned from the frame via rfPositionToolbar', fnFull('rfBuildToolbar', SRC));
ok(fnFull('rfPositionToolbar', SRC).length > 0, 'rfPositionToolbar exists');
has('if (state.reframing && state.reframing._tb) rfPositionToolbar()',
    'the toolbar tracks the frame when the board is panned/zoomed', fnFull('updateCanvas', SRC));

// ═══ 10b. ONE writer of the framing fields ════════════════════════════
// "Write the framing back onto an item" was spelled out by hand four times:
// exitReframe, the toolbar Reset, and both halves of Hold:original. A sixth
// framing field would have to be added in four places — and the copy that got
// missed is exactly how the old cancel restored cropX/cropY and nothing else.
// Pin the delegation AND the count, because a delegation assertion alone is
// satisfied by a fifth copy that simply also calls through.
const fieldsSrc = fnFull('rfSetFrameFields', SRC);
ok(fieldsSrc.length > 0, 'rfSetFrameFields exists');
['frameOn', 'frameZ', 'frameRot', 'frameX', 'frameY'].forEach(function (f) {
  has('it.' + f + ' =', 'the single writer restores ' + f, fieldsSrc);
});
// migration + the pan setter + the single restore. A fourth assignment means a
// hand-written copy has crept back in.
eq(count('.frameX = '), 3, 'frameX is assigned in exactly 3 places: migration, the pan setter, the one restore');
eq(count('.frameRot = '), 3, 'frameRot is assigned in exactly 3 places: migration, the rotation setter, the one restore');

const rfShowSrc = fnFull('rfShowOriginal', SRC);
ok(rfShowSrc.length > 0, 'rfShowOriginal exists');
has('rfSetFrameFields(it, rf.snap[i])', 'Hold:original (held) restores through the single writer', rfShowSrc);
has('rfSetFrameFields(it, rf._live[i])', 'Hold:original (released) restores through the single writer', rfShowSrc);
// Without `on` in the live record, holding on an item that was not framed
// before reframe would leave it unframed after release.
has('on: !!it.frameOn, z: it.frameZ', 'Hold:original captures frameOn too, so releasing is an exact round-trip', rfShowSrc);
const rfTbSrc = fnFull('rfBuildToolbar', SRC);
has('rfSetFrameFields(it, rf.snap[i])', 'the toolbar Reset restores through the single writer', rfTbSrc);

// ═══ 11. "no framing" and "just created" are the same picture ══════════
// Every image element is born with object-fit:cover in its inline cssText. The
// reset used to blank objectFit to '' — and blank is NOT the default: with
// object-fit gone the image stretches to the item box instead of cropping to
// fill it, so cancelling a reframe on an image that had never been framed left
// it visibly distorted. One constant, used by the creators and the reset, so
// the two can never disagree again.
const IMG_BASE = "display:block;width:100%;height:100%;pointer-events:none;object-fit:cover;";
has("var ITEM_IMG_BASE_CSS = '" + IMG_BASE + "';", 'the default image styling is a single named constant');
eq(count("mediaEl.style.cssText = ITEM_IMG_BASE_CSS;"), 3, 'all three image creators use that constant');
const clearSrc = fnFull('clearFramingStyles', SRC);
ok(clearSrc.length > 0, 'clearFramingStyles exists');
has('cssText = ITEM_IMG_BASE_CSS', 'the reset restores the default styling rather than blanking it', clearSrc);
hasNot("objectFit = ''", 'the reset no longer clears object-fit (that is what stretched the image)', clearSrc);

// ═══ report ═══════════════════════════════════════════════════════════
console.log(`\ntest_v7049.js — Reframe (v7.2.1)`);
console.log(`${'-'.repeat(46)}`);
if (fails.length) {
  fails.forEach(f => console.log(`  FAIL  ${f}`));
  console.log(`${'-'.repeat(46)}`);
  console.log(`${pass} passed, ${fails.length} FAILED`);
  process.exit(1);
}
console.log(`${pass} passed, 0 failed`);
