// ============================================================
//  GIF EDITOR
// ============================================================
let gifEditorState = null;
let gifPreviewTimer = null;
let gifCurrentFrame = 0;
let gifInFrame = 0;
let gifOutFrame = 0;
let gifTimelineDrag = null; // 'in' or 'out'
let gifWorkerBlobUrl = null; // Blob URL for gif.js worker (avoids CORS issues)

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

function isAnimatedGif(src) {
  if (!src) return false;
  // Check for data: GIF URLs
  if (src.startsWith('data:image/gif')) return true;
  // Check for .gif extension in URL
  if (/\.gif[\?#]?/i.test(src)) return true;
  return false;
}

function openGifEditor(item) {
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

function renderGifTimelineBar() {
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

function updateGifTimelineUI() {
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

function startGifPreview() {
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

function closeGifEditor() {
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

function collectGifFrames() {
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

function applyGifTrim() {
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

function exportGifTrim() {
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

// ============================================================
//  AUDIO ITEMS — MP3/WAV/AIFF support on main canvas
// ============================================================
function addAudioItem(src, fileName, x, y) {
  pushUndo();
  const w = 280, h = 64;
  const el = document.createElement('div');
  el.className = 'item audio-item';
  el.style.cssText = 'display:flex;flex-direction:column;justify-content:center;background:#1a1a2e;border:1px solid rgba(0,229,255,0.3);border-radius:10px;padding:10px 14px;box-sizing:border-box;';
  // Music icon + filename
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
  header.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00e5ff" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  const nameEl = document.createElement('span');
  nameEl.style.cssText = 'color:#ccc;font-size:11px;font-family:Inter,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;';
  nameEl.textContent = fileName || 'Audio';
  header.appendChild(nameEl);
  el.appendChild(header);
  // Audio element + custom player
  const audio = document.createElement('audio');
  audio.src = src;
  audio.preload = 'metadata';
  audio.style.cssText = 'display:none;';
  el.appendChild(audio);
  // Custom player UI
  const player = document.createElement('div');
  player.style.cssText = 'display:flex;align-items:center;gap:8px;';
  const playBtn = document.createElement('button');
  playBtn.style.cssText = 'background:rgba(0,229,255,0.15);border:1px solid rgba(0,229,255,0.4);color:#00e5ff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;flex-shrink:0;';
  playBtn.innerHTML = '▶';
  const seekBar = document.createElement('div');
  seekBar.style.cssText = 'flex:1;height:4px;background:rgba(255,255,255,0.15);border-radius:2px;cursor:pointer;position:relative;';
  const seekFill = document.createElement('div');
  seekFill.style.cssText = 'position:absolute;left:0;top:0;height:100%;background:#00e5ff;border-radius:2px;width:0%;';
  seekBar.appendChild(seekFill);
  const timeLabel = document.createElement('span');
  timeLabel.style.cssText = 'color:#999;font-size:10px;font-family:monospace;flex-shrink:0;min-width:70px;text-align:right;';
  timeLabel.textContent = '0:00 / 0:00';
  player.appendChild(playBtn);
  player.appendChild(seekBar);
  player.appendChild(timeLabel);
  // Volume control
  const volWrap = document.createElement('div');
  volWrap.style.cssText = 'position:relative;flex-shrink:0;display:flex;align-items:center;margin-left:4px;';
  const volBtn = document.createElement('button');
  volBtn.style.cssText = 'background:none;border:1px solid rgba(0,229,255,0.35);color:#00e5ff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:10px;flex-shrink:0;padding:0;';
  volBtn.innerHTML = '&#128264;';
  volBtn.title = 'Volume';
  const volPopover = document.createElement('div');
  volPopover.style.cssText = 'position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:rgba(26,26,46,0.97);border:1px solid #444;border-radius:8px;padding:10px 8px;display:none;flex-direction:column;align-items:center;gap:6px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.5);-webkit-';
  const volSlider = document.createElement('input');
  volSlider.type = 'range'; volSlider.min = '0'; volSlider.max = '1'; volSlider.step = '0.01';
  volSlider.value = String(audio.volume);
  volSlider.style.cssText = '-webkit-appearance:none;appearance:none;width:80px;height:4px;border-radius:2px;background:rgba(255,255,255,0.2);outline:none;cursor:pointer;';
  volSlider.title = 'Volume';
  const volLabel = document.createElement('span');
  volLabel.style.cssText = 'font-size:9px;color:rgba(255,255,255,0.7);font-family:Inter,monospace;min-width:28px;text-align:center;';
  volLabel.textContent = Math.round(audio.volume * 100) + '%';
  volSlider.addEventListener('input', function() {
    audio.volume = parseFloat(volSlider.value);
    audio.muted = false;
    volLabel.textContent = Math.round(audio.volume * 100) + '%';
    volBtn.innerHTML = audio.volume === 0 ? '&#128263;' : '&#128264;';
  });
  volBtn.addEventListener('click', function(ev) {
    ev.stopPropagation();
    if (audio.volume > 0) { audio.volume = 0; volSlider.value = '0'; volBtn.innerHTML = '&#128263;'; }
    else { audio.volume = 0.7; volSlider.value = '0.7'; volBtn.innerHTML = '&#128264;'; }
    volLabel.textContent = Math.round(audio.volume * 100) + '%';
  });
  volPopover.appendChild(volSlider);
  volPopover.appendChild(volLabel);
  volWrap.appendChild(volBtn);
  volWrap.appendChild(volPopover);
  // Prevent volume controls from triggering canvas drag
  [volBtn, volSlider, volPopover].forEach(c => { c.addEventListener('mousedown', e => e.stopPropagation()); });
  player.appendChild(volWrap);
  el.appendChild(player);

  // Audio badge
  const audioBadge = document.createElement('div');
  audioBadge.className = 'media-type-badge audio-badge';
  audioBadge.textContent = 'AUDIO';
  el.appendChild(audioBadge);

  canvasContent.appendChild(el);
  // Format time helper
  function fmtTime(t) {
    if (!t || isNaN(t)) return '0:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  // Play/pause toggle
  playBtn.onclick = (ev) => {
    ev.stopPropagation();
    if (audio.paused) { audio.play(); playBtn.innerHTML = '⏸'; } else { audio.pause(); playBtn.innerHTML = '▶'; }
  };
  audio.addEventListener('ended', () => { playBtn.innerHTML = '▶'; });
  audio.addEventListener('loadedmetadata', () => {
    timeLabel.textContent = '0:00 / ' + fmtTime(audio.duration);
  });
  audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
      seekFill.style.width = (audio.currentTime / audio.duration * 100) + '%';
      timeLabel.textContent = fmtTime(audio.currentTime) + ' / ' + fmtTime(audio.duration);
    }
  });
  // Seek
  seekBar.onclick = (ev) => {
    ev.stopPropagation();
    if (!audio.duration) return;
    const rect = seekBar.getBoundingClientRect();
    audio.currentTime = ((ev.clientX - rect.left) / rect.width) * audio.duration;
  };
  // Prevent player interactions from triggering canvas drag
  [playBtn, seekBar, timeLabel].forEach(c => { c.addEventListener('mousedown', e => e.stopPropagation()); });

  const item = {
    id: nextId++, el, img: null, video: null, audio: audio,
    x: x !== undefined ? x : (window.innerWidth/2 - w/2 - state.pan.x) / state.zoom,
    y: y !== undefined ? y : (window.innerHeight/2 - h/2 - state.pan.y) / state.zoom,
    w, h, rot: 0, opacity: 1, flipH: false, flipV: false, locked: false,
    z: nextZ++,
    src, isAudio: true, audioName: fileName || 'Audio',
    natW: w, natH: h,
    cropX: 0, cropY: 0, cropW: w, cropH: h,
    brightness: 100, contrast: 100, saturate: 100, hueRotate: 0, blur: 0, sepia: 0, grayscale: 0,
    temp: 0, vignette: 0, shadow: 100, highlight: 100, grain: 0,
    trimStart: 0, trimEnd: 0, playbackRate: 1,
  };
  state.items.push(item);
  updateItemStyle(item);
  selectOnly(item.id);
  scheduleAutoSave();
  updateAutoFitPaper();
  return item;
}

function handleAudioUpload(event) {
  const files = [...event.target.files];
  if (files.length === 0) return;
  hideWelcome();
  const pasteX = (lastScreenX - state.pan.x) / state.zoom;
  const pasteY = (lastScreenY - state.pan.y) / state.zoom;
  files.forEach((file, idx) => {
    const reader = new FileReader();
    reader.onload = ev => {
      addAudioItem(ev.target.result, file.name, pasteX + idx * 20, pasteY + idx * 20);
    };
    reader.readAsDataURL(file);
  });
  event.target.value = ''; // Reset for re-upload
}

// ============================================================
//  EXPORT MEDIA — download original source files
// ============================================================
function exportMediaSelected() {
  const sel = getSelectedItems();
  if (sel.length === 0) { toast('Select an item first'); return; }
  sel.forEach(item => {
    if (!item.src) return;
    let ext = 'bin';
    let name = 'export_' + Date.now();
    if (item.isAudio) {
      name = item.audioName || 'audio';
      if (item.src.startsWith('data:')) {
        const m = item.src.match(/^data:audio\/(\w+)/);
        if (m) ext = m[1];
      } else {
        ext = item.src.split('.').pop().split('?')[0] || 'mp3';
      }
    } else if (item.isVideo) {
      name = 'video_' + Date.now();
      if (item.src.startsWith('data:')) {
        const m = item.src.match(/^data:video\/(\w+)/);
        if (m) ext = m[1];
      } else {
        ext = item.src.split('.').pop().split('?')[0] || 'mp4';
      }
    } else if (item.src) {
      name = 'image_' + Date.now();
      if (item.src.startsWith('data:')) {
        const m = item.src.match(/^data:image\/(\w+)/);
        if (m) ext = m[1];
      } else {
        ext = item.src.split('.').pop().split('?')[0] || 'png';
      }
    }
    // Convert data URI or blob URL to download
    const link = document.createElement('a');
    link.download = name.replace(/\.[^.]+$/, '') + '.' + ext;
    link.href = item.src;
    link.click();
  });
  toast('Downloading ' + sel.length + ' file(s)');
}

// ============================================================
//  REFRAME — reposition image within its frame (crop)
// ============================================================
function enterReframe(item) {
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

function exitReframe(apply) {
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

function enterCrop(item) {
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
  item.z = ++nextZ;
  el.style.zIndex = item.z;
}

function setCropAspect(v) {
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

function positionCropUI() {
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

function exitCrop(restoreOriginal) {
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

function applyCrop() {
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

// ============================================================
//  HELP PANEL — hotkeys & function guide
// ============================================================
function showHelp() {
  const overlay = document.getElementById('help-overlay');
  if (overlay) overlay.style.display = 'flex';
}
function hideHelp() {
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
function newBoard() {
  cleanupAllItems();
  state.items = [];
  state.texts = [];
  state.todos = [];
  state.mindmaps = [];
  state.selected.clear();
  state.groups.forEach(g => g.borderEl.remove());
  state.groups = [];
  nextGroupId = 1;
  state.undoStack = [];
  state.redoStack = [];
  nextZ = 1; nextId = 1;
  drawStrokes = [];
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

function hasFileSystemAccess() {
  return typeof window.showDirectoryPicker === 'function';
}

async function pickSaveFolder() {
  if (!hasFileSystemAccess()) return null;
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (e) {
    // User cancelled the picker — silent return
    if (e && (e.name === 'AbortError' || e.code === 20 || e.code === 'ABORT_ERR')) return null;
    throw e;
  }
}

function dataUrlToBlob(dataUrl) {
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

function canvasToBlobAsync(canvas, type, quality) {
  type = type || 'image/png';
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob returned null')), type, quality);
    } catch (e) { reject(e); }
  });
}

function sanitizeFilename(name, fallback) {
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

async function uniqueFilename(dirHandle, base, ext) {
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

async function writeBlobToFolder(dirHandle, filename, blob) {
  const fh = await dirHandle.getFileHandle(filename, { create: true });
  const w = await fh.createWritable();
  try { await w.write(blob); } finally { await w.close(); }
  return filename;
}

function triggerDownload(blob, filename) {
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
function hasShowSaveFilePicker() {
  return typeof window.showSaveFilePicker === 'function';
}
async function kraftedSaveFile(opts) {
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
async function saveCaptureToFolder(canvas, suggestedName, onComplete) {
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

function saveExportModalToFolder() {
  saveCaptureToFolder(
    document.getElementById('export-canvas'),
    'krafted_export_' + Date.now()
  );
}

function saveCapturePanelToFolder() {
  saveCaptureToFolder(
    captureResultCanvas,
    'krafted_capture_' + Date.now(),
    () => {
      captureResultPanel.classList.remove('show');
      captureResultCanvas = null;
      captureResultImg.style.display = '';
    }
  );
}

// Export all images on the board (or only the selected ones) to a chosen local folder
async function exportAllImagesToFolder() {
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
