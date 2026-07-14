import { getSelectedItems } from './selection.js';
import { state, paperState, canvasContent } from './core-state.js';
import { scheduleAutoSave } from './save-load.js';
import { toast } from './ui-utils.js';
import { scheduleAutoSave } from './save-load.js';

// ============================================================
//  PAPER / ARTBOARD
// ============================================================
export function updatePaper() {
  const paperEl = document.getElementById('paper');
  if (!paperState.enabled) {
    paperEl.style.display = 'none';
    document.getElementById('canvas').style.background = '';
    return;
  }
  paperEl.style.display = 'block';
  paperEl.style.width = paperState.width + 'px';
  paperEl.style.height = paperState.height + 'px';
  paperEl.style.background = paperState.color;
  // Center the paper at world origin (0,0) inside canvas-content
  // If auto-fit is enabled and we have items, center on the content bounding box
  if (paperState.autoFit) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const allItems = [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])];
    allItems.forEach(i => {
      if (i.x < minX) minX = i.x;
      if (i.y < minY) minY = i.y;
      if (i.x + (i.w||0) > maxX) maxX = i.x + (i.w||0);
      if (i.y + (i.h||0) > maxY) maxY = i.y + (i.h||0);
    });
    if (minX !== Infinity) {
      const pad = 60;
      paperEl.style.left = (minX - pad) + 'px';
      paperEl.style.top = (minY - pad) + 'px';
      paperEl.style.width = (maxX - minX + pad * 2) + 'px';
      paperEl.style.height = (maxY - minY + pad * 2) + 'px';
    } else {
      paperEl.style.left = -(paperState.width / 2) + 'px';
      paperEl.style.top = -(paperState.height / 2) + 'px';
    }
  } else {
    paperEl.style.left = -(paperState.width / 2) + 'px';
    paperEl.style.top = -(paperState.height / 2) + 'px';
  }
}

// Calculate bounding box of all items + texts and auto-size the paper
export function updateAutoFitPaper() {
  if (!paperState.autoFit) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  // Check image/video/link items
  for (const item of state.items) {
    if (item.x < minX) minX = item.x;
    if (item.y < minY) minY = item.y;
    if (item.x + item.w > maxX) maxX = item.x + item.w;
    if (item.y + item.h > maxY) maxY = item.y + item.h;
  }
  // Check text items
  for (const tx of state.texts) {
    if (tx.x < minX) minX = tx.x;
    if (tx.y < minY) minY = tx.y;
    if (tx.x + tx.w > maxX) maxX = tx.x + tx.w;
    if (tx.y + tx.h > maxY) maxY = tx.y + tx.h;
  }
  // If no items, use default size
  if (minX === Infinity) {
    paperState.width = 1920;
    paperState.height = 1080;
  } else {
    const padding = 60;
    paperState.width = Math.max(100, Math.round(maxX - minX + padding * 2));
    paperState.height = Math.max(100, Math.round(maxY - minY + padding * 2));
  }
  // Update UI inputs
  const wInput = document.getElementById('paper-w');
  const hInput = document.getElementById('paper-h');
  if (wInput) wInput.value = paperState.width;
  if (hInput) hInput.value = paperState.height;
  updatePaper();
}

export function toggleAutoFit(enabled) {
  paperState.autoFit = enabled;
  if (enabled) {
    paperState.enabled = true;
    document.getElementById('paper-controls').style.display = 'block';
    document.getElementById('btn-paper-toggle').textContent = 'Hide Paper';
    // Disable manual size inputs when auto-fit is on
    const wInput = document.getElementById('paper-w');
    const hInput = document.getElementById('paper-h');
    if (wInput) wInput.disabled = true;
    if (hInput) hInput.disabled = true;
    updateAutoFitPaper();
  } else {
    // Re-enable manual size inputs
    const wInput = document.getElementById('paper-w');
    const hInput = document.getElementById('paper-h');
    if (wInput) wInput.disabled = false;
    if (hInput) hInput.disabled = false;
  }
  scheduleAutoSave();
}

export function togglePaper(enabled) {
  paperState.enabled = enabled;
  document.getElementById('paper-controls').style.display = enabled ? 'block' : 'none';
  if (!enabled && paperState.autoFit) {
    paperState.autoFit = false;
    const btn = document.getElementById('btn-autofit-toggle');
    if (btn) { btn.textContent = 'Auto-fit: OFF'; btn.style.color = ''; }
    const wInput = document.getElementById('paper-w');
    const hInput = document.getElementById('paper-h');
    if (wInput) wInput.disabled = false;
    if (hInput) hInput.disabled = false;
  }
  updatePaper();
  scheduleAutoSave();
}

export function setPaperSize(w, h) {
  paperState.width = w;
  paperState.height = h;
  updatePaper();
  scheduleAutoSave();
}

export function setPaperColor(color) {
  paperState.color = color;
  updatePaper();
  scheduleAutoSave();
}

export function setCanvasBg(color) {
  document.documentElement.style.setProperty('--canvas-bg', color);
  scheduleAutoSave();
}

