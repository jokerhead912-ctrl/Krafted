import { getSelectedImages, getSelectedItems, selectOnly } from './selection.js';
import { state } from './core-state.js';

import { scheduleAutoSave } from './save-load.js';
import { toast } from './ui-utils.js';
import { updateVideoControls } from './frame-comments.js';
import { pushUndo } from './undo-redo.js';

export function setupVideoTrim(item) {
  const v = item.video;
  if (!v) return;
  // When metadata is ready, set trimEnd to full duration
  const onMeta = () => {
    if (!item.trimEnd || item.trimEnd <= 0 || item.trimEnd > v.duration) {
      item.trimEnd = v.duration;
    }
    v.playbackRate = item.playbackRate || 1;
    // Seek to trim start
    if (v.currentTime < (item.trimStart || 0)) {
      v.currentTime = item.trimStart || 0;
    }
    if (state.selected.has(item.id)) updateVideoTimeline(item);
  };
  if (v.readyState >= 1) onMeta();
  else v.addEventListener('loadedmetadata', onMeta);
  // Loop within trim range
  v.addEventListener('timeupdate', () => {
    const ts = item.trimStart || 0;
    const te = item.trimEnd || v.duration;
    if (v.currentTime >= te) {
      v.currentTime = ts;
    }
    if (v.currentTime < ts - 0.05) {
      v.currentTime = ts;
    }
    // Only update playhead UI if this item is currently selected
    if (state.selected.has(item.id)) updateVideoPlayhead(item);
  });
  // Seek to trimStart when playing
  v.addEventListener('play', () => {
    const ts = item.trimStart || 0;
    if (v.currentTime < ts || v.currentTime >= (item.trimEnd || v.duration) - 0.1) {
      v.currentTime = ts;
    }
  });
}

// Global time display mode for video panels: 'time' shows 0:00, 'frame' shows f 1234.
// Initialized to 'time' on load; toggled by clicking any .video-time-toggle label
// or the in-player .media-time label. Persists across selections.
export var videoTimeMode = (function() {
  try {
    var saved = (window.KraftedStorage && window.KraftedStorage.getItemSync('krafted.videoTimeMode')) || localStorage.getItem('krafted.videoTimeMode');
    return (saved === 'time' || saved === 'frame') ? saved : 'time';
  } catch (e) { return 'time'; }
})();
export function setVideoTimeMode(mode) {
  if (mode !== 'time' && mode !== 'frame') return;
  videoTimeMode = mode;
  try {
    localStorage.setItem('krafted.videoTimeMode', mode);
    if (window.KraftedStorage) window.KraftedStorage.setItem('krafted.videoTimeMode', mode).catch(function(){});
  } catch (e) {}
  refreshVideoPanelTimes();
}
export function getSelectedVideoItem() {
  try {
    var sel = (typeof getSelectedImages === 'function') ? getSelectedImages() : [];
    if (sel && sel.length && sel[0] && sel[0].video) return sel[0];
  } catch (e) {}
  return null;
}
export function getCurrentFps() {
  var it = getSelectedVideoItem();
  if (it && it.video && it.video._kraftedFps) return it.video._kraftedFps;
  return 30; // sensible default
}
export function formatTime(s) {
  if (!s || isNaN(s)) return videoTimeMode === 'frame' ? 'f 0' : '0:00';
  if (videoTimeMode === 'frame') {
    var fps = getCurrentFps();
    var fIdx = Math.round(s * fps);
    return 'f ' + fIdx;
  }
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + sec.toString().padStart(2, '0');
}
export function formatTimeWithTotal(s, totalS) {
  if (!s || isNaN(s)) return videoTimeMode === 'frame' ? 'f 0 / 0' : '0:00';
  if (videoTimeMode === 'frame') {
    var fps = getCurrentFps();
    var fIdx = Math.round(s * fps);
    var fTotal = (totalS && !isNaN(totalS)) ? Math.round(totalS * fps) : 0;
    return 'f ' + fIdx + ' / ' + fTotal;
  }
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + sec.toString().padStart(2, '0');
}
// Format a video time using the PER-ITEM display mode (the in-player label
// stores its mode on `item.el._timeMode`, separate from the global
// `videoTimeMode` used by the right panel). Reads `vid._kraftedFps` so the
// frame count matches the in-player FPS chip after a re-detect.
export function formatVideoTimeForLabel(itemEl, vid, seconds) {
  var mode = (itemEl && itemEl._timeMode) || 'time';
  var dur = (vid && isFinite(vid.duration)) ? vid.duration : 0;
  if (mode === 'frame' && dur > 0) {
    var fps = (vid && vid._kraftedFps) ? vid._kraftedFps : 30;
    var fIdx = Math.round(seconds * fps);
    var fTotal = Math.round(dur * fps);
    return 'f ' + fIdx + ' / ' + fTotal;
  }
  if (!isFinite(seconds)) return '0:00';
  var m = Math.floor(seconds / 60);
  var s = Math.floor(seconds % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}
// Re-render the time labels in the right panel to reflect the current mode.
export function refreshVideoPanelTimes() {
  var it = getSelectedVideoItem();
  if (!it) return;
  var v = it.video;
  var dur = (v && isFinite(v.duration)) ? v.duration : 0;
  var ts = it.trimStart || 0;
  var te = it.trimEnd || dur;
  var startLabel = document.getElementById('video-trim-start-label');
  var endLabel = document.getElementById('video-trim-end-label');
  var durLabel = document.getElementById('video-trim-dur-label');
  var curLabel = document.getElementById('video-current-time');
  if (startLabel) startLabel.textContent = formatTime(ts);
  if (endLabel) endLabel.textContent = formatTime(te);
  if (durLabel) durLabel.textContent = formatTimeWithTotal(te - ts, dur);
  if (curLabel) curLabel.textContent = formatTimeWithTotal((v && v.currentTime) || 0, dur);
  // Update FPS label too (it can change after re-detect)
  var fpsLabel = document.getElementById('video-frame-rate-label');
  if (fpsLabel) {
    var fps = getCurrentFps();
    fpsLabel.textContent = fps + ' fps';
  }
  // Also refresh the in-player controls' FPS chip and the current-time label
  // for the selected video, so the in-player UI matches the panel.
  try {
    if (it.el) {
      var inPlayerFps = it.el.querySelector && it.el.querySelector('.media-fps-chip');
      if (inPlayerFps) inPlayerFps.textContent = (v && v._kraftedFps ? v._kraftedFps : 30) + ' fps';
      // The in-player current-time label has its own per-element time mode,
      // but the user can re-toggle it independently. We don't overwrite it here
      // to preserve their per-video preference.
    }
  } catch (e) {}
}
// Wire up click handlers on the right-panel time labels and the FPS label.
// Use a single delegated click on the prop section so we don't need to re-bind
// when the panel re-renders.
(function bindVideoTimeToggles() {
  function delegate() {
    var root = document.querySelector('.prop-section') || document.body;
    if (root._kraftedTimeToggleBound) return;
    root._kraftedTimeToggleBound = true;
    root.addEventListener('click', function(ev) {
      var t = ev.target;
      if (!t || !t.classList) return;
      if (t.classList.contains('video-time-toggle')) {
        ev.stopPropagation();
        setVideoTimeMode(videoTimeMode === 'time' ? 'frame' : 'time');
        return;
      }
      if (t.id === 'video-frame-rate-label') {
        ev.stopPropagation();
        var it = getSelectedVideoItem();
        if (!it || !it.video) return;
        // Re-detect FPS using the same heuristic as elsewhere in the file
        try { delete it.video._kraftedFps; } catch (e) { it.video._kraftedFps = undefined; }
        var detected = 30;
        try {
          if (typeof it.video.getVideoPlaybackQuality === 'function') {
            var q = it.video.getVideoPlaybackQuality();
            if (q && q.totalVideoFrames > 0 && it.video.duration > 0) {
              detected = Math.round(q.totalVideoFrames / it.video.duration);
            }
          }
        } catch (e) {}
        if (!detected || detected <= 0) {
          var h = it.video.videoHeight || 720;
          if (h >= 2160) detected = 60;
          else if (h >= 1080) detected = 30;
          else if (h >= 720) detected = 30;
          else detected = 24;
        }
        it.video._kraftedFps = Math.max(12, Math.min(120, detected));
        t.textContent = it.video._kraftedFps + ' fps';
        refreshVideoPanelTimes();
        if (typeof toast === 'function') toast('Frame rate: ' + it.video._kraftedFps + ' fps');
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', delegate);
  } else {
    delegate();
  }
})();

export function updateVideoTimeline(item) {
  // The live trim UI is on the in-player mini-timeline now. The right panel
  // is just a read-only mirror. Update its labels to keep the displayed
  // start/end/duration values in sync, but skip the (now-removed) bar / handles.
  if (!item || !item.video) return;
  const v = item.video;
  const dur = v.duration || 0;
  if (dur <= 0) return;
  const ts = item.trimStart || 0;
  const te = item.trimEnd || dur;
  const startLabel = document.getElementById('video-trim-start-label');
  const endLabel = document.getElementById('video-trim-end-label');
  const durLabel = document.getElementById('video-trim-dur-label');
  if (startLabel) startLabel.textContent = formatTime(ts);
  if (endLabel) endLabel.textContent = formatTime(te);
  if (durLabel) durLabel.textContent = formatTimeWithTotal(te - ts, dur);
  // The in-player mini-timeline UI lives inside the buildMediaControls closure,
  // so it refreshes itself via its own timeupdate listener. Nothing to do here.
}

export function updateVideoPlayhead(item) {
  const playhead = document.getElementById('video-playhead');
  if (!playhead || !item.video) return;
  const v = item.video;
  const dur = v.duration || 0;
  if (dur <= 0) return;
  playhead.style.left = (v.currentTime / dur * 100) + '%';
  // Update current time label (with total so frame mode shows f 1234 / 3600)
  const curLabel = document.getElementById('video-current-time');
  if (curLabel) curLabel.textContent = formatTimeWithTotal(v.currentTime, dur);
}

export function setVideoTrimStart(val) {
  const sel = getSelectedImages();
  if (sel.length === 0 || !sel[0].video) return;
  const item = sel[0];
  const v = item.video;
  const dur = v.duration || 0;
  val = Math.max(0, Math.min(val, (item.trimEnd || dur) - 0.1));
  item.trimStart = val;
  if (v.currentTime < val) v.currentTime = val;
  updateVideoTimeline(item);
  scheduleAutoSave();
}

export function setVideoTrimEnd(val) {
  const sel = getSelectedImages();
  if (sel.length === 0 || !sel[0].video) return;
  const item = sel[0];
  const v = item.video;
  const dur = v.duration || 0;
  val = Math.min(dur, Math.max(val, (item.trimStart || 0) + 0.1));
  item.trimEnd = val;
  if (v.currentTime > val) v.currentTime = item.trimStart || 0;
  updateVideoTimeline(item);
  scheduleAutoSave();
}

export function setVideoPlaybackRate(rate) {
  const sel = getSelectedImages();
  if (sel.length === 0 || !sel[0].video) return;
  const item = sel[0];
  item.playbackRate = parseFloat(rate);
  item.video.playbackRate = item.playbackRate;
  scheduleAutoSave();
}

export function seekVideo(pct) {
  const sel = getSelectedImages();
  if (sel.length === 0 || !sel[0].video) return;
  const item = sel[0];
  const v = item.video;
  const dur = v.duration || 0;
  if (dur <= 0) return;
  const target = Math.max(item.trimStart || 0, Math.min(item.trimEnd || dur, pct * dur));
  v.currentTime = target;
  updateVideoPlayhead(item);
}

// Timeline drag interactions
export let videoTrimDragging = null; // 'start', 'end', 'seek', or null

export function videoTimelineMouseDown(e, type) {
  e.stopPropagation();
  e.preventDefault();
  videoTrimDragging = type;
  const bar = document.getElementById('video-timeline-bar');
  if (!bar) return;
  const sel = getSelectedImages();
  if (sel.length === 0 || !sel[0].video) return;
  const item = sel[0];
  const v = item.video;
  const dur = v.duration || 0;
  if (dur <= 0) return;
  if (type === 'seek') {
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekVideo(pct);
  }
  const moveHandler = (ev) => {
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    const time = pct * dur;
    if (videoTrimDragging === 'start') {
      setVideoTrimStart(time);
    } else if (videoTrimDragging === 'end') {
      setVideoTrimEnd(time);
    } else if (videoTrimDragging === 'seek') {
      seekVideo(pct);
    }
  };
  const upHandler = () => {
    if (videoTrimDragging === 'start' || videoTrimDragging === 'end') {
      pushUndo();
    }
    videoTrimDragging = null;
    document.removeEventListener('mousemove', moveHandler);
    document.removeEventListener('mouseup', upHandler);
  };
  document.addEventListener('mousemove', moveHandler);
  document.addEventListener('mouseup', upHandler);
}

export function resetVideoTrim() {
  const sel = getSelectedImages();
  if (sel.length === 0 || !sel[0].video) return;
  const item = sel[0];
  const v = item.video;
  pushUndo();
  item.trimStart = 0;
  item.trimEnd = v.duration || 0;
  item.playbackRate = 1;
  v.playbackRate = 1;
  v.currentTime = 0;
  updateVideoTimeline(item);
  updateVideoPlayhead(item);
  updateVideoControls(item);
  scheduleAutoSave();
}

window.setupVideoTrim = setupVideoTrim;
window.setVideoTimeMode = setVideoTimeMode;
window.setVideoTrimStart = setVideoTrimStart;
window.setVideoTrimEnd = setVideoTrimEnd;
window.setVideoPlaybackRate = setVideoPlaybackRate;
window.seekVideo = seekVideo;
window.resetVideoTrim = resetVideoTrim;
window.getCurrentFps = getCurrentFps;
