
import { state, canvasContent } from './core-state.js';
import { scheduleAutoSave } from './save-load.js';
import { toast } from './ui-utils.js';
import { addImage } from './add-items.js';
import { setTool } from './tools.js';

// ============================================================
//  FREE SHAPE CUT — draw a freehand path on an image, extract
// ============================================================
export let cutState = null; // { itemId, points: [], isDragging, closed }
const cutOverlay = document.getElementById('cut-overlay');
const cutSvg = document.getElementById('cut-svg');
const cutPathEl = document.getElementById('cut-path');
const cutFillPathEl = document.getElementById('cut-fill-path');
const cutPanel = document.getElementById('cut-panel');
const cutTargetHighlight = document.getElementById('cut-target-highlight');
const cutPreviewMask = document.getElementById('cut-preview-mask');
const cutExtractBtn = document.getElementById('cut-extract-btn');
const cutRedrawBtn = document.getElementById('cut-redraw-btn');
const cutHint = document.getElementById('cut-hint');

export function enterCutMode(item) {
  cancelCut();
  cutState = { itemId: item.id, points: [], isDragging: false, closed: false };
  cutOverlay.classList.add('active');
  cutPanel.classList.add('active');
  cutExtractBtn.style.display = 'none';
  cutRedrawBtn.style.display = 'none';
  cutHint.textContent = 'Draw on image to cut';
  updateCutTargetHighlight();
}

export function updateCutTargetHighlight() {
  if (!cutState) { cutTargetHighlight.classList.remove('active'); return; }
  const item = state.items.find(i => i.id === cutState.itemId);
  if (!item) { cutTargetHighlight.classList.remove('active'); return; }
  const r = item.el.getBoundingClientRect();
  cutTargetHighlight.classList.add('active');
  cutTargetHighlight.style.left = (r.left - 2) + 'px';
  cutTargetHighlight.style.top = (r.top - 2) + 'px';
  cutTargetHighlight.style.width = (r.width + 4) + 'px';
  cutTargetHighlight.style.height = (r.height + 4) + 'px';
}

export function getCutItem() {
  if (!cutState) return null;
  return state.items.find(i => i.id === cutState.itemId);
}

export function cancelCut() {
  cutState = null;
  cutOverlay.classList.remove('active');
  cutPanel.classList.remove('active');
  cutTargetHighlight.classList.remove('active');
  cutPreviewMask.classList.remove('active');
  cutPathEl.setAttribute('d', '');
  cutFillPathEl.setAttribute('d', '');
  cutExtractBtn.style.display = 'none';
  cutRedrawBtn.style.display = 'none';
}

export function clearCutPath() {
  if (!cutState) return;
  cutState.points = [];
  cutState.closed = false;
  cutPathEl.setAttribute('d', '');
  cutPathEl.classList.remove('closed');
  cutFillPathEl.setAttribute('d', '');
  cutPreviewMask.classList.remove('active');
  cutExtractBtn.style.display = 'none';
  cutRedrawBtn.style.display = 'none';
  cutHint.textContent = 'Draw on image to cut';
}

// Start drawing path on the image
export function startCutDraw(clientX, clientY) {
  if (!cutState) return;
  cutState.points = [{ x: clientX, y: clientY }];
  cutState.isDragging = true;
  cutState.closed = false;
  cutPathEl.setAttribute('d', 'M ' + clientX + ' ' + clientY);
  cutPathEl.classList.remove('closed');
  cutFillPathEl.setAttribute('d', '');
  cutPreviewMask.classList.remove('active');
  cutExtractBtn.style.display = 'none';
  cutRedrawBtn.style.display = 'none';
}

// Update path while dragging
export function updateCutDraw(clientX, clientY) {
  if (!cutState || !cutState.isDragging) return;
  const pts = cutState.points;
  const last = pts[pts.length - 1];
  // Only add point if moved enough (reduce point count for performance)
  const dx = clientX - last.x, dy = clientY - last.y;
  if (dx * dx + dy * dy < 4) return;
  pts.push({ x: clientX, y: clientY });
  // Build SVG path — smooth via simple line-to for real-time
  let d = 'M ' + pts[0].x + ' ' + pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    d += ' L ' + pts[i].x + ' ' + pts[i].y;
  }
  cutPathEl.setAttribute('d', d);
}

// Finish drawing path — close it
export function endCutDraw() {
  if (!cutState || !cutState.isDragging) return;
  cutState.isDragging = false;
  if (cutState.points.length < 3) {
    // Too few points — reset
    clearCutPath();
    return;
  }
  cutState.closed = true;
  // Close the path visually
  let d = 'M ' + cutState.points[0].x + ' ' + cutState.points[0].y;
  for (let i = 1; i < cutState.points.length; i++) {
    d += ' L ' + cutState.points[i].x + ' ' + cutState.points[i].y;
  }
  d += ' Z';
  cutPathEl.setAttribute('d', d);
  cutPathEl.classList.add('closed');
  cutFillPathEl.setAttribute('d', d);
  // Show extract + redraw buttons
  cutExtractBtn.style.display = '';
  cutRedrawBtn.style.display = '';
  cutHint.textContent = 'Extract or redraw';
}

// Extract the area inside the freehand path as a new image item
export function applyCutExtract() {
  const item = getCutItem();
  if (!item || !cutState || !cutState.closed || cutState.points.length < 3) return;
  const imgEl = item.el.querySelector('img');
  if (!imgEl || !imgEl.complete) { toast('Image not loaded'); return; }
  const imgW = imgEl.naturalWidth || item.natW;
  const imgH = imgEl.naturalHeight || item.natH;
  const r = item.el.getBoundingClientRect();
  // Convert screen points to image pixel coordinates
  const imgPoints = cutState.points.map(p => ({
    x: ((p.x - r.left) / r.width) * imgW,
    y: ((p.y - r.top) / r.height) * imgH
  }));
  try {
    // Create full-resolution canvas
    const cv = document.createElement('canvas');
    cv.width = imgW; cv.height = imgH;
    const ctx = cv.getContext('2d');
    // Draw the path and clip
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(imgPoints[0].x, imgPoints[0].y);
    for (let i = 1; i < imgPoints.length; i++) {
      ctx.lineTo(imgPoints[i].x, imgPoints[i].y);
    }
    ctx.closePath();
    ctx.clip();
    // Draw the image clipped to the path
    ctx.drawImage(imgEl, 0, 0, imgW, imgH);
    ctx.restore();
    const dataURL = cv.toDataURL('image/png');
    const newItem = addImage(dataURL, imgW, imgH, item.x + item.w + 20 / state.zoom, item.y);
    toast('Cut shape extracted');
    // Reset for next cut
    clearCutPath();
  } catch (e) {
    toast('Cannot cut this image (cross-origin)');
  }
}

// ============================================================
//  LASSO — click points to define polygon, extract with border
// ============================================================
export let lassoState = null; // { itemId, points: [{x,y}], closed }
const lassoOverlay = document.getElementById('lasso-overlay');
const lassoSvg = document.getElementById('lasso-svg');
const lassoPathEl = document.getElementById('lasso-path');
const lassoFillPathEl = document.getElementById('lasso-fill-path');
const lassoPanel = document.getElementById('lasso-panel');
const lassoTargetHighlight = document.getElementById('lasso-target-highlight');
const lassoHint = document.getElementById('lasso-hint');
const lassoExtractBtn = document.getElementById('lasso-extract-btn');
const lassoCloseBtn = document.getElementById('lasso-close-btn');
const lassoUndoBtn = document.getElementById('lasso-undo-btn');
let lassoPointEls = []; // DOM elements for point markers

export function enterLassoMode(item) {
  cancelLasso();
  lassoState = { itemId: item.id, points: [], closed: false };
  lassoOverlay.classList.add('active');
  lassoPanel.classList.add('active');
  lassoExtractBtn.style.display = 'none';
  lassoCloseBtn.style.display = 'none';
  lassoUndoBtn.style.display = 'none';
  lassoHint.textContent = 'Click points on image to define cut area';
  updateLassoTargetHighlight();
}

export function updateLassoTargetHighlight() {
  if (!lassoState) { lassoTargetHighlight.classList.remove('active'); return; }
  const item = state.items.find(i => i.id === lassoState.itemId);
  if (!item) { lassoTargetHighlight.classList.remove('active'); return; }
  const r = item.el.getBoundingClientRect();
  lassoTargetHighlight.classList.add('active');
  lassoTargetHighlight.style.left = (r.left - 2) + 'px';
  lassoTargetHighlight.style.top = (r.top - 2) + 'px';
  lassoTargetHighlight.style.width = (r.width + 4) + 'px';
  lassoTargetHighlight.style.height = (r.height + 4) + 'px';
}

export function getLassoItem() {
  if (!lassoState) return null;
  return state.items.find(i => i.id === lassoState.itemId);
}

export function cancelLasso() {
  lassoState = null;
  lassoOverlay.classList.remove('active');
  lassoPanel.classList.remove('active');
  lassoTargetHighlight.classList.remove('active');
  lassoPathEl.setAttribute('d', '');
  lassoFillPathEl.setAttribute('d', '');
  lassoExtractBtn.style.display = 'none';
  lassoCloseBtn.style.display = 'none';
  lassoUndoBtn.style.display = 'none';
  clearLassoPoints();
}

export function clearLassoPoints() {
  lassoPointEls.forEach(el => el.remove());
  lassoPointEls = [];
}

export function addLassoPoint(clientX, clientY) {
  if (!lassoState || lassoState.closed) return;
  // Check if clicking near first point to close
  if (lassoState.points.length >= 3) {
    const first = lassoState.points[0];
    const dx = clientX - first.x, dy = clientY - first.y;
    if (dx * dx + dy * dy < 196) { // within 14px
      closeLasso();
      return;
    }
  }
  lassoState.points.push({ x: clientX, y: clientY });
  renderLassoPath();
  renderLassoPoints();
  lassoUndoBtn.style.display = '';
  if (lassoState.points.length >= 3) {
    lassoCloseBtn.style.display = '';
  }
  lassoHint.textContent = lassoState.points.length + ' points — click to add, click first point to close';
}

export function undoLassoPoint() {
  if (!lassoState || lassoState.closed || lassoState.points.length === 0) return;
  lassoState.points.pop();
  renderLassoPath();
  renderLassoPoints();
  if (lassoState.points.length < 3) lassoCloseBtn.style.display = 'none';
  if (lassoState.points.length === 0) lassoUndoBtn.style.display = 'none';
  lassoHint.textContent = lassoState.points.length + ' points — click to add';
}

export function closeLasso() {
  if (!lassoState || lassoState.points.length < 3) return;
  lassoState.closed = true;
  renderLassoPath();
  renderLassoPoints();
  lassoCloseBtn.style.display = 'none';
  lassoExtractBtn.style.display = '';
  lassoHint.textContent = 'Extract or undo points';
}

export function renderLassoPath() {
  if (!lassoState || lassoState.points.length === 0) {
    lassoPathEl.setAttribute('d', '');
    lassoFillPathEl.setAttribute('d', '');
    return;
  }
  const pts = lassoState.points;
  let d = 'M ' + pts[0].x + ' ' + pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    d += ' L ' + pts[i].x + ' ' + pts[i].y;
  }
  if (lassoState.closed) {
    d += ' Z';
    lassoFillPathEl.setAttribute('d', d);
  } else {
    lassoFillPathEl.setAttribute('d', '');
  }
  lassoPathEl.setAttribute('d', d);
}

export function renderLassoPoints() {
  clearLassoPoints();
  if (!lassoState) return;
  lassoState.points.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'lasso-point' + (i === 0 ? ' first-point' : '');
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    if (i === 0 && lassoState.points.length >= 3 && !lassoState.closed) {
      el.onclick = (e) => { e.stopPropagation(); closeLasso(); };
    }
    document.body.appendChild(el);
    lassoPointEls.push(el);
  });
}

export function applyLassoExtract() {
  const item = getLassoItem();
  if (!item || !lassoState || !lassoState.closed || lassoState.points.length < 3) return;
  const imgEl = item.el.querySelector('img');
  if (!imgEl || !imgEl.complete) { toast('Image not loaded'); return; }
  const imgW = imgEl.naturalWidth || item.natW;
  const imgH = imgEl.naturalHeight || item.natH;
  const r = item.el.getBoundingClientRect();
  const withBorder = document.getElementById('lasso-border-toggle').checked;
  const borderColor = document.getElementById('lasso-border-color').value;
  // Convert screen points to image pixel coordinates
  const imgPoints = lassoState.points.map(p => ({
    x: ((p.x - r.left) / r.width) * imgW,
    y: ((p.y - r.top) / r.height) * imgH
  }));
  try {
    const cv = document.createElement('canvas');
    cv.width = imgW; cv.height = imgH;
    const ctx = cv.getContext('2d');
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(imgPoints[0].x, imgPoints[0].y);
    for (let i = 1; i < imgPoints.length; i++) {
      ctx.lineTo(imgPoints[i].x, imgPoints[i].y);
    }
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(imgEl, 0, 0, imgW, imgH);
    ctx.restore();
    // Draw border on top (outside clip)
    if (withBorder) {
      ctx.beginPath();
      ctx.moveTo(imgPoints[0].x, imgPoints[0].y);
      for (let i = 1; i < imgPoints.length; i++) {
        ctx.lineTo(imgPoints[i].x, imgPoints[i].y);
      }
      ctx.closePath();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = Math.max(2, Math.round(imgW * 0.005));
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    const dataURL = cv.toDataURL('image/png');
    const newItem = addImage(dataURL, imgW, imgH, item.x + item.w + 20 / state.zoom, item.y);
    toast('Lasso extracted' + (withBorder ? ' with border' : ''));
    cancelLasso();
    setTool('select');
  } catch (e) {
    toast('Cannot cut this image (cross-origin)');
  }
}

window.enterCutMode = enterCutMode;
window.enterLassoMode = enterLassoMode;

