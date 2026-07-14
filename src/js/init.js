import { state, G, paperState, captureResultPanel, captureResultImg, _frozenGifs } from './core-state.js';;
import { initTextToolbar } from './text-style.js';
import { updateCanvas } from './canvas-view.js';
import { restoreBoard, formatBytes } from './save-load.js';
import { updateMediaBar } from './media-bar.js';
import { canvas } from './core-state.js';
import { updateAltPanBadge } from './text-sanitizer.js';
import { updateCanvas } from './canvas-view.js';
import { initTextToolbar } from './text-style.js';
import { redrawDrawLayer } from './draw-layer.js';
import { updateCutTargetHighlight } from './cut-lasso.js';
import { formatBytes, restoreBoard } from './save-load.js';
import { toast } from './ui-utils.js';
import { redrawDrawLayer } from './draw-layer.js';
import { updateMediaBar } from './media-bar.js';
import { cutState, updateCutTargetHighlight } from './cut-lasso.js';
import { updateAltPanBadge } from './text-sanitizer.js';

//  HELP PANEL — hotkeys & function guide
// ============================================================
export function showHelp() {
  const overlay = document.getElementById('help-overlay');
  if (overlay) overlay.style.display = 'flex';
}
export function hideHelp() {
  const overlay = document.getElementById('help-overlay');
  if (overlay) overlay.style.display = 'none';
}

initTextToolbar();
updateCanvas();
// ALWAYS show welcome page on load — user must click GET STARTED every time
showWelcome();
// Auto-save restore: if data exists, restore in background but keep welcome page visible
window.addEventListener('load', async () => {
  // Restore autosave in background
  setTimeout(() => {
    const saved = localStorage.getItem('krafted_autosave');
    if (saved) { try { restoreBoard(JSON.parse(saved)); } catch(e) {} }
  }, 100);
  // Show alt-pan status badge if enabled (MacBook trackpad mode)
  updateAltPanBadge();
});
window.addEventListener('resize', () => { updateCanvas(); if (cutState) updateCutTargetHighlight(); });

// New Board — clear everything and show fresh welcome
export function newBoard() {
  cleanupAllItems();
  state.items = [];
  state.texts = [];
  state.todos = [];
  state.mindmaps = [];
  state.selected.clear();
  state.groups.forEach(g => g.borderEl.remove());
  state.groups = [];
  G.nextGroupId = 1;
  state.undoStack = [];
  state.redoStack = [];
  G.nextZ = 1; G.nextId = 1;
  G.drawStrokes.length = 0;
  state.pan = { x: 0, y: 0 };
  state.zoom = 1;
  try { localStorage.removeItem('krafted_autosave'); } catch(e) {}
  updateCanvas();
  redrawDrawLayer();
  refreshSelection();
  _frozenGifs.clear();
  updateMediaBar();
  showWelcome();
  toast('Board cleared!');
}

// ============================================================
//  SAVE TO FOLDER — File System Access API
//  Lets the user pick a local folder and write files directly to it.
//  Works in Chrome / Edge / Brave / Arc on Windows + Mac.
//  Falls back to standard download on Safari / Firefox.
// ============================================================

export function hasFileSystemAccess() {
  return typeof window.showDirectoryPicker === 'function';
}

export async function pickSaveFolder() {
  if (!hasFileSystemAccess()) return null;
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (e) {
    // User cancelled the picker — silent return
    if (e && (e.name === 'AbortError' || e.code === 20 || e.code === 'ABORT_ERR')) return null;
    throw e;
  }
}

export function dataUrlToBlob(dataUrl) {
  if (!dataUrl) return Promise.resolve(null);
  if (dataUrl.startsWith('blob:')) {
    return fetch(dataUrl).then(r => r.ok ? r.blob() : null).catch(() => null);
  }
  const idx = dataUrl.indexOf(',');
  if (idx < 0) return Promise.resolve(null);
  const meta = dataUrl.slice(0, idx);
  const b64 = dataUrl.slice(idx + 1);
  const mime = (meta.match(/data:([^;]+)/) || [, 'image/png'])[1];
  try {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return Promise.resolve(new Blob([arr], { type: mime }));
  } catch (e) {
    return Promise.resolve(null);
  }
}

export function canvasToBlobAsync(canvas, type, quality) {
  type = type || 'image/png';
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob returned null')), type, quality);
    } catch (e) { reject(e); }
  });
}

export function sanitizeFilename(name, fallback) {
  let s = (name == null ? '' : String(name));
  // Strip path separators and characters forbidden on Win/Mac
  s = s.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  // Strip leading dots (hidden files on Mac, invalid on Win)
  s = s.replace(/^\.+/, '');
  // Collapse whitespace and underscores
  s = s.replace(/[\s_]+/g, ' ').trim();
  if (s.length > 120) s = s.slice(0, 120);
  return s || (fallback || 'file');
}

export async function uniqueFilename(dirHandle, base, ext) {
  // Returns a filename that doesn't already exist in the folder
  const tryName = async (n) => {
    try {
      await dirHandle.getFileHandle(n, { create: false });
      return false; // exists
    } catch (e) { return true; } // doesn't exist (good)
  };
  let candidate = base + '.' + ext;
  if (await tryName(candidate)) return candidate;
  for (let i = 2; i < 1000; i++) {
    candidate = base + '_' + i + '.' + ext;
    if (await tryName(candidate)) return candidate;
  }
  return base + '_' + Date.now() + '.' + ext;
}

export async function writeBlobToFolder(dirHandle, filename, blob) {
  const fh = await dirHandle.getFileHandle(filename, { create: true });
  const w = await fh.createWritable();
  try { await w.write(blob); } finally { await w.close(); }
  return filename;
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// Round 28.7: kraftedSaveFile — unified "Save As" helper that gives the
// user a NATIVE save-location dialog on Chrome/Edge (Mac + Windows + Linux)
// via window.showSaveFilePicker, and falls back to the same-old
// <a download> for Safari / Firefox / any browser that doesn't ship the
// File System Access API. The user was getting frustrated with the
// "the file just lands in Downloads and I have to dig it out" flow —
// the native picker is what they want.
//
// Usage:
//   await kraftedSaveFile({ filename: 'foo.html', blob: myBlob, mime: 'text/html' })
//   await kraftedSaveFile({ filename: 'foo.mp4', blob: myBlob })  // mime auto-from .mp4
//
// Returns 'saved' / 'cancelled' / 'fallback' so the caller can update
// the toast. 'fallback' means "saved via the old <a download> path,
// because this browser doesn't support the native picker".
export function hasShowSaveFilePicker() {
  return typeof window.showSaveFilePicker === 'function';
}
export async function kraftedSaveFile(opts) {
  opts = opts || {};
  const filename = sanitizeFilename(opts.filename || 'krafted-export', 'krafted-export');
  const blob = opts.blob;
  if (!blob) return 'cancelled';
  // Preferred path: native save dialog (Chrome/Edge 86+, works on Mac + Win)
  if (hasShowSaveFilePicker()) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: (opts.description || 'File'),
          accept: { [opts.mime || (blob.type || 'application/octet-stream')]: ['.' + (filename.split('.').pop() || 'bin')] },
        }],
      });
      const w = await handle.createWritable();
      try { await w.write(blob); } finally { try { await w.close(); } catch (e) {} }
      return 'saved';
    } catch (e) {
      // User cancelled the picker — silent return
      if (e && (e.name === 'AbortError' || e.code === 20 || e.code === 'ABORT_ERR')) return 'cancelled';
      // Any other error: log + fall through to the <a download> fallback
      console.warn('showSaveFilePicker failed, falling back:', e);
    }
  }
  // Fallback: classic <a download> — works everywhere but the user has
  // to find the file in their browser's default download location.
  try {
    triggerDownload(blob, filename);
    return 'fallback';
  } catch (e) {
    console.error('Save failed:', e);
    return 'cancelled';
  }
}

// Save a single canvas (capture or export) to a chosen local folder
export async function saveCaptureToFolder(canvas, suggestedName, onComplete) {
  if (!canvas) return;
  if (!hasFileSystemAccess()) {
    // Fallback: download
    try {
      const blob = await canvasToBlobAsync(canvas, 'image/png');
      const name = sanitizeFilename(suggestedName, 'krafted') + '.png';
      triggerDownload(blob, name);
      toast('Folder picker not supported — downloaded instead');
    } catch (e) {
      console.error(e);
      toast('Save failed: ' + (e.message || e));
    }
    if (onComplete) onComplete();
    return;
  }
  const dirHandle = await pickSaveFolder();
  if (!dirHandle) return; // user cancelled
  try {
    const blob = await canvasToBlobAsync(canvas, 'image/png');
    const baseName = sanitizeFilename(suggestedName, 'krafted');
    const filename = await uniqueFilename(dirHandle, baseName, 'png');
    await writeBlobToFolder(dirHandle, filename, blob);
    toast('Saved to ' + dirHandle.name + '/' + filename);
    if (onComplete) onComplete();
  } catch (e) {
    console.error('Save capture failed', e);
    if (e && e.name === 'SecurityError') {
      toast('Cannot save: image is cross-origin');
    } else if (e && e.name === 'NotAllowedError') {
      toast('Permission denied');
    } else {
      toast('Save failed: ' + (e.message || e));
    }
  }
}

export function saveExportModalToFolder() {
  saveCaptureToFolder(
    document.getElementById('export-canvas'),
    'krafted_export_' + Date.now()
  );
}

export function saveCapturePanelToFolder() {
  saveCaptureToFolder(
    G.captureResultCanvas,
    'krafted_capture_' + Date.now(),
    () => {
      captureResultPanel.classList.remove('show');
      G.captureResultCanvas = null;
      captureResultImg.style.display = '';
    }
  );
}

// Export all images on the board (or only the selected ones) to a chosen local folder
export async function exportAllImagesToFolder() {
  // Determine which images to export
  let images = [];
  const sel = (typeof getSelectedImages === 'function') ? getSelectedImages() : [];
  if (sel && sel.length > 0) {
    images = sel.filter(i => i && i.img && i.src);
  } else {
    images = state.items.filter(i => i && i.img && i.src && !i.isVideo);
  }
  if (images.length === 0) {
    toast('No images to export');
    return;
  }

  if (!hasFileSystemAccess()) {
    // Fallback: download each one
    toast('Folder picker not supported — downloading ' + images.length + ' image' + (images.length === 1 ? '' : 's') + ' one by one');
    let saved = 0;
    for (let i = 0; i < images.length; i++) {
      try {
        const blob = await dataUrlToBlob(images[i].src);
        if (!blob) continue;
        const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        const name = sanitizeFilename('krafted_image_' + (i + 1), 'image') + '.' + ext;
        triggerDownload(blob, name);
        saved++;
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        console.error('Download image failed', i, e);
      }
    }
    toast('Downloaded ' + saved + ' image' + (saved === 1 ? '' : 's'));
    return;
  }

  const dirHandle = await pickSaveFolder();
  if (!dirHandle) return; // user cancelled
  let saved = 0, failed = 0;
  toast('Saving 0/' + images.length + ' to ' + dirHandle.name + '/…');
  for (let i = 0; i < images.length; i++) {
    try {
      const item = images[i];
      const blob = await dataUrlToBlob(item.src);
      if (!blob) { failed++; continue; }
      const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const baseName = sanitizeFilename(item.name || ('image_' + (i + 1)), 'image_' + (i + 1));
      const filename = await uniqueFilename(dirHandle, baseName, ext);
      await writeBlobToFolder(dirHandle, filename, blob);
      saved++;
      toast('Saving ' + saved + '/' + images.length + '…');
    } catch (e) {
      console.error('Save image failed', i, e);
      failed++;
    }
  }
  if (failed === 0) {
    toast('Saved ' + saved + ' image' + (saved === 1 ? '' : 's') + ' to ' + dirHandle.name + '/');
  } else {
    toast('Saved ' + saved + ', failed ' + failed);
  }
}
// R88 — Auto-load .kpak from embedded base64 data.
// When a .kpak is double-clicked, the launcher script base64-encodes the
// entire kpak zip, injects it as window._kraftedAutoLoadKpak, and writes a
// temp HTML file. This block decodes it, unzips, remaps media, and calls
// restoreBoard — no manual "Load" needed.
(function autoLoadKpak() {
  var b64 = window._kraftedAutoLoadKpak;
  if (!b64) return;
  var fname = window._kraftedAutoLoadKpakName || '';
  delete window._kraftedAutoLoadKpak;
  delete window._kraftedAutoLoadKpakName;
  var toastEl = document.getElementById('toast');
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastEl._t); toastEl._t = setTimeout(function(){ toastEl.classList.remove('show'); }, 2000);
  }
  function showProg(msg) {
    var p = document.createElement('div');
    p.className = 'save-progress';
    p.innerHTML = '<div class="pct">' + msg + '</div>';
    document.body.appendChild(p);
    return p;
  }
  function removeProg(p) { if (p && p.parentNode) p.parentNode.removeChild(p); }
  (async function() {
    var prog = null;
    try {
      var fSize = Math.round(b64.length * 0.75);
      prog = showProg('Opening ' + fname + ' (' + formatBytes(fSize) + ')...');

      // R91: Use fetch(data:…) to decode base64 asynchronously instead of
      // atob(b64) which blocks the main thread. For large files (100 MB +)
      // this prevents the browser tab from freezing during decoding.
      var dataUrl = 'data:application/zip;base64,' + b64;
      var resp = await fetch(dataUrl);
      if (!resp.ok) throw new Error('Failed to decode package (HTTP ' + resp.status + ')');
      var zipBlob = await resp.blob();
      prog.innerHTML = '<div class="pct">Unpacking...</div>';
      var zip = await JSZip.loadAsync(zipBlob);
      var manifestFile = zip.file('manifest.json');
      if (!manifestFile) throw new Error('No manifest.json inside kpak');
      var manifestJson = await manifestFile.async('string');
      var data = JSON.parse(manifestJson);
      // Remap media/ entries
      var mediaEntries = Object.keys(zip.files).filter(function(p) { return p.startsWith('media/') && !p.endsWith('/'); });
      var restoredCount = 0;
      for (var j = 0; j < (data.items || []).length; j++) {
        var dataItem = data.items[j];
        var mediPrefix = 'media/' + dataItem.id + '.';
        var entryPath = mediaEntries.find(function(p) { return p.startsWith(mediPrefix); });
        if (!entryPath) continue;
        try {
          var blob = await zip.file(entryPath).async('blob');
          if (blob && blob.size > 0) { dataItem.src = URL.createObjectURL(blob); restoredCount++; }
        } catch(e) { console.warn('Auto-load media failed:', dataItem.id, e); }
        // R91: yield every 2 items to let the browser paint and stay responsive
        if (j % 2 === 1) await new Promise(function(r) { setTimeout(r, 0); });
      }
      if (typeof restoreBoard === 'function' && typeof hideWelcome === 'function') {
        restoreBoard(data);
        hideWelcome();
        // R91: yield after synchronous restore so video elements can start
        // their metadata loading without blocking the main thread.
        await new Promise(function(r) { setTimeout(r, 50); });
        removeProg(prog);
        // R93: Release the decoded zip, base64, and fetch response to help
        // the garbage collector free memory. For large videos, the zip can
        // easily be 100+ MB. The blob URLs we created hold independent
        // copies, so the zip data is no longer needed after restore.
        zip = null; zipBlob = null; b64 = null; resp = null; dataUrl = null;
        if (window._kraftedAutoLoadKpak) { delete window._kraftedAutoLoadKpak; }
        toast('Opened ' + fname + (restoredCount > 0 ? ' (' + restoredCount + ' media)' : ''));
      } else {
        throw new Error('Core functions not loaded');
      }
    } catch(e) {
      removeProg(prog);
      console.error('[AutoLoad] Failed:', e);
      toast('Failed to open: ' + e.message);
    }
  })();
})();
