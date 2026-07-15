
// ============================================================
//  STARTUP CHECKS
// ============================================================
console.log('[INIT] Krafted v5.5 loading...');
console.log('[INIT] JSZip available:', typeof JSZip);
console.log('[INIT] showSaveFilePicker available:', typeof window.showSaveFilePicker);
// === COPYRIGHT — Krafted by Joker Head Studios ===
console.log(
  '%c Krafted v5.5 %c by Joker Head Studios ',
  'background:#7c8cf0;color:#000;font-weight:bold;padding:4px 8px;font-size:14px;',
  'background:#1a1a1a;color:#e8e8e8;padding:4px 8px;font-size:12px;'
);
console.log('%c© 2025 Joker Head Studios. All rights reserved. Unauthorized modification or redistribution is prohibited.',
  'color:#888;font-size:11px;');

// ============================================================
//  PLATFORM REGISTRY — unified detection for cross-platform
//  feature gating. Every platform-specific shortcut, gesture,
//  or behaviour should check this object instead of calling
//  navigator.userAgent / navigator.platform directly.
//  Rules:
//    Platform.mac    → macOS (includes MacBook, iMac, Mac mini)
//    Platform.win    → Windows
//    Platform.touch  → touchscreen device (phone/tablet)
//    Platform.trackpad → MacBook built-in trackpad OR Magic
//                         Trackpad (multi-touch gestures)
//    Platform.pen    → Wacom/Huion/XP-Pen stylus detected
//  When adding a NEW platform-specific feature, add a branch
//  in the feature file using these flags so it NEVER leaks
//  onto the wrong platform.
// ============================================================
export const Platform = (function(){
  const ua = (navigator.userAgent || '');
  const plat = (navigator.platform || '');
  const mac = /Mac|iPhone|iPad|iPod/.test(plat) || /Mac/.test(ua);
  const win = /Win/.test(plat) || /Windows/.test(ua);
  const touch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  // Trackpad detection: Mac + touch-capable (Magic Trackpad / built-in).
  // We can't 100% distinguish a Magic Mouse scroll from a Trackpad scroll
  // at the UA level, so this flag means "the platform HAS a trackpad".
  // Individual gesture handlers (wheel-zoom.js) use runtime deltaMode +
  // pointer count to further narrow down pinch vs wheel.
  const trackpad = mac && touch;
  // Pen tablet detection: PointerEvent with pointerType='pen' at any point
  // in the session. We set a one-shot listener so the flag is true after
  // the first pen event. Before the first pen event, Platform.pen is false.
  let penDetected = false;
  try {
    window.addEventListener('pointerdown', function _penDetect(e){
      if (e.pointerType === 'pen') {
        penDetected = true;
        window.removeEventListener('pointerdown', _penDetect, true);
      }
    }, true);
  } catch(e){}
  return {
    mac: mac,
    win: win,
    touch: touch,
    trackpad: trackpad,
    get pen(){ return penDetected; },
    // Convenience: the "modifier" key for zoom on this platform.
    // Mac → 'Cmd', Windows → 'Ctrl'. Use this in shortcut labels
    // and help text so users see the right key for their OS.
    zoomMod: mac ? 'Cmd' : 'Ctrl',
    // Convenience: the native zoom key string for wheel events.
    // Mac → 'metaKey', Windows → 'ctrlKey'. Used in wheel-zoom.js
    // to branch without hard-coding platform checks.
    zoomKey: mac ? 'metaKey' : 'ctrlKey',
  };
})();
console.log('[INIT] Platform:', JSON.stringify({
  mac: Platform.mac, win: Platform.win, touch: Platform.touch,
  trackpad: Platform.trackpad, zoomMod: Platform.zoomMod,
}));
if (typeof JSZip === 'undefined') {
  console.error('[INIT] JSZip is NOT available! .kpak save will fail.');
}
if (typeof window.showSaveFilePicker === 'undefined') {
  console.warn('[INIT] showSaveFilePicker NOT available — saves will download to your browser\'s default Downloads folder instead of letting you choose a location.');
}

// ============================================================
//  MOBILE / TOUCH DEVICE DETECTION
// ============================================================
export const IS_TOUCH_DEVICE = (function() {
  // Primary: check for touch capability
  const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0);
  // Secondary: check screen size for phones (not iPads with large screens)
  const isSmallScreen = window.innerWidth < 1024;
  return hasTouch && isSmallScreen;
})();
console.log('[INIT] Touch device:', IS_TOUCH_DEVICE);

// ── Adaptive scale for player controls ──
// Player controls are fixed-px so they look small on Windows
// monitors that report DPR=1 (or low DPR like 1.25-1.5). Two triggers
// stack and combine:
//   (a) devicePixelRatio (Retina / 4K at high scaling)
//   (b) viewport width (large Windows monitors at any DPI)
// Base scale 1.2× so even modest-DPR screens get a noticeable bump.
// Cap the combined scale at 1.6× so it stays usable without dominating.
// The scale only targets .item.has-media controls — canvas, toolbar
// and panels are unchanged.
window._applyDpiScale = (function _initDpiScale() {
  var dpr = (window.devicePixelRatio || 1);
  var vw = window.innerWidth || 0;
  // DPR-based: starts at 1.2× for DPR 1.0, grows to 1.4× at DPR 2+
  var scaleDpr = 1 + Math.min(0.4, 0.20 + Math.max(0, dpr - 1) * 0.20);
  // Viewport-based: 1.2× base at 1600px, grows linearly to 1.4× at 3200px+
  var scaleVw  = vw >= 1600 ? Math.min(1.4, 1.20 + (vw - 1600) / 4000) : 1.20;
  // Combine: take the larger, but cap at 1.6×
  var scale = Math.min(1.6, Math.max(scaleDpr, scaleVw));
  if (scale > 1.01) {
    var rounded = Math.round(scale * 100) / 100;
    document.body.dataset.dpiScale = String(rounded);
    document.body.style.setProperty('--dpi-scale', String(rounded));
    console.log('[INIT] Player controls auto-scaled ' + Math.round(scale * 100) + '% (DPR=' + dpr + ', vw=' + vw + ')');
  }
  // Return as a callable function for kpak-load re-application
  return arguments.callee;
})();

// Mobile state for touch gesture tracking
export const touchState = {
  panStart: null,       // { x, y, panX, panY }
  pinchStart: null,     // { dist, zoom }
  lastTap: 0,           // timestamp of last tap (for double-tap detection)
  tapTarget: null,      // element tapped
  tapTimeout: null,     // timeout for single-tap delay
  isDoubleTap: false,
  activeTouches: 0,
  initialPinchDist: 0,
};
// ============================================================
//  STATE
// ============================================================
export const state = {
  items: [], texts: [], todos: [], mindmaps: [],
  selected: new Set(),
  pan: { x: 0, y: 0 },
  zoom: 1,
  dragging: null,
  tool: 'select',
  spaceDown: false,
  undoStack: [], redoStack: [],
  clipboard: null,
  autoSaveTimer: null,
  groups: [],  // [{id, color, memberIds:Set, borderEl}]
  mouse: { x: 0, y: 0 }, // last known mouse position (screen coords)
  reframing: null, // { item, origCropX, origCropY }
  cropping: null, // { item, x, y, w, h, aspect, origSrc, origNatW, origNatH, origW, origH, origCropX, origCropY }
  // Alt+Left-Click pans the canvas — primarily for MacBook trackpads (no middle button).
  // Auto-enabled on Mac; off by default on Windows/Linux to avoid clashing with system Alt+Click.
  altPanEnabled: (function() {
    try {
      const saved = localStorage.getItem('krafted_alt_pan');
      if (saved !== null) return saved === '1';
    } catch (e) {}
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform) ||
                  /Mac/.test(navigator.userAgent || '');
    return isMac;
  })(),
  // Round 76: Natural scroll toggle. On Mac the OS default is "natural"
  // (scroll-up = push content down = zoom-out). On Windows the default is
  // "traditional" (scroll-up = zoom-in). This toggle lets the user flip
  // the mouse-wheel zoom direction without changing OS settings.
  // Does NOT affect pinch-zoom (spread=in / pinch=out is universal).
  naturalScroll: (function() {
    try {
      const saved = localStorage.getItem('krafted_natural_scroll');
      if (saved !== null) return saved === '1';
    } catch (e) {}
    // Auto-detect: Mac defaults to natural, Windows/Linux to traditional.
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ||
           /Mac/.test(navigator.userAgent || '');
  })(),
  // Round 32: mouse-wheel zoom step (multiplier per tick). Persisted to
  // localStorage so the user's chosen sensitivity survives reloads.
  // The wheel handler reads this to scale the zoom on each tick, and
  // the status-bar slider in the UI lets the user adjust it on the fly.
  // Direction is INVERTED from before: scroll-down now zooms OUT and
  // scroll-up zooms IN (matches the "push to zoom out, pull to zoom in"
  // mental model from photo editors).
  // Range: 1.01 (1% per tick, very gentle) to 1.50 (50% per tick, very
  // punchy). Default 1.10 — same magnitude as the old ±10% step.
  zoomStep: (function() {
    try {
      const saved = parseFloat(localStorage.getItem('krafted_zoom_step'));
      if (isFinite(saved) && saved >= 1.01 && saved <= 1.50) return saved;
    } catch (e) {}
    return 1.10;
  })(),
  // Round 32: pinch-zoom coefficient (proportional to deltaY). User-
  // adjustable via the same status-bar slider (a 1:1 mapping — the slider
  // sets the wheel step, the pinch step is derived as wheel * 0.26 so the
  // two gestures stay in proportion). Range: 0.0010 to 0.0120.
  pinchStep: (function() {
    try {
      const saved = parseFloat(localStorage.getItem('krafted_pinch_step'));
      if (isFinite(saved) && saved >= 0.0010 && saved <= 0.0120) return saved;
    } catch (e) {}
    return 0.0028;
  })(),
};

// Helper — should this mousedown start a canvas pan?
// Returns true for: spacebar held, middle button, OR (Alt + Left) when altPanEnabled.
export function isPanTrigger(e) {
  if (state.spaceDown) return true;
  if (e.button === 1) return true; // middle mouse button
  if (state.altPanEnabled && e.button === 0 && e.altKey) return true; // Alt + Left click (Mac trackpad)
  return false;
}

export const textTool = {
  font: 'Arial', size: 24, bold: false, italic: false, underline: false, strike: false,
  highlight: false, shadow: false, bg: false, outline: false, uppercase: false,
  color: '#ffffff', highlightColor: '#ffff00', align: 'left',
  activeColorTarget: 'color',
};
export const drawTool = { color: '#ff4444', size: 3, opacity: 1, mode: 'pen', arrowHead: 15, pressure: true };
// Paper / artboard settings
export const paperState = {
  enabled: false,
  autoFit: false,
  width: 1920,
  height: 1080,
  color: '#ffffff',
};
export const colors = ['#ffffff','#ff4444','#ff8800','#ffdd00','#44ff44','#44ddff','#8844ff','#ff44aa','#ff8844','#88ff44','#44ffaa','#4488ff','#aa44ff','#ff4488','#444444','#888888','#cccccc','#000000','#224422','#442222'];
// All draw strokes (flat array — no layer system, just like images)
let _drawStrokes = [];
let _currentStroke = null;
let _exportDrag = null;
let _captureDrag = null;
let _captureResultCanvas = null; // holds the last captured canvas for save/discard
export const captureResultPanel = document.getElementById('capture-result');
export const captureResultImg = document.getElementById('cr-preview-img');
export const captureResultInfo = document.getElementById('cr-info');
let _nextZ = 1;
let _nextId = 1;
let _nextGroupId = 1;
let _nextStrokeId = 1; // for draw items
// Draw stroke hover/move state
let _hoveredStroke = null;   // reference to stroke under cursor
let _drawMoveState = null;   // { stroke, startWx, startWy, origPoints }
let _potentialTextDrag = null;  // { el, startX, startY, triggered } — text-item drag-threshold state
// Mouse position tracking (for paste-at-cursor)
let _lastScreenX = window.innerWidth / 2;
let _lastScreenY = window.innerHeight / 2;

// DOM refs
export const viewport = document.getElementById('viewport');
export const canvas = document.getElementById('canvas');
export const canvasContent = document.getElementById('canvas-content');
export const drawLayer = document.getElementById('draw-layer');
export const ctxMenu = document.getElementById('ctx-menu');
export const selBox = document.getElementById('sel-box');
export const exportBox = document.getElementById('export-box');
export const captureBox = document.getElementById('capture-box');
export const captureOverlay = document.getElementById('capture-overlay');
export const captureHint = document.getElementById('capture-hint');
export const coPanels = {
  top: document.getElementById('co-top'),
  bottom: document.getElementById('co-bottom'),
  left: document.getElementById('co-left'),
  right: document.getElementById('co-right')
};
export const toolBadge = document.getElementById('tool-badge');
export const toastEl = document.getElementById('toast');

// Mutable globals — wrapped in G so ES modules can reassign properties
// without violating the "cannot reassign import" rule.
export const G = {
  drawStrokes: undefined,  // will be initialized below
  currentStroke: undefined,  // will be initialized below
  exportDrag: undefined,  // will be initialized below
  captureDrag: undefined,  // will be initialized below
  captureResultCanvas: undefined,  // will be initialized below
  nextZ: undefined,  // will be initialized below
  nextId: undefined,  // will be initialized below
  nextGroupId: undefined,  // will be initialized below
  nextStrokeId: undefined,  // will be initialized below
  hoveredStroke: undefined,  // will be initialized below
  drawMoveState: undefined,  // will be initialized below
  potentialTextDrag: undefined,  // will be initialized below
  lastScreenX: undefined,  // will be initialized below
  lastScreenY: undefined,  // will be initialized below
  lockToPlayer: false,  // R79: when true, draw mode stays active after
                         // each stroke (no need to re-pick the Draw tool
                         // between strokes). Toggled by the lock button
                         // in the draw toolbar and the player bar.
};

G.drawStrokes = _drawStrokes;
G.currentStroke = _currentStroke;
G.exportDrag = _exportDrag;
G.captureDrag = _captureDrag;
G.captureResultCanvas = _captureResultCanvas;
G.nextZ = _nextZ;
G.nextId = _nextId;
G.nextGroupId = _nextGroupId;
G.nextStrokeId = _nextStrokeId;
G.hoveredStroke = _hoveredStroke;
G.drawMoveState = _drawMoveState;
G.potentialTextDrag = _potentialTextDrag;
G.lastScreenX = _lastScreenX;
G.lastScreenY = _lastScreenY;

// Expose G globally so lib files (krafted-bridge.js) and any other code
// running BEFORE this file in the concatenated build can read mutable
// globals through `window.G`. Same for state, paperState, textTool,
// drawTool, colors — they're all top-level consts that don't auto-bind
// to window in <script> scope, so we explicitly publish them.
if (typeof window !== 'undefined') {
  window.G = G;
  window.state = state;
  window.Platform = Platform;
  window.paperState = paperState;
  window.textTool = textTool;
  window.drawTool = drawTool;
  window.colors = colors;
}


// _frozenGifs Map — defined here so cullOffscreenItems (in canvas-view.js)
// can reference it early. The media-bar section (originally ~line 9502)
// should reuse this export instead of redefining it.
export const _frozenGifs = new Map();
