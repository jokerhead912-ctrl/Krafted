
import { state, canvas, viewport, captureBox, captureOverlay, captureHint, exportBox, toolBadge, IS_TOUCH_DEVICE } from './core-state.js';
import { _startRelationTool } from './relations.js';
import { cancelCut, cancelLasso, cutState, lassoState } from './cut-lasso.js';
import { removeBrushCanvas } from './masking.js';
import { setCaptureMode } from './capture.js';
import { showTextQuickBar } from './text-style.js';
import { toast } from './ui-utils.js';

// ============================================================
//  TOOLS
// ============================================================
export function setTool(tool) {
  // Clean up any in-progress drag operations
  if (G.captureDrag) { G.captureDrag = null; captureBox.style.display = 'none'; captureOverlay.style.display = 'none'; document.body.style.cursor = ''; setCaptureMode(false); }
  captureHint.style.display = 'none';
  if (G.exportDrag) { G.exportDrag = null; exportBox.style.display = 'none'; }
  // Clean up cut mode
  if (cutState) cancelCut();
  // Clean up lasso mode
  if (lassoState) cancelLasso();
  // Clean up mask editing
  if (window.maskPickColorActive) { window.maskPickColorActive = false; document.getElementById('viewport').classList.remove('mask-pick-mode'); }
  if (window.maskBrushActive) { window.maskBrushActive = false; removeBrushCanvas(); }
  // Hide text quick bar
  showTextQuickBar(false);

  state.tool = tool;
  document.querySelectorAll('#toolbar button').forEach(b => b.classList.remove('active'));
  const btnMap = { select: 'btn-select', text: 'btn-text', draw: 'btn-draw', export: 'btn-export', capture: 'btn-capture', cut: 'btn-cut', lasso: 'btn-lasso', mindmap: 'btn-mindmap', relation: 'btn-relation' };
  if (btnMap[tool]) document.getElementById(btnMap[tool]).classList.add('active');
  document.getElementById('text-toolbar').classList.toggle('active', tool === 'text');
  document.getElementById('draw-toolbar').classList.toggle('active', tool === 'draw');
  if (tool === 'export') { toast('Drag to select export area'); }
  if (tool === 'capture') { toast('Drag to select capture area'); captureHint.style.display = 'block'; }
  if (tool === 'cut') { toast('Click an image to start cutting'); cancelCut(); }
  if (tool === 'lasso') { toast('Click an image to start lasso cutting'); cancelLasso(); }
  if (tool === 'relation') { _startRelationTool(); }

  // Custom cursors per tool — SVG data URI cursors with hotspot
  const cursors = {
    select: 'default',
    text: 'text',
    draw: 'crosshair',
    export: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Crect x='4' y='4' width='20' height='20' fill='none' stroke='%23f0a030' stroke-width='1.5' stroke-dasharray='3,2'/%3E%3Ccircle cx='14' cy='14' r='3' fill='%23f0a030'/%3E%3C/svg%3E\") 14 14, crosshair",
    capture: 'crosshair',
    cut: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Cpath d='M6 6L22 22M6 22L22 6' stroke='%2300e5ff' stroke-width='1.5' stroke-linecap='round'/%3E%3Ccircle cx='14' cy='14' r='4' fill='none' stroke='%2300e5ff' stroke-width='1.5' stroke-dasharray='2,1'/%3E%3C/svg%3E\") 14 14, crosshair",
    lasso: 'crosshair',
  };
  viewport.style.cursor = cursors[tool] || 'default';
  // Force items to inherit cursor when not in select mode (prevents move cursor on hover)
  viewport.classList.toggle('tool-active', tool !== 'select');

  // Update mobile toolbar active state
  if (IS_TOUCH_DEVICE) {
    document.querySelectorAll('#mobile-toolbar-left button, #mobile-toolbar-right button').forEach(function(b) { b.classList.remove('active'); });
    var mtMap = { select: 'mt-select', text: 'mt-text', draw: 'mt-draw' };
    var mtBtn = document.getElementById(mtMap[tool]);
    if (mtBtn) mtBtn.classList.add('active');
  }

  // Tool indicator badge
  const badgeData = {
    select: { icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2l5 12 1.5-4.5L14 8 3 2z"/></svg>', name: 'Select & Move' },
    text: { icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4V3h10v1M8 3v10M6 13h4"/></svg>', name: 'Text' },
    draw: { icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2l3 3-8 8H3v-3l8-8z"/><path d="M9.5 3.5l3 3"/></svg>', name: 'Draw' },
    export: { icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5h2l1-2h6l1 2h2v8H2V5z"/><circle cx="8" cy="9" r="2.5"/></svg>', name: 'Export — drag to select' },
    capture: { icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5V2h3M14 5V2h-3M2 11v3h3M14 11v3h-3"/><circle cx="8" cy="8" r="1.5"/></svg>', name: 'Capture — drag to select' },
    cut: { icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="11" r="2"/><circle cx="4" cy="4" r="2"/><path d="M5.5 5L14 12M5.5 10L14 3"/></svg>', name: 'Free Cut — click an image' },
    lasso: { icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8C2 5 5 3 8 3s6 2 6 5-3 5-6 5-6-2-6-5z" stroke-dasharray="2,1.5"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/></svg>', name: 'Lasso — click an image' },
    relation: { icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="2" cy="8" r="1.5"/><circle cx="14" cy="8" r="1.5"/><path d="M3.5 8h7"/><path d="M11 5l3 3-3 3"/></svg>', name: 'Relation — click two items to connect' },
  };
  if (badgeData[tool] && tool !== 'select') {
    toolBadge.querySelector('.tb-icon').innerHTML = badgeData[tool].icon;
    toolBadge.querySelector('.tb-name').textContent = badgeData[tool].name;
    toolBadge.classList.add('show');
  } else {
    toolBadge.classList.remove('show');
  }
}
