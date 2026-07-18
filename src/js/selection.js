
import { state, canvasContent } from './core-state.js';
import { removeBrushCanvas } from './masking.js';
import { updatePropsPanel } from './props-panel.js';
import { updateStatus } from './canvas-view.js';
import { updateTextColorPalette } from './text-style.js';

export function getSelectedItems() {
  return [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])].filter(i => state.selected.has(i.id));
}
export function getSelectedImages() {
  return state.items.filter(i => state.selected.has(i.id));
}

// ============================================================
//  SELECTION
// ============================================================
export function selectOnly(id) {
  state.selected.clear();
  state.selected.add(id);
  refreshSelection();
  updateTextColorPalette();
}
export function clearSelection() {
  state.selected.clear();
  refreshSelection();
  updateTextColorPalette();
}
export function toggleSelect(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  refreshSelection();
  updateTextColorPalette();
}
export function refreshSelection() {
  document.querySelectorAll('.item, .text-item, .todo-item, .draw-item').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.item-handle, .item-rot').forEach(el => el.remove());
  // Round 67 — also wipe the empty union multi-select container left
  // behind after the 8 child handles were just removed. The container
  // is empty (no styles, no children) but we drop it anyway to keep
  // the DOM tidy across long sessions of reselecting.
  document.querySelectorAll('.multi-sel-handles').forEach(el => el.remove());
  document.querySelectorAll('.text-handles').forEach(el => el.remove());
  // Don't add handles during reframe mode
  if (state.reframing) return;
  // Clean up mask editing if selected item changed
  const sel = getSelectedItems();
  if (sel.length !== 1 || !sel[0].masks || !sel[0].masks.find(m => m.id === window.activeMaskId)) {
    if (window.maskBrushActive) { window.maskBrushActive = false; removeBrushCanvas(); }
    if (window.maskPickColorActive) { window.maskPickColorActive = false; document.getElementById('viewport').classList.remove('mask-pick-mode'); }
    window.activeMaskId = null;
  }
  // Round 67 — MULTI-SELECT UNION HANDLES: when 2+ items are selected,
  // skip the per-item addHandles() loop and add ONE set of 8 resize
  // handles at the corners of the union bounding box (Figma / Sketch
  // behavior). Previously every item got its own 8 handles, scattering
  // them around the canvas and looking like "scale points outside the
  // selection box". The existing Round-41 multi-select scale path
  // (in the mousedown handler) still kicks in because dataset.id points
  // at a selected item and state.selected.size > 1.
  if (sel.length >= 2) {
    // Mark every selected item visually (blue outline etc.) but skip the
    // per-item handle children. The 8 union handles do the resize job.
    sel.forEach(item => item.el.classList.add('selected'));
    addMultiSelectHandles(sel);
  } else {
    sel.forEach(item => {
      item.el.classList.add('selected');
      // v5.5.1: lazy-load video when selected (preload="none" saves memory)
      if (item.video && item.video.preload === 'none') {
        item.video.preload = 'auto';
        item.video.load();
      }
      if (item.img) addHandles(item);
      else if (item.type === 'draw') addHandles(item);
      else if (item.video) {
        // Round 57: video items need the SAME 8 resize handles + 1 rotation
        // handle as images. Previously the code fell through to addTextHandles
        // which expects tx.x/y/w/h (text properties) — videos don't have
        // those, so the .text-handles container got NaN dimensions and the
        // 6 handles clustered at the top-left of the canvas, looking like
        // "many random scale dots" on selection. addHandles reads item.el
        // only, so it works for any element-based item type.
        addHandles(item);
      } else if (item.audio) {
        // Audio items also need standard resize handles (their .item is
        // a flex column with no text/text-handle semantics).
        addHandles(item);
      } else if (item.el && item.el.classList.contains('todo-item')) {
        // Todo items: add resize handles for scaling
        addHandles(item);
      } else if (item.el && item.el.classList.contains('mindmap-item')) {
        // Mind map items: add resize handles for manual scaling
        addHandles(item);
      } else if (item.isLink) {
        // Link cards: also need standard resize handles
        addHandles(item);
      } else addTextHandles(item); // Text items get resize handles too
    });
  }
  // Round 58: playhead-position label visibility is a multi-source OR:
  //   - selected (this refreshSelection pass found it in `sel`)
  //   - actively playing
  //   - mid-drag (toggle handled in the mousedown/mouseup handler)
  // Iterate ALL video items and reconcile, so the previously-selected
  // video's label hides on deselect and the new one shows. Cheaper
  // than a per-item hook.
  document.querySelectorAll('.item.has-media .media-playhead-label').forEach(lbl => {
    var itemEl = lbl.closest('.item');
    if (!itemEl) return;
    var isSelected = itemEl.classList.contains('selected');
    var media = itemEl.querySelector('video, audio');
    var isPlaying = media && !media.paused && !media.ended;
    if (isSelected || isPlaying) {
      lbl.classList.add('show');
      lbl._forceVisible = true;
    } else {
      lbl.classList.remove('show');
      lbl._forceVisible = false;
    }
  });
  updatePropsPanel();
  updateStatus();
}
export function addHandles(item) {
  const handles = [
    { cls: 'nw', dir: 'nw' }, { cls: 'ne', dir: 'ne' },
    { cls: 'sw', dir: 'sw' }, { cls: 'se', dir: 'se' },
    { cls: 'n', dir: 'n' }, { cls: 's', dir: 's' },
    { cls: 'e', dir: 'e' }, { cls: 'w', dir: 'w' },
  ];
  handles.forEach(h => {
    const el = document.createElement('div');
    el.className = `item-handle ${h.cls}`;
    el.dataset.dir = h.dir;
    el.dataset.id = item.id;
    item.el.appendChild(el);
  });
  if (!item.locked) {
    const rot = document.createElement('div');
    rot.className = 'item-rot';
    rot.dataset.id = item.id;
    item.el.appendChild(rot);
  }
}

// Round 67 — MULTI-SELECT UNION HANDLES.
// When 2+ items are selected, instead of adding 8 scale handles + 1 rotation
// handle on EACH item (which puts handles scattered around every individual
// item — looking like "scale points outside the [logical] selection box"),
// we draw a SINGLE set of 8 resize handles at the corners of the union
// axis-aligned bounding box. This matches Figma / Sketch / Photoshop behavior
// and is what the user expects when they select multiple things.
//
// The container is appended to canvasContent (the same parent as items),
// so it inherits the canvas pan/zoom transform and the items inside it are
// positioned in world coords. dataset.id points at the first non-locked
// selected item so the existing mousedown handler can find it; the existing
// multi-select scale path (Round 41) then takes over.
export function addMultiSelectHandles(sel) {
  // Union AABB in world coords
  let mx = Infinity, my = Infinity, mx2 = -Infinity, my2 = -Infinity;
  for (const s of sel) {
    if (s.x < mx) mx = s.x;
    if (s.y < my) my = s.y;
    if (s.x + s.w > mx2) mx2 = s.x + s.w;
    if (s.y + s.h > my2) my2 = s.y + s.h;
  }
  const bw = mx2 - mx;
  const bh = my2 - my;
  // Pick the first non-locked item as the handle "owner" so the mousedown
  // handler finds a resizable item (the existing multi-select path then
  // scales every selected item together around the union bbox pivot).
  const owner = sel.find(s => !s.locked) || sel[0];
  // Highest z so the handles sit on top of every selected item
  let maxZ = 0;
  for (const s of sel) { if ((s.z || 1) > maxZ) maxZ = s.z || 1; }
  const cont = document.createElement('div');
  cont.className = 'multi-sel-handles';
  // Position in world coords. The .item-handle CSS already positions each
  // handle at the corners of its parent (top: -8px; left: -8px; etc), so
  // the handle dots sit 8px OUTSIDE the bbox corners — exactly like the
  // per-item handles, but at the union of all selected items.
  cont.style.position = 'absolute';
  cont.style.left = '0px';
  cont.style.top = '0px';
  cont.style.width = bw + 'px';
  cont.style.height = bh + 'px';
  cont.style.transform = `translate3d(${mx}px, ${my}px, 0)`;
  cont.style.transformOrigin = '0 0';
  cont.style.zIndex = (maxZ + 1) + '';
  cont.style.pointerEvents = 'none'; // container is click-through; children re-enable
  cont.dataset.ownerId = owner.id;
  // 8 resize handles. dataset.id = owner.id so the mousedown handler in the
  // SELECT TOOL branch can find the item and enter the Round-41 multi-select
  // scale path (which scales every selected item together around the union
  // bbox pivot). The same path triggers on ANY handle, so we don't need to
  // change the resize logic at all.
  const dirs = ['nw','ne','sw','se','n','s','e','w'];
  for (const d of dirs) {
    const el = document.createElement('div');
    el.className = 'item-handle ' + d + ' multi-handle';
    el.dataset.dir = d;
    el.dataset.id = owner.id;
    el.style.pointerEvents = 'auto';
    cont.appendChild(el);
  }
  canvasContent.appendChild(cont);
}

// Text items get corner + edge handles for resizing
// Handles go in a SIBLING container (.text-handles), NOT inside the contentEditable div
export function addTextHandles(tx) {
  const handles = [
    { cls: 'nw', dir: 'nw' }, { cls: 'ne', dir: 'ne' },
    { cls: 'sw', dir: 'sw' }, { cls: 'se', dir: 'se' },
    { cls: 'e', dir: 'e' }, { cls: 'w', dir: 'w' },
  ];
  // Find or create the handle container (sibling of text-item)
  let hCont = tx.el.parentElement.querySelector('.text-handles[data-owner="' + tx.id + '"]');
  if (!hCont) {
    hCont = document.createElement('div');
    hCont.className = 'text-handles';
    hCont.dataset.owner = tx.id;
    tx.el.parentElement.appendChild(hCont);
  }
  // Round 54: tx.w/tx.h are on-screen. Divide by zoom so the handle
  // container's visual size (canvas scales by zoom) matches the text box.
  const _tz = Math.max(0.02, Math.min(10, state.zoom || 1));
  hCont.style.left = tx.x + 'px';
  hCont.style.top = tx.y + 'px';
  hCont.style.width = (tx.w / _tz) + 'px';
  hCont.style.height = (tx.h / _tz) + 'px';
  hCont.style.zIndex = tx.z || 1;
  handles.forEach(h => {
    const el = document.createElement('div');
    el.className = `item-handle ${h.cls}`;
    el.dataset.dir = h.dir;
    el.dataset.id = tx.id;
    el.dataset.textHandle = '1';
    hCont.appendChild(el);
  });
}

// ── v5.5.1: hover-based video lazy load ──────────────────────
// When the mouse hovers over a video that hasn't been loaded yet
// (preload="none"), trigger load so the user sees a thumbnail.
var _videoLazyLoadObserver = null;
export function initVideoLazyLoad() {
  if (_videoLazyLoadObserver) return;
  var hoveredVideo = null;
  document.addEventListener('mousemove', function(e) {
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    var itemEl = el.closest('.item.has-media');
    if (!itemEl) {
      if (hoveredVideo) { hoveredVideo = null; }
      return;
    }
    // Avoid re-checking the same element every mousemove tick
    if (itemEl === hoveredVideo) return;
    hoveredVideo = itemEl;
    // Find the video element inside
    var vid = itemEl.querySelector('video');
    if (vid && vid.preload === 'none') {
      vid.preload = 'auto';
      vid.load();
    }
  }, { passive: true });
}
