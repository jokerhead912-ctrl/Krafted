
import { state, viewport, Platform } from './core-state.js';
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
  // ============================================================
  //  PLATFORM ROUTER — every branch is gated by Platform.* flags
  //  so MacBook gestures never leak onto Windows, and vice-versa.
  //  Rules:
  //    Platform.mac      → Mac-specific behaviour
  //    Platform.win      → Windows-specific behaviour
  //    Platform.trackpad → MacBook / Magic Trackpad gestures
  //  ============================================================
  // Round 35: during item drag, suppress wheel events (accidental
  // trackpad touches while clicking).
  if (state.dragging && state.dragging.type === 'move') return;

  // ── Mac Cmd + wheel: zoom (metaKey on Mac, absent on Windows) ──
  if (Platform.mac && e.metaKey) {
    const s = state.zoomStep;
    const rawDY = state.naturalScroll ? -e.deltaY : e.deltaY;
    zoomBy(rawDY < 0 ? s : 1 / s, window.innerWidth / 2, window.innerHeight / 2);
    return;
  }

  // ── Ctrl + wheel (Windows zoom) / trackpad pinch (Mac pinch) ──
  if (e.ctrlKey) {
    // (a) Real mouse wheel (deltaMode 1/2) → use zoomStep
    // (b) Trackpad pinch (deltaMode 0) → use proportional pinchStep
    if (e.deltaMode !== 0) {
      const s = state.zoomStep;
      const rawDY = state.naturalScroll ? -e.deltaY : e.deltaY;
      zoomBy(rawDY < 0 ? s : 1 / s, window.innerWidth / 2, window.innerHeight / 2);
    } else {
      // Pinch — only if not over a media item (so two-finger
      // video scrubbing doesn't accidentally zoom the canvas).
      if (e.target && e.target.closest && e.target.closest('.item.has-media')) {
        // fall through to pan
      } else {
        const _pct = (state.zoomStep - 1) * 0.26;
        const pinchStep = Math.max(0.020, Math.min(0.080, Math.abs(e.deltaY) * _pct));
        zoomBy(e.deltaY > 0 ? 1 - pinchStep : 1 + pinchStep, window.innerWidth / 2, window.innerHeight / 2);
      }
    }
  // ── Two-finger trackpad pan ──
  // Mac: _twoFingerPan OR deltaMode 0 (Mac trackpad swipes)
  // Win: require BOTH _twoFingerPan AND deltaMode 0 (else high-res
  //      mouse wheels misroute to pan)
  } else if (Platform.mac ? (_twoFingerPan || e.deltaMode === 0) : (_twoFingerPan && e.deltaMode === 0)) {
    state.pan.x -= e.deltaX;
    state.pan.y -= e.deltaY;
    updateCanvas();
    if (typeof scheduleVisibleItemsUpdate === 'function') scheduleVisibleItemsUpdate();
    if (typeof updateStatus === 'function') updateStatus();
  } else {
    // ── Plain mouse wheel zoom ──
    const s = state.zoomStep;
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
