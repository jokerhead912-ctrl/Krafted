import { renderMasks } from './masking.js';
import { mmUpdateConnectors } from './mindmap.js';
import { updateAutoFitPaper } from './paper.js';
import { clearSelection, getSelectedItems, refreshSelection, selectOnly } from './selection.js';
import { setTool } from './tools.js';
import { state, canvasContent, G, textTool } from './core-state.js';
import { _cullLast } from './canvas-view.js';;

import { pushUndo, undo } from './undo-redo.js';
import { setupVideoTrim } from './video-trim.js';
import { buildMediaControls } from './media-player.js';
import { updateMediaBar } from './media-bar.js';
import { showTextQuickBar, updateTextColorPalette, updateTextQuickBarActive } from './text-style.js';
import { scheduleAutoSave } from './save-load.js';
import { cullOffscreenItems } from './canvas-view.js';
import { isAnimatedGif } from './gif-editor.js';
import { toast } from './ui-utils.js';
import { canvas } from './core-state.js';
import { updateCgiOverlays } from './props-panel.js';

// ============================================================
export function addImage(src, natW, natH, x, y, isVideoFlag, isLast) {
  // BATCH MODE (isLast defined): caller manages the batch undo (push it ONCE at start),
  // so we skip pushUndo here. We only call selectOnly on the last item so the final dropped
  // image is the active selection. This prevents memory crash from N parallel FileReader/
  // Image decodes and N JSON snapshot bloat in the undo stack.
  // SINGLE MODE (isLast undefined): backward compat — push undo + select as before.
  const isBatch = (isLast !== undefined);
  if (!isBatch) pushUndo();
  // Bigger default so the player actually fills the canvas (was 400, then 540, now 720).
  const maxW = 720;
  let w = natW, h = natH;
  if (w > maxW) { h = h * (maxW / w); w = maxW; }
  const isVideo = !!isVideoFlag;
  const el = document.createElement('div');
  el.className = 'item';
  let mediaEl;
  if (isVideo) {
    mediaEl = document.createElement('video');
    mediaEl.src = src;
    mediaEl.playsInline = true;
    mediaEl.loop = true;
    mediaEl.muted = true;
    mediaEl.preload = 'metadata';  // v5.5: metadata-only preload saves memory; full load on play
    mediaEl.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;background:#000;object-fit:contain;';
    // Seek to first frame for thumbnail (metadata-only preload won't show a frame otherwise)
    mediaEl.addEventListener('loadedmetadata', () => {
      if (mediaEl.currentTime < 0.05) mediaEl.currentTime = 0.1;
    });
  } else {
    mediaEl = document.createElement('img');
    mediaEl.src = src;
    mediaEl.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;';
  }
  mediaEl.draggable = false;
  // ── Video / GIF: use buildMediaControls helper ──
  const isAnimatedGifSrc = !isVideo && isAnimatedGif(src);
  if (isVideo || isAnimatedGifSrc) {
    buildMediaControls(el, mediaEl, isVideo, isAnimatedGifSrc);
  } else {
    // Plain image: media goes directly in .item
    el.appendChild(mediaEl);
  }
  canvasContent.appendChild(el);
  const item = {
    id: G.nextId++, el, img: isVideo ? null : mediaEl, video: isVideo ? mediaEl : null,
    x: x !== undefined ? x : (window.innerWidth/2 - w/2 - state.pan.x) / state.zoom,
    y: y !== undefined ? y : (window.innerHeight/2 - h/2 - state.pan.y) / state.zoom,
    w, h, rot: 0, opacity: 1, flipH: false, flipV: false, locked: false,
    z: G.nextZ++,
    src, natW, natH, isVideo: isVideo, isGif: isAnimatedGifSrc,
    // Original file name (for video/image export naming & display). Set by
    // callers (drag-drop, paste) when known. Empty when not available.
    filename: '',
    cropX: 0, cropY: 0, cropW: natW, cropH: natH,
    brightness: 100, contrast: 100, saturate: 100, hueRotate: 0, blur: 0, sepia: 0, grayscale: 0,
    temp: 0, vignette: 0, shadow: 100, highlight: 100, grain: 0,
    trimStart: 0, trimEnd: 0, playbackRate: 1,
  };
  state.items.push(item);
  // Stash the item on its DOM element so closures defined inside the
  // top-level `buildMediaControls` function (which cannot close over `item`
  // from this function's scope) can look it up via `el._item` at event time.
  el._item = item;
  updateItemStyle(item);
  if (isBatch ? isLast : true) selectOnly(item.id);
  if (isVideo) { setupVideoTrim(item); }
  // Round 13: sync the file name pill on the player. The badge is
  // created in buildMediaControls with an empty name (because the
  // item didn't exist yet). Now that the item is in hand, set the
  // badge to item.filename if known. The drag-drop / paste callers
  // may set item.filename AFTER addImage returns, in which case
  // they'll call el._setFilenameBadge themselves.
  if (el._setFilenameBadge) {
    try { el._setFilenameBadge(item.filename || ''); } catch (e) {}
  }
  // Initial badge sync for the new item (buildMediaControls couldn't run it
  // because `item` wasn't defined yet during the build). Use the stash ref
  // on the .item element so we call the right item's closure.
  if (isVideo && el._refreshAnnoBadges) {
    try { el._refreshAnnoBadges(); } catch (e) {}
  }
  if (isVideo && el._refreshSeekMarkers) {
    // Try once now, and again once metadata is loaded (for fresh items).
    try { el._refreshSeekMarkers(); } catch (e) {}
    if (el.video) {
      el.video.addEventListener('loadedmetadata', function _mk(){
        el.video.removeEventListener('loadedmetadata', _mk);
        try { el._refreshSeekMarkers(); } catch (e) {}
      });
    }
  }
  scheduleAutoSave();
  updateMediaBar();
  updateAutoFitPaper();
  // Apply viewport culling to new item (force-refresh cull state on every add)
  if (typeof cullOffscreenItems === 'function') {
    // Reset cache so the new item is always evaluated
    _cullLast.vx = -1e9;
    cullOffscreenItems();
  }
  return item;
}
export function addVideoItem(src, natW, natH, x, y) {
  return addImage(src, natW, natH, x, y, true);
}

// ============================================================
//  LINK CARDS — paste a URL, get a preview cover, click to open
// ============================================================
export function openLinkModal() {
  hideWelcome();
  const modal = document.getElementById('link-modal');
  const input = document.getElementById('link-url-input');
  modal.classList.add('active');
  input.value = '';
  setTimeout(() => input.focus(), 50);
}
export function closeLinkModal() {
  document.getElementById('link-modal').classList.remove('active');
  document.getElementById('link-loading-msg').style.display = 'none';
}
export function confirmLinkModal() {
  const input = document.getElementById('link-url-input');
  let url = input.value.trim();
  if (!url) return;
  // Auto-add https:// if missing
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  closeLinkModal();
  addLinkCard(url);
}

export function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

export function extractBilibiliId(url) {
  // BV ID: bilibili.com/video/BV1xx411c7mD
  const bvMatch = url.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/);
  if (bvMatch) return { type: 'bvid', id: bvMatch[1] };
  // AV ID: bilibili.com/video/av12345678
  const avMatch = url.match(/bilibili\.com\/video\/av(\d+)/i);
  if (avMatch) return { type: 'aid', id: avMatch[1] };
  // Short URL: b23.tv/xxxxxxx
  const shortMatch = url.match(/b23\.tv\/([a-zA-Z0-9]+)/);
  if (shortMatch) return { type: 'short', id: shortMatch[1] };
  return null;
}

export function getHostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch(e) { return url; }
}

export function addLinkCard(url, opts) {
  pushUndo();
  const linkUrl = url;
  const hostname = getHostname(url);
  const placeX = (opts && opts.x !== undefined) ? opts.x : (window.innerWidth/2 - 200 - state.pan.x) / state.zoom;
  const placeY = (opts && opts.y !== undefined) ? opts.y : (window.innerHeight/2 - 150 - state.pan.y) / state.zoom;
  const w = 400, h = 300;

  const el = document.createElement('div');
  el.className = 'item link-card';
  canvasContent.appendChild(el);

  // Placeholder shown while fetching
  const placeholder = document.createElement('div');
  placeholder.className = 'link-placeholder';
  placeholder.innerHTML = '<div class="link-icon"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9.5l3-3M6 10l-1 1a2 2 0 01-3-3l2-2a2 2 0 013 0M10 6l1-1a2 2 0 013 3l-2 2a2 2 0 01-3 0"/></svg></div><div class="link-text">' + hostname + '</div>';
  el.appendChild(placeholder);

  const item = {
    id: G.nextId++, el, img: null, video: null,
    x: placeX, y: placeY, w, h, rot: 0, opacity: 1, flipH: false, flipV: false, locked: false,
    z: G.nextZ++,
    src: '', natW: 400, natH: 300, isVideo: false,
    isLink: true, linkUrl, linkTitle: hostname, linkDesc: '',
    cropX: 0, cropY: 0, cropW: 400, cropH: 300,
    brightness: 100, contrast: 100, saturate: 100, hueRotate: 0, blur: 0, sepia: 0, grayscale: 0,
    temp: 0, vignette: 0, shadow: 100, highlight: 100, grain: 0,
    trimStart: 0, trimEnd: 0, playbackRate: 1,
  };
  state.items.push(item);
  updateItemStyle(item);
  selectOnly(item.id);

  // Double-click opens the link
  el.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(item.linkUrl, '_blank', 'noopener,noreferrer');
  });

  // Try to fetch cover image
  fetchLinkCover(url, el, item, placeholder);
  scheduleAutoSave();
  updateAutoFitPaper();
  return item;
}

export function fetchLinkCover(url, el, item, placeholder) {
  const ytId = extractYouTubeId(url);
  if (ytId) {
    // YouTube — use thumbnail directly (no API needed)
    const coverUrl = 'https://img.youtube.com/vi/' + ytId + '/hqdefault.jpg';
    const title = 'YouTube Video';
    applyLinkCover(el, item, placeholder, coverUrl, title, 480, 360, url);
    return;
  }
  const biliId = extractBilibiliId(url);
  if (biliId) {
    // Bilibili — fetch video info via CORS proxy
    if (biliId.type === 'short') {
      // b23.tv short URL — need to resolve redirect first to get BV ID
      fetchBilibiliShort(url, el, item, placeholder);
      return;
    }
    fetchBilibiliVideoInfo(biliId, url, el, item, placeholder);
    return;
  }
  // Other URLs — try microlink.io API
  fetchMicrolink(url, el, item, placeholder);
}

export function fetchBilibiliShort(url, el, item, placeholder) {
  // Resolve b23.tv short URL to get the full URL (which contains BV ID)
  // Try multiple CORS proxies in parallel, fastest wins
  var proxyUrls = [
    'https://corsproxy.io/?' + encodeURIComponent(url),
    'https://api.allorigins.win/get?url=' + encodeURIComponent(url),
    'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url),
    'https://cors-anywhere.herokuapp.com/' + url
  ];

  var fetchWithTimeout = function(u) {
    return new Promise(function(resolve, reject) {
      var controller = new AbortController();
      var timer = setTimeout(function() { controller.abort(); reject(new Error('timeout')); }, 8000);
      fetch(u, { signal: controller.signal })
        .then(function(r) {
          clearTimeout(timer);
          resolve(r);
        })
        .catch(function(e) { clearTimeout(timer); reject(e); });
    });
  };

  Promise.any(proxyUrls.map(fetchWithTimeout))
    .then(function(r) {
      // Try to determine the resolved URL
      if (r.redirected) {
        onShortResolved(r.url);
      } else {
        // Might be allorigins /get JSON response — try parsing
        r.json().then(function(data) {
          onShortResolved((data.status && data.status.url) || url);
        }).catch(function() {
          onShortResolved(url);
        });
      }
    })
    .catch(function() {
      onShortResolved(url);
    });

  function onShortResolved(resolvedUrl) {
    var biliId = extractBilibiliId(resolvedUrl);
    if (biliId && biliId.type !== 'short') {
      fetchBilibiliVideoInfo(biliId, url, el, item, placeholder);
    } else {
      fetchMicrolink(url, el, item, placeholder);
    }
  }
}

export function fetchBilibiliVideoInfo(biliId, originalUrl, el, item, placeholder) {
  let apiUrl;
  if (biliId.type === 'bvid') apiUrl = 'https://api.bilibili.com/x/web-interface/view?bvid=' + biliId.id;
  else if (biliId.type === 'aid') apiUrl = 'https://api.bilibili.com/x/web-interface/view?aid=' + biliId.id;
  else { fetchMicrolink(originalUrl, el, item, placeholder); return; }

  // Multiple CORS proxies — tried in parallel, fastest wins
  var proxyUrls = [
    'https://corsproxy.io/?' + encodeURIComponent(apiUrl),
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(apiUrl),
    'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(apiUrl),
    'https://cors-anywhere.herokuapp.com/' + apiUrl,
    'https://thingproxy.freeboard.io/fetch/' + apiUrl
  ];

  var fetchWithTimeout = function(url) {
    return new Promise(function(resolve, reject) {
      var controller = new AbortController();
      var timer = setTimeout(function() { controller.abort(); reject(new Error('timeout')); }, 8000);
      fetch(url, { signal: controller.signal })
        .then(function(r) {
          clearTimeout(timer);
          if (!r.ok) { reject(new Error('status ' + r.status)); return; }
          r.json().then(resolve).catch(reject);
        })
        .catch(function(e) { clearTimeout(timer); reject(e); });
    });
  };

  Promise.any(proxyUrls.map(fetchWithTimeout))
    .then(function(data) {
      if (data && data.code === 0 && data.data) {
        var coverUrl = data.data.pic || '';
        var title = data.data.title || 'Bilibili Video';
        var desc = data.data.desc || '';
        if (coverUrl) {
          // Bilibili CDN blocks hotlinking via Referer — use no-referrer
          applyLinkCover(el, item, placeholder, coverUrl, title, 400, 300, originalUrl, desc, true);
        } else {
          applyLinkPlaceholder(el, item, placeholder, title, originalUrl);
        }
      } else {
        fetchMicrolink(originalUrl, el, item, placeholder);
      }
    })
    .catch(function() {
      // All proxies failed — fallback to microlink
      fetchMicrolink(originalUrl, el, item, placeholder);
    });
}

export function fetchMicrolink(url, el, item, placeholder) {
  fetch('https://api.microlink.io/?url=' + encodeURIComponent(url))
    .then(r => r.json())
    .then(data => {
      if (data.status === 'success' && data.data) {
        const coverUrl = (data.data.image && data.data.image.url) ||
                         (data.data.screenshot && data.data.screenshot.url) || '';
        const title = data.data.title || getHostname(url);
        const desc = data.data.description || '';
        const imgW = (data.data.image && data.data.image.width) || 400;
        const imgH = (data.data.image && data.data.image.height) || 300;
        if (coverUrl) {
          applyLinkCover(el, item, placeholder, coverUrl, title, imgW, imgH, url, desc);
        } else {
          applyLinkPlaceholder(el, item, placeholder, title, url);
        }
      } else {
        applyLinkPlaceholder(el, item, placeholder, getHostname(url), url);
      }
    })
    .catch(() => {
      applyLinkPlaceholder(el, item, placeholder, getHostname(url), url);
    });
}

export function applyLinkCover(el, item, placeholder, coverUrl, title, imgW, imgH, url, desc, noCors) {
  const img = new Image();
  if (!noCors) img.crossOrigin = 'anonymous';
  // Set no-referrer to bypass hotlink protection (e.g. Bilibili CDN blocks foreign Referer)
  img.referrerPolicy = 'no-referrer';
  img.onload = () => {
    // Remove placeholder
    if (placeholder && placeholder.parentNode) placeholder.remove();
    // Create img element
    const mediaEl = document.createElement('img');
    mediaEl.src = coverUrl;
    mediaEl.referrerPolicy = 'no-referrer';
    mediaEl.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;object-fit:cover;';
    mediaEl.draggable = false;
    el.insertBefore(mediaEl, el.firstChild);
    item.img = mediaEl;
    item.src = coverUrl;
    item.natW = img.naturalWidth || imgW;
    item.natH = img.naturalHeight || imgH;
    item.linkTitle = title;
    item.linkDesc = desc || '';
    // Adjust aspect ratio
    const aspect = item.natW / item.natH;
    item.w = 720;
    item.h = Math.round(720 / aspect);
    updateItemStyle(item);
    // Add overlay elements
    addLinkOverlay(el, item);
    refreshSelection();
    scheduleAutoSave();
    updateAutoFitPaper();
    toast('Link card added: ' + title);
  };
  img.onerror = () => {
    // If direct load fails, try loading through an image proxy as last resort
    const proxiedCoverUrl = 'https://images.weserv.nl/?url=' + encodeURIComponent(coverUrl.replace(/^https?:\/\//, ''));
    const img2 = new Image();
    img2.referrerPolicy = 'no-referrer';
    img2.onload = () => {
      if (placeholder && placeholder.parentNode) placeholder.remove();
      const mediaEl = document.createElement('img');
      mediaEl.src = proxiedCoverUrl;
      mediaEl.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;object-fit:cover;';
      mediaEl.draggable = false;
      el.insertBefore(mediaEl, el.firstChild);
      item.img = mediaEl;
      item.src = proxiedCoverUrl;
      item.natW = img2.naturalWidth || imgW;
      item.natH = img2.naturalHeight || imgH;
      item.linkTitle = title;
      item.linkDesc = desc || '';
      const aspect = item.natW / item.natH;
      item.w = 720;
      item.h = Math.round(720 / aspect);
      updateItemStyle(item);
      addLinkOverlay(el, item);
      refreshSelection();
      scheduleAutoSave();
      updateAutoFitPaper();
      toast('Link card added: ' + title);
    };
    img2.onerror = () => {
      applyLinkPlaceholder(el, item, placeholder, title, url);
    };
    img2.src = proxiedCoverUrl;
  };
  img.src = coverUrl;
}

export function applyLinkPlaceholder(el, item, placeholder, title, url) {
  if (placeholder) {
    placeholder.querySelector('.link-text').textContent = title || getHostname(url);
  }
  item.linkTitle = title || getHostname(url);
  item.src = '';
  addLinkOverlay(el, item);
  refreshSelection();
  scheduleAutoSave();
  toast('Link added (no preview available)');
}

export function addLinkOverlay(el, item) {
  // Remove existing overlay if any
  const existing = el.querySelectorAll('.link-overlay, .link-badge, .link-open-btn');
  existing.forEach(e => e.remove());
  // Info overlay at bottom
  const overlay = document.createElement('div');
  overlay.className = 'link-overlay';
  overlay.innerHTML = '<div class="link-title">' + (item.linkTitle || '') + '</div>' +
                      '<div class="link-url">' + getHostname(item.linkUrl) + '</div>';
  el.appendChild(overlay);
  // Badge
  const badge = document.createElement('div');
  badge.className = 'link-badge';
  badge.textContent = 'LINK';
  el.appendChild(badge);
  // Hover open button
  const openBtn = document.createElement('div');
  openBtn.className = 'link-open-btn';
  openBtn.innerHTML = 'Open Link';
  openBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(item.linkUrl, '_blank', 'noopener,noreferrer');
  });
  el.appendChild(openBtn);
}

export function openSelectedLink() {
  const sel = getSelectedItems();
  if (sel.length > 0 && sel[0].isLink && sel[0].linkUrl) {
    window.open(sel[0].linkUrl, '_blank', 'noopener,noreferrer');
  }
}

// Rebuild link overlay when restoring from saved state
export function rebuildLinkCard(item) {
  const el = item.el;
  el.className = 'item link-card';
  if (item.src) {
    // Has cover image — recreate it
    const mediaEl = document.createElement('img');
    mediaEl.src = item.src;
    mediaEl.referrerPolicy = 'no-referrer';
    mediaEl.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;object-fit:cover;';
    mediaEl.draggable = false;
    el.appendChild(mediaEl);
    item.img = mediaEl;
  } else {
    // No cover — show placeholder
    const placeholder = document.createElement('div');
    placeholder.className = 'link-placeholder';
    placeholder.innerHTML = '<div class="link-icon"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9.5l3-3M6 10l-1 1a2 2 0 01-3-3l2-2a2 2 0 013 0M10 6l1-1a2 2 0 013 3l-2 2a2 2 0 01-3 0"/></svg></div><div class="link-text">' + (item.linkTitle || getHostname(item.linkUrl)) + '</div>';
    el.appendChild(placeholder);
  }
  addLinkOverlay(el, item);
  // Double-click opens the link
  el.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(item.linkUrl, '_blank', 'noopener,noreferrer');
  });
}
export function addText(x, y, initialText, opts) {
  pushUndo();
  const el = document.createElement('div');
  el.className = 'text-item';
  el.contentEditable = true;
  el.spellcheck = false;
  el.setAttribute('data-placeholder', 'Type here...');
  // Do NOT set textContent if empty — keeps the element truly empty so :empty::before placeholder works
  if (initialText) el.textContent = initialText;
  canvasContent.appendChild(el);
  const tx = {
    id: G.nextId++, el,
    x: x !== undefined ? x : (window.innerWidth/2 - 100 - state.pan.x) / state.zoom,
    y: y !== undefined ? y : (window.innerHeight/2 - 24 - state.pan.y) / state.zoom,
    // Round 54: text box W/H and font size are stored as on-screen
    // (CSS-pixel) values, NOT world coords. Live rendering divides by
    // current zoom in applyTextProps/updateItemStyle, so the box and
    // text always look the same on-screen size regardless of zoom.
    // Old items in localStorage use the same convention, so no
    // migration is needed.
    // opts.initW still wins (used by paste/undo paths).
    w: (opts && opts.initW) ? opts.initW : 160, h: 36, z: G.nextZ++,
    font: textTool.font, size: textTool.size || 24,
    bold: textTool.bold, italic: textTool.italic, underline: textTool.underline, strike: textTool.strike,
    highlight: textTool.highlight, shadow: textTool.shadow, bg: textTool.bg, outline: textTool.outline,
    uppercase: textTool.uppercase,
    color: textTool.color, highlightColor: textTool.highlightColor,
    align: textTool.align,
  };
  state.texts.push(tx);
  applyTextProps(tx);
  updateItemStyle(tx);
  // Auto-grow on input
  el.addEventListener('input', () => autoGrowTextItem(tx));
  el.addEventListener('focus', () => { el.classList.add('editing'); showTextQuickBar(true); updateTextQuickBarActive(); updateTextColorPalette(); });
  // When done editing
  el.addEventListener('blur', () => {
    el.classList.remove('editing');
    showTextQuickBar(false);
    updateTextColorPalette();
    // Remove empty text items
    if (!el.textContent.trim()) {
      pushUndo();
      el.remove();
      // Remove associated text handle container
      const hCont = canvas.querySelector('.text-handles[data-owner="' + tx.id + '"]');
      if (hCont) hCont.remove();
      state.texts = state.texts.filter(t => t.id !== tx.id);
      clearSelection();
    } else {
      autoGrowTextItem(tx);
    }
    // Auto-switch back to select mode so clicking doesn't keep creating text boxes
    if (state.tool === 'text') setTool('select');
    scheduleAutoSave();
    updateAutoFitPaper();
  });
  // Defer focus + selection so DOM is fully settled and handles don't interfere
  requestAnimationFrame(() => {
    selectOnly(tx.id);
    if (!opts || !opts.noFocus) el.focus();
  });
  scheduleAutoSave();
  updateAutoFitPaper();
  return tx;
}
export function autoGrowTextItem(tx) {
  const el = tx.el;
  if (!el || !el.isConnected) return;
  // Round 54: tx.w/tx.h/tx.size are on-screen (CSS-px at zoom 100%).
  // The canvas is `transform: scale(zoom)`, so we set the element's
  // CSS width/height to (on-screen / zoom) for the actual rendering.
  // scrollHeight/scrollWidth return CSS pixels, so we multiply by zoom
  // to get back to on-screen units for the stored value.
  const _tz = Math.max(0.02, Math.min(10, state.zoom || 1));

  const origW = el.style.width;
  const origH = el.style.height;

  // If the user has manually resized the text box, respect their width.
  // Only grow the HEIGHT to fit wrapped content — never force the width back
  // to a wider value, otherwise the text jumps wider every time the user
  // starts typing.
  const lockWidth = (tx.userResized || tx._autoGrowLocked) && tx.w;
  if (lockWidth) {
    el.style.width = (tx.w / _tz) + 'px';
    el.style.height = 'auto';
    const finalH = el.scrollHeight; // CSS pixels
    const padH = 12;                // on-screen pixels of padding
    const newH = Math.max(32, finalH * _tz + padH);
    if (tx.h === newH) {
      el.style.width = origW;
      el.style.height = origH;
      return;
    }
    tx.h = newH;
    updateItemStyle(tx);
    const hCont = el.parentElement ? el.parentElement.querySelector('.text-handles[data-owner="' + tx.id + '"]') : null;
    if (hCont) { hCont.style.width = (tx.w / _tz) + 'px'; hCont.style.height = (newH / _tz) + 'px'; }
    updateAutoFitPaper();
    return;
  }

  // For a freshly-created text box (never user-resized), keep the width
  // fixed at its initial size. Only grow the HEIGHT as the user types and
  // the text wraps. This prevents the box from ballooning wider the
  // moment the user starts typing a long line.
  if (tx.w) {
    el.style.width = (tx.w / _tz) + 'px';
    el.style.height = 'auto';
    const finalH = el.scrollHeight; // CSS pixels
    const padH = 12;                // on-screen pixels of padding
    const newH = Math.max(32, finalH * _tz + padH);
    if (tx.h === newH) {
      el.style.width = origW;
      el.style.height = origH;
      return;
    }
    tx.h = newH;
    updateItemStyle(tx);
    const hCont = el.parentElement ? el.parentElement.querySelector('.text-handles[data-owner="' + tx.id + '"]') : null;
    if (hCont) { hCont.style.width = (tx.w / _tz) + 'px'; hCont.style.height = (newH / _tz) + 'px'; }
    updateAutoFitPaper();
    // Lock future auto-grows to the same width so the box stays small
    // even as the user types more.
    tx._autoGrowLocked = true;
    return;
  }

  // Fallback: measure at maxW and shrink to fit (original behavior)
  const maxW = 520; // CSS pixels
  const minW = 120; // CSS pixels
  el.style.width = maxW + 'px';
  el.style.height = 'auto';
  const naturalH = el.scrollHeight;
  const contentW = el.scrollWidth; // CSS pixels
  const padW = 28;                 // on-screen pixels of horizontal padding
  // Convert content width to on-screen, add padW, then clamp
  const contentWOS = contentW * _tz;
  const targetWOS = Math.min(maxW, Math.max(minW, contentWOS + padW));
  el.style.width = (targetWOS / _tz) + 'px';
  el.style.height = 'auto';
  const finalH = el.scrollHeight;
  const padH = 12;
  const newW = targetWOS;
  const newH = Math.max(32, finalH * _tz + padH);
  if (tx.w === newW && tx.h === newH) {
    el.style.width = origW;
    el.style.height = origH;
    return;
  }
  tx.w = newW;
  tx.h = newH;
  updateItemStyle(tx);
  const hCont = el.parentElement ? el.parentElement.querySelector('.text-handles[data-owner="' + tx.id + '"]') : null;
  if (hCont) { hCont.style.width = (newW / _tz) + 'px'; hCont.style.height = (newH / _tz) + 'px'; }
  updateAutoFitPaper();
}
export function updateItemStyle(item, lightweight) {
  const el = item.el;
  // Skip style updates on the container during reframe — img is manually controlled
  if (el.classList.contains('reframing')) return;
  // Round 54: text items store W/H as on-screen (CSS-px) values. The
  // canvas is `transform: scale(zoom)`, so to make the on-screen box
  // match tx.w/tx.h, we set CSS width/height to (tx.w / zoom). All
  // other item types still use world coords (their on-screen size
  // is intentionally scaled by the canvas zoom, like images/videos).
  const isTextItem = el.classList.contains('text-item');
  const _tz = isTextItem ? Math.max(0.02, Math.min(10, state.zoom || 1)) : 1;
  if (item.w !== undefined) el.style.width = (item.w / _tz) + 'px';
  // Video/GIF items (.has-media): total height = video height + 54px
  // (24px info bar + 30px controls bar). Round 68: added info bar height.
  const isMediaItem = el.classList.contains('has-media');
  if (item.h !== undefined && !(el.classList.contains('todo-item'))) {
    el.style.height = ((isMediaItem ? item.h + 54 : item.h) / _tz) + 'px';
  }
  // Set .media-wrap height for video/GIF items
  if (isMediaItem) {
    const wrap = el.querySelector('.media-wrap');
    if (wrap) wrap.style.height = (item.h / _tz) + 'px';
  }
  // But allow explicit height for todos when resized (h !== initial auto height)
  if (item.h !== undefined && el.classList.contains('todo-item') && item._resized) el.style.height = item.h + 'px';
  // Scale todo internal content proportionally with window width
  if (el.classList.contains('todo-item') && item._resized) {
    el.style.setProperty('--todo-zoom', Math.max(0.3, Math.min(4, item.w / 220)));
  }
  // translate3d forces GPU compositing — critical for smooth drag of many items
  const flipS = `${item.flipH ? -1 : 1}, ${item.flipV ? -1 : 1}`;
  el.style.transform = `translate3d(${item.x}px, ${item.y}px, 0) rotate(${item.rot || 0}deg) scale(${flipS})`;
  el.style.opacity = item.opacity !== undefined ? item.opacity : 1;
  el.style.zIndex = item.z || 1;
  if (item.locked) el.classList.add('locked'); else el.classList.remove('locked');
  // Sync text handle container position (sibling of text-item) — must run during drag too
  if (isTextItem) {
    const hCont = el.parentElement.querySelector('.text-handles[data-owner="' + item.id + '"]');
    if (hCont) {
      hCont.style.left = item.x + 'px';
      hCont.style.top = item.y + 'px';
      hCont.style.width = (item.w / _tz) + 'px';
      hCont.style.height = (item.h / _tz) + 'px';
      hCont.style.zIndex = item.z || 1;
    }
  }
  // LIGHTWEIGHT PATH (drag): skip all GPU-expensive work that doesn't depend on position.
  // Filter strings, CGI overlays, mask layer updates all re-trigger GPU filter/canvas work.
  // transform/width/height/opacity/zIndex above are all we need for smooth dragging.
  if (lightweight) return;
  // Sync mind map connectors when item moves
  if (el.classList.contains('mindmap-item') && item.nodes && item.nodes.length > 0) {
    requestAnimationFrame(() => mmUpdateConnectors(item));
  }
  // CSS filter for images/videos
  const mediaEl = item.img || item.video;
  if (mediaEl) {
    let bri = item.brightness || 100;
    let con = item.contrast || 100;
    // Temperature: warm = shift toward orange, cool = shift toward blue
    let tempFilter = '';
    const temp = item.temp || 0;
    if (temp > 0) {
      const sepiaAmt = Math.min(100, temp * 0.33);
      const satAmt = Math.min(400, 100 + temp * 0.5);
      tempFilter = ` sepia(${sepiaAmt}%) saturate(${satAmt}%)`;
    } else if (temp < 0) {
      const hueAmt = Math.min(180, Math.abs(temp) * 0.6);
      const satAmt = Math.max(10, 100 + temp * 0.3);
      tempFilter = ` hue-rotate(${hueAmt}deg) saturate(${satAmt}%)`;
    }
    // Shadow: >100 lifts shadows (brighten dark areas), <100 deepens
    let shadowFilter = '';
    const shadowVal = item.shadow !== undefined ? item.shadow : 100;
    if (shadowVal !== 100) {
      const sAdj = 100 + (shadowVal - 100) * 0.4;
      shadowFilter = ` brightness(${sAdj}%)`;
    }
    // Highlight: >100 brightens highlights (boost contrast), <100 suppresses
    let highlightFilter = '';
    const highlightVal = item.highlight !== undefined ? item.highlight : 100;
    if (highlightVal !== 100) {
      const hAdj = 100 + (highlightVal - 100) * 0.4;
      highlightFilter = ` contrast(${hAdj}%)`;
    }
    const f = `brightness(${bri}%) contrast(${con}%) saturate(${item.saturate||100}%) hue-rotate(${item.hueRotate||0}deg) blur(${item.blur||0}px) sepia(${item.sepia||0}%) grayscale(${item.grayscale||0}%)${tempFilter}${shadowFilter}${highlightFilter}`;
    mediaEl.style.filter = f;
    // Shadow/Highlight overlay
    updateCgiOverlays(item);
    // Mask layer overlays — filter-only update (mask shape unchanged)
    renderMasks(item, true);
  }
}
export function applyTextProps(tx) {
  const el = tx.el;
  el.style.fontFamily = tx.font;
  // Round 54: tx.size is on-screen px. Divide by current zoom so the
  // canvas's transform: scale(zoom) brings it back to the expected
  // on-screen size. Old items in localStorage use the same on-screen
  // convention, so no migration is needed.
  const _tz = Math.max(0.02, Math.min(10, state.zoom || 1));
  el.style.fontSize = (tx.size / _tz) + 'px';
  el.style.fontWeight = tx.bold ? 'bold' : 'normal';
  el.style.fontStyle = tx.italic ? 'italic' : 'normal';
  el.style.textDecoration = [tx.underline ? 'underline' : '', tx.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
  el.style.color = tx.color;
  el.style.textAlign = tx.align;
  el.style.textTransform = tx.uppercase ? 'uppercase' : 'none';
  let bg = 'transparent';
  if (tx.highlight) bg = tx.highlightColor;
  else if (tx.bg) bg = tx.highlightColor + '88';
  el.style.backgroundColor = bg;
  let shadow = 'none';
  if (tx.shadow) shadow = '2px 2px 4px rgba(0,0,0,0.7)';
  el.style.textShadow = tx.outline ? `-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000${tx.shadow ? ', 2px 2px 4px rgba(0,0,0,0.7)' : ''}` : (tx.shadow ? shadow : 'none');
}
