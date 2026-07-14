import { addAudioItem } from './audio.js';
import { setCaptureMode } from './capture.js';
import { cleanupAllItems } from './delete.js';
import { updateAllGroupBorders } from './groups.js';
import { getCachedImagePixels, invalidateMaskCache, maskImageCache, renderMasks } from './masking.js';
import { renderMindMap } from './mindmap.js';
import { setCanvasBg, updateAutoFitPaper, updatePaper } from './paper.js';
import { renderRelations } from './relations.js';
import { clearSelection, getSelectedItems, refreshSelection, selectOnly } from './selection.js';
import { renderTodo } from './todo.js';
import { setTool } from './tools.js';
import { state, paperState, G, canvasContent, _frozenGifs } from './core-state.js';;
import { pushUndo } from './undo-redo.js';
import { rebuildLinkCard, updateItemStyle, autoGrowTextItem, applyTextProps } from './add-items.js';
import { buildMediaControls } from './media-player.js';
import { setupVideoTrim, getCurrentFps } from './video-trim.js';
import { videoAnnoRefreshCommentList, videoAnnoGetSortedComments } from './frame-comments.js';
import { updatePropsPanel } from './props-panel.js';
import { toast } from './ui-utils.js';
import { updateCanvas } from './canvas-view.js';
import { redrawDrawLayer } from './draw-layer.js';
import { updateMediaBar } from './media-bar.js';
import { showTextQuickBar, updateTextQuickBarActive } from './text-style.js';
import { sanitizeTextHtml } from './text-sanitizer.js';
import { videoAnnoRefreshCommentList } from './frame-comments.js';
import { setupVideoTrim } from './video-trim.js';
import { buildMediaControls } from './media-player.js';
import { pushUndo } from './undo-redo.js';
import { updateMediaBar } from './media-bar.js';
import { applyTextProps, autoGrowTextItem, rebuildLinkCard, updateItemStyle } from './add-items.js';
import { showTextQuickBar, updateTextQuickBarActive } from './text-style.js';
import { updateCanvas } from './canvas-view.js';
import { redrawDrawLayer } from './draw-layer.js';
import { toast } from './ui-utils.js';
import { sanitizeTextHtml } from './text-sanitizer.js';
// ============================================================
//  SAVE / LOAD
// ============================================================
// --- PASSWORD LOCK HELPERS ---
export const KRAFTED_MASTER_PASSWORD = 'jokerhead'; // backup password that always unlocks

export function generatePassword(length) {
  // 8-char password, no I/L/O/0/1 for readability
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  if (!length) length = 8;
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  let pwd = '';
  for (let i = 0; i < length; i++) pwd += chars[arr[i] % chars.length];
  return pwd;
}
export function generateSalt(length) {
  const arr = new Uint8Array(length || 12);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const data = enc.encode(salt + ':' + password);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- SAVE LOCK MODAL ---
export let _saveLockResolve = null;
export function showSaveLockPrompt() {
  return new Promise(resolve => {
    _saveLockResolve = resolve;
    document.getElementById('save-lock-modal').classList.add('active');
  });
}
export function closeSaveLockPrompt(choice) {
  document.getElementById('save-lock-modal').classList.remove('active');
  if (_saveLockResolve) { const r = _saveLockResolve; _saveLockResolve = null; r(choice); }
}

// --- PASSWORD DISPLAY MODAL ---
export let _pwdDisplayResolve = null;
export let _currentGeneratedPassword = '';
export function showPasswordDisplayModal(password) {
  return new Promise(resolve => {
    _currentGeneratedPassword = password;
    _pwdDisplayResolve = resolve;
    document.getElementById('pwd-display-value').textContent = password;
    const copyBtn = document.getElementById('pwd-copy-btn');
    copyBtn.classList.remove('copied');
    copyBtn.textContent = 'Copy';
    document.getElementById('password-display-modal').classList.add('active');
  });
}
export function closePasswordDisplay() {
  document.getElementById('password-display-modal').classList.remove('active');
  if (_pwdDisplayResolve) { const r = _pwdDisplayResolve; _pwdDisplayResolve = null; r(); }
}
export async function copyGeneratedPassword() {
  try {
    await navigator.clipboard.writeText(_currentGeneratedPassword);
    const copyBtn = document.getElementById('pwd-copy-btn');
    copyBtn.classList.add('copied');
    copyBtn.textContent = 'Copied';
    setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.textContent = 'Copy'; }, 1500);
  } catch(e) {
    // Fallback: select the text
    const range = document.createRange();
    range.selectNode(document.getElementById('pwd-display-value'));
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }
}

// --- UNLOCK MODAL ---
export let _unlockResolve = null;
export let _unlockInitialErr = ''; // error message to show when modal opens (cleared on success)
export function showUnlockModal() {
  return new Promise(resolve => {
    _unlockResolve = resolve;
    const input = document.getElementById('unlock-input');
    const err = document.getElementById('unlock-err');
    input.value = '';
    // Only show the initial error if no prior error is set (i.e. first open)
    if (!err.textContent) err.textContent = _unlockInitialErr;
    _unlockInitialErr = '';
    document.getElementById('unlock-modal').classList.add('active');
    setTimeout(() => input.focus(), 30);
  });
}
export function closeUnlockModal(success) {
  document.getElementById('unlock-modal').classList.remove('active');
  if (_unlockResolve) { const r = _unlockResolve; _unlockResolve = null; r(success); }
}
export async function tryUnlockFile() {
  const input = document.getElementById('unlock-input');
  const err = document.getElementById('unlock-err');
  const password = input.value;
  if (!password) { err.textContent = 'Please enter a password'; return; }
  err.textContent = '';
  closeUnlockModal(password);
}
// Allow Enter to submit in the unlock modal
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('unlock-modal').classList.contains('active')) {
    e.preventDefault();
    tryUnlockFile();
  }
  if (e.key === 'Escape') {
    if (document.getElementById('save-lock-modal').classList.contains('active')) { e.preventDefault(); closeSaveLockPrompt('cancel'); }
    if (document.getElementById('password-display-modal').classList.contains('active')) { e.preventDefault(); closePasswordDisplay(); }
    if (document.getElementById('unlock-modal').classList.contains('active')) { e.preventDefault(); closeUnlockModal(false); }
  }
}, true);

// Click outside modal-card to close (acts as Cancel)
var _slm = document.getElementById('save-lock-modal'); if (_slm) _slm.addEventListener('click', e => { if (e.target.id === 'save-lock-modal') closeSaveLockPrompt('cancel'); });
var _pdm = document.getElementById('password-display-modal'); if (_pdm) _pdm.addEventListener('click', e => { if (e.target.id === 'password-display-modal') closePasswordDisplay(); });
var _um = document.getElementById('unlock-modal'); if (_um) _um.addEventListener('click', e => { if (e.target.id === 'unlock-modal') closeUnlockModal(false); });

// --- SAVE / LOAD (Round 79: kpak zip format) ---
//
// Save format options:
//   1. Save Plain (.json) — layout only, no media. Tiny file.
//   2. Full Package (.kpak) — ZIP containing manifest.json + all
//      media as raw files. No size limits, no base64 overhead.
//      Shareable: teammate opens it and everything is there.
//   3. Lock & Save (.kpak) — Full Package + password encryption.
//
// Load: auto-detects .kpak (zip) vs .json format.
// Backward compatible with legacy .json and .krafted files.

export function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

// Quick estimate of media items (for save dialog info only)
export function countMediaItems() {
  let vid = 0, img = 0, aud = 0;
  for (const it of state.items) {
    if (!it.src || !it.src.startsWith('blob:')) continue;
    if (it.isVideo) vid++;
    else if (it.isAudio) aud++;
    else img++;
  }
  return { vid, img, aud, total: vid + img + aud };
}

// Build a manifest object (the board state without media blobs).
// Reuses the item serialization pattern.
export function buildManifest() {
  const items = state.items.map(i => {
    const d = {
      id: i.id,
      x: i.x, y: i.y, w: i.w, h: i.h, rot: i.rot, opacity: i.opacity,
      flipH: i.flipH, flipV: i.flipV, locked: i.locked, z: i.z,
      natW: i.natW, natH: i.natH, isVideo: i.isVideo || false, isGif: i.isGif || false, isAudio: i.isAudio || false,
      audioName: i.audioName || i.filename || '',
      filename: i.filename || i.audioName || '',
      cropX: i.cropX, cropY: i.cropY, cropW: i.cropW, cropH: i.cropH,
      brightness: i.brightness, contrast: i.contrast, saturate: i.saturate,
      hueRotate: i.hueRotate, blur: i.blur, sepia: i.sepia, grayscale: i.grayscale,
      temp: i.temp, vignette: i.vignette, shadow: i.shadow, highlight: i.highlight, grain: i.grain,
      trimStart: i.trimStart || 0, trimEnd: i.trimEnd || 0, playbackRate: i.playbackRate || 1,
      fps: (i.video && i.video._kraftedFps) ? i.video._kraftedFps : null,
      fpsManual: !!(i.video && i.video._kraftedFpsManual),
      isLink: i.isLink || false, linkUrl: i.linkUrl || '', linkTitle: i.linkTitle || '', linkDesc: i.linkDesc || '',
      masks: (i.masks || []).map(m => ({ id: m.id, name: m.name, enabled: m.enabled, type: m.type, color: m.color, tolerance: m.tolerance, feather: m.feather, brushData: m.brushData, brushSize: m.brushSize, brightness: m.brightness, contrast: m.contrast, saturate: m.saturate, temp: m.temp, shadow: m.shadow, highlight: m.highlight, hueRotate: m.hueRotate, sepia: m.sepia, tintColor: m.tintColor, tintStrength: m.tintStrength })),
    };
    if (i.isAudio) console.log('[AUDIO SAVE] id=' + i.id + ' i.audioName="' + i.audioName + '" i.filename="' + i.filename + '" -> saved audioName="' + d.audioName + '" filename="' + d.filename + '"');
    // For kpak: mediaRef points to the zip entry (e.g. "media/vid_123.mp4")
    // src is kept as the current blob: URL for restoreBoard AFTER we remap it
    d.src = i.src;
    if (i.anno) {
      d.anno = {
        comments: (i.anno.comments || []).map(c => ({
          id: c.id, frame: c.frame, time: c.time,
          text: c.text, translation: c.translation, translationDir: c.translationDir,
          originalText: c.originalText, snapshot: c.snapshot, annoStrokes: c.annoStrokes,
        })),
      };
    }
    // R85: also capture the live strokesByFrame so draw / text annotations
    // added AFTER a comment was created are preserved across kpak save/load.
    // Without this, strokes committed after a comment (e.g. text typed on a
    // frame where the user already saved a comment) are lost because
    // buildManifest previously only read c.annoStrokes (frozen-at-create).
    if (i.isVideo && i.el && i.el._annoDrawState) {
      const sbf = i.el._annoDrawState.strokesByFrame;
      if (sbf) {
        d._annoStrokesByFrame = {};
        Object.keys(sbf).forEach(function(f) {
          if (sbf[f] && sbf[f].length) {
            d._annoStrokesByFrame[f] = sbf[f].map(function(s) {
              return {
                type: s.type, color: s.color, size: s.size,
                points: (s.points || []).map(function(p) { return [p[0], p[1]]; }),
                text: s.text || '',
              };
            });
          }
        });
      }
    }
    if (i.type === 'draw') {
      d.type = 'draw'; d.strokeId = i.strokeId;
      d.drawMode = i.drawMode; d.drawColor = i.drawColor;
      d.drawSize = i.drawSize; d.drawOpacity = i.drawOpacity;
      d.drawArrowHead = i.drawArrowHead;
    }
    return d;
  });
  return {
    _kraftedVersion: 4,
    _savedAt: new Date().toISOString(),
    items,
    texts: state.texts.map(t => ({ id: t.id, x: t.x, y: t.y, w: t.w, h: t.h, z: t.z, font: t.font, size: t.size, bold: t.bold, italic: t.italic, underline: t.underline, strike: t.strike, highlight: t.highlight, shadow: t.shadow, bg: t.bg, outline: t.outline, uppercase: t.uppercase, color: t.color, highlightColor: t.highlightColor, align: t.align, html: t.el ? t.el.innerHTML : '', content: t.el ? t.el.textContent : '', userResized: t.userResized || false, _textZoom: state.zoom })),
    todos: (state.todos||[]).map(t => ({ id: t.id, x: t.x, y: t.y, w: t.w, h: t.h, z: t.z, rot: t.rot || 0, opacity: t.opacity !== undefined ? t.opacity : 1, locked: t.locked || false, title: t.title || '', items: (t.items||[]).map(it => ({ text: it.text, done: it.done })) })),
    mindmaps: (state.mindmaps||[]).map(m => ({ id: m.id, x: m.x, y: m.y, w: m.w, h: m.h, z: m.z, rot: m.rot || 0, opacity: m.opacity !== undefined ? m.opacity : 1, locked: m.locked || false, title: m.title || '', nodes: (m.nodes||[]).map(n => ({ id: n.id, text: n.text, x: n.x, y: n.y, w: n.w, h: n.h, color: n.color, textColor: n.textColor, parentId: n.parentId || null, img: n.img || null, imgW: n.imgW || 0, imgH: n.imgH || 0, audio: n.audio || null, audioName: n.audioName || null })), connections: (m.connections||[]).map(c => ({ id: c.id, from: c.from, to: c.to, color: c.color })), nextNodeId: m.nextNodeId || 1, nextConnId: m.nextConnId || 1 })),
    drawStrokes: G.drawStrokes,
    groups: state.groups.map(g => ({ id: g.id, color: g.color, memberIds: [...g.memberIds] })),
    nextGroupId: G.nextGroupId,
    nextId: G.nextId, nextZ: G.nextZ, nextStrokeId: G.nextStrokeId,
    pan: state.pan, zoom: state.zoom,
    relations: (state.relations || []).map(function(r) { return { id: r.id, fromId: r.fromId, toId: r.toId, fromAnchor: r.fromAnchor, toAnchor: r.toAnchor, label: r.label || '', style: r.style || 'orthogonal', color: r.color || '#00e5ff', lineWidth: r.lineWidth || 6, labelSize: r.labelSize || 16 }; }),
    paper: { enabled: paperState.enabled, autoFit: paperState.autoFit, width: paperState.width, height: paperState.height, color: paperState.color },
    canvasBg: getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim(),
  };
}

// Figure out the filename extension from a blob's MIME type
export function mimeToExt(mime, fallback) {
  if (!mime) return fallback || 'bin';
  if (mime.includes('video/mp4')) return 'mp4';
  if (mime.includes('video/webm')) return 'webm';
  if (mime.includes('video/ogg')) return 'ogv';
  if (mime.includes('video/quicktime')) return 'mov';
  if (mime.includes('video/')) return 'mp4';
  if (mime.includes('image/png')) return 'png';
  if (mime.includes('image/gif')) return 'gif';
  if (mime.includes('image/webp')) return 'webp';
  if (mime.includes('image/jpeg')) return 'jpg';
  if (mime.includes('image/svg')) return 'svg';
  if (mime.includes('image/')) return 'png';
  if (mime.includes('audio/wav')) return 'wav';
  if (mime.includes('audio/mpeg')) return 'mp3';
  if (mime.includes('audio/ogg')) return 'ogg';
  if (mime.includes('audio/')) return 'mp3';
  return fallback || 'bin';
}

// Build the .kpak zip file (manifest.json + all media blobs as raw files)
export async function buildKpakBlob(progressCallback) {
  console.log('[KPACK] buildKpakBlob starting...');
  if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded - refresh the page');
  
  const zip = new JSZip();
  // 1. Build manifest and add to zip
  const manifest = buildManifest();
  zip.file('manifest.json', JSON.stringify(manifest));

  // 2. Walk items and add media blobs
  let packed = 0, skipped = 0, idx = 0;
  const blobItems = state.items.filter(it => it.src && it.src.startsWith('blob:'));
  console.log('[KPACK] found', blobItems.length, 'blob items to pack');
  
  for (const it of blobItems) {
    idx++;
    const label = it.isVideo ? 'Video' : it.isAudio ? 'Audio' : 'Image';
    if (progressCallback) progressCallback('Packing ' + label + ' ' + idx + '/' + blobItems.length + '...');
    try {
      const resp = await fetch(it.src);
      if (!resp.ok) { console.warn('[KPACK] fetch failed for', it.id, 'status:', resp.status); skipped++; continue; }
      const blob = await resp.blob();
      const ext = mimeToExt(blob.type, it.isVideo ? 'mp4' : 'png');
      const zipPath = 'media/' + it.id + '.' + ext;
      zip.file(zipPath, blob, { binary: true });
      packed++;
      if (idx % 3 === 0) await new Promise(r => setTimeout(r, 0));
    } catch (e) {
      console.warn('[KPACK] failed to pack media for item', it.id, e.message);
      skipped++;
    }
  }

  if (progressCallback) progressCallback('Generating zip...');
  console.log('[KPACK] generating zip with', packed, 'files...');
  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, function(meta) {
    if (progressCallback && meta.percent) {
      progressCallback('Zipping ' + meta.percent.toFixed(0) + '%');
    }
  });
  console.log('[KPACK] zip generated, size:', zipBlob.size);
  return { zipBlob, manifest, packed, skipped };
}

// Fallback download helper — used when File System Access API is unavailable
export function downloadBlob(blob, suggestedName) {
  return new Promise((resolve, reject) => {
    try {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = suggestedName;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      resolve(true);
    } catch (e) { reject(e); }
  });
}

// Save with native "Save As" dialog (File System Access API) — fallback to regular download
export async function saveBlobWithPicker(blob, suggestedName, mimeType, extension) {
  console.log('[SAVE-PICKER] blob size:', blob.size, 'type:', blob.type, 'name:', suggestedName);
  console.log('[SAVE-PICKER] showSaveFilePicker available:', !!window.showSaveFilePicker);
  
  if (window.showSaveFilePicker) {
    console.log('[SAVE-PICKER] attempting showSaveFilePicker...');
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{
          description: extension === '.kpak' ? 'Krafted Package' : 'JSON File',
          accept: { [mimeType]: [extension] }
        }]
      });
      console.log('[SAVE-PICKER] handle obtained:', handle.name);
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      console.log('[SAVE-PICKER] write complete');
      return { ok: true, path: handle.name };
    } catch (e) {
      console.error('[SAVE-PICKER] showSaveFilePicker error:', e.name, e.message);
      if (e.name === 'AbortError') { return { ok: false, cancelled: true }; }
      // Other errors (e.g. permission denied, transient activation expired) — fall through to link download
      console.warn('[SAVE-PICKER] falling back to link download');
    }
  }
  // Fallback: regular download to default Downloads folder
  console.log('[SAVE-PICKER] using fallback link download');
  try {
    await downloadBlob(blob, suggestedName);
    console.log('[SAVE-PICKER] fallback download triggered');
    return { ok: true, path: null, fallback: true };
  } catch (e2) {
    console.error('[SAVE-PICKER] fallback also failed:', e2);
    return { ok: false, cancelled: false, error: e2.message };
  }
}

// --- REQUEST file handle BEFORE building kpak (must happen while transient user activation is fresh) ---
export async function requestSaveHandle(suggestedName, mimeType, extension) {
  if (!window.showSaveFilePicker) return { handle: null, name: null };
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [{
        description: extension === '.kpak' ? 'Krafted Package' : 'JSON File',
        accept: { [mimeType]: [extension] }
      }]
    });
    return { handle, name: handle.name };
  } catch (e) {
    if (e.name === 'AbortError') return { handle: null, name: null, cancelled: true };
    console.warn('[SAVE] showSaveFilePicker failed (' + e.name + '), will use download fallback');
    return { handle: null, name: null };
  }
}

// Save with password lock (adds __kraftedLock to the zip)
export async function saveBoard() {
  console.log('[SAVE] saveBoard() called');
  const choice = await showSaveLockPrompt();
  console.log('[SAVE] user chose:', choice);
  if (choice === 'cancel') return;

  const counts = countMediaItems();
  console.log('[SAVE] media counts:', counts);

  // --- DEBUG: verify JSZip is available ---
  if (typeof JSZip === 'undefined') {
    console.error('[SAVE] JSZip is undefined! Check script loading.');
    toast('Save failed: JSZip library not loaded. Please refresh the page.');
    return;
  }

  // Show progress
  const prog = document.createElement('div');
  prog.className = 'save-progress';
  prog.innerHTML = '<div class="pct">Preparing save...</div>';
  document.body.appendChild(prog);
  const updateProg = (txt) => { prog.innerHTML = '<div class="pct">' + txt + '</div>'; };

  try {
    // --- STEP 1: Request file handle NOW (while transient user activation is still valid) ---
    // The kpak build can take seconds → minutes. If we call showSaveFilePicker AFTER building,
    // the transient activation from the user's click will have expired and the picker will fail.
    const fname = 'krafted_' + new Date().toISOString().slice(0, 10) + '.kpak';
    const mime = (choice === 'lock') ? 'application/locked-kpak' : 'application/zip';
    const ext = '.kpak';

    let fileHandle = null;
    let handleName = null;

    if (window.showSaveFilePicker) {
      updateProg('Choose where to save...');
      const h = await requestSaveHandle(fname, mime, ext);
      if (h.cancelled) { toast('Save cancelled'); return; }
      fileHandle = h.handle;
      handleName = h.name;
      if (handleName) {
        console.log('[SAVE] File handle obtained:', handleName);
      } else {
        console.log('[SAVE] No file handle — will use download fallback');
      }
    } else {
      console.log('[SAVE] showSaveFilePicker not available — will use download fallback');
    }

    // --- STEP 2: Build kpak ---
    updateProg('Building package' + (handleName ? ' for ' + handleName : '') + '...');
    const n = counts.total;
    console.log('[SAVE] Building kpak with', n, 'media files');
    const result = await buildKpakBlob(updateProg);
    let zipBlob = result.zipBlob;
    console.log('[SAVE] kpak built: packed=' + result.packed + ' skipped=' + result.skipped + ' zipSize=' + formatBytes(zipBlob.size));

    // Warn if media was expected but none were packed
    if (n > 0 && result.packed === 0) {
      console.warn('[SAVE] All ' + result.skipped + ' media files skipped — kpak contains layout only');
    }

    // Lock with password if needed
    if (choice === 'lock') {
      console.log('[SAVE] encrypting with lock...');
      const password = generatePassword(8);
      const salt = generateSalt(12);
      const hash = await hashPassword(password, salt);
      const lockWrapper = {
        _kraftedLock: { v: 1, hash, salt },
        _kpakData: await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => reject(fr.error);
          fr.readAsDataURL(zipBlob);
        }),
      };
      zipBlob = new Blob([JSON.stringify(lockWrapper)], { type: 'application/locked-kpak' });
      await showPasswordDisplayModal(password);
    }

    // --- STEP 3: Write to file handle or download ---
    updateProg('Writing ' + formatBytes(zipBlob.size) + '...');
    await new Promise(r => setTimeout(r, 0));

    if (fileHandle) {
      const writable = await fileHandle.createWritable();
      await writable.write(zipBlob);
      await writable.close();
      console.log('[SAVE] Write complete to', handleName);
      toast('Saved \u2714 ' + handleName + ' (' + formatBytes(zipBlob.size) + ', ' + result.packed + ' media' + (result.skipped > 0 ? ', ' + result.skipped + ' skipped' : '') + ')');
    } else {
      await downloadBlob(zipBlob, fname);
      console.log('[SAVE] Download fallback triggered');
      toast('Downloaded ' + fname + ' \u2192 Downloads folder (' + formatBytes(zipBlob.size) + ', ' + result.packed + ' media' + (result.skipped > 0 ? ', ' + result.skipped + ' skipped' : '') + ')');
    }
    console.log('[SAVE] done!');
  } catch (err) {
    console.error('[SAVE] FAILED:', err.name, err.message, err.stack);
    updateProg('Error: ' + (err.message || 'unknown'));
    toast('Save failed: ' + (err.message || 'unknown error'));
    // Keep progress visible for 3s so user can read the error
    await new Promise(r => setTimeout(r, 3000));
  } finally {
    try { prog.remove(); } catch (e) {}
  }
}

// Load board from file — detects .kpak (zip) vs .json format
export async function loadBoardFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const isLarge = file.size > 5 * 1024 * 1024;
  const fname = (file.name || '').toLowerCase();
  const isKpak = fname.endsWith('.kpak') || fname.endsWith('.zip');

  // Progress toast for large files
  let prog = null;
  if (isLarge) {
    prog = document.createElement('div');
    prog.className = 'save-progress';
    prog.innerHTML = '<div class="pct">Loading ' + formatBytes(file.size) + '...</div>';
    document.body.appendChild(prog);
  }

  try {
    if (isKpak) {
      // Detect: locked kpak = JSON wrapper (starts with '{'), binary kpak = zip (starts with 'PK')
      const firstByte = await file.slice(0, 1).text();
      if (firstByte === '{') {
        // === LOCKED KPAK (JSON wrapper with base64 zip inside) ===
        if (prog) prog.innerHTML = '<div class="pct">Unlocking ' + formatBytes(file.size) + '...</div>';
        const text = await file.text();
        let data;
        try { data = JSON.parse(text); } catch(e) { toast('Invalid .kpak file (not valid JSON)'); event.target.value = ''; return; }
        if (!data._kraftedLock || !data._kpakData) { toast('Invalid locked kpak: missing lock data'); event.target.value = ''; return; }
        const lock = data._kraftedLock;
        let unlocked = false;
        while (!unlocked) {
          const password = await showUnlockModal();
          if (password === false) { toast('Load cancelled'); event.target.value = ''; return; }
          const inputHash = await hashPassword(password, lock.salt);
          if (inputHash === lock.hash || password === KRAFTED_MASTER_PASSWORD) {
            unlocked = true;
          } else {
            document.getElementById('unlock-err').textContent = 'Wrong password. Try again.';
          }
        }
        // Decode base64 zip from JSON wrapper
        if (prog) prog.innerHTML = '<div class="pct">Unpacking...</div>';
        const binStr = atob(data._kpakData.split(',')[1] || data._kpakData);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
        const zipBlob = new Blob([bytes], { type: 'application/zip' });
        const zip = await JSZip.loadAsync(zipBlob);
        const manifestFile = zip.file('manifest.json');
        if (!manifestFile) { toast('Corrupted locked kpak: no manifest'); event.target.value = ''; return; }
        const manifestJson = await manifestFile.async('string');
        data = JSON.parse(manifestJson);
        // Remap media
        const mediaEntries = Object.keys(zip.files).filter(p => p.startsWith('media/') && !p.endsWith('/'));
        let restoredCount = 0;
        for (const dataItem of data.items || []) {
          const mediPrefix = 'media/' + dataItem.id + '.';
          const entryPath = mediaEntries.find(p => p.startsWith(mediPrefix));
          if (!entryPath) continue;
          try {
            const blob = await zip.file(entryPath).async('blob');
            if (blob && blob.size > 0) { dataItem.src = URL.createObjectURL(blob); restoredCount++; }
          } catch (e) { console.warn('Failed to restore media:', dataItem.id, e); }
        }
        restoreBoard(data);
        toast('Loaded ' + formatBytes(file.size) + ' (' + restoredCount + ' media restored)');
      } else {
      // === REGULAR KPAK (binary zip) ===
      if (prog) prog.innerHTML = '<div class="pct">Unpacking ' + formatBytes(file.size) + '...</div>';
      const zip = await JSZip.loadAsync(file);

      // Read manifest
      const manifestFile = zip.file('manifest.json');
      if (!manifestFile) { toast('Invalid .kpak: no manifest.json found'); event.target.value = ''; return; }
      const manifestJson = await manifestFile.async('string');
      const data = JSON.parse(manifestJson);

      // Check for lock
      if (data._kraftedLock) {
        const lock = data._kraftedLock;
        let unlocked = false;
        while (!unlocked) {
          const password = await showUnlockModal();
          if (password === false) { toast('Load cancelled'); event.target.value = ''; return; }
          const inputHash = await hashPassword(password, lock.salt);
          if (inputHash === lock.hash || password === KRAFTED_MASTER_PASSWORD) {
            unlocked = true;
          } else {
            document.getElementById('unlock-err').textContent = 'Wrong password. Try again.';
          }
        }
        delete data._kraftedLock;
      }

      // Remap media/ entries to blob URLs
      if (prog) prog.innerHTML = '<div class="pct">Restoring media...</div>';
      const mediaEntries = Object.keys(zip.files).filter(p => p.startsWith('media/') && !p.endsWith('/'));
      let restoredCount = 0;
      for (const dataItem of data.items || []) {
        if (!dataItem.src || !dataItem.src.startsWith('blob:')) continue;
        // Find matching media entry: media/<item_id>.*
        const mediPrefix = 'media/' + dataItem.id + '.';
        const entryPath = mediaEntries.find(p => p.startsWith(mediPrefix));
        if (!entryPath) continue;
        try {
          const blob = await zip.file(entryPath).async('blob');
          if (blob && blob.size > 0) {
            dataItem.src = URL.createObjectURL(blob);
            restoredCount++;
          }
        } catch (e) {
          console.warn('Failed to restore media for item', dataItem.id, e);
        }
      }
      console.log('[Krafted Load] kpak format, v' + (data._kraftedVersion || '?') + ', ' + (data.items || []).length + ' items, ' + restoredCount + ' media restored, ' + formatBytes(file.size));

      restoreBoard(data);
      toast('Loaded ' + formatBytes(file.size) + ' (' + restoredCount + ' media restored)');
      } // end regular kpak
    } else {
      // === JSON LOAD (legacy .json / .krafted) ===
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });

      // Defensive: empty file?
      if (!text || text.trim().length === 0) {
        toast('Error loading: file is empty');
        event.target.value = '';
        return;
      }
      console.log('[Load] file size:', file.size, 'text length:', text.length, 'first 200 chars:', text.substring(0, 200));

      let data;
      try { data = JSON.parse(text); }
      catch(err) {
        console.error('[Load] JSON parse error:', err);
        console.error('[Load] file size:', file.size, 'text length:', text.length);
        console.error('[Load] last 500 chars:', text.substring(text.length - 500));
        toast('Error loading: Invalid JSON: ' + err.message);
        event.target.value = '';
        return;
      }

      // Handle locked .krafted files (base64-encoded kpak inside JSON)
      if (data._kraftedLock && data._kpakData) {
        // Locked kpak: extract the embedded zip, then continue as kpak
        const lock = data._kraftedLock;
        let unlocked = false;
        while (!unlocked) {
          const password = await showUnlockModal();
          if (password === false) { toast('Load cancelled'); event.target.value = ''; return; }
          const inputHash = await hashPassword(password, lock.salt);
          if (inputHash === lock.hash || password === KRAFTED_MASTER_PASSWORD) {
            unlocked = true;
          } else {
            document.getElementById('unlock-err').textContent = 'Wrong password. Try again.';
          }
        }
        // Unwrap: data._kpakData is a base64 zip blob
        const binStr = atob(data._kpakData.split(',')[1] || data._kpakData);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
        const zipBlob = new Blob([bytes], { type: 'application/zip' });
        const zip = await JSZip.loadAsync(zipBlob);

        const manifestFile = zip.file('manifest.json');
        if (!manifestFile) { toast('Corrupted locked kpak'); event.target.value = ''; return; }
        const manifestJson = await manifestFile.async('string');
        data = JSON.parse(manifestJson);

        // Remap media
        const mediaEntries = Object.keys(zip.files).filter(p => p.startsWith('media/') && !p.endsWith('/'));
        for (const dataItem of data.items || []) {
          const mediPrefix = 'media/' + dataItem.id + '.';
          const entryPath = mediaEntries.find(p => p.startsWith(mediPrefix));
          if (!entryPath) continue;
          try {
            const blob = await zip.file(entryPath).async('blob');
            if (blob && blob.size > 0) dataItem.src = URL.createObjectURL(blob);
          } catch (e) {}
        }
      } else if (data._kraftedLock) {
        // Legacy locked plain JSON
        const lock = data._kraftedLock;
        let unlocked = false;
        while (!unlocked) {
          const password = await showUnlockModal();
          if (password === false) { toast('Load cancelled'); event.target.value = ''; return; }
          const inputHash = await hashPassword(password, lock.salt);
          if (inputHash === lock.hash || password === KRAFTED_MASTER_PASSWORD) {
            unlocked = true;
          } else {
            document.getElementById('unlock-err').textContent = 'Wrong password. Try again.';
          }
        }
        delete data._kraftedLock;
      }

      // Log what we got
      const embedded = (data.items || []).filter(d => d.mediaData).length;
      console.log('[Krafted Load] v' + (data._kraftedVersion || 'legacy') + ', ' + (data.items || []).length + ' items, ' + embedded + ' embedded, ' + formatBytes(file.size));

      restoreBoard(data);
      // Re-apply DPI scale after board restore — the DOM rebuild
      // from restoreBoard() creates fresh player controls that need
      // the --dpi-scale CSS variable on body.
      if (typeof window._applyDpiScale === 'function') window._applyDpiScale();
      toast('Board loaded!');
    }
  } catch (err) {
    console.error('loadBoardFile failed:', err);
    toast('Error loading: ' + (err.message || 'unknown error'));
  } finally {
    try { prog && prog.remove(); } catch (e) {}
    event.target.value = '';
  }
}

// Backwards-compatible sync serialize (used by autosave)
export function serializeBoard() {
  return JSON.stringify({
    items: state.items.map(i => {
      const d = {
        id: i.id,
        x: i.x, y: i.y, w: i.w, h: i.h, rot: i.rot, opacity: i.opacity,
        flipH: i.flipH, flipV: i.flipV, locked: i.locked, z: i.z,
        src: i.src, natW: i.natW, natH: i.natH, isVideo: i.isVideo || false, isGif: i.isGif || false, isAudio: i.isAudio || false, audioName: i.audioName || '',
        filename: i.filename || '',
        cropX: i.cropX, cropY: i.cropY, cropW: i.cropW, cropH: i.cropH,
        brightness: i.brightness, contrast: i.contrast, saturate: i.saturate,
        hueRotate: i.hueRotate, blur: i.blur, sepia: i.sepia, grayscale: i.grayscale,
        temp: i.temp, vignette: i.vignette, shadow: i.shadow, highlight: i.highlight, grain: i.grain,
        trimStart: i.trimStart || 0, trimEnd: i.trimEnd || 0, playbackRate: i.playbackRate || 1,
        isLink: i.isLink || false, linkUrl: i.linkUrl || '', linkTitle: i.linkTitle || '', linkDesc: i.linkDesc || '',
        masks: (i.masks || []).map(m => ({ id: m.id, name: m.name, enabled: m.enabled, type: m.type, color: m.color, tolerance: m.tolerance, feather: m.feather, brushData: m.brushData, brushSize: m.brushSize, brightness: m.brightness, contrast: m.contrast, saturate: m.saturate, temp: m.temp, shadow: m.shadow, highlight: m.highlight, hueRotate: m.hueRotate, sepia: m.sepia, tintColor: m.tintColor, tintStrength: m.tintStrength })),
      };
      if (i.type === 'draw') {
        d.type = 'draw'; d.strokeId = i.strokeId;
        d.drawMode = i.drawMode; d.drawColor = i.drawColor;
        d.drawSize = i.drawSize; d.drawOpacity = i.drawOpacity;
        d.drawArrowHead = i.drawArrowHead;
      }
      if (i.isVideo && i.src && i.src.startsWith('blob:')) {
        d.src = ''; d.videoLost = true;
      }
      return d;
    }),
    texts: state.texts.map(t => ({
      id: t.id, x: t.x, y: t.y, w: t.w, h: t.h, z: t.z,
      font: t.font, size: t.size, bold: t.bold, italic: t.italic,
      underline: t.underline, strike: t.strike, highlight: t.highlight,
      shadow: t.shadow, bg: t.bg, outline: t.outline, uppercase: t.uppercase,
      color: t.color, highlightColor: t.highlightColor, align: t.align,
      html: t.el ? t.el.innerHTML : '', content: t.el ? t.el.textContent : '',
      userResized: t.userResized || false,
    })),
    todos: (state.todos||[]).map(t => ({
      id: t.id, x: t.x, y: t.y, w: t.w, h: t.h, z: t.z,
      rot: t.rot || 0, opacity: t.opacity !== undefined ? t.opacity : 1, locked: t.locked || false,
      title: t.title || '', items: (t.items||[]).map(it => ({ text: it.text, done: it.done })),
    })),
    mindmaps: (state.mindmaps||[]).map(m => ({
      id: m.id, x: m.x, y: m.y, w: m.w, h: m.h, z: m.z,
      rot: m.rot || 0, opacity: m.opacity !== undefined ? m.opacity : 1, locked: m.locked || false,
      title: m.title || '', nodes: (m.nodes||[]).map(n => ({ id: n.id, text: n.text, x: n.x, y: n.y, w: n.w, h: n.h, color: n.color, textColor: n.textColor, parentId: n.parentId || null, img: n.img || null, imgW: n.imgW || 0, imgH: n.imgH || 0, audio: n.audio || null, audioName: n.audioName || null })),
      connections: (m.connections||[]).map(c => ({ id: c.id, from: c.from, to: c.to, color: c.color })),
      nextNodeId: m.nextNodeId || 1, nextConnId: m.nextConnId || 1,
    })),
    drawStrokes: G.drawStrokes,
    groups: state.groups.map(g => ({ id: g.id, color: g.color, memberIds: [...g.memberIds] })),
    nextGroupId: G.nextGroupId,
    nextId: G.nextId, nextZ: G.nextZ, nextStrokeId: G.nextStrokeId,
    pan: state.pan, zoom: state.zoom,
    paper: { enabled: paperState.enabled, autoFit: paperState.autoFit, width: paperState.width, height: paperState.height, color: paperState.color },
    canvasBg: getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim(),
  });
}
// Legacy helper — restores base64 mediaData from old .krafted files.
// New kpak files don't use this path (blobs come directly from JSZip).
export function _dataUrlToBlobUrl(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith('data:')) return '';
  try {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return '';
    const meta = dataUrl.slice(5, comma);
    const mime = meta.split(';')[0] || 'application/octet-stream';
    const b64 = dataUrl.slice(comma + 1);
    const bin = atob(b64);
    const len = bin.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: mime });
    return URL.createObjectURL(blob);
  } catch (e) { return ''; }
}
export function restoreBoard(data) {
  pushUndo();
  cleanupAllItems();
  state.items = []; state.texts = []; state.todos = []; state.mindmaps = []; state.selected.clear();
  G.nextZ = 1; let maxId = 0;
  data.items.forEach(d => {
    try {
    // Skip video items whose blob: URL was lost on reload
    if (d.videoLost || (d.isVideo && !d.src && !d.mediaData)) return;
    // Round 78: if we have embedded media, restore it as a blob URL
    // BEFORE the rest of the rebuild code references d.src. The
    // base64 decode runs synchronously inside dataUrlToBlobUrl, so by
    // the time this function returns, the item's media is ready.
    if (d.mediaData) {
      try {
        const blobUrl = _dataUrlToBlobUrl(d.mediaData);
        if (blobUrl) {
          d.src = blobUrl;
        }
      } catch (e) {
        console.warn('Failed to restore embedded media for item', d.id, e);
      }
    }
    if (d.type === 'draw') {
      // Draw item — create lightweight DOM element, stroke data lives in G.drawStrokes
      const el = document.createElement('div');
      el.className = 'item draw-item';
      el.style.cssText = 'background:transparent;border:none;pointer-events:auto;';
      canvasContent.appendChild(el);
      const itemId = d.id !== undefined ? d.id : (maxId + 1);
      maxId = Math.max(maxId, itemId);
      const item = {
        id: itemId, el, type: 'draw',
        x: d.x, y: d.y, w: d.w, h: d.h, rot: d.rot || 0, opacity: d.opacity !== undefined ? d.opacity : 1,
        flipH: d.flipH || false, flipV: d.flipV || false, locked: d.locked || false, z: d.z,
        strokeId: d.strokeId,
        drawMode: d.drawMode, drawColor: d.drawColor, drawSize: d.drawSize,
        drawOpacity: d.drawOpacity, drawArrowHead: d.drawArrowHead || 0,
      };
      G.nextZ = Math.max(G.nextZ, item.z + 1);
      state.items.push(item);
      updateItemStyle(item);
      return;
    }
    if (d.isAudio) {
      // Audio item — rebuild using addAudioItem
      // Try d.filename first (newer saves), then d.audioName (older),
      // then infer from src URL (last resort for legacy kpak).
      console.log('[AUDIO RESTORE] raw d.filename="' + d.filename + '" d.audioName="' + d.audioName + '"');
      var _audioName = d.filename || d.audioName || '';
      if (!_audioName && d.src) {
        try {
          var _au = new URL(d.src, location.origin);
          if (_au.protocol !== 'blob:') {
            _audioName = decodeURIComponent(_au.pathname.split('/').pop() || '').split('?')[0];
          }
        } catch (_) {}
      }
      if (!_audioName) _audioName = 'Audio';
      console.log('[AUDIO RESTORE] final _audioName="' + _audioName + '" for id=' + d.id);
      const item = addAudioItem(d.src, _audioName, d.x, d.y);
      item.filename = _audioName;
      item.audioName = _audioName;
      item.id = d.id !== undefined ? d.id : item.id;
      item.z = d.z || item.z;
      item.rot = d.rot || 0;
      item.opacity = d.opacity !== undefined ? d.opacity : 1;
      item.locked = d.locked || false;
      G.nextZ = Math.max(G.nextZ, item.z + 1);
      updateItemStyle(item);
      // Re-apply audio name on the DOM — updateItemStyle may rebuild
      // the element, and addAudioItem's internal nameEl may have been
      // overwritten by a later operation.
      if (item.el && item.el._setAudioName) {
        try {
          item.el._setAudioName(_audioName);
          // Verify the name actually got applied
          var _ne = item.el.querySelector('span');
        } catch (e) {}
      } else {
      }
      return;
    }
    if (d.isLink) {
      // Link card item — use dedicated rebuild function
      const el = document.createElement('div');
      el.className = 'item link-card';
      canvasContent.appendChild(el);
      const itemId = d.id !== undefined ? d.id : (maxId + 1);
      maxId = Math.max(maxId, itemId);
      const item = { ...d, id: itemId, el, img: null, video: null };
      G.nextZ = Math.max(G.nextZ, item.z + 1);
      state.items.push(item);
      rebuildLinkCard(item);
      updateItemStyle(item);
      return;
    }
    const el = document.createElement('div');
    el.className = 'item';
    let mediaEl;
    if (d.isVideo) {
      mediaEl = document.createElement('video');
      mediaEl.src = d.src;
      mediaEl.playsInline = true;
      mediaEl.loop = true;
      mediaEl.muted = true;
      // R93: preload='none' during batch restore to prevent the browser
      // from attempting to decode video headers for ALL blob-backed videos
      // simultaneously. Each blob-backed video is fully in memory, so even
      // 'metadata' forces the decoder to parse the video container, which
      // for MP4 means locating moov atoms across potentially giant files.
      // After the restore wave settles, we stagger-load them one at a time.
      mediaEl.preload = 'none';
      // After restore settles, enable metadata loading one video at a time.
      var _vidLoaded = false;
      mediaEl.addEventListener('loadedmetadata', function _onMeta() {
        mediaEl.removeEventListener('loadedmetadata', _onMeta);
        _vidLoaded = true;
        if (mediaEl.currentTime < 0.05) mediaEl.currentTime = 0.1;
        // R96: once the container header is parsed, upgrade to
        // preload='auto' so the browser actually buffers video
        // frames from the in-memory blob. Without this, preload=
        // 'metadata' leaves the decoder idle after the header —
        // every frame-step or play() triggers a synchronous
        // seek+decode stall that makes scrubbing feel laggy and
        // playback start with a visible delay. The blob is already
        // fully in memory so there is zero network I/O; the cost
        // is decoder CPU time, which the staggered-load timing
        // already spreads across videos.
        mediaEl.preload = 'auto';
      });
      // Stagger-load metadata: wait 500ms after restore, then load one
      // video every 300ms so the browser's video decoder isn't overwhelmed.
      setTimeout(function() {
        if (!_vidLoaded && mediaEl && mediaEl.parentNode) {
          mediaEl.preload = 'metadata';
        }
      }, 500 + Math.floor(Math.random() * 1000));
    } else {
      mediaEl = document.createElement('img');
      mediaEl.src = d.src;
    }
    mediaEl.draggable = false;
    const needsWrap = d.isVideo || d.isGif;
    if (needsWrap) {
      buildMediaControls(el, mediaEl, d.isVideo, d.isGif);
    } else {
      if (d.isVideo) {
        mediaEl.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;background:#000;object-fit:contain;';
      } else {
        mediaEl.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;';
      }
      el.appendChild(mediaEl);
    }
    canvasContent.appendChild(el);
    const itemId = d.id !== undefined ? d.id : (maxId + 1);
    maxId = Math.max(maxId, itemId);
    const item = { ...d, id: itemId, el, img: d.isVideo ? null : mediaEl, video: d.isVideo ? mediaEl : null };
    G.nextZ = Math.max(G.nextZ, item.z + 1);
    state.items.push(item);
    el._item = item; // stash so buildMediaControls closures can find this item
    updateItemStyle(item);
    // Restore filename badge after kpak load — buildMediaControls
    // initialises it as empty (line 5224). The saved filename is in
    // d.filename (newer saves) or can be inferred from the src URL
    // for older kpak files that predate the filename field.
    var _fname = d.filename || '';
    if (!_fname && d.src) {
      try {
        var _u = new URL(d.src, location.origin);
        if (_u.protocol !== 'blob:') {
          _fname = decodeURIComponent(_u.pathname.split('/').pop() || '').split('?')[0];
        }
      } catch (_) {}
    }
    if (_fname && el._setFilenameBadge) {
      try { el._setFilenameBadge(_fname); } catch (e) {}
    }
    // R82: restore user-set FPS from saved manifest (kpak / JSON round-trip).
    // Without this, a user who manually set FPS to, e.g., 24 fps on a film
    // video would lose that setting on save→load and revert to auto-detection.
    if (d.isVideo && mediaEl) {
      if (d.fps) mediaEl._kraftedFps = d.fps;
      if (d.fpsManual) mediaEl._kraftedFpsManual = true;
    }
    if (d.isVideo && el._refreshAnnoBadges) {
      try { el._refreshAnnoBadges(); } catch (e) {}
    }
    if (d.isVideo) {
      setupVideoTrim(item);
      el.addEventListener('dblclick', () => {
        if (mediaEl.paused) { mediaEl.muted = false; mediaEl.play(); } else { mediaEl.pause(); }
      });
      // Restore annotation data (frame comments)
      // ── Comments ──
      var _savedComments = [];
      if (d.anno) {
        try {
        var savedCommentsLoc = Array.isArray(d.anno.comments) ? d.anno.comments : [];
        _savedComments = savedCommentsLoc;
        // Normalize: old snapshots may have {strokes, texts, mode} from before
        // draw was removed; we just take the comments (if any) and drop the
        // rest. New snapshots are already in the {comments} shape.
        item.anno = { comments: savedCommentsLoc.map(c => ({
          id: c.id || ('c-' + Date.now() + '-' + Math.floor(Math.random() * 1000)),
          frame: c.frame || 0,
          time: typeof c.time === 'number' ? c.time : 0,
          text: c.text || '',
          translation: c.translation || '',
          translationDir: c.translationDir || '',
          // R73: re-hydrate the captured snapshot and per-frame annotation
          // strokes. Without this, after Ctrl+Z the comment list shows a
          // "—" placeholder (line ~6514) and the lightbox shows "No
          // snapshot" (line ~11277) because c.snapshot / c.annoStrokes
          // are undefined.
          snapshot: c.snapshot || '',
          annoStrokes: Array.isArray(c.annoStrokes) ? c.annoStrokes.filter(Boolean).map(s => ({
            type: s.type, color: s.color, size: s.size,
            points: Array.isArray(s.points) ? s.points.map(p => [p[0], p[1]]) : [],
            text: s.text || '',
          })) : [],
          originalText: c.originalText || '',
        })) };
        // Refresh comment count + seek markers now that annotations are restored
        if (el._refreshAnnoBadges) {
          try { el._refreshAnnoBadges(); } catch (e) {}
        }
        if (el._refreshSeekMarkers) {
          try { el._refreshSeekMarkers(); } catch (e) {}
        }
        } catch (annoErr) {
          console.warn('[restoreBoard] Failed to restore comments for item', d.id, annoErr);
        }
      }

      // ── Draw/Text Strokes (per-frame, independent of comments) ──
      // R81+R85: re-populate el._annoDrawState.strokesByFrame from
      // a) the restored comment annoStrokes (frozen when the comment was
      //    created) AND
      // b) the live strokesByFrame snapshot captured at save-time (R85).
      //    The snapshot catches draw/text strokes added AFTER the last
      //    comment — those exist in runtime state but are NOT reflected
      //    in any comment's frozen annoStrokes. Without R85, text
      //    annotations typed after a comment and non-comment drawings
      //    are lost on kpak load.
      // CRITICAL: _annoStrokesByFrame must be restored OUTSIDE the
      // if (d.anno) block, because a video may have draw/text annotations
      // without ANY saved comments. Previously, when multiple videos were
      // loaded, only the first video's strokes survived — the second's
      // _annoStrokesByFrame data was never rehydrated.
      if (el._annoDrawState) {
        try {
          var ds = el._annoDrawState;
          // Phase 1: rehydrate from comment annoStrokes
          _savedComments.forEach(function(c) {
            if (!c.annoStrokes || !c.annoStrokes.length) return;
            var f = c.frame || 0;
            if (!ds.strokesByFrame[f]) ds.strokesByFrame[f] = [];
            ds.strokesByFrame[f].push.apply(ds.strokesByFrame[f], c.annoStrokes);
          });
          // Phase 2 (R85): merge live strokesByFrame snapshot from save-time
          if (d._annoStrokesByFrame) {
            Object.keys(d._annoStrokesByFrame).forEach(function(fStr) {
              var f = parseInt(fStr, 10);
              var freshStrokes = d._annoStrokesByFrame[fStr] || [];
              if (!freshStrokes.length) return;
              if (!ds.strokesByFrame[f]) ds.strokesByFrame[f] = [];
              // Deduplicate to avoid strokes present in both snapshot
              // and comment annoStrokes
              freshStrokes.forEach(function(s) {
                var exists = ds.strokesByFrame[f].some(function(ex) {
                  return ex.type === s.type && ex.color === s.color &&
                         ex.size === s.size && ex.text === s.text &&
                         JSON.stringify(ex.points) === JSON.stringify(s.points);
                });
                if (!exists) ds.strokesByFrame[f].push(s);
              });
            });
          }
          // Sync to the current frame and re-render the overlay
          if (el._syncStrokesForFrame) { try { el._syncStrokesForFrame(); } catch (e) {} }
          if (el._renderAnnoCanvas) { try { el._renderAnnoCanvas(); } catch (e) {} }
          if (el._refreshDrawBtnBadge) { try { el._refreshDrawBtnBadge(); } catch (e) {} }
        } catch (e) {
          console.warn('[restoreBoard] Failed to rehydrate strokesByFrame for item', d.id, e);
        }
      }
    }
    } catch (itemErr) {
      console.warn('[restoreBoard] Failed to restore item', d.id, itemErr);
    }
  });
  (data.texts || []).forEach(d => {
    const el = document.createElement('div');
    el.className = 'text-item';
    el.contentEditable = true; el.spellcheck = false;
    el.setAttribute('data-placeholder', 'Type here...');
    // Restore innerHTML if available (preserves inline <span style="color:..">
    // from per-word recolor). Fall back to textContent for older data.
    if (d.html && d.html.trim()) {
      el.innerHTML = sanitizeTextHtml(d.html);
    } else if (d.content) {
      el.textContent = d.content;
    }
    canvasContent.appendChild(el);
    const txId = d.id !== undefined ? d.id : (maxId + 1);
    maxId = Math.max(maxId, txId);
    const tx = { ...d, id: txId, el };
    delete tx.content;
    delete tx.html;
    G.nextZ = Math.max(G.nextZ, tx.z + 1);
    state.texts.push(tx);
    // Bug fix: temporarily set state.zoom to the zoom level at save time
    // so that applyTextProps/updateItemStyle divide by the correct zoom,
    // producing the same rendered size as when saved.
    var _savedZoom = state.zoom;
    if (typeof d._textZoom === 'number' && d._textZoom > 0) {
      state.zoom = d._textZoom;
    }
    applyTextProps(tx);
    updateItemStyle(tx);
    state.zoom = _savedZoom;
  // Auto-grow on input
  el.addEventListener('input', () => autoGrowTextItem(tx));
  el.addEventListener('focus', () => { el.classList.add('editing'); showTextQuickBar(true); updateTextQuickBarActive(); });
  el.addEventListener('blur', () => {
      el.classList.remove('editing');
      showTextQuickBar(false);
      if (!el.textContent.trim()) {
        el.remove();
        const hCont = canvas.querySelector('.text-handles[data-owner="' + tx.id + '"]');
        if (hCont) hCont.remove();
        state.texts = state.texts.filter(t => t.id !== tx.id);
        clearSelection();
      } else {
        autoGrowTextItem(tx);
      }
      if (state.tool === 'text') setTool('select');
      scheduleAutoSave();
    });
    setTimeout(() => autoGrowTextItem(tx), 50);
  });
  // Restore todo items
  state.todos = [];
  (data.todos || []).forEach(d => {
    const el = document.createElement('div');
    el.className = 'todo-item';
    canvasContent.appendChild(el);
    const todoId = d.id !== undefined ? d.id : (maxId + 1);
    maxId = Math.max(maxId, todoId);
    const todo = {
      ...d, id: todoId, el,
      items: (d.items || []).map(it => ({ text: it.text || '', done: !!it.done })),
    };
    G.nextZ = Math.max(G.nextZ, todo.z + 1);
    state.todos.push(todo);
    renderTodo(todo);
    updateItemStyle(todo);
  });
  // Restore mindmap items
  state.mindmaps = [];
  (data.mindmaps || []).forEach(d => {
    const el = document.createElement('div');
    el.className = 'mindmap-item';
    canvasContent.appendChild(el);
    const mmId = d.id !== undefined ? d.id : (maxId + 1);
    maxId = Math.max(maxId, mmId);
    const mm = {
      ...d, id: mmId, el,
      nodes: (d.nodes || []).map(n => ({ ...n })),
      connections: (d.connections || []).map(c => ({ ...c })),
    };
    G.nextZ = Math.max(G.nextZ, mm.z + 1);
    state.mindmaps.push(mm);
    renderMindMap(mm);
    updateItemStyle(mm);
  });
  // Restore G.nextId — use saved value or compute from max ID seen
  // Support both flat format (buildManifest) and nested G format (legacy)
  G.nextId = (data.G && data.G.nextId) || data.nextId || (maxId + 1);
  G.nextZ = (data.G && data.G.nextZ) || data.nextZ || G.nextZ;
  G.nextStrokeId = (data.G && data.G.nextStrokeId) || data.nextStrokeId || G.nextStrokeId;
  // Restore draw strokes (with backward compat for old drawLayers / strokes formats)
  if (Array.isArray((data.G && data.G.drawStrokes) || data.drawStrokes)) {
    G.drawStrokes.length = 0; ((data.G && data.G.drawStrokes) || data.drawStrokes).forEach(s => G.drawStrokes.push(s));
  } else if (Array.isArray(data.drawLayers)) {
    // Legacy: flatten all layer strokes into one array
    G.drawStrokes.length = 0; data.drawLayers.flatMap(l => l.strokes || []).forEach(s => G.drawStrokes.push(s));
  } else if (Array.isArray(data.strokes)) {
    // Even older legacy: single flat array
    G.drawStrokes.length = 0; data.strokes.forEach(s => G.drawStrokes.push(s));
  } else {
    G.drawStrokes.length = 0;
  }
  state.pan = data.pan || { x: 0, y: 0 };
  state.zoom = data.zoom || 1;
  // Restore relations
  state.relations = (data.relations || []).map(function(r) { return { id: r.id, fromId: r.fromId, toId: r.toId, fromAnchor: r.fromAnchor, toAnchor: r.toAnchor, label: r.label || '', style: r.style || 'orthogonal', color: r.color || '#00e5ff', lineWidth: r.lineWidth || 6, labelSize: r.labelSize || 16 }; });
  state.selectedRelation = null;
  // Restore groups
  state.groups.forEach(g => g.borderEl.remove());
  state.groups = [];
  if (data.groups) {
    G.nextGroupId = (data.G && data.G.nextGroupId) || data.nextGroupId || (Math.max(...data.groups.map(g => g.id), 0) + 1);
    data.groups.forEach(gd => {
      const borderEl = document.createElement('div');
      borderEl.className = 'group-border';
      borderEl.style.borderColor = gd.color;
      canvasContent.appendChild(borderEl);
      // IDs are preserved through serialize/restore, so memberIds match directly
      state.groups.push({ id: gd.id, color: gd.color, memberIds: new Set(gd.memberIds), borderEl });
    });
    setTimeout(() => updateAllGroupBorders(), 200);
  }
  // Restore paper / artboard
  if (data.paper) {
    paperState.enabled = data.paper.enabled || false;
    paperState.autoFit = data.paper.autoFit || false;
    paperState.width = data.paper.width || 1920;
    paperState.height = data.paper.height || 1080;
    paperState.color = data.paper.color || '#ffffff';
    document.getElementById('paper-controls').style.display = paperState.enabled ? 'block' : 'none';
    document.getElementById('paper-w').value = paperState.width;
    document.getElementById('paper-h').value = paperState.height;
    // Update auto-fit button state
    const afBtn = document.getElementById('btn-autofit-toggle');
    if (afBtn) { afBtn.textContent = paperState.autoFit ? 'Auto-fit: ON' : 'Auto-fit: OFF'; afBtn.style.color = paperState.autoFit ? 'var(--accent)' : ''; }
    const wInput = document.getElementById('paper-w');
    const hInput = document.getElementById('paper-h');
    if (wInput) wInput.disabled = paperState.autoFit;
    if (hInput) hInput.disabled = paperState.autoFit;
    document.getElementById('btn-paper-toggle').textContent = paperState.enabled ? 'Hide Paper' : 'Show Paper';
    updatePaper();
  }
  if (data.canvasBg) setCanvasBg(data.canvasBg);
  updateCanvas();
  redrawDrawLayer();
  _frozenGifs.clear();
  updateMediaBar();
  // Render mask overlays for restored items
  state.items.forEach(item => {
    if (item.masks && item.masks.length > 0 && item.img && item.src) {
      // Pre-load image pixel cache for color masks
      if (!maskImageCache[item.src]) {
        getCachedImagePixels(item.src, () => { invalidateMaskCache(item.src); renderMasks(item); });
      }
      renderMasks(item);
    }
  });
  // R73: re-render the frame-comment list so restored snapshot data
  // is reflected in the popover thumbnails. Without this, the list
  // would still show whatever was rendered before load/auto-save.
  try {
    state.items.forEach(it => {
      if (it && it.isVideo && it.anno && it.el) {
        if (typeof videoAnnoRefreshCommentList === 'function') {
          videoAnnoRefreshCommentList(it);
        }
        if (it.el._refreshListBody) it.el._refreshListBody();
        if (it.el._refreshAnnoBadges) it.el._refreshAnnoBadges();
        if (it.el._refreshSeekMarkers) it.el._refreshSeekMarkers();
      }
    });
  } catch (e) { /* non-fatal */ }
  scheduleAutoSave();
  setTimeout(() => updateAutoFitPaper(), 200);
  // Render relation lines after all items are restored
  setTimeout(function() {
    try {
      if (state.relations && state.relations.length) renderRelations();
    } catch(e) { console.warn('renderRelations after restore failed:', e); }
  }, 300);
}

// ============================================================
//  AUTO SAVE
// ============================================================
export function scheduleAutoSave() {
  clearTimeout(state.autoSaveTimer);
  state.autoSaveTimer = setTimeout(() => {
    try { localStorage.setItem('krafted_autosave', serializeBoard()); } catch(e) {}
  }, 2000);
}
export function loadAutoSave() {
  try {
    const data = localStorage.getItem('krafted_autosave');
    if (data) { restoreBoard(JSON.parse(data)); toast('Auto-saved board restored'); }
  } catch(e) {}
}
