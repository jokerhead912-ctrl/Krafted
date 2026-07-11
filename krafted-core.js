// ============================================================
//  STARTUP CHECKS
// ============================================================
console.log('[INIT] Krafted v4.4 loading...');
console.log('[INIT] JSZip available:', typeof JSZip);
console.log('[INIT] showSaveFilePicker available:', typeof window.showSaveFilePicker);
if (typeof JSZip === 'undefined') {
  console.error('[INIT] JSZip is NOT available! .kpak save will fail.');
}
if (typeof window.showSaveFilePicker === 'undefined') {
  console.warn('[INIT] showSaveFilePicker NOT available — saves will download to your browser\'s default Downloads folder instead of letting you choose a location.');
}
// ============================================================
//  STATE
// ============================================================
const state = {
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
function isPanTrigger(e) {
  if (state.spaceDown) return true;
  if (e.button === 1) return true; // middle mouse button
  if (state.altPanEnabled && e.button === 0 && e.altKey) return true; // Alt + Left click (Mac trackpad)
  return false;
}

const textTool = {
  font: 'Arial', size: 24, bold: false, italic: false, underline: false, strike: false,
  highlight: false, shadow: false, bg: false, outline: false, uppercase: false,
  color: '#ffffff', highlightColor: '#ffff00', align: 'left',
  activeColorTarget: 'color',
};
const drawTool = { color: '#ff4444', size: 3, opacity: 1, mode: 'pen', arrowHead: 15, pressure: true };
// Paper / artboard settings
const paperState = {
  enabled: false,
  autoFit: false,
  width: 1920,
  height: 1080,
  color: '#ffffff',
};
const colors = ['#ffffff','#ff4444','#ff8800','#ffdd00','#44ff44','#44ddff','#8844ff','#ff44aa','#ff8844','#88ff44','#44ffaa','#4488ff','#aa44ff','#ff4488','#444444','#888888','#cccccc','#000000','#224422','#442222'];
// All draw strokes (flat array — no layer system, just like images)
let drawStrokes = [];
let currentStroke = null;
let exportDrag = null;
let captureDrag = null;
let captureResultCanvas = null; // holds the last captured canvas for save/discard
const captureResultPanel = document.getElementById('capture-result');
const captureResultImg = document.getElementById('cr-preview-img');
const captureResultInfo = document.getElementById('cr-info');
let nextZ = 1;
let nextId = 1;
let nextGroupId = 1;
let nextStrokeId = 1; // for draw items
// Draw stroke hover/move state
let hoveredStroke = null;   // reference to stroke under cursor
let drawMoveState = null;   // { stroke, startWx, startWy, origPoints }
let potentialTextDrag = null;  // { el, startX, startY, triggered } — text-item drag-threshold state
// Mouse position tracking (for paste-at-cursor)
let lastScreenX = window.innerWidth / 2;
let lastScreenY = window.innerHeight / 2;

// DOM refs
const viewport = document.getElementById('viewport');
const canvas = document.getElementById('canvas');
const canvasContent = document.getElementById('canvas-content');
const drawLayer = document.getElementById('draw-layer');
const ctxMenu = document.getElementById('ctx-menu');
const selBox = document.getElementById('sel-box');
const exportBox = document.getElementById('export-box');
const captureBox = document.getElementById('capture-box');
const captureOverlay = document.getElementById('capture-overlay');
const captureHint = document.getElementById('capture-hint');
const coPanels = {
  top: document.getElementById('co-top'),
  bottom: document.getElementById('co-bottom'),
  left: document.getElementById('co-left'),
  right: document.getElementById('co-right')
};
const toolBadge = document.getElementById('tool-badge');
const toastEl = document.getElementById('toast');
