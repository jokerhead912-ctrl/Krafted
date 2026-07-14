
import { IS_TOUCH_DEVICE, state, viewport } from './core-state.js';

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
  _welcomeEl.addEventListener('dragover', function(e){
    if (_isFileDrag(e)) { e.preventDefault(); }
  });
  _welcomeEl.addEventListener('drop', function(e){
    if (!_isFileDrag(e)) return;
    e.preventDefault();
    hideWelcome();
    const files = [...e.dataTransfer.files];
    if (files.length) _handleFileDrop(e, files);
  });
}

// DRAG & DROP FILES
viewport.addEventListener('dragover', e => { e.preventDefault(); });
// Round 13: auto-hide the draw panel while a file is being dragged in,
// so the panel doesn't sit on top of the drop target and "trap" the
// cursor / block the drop. The panel reappears once the drag leaves
// the window or completes. Uses a counter (dragenter/dragleave fire
// for every child element traversed, so a naive toggle would flicker
// or get out of sync).
let _fileDragDepth = 0;
export function _isFileDrag(e) {
  // Only react when the drag actually carries files (not text/internal
  // reordering of items, which we don't want to hide the panel for).
  if (!e || !e.dataTransfer) return false;
  const types = e.dataTransfer.types;
  if (!types) return false;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'Files') return true;
  }
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
export function _handleFileDrop(e, files) {
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
  // 20 parallel FileReader+Image decodes spike RAM (base64 strings + decoded bitmaps).
  // We also push a single undo snapshot at batch start so one undo reverts the whole drop.
  if (imageFiles.length > 0) pushUndo();
  let imgIdx = 0;
  function processNextImage() {
    if (imgIdx >= imageFiles.length) return;
    const { file, idx } = imageFiles[imgIdx];
    const dropX = dropX0 + idx * 20;
    const dropY = dropY0 + idx * 20;
    const isLast = (imgIdx === imageFiles.length - 1);
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        addImage(ev.target.result, img.naturalWidth, img.naturalHeight, dropX, dropY, false, isLast);
        imgIdx++;
        // Small delay so GC can reclaim the previous dataURL before the next one
        setTimeout(processNextImage, 30);
      };
      img.onerror = () => {
        // Skip and continue
        imgIdx++;
        setTimeout(processNextImage, 30);
      };
      img.src = ev.target.result;
    };
    reader.onerror = () => {
      // Skip and continue
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
    videoEl.preload = 'auto';
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
  const files = [...e.dataTransfer.files];
  if (files.length) _handleFileDrop(e, files);
});
