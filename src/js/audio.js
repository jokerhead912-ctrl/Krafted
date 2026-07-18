import { updateAutoFitPaper } from './paper.js';
import { selectOnly } from './selection.js';
import { state, canvasContent, G } from './core-state.js';;

import { scheduleAutoSave } from './save-load.js';
import { updateItemStyle } from './add-items.js';
import { pushUndo } from './undo-redo.js';

export function addAudioItem(src, fileName, x, y) {
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
  // Expose a setter so kpak restore can update the visible name after load
  el._setAudioName = function(n) { nameEl.textContent = n || 'Audio'; };
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
    id: G.nextId++, el, img: null, video: null, audio: audio,
    x: x !== undefined ? x : (window.innerWidth/2 - w/2 - state.pan.x) / state.zoom,
    y: y !== undefined ? y : (window.innerHeight/2 - h/2 - state.pan.y) / state.zoom,
    w, h, rot: 0, opacity: 1, flipH: false, flipV: false, locked: false,
    z: G.nextZ++,
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

export function handleAudioUpload(event) {
  const files = [...event.target.files];
  if (files.length === 0) return;
  hideWelcome();
  const pasteX = (G.lastScreenX - state.pan.x) / state.zoom;
  const pasteY = (G.lastScreenY - state.pan.y) / state.zoom;
  files.forEach((file, idx) => {
    const reader = new FileReader();
    reader.onload = ev => {
      addAudioItem(ev.target.result, file.name, pasteX + idx * 20, pasteY + idx * 20);
    };
    reader.readAsDataURL(file);
  });
  event.target.value = ''; // Reset for re-upload
}

window.addAudioItem = addAudioItem;
window.handleAudioUpload = handleAudioUpload;

