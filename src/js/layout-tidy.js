
import { state } from './core-state.js';

// ============================================================
//  TIDY SELECTION — Masonry layout for selected items
// ============================================================
// Arranges all selected items (items, texts, todos, mindmaps) in a compact
// masonry (Pinterest-style) grid centered on the original selection bounding
// box. All items are scaled to a uniform column width (COL_W = 280px world
// coords) preserving aspect ratio. Uses minimum 2 columns for 2+ items.
// After layout, auto-frames the viewport to show all tidied items.
// Bound to Ctrl+Shift+T (Cmd+Shift+T on Mac) and the 🧹 toolbar button.
export function tidySelection() {
  var sel = state.selected;
  if (!sel || sel.size === 0) {
    try { toast('Select items to tidy first'); } catch (e) {}
    return;
  }

  // --- Collect all selected items with their world-coordinate bounds ---
  var selItems = [];
  var selArr = Array.from(sel);
  var COL_W = 280;
  var GAP = 16;

  for (var si = 0; si < selArr.length; si++) {
    var id = selArr[si];

    // Image / video / link / draw items
    var it = (state.items || []).find(function(i) { return i.id === id; });
    if (it) {
      selItems.push({
        id: id, x: it.x, y: it.y, w: it.w, h: it.h,
        el: it.el, isText: false, isTodo: false, isMindmap: false,
        item: it
      });
      continue;
    }

    // Text items — get world-coord size from BCR
    var tx = (state.texts || []).find(function(t) { return t.id === id; });
    if (tx && tx.el) {
      var r = tx.el.getBoundingClientRect();
      var wx = (r.left - state.pan.x) / state.zoom;
      var wy = (r.top  - state.pan.y) / state.zoom;
      var ww = r.width  / state.zoom;
      var wh = r.height / state.zoom;
      selItems.push({
        id: id, x: wx, y: wy, w: ww, h: wh,
        el: tx.el, isText: true, isTodo: false, isMindmap: false,
        item: tx
      });
      continue;
    }

    // Todo items
    var td = (state.todos || []).find(function(t) { return t.id === id; });
    if (td && td.el) {
      var r2 = td.el.getBoundingClientRect();
      var wx2 = (r2.left - state.pan.x) / state.zoom;
      var wy2 = (r2.top  - state.pan.y) / state.zoom;
      var ww2 = r2.width  / state.zoom;
      var wh2 = r2.height / state.zoom;
      selItems.push({
        id: id, x: wx2, y: wy2, w: ww2, h: wh2,
        el: td.el, isText: false, isTodo: true, isMindmap: false,
        item: td
      });
      continue;
    }

    // Mindmap items — use the bounding box of all nodes
    var mm = (state.mindmaps || []).find(function(m) { return m.id === id; });
    if (mm && Array.isArray(mm.nodes) && mm.nodes.length > 0) {
      var mMinX = Infinity, mMinY = Infinity, mMaxX = -Infinity, mMaxY = -Infinity;
      mm.nodes.forEach(function(n) {
        if (typeof n.x === 'number' && typeof n.y === 'number') {
          if (n.x < mMinX) mMinX = n.x;
          if (n.y < mMinY) mMinY = n.y;
          // Mindmap node approximate size: 120x40
          var nw = n.w || 120;
          var nh = n.h || 40;
          if (n.x + nw > mMaxX) mMaxX = n.x + nw;
          if (n.y + nh > mMaxY) mMaxY = n.y + nh;
        }
      });
      if (isFinite(mMinX) && isFinite(mMaxX)) {
        selItems.push({
          id: id, x: mMinX, y: mMinY, w: mMaxX - mMinX, h: mMaxY - mMinY,
          el: mm.el, isText: false, isTodo: false, isMindmap: true,
          item: mm, origMinX: mMinX, origMinY: mMinY
        });
      }
    }
  }

  if (selItems.length === 0) {
    try { toast('Select items to tidy first'); } catch (e) {}
    return;
  }

  // --- Push undo before modifying ---
  try { pushUndo(); } catch (e) {}

  // --- Find the center of the current selection bounding box ---
  var cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity;
  for (var ci = 0; ci < selItems.length; ci++) {
    var siBox = selItems[ci];
    if (siBox.x < cMinX) cMinX = siBox.x;
    if (siBox.y < cMinY) cMinY = siBox.y;
    if (siBox.x + siBox.w > cMaxX) cMaxX = siBox.x + siBox.w;
    if (siBox.y + siBox.h > cMaxY) cMaxY = siBox.y + siBox.h;
  }
  var centerX = (cMinX + cMaxX) / 2;
  var centerY = (cMinY + cMaxY) / 2;

  // --- Masonry layout ---
  // Minimum 2 columns for 2+ items; sqrt-based for larger counts
  var cols = selItems.length <= 1 ? 1 : Math.max(2, Math.ceil(Math.sqrt(selItems.length)));

  // Sort by height descending (larger items first reduces gaps)
  selItems.sort(function(a, b) { return b.h - a.h; });

  var colHeights = new Array(cols);
  for (var cj = 0; cj < cols; cj++) { colHeights[cj] = 0; }

  // --- Pass 1: compute relative positions (relative to 0,0) ---
  // Also store scaled w/h for each item.
  var _z = Math.max(0.02, Math.min(10, state.zoom || 1));
  for (var pk = 0; pk < selItems.length; pk++) {
    var ssi = selItems[pk];

    // Find the shortest column
    var shortestCol = 0;
    for (var ck = 1; ck < cols; ck++) {
      if (colHeights[ck] < colHeights[shortestCol]) shortestCol = ck;
    }

    // Scale to uniform column width, preserve aspect ratio
    var scale = COL_W / ssi.w;
    var newW = COL_W;
    var newH = ssi.h * scale;

    // Store scaled dimensions for framing
    ssi._newW = newW;
    ssi._newH = newH;

    // Compute relative position
    ssi._relX = shortestCol * (COL_W + GAP);
    ssi._relY = colHeights[shortestCol];
    ssi._relCol = shortestCol;

    // Update column height
    colHeights[shortestCol] += newH + GAP;
  }

  // --- Compute the origin so the layout is centered on the selection ---
  var totalW = cols * (COL_W + GAP) - GAP;
  var maxColH = 0;
  for (var cm = 0; cm < colHeights.length; cm++) {
    if (colHeights[cm] > maxColH) maxColH = colHeights[cm];
  }
  var totalH = maxColH - GAP;
  if (totalH < 1) totalH = 1;
  var originX = centerX - totalW / 2;
  var originY = centerY - totalH / 2;

  // --- Pass 2: apply positions with the origin offset ---
  for (var pa = 0; pa < selItems.length; pa++) {
    var si = selItems[pa];
    var finalX = originX + si._relX;
    var finalY = originY + si._relY;

    // --- Apply new position and scaled size to the underlying item ---
    if (si.isMindmap) {
      // Mindmap: shift all nodes by the delta from original top-left
      var dx = finalX - si.origMinX;
      var dy = finalY - si.origMinY;
      si.item.nodes.forEach(function(n) {
        if (typeof n.x === 'number') n.x += dx;
        if (typeof n.y === 'number') n.y += dy;
      });
      // Update connectors and DOM position
      try { mmUpdateConnectors(si.item); } catch (e) {}
    } else if (si.isText) {
      // Text items: x/y are world coords, w/h are screen pixels (CSS-px)
      si.item.x = finalX;
      si.item.y = finalY;
      si.item.w = si._newW * _z;  // convert world-coord width back to screen pixels
      si.item.h = si._newH * _z;
    } else if (si.isTodo) {
      si.item.x = finalX;
      si.item.y = finalY;
      si.item.w = si._newW;
      si.item.h = si._newH;
    } else {
      // Regular items (images, videos, etc.)
      si.item.x = finalX;
      si.item.y = finalY;
      si.item.w = si._newW;
      si.item.h = si._newH;
    }

    // Update DOM via updateItemStyle
    try { updateItemStyle(si.item); } catch (e) {}

    // Store tidied position for framing (use new scaled w/h)
    si._newX = finalX;
    si._newY = finalY;
  }

  // --- Refresh canvas ---
  try { updateCanvas(); } catch (e) {}

  // --- Auto-frame to show all tidied items ---
  frameTidiedSelection(selItems);

  // --- Schedule auto-save ---
  try { scheduleAutoSave(); } catch (e) {}

  try { toast('Tidied ' + selItems.length + ' items'); } catch (e) {}
}

// Tidy all items on the board — select everything then run tidySelection
export function tidyAll() {
  state.selected.clear();
  [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])].forEach(function(i) {
    state.selected.add(i.id);
  });
  tidySelection();
}

// Helper: frame the viewport to show all tidied items.
// Uses the _newW/_newH (scaled) dimensions from tidySelection for accurate
// bounding box calculation, since item w/h may have been changed by tidy.
export function frameTidiedSelection(selItems) {
  if (!selItems || selItems.length === 0) return;

  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (var i = 0; i < selItems.length; i++) {
    var si = selItems[i];
    var nx = si._newX !== undefined ? si._newX : si.x;
    var ny = si._newY !== undefined ? si._newY : si.y;
    // Use the post-tidy scaled dimensions if available
    var nw = si._newW !== undefined ? si._newW : si.w;
    var nh = si._newH !== undefined ? si._newH : si.h;

    if (nx < minX) minX = nx;
    if (ny < minY) minY = ny;
    if (nx + nw > maxX) maxX = nx + nw;
    if (ny + nh > maxY) maxY = ny + nh;
  }

  if (!isFinite(minX) || !isFinite(maxX)) return;

  // Clamp degenerate selections
  if (maxX - minX < 1) { minX -= 40; maxX += 40; }
  if (maxY - minY < 1) { minY -= 30; maxY += 30; }

  var bboxCx = (minX + maxX) / 2;
  var bboxCy = (minY + maxY) / 2;
  var bboxW  = maxX - minX;
  var bboxH  = maxY - minY;
  var PADDING = 1.24;
  var sw = window.innerWidth;
  var sh = window.innerHeight;
  var targetW = bboxW * PADDING;
  var targetH = bboxH * PADDING;

  var z = Math.min(sw / Math.max(1, targetW), sh / Math.max(1, targetH));
  z = Math.max(0.02, Math.min(10, z));
  state.zoom = z;
  state.pan.x = sw / 2 - bboxCx * state.zoom;
  state.pan.y = sh / 2 - bboxCy * state.zoom;
  try { updateCanvas(); } catch (e) {}
}
