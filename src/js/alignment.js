import { updateAutoFitPaper } from './paper.js';
import { getSelectedImages, getSelectedItems, refreshSelection } from './selection.js';
import { state, canvasContent } from './core-state.js';
import { scheduleAutoSave } from './save-load.js';
import { toast } from './ui-utils.js';
import { findStrokeById } from './draw-items.js';
import { updateItemStyle } from './add-items.js';
import { redrawDrawLayer } from './draw-layer.js';
import { pushUndo } from './undo-redo.js';

// ============================================================
//  LAYER ORDER
// ============================================================
export function layerOrder(action) {
  pushUndo();
  const all = [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])];
  all.sort((a, b) => a.z - b.z);
  if (action === 'front') { getSelectedItems().forEach(i => i.z = G.nextZ++); }
  else if (action === 'back') { const minZ = all.length ? all[0].z - 1 : 0; getSelectedItems().forEach((i, idx) => i.z = minZ - getSelectedItems().length + idx); }
  else if (action === 'up') { getSelectedItems().forEach(i => i.z = G.nextZ++); }
  else if (action === 'down') { getSelectedItems().forEach(i => i.z = (i.z || 1) - 100); }
  all.forEach(i => updateItemStyle(i));
  scheduleAutoSave();
}

// ============================================================
//  ALIGNMENT (PureRef style)
// ============================================================
export function alignItems(type) {
  const sel = getSelectedItems();
  if (sel.length < 2) return;
  pushUndo();

  // Step 1: Align to edge (Word-style — shift one axis only)
  if (type === 'left') {
    const target = Math.min(...sel.map(i => i.x));
    sel.forEach(i => { i.x = target; updateItemStyle(i); });
    nudgeOverlaps(sel, 'v');
  } else if (type === 'right') {
    const target = Math.max(...sel.map(i => i.x + i.w));
    sel.forEach(i => { i.x = target - i.w; updateItemStyle(i); });
    nudgeOverlaps(sel, 'v');
  } else if (type === 'top') {
    const target = Math.min(...sel.map(i => i.y));
    sel.forEach(i => { i.y = target; updateItemStyle(i); });
    nudgeOverlaps(sel, 'h');
  } else if (type === 'bottom') {
    const target = Math.max(...sel.map(i => i.y + i.h));
    sel.forEach(i => { i.y = target - i.h; updateItemStyle(i); });
    nudgeOverlaps(sel, 'h');
  } else if (type === 'hcenter') {
    const target = sel.reduce((s, i) => s + (i.x + i.w / 2), 0) / sel.length;
    sel.forEach(i => { i.x = target - i.w / 2; updateItemStyle(i); });
    nudgeOverlaps(sel, 'v');
  } else if (type === 'vcenter') {
    const target = sel.reduce((s, i) => s + (i.y + i.h / 2), 0) / sel.length;
    sel.forEach(i => { i.y = target - i.h / 2; updateItemStyle(i); });
    nudgeOverlaps(sel, 'h');
  }

  refreshSelection();
  scheduleAutoSave();
  toast('Align ' + type);
}

// Single-axis edge alignment: Ctrl+←/→ only changes X, Ctrl+↑/↓ only changes Y
// After alignment, push apart items that overlap in 2D (both X and Y)
// CRITICAL: overlap check uses the TARGET position (minTop/minLeft), not original
export function groupMove(direction) {
  const sel = getSelectedItems();
  if (sel.length === 0) return;
  pushUndo();
  const gap = 8;

  if (direction === 'left') {
    // Align left edges — only change X
    const targetX = Math.min(...sel.map(i => i.x));
    sel.forEach(item => { item.x = targetX; updateItemStyle(item); });
    // Push overlapping items down — check at TARGET position, not original
    sel.sort((a, b) => a.y - b.y || a.x - b.x);
    for (let i = 1; i < sel.length; i++) {
      let minTop = sel[i].y;
      for (let j = 0; j < i; j++) {
        const prev = sel[j];
        // Check if item at minTop would overlap with prev (2D)
        const xOverlap = prev.x < sel[i].x + sel[i].w && prev.x + prev.w > sel[i].x;
        const yOverlapAtMinTop = prev.y < minTop + sel[i].h && prev.y + prev.h > minTop;
        if (xOverlap && yOverlapAtMinTop) {
          minTop = prev.y + prev.h + gap;
        }
      }
      if (minTop > sel[i].y) { sel[i].y = minTop; updateItemStyle(sel[i]); }
    }
  } else if (direction === 'right') {
    // Align right edges — only change X
    const targetRight = Math.max(...sel.map(i => i.x + i.w));
    sel.forEach(item => { item.x = targetRight - item.w; updateItemStyle(item); });
    // Push overlapping items down
    sel.sort((a, b) => a.y - b.y || a.x - b.x);
    for (let i = 1; i < sel.length; i++) {
      let minTop = sel[i].y;
      for (let j = 0; j < i; j++) {
        const prev = sel[j];
        const xOverlap = prev.x < sel[i].x + sel[i].w && prev.x + prev.w > sel[i].x;
        const yOverlapAtMinTop = prev.y < minTop + sel[i].h && prev.y + prev.h > minTop;
        if (xOverlap && yOverlapAtMinTop) {
          minTop = prev.y + prev.h + gap;
        }
      }
      if (minTop > sel[i].y) { sel[i].y = minTop; updateItemStyle(sel[i]); }
    }
  } else if (direction === 'up') {
    // Align top edges — only change Y
    const targetY = Math.min(...sel.map(i => i.y));
    sel.forEach(item => { item.y = targetY; updateItemStyle(item); });
    // Push overlapping items right
    sel.sort((a, b) => a.x - b.x || a.y - b.y);
    for (let i = 1; i < sel.length; i++) {
      let minLeft = sel[i].x;
      for (let j = 0; j < i; j++) {
        const prev = sel[j];
        // Check if item at minLeft would overlap with prev (2D)
        const yOverlap = prev.y < sel[i].y + sel[i].h && prev.y + prev.h > sel[i].y;
        const xOverlapAtMinLeft = prev.x < minLeft + sel[i].w && prev.x + prev.w > minLeft;
        if (yOverlap && xOverlapAtMinLeft) {
          minLeft = prev.x + prev.w + gap;
        }
      }
      if (minLeft > sel[i].x) { sel[i].x = minLeft; updateItemStyle(sel[i]); }
    }
  } else if (direction === 'down') {
    // Align bottom edges — only change Y
    const targetBottom = Math.max(...sel.map(i => i.y + i.h));
    sel.forEach(item => { item.y = targetBottom - item.h; updateItemStyle(item); });
    // Push overlapping items right
    sel.sort((a, b) => a.x - b.x || a.y - b.y);
    for (let i = 1; i < sel.length; i++) {
      let minLeft = sel[i].x;
      for (let j = 0; j < i; j++) {
        const prev = sel[j];
        const yOverlap = prev.y < sel[i].y + sel[i].h && prev.y + prev.h > sel[i].y;
        const xOverlapAtMinLeft = prev.x < minLeft + sel[i].w && prev.x + prev.w > minLeft;
        if (yOverlap && xOverlapAtMinLeft) {
          minLeft = prev.x + prev.w + gap;
        }
      }
      if (minLeft > sel[i].x) { sel[i].x = minLeft; updateItemStyle(sel[i]); }
    }
  }

  refreshSelection();
  scheduleAutoSave();
  updateAutoFitPaper();
  const labels = { up: 'Top aligned', down: 'Bottom aligned', left: 'Left aligned', right: 'Right aligned' };
  toast(labels[direction]);
}

// Round 43: Tetris-style snap for Ctrl+Arrow. Replaces the old
// "align to the topmost item's edge" groupMove behavior with a
// piece-by-piece snap:
//   • Each item in the selection moves INDEPENDENTLY (not as a group).
//   • Each item moves in the chosen direction as far as it can until
//     it would touch another item on the board.
//   • The "hit" item does NOT move — only the moving item's
//     perpendicular axis is preserved (X for up/down, Y for left/right).
//   • The hit item can be any other item on the board, including
//     other selected items — Tetris pieces don't pass through each
//     other.
//   • If there's no obstacle, the item snaps to the canvas edge in
//     that direction: Y=0 (up), X=0 (left), or the bbox extreme of
//     all items on the board (down/right), so items at the bottom
//     of a column stay at the bottom when pressed.
// Round 45: Tetris-style snap for Ctrl+Arrow. Each item in the
// selection moves INDEPENDENTLY in the chosen direction, stops
// just before it would overlap anything else (8px gap).
//   • Process order = sort by move axis. Topmost first for Up,
//     bottommost first for Down, leftmost first for Left, rightmost
//     first for Right. This honors the user's rule "以最高位置為
//     對砌方位" — the topmost item in the input ends up as the
//     topmost in the layout.
//   • The first item in sort order is the "reference": it gets to
//     occupy snapTarget (the selection's min/max in the move
//     direction) and only sees NON-SELECTED obstacles. Subsequent
//     items see both non-selected obstacles AND already-processed
//     selected items — so they Tetris-pack below/right/above/left
//     of the reference and the previous pieces.
//   • Algorithm: iterative push. Start at snapTarget, scan obstacles
//     for overlap; if any, push past the obstacle's edge (with gap)
//     and re-scan. Stops when no more overlap (typically 1–2
//     iterations in practice; capped at 100 to be safe).
//   • ABSOLUTELY no overlap is the hard constraint: gap=8 between
//     every touching pair, including selected-vs-selected and
//     moving-vs-obstacle. The user's "亂飛" complaint was caused
//     by Round 44 using a flawed `isAbove`/`isBelow` condition
//     that missed obstacles that overlapped the moving item's
//     newY range — e.g. A at y=0 with B at y=20 same X: B's
//     `isAbove` check `o.y+h <= item.y` (50<=20=F) excluded A,
//     so B snapped to y=0 and overlapped A. The new overlap
//     condition `newPos < o.y+o.h && newPos+item.h > o.y` catches
//     ALL colliding cases, not just strictly-above ones.
export function tetrisAlign(direction) {
  const sel = getSelectedItems();
  if (sel.length === 0) return;
  pushUndo();
  const gap = 8;
  const allItems = [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])];
  const selIds = new Set(sel.map(i => i.id));
  // Non-selected items are permanent obstacles for every step.
  // Selected items become obstacles for items processed AFTER them
  // (this is what makes them pack Tetris-style below/above/left/right
  // of earlier pieces instead of all snapping to the same spot).
  const nonSelectedObs = allItems.filter(i => !selIds.has(i.id));
  // Sort the selection by move axis. The first item in this order
  // is the "reference" — topmost for up, bottommost for down, etc.
  const sortedSel = sel.slice();
  if (direction === 'up')    sortedSel.sort((a, b) => a.y - b.y);
  if (direction === 'down')  sortedSel.sort((a, b) => (b.y + b.h) - (a.y + a.h));
  if (direction === 'left')  sortedSel.sort((a, b) => a.x - b.x);
  if (direction === 'right') sortedSel.sort((a, b) => (b.x + b.w) - (a.x + a.w));
  // Snap target: the extreme of the SELECTION in the move direction.
  // For Up/Left this is the min edge; for Down/Right it's the max
  // edge. The reference item gets to occupy this position; later
  // items push past it.
  let snapTarget;
  if (direction === 'up')    snapTarget = Math.min(...sortedSel.map(i => i.y));
  if (direction === 'down')  snapTarget = Math.max(...sortedSel.map(i => i.y + i.h));
  if (direction === 'left')  snapTarget = Math.min(...sortedSel.map(i => i.x));
  if (direction === 'right') snapTarget = Math.max(...sortedSel.map(i => i.x + i.w));
  // Track which selected items have already been processed so we
  // can include them in the obstacle set for subsequent items.
  const processed = [];
  sortedSel.forEach((item, idx) => {
    if (item.locked) return;
    // Initial target position: align the moving edge to snapTarget.
    let newPos;
    if (direction === 'up')    newPos = snapTarget;
    if (direction === 'down')  newPos = snapTarget - item.h;
    if (direction === 'left')  newPos = snapTarget;
    if (direction === 'right') newPos = snapTarget - item.w;
    // Obstacle set: non-selected + already-processed selected.
    // The reference item (idx=0) sees only non-selected obstacles
    // (its peers haven't been placed yet, so it can't "block" on them).
    const obs = nonSelectedObs.concat(processed);
    // Iterative push: while the new position overlaps any obstacle,
    // push past the obstacle's edge. Each push restarts the scan
    // because the new position might collide with a different obstacle.
    let changed = true, iter = 0;
    while (changed && iter < 100) {
      changed = false;
      iter++;
      for (const o of obs) {
        if (o.id === item.id) continue;
        let axisOverlap, posOverlap;
        if (direction === 'up' || direction === 'down') {
          axisOverlap = o.x < item.x + item.w && o.x + o.w > item.x;
          posOverlap = newPos < o.y + o.h && newPos + item.h > o.y;
        } else {
          axisOverlap = o.y < item.y + item.h && o.y + o.h > item.y;
          posOverlap = newPos < o.x + o.w && newPos + item.w > o.x;
        }
        if (axisOverlap && posOverlap) {
          if (direction === 'up')    newPos = o.y + o.h + gap;
          if (direction === 'down')  newPos = o.y - item.h - gap;
          if (direction === 'left')  newPos = o.x + o.w + gap;
          if (direction === 'right') newPos = o.x - item.w - gap;
          changed = true;
          break;  // restart scan from the top
        }
      }
    }
    if (direction === 'up' || direction === 'down') {
      item.y = newPos;
    } else {
      item.x = newPos;
    }
    updateItemStyle(item);
    processed.push(item);
  });
  refreshSelection();
  scheduleAutoSave();
  updateAutoFitPaper();
  const labels = { up: 'Snapped ↑', down: 'Snapped ↓', left: 'Snapped ←', right: 'Snapped →' };
  toast(labels[direction]);
}
// dir: 'h' = nudge horizontally, 'v' = nudge vertically
// Keeps items near their original position — just removes overlap, doesn't sort into a column
export function nudgeOverlaps(items, dir) {
  const gap = 6;
  const changed = new Set();
  // Check every pair
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      const A = items[a], B = items[b];
      // Check if they overlap
      if (A.x < B.x + B.w && A.x + A.w > B.x && A.y < B.y + B.h && A.y + A.h > B.y) {
        if (dir === 'v') {
          // Nudge vertically: push B down just enough
          const push = (A.y + A.h + gap) - B.y;
          if (push > 0) { B.y += push; updateItemStyle(B); changed.add(B.id); }
        } else {
          // Nudge horizontally: push B right just enough
          const push = (A.x + A.w + gap) - B.x;
          if (push > 0) { B.x += push; updateItemStyle(B); changed.add(B.id); }
        }
      }
    }
  }
}// Separate overlapping items after alignment
// dir: 'h' = spread horizontally, 'v' = spread vertically
export function separateOverlaps(items, dir) {
  const gap = 10; // pixel gap between items
  if (dir === 'v') {
    // Items may overlap in Y — sort by Y and spread vertically
    items.sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      const minTop = prev.y + prev.h + gap;
      if (items[i].y < minTop) {
        items[i].y = minTop;
        updateItemStyle(items[i]);
      }
    }
  } else {
    // Items may overlap in X — sort by X and spread horizontally
    items.sort((a, b) => a.x - b.x);
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      const minLeft = prev.x + prev.w + gap;
      if (items[i].x < minLeft) {
        items[i].x = minLeft;
        updateItemStyle(items[i]);
      }
    }
  }
}
export function distributeItems(axis) {
  const sel = getSelectedItems();
  if (sel.length < 3) return;
  pushUndo();
  // Save original positions for draw stroke sync
  const drawOffsets = new Map();
  sel.forEach(i => {
    if (i.type === 'draw' && i.strokeId) drawOffsets.set(i.id, { ox: i.x, oy: i.y });
  });
  if (axis === 'h') {
    sel.sort((a, b) => a.x - b.x);
    const first = sel[0], last = sel[sel.length - 1];
    const totalW = sel.reduce((s, i) => s + i.w, 0);
    const gap = (last.x + last.w - first.x - totalW) / (sel.length - 1);
    let curX = first.x;
    sel.forEach(i => { i.x = curX; curX += i.w + gap; updateItemStyle(i); });
  } else {
    sel.sort((a, b) => a.y - b.y);
    const first = sel[0], last = sel[sel.length - 1];
    const totalH = sel.reduce((s, i) => s + i.h, 0);
    const gap = (last.y + last.h - first.y - totalH) / (sel.length - 1);
    let curY = first.y;
    sel.forEach(i => { i.y = curY; curY += i.h + gap; updateItemStyle(i); });
  }
  // Sync draw stroke positions
  sel.forEach(i => {
    if (i.type === 'draw' && i.strokeId) {
      const orig = drawOffsets.get(i.id);
      if (orig) {
        const stroke = findStrokeById(i.strokeId);
        if (stroke) stroke.points = stroke.points.map(p => [p[0] + i.x - orig.ox, p[1] + i.y - orig.oy]);
      }
    }
  });
  redrawDrawLayer();
  scheduleAutoSave();
}

// ============ SMART LAYOUT: Column & Row ============

// Column layout: stack selected items vertically, center-aligned horizontally
// like a vertical column of reference images
// Helper: build clusters of image+nearby text pairs
export function buildClusters(sel) {
  // Items with 'src' are images/videos; items without are texts
  const images = sel.filter(i => 'src' in i);
  const texts = sel.filter(i => !('src' in i));
  const claimed = new Set();

  const clusters = images.map(img => {
    const paired = [];
    texts.forEach(txt => {
      if (claimed.has(txt.id)) return;
      // Distance between text center and image center
      const dist = Math.hypot(
        (txt.x + txt.w / 2) - (img.x + img.w / 2),
        (txt.y + txt.h / 2) - (img.y + img.h / 2)
      );
      // If text is within 1.5x the image's max dimension, pair it
      const maxDist = Math.max(img.w, img.h, 200) * 1.5;
      if (dist < maxDist) {
        paired.push(txt);
        claimed.add(txt.id);
      }
    });
    return { anchor: img, texts: paired };
  });

  // Standalone texts become their own clusters
  texts.filter(t => !claimed.has(t.id)).forEach(txt => {
    clusters.push({ anchor: txt, texts: [] });
  });

  // Calculate cluster bounding box
  clusters.forEach(c => {
    const allItems = [c.anchor, ...c.texts];
    c.minX = Math.min(...allItems.map(i => i.x));
    c.minY = Math.min(...allItems.map(i => i.y));
    c.maxX = Math.max(...allItems.map(i => i.x + i.w));
    c.maxY = Math.max(...allItems.map(i => i.y + i.h));
    c.bw = c.maxX - c.minX;
    c.bh = c.maxY - c.minY;
  });

  return clusters;
}

// Column layout: images stacked vertically, paired texts move with their image
export function layoutColumn() {
  const sel = getSelectedItems();
  if (sel.length < 2) return;
  pushUndo();
  const gap = 10;

  const clusters = buildClusters(sel);

  // Sort by anchor Y then X
  clusters.sort((a, b) => a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x);

  // Center X based on image anchors (not texts)
  const imgClusters = clusters.filter(c => 'src' in c.anchor);
  const centerX = imgClusters.length > 0
    ? imgClusters.reduce((s, c) => s + c.anchor.x + c.anchor.w / 2, 0) / imgClusters.length
    : clusters.reduce((s, c) => s + c.anchor.x + c.anchor.w / 2, 0) / clusters.length;

  let curY = Math.min(...clusters.map(c => c.minY));

  let anyDraw = false;
  clusters.forEach(cluster => {
    const oldAnchorX = cluster.anchor.x;
    const oldAnchorY = cluster.anchor.y;

    // Move anchor (image/text) to center X, stack vertically
    cluster.anchor.x = centerX - cluster.anchor.w / 2;
    cluster.anchor.y = curY + (cluster.anchor.y - cluster.minY);
    updateItemStyle(cluster.anchor);

    // Sync draw stroke if anchor is a draw item
    if (cluster.anchor.type === 'draw' && cluster.anchor.strokeId) {
      const dx = cluster.anchor.x - oldAnchorX;
      const dy = cluster.anchor.y - oldAnchorY;
      const stroke = findStrokeById(cluster.anchor.strokeId);
      if (stroke) stroke.points = stroke.points.map(p => [p[0] + dx, p[1] + dy]);
      anyDraw = true;
    }

    // Apply same delta to paired texts
    const dx = cluster.anchor.x - oldAnchorX;
    const dy = cluster.anchor.y - oldAnchorY;
    cluster.texts.forEach(txt => {
      txt.x += dx;
      txt.y += dy;
      updateItemStyle(txt);
    });

    curY += cluster.bh + gap;
  });

  if (anyDraw) redrawDrawLayer();
  refreshSelection();
  scheduleAutoSave();
  toast('Column layout');
}

// Row layout: images lined horizontally, paired texts move with their image
export function layoutRow() {
  const sel = getSelectedItems();
  if (sel.length < 2) return;
  pushUndo();
  const gap = 10;

  const clusters = buildClusters(sel);

  // Sort by anchor X then Y
  clusters.sort((a, b) => a.anchor.x - b.anchor.x || a.anchor.y - b.anchor.y);

  // Center Y based on image anchors
  const imgClusters = clusters.filter(c => 'src' in c.anchor);
  const centerY = imgClusters.length > 0
    ? imgClusters.reduce((s, c) => s + c.anchor.y + c.anchor.h / 2, 0) / imgClusters.length
    : clusters.reduce((s, c) => s + c.anchor.y + c.anchor.h / 2, 0) / clusters.length;

  let curX = Math.min(...clusters.map(c => c.minX));

  let anyDrawRow = false;
  clusters.forEach(cluster => {
    const oldAnchorX = cluster.anchor.x;
    const oldAnchorY = cluster.anchor.y;

    // Move anchor to center Y, line horizontally
    cluster.anchor.y = centerY - cluster.anchor.h / 2;
    cluster.anchor.x = curX + (cluster.anchor.x - cluster.minX);
    updateItemStyle(cluster.anchor);

    // Sync draw stroke if anchor is a draw item
    if (cluster.anchor.type === 'draw' && cluster.anchor.strokeId) {
      const dx = cluster.anchor.x - oldAnchorX;
      const dy = cluster.anchor.y - oldAnchorY;
      const stroke = findStrokeById(cluster.anchor.strokeId);
      if (stroke) stroke.points = stroke.points.map(p => [p[0] + dx, p[1] + dy]);
      anyDrawRow = true;
    }

    // Apply same delta to paired texts
    const dx = cluster.anchor.x - oldAnchorX;
    const dy = cluster.anchor.y - oldAnchorY;
    cluster.texts.forEach(txt => {
      txt.x += dx;
      txt.y += dy;
      updateItemStyle(txt);
    });

    curX += cluster.bw + gap;
  });

  if (anyDrawRow) redrawDrawLayer();
  refreshSelection();
  scheduleAutoSave();
  toast('Row layout');
}

// Grid layout: arrange clusters in a grid
export function layoutGrid(cols) {
  const sel = getSelectedItems();
  if (sel.length < 2) return;
  pushUndo();
  const gap = 10;

  const clusters = buildClusters(sel);
  clusters.sort((a, b) => a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x);

  if (!cols) cols = Math.ceil(Math.sqrt(clusters.length));

  const startX = Math.min(...clusters.map(c => c.minX));
  const startY = Math.min(...clusters.map(c => c.minY));
  let curX = startX, curY = startY, rowMaxH = 0;

  let anyDrawGrid = false;
  clusters.forEach((cluster, idx) => {
    const oldAnchorX = cluster.anchor.x;
    const oldAnchorY = cluster.anchor.y;

    cluster.anchor.x = curX + (cluster.anchor.x - cluster.minX);
    cluster.anchor.y = curY + (cluster.anchor.y - cluster.minY);
    updateItemStyle(cluster.anchor);

    // Sync draw stroke if anchor is a draw item
    if (cluster.anchor.type === 'draw' && cluster.anchor.strokeId) {
      const sdx = cluster.anchor.x - oldAnchorX;
      const sdy = cluster.anchor.y - oldAnchorY;
      const stroke = findStrokeById(cluster.anchor.strokeId);
      if (stroke) stroke.points = stroke.points.map(p => [p[0] + sdx, p[1] + sdy]);
      anyDrawGrid = true;
    }

    const dx = cluster.anchor.x - oldAnchorX;
    const dy = cluster.anchor.y - oldAnchorY;
    cluster.texts.forEach(txt => {
      txt.x += dx;
      txt.y += dy;
      updateItemStyle(txt);
    });

    rowMaxH = Math.max(rowMaxH, cluster.bh);
    if ((idx + 1) % cols === 0) {
      curX = startX;
      curY += rowMaxH + gap;
      rowMaxH = 0;
    } else {
      curX += cluster.bw + gap;
    }
  });

  if (anyDrawGrid) redrawDrawLayer();
  refreshSelection();
  scheduleAutoSave();
  toast('Grid layout (' + cols + ' cols)');
}

export function normalizeSize(type) {
  const sel = getSelectedImages();
  if (sel.length < 2) return;
  pushUndo();
  // Snapshot original draw item dimensions before resizing (for stroke scale sync)
  const _drawOrig = new Map();
  sel.forEach(function(i) {
    if (i.type === 'draw' && i.strokeId) { _drawOrig.set(i.id, { x: i.x, y: i.y, w: i.w, h: i.h }); }
  });
  if (type === 'size') {
    // Normalize: largest side same size (average)
    const avg = sel.reduce((s, i) => s + Math.max(i.w, i.h), 0) / sel.length;
    sel.forEach(i => {
      const ratio = i.w / i.h;
      if (i.w > i.h) { i.w = avg; i.h = avg / ratio; }
      else { i.h = avg; i.w = avg * ratio; }
      updateItemStyle(i);
    });
  } else if (type === 'width') {
    const avg = sel.reduce((s, i) => s + i.w, 0) / sel.length;
    sel.forEach(i => { const ratio = i.w / i.h; i.w = avg; i.h = avg / ratio; updateItemStyle(i); });
  } else if (type === 'height') {
    const avg = sel.reduce((s, i) => s + i.h, 0) / sel.length;
    sel.forEach(i => { const ratio = i.w / i.h; i.h = avg; i.w = avg * ratio; updateItemStyle(i); });
  } else if (type === 'scale') {
    // Normalize scale: resize so all have same average area
    const avgArea = sel.reduce((s, i) => s + (i.w * i.h), 0) / sel.length;
    sel.forEach(i => {
      const ratio = i.w / i.h;
      const factor = Math.sqrt(avgArea / (i.w * i.h));
      i.w *= factor; i.h *= factor;
      updateItemStyle(i);
    });
  }
  // Round 66/67: sync draw item stroke points after normalizing size/scale.
  // Round 67: switch to normalized bbox mapping (see the resize handler for
  // the full rationale) so the stroke is guaranteed to be co-located with
  // the new bbox regardless of how the size was changed.
  _drawOrig.forEach(function(orig, id) {
    var it = sel.find(function(i) { return i.id === id; });
    if (!it) return;
    if (Math.abs(it.w - orig.w) < 0.5 && Math.abs(it.h - orig.h) < 0.5
        && Math.abs(it.x - orig.x) < 0.5 && Math.abs(it.y - orig.y) < 0.5) return;
    var stroke = findStrokeById(it.strokeId);
    if (stroke && orig.w > 0 && orig.h > 0) {
      var sx = it.w / orig.w;
      var sy = it.h / orig.h;
      var dx = it.x - orig.x * sx;
      var dy = it.y - orig.y * sy;
      stroke.points = stroke.points.map(function(p) {
        return [p[0] * sx + dx, p[1] * sy + dy];
      });
    }
  });
  if (_drawOrig.size > 0) redrawDrawLayer();
  refreshSelection();
  scheduleAutoSave();
}
export function stackItems() {
  const sel = getSelectedItems();
  if (sel.length < 2) return;
  pushUndo();
  const cx = sel.reduce((s, i) => s + i.x + i.w / 2, 0) / sel.length;
  const cy = sel.reduce((s, i) => s + i.y + i.h / 2, 0) / sel.length;
  sel.forEach(i => {
    const origX = i.x, origY = i.y;
    i.x = cx - i.w / 2; i.y = cy - i.h / 2;
    if (i.type === 'draw' && i.strokeId) {
      const dx = i.x - origX;
      const dy = i.y - origY;
      const stroke = findStrokeById(i.strokeId);
      if (stroke) stroke.points = stroke.points.map(p => [p[0] + dx, p[1] + dy]);
    }
    updateItemStyle(i);
  });
  redrawDrawLayer();
  refreshSelection();
  scheduleAutoSave();
}
export function autoTidy() {
  const sel = getSelectedItems();
  if (sel.length === 0) return;
  pushUndo();
  const items = sel.length >= 2 ? sel : [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])];
  // Round 42: capture the current bounding box of the items BEFORE packing
  // them, then offset the grid so the tidy layout stays "around the same
  // place" — the user complained that autoTidy teleported the selection to
  // the top-left corner (cx=0, cy=0) of the canvas, even though the items
  // were originally in the middle of the board. Pack relative to the
  // bbox's top-left corner so visually the items reorganize IN PLACE.
  const padding = 10;
  const minX = Math.min(...items.map(i => i.x));
  const minY = Math.min(...items.map(i => i.y));
  // For 1-item case the bbox is a single point; in that case the user
  // pressed Tidy with nothing or one thing selected, and the whole board
  // gets tidied into a grid at its current top-left (no teleport to 0,0).
  const baseX = isFinite(minX) ? minX : 0;
  const baseY = isFinite(minY) ? minY : 0;
  // Sort by area (smallest first) so the layout puts smaller items at
  // the top-left of the grid — feels more natural for mixed sizes.
  items.sort((a, b) => (a.w * a.h) - (b.w * b.h));
  // Column count: prefer the same width as the original bbox, so a
  // wide selection stays wide and a tall selection stays tall. Fall
  // back to sqrt(N) when the bbox is degenerate (e.g. all items
  // stacked at the same point).
  const bboxW = Math.max(...items.map(i => i.x + i.w)) - baseX;
  const bboxH = Math.max(...items.map(i => i.y + i.h)) - baseY;
  let cols = Math.max(1, Math.round(bboxW / 200));
  if (!isFinite(cols) || cols < 1) cols = Math.ceil(Math.sqrt(items.length));
  cols = Math.min(items.length, Math.max(1, cols));
  let cx = baseX, cy = baseY, rowH = 0;
  items.forEach((i, idx) => {
    const origX = i.x, origY = i.y;
    i.x = cx; i.y = cy;
    // Sync draw stroke positions when draw items are moved
    if (i.type === 'draw' && i.strokeId) {
      const dx = i.x - origX;
      const dy = i.y - origY;
      const stroke = findStrokeById(i.strokeId);
      if (stroke) stroke.points = stroke.points.map(p => [p[0] + dx, p[1] + dy]);
    }
    cx += i.w + padding;
    rowH = Math.max(rowH, i.h);
    if ((idx + 1) % cols === 0) { cx = baseX; cy += rowH + padding; rowH = 0; }
    updateItemStyle(i);
  });
  redrawDrawLayer();
  refreshSelection();
  scheduleAutoSave();
}

window.alignItems = alignItems;
window.layerOrder = layerOrder;

