
import { state, G, exportBox, canvasContent, canvas, viewport } from './core-state.js';
import { scheduleAutoSave } from './save-load.js';
import { toast } from './ui-utils.js';;

// ============================================================
//  EXPORT PNG
// ============================================================
export function startExportDrag() {
  G.exportDrag = { startX: 0, startY: 0 };
  exportBox.style.display = 'block';
  exportBox.style.left = '0px'; exportBox.style.top = '0px';
  exportBox.style.width = '0px'; exportBox.style.height = '0px';
}
export function updateExport(e) {
  if (!G.exportDrag) return;
  const x1 = Math.min(G.exportDrag.startX, e.clientX);
  const y1 = Math.min(G.exportDrag.startY, e.clientY);
  const w = Math.abs(e.clientX - G.exportDrag.startX);
  const h = Math.abs(e.clientY - G.exportDrag.startY);
  exportBox.style.left = x1 + 'px';
  exportBox.style.top = y1 + 'px';
  exportBox.style.width = w + 'px';
  exportBox.style.height = h + 'px';
}
export function finishExport(e) {
  if (!G.exportDrag) return;
  const x1 = Math.min(G.exportDrag.startX, e.clientX);
  const y1 = Math.min(G.exportDrag.startY, e.clientY);
  const w = Math.abs(e.clientX - G.exportDrag.startX);
  const h = Math.abs(e.clientY - G.exportDrag.startY);
  exportBox.style.display = 'none';
  G.exportDrag = null;
  if (w < 10 || h < 10) return;
  renderExport(x1, y1, w, h);
}
// === EXPORT BACKGROUND CONTROL ===
// v3.10: user can now choose export bg color (default #2a2a3e, with a
// transparent option). Choice persists across sessions via localStorage.
const EXPORT_BG_KEY = 'krafted_export_bg';
const EXPORT_BG_TRANS_KEY = 'krafted_export_bg_transparent';
let lastExportArea = null;
let exportBgColor = '#2a2a3e';
let exportBgTransparent = false;
try {
  const saved = localStorage.getItem(EXPORT_BG_KEY);
  if (saved && /^#[0-9a-fA-F]{6}$/.test(saved)) exportBgColor = saved;
  const savedT = localStorage.getItem(EXPORT_BG_TRANS_KEY);
  if (savedT === '1') exportBgTransparent = true;
} catch(e) {}
export function setExportBg(color) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color || '')) return;
  exportBgColor = color;
  exportBgTransparent = false;
  try { localStorage.setItem(EXPORT_BG_KEY, color); localStorage.setItem(EXPORT_BG_TRANS_KEY, '0'); } catch(e) {}
  syncExportBgUI();
  rerenderExport();
}
export function setExportBgTransparent(on) {
  exportBgTransparent = !!on;
  try { localStorage.setItem(EXPORT_BG_TRANS_KEY, on ? '1' : '0'); } catch(e) {}
  syncExportBgUI();
  rerenderExport();
}
export function syncExportBgUI() {
  const c = document.getElementById('export-bg-color');
  const t = document.getElementById('export-bg-transparent');
  if (c) c.value = exportBgColor;
  if (t) t.checked = exportBgTransparent;
}
export function rerenderExport() {
  if (lastExportArea) {
    renderExport(lastExportArea.x1, lastExportArea.y1, lastExportArea.w, lastExportArea.h);
  }
}
// Apply saved prefs to the modal UI on first load
syncExportBgUI();
export function renderExport(sx, sy, sw, sh) {
  // Hide media UI so it doesn't bleed into the exported PNG
  setCaptureMode(true);
  void document.body.offsetHeight; // force reflow before measuring
  try {
  const scale = 2;
  const cv = document.getElementById('export-canvas');
  cv.width = sw * scale;
  cv.height = sh * scale;
  cv.style.width = sw + 'px';
  cv.style.height = sh + 'px';
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);
  // v3.10: user-controllable export background (color or transparent)
  if (exportBgTransparent) {
    ctx.clearRect(0, 0, sw, sh);
  } else {
    ctx.fillStyle = exportBgColor;
    ctx.fillRect(0, 0, sw, sh);
  }
  // Remember the area so a color/toggle change can re-render the preview
  lastExportArea = {x1: sx, y1: sy, w: sw, h: sh};
  // Render items
  [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])].sort((a, b) => a.z - b.z).forEach(item => {
    const el = item.el;
    const r = el.getBoundingClientRect();
    const ix = r.left - sx, iy = r.top - sy;
    const iw = r.width, ih = r.height;
    if (ix + iw < 0 || iy + ih < 0 || ix > sw || iy > sh) return;
    ctx.save();
    ctx.globalAlpha = item.opacity !== undefined ? item.opacity : 1;
    const cx = ix + iw / 2, cy = iy + ih / 2;
    ctx.translate(cx, cy);
    ctx.rotate((item.rot || 0) * Math.PI / 180);
    ctx.scale(item.flipH ? -1 : 1, item.flipV ? -1 : 1);
    if (item.img || item.video) {
      // Build full filter string including temperature, shadow, highlight
      let tempFilter = '';
      const temp = item.temp || 0;
      if (temp > 0) tempFilter = ` sepia(${temp*0.3}%) saturate(${100+temp*0.5}%)`;
      else if (temp < 0) tempFilter = ` hue-rotate(${Math.abs(temp)*0.6}deg) saturate(${100+temp*0.2}%)`;
      // Shadow filter
      let shadowFilter = '';
      const shadowVal = item.shadow !== undefined ? item.shadow : 100;
      if (shadowVal !== 100) { shadowFilter = ` brightness(${100 + (shadowVal - 100) * 0.4}%)`; }
      // Highlight filter
      let highlightFilter = '';
      const highlightVal = item.highlight !== undefined ? item.highlight : 100;
      if (highlightVal !== 100) { highlightFilter = ` contrast(${100 + (highlightVal - 100) * 0.4}%)`; }
      ctx.filter = `brightness(${item.brightness||100}%) contrast(${item.contrast||100}%) saturate(${item.saturate||100}%) hue-rotate(${item.hueRotate||0}deg) blur(${item.blur||0}px) sepia(${item.sepia||0}%) grayscale(${item.grayscale||0}%)${tempFilter}${shadowFilter}${highlightFilter}`;
      const drawSrc = item.video || item.img;
      try { ctx.drawImage(drawSrc, -iw/2, -ih/2, iw, ih); } catch(e) {}
      ctx.filter = 'none';
      // Mask overlays
      drawMasksOnCanvas(ctx, item, iw, ih);
      // Vignette overlay
      if (item.vignette && item.vignette > 0) {
        const intensity = item.vignette / 100;
        const vGrad = ctx.createRadialGradient(0, 0, Math.min(iw,ih) * (0.3 + intensity * 0.2), 0, 0, Math.max(iw,ih) * 0.7);
        vGrad.addColorStop(0, 'transparent');
        vGrad.addColorStop(1, `rgba(0,0,0,${intensity * 0.8})`);
        ctx.fillStyle = vGrad;
        ctx.fillRect(-iw/2, -ih/2, iw, ih);
      }
    } else if (item.el && item.el.classList.contains('todo-item')) {
      // Todo checklist — render as card on canvas
      ctx.fillStyle = '#1e1e2e';
      ctx.fillRect(-iw/2, -ih/2, iw, ih);
      ctx.strokeStyle = '#3a3a4e';
      ctx.lineWidth = 1;
      ctx.strokeRect(-iw/2, -ih/2, iw, ih);
      ctx.fillStyle = '#e0e0e0';
      ctx.font = 'bold 13px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(item.title || 'Checklist', -iw/2 + 14, -ih/2 + 12);
      ctx.font = '12px Inter, sans-serif';
      let ty = -ih/2 + 36;
      (item.items||[]).forEach(it => {
        ctx.fillStyle = it.done ? '#888' : '#e0e0e0';
        ctx.fillText((it.done ? '[x] ' : '[ ] ') + (it.text || ''), -iw/2 + 14, ty);
        ty += 18;
      });
    } else if (item.el && item.el.classList.contains('mindmap-item')) {
      // Mind map — render as dark card with nodes and connections
      ctx.fillStyle = '#161616';
      ctx.fillRect(-iw/2, -ih/2, iw, ih);
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 1;
      ctx.strokeRect(-iw/2, -ih/2, iw, ih);
      ctx.fillStyle = '#e0e0e0';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(item.title || 'Mind Map', -iw/2 + 10, -ih/2 + 8);
      // Draw connections
      (item.connections||[]).forEach(c => {
        const from = (item.nodes||[]).find(n => n.id === c.from);
        const to = (item.nodes||[]).find(n => n.id === c.to);
        if (!from || !to) return;
        ctx.strokeStyle = c.color || '#7c8cf0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-iw/2 + from.x + (from.w||100)/2, -ih/2 + from.y + (from.h||32)/2 + 30);
        ctx.lineTo(-iw/2 + to.x + (to.w||100)/2, -ih/2 + to.y + (to.h||32)/2 + 30);
        ctx.stroke();
        // Arrow head
        const ax = -iw/2 + to.x + (to.w||100)/2, ay = -ih/2 + to.y + (to.h||32)/2 + 30;
        const angle = Math.atan2(ay - (-ih/2 + from.y + (from.h||32)/2 + 30), ax - (-iw/2 + from.x + (from.w||100)/2));
        ctx.fillStyle = c.color || '#7c8cf0';
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - 8*Math.cos(angle-0.4), ay - 8*Math.sin(angle-0.4));
        ctx.lineTo(ax - 8*Math.cos(angle+0.4), ay - 8*Math.sin(angle+0.4));
        ctx.closePath();
        ctx.fill();
      });
      // Draw nodes
      (item.nodes||[]).forEach(n => {
        ctx.fillStyle = n.color || '#7c8cf0';
        const nw = n.w || 100, nh = n.h || 32;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-iw/2 + n.x, -ih/2 + n.y + 30, nw, nh, 8);
        else ctx.rect(-iw/2 + n.x, -ih/2 + n.y + 30, nw, nh);
        ctx.fill();
        // Draw node image if present
        if (n.img) {
          try {
            const nodeImg = new Image();
            nodeImg.src = n.img;
            const imgDispW = Math.min(120, nw - 8);
            const imgDispH = Math.min(80, n.imgH * (imgDispW / Math.max(n.imgW, 1)));
            ctx.save();
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(-iw/2 + n.x + 4, -ih/2 + n.y + 34, imgDispW, imgDispH, 4);
            else ctx.rect(-iw/2 + n.x + 4, -ih/2 + n.y + 34, imgDispW, imgDispH);
            ctx.clip();
            ctx.drawImage(nodeImg, -iw/2 + n.x + 4, -ih/2 + n.y + 34, imgDispW, imgDispH);
            ctx.restore();
          } catch(e) {}
        }
        // Draw audio indicator if present
        if (n.audio) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.font = '10px Inter, sans-serif';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'top';
          ctx.fillText('\u266B', -iw/2 + n.x + nw - 4, -ih/2 + n.y + 32);
        }
        ctx.fillStyle = n.textColor || '#ffffff';
        ctx.font = '500 11.5px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(n.text || '', -iw/2 + n.x + nw/2, -ih/2 + n.y + 30 + nh - 12);
      });
    } else if (!item.isLink) {
      // Text (skip link cards without cover image)
      ctx.font = `${item.italic?'italic ':''}${item.bold?'bold ':''}${item.size}px ${item.font}`;
      ctx.fillStyle = item.color;
      ctx.textAlign = item.align || 'left';
      ctx.textBaseline = 'top';
      const text = item.el.textContent;
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        let tx = -iw/2;
        if (item.align === 'center') tx = 0;
        else if (item.align === 'right') tx = iw/2;
        ctx.fillText(line, tx, -ih/2 + i * item.size * 1.3);
      });
    }
    ctx.restore();
  });
  // Render drawing
  ctx.globalCompositeOperation = 'source-over';
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
      ctx.beginPath();
      stroke.points.forEach((p, i) => {
        const px = p[0] * state.zoom + state.pan.x - sx;
        const py = p[1] * state.zoom + state.pan.y - sy;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    } else if (stroke.mode === 'arrow') {
      ctx.globalCompositeOperation = 'source-over';
      const p0 = stroke.points[0], p1 = stroke.points[1];
      const px0 = p0[0] * state.zoom + state.pan.x - sx;
      const py0 = p0[1] * state.zoom + state.pan.y - sy;
      const px1 = p1[0] * state.zoom + state.pan.x - sx;
      const py1 = p1[1] * state.zoom + state.pan.y - sy;
      ctx.beginPath();
      ctx.moveTo(px0, py0);
      ctx.lineTo(px1, py1);
      ctx.stroke();
      const angle = Math.atan2(py1 - py0, px1 - px0);
      const headLen = stroke.arrowHead || 15;
      const spread = Math.PI / 7;
      ctx.beginPath();
      ctx.moveTo(px1, py1);
      ctx.lineTo(px1 - headLen * Math.cos(angle - spread), py1 - headLen * Math.sin(angle - spread));
      ctx.lineTo(px1 - headLen * Math.cos(angle + spread), py1 - headLen * Math.sin(angle + spread));
      ctx.closePath();
      ctx.fill();
    } else if (stroke.mode === 'box') {
      ctx.globalCompositeOperation = 'source-over';
      const p0 = stroke.points[0], p1 = stroke.points[1];
      const px0 = p0[0] * state.zoom + state.pan.x - sx;
      const py0 = p0[1] * state.zoom + state.pan.y - sy;
      const px1 = p1[0] * state.zoom + state.pan.x - sx;
      const py1 = p1[1] * state.zoom + state.pan.y - sy;
      ctx.strokeRect(Math.min(px0,px1), Math.min(py0,py1), Math.abs(px1-px0), Math.abs(py1-py0));
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      stroke.points.forEach((p, i) => {
        const px = p[0] * state.zoom + state.pan.x - sx;
        const py = p[1] * state.zoom + state.pan.y - sy;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
  });
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  document.getElementById('export-modal').classList.add('active');
  } finally {
    setCaptureMode(false);
  }
}
export function downloadExport() {
  const cv = document.getElementById('export-canvas');
  const link = document.createElement('a');
  link.download = 'krafted_export_' + Date.now() + '.png';
  link.href = cv.toDataURL('image/png');
  link.click();
}
export function closeExport() {
  document.getElementById('export-modal').classList.remove('active');
}

