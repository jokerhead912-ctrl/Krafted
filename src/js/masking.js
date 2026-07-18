import { getSelectedImages, getSelectedItems } from './selection.js';
import { state, G } from './core-state.js';
import { pushUndo } from './undo-redo.js';
import { scheduleAutoSave } from './save-load.js';
import { toast } from './ui-utils.js';;

// ============================================================
//  MASK LAYERS — per-area adjustments via CSS mask-image
// ============================================================
let maskPickColorActive = false;
let maskBrushActive = false;
let activeMaskId = null;
let maskBrushCanvas = null;
let maskBrushCtx = null;
let maskBrushDrawing = false;
export let maskImageCache = {}; // cache for image pixel data
let maskCanvasCache = {}; // key: src|color|tol|feather -> canvas (downsampled, blurred)
let maskBlobUrls = {}; // key -> blob URL (for CSS mask-image)
let maskRenderRAF = null; // requestAnimationFrame ID for debounced renders
let brushMaskCache = {}; // key: maskId|feather -> feathered brush data URL
let maskShowOverlay = false; // when true, show red 50% overlay on mask areas
let maskWheelOpenId = null; // tracks which mask's color wheel is open

export function getSelectedImageItem() {
  const sel = getSelectedImages();
  return sel.length > 0 ? sel[0] : null;
}

export function addMaskLayer(type) {
  const item = getSelectedImageItem();
  if (!item) return;
  if (!item.src) { toast('Masks only work on images'); return; }
  pushUndo();
  if (!item.masks) item.masks = [];
  const id = 'mask_' + Date.now();
  const mask = {
    id, name: 'Mask ' + (item.masks.length + 1), enabled: true, type,
    color: '#ffffff', tolerance: 40, feather: 3, brushData: null, brushSize: 40,
    brightness: 100, contrast: 100, saturate: 100, temp: 0,
    shadow: 100, highlight: 100, hueRotate: 0, sepia: 0,
    tintColor: null, tintStrength: 50,
  };
  item.masks.push(mask);
  activeMaskId = id;
  updateMaskList();
  renderMasks(item);
  scheduleAutoSave();
  toast(type === 'color' ? 'Color mask added — pick a color' : 'Brush mask added — paint area');
}

export function deleteMaskLayer(maskId) {
  const item = getSelectedImageItem();
  if (!item || !item.masks) return;
  pushUndo();
  item.masks = item.masks.filter(m => m.id !== maskId);
  invalidateBrushMaskCache(maskId);
  if (activeMaskId === maskId) { activeMaskId = null; maskBrushActive = false; removeBrushCanvas(); }
  updateMaskList();
  renderMasks(item);
  scheduleAutoSave();
}

export function toggleMask(maskId, enabled) {
  const item = getSelectedImageItem();
  if (!item || !item.masks) return;
  const mask = item.masks.find(m => m.id === maskId);
  if (!mask) return;
  mask.enabled = enabled;
  renderMasks(item);
  scheduleAutoSave();
}

export function selectMask(maskId) {
  activeMaskId = (activeMaskId === maskId) ? null : maskId;
  if (activeMaskId !== maskId) maskWheelOpenId = null;
  updateMaskList();
}

export function setMaskFilter(maskId, prop, value) {
  const item = getSelectedImageItem();
  if (!item || !item.masks) return;
  const mask = item.masks.find(m => m.id === maskId);
  if (!mask) return;
  if (!mask._dragging) { pushUndo(); mask._dragging = true; }
  mask[prop] = +value;
  // Fast path: only update CSS filter on existing overlay, no mask regeneration
  renderMasks(item, true);
  // Update value display
  const valEl = document.getElementById('mk-' + maskId + '-' + prop + '-val');
  if (valEl) {
    if (prop === 'hueRotate') valEl.textContent = value + '\u00b0';
    else valEl.textContent = value;
  }
  clearTimeout(mask._timer);
  mask._timer = setTimeout(() => { mask._dragging = false; }, 300);
  scheduleAutoSave();
}

export function setMaskColor(maskId, color) {
  const item = getSelectedImageItem();
  if (!item || !item.masks) return;
  const mask = item.masks.find(m => m.id === maskId);
  if (!mask) return;
  pushUndo();
  mask.color = color;
  invalidateMaskCache(item.src);
  renderMasks(item);
  scheduleAutoSave();
}

export function setMaskTolerance(maskId, tol) {
  const item = getSelectedImageItem();
  if (!item || !item.masks) return;
  const mask = item.masks.find(m => m.id === maskId);
  if (!mask) return;
  mask.tolerance = +tol;
  const valEl = document.getElementById('mk-' + maskId + '-tol-val');
  if (valEl) valEl.textContent = tol;
  // Debounce mask regeneration (expensive operation)
  clearTimeout(mask._tolTimer);
  mask._tolTimer = setTimeout(() => {
    pushUndo();
    invalidateMaskCache(item.src);
    renderMasks(item);
    scheduleAutoSave();
  }, 150);
}

export function setMaskFeather(maskId, feather) {
  const item = getSelectedImageItem();
  if (!item || !item.masks) return;
  const mask = item.masks.find(m => m.id === maskId);
  if (!mask) return;
  mask.feather = +feather;
  const valEl = document.getElementById('mk-' + maskId + '-feather-val');
  if (valEl) valEl.textContent = feather;
  // Clear caches so new feather value takes effect
  invalidateBrushMaskCache(maskId);
  clearTimeout(mask._featherTimer);
  mask._featherTimer = setTimeout(() => {
    pushUndo();
    invalidateMaskCache(item.src);
    renderMasks(item);
    scheduleAutoSave();
  }, 150);
}

export function setMaskBrushSize(maskId, size) {
  const item = getSelectedImageItem();
  if (!item || !item.masks) return;
  const mask = item.masks.find(m => m.id === maskId);
  if (!mask) return;
  mask.brushSize = +size;
  const valEl = document.getElementById('mk-' + maskId + '-bs-val');
  if (valEl) valEl.textContent = size;
  scheduleAutoSave();
}

export function togglePickColor(maskId) {
  if (maskPickColorActive && activeMaskId === maskId) {
    maskPickColorActive = false;
    document.getElementById('viewport').classList.remove('mask-pick-mode');
  } else {
    maskPickColorActive = true;
    activeMaskId = maskId;
    maskBrushActive = false;
    removeBrushCanvas();
    document.getElementById('viewport').classList.add('mask-pick-mode');
    toast('Click on the image to pick a color');
  }
  updateMaskList();
}

export function toggleBrushMode(maskId) {
  const item = getSelectedImageItem();
  if (!item || !item.masks) return;
  const mask = item.masks.find(m => m.id === maskId);
  if (!mask) return;
  if (maskBrushActive && activeMaskId === maskId) {
    maskBrushActive = false;
    removeBrushCanvas();
    // Save brush data
    if (maskBrushCanvas) {
      mask.brushData = maskBrushCanvas.toDataURL();
      invalidateBrushMaskCache(maskId);
      renderMasks(item);
      scheduleAutoSave();
    }
  } else {
    maskBrushActive = true;
    activeMaskId = maskId;
    maskPickColorActive = false;
    document.getElementById('viewport').classList.remove('mask-pick-mode');
    showBrushCanvas(item, mask);
    toast('Paint on the image to create mask');
  }
  updateMaskList();
}

export function clearBrushMask(maskId) {
  const item = getSelectedImageItem();
  if (!item || !item.masks) return;
  const mask = item.masks.find(m => m.id === maskId);
  if (!mask) return;
  pushUndo();
  mask.brushData = null;
  invalidateBrushMaskCache(maskId);
  if (maskBrushCtx && maskBrushCanvas) {
    maskBrushCtx.clearRect(0, 0, maskBrushCanvas.width, maskBrushCanvas.height);
  }
  renderMasks(item);
  scheduleAutoSave();
  toast('Brush mask cleared');
}

export function showBrushCanvas(item, mask) {
  removeBrushCanvas();
  const rect = item.el.getBoundingClientRect();
  maskBrushCanvas = document.createElement('canvas');
  maskBrushCanvas.className = 'mask-brush-overlay';
  maskBrushCanvas.width = Math.round(rect.width);
  maskBrushCanvas.height = Math.round(rect.height);
  maskBrushCanvas.style.cssText = 'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;pointer-events:auto;cursor:crosshair;z-index:9999998;opacity:0.5;';
  document.body.appendChild(maskBrushCanvas);
  maskBrushCtx = maskBrushCanvas.getContext('2d');
  // Load existing brush data
  if (mask.brushData) {
    const img = new Image();
    img.onload = () => { maskBrushCtx.drawImage(img, 0, 0, maskBrushCanvas.width, maskBrushCanvas.height); };
    img.src = mask.brushData;
  }
  // Drawing events
  let lastX = 0, lastY = 0;
  maskBrushCanvas.addEventListener('mousedown', (e) => {
    maskBrushDrawing = true;
    const r = maskBrushCanvas.getBoundingClientRect();
    lastX = (e.clientX - r.left) / r.width * maskBrushCanvas.width;
    lastY = (e.clientY - r.top) / r.height * maskBrushCanvas.height;
    maskBrushCtx.beginPath();
    maskBrushCtx.arc(lastX, lastY, mask.brushSize / 2, 0, Math.PI * 2);
    maskBrushCtx.fillStyle = '#ff0000';
    maskBrushCtx.fill();
  });
  maskBrushCanvas.addEventListener('mousemove', (e) => {
    if (!maskBrushDrawing) return;
    const r = maskBrushCanvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * maskBrushCanvas.width;
    const y = (e.clientY - r.top) / r.height * maskBrushCanvas.height;
    maskBrushCtx.lineWidth = mask.brushSize;
    maskBrushCtx.strokeStyle = '#ff0000';
    maskBrushCtx.lineCap = 'round';
    maskBrushCtx.lineJoin = 'round';
    maskBrushCtx.beginPath();
    maskBrushCtx.moveTo(lastX, lastY);
    maskBrushCtx.lineTo(x, y);
    maskBrushCtx.stroke();
    lastX = x; lastY = y;
  });
  maskBrushCanvas.addEventListener('mouseup', () => {
    maskBrushDrawing = false;
    mask.brushData = maskBrushCanvas.toDataURL();
    invalidateBrushMaskCache(mask.id);
    renderMasks(item);
    scheduleAutoSave();
  });
  maskBrushCanvas.addEventListener('mouseleave', () => {
    if (maskBrushDrawing) {
      maskBrushDrawing = false;
      mask.brushData = maskBrushCanvas.toDataURL();
      invalidateBrushMaskCache(mask.id);
      renderMasks(item);
      scheduleAutoSave();
    }
  });
}

export function removeBrushCanvas() {
  if (maskBrushCanvas) {
    maskBrushCanvas.remove();
    maskBrushCanvas = null;
    maskBrushCtx = null;
  }
}

export function pickColorFromImage(e, item) {
  if (!maskPickColorActive || !activeMaskId) return false;
  if (!item.src) return false;
  const mask = item.masks ? item.masks.find(m => m.id === activeMaskId) : null;
  if (!mask) return false;
  // Use cached image data or load it
  getCachedImagePixels(item.src, (img, canvas, ctx) => {
    const rect = item.el.getBoundingClientRect();
    // Calculate click position relative to the image
    // Account for object-fit: contain
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const elAspect = rect.width / rect.height;
    let renderW, renderH, offsetX, offsetY;
    if (imgAspect > elAspect) {
      renderW = rect.width;
      renderH = rect.width / imgAspect;
      offsetX = 0;
      offsetY = (rect.height - renderH) / 2;
    } else {
      renderH = rect.height;
      renderW = rect.height * imgAspect;
      offsetY = 0;
      offsetX = (rect.width - renderW) / 2;
    }
    const px = e.clientX - rect.left - offsetX;
    const py = e.clientY - rect.top - offsetY;
    if (px < 0 || py < 0 || px > renderW || py > renderH) return;
    const imgX = Math.round(px / renderW * img.naturalWidth);
    const imgY = Math.round(py / renderH * img.naturalHeight);
    const pixel = ctx.getImageData(imgX, imgY, 1, 1).data;
    const hex = '#' + [pixel[0], pixel[1], pixel[2]].map(c => c.toString(16).padStart(2, '0')).join('');
    pushUndo();
    mask.color = hex;
    maskPickColorActive = false;
    document.getElementById('viewport').classList.remove('mask-pick-mode');
    updateMaskList();
    renderMasks(item);
    scheduleAutoSave();
    toast('Color picked: ' + hex);
  });
  return true;
}

export function getCachedImagePixels(src, callback) {
  if (maskImageCache[src]) {
    const { img, canvas, ctx } = maskImageCache[src];
    callback(img, canvas, ctx);
    return;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    maskImageCache[src] = { img, canvas, ctx };
    callback(img, canvas, ctx);
  };
  img.src = src;
}

export function _buildMaskCanvas(item, mask) {
  if (!item.src) return null;
  const cached = maskImageCache[item.src];
  if (!cached) { getCachedImagePixels(item.src, () => { invalidateMaskCache(item.src); renderMasks(item); }); return null; }
  const { img } = cached;
  const feather = mask.feather !== undefined ? mask.feather : 3;
  const tol = mask.tolerance || 40;
  // Downsample to max 600px for massive speedup
  const maxDim = 600;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  // Draw image at reduced size
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = w; tmpCanvas.height = h;
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.drawImage(img, 0, 0, w, h);
  const imageData = tmpCtx.getImageData(0, 0, w, h);
  const data = imageData.data;
  // Parse target color
  const tR = parseInt(mask.color.slice(1, 3), 16);
  const tG = parseInt(mask.color.slice(3, 5), 16);
  const tB = parseInt(mask.color.slice(5, 7), 16);
  const tolSq = tol * tol * 3;
  // Build binary mask — no per-pixel sqrt, no per-pixel feathering
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w; maskCanvas.height = h;
  const maskCtx = maskCanvas.getContext('2d');
  const maskImageData = maskCtx.createImageData(w, h);
  const maskData = maskImageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - tR, dg = data[i+1] - tG, db = data[i+2] - tB;
    if (dr*dr + dg*dg + db*db <= tolSq) {
      maskData[i] = 255; maskData[i+1] = 255; maskData[i+2] = 255; maskData[i+3] = 255;
    }
  }
  maskCtx.putImageData(maskImageData, 0, 0);
  // Apply GPU-accelerated Gaussian blur for feathering (smooth, high quality)
  if (feather > 0) {
    const blurR = Math.max(0.5, feather * scale);
    const fc = document.createElement('canvas');
    fc.width = w; fc.height = h;
    const fctx = fc.getContext('2d');
    fctx.filter = 'blur(' + blurR + 'px)';
    fctx.drawImage(maskCanvas, 0, 0);
    fctx.filter = 'none';
    return fc;
  }
  return maskCanvas;
}

export function getMaskBlobURL(item, mask) {
  const feather = mask.feather !== undefined ? mask.feather : 3;
  const key = item.src + '|' + mask.color + '|' + (mask.tolerance || 40) + '|' + feather;
  if (maskBlobUrls[key]) return maskBlobUrls[key];
  const canvas = _buildMaskCanvas(item, mask);
  if (!canvas) return null;
  maskCanvasCache[key] = canvas;
  const url = canvas.toDataURL('image/png');
  maskBlobUrls[key] = url;
  return url;
}

export function getMaskCanvasCached(item, mask) {
  const feather = mask.feather !== undefined ? mask.feather : 3;
  const key = item.src + '|' + mask.color + '|' + (mask.tolerance || 40) + '|' + feather;
  if (maskCanvasCache[key]) return maskCanvasCache[key];
  const canvas = _buildMaskCanvas(item, mask);
  if (!canvas) return null;
  maskCanvasCache[key] = canvas;
  return canvas;
}

export function invalidateMaskCache(src) {
  if (!src) { maskCanvasCache = {}; maskBlobUrls = {}; return; }
  Object.keys(maskBlobUrls).forEach(k => { if (k.startsWith(src + '|')) delete maskBlobUrls[k]; });
  Object.keys(maskCanvasCache).forEach(k => { if (k.startsWith(src + '|')) delete maskCanvasCache[k]; });
}

export function invalidateBrushMaskCache(maskId) {
  if (!maskId) { brushMaskCache = {}; return; }
  Object.keys(brushMaskCache).forEach(k => { if (k.startsWith(maskId + '|')) delete brushMaskCache[k]; });
}

// Generate feathered brush mask URL — loads brush data into canvas, applies blur, caches result
export function getBrushMaskURL(item, mask) {
  const feather = mask.feather !== undefined ? mask.feather : 3;
  if (feather <= 0) return mask.brushData; // no feather needed, use raw brush data
  const key = mask.id + '|' + feather;
  if (brushMaskCache[key]) return brushMaskCache[key];
  // Async: load brush data, apply blur, cache, then re-render
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.filter = 'blur(' + feather + 'px)';
    ctx.drawImage(img, 0, 0);
    ctx.filter = 'none';
    brushMaskCache[key] = canvas.toDataURL('image/png');
    renderMasks(item);
  };
  img.src = mask.brushData;
  return null; // will re-render when feathered version is ready
}

// Toggle red overlay visualization of mask areas
export function toggleMaskShow() {
  maskShowOverlay = !maskShowOverlay;
  const item = getSelectedImageItem();
  if (item) renderMasks(item);
  updateMaskList();
}

// Set tint color for masked area (warm/cool tone adjustment)
export function setMaskTint(maskId, color) {
  const item = getSelectedImageItem();
  if (!item || !item.masks) return;
  const mask = item.masks.find(m => m.id === maskId);
  if (!mask) return;
  pushUndo();
  mask.tintColor = color || null;
  renderMasks(item);
  updateMaskList();
  scheduleAutoSave();
}

// Set tint color without full UI rebuild (for drag operations)
export function setMaskTintQuick(maskId, color) {
  const item = getSelectedImageItem();
  if (!item || !item.masks) return;
  const mask = item.masks.find(m => m.id === maskId);
  if (!mask) return;
  mask.tintColor = color || null;
  renderMasks(item);
  // Update button text without full rebuild
  const btn = document.querySelector('.mask-detail .mask-pick-btn');
  if (btn && maskWheelOpenId === maskId) {
    btn.textContent = color ? color.toUpperCase() : 'Color Wheel';
    btn.classList.toggle('active', !!color);
  }
}

// Set tint strength (opacity) for masked area
export function setMaskTintStrength(maskId, strength) {
  const item = getSelectedImageItem();
  if (!item || !item.masks) return;
  const mask = item.masks.find(m => m.id === maskId);
  if (!mask) return;
  mask.tintStrength = +strength;
  const valEl = document.getElementById('mk-' + maskId + '-tint-val');
  if (valEl) valEl.textContent = strength;
  clearTimeout(mask._tintTimer);
  mask._tintTimer = setTimeout(() => {
    pushUndo();
    renderMasks(item, true);
    scheduleAutoSave();
  }, 100);
}

// Toggle color wheel visibility
export function toggleColorWheel(maskId) {
  const wheel = document.getElementById('cw-' + maskId);
  if (!wheel) return;
  if (wheel.style.display === 'none') {
    wheel.style.display = 'block';
    maskWheelOpenId = maskId;
  } else {
    wheel.style.display = 'none';
    maskWheelOpenId = null;
  }
}

// Handle color wheel click/drag — returns hex color from angle
export function colorWheelPick(e, maskId, wheelEl) {
  const rect = wheelEl.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const dx = e.clientX - rect.left - cx;
  const dy = e.clientY - rect.top - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const radius = Math.min(cx, cy);
  // If clicked near center, clear tint
  if (dist < radius * 0.15) {
    setMaskTintQuick(maskId, null);
    return;
  }
  let angle = Math.atan2(dy, dx) * 180 / Math.PI;
  if (angle < 0) angle += 360;
  const sat = Math.min(1, dist / radius);
  // Convert HSL(hue, sat, 0.5) to hex
  const h = angle / 360;
  const s = sat;
  const l = 0.5;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h * 6) % 2 - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 1/6) { r = c; g = x; b = 0; }
  else if (h < 2/6) { r = x; g = c; b = 0; }
  else if (h < 3/6) { r = 0; g = c; b = x; }
  else if (h < 4/6) { r = 0; g = x; b = c; }
  else if (h < 5/6) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);
  const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  setMaskTintQuick(maskId, hex);
}

// Set up drag interaction for color wheel
export function colorWheelDrag(e, maskId, wheelEl) {
  e.stopPropagation();
  e.preventDefault();
  colorWheelPick(e, maskId, wheelEl);
  const moveHandler = (ev) => { ev.preventDefault(); colorWheelPick(ev, maskId, wheelEl); };
  const upHandler = () => {
    document.removeEventListener('mousemove', moveHandler);
    document.removeEventListener('mouseup', upHandler);
    // Final save with undo push
    const item = getSelectedImageItem();
    if (item) { pushUndo(); scheduleAutoSave(); }
  };
  document.addEventListener('mousemove', moveHandler);
  document.addEventListener('mouseup', upHandler);
}

// Draw masks on export/capture canvas
export function drawMasksOnCanvas(targetCtx, item, iw, ih) {
  if (!item.masks || !item.img || !item.src) return;
  item.masks.forEach(mask => {
    if (!mask.enabled) return;
    let maskCanvas = null;
    if (mask.type === 'color') {
      maskCanvas = getMaskCanvasCached(item, mask);
    } else if (mask.type === 'brush' && mask.brushData) {
      // Brush masks need async image load — skip for canvas export
      return;
    }
    if (!maskCanvas) return;
    // Create adjusted image canvas
    const adjCanvas = document.createElement('canvas');
    adjCanvas.width = iw; adjCanvas.height = ih;
    const adjCtx = adjCanvas.getContext('2d');
    // Draw image with object-fit: contain
    const img = item.img;
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const elAspect = iw / ih;
    let drawW, drawH, dx, dy;
    if (imgAspect > elAspect) {
      drawW = iw; drawH = iw / imgAspect; dx = 0; dy = (ih - drawH) / 2;
    } else {
      drawH = ih; drawW = ih * imgAspect; dy = 0; dx = (iw - drawW) / 2;
    }
    adjCtx.filter = combineMaskFilter(item, mask);
    adjCtx.drawImage(img, dx, dy, drawW, drawH);
    adjCtx.filter = 'none';
    // Apply mask
    adjCtx.globalCompositeOperation = 'destination-in';
    adjCtx.drawImage(maskCanvas, 0, 0, iw, ih);
    adjCtx.globalCompositeOperation = 'source-over';
    // Draw on target
    targetCtx.drawImage(adjCanvas, -iw/2, -ih/2);
    // Apply tint overlay if set
    if (mask.tintColor) {
      const tintCanvas = document.createElement('canvas');
      tintCanvas.width = iw; tintCanvas.height = ih;
      const tintCtx = tintCanvas.getContext('2d');
      tintCtx.fillStyle = mask.tintColor;
      tintCtx.fillRect(0, 0, iw, ih);
      tintCtx.globalCompositeOperation = 'destination-in';
      tintCtx.drawImage(maskCanvas, 0, 0, iw, ih);
      tintCtx.globalCompositeOperation = 'source-over';
      tintCtx.globalAlpha = (mask.tintStrength || 50) / 100 * 0.6;
      // Use 'color' blend: preserve luminance, apply hue+saturation
      targetCtx.save();
      targetCtx.globalCompositeOperation = 'color';
      targetCtx.drawImage(tintCanvas, -iw/2, -ih/2);
      targetCtx.restore();
    }
  });
}

export function combineMaskFilter(item, mask) {
  // Combine base item filters with mask-specific filters
  const bBri = (item.brightness || 100) * (mask.brightness || 100) / 100;
  const bCon = (item.contrast || 100) * (mask.contrast || 100) / 100;
  const bSat = (item.saturate || 100) * (mask.saturate || 100) / 100;
  const bHue = (item.hueRotate || 0) + (mask.hueRotate || 0);
  const bBlur = (item.blur || 0) + 0; // Don't add blur to mask
  const bSepia = Math.min(100, (item.sepia || 0) + (mask.sepia || 0));
  // Temperature
  const totalTemp = (item.temp || 0) + (mask.temp || 0);
  let tempFilter = '';
  if (totalTemp > 0) {
    tempFilter = ` sepia(${Math.min(100, totalTemp * 0.33)}%) saturate(${Math.min(400, 100 + totalTemp * 0.5)}%)`;
  } else if (totalTemp < 0) {
    tempFilter = ` hue-rotate(${Math.min(180, Math.abs(totalTemp) * 0.6)}deg) saturate(${Math.max(10, 100 + totalTemp * 0.3)}%)`;
  }
  // Shadow
  const totalShadow = (item.shadow !== undefined ? item.shadow : 100) * (mask.shadow || 100) / 100;
  let shadowFilter = '';
  if (Math.abs(totalShadow - 100) > 0.1) {
    shadowFilter = ` brightness(${100 + (totalShadow - 100) * 0.4}%)`;
  }
  // Highlight
  const totalHighlight = (item.highlight !== undefined ? item.highlight : 100) * (mask.highlight || 100) / 100;
  let highlightFilter = '';
  if (Math.abs(totalHighlight - 100) > 0.1) {
    highlightFilter = ` contrast(${100 + (totalHighlight - 100) * 0.4}%)`;
  }
  return `brightness(${bBri}%) contrast(${bCon}%) saturate(${bSat}%) hue-rotate(${bHue}deg) blur(${bBlur}px) sepia(${bSepia}%)${tempFilter}${shadowFilter}${highlightFilter}`;
}

export function renderMasks(item, filterOnly) {
  if (!item.el) return;
  if (!item.masks || item.masks.length === 0) {
    item.el.querySelectorAll('.mask-overlay').forEach(el => el.remove());
    return;
  }
  if (!item.img || !item.src) return;

  // Fast path: only update CSS filters on existing overlays (no mask regeneration)
  if (filterOnly) {
    item.masks.forEach(mask => {
      if (!mask.enabled) return;
      const overlay = item.el.querySelector('.mask-overlay[data-mask-id="' + mask.id + '"]');
      if (overlay) {
        const img = overlay.querySelector('img');
        if (img) img.style.filter = combineMaskFilter(item, mask);
      }
      // Update tint overlay opacity
      const tintOv = item.el.querySelector('.mask-overlay[data-mask-id="' + mask.id + '-tint"]');
      if (tintOv) {
        tintOv.style.opacity = (mask.tintStrength || 0) / 100 * 0.6;
      }
    });
    return;
  }

  // Full path: remove all overlays (including red preview) and recreate
  item.el.querySelectorAll('.mask-overlay').forEach(el => el.remove());

  item.masks.forEach(mask => {
    if (!mask.enabled) return;
    let maskURL = null;
    if (mask.type === 'color') {
      maskURL = getMaskBlobURL(item, mask);
    } else if (mask.type === 'brush' && mask.brushData) {
      maskURL = getBrushMaskURL(item, mask);
    }
    if (!maskURL) return;

    // --- Filtered image overlay (applies adjustments to masked area) ---
    const overlay = document.createElement('div');
    overlay.className = 'mask-overlay';
    overlay.setAttribute('data-mask-id', mask.id);
    overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;-webkit-mask-mode:alpha;mask-mode:alpha;';

    const cloneImg = document.createElement('img');
    cloneImg.src = item.src;
    cloneImg.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;';
    cloneImg.style.filter = combineMaskFilter(item, mask);

    overlay.style.maskImage = `url(${maskURL})`;
    overlay.style.webkitMaskImage = `url(${maskURL})`;
    overlay.style.maskRepeat = 'no-repeat';
    overlay.style.webkitMaskRepeat = 'no-repeat';
    overlay.style.maskSize = '100% 100%';
    overlay.style.webkitMaskSize = '100% 100%';

    if (item.flipH) { overlay.style.transform = 'scaleX(-1)'; }

    overlay.appendChild(cloneImg);

    const firstHandle = item.el.querySelector('.item-handle');
    if (firstHandle) {
      item.el.insertBefore(overlay, firstHandle);
    } else {
      item.el.appendChild(overlay);
    }

    // --- Tint overlay (applies color tint to masked area for warm/cool adjustment) ---
    if (mask.tintColor) {
      const tintOv = document.createElement('div');
      tintOv.className = 'mask-overlay mask-tint';
      tintOv.setAttribute('data-mask-id', mask.id + '-tint');
      tintOv.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:' + mask.tintColor + ';opacity:' + ((mask.tintStrength || 50) / 100 * 0.6) + ';mix-blend-mode:color;-webkit-mask-mode:alpha;mask-mode:alpha;';
      tintOv.style.maskImage = `url(${maskURL})`;
      tintOv.style.webkitMaskImage = `url(${maskURL})`;
      tintOv.style.maskRepeat = 'no-repeat';
      tintOv.style.webkitMaskRepeat = 'no-repeat';
      tintOv.style.maskSize = '100% 100%';
      tintOv.style.webkitMaskSize = '100% 100%';

      if (item.flipH) { tintOv.style.transform = 'scaleX(-1)'; }

      const fh2 = item.el.querySelector('.item-handle');
      if (fh2) {
        item.el.insertBefore(tintOv, fh2);
      } else {
        item.el.appendChild(tintOv);
      }
    }

    // --- Red visualization overlay (shows mask area at 50% red opacity) ---
    if (maskShowOverlay) {
      const redOverlay = document.createElement('div');
      redOverlay.className = 'mask-overlay mask-preview';
      redOverlay.setAttribute('data-mask-id', mask.id + '-preview');
      redOverlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:rgba(255,0,0,0.5);-webkit-mask-mode:alpha;mask-mode:alpha;z-index:9999;';
      redOverlay.style.maskImage = `url(${maskURL})`;
      redOverlay.style.webkitMaskImage = `url(${maskURL})`;
      redOverlay.style.maskRepeat = 'no-repeat';
      redOverlay.style.webkitMaskRepeat = 'no-repeat';
      redOverlay.style.maskSize = '100% 100%';
      redOverlay.style.webkitMaskSize = '100% 100%';

      if (item.flipH) { redOverlay.style.transform = 'scaleX(-1)'; }

      const fh = item.el.querySelector('.item-handle');
      if (fh) {
        item.el.insertBefore(redOverlay, fh);
      } else {
        item.el.appendChild(redOverlay);
      }
    }
  });
}

export function updateMaskList() {
  const item = getSelectedImageItem();
  const listEl = document.getElementById('mask-list');
  const emptyEl = document.getElementById('mask-empty');
  if (!listEl) return;
  if (!item || !item.masks || item.masks.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  listEl.innerHTML = '';
  item.masks.forEach((mask, idx) => {
    const isActive = activeMaskId === mask.id;
    const div = document.createElement('div');
    div.className = 'mask-item' + (isActive ? ' active-mask' : '');
    let html = '<div class="mask-item-head" onclick="selectMask(\'' + mask.id + '\')">';
    html += '<input type="checkbox" class="mi-toggle" ' + (mask.enabled ? 'checked' : '') + ' onclick="event.stopPropagation();toggleMask(\'' + mask.id + '\',this.checked)">';
    const icon = mask.type === 'color' ? 'C' : 'B';
    html += '<span class="mi-name">' + icon + ' ' + mask.name + '</span>';
    html += '<button class="mi-del" onclick="event.stopPropagation();deleteMaskLayer(\'' + mask.id + '\')" title="Delete">\u00d7</button>';
    html += '</div>';
    if (isActive) {
      html += '<div class="mask-detail show">';
      html += '<div class="btn-group" style="margin-bottom:6px;">';
      html += '<button class="mask-pick-btn ' + (maskShowOverlay ? 'active' : '') + '" onclick="event.stopPropagation();toggleMaskShow()" style="flex:1;">' + (maskShowOverlay ? 'Hide Area' : 'Show Area') + '</button>';
      html += '</div>';
      if (mask.type === 'color') {
        html += '<div class="mask-color-row">';
        html += '<input type="color" value="' + (mask.color || '#ffffff') + '" onchange="setMaskColor(\'' + mask.id + '\',this.value)">';
        html += '<label>Color</label>';
        html += '<button class="mask-pick-btn ' + (maskPickColorActive ? 'active' : '') + '" onclick="event.stopPropagation();togglePickColor(\'' + mask.id + '\')">' + (maskPickColorActive ? 'Picking...' : 'Pick') + '</button>';
        html += '</div>';
        html += '<div class="prop-row"><label>Tol</label><input type="range" min="5" max="200" value="' + (mask.tolerance || 40) + '" oninput="setMaskTolerance(\'' + mask.id + '\',this.value)"><span id="mk-' + mask.id + '-tol-val" style="font-size:9px;width:28px;">' + (mask.tolerance || 40) + '</span></div>';
        html += '<div class="prop-row"><label>Feather</label><input type="range" min="0" max="30" value="' + (mask.feather !== undefined ? mask.feather : 3) + '" oninput="setMaskFeather(\'' + mask.id + '\',this.value)"><span id="mk-' + mask.id + '-feather-val" style="font-size:9px;width:28px;">' + (mask.feather !== undefined ? mask.feather : 3) + '</span></div>';
      } else {
        html += '<div class="prop-row"><label>Brush</label><input type="range" min="5" max="150" value="' + (mask.brushSize || 40) + '" oninput="setMaskBrushSize(\'' + mask.id + '\',this.value)"><span id="mk-' + mask.id + '-bs-val" style="font-size:9px;width:28px;">' + (mask.brushSize || 40) + '</span></div>';
        html += '<div class="btn-group" style="margin-bottom:6px;">';
        html += '<button class="mask-pick-btn ' + (maskBrushActive ? 'active' : '') + '" onclick="event.stopPropagation();toggleBrushMode(\'' + mask.id + '\')" style="flex:1;">' + (maskBrushActive ? 'Done' : 'Paint') + '</button>';
        html += '<button onclick="event.stopPropagation();clearBrushMask(\'' + mask.id + '\')" style="flex:1;font-size:10px;">Clear</button>';
        html += '</div>';
        html += '<div class="prop-row"><label>Feather</label><input type="range" min="0" max="30" value="' + (mask.feather !== undefined ? mask.feather : 3) + '" oninput="setMaskFeather(\'' + mask.id + '\',this.value)"><span id="mk-' + mask.id + '-feather-val" style="font-size:9px;width:28px;">' + (mask.feather !== undefined ? mask.feather : 3) + '</span></div>';
      }
      html += '<div style="font-size:9px;color:var(--text-subtle);text-transform:uppercase;letter-spacing:1px;margin:6px 0 3px;">Tone Tint</div>';
      html += '<div class="btn-group" style="margin-bottom:6px;">';
      html += '<button class="mask-pick-btn ' + (mask.tintColor ? 'active' : '') + '" onclick="event.stopPropagation();toggleColorWheel(\'' + mask.id + '\')" style="flex:1;">' + (mask.tintColor ? mask.tintColor.toUpperCase() : 'Color Wheel') + '</button>';
      if (mask.tintColor) html += '<button onclick="event.stopPropagation();setMaskTint(\'' + mask.id + '\',null)" style="flex:0 0 auto;font-size:10px;padding:5px 8px;">\u2715</button>';
      html += '</div>';
      html += '<div id="cw-' + mask.id + '" style="display:' + (maskWheelOpenId === mask.id ? 'block' : 'none') + ';margin-bottom:6px;">';
      html += '<div style="display:flex;align-items:center;gap:8px;">';
      html += '<div onmousedown="event.stopPropagation();colorWheelDrag(event,\'' + mask.id + '\',this)" style="width:70px;height:70px;border-radius:50%;cursor:crosshair;flex-shrink:0;background:conic-gradient(from 0deg,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000);position:relative;overflow:hidden;">';
      html += '<div style="position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,#fff 0%,#fff 14%,rgba(255,255,255,0) 65%);pointer-events:none;"></div>';
      html += '</div>';
      html += '<div style="flex:1;font-size:9px;color:var(--text-subtle);line-height:1.5;">Click/drag wheel to pick tone.<br>Center = clear tint.</div>';
      html += '</div>';
      html += '</div>';
      html += '<div class="prop-row"><label>Strength</label><input type="range" min="0" max="100" value="' + (mask.tintStrength !== undefined ? mask.tintStrength : 50) + '" oninput="setMaskTintStrength(\'' + mask.id + '\',this.value)"><span id="mk-' + mask.id + '-tint-val" style="font-size:9px;width:28px;">' + (mask.tintStrength !== undefined ? mask.tintStrength : 50) + '</span></div>';
      html += '<div style="font-size:9px;color:var(--text-subtle);text-transform:uppercase;letter-spacing:1px;margin:6px 0 3px;">Adjustments</div>';
      html += '<div class="prop-row"><label>Bright</label><input type="range" min="0" max="1000" value="' + (mask.brightness || 100) + '" oninput="setMaskFilter(\'' + mask.id + '\',\'brightness\',this.value)"><span id="mk-' + mask.id + '-brightness-val" style="font-size:9px;width:28px;">' + (mask.brightness || 100) + '</span></div>';
      html += '<div class="prop-row"><label>Contrast</label><input type="range" min="0" max="1000" value="' + (mask.contrast || 100) + '" oninput="setMaskFilter(\'' + mask.id + '\',\'contrast\',this.value)"><span id="mk-' + mask.id + '-contrast-val" style="font-size:9px;width:28px;">' + (mask.contrast || 100) + '</span></div>';
      html += '<div class="prop-row"><label>Saturate</label><input type="range" min="0" max="1000" value="' + (mask.saturate || 100) + '" oninput="setMaskFilter(\'' + mask.id + '\',\'saturate\',this.value)"><span id="mk-' + mask.id + '-saturate-val" style="font-size:9px;width:28px;">' + (mask.saturate || 100) + '</span></div>';
      html += '<div class="prop-row"><label>Temp</label><input type="range" min="-1000" max="1000" value="' + (mask.temp || 0) + '" oninput="setMaskFilter(\'' + mask.id + '\',\'temp\',this.value)"><span id="mk-' + mask.id + '-temp-val" style="font-size:9px;width:28px;">' + (mask.temp || 0) + '</span></div>';
      html += '<div class="prop-row"><label>Shadow</label><input type="range" min="0" max="1000" value="' + (mask.shadow || 100) + '" oninput="setMaskFilter(\'' + mask.id + '\',\'shadow\',this.value)"><span id="mk-' + mask.id + '-shadow-val" style="font-size:9px;width:28px;">' + (mask.shadow || 100) + '</span></div>';
      html += '<div class="prop-row"><label>Highlight</label><input type="range" min="0" max="1000" value="' + (mask.highlight || 100) + '" oninput="setMaskFilter(\'' + mask.id + '\',\'highlight\',this.value)"><span id="mk-' + mask.id + '-highlight-val" style="font-size:9px;width:28px;">' + (mask.highlight || 100) + '</span></div>';
      html += '<div class="prop-row"><label>Hue</label><input type="range" min="-720" max="1440" value="' + (mask.hueRotate || 0) + '" oninput="setMaskFilter(\'' + mask.id + '\',\'hueRotate\',this.value)"><span id="mk-' + mask.id + '-hueRotate-val" style="font-size:9px;width:28px;">' + (mask.hueRotate || 0) + '\u00b0</span></div>';
      html += '<div class="prop-row"><label>Sepia</label><input type="range" min="0" max="400" value="' + (mask.sepia || 0) + '" oninput="setMaskFilter(\'' + mask.id + '\',\'sepia\',this.value)"><span id="mk-' + mask.id + '-sepia-val" style="font-size:9px;width:28px;">' + (mask.sepia || 0) + '</span></div>';
      html += '</div>';
    }
    div.innerHTML = html;
    listEl.appendChild(div);
  });
}

export function resetMasks(item) {
  if (item.masks) {
    item.el.querySelectorAll('.mask-overlay').forEach(el => el.remove());
    item.masks = [];
  }
  invalidateMaskCache(item.src);
  brushMaskCache = {};
  activeMaskId = null;
  maskPickColorActive = false;
  maskBrushActive = false;
  maskShowOverlay = false;
  maskWheelOpenId = null;
  removeBrushCanvas();
  updateMaskList();
}
