import { getSelectedItems, refreshSelection } from './selection.js';
import { state, canvasContent } from './core-state.js';
import { scheduleAutoSave } from './save-load.js';
import { toast } from './ui-utils.js';
import { scheduleAutoSave } from './save-load.js';
import { toast } from './ui-utils.js';
import { updateItemStyle } from './add-items.js';
import { pushUndo } from './undo-redo.js';

// ============================================================
//  REFRAME — reposition image within its frame (crop)
// ============================================================
export function enterReframe(item) {
  if (!item || !item.src || item.isVideo) return;
  // Exit any existing reframe first
  if (state.reframing) exitReframe(false);
  pushUndo();
  state.reframing = {
    item,
    origCropX: item.cropX || 0,
    origCropY: item.cropY || 0,
    dragStartX: 0,
    dragStartY: 0,
    dragCropX: 0,
    dragCropY: 0,
  };
  const el = item.el;
  el.classList.add('reframing');
  // Position img at its natural size within the container
  const imgEl = item.img;
  if (imgEl) {
    imgEl.style.width = item.natW + 'px';
    imgEl.style.height = 'auto';
    imgEl.style.transform = 'translate(' + (-(item.cropX || 0)) + 'px, ' + (-(item.cropY || 0)) + 'px)';
  }
  // Remove selection handles during reframe
  document.querySelectorAll('.item-handle, .item-rot').forEach(el => el.remove());
      // Round 67 — also wipe the empty union multi-select container left
      // behind after the 8 child handles were just removed. The container
      // is empty (no styles, no children) but we drop it anyway to keep
      // the DOM tidy across long sessions of reselecting.
      document.querySelectorAll('.multi-sel-handles').forEach(el => el.remove());
  toast('Drag to reframe — Enter to apply, Esc to cancel');
}

export function exitReframe(apply) {
  if (!state.reframing) return;
  const { item, origCropX, origCropY } = state.reframing;
  state.reframing = null;
  const el = item.el;
  el.classList.remove('reframing');
  const imgEl = item.img;
  if (!apply) {
    // Revert to original crop
    item.cropX = origCropX;
    item.cropY = origCropY;
  }
  if (imgEl) {
    // Restore normal display: fill the frame with the crop offset
    imgEl.style.width = '100%';
    imgEl.style.height = '100%';
    imgEl.style.transform = '';
    // Use object-fit to show the cropped area filling the frame
    imgEl.style.objectFit = 'cover';
    imgEl.style.objectPosition = (-(item.cropX || 0)) + 'px ' + (-(item.cropY || 0)) + 'px';
  }
  updateItemStyle(item);
  refreshSelection();
  scheduleAutoSave();
  toast(apply ? 'Reframe applied' : 'Reframe cancelled');
}

// ============================================================
//  CROP IMAGE — Photoshop-style crop box with handles
// ============================================================
// state.cropping: { item, x, y, w, h, aspect, origSrc, origNatW, origNatH,
//                    origW, origH, origCropX, origCropY, els:{...} }
// x,y,w,h are in DISPLAY pixels relative to the image element (0..item.w, 0..item.h)

export function enterCrop(item) {
  if (!item || !item.src || item.isVideo || item.isAudio) {
    toast('Select a static image to crop');
    return;
  }
  // Exit any existing crop first
  if (state.cropping) exitCrop(false);
  if (state.reframing) exitReframe(true);

  const el = item.el;
  const imgW = item.w, imgH = item.h;
  // Default crop window: 80% of image, centered
  const defW = imgW * 0.8;
  const defH = imgH * 0.8;
  const defX = (imgW - defW) / 2;
  const defY = (imgH - defH) / 2;

  state.cropping = {
    item,
    x: defX, y: defY, w: defW, h: defH,
    aspect: null,
    origSrc: item.src,
    origNatW: item.natW,
    origNatH: item.natH,
    origW: item.w,
    origH: item.h,
    origCropX: item.cropX || 0,
    origCropY: item.cropY || 0,
    els: {},
  };

  el.classList.add('cropping');
  // Build overlay
  const overlay = document.createElement('div');
  overlay.className = 'crop-overlay';

  // 4 mask divs (positioned around the crop window)
  const mTop = document.createElement('div');
  const mBot = document.createElement('div');
  const mL = document.createElement('div');
  const mR = document.createElement('div');
  mTop.className = 'crop-mask mask-top';
  mBot.className = 'crop-mask mask-bottom';
  mL.className = 'crop-mask mask-left';
  mR.className = 'crop-mask mask-right';

  // Crop window (drag to move)
  const win = document.createElement('div');
  win.className = 'crop-window';
  const winInner = document.createElement('div');
  winInner.className = 'crop-window-inner';
  win.appendChild(winInner);

  // Rule-of-thirds
  const rh1 = document.createElement('div'); rh1.className = 'crop-rule-h';
  const rh2 = document.createElement('div'); rh2.className = 'crop-rule-h';
  const rv1 = document.createElement('div'); rv1.className = 'crop-rule-v';
  const rv2 = document.createElement('div'); rv2.className = 'crop-rule-v';

  // 8 handles
  const handles = {};
  ['nw','n','ne','e','se','s','sw','w'].forEach(name => {
    const h = document.createElement('div');
    h.className = 'crop-handle ' + (name.length === 2 ? 'corner' : 'edge') + ' ' + name;
    h.dataset.handle = name;
    handles[name] = h;
    win.appendChild(h);
  });

  // Toolbar with aspect ratio + Apply + Cancel
  const toolbar = document.createElement('div');
  toolbar.className = 'crop-toolbar';
  toolbar.innerHTML =
    '<select data-role="aspect" title="Aspect ratio">' +
    '<option value="free">Free</option>' +
    '<option value="1:1">1:1</option>' +
    '<option value="4:3">4:3</option>' +
    '<option value="3:2">3:2</option>' +
    '<option value="16:9">16:9</option>' +
    '<option value="2:3">2:3</option>' +
    '<option value="9:16">9:16</option>' +
    '</select>' +
    '<div class="sep"></div>' +
    '<button data-role="reset" title="Reset crop box">Reset</button>' +
    '<button data-role="full" title="Select full image">Full</button>' +
    '<div class="sep"></div>' +
    '<button data-role="cancel" title="Cancel (Esc)">Cancel</button>' +
    '<button data-role="apply" class="primary" title="Apply (Enter)">Apply</button>';

  overlay.appendChild(mTop); overlay.appendChild(mBot); overlay.appendChild(mL); overlay.appendChild(mR);
  overlay.appendChild(win);
  win.appendChild(rh1); win.appendChild(rh2); win.appendChild(rv1); win.appendChild(rv2);
  el.appendChild(overlay);
  el.appendChild(toolbar);
  state.cropping.els = { overlay, win, mTop, mBot, mL, mR, toolbar, handles, rh1, rh2, rv1, rv2 };

  // Position masks/window/handles
  positionCropUI();

  // Crop window: drag to move
  win.addEventListener('mousedown', e => {
    if (e.target.classList.contains('crop-handle')) return; // let handle handle
    e.stopPropagation(); e.preventDefault();
    state.dragging = {
      type: 'crop-move',
      startX: e.clientX, startY: e.clientY,
      origX: state.cropping.x, origY: state.cropping.y,
      imgW, imgH,
    };
    document.body.classList.add('is-dragging');
  });
  // Handle: drag to resize
  Object.values(handles).forEach(h => {
    h.addEventListener('mousedown', e => {
      e.stopPropagation(); e.preventDefault();
      state.dragging = {
        type: 'crop-resize',
        handle: h.dataset.handle,
        startX: e.clientX, startY: e.clientY,
        origX: state.cropping.x, origY: state.cropping.y,
        origW: state.cropping.w, origH: state.cropping.h,
        imgW, imgH,
      };
      document.body.classList.add('is-dragging');
    });
  });

  // Toolbar events
  toolbar.querySelector('[data-role="aspect"]').addEventListener('change', e => {
    const v = e.target.value;
    setCropAspect(v === 'free' ? null : v);
  });
  toolbar.querySelector('[data-role="reset"]').addEventListener('click', e => {
    e.stopPropagation();
    state.cropping.x = (imgW - defW) / 2;
    state.cropping.y = (imgH - defH) / 2;
    state.cropping.w = defW;
    state.cropping.h = defH;
    positionCropUI();
  });
  toolbar.querySelector('[data-role="full"]').addEventListener('click', e => {
    e.stopPropagation();
    state.cropping.x = 0; state.cropping.y = 0;
    state.cropping.w = imgW; state.cropping.h = imgH;
    positionCropUI();
  });
  toolbar.querySelector('[data-role="apply"]').addEventListener('click', e => {
    e.stopPropagation(); applyCrop();
  });
  toolbar.querySelector('[data-role="cancel"]').addEventListener('click', e => {
    e.stopPropagation(); exitCrop(false);
  });

  // Block all clicks/pointer events inside the overlay from reaching the canvas
  overlay.addEventListener('click', e => e.stopPropagation());
  overlay.addEventListener('mousedown', e => e.stopPropagation());
  overlay.addEventListener('dblclick', e => e.stopPropagation());
  toolbar.addEventListener('mousedown', e => e.stopPropagation());

  // Remove selection handles during crop
  document.querySelectorAll('.item-handle, .item-rot').forEach(el => el.remove());
      // Round 67 — also wipe the empty union multi-select container left
      // behind after the 8 child handles were just removed. The container
      // is empty (no styles, no children) but we drop it anyway to keep
      // the DOM tidy across long sessions of reselecting.
      document.querySelectorAll('.multi-sel-handles').forEach(el => el.remove());
  toast('Crop: drag to move, drag handles to resize. Enter to apply, Esc to cancel');
  // Bring item to front
  item.z = ++G.nextZ;
  el.style.zIndex = item.z;
}

export function setCropAspect(v) {
  if (!state.cropping) return;
  state.cropping.aspect = v;
  // Snap to current center if a ratio is set
  if (v) {
    const c = state.cropping;
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    let newH = c.w / v;
    let newW = c.w;
    const maxW = c.imgW || c.item.w;
    const maxH = c.imgH || c.item.h;
    if (newH > maxH) { newH = maxH; newW = newH * v; }
    if (newW > maxW) { newW = maxW; newH = newW / v; }
    c.w = newW; c.h = newH;
    c.x = Math.max(0, Math.min(maxW - newW, cx - newW / 2));
    c.y = Math.max(0, Math.min(maxH - newH, cy - newH / 2));
    positionCropUI();
  }
}

export function positionCropUI() {
  const c = state.cropping;
  if (!c || !c.els.win) return;
  const { x, y, w, h, els, item } = c;
  // image is positioned at 0,0 within .item (image is 100% of .item)
  els.win.style.left = x + 'px';
  els.win.style.top = y + 'px';
  els.win.style.width = w + 'px';
  els.win.style.height = h + 'px';
  // 4 masks
  els.mTop.style.left = '0';     els.mTop.style.top = '0';
  els.mTop.style.width = item.w + 'px'; els.mTop.style.height = y + 'px';
  els.mBot.style.left = '0';     els.mBot.style.top = (y + h) + 'px';
  els.mBot.style.width = item.w + 'px'; els.mBot.style.height = (item.h - y - h) + 'px';
  els.mL.style.left = '0';       els.mL.style.top = y + 'px';
  els.mL.style.width = x + 'px'; els.mL.style.height = h + 'px';
  els.mR.style.left = (x + w) + 'px'; els.mR.style.top = y + 'px';
  els.mR.style.width = (item.w - x - w) + 'px'; els.mR.style.height = h + 'px';
  // Rule of thirds
  els.rh1.style.top = (h / 3) + 'px';
  els.rh2.style.top = (h * 2 / 3) + 'px';
  els.rv1.style.left = (w / 3) + 'px';
  els.rv2.style.left = (w * 2 / 3) + 'px';
  // Toolbar position: prefer below; flip above if it would overflow
  const tb = els.toolbar;
  tb.classList.remove('below', 'above');
  if (y + h + 50 < item.h) {
    tb.classList.add('below');
    tb.style.top = (y + h + 6) + 'px';
  } else {
    tb.classList.add('above');
    tb.style.top = Math.max(0, y - 44) + 'px';
  }
  tb.style.left = Math.max(0, Math.min(item.w - 200, x + w / 2 - 100)) + 'px';
}

export function exitCrop(restoreOriginal) {
  if (!state.cropping) return;
  const c = state.cropping;
  const { item, els, origSrc, origNatW, origNatH, origW, origH, origCropX, origCropY } = c;
  state.cropping = null;
  if (els.overlay && els.overlay.parentNode) els.overlay.parentNode.removeChild(els.overlay);
  if (els.toolbar && els.toolbar.parentNode) els.toolbar.parentNode.removeChild(els.toolbar);
  item.el.classList.remove('cropping');
  if (restoreOriginal) {
    item.src = origSrc;
    item.natW = origNatW; item.natH = origNatH;
    item.w = origW; item.h = origH;
    item.cropX = origCropX; item.cropY = origCropY;
    if (item.img) {
      item.img.src = origSrc;
      item.img.style.width = '100%'; item.img.style.height = '100%';
      item.img.style.transform = '';
      item.img.style.objectFit = '';
      item.img.style.objectPosition = '';
    }
    updateItemStyle(item);
    refreshSelection();
    scheduleAutoSave();
    toast('Crop cancelled');
  } else {
    // No-op exit (e.g. via Apply path which has already rebuilt the image)
    refreshSelection();
    scheduleAutoSave();
  }
}

export function applyCrop() {
  if (!state.cropping) return;
  const c = state.cropping;
  const item = c.item;
  // Convert display-pixel crop box to image natural-pixel crop box
  const ratioX = item.natW / item.w;
  const ratioY = item.natH / item.h;
  const sx = Math.max(0, Math.round(c.x * ratioX));
  const sy = Math.max(0, Math.round(c.y * ratioY));
  let sw = Math.max(1, Math.round(c.w * ratioX));
  let sh = Math.max(1, Math.round(c.h * ratioY));
  // Clamp to image bounds
  sw = Math.min(sw, item.natW - sx);
  sh = Math.min(sh, item.natH - sy);

  if (sw < 2 || sh < 2) { toast('Crop area too small'); return; }
  toast('Cropping…');

  const sourceSrc = item.src;
  const img = new Image();
  img.onload = function() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx2d = canvas.getContext('2d');
      ctx2d.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      // Preserve format: try to keep original mime, fallback png
      let mime = 'image/png';
      const m = (sourceSrc.match(/^data:([^;,]+)/) || [])[1];
      if (m && /^image\/(png|jpeg|webp)$/i.test(m)) mime = m;
      const quality = mime === 'image/jpeg' ? 0.92 : undefined;
      const newSrc = canvas.toDataURL(mime, quality);

      // Compute new display size: keep the same display width, recompute height
      const newAspect = sw / sh;
      const oldDispW = item.w;
      const newDispW = oldDispW;
      const newDispH = Math.max(20, Math.round(newDispW / newAspect));

      // Persist old for restore on cancel (we already passed orig values into state.cropping)
      const old = { src: item.src, natW: item.natW, natH: item.natH, w: item.w, h: item.h,
                    cropX: item.cropX || 0, cropY: item.cropY || 0 };
      item.src = newSrc;
      item.natW = sw; item.natH = sh;
      item.w = newDispW; item.h = newDispH;
      item.cropX = 0; item.cropY = 0;
      if (item.img) {
        item.img.src = newSrc;
        item.img.style.width = '100%'; item.img.style.height = '100%';
        item.img.style.transform = '';
        item.img.style.objectFit = '';
        item.img.style.objectPosition = '';
      }
      // Tear down crop UI
      if (state.cropping) {
        const crop = state.cropping;
        state.cropping = null;
        if (crop.els.overlay && crop.els.overlay.parentNode) crop.els.overlay.parentNode.removeChild(crop.els.overlay);
        if (crop.els.toolbar && crop.els.toolbar.parentNode) crop.els.toolbar.parentNode.removeChild(crop.els.toolbar);
        crop.item.el.classList.remove('cropping');
      }
      updateItemStyle(item);
      refreshSelection();
      scheduleAutoSave();
      toast('Image cropped to ' + sw + '×' + sh);
    } catch (err) {
      console.error('Crop failed', err);
      toast('Crop failed');
    }
  };
  img.onerror = function() { toast('Could not load image for cropping'); };
  img.src = sourceSrc;
}

