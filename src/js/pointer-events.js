
import { viewport } from './core-state.js';

// ============================================================
//  POINTER EVENTS — Pen Tablet Support (Wacom / Huion / XP-Pen / Surface Pen)
//  Captures pressure, captures pointer, and dispatches synthetic mouse
//  events so the existing draw logic works seamlessly with styluses.
// ============================================================
(function setupPointerEvents() {
  // Track current pen pressure; read by draw logic via window.__kraftedPressure
  let lastPressure = 0.5;
  let activePointerId = null;
  let pointerType = '';
  // When pen pointerdown fires, the browser SHOULD fire a synthetic mousedown
  // (per W3C Pointer Events spec) — but in practice many Wacom/Huion/Chrome
  // combinations don't, leaving pen users unable to draw. We track whether
  // mousedown arrived and dispatch one ourselves if the browser didn't.
  let penWaitingForMousedown = false;
  let penSyntheticDispatched = false;

  function isPenLike(e) {
    // Pen tablet / stylus / touch — all should go through this handler.
    // Mouse also passes through (pointerType === 'mouse'), but we only
    // intercept when needed (e.g. when pen/tablet signals pressure).
    return e.pointerType === 'pen' || e.pointerType === 'touch';
  }

  viewport.addEventListener('pointerdown', e => {
    pointerType = e.pointerType;
    lastPressure = (typeof e.pressure === 'number' && e.pressure > 0) ? e.pressure : 0.5;
    window.__kraftedPressure = lastPressure;
    window.__kraftedPointerType = pointerType;

    if (isPenLike(e)) {
      try { viewport.setPointerCapture(e.pointerId); } catch (err) {}
      activePointerId = e.pointerId;

      // Arm a guard: if the browser doesn't fire a synthetic mousedown
      // within a tick, we dispatch one ourselves so the existing draw
      // logic (in the mousedown handler) runs for pen input.
      // Skip if the pen side-button is pressed (e.button !== 0) so we
      // don't trigger draws from a right-click pen press.
      if (e.button === 0) {
        penWaitingForMousedown = true;
        penSyntheticDispatched = false;
        // Defer one tick so any native mousedown has a chance to run first.
        Promise.resolve().then(() => {
          if (penWaitingForMousedown && !penSyntheticDispatched) {
            // Browser never fired a synthetic mousedown for this pen
            // press — emit one so the existing draw code can run.
            const md = new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
              composed: true,
              view: window,
              button: 0,
              buttons: 1,
              clientX: e.clientX,
              clientY: e.clientY
            });
            penSyntheticDispatched = true;
            // Dispatch on the actual target (where the pen touched), so
            // closest('.item') and other DOM lookups behave the same as
            // a real mouse click at that position.
            const tgt = e.target || viewport;
            tgt.dispatchEvent(md);
          }
        });
      }
    }
  }, { passive: false });

  viewport.addEventListener('pointermove', e => {
    if (typeof e.pressure === 'number') {
      lastPressure = e.pressure > 0 ? e.pressure : 0.5;
      window.__kraftedPressure = lastPressure;
    }

    // For pen / touch pointermove, if a synthetic mousedown was needed
    // (browser didn't fire one natively), we must also synthesize the
    // matching mousemove — otherwise the existing mousemove handler won't
    // see this move, and the stroke won't grow past its starting point.
    if (isPenLike(e) && penSyntheticDispatched && e.buttons > 0) {
      const mm = new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        button: 0,
        buttons: 1,
        clientX: e.clientX,
        clientY: e.clientY
      });
      (e.target || viewport).dispatchEvent(mm);
    }
  });

  function endPointer(e) {
    if (activePointerId !== null) {
      try { viewport.releasePointerCapture(activePointerId); } catch (err) {}
      activePointerId = null;
    }
    window.__kraftedPressure = 0.5;
    penWaitingForMousedown = false;

    // If the browser never fired a synthetic mouseup for this pen
    // press, dispatch one ourselves so the existing mouseup handler
    // can finalize the stroke / clear G.currentStroke.
    if (e && e.button === 0 && isPenLike(e) && e.type === 'pointerup') {
      // Defer one tick to give the browser a chance to fire the
      // native mouseup first.
      Promise.resolve().then(() => {
        const mu = new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          button: 0,
          buttons: 0,
          clientX: e.clientX,
          clientY: e.clientY
        });
        (e.target || viewport).dispatchEvent(mu);
      });
    }
  }
  viewport.addEventListener('pointerup', endPointer);
  viewport.addEventListener('pointercancel', endPointer);
  viewport.addEventListener('pointerleave', e => {
    // Only clear when leaving the viewport (not just for non-captured moves)
    if (e.pointerType !== 'mouse') endPointer(e);
  });

  // Clear the pen-waiting flag whenever mousedown / mouseup actually fires,
  // so the pointerdown handler knows the browser did its job and we don't
  // dispatch a duplicate.
  viewport.addEventListener('mousedown', () => {
    penWaitingForMousedown = false;
  }, true);  // capture phase — run before the main mousedown handler
  viewport.addEventListener('mouseup', () => {
    penSyntheticDispatched = false;
  }, true);
})();
