
import { state, drawLayer, canvas, _frozenGifs } from './core-state.js';
import { redrawDrawLayer } from './draw-layer.js';
import { updateAllGroupBorders } from './groups.js';
import { renderRelations } from './relations.js';
import { mmUpdateConnectors } from './mindmap.js';
import { repositionAllAnnoToolbars, repositionAllAnnoPopovers } from './delete.js';
import { isAnimatedGif } from './gif-editor.js';
import { toast } from './ui-utils.js';
import { cutState, lassoState } from './cut-lasso.js';

// ============================================================
//  CANVAS / VIEW
// ============================================================
export function updateCanvas() {
  // Canvas uses a large fixed area with coordinate offset (50000px) so the grid
  // covers all content including negative world coordinates. Items are inside
  // #canvas-content which is offset by 50000px, so world (0,0) maps to
  // canvas-local (50000, 50000) — always inside the canvas box.
  const OFF = 50000;
  canvas.style.transform = `translate(${state.pan.x + OFF - OFF * state.zoom}px, ${state.pan.y + OFF - OFF * state.zoom}px) scale(${state.zoom})`;
  const dpr = window.devicePixelRatio || 1;
  drawLayer.width = window.innerWidth * dpr;
  drawLayer.height = window.innerHeight * dpr;
  drawLayer.style.width = window.innerWidth + 'px';
  drawLayer.style.height = window.innerHeight + 'px';
  redrawDrawLayer();
  updateAllGroupBorders();
  // Update mind map connectors on pan/zoom
  (state.mindmaps||[]).forEach(mm => mmUpdateConnectors(mm));
  // Update relation lines on pan/zoom
  renderRelations();
  updateStatus();
  // Viewport culling: hide/freeze items outside visible area to keep framerate high.
  // Triggered on every pan/zoom. Cheap: just one rectangle-vs-rect test per item.
  cullOffscreenItems();
  // Round 52: keep the floating "draw panel" (.media-anno-toolbar) and the
  // "frame comment panel" (.media-anno-popover.list) glued to the video as
  // the canvas zooms. Both are appended to <body> at position: fixed and
  // sized by the video's screen-pixel BCR. updateCanvas() runs on every
  // pan/zoom tick, so this is the single hook to make them follow the
  // player. Each function early-returns if the panel is hidden / closed,
  // and the iteration is O(items) — fine for typical boards (1-3 vids).
  repositionAllAnnoToolbars();
  repositionAllAnnoPopovers();
}

// ============================================================
//  VIEWPORT CULLING (perf)
// ============================================================
// Computes the visible world-space rectangle, then for each item:
//   - If completely outside: set el.style.display = 'none' (static images) or
//     pause video / freeze GIF (videos/GIFs still pay decode cost even when hidden).
//   - If partially inside: leave alone (preserve partial visibility).
// Called on every updateCanvas() (pan/zoom). Throttled internally — only does work
// when visible bounds change by more than 50px.
export const _cullLast = { vx: -1e9, vy: -1e9, vw: -1, vh: -1 };
export function cullOffscreenItems() {
  // World-space visible rectangle: 4 corners transformed back to canvas-local.
  const vw = window.innerWidth, vh = window.innerHeight;
  // visible world rect = (viewport / zoom) - pan
  const wx = -state.pan.x / state.zoom;
  const wy = -state.pan.y / state.zoom;
  const ww = vw / state.zoom;
  const wh = vh / state.zoom;
  // Skip if bounds haven't moved much (cheap fast path)
  if (Math.abs(_cullLast.vx - wx) < 50 && Math.abs(_cullLast.vy - wy) < 50 &&
      Math.abs(_cullLast.vw - ww) < 50 && Math.abs(_cullLast.vh - wh) < 50) return;
  _cullLast.vx = wx; _cullLast.vy = wy; _cullLast.vw = ww; _cullLast.vh = wh;

  // Expand visible rect by 200px so partially-cropped items don't flicker on small pans
  const pad = 200;
  const x0 = wx - pad, y0 = wy - pad, x1 = wx + ww + pad, y1 = wy + wh + pad;
  const allItems = [
    ...state.items,
    ...state.texts,
    ...(state.todos||[]),
    ...(state.mindmaps||[])
  ];
  for (let i = 0; i < allItems.length; i++) {
    const it = allItems[i];
    if (!it.el) continue;
    const ix = it.x, iy = it.y;
    const iw = it.w || 100, ih = it.h || 100;
    // AABB test with padding (item must overlap visible area to be visible)
    if (ix + iw < x0 || ix > x1 || iy + ih < y0 || iy > y1) {
      // Off-screen
      if (!it._culled) {
        it._culled = true;
        if (it.video && !it.video.paused) {
          // Pause video but remember it was playing
          it._wasPlaying = true;
          it.video.pause();
        } else if (it.img && it.src && isAnimatedGif(it.src) && !_frozenGifs.has(it.id)) {
          // Freeze animated GIFs (replace with static first frame) — this is the biggest perf win
          try {
            const c = document.createElement('canvas');
            c.width = it.img.naturalWidth || it.natW || iw;
            c.height = it.img.naturalHeight || it.natH || ih;
            const cctx = c.getContext('2d');
            cctx.drawImage(it.img, 0, 0);
            const staticSrc = c.toDataURL('image/png');
            _frozenGifs.set(it.id, it.img.src);
            it.img.src = staticSrc;
          } catch (e) { /* CORS or other — skip freeze */ }
        }
      }
    } else {
      // On-screen
      if (it._culled) {
        it._culled = false;
        if (it.video && it._wasPlaying) {
          it.video.play().catch(() => {});
          it._wasPlaying = false;
        } else if (it.img && _frozenGifs.has(it.id)) {
          // Restore animated GIF
          const origSrc = _frozenGifs.get(it.id);
          if (it.img) it.img.src = origSrc;
          _frozenGifs.delete(it.id);
        }
      }
    }
  }
}
export function updateStatus() {
  const selCount = state.selected.size;
  const selText = selCount > 1 ? ` | ${selCount} selected (drag to move all)` : selCount === 1 ? ' | 1 selected' : '';
  document.getElementById('status').textContent = `Zoom: ${Math.round(state.zoom*100)}% | Items: ${state.items.length + state.texts.length + (state.todos?state.todos.length:0) + (state.mindmaps?state.mindmaps.length:0)}${selText} | Undo: ${state.undoStack.length}`;
}
export function zoomBy(factor, cx, cy) {
  zoomTo(state.zoom * factor, cx, cy);
}
export function zoomTo(z, cx, cy) {
  if (cx === undefined) { cx = window.innerWidth/2; cy = window.innerHeight/2; }
  const oldZ = state.zoom;
  state.zoom = Math.max(0.02, Math.min(10, z));
  state.pan.x = cx - (cx - state.pan.x) * (state.zoom / oldZ);
  state.pan.y = cy - (cy - state.pan.y) * (state.zoom / oldZ);
  updateCanvas();
}

// Frame / focus the viewport. Maya-style:
//   - If anything is selected, compute the union bounding box of the
//     selection (items, text, todo, mindmap) and zoom + pan so the box
//     fills ~80% of the visible area, centered on the viewport center.
//   - If nothing is selected, reset to the app-open default (zoom=1,
//     pan=(0,0)) so world (0,0) is at the top-left of the visible area.
// Bound to the F key and to the "🎯 Frame" button in the zoom-step widget.
export function frameSelection() {
  // Don't disturb the viewport while the user is mid-action on the board
  // (dragging an item, drawing, reframe, crop, free cut, lasso) — pressing
  // F should not yank the view out from under their cursor. We only block
  // when a real interaction is in flight.
  if (state.dragging || state.reframing || state.cropping || cutState || lassoState) return;
  const sel = state.selected;
  if (!sel || sel.size === 0) {
    // No selection: reset to default (zoom=1, pan=(0,0)) so world (0,0)
    // sits at the top-left of the visible area, like when the app opens.
    state.zoom = 1;
    state.pan.x = 0;
    state.pan.y = 0;
    updateCanvas();
    try { toast('View reset · 100% · (0, 0)  —  F'); } catch (e) {}
    return;
  }
  // Gather bounding boxes of every selected thing in WORLD coordinates.
  // Items: x/y/w/h are world coords. Texts and todos also use world x/y
  // with computed size. Mindmaps: use the union of all node positions.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;
  const selArr = Array.from(sel);
  for (const id of selArr) {
    const it = (state.items || []).find(i => i.id === id);
    if (it) {
      if (it.x < minX) minX = it.x;
      if (it.y < minY) minY = it.y;
      if (it.x + it.w > maxX) maxX = it.x + it.w;
      if (it.y + it.h > maxY) maxY = it.y + it.h;
      count++;
      continue;
    }
    const tx = (state.texts || []).find(t => t.id === id);
    if (tx && tx.el) {
      const r = tx.el.getBoundingClientRect();
      // Convert BCR back to world: subtract pan, divide by zoom.
      const wx = (r.left - state.pan.x) / state.zoom;
      const wy = (r.top  - state.pan.y) / state.zoom;
      const ww = r.width  / state.zoom;
      const wh = r.height / state.zoom;
      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wx + ww > maxX) maxX = wx + ww;
      if (wy + wh > maxY) maxY = wy + wh;
      count++;
      continue;
    }
    const td = (state.todos || []).find(t => t.id === id);
    if (td && td.el) {
      const r = td.el.getBoundingClientRect();
      const wx = (r.left - state.pan.x) / state.zoom;
      const wy = (r.top  - state.pan.y) / state.zoom;
      const ww = r.width  / state.zoom;
      const wh = r.height / state.zoom;
      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wx + ww > maxX) maxX = wx + ww;
      if (wy + wh > maxY) maxY = wy + wh;
      count++;
      continue;
    }
    const mm = (state.mindmaps || []).find(m => m.id === id);
    if (mm && Array.isArray(mm.nodes) && mm.nodes.length > 0) {
      mm.nodes.forEach(n => {
        if (typeof n.x === 'number' && typeof n.y === 'number') {
          if (n.x < minX) minX = n.x;
          if (n.y < minY) minY = n.y;
          if (n.x > maxX) maxX = n.x;
          if (n.y > maxY) maxY = n.y;
        }
      });
      count++;
    }
  }
  if (count === 0 || !isFinite(minX) || !isFinite(maxX)) {
    // Selected IDs don't match anything (e.g. mid-load, stale id). Fall
    // back to default so F still does something sensible.
    state.zoom = 1;
    state.pan.x = 0;
    state.pan.y = 0;
    updateCanvas();
    try { toast('View reset · 100% · (0, 0)  —  F'); } catch (e) {}
    return;
  }
  // Clamp degenerate selections (single point or zero-area) to a small
  // 80×60 region so we don't divide by zero in the zoom math.
  if (maxX - minX < 1) { minX -= 40; maxX += 40; }
  if (maxY - minY < 1) { minY -= 30; maxY += 30; }
  const bboxCx = (minX + maxX) / 2;
  const bboxCy = (minY + maxY) / 2;
  const bboxW  = maxX - minX;
  const bboxH  = maxY - minY;
  // Padding: leave ~12% margin around the bounding box so the selection
  // doesn't kiss the screen edges. 1.0 = tight, 1.5 = very generous.
  const PADDING = 1.24;
  const sw = window.innerWidth;
  const sh = window.innerHeight;
  const targetW = bboxW * PADDING;
  const targetH = bboxH * PADDING;
  // Use min so the WHOLE bbox fits (don't crop). Also cap at 10x so a
  // tiny selection (e.g. one small image) doesn't zoom to a screenful of
  // pixelated nothing.
  let z = Math.min(sw / Math.max(1, targetW), sh / Math.max(1, targetH));
  z = Math.max(0.02, Math.min(10, z));
  state.zoom = z;
  // Center the bbox on the viewport center.
  state.pan.x = sw / 2 - bboxCx * state.zoom;
  state.pan.y = sh / 2 - bboxCy * state.zoom;
  updateCanvas();
  try {
    const tag = count === 1 ? '1 item' : count + ' items';
    toast('Framed ' + tag + ' · ' + Math.round(state.zoom * 100) + '%  —  F');
  } catch (e) {}
}

window.updateCanvas = updateCanvas;
window.frameSelection = frameSelection;
window.zoomBy = zoomBy;
window.zoomTo = zoomTo;
