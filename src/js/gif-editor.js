import { getSelectedImages, getSelectedItems, selectOnly } from './selection.js';
import { state } from './core-state.js';

import { scheduleAutoSave } from './save-load.js';
import { toast } from './ui-utils.js';
import { pushUndo } from './undo-redo.js';

export let gifEditorState = null;
export let gifPreviewTimer = null;
export let gifCurrentFrame = 0;
export let gifInFrame = 0;
export let gifOutFrame = 0;
export let gifTimelineDrag = null; // 'in' or 'out'
export let gifWorkerBlobUrl = null; // Blob URL for gif.js worker (avoids CORS issues)

// Preload gif.js worker script and convert to Blob URL (fixes CORS worker issue)
(function preloadGifWorker() {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js', true);
    xhr.responseType = 'text';
    xhr.onload = function() {
      if (xhr.status === 200) {
        const blob = new Blob([xhr.responseText], { type: 'application/javascript' });
        gifWorkerBlobUrl = URL.createObjectURL(blob);
      }
    };
    xhr.send();
  } catch(e) { /* will fallback to direct URL */ }
})();

export function isAnimatedGif(src) {
  if (!src) return false;
  // Check for data: GIF URLs
  if (src.startsWith('data:image/gif')) return true;
  // Check for .gif extension in URL
  if (/\.gif[\?#]?/i.test(src)) return true;
  return false;
}

export function openGifEditor(item) {
  if (typeof SuperGif === 'undefined') { toast('GIF library not loaded. Check internet connection.'); return; }
  gifEditorState = { itemId: item.id, rub: null, _container: null };
  gifInFrame = 0;
  gifOutFrame = 0;
  gifCurrentFrame = 0;

  // Load GIF using libgif — SuperGif needs an img element in DOM with explicit dimensions
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
  const gifImg = document.createElement('img');
  gifImg.src = item.src;
  // SuperGif needs the img to have explicit width/height set
  gifImg.width = item.natW || item.w;
  gifImg.height = item.natH || item.h;
  gifImg.style.cssText = 'width:' + (item.natW || item.w) + 'px;height:' + (item.natH || item.h) + 'px;';
  container.appendChild(gifImg);
  document.body.appendChild(container);

  // Wait for image to load before passing to SuperGif
  function tryLoadGif() {
    try {
      const rub = new SuperGif({ gif: gifImg, auto_play: false });
      rub.load(() => {
        gifEditorState.rub = rub;
        gifEditorState._container = container;
        const totalFrames = rub.get_length();
        if (totalFrames <= 1) {
          toast('This GIF has only 1 frame (not animated)');
          closeGifEditor();
          return;
        }
        gifEditorState.totalFrames = totalFrames;
        gifOutFrame = totalFrames - 1;
        document.getElementById('gif-total-frames').textContent = totalFrames;
        const duration = (totalFrames * 0.1).toFixed(1);
        document.getElementById('gif-duration').textContent = duration + 's';

        // Build frame strip thumbnails
        const strip = document.getElementById('gif-frame-strip');
        strip.innerHTML = '';
        for (let i = 0; i < totalFrames; i++) {
          rub.move_to(i);
          const fc = rub.get_canvas();
          const thumb = document.createElement('canvas');
          thumb.width = 40; thumb.height = 40;
          thumb.style.cssText = 'width:40px;height:40px;object-fit:cover;border:1px solid var(--border);border-radius:2px;flex-shrink:0;cursor:pointer;';
          thumb.title = 'Frame ' + i;
          const tctx = thumb.getContext('2d');
          tctx.drawImage(fc, 0, 0, 40, 40);
          thumb.onclick = () => { gifInFrame = i; updateGifTimelineUI(); startGifPreview(); };
          strip.appendChild(thumb);
        }

        // Build timeline bar thumbnails
        renderGifTimelineBar();
        updateGifTimelineUI();
        startGifPreview();
      });
    } catch(err) {
      toast('Error loading GIF: ' + err.message);
      closeGifEditor();
    }
  }

  if (gifImg.complete && gifImg.naturalWidth > 0) {
    tryLoadGif();
  } else {
    gifImg.onload = tryLoadGif;
    gifImg.onerror = () => {
      toast('Failed to load GIF image');
      closeGifEditor();
    };
  }

  document.getElementById('gif-modal').style.display = 'flex';
}

export function renderGifTimelineBar() {
  if (!gifEditorState || !gifEditorState.rub) return;
  const rub = gifEditorState.rub;
  const total = gifEditorState.totalFrames;
  const tc = document.getElementById('gif-timeline-canvas');
  const bar = document.getElementById('gif-timeline-bar');
  const barW = bar.clientWidth || 400;
  tc.width = barW;
  tc.height = 36;
  const ctx = tc.getContext('2d');
  ctx.fillStyle = '#0f0f1e';
  ctx.fillRect(0, 0, barW, 36);
  // Draw frame thumbnails
  const fw = Math.max(2, barW / total);
  for (let i = 0; i < total; i++) {
    rub.move_to(i);
    const fc = rub.get_canvas();
    const x = (i / total) * barW;
    ctx.drawImage(fc, 0, 0, fc.width, fc.height, x, 0, Math.ceil(fw) + 1, 36);
  }
}

export function updateGifTimelineUI() {
  if (!gifEditorState) return;
  const total = gifEditorState.totalFrames || 1;
  const bar = document.getElementById('gif-timeline-bar');
  const barW = bar.clientWidth || 400;
  const inPct = gifInFrame / total;
  const outPct = (gifOutFrame + 1) / total;
  const handleW = 12;

  // Update in handle
  const inH = document.getElementById('gif-in-handle');
  inH.style.left = (inPct * barW - handleW / 2) + 'px';
  // Update out handle
  const outH = document.getElementById('gif-out-handle');
  outH.style.left = (outPct * barW - handleW / 2) + 'px';
  // Update selection highlight
  const sel = document.getElementById('gif-timeline-select');
  sel.style.left = (inPct * barW) + 'px';
  sel.style.width = ((outPct - inPct) * barW) + 'px';
  // Update info text
  document.getElementById('gif-trim-info').textContent = gifInFrame + ' - ' + gifOutFrame;
  document.getElementById('gif-trim-count').textContent = (gifOutFrame - gifInFrame + 1);
}

export function startGifPreview() {
  if (gifPreviewTimer) clearInterval(gifPreviewTimer);
  gifCurrentFrame = gifInFrame;
  const speed = parseFloat(document.getElementById('gif-speed').value);
  gifPreviewTimer = setInterval(() => {
    if (!gifEditorState || !gifEditorState.rub) return;
    gifCurrentFrame++;
    if (gifCurrentFrame > gifOutFrame) gifCurrentFrame = gifInFrame;
    gifEditorState.rub.move_to(gifCurrentFrame);
    const cv = gifEditorState.rub.get_canvas();
    const pc = document.getElementById('gif-preview-canvas');
    pc.width = cv.width;
    pc.height = cv.height;
    pc.getContext('2d').drawImage(cv, 0, 0);
    // Update playhead
    const total = gifEditorState.totalFrames || 1;
    const bar = document.getElementById('gif-timeline-bar');
    const barW = bar.clientWidth || 400;
    const ph = document.getElementById('gif-playhead');
    ph.style.left = (gifCurrentFrame / total * barW) + 'px';
  }, 100 / speed);
}

export function closeGifEditor() {
  if (gifPreviewTimer) clearInterval(gifPreviewTimer);
  gifPreviewTimer = null;
  if (gifEditorState && gifEditorState._container) {
    gifEditorState._container.remove();
  }
  gifEditorState = null;
  document.getElementById('gif-modal').style.display = 'none';
}

// Timeline bar drag handlers
document.getElementById('gif-in-handle').addEventListener('mousedown', e => {
  e.preventDefault(); e.stopPropagation();
  gifTimelineDrag = 'in';
});
document.getElementById('gif-out-handle').addEventListener('mousedown', e => {
  e.preventDefault(); e.stopPropagation();
  gifTimelineDrag = 'out';
});
document.addEventListener('mousemove', e => {
  if (!gifTimelineDrag || !gifEditorState) return;
  const bar = document.getElementById('gif-timeline-bar');
  const rect = bar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const total = gifEditorState.totalFrames || 1;
  const frame = Math.round(pct * (total - 1));
  if (gifTimelineDrag === 'in') {
    gifInFrame = Math.min(frame, gifOutFrame - 1);
  } else if (gifTimelineDrag === 'out') {
    gifOutFrame = Math.max(frame, gifInFrame + 1);
  }
  updateGifTimelineUI();
  if (gifPreviewTimer) clearInterval(gifPreviewTimer);
  startGifPreview();
});
document.addEventListener('mouseup', () => {
  if (gifTimelineDrag) gifTimelineDrag = null;
});

// Click on timeline bar to set playhead position
document.getElementById('gif-timeline-bar').addEventListener('click', e => {
  if (!gifEditorState || e.target.closest('#gif-in-handle') || e.target.closest('#gif-out-handle')) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const total = gifEditorState.totalFrames || 1;
  const frame = Math.round(pct * (total - 1));
  gifCurrentFrame = Math.max(gifInFrame, Math.min(gifOutFrame, frame));
  if (gifEditorState.rub) {
    gifEditorState.rub.move_to(gifCurrentFrame);
    const cv = gifEditorState.rub.get_canvas();
    const pc = document.getElementById('gif-preview-canvas');
    pc.width = cv.width; pc.height = cv.height;
    pc.getContext('2d').drawImage(cv, 0, 0);
  }
});

export function collectGifFrames() {
  if (!gifEditorState || !gifEditorState.rub) return null;
  const rub = gifEditorState.rub;
  const speed = parseFloat(document.getElementById('gif-speed').value);
  const frames = [];
  for (let i = gifInFrame; i <= gifOutFrame; i++) {
    rub.move_to(i);
    const fc = rub.get_canvas();
    const tc = document.createElement('canvas');
    tc.width = fc.width;
    tc.height = fc.height;
    tc.getContext('2d').drawImage(fc, 0, 0);
    frames.push(tc);
  }
  return { frames, speed };
}

export function applyGifTrim() {
  if (typeof GIF === 'undefined') { toast('GIF encoder not loaded. Check internet connection.'); return; }
  const result = collectGifFrames();
  if (!result) { toast('GIF not loaded'); return; }
  const { frames, speed } = result;
  if (frames.length < 2) { toast('Need at least 2 frames'); return; }

  toast('Encoding GIF... please wait');

  try {
    const workerUrl = gifWorkerBlobUrl || 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js';
    const gif = new GIF({
      workers: 2, quality: 10,
      width: frames[0].width, height: frames[0].height,
      workerScript: workerUrl
    });

    const delay = Math.round(100 / speed);
    frames.forEach(f => gif.addFrame(f, { delay }));

    // Timeout — if encoding takes too long, warn user
    let encodingDone = false;
    const encodeTimeout = setTimeout(() => {
      if (!encodingDone) {
        toast('GIF encoding is taking long... try fewer frames or lower quality');
      }
    }, 30000);

    gif.on('progress', p => {
      // Show progress
      const pct = Math.round(p * 100);
      const info = document.getElementById('gif-trim-info');
      if (info) info.textContent = 'Encoding: ' + pct + '%';
    });

    gif.on('finished', blob => {
      encodingDone = true;
      clearTimeout(encodeTimeout);
      const reader = new FileReader();
      reader.onload = () => {
        const newSrc = reader.result;
        const item = state.items.find(i => i.id === gifEditorState.itemId);
        if (item) {
          pushUndo();
          item.src = newSrc;
          const mediaEl = item.img || item.el.querySelector('img');
          if (mediaEl) mediaEl.src = newSrc;
          item.natW = frames[0].width;
          item.natH = frames[0].height;
          toast('GIF trimmed! ' + frames.length + ' frames');
          scheduleAutoSave();
        }
        closeGifEditor();
      };
      reader.readAsDataURL(blob);
    });

    gif.on('error', err => {
      encodingDone = true;
      clearTimeout(encodeTimeout);
      console.error('GIF encoding error:', err);
      toast('GIF encoding failed. Try Export instead.');
    });

    gif.render();
  } catch(err) {
    console.error('applyGifTrim error:', err);
    toast('GIF trim failed: ' + err.message);
  }
}

export function exportGifTrim() {
  if (typeof GIF === 'undefined') { toast('GIF encoder not loaded. Check internet connection.'); return; }
  const result = collectGifFrames();
  if (!result) { toast('GIF not loaded'); return; }
  const { frames, speed } = result;
  if (frames.length < 2) { toast('Need at least 2 frames'); return; }

  toast('Exporting GIF... please wait');

  try {
    const workerUrl = gifWorkerBlobUrl || 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js';
    const gif = new GIF({
      workers: 2, quality: 10,
      width: frames[0].width, height: frames[0].height,
      workerScript: workerUrl
    });

    const delay = Math.round(100 / speed);
    frames.forEach(f => gif.addFrame(f, { delay }));

    gif.on('progress', p => {
      const pct = Math.round(p * 100);
      const info = document.getElementById('gif-trim-info');
      if (info) info.textContent = 'Exporting: ' + pct + '%';
    });

    gif.on('finished', blob => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = 'trimmed_' + Date.now() + '.gif';
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      toast('GIF exported! (' + frames.length + ' frames)');
    });

    gif.on('error', err => {
      console.error('GIF export error:', err);
      toast('GIF export failed: ' + err.message);
    });

    gif.render();
  } catch(err) {
    console.error('exportGifTrim error:', err);
    toast('GIF export failed: ' + err.message);
  }
}

window.openGifEditor = openGifEditor;
