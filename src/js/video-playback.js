import { getSelectedImages } from './selection.js';
import { state } from './core-state.js';

import { updateMediaBar } from './media-bar.js';

export function toggleVideoPlay() {
  const sel = getSelectedImages();
  if (sel.length === 0 || !sel[0].video) return;
  const item = sel[0];
  const v = item.video;
  if (v.paused) {
    const ts = item.trimStart || 0;
    if (v.currentTime < ts || v.currentTime >= (item.trimEnd || v.duration) - 0.1) v.currentTime = ts;
    v.muted = false; v.play().catch(() => {});
  } else { v.pause(); }
  document.getElementById('btn-video-play').textContent = v.paused ? '▶️ Play' : '⏸ Pause';
  updateMediaBar();
}
export function restartVideo() {
  const sel = getSelectedImages();
  if (sel.length === 0 || !sel[0].video) return;
  const item = sel[0];
  const v = item.video;
  v.currentTime = item.trimStart || 0;
  v.play().catch(() => {});
  document.getElementById('btn-video-play').textContent = '⏸ Pause';
  updateMediaBar();
}
export function setVideoVolume(val) {
  const sel = getSelectedImages();
  if (sel.length === 0 || !sel[0].video) return;
  sel[0].video.muted = val == 0;
  sel[0].video.volume = val / 100;
  document.getElementById('prop-video-vol-val').textContent = val + '%';
}
