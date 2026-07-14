
import { state, viewport } from './core-state.js';
import { updateCanvas, zoomBy, frameSelection } from './canvas-view.js';

// TRACKPAD TWO-FINGER PAN DETECTION
// A real mouse wheel and a two-finger trackpad drag both arrive as `wheel`
// events with no `ctrlKey` — they're indistinguishable from the wheel alone.
// The reliable distinguisher is that the trackpad two-finger gesture fires
// *two* `pointerdown` events (one per finger) before the wheel events start,
// whereas a physical mouse wheel has zero concurrent pointers. So we count
// the live pointers on the viewport and use that to branch in the wheel
// handler below. Works the same on Mac (Magic Trackpad / built-in) and
// Windows (Precision Touchpad).
export const _trackpadPointers = new Set();
export let _twoFingerPan = false;
export function _refreshTwoFingerPan() {
  _twoFingerPan = _trackpadPointers.size >= 2;
}
viewport.addEventListener('pointerdown', e => {
  // Capture phase so we still see it when an item handler stopped propagation
  _trackpadPointers.add(e.pointerId);
  _refreshTwoFingerPan();
}, true);
viewport.addEventListener('pointerup', e => {
  _trackpadPointers.delete(e.pointerId);
  _refreshTwoFingerPan();
}, true);
viewport.addEventListener('pointercancel', e => {
  _trackpadPointers.delete(e.pointerId);
  _refreshTwoFingerPan();
}, true);

// SCROLL ZOOM / PAN
// Wheel direction note: On Mac the OS often delivers mouse-wheel deltaY with the
// opposite sign convention vs Windows (rolling up = positive deltaY). To match the
// user-friendly "roll up = zoom in / roll down = zoom out" expectation across
// both platforms, we invert the natural deltaY sign here.
//
// Trackpad pinch (two-finger) in Chrome also fires `wheel` events but with
// `ctrlKey: true`. The natural deltaY direction for pinch is *inverted* relative
// to a physical mouse wheel, so we handle that branch separately:
//   pinch out (spread) → zoom in
//   pinch in  (pinch)  → zoom out
//
// Trackpad two-finger *drag* (sliding both fingers without pinching) is the
// standard Mac/Win "pan" gesture. We detect it via the pointer count above
// and route its wheel deltas straight into `state.pan`. Mouse wheel alone
// (0 active pointers) still zooms as before.
//
// Round 19: user says the mouse wheel still feels too gentle (was ±2% per
// tick, which takes ~35 ticks to double the zoom). Bumped the wheel branch
// to ±10% per tick to match the lightbox wheel feel, and roughly doubled the
// pinch coefficient + cap to keep the two gestures in step. At 30 wheel
// ticks (~0.5s of scrolling) this moves the zoom ~13× (vs Round 18's 1.8×
// over the same time), so a normal scroll lands a strong, decisive zoom —
// close to the pre-Round 12 "1.10/0.90" feel while still passing through
// `zoomTo` so the cursor stays anchored to the same world point.
//   (a) Wheel: 1.02/0.98 → 1.10/0.90 (≈5× faster)
//   (b) Pinch: coefficient 0.0014 → 0.0028, cap 0.012-0.035 → 0.025-0.07
//       (≈2× faster; 30 ticks ≈ 70% zoom in 0.5s)
//
// Detection note for MacBook built-in trackpad:
// Chrome on macOS treats the trackpad as a "mouse" device, so the two-finger
// drag gesture does NOT fire two separate pointerdown events. The pointer
// counter above (≥2) is only reliable for touchscreens and some external
// trackpads. As a fallback for MacBook, we also treat any non-ctrlKey wheel
// event with a non-zero `deltaX` as a two-finger drag (the two fingers are
// never perfectly synchronised in the X axis, so even a "vertical-only"
// two-finger drag carries a small horizontal delta). Combined with the
// pointer check, this catches the gesture on both MacBook and Windows
// Precision Touchpads while still letting a true vertical mouse wheel zoom.
viewport.addEventListener('wheel', e => {
  e.preventDefault();
  // Platform detection: Mac vs Windows trackpad/mouse behaviour differs.
  // Mac trackpads use deltaMode 0 for both pinch-zoom AND two-finger pan.
  // Windows high-res mouse wheels also report deltaMode 0 but should zoom,
  // not pan. We branch by platform so one fix doesn't break the other.
  var _isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent || '');
  var _isTwoFingerPan; // ← computed per platform below
  // Round 35: when the user is in the middle of dragging an item (move
  // drag), don't let wheel events (which can fire from accidental
  // trackpad touches while clicking) also pan or zoom the canvas. The
  // user reported: "when i use mouse to move the mov player, the screen
  // offset will move, please keep it stable when i translate the player".
  // Without this guard a tiny two-finger brush during a click-and-drag
  // would translate the whole canvas underneath the player — making the
  // player appear to "stick" to the cursor while the background slides
  // the other way. The wheel handler is for canvas-level navigation,
  // and during a per-item drag the user is moving an item, not the view.
  if (state.dragging && state.dragging.type === 'move') return;

  // R79: Cmd + mouse wheel on Mac (metaKey=true, NOT ctrlKey).
  // Chrome/Safari on macOS set metaKey=true when the user holds the
  // Command key during a mouse wheel event, while Ctrl+wheel sets
  // ctrlKey=true. This gives us a clean branch: Cmd+wheel zooms
  // with the regular wheel step (feels like a real mouse wheel),
  // and Ctrl+wheel (pinch) uses the proportional pinch step.
  // The user said "在Mac min 上 zoom in out 想加 command 鼠標點擊加
  // 上下，而家係control 好吾順手" — Ctrl is awkward on Mac because
  // Ctrl+click = right-click and Ctrl+wheel = browser zoom-override
  // in some setups. Cmd is the native modifier key for "zoom".
  if (e.metaKey) {
    // Cmd + mouse wheel on Mac: use the regular wheel step,
    // anchored at viewport center. Direction matches the
    // naturalScroll preference (same as plain-wheel branch).
    const s = state.zoomStep;
    const rawDY = state.naturalScroll ? -e.deltaY : e.deltaY;
    zoomBy(rawDY < 0 ? s : 1 / s, window.innerWidth / 2, window.innerHeight / 2);
    return;
  }

  if (e.ctrlKey) {
    // Two sub-cases:
    //  (a) Trackpad pinch (deltaMode 0 + typically 2 active pointers) →
    //      small continuous deltaY → use pinchStep.
    //  (b) Ctrl + mouse wheel (Windows) — deltaMode 1 or 2, step-
    //      quantised → use state.zoomStep (same as plain wheel).
    // (Cmd on Mac was already handled by the e.metaKey branch above.)
    if (e.deltaMode !== 0) {
      // (b) Ctrl + mouse wheel (Windows): use the regular wheel step,
      // anchored at the viewport center.
      const s = state.zoomStep;
      const rawDY = state.naturalScroll ? -e.deltaY : e.deltaY;
      zoomBy(rawDY < 0 ? s : 1 / s, window.innerWidth / 2, window.innerHeight / 2);
    } else {
    // Trackpad pinch: flip direction so "spread" zooms in, "pinch" zooms out.
    // Round 12: drastically reduced sensitivity — the user said the previous
    // 0.98/1.02 step (1.02^20 ≈ 1.49× over 1-2s) was "always suddenly scale
    // the mov". New step is proportional to the actual deltaY so a small
    // finger twitch produces a tiny zoom, and a hard pinch is still
    // responsive. Coefficient tuned so a typical 1s pinch moves ~5-8% (vs
    // the old 49% in the same time). The 0.5% per-event cap prevents a
    // single large deltaY from teleporting the zoom level.
    // Round 14: user said the 0.002-0.005 cap was "too small" — they wanted
    // the previous feel back. Bumped the range to 0.004-0.010 and the
    // coefficient to 0.0004. Verified by e2e: 30 ticks (≈0.5s of pinching)
    // moves the zoom ~24%, so a normal 1s pinch lands around 40-50% — close
    // to the old 0.98/1.02 feel but still proportional to finger movement,
    // so a small twitch doesn't "suddenly scale" the mov.
    // Round 17: user says Round 14 was still slow. Bumped again to
    // 0.006-0.020 cap with 0.0007 coefficient. Verified by e2e: 30
    // ticks (≈0.5s of pinching) moves the zoom ~33%, so a normal 1s
    // pinch lands around 65-75% — feels close to the old responsive
    // 0.98/1.02 behaviour while staying proportional to finger
    // movement so a small twitch doesn't "suddenly scale" the mov.
    // Round 18: user says it's STILL too slow + pinch-zoom is fighting
    // with two-finger scrubbing on the player. Two changes:
    //   (a) +60% faster: 0.0007 → 0.0014 coefficient, 0.006-0.020
    //       cap → 0.012-0.035. At 30 ticks (~0.5s) this moves the
    //       zoom ~35% (vs Round 17's 19%), so a 1s pinch lands around
    //       70% — well above Round 17 while staying proportional to
    //       finger movement so a small twitch doesn't "suddenly
    //       scale" the mov.
    //   (b) skip pinch zoom when the cursor is over a media item
    //       (`.item.has-media`) so the user can two-finger scrub
    //       through a video without accidentally zooming the board.
    //       Mouse-wheel zoom and the two-finger pan (deltaX) still
    //       work everywhere — only the pinch-zoom branch is gated.
    // Round 19: user says the mouse wheel "needs more effect". Doubled
    // the pinch coefficient and cap to keep wheel + pinch in step with
    // the new ±10% wheel step. 0.0014 → 0.0028, 0.012-0.035 → 0.025-0.07.
    // At 30 ticks (~0.5s) this moves the zoom ~85% (vs Round 18's 35%),
    // so a 1s pinch lands around 170% — well above Round 18 while
    // staying proportional to finger movement.
    // Round 32: pinch coefficient + cap are now DERIVED from the user's
    // chosen `state.zoomStep` (wheel) so the two gestures stay in lock-
    // step. Map: pinch coeff = (zoomStep - 1) * 0.026 — gives 0.0026 at
    // 10% step (matches the old 0.0028 default), scales linearly with
    // the slider. Cap range widened to 0.020-0.080 so the full slider
    // has usable room in both directions. Direction INVERTED to match
    // the new wheel direction: e.deltaY > 0 (pinch = zoom out) → scale
    // DOWN, e.deltaY < 0 (spread = zoom in) → scale UP.
    if (e.target && e.target.closest && e.target.closest('.item.has-media')) {
      // Let the event bubble to the player's own wheel handler
      // (no zoom). Fall through to the pan branch so two-finger
      // horizontal drag still slides the canvas if needed.
    } else {
      // Pinch step is proportional to (zoomStep - 1), the percentage of
      // the wheel step. Capped so a tiny slider setting still gives a
      // tiny but visible zoom, and the max setting can't teleport.
      const _pct = (state.zoomStep - 1) * 0.26; // 0.0026 @ 1.10, 0.0130 @ 1.15
      const pinchStep = Math.max(0.020, Math.min(0.080, Math.abs(e.deltaY) * _pct));
      // INVERTED: spread (deltaY<0) zooms IN, pinch (deltaY>0) zooms OUT
      // Round 75: always zoom anchored to the VIEWPORT CENTER, not the
      // cursor. Pass window.innerWidth/2, window.innerHeight/2 so the
      // point at the screen center stays fixed while everything else
      // scales around it. This matches the user's "zoom center should
      // always be the center of the screen" preference. Cursor-anchored
      // zoom was confusing because moving the cursor during a wheel
      // event would shift the view unpredictably.
      zoomBy(e.deltaY > 0 ? 1 - pinchStep : 1 + pinchStep, window.innerWidth / 2, window.innerHeight / 2);
    }
    }
  } else if (_isMac ? (_twoFingerPan || e.deltaMode === 0) : (_twoFingerPan && e.deltaMode === 0)) {
    // Two-finger trackpad drag (all axes): pan the canvas in 2D.
    // ── Mac: original logic — _twoFingerPan OR deltaMode 0 (pixel-mode
    //   trackpad). Mac trackpad two-finger swipe fires wheel events with
    //   deltaMode 0 regardless of whether a pointerdown happened first,
    //   so `||` covers both the "drag-to-pan" and "swipe-to-pan" paths.
    //   Pinch-zoom is handled by the ctrlKey branch above.
    // ── Windows: require BOTH _twoFingerPan AND deltaMode 0, otherwise
    //   high-res mouse wheels (which also report deltaMode 0) would be
    //   misrouted to pan instead of zoom.
    state.pan.x -= e.deltaX;
    state.pan.y -= e.deltaY;
    updateCanvas();
    if (typeof scheduleVisibleItemsUpdate === 'function') scheduleVisibleItemsUpdate();
    if (typeof updateStatus === 'function') updateStatus();
  } else {
    // Notched mouse wheel (deltaMode 1 or 2): scroll-UP = zoom in,
    // scroll-DOWN = zoom out. Trackpad events (deltaMode 0) are
    // handled by the pan branch above, so this only fires for real
    // physical mouse wheels.
    // Round 12: also reduced (was 1.04/0.96) for parity with the pinch fix.
    // Round 19: bumped from 1.02/0.98 → 1.10/0.90 so a single wheel tick
    // gives a clearly visible zoom change.
    // Round 32: step is now user-controlled via the status-bar slider
    // (state.zoomStep, default 1.10, range 1.01-1.50). Direction is
    // INVERTED: e.deltaY < 0 (scroll up) → multiply by zoomStep (zoom
    // IN), e.deltaY > 0 (scroll down) → divide (zoom OUT). This matches
    // the photo-editor convention where pulling the content toward you
    // magnifies it, and pushing it away shrinks it. The cursor-anchored
    // math in zoomTo() still keeps the world point under the cursor
    // fixed, so a bigger step doesn't make the canvas fly under the
    // cursor — it only makes the zoom feel more decisive.
    const s = state.zoomStep;
    // Round 75: zoom always anchored at viewport center (not cursor).
    // See pinch branch above for rationale. The cursor-anchored math
    // in zoomTo() is still correct in absolute terms; we just no longer
    // want the cursor to dictate where the zoom "origin" is.
    // Round 76: when naturalScroll is ON (Mac default), flip the wheel
    // direction — scroll-UP pushes content away (zoom-out), matching
    // macOS natural scrolling. When OFF, scroll-UP zooms IN (traditional).
    const rawDY = state.naturalScroll ? -e.deltaY : e.deltaY;
    zoomBy(rawDY < 0 ? s : 1 / s, window.innerWidth / 2, window.innerHeight / 2);
  }
}, { passive: false });

// ZOOM STEP WIDGET (Round 32) — wire the slider to `state.zoomStep`.
// On every input event we (a) update the state, (b) update the percentage
// label next to the slider, and (c) persist the new value to localStorage
// so it survives reloads. The wheel handler reads `state.zoomStep` at
// event time, so changes apply on the very next wheel event with no
// reload needed. The slider's value is initialised from the same saved
// value (or the default 10% if nothing was saved) so the UI matches the
// running state.
(function _initZoomStepWidget(){
  try {
    const slider = document.getElementById('zoom-step-slider');
    const valEl  = document.getElementById('zoom-step-value');
    if (!slider || !valEl) return;
    // Initial display: read state.zoomStep (already loaded from
    // localStorage in the state object IIFE) and convert to percent.
    const initPct = Math.round((state.zoomStep - 1) * 100);
    slider.value = String(initPct);
    valEl.textContent = initPct + '%';
    slider.addEventListener('input', function(ev){
      const pct = parseInt(ev.target.value, 10) || 10;
      // Slider value is a percent (1-50); convert to multiplier (1.01-1.50).
      // Clamp to the safe range so a stray value can't teleport the zoom.
      const s = Math.max(1.01, Math.min(1.50, 1 + pct / 100));
      state.zoomStep = s;
      // Derive pinch step from wheel step so the two stay in lock-step.
      // Map: pinch coeff = (s - 1) * 0.026 (gives 0.0026 at 1.10,
      // matches the previous default).
      state.pinchStep = (s - 1) * 0.026;
      valEl.textContent = pct + '%';
      try { localStorage.setItem('krafted_zoom_step', String(s)); } catch (e) {}
      try { localStorage.setItem('krafted_pinch_step', String(state.pinchStep)); } catch (e) {}
    });
    // Wire the 🎯 Frame button. Mirrors the F key shortcut so
    // users who never read the help modal still have a click target.
    // The button is purely additive — `frameSelection` does the
    // actual work and has its own safety checks (no-op while a
    // drag/draw/cut/lasso is in flight). If nothing is selected
    // it falls back to a default reset.
    try {
      const btn = document.getElementById('btn-reset-view');
      if (btn) btn.addEventListener('click', function(){ frameSelection(); });
    } catch (e) {}
    // Wire the 🔄 Natural scroll checkbox.
    // Reads state.naturalScroll (already loaded from localStorage), sets
    // the checkbox to match, and toggles on change.
    try {
      const cb = document.getElementById('natural-scroll-checkbox');
      if (cb) {
        cb.checked = state.naturalScroll;
        cb.addEventListener('change', function() {
          state.naturalScroll = cb.checked;
          try { localStorage.setItem('krafted_natural_scroll', cb.checked ? '1' : '0'); } catch (e) {}
        });
      }
    } catch (e) {}
  } catch (e) {}
})();
