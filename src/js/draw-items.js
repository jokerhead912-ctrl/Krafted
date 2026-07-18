
import { state, G, canvasContent } from './core-state.js';
import { scheduleAutoSave } from './save-load.js';
import { toast } from './ui-utils.js';
import { redrawDrawLayer } from './draw-layer.js';
import { updateItemStyle } from './add-items.js';;

// ============================================================
//  CREATE DRAW ITEM — convert stroke into selectable/grooupable item
// ============================================================
export function createDrawItem(stroke) {
  // Compute bounding box from points
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  stroke.points.forEach(p => {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  });
  // Add padding based on stroke size + hit target needs
  const pad = Math.max(stroke.size * 1.5, 12);
  const x = minX - pad;
  const y = minY - pad;
  const w = Math.max(maxX - minX + pad * 2, 20);
  const h = Math.max(maxY - minY + pad * 2, 20);
  
  const el = document.createElement('div');
  el.className = 'item draw-item';
  el.style.cssText = 'background:transparent;border:none;pointer-events:auto;';
  canvasContent.appendChild(el);
  
  const item = {
    id: G.nextId++, el, type: 'draw',
    x, y, w, h, rot: 0, opacity: 1, flipH: false, flipV: false, locked: false,
    z: G.nextZ++,
    strokeId: stroke.strokeId,
    drawMode: stroke.mode,
    drawColor: stroke.color,
    drawSize: stroke.size,
    drawOpacity: stroke.opacity,
    drawArrowHead: stroke.arrowHead || 0,
  };
  state.items.push(item);
  updateItemStyle(item);
  return item;
}

// Helper: find stroke by strokeId
export function findStrokeById(strokeId) {
  return G.drawStrokes.find(s => s.strokeId === strokeId) || null;
}

// Remove stroke by strokeId
export function removeStrokeById(strokeId) {
  G.drawStrokes = G.drawStrokes.filter(s => s.strokeId !== strokeId);
}

// Update stroke points from draw item position changes
export function syncStrokeFromDrawItem(item) {
  const stroke = findStrokeById(item.strokeId);
  if (!stroke) return;
  // Compute the original center vs new center delta
  const pad = Math.max(stroke.size * 1.5, 12);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  stroke.points.forEach(p => {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  });
  const oldCx = minX + (maxX - minX) / 2;
  const oldCy = minY + (maxY - minY) / 2;
  const newCx = item.x + item.w / 2;
  const newCy = item.y + item.h / 2;
  const dx = newCx - oldCx;
  const dy = newCy - oldCy;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
  stroke.points = stroke.points.map(p => [p[0] + dx, p[1] + dy]);
  // Update item's bbox to match
  item.x += dx; item.y += dy;
  redrawDrawLayer();
}

// ============================================================
//  DRAW STROKE HIT-TESTING & MOVE
// ============================================================
const HIT_THRESHOLD = 8; // pixels in screen space

export function hitTestStrokes(wx, wy) {
  // Check all strokes, return the topmost one under cursor
  const sx = wx * state.zoom + state.pan.x;
  const sy = wy * state.zoom + state.pan.y;
  // Check in reverse order (topmost first)
  for (let i = G.drawStrokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    if (s.mode === 'eraser') continue;
    if (s.mode === 'pen' && s.points.length >= 2) {
      for (let j = 1; j < s.points.length; j++) {
        const p0 = s.points[j-1], p1 = s.points[j];
        const x0 = p0[0] * state.zoom + state.pan.x, y0 = p0[1] * state.zoom + state.pan.y;
        const x1 = p1[0] * state.zoom + state.pan.x, y1 = p1[1] * state.zoom + state.pan.y;
        if (distToSegment(sx, sy, x0, y0, x1, y1) < HIT_THRESHOLD + s.size / 2) return s;
      }
    } else if (s.mode === 'arrow' && s.points.length >= 2) {
      const p0 = s.points[0], p1 = s.points[1];
      const x0 = p0[0] * state.zoom + state.pan.x, y0 = p0[1] * state.zoom + state.pan.y;
      const x1 = p1[0] * state.zoom + state.pan.x, y1 = p1[1] * state.zoom + state.pan.y;
      if (distToSegment(sx, sy, x0, y0, x1, y1) < HIT_THRESHOLD + s.size / 2) return s;
      // Also check arrowhead
      const angle = Math.atan2(y1 - y0, x1 - x0);
      const headLen = s.arrowHead || 15;
      const spread = Math.PI / 7;
      const ax1 = x1 - headLen * Math.cos(angle - spread), ay1 = y1 - headLen * Math.sin(angle - spread);
      const ax2 = x1 - headLen * Math.cos(angle + spread), ay2 = y1 - headLen * Math.sin(angle + spread);
      if (distToSegment(sx, sy, x1, y1, ax1, ay1) < HIT_THRESHOLD + s.size / 2) return s;
      if (distToSegment(sx, sy, x1, y1, ax2, ay2) < HIT_THRESHOLD + s.size / 2) return s;
    } else if (s.mode === 'box' && s.points.length >= 2) {
      const p0 = s.points[0], p1 = s.points[1];
      const x0 = p0[0] * state.zoom + state.pan.x, y0 = p0[1] * state.zoom + state.pan.y;
      const x1 = p1[0] * state.zoom + state.pan.x, y1 = p1[1] * state.zoom + state.pan.y;
      const bx = Math.min(x0,x1), by = Math.min(y0,y1), bw = Math.abs(x1-x0), bh = Math.abs(y1-y0);
      // Check all 4 edges
      if (distToSegment(sx, sy, bx, by, bx+bw, by) < HIT_THRESHOLD + s.size/2) return s;
      if (distToSegment(sx, sy, bx+bw, by, bx+bw, by+bh) < HIT_THRESHOLD + s.size/2) return s;
      if (distToSegment(sx, sy, bx+bw, by+bh, bx, by+bh) < HIT_THRESHOLD + s.size/2) return s;
      if (distToSegment(sx, sy, bx, by+bh, bx, by) < HIT_THRESHOLD + s.size/2) return s;
    }
  }
  return null;
}

export function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function moveStroke(stroke, dx, dy) {
  stroke.points = stroke.points.map(p => [p[0] + dx, p[1] + dy]);
}
