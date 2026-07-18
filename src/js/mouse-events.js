import { finishCapture, setCaptureMode, updateCapture } from './capture.js';
import { repositionAllAnnoPopovers } from './delete.js';
import { finishExport, updateExport } from './export.js';
import { updateAllGroupBorders, updateGroupBorder, getGroupForItem } from './groups.js';
import { pickColorFromImage } from './masking.js';
import { mmUpdateConnectors } from './mindmap.js';
import { updateAutoFitPaper } from './paper.js';
import { _handleRelationClick, renderRelations } from './relations.js';
import { clearSelection, getSelectedItems, refreshSelection, selectOnly, toggleSelect } from './selection.js';
import { setTool } from './tools.js';
import { IS_TOUCH_DEVICE, state, viewport, selBox, exportBox, captureBox, captureOverlay, captureHint, coPanels, G, drawTool, isPanTrigger } from './core-state.js';;
import { createDrawItem, findStrokeById, hitTestStrokes } from './draw-items.js';
import { addLassoPoint, endCutDraw, enterCutMode, enterLassoMode, getCutItem, getLassoItem, startCutDraw, updateCutDraw, updateCutTargetHighlight } from './cut-lasso.js';
import { pushUndo } from './undo-redo.js';
import { addText, updateItemStyle } from './add-items.js';
import { updatePropsPanel } from './props-panel.js';
import { scheduleAutoSave } from './save-load.js';
import { exitReframe, positionCropUI } from './reframe-crop.js';
import { updateCanvas } from './canvas-view.js';
import { redrawDrawLayer } from './draw-layer.js';
import { hideCtx } from './ui-utils.js';

// ============================================================
//  MOUSE EVENTS (desktop — unchanged)
// ============================================================

viewport.addEventListener('mousedown', e => {
  // Belt-and-suspenders: on touch devices, real interaction is handled
  // entirely by the touchstart/touchmove/touchend listeners above (which
  // call e.preventDefault() to suppress synthetic mouse events). Some
  // older iOS Safari versions can still dispatch a synthetic mousedown
  // in edge cases, so bail out early here to guarantee it never reaches
  // the box-select / drag logic below. Desktop (IS_TOUCH_DEVICE === false)
  // behavior is completely untouched.
  if (IS_TOUCH_DEVICE) return;

  hideCtx();
  if (e.target.closest('#toolbar') || e.target.closest('#props') || e.target.closest('#text-toolbar') || e.target.closest('#draw-toolbar') || e.target.closest('#ctx-menu') || e.target.closest('#export-modal') || e.target.closest('#gif-modal') || e.target.closest('#cut-panel') || e.target.closest('#lasso-panel') || e.target.closest('#text-quick-bar')) return;

  // Relation mode: intercept clicks to pick two items
  if (state.tool === 'relation') {
    _handleRelationClick(e.target);
    return;
  }

  // Round 59: Defensive guard for media controls. The seek bar / play
  // button / volume / trim handles all have their own stopPropagation
  // in their mousedown handlers, so a normal click on them should
  // never reach this handler. But there are edge cases where the
  // bubbling path can short-circuit (e.g. a touch/pen pointerdown
  // that synthesizes a mousedown on a different element, or a
  // capture-phase listener elsewhere that pre-empts ours). The user
  // reported "timeline always translates the mov" — i.e. clicking
  // the seek bar was moving the player instead of seeking. Even
  // though the per-control stopPropagation should prevent this, we
  // belt-and-suspenders it here: any click on a media control or
  // its descendant is a control interaction, not a move gesture.
  //
  // We deliberately do NOT add .media-wrap here, because the user
  // also relies on clicking the bare video area to (a) select the
  // item and (b) start a move drag. Only control chrome is
  // exempted.
  if (e.target.closest('.media-controls')) return;
  if (e.target.closest('.annotation-toolbar')) return;

  // MASK COLOR PICKER
  if (window.maskPickColorActive) {
    const itemEl = e.target.closest('.item');
    if (itemEl) {
      const item = state.items.find(i => i.el === itemEl);
      if (item && item.src) {
        e.preventDefault();
        e.stopPropagation();
        pickColorFromImage(e, item);
        return;
      }
    }
  }

  // FREE CUT MODE
  if (state.tool === 'cut') {
    e.preventDefault();
    // Pan with space / middle mouse / Alt+Left (Mac trackpad)
    if (isPanTrigger(e)) {
      state.dragging = { type: 'pan', startX: e.clientX - state.pan.x, startY: e.clientY - state.pan.y };
      viewport.classList.add('grabbing');
      return;
    }
    // If already in cut mode for an item, handle drawing on that item
    if (window.cutState) {
      const item = getCutItem();
      if (item) {
        const itemEl = e.target.closest('.item');
        if (itemEl === item.el) {
          // Start drawing freehand path on the image
          startCutDraw(e.clientX, e.clientY);
          return;
        }
        // Click on a different image — switch to that image
        if (itemEl) {
          const newItem = state.items.find(i => i.el === itemEl);
          if (newItem && newItem.src && !newItem.isVideo && !newItem.isLink) {
            enterCutMode(newItem);
            return;
          }
        }
      }
    }
    // Not yet in cut mode — check if clicking an image
    const itemEl = e.target.closest('.item');
    if (itemEl) {
      const item = state.items.find(i => i.el === itemEl);
      if (item && item.src && !item.isVideo && !item.isLink) {
        enterCutMode(item);
        return;
      }
    }
    return;
  }

  // LASSO MODE
  if (state.tool === 'lasso') {
    e.preventDefault();
    // Pan with space / middle mouse / Alt+Left (Mac trackpad)
    if (isPanTrigger(e)) {
      state.dragging = { type: 'pan', startX: e.clientX - state.pan.x, startY: e.clientY - state.pan.y };
      viewport.classList.add('grabbing');
      return;
    }
    // If already in lasso mode for an item
    if (window.lassoState) {
      const item = getLassoItem();
      if (item) {
        const itemEl = e.target.closest('.item');
        // Click on the target image — add a point
        if (itemEl === item.el) {
          addLassoPoint(e.clientX, e.clientY);
          return;
        }
        // Click on a different image — switch
        if (itemEl) {
          const newItem = state.items.find(i => i.el === itemEl);
          if (newItem && newItem.src && !newItem.isVideo && !newItem.isLink) {
            enterLassoMode(newItem);
            return;
          }
        }
      }
    }
    // Not yet in lasso mode — check if clicking an image
    const itemEl = e.target.closest('.item');
    if (itemEl) {
      const item = state.items.find(i => i.el === itemEl);
      if (item && item.src && !item.isVideo && !item.isLink) {
        enterLassoMode(item);
        return;
      }
    }
    return;
  }

  // EXPORT DRAG
  if (state.tool === 'export') {
    G.exportDrag = { startX: e.clientX, startY: e.clientY };
    exportBox.style.display = 'block';
    exportBox.style.left = e.clientX + 'px';
    exportBox.style.top = e.clientY + 'px';
    exportBox.style.width = '0px';
    exportBox.style.height = '0px';
    return;
  }

  // CAPTURE DRAG
  if (state.tool === 'capture') {
    G.captureDrag = { startX: e.clientX, startY: e.clientY };
    captureBox.style.display = 'block';
    captureOverlay.style.display = 'block';
    captureHint.style.display = 'none';
    captureBox.style.left = e.clientX + 'px';
    captureBox.style.top = e.clientY + 'px';
    captureBox.style.width = '0px';
    captureBox.style.height = '0px';
    // Show full-screen dim initially
    coPanels.top.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);';
    coPanels.bottom.style.display = 'none';
    coPanels.left.style.display = 'none';
    coPanels.right.style.display = 'none';
    document.body.style.cursor = 'crosshair';
    // R50: do NOT call setCaptureMode(true) here. The user wants the
    // media controls panel to stay visible during the selection drag
    // (R49 fix for the scale issue had them hidden, which surprised
    // the user). captureArea's drawing logic now uses .media-wrap
    // dimensions for the video and fills the controls bar area with a
    // dark color, so the captured output matches the visible state.
    return;
  }

  // PAN
  if (isPanTrigger(e)) {
    state.dragging = { type: 'pan', startX: e.clientX - state.pan.x, startY: e.clientY - state.pan.y };
    viewport.classList.add('grabbing');
    return;
  }

  // TEXT TOOL
  if (state.tool === 'text') {
    // Check if clicking on existing text
    const textEl = e.target.closest('.text-item');
    if (textEl) {
      const tx = state.texts.find(t => t.el === textEl);
      if (tx) {
        selectOnly(tx.id);
        textEl.focus();
        return;
      }
    }
    // If a text-item is currently being edited, the user just finished typing.
    // Clicking on empty area should commit the edit and switch to select mode
    // instead of creating yet another text box.
    // Detect editing text robustly: by .editing class OR by being the activeElement.
    const editingByClass = document.querySelector('.text-item.editing');
    const ae = document.activeElement;
    const editingByFocus = (ae && ae.classList && ae.classList.contains('text-item')) ? ae : null;
    const editingEl = editingByClass || editingByFocus;
    if (editingEl) {
      // Force blur to commit any pending edit, then drop back to select mode.
      if (document.activeElement === editingEl) editingEl.blur();
      else editingEl.classList.remove('editing');
      setTool('select');
      return;
    }
    const wx = (e.clientX - state.pan.x) / state.zoom;
    const wy = (e.clientY - state.pan.y) / state.zoom;
    addText(wx, wy, '');
    return;
  }

  // DRAW TOOL
  if (state.tool === 'draw') {
    const wx = (e.clientX - state.pan.x) / state.zoom;
    const wy = (e.clientY - state.pan.y) / state.zoom;
    // Check if hovering on an existing stroke — start move
    if (G.hoveredStroke && drawTool.mode !== 'eraser') {
      G.drawMoveState = {
        stroke: G.hoveredStroke,
        startWx: wx,
        startWy: wy,
        origPoints: G.hoveredStroke.points.map(p => [p[0], p[1]])
      };
      viewport.style.cursor = 'grabbing';
      return;
    }
    // Otherwise start a new stroke
    G.currentStroke = { strokeId: G.nextStrokeId++, color: drawTool.color, size: drawTool.size, opacity: drawTool.opacity, mode: drawTool.mode, arrowHead: drawTool.arrowHead, points: [[wx, wy, (drawTool.pressure ? (window.__kraftedPressure || 0.5) : 1)]] };
    G.drawStrokes.push(G.currentStroke);
    redrawDrawLayer();
    return;
  }

  // SELECT TOOL — check for handles
  const handle = e.target.closest('.item-handle');
  const rotHandle = e.target.closest('.item-rot');
  if (handle) {
    e.preventDefault();
    const item = [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])].find(i => i.id === +handle.dataset.id);
    if (item && !item.locked) {
      pushUndo();
      const dir = handle.dataset.dir;
      // Cache media-wrap reference for fast height updates during drag
      const cachedMediaWrap = item.el.classList.contains('has-media') ? item.el.querySelector('.media-wrap') : null;
      // Cache group + member references (avoid refinding on every mousemove)
      const cachedGroup = getGroupForItem(item.id);
      const cachedMembers = [];
      if (cachedGroup) {
        const allItems = [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])];
        cachedGroup.memberIds.forEach(mid => {
          if (mid === item.id) return;
          const m = allItems.find(i => i.id === mid);
          if (m && m.img) cachedMembers.push(m);
        });
      }
      // Round 41 — MULTI-SELECT SCALE: when 2+ items are selected and the
      // user grabs a handle on ONE of them, scale ALL selected items
      // together proportionally (Figma-style). Previously only the dragged
      // item scaled, which was confusing when trying to "tidy the layout".
      //
      // We compute the union axis-aligned bounding box of the entire
      // selection, then pivot the scale around the corner OPPOSITE the
      // dragged handle. Each selected item's (x, y, w, h) is multiplied by
      // the resulting scaleX/scaleY around the pivot, so their relative
      // positions and sizes are preserved.
      //
      // This also fixes the "video goes black when scaling with other
      // items" bug: every selected media item now gets its .item height
      // and .media-wrap height written in lockstep with its width, so
      // the <video> element never ends up with a 0-height wrap.
      let multiData = null;
      if (state.selected.size > 1 && state.selected.has(item.id)) {
        const sel41 = getSelectedItems().filter(s => !s.locked);
        if (sel41.length > 1) {
          // Union AABB of the selection (in world coords)
          let mx = Infinity, my = Infinity, mx2 = -Infinity, my2 = -Infinity;
          sel41.forEach(s => {
            if (s.x < mx) mx = s.x;
            if (s.y < my) my = s.y;
            if (s.x + s.w > mx2) mx2 = s.x + s.w;
            if (s.y + s.h > my2) my2 = s.y + s.h;
          });
          const bb = { x: mx, y: my, w: mx2 - mx, h: my2 - my };
          // Pivot = corner/edge OPPOSITE to the handle direction
          // 'se' (bottom-right handle) → pivot = top-left of bbox
          // 'nw' (top-left handle)     → pivot = bottom-right of bbox
          // 'n'/'s'                    → pivot = middle of opposite edge
          // 'e'/'w'                    → pivot = middle of opposite edge
          const pivotX = dir.includes('w') ? (bb.x + bb.w) : (dir.includes('e') ? bb.x : (bb.x + bb.w / 2));
          const pivotY = dir.includes('n') ? (bb.y + bb.h) : (dir.includes('s') ? bb.y : (bb.y + bb.h / 2));
          // Original handle position on the bbox (in world coords)
          const handleOrigX = dir.includes('w') ? bb.x : (dir.includes('e') ? (bb.x + bb.w) : (bb.x + bb.w / 2));
          const handleOrigY = dir.includes('n') ? bb.y : (dir.includes('s') ? (bb.y + bb.h) : (bb.y + bb.h / 2));
          // Snapshot each item's pre-scale geometry so we can re-derive on
          // every mousemove (rAF may skip frames; we want pure derivation)
          const snaps = sel41.map(s => ({
            item: s,
            x: s.x, y: s.y, w: s.w, h: s.h,
            // For media items: also cache the .media-wrap element so the
            // fast-path can resize it without querySelector each frame
            wrapEl: s.el && s.el.classList.contains('has-media') ? s.el.querySelector('.media-wrap') : null
          }));
          multiData = { bbox: bb, pivotX, pivotY, handleOrigX, handleOrigY, snaps, dir };
        }
      }
      state.dragging = { type: 'resize', item, dir, startX: e.clientX, startY: e.clientY, origW: item.w, origH: item.h, origX: item.x, origY: item.y, _rafId: null, _mediaWrap: cachedMediaWrap, _group: cachedGroup, _members: cachedMembers, _multi: multiData };
      document.body.classList.add('is-dragging');
      document.querySelectorAll('.item-handle, .item-rot').forEach(el => el.remove());
      // Round 67 — also wipe the empty union multi-select container left
      // behind after the 8 child handles were just removed. The container
      // is empty (no styles, no children) but we drop it anyway to keep
      // the DOM tidy across long sessions of reselecting.
      document.querySelectorAll('.multi-sel-handles').forEach(el => el.remove());
    }
    return;
  }
  if (rotHandle) {
    e.preventDefault();
    const item = [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])].find(i => i.id === +rotHandle.dataset.id);
    if (item && !item.locked) {
      pushUndo();
      const r = item.el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      state.dragging = { type: 'rotate', item, cx, cy, startAngle: Math.atan2(e.clientY - cy, e.clientX - cx), origRot: item.rot };
      document.body.classList.add('is-dragging');
      document.querySelectorAll('.item-handle, .item-rot').forEach(el => el.remove());
      // Round 67 — also wipe the empty union multi-select container left
      // behind after the 8 child handles were just removed. The container
      // is empty (no styles, no children) but we drop it anyway to keep
      // the DOM tidy across long sessions of reselecting.
      document.querySelectorAll('.multi-sel-handles').forEach(el => el.remove());
    }
    return;
  }

  // REFRAME MODE — drag image within frame
  if (state.reframing) {
    const reframeItem = state.reframing.item;
    const reframeEl = reframeItem.el;
    const imgEl = reframeItem.img;
    // Check if clicking inside the reframing item
    if (reframeEl.contains(e.target) || e.target === imgEl) {
      e.preventDefault();
      state.reframing.dragStartX = e.clientX;
      state.reframing.dragStartY = e.clientY;
      state.reframing.dragCropX = reframeItem.cropX || 0;
      state.reframing.dragCropY = reframeItem.cropY || 0;
      state.dragging = { type: 'reframe', item: reframeItem };
      document.body.classList.add('is-dragging');
      return;
    }
    // Clicked outside — cancel reframe
    exitReframe(true);
    return;
  }

  // Check for item click
  const itemEl = e.target.closest('.item, .text-item, .todo-item, .mindmap-item');
  if (itemEl) {
    const isEditingText = itemEl.classList.contains('text-item') && itemEl.classList.contains('editing');
    // When clicking on an editing text-item, do NOT initiate a move drag.
    // Let the browser handle native text selection / caret positioning.
    // To move the box, the user clicks outside first (commits edit), then clicks the box to select, then drags.
    const item = [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])].find(i => i.el === itemEl);
    if (item) {
      if (e.shiftKey) {
        toggleSelect(item.id);
      } else if (state.selected.has(item.id) && state.selected.size > 1) {
        // Already part of multi-selection — keep all selected so we can drag together
        const group = getGroupForItem(item.id);
        if (group) { group.memberIds.forEach(mid => state.selected.add(mid)); }
      } else {
        selectOnly(item.id);
        const group = getGroupForItem(item.id);
        if (group) { group.memberIds.forEach(mid => state.selected.add(mid)); }
      }
      if (!item.locked && !isEditingText) {
        pushUndo();
        const moveItems = getSelectedItems();
        // Pre-cache origin positions and the to-move set so mousemove doesn't redo work
        const allItemsNow = [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])];
        const toMoveNow = new Set(moveItems);
        moveItems.forEach(it => {
          const grp = getGroupForItem(it.id);
          if (grp) grp.memberIds.forEach(mid => {
            const member = allItemsNow.find(i => i.id === mid);
            if (member && !toMoveNow.has(member)) toMoveNow.add(member);
          });
        });
        toMoveNow.forEach(it => {
          it._origX = it.x;
          it._origY = it.y;
          if (it.type === 'draw' && it.strokeId) {
            const stroke = findStrokeById(it.strokeId);
            if (stroke) it._origPoints = stroke.points.map(p => [...p]);
          }
        });
        state.dragging = {
          type: 'move',
          startX: e.clientX, startY: e.clientY,
          // Round 35: capture the canvas pan at drag start. The move
          // handler restores it every frame so the canvas view stays
          // stable while the user translates a player. See the wheel
          // handler for the matching skip-when-moving guard.
          _lockedPanX: state.pan.x, _lockedPanY: state.pan.y,
          items: moveItems,
          _allItems: allItemsNow,
          _toMoveCache: toMoveNow,
          _moveRafId: null,
        };
        // Physically remove handles from DOM to prevent GPU-composited ghosting (video/GIF)
        document.querySelectorAll('.item-handle, .item-rot').forEach(el => el.remove());
      // Round 67 — also wipe the empty union multi-select container left
      // behind after the 8 child handles were just removed. The container
      // is empty (no styles, no children) but we drop it anyway to keep
      // the DOM tidy across long sessions of reselecting.
      document.querySelectorAll('.multi-sel-handles').forEach(el => el.remove());
        document.body.classList.add('is-dragging');
      }
      return;
    }
  }

  // Box select
  if (!e.shiftKey) clearSelection();
  state.dragging = { type: 'box-select', startX: e.clientX, startY: e.clientY };
  selBox.style.display = 'block';
  selBox.style.left = e.clientX + 'px';
  selBox.style.top = e.clientY + 'px';
  selBox.style.width = '0px';
  selBox.style.height = '0px';
});
// ── DOCUMENT-LEVEL MOUSEDOWN: capture mode works anywhere on screen ──
document.addEventListener('mousedown', e => {
  if (state.tool !== 'capture') return;
  // Don't re-trigger if viewport handler already started capture
  if (G.captureDrag) return;
  // Don't capture clicks on toolbar, buttons, etc.
  if (e.target.closest('#toolbar') || e.target.closest('#props-panel') || e.target.closest('button') || e.target.closest('a')) return;
  e.preventDefault();
  G.captureDrag = { startX: e.clientX, startY: e.clientY };
  captureBox.style.display = 'block';
  captureOverlay.style.display = 'block';
  const hint = document.getElementById('capture-hint');
  if (hint) hint.style.display = 'none';
  captureBox.style.left = e.clientX + 'px';
  captureBox.style.top = e.clientY + 'px';
  captureBox.style.width = '0px';
  captureBox.style.height = '0px';
  coPanels.top.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);';
  coPanels.bottom.style.display = 'none';
  coPanels.left.style.display = 'none';
  coPanels.right.style.display = 'none';
  document.body.style.cursor = 'crosshair';
  // R50: do NOT call setCaptureMode(true) here either. Per user
  // request, the media controls panel must stay visible throughout
  // the capture flow. captureArea reads .media-wrap BCR for the
  // video draw and fills the controls area with a dark bar, so the
  // captured output mirrors what's on screen exactly.
});

// DOUBLE-CLICK: edit text items
viewport.addEventListener('dblclick', e => {
  const textEl = e.target.closest('.text-item');
  if (textEl) {
    const tx = state.texts.find(t => t.el === textEl);
    if (tx) {
      selectOnly(tx.id);
      textEl.focus();
      textEl.classList.add('editing');
      // Place cursor at end
      const range = document.createRange();
      range.selectNodeContents(textEl);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
});

// MOUSEMOVE
document.addEventListener('mousemove', e => {
  // Belt-and-suspenders: touch devices handle all gestures via the
  // touchstart/touchmove/touchend listeners above (which call
  // e.preventDefault() to suppress synthetic mouse events). This
  // guard ensures that even if an older iOS Safari version still
  // dispatches a synthetic mousemove, it can never reach box-select
  // or any other desktop-only drag logic below. Desktop
  // (IS_TOUCH_DEVICE === false) behavior is completely untouched.
  if (IS_TOUCH_DEVICE) return;

  G.lastScreenX = e.clientX;
  G.lastScreenY = e.clientY;
  state.mouse.x = e.clientX;
  state.mouse.y = e.clientY;

  // REFRAME DRAG — move image within frame
  if (state.dragging && state.dragging.type === 'reframe' && state.reframing) {
    const rf = state.reframing;
    const dx = e.clientX - rf.dragStartX;
    const dy = e.clientY - rf.dragStartY;
    const item = rf.item;
    item.cropX = Math.max(0, Math.min(item.natW - item.w, rf.dragCropX - dx));
    item.cropY = Math.max(0, Math.min(item.natH - item.h, rf.dragCropY - dy));
    if (item.img) {
      item.img.style.transform = 'translate(' + (-(item.cropX || 0)) + 'px, ' + (-(item.cropY || 0)) + 'px)';
    }
    return;
  }

  // CROP DRAG — move crop window or resize via handle
  if (state.dragging && (state.dragging.type === 'crop-move' || state.dragging.type === 'crop-resize') && state.cropping) {
    const d = state.dragging;
    const c = state.cropping;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const maxW = d.imgW, maxH = d.imgH;
    const minSize = 12;
    if (d.type === 'crop-move') {
      let nx = d.origX + dx;
      let ny = d.origY + dy;
      nx = Math.max(0, Math.min(maxW - c.w, nx));
      ny = Math.max(0, Math.min(maxH - c.h, ny));
      c.x = nx; c.y = ny;
    } else {
      // resize
      let nx = d.origX, ny = d.origY, nw = d.origW, nh = d.origH;
      const h = d.handle;
      const ar = c.aspect; // null or number
      if (h.includes('e')) nw = Math.max(minSize, Math.min(maxW - nx, d.origW + dx));
      if (h.includes('s')) nh = Math.max(minSize, Math.min(maxH - ny, d.origH + dy));
      if (h.includes('w')) {
        const right = d.origX + d.origW;
        const newW = Math.max(minSize, Math.min(d.origW + d.origX, d.origW - dx));
        nx = right - newW;
        nw = newW;
      }
      if (h.includes('n')) {
        const bottom = d.origY + d.origH;
        const newH = Math.max(minSize, Math.min(d.origH + d.origY, d.origH - dy));
        ny = bottom - newH;
        nh = newH;
      }
      if (ar) {
        // Constrain to aspect ratio: anchor depends on which handle is being dragged
        if (h === 'n' || h === 's') nw = nh * ar;
        else if (h === 'e' || h === 'w') nh = nw / ar;
        else {
          // corners: choose axis with greater delta
          if (Math.abs(dx) > Math.abs(dy)) nh = nw / ar; else nw = nh * ar;
        }
        // Re-clamp
        if (nw > maxW) { nw = maxW; nh = nw / ar; }
        if (nh > maxH) { nh = maxH; nw = nh * ar; }
        // Re-anchor for corner handles
        if (h.includes('w')) nx = (d.origX + d.origW) - nw;
        if (h.includes('n')) ny = (d.origY + d.origH) - nh;
      }
      // Final clamp
      if (nx < 0) { nw += nx; nx = 0; }
      if (ny < 0) { nh += ny; ny = 0; }
      if (nx + nw > maxW) nw = maxW - nx;
      if (ny + nh > maxH) nh = maxH - ny;
      if (nw < minSize) nw = minSize;
      if (nh < minSize) nh = minSize;
      c.x = nx; c.y = ny; c.w = nw; c.h = nh;
    }
    positionCropUI();
    return;
  }

  // FREE CUT DRAW UPDATE
  if (window.cutState && window.cutState.isDragging) {
    updateCutDraw(e.clientX, e.clientY);
    return;
  }

  // Update cut target highlight on pan/zoom
  if (window.cutState && !window.cutState.isDragging) {
    updateCutTargetHighlight();
  }

  // DRAW TOOL — update current stroke (before !d check since draw doesn't set state.dragging)
  if (G.currentStroke) {
    const wx = (e.clientX - state.pan.x) / state.zoom;
    const wy = (e.clientY - state.pan.y) / state.zoom;
    if (G.currentStroke.mode === 'pen') {
      const p = drawTool.pressure ? (window.__kraftedPressure || 0.5) : 1;
      if (e.shiftKey && G.currentStroke.points.length >= 1) {
        // Shift held: constrain to straight line from last point (45° snap)
        const last = G.currentStroke.points[G.currentStroke.points.length - 1];
        const dx = wx - last[0], dy = wy - last[1];
        const angle = Math.atan2(dy, dx);
        const len = Math.hypot(dx, dy);
        const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        G.currentStroke.points.push([last[0] + len * Math.cos(snapped), last[1] + len * Math.sin(snapped), p]);
      } else {
        G.currentStroke.points.push([wx, wy, p]);
      }
    } else if (G.currentStroke.mode === 'eraser') {
      G.currentStroke.points.push([wx, wy]);
    } else if (G.currentStroke.mode === 'arrow') {
      let ex = wx, ey = wy;
      if (e.shiftKey) {
        // Constrain to 0/45/90/135 degree angles
        const sx0 = G.currentStroke.points[0][0], sy0 = G.currentStroke.points[0][1];
        const dx = ex - sx0, dy = ey - sy0;
        const angle = Math.atan2(dy, dx);
        const len = Math.hypot(dx, dy);
        const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        ex = sx0 + len * Math.cos(snapped);
        ey = sy0 + len * Math.sin(snapped);
      }
      G.currentStroke.points = [G.currentStroke.points[0], [ex, ey]];
    } else if (G.currentStroke.mode === 'box') {
      let ex = wx, ey = wy;
      if (e.shiftKey) {
        // Constrain to perfect square
        const sx0 = G.currentStroke.points[0][0], sy0 = G.currentStroke.points[0][1];
        const dx = ex - sx0, dy = ey - sy0;
        const size = Math.max(Math.abs(dx), Math.abs(dy));
        ex = sx0 + (dx >= 0 ? size : -size);
        ey = sy0 + (dy >= 0 ? size : -size);
      }
      G.currentStroke.points = [G.currentStroke.points[0], [ex, ey]];
    }
    redrawDrawLayer();
    return;
  }

  // DRAW STROKE MOVE — dragging a stroke
  if (G.drawMoveState) {
    const wx = (e.clientX - state.pan.x) / state.zoom;
    const wy = (e.clientY - state.pan.y) / state.zoom;
    const dx = wx - G.drawMoveState.startWx;
    const dy = wy - G.drawMoveState.startWy;
    // Restore original points then apply offset
    G.drawMoveState.stroke.points = G.drawMoveState.origPoints.map(p => [p[0] + dx, p[1] + dy]);
    // Sync associated draw item position
    const drawItem = state.items.find(i => i.type === 'draw' && i.strokeId === G.drawMoveState.stroke.strokeId);
    if (drawItem) {
      const origItem = G.drawMoveState.origItem || (G.drawMoveState.origItem = { x: drawItem.x, y: drawItem.y });
      drawItem.x = origItem.x + dx;
      drawItem.y = origItem.y + dy;
      updateItemStyle(drawItem);
    }
    redrawDrawLayer();
    return;
  }

  // DRAW TOOL — hover detection for stroke move
  if (state.tool === 'draw' && !G.currentStroke && !state.dragging) {
    const wx = (e.clientX - state.pan.x) / state.zoom;
    const wy = (e.clientY - state.pan.y) / state.zoom;
    const hit = hitTestStrokes(wx, wy);
    if (hit !== G.hoveredStroke) {
      G.hoveredStroke = hit;
      redrawDrawLayer();
      viewport.style.cursor = hit ? 'grab' : 'crosshair';
    }
  }

  // SELECT TOOL — show pointer cursor when hovering a draw item
  if (state.tool === 'select' && !state.dragging) {
    const drawItem = e.target.closest('.draw-item');
    if (drawItem) {
      viewport.style.cursor = 'move';
    } else if (viewport.style.cursor === 'move') {
      viewport.style.cursor = '';
    }
  }

  // EXPORT DRAG (before !d check — export doesn't use state.dragging)
  if (G.exportDrag) { updateExport(e); return; }

  // CAPTURE DRAG (before !d check — capture doesn't use state.dragging)
  if (G.captureDrag) { updateCapture(e); return; }

  const d = state.dragging;
  if (!d) return;

  if (d.type === 'pan') {
    state.pan.x = e.clientX - d.startX;
    state.pan.y = e.clientY - d.startY;
    updateCanvas();
    // Keep any open annotation popovers parallel to their video while the
    // canvas pans (they're on <body> at position: fixed, so they'd stay
    // stuck without this).
    repositionAllAnnoPopovers();
    return;
  }

  if (d.type === 'move') {
    // Coalesce rapid mousemove events to one DOM write per frame (60fps cap).
    // Without rAF, mousemove can fire 100+ times/sec, each triggering updateItemStyle
    // on every selected item. For 30 images that's 3000+ style mutations/sec.
    if (d._moveRafId) cancelAnimationFrame(d._moveRafId);
    const lastClientX = e.clientX, lastClientY = e.clientY;
    d._moveRafId = requestAnimationFrame(() => {
      d._moveRafId = null;
      // Round 35: keep the canvas view stable during a move drag. If any
      // other handler (e.g. the wheel handler for accidental trackpad
      // touches) has shifted state.pan since the drag started, snap it
      // back. The player translates in world space relative to the
      // captured pan, so the visual effect is: the player follows the
      // cursor exactly, and the canvas stays still.
      if (typeof d._lockedPanX === 'number' && state.pan.x !== d._lockedPanX) state.pan.x = d._lockedPanX;
      if (typeof d._lockedPanY === 'number' && state.pan.y !== d._lockedPanY) state.pan.y = d._lockedPanY;
      let dx = (lastClientX - d.startX) / state.zoom;
      let dy = (lastClientY - d.startY) / state.zoom;
      // Round 47 — SHIFT AXIS-LOCKED MOVE. While Shift is held during a
      // drag, movement is constrained to a single axis (the one with the
      // greater cursor delta). This matches Figma / Sketch / Photoshop:
      // the user starts dragging, sees the item move, then realizes they
      // wanted a straight line — pressing Shift snaps the perpendicular
      // axis to zero so the item only moves along the dominant direction.
      //
      // We pick the axis CONTINUOUSLY (not "lock on first move") because
      // (a) it's what every other design tool does, (b) the lock follows
      // the cursor naturally — diagonal drags with Shift held look
      // perfectly straight in the dominant direction, and (c) releasing
      // Shift mid-drag restores free 2D movement from the current cursor
      // position (no jump), since the move always derives from the
      // original start point + current cursor.
      //
      // Works for both single-item and multi-item (group/multi-select)
      // moves — the toMove.forEach below applies the locked dx/dy to
      // every member uniformly, so all selected items travel on the same
      // axis in lockstep.
      if (e.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) {
          dy = 0;  // horizontal-dominant — lock vertical
        } else {
          dx = 0;  // vertical-dominant — lock horizontal
        }
      }
      // Reuse cached allItems array (set on mousedown) — avoids 4 array spreads per frame
      const allItems = d._allItems;
      // Collect all items to move (including unselected group members)
      const toMove = d._toMoveCache;
      toMove.forEach(item => {
        item.x = item._origX + dx;
        item.y = item._origY + dy;
        updateItemStyle(item, true);  // lightweight: skip filter/overlay/mask recompute
      });
      // Sync draw item stroke positions after moving — use origPoints to avoid cumulative drift
      toMove.forEach(item => {
        if (item.type === 'draw' && item.strokeId) {
          const stroke = findStrokeById(item.strokeId);
          if (stroke) {
            const origPoints = item._origPoints;
            const itemDx = item.x - item._origX;
            const itemDy = item.y - item._origY;
            stroke.points = origPoints.map(p => [p[0] + itemDx, p[1] + itemDy]);
          }
        }
      });
      updateAllGroupBorders();
      redrawDrawLayer();
      // Refresh relation lines so they follow dragged items in real-time
      if (state.relations && state.relations.length) renderRelations();
      // Keep any open annotation popovers parallel to the video as the
      // user drags items around. Without this, a popover opened for an
      // item would stay glued to its old viewport position even after
      // the item moves out from under it.
      repositionAllAnnoPopovers();
    });
    return;
  }

  if (d.type === 'resize') {
    // Cancel any pending rAF to coalesce rapid mousemove events
    if (d._rafId) cancelAnimationFrame(d._rafId);
    // Compute everything synchronously, defer DOM write to next frame (rAF = ~16ms, max 60fps)
    const dx = (e.clientX - d.startX) / state.zoom;
    const dy = (e.clientY - d.startY) / state.zoom;
    const dir = d.dir;
    let w = d.origW, h = d.origH, x = d.origX, y = d.origY;
    const isText = !d.item.img;
    const minSize = isText ? 30 : 5;
    if (dir.includes('e')) w = Math.max(minSize, d.origW + dx);
    if (dir.includes('w')) { w = Math.max(minSize, d.origW - dx); x = d.origX + (d.origW - w); }
    if (dir.includes('s')) h = Math.max(minSize, d.origH + dy);
    if (dir.includes('n')) { h = Math.max(minSize, d.origH - dy); y = d.origY + (d.origH - h); }
    // Aspect ratio for images only (not text), unless Shift held
    if (d.item.img && !e.shiftKey) {
      const ratio = d.origW / d.origH;
      if (dir.length === 2 || dir === 'e' || dir === 'w') h = w / ratio;
      else if (dir === 'n' || dir === 's') w = h * ratio;
    }
    // Round 41 — MULTI-SELECT SCALE: scale all selected items together
    // when 2+ items are selected. Computes a single scaleX/scaleY from
    // the cursor delta applied to the union bbox, then maps every snap
    // through that scale around the pivot. Each media item also gets
    // its .item height (+30 for the controls bar) and .media-wrap height
    // written so the <video> element never gets a 0-height wrap (the
    // "video goes black when scaling with other items" fix).
    let multiApply = null;
    if (d._multi) {
      const M = d._multi;
      // New handle position in world coords
      const newHandleX = M.handleOrigX + dx;
      const newHandleY = M.handleOrigY + dy;
      // Scale factors from pivot. Guard against zero-span handles (edge
      // handles have zero span on one axis, so only the other axis
      // produces a meaningful scale there).
      const spanX = M.handleOrigX - M.pivotX;
      const spanY = M.handleOrigY - M.pivotY;
      const rawX = (Math.abs(spanX) > 0.0001) ? (newHandleX - M.pivotX) / spanX : 1;
      const rawY = (Math.abs(spanY) > 0.0001) ? (newHandleY - M.pivotY) / spanY : 1;
      // Round 46 — ASPECT-PRESERVING MULTI-SELECT SCALE.
      // By default, every item in the selection keeps its OWN aspect
      // ratio (a 1:1 image stays 1:1, a 16:9 image stays 16:9, a 4:5
      // image stays 4:5). We achieve this with a UNIFIED scale `s`
      // applied to both axes — applying the same scalar to width and
      // height of an item is, by definition, aspect-preserving. Each
      // item scales by the same `s`, so 1:1 and 16:9 stay in their
      // own shapes and just grow/shrink together.
      //
      // For corner handles we pick `s` from the DOMINANT axis
      // (max(|rawX|, |rawY|)) so the cursor tracks the dragged corner
      // on its leading axis; the trailing axis follows proportionally.
      // This matches the natural "grab the corner and pull" feel of
      // Figma / Sketch / Photoshop.
      //
      // The user can hold Shift OR Ctrl to switch to FREE scale
      // (independent X/Y) — the classic stretch behavior. Same
      // convention as the single-item resize path.
      const freeScale = e.shiftKey || e.ctrlKey;
      let scaleX, scaleY;
      if (freeScale) {
        // Free scale — independent X/Y (legacy behavior)
        scaleX = rawX; scaleY = rawY;
        if (dir === 'n' || dir === 's') scaleX = 1;
        if (dir === 'e' || dir === 'w') scaleY = 1;
      } else {
        // Default: aspect-preserving unified scale
        if (dir === 'n' || dir === 's') {
          // Vertical edge — only Y scales (only one axis changes,
          // aspect is not defined for an edge drag)
          scaleX = 1;
          scaleY = rawY;
        } else if (dir === 'e' || dir === 'w') {
          // Horizontal edge — only X scales
          scaleX = rawX;
          scaleY = 1;
        } else {
          // Corner — unified scale from the dominant axis. The
          // sign comes from whichever axis is dominant, so flips
          // (negative scales) still work. |max| keeps the magnitude
          // matching how far the user pulled the corner.
          const s = (Math.abs(rawX) >= Math.abs(rawY)) ? rawX : rawY;
          scaleX = s; scaleY = s;
        }
      }
      // Clamp to a sensible minimum so items don't disappear
      scaleX = Math.max(0.05, scaleX);
      scaleY = Math.max(0.05, scaleY);
      // Pre-compute new geometry for every snap so the rAF write is a
      // tight loop of style assignments (no per-frame arithmetic).
      const applies = M.snaps.map(s => {
        const nw = Math.max(5, s.w * scaleX);
        const nh = Math.max(5, s.h * scaleY);
        const nx = M.pivotX + (s.x - M.pivotX) * scaleX;
        const ny = M.pivotY + (s.y - M.pivotY) * scaleY;
        s.item.x = nx; s.item.y = ny; s.item.w = nw; s.item.h = nh;
        return { item: s.item, x: nx, y: ny, w: nw, h: nh, wrapEl: s.wrapEl };
      });
      multiApply = applies;
    }
    // Commit new dimensions to state (for the dragged item, single-item path)
    // Skip this when multi-select is active — the multi-select block below
    // already wrote d.item.x/y/w/h via the snap.
    if (!multiApply) {
      d.item.w = w; d.item.h = h; d.item.x = x; d.item.y = y;
      if (d.item.el && d.item.el.classList.contains('todo-item')) d.item._resized = true;
      // Mark text-items as user-resized so autoGrowTextItem respects the width
      // and only grows height on input (prevents width jumping on type).
      if (d.item.el && d.item.el.classList.contains('text-item')) {
        d.item.userResized = true;
        // Font size is independent of box resize — user changes it manually in text props.
        // Box resize only affects dimensions; text wraps naturally.
      }
    }
    // Cache scale factors and pivot for group members
    const scaleX = w / d.origW;
    const scaleY = h / d.origH;
    const pivotX = d.origX;
    const pivotY = d.origY;
    d._rafId = requestAnimationFrame(function() {
      d._rafId = null;
      // Multi-select path: every selected item (including the dragged one)
      // gets a full geometric write. This is the primary path when
      // 2+ items are selected.
      if (multiApply) {
        multiApply.forEach(a => {
          const el = a.item.el;
          if (!el) return;
          el.style.width = a.w + 'px';
          // Media items: total height = video height + 54px (info bar + controls)
          const isMedia = el.classList.contains('has-media');
          if (!el.classList.contains('todo-item')) {
            el.style.height = (isMedia ? a.h + 54 : a.h) + 'px';
          }
          // Direct write to the cached .media-wrap (no querySelector)
          if (a.wrapEl) a.wrapEl.style.height = a.h + 'px';
          el.style.transform = 'translate(' + a.x + 'px, ' + a.y + 'px) rotate(' + (a.item.rot || 0) + 'deg)';
          // Mark resized flags so other systems know this was a user drag
          if (el.classList.contains('todo-item')) a.item._resized = true;
          if (el.classList.contains('text-item')) a.item.userResized = true;
        });
        // Keep any open annotation popovers parallel to the video as the
        // selection is resized (popovers anchor to .media-wrap rect)
        repositionAllAnnoPopovers();
        // Refresh relation lines
        if (state.relations && state.relations.length) renderRelations();
        return;
      }
      // FAST PATH: direct style writes (no full updateItemStyle) for max snappiness
      const el = d.item.el;
      el.style.width = w + 'px';
      // Media items: total height = video height + 54px (info bar + controls)
      const isMedia = el.classList.contains('has-media');
      if (!el.classList.contains('todo-item')) {
        el.style.height = (isMedia ? h + 54 : h) + 'px';
      }
      // Direct write to cached media-wrap (skip querySelector)
      if (d._mediaWrap) d._mediaWrap.style.height = h + 'px';
      // Direct transform write (position + rotation, scale handled by width/height)
      el.style.transform = 'translate(' + x + 'px, ' + y + 'px) rotate(' + (d.item.rot || 0) + 'deg)';
      // Scale group members proportionally (also using direct style writes)
      if (d._group && d._members.length) {
        d._members.forEach(member => {
          const mOrigX = member._origX !== undefined ? member._origX : (member._origX = member.x);
          const mOrigY = member._origY !== undefined ? member._origY : (member._origY = member.y);
          const mOrigW = member._origW !== undefined ? member._origW : (member._origW = member.w);
          const mOrigH = member._origH !== undefined ? member._origH : (member._origH = member.h);
          member.x = pivotX + (mOrigX - pivotX) * scaleX;
          member.y = pivotY + (mOrigY - pivotY) * scaleY;
          member.w = Math.max(5, mOrigW * scaleX);
          member.h = Math.max(5, mOrigH * scaleY);
          // Fast direct writes
          const mel = member.el;
          mel.style.width = member.w + 'px';
          mel.style.height = member.h + 'px';
          mel.style.transform = 'translate(' + member.x + 'px, ' + member.y + 'px) rotate(' + (member.rot || 0) + 'deg)';
        });
        updateGroupBorder(d._group);
      }
      // Refresh relation lines so they follow resized items
      if (state.relations && state.relations.length) renderRelations();
      // Keep any open annotation popovers parallel to the video as the
      // item is resized (video height changes, so the popover's parallel
      // span must follow).
      repositionAllAnnoPopovers();
    });
    return;
  }

  if (d.type === 'rotate') {
    const angle = Math.atan2(e.clientY - d.cy, e.clientX - d.cx);
    let deg = d.origRot + (angle - d.startAngle) * 180 / Math.PI;
    if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    d.item.rot = deg;
    updateItemStyle(d.item, true);  // lightweight: skip filter/overlay/mask recompute
    return;
  }

  if (d.type === 'box-select') {
    const x1 = Math.min(d.startX, e.clientX);
    const y1 = Math.min(d.startY, e.clientY);
    const w = Math.abs(e.clientX - d.startX);
    const h = Math.abs(e.clientY - d.startY);
    selBox.style.left = x1 + 'px';
    selBox.style.top = y1 + 'px';
    selBox.style.width = w + 'px';
    selBox.style.height = h + 'px';
    // Check intersection
    [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])].forEach(item => {
      const r = item.el.getBoundingClientRect();
      if (r.left < x1 + w && r.right > x1 && r.top < y1 + h && r.bottom > y1) {
        state.selected.add(item.id);
      } else if (!e.shiftKey) {
        state.selected.delete(item.id);
      }
    });
    refreshSelection();
    return;
  }
});

// MOUSEUP
document.addEventListener('mouseup', e => {
  // Belt-and-suspenders: see MOUSEMOVE guard above for rationale.
  // Desktop (IS_TOUCH_DEVICE === false) behavior is completely untouched.
  if (IS_TOUCH_DEVICE) return;

  // Clear any stale G.potentialTextDrag state (no longer used for editing text items,
  // but kept as a safety net in case some code path sets it)
  if (G.potentialTextDrag && !G.potentialTextDrag.triggered) {
    G.potentialTextDrag = null;
  }
  if (state.dragging) {
    // Reframe drag end — keep mode active, just end the drag
    if (state.dragging.type === 'reframe') {
      state.dragging = null;
      document.body.classList.remove('is-dragging');
      return;
    }
    // Crop drag end — keep crop mode active, just end the drag
    if (state.dragging.type === 'crop-move' || state.dragging.type === 'crop-resize') {
      state.dragging = null;
      document.body.classList.remove('is-dragging');
      return;
    }
    if (state.dragging.type === 'move') {
      // Cancel any pending rAF — final sync run synchronously below
      if (state.dragging._moveRafId) { cancelAnimationFrame(state.dragging._moveRafId); state.dragging._moveRafId = null; }
      // Run one final full updateItemStyle on moved items to sync filter/overlay/mask
      // (the lightweight path during drag skipped these GPU-expensive updates)
      const moved = state.dragging._toMoveCache || new Set(getSelectedItems());
      moved.forEach(item => { if (item.el) updateItemStyle(item); });
      // Clean up _orig for all moved items (including group members)
      const allItems = [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])];
      state.groups.forEach(g => g.memberIds.forEach(mid => {
        const m = allItems.find(i => i.id === mid);
        if (m) { delete m._origX; delete m._origY; delete m._origPoints; }
      }));
      getSelectedItems().forEach(i => { delete i._origX; delete i._origY; delete i._origPoints; });
    }
    if (state.dragging.type === 'resize') {
      // Cancel any pending rAF to prevent stale writes after mouseup
      if (state.dragging._rafId) { cancelAnimationFrame(state.dragging._rafId); state.dragging._rafId = null; }
      const item = state.dragging.item;
      // Run one final full updateItemStyle to apply any state we skipped (e.g. todo zoom var, opacity)
      updateItemStyle(item);
      // Same for group members
      if (state.dragging._group && state.dragging._members.length) {
        state.dragging._members.forEach(m => updateItemStyle(m));
      }
      // Round 41 — clean up multi-select snap state. We don't keep
      // _msOrigX/Y/W/H on the items permanently; the geometry is now
      // canonical in item.x/y/w/h. The snap data lives in state.dragging
      // and goes away with it (state.dragging = null at end of this
      // block). We DO want every snap'd item to get a final full
      // updateItemStyle so filter/overlay/mask (skipped during the
      // lightweight fast-path) are applied, and text auto-grow respects
      // the new width.
      if (state.dragging._multi) {
        state.dragging._multi.snaps.forEach(sn => {
          if (sn.item && sn.item !== item) {
            try { updateItemStyle(sn.item); } catch (_e41) {}
          }
        });
      }
      // ── Round 66/67: draw item scale sync (with normalized bbox mapping) ──
      // When a draw item is resized, scale its stroke points so the
      // visible drawing stays aligned with the item's bounding box.
      //
      // Round 67: the previous pivot-based transform (`scale around
      // the bbox center`) was correct only for UNIFORM scaling. For
      // a free-aspect corner drag the bbox center moves to a new
      // position, but the stroke was still scaled around the OLD
      // center — so the stroke "flew away" to a position that no
      // longer matched the new bbox. The user reported this as
      // "the drawing will fly away when I scale it".
      //
      // The fix: use a normalized bbox mapping. For each stroke
      // point P, compute its (u, v) position within the ORIGINAL
      // bbox (u = 0 at the left edge, u = 1 at the right edge, same
      // for v vertically), then place the new point at the same
      // (u, v) within the NEW bbox. This works for ANY resize
      // direction because it's the literal definition of "this
      // part of the stroke stays at this part of the box" — same
      // transformation that the DOM element itself undergoes, so
      // the stroke is guaranteed to be co-located with the box
      // regardless of how the user dragged the handle.
      //
      //   For a uniform scale (sx === sy), this is equivalent to
      //   "scale around the bbox center" — uniform-scale behavior
      //   is preserved.
      //
      //   For a free corner drag (sx !== sy, anchor at the opposite
      //   corner), the stroke anchors at the opposite corner too,
      //   just like the box itself. No more flying away.
      const _syncDrawScale = function(drawItem, origX, origY, origW, origH,
                                                   newX,  newY,  newW,  newH) {
        if (!drawItem || drawItem.type !== 'draw' || !drawItem.strokeId) return;
        if (!origW || !origH) return;
        if (Math.abs(newW - origW) < 0.5 && Math.abs(newH - origH) < 0.5
            && Math.abs(newX - origX) < 0.5 && Math.abs(newY - origY) < 0.5) return;
        var stroke = findStrokeById(drawItem.strokeId);
        if (!stroke) return;
        var sx = newW / origW;
        var sy = newH / origH;
        var dx = newX - origX * sx;
        var dy = newY - origY * sy;
        stroke.points = stroke.points.map(function(p) {
          return [p[0] * sx + dx, p[1] * sy + dy];
        });
      };
      {
        var d = state.dragging;
        if (d._multi) {
          var mm = d._multi;
          mm.snaps.forEach(function(sn) {
            _syncDrawScale(sn.item, sn.x, sn.y, sn.w, sn.h,
                                    sn.item.x, sn.item.y, sn.item.w, sn.item.h);
          });
        } else if (d._group && d._members && d._members.length) {
          // Group members share the same pivot (group origin) and scale,
          // but each member has its OWN original bbox that we cached on
          // mousedown (member._origX/Y/W/H). Scale each one independently
          // so the stroke maps to its own new bbox.
          _syncDrawScale(item, d.origX, d.origY, d.origW, d.origH,
                                  item.x,  item.y,  item.w,  item.h);
          d._members.forEach(function(m) {
            var mox = (m._origX !== undefined) ? m._origX : m.x;
            var moy = (m._origY !== undefined) ? m._origY : m.y;
            var mow = (m._origW !== undefined) ? m._origW : m.w;
            var moh = (m._origH !== undefined) ? m._origH : m.h;
            _syncDrawScale(m, mox, moy, mow, moh,
                                m.x,  m.y,  m.w,  m.h);
          });
        } else {
          _syncDrawScale(item, d.origX, d.origY, d.origW, d.origH,
                                  item.x,  item.y,  item.w,  item.h);
        }
        redrawDrawLayer();
      }
      // Clean up _orig for group members
      const group = getGroupForItem(item.id);
      if (group) {
        const allItems = [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])];
        group.memberIds.forEach(mid => {
          const m = allItems.find(i => i.id === mid);
          if (m) { delete m._origX; delete m._origY; delete m._origW; delete m._origH; }
        });
      }
      delete item._origW; delete item._origH;
      // Update connectors after mind map resize
      if (item.el && item.el.classList.contains('mindmap-item')) {
        requestAnimationFrame(() => mmUpdateConnectors(item));
      }
    }
    if (state.dragging.type === 'pan') viewport.classList.remove('grabbing');
    if (state.dragging.type === 'box-select') {
      selBox.style.display = 'none';
      if (state.selected.size === 0) updatePropsPanel();
    }
    // Re-add handles that were physically removed from DOM at drag start
    const wasItemDrag = state.dragging.type === 'move' || state.dragging.type === 'resize' || state.dragging.type === 'rotate';
    // Sync filter/overlay/mask (skipped during lightweight drag) — one final full pass
    if (state.dragging.type === 'rotate' && state.dragging.item) {
      updateItemStyle(state.dragging.item);
    }
    document.body.classList.remove('is-dragging');
    state.dragging = null;
    if (wasItemDrag) { refreshSelection(); updateAutoFitPaper(); }
  }

  // FREE CUT DRAW END
  if (window.cutState && window.cutState.isDragging) {
    endCutDraw();
  }

  // DRAW END
  if (G.currentStroke) {
    const stroke = G.currentStroke;
    G.currentStroke = null;
    // Convert completed stroke into a draw item (selectable, groupable, deletable)
    if (stroke.points.length >= 2 && stroke.mode !== 'eraser') {
      createDrawItem(stroke);
    }
    // R79: push an undo snapshot so undo walks back ONE stroke at a
    // time. Previously mouseup of a draw stroke didn't push — undo
    // reverted to the pre-stroke state and removed the stroke AND
    // any text/items the user had added since, which the user
    // reported as "撤一次清晒所有嘢". Pushing here gives proper
    // per-stroke undo granularity.
    try { pushUndo(); } catch (e) {}
    scheduleAutoSave();
    // R79: if "lock to player" is on, stay in draw mode so the user
    // can immediately start the next stroke. Otherwise the default
    // behaviour is to drop back to select on stroke end (handled by
    // the existing tool-state machine; the lock toggle is the only
    // opt-in to "continuous draw" here).
  }

  // DRAW STROKE MOVE END
  if (G.drawMoveState) {
    G.drawMoveState = null;
    G.hoveredStroke = null;
    viewport.style.cursor = 'crosshair';
    redrawDrawLayer();
    scheduleAutoSave();
  }

  // EXPORT END
  if (G.exportDrag) { finishExport(e); }

  // CAPTURE END
  if (G.captureDrag) { finishCapture(e); }
});
