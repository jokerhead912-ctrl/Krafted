import { getCachedImagePixels, resetMasks, updateMaskList } from './masking.js';
import { getSelectedImages, getSelectedItems, refreshSelection } from './selection.js';
import { state } from './core-state.js';
import { scheduleAutoSave } from './save-load.js';
import { pushUndo } from './undo-redo.js';
import { updateItemStyle } from './add-items.js';
import { updateVideoControls } from './frame-comments.js';
import { refreshVideoPanelTimes } from './video-trim.js';
import { isAnimatedGif, openGifEditor } from './gif-editor.js';
import { toast } from './ui-utils.js';

// ============================================================
//  PROPERTIES PANEL
// ============================================================
export function trimGifSelected() {
  const sel = getSelectedImages();
  if (sel.length !== 1) { toast('Select 1 GIF image'); return; }
  openGifEditor(sel[0]);
}

export function updatePropsPanel() {
  const sel = getSelectedItems();
  const empty = document.getElementById('props-empty');
  const content = document.getElementById('props-content');
  const gifSection = document.getElementById('gif-section');
  if (sel.length === 0) {
    empty.style.display = 'block';
    content.style.display = 'none';
    if (gifSection) gifSection.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  content.style.display = 'block';
  const item = sel[0];
  if (item.opacity !== undefined) {
    document.getElementById('prop-opacity').value = Math.round(item.opacity * 100);
    document.getElementById('prop-opacity-val').textContent = Math.round(item.opacity * 100) + '%';
  }
  if (item.rot !== undefined) {
    document.getElementById('prop-rotate').value = item.rot;
    document.getElementById('prop-rotate-val').textContent = Math.round(item.rot) + '°';
  }
  if (item.brightness !== undefined) {
    document.getElementById('prop-brightness').value = item.brightness;
    document.getElementById('prop-contrast').value = item.contrast;
    document.getElementById('prop-saturate').value = item.saturate;
    document.getElementById('prop-hue').value = item.hueRotate;
    document.getElementById('prop-blur').value = item.blur;
    document.getElementById('prop-sepia').value = item.sepia;
    // Update value displays
    document.getElementById('prop-brightness-val').textContent = item.brightness;
    document.getElementById('prop-contrast-val').textContent = item.contrast;
    document.getElementById('prop-saturate-val').textContent = item.saturate;
    document.getElementById('prop-hue-val').textContent = item.hueRotate + '°';
    document.getElementById('prop-blur-val').textContent = item.blur + 'px';
    document.getElementById('prop-sepia-val').textContent = item.sepia;
  }
  // CGI Director values
  if (item.temp !== undefined) {
    document.getElementById('prop-temp').value = item.temp;
    document.getElementById('prop-temp-val').textContent = item.temp;
    document.getElementById('prop-vignette').value = item.vignette;
    document.getElementById('prop-vignette-val').textContent = item.vignette;
    document.getElementById('prop-shadow').value = item.shadow;
    document.getElementById('prop-shadow-val').textContent = item.shadow;
    document.getElementById('prop-highlight').value = item.highlight;
    document.getElementById('prop-highlight-val').textContent = item.highlight;
    document.getElementById('prop-grain').value = item.grain;
    document.getElementById('prop-grain-val').textContent = item.grain;
  }
  document.getElementById('btn-lock').textContent = item.locked ? 'Unlock' : 'Lock';
  // Show Text section only for text items
  const textSection = document.getElementById('text-section');
  if (textSection) {
    textSection.style.display = (item.el && item.el.classList.contains('text-item')) ? 'block' : 'none';
  }
  // Show GIF section only for GIF images
  if (gifSection) {
    gifSection.style.display = (item.img && item.src && isAnimatedGif(item.src)) ? 'block' : 'none';
  }
  // Show Video section only for video items
  const videoSection = document.getElementById('video-section');
  if (videoSection) {
    videoSection.style.display = item.video ? 'block' : 'none';
    // Round 28: when a video is selected, auto-expand the Video
    // section so the user can see the playback / volume / speed /
    // comments controls without having to click the header first.
    // We do NOT touch any OTHER section — they keep their own
    // collapsed/expanded state, exactly as the user left them.
    if (item.video) {
      try {
        const vHead = videoSection.previousElementSibling;
        if (vHead && vHead.classList && vHead.classList.contains('collapsed')) {
          vHead.classList.remove('collapsed');
          videoSection.classList.remove('hidden');
          // Persist this expansion so the choice is remembered
          const st = _loadPropSectionState();
          st['Video'] = false;
          _savePropSectionState(st);
        }
      } catch (e) {}
      updateVideoControls(item);
      // Update the FPS label and re-render the time labels in the current mode
      var fpsLabel = document.getElementById('video-frame-rate-label');
      if (fpsLabel) fpsLabel.textContent = (item.video._kraftedFps || 30) + ' fps';
      refreshVideoPanelTimes();
    }
  }
  // Show Group section if any selected item is in a group
  const groupSection = document.getElementById('group-section');
  if (groupSection) {
    const anyGrouped = sel.some(i => state.groups.some(g => g.memberIds.has(i.id)));
    groupSection.style.display = anyGrouped ? 'block' : 'none';
  }
  // Show Link section only for link card items
  const linkSection = document.getElementById('link-section');
  if (linkSection) {
    linkSection.style.display = item.isLink ? 'block' : 'none';
    if (item.isLink) {
      document.getElementById('prop-link-title').textContent = item.linkTitle || '';
      document.getElementById('prop-link-url').textContent = item.linkUrl || '';
    }
  }
  // Update mask list
  const maskWrap = document.getElementById('mask-wrap');
  if (maskWrap) {
    maskWrap.style.display = (item.img && item.src) ? 'block' : 'none';
    // Pre-load image pixel cache for mask color picking
    if (item.img && item.src && !window.maskImageCache[item.src]) {
      getCachedImagePixels(item.src, () => {});
    }
  }
  updateMaskList();
}
export function setOpacity(v) {
  const sel = getSelectedItems();
  sel.forEach(i => { i.opacity = v / 100; updateItemStyle(i); });
  document.getElementById('prop-opacity-val').textContent = v + '%';
  scheduleAutoSave();
}
export function setRotation(v) {
  const sel = getSelectedItems();
  sel.forEach(i => { i.rot = +v; updateItemStyle(i); });
  document.getElementById('prop-rotate-val').textContent = Math.round(v) + '°';
  scheduleAutoSave();
}
export function flipH() { pushUndo(); getSelectedItems().forEach(i => { i.flipH = !i.flipH; updateItemStyle(i); }); scheduleAutoSave(); }
export function flipV() { pushUndo(); getSelectedItems().forEach(i => { i.flipV = !i.flipV; updateItemStyle(i); }); scheduleAutoSave(); }
export function toggleLock() { pushUndo(); getSelectedItems().forEach(i => { i.locked = !i.locked; updateItemStyle(i); }); refreshSelection(); updatePropsPanel(); scheduleAutoSave(); }
export function setPhotoFilter(filter, value) {
  const sel = getSelectedImages();
  if (sel.length === 0) return;
  if (!sel[0]._filterDragging) { pushUndo(); sel[0]._filterDragging = true; }
  sel.forEach(i => { i[filter] = +value; updateItemStyle(i); });
  // Update value display
  const valEl = document.getElementById('prop-' + filter.replace('hueRotate','hue') + '-val');
  if (valEl) valEl.textContent = filter === 'hueRotate' ? value + '°' : (filter === 'blur' ? value + 'px' : value);
  clearTimeout(sel[0]._filterTimer);
  sel[0]._filterTimer = setTimeout(() => { sel[0]._filterDragging = false; }, 300);
  scheduleAutoSave();
}
export function resetPhotoFilters() {
  pushUndo();
  getSelectedImages().forEach(i => {
    i.brightness = 100; i.contrast = 100; i.saturate = 100; i.hueRotate = 0; i.blur = 0; i.sepia = 0; i.grayscale = 0;
    i.temp = 0; i.vignette = 0; i.shadow = 100; i.highlight = 100; i.grain = 0;
    // Remove overlays
    const oldVig = i.el.querySelector('.cgi-vignette');
    if (oldVig) oldVig.remove();
    const oldGrain = i.el.querySelector('.cgi-grain');
    if (oldGrain) oldGrain.remove();
    // Reset masks
    resetMasks(i);
    updateItemStyle(i);
  });
  updatePropsPanel();
  scheduleAutoSave();
}

// ============================================================
//  PROPERTIES PANEL SECTIONS (collapsible)
// ============================================================
// ============================================================
//  PROP PANEL SECTION STATE
//  Round 28: persist per-section collapse state in localStorage
//  so the user's chosen layout survives reloads. Default = all
//  sections expanded (the user explicitly said "keep this setting
//  for default not close all" — they want the panel open by default,
//  not auto-closed when they refresh or select a different item).
// ============================================================
export const PROP_SECTIONS_KEY = 'krafted_prop_sections_v1';
// Sections that exist in the right panel. We look them up by their
// header text so adding a new section doesn't require a code edit.
export const PROP_SECTION_NAMES = [
  'Transform','Text','Photo Adjust','CGI Director','Mask Layers',
  'GIF','Video','Layer & Layout','Group','Link','Canvas',
];
// Sections that start collapsed on first load. Users can still
// open/close them manually — their explicit choice is remembered
// and overrides this default.
export const DEFAULT_COLLAPSED_PROP_SECTIONS = new Set([
  'Photo Adjust', 'CGI Director', 'Video',
]);
export function _loadPropSectionState() {
  try {
    const raw = (window.KraftedStorage && window.KraftedStorage.getItemSync(PROP_SECTIONS_KEY)) || localStorage.getItem(PROP_SECTIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) { return {}; }
}
export function _savePropSectionState(st) {
  try {
    var val = JSON.stringify(st || {});
    localStorage.setItem(PROP_SECTIONS_KEY, val);
    if (window.KraftedStorage) window.KraftedStorage.setItem(PROP_SECTIONS_KEY, val).catch(function(){});
  } catch (e) {}
}
export function _applyPropSectionState() {
  // Resolution order for each section:
  //   1. state[name] === true  → user explicitly collapsed → restore collapsed
  //   2. state[name] === false → user explicitly expanded → ensure expanded
  //   3. state[name] === undef → no prior state → use DEFAULT_COLLAPSED list
  //                              (rarely-used sections start folded so the
  //                              props panel feels less cluttered by default)
  const state = _loadPropSectionState();
  document.querySelectorAll('#props .section-header').forEach((h) => {
    const name = (h.textContent || '').trim();
    let collapsed;
    if (state[name] === true)        collapsed = true;
    else if (state[name] === false)  collapsed = false;
    else                             collapsed = DEFAULT_COLLAPSED_PROP_SECTIONS.has(name);
    h.classList.toggle('collapsed', collapsed);
    const section = h.nextElementSibling;
    if (section) section.classList.toggle('hidden', collapsed);
  });
}
// Apply on initial load so the persisted layout shows before the
// user clicks anything. (DOM is ready because this script is at the
// bottom of <body>.)
_applyPropSectionState();

export function togglePropSection(header) {
  header.classList.toggle('collapsed');
  const section = header.nextElementSibling;
  if (section) section.classList.toggle('hidden');
  // Round 28: persist the new state. Only the toggled section
  // changes — other sections keep their previous state, so
  // collapsing one does NOT cascade and close the rest.
  try {
    const name = (header.textContent || '').trim();
    const state = _loadPropSectionState();
    state[name] = header.classList.contains('collapsed');
    _savePropSectionState(state);
  } catch (e) {}
}

// ============================================================
//  CGI DIRECTOR FILTERS
// ============================================================
export function setCgiFilter(filter, value) {
  const sel = getSelectedImages();
  if (sel.length === 0) return;
  if (!sel[0]._cgiDragging) { pushUndo(); sel[0]._cgiDragging = true; }
  sel.forEach(i => { i[filter] = +value; updateItemStyle(i); });
  const valEl = document.getElementById('prop-' + filter + '-val');
  if (valEl) valEl.textContent = value;
  clearTimeout(sel[0]._cgiTimer);
  sel[0]._cgiTimer = setTimeout(() => { sel[0]._cgiDragging = false; }, 300);
  scheduleAutoSave();
}

export function updateCgiOverlays(item) {
  // Vignette overlay
  let vig = item.el.querySelector('.cgi-vignette');
  const vigVal = item.vignette || 0;
  if (vigVal > 0) {
    if (!vig) {
      vig = document.createElement('div');
      vig.className = 'cgi-vignette';
      vig.style.cssText = 'position:absolute;inset:0;pointer-events:none;border-radius:0;';
      item.el.appendChild(vig);
    }
    const intensity = Math.min(vigVal / 100, 2.0); // Allow extreme vignette up to 200
    vig.style.background = `radial-gradient(ellipse at center, transparent ${Math.max(0, 60 - intensity * 30)}%, rgba(0,0,0,${Math.min(1, intensity * 0.8)}) 100%)`;
  } else if (vig) {
    vig.remove();
  }

  // Grain overlay
  let grain = item.el.querySelector('.cgi-grain');
  const grainVal = item.grain || 0;
  if (grainVal > 0) {
    if (!grain) {
      grain = document.createElement('div');
      grain.className = 'cgi-grain';
      grain.style.cssText = 'position:absolute;inset:0;pointer-events:none;mix-blend-mode:overlay;opacity:0.3;';
      // SVG noise filter for grain
      grain.style.backgroundImage = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`;
      grain.style.backgroundSize = '100px 100px';
      item.el.appendChild(grain);
    }
    grain.style.opacity = Math.min(1, grainVal / 200); // Allow extreme grain up to 200
  } else if (grain) {
    grain.remove();
  }
}

window.flipH = flipH;
window.flipV = flipV;
window.toggleLock = toggleLock;
window.setOpacity = setOpacity;
window.setRotation = setRotation;
window.setPhotoFilter = setPhotoFilter;
window.resetPhotoFilters = resetPhotoFilters;
window.setCgiFilter = setCgiFilter;
window.updatePropsPanel = updatePropsPanel;
