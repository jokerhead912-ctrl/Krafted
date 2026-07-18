
import { IS_TOUCH_DEVICE, state, viewport } from './core-state.js';
import { maskImageCache } from './masking.js';
import { addAudioItem } from './audio.js';
import { addImage } from './add-items.js';
import { pushUndo } from './undo-redo.js';
import { showCtx, toast } from './ui-utils.js';

// MIDDLE MOUSE / ALT+LEFT PAN (Mac trackpad fallback)
viewport.addEventListener('mousedown', e => {
  // Belt-and-suspenders: see MOUSEMOVE guard above for rationale.
  // Desktop (IS_TOUCH_DEVICE === false) behavior is completely untouched.
  if (IS_TOUCH_DEVICE) return;

  // Catches middle-button (e.button===1) and Alt+Left (button===0 + altKey, Mac trackpad fallback)
  if (e.button === 1 || (state.altPanEnabled && e.button === 0 && e.altKey)) {
    if (e.cancelable) e.preventDefault();
    state.dragging = { type: 'pan', startX: e.clientX - state.pan.x, startY: e.clientY - state.pan.y };
    viewport.classList.add('grabbing');
  }
});

// RIGHT CLICK
viewport.addEventListener('contextmenu', e => {
  e.preventDefault();
  showCtx(e.clientX, e.clientY);
});

// Round 63: WELCOME MUST NOT BLOCK FILE DROP.
// The welcome overlay sits at z-index 99999999, full-screen, on top of
// the viewport. Without these handlers, dragging a .mov (or any file)
// over the welcome fires drop on the welcome element — the viewport's
// drop handler is on a SIBLING, not an ancestor, so it never sees the
// event and the file is silently swallowed. Result: "i can't drag the
// .mov to the app".
// Fix: (1) add dragover preventDefault on welcome so the OS cursor
// shows the "allowed" copy icon, (2) handle the drop on welcome using
// the same path as the viewport, (3) auto-hide the welcome the moment
// a file drag starts so the user gets immediate visual feedback that
// the drop is being received.
const _welcomeEl = document.getElementById('welcome');
if (_welcomeEl) {
  // v5.5.2: dragover MUST unconditionally preventDefault so the browser
  // allows a drop. _isFileDrag cannot be used during dragover/dragenter
  // because dataTransfer.types is empty for security reasons in those
  // phases (only populated during 'drop'). Without this, dragging any
  // file over the welcome (z-index 99999999) is silently rejected.
  _welcomeEl.addEventListener('dragover', function(e){
    e.preventDefault();
    // v5.5.3: MUST set dropEffect to 'copy' — without this some browsers
    // (especially Windows Chrome) will refuse to fire the drop event even
    // though preventDefault() was called.
    e.dataTransfer.dropEffect = 'copy';
  });
  _welcomeEl.addEventListener('drop', function(e){
    e.preventDefault();
    e.stopPropagation(); // v5.5.3: prevent bubbling to document-level handlers
    console.log('[FileDrop] Welcome received drop, files:', e.dataTransfer.files.length);
    hideWelcome();
    const files = e.dataTransfer.files;
    if (files && files.length) _handleFileDrop(e, [...files]);
  });
}

// DRAG & DROP FILES
// v5.5.3: GLOBAL capture-phase listeners on window. This is the LAST
// line of defense — if for any reason the welcome/viewport listeners
// are not receiving the event (extension interference, wrong target,
// timing race with hideWelcome), this catch-all WILL fire and route
// the file to _handleFileDrop.
window.addEventListener('dragover', function(e){
  // Only react to file drags (use the items check, types is empty here)
  if (e.dataTransfer && e.dataTransfer.items) {
    for (let i = 0; i < e.dataTransfer.items.length; i++) {
      if (e.dataTransfer.items[i].kind === 'file') {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        // Hide welcome immediately so user sees visual feedback
        const w = document.getElementById('welcome');
        if (w && w._welcomeHiddenByDrag !== true && w.style.display !== 'none') {
          try { hideWelcome(); } catch (err) {}
        }
        return;
      }
    }
  }
  // No files detected — also preventDefault to allow drop fallback
  e.preventDefault();
}, true);
window.addEventListener('drop', function(e){
  try { console.log('[FileDrop] window capture-phase drop, files:', e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files.length : 0, 'types:', e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types).join(',') : ''); } catch (err) {}
  e.preventDefault();
  e.stopPropagation();
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length) {
    try { hideWelcome(); } catch (err) {}
    try { _handleFileDrop(e, [...files]); } catch (err) { console.warn('[FileDrop] window handler error:', err); }
    return;
  }
  // ── Cross-origin drag: no files, but dataTransfer may have URL ──
  const dt = e.dataTransfer;
  if (!dt) return;
  let url = null;
  if (dt.getData) {
    const uriList = dt.getData('text/uri-list');
    if (uriList) {
      const lines = uriList.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
      if (lines.length) url = lines[0];
    }
    if (!url) {
      const html = dt.getData('text/html');
      if (html) {
        const m = html.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
        if (m) url = m[1];
      }
    }
  }
  if (!url) return;
  try { hideWelcome(); } catch (err) {}
  // Fetch real image bytes via CORS proxy → convert to data URL →
  // addImage directly. Data URL is same-origin, zero CORS forever.
  // This is functionally identical to "Copy Image → Paste" but done
  // in one drag gesture.
  toast('Fetching image…');
  fetch('https://images.weserv.nl/?url=' + encodeURIComponent(url))
    .then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.blob();
    })
    .then(blob => {
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          // Max 360px wide for comfortable drag-drop viewing
          const dw = Math.round(Math.min(img.naturalWidth / 2, 360));
          const dh = Math.round(img.naturalHeight * (dw / img.naturalWidth));
          addImage(ev.target.result, dw, dh,
            (e.clientX - state.pan.x) / state.zoom,
            (e.clientY - state.pan.y) / state.zoom);
          toast('Pasted image');
        };
        img.onerror = () => toast('Failed to decode image');
        img.src = ev.target.result;
      };
      reader.readAsDataURL(blob);
    })
    .catch(err => {
      console.log('[FileDrop] proxy fetch failed:', err.message);
      // Last resort: hotlink with no CORS check
      const img = new Image();
      img.onload = () => {
        if (typeof maskImageCache !== 'undefined') maskImageCache[url] = { img: null };
        const dw = Math.round(Math.min(img.naturalWidth / 2, 360));
        const dh = Math.round(img.naturalHeight * (dw / img.naturalWidth));
        addImage(url, dw, dh,
          (e.clientX - state.pan.x) / state.zoom,
          (e.clientY - state.pan.y) / state.zoom);
        toast('Pasted image (hotlinked)');
      };
      img.onerror = () => {
        // Try fallback proxy (corsproxy.io) as last resort
        console.log('[FileDrop] hotlink failed, trying corsproxy.io');
        fetch('https://corsproxy.io/?' + encodeURIComponent(url))
          .then(function(r){ return r.blob(); })
          .then(function(blob){
            var reader = new FileReader();
            reader.onload = function(ev){
              var i2 = new Image();
              i2.onload = function(){
                var dw = Math.round(Math.min(i2.naturalWidth / 2, 360));
                var dh = Math.round(i2.naturalHeight * (dw / i2.naturalWidth));
                addImage(ev.target.result, dw, dh,
                  (e.clientX - state.pan.x) / state.zoom,
                  (e.clientY - state.pan.y) / state.zoom);
                toast('Pasted image (via fallback proxy)');
              };
              i2.src = ev.target.result;
            };
            reader.readAsDataURL(blob);
          })
          .catch(function(e2){
            console.log('[FileDrop] all paths failed:', e2.message);
            toast('Image could not be loaded (source may be expired)');
          });
      };
      img.src = url;
    });
}, true);

viewport.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
// Round 13: auto-hide the draw panel while a file is being dragged in,
// so the panel doesn't sit on top of the drop target and "trap" the
// cursor / block the drop. The panel reappears once the drag leaves
// the window or completes. Uses a counter (dragenter/dragleave fire
// for every child element traversed, so a naive toggle would flicker
// or get out of sync).
let _fileDragDepth = 0;
export function _isFileDrag(e) {
  // v5.5.2: dataTransfer.types is EMPTY during dragover/dragenter in
  // most browsers for security. Fall back to checking items.length
  // (which IS populated) or files.length. Without this, the dragenter
  // handler never triggers → welcome stays visible → drop fails.
  if (!e || !e.dataTransfer) return false;
  // Check items first (works during dragover/dragenter)
  if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
    for (let i = 0; i < e.dataTransfer.items.length; i++) {
      if (e.dataTransfer.items[i].kind === 'file') return true;
    }
  }
  // Check types (works during drop/paste)
  const types = e.dataTransfer.types;
  if (types && types.length) {
    for (let i = 0; i < types.length; i++) {
      if (types[i] === 'Files') return true;
    }
  }
  // Check files (sometimes populated even when types is empty)
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) return true;
  return false;
}
document.addEventListener('dragenter', function(e){
  if (!_isFileDrag(e)) return;
  _fileDragDepth++;
  if (_fileDragDepth === 1) {
    document.body.classList.add('dragging-file');
    // Round 63: auto-hide the welcome the moment a file drag begins.
    // Without this, the welcome (z-index 99999999, full-screen) sits
    // on top of the viewport and silently swallows the drop. The user
    // would see the file disappear with no feedback. Fading the
    // welcome out as the drag starts gives immediate visual confirmation
    // that the drop is being received, and lets the drop land on the
    // viewport below. We mark a flag so we can restore it if the drag
    // is cancelled (e.g. user releases outside the window).
    try {
      const w = document.getElementById('welcome');
      if (w && w.style.display !== 'none' && !w.classList.contains('fading')) {
        w._welcomeHiddenByDrag = true;
        w.classList.add('fading');
        setTimeout(function(){ w.style.display = 'none'; }, 320);  // faster than the 800ms normal hide so the drop target is clear by the time the user releases
      }
    } catch (err) {}
  }
});
document.addEventListener('dragleave', function(e){
  if (!_isFileDrag(e)) return;
  _fileDragDepth = Math.max(0, _fileDragDepth - 1);
  if (_fileDragDepth === 0) {
    document.body.classList.remove('dragging-file');
  }
});
// Drop & dragend both end the drag state. drop fires on a successful
// drop; dragend is the fallback for when the user drops outside the
// window (e.g. releases on the browser chrome) or cancels (Esc).
document.addEventListener('drop', function(){
  _fileDragDepth = 0;
  document.body.classList.remove('dragging-file');
  // Round 63: clear the welcome-hidden-by-drag flag. We do NOT restore
  // the welcome here — the user just successfully added content, so
  // showing the welcome again would be jarring.
  try {
    const w = document.getElementById('welcome');
    if (w) w._welcomeHiddenByDrag = false;
  } catch (err) {}
});
document.addEventListener('dragend', function(){
  _fileDragDepth = 0;
  document.body.classList.remove('dragging-file');
});
// Window-level dragleave fires when the cursor leaves the browser
// window entirely — reset there too so the panel doesn't get stuck
// hidden.
window.addEventListener('dragleave', function(e){
  // e.relatedTarget is null when the cursor left the window
  if (e.relatedTarget === null) {
    _fileDragDepth = 0;
    document.body.classList.remove('dragging-file');
    // Round 63: if the welcome was hidden because a file drag started
    // but the user dragged back out and released outside the window,
    // restore it so the user isn't left with no entry point.
    try {
      const w = document.getElementById('welcome');
      if (w && w._welcomeHiddenByDrag) {
        w._welcomeHiddenByDrag = false;
        w.style.display = 'flex';
        // Force reflow then remove fading class so it fades in cleanly
        void w.offsetWidth;
        w.classList.remove('fading');
      }
    } catch (err) {}
  }
});
// Round 63: extracted into _handleFileDrop so the welcome overlay
// (and any future overlay) can route drops through the same path.
// The welcome sits at z-index 99999999, full-screen, on top of the
// viewport — without a shared handler, drops fired on the welcome
// never reach the viewport's drop listener and the file is lost.

// v5.5.1: folder drop handler — recursively reads all files from
// a dropped folder (including subfolders) and imports them as a batch.
function _handleEntryDrop(e, entries) {
  var allFiles = [];
  var pending = entries.length;

  function readEntry(entry, path) {
    if (entry.isFile) {
      pending++;
      entry.file(function(file) {
        file._kraftedPath = path;
        allFiles.push(file);
        pending--;
        if (pending === 0) _finishFolderImport(e, allFiles);
      }, function(err) {
        console.warn('[FileDrop] Failed to read file:', entry.name, err);
        pending--;
        if (pending === 0) _finishFolderImport(e, allFiles);
      });
    } else if (entry.isDirectory) {
      var reader = entry.createReader();
      var subPath = path ? path + '/' + entry.name : entry.name;
      function readBatch() {
        reader.readEntries(function(batch) {
          if (batch.length === 0) {
            pending--;
            if (pending === 0) _finishFolderImport(e, allFiles);
            return;
          }
          pending += batch.length;
          batch.forEach(function(subEntry) { readEntry(subEntry, subPath); });
          pending--; // this batch done
          readBatch(); // continue reading (directory readers return max 100 entries)
        }, function(err) {
          console.warn('[FileDrop] Failed to read directory:', entry.name, err);
          pending--;
          if (pending === 0) _finishFolderImport(e, allFiles);
        });
      }
      readBatch();
    } else {
      pending--;
      if (pending === 0) _finishFolderImport(e, allFiles);
    }
  }

  entries.forEach(function(entry) { readEntry(entry, ''); });
}

function _finishFolderImport(e, allFiles) {
  if (allFiles.length === 0) return;
  // Sort: images first, then videos, then audio
  var images = [], videos = [], audios = [];
  allFiles.forEach(function(f) {
    if (f.type.startsWith('image/')) images.push(f);
    else if (f.type.startsWith('video/')) videos.push(f);
    else if (f.type.startsWith('audio/') || /\.(mp3|wav|aiff|aif|flac|ogg|m4a)$/i.test(f.name)) audios.push(f);
  });
  var sorted = images.concat(videos).concat(audios);
  console.log('[FileDrop] Folder import: ' + sorted.length + ' files (' + images.length + ' images, ' + videos.length + ' videos, ' + audios.length + ' audio)');
  if (typeof window.toast === 'function') {
    window.toast('📁 Importing ' + sorted.length + ' files from folder...');
  }
  _handleFileDrop(e, sorted);
}

export function _handleFileDrop(e, files) {
  console.log('[FileDrop] _handleFileDrop called with', files.length, 'files');
  // Separate images, videos, and audio files
  const imageFiles = [];
  const videoFiles = [];
  const audioFiles = [];
  files.forEach((file, idx) => {
    const isVideo = file.type.startsWith('video/');
    const isAudio = file.type.startsWith('audio/') || /\.(mp3|wav|aiff|aif|flac|ogg|m4a)$/i.test(file.name);
    if (!file.type.startsWith('image/') && !isVideo && !isAudio) return;
    if (isVideo) videoFiles.push({ file, idx });
    else if (isAudio) audioFiles.push({ file, idx });
    else imageFiles.push({ file, idx });
  });
  const dropX0 = (e.clientX - state.pan.x) / state.zoom;
  const dropY0 = (e.clientY - state.pan.y) / state.zoom;
  // Process images SEQUENTIALLY (one at a time) to avoid memory crash on 20+ images.
  // v5.5: Use blob URLs instead of base64 data URLs. Blob URLs are 33% smaller
  // in memory and won't bloat localStorage during auto-save (serializeBoard
  // strips blob:/data: src). We still need Image() decode to get natural
  // dimensions, but we pass the blob URL to addImage — the <img> element
  // loads directly from the blob, no base64 overhead.
  if (imageFiles.length > 0) pushUndo();
  let imgIdx = 0;
  function processNextImage() {
    if (imgIdx >= imageFiles.length) return;
    const { file, idx } = imageFiles[imgIdx];
    const dropX = dropX0 + idx * 20;
    const dropY = dropY0 + idx * 20;
    const isLast = (imgIdx === imageFiles.length - 1);
    // v5.5.2: Use FileReader → data URL instead of blob URL for Image().
    // blob URLs created from `new File([bytes])` can fail to decode in
    // some browser/OS combos (especially on Windows where the file bytes
    // are raw disk data). data URLs are universally reliable.
    const reader = new FileReader();
    reader.onload = function(ev) {
      const dataUrl = ev.target.result;
      const img = new Image();
      img.onload = function() {
        addImage(dataUrl, img.naturalWidth, img.naturalHeight, dropX, dropY, false, isLast);
        imgIdx++;
        setTimeout(processNextImage, 30);
      };
      img.onerror = function() {
        console.warn('[FileDrop] Image decode failed, trying blob fallback:', file.name);
        // Fallback: try blob URL directly
        const blobUrl = URL.createObjectURL(file);
        const img2 = new Image();
        img2.onload = function() {
          addImage(blobUrl, img2.naturalWidth, img2.naturalHeight, dropX, dropY, false, isLast);
          imgIdx++;
          setTimeout(processNextImage, 30);
        };
        img2.onerror = function() {
          console.error('[FileDrop] Both data URL and blob URL failed for:', file.name);
          toast('Failed to load image: ' + file.name);
          imgIdx++;
          setTimeout(processNextImage, 30);
        };
        img2.src = blobUrl;
      };
      img.src = dataUrl;
    };
    reader.onerror = function() {
      console.error('[FileDrop] FileReader failed for:', file.name);
      imgIdx++;
      setTimeout(processNextImage, 30);
    };
    reader.readAsDataURL(file);
  }
  if (imageFiles.length > 0) {
    processNextImage();
    if (imageFiles.length > 1) toast('Importing ' + imageFiles.length + ' images…');
  }
  // Process videos sequentially (one at a time to avoid memory crash).
  // We use a temporary blob URL just to read the dimensions, then call addImage
  // with the SAME blob URL — the addImage path also creates its own blob URL
  // for the live <video> element. This is fast and reliable for in-session use.
  // Note: blob URLs do NOT survive page reload — videos imported this way
  // exist for the current session only. (Saving to localStorage for full
  // persistence is a separate, much bigger change — would need IndexedDB.)
  if (videoFiles.length > 0) pushUndo();
  let videoQueueIdx = 0;
  function processNextVideo() {
    if (videoQueueIdx >= videoFiles.length) return;
    const { file, idx } = videoFiles[videoQueueIdx];
    const dropX = dropX0 + idx * 20;
    const dropY = dropY0 + idx * 20;
    const isLast = (videoQueueIdx === videoFiles.length - 1);
    const blobUrl = URL.createObjectURL(file);
    // Use preload=metadata on temp element to read dimensions, then clean up
    const videoEl = document.createElement('video');
    videoEl.preload = 'metadata';  // v5.5: metadata-only to avoid memory spike
    videoEl.muted = true;
    videoEl.src = blobUrl;
    let done = false;
    const finish = (w, h) => {
      if (done) return;
      done = true;
      // Clean up temp video element to free memory
      videoEl.removeAttribute('src');
      videoEl.load();
      // Capture the original file name so the export can use it
      // (drag-drop → file.name is available; paste also has it)
      const newItem = addImage(blobUrl, w, h, dropX, dropY, true, isLast);
      if (newItem && file && file.name) {
        newItem.filename = file.name;
        // Round 13: push the file name to the player badge so the user
        // can identify the video on the canvas.
        try { if (newItem.el && newItem.el._setFilenameBadge) newItem.el._setFilenameBadge(file.name); } catch (e) {}
      }
      videoQueueIdx++;
      // Process next video after a short delay to let GC run
      setTimeout(processNextVideo, 100);
    };
    videoEl.onloadedmetadata = () => {
      finish(videoEl.videoWidth || 640, videoEl.videoHeight || 360);
    };
    videoEl.onerror = () => {
      if (done) return;
      done = true;
      toast('Failed to load video: ' + file.name);
      URL.revokeObjectURL(blobUrl);
      videoQueueIdx++;
      setTimeout(processNextVideo, 100);
    };
    // Safety timeout — if metadata doesn't load in 15s, skip
    setTimeout(() => { if (!done) { finish(640, 360); } }, 15000);
  }
  processNextVideo();
  // Process audio files
  audioFiles.forEach(({ file, idx }) => {
    const dropX = dropX0 + idx * 20;
    const dropY = dropY0 + idx * 20;
    const reader = new FileReader();
    reader.onload = ev => {
      addAudioItem(ev.target.result, file.name, dropX, dropY);
    };
    reader.readAsDataURL(file);
  });
}

viewport.addEventListener('drop', e => {
  e.preventDefault();
  hideWelcome();
  // v5.5.1: detect folder drops via DataTransferItem.webkitGetAsEntry()
  var items = e.dataTransfer.items;
  if (items && items.length > 0 && items[0].webkitGetAsEntry) {
    var entries = [];
    for (var i = 0; i < items.length; i++) {
      var entry = items[i].webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    if (entries.length > 0) {
      _handleEntryDrop(e, entries);
      return;
    }
  }
  // Fallback: regular file drop
  const files = [...e.dataTransfer.files];
  if (files.length) _handleFileDrop(e, files);
});

// ============================================================
//  CROSS-ORIGIN IMAGE FETCH — used by drag-drop + paste
// ============================================================

// Fetch an image from a URL and embed it on the canvas.
// Used for cross-origin paste (copy image from another website → paste into Krafted).
// Tries direct fetch first; if CORS-blocked, falls back to an image element load
// (which works for most public images but won't give us the raw bytes — we use
// a canvas to convert to data URL for persistence).
export function fetchImageFromURL(url, x, y) {
  console.log('[fetchImageFromURL] start:', url);
  try { hideWelcome(); } catch (err) {}
  toast('Fetching image…');
  // 1) Try direct fetch (works if server has CORS headers or same-origin)
  fetch(url, { mode: 'cors' })
    .then(res => {
      console.log('[fetchImageFromURL] fetch response status:', res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.blob();
    })
    .then(blob => {
      console.log('[fetchImageFromURL] got blob size:', blob.size);
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          addImage(ev.target.result, img.naturalWidth, img.naturalHeight, x, y);
          toast('Pasted image from URL');
        };
        img.onerror = () => { console.log('[fetchImageFromURL] data URL img decode failed'); toast('Failed to decode image'); };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(blob);
    })
    .catch(err => {
      console.log('[fetchImageFromURL] direct fetch failed:', err.message);
      // 2) Fallback: load via img tag (no CORS). Then convert to data
      // URL via fetch(no-cors) so the embedded image is same-origin
      // and never triggers CORS again on re-render.
      const img = new Image();
      img.onload = () => {
        console.log('[fetchImageFromURL] hotlink img loaded:', img.naturalWidth, 'x', img.naturalHeight);
        // Pre-mark mask cache as failed BEFORE addImage
        if (typeof maskImageCache !== 'undefined') {
          maskImageCache[url] = { img: null };
        }
        // Try fetch(no-cors) to get the bytes — opaque response still
        // gives us a Blob, which we convert to objectURL. This avoids
        // any future CORS check since objectURL is same-origin.
        fetch(url, { mode: 'no-cors' })
          .then(res => res.blob())
          .then(blob => {
            const objUrl = URL.createObjectURL(blob);
            addImage(objUrl, img.naturalWidth, img.naturalHeight, x, y);
            toast('Pasted image (hotlinked)');
          })
          .catch(() => {
            // Even blob conversion failed — fall back to direct URL.
            // The browser's <img> cache will at least make re-renders
            // not re-trigger CORS for this src.
            addImage(url, img.naturalWidth, img.naturalHeight, x, y);
            toast('Pasted image (hotlinked)');
          });
      };
      img.onerror = () => {
        console.log('[fetchImageFromURL] hotlink also failed, trying CORS proxy');
        if (typeof state !== 'undefined' && state.allowCorsProxy) {
          tryCorsProxy(url, x, y);
        } else {
          toast('Image blocked. Enable proxy: kraftedEnableCorsProxy()');
          console.log('[fetchImageFromURL] CORS proxy not enabled — giving up');
        }
      };
      img.src = url;
    });
}

// Last-resort: fetch through a public CORS proxy. Only invoked if the user
// has explicitly enabled state.allowCorsProxy in settings (privacy: the proxy
// sees the URL you're fetching). Uses images.weserv.nl as the primary proxy
// (designed for image hotlinking, no rate limit on free tier) with
// corsproxy.io as fallback.
// To enable, run in console: kraftedEnableCorsProxy()
export function tryCorsProxy(url, x, y) {
  const proxy = 'https://images.weserv.nl/?url=' + encodeURIComponent(url);
  console.log('[tryCorsProxy]', proxy);
  toast('Fetching via CORS proxy…');
  fetch(proxy)
    .then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.blob();
    })
    .then(blob => {
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          addImage(ev.target.result, img.naturalWidth, img.naturalHeight, x, y);
          toast('Pasted image (via proxy)');
        };
        img.onerror = () => { toast('Proxy returned invalid image'); };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(blob);
    })
    .catch(err => {
      console.log('[tryCorsProxy] weserv failed:', err.message);
      // Fallback proxy
      const fallback = 'https://corsproxy.io/?' + encodeURIComponent(url);
      fetch(fallback)
        .then(res => res.blob())
        .then(blob => {
          const reader = new FileReader();
          reader.onload = ev => {
            const img = new Image();
            img.onload = () => {
              addImage(ev.target.result, img.naturalWidth, img.naturalHeight, x, y);
              toast('Pasted image (via fallback proxy)');
            };
            img.onerror = () => { toast('Proxy returned invalid image'); };
            img.src = ev.target.result;
          };
          reader.readAsDataURL(blob);
        })
        .catch(e2 => {
          console.log('[tryCorsProxy] fallback also failed:', e2.message);
          toast('All CORS proxies failed. Image cannot be loaded.');
        });
    });
}

// Console command: enable CORS proxy for cross-origin image paste.
// Persists in localStorage. To disable: kraftedDisableCorsProxy()
window.kraftedEnableCorsProxy = function() {
  try {
    if (!window.state) window.state = {};
    window.state.allowCorsProxy = true;
    localStorage.setItem('krafted-allow-cors-proxy', '1');
    console.log('[Krafted] CORS proxy ENABLED. Cross-origin image paste will use images.weserv.nl as fallback.');
    toast('CORS proxy enabled — try paste again');
  } catch (e) { console.warn(e); }
};

window._handleFileDrop = _handleFileDrop;
window.fetchImageFromURL = fetchImageFromURL;
window.tryCorsProxy = tryCorsProxy;
