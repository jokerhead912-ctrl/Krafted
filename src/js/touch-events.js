import { clearSelection, refreshSelection, selectOnly } from './selection.js';
import { IS_TOUCH_DEVICE, touchState, state, viewport } from './core-state.js';
import { updateTextColorPalette } from './text-style.js';
import { updateCanvas } from './canvas-view.js';

// ============================================================
//  MOBILE TOUCH EVENTS (iPhone/iPad — map-style gestures)
//  Single finger = pan canvas, Pinch = zoom, Double-tap = select
//  Only active on touch devices — desktop mouse events unchanged
// ============================================================
if (IS_TOUCH_DEVICE) {
  // Prevent default iOS behaviors (rubber-band, zoom, etc.)
  document.body.style.touchAction = 'none';

  // Shared helper — find the item under a touch point and select it.
  // toggle=true  → flip selection state (used by double-tap)
  // toggle=false → select-only (used by single-tap), i.e. clears
  //                any previous selection and selects just this item
  // Returns true if an item was found and handled, false otherwise
  // (caller decides what to do on a miss, e.g. clearSelection()).
  function _selectItemAtTouchPoint(target, toggle) {
    const itemEl = target && target.closest ? target.closest('.item') : null;
    if (!itemEl) return false;
    const item = state.items.find(i => i.el === itemEl);
    if (!item) return false;
    if (toggle) {
      if (state.selected.has(item.id)) {
        state.selected.delete(item.id);
      } else {
        state.selected.clear();
        state.selected.add(item.id);
      }
      refreshSelection();
      updateTextColorPalette();
    } else {
      selectOnly(item.id);
    }
    return true;
  }

  viewport.addEventListener('touchstart', function(e) {
    // Prevent the browser from synthesizing mousedown/mousemove/mouseup
    // from this touch sequence. Without this, iOS Safari fires a
    // synthetic mousedown after touchstart, which desktop mouse
    // handlers (box-select, etc.) pick up and misinterpret as a
    // real mouse drag — causing the "phantom selection box" bug.
    if (e.cancelable) e.preventDefault();
    touchState.activeTouches = e.touches.length;

    // 2 fingers = pinch zoom
    if (e.touches.length === 2) {
      touchState.panStart = null;
      clearTimeout(touchState.tapTimeout);
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchState.initialPinchDist = Math.sqrt(dx * dx + dy * dy);
      touchState.pinchStart = { dist: touchState.initialPinchDist, zoom: state.zoom };
      return;
    }

    // 1 finger = potential pan or tap
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchState.panStart = { x: t.clientX, y: t.clientY, panX: state.pan.x, panY: state.pan.y };
      touchState.pinchStart = null;

      // Double-tap detection
      const now = Date.now();
      const tapTarget = e.target;

      if (now - touchState.lastTap < 350 && touchState.tapTarget === tapTarget) {
        // DOUBLE TAP — select item under finger (toggle).
        // Cancel any pending single-tap select scheduled by the
        // previous touchend so it doesn't fire on top of this.
        touchState.isDoubleTap = true;
        touchState.panStart = null; // cancel pan
        clearTimeout(touchState.tapTimeout);

        _selectItemAtTouchPoint(tapTarget, true);

        touchState.lastTap = 0;
        return;
      }

      touchState.isDoubleTap = false;
      touchState.lastTap = now;
      touchState.tapTarget = tapTarget;
    }
  }, { passive: false });

  viewport.addEventListener('touchmove', function(e) {
    e.preventDefault();

    // Pinch zoom
    if (e.touches.length === 2 && touchState.pinchStart) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (touchState.initialPinchDist > 0) {
        const scale = dist / touchState.initialPinchDist;
        const newZoom = touchState.pinchStart.zoom * scale;
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        // Zoom anchored to pinch center
        const ratio = newZoom / state.zoom;
        state.pan.x = cx - ratio * (cx - state.pan.x);
        state.pan.y = cy - ratio * (cy - state.pan.y);
        state.zoom = Math.max(0.05, Math.min(10, newZoom));
        updateCanvas();
      }
      return;
    }

    // Single finger pan
    if (e.touches.length === 1 && touchState.panStart && !touchState.isDoubleTap) {
      const t = e.touches[0];
      const dx = t.clientX - touchState.panStart.x;
      const dy = t.clientY - touchState.panStart.y;

      // Threshold: only pan if moved >5px (prevents accidental pan on tap)
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;

      state.pan.x = touchState.panStart.panX + dx;
      state.pan.y = touchState.panStart.panY + dy;
      updateCanvas();
    }
  }, { passive: false });

  viewport.addEventListener('touchend', function(e) {
    // Single-tap selection: if this was a single-finger touch that
    // barely moved (not a pan), and wasn't already handled as a
    // double-tap or a pinch, treat it as a tap — select the item
    // under the finger, or clear selection when tapping empty space.
    if (touchState.panStart && !touchState.isDoubleTap && touchState.activeTouches === 1) {
      const startX = touchState.panStart.x;
      const startY = touchState.panStart.y;
      const endTouch = (e.changedTouches && e.changedTouches[0]) || null;
      if (endTouch) {
        const dx = endTouch.clientX - startX;
        const dy = endTouch.clientY - startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 10) {
          const handled = _selectItemAtTouchPoint(touchState.tapTarget || e.target, false);
          if (!handled) clearSelection();
        }
      }
    }

    touchState.panStart = null;
    touchState.pinchStart = null;
    touchState.activeTouches = 0;
  });
}
