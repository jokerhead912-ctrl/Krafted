import { getSelectedItems, selectOnly } from './selection.js';
import { state, _frozenGifs } from './core-state.js';

import { isAnimatedGif } from './gif-editor.js';
import { toast } from './ui-utils.js';
import { updatePropsPanel } from './props-panel.js';

// ============================================================
//  MEDIA CONTROL BAR
// ============================================================
// _frozenGifs is now defined in core-state.js and exported.
// This section reuses that export (no redefinition).

export function updateMediaBar() {
  const bar = document.getElementById('media-bar');
  const list = document.getElementById('media-list');
  // Collect all GIF and video items
  const mediaItems = state.items.filter(i => {
    if (i.video) return true;
    if (i.img && i.src && isAnimatedGif(i.src)) return true;
    return false;
  });
  if (mediaItems.length === 0) {
    bar.classList.remove('active');
    _syncBottomBarOffsets();
    return;
  }
  bar.classList.add('active');
  list.innerHTML = '';
  mediaItems.forEach(item => {
    const isVid = !!item.video;
    const isPlaying = isVid ? !item.video.paused : !_frozenGifs.has(item.id);
    const icon = isVid ? 'VID' : 'GIF';
    const label = isVid ? 'Video' : 'GIF';
    const el = document.createElement('div');
    el.className = 'media-item' + (isPlaying ? ' is-playing' : '');
    el.innerHTML = `<span class="media-icon">${icon}</span>${label} #${item.id} ${isPlaying ? '▶' : '⏸'}`;
    el.onclick = () => { selectOnly(item.id); updatePropsPanel(); };
    list.appendChild(el);
  });
  // Update Play All / Pause All button state
  const anyPlaying = mediaItems.some(i => i.video ? !i.video.paused : !_frozenGifs.has(i.id));
  document.getElementById('btn-play-all').classList.toggle('playing', anyPlaying);
  _syncBottomBarOffsets();
}

/* Round 95: the bottom-left #zoom-step-widget (Wheel step / Frame /
   Natural scroll) and bottom-right #status pill are both `position:fixed`
   at a hardcoded `bottom` value, with NO awareness of #media-bar (the
   Play All/Pause All row that slides in from the bottom whenever a
   video or GIF exists on the board). Whenever media-bar activates, it
   sits on top of them (screenshot: Wheel step row half-buried under
   Play All/Pause All). Fix: measure the real, current height of
   #media-bar via getBoundingClientRect() (never hardcode — text can
   wrap, DPI-scale can change padding) and push both widgets up by
   exactly that height + a small gap, whenever it's active. Restore
   the default 14px/42px the instant media-bar goes away. */
export function _syncBottomBarOffsets() {
  const bar = document.getElementById('media-bar');
  const zw = document.getElementById('zoom-step-widget');
  const st = document.getElementById('status');
  if (!bar || !zw || !st) return;
  const active = bar.classList.contains('active');
  const barH = active ? bar.getBoundingClientRect().height : 0;
  const gap = active ? 8 : 0;
  zw.style.bottom = (14 + barH + gap) + 'px';
  st.style.bottom = (42 + barH + gap) + 'px';
}
// Keep the offsets correct if media-bar's own height changes (e.g. the
// media-list wraps to two lines on a narrow window, or DPI-scale changes
// its padding) without anyone explicitly calling updateMediaBar() again.
if (typeof ResizeObserver !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function () {
    const bar = document.getElementById('media-bar');
    if (bar) {
      const _mediaBarRO = new ResizeObserver(function () { _syncBottomBarOffsets(); });
      _mediaBarRO.observe(bar);
    }
  });
}

export function playAllMedia() {
  // Limit concurrent video playback to avoid crashes with many videos.
  // Hardware decoders typically handle 4-8 concurrent, but with CSS filter applied drops to 2-3.
  // 3 is the sweet spot for "always smooth" with filters enabled.
  const MAX_CONCURRENT_VIDEOS = 3;
  // Pick the 3 most-visible videos first (selected, or nearest to viewport center).
  // This way the user always sees something playing, even if they have 50 videos on the board.
  const vw = window.innerWidth, vh = window.innerHeight;
  const cx = vw / 2 - state.pan.x;
  const cy = vh / 2 - state.pan.y;
  const videos = state.items.filter(i => i.video);
  videos.sort((a, b) => {
    // Selected videos first
    const aSel = (a.id === state.selectedId) ? 0 : 1;
    const bSel = (b.id === state.selectedId) ? 0 : 1;
    if (aSel !== bSel) return aSel - bSel;
    // Then by distance to viewport center
    const da = Math.hypot((a.x + (a.w||0)/2) - cx, (a.y + (a.h||0)/2) - cy);
    const db = Math.hypot((b.x + (b.w||0)/2) - cx, (b.y + (b.h||0)/2) - cy);
    return da - db;
  });
  let videoCount = 0;
  videos.forEach(item => {
    if (videoCount < MAX_CONCURRENT_VIDEOS) {
      item.video.muted = false;
      item.video.play().catch(() => {});
      videoCount++;
    } else {
      // Pause the rest — they're queued for later, no point decoding them
      item.video.pause();
    }
  });
  // Unfreeze GIFs (cheap, just restores img.src)
  state.items.forEach(item => {
    if (_frozenGifs.has(item.id)) {
      const origSrc = _frozenGifs.get(item.id);
      if (item.img) item.img.src = origSrc;
      _frozenGifs.delete(item.id);
    }
  });
  updateMediaBar();
  toast(videoCount > 0 ? '\u25b6\ufe0f Playing ' + videoCount + ' video' + (videoCount > 1 ? 's' : '') : '\u25b6\ufe0f All media playing');
}

export function pauseAllMedia() {
  state.items.forEach(item => {
    if (item.video) {
      item.video.pause();
    }
    // Freeze GIFs by replacing src with a static first frame
    if (item.img && item.src && isAnimatedGif(item.src) && !_frozenGifs.has(item.id)) {
      try {
        const c = document.createElement('canvas');
        c.width = item.img.naturalWidth || item.natW;
        c.height = item.img.naturalHeight || item.natH;
        const cctx = c.getContext('2d');
        cctx.drawImage(item.img, 0, 0);
        const staticSrc = c.toDataURL('image/png');
        _frozenGifs.set(item.id, item.img.src);
        item.img.src = staticSrc;
      } catch(e) {
        // CORS or other error — skip freeze
      }
    }
  });
  updateMediaBar();
  toast('⏸ All media paused — memory saved');
}

export function toggleMediaItem(itemId) {
  const item = state.items.find(i => i.id === itemId);
  if (!item) return;
  if (item.video) {
    if (item.video.paused) { item.video.muted = false; item.video.play().catch(() => {}); }
    else { item.video.pause(); }
  } else if (_frozenGifs.has(item.id)) {
    const origSrc = _frozenGifs.get(item.id);
    if (item.img) item.img.src = origSrc;
    _frozenGifs.delete(item.id);
  } else if (item.img && item.src && isAnimatedGif(item.src)) {
    try {
      const c = document.createElement('canvas');
      c.width = item.img.naturalWidth || item.natW;
      c.height = item.img.naturalHeight || item.natH;
      const cctx = c.getContext('2d');
      cctx.drawImage(item.img, 0, 0);
      const staticSrc = c.toDataURL('image/png');
      _frozenGifs.set(item.id, item.img.src);
      item.img.src = staticSrc;
    } catch(e) {}
  }
  updateMediaBar();
}

window.playAllMedia = playAllMedia;
window.pauseAllMedia = pauseAllMedia;
window.updateMediaBar = updateMediaBar;
