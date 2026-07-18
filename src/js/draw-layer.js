
import { state, drawTool, G, drawLayer } from './core-state.js';
import { scheduleAutoSave } from './save-load.js';
import { toast } from './ui-utils.js';
import { renderRelations } from './relations.js';;

// ============================================================
//  DRAWING
// ============================================================
export function setDrawMode(mode) {
  drawTool.mode = mode;
  ['pen','arrow','box','eraser'].forEach(m => {
    const btn = document.getElementById('dm-' + m);
    if (btn) btn.classList.toggle('active', mode === m);
  });
}
export function getDrawCtx() {
  const ctx = drawLayer.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
export function redrawDrawLayer() {
  const ctx = getDrawCtx();
  ctx.clearRect(0, 0, drawLayer.width, drawLayer.height);
  G.drawStrokes.forEach(stroke => {
    if (stroke.points.length < 2) return;
    ctx.globalAlpha = stroke.opacity;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (stroke.mode === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      // Draw as freehand path
      ctx.beginPath();
      stroke.points.forEach((p, i) => {
        const sx = p[0] * state.zoom + state.pan.x;
        const sy = p[1] * state.zoom + state.pan.y;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
    } else if (stroke.mode === 'arrow') {
      ctx.globalCompositeOperation = 'source-over';
      const p0 = stroke.points[0], p1 = stroke.points[1];
      const sx0 = p0[0] * state.zoom + state.pan.x;
      const sy0 = p0[1] * state.zoom + state.pan.y;
      const sx1 = p1[0] * state.zoom + state.pan.x;
      const sy1 = p1[1] * state.zoom + state.pan.y;
      // Draw line
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.stroke();
      // Draw arrowhead
      const angle = Math.atan2(sy1 - sy0, sx1 - sx0);
      const headLen = stroke.arrowHead || drawTool.arrowHead || 15;
      const spread = Math.PI / 7; // ~25 degrees
      ctx.beginPath();
      ctx.moveTo(sx1, sy1);
      ctx.lineTo(sx1 - headLen * Math.cos(angle - spread), sy1 - headLen * Math.sin(angle - spread));
      ctx.lineTo(sx1 - headLen * Math.cos(angle + spread), sy1 - headLen * Math.sin(angle + spread));
      ctx.closePath();
      ctx.fill();
    } else if (stroke.mode === 'box') {
      ctx.globalCompositeOperation = 'source-over';
      const p0 = stroke.points[0], p1 = stroke.points[1];
      const sx0 = p0[0] * state.zoom + state.pan.x;
      const sy0 = p0[1] * state.zoom + state.pan.y;
      const sx1 = p1[0] * state.zoom + state.pan.x;
      const sy1 = p1[1] * state.zoom + state.pan.y;
      const bx = Math.min(sx0, sx1), by = Math.min(sy0, sy1);
      const bw = Math.abs(sx1 - sx0), bh = Math.abs(sy1 - sy0);
      ctx.strokeRect(bx, by, bw, bh);
    } else {
      // Pen: freehand path with optional per-point pressure (variable line width)
      ctx.globalCompositeOperation = 'source-over';
      const hasPressure = stroke.points[0] && stroke.points[0].length >= 3;
      if (hasPressure) {
        // Variable-width pen — draw each segment with its own line width
        for (let i = 1; i < stroke.points.length; i++) {
          const p0 = stroke.points[i - 1];
          const p1 = stroke.points[i];
          const sx0 = p0[0] * state.zoom + state.pan.x;
          const sy0 = p0[1] * state.zoom + state.pan.y;
          const sx1 = p1[0] * state.zoom + state.pan.x;
          const sy1 = p1[1] * state.zoom + state.pan.y;
          // Average pressure of segment endpoints
          const pr = ((p0[2] || 0.5) + (p1[2] || 0.5)) / 2;
          // Clamp pressure and map to lineWidth: 0.0 → 30% of size, 0.5 → 80%, 1.0 → 100%
          const w = stroke.size * (0.3 + 0.7 * Math.min(1, Math.max(0, pr)));
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(sx0, sy0);
          ctx.lineTo(sx1, sy1);
          ctx.stroke();
        }
      } else {
        // Constant width (mouse / no pressure)
        ctx.lineWidth = stroke.size;
        ctx.beginPath();
        stroke.points.forEach((p, i) => {
          const sx = p[0] * state.zoom + state.pan.x;
          const sy = p[1] * state.zoom + state.pan.y;
          if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        });
        ctx.stroke();
      }
    }
  });
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  // Draw hovered stroke highlight
  if (G.hoveredStroke && !G.currentStroke && !G.drawMoveState) {
    const hs = G.hoveredStroke;
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = (hs.size || 3) + 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([6, 4]);
    if (hs.mode === 'arrow' && hs.points.length >= 2) {
      const p0 = hs.points[0], p1 = hs.points[1];
      const sx0 = p0[0] * state.zoom + state.pan.x, sy0 = p0[1] * state.zoom + state.pan.y;
      const sx1 = p1[0] * state.zoom + state.pan.x, sy1 = p1[1] * state.zoom + state.pan.y;
      ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.lineTo(sx1, sy1); ctx.stroke();
    } else if (hs.mode === 'box' && hs.points.length >= 2) {
      const p0 = hs.points[0], p1 = hs.points[1];
      const sx0 = p0[0] * state.zoom + state.pan.x, sy0 = p0[1] * state.zoom + state.pan.y;
      const sx1 = p1[0] * state.zoom + state.pan.x, sy1 = p1[1] * state.zoom + state.pan.y;
      ctx.strokeRect(Math.min(sx0,sx1), Math.min(sy0,sy1), Math.abs(sx1-sx0), Math.abs(sy1-sy0));
    } else if (hs.mode === 'pen') {
      ctx.beginPath();
      hs.points.forEach((p, i) => {
        const sx = p[0] * state.zoom + state.pan.x, sy = p[1] * state.zoom + state.pan.y;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
}
export function undoDraw() {
  if (G.drawStrokes.length === 0) return;
  const removed = G.drawStrokes.pop();
  // Remove associated draw item if exists
  if (removed.strokeId) {
    const drawItem = state.items.find(i => i.type === 'draw' && i.strokeId === removed.strokeId);
    if (drawItem) { drawItem.el.remove(); state.items = state.items.filter(i => i !== drawItem); }
  }
  redrawDrawLayer();
}
export function clearDraw() {
  // Remove all associated draw items
  G.drawStrokes.forEach(s => {
    if (s.strokeId) {
      const drawItem = state.items.find(i => i.type === 'draw' && i.strokeId === s.strokeId);
      if (drawItem) { drawItem.el.remove(); state.items = state.items.filter(i => i !== drawItem); }
    }
  });
  G.drawStrokes = [];
  state.relations = [];
  state.selectedRelation = null;
  renderRelations();
  redrawDrawLayer();
}

window.setDrawMode = setDrawMode;
window.clearDraw = clearDraw;
window.undoDraw = undoDraw;
window.redrawDrawLayer = redrawDrawLayer;

