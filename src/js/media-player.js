import { getSelectedItems, selectOnly } from './selection.js';
import { setTool } from './tools.js';
import { translateText } from './translation.js';
import { state, canvasContent } from './core-state.js';

import { videoAnnoAddComment, videoAnnoCaptureSnapshot, videoAnnoDeleteComment, videoAnnoEnsure, videoAnnoJumpToComment, videoAnnoOpenLightbox, videoAnnoRefreshCommentList, videoAnnoUpdateComment } from './frame-comments.js';
import { pushUndo } from './undo-redo.js';
import { getCurrentFps, refreshVideoPanelTimes, updateVideoTimeline } from './video-trim.js';
import { addImage } from './add-items.js';
import { scheduleAutoSave } from './save-load.js';
import { trimGifSelected } from './props-panel.js';
import { toast } from './ui-utils.js';
import { canvas, viewport } from './core-state.js';

export function buildMediaControls(el, mediaEl, isVideo, isGif) {
  el.classList.add('has-media');
  // Helper for closures inside this top-level function. `buildMediaControls`
  // cannot close over `item` from the calling addImage()/loadData()/history
  // scope, so each closure that needs the live item must go through this.
  // The caller (after returning from this function) stashes the item via
  // `el._item = item;` so the helper returns it at event time. During the
  // initial synchronous setup (e.g. the _refreshBadges call at the end of
  // this function) the stash is not yet set, so the helper returns null and
  // callers fall back to safe defaults.
  function _getItem() { return el._item || null; }
  // ── .media-wrap (holds video/img + type badge) ──
  const wrap = document.createElement('div');
  wrap.className = 'media-wrap';
  if (isVideo) {
    mediaEl.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;background:#000;object-fit:contain;';
  } else {
    mediaEl.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;object-fit:contain;';
  }
  wrap.appendChild(mediaEl);
  // Round 57: cinema-style frame / timecode overlay (top-left of video).
  // Two lines: the F-number (with / total) on top in accent cyan, the
  // timecode (m:ss.cc — centisecond precision) below in white. Always
  // shown together so the user can read both at a glance, regardless
  // of the per-item time/frame toggle in the controls bar. Auto-shows
  // when the video is selected (CSS via .item.selected) and stays
  // visible while playing; fades out otherwise. Updates from the same
  // timeupdate listener that updates the seek bar fill.
  let frameCodeDisplay = null;
  if (isVideo && !isGif) {
    frameCodeDisplay = document.createElement('div');
    frameCodeDisplay.className = 'media-frame-display';
    frameCodeDisplay.innerHTML =
      '<span class="fc-frame"><span class="fc-cur">F 0</span><span class="fc-total">/ 0</span></span>' +
      '<span class="fc-time">0:00.00</span>';
    wrap.appendChild(frameCodeDisplay);
  }
  // Round 71: type + filename are SHOWN ONLY in the dedicated black
  // info bar at the top (.media-info-bar below) — the old in-frame
  // `media-type-badge` + `media-filename-badge` pill was removed in
  // Round 72 because it duplicated the info bar and cluttered the
  // start of the timeline (where it overlapped the trim start handle).
  // The audio card keeps its own small "AUDIO" badge in its own
  // build path (search for `audioBadge`) since audio items don't have
  // an info bar.
  // Round 68: dedicated black info header bar that sits ABOVE the video
  // as a flex sibling (appended to `el`, not `wrap`). Shows the full
  // player metadata — type, filename, frame counter, timecode, and FPS —
  // in one compact 24px row with zero content obstruction.
  const infoBar = document.createElement('div');
  infoBar.className = 'media-info-bar';
  // Round 71: full info bar — type badge, filename, frame counter, FPS.
  // (Time is still shown in the controls bar, not duplicated here.)
  infoBar.innerHTML =
    '<span class="ib-type">' + (isVideo ? 'MP4' : 'GIF') + '</span>' +
    '<span class="ib-sep">&middot;</span>' +
    '<span class="ib-name"></span>' +
    '<span class="ib-sep">&middot;</span>' +
    '<span class="ib-frame"><span class="ib-fcur">F 0</span><span class="ib-ftot">/ 0</span></span>' +
    '<span class="ib-sep">&middot;</span>' +
    '<span class="ib-fps">30 fps</span>';
  // Helper: set the file name on the info bar. The redundant
  // filename pill (`.media-filename-badge`) is gone, so this only
  // needs to update `.ib-name` inside the info bar.
  function _setFilenameBadge(name) {
    const ibName = infoBar ? infoBar.querySelector('.ib-name') : null;
    if (!ibName) return;
    const s = (name || '').toString().trim();
    ibName.textContent = s || (isVideo ? 'Video' : 'Image');
  }
  // Initial population: the item may already have a filename (when the
  // item was loaded from history). We hook up later via the
  // _refreshFileBadge function exposed on el, called from addImage()
  // after the filename is known.
  _setFilenameBadge('');
  el._setFilenameBadge = _setFilenameBadge;
  // ── Comments button (Round 51: moved from video overlay to controls bar)
  // Replaces the two control-bar buttons (💬 Add + 🗨 list) the user
  // asked to remove. Used to sit on top of the video as a pill, but the
  // user reported "all the button dont overlap the player screen" — so
  // R51 moved it INTO the controls bar (right utility group). The
  // class is now `media-comments-btn` (the in-bar styled version). The
  // variable name `commentsFab` is kept for backward compatibility with
  // the click handler + popover positioning code that references it.
  // The element is NOT appended here — it's appended by the controls
  // bar builder further down (rightGroup.appendChild(commentsFab)).
  const commentsFab = document.createElement('div');
  commentsFab.className = 'media-comments-btn';
  commentsFab.title = 'Open frame comments  (shortcut: M)';
  const fabIcon = document.createElement('span');
  fabIcon.className = 'btn-icon';
  fabIcon.textContent = '💬';
  const fabLabel = document.createElement('span');
  fabLabel.className = 'btn-label';
  fabLabel.textContent = 'Comments';
  const fabCount = document.createElement('span');
  fabCount.className = 'btn-count';
  fabCount.textContent = '0';
  fabCount.setAttribute('data-zero', '1');
  commentsFab.appendChild(fabIcon);
  commentsFab.appendChild(fabLabel);
  commentsFab.appendChild(fabCount);

  // ── Annotation canvas overlay + floating toolbar (video only) ──
  // The user can pause the video on a frame, click ✏️ Draw, then
  // draw arrows or freehand strokes directly on top of the frame.
  // When they next add a comment, the strokes are bundled with the
  // snapshot. Recipients can see the annotation in the popover, the
  // lightbox, and the exported HTML report.
  // All annotation-related locals are hoisted to here so they're declared
  // before any helper that references them (the toolbar setup block below
  // uses `_applyDrawMode` / `_refreshDrawBtnBadge`, which close over
  // `drawBtn`; if `let drawBtn` lives further down, calling those helpers
  // hits the temporal dead zone with "Cannot access 'drawBtn' before
  // initialization").
  let annoCanvas = null, annoToolbar = null;
  let drawBtn = null;
  // Per-item state lives on `el` so it survives any refresh that doesn't
  // rebuild the controls bar. Strokes are normalized to [0,1] coords so
  // the same stroke renders correctly at any canvas size.
  if (isVideo) {
    el._annoDrawState = el._annoDrawState || {
      mode: 'off',          // 'off' | 'arrow' | 'pen' | 'box' | 'circle'
      color: '#ff4444',     // current color
      size: 4,              // stroke width in CSS pixels
      // Round 9: per-frame strokes. Strokes are tied to a specific frame
      // number so when the user scrubs the timeline, only the strokes
      // belonging to the current frame are visible. The flat `strokes`
      // array now aliases to `strokesByFrame[currentFrame]` for any
      // legacy code that reads it. New strokes get added to the current
      // frame; the `_onFrameChange` listener re-syncs `strokes` whenever
      // the frame changes (via timeupdate or seek).
      strokesByFrame: {},   // { [frameNumber]: [stroke1, stroke2, ...] }
      strokes: [],          // legacy alias for the current frame's strokes
      lastFrame: -1,        // last seen frame number (for change detection)
      drawing: null,        // current in-progress stroke
    };
    // Canvas overlay (sits over the video; pointer-events toggled by mode)
    annoCanvas = document.createElement('canvas');
    annoCanvas.className = 'media-anno-canvas';
    wrap.appendChild(annoCanvas);

    // Cursor ring — follows mouse on the canvas so the user can see
    // where they're drawing and what color/size is active.
    const cursorRing = document.createElement('div');
    cursorRing.className = 'media-anno-cursor-ring';
    // Mark which item owns this ring (the LAST video created owns the
    // current ring — only one ring is active at a time). Stash on body
    // so global handlers can find it without DOM-walking.
    cursorRing._ownerEl = el;
    function _updateCursorRing() {
      const s = el._annoDrawState || { color: '#ff4444', size: 4 };
      cursorRing.style.borderColor = s.color;
      // Size scales the ring so user has feedback about brush size.
      // Round 9: shrunk the scale factor from * 4 + 8 → * 1.5 + 6, and
      // lowered the cap from 40px → 18px. The previous 24-40px range
      // covered way too much of the screen; the new 12-18px range
      // stays subtle while still showing the color and a hint of size.
      const ringSize = Math.max(10, Math.min(18, s.size * 1.5 + 6));
      cursorRing.style.width = ringSize + 'px';
      cursorRing.style.height = ringSize + 'px';
    }
    // Round 75: append cursor ring to wrap (the fullscreen target)
    // instead of document.body. The Fullscreen API only renders the
    // fullscreen element and its descendants — anything appended to
    // document.body is invisible. By putting the ring inside wrap,
    // it stays visible in both normal and fullscreen modes (the ring
    // uses position:fixed, which ignores ancestor overflow:hidden).
    document.body.appendChild(cursorRing);
    _updateCursorRing();
    // R72: stash on el so cleanupAllItems can find and remove the orphaned
    // ring on undo/delete. Previously the ring was appended to body and
    // stayed there forever — multiple undos leaked multiple rings.
    el._annoCursorRing = cursorRing;
    // Hide ring on pointerleave canvas; show on enter
    annoCanvas.addEventListener('pointerenter', function(ev){
      if (el._annoDrawState && el._annoDrawState.mode !== 'off') {
        cursorRing.style.display = 'block';
        cursorRing.style.left = ev.clientX + 'px';
        cursorRing.style.top = ev.clientY + 'px';
      }
    });
    annoCanvas.addEventListener('pointerleave', function(){
      cursorRing.style.display = 'none';
    });
    annoCanvas.addEventListener('pointermove', function(ev){
      if (!el._annoDrawState || el._annoDrawState.mode === 'off') {
        cursorRing.style.display = 'none';
        return;
      }
      cursorRing.style.display = 'block';
      cursorRing.style.left = ev.clientX + 'px';
      cursorRing.style.top = ev.clientY + 'px';
    });
    // Also track pointermove ANYWHERE on the page (so the ring shows up
    // even when the user moves the mouse OFF the canvas but is still
    // dragging a stroke — without this, the ring disappears mid-stroke
    // the moment the cursor leaves the canvas rectangle).
    let _lastMouseX = 0, _lastMouseY = 0;
    document.addEventListener('pointermove', function(ev){
      _lastMouseX = ev.clientX; _lastMouseY = ev.clientY;
      if (cursorRing._ownerEl !== el) return;
      const s = el._annoDrawState;
      if (!s) return;
      // Only show the ring when WE are the one drawing (this video
      // is in draw mode and another video's draw mode isn't active).
      const otherActive = document.querySelectorAll('.item.has-media.draw-mode');
      let isOurTurn = false;
      otherActive.forEach(ei => { if (ei === el) isOurTurn = true; });
      if (!isOurTurn) { cursorRing.style.display = 'none'; return; }
      if (s.mode === 'off') { cursorRing.style.display = 'none'; return; }
      cursorRing.style.display = 'block';
      cursorRing.style.left = ev.clientX + 'px';
      cursorRing.style.top = ev.clientY + 'px';
    });

    // Floating toolbar (only visible when draw mode is on)
    annoToolbar = document.createElement('div');
    annoToolbar.className = 'media-anno-toolbar';
    annoToolbar.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
    annoToolbar.addEventListener('click', function(ev){ ev.stopPropagation(); });

    // Round 7: 2-column layout
    //   col1: modes (arrow/pen/box/circle) + color wheel
    //   col2: sizes (S/M/L) + actions (undo/clear/done) + close
    // Round 12: switched to a single vertical column (CSS uses
    // flex-direction: column). The two "cols" are now full-width sections
    // stacked top-to-bottom. Section 1 has modes + color picker; section 2
    // has sizes + frame + actions + close. The close row gets
    // margin-top: auto so it sits at the bottom when the panel is taller
    // than its content.
    const col1 = document.createElement('div');
    col1.className = 'tb-col';
    const col2 = document.createElement('div');
    col2.className = 'tb-col';
    annoToolbar.appendChild(col1);
    annoToolbar.appendChild(col2);

    // Mode buttons (col1, row 1: arrow + pen)
    const modeRow1 = document.createElement('div');
    modeRow1.className = 'toolbar-row toolbar-row-modes1';
    const arrowBtn = document.createElement('button');
    arrowBtn.innerHTML = '&#10145;'; // ➡
    arrowBtn.title = 'Arrow mode — click and drag to draw an arrow';
    arrowBtn.addEventListener('click', function(){
      const s = el._annoDrawState;
      s.mode = (s.mode === 'arrow') ? 'off' : 'arrow';
      _applyDrawMode();
    });
    const penBtn = document.createElement('button');
    penBtn.innerHTML = '&#9998;'; // ✏
    penBtn.title = 'Freehand pen mode — click and drag to draw';
    penBtn.addEventListener('click', function(){
      const s = el._annoDrawState;
      s.mode = (s.mode === 'pen') ? 'off' : 'pen';
      _applyDrawMode();
    });
    modeRow1.appendChild(arrowBtn);
    modeRow1.appendChild(penBtn);
    col1.appendChild(modeRow1);

    // Mode buttons (col1, row 2: box + circle)
    const modeRow2 = document.createElement('div');
    modeRow2.className = 'toolbar-row toolbar-row-modes2';
    const boxBtn = document.createElement('button');
    boxBtn.innerHTML = '&#9645;'; // ▣
    boxBtn.title = 'Box / rectangle mode — click and drag to draw a box';
    boxBtn.addEventListener('click', function(){
      const s = el._annoDrawState;
      s.mode = (s.mode === 'box') ? 'off' : 'box';
      _applyDrawMode();
    });
    const circleBtn = document.createElement('button');
    circleBtn.innerHTML = '&#9711;'; // ◯
    circleBtn.title = 'Circle / ellipse mode — click and drag to draw a circle';
    circleBtn.addEventListener('click', function(){
      const s = el._annoDrawState;
      s.mode = (s.mode === 'circle') ? 'off' : 'circle';
      _applyDrawMode();
    });
    modeRow2.appendChild(boxBtn);
    modeRow2.appendChild(circleBtn);
    col1.appendChild(modeRow2);

    // Round 12: text mode (row 3). Click on the canvas to place a text
    // annotation, type, press Enter to commit. Text snaps to the current
    // frame and is shown on the seek bar as a green square marker
    // (distinct from cyan diamond = drawing, amber flag = comment).
    const modeRow3 = document.createElement('div');
    modeRow3.className = 'toolbar-row toolbar-row-modes3';
    const textBtn = document.createElement('button');
    textBtn.innerHTML = '&#84;'; // T
    textBtn.title = 'Text mode — click on the video to place a text annotation';
    textBtn.addEventListener('click', function(){
      const s = el._annoDrawState;
      s.mode = (s.mode === 'text') ? 'off' : 'text';
      _applyDrawMode();
    });
    modeRow3.appendChild(textBtn);
    col1.appendChild(modeRow3);

    // Round 10: HSV color picker (replaces the conic-gradient color wheel
    // which the user found hard to use). The new picker is:
    //   1. A 2D Saturation/Value square (the big block — click to pick S+V).
    //   2. A horizontal Hue strip (drag to pick the base hue).
    //   3. A row of 16 preset swatches for quick access.
    //   4. A current-color preview chip + HEX readout.
    const colorPicker = document.createElement('div');
    colorPicker.className = 'color-picker';
    // Initialize from the existing drawState color (default red)
    const initState = el._annoDrawState;
    let _hue = 0, _sat = 100, _val = 100; // HSV [0..360, 0..100, 0..100]
    if (initState && initState.color) {
      // Parse existing HSL color back to HSV (it's stored as hsl(H, 100%, 55%))
      const m = /hsl\(\s*([0-9.]+)\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%\s*\)/.exec(initState.color || '');
      if (m) {
        const h = parseFloat(m[1]);
        const s = parseFloat(m[2]) / 100;
        const l = parseFloat(m[3]) / 100;
        _hue = h;
        _sat = s * 100;
        // HSL→HSV V
        _val = l + s * (0.5 - Math.abs(0.5 - l));
        _val = Math.max(0, Math.min(100, _val * 2));
      }
    }
    // 1. Saturation/Value square
    const svSquare = document.createElement('div');
    svSquare.className = 'cp-sv';
    svSquare.title = 'Click to pick saturation & brightness';
    // 2. Hue strip
    const hueStrip = document.createElement('div');
    hueStrip.className = 'cp-hue';
    hueStrip.title = 'Drag to pick hue';
    // 3. Swatches row (16 common colors)
    const swatchRow = document.createElement('div');
    swatchRow.className = 'cp-swatches';
    // 4. Preview + HEX
    const previewRow = document.createElement('div');
    previewRow.className = 'cp-preview-row';
    const previewChip = document.createElement('div');
    previewChip.className = 'cp-preview';
    const hexReadout = document.createElement('span');
    hexReadout.className = 'cp-hex';
    previewRow.appendChild(previewChip);
    previewRow.appendChild(hexReadout);
    colorPicker.appendChild(svSquare);
    colorPicker.appendChild(hueStrip);
    colorPicker.appendChild(swatchRow);
    colorPicker.appendChild(previewRow);
    col1.appendChild(colorPicker);
    // Round 13: 8 preset colors covering the common brand/red/blue/green
    // palette (was 16 — the second row doubled the picker's height and
    // pushed it past the panel's bottom border). The HSV picker above
    // covers any color the user might need; the swatches are just
    // quick-access shortcuts for the most common ones.
    const PRESETS = [
      '#ff4444', '#ff8800', '#ffdd00', '#88dd00',
      '#00aaff', '#4444ff', '#ffffff', '#000000',
    ];
    // ── helpers ──
    // Convert HSV (0..360, 0..100, 0..100) to a CSS hsl() string. We use
    // HSL because the rest of the code stores colors as HSL — staying in
    // the same format keeps the cursor ring and the comment snapshot
    // pipeline happy. The conversion V→L is the standard HSL↔HSV rule.
    function _hsvToColor(h, s, v) {
      const l = v / 2 * (1 - s / 100) + v / 2;
      return 'hsl(' + Math.round(h) + ',' + Math.round(s) + '%,' + Math.round(l) + '%)';
    }
    function _colorToHex(color) {
      // Uses a hidden 1x1 canvas to convert any CSS color to HEX.
      try {
        const c = document.createElement('canvas');
        c.width = 1; c.height = 1;
        const ctx = c.getContext('2d');
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return '#' + [d[0], d[1], d[2]].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
      } catch (e) { return color; }
    }
    function _syncPicker() {
      // SV square background = pure hue; marker = sat/val position
      svSquare.style.setProperty('--cp-hue', Math.round(_hue));
      svSquare.style.setProperty('--cp-sx', _sat + '%');
      svSquare.style.setProperty('--cp-sy', (100 - _val) + '%');
      // Hue strip marker
      hueStrip.style.setProperty('--cp-hx', (_hue / 360 * 100) + '%');
      // Preview chip + hex readout
      const c = _hsvToColor(_hue, _sat, _val);
      previewChip.style.background = c;
      hexReadout.textContent = _colorToHex(c);
      // Highlight matching preset swatch
      const cur = _colorToHex(c).toLowerCase();
      swatchRow.querySelectorAll('.cp-swatch').forEach(sw => {
        sw.classList.toggle('active', (sw.getAttribute('data-color') || '').toLowerCase() === cur);
      });
    }
    function _applyColor(newColor) {
      if (!newColor) return;
      el._annoDrawState.color = newColor;
      // If newColor is HSL, parse it back to HSV so the picker markers
      // move to the right positions.
      const m = /hsl\(\s*([0-9.]+)\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%\s*\)/.exec(newColor);
      if (m) {
        _hue = parseFloat(m[1]);
        const sIn = parseFloat(m[2]);
        const lIn = parseFloat(m[3]);
        _sat = sIn;
        _val = lIn + sIn * (50 - Math.abs(50 - lIn)) / 100;
        _val = Math.max(0, Math.min(100, _val * 2));
        _syncPicker();
      } else if (newColor.indexOf('#') === 0) {
        // HEX — convert to HSV via canvas
        try {
          const c = document.createElement('canvas');
          c.width = 1; c.height = 1;
          const ctx = c.getContext('2d');
          ctx.fillStyle = newColor;
          ctx.fillRect(0, 0, 1, 1);
          const d = ctx.getImageData(0, 0, 1, 1).data;
          // RGB → HSV
          const r = d[0] / 255, g = d[1] / 255, b = d[2] / 255;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const dlt = max - min;
          _val = max * 100;
          _sat = max === 0 ? 0 : (dlt / max) * 100;
          if (dlt === 0) _hue = 0;
          else if (max === r) _hue = 60 * (((g - b) / dlt) % 6);
          else if (max === g) _hue = 60 * (((b - r) / dlt) + 2);
          else _hue = 60 * (((r - g) / dlt) + 4);
          if (_hue < 0) _hue += 360;
          _syncPicker();
        } catch (e) {}
      }
      // Update the cursor ring color
      if (typeof _updateCursorRing === 'function') _updateCursorRing();
    }
    // SV square: mousedown + mousemove drag
    let _draggingSV = false;
    function _pickSV(clientX, clientY) {
      const r = svSquare.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      const y = Math.max(0, Math.min(1, (clientY - r.top) / r.height));
      _sat = Math.round(x * 100);
      _val = Math.round((1 - y) * 100);
      const c = _hsvToColor(_hue, _sat, _val);
      el._annoDrawState.color = c;
      _syncPicker();
      if (typeof _updateCursorRing === 'function') _updateCursorRing();
    }
    svSquare.addEventListener('mousedown', function(ev){
      ev.stopPropagation(); ev.preventDefault();
      _draggingSV = true;
      _pickSV(ev.clientX, ev.clientY);
    });
    document.addEventListener('mousemove', function(ev){
      if (_draggingSV) _pickSV(ev.clientX, ev.clientY);
    });
    document.addEventListener('mouseup', function(){ _draggingSV = false; });
    // Hue strip
    let _draggingHue = false;
    function _pickHue(clientX) {
      const r = hueStrip.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      _hue = x * 360;
      const c = _hsvToColor(_hue, _sat, _val);
      el._annoDrawState.color = c;
      _syncPicker();
      if (typeof _updateCursorRing === 'function') _updateCursorRing();
    }
    hueStrip.addEventListener('mousedown', function(ev){
      ev.stopPropagation(); ev.preventDefault();
      _draggingHue = true;
      _pickHue(ev.clientX);
    });
    document.addEventListener('mousemove', function(ev){
      if (_draggingHue) _pickHue(ev.clientX);
    });
    document.addEventListener('mouseup', function(){ _draggingHue = false; });
    // Build the preset swatches
    PRESETS.forEach(col => {
      const sw = document.createElement('button');
      sw.className = 'cp-swatch';
      sw.setAttribute('data-color', col);
      sw.style.background = col;
      sw.title = col;
      sw.addEventListener('click', function(ev){
        ev.stopPropagation(); ev.preventDefault();
        _applyColor(col);
      });
      swatchRow.appendChild(sw);
    });
    // Initial sync (positions markers, fills preview, highlights swatch)
    _syncPicker();
    el._applyColor = _applyColor;

    // Size buttons (col2, row 1: S/M/L — single row)
    const sizeRow = document.createElement('div');
    sizeRow.className = 'toolbar-row toolbar-row-sizes';
    [
      { s: 2, t: 'S' },
      { s: 4, t: 'M' },
      { s: 7, t: 'L' },
    ].forEach(o => {
      const b = document.createElement('button');
      b.innerHTML = o.t;
      b.title = 'Stroke size ' + o.s + 'px';
      b.style.fontSize = o.s === 7 ? '11px' : (o.s === 4 ? '10px' : '9px');
      b.style.fontWeight = '700';
      if (o.s === 4) b.classList.add('active');
      b.addEventListener('click', function(){
        el._annoDrawState.size = o.s;
        annoToolbar.querySelectorAll('.toolbar-row-sizes button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        if (typeof _updateCursorRing === 'function') _updateCursorRing();
      });
      sizeRow.appendChild(b);
    });
    col2.appendChild(sizeRow);

    // ── Round 9: frame indicator ──
    // Shows the current frame number so the user knows which frame
    // their drawings will be tied to. Live-updates via timeupdate /
    // seeked listeners (set up later). Compact pill style so it doesn't
    // disrupt the 2-col layout.
    const frameIndicator = document.createElement('div');
    frameIndicator.className = 'toolbar-row toolbar-row-frame';
    const fiLabel = document.createElement('span');
    fiLabel.className = 'fi-label';
    fiLabel.innerHTML = 'F';
    const fiValue = document.createElement('span');
    fiValue.className = 'fi-value';
    fiValue.textContent = '0';
    frameIndicator.appendChild(fiLabel);
    frameIndicator.appendChild(fiValue);
    col2.appendChild(frameIndicator);
    function _updateFrameIndicator() {
      const s = el._annoDrawState;
      if (!s) return;
      const fps = (typeof getCurrentFps === 'function') ? getCurrentFps() : (mediaEl._kraftedFps || 30);
      const f = Math.max(0, Math.floor((mediaEl.currentTime || 0) * fps));
      fiValue.textContent = f.toString();
      // Show count of strokes on this frame
      const c = (s.strokesByFrame && s.strokesByFrame[f]) ? s.strokesByFrame[f].length : 0;
      fiValue.title = 'Frame ' + f + ' — ' + c + ' strokes on this frame';
    }
    el._updateFrameIndicator = _updateFrameIndicator;
    // Initial update (in case frame indicator is being shown right away)
    try { _updateFrameIndicator(); } catch (e) {}

    // Undo + Clear (col2, row 2: actions)
    const actionRow = document.createElement('div');
    actionRow.className = 'toolbar-row toolbar-row-actions';
    const undoBtn = document.createElement('button');
    undoBtn.innerHTML = '&#8630;'; // ↰
    undoBtn.title = 'Undo last stroke';
    undoBtn.addEventListener('click', function(){
      const s = el._annoDrawState;
      s.strokes.pop();
      _renderAnnoCanvas();
      _refreshDrawBtnBadge();
      // Round 10: refresh drawing markers (may need to remove the
      // marker if the user just removed the last stroke on this frame)
      if (el._refreshDrawSeekMarkers) {
        try { el._refreshAllSeekMarkers(); } catch (e) {}
      }
    });
    actionRow.appendChild(undoBtn);
    // R79: lock-to-player button — when on, the draw mode stays
    // active after each stroke so the user can immediately start
    // the next one without picking the draw tool again. Sits
    // between Undo and Clear so it's reachable with the pen
    // tablet without crowding the color/size row above.
    const lockBtn = document.createElement('button');
    lockBtn.className = 'lock-btn';
    lockBtn.innerHTML = '&#128274;'; // 🔒
    lockBtn.title = 'Lock to player — stay in draw mode between strokes (off → keep current tool, on → continuous draw)';
    lockBtn.addEventListener('click', function(){
      const newState = !window.G.lockToPlayer;
      window.G.lockToPlayer = newState;
      _refreshLockBtn();
      if (typeof toast === 'function') {
        toast(newState ? 'Lock ON — stay in draw mode' : 'Lock OFF — back to single-stroke draw');
      }
    });
    function _refreshLockBtn(){
      const on = !!(window.G && window.G.lockToPlayer);
      lockBtn.classList.toggle('active', on);
      lockBtn.innerHTML = on ? '&#128275;' : '&#128274;'; // 🔓 / 🔒
      lockBtn.title = on
        ? 'Lock ON — stay in draw mode between strokes (click to turn off)'
        : 'Lock OFF — drop to select after each stroke (click to turn on)';
    }
    _refreshLockBtn();
    actionRow.appendChild(lockBtn);
    const clearBtn = document.createElement('button');
    clearBtn.innerHTML = '&#128465;'; // 🗑
    clearBtn.title = 'Clear all strokes on this frame';
    clearBtn.addEventListener('click', function(){
      // Round 17: must mutate the PERSISTENT per-frame array
      // (strokesByFrame[currentFrame]) IN PLACE, not the local
      // `strokes` alias. The alias is a reference to
      // strokesByFrame[currentFrame], so emptying it in place
      // clears the visible canvas AND the data. Previously we
      // did `s.strokes = []` which created a NEW empty array
      // for the alias, leaving the persistent array untouched.
      // The next time the user moved the time slider,
      // _syncStrokesForFrame re-bound the alias to the still-
      // populated strokesByFrame[frame] and the strokes came
      // back. Emptying the array in place keeps the alias and
      // the persistent store pointing at the same (now empty)
      // array, so the clear is durable across scrubs.
      const s = el._annoDrawState;
      const frame = _currentFrame();
      if (s.strokesByFrame[frame]) s.strokesByFrame[frame].length = 0;
      if (s.strokes) s.strokes.length = 0;
      _renderAnnoCanvas();
      _refreshDrawBtnBadge();
      if (el._refreshAllSeekMarkers) {
        try { el._refreshAllSeekMarkers(); } catch (e) {}
      }
      try { scheduleAutoSave(); } catch (e) {}
    });
    actionRow.appendChild(clearBtn);
    const doneBtn = document.createElement('button');
    doneBtn.innerHTML = '&#10003;'; // ✓
    doneBtn.title = 'Done drawing (Esc)';
    doneBtn.style.color = 'var(--accent)';
    doneBtn.addEventListener('click', function(){ _exitDrawMode(); });
    actionRow.appendChild(doneBtn);
    col2.appendChild(actionRow);

    // Round 5: close button (✕) at the bottom of col2. Round 19:
    // exits draw mode entirely (equivalent to pressing the draw button
    // again). The toolbar is now tied to draw mode so hiding it means
    // leaving draw mode. Legacy `drawToolbarHidden` flag is still
    // honoured as a force-hide if set elsewhere.
    const closeRow = document.createElement('div');
    closeRow.className = 'toolbar-row toolbar-row-close';
    const toolbarCloseBtn = document.createElement('button');
    toolbarCloseBtn.className = 'toolbar-close';
    toolbarCloseBtn.innerHTML = '&#10005;'; // ✕
    toolbarCloseBtn.title = 'Exit draw mode (press the draw button again to come back)';
    toolbarCloseBtn.addEventListener('click', function(ev){
      ev.stopPropagation();
      const s = el._annoDrawState;
      if (!s) return;
      // Exit draw mode — this also hides the toolbar via _applyDrawMode.
      s.mode = 'off';
      _applyDrawMode();
      try {
        const itm = _getItem();
        if (itm && itm.anno) itm.anno.drawToolbarHidden = true;
      } catch (e) {}
      try { scheduleAutoSave(); } catch (e) {}
      try { toast('Draw mode off — press the draw button to start again'); } catch (e) {}
    });
    closeRow.appendChild(toolbarCloseBtn);

    // Round 31: "📌 Follow" button — re-attach the draw panel to the
    // video. Sits next to the ✕ in the close row. Only visible when
    // the user has dragged the toolbar to a custom position (toolbarPos
    // is set); clicking it clears toolbarPos so the rAF follow loop
    // snaps the panel back to the video.
    const toolbarFollowBtn = document.createElement('button');
    toolbarFollowBtn.className = 'toolbar-follow hidden';
    toolbarFollowBtn.innerHTML = '📌';
    toolbarFollowBtn.title = 'Snap the draw panel back to the video (re-enable follow)';
    toolbarFollowBtn.addEventListener('click', function(ev){
      ev.stopPropagation();
      try {
        if (el._annoDrawState) {
          el._annoDrawState.toolbarPos = null;
        }
      } catch (e) {}
      try { _positionToolbar(); } catch (e) {}
      try { _syncToolbarFollowBtn(); } catch (e) {}
      try { toast('Following video'); } catch (e) {}
    });
    function _syncToolbarFollowBtn() {
      try {
        const detached = !!(el._annoDrawState && el._annoDrawState.toolbarPos);
        toolbarFollowBtn.classList.toggle('hidden', !detached);
      } catch (e) {}
    }
    closeRow.appendChild(toolbarFollowBtn);

    col2.appendChild(closeRow);

    // Apply persisted hidden state. Round 19: default is now hidden —
    // the toolbar only shows up after the user explicitly presses the
    // draw button. The `drawToolbarHidden` flag is honoured when set
    // (legacy behaviour + a way to force-hide if the user wants), but
    // on a fresh video we start hidden.
    try {
      const _initItm = _getItem();
      const _initAnno = (_initItm && _initItm.anno) ? _initItm.anno : null;
      const _initState = el._annoDrawState;
      // Default: hidden unless draw mode is on OR user has explicitly
      // un-hidden it (drawToolbarHidden === false).
      const _startHidden = !(_initState && _initState.mode && _initState.mode !== 'off')
        && (_initAnno ? _initAnno.drawToolbarHidden !== false : true);
      if (_startHidden) {
        annoToolbar.classList.add('toolbar-hidden');
      } else {
        annoToolbar.classList.remove('toolbar-hidden');
      }
    } catch (e) {
      annoToolbar.classList.add('toolbar-hidden');
    }

    // Round 6: Move the toolbar OUT of the video wrap and into <body>
    // so it floats as a separate panel that NEVER overlaps the video.
    // The toolbar gets a drag handle at the top so the user can move
    // it to a custom position. We position it next to the video on
    // creation and keep it in sync with the video position on resize.
    // R72: stash on el so cleanupAllItems can find and remove the orphaned
    // draw toolbar on undo/delete. Without this, the toolbar (which lives
    // on body) was leaking across undos — the user reported "the draw
    // panel stays on the screen" after Ctrl+Z.
    // Round 76: toolbar stays on document.body. The Fullscreen API hides
    // everything outside the fullscreen element's subtree, so the toolbar
    // is AUTO-HIDDEN in fullscreen — exactly what the user wants (clean
    // video view, no floating panels). The cursor ring, text editor, and
    // translate button are inside wrap so they remain usable in fullscreen.
    document.body.appendChild(annoToolbar);
    el._annoToolbar = annoToolbar;

    // ── Drag handle at the top of the toolbar ──
    // Lets the user move the floating toolbar anywhere on screen.
    const dragHandle = document.createElement('div');
    dragHandle.className = 'toolbar-drag-handle';
    dragHandle.title = 'Drag to move the toolbar';
    annoToolbar.insertBefore(dragHandle, annoToolbar.firstChild);

    // ── Position the toolbar next to the video (left by default) ──
    // We compute the position from the video's current bounding rect.
    // If there's no room to the left, we try the right. The user can
    // also drag the toolbar to a custom position via the drag handle.
    //
    // Round 7: also compute a SCALE factor so the toolbar visually
    // matches the player size. The base is calibrated for an 800-px
    // wide video (scale 1.0). For smaller players (mobile / shrunk
    // canvas) we shrink down to 0.65. For larger players (fullscreen
    // 1080p) we grow up to 1.35. The scale is applied as a CSS var
    // --tb-scale so all the toolbar's button / wheel / label sizes
    // resize together (no JS per-element work).
    function _positionToolbar() {
      if (!annoToolbar) return;
      if (annoToolbar.classList.contains('toolbar-hidden')) return;
      const r = wrap.getBoundingClientRect();
      if (!r || r.width === 0 || r.height === 0) return; // video not visible
      // Compute scale from the shorter side of the video (so the
      // toolbar doesn't get HUGE on a wide but short player).
      const ref = Math.min(r.width, r.height);
      // Round 10: bumped the scale up slightly so the toolbar is
      // easier to read on the 100px-wide color picker. Was 0.65–1.35,
      // now 0.75–1.5. Also bumped the base reference so the toolbar
      // doesn't shrink too aggressively on small players.
      let scale = 0.75 + Math.max(0, Math.min(1, (ref - 280) / 620)) * 0.75;
      scale = Math.round(scale * 100) / 100;
      annoToolbar.style.setProperty('--tb-scale', String(scale));
      // Round 12: make the draw panel the SAME HEIGHT as the video
      // player so they read as a single unit. We use `height` (not
      // min-height) so the panel is exactly r.height — no content
      // can push it taller and break the visual alignment. The
      // flex layout (margin-top:auto on the close row) keeps the
      // close button anchored to the bottom when the panel is
      // taller than its content; when content is taller than the
      // panel, overflow:hidden on the toolbar clips it cleanly.
      // Round 12: make the draw panel the SAME HEIGHT as the video
      // player so they read as a single unit. We use `height` (not
      // min-height) so the panel is exactly r.height — no content
      // can push it taller and break the visual alignment. The
      // flex layout (margin-top:auto on the close row) keeps the
      // close button anchored to the bottom when the panel is
      // taller than its content; when content is taller than the
      // panel, overflow:hidden on the toolbar clips it cleanly.
      annoToolbar.style.height = r.height + 'px';
      const tw = annoToolbar.offsetWidth || 110;
      const th = annoToolbar.offsetHeight || 240;
      // If the user has dragged the toolbar, respect their custom position
      // (we store the offset from the viewport origin, not the video)
      if (el._annoDrawState && el._annoDrawState.toolbarPos) {
        const p = el._annoDrawState.toolbarPos;
        // Clamp to viewport so it doesn't go off-screen
        const cx = Math.max(4, Math.min(window.innerWidth - tw - 4, p.x));
        const cy = Math.max(4, Math.min(window.innerHeight - th - 4, p.y));
        annoToolbar.style.left = cx + 'px';
        annoToolbar.style.top = cy + 'px';
        return;
      }
      // Round 10 (revised): place the toolbar to the LEFT of the video
      // and vertically CENTERED on the video (Photoshop / Figma side
      // panel pattern). Falls back to the right side (also centered)
      // if there's no room on the left, and finally to the top if
      // neither side has room.
      let left = r.left - tw - 10;
      let top = r.top + Math.max(0, (r.height - th) / 2);
      // If no room on the left, try the right (vertically centered)
      if (left < 8) {
        left = r.right + 10;
        top = r.top + Math.max(0, (r.height - th) / 2);
      }
      // If still no room (video is full-width), position at the top
      if (left + tw > window.innerWidth - 8) {
        left = r.left;
        top = r.top - th - 10;
      }
      // Clamp to viewport
      left = Math.max(4, Math.min(window.innerWidth - tw - 4, left));
      top = Math.max(4, Math.min(window.innerHeight - th - 4, top));
      annoToolbar.style.left = left + 'px';
      annoToolbar.style.top = top + 'px';
    }
    // Initial position (after the toolbar is in the DOM so offsetWidth is correct)
    try { _positionToolbar(); } catch (e) {}
    // Reposition on window resize
    window.addEventListener('resize', _positionToolbar);
    // Round 52: expose the toolbar's re-positioner on the el so the global
    // canvas-update hook (pan, zoom, item-move) can call it. The toolbar
    // is appended to <body> at position: fixed, so it needs to track the
    // video's screen-pixel size — when the canvas zooms, the video's
    // BCR changes, and the toolbar's --tb-scale + left/top must follow.
    el._repositionAnnoToolbar = _positionToolbar;

    // ── Drag logic for the floating toolbar ──
    let _tbDragging = false;
    let _tbDragStartX = 0, _tbDragStartY = 0;
    let _tbStartLeft = 0, _tbStartTop = 0;
    dragHandle.addEventListener('mousedown', function(ev) {
      ev.stopPropagation();
      ev.preventDefault();
      _tbDragging = true;
      _tbDragStartX = ev.clientX;
      _tbDragStartY = ev.clientY;
      const r = annoToolbar.getBoundingClientRect();
      _tbStartLeft = r.left;
      _tbStartTop = r.top;
      document.addEventListener('mousemove', _onTbDragMove);
      document.addEventListener('mouseup', _onTbDragEnd);
    });
    function _onTbDragMove(ev) {
      if (!_tbDragging) return;
      ev.preventDefault();
      const dx = ev.clientX - _tbDragStartX;
      const dy = ev.clientY - _tbDragStartY;
      const tw = annoToolbar.offsetWidth || 48;
      const th = annoToolbar.offsetHeight || 220;
      const nx = Math.max(4, Math.min(window.innerWidth - tw - 4, _tbStartLeft + dx));
      const ny = Math.max(4, Math.min(window.innerHeight - th - 4, _tbStartTop + dy));
      annoToolbar.style.left = nx + 'px';
      annoToolbar.style.top = ny + 'px';
    }
    function _onTbDragEnd() {
      if (!_tbDragging) return;
      _tbDragging = false;
      document.removeEventListener('mousemove', _onTbDragMove);
      document.removeEventListener('mouseup', _onTbDragEnd);
      // Save the custom position so it persists across reopens
      try {
        if (el._annoDrawState) {
          el._annoDrawState.toolbarPos = {
            x: parseFloat(annoToolbar.style.left) || 0,
            y: parseFloat(annoToolbar.style.top) || 0,
          };
        }
      } catch (e) {}
      // Round 31: surface the 📌 Follow button now that the user has
      // detached the panel. They can click it to re-attach.
      try { _syncToolbarFollowBtn(); } catch (e) {}
    }
    // Also reposition when the item moves on the canvas (e.g. user drags
    // the video to a new position). We use a lightweight periodic check
    // via requestAnimationFrame while the toolbar is visible.
    let _tbRafId = 0;
    function _tbFollowLoop() {
      try {
        if (annoToolbar && !annoToolbar.classList.contains('toolbar-hidden')) {
          // Only re-position if the user hasn't dragged the toolbar
          // to a custom position (toolbarPos is set on drag)
          if (!el._annoDrawState || !el._annoDrawState.toolbarPos) {
            _positionToolbar();
          }
        }
      } catch (e) {}
      _tbRafId = requestAnimationFrame(_tbFollowLoop);
    }
    _tbRafId = requestAnimationFrame(_tbFollowLoop);

    // ── helpers used by the toolbar above ──
    function _makeToolbarSep() {
      const s = document.createElement('div');
      s.className = 'sep';
      return s;
    }
    function _applyDrawMode() {
      const s = el._annoDrawState;
      // Update active state on the buttons (Round 7: added box, circle)
      arrowBtn.classList.toggle('active', s.mode === 'arrow');
      penBtn.classList.toggle('active', s.mode === 'pen');
      boxBtn.classList.toggle('active', s.mode === 'box');
      circleBtn.classList.toggle('active', s.mode === 'circle');
      // Round 12: text mode active state
      textBtn.classList.toggle('active', s.mode === 'text');
      // Round 34: when in text mode, update size button tooltips to
      // show the corresponding font size so users know S/M/L controls
      // text size as well as stroke size.
      try {
        var sizeBtns = annoToolbar.querySelectorAll('.toolbar-row-sizes button');
        sizeBtns.forEach(function(sb) {
          var sz = parseInt(sb.textContent === 'S' ? 2 : (sb.textContent === 'M' ? 4 : 7));
          if (s.mode === 'text') {
            sb.title = 'Text size ' + (Math.max(14, sz * 5)) + 'px (stroke ' + sz + 'px)';
          } else {
            sb.title = 'Stroke size ' + sz + 'px';
          }
        });
      } catch (_eSz) {}
      drawBtn.classList.toggle('active', s.mode !== 'off');
      // Toggle the wrap class (controls CSS for canvas pointer-events + dim)
      el.classList.toggle('draw-mode', s.mode !== 'off');
      // Toggle the body-level draw-mode class so the cursor ring (which
      // lives on body) becomes visible. Without this, the ring stays
      // `display: none` until the cursor actually moves over the canvas.
      document.body.classList.toggle('video-draw-mode', s.mode !== 'off');
      // Show / hide the cursor ring immediately so the user gets
      // instant feedback the moment they enter or leave draw mode.
      try {
        if (s.mode !== 'off') {
          _updateCursorRing();
          // Centre the ring on current mouse pos, or fall back to the
          // canvas centre if the mouse hasn't moved yet.
          const cx = _lastMouseX || (wrap.getBoundingClientRect().left + wrap.clientWidth / 2);
          const cy = _lastMouseY || (wrap.getBoundingClientRect().top + wrap.clientHeight / 2);
          cursorRing.style.left = cx + 'px';
          cursorRing.style.top = cy + 'px';
          cursorRing.style.display = 'block';
        } else {
          cursorRing.style.display = 'none';
        }
      } catch (e) {}
      // Safety net: if the board's draw tool got activated by some other
      // path (e.g. a stray global keypress), force it back to 'select'
      // while the video's draw mode is on. This prevents the white board
      // draw toolbar from painting over the video and blocking input.
      if (s.mode !== 'off') {
        try {
          if (typeof state !== 'undefined' && state && state.tool === 'draw') {
            // Use a direct reset that doesn't re-trigger our key handler.
            state.tool = 'select';
            const drawToolbar = document.getElementById('draw-toolbar');
            if (drawToolbar) drawToolbar.classList.remove('active');
          }
        } catch (e) {}
      }
      // Pause the video when entering draw mode (so strokes line up with the frame)
      if (s.mode !== 'off' && !mediaEl.paused) {
        try { mediaEl.pause(); } catch (e) {}
      }
      // Round 19: tie toolbar visibility to draw mode. When draw mode
      // is off, the toolbar is hidden. When the user presses the draw
      // button (or any other tool button), the toolbar pops up. The
      // ✕ close button now just exits draw mode (equivalent to pressing
      // the draw button again).
          try {
        if (annoToolbar) {
          annoToolbar.classList.toggle('toolbar-hidden', s.mode === 'off');
        }
      } catch (e) {}
      // Round 31: re-sync the 📌 Follow button so it reflects the
      // current detach state (toolbarPos is preserved across hide/show).
      try { _syncToolbarFollowBtn(); } catch (e) {}
      // Round 6: Don't hide the bottom controls while drawing — the user
      // needs the timeline/scrubber visible to jump between frames while
      // annotating. The toolbar is now a floating panel outside the video,
      // so there's no need to hide the controls for drawing room.
      // (The `drawing-hide` CSS class is kept for backwards compat but
      //  is no longer applied here.)
      _renderAnnoCanvas();
    }
    function _exitDrawMode() {
      el._annoDrawState.mode = 'off';
      _applyDrawMode();
      // Hide cursor ring when leaving draw mode
      if (typeof cursorRing !== 'undefined' && cursorRing) {
        cursorRing.style.display = 'none';
      }
    }
    function _refreshDrawBtnBadge() {
      const s = el._annoDrawState;
      drawBtn.classList.toggle('has-strokes', s.strokes.length > 0);
    }
    // Round 65: compute the video element's actual rendered content rect
    // inside the wrap. The video uses object-fit: contain, so when the
    // wrap's aspect ratio differs from the video's, the video content
    // is letterboxed (or pillarboxed). The annoCanvas should only cover
    // the visible content area — otherwise strokes would be drawn in
    // the black bars and appear misaligned with the video.
    function _getVideoContentRect() {
      const wrapW = wrap.clientWidth || 1;
      const wrapH = wrap.clientHeight || 1;
      const vw = mediaEl.videoWidth || 0;
      const vh = mediaEl.videoHeight || 0;
      if (!vw || !vh) {
        // metadata not loaded yet — cover the full wrap
        return { left: 0, top: 0, width: wrapW, height: wrapH };
      }
      const wrapAspect = wrapW / wrapH;
      const vidAspect = vw / vh;
      if (vidAspect > wrapAspect) {
        // video is wider — fit to width, letterbox top/bottom
        const w = wrapW;
        const h = wrapW / vidAspect;
        return { left: 0, top: (wrapH - h) / 2, width: w, height: h };
      } else {
        // video is taller — fit to height, pillarbox left/right
        const h = wrapH;
        const w = wrapH * vidAspect;
        return { left: (wrapW - w) / 2, top: 0, width: w, height: h };
      }
    }
    function _renderAnnoCanvas() {
      if (!annoCanvas) return;
      // Position the canvas over the video's visible content rect (no
      // letterbox area). This way strokes land on the video content
      // and stay aligned when the user zooms/pans the canvas.
      const r = _getVideoContentRect();
      if (r.width < 1 || r.height < 1) return;
      annoCanvas.style.left = r.left + 'px';
      annoCanvas.style.top = r.top + 'px';
      annoCanvas.style.width = r.width + 'px';
      annoCanvas.style.height = r.height + 'px';
      const cw = r.width;
      const ch = r.height;
      // Set internal resolution (retina-friendly: 2x of CSS pixels)
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const targetW = Math.max(1, Math.round(cw * dpr));
      const targetH = Math.max(1, Math.round(ch * dpr));
      if (annoCanvas.width !== targetW || annoCanvas.height !== targetH) {
        annoCanvas.width = targetW;
        annoCanvas.height = targetH;
      }
      const ctx = annoCanvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, annoCanvas.width, annoCanvas.height);
      // Re-apply DPR scale
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Render committed strokes
      const s = el._annoDrawState;
      s.strokes.forEach(stk => _drawAnnoStroke(ctx, stk, cw, ch));
      if (s.drawing) _drawAnnoStroke(ctx, s.drawing, cw, ch);
    }
    function _drawAnnoStroke(ctx, stk, cw, ch) {
      if (!stk || !stk.points || stk.points.length === 0) return;
      ctx.strokeStyle = stk.color;
      ctx.fillStyle = stk.color;
      ctx.lineWidth = stk.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const pts = stk.points.map(p => [p[0] * cw, p[1] * ch]);
      if (stk.type === 'pen') {
        if (pts.length < 2) return;
        ctx.beginPath();
        pts.forEach((p, i) => i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]));
        ctx.stroke();
      } else if (stk.type === 'arrow') {
        if (pts.length < 2) return;
        const [x0, y0] = pts[0];
        const [x1, y1] = pts[pts.length - 1];
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        // Arrowhead
        const angle = Math.atan2(y1 - y0, x1 - x0);
        const headLen = Math.max(10, stk.size * 3.2);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - headLen * Math.cos(angle - Math.PI / 6), y1 - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(x1 - headLen * Math.cos(angle + Math.PI / 6), y1 - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      } else if (stk.type === 'box') {
        // Round 7: rectangle from start → end (the same way as the
        // global drawing tool uses in renderStrokes). Lives on a
        // separate branch so the existing `else` (freehand pen)
        // doesn't accidentally try to stroke a single point.
        if (pts.length < 2) return;
        const [x0, y0] = pts[0];
        const [x1, y1] = pts[pts.length - 1];
        const bx = Math.min(x0, x1), by = Math.min(y0, y1);
        const bw = Math.abs(x1 - x0), bh = Math.abs(y1 - y0);
        ctx.beginPath();
        ctx.strokeRect(bx, by, bw, bh);
      } else if (stk.type === 'circle') {
        // Round 7: ellipse fitted to the bounding box of the two
        // pointer positions. cx/cy = center, rx/ry = half of the
        // box width/height. Both radii are clamped to >= 0.5 so
        // a single-click does not crash.
        if (pts.length < 2) return;
        const [x0, y0] = pts[0];
        const [x1, y1] = pts[pts.length - 1];
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const rx = Math.max(0.5, Math.abs(x1 - x0) / 2);
        const ry = Math.max(0.5, Math.abs(y1 - y0) / 2);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (stk.type === 'text') {
        // Round 12: text annotation. The stroke stores a single
        // normalised [x, y] point and a `text` string. We render
        // the text with a translucent black pill background so the
        // text stays readable on light AND dark video frames.
        const [x, y] = pts[0];
        const text = (stk.text || '').trim();
        if (!text) return;
        // Font size scales with the stroke's `size` field (the
        // S/M/L picker value, 2-7px). Translate that to a readable
        // pixel size for the text.
        const fontSize = Math.max(14, (stk.size || 4) * 5);
        ctx.font = '600 ' + fontSize + 'px -apple-system, "SF Pro Display", system-ui, sans-serif';
        ctx.textBaseline = 'top';
        // Measure to build a background pill
        const metrics = ctx.measureText(text);
        const padX = 6, padY = 4;
        const bgW = metrics.width + padX * 2;
        const bgH = fontSize * 1.15 + padY * 2;
        // Translucent background for readability on any frame
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        const radius = 5;
        const bx2 = x, by2 = y, bw2 = bgW, bh2 = bgH;
        ctx.beginPath();
        ctx.moveTo(bx2 + radius, by2);
        ctx.lineTo(bx2 + bw2 - radius, by2);
        ctx.quadraticCurveTo(bx2 + bw2, by2, bx2 + bw2, by2 + radius);
        ctx.lineTo(bx2 + bw2, by2 + bh2 - radius);
        ctx.quadraticCurveTo(bx2 + bw2, by2 + bh2, bx2 + bw2 - radius, by2 + bh2);
        ctx.lineTo(bx2 + radius, by2 + bh2);
        ctx.quadraticCurveTo(bx2, by2 + bh2, bx2, by2 + bh2 - radius);
        ctx.lineTo(bx2, by2 + radius);
        ctx.quadraticCurveTo(bx2, by2, bx2 + radius, by2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        // Text on top
        ctx.fillStyle = stk.color || '#fff';
        ctx.fillText(text, x + padX, y + padY);
      }
    }
    // Expose helpers for later use (lightbox / export compositing)
    el._renderAnnoCanvas = _renderAnnoCanvas;
    el._drawAnnoStroke = _drawAnnoStroke;
    el._applyDrawMode = _applyDrawMode;
    el._exitDrawMode = _exitDrawMode;
    el._refreshDrawBtnBadge = _refreshDrawBtnBadge;

    // ── Round 9: per-frame strokes helpers ──
    // Get the current frame number from the video's currentTime and FPS.
    // Uses the global `getCurrentFps` (project-wide) and falls back to
    // `_kraftedFps` (set when the video is imported) or 30.
    function _currentFrame() {
      const fps = (typeof getCurrentFps === 'function') ? getCurrentFps() : (mediaEl._kraftedFps || 30);
      return Math.max(0, Math.floor((mediaEl.currentTime || 0) * fps));
    }
    // Re-bind the flat `strokes` alias to the strokes for the current
    // frame. Called whenever the frame number changes (via timeupdate
    // or seeked). The flat alias is what existing render / undo / clear
    // code reads; the persistent store is `strokesByFrame`.
    function _syncStrokesForFrame() {
      const s = el._annoDrawState;
      if (!s) return;
      const frame = _currentFrame();
      if (!s.strokesByFrame[frame]) s.strokesByFrame[frame] = [];
      s.strokes = s.strokesByFrame[frame];
      s.lastFrame = frame;
    }
    // Fire when the frame changes — re-sync the strokes alias and
    // re-render the canvas so the new frame's strokes are shown.
    function _onFrameChange() {
      const s = el._annoDrawState;
      if (!s) return;
      const frame = _currentFrame();
      if (frame === s.lastFrame) return;
      _syncStrokesForFrame();
      _renderAnnoCanvas();
      _refreshDrawBtnBadge();
      // Update the frame indicator in the toolbar (if visible)
      try { _updateFrameIndicator(); } catch (e) {}
    }
    el._currentFrame = _currentFrame;
    el._syncStrokesForFrame = _syncStrokesForFrame;
    el._onFrameChange = _onFrameChange;

    // ── Round 9: listen for frame changes ──
    // `timeupdate` fires every 100-250ms while playing, and on seek.
    // We also listen for `seeked` to catch the cases where the user
    // jumps the scrubber directly (some browsers don't fire a
    // timeupdate on pure seeks). The double-listener is fine — both
    // call into _onFrameChange which is a no-op if the frame hasn't
    // actually changed.
    mediaEl.addEventListener('timeupdate', _onFrameChange);
    mediaEl.addEventListener('seeked', _onFrameChange);
    // Initial sync
    _syncStrokesForFrame();

    // ── Pointer events on the canvas ──
    let _activePointerId = null;
    // Throttle pointermove → render to one frame per animation tick so
    // the line follows the cursor smoothly even on long strokes. Without
    // this, fast drags can drop events and the line looks choppy.
    let _renderQueued = false;
    function _queueRender() {
      if (_renderQueued) return;
      _renderQueued = true;
      requestAnimationFrame(function() {
        _renderQueued = false;
        _renderAnnoCanvas();
      });
    }
    function _canvasPoint(ev) {
      const rect = annoCanvas.getBoundingClientRect();
      // Use clientWidth/Height of the CSS-sized canvas (matches displayed pixels)
      const w = rect.width || 1;
      const h = rect.height || 1;
      return [
        Math.max(0, Math.min(1, (ev.clientX - rect.left) / w)),
        Math.max(0, Math.min(1, (ev.clientY - rect.top) / h)),
      ];
    }
    annoCanvas.addEventListener('pointerdown', function(ev) {
      const s = el._annoDrawState;
      if (s.mode === 'off') return;
      ev.preventDefault();
      ev.stopPropagation();
      // Round 12: text mode is single-click (no drag). Spawn an
      // inline editor at the click point. The user types text and
      // presses Enter to commit. This is the same UX as Figma's
      // text tool — click, type, Enter.
      if (s.mode === 'text') {
        try { annoCanvas.releasePointerCapture(ev.pointerId); } catch (e) {}
        _spawnTextEditor(ev, _canvasPoint(ev));
        return;
      }
      try { annoCanvas.setPointerCapture(ev.pointerId); } catch (e) {}
      _activePointerId = ev.pointerId;
      const pt = _canvasPoint(ev);
      s.drawing = {
        type: s.mode,
        color: s.color,
        size: s.size,
        // Round 7: arrow/box/circle all use 2-point drag (start→end);
        // only pen accumulates intermediate points for freehand. Seed
        // with two copies of the start point so the preview rendering
        // (which expects >=2 points) doesn't no-op.
        points: s.mode === 'pen' ? [pt] : [pt, pt],
        // Round 20: capture the frame at SPAWN (not commit). The
        // flat `s.strokes` alias is re-bound to a different frame
        // on every timeupdate. If the playhead drifts between
        // pointerdown and pointerup (e.g. the user accidentally
        // hits space, or a seek lands mid-drag), the old code
        // pushed the stroke to whichever frame was current at
        // pointerup — the user had to step ±1 to find it. By
        // snapshotting the frame at pen-down and writing to that
        // exact slot on commit, the stroke lands on the frame the
        // user was actually looking at when they clicked.
        _spawnFrame: _currentFrame(),
      };
      _renderAnnoCanvas();
    });
    // Round 12: text editor. Spawns an absolutely-positioned
    // <textarea> at the click point. The user types text, presses
    // Enter to commit, Esc to cancel. On commit, the text becomes
    // a stroke with type 'text' and is added to the current frame's
    // strokesByFrame array — same storage as pen/arrow/box/circle.
    // Round 18: capture the frame number at SPAWN time (not commit
    // time). `s.strokes` is a live alias to strokesByFrame[currentFrame]
    // that gets re-bound on every timeupdate. If the user clicks at
    // frame N, then while typing the playhead drifts to N+1, the old
    // code pushed the new text to N+1's strokesByFrame — the text
    // appeared on the "next frame" and the user couldn't find it. By
    // snapshotting the frame at spawn and writing to that exact slot
    // on commit, the text lands on the frame the user was actually
    // looking at when they clicked.
    function _spawnTextEditor(ev, pt) {
      const s = el._annoDrawState;
      // Remove any existing text editor for this video. We use
      // el._textEditorEl (not a bareword) so this works in any
      // script mode — bareword reads of undeclared vars throw
      // ReferenceError even in non-strict mode.
      if (el._textEditorEl && el._textEditorEl.parentNode) {
        try { _commitTextEditor(true); } catch (e) {}
      }
      // Pause the video so the frame can't drift while typing.
      // The draw mode already pauses on entry, but the user may
      // have unpaused, or this can be reached via other paths.
      try { if (!mediaEl.paused) mediaEl.pause(); } catch (e) {}
      // Capture the frame at spawn so the commit lands here even
      // if timeupdate / seek / etc. happens mid-typing.
      const spawnFrame = _currentFrame();
      s._textSpawnFrame = spawnFrame;
      // Create the editor element
      const editor = document.createElement('textarea');
      editor.className = 'media-anno-text-editor';
      editor.placeholder = 'Type…';
      editor.rows = 1;
      editor.value = '';
      // Position it at the click point in viewport coords. The editor
      // is `position: fixed` and is NOT inside the canvas zoom/pan
      // transform, so the click position is just ev.clientX/Y.
      // The committed text is drawn on the canvas in canvas-CSS-pixel
      // space, which the zoom transform maps back to viewport at
      // (rect.left + pt[0]*cw*zoom) = ev.clientX — so both the
      // editor and the committed text line up at the click point.
      // (Earlier versions did `rect.left + pt[0] * cw` which only
      //  equals the click point at zoom=1; at zoom!=1 the editor
      //  drifted toward the click-point-divided-by-zoom.)
      const px = ev.clientX;
      const py = ev.clientY;
      // Round 18: position the editor so the text inside it lands
      // at the exact same viewport pixel as the final committed text.
      // The committed text is drawn at (x + padX, y + padY) where
      // padX=6, padY=4 (in canvas CSS pixels), and the editor has
      // padding 5px 8px around its text. To compensate we shift
      // the editor up-left by (padding - pad) = (8-6, 5-4) = (2, 1).
      // We also use the same fontSize formula as the renderer
      // (max(14, size*5)) so what-you-see matches what-you-get.
      const fontSize = Math.max(14, (s.size || 4) * 5);
      editor.style.font = '600 ' + fontSize + 'px -apple-system, "SF Pro Display", system-ui, sans-serif';
      editor.style.left = (px - 2) + 'px';
      editor.style.top = (py - 1) + 'px';
      editor.style.width = '20px'; // start small, auto-grow on input
      // Color: copy from current draw state
      editor.style.color = s.color || '#fff';
      // Stash the normalised point for later commit
      editor._annoPt = pt;
      // Auto-grow width & height as the user types.
      // Uses a hidden mirror <span> with identical styling to measure
      // the natural text width, then clamps between minW(60) and maxW(420).
      var _mirror = document.createElement('span');
      _mirror.style.cssText = 'position:absolute;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;pointer-events:none;left:-9999px;top:-9999px;';
      document.body.appendChild(_mirror);
      editor._mirror = _mirror; // stash for cleanup
      // Run once immediately to fit the placeholder width
      (function(){
        editor.style.height = 'auto';
        editor.style.height = (editor.scrollHeight + 4) + 'px';
        var txt = editor.value || editor.placeholder || '';
        var fs = editor.style.font || window.getComputedStyle(editor).font || '14px sans-serif';
        var pw = parseFloat(window.getComputedStyle(editor).paddingLeft || 0) + parseFloat(window.getComputedStyle(editor).paddingRight || 0);
        _mirror.style.font = fs;
        _mirror.style.lineHeight = editor.style.lineHeight || window.getComputedStyle(editor).lineHeight;
        _mirror.style.letterSpacing = window.getComputedStyle(editor).letterSpacing;
        _mirror.textContent = txt;
        var naturalW = _mirror.getBoundingClientRect().width + pw + 2;
        var targetW = Math.max(20, Math.min(140, Math.ceil(naturalW)));
        editor.style.width = targetW + 'px';
      })();
      editor.addEventListener('input', function(){
        // Height: auto-grow
        editor.style.height = 'auto';
        editor.style.height = (editor.scrollHeight + 4) + 'px';
        // Width: measure via mirror span
        var txt = editor.value || editor.placeholder || '';
        var fs = editor.style.font || window.getComputedStyle(editor).font || '14px sans-serif';
        var pw = parseFloat(window.getComputedStyle(editor).paddingLeft || 0) + parseFloat(window.getComputedStyle(editor).paddingRight || 0);
        _mirror.style.font = fs;
        _mirror.style.lineHeight = editor.style.lineHeight || window.getComputedStyle(editor).lineHeight;
        _mirror.style.letterSpacing = window.getComputedStyle(editor).letterSpacing;
        _mirror.textContent = txt;
        var naturalW = _mirror.getBoundingClientRect().width + pw + 2; // +2 for border
        var targetW = Math.max(20, Math.min(140, Math.ceil(naturalW)));
        editor.style.width = targetW + 'px';
      });
      // Enter to commit, Shift+Enter for newline, Esc to cancel
      editor.addEventListener('keydown', function(ke){
        if (ke.key === 'Enter' && !ke.shiftKey) {
          ke.preventDefault();
          _commitTextEditor();
        } else if (ke.key === 'Escape') {
          ke.preventDefault();
          _cancelTextEditor();
        }
      });
      // Click-outside to commit
      editor.addEventListener('blur', function(){
        // Use a microtask so the click that triggered the blur
        // doesn't immediately tear the editor down
        setTimeout(function(){
          if (el._textEditorEl === editor) _commitTextEditor();
        }, 80);
      });
      // Round 75.2: append editor to wrap (the fullscreen target)
      // instead of document.body so the text editor is visible when
      // the player is in fullscreen. Same fix as the annotation
      // toolbar and cursor ring. The editor uses position:fixed so
      // it escapes ancestor overflow:hidden and anchors to the
      // viewport/fullscreen viewport identically.
      document.body.appendChild(editor);
      el._textEditorEl = editor;
      // Make the text editor draggable so the user can reposition it
      // after it spawns at the video centre (T-key shortcut).
      (function _makeDraggable() {
        var dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;
        editor.addEventListener('pointerdown', function(de) {
          if (de.target.tagName === 'TEXTAREA') return; // let typing through
          dragging = true; startX = de.clientX; startY = de.clientY;
          origLeft = parseFloat(editor.style.left) || 0;
          origTop = parseFloat(editor.style.top) || 0;
          editor.setPointerCapture(de.pointerId);
          de.preventDefault(); de.stopPropagation();
        });
        editor.addEventListener('pointermove', function(de) {
          if (!dragging) return;
          editor.style.left = (origLeft + de.clientX - startX) + 'px';
          editor.style.top = (origTop + de.clientY - startY) + 'px';
        });
        editor.addEventListener('pointerup', function() { dragging = false; });
        editor.addEventListener('pointercancel', function() { dragging = false; });
      })();
      // Round 28.7: translate-to-Chinese button. Floats just below
      // the editor's right edge. Click → calls translateText(), replaces
      // the editor's value with the translation. The user can still
      // edit / commit normally. If the typed text is already CJK the
      // button auto-flips to translate to English (same icon, same flow).
      const trBtn = document.createElement('button');
      trBtn.type = 'button';
      trBtn.className = 'media-anno-text-translate';
      trBtn.innerHTML = '🌐 → 中';
      trBtn.title = 'Translate the typed text — auto-detects source language (uses MyMemory/Google translate API; offline / network failure shows a hint)';
      const positionTrBtn = () => {
        try {
          const r = editor.getBoundingClientRect();
          // Place the chip BELOW the editor's right edge. If that would
          // fall off-screen, flip it to above the editor instead.
          const btnW = 84, btnH = 22;
          let bx = r.right - btnW;
          let by = r.bottom + 6;
          if (by + btnH > window.innerHeight - 8) by = r.top - btnH - 6;
          if (by < 8) by = 8;
          if (bx < 8) bx = 8;
          if (bx + btnW > window.innerWidth - 8) bx = window.innerWidth - btnW - 8;
          trBtn.style.left = bx + 'px';
          trBtn.style.top = by + 'px';
        } catch (e) {}
      };
      // Position now (after the editor has had a tick to render)
      setTimeout(positionTrBtn, 0);
      // Reposition on window resize (the editor is fixed-positioned so
      // window resize is the only thing that can break the alignment)
      window.addEventListener('resize', positionTrBtn);
      // Auto-flip the button label based on what's typed. CJK in the
      // box → button becomes "中 → EN". Latin/digits → "🌐 → 中".
      // The detection is a single regex; runs on every keystroke.
      const refreshTrBtnLabel = () => {
        const v = (editor.value || '');
        const hasCjk = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(v);
        const hasLatin = /[A-Za-z]/.test(v);
        if (hasCjk && !hasLatin) {
          trBtn.innerHTML = '中 → EN';
        } else if (hasLatin || v.length > 0) {
          trBtn.innerHTML = '🌐 → 中';
        } else {
          trBtn.innerHTML = '🌐 → 中';
        }
      };
      editor.addEventListener('input', refreshTrBtnLabel);
      // The click handler
      trBtn.addEventListener('mousedown', function(ev){
        // Don't blur the editor before the click registers
        ev.preventDefault();
      });
      trBtn.addEventListener('click', async function(ev){
        ev.preventDefault();
        ev.stopPropagation();
        const text = (editor.value || '').trim();
        if (!text) {
          try { editor.focus(); } catch (e) {}
          return;
        }
        // Detect direction
        const hasCjk = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
        const fromLang = hasCjk ? 'zh' : 'en';
        const toLang   = hasCjk ? 'en' : 'zh';
        const origLabel = trBtn.innerHTML;
        trBtn.disabled = true;
        trBtn.classList.add('translating');
        trBtn.innerHTML = '⏳';
        try {
          const translated = await translateText(text, fromLang, toLang);
          if (translated && translated !== text) {
            editor.value = translated;
            // Trigger input so auto-grow runs
            try {
              editor.dispatchEvent(new Event('input', { bubbles: true }));
            } catch (e) {
              editor.style.height = 'auto';
              editor.style.height = (editor.scrollHeight + 4) + 'px';
            }
            refreshTrBtnLabel();
            positionTrBtn();
            try { editor.focus(); } catch (e) {}
          } else {
            trBtn.innerHTML = 'no change';
            setTimeout(() => { trBtn.innerHTML = origLabel; }, 1100);
          }
        } catch (e) {
          console.warn('Translate failed:', e);
          trBtn.innerHTML = '✗ offline';
          setTimeout(() => { trBtn.innerHTML = origLabel; }, 1400);
        } finally {
          trBtn.disabled = false;
          trBtn.classList.remove('translating');
          // Revert label to whatever the current text suggests
          refreshTrBtnLabel();
        }
      });
      // Round 75.2: append translate button to wrap (the fullscreen
      // target), not document.body — same reason as the editor: the
      // Fullscreen API only renders the fullscreen element's subtree.
      document.body.appendChild(trBtn);
      // Stash on the editor so _commit / _cancel can tear it down cleanly
      editor._trBtn = trBtn;
      editor._positionTrBtn = positionTrBtn;
      // Focus + position cursor
      setTimeout(function(){
        try { editor.focus(); } catch (e) {}
      }, 10);
    }
    // `skipExitTextMode` is true when this commit is triggered by
    // _spawnTextEditor (user clicked again to place another text) —
    // in that case the user wants to stay in text mode. For all other
    // callers (Enter key, blur/click-outside), we exit text mode
    // automatically so the user can click to play/pause/seek normally.
    function _commitTextEditor(skipExitTextMode) {
      if (!el._textEditorEl || !el._textEditorEl.parentNode) return;
      const ed = el._textEditorEl;
      // Round 28.7: tear down the translate button too. It floats
      // separately from the editor, so it needs its own cleanup.
      try {
        if (ed._trBtn && ed._trBtn.parentNode) {
          ed._trBtn.parentNode.removeChild(ed._trBtn);
        }
        ed._trBtn = null;
      } catch (e) {}
      const text = (ed.value || '').trim();
      if (text) {
        const s = el._annoDrawState;
        // Round 18: write to the frame the user was ON when they
        // clicked, not whatever the playhead drifted to while they
        // were typing. Falls back to current frame if the spawn
        // frame wasn't recorded (e.g. legacy editor created before
        // this fix).
        const targetFrame = (typeof s._textSpawnFrame === 'number')
          ? s._textSpawnFrame
          : _currentFrame();
        if (!s.strokesByFrame[targetFrame]) s.strokesByFrame[targetFrame] = [];
        s.strokesByFrame[targetFrame].push({
          type: 'text',
          color: s.color,
          size: s.size,
          text: text,
          points: [ed._annoPt || [0.5, 0.5]],
        });
        // Re-bind the live alias to the target frame so the canvas
        // re-render shows the new text (the alias may have moved
        // to a different frame during the typing interval).
        s.strokes = s.strokesByFrame[targetFrame];
        s.lastFrame = targetFrame;
        _renderAnnoCanvas();
        _refreshDrawBtnBadge();
        if (el._refreshAllSeekMarkers) {
          try { el._refreshAllSeekMarkers(); } catch (e) {}
        }
        try { scheduleAutoSave(); } catch (e) {}
        // Reset spawn-frame so the next T-press on a different frame
        // creates a fresh annotation (not the same one we just committed).
        s._textSpawnFrame = null;
      }
      // Tear down the editor
      try { if (ed._mirror && ed._mirror.parentNode) ed._mirror.parentNode.removeChild(ed._mirror); } catch (e) {}
      try { ed.parentNode.removeChild(ed); } catch (e) {}
      el._textEditorEl = null;
      // Auto-exit text mode after committing a video annotation so the
      // user can click the video to play/pause/seek without accidentally
      // spawning another text editor. Skip this when the user clicked
      // to place another text (skipExitTextMode=true from _spawnTextEditor).
      if (!skipExitTextMode) {
        try { setTool('select'); } catch (e) {}
      }
    }
    function _cancelTextEditor() {
      if (!el._textEditorEl || !el._textEditorEl.parentNode) return;
      // Round 28.7: also tear down the floating translate button
      try {
        const ed = el._textEditorEl;
        if (ed && ed._trBtn && ed._trBtn.parentNode) {
          ed._trBtn.parentNode.removeChild(ed._trBtn);
        }
        if (ed) ed._trBtn = null;
      } catch (e) {}
      try { if (el._textEditorEl._mirror && el._textEditorEl._mirror.parentNode) el._textEditorEl._mirror.parentNode.removeChild(el._textEditorEl._mirror); } catch (e) {}
      try { el._textEditorEl.parentNode.removeChild(el._textEditorEl); } catch (e) {}
      el._textEditorEl = null;
    }
    // Expose for tests + lightbox / export compositing
    el._textEditorEl = null;
    el._commitTextEditor = _commitTextEditor;
    el._cancelTextEditor = _cancelTextEditor;
    el._spawnTextEditorDirect = function(fakeEv) {
      // Ensure draw state is active before spawning
      if (el._annoDrawState.mode !== 'text') el._annoDrawState.mode = 'text';
      _applyDrawMode();
      // Use the video wrap's centre for the canvas point
      var cr = annoCanvas.getBoundingClientRect();
      var pt = [
        Math.max(0, Math.min(1, (fakeEv.clientX - cr.left) / (cr.width || 1))),
        Math.max(0, Math.min(1, (fakeEv.clientY - cr.top) / (cr.height || 1)))
      ];
      _spawnTextEditor(fakeEv, pt);
    };
    annoCanvas.addEventListener('pointermove', function(ev) {
      const s = el._annoDrawState;
      if (!s.drawing) return;
      if (_activePointerId !== null && ev.pointerId !== _activePointerId) return;
      ev.preventDefault();
      ev.stopPropagation();
      const pt = _canvasPoint(ev);
      if (s.drawing.type === 'pen') {
        s.drawing.points.push(pt);
      } else {
        // Arrow / box / circle: always update the LAST point (keep start)
        s.drawing.points[s.drawing.points.length - 1] = pt;
      }
      _queueRender();
    });
    function _endStroke(ev) {
      const s = el._annoDrawState;
      if (!s.drawing) return;
      if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      // Only commit if the stroke is "real" (at least 4% of canvas size moved)
      // — otherwise a single click would add a tiny dot stroke.
      const pts = s.drawing.points;
      let keep = false;
      if (s.drawing.type === 'arrow' && pts.length >= 2) {
        const dx = pts[pts.length - 1][0] - pts[0][0];
        const dy = pts[pts.length - 1][1] - pts[0][1];
        if (Math.hypot(dx, dy) > 0.015) keep = true;
      } else if (s.drawing.type === 'pen' && pts.length >= 3) {
        keep = true;
      } else if ((s.drawing.type === 'box' || s.drawing.type === 'circle') && pts.length >= 2) {
        // Round 7: box/circle need a real drag (>1.5% of canvas) to commit
        const dx = pts[pts.length - 1][0] - pts[0][0];
        const dy = pts[pts.length - 1][1] - pts[0][1];
        if (Math.hypot(dx, dy) > 0.015) keep = true;
      }
      if (keep) {
        // Round 20: write to the frame captured at pointerdown, not the
        // current frame. The flat `s.strokes` alias is re-bound by
        // _syncStrokesForFrame on every timeupdate, so pushing via
        // `s.strokes.push(...)` would land on whatever frame is current
        // at commit time — which can drift from the spawn frame if the
        // playhead moved during the stroke. We push directly to
        // strokesByFrame[spawnFrame] to guarantee frame-accurate
        // placement, then re-sync the flat alias so the canvas still
        // shows the stroke on the current frame.
        const spawnFrame = (typeof s.drawing._spawnFrame === 'number')
          ? s.drawing._spawnFrame
          : _currentFrame();
        if (!s.strokesByFrame[spawnFrame]) s.strokesByFrame[spawnFrame] = [];
        s.strokesByFrame[spawnFrame].push({
          type: s.drawing.type,
          color: s.drawing.color,
          size: s.drawing.size,
          points: s.drawing.points,
        });
        // Re-sync the flat alias so the canvas re-renders correctly.
        // If we're still on the spawn frame, this re-points to the
        // same array we just pushed to. If we've drifted, the alias
        // points to the current frame's array (which is empty for
        // now) — the stroke will become visible again when the user
        // scrubs back to the spawn frame.
        _syncStrokesForFrame();
      }
      s.drawing = null;
      try { annoCanvas.releasePointerCapture(_activePointerId); } catch (e) {}
      _activePointerId = null;
      _renderAnnoCanvas();
      _refreshDrawBtnBadge();
      // Round 10: refresh drawing markers on the seek bar so the new
      // stroke shows up as a cyan diamond at the spawn frame.
      if (el._refreshDrawSeekMarkers) {
        try { el._refreshAllSeekMarkers(); } catch (e) {}
      }
      // Round 65: auto-exit draw mode after one stroke. The user reported
      // that after drawing on a frame, scrubbing to other frames kept
      // them in draw mode and any stray pointer movement on the canvas
      // would create a phantom stroke. Now we drop back to "off" so the
      // user can scrub/check other frames safely. To draw more, just
      // tap the draw button again — one stroke per tap.
      // R79: if lockToPlayer is ON, stay in draw mode after the stroke.
      if (!(window.G && window.G.lockToPlayer)) {
        _exitDrawMode();
      }
    }
    annoCanvas.addEventListener('pointerup', _endStroke);
    annoCanvas.addEventListener('pointercancel', _endStroke);
    annoCanvas.addEventListener('pointerleave', function(ev) {
      // Only end if we were actively drawing and the pointer really left
      if (el._annoDrawState.drawing && _activePointerId !== null && ev.pointerId === _activePointerId) {
        _endStroke(ev);
      }
    });
    // Prevent the wrap's click-to-seek handler from firing when the user
    // was drawing (we don't seek while the user is annotating).
    annoCanvas.addEventListener('click', function(ev){ ev.stopPropagation(); });
    // Resize observer: keep the canvas in sync with the wrap size
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => _renderAnnoCanvas());
      ro.observe(wrap);
    } else {
      window.addEventListener('resize', _renderAnnoCanvas);
    }
    // Round 65: re-render when video metadata loads — that's when we
    // learn the video's natural aspect ratio, which is needed to compute
    // the correct content rect (object-fit: contain letterbox area).
    if (mediaEl.readyState >= 1) {
      // metadata already loaded — render now
      _renderAnnoCanvas();
    } else {
      mediaEl.addEventListener('loadedmetadata', function _metaRerender() {
        mediaEl.removeEventListener('loadedmetadata', _metaRerender);
        _renderAnnoCanvas();
      });
    }
    // Initial badge state — NOTE: `_refreshDrawBtnBadge()` and the
    // drawBtn click handlers were here before but ran before `drawBtn`
    // was assigned (the button element is created in a later
    // `if (isVideo)` block that runs *after* this whole annotation
    // toolbar block). They've been moved further down to run right
    // after the element exists, with the rest of the ctrlsRow setup.
  } // end if (isVideo)

  // Round 68: info bar (type · filename · F N/M · time · fps) goes first
  // so it sits above the video, never overlapping content.
  if (infoBar) el.appendChild(infoBar);
  el.appendChild(wrap);

  // ── Click on video area to toggle play/pause ──
  // Round 73: changed from "seek + pause" (RV Player logic) to play/pause
  // toggle per user request. Drag-gate still prevents accidental triggers
  // when repositioning the card on canvas.
  // ── Click on video area to toggle play/pause ──
  // Round 73: changed from "seek + pause" (RV Player logic) to play/pause
  // toggle, per user request. Drag-gate still prevents spurious triggers
  // when repositioning the card on canvas.
  wrap.style.pointerEvents = 'auto';
  let _clickDownX = null, _clickDownY = null, _clickDragged = false;
  wrap.addEventListener('mousedown', function(ev) {
    _clickDownX = ev.clientX;
    _clickDownY = ev.clientY;
    _clickDragged = false;
  });
  wrap.addEventListener('mousemove', function(ev) {
    if (_clickDownX === null) return;
    const dx = ev.clientX - _clickDownX;
    const dy = ev.clientY - _clickDownY;
    if (dx*dx + dy*dy > 25) _clickDragged = true; // 5px threshold, squared
  });
  wrap.addEventListener('click', function(ev) {
    if (_clickDragged) {
      _clickDownX = null; _clickDownY = null; _clickDragged = false;
      return;
    }
    _clickDownX = null; _clickDownY = null; _clickDragged = false;
    // In clean mode the click handler below exits clean mode — don't
    // also toggle play/pause here.
    if (el.classList.contains('clean-mode')) return;
    if (ev.target.closest('.media-controls')) return;
    if (ev.target.closest('.media-volume-popover')) return;
    if (!mediaEl.duration || mediaEl.readyState < 2) return;
    ev.stopPropagation();
    // Round 73: toggle play/pause (was: seek to click position + pause)
    if (mediaEl.paused) {
      mediaEl.muted = false;
      mediaEl.play().catch(function(){});
    } else {
      mediaEl.pause();
    }
  });

  // ── .media-controls (bottom bar) ──
  // Round 51: redesigned layout. Three visual groups in row 1,
  // separated by thin dividers:
  //   [LEFT: play + draw] | [CENTER: time + seek + time] | [RIGHT: comments + volume]
  // Row 2 (trim mini-timeline) is unchanged. The on-video comments FAB
  // is GONE — comments button now lives in the right group.
  const ctrls = document.createElement('div');
  ctrls.className = 'media-controls';
  const ctrlsRow = document.createElement('div');
  ctrlsRow.className = 'media-controls-row';
  ctrls.appendChild(ctrlsRow);
  // Helper: build a group container
  function _makeGroup(extraClass) {
    const g = document.createElement('div');
    g.className = 'media-controls-group' + (extraClass ? ' ' + extraClass : '');
    return g;
  }
  // Helper: build a thin vertical separator
  function _makeSep() {
    const s = document.createElement('div');
    s.className = 'media-controls-sep';
    return s;
  }

  // ── LEFT GROUP: play + draw ──
  const leftGroup = _makeGroup();
  // Play / pause button
  const btn = document.createElement('div');
  btn.className = 'media-play-btn';
  btn.innerHTML = isVideo ? '&#9654;' : '&#127902;&#65039;';
  leftGroup.appendChild(btn);

  // Draw / annotate button (video only). Sits right next to the play button
  // for muscle-memory parity with screenshot tools (cmd+shift+4, Snip,
  // Discord, Slack, etc. all put the markup tool adjacent to capture).
  // Toggles the annotation canvas overlay on the video frame.
  // (Declaration hoisted near the top of this function with the other
  // annotation locals; the assignment below gives it a real element.)
  if (isVideo) {
    drawBtn = document.createElement('div');
    drawBtn.className = 'media-draw-btn';
    drawBtn.innerHTML = '&#9998;&#65039;'; // ✏️
    drawBtn.title = 'Draw on the frame (D) — arrows / freehand annotations saved with the next comment';
    leftGroup.appendChild(drawBtn);
    // Draw button click — toggle draw mode (off → arrow → pen → off).
    // Wired up here (instead of in the earlier annotation-toolbar block)
    // because `drawBtn` only exists from this point onward.
    drawBtn.addEventListener('mousedown', function(ev) { ev.stopPropagation(); ev.preventDefault(); });
    drawBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      // Round 7: clicking the draw button (✏️ on the controls bar) now
      // goes DIRECTLY to pen mode, not arrow. Matches the D key
      // shortcut. Subsequent clicks toggle off.
      const s = el._annoDrawState;
      s.mode = (s.mode === 'off') ? 'pen' : 'off';
      _applyDrawMode();
    });
    // Initial badge state (must run after the button element exists).
    _refreshDrawBtnBadge();
  }
  // Commit the left group + a separator
  ctrlsRow.appendChild(leftGroup);
  ctrlsRow.appendChild(_makeSep());

  // ── CENTER GROUP: time-cur + seek bar + time-dur ──
  const centerGroup = _makeGroup('grow');

  // Current time label
  const tCur = document.createElement('span');
  tCur.className = 'media-time media-time-cur';
  tCur.textContent = '0:00';
  centerGroup.appendChild(tCur);

  // Seek bar (draggable)
  const seekBar = document.createElement('div');
  seekBar.className = 'media-seek-bar';
  const track = document.createElement('div');
  track.className = 'media-seek-track';
  const fill = document.createElement('div');
  fill.className = 'media-seek-fill';
  const thumb = document.createElement('div');
  thumb.className = 'media-seek-thumb';
  // Container for comment markers (small flags showing where comments live).
  // Built fresh whenever comments change — see refreshSeekMarkers().
  const seekMarkers = document.createElement('div');
  seekMarkers.className = 'media-seek-markers';
  // Round 10: drawing markers (cyan diamonds below the bar) for frames
  // that have strokes. One diamond per frame with strokes.
  const seekDrawMarkers = document.createElement('div');
  seekDrawMarkers.className = 'media-seek-draw-markers';
  // Round 12: text markers (green squares on the bar) for frames
  // that have text annotations. Distinct shape + color from the
  // amber comment flags and the cyan draw diamonds.
  const seekTextMarkers = document.createElement('div');
  seekTextMarkers.className = 'media-seek-text-markers';
  track.appendChild(fill);
  track.appendChild(thumb);
  track.appendChild(seekMarkers);
  track.appendChild(seekTextMarkers);
  track.appendChild(seekDrawMarkers);
  // Round 17: trim handles on the MAIN seek bar.
  // Two draggable handles (left + right) plus two dimmed overlays
  // covering the trimmed-out regions. Distinct from the existing
  // property-panel trim row (which is still there) — these sit
  // directly on the main timeline so the user can see + adjust
  // trim without expanding a second row.
  const mainTrimStartHandle = document.createElement('div');
  mainTrimStartHandle.className = 'trim-handle trim-handle-start';
  mainTrimStartHandle.title = 'Drag to set trim start';
  const mainTrimEndHandle = document.createElement('div');
  mainTrimEndHandle.className = 'trim-handle trim-handle-end';
  mainTrimEndHandle.title = 'Drag to set trim end';
  const mainTrimLeftOverlay = document.createElement('div');
  mainTrimLeftOverlay.className = 'trim-overlay trim-overlay-left';
  const mainTrimRightOverlay = document.createElement('div');
  mainTrimRightOverlay.className = 'trim-overlay trim-overlay-right';
  track.appendChild(mainTrimLeftOverlay);
  track.appendChild(mainTrimRightOverlay);
  track.appendChild(mainTrimStartHandle);
  track.appendChild(mainTrimEndHandle);
  seekBar.appendChild(track);
  // Round 48: hover/drag tooltip showing frame number + time at the
  // cursor's X position. Two lines (frame on top in accent purple, time
  // below in white) so both are readable at a glance. Positioned inside
  // seekBar (which is `position: relative` per CSS) and clamped
  // horizontally in JS so it never overflows the bar's edges.
  const seekTooltip = document.createElement('div');
  seekTooltip.className = 'media-seek-tooltip';
  seekTooltip.innerHTML = '<span class="tt-frame">F 0</span><span class="tt-time">0:00.00</span>';
  seekBar.appendChild(seekTooltip);
  // Round 58: playhead-position label. Follows the actual video playhead
  // (the front of the fill bar) rather than the cursor. Shows during
  // playback, drag, and whenever the video is the selected/active item.
  // Single-line compact format (F 1234 · 0:41.20) so it doesn't visually
  // fight the hover tooltip on drag. Hidden by default, toggled via
  // .show class by the play/pause listeners and updateSeekUI.
  // Video-only: GIFs don't have a meaningful playhead (the <img> just
  // auto-loops, no seek), and adding the label there would show
  // "F 0 · 0:00.00" forever, which is misleading.
  const playheadLabel = isVideo ? document.createElement('div') : null;
  if (playheadLabel) {
    playheadLabel.className = 'media-playhead-label';
    playheadLabel.innerHTML = '<span class="pl-frame">F 0</span><span class="pl-sep">·</span><span class="pl-time">0:00.00</span>';
    seekBar.appendChild(playheadLabel);
  }
  centerGroup.appendChild(seekBar);

  // Duration label
  const tDur = document.createElement('span');
  tDur.className = 'media-time media-time-dur';
  tDur.textContent = '0:00';
  centerGroup.appendChild(tDur);
  // Commit the center group + a separator
  ctrlsRow.appendChild(centerGroup);
  ctrlsRow.appendChild(_makeSep());

  // Volume control (video)
  const mVolWrap = document.createElement('div');
  mVolWrap.className = 'media-volume-wrap';
  const mVolBtn = document.createElement('button');
  mVolBtn.className = 'media-volume-btn';
  mVolBtn.innerHTML = '&#128264;';
  mVolBtn.title = 'Volume';
  const mVolPop = document.createElement('div');
  mVolPop.className = 'media-volume-popover';
  const mVolSlider = document.createElement('input');
  mVolSlider.type = 'range'; mVolSlider.min = '0'; mVolSlider.max = '1'; mVolSlider.step = '0.01';
  mVolSlider.value = String(mediaEl.volume);
  mVolSlider.className = 'media-volume-slider';
  const mVolLabel = document.createElement('span');
  mVolLabel.className = 'media-volume-label';
  mVolLabel.textContent = Math.round(mediaEl.volume * 100) + '%';
  mVolSlider.addEventListener('input', function() {
    mediaEl.volume = parseFloat(mVolSlider.value);
    mediaEl.muted = false;
    mVolLabel.textContent = Math.round(mediaEl.volume * 100) + '%';
    mVolBtn.innerHTML = mediaEl.volume === 0 ? '&#128263;' : '&#128264;';
  });
  mVolBtn.addEventListener('click', function(ev) {
    ev.stopPropagation();
    if (mediaEl.volume > 0) { mediaEl.volume = 0; mVolSlider.value = '0'; mVolBtn.innerHTML = '&#128263;'; }
    else { mediaEl.volume = 0.7; mVolSlider.value = '0.7'; mVolBtn.innerHTML = '&#128264;'; }
    mVolLabel.textContent = Math.round(mediaEl.volume * 100) + '%';
  });
  mediaEl.addEventListener('volumechange', function() {
    mVolSlider.value = String(mediaEl.volume);
    mVolLabel.textContent = Math.round(mediaEl.volume * 100) + '%';
    mVolBtn.innerHTML = mediaEl.volume === 0 || mediaEl.muted ? '&#128263;' : '&#128264;';
  });
  mVolPop.appendChild(mVolSlider);
  mVolPop.appendChild(mVolLabel);
  mVolWrap.appendChild(mVolBtn);
  mVolWrap.appendChild(mVolPop);

  // ── RIGHT GROUP: comments button + snap + volume ──
  // R51: the on-video comments FAB is GONE. The comments button now
  // lives here, in the utility group, alongside the volume control.
  // Click handler + popover positioning all still reference
  // `commentsFab` (the variable was kept for backward compat), so the
  // only changes here are (a) the class (media-comments-btn) and
  // (b) the append location (right group, not wrap).
  const rightGroup = _makeGroup();
  // Comments button (was: floating pill on the video)
  rightGroup.appendChild(commentsFab);
  // ── Snap button: batch-capture all stroked frames (same as popover Snap) ──
  const playerSnapBtn = document.createElement('div');
  playerSnapBtn.className = 'media-snap-btn';
  playerSnapBtn.innerHTML = '&#9636;&#65039;<span class="btn-label"> Snap</span>'; // ▤️ Snap
  playerSnapBtn.title = 'Snap all annotated frames — batch-capture every frame that has draw/text strokes as a frame comment';
  playerSnapBtn.addEventListener('mousedown', function(ev) { ev.stopPropagation(); ev.preventDefault(); });
  playerSnapBtn.addEventListener('click', async function(ev) {
    ev.stopPropagation(); ev.preventDefault();
    const itm = _getItem();
    if (!itm || !itm.video) { toast('Video not ready'); return; }
    const drawState = itm.el._annoDrawState;
    const hasStrokes = drawState && drawState.strokesByFrame && Object.keys(drawState.strokesByFrame).some(function(f) { return (drawState.strokesByFrame[f] || []).length > 0; });
    if (!hasStrokes) {
      // No strokes → snap just the current frame
      const fps = (typeof getCurrentFps === 'function') ? getCurrentFps() : (itm.video._kraftedFps || 30);
      const frame = Math.max(0, Math.floor((itm.video.currentTime || 0) * fps));
      var snapshot = '';
      try { snapshot = videoAnnoCaptureSnapshot(itm.video, 0, []); } catch(e) {}
      const anno = videoAnnoEnsure(itm);
      pushUndo();
      anno.comments.push({
        id: 'c-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        frame: frame, time: itm.video.currentTime || 0, text: '',
        translation: '', translationDir: '', createdAt: Date.now(),
        snapshot: snapshot, annoStrokes: [],
      });
      anno.comments.sort(function(a,b) { return (a.frame || 0) - (b.frame || 0); });
      scheduleAutoSave();
      videoAnnoRefreshCommentList(itm);
      try { toast('Snapped f ' + frame); } catch(e) {}
      return;
    }
    // Has strokes → batch-capture all stroked frames (same as popover Snap)
    const anno2 = videoAnnoEnsure(itm);
    const fps2 = (typeof getCurrentFps === 'function') ? getCurrentFps() : (mediaEl._kraftedFps || 30);
    const framesWithStrokes = Object.keys(drawState.strokesByFrame)
      .map(Number)
      .filter(function(f){ return (drawState.strokesByFrame[f] || []).length > 0; })
      .sort(function(a,b){ return a - b; });
    if (!framesWithStrokes.length) { toast('No strokes on any frame'); return; }
    var existingFrames = new Set((anno2.comments || []).map(function(c){ return c.frame; }));
    var newFrames = framesWithStrokes.filter(function(f){ return !existingFrames.has(f); });
    if (!newFrames.length) {
      toast('All ' + framesWithStrokes.length + ' stroked frames already have comments');
      return;
    }
    playerSnapBtn.style.opacity = '0.4';
    var origTime = mediaEl.currentTime;
    pushUndo();
    var SNAP_W = 0, snapped = 0;
    for (var i = 0; i < newFrames.length; i++) {
      var frame2 = newFrames[i];
      var targetTime = Math.max(0, Math.min(mediaEl.duration || 0, frame2 / fps2));
      mediaEl.currentTime = targetTime;
      await new Promise(function(resolve){
        function onSeeked(){
          mediaEl.removeEventListener('seeked', onSeeked);
          resolve();
        }
        mediaEl.addEventListener('seeked', onSeeked);
        setTimeout(function(){ mediaEl.removeEventListener('seeked', onSeeked); resolve(); }, 3000);
      });
      var strokes2 = drawState.strokesByFrame[frame2] || [];
      var snapshot2 = '';
      try { snapshot2 = videoAnnoCaptureSnapshot(mediaEl, SNAP_W, strokes2); } catch(e){}
      anno2.comments.push({
        id: 'c-' + Date.now() + '-' + Math.floor(Math.random() * 1000) + '-' + i,
        frame: frame2, time: targetTime, text: '',
        translation: '', translationDir: '', createdAt: Date.now(),
        snapshot: snapshot2,
        annoStrokes: strokes2.map(function(s){
          return { type: s.type, color: s.color, size: s.size,
            points: (s.points || []).map(function(p){ return [p[0], p[1]]; }),
            text: s.text || '' };
        }),
      });
      snapped++;
      if (snapped % 5 === 0 || i === newFrames.length - 1) {
        toast('Snapped ' + snapped + '/' + newFrames.length + ' frames…');
      }
    }
    anno2.comments.sort(function(a,b){ return (a.frame || 0) - (b.frame || 0); });
    scheduleAutoSave();
    videoAnnoRefreshCommentList(itm);
    mediaEl.currentTime = origTime;
    playerSnapBtn.style.opacity = '';
    var skipped = framesWithStrokes.length - newFrames.length;
    // Auto-open the comment panel after player-bar Snap so the user can
    // immediately see the new comments without clicking 💬 separately.
    // The popover Snap button (snapBtn below) does NOT auto-open because
    // the panel is already open when the user clicks it.
    if (commentsFab) { commentsFab.click(); }
    toast('Snapped ' + snapped + ' frame(s)' + (skipped ? ' (' + skipped + ' skipped)' : ''));
  });
  rightGroup.appendChild(playerSnapBtn);
  rightGroup.appendChild(mVolWrap);
  // ── Clean mode toggle: hides all controls for distraction-free viewing ──
  const cleanBtn = document.createElement('div');
  cleanBtn.className = 'media-clean-btn';
  cleanBtn.innerHTML = '👁';
  cleanBtn.title = 'Clean mode (H) — hide all controls for distraction-free viewing';
  cleanBtn.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
  cleanBtn.addEventListener('click', function(ev) {
    ev.stopPropagation();
    toggleCleanMode();
  });
  rightGroup.appendChild(cleanBtn);
  // ── Fullscreen toggle ──
  const fsBtn = document.createElement('div');
  fsBtn.className = 'media-fullscreen-btn';
  // F is reserved for center/frame selection (global hotkey). The player
  // fullscreen button has no hotkey — use Shift+F for app fullscreen,
  // or click this button to fullscreen the player only.
  fsBtn.title = 'Player Fullscreen';
  // SVG expand icon — same as the toolbar fullscreen button
  fsBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v4M3 3h4M3 3l4 4M13 13v-4M13 13H9M13 13l-4-4"/></svg>';
  fsBtn.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
  fsBtn.addEventListener('click', function(ev) {
    ev.stopPropagation();
    // Request fullscreen on the media-wrap container so only the
    // video player fills the screen (not the entire app).
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      if (document.exitFullscreen) { document.exitFullscreen(); }
      else if (document.webkitExitFullscreen) { document.webkitExitFullscreen(); }
    } else {
      if (wrap.requestFullscreen) { wrap.requestFullscreen(); }
      else if (wrap.webkitRequestFullscreen) { wrap.webkitRequestFullscreen(); }
    }
  });
  rightGroup.appendChild(fsBtn);

  // v5.5.1: double-click video frame → toggle fullscreen
  if (isVideo && !isGif) {
    wrap.addEventListener('dblclick', function(ev) {
      // Don't toggle if clicking on annotation canvas or controls
      if (ev.target.closest && (ev.target.closest('canvas') || ev.target.closest('.media-anno-toolbar') || ev.target.closest('.media-comments-popover'))) return;
      ev.stopPropagation();
      ev.preventDefault();
      var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl) {
        if (document.exitFullscreen) { document.exitFullscreen(); }
        else if (document.webkitExitFullscreen) { document.webkitExitFullscreen(); }
      } else {
        if (wrap.requestFullscreen) { wrap.requestFullscreen(); }
        else if (wrap.webkitRequestFullscreen) { wrap.webkitRequestFullscreen(); }
      }
    });
  }

  // Sync the button icon on fullscreen change
  function _syncFsIcon() {
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    var svg = fsBtn.querySelector('svg');
    if (fsEl) {
      // Collapse icon — exit fullscreen
      if (svg) svg.innerHTML = '<path d="M5 3v3M5 3H2M5 3L2 6M11 13v-3M11 13h3M11 13l3-3"/>';
      fsBtn.title = 'Exit Player Fullscreen (Esc)';
    } else {
      // Expand icon — enter fullscreen
      if (svg) svg.innerHTML = '<path d="M3 3v4M3 3h4M3 3l4 4M13 13v-4M13 13H9M13 13l-4-4"/>';
      fsBtn.title = 'Player Fullscreen';
    }
  }
  document.addEventListener('fullscreenchange', _syncFsIcon);
  document.addEventListener('webkitfullscreenchange', _syncFsIcon);

  // ── Fullscreen floating timeline (v5.5.1) ──────────────────
  // When the player is fullscreen, a slim timeline bar auto-shows
  // when the mouse moves to the bottom ~60px of the screen. Lets
  // the user scrub through the video without exiting fullscreen.
  // Auto-hides after 1.5s of no mouse movement in the zone.
  if (isVideo && !isGif) {
    var fsTimeline = document.createElement('div');
    fsTimeline.className = 'media-fs-timeline';
    fsTimeline.innerHTML =
      '<div class="fs-tl-track">' +
        '<div class="fs-tl-fill"></div>' +
        '<div class="fs-tl-thumb"></div>' +
      '</div>' +
      '<span class="fs-tl-time">0:00 / 0:00</span>';
    wrap.appendChild(fsTimeline);

    var fsTimelineVisible = false;
    var fsTimelineTimer = null;
    var fsTimelineDragging = false;

    var fsTrack = fsTimeline.querySelector('.fs-tl-track');
    var fsFill = fsTimeline.querySelector('.fs-tl-fill');
    var fsThumb = fsTimeline.querySelector('.fs-tl-thumb');
    var fsTimeLabel = fsTimeline.querySelector('.fs-tl-time');

    function _showFsTimeline() {
      if (!fsTimelineVisible) {
        fsTimelineVisible = true;
        fsTimeline.classList.add('visible');
      }
      clearTimeout(fsTimelineTimer);
      fsTimelineTimer = setTimeout(_hideFsTimeline, 1500);
    }

    function _hideFsTimeline() {
      if (!fsTimelineDragging && fsTimelineVisible) {
        fsTimelineVisible = false;
        fsTimeline.classList.remove('visible');
      }
    }

    function _updateFsTimeline() {
      if (!mediaEl || !mediaEl.duration) return;
      var pct = mediaEl.duration > 0 ? (mediaEl.currentTime / mediaEl.duration) * 100 : 0;
      fsFill.style.width = pct + '%';
      fsThumb.style.left = pct + '%';
      var cur = formatTime(mediaEl.currentTime);
      var dur = formatTime(mediaEl.duration);
      fsTimeLabel.textContent = cur + ' / ' + dur;
    }

    // Seek by clicking or dragging the track
    function _fsSeekFromClientX(clientX) {
      if (!mediaEl || !mediaEl.duration) return;
      var tr = fsTrack.getBoundingClientRect();
      var pct = Math.max(0, Math.min(1, (clientX - tr.left) / tr.width));
      mediaEl.currentTime = pct * mediaEl.duration;
      _updateFsTimeline();
    }

    fsTrack.addEventListener('mousedown', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      fsTimelineDragging = true;
      _fsSeekFromClientX(ev.clientX);
    });

    document.addEventListener('mousemove', function(ev) {
      if (fsTimelineDragging) {
        _fsSeekFromClientX(ev.clientX);
      }
    });

    document.addEventListener('mouseup', function() {
      if (fsTimelineDragging) {
        fsTimelineDragging = false;
        // restart auto-hide timer after drag
        clearTimeout(fsTimelineTimer);
        fsTimelineTimer = setTimeout(_hideFsTimeline, 1500);
      }
    });

    // Show timeline when mouse is near the bottom of the wrap
    wrap.addEventListener('mousemove', function(ev) {
      var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl !== wrap) return; // only in fullscreen
      var wr = wrap.getBoundingClientRect();
      var bottomZone = wr.bottom - 60; // bottom 60px
      if (ev.clientY >= bottomZone) {
        _showFsTimeline();
      } else if (fsTimelineVisible && !fsTimelineDragging) {
        // Mouse left the zone — start hide timer
        clearTimeout(fsTimelineTimer);
        fsTimelineTimer = setTimeout(_hideFsTimeline, 800);
      }
    });

    // Update timeline position during playback
    mediaEl.addEventListener('timeupdate', function() {
      var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl === wrap && fsTimelineVisible) {
        _updateFsTimeline();
      }
    });

    // Also update on fullscreen enter
    document.addEventListener('fullscreenchange', function() {
      var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl === wrap) {
        _updateFsTimeline();
      } else {
        _hideFsTimeline();
      }
    });
    document.addEventListener('webkitfullscreenchange', function() {
      var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl === wrap) {
        _updateFsTimeline();
      } else {
        _hideFsTimeline();
      }
    });
  }

  // Clean mode exit notice — sits in the empty controls-bar area below
  // the player when clean mode is on (NOT overlaying the video).
  const cleanExit = document.createElement('div');
  cleanExit.className = 'media-clean-exit';
  cleanExit.innerHTML = '<span>Press <span class="clean-exit-key">H</span> or click to exit clean mode</span>';
  cleanExit.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
  cleanExit.addEventListener('click', function(ev) {
    ev.stopPropagation();
    toggleCleanMode();
  });
  // Clean mode exit pill — placed in the *item* (NOT inside .media-wrap)
  // so it sits in the empty controls-bar area below the video when the
  // controls are hidden. CSS hides it by default (display:none) and
  // shows it (display:flex) only when .clean-mode is active.
  el.appendChild(cleanExit);
  // Toggle function — shows/hides controls and the exit overlay
  function toggleCleanMode() {
    const wasClean = el.classList.contains('clean-mode');
    // Exit draw mode if active (incompatible with clean mode)
    if (!wasClean && el._annoDrawState && el._annoDrawState.mode !== 'off') {
      el._annoDrawState.mode = 'off'; _applyDrawMode();
    }
    el.classList.toggle('clean-mode');
    const isClean = el.classList.contains('clean-mode');
    cleanBtn.classList.toggle('active', isClean);
    cleanBtn.innerHTML = isClean ? '👁' : '👁';
    cleanBtn.title = isClean ? 'Exit clean mode (H)' : 'Clean mode (H) — hide all controls for distraction-free viewing';
    // When exiting clean mode, re-show controls and re-sync
    if (!isClean) {
      try { updateSeekUI(); } catch (e) {}
      if (drawBtn) { try { _refreshDrawBtnBadge(); } catch (e) {} }
    }
  }
  // Also expose on el so keyboard handler can reach it
  el._toggleCleanMode = toggleCleanMode;
  // Click on the video area (media-wrap) also exits clean mode
  if (isVideo) {
    wrap.addEventListener('click', function(ev) {
      if (el.classList.contains('clean-mode')) {
        ev.stopPropagation();
        toggleCleanMode();
      }
    });
    wrap.addEventListener('dblclick', function(ev) {
      if (el.classList.contains('clean-mode')) {
        ev.stopPropagation();
        toggleCleanMode();
      }
    });
  }
  ctrlsRow.appendChild(rightGroup);

  // ── Responsive compact mode: when the player is narrow, the seek
  // bar gets squeezed and its time labels / playhead marker can visually
  // collide with the Comments/Snap buttons on the right. Fix: once the
  // controls row drops below a width threshold, add `.compact` which
  // hides the text labels on the comments/snap buttons (icon-only),
  // freeing up horizontal space so nothing overlaps.
  if (typeof ResizeObserver !== 'undefined') {
    const _ctrlsRO = new ResizeObserver(function(entries) {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        ctrlsRow.classList.toggle('compact', w < 420);
      }
    });
    _ctrlsRO.observe(ctrlsRow);
  }

  // ── (Stage B: comment buttons REMOVED from the control bar) ──
  // The user asked to remove the two buttons ("💬 Add" + "🗨 list"). They
  // are replaced by:
  //   1. A single "Comments" button in the right utility group of the
  //      controls bar (Round 51: was a floating pill on the video
  //      wrap, but the user reported it overlapping the video).
  //   2. A keyboard shortcut: 'C' to add a comment at the current frame,
  //      'M'/'L' to toggle the list popover. See the keydown listener
  //      further down.
  // The list popover itself contains an inline add input at the top, so
  // the user can add comments without ever opening a separate popover.

  // ── Trackpad two-finger swipe (MacBook / Magic Trackpad logic) ──
  // On macOS, two-finger horizontal swipe on the trackpad fires a
  // `wheel` event with non-zero `deltaX` and ~0 `deltaY`. We map this to
  // `currentTime` so swiping the trackpad left/right scrubs the video —
  // the same gesture macOS QuickTime / IINA use.
  //
  // Sensitivity: a single casual swipe is usually 30–80px of accumulated
  // deltaX. We treat ~6px of deltaX as "1 frame" so a moderate swipe
  // moves ~5–15 frames (matching QuickTime's feel on a real trackpad).
  //
  // We also call preventDefault to stop the page from scrolling when the
  // user is scrubbing over the video.
  if (isVideo) {
    let _swipeActive = false;     // true while a horizontal scrub gesture is in progress
    let _swipeEndTimer = null;    // timeout id for ending the gesture after finger lift
    let _scrubRafId = null;       // rAF id for batching DOM updates during scrub
    // Round 64: Mac-only two-finger scrub — Two-fix rollout (v5.3).
    //   Fix 1 — Per-event synchronous seek: each wheel event directly
    //     sets mediaEl.currentTime (no accumulation), giving real-time
    //     visual feedback as the user drags their fingers.
    //   Fix 2 — preventDefault at TOP of handler: stops the browser
    //     from panning/translating the player during two-finger gestures.
    //   - macOS trackpad:  two-finger drag → scrub frames  (deltaX scrub)
    //                      pinch (ctrl+wheel) → zoom  (let it bubble)
    //   - Windows mouse:  wheel → zoom  (let it bubble to canvas)

    // R79: use Platform registry instead of inline UA sniffing
    const _isMac = !!(window.Platform && window.Platform.mac);

    // rAF-batched DOM sync — runs once per animation frame, cheaply
    // updates the fill bar, time label, thumb position and playhead
    // label so the UI stays in sync with the video frame without
    // forcing costly reflows during the gesture loop.
    function _scrubUpdateDom() {
      _scrubRafId = null;
      var d = mediaEl.duration;
      if (!d || !isFinite(d)) return;
      var t = mediaEl.currentTime;
      var pct = t / d;
      if (fill) fill.style.width = (pct * 100) + '%';
      if (tCur) tCur.textContent = fmt(t);
      if (typeof updatePlayheadLabel === 'function') updatePlayheadLabel(pct);
      if (thumb) thumb.style.left = (pct * 100) + '%';
    }

    wrap.addEventListener('wheel', function(ev) {
      // Always prevent the browser from handling wheel events over the
      // player — otherwise two-finger trackpad gestures translate/pan
      // the player viewport instead of scrubbing the video.
      ev.preventDefault();
      ev.stopPropagation();

      if (!_isMac) return;
      if (ev.ctrlKey) return;
      var absX = Math.abs(ev.deltaX);
      var absY = Math.abs(ev.deltaY);
      if (absX < 2 && absY > 0) return;

      if (_swipeActive) {
        clearTimeout(_swipeEndTimer);
        _swipeEndTimer = setTimeout(function() { _swipeActive = false; }, 180);
        if (absX < 0.2 || !mediaEl.duration || !isFinite(mediaEl.duration)) return;
      } else {
        if (absX < 1.6) return;
        if (absY > absX * 2.8) return;
        if (!mediaEl.duration || !isFinite(mediaEl.duration)) return;
        _swipeActive = true;
        clearTimeout(_swipeEndTimer);
        _swipeEndTimer = setTimeout(function() { _swipeActive = false; }, 180);
      }

      if (!mediaEl.duration || !isFinite(mediaEl.duration)) return;

      // Per-event seek: each wheel event directly moves the playhead.
      // 6px of deltaX = 1 frame, converted to seconds via FPS.
      // Negative deltaX = swipe left = scrub backwards.
      var fps = getFps();
      var secondsDelta = (ev.deltaX / 6) / fps;

      var _itm = _getItem();
      var ts = (_itm && typeof _itm.trimStart === 'number') ? _itm.trimStart : 0;
      var te = (_itm && typeof _itm.trimEnd === 'number') ? _itm.trimEnd : (mediaEl.duration || 0);
      var lo = Math.min(ts, te);
      var hi = Math.max(ts, te, mediaEl.duration || 0);
      var newT = Math.max(lo, Math.min(hi, (mediaEl.currentTime || 0) - secondsDelta));

      // Synchronous currentTime assignment — the browser seeks and
      // paints the new frame immediately, giving real-time visual
      // feedback as the user drags their fingers.
      mediaEl.currentTime = newT;

      // Batch DOM updates via rAF — cheap, at most once per frame
      if (!_scrubRafId) {
        _scrubRafId = requestAnimationFrame(_scrubUpdateDom);
      }
    }, { passive: false });
  }

  // ── Trim mini-timeline row (second row, inside player) ──
  // Build: [start label] [trim mini-bar with playhead + start/end handles] [end label] [Reset]
  const trimRow = document.createElement('div');
  trimRow.className = 'media-trim-row';
  const trimStartInfo = document.createElement('span');
  trimStartInfo.className = 'media-trim-info start';
  trimStartInfo.textContent = '0:00';
  const trimMini = document.createElement('div');
  trimMini.className = 'media-trim-mini';
  const trimRegion = document.createElement('div');
  trimRegion.className = 'trim-region';
  const trimPlayheadEl = document.createElement('div');
  trimPlayheadEl.className = 'trim-playhead';
  const trimStartHandle = document.createElement('div');
  trimStartHandle.className = 'trim-handle trim-handle-start';
  trimStartHandle.title = 'Trim start';
  const trimEndHandle = document.createElement('div');
  trimEndHandle.className = 'trim-handle trim-handle-end';
  trimEndHandle.title = 'Trim end';
  // Add tick marks every 10% so users can see the scale
  for (var ti = 1; ti < 10; ti++) {
    const tick = document.createElement('div');
    tick.className = 'trim-tick';
    tick.style.left = (ti * 10) + '%';
    trimMini.appendChild(tick);
  }
  trimMini.appendChild(trimRegion);
  trimMini.appendChild(trimPlayheadEl);
  trimMini.appendChild(trimStartHandle);
  trimMini.appendChild(trimEndHandle);
  const trimEndInfo = document.createElement('span');
  trimEndInfo.className = 'media-trim-info end';
  trimEndInfo.textContent = '0:00';
  const trimResetBtn = document.createElement('button');
  trimResetBtn.className = 'media-trim-reset';
  trimResetBtn.textContent = '↺';
  trimResetBtn.title = 'Reset trim';
  trimRow.appendChild(trimStartInfo);
  trimRow.appendChild(trimMini);
  trimRow.appendChild(trimEndInfo);
  trimRow.appendChild(trimResetBtn);
  ctrls.appendChild(trimRow);

  // Hide the trim row for non-video (audio / GIF) since trimming semantics differ
  if (!isVideo) trimRow.style.display = 'none';

  // Round 20: keyboard shortcuts for trim. 'i' sets the trim
  // START to the current playhead, 'o' sets the trim END. The
  // hotkeys are scoped to EITHER of the two timeline strips on
  // the mov player — they fire when the cursor is over the top
  // playback control bar (.media-seek-bar, which contains
  // .media-seek-track and its trim handles) OR the bottom
  // trim-only mini-bar (.media-trim-mini). Outside both bars
  // (e.g. over the video image, the comments FAB, the canvas,
  // or a text annotation), 'i' and 'o' are plain characters
  // that pass through to other inputs. The video is paused
  // first so the playhead can't drift during the press. The
  // corresponding handle flashes cyan for ~450ms as visual
  // confirmation.
  // Round 34: the i/o trim hotkey helpers below (_isCursorOverPlayer,
  // _flashTrimHandle, _setTrimFromHotkey) used to live here as
  // closure-locals to buildMediaControls(). They were DEAD CODE because
  // the only caller — the per-video document keydown listener — moved to
  // a single global handler. The global version lives in the main
  // keyboard dispatcher (see the main keydown listener) and looks up
  // .media-seek-bar / .media-trim-mini out of the SELECTED video's
  // item.el. Keeping these helpers here would just be misleading.
  // Round 34: i/o trim hotkey moved to a single global handler in the
  // main keyboard dispatcher. Was: per-video registration here, which
  // leaked (never removed on video delete) and raced when multiple
  // videos were on the board.

  // (DRAW FUNCTION REMOVED — the entire in-player draw toolbar is gone.
  // The frame-comments workflow is the only annotation tool now. The
  // 💬 floating pill (built earlier on the wrap) opens the list popover,
  // which contains an inline add input at the top.)

  el.appendChild(ctrls);

  // ── Stage B: UNIFIED comments popover (was: 2 separate popovers) ──
  // The user asked to:
  //   1. Remove the two control-bar buttons.
  //   2. See the comments clearly (no auto-close on outside click).
  //   3. Move the window freely.
  //   4. Edit comments.
  //   5. Export to a supplier (with frame # + snapshot).
  //
  // We collapse the previous "Add" + "List" popovers into a SINGLE
  // floating panel. The panel has:
  //   - a draggable head (drag-grip + title + count + actions)
  //   - an always-visible add-comment input at the top of the body
  //   - a scrollable list of comment cards below
  //   - a resize handle in the SE corner
  //
  // Because the buttons were removed, opening this panel is now done via:
  //   - the floating 💬 pill on the video
  //   - keyboard shortcut M (toggle) / C (add at current frame & open)
  //
  // The popover is appended to <body> (not the item) so it escapes the
  // item's transform stacking context — see the long comment near
  // _positionPopover for details.

  // ── Comments List popover (the unified panel) ──
  const listPopover = document.createElement('div');
  listPopover.className = 'media-anno-popover list fs-medium';
  const listHead = document.createElement('div');
  listHead.className = 'head';
  // Drag grip — visual affordance that says "this is the drag handle"
  const dragGrip = document.createElement('span');
  dragGrip.className = 'drag-grip';
  dragGrip.textContent = '⋮⋮';
  dragGrip.title = 'Drag to move';
  // Title with comment count chip
  const listHeadTitle = document.createElement('span');
  listHeadTitle.className = 'title';
  // Title is the original file name (with extension) + a small "Comments" label.
  // Helps the user confirm which video they're annotating — especially when
  // multiple videos are on the board. Falls back to "Comments" if no file name.
  const listHeadFile = document.createElement('span');
  listHeadFile.className = 'title-file';
  listHeadFile.title = 'Original video file name';
  const listHeadFileName = document.createElement('span');
  listHeadFileName.className = 'title-file-name';
  const listHeadFileExt = document.createElement('span');
  listHeadFileExt.className = 'title-file-ext';
  listHeadFile.appendChild(listHeadFileName);
  listHeadFile.appendChild(listHeadFileExt);
  const listHeadCount = document.createElement('span');
  listHeadCount.className = 'count';
  listHeadCount.textContent = '0';
  listHeadTitle.appendChild(listHeadFile);
  listHeadTitle.appendChild(document.createTextNode(' '));
  listHeadTitle.appendChild(listHeadCount);
  // Helper: set the title to the video's file name (or fallback)
  function _updateHeadFileName() {
    try {
      const itm = _getItem();
      const fn = (itm && itm.filename) ? itm.filename : '';
      if (fn) {
        const dot = fn.lastIndexOf('.');
        const base = dot > 0 ? fn.slice(0, dot) : fn;
        const ext = dot > 0 ? fn.slice(dot) : '';
        listHeadFileName.textContent = base;
        listHeadFileExt.textContent = ext;
        listHeadFile.style.display = '';
        listHeadFile.title = fn;
      } else {
        listHeadFile.style.display = 'none';
      }
    } catch (e) {
      listHeadFile.style.display = 'none';
    }
  }
  // Font size toggle (S / M / L) — small, inline
  const fsToggle = document.createElement('span');
  fsToggle.className = 'font-size-toggle';
  const fsBtns = [
    { cls: 'fs-s', label: 'S', size: 'fs-small' },
    { cls: 'fs-m', label: 'M', size: 'fs-medium' },
    { cls: 'fs-l', label: 'L', size: 'fs-large' },
  ];
  fsBtns.forEach(spec => {
    const b = document.createElement('button');
    b.className = spec.cls;
    b.textContent = spec.label;
    b.title = 'Comment text size: ' + spec.label;
    if (spec.size === 'fs-medium') b.classList.add('active');
    b.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
    b.addEventListener('click', function(ev){
      ev.stopPropagation();
      fsToggle.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      listPopover.classList.remove('fs-small', 'fs-medium', 'fs-large');
      listPopover.classList.add(spec.size);
    });
    fsToggle.appendChild(b);
  });
  // Round 30: "minimize all" toggle — hides every snapshot thumbnail
  // in the list, leaving just the frame chip + time + text. Compact
  // mode for scanning many comments. State lives on the popover (each
  // video owns its own popover, so toggling is naturally per-video).
  const minimizeBtn = document.createElement('button');
  minimizeBtn.className = 'head-btn min-shots-btn';
  minimizeBtn.innerHTML = '🖼';
  minimizeBtn.title = 'Hide / show snapshot thumbnails on every comment card';
  minimizeBtn.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
  minimizeBtn.addEventListener('click', function(ev){
    ev.stopPropagation();
    const isMin = listPopover.classList.toggle('minimized');
    minimizeBtn.classList.toggle('active', isMin);
    minimizeBtn.title = isMin
      ? 'Show snapshot thumbnails'
      : 'Hide snapshot thumbnails (compact view — frame + text only)';
    // Re-compute the popover height to match the new card size, unless
    // the user has manually moved/resized it (then keep their size).
    try {
      if (listPopover.classList.contains('open')) {
        _positionPopover(listPopover, commentsFab);
      }
    } catch (e) {}
  });
  // Round 31: "📌 Follow" toggle — re-attach the popover to the video
  // after the user has dragged or resized it. The button is only
  // visible when the popover is currently detached; clicking it clears
  // the moved/resized flags and snaps the popover back to the video.
  const followBtn = document.createElement('button');
  followBtn.className = 'head-btn follow-player-btn hidden';
  followBtn.innerHTML = '📌 Follow';
  followBtn.title = 'Snap the popover back to the video (re-enable follow)';
  followBtn.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
  followBtn.addEventListener('click', function(ev){
    ev.stopPropagation(); ev.preventDefault();
    el._userMovedPopover = false;
    el._userResizedPopover = false;
    try {
      if (listPopover.classList.contains('open')) {
        _positionPopover(listPopover, commentsFab);
        try { toast('Following video'); } catch (e) {}
      }
    } catch (e) {}
    _syncFollowBtn();
  });
  // Update the follow button's visibility + label to match the current
  // detach state. Called after every drag/resize end and after the
  // button itself is clicked.
  function _syncFollowBtn() {
    const detached = !!(el._userMovedPopover || el._userResizedPopover);
    if (detached) {
      followBtn.classList.remove('hidden');
      followBtn.classList.add('detached');
    } else {
      followBtn.classList.add('hidden');
      followBtn.classList.remove('detached');
    }
  }
  // Round 5: "Show draw toolbar" button — only visible when the toolbar
  // is currently hidden. Clicking brings the toolbar back AND enters
  // pen draw mode (Round 19: toolbar visibility is now tied to draw
  // mode, so we set the mode here). State persists per video.
  const showToolbarBtn = document.createElement('button');
  showToolbarBtn.className = 'head-btn show-toolbar-btn';
  showToolbarBtn.innerHTML = '🖌';
  showToolbarBtn.title = 'Show the draw toolbar and start drawing (or press Ctrl+D / the draw button)';
  showToolbarBtn.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
  showToolbarBtn.addEventListener('click', function(ev){
    ev.stopPropagation(); ev.preventDefault();
    const itm = _getItem();
    if (!itm) return;
    const ann = videoAnnoEnsure(itm);
    ann.drawToolbarHidden = false;
    // Round 19: also enter pen draw mode so the toolbar + draw mode
    // come up together. If the user just wants the toolbar without
    // drawing they can press Ctrl+D / the draw button again to leave draw
    // mode, but per the new spec the toolbar = draw mode anyway.
    try {
      if (el._annoDrawState) {
        el._annoDrawState.mode = 'pen';
        if (typeof _applyDrawMode === 'function') _applyDrawMode();
      }
    } catch (e) {}
    try { annoToolbar.classList.remove('toolbar-hidden'); } catch (e) {}
    try { showToolbarBtn.classList.add('hidden'); } catch (e) {}
    try { scheduleAutoSave(); } catch (e) {}
    try { toast('Draw mode on — click ✕ or the draw button to hide'); } catch (e) {}
  });
  // Round 5: "Translate all → 中" button — translates EVERY comment in
  // the list to Chinese (or back to English if already Chinese) at once.
  // Skips comments that already have a translation, but the user can clear
  // them individually first if they want a fresh translation. Sequential
  // calls (not parallel) to avoid hammering the translation API.
  const translateAllBtn = document.createElement('button');
  translateAllBtn.className = 'head-btn bulk-translate';
  translateAllBtn.innerHTML = '🌐→中 All';
  translateAllBtn.title = 'Translate every comment to the other language at once (sequential, ~1s per comment)';
  translateAllBtn.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
  translateAllBtn.addEventListener('click', async function(ev){
    ev.stopPropagation(); ev.preventDefault();
    const itm = _getItem();
    if (!itm) return;
    const ann = videoAnnoEnsure(itm);
    const list = Array.isArray(ann.comments) ? ann.comments : [];
    if (list.length === 0) { try { toast('No comments to translate'); } catch (e) {} return; }
    // Filter to comments that need translation (have text, no current translation
    // OR a translation that matches the source language — i.e. stale)
    const toTranslate = list.filter(c => {
      if (!c || !c.text) return false;
      // Skip if translation matches text (no-op)
      if (c.translation && c.translation === c.text) return false;
      return true;
    });
    if (toTranslate.length === 0) { try { toast('All comments already have a translation'); } catch (e) {} return; }
    // Confirm with the user (so they don't accidentally trigger this on 50 comments)
    if (toTranslate.length > 1) {
      const ok = window.confirm('Translate ' + toTranslate.length + ' comments?\n(This will make ~' + toTranslate.length + ' API calls, one per comment, sequential)');
      if (!ok) return;
    }
    translateAllBtn.disabled = true;
    const origLabel = translateAllBtn.innerHTML;
    let done = 0, failed = 0;
    for (const c of toTranslate) {
      const hasCjk = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(c.text);
      const fromLang = hasCjk ? 'zh' : 'en';
      const toLang = hasCjk ? 'en' : 'zh';
      translateAllBtn.innerHTML = '🌐→中 ' + (done + 1) + '/' + toTranslate.length;
      try {
        const translated = await translateText(c.text, fromLang, toLang);
        if (translated && translated !== c.text) {
          c.translation = translated;
          c.translationDir = fromLang + '-' + toLang;
          if (!c.originalText) c.originalText = c.text;
          done++;
        } else { failed++; }
      } catch (e) {
        console.warn('Bulk translate failed for comment', c.id, e);
        failed++;
      }
    }
    try { scheduleAutoSave(); } catch (e) {}
    try { _refreshListBody(); } catch (e) {}
    try { if (item && item.el && item.el._refreshSeekMarkers) item.el._refreshSeekMarkers(); } catch (e) {}
    translateAllBtn.innerHTML = origLabel;
    translateAllBtn.disabled = false;
    try { toast('Translated ' + done + ' / ' + toTranslate.length + (failed ? ' (' + failed + ' failed)' : '')); } catch (e) {}
  });
  // Round 5: "Clear all" button — wipes all comments for this video.
  // Asks for confirmation first.
  const clearAllBtn = document.createElement('button');
  clearAllBtn.className = 'head-btn bulk-clear';
  clearAllBtn.innerHTML = '🗑 Clear';
  clearAllBtn.title = 'Delete ALL comments for this video (cannot be undone — confirmation asked)';
  clearAllBtn.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
  clearAllBtn.addEventListener('click', function(ev){
    ev.stopPropagation(); ev.preventDefault();
    const itm = _getItem();
    if (!itm) return;
    const ann = videoAnnoEnsure(itm);
    const n = (ann.comments || []).length;
    if (n === 0) { try { toast('No comments to clear'); } catch (e) {} return; }
    const ok = window.confirm('Delete all ' + n + ' comments for this video?\nThis cannot be undone.');
    if (!ok) return;
    ann.comments = [];
    try { scheduleAutoSave(); } catch (e) {}
    try { _refreshListBody(); } catch (e) {}
    try { _refreshBadges(); } catch (e) {}
    try { if (item && item.el && item.el._refreshSeekMarkers) item.el._refreshSeekMarkers(); } catch (e) {}
    try { if (item && item.el && item.el._refreshAnnoBadges) item.el._refreshAnnoBadges(); } catch (e) {}
    try { toast('Cleared all ' + n + ' comments'); } catch (e) {}
  });
  // Export button — generates a supplier-friendly HTML report
  const exportBtn = document.createElement('button');
  exportBtn.className = 'head-btn';
  exportBtn.innerHTML = '⤓ Export';
  exportBtn.title = 'Export frame comments + snapshots + over comment to HTML (uses original file name)';
  exportBtn.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
  // Round 65: "Send to Board" button — lays out every snap+text comment
  // as a 2-column storyboard on the canvas (image left, text right).
  // Round 68 redesign: each row is one image + ONE combined text box
  // (chip "f 1276 · 0:42" stacked above the comment body), and the
  // text box auto-fits its width to the actual content. The text is
  // a normal editable text item so the user can tweak wording before
  // screenshotting for the supplier. Lives right before the HTML
  // Export button because it's a CANVAS action (in-app editing),
  // while Export is a DOWNLOAD action.
  const sendToBoardBtn = document.createElement('button');
  sendToBoardBtn.className = 'head-btn';
  sendToBoardBtn.innerHTML = '📋 Board';
  sendToBoardBtn.title = 'Send every snap+text comment to the canvas as a 2-column storyboard (image left, combined time+comment text right, auto-fitted) — so you can tweak wording and screenshot for the supplier';
  sendToBoardBtn.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
  sendToBoardBtn.addEventListener('click', function(ev){
    ev.stopPropagation(); ev.preventDefault();
    // R78: commit any active inline comment edit FIRST. If the user
    // typed text in the popover list ("Click to type…") and pressed
    // the Send-to-Board button without first blurring the field, the
    // `c.text` was still empty — the board export used the stale text.
    // Force-blur every contenteditable in the popover so each one's
    // `blur` handler runs and updates the comment's `text` field.
    try {
      const pop = listPopover;
      if (pop && typeof pop.querySelectorAll === 'function') {
        const editables = pop.querySelectorAll('[contenteditable="true"]');
        editables.forEach(function(el){
          try { el.blur(); } catch (e) {}
        });
      }
    } catch (e) {}
    if (typeof videoAnnoSendToBoard === 'function') {
      videoAnnoSendToBoard();
    } else {
      toast('Send-to-board not ready yet');
    }
  });
  // Round 9: video export button — exports an .mp4 with the per-frame
  // drawings baked into the video itself. Real-time (plays through
  // the video once). Disabled if there are no drawings.
  // Round 67: WebM fallback removed. MP4 only.
  const exportVideoBtn = document.createElement('button');
  exportVideoBtn.className = 'head-btn';
  exportVideoBtn.innerHTML = '🎬 Video';
  exportVideoBtn.title = 'Export the video with per-frame drawings baked in (.mp4)';
  exportVideoBtn.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
  exportVideoBtn.addEventListener('click', function(ev){
    ev.stopPropagation(); ev.preventDefault();
    if (typeof videoAnnoExportVideo === 'function') {
      videoAnnoExportVideo();
    } else {
      toast('Video export not ready yet');
    }
  });
  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'head-btn danger';
  closeBtn.innerHTML = '✕';
  closeBtn.title = 'Close  (Esc)';
  closeBtn.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
  // Hint label
  const listHeadEsc = document.createElement('span');
  listHeadEsc.className = 'esc';
  listHeadEsc.textContent = 'drag title · Esc to close';
  // Spacer
  const headSpacer = document.createElement('span');
  headSpacer.className = 'head-spacer';
  // Compose head: grip, title, [spacer], esc, fsToggle, minimize, follow,
  // bulk-translate, clear-all, export, video-export, close.
  // (Round 32: removed the 🖌 show-toolbar / pen button per user request
  // — drawing is no longer surfaced from the comments popover. The
  // draw toolbar is still reachable via the D hotkey and the bottom
  // media-bar, but it no longer has a one-click entry inside the
  // comments window. The showToolbarBtn variable is still created
  // above (in case the user re-enables it later) but is NOT appended
  // to the head here.)
  listHead.appendChild(dragGrip);
  listHead.appendChild(listHeadTitle);
  listHead.appendChild(headSpacer);
  listHead.appendChild(listHeadEsc);
  listHead.appendChild(fsToggle);
  listHead.appendChild(minimizeBtn);
  // Round 31: 📌 Follow button (re-attach popover to video) — sits next to
  // minimize so the user can reach it without hunting. Hidden by default.
  listHead.appendChild(followBtn);
  // Round 5: bulk translate + clear all buttons sit right next to the show-toolbar button
  listHead.appendChild(translateAllBtn);
  listHead.appendChild(clearAllBtn);
  listHead.appendChild(sendToBoardBtn);
  listHead.appendChild(exportBtn);
  // Round 9: video export button — right next to the HTML export
  listHead.appendChild(exportVideoBtn);
  listHead.appendChild(closeBtn);
  listPopover.appendChild(listHead);
  // Add-comment input row — sits between the head and the list, so the
  // user can add a comment without a separate popover. The hint shows
  // the current frame so the user knows what frame the new comment will
  // attach to.
  const addInputRow = document.createElement('div');
  addInputRow.className = 'add-row';
  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.placeholder = 'Text (optional) — Enter or Add to snap…';
  addInput.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
  addInput.addEventListener('click', function(ev){ ev.stopPropagation(); });
  const addBtn = document.createElement('button');
  addBtn.className = 'add-btn';
  addBtn.textContent = 'Add';
  // R78: "Snap Strokes" button — batch-capture ALL frames that have
  // draw/text strokes as frame comments (empty text). Moved from the
  // draw toolbar into the comment panel so it lives next to the input.
  const snapBtn = document.createElement('button');
  snapBtn.className = 'snap-btn';
  snapBtn.innerHTML = '&#9636;&#65039; Snap'; // ▤️ Snap
  snapBtn.title = 'Snap all annotated frames — batch-capture every frame that has draw/text strokes as a frame comment';
  snapBtn.addEventListener('click', async function(ev){
    ev.stopPropagation(); ev.preventDefault();
    const drawState = el._annoDrawState;
    if (!drawState || !drawState.strokesByFrame || !Object.keys(drawState.strokesByFrame).length) {
      toast('No strokes to snap — draw or type on the video first');
      return;
    }
    const itm = _getItem();
    if (!itm || !itm.video) { toast('Video not ready'); return; }
    const anno = videoAnnoEnsure(itm);
    const fps = (typeof getCurrentFps === 'function') ? getCurrentFps() : (mediaEl._kraftedFps || 30);
    const framesWithStrokes = Object.keys(drawState.strokesByFrame)
      .map(Number)
      .filter(function(f){ return (drawState.strokesByFrame[f] || []).length > 0; })
      .sort(function(a,b){ return a - b; });
    if (!framesWithStrokes.length) { toast('No strokes on any frame'); return; }
    var existingFrames = new Set((anno.comments || []).map(function(c){ return c.frame; }));
    var newFrames = framesWithStrokes.filter(function(f){ return !existingFrames.has(f); });
    if (!newFrames.length) {
      toast('All ' + framesWithStrokes.length + ' stroked frames already have comments');
      return;
    }
    snapBtn.disabled = true;
    var origTime = mediaEl.currentTime;
    pushUndo();
    var SNAP_W = 0, snapped = 0; // 0 = use video native resolution
    for (var i = 0; i < newFrames.length; i++) {
      var frame = newFrames[i];
      var targetTime = Math.max(0, Math.min(mediaEl.duration || 0, frame / fps));
      mediaEl.currentTime = targetTime;
      await new Promise(function(resolve){
        function onSeeked(){
          mediaEl.removeEventListener('seeked', onSeeked);
          resolve();
        }
        mediaEl.addEventListener('seeked', onSeeked);
        setTimeout(function(){ mediaEl.removeEventListener('seeked', onSeeked); resolve(); }, 3000);
      });
      var strokes = drawState.strokesByFrame[frame] || [];
      var snapshot = '';
      try { snapshot = videoAnnoCaptureSnapshot(mediaEl, SNAP_W, strokes); } catch(e){}
      anno.comments.push({
        id: 'c-' + Date.now() + '-' + Math.floor(Math.random() * 1000) + '-' + i,
        frame: frame, time: targetTime, text: '',
        translation: '', translationDir: '', createdAt: Date.now(),
        snapshot: snapshot,
        annoStrokes: strokes.map(function(s){
          return { type: s.type, color: s.color, size: s.size,
            points: (s.points || []).map(function(p){ return [p[0], p[1]]; }),
            text: s.text || '' };
        }),
      });
      snapped++;
      if (snapped % 5 === 0 || i === newFrames.length - 1) {
        toast('Snapped ' + snapped + '/' + newFrames.length + ' frames\u2026');
      }
    }
    anno.comments.sort(function(a,b){ return (a.frame || 0) - (b.frame || 0); });
    scheduleAutoSave();
    videoAnnoRefreshCommentList(itm);
    mediaEl.currentTime = origTime;
    snapBtn.disabled = false;
    var skipped = framesWithStrokes.length - newFrames.length;
    // The popover Snap does NOT auto-open the comment panel — it's
    // already open (user clicked it from inside the popover). Only the
    // player-bar Snap button (playerSnapBtn above) auto-opens.
    toast('Snapped ' + snapped + ' frame(s)' + (skipped ? ' (' + skipped + ' already had comments, skipped)' : ''));
  });
  const addHint = document.createElement('span');
  addHint.className = 'add-hint';
  addHint.textContent = 'f —';
  addInputRow.appendChild(addInput);
  addInputRow.appendChild(addBtn);
  addInputRow.appendChild(snapBtn);
  addInputRow.appendChild(addHint);
  listPopover.appendChild(addInputRow);
  // ── "Over Comment" section ──
  // A free-form text field for an overall comment that gets included in
  // the exported HTML report (not attached to any specific frame). Lives
  // in the popover between the add-input row and the comments list so
  // the user can type/edit it any time. Persists per video on item.anno.
  const overWrap = document.createElement('div');
  overWrap.className = 'over-wrap';
  const overHead = document.createElement('div');
  overHead.className = 'over-head';
  overHead.innerHTML = '<span class="over-label">📝 (overall comment)</span>' +
    '<span class="over-hint">shown at top of export</span>';
  const overInput = document.createElement('textarea');
  overInput.className = 'over-input';
  overInput.rows = 2;
  overInput.placeholder = 'Optional — overall comment for the whole review (e.g. summary, key points, instructions)…';
  overInput.spellcheck = true;
  // Stop popover drag from triggering when interacting with the textarea
  overInput.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
  overInput.addEventListener('click', function(ev){ ev.stopPropagation(); });
  // Save on input (debounced) + on blur
  let _overSaveTimer = null;
  overInput.addEventListener('input', function(){
    if (_overSaveTimer) clearTimeout(_overSaveTimer);
    _overSaveTimer = setTimeout(_saveOver, 300);
  });
  overInput.addEventListener('blur', _saveOver);
  function _saveOver() {
    if (_overSaveTimer) { clearTimeout(_overSaveTimer); _overSaveTimer = null; }
    const itm = _getItem();
    if (!itm) return;
    const anno = videoAnnoEnsure(itm);
    const v = overInput.value;
    if ((anno.overComment || '') === v) return;
    anno.overComment = v;
    try { scheduleAutoSave(); } catch (e) {}
  }
  overWrap.appendChild(overHead);
  overWrap.appendChild(overInput);
  listPopover.appendChild(overWrap);
  // Scrollable list of comments
  const listBody = document.createElement('div');
  listBody.className = 'list-body';
  listPopover.appendChild(listBody);
  // Resize handle in the SE corner
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'resize-handle';
  resizeHandle.title = 'Drag to resize';
  listPopover.appendChild(resizeHandle);
  // Append the list popover to <body> so it escapes the item's transform
  // stacking context (see the long comment near _positionPopover for why).
  document.body.appendChild(listPopover);

  // Round 31: lifted the "user detached the popover" flags to the item
  // element (el._userMovedPopover / el._userResizedPopover) so the new
  // "📌 Follow" button in the head can reset them and snap the popover
  // back to the video. Storing on el (vs closure) is the only way external
  // code (the head button) can re-attach a detached popover.
  el._userMovedPopover = false;
  el._userResizedPopover = false;

  // Position the popover OUTSIDE the player — to the right of the video,
  // running PARALLEL to it (same vertical span). This way it looks like a
  // proper side panel and never covers the video. If the user has
  // already dragged the popover, leave it where they put it. If the
  // video has been moved into a corner and there's no room on the right,
  // flip to the LEFT. As a last resort, anchor above the open button.
  function _positionPopover(popover, anchor) {
    if (!popover || !anchor) return;
    if (el._userMovedPopover || el._userResizedPopover) return;
    // Anchor against the actual video (the .media-wrap), not the whole
    // item, so the popover runs parallel to the visible video.
    const mediaWrap = el.querySelector('.media-wrap');
    const wrapRect = mediaWrap ? mediaWrap.getBoundingClientRect() : el.getBoundingClientRect();
    const popW = popover.classList.contains('list') ? listPopover.offsetWidth : 300;
    const gap = 18;
    const rightSpace = window.innerWidth - wrapRect.right;
    const leftSpace = wrapRect.left;
    let left, top, height;
    // ── Auto-grow the popover when there are many comments ──
    // R70: rebalanced the formula to match what the user actually sees.
    // The previous constants (cardH=84, chromeH=96) were way too small —
    // a real comment card is 130-150px tall (90px thumb + 4px gap + 1-2
    // lines text at 13px/1.5 + 12px padding + 5px gap to next card), and
    // the chrome is 130-160px (head ~40 + add-row ~40 + over-wrap ~20-150
    // + padding 19 + 3 inter-section gaps 18 = ~137-260). With the old
    // numbers, 5-6 comments would compute ~520px but the real content
    // needed ~700-900px, so the popover was capped and the 4th+ cards
    // were clipped (the user reported "the window need to auto scale up
    // for showing more if i add the newone in").
    //
    // Two-mode sizing:
    //   1-2 comments: popover = player height (scales with canvas zoom —
    //      a 75px-tall player at 25% zoom gets a 100px popover, not a
    //      240px popover floating next to a tiny video)
    //   3+  comments: popover = height needed to show all cards, capped
    //      at ~92vh. Priority over player match — the user wants to see
    //      every comment without scrolling
    const _itm2 = _getItem();
    const _anno2 = _itm2 && _itm2.anno ? _itm2.anno : null;
    const _comments2 = _anno2 && Array.isArray(_anno2.comments) ? _anno2.comments : [];
    const nComments = _comments2.length;
    // Detect over-wrap state so chromeH is accurate. When the user
    // expands the overall-comment textarea, the chrome grows by ~100px.
    const _overWrap = listPopover.querySelector('.over-wrap');
    const _overCollapsed = _overWrap ? _overWrap.classList.contains('collapsed') : true;
    const _overInputH = (!_overCollapsed && _overWrap) ? Math.min(140, _overWrap.querySelector('.over-input')?.offsetHeight || 60) : 0;
    const cardH = listPopover.classList.contains('minimized') ? 56 : 140;
    const chromeH = 40 /* head */ + 40 /* add-row */ + 16 /* over-head + padding */ + _overInputH + 19 /* popover padding */ + 18 /* 3 inter-section gaps */;
    const autoHeight = (nComments * cardH) + chromeH;
    const maxH = Math.floor(window.innerHeight * 0.92);
    const minPanelH = 100;
    const videoH = Math.max(80, wrapRect.height);
    // Threshold lowered from 3 → 2 (the user said "more than two snap").
    // For ≤2 comments, follow the player; for 3+, show every card.
    if (nComments > 2) {
      height = Math.min(maxH, Math.max(minPanelH, autoHeight));
    } else {
      height = Math.max(minPanelH, videoH);
    }
    // ── Smart side selection: prefer the side with more room ──
    // The popover head contains Export + Board + Video + ✕ buttons
    // (~320px worth of chrome). A too-narrow placement clips those
    // buttons or forces the popover to overflow the viewport. When
    // both sides have room, default to RIGHT (the "side panel" UX).
    // When the right side is tight (< popW + 80px buffer so Export
    // /Board isn't clipped) but the left side has more room, flip to
    // the LEFT. The 80px buffer accounts for the popover's own head
    // chrome extending past the video edge.
    const sideBuffer = 80; // extra padding so Export/Board buttons don't clip
    const canRight = rightSpace >= popW + gap + sideBuffer;
    const canLeft  = leftSpace >= popW + gap + sideBuffer;
    if (canRight) {
      left = wrapRect.right + gap;
      top = wrapRect.top;
    } else if (canLeft) {
      left = wrapRect.left - popW - gap;
      top = wrapRect.top;
    } else if (rightSpace >= popW + gap + 8) {
      // Tight right fit — use right but without the extra buffer
      left = wrapRect.right + gap;
      top = wrapRect.top;
    } else if (leftSpace >= popW + gap + 8) {
      // Tight left fit
      left = wrapRect.left - popW - gap;
      top = wrapRect.top;
    } else {
      const aRect = anchor.getBoundingClientRect();
      left = Math.max(8, Math.min(window.innerWidth - popW - 8, aRect.left - popW / 2 + aRect.width / 2));
      const bottomOffset = (window.innerHeight - aRect.top) + 4;
      popover.style.left = left + 'px';
      popover.style.bottom = bottomOffset + 'px';
      popover.style.top = 'auto';
      popover.style.height = 'auto';
      popover.style.right = 'auto';
      return;
    }
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';
    popover.style.height = height + 'px';
    popover.style.bottom = 'auto';
    popover.style.right = 'auto';
    // Clamp vertical: keep popover within viewport, avoid the bottom media-bar
    const mediaBar = document.getElementById('media-bar');
    const barH = (mediaBar && mediaBar.classList.contains('active')) ? mediaBar.offsetHeight : 0;
    const maxBottom = window.innerHeight - barH - 8;
    const popBottom = top + height;
    if (popBottom > maxBottom) {
      popover.style.top = Math.max(8, top - (popBottom - maxBottom)) + 'px';
      // If the popover grows past the viewport bottom, clip its height
      const adjustedH = maxBottom - (top - (popBottom - maxBottom));
      if (adjustedH < 120) {
        popover.style.height = Math.max(120, Math.min(height, maxBottom - top)) + 'px';
        popover.style.top = top + 'px';
      }
    }
  }

  // ── Draggable head: mousedown on the head → start drag, mousemove
  // updates the popover's left/top, mouseup releases. The head is the
  // drag handle; the buttons inside the head (export, close, font size)
  // stopPropagation on mousedown so they don't trigger a drag. ──
  (function _setupPopoverDrag() {
    let dragging = false, offX = 0, offY = 0;
    listHead.addEventListener('mousedown', function(ev) {
      // Ignore drag if user clicked a button or input in the head
      if (ev.target.closest('button, input')) return;
      if (ev.button !== 0) return;            // left button only
      dragging = true;
      el._userMovedPopover = true;
      _syncFollowBtn();
      const rect = listPopover.getBoundingClientRect();
      offX = ev.clientX - rect.left;
      offY = ev.clientY - rect.top;
      ev.preventDefault();
      ev.stopPropagation();
      // Promote to a slightly higher z-index so the user sees it move
      listPopover.style.zIndex = '100000001';
    });
    document.addEventListener('mousemove', function(ev) {
      if (!dragging) return;
      let nx = ev.clientX - offX;
      let ny = ev.clientY - offY;
      // Clamp to viewport (keep at least the drag-grip reachable)
      const W = listPopover.offsetWidth;
      const H = listPopover.offsetHeight;
      const minOn = 60;     // keep 60px of the popover on-screen
      nx = Math.max(-W + minOn, Math.min(window.innerWidth - minOn, nx));
      ny = Math.max(0, Math.min(window.innerHeight - 28, ny));
      listPopover.style.left = nx + 'px';
      listPopover.style.top = ny + 'px';
      listPopover.style.bottom = 'auto';
      listPopover.style.right = 'auto';
      listPopover.style.height = H + 'px';
    });
    document.addEventListener('mouseup', function() {
      if (dragging) {
        dragging = false;
        // Restore the standard popover z-index
        listPopover.style.zIndex = '';
      }
    });
  })();

  // ── Resize handle (SE corner) ──
  (function _setupPopoverResize() {
    let resizing = false, startX = 0, startY = 0, startW = 0, startH = 0;
    resizeHandle.addEventListener('mousedown', function(ev) {
      if (ev.button !== 0) return;
      resizing = true;
      el._userResizedPopover = true;
      _syncFollowBtn();
      startX = ev.clientX; startY = ev.clientY;
      startW = listPopover.offsetWidth;
      startH = listPopover.offsetHeight;
      ev.preventDefault();
      ev.stopPropagation();
    });
    document.addEventListener('mousemove', function(ev) {
      if (!resizing) return;
      const dw = ev.clientX - startX;
      const dh = ev.clientY - startY;
      const newW = Math.max(280, Math.min(window.innerWidth - 40, startW + dw));
      const newH = Math.max(200, Math.min(window.innerHeight - 40, startH + dh));
      listPopover.style.width = newW + 'px';
      listPopover.style.height = newH + 'px';
      listPopover.style.left = listPopover.getBoundingClientRect().left + 'px';
      listPopover.style.top = listPopover.getBoundingClientRect().top + 'px';
      listPopover.style.bottom = 'auto';
      listPopover.style.right = 'auto';
    });
    document.addEventListener('mouseup', function() { resizing = false; });
  })();

  // Wire up the add input + button
  function _commitAdd() {
    // Round 13 fix: pass the popover's OWN item (via _getItem → el._item)
    // so the comment lands on this popover's video, not whatever video
    // happens to be selected. Without this, multi-video workflows break:
    // the user clicks Add in Video A's popover, but Video B is the
    // currently-selected item, and the comment silently goes to B.
    const ownItem = _getItem();
    if (typeof videoAnnoAddComment === 'function') {
      videoAnnoAddComment(addInput.value, ownItem);
    }
    addInput.value = '';
  }
  addBtn.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
  addBtn.addEventListener('click', function(ev){ ev.stopPropagation(); ev.preventDefault(); _commitAdd(); });
  addInput.addEventListener('keydown', function(ev){
    if (ev.key === 'Enter') {
      ev.preventDefault(); ev.stopPropagation();
      _commitAdd();
    } else if (ev.key === 'Escape') {
      ev.preventDefault(); ev.stopPropagation();
      addInput.value = '';
      addInput.blur();
    }
  });
  // Close button
  closeBtn.addEventListener('click', function(ev){
    ev.stopPropagation(); ev.preventDefault();
    _setListOpen(false);
  });
  // Export button — generated in the next step (see _exportComments below)
  exportBtn.addEventListener('click', function(ev){
    ev.stopPropagation(); ev.preventDefault();
    if (typeof videoAnnoExportComments === 'function') {
      videoAnnoExportComments();
    } else {
      toast('Export not ready yet');
    }
  });

  function _setListOpen(open) {
    listPopover.classList.toggle('open', !!open);
    commentsFab.classList.toggle('active', !!open);
    if (open) {
      // Position next to the video (unless the user has already moved it)
      _positionPopover(listPopover, commentsFab);
      // Lift the item above the right props panel
      el.style.zIndex = '99999999';
      // Refresh the comments list
      _refreshListBody();
      // Refresh the file name shown in the head
      _updateHeadFileName();
      // Round 31: re-sync the 📌 Follow button in case the popover was
      // opened with a previously-saved detach state (drag/resize flags
      // survive close → reopen because they live on the item element).
      try { _syncFollowBtn(); } catch (e) {}
      // Round 5: refresh the show-draw-toolbar button visibility based on
      // the current video's persisted state. The popover can outlive the
      // toolbar's class state, so always re-sync from anno.drawToolbarHidden.
      try {
        const _sbitm = _getItem();
        const _sbann = (_sbitm && _sbitm.anno) ? _sbitm.anno : null;
        // Round 19: tie visibility to draw mode — hidden when off.
        const _modeOff = !(el._annoDrawState && el._annoDrawState.mode && el._annoDrawState.mode !== 'off');
        const _hidden = _modeOff || (_sbann && _sbann.drawToolbarHidden);
        if (_hidden) {
          showToolbarBtn.classList.remove('hidden');
        } else {
          showToolbarBtn.classList.add('hidden');
        }
        // Also sync the actual toolbar's class (in case it drifted)
        try {
          if (annoToolbar) annoToolbar.classList.toggle('toolbar-hidden', !!_hidden);
        } catch (e) {}
      } catch (e) {}
      // Update the add-hint with the current frame
      try {
        const fps = getFps();
        const fIdx = Math.round((mediaEl.currentTime || 0) * fps);
        addHint.textContent = 'f ' + fIdx;
      } catch (e) { addHint.textContent = 'f —'; }
      // Load the over-comment value (if any) into the textarea so the
      // user can see and edit the existing comment
      try {
        const itm2 = _getItem();
        const anno2 = (itm2 && itm2.anno) ? itm2.anno : null;
        overInput.value = (anno2 && anno2.overComment) ? anno2.overComment : '';
      } catch (e) { overInput.value = ''; }
      // Focus the add input so the user can start typing immediately
      setTimeout(() => { try { addInput.focus(); } catch (e) {} }, 30);
      // Round 28.5: glue the popover to its video — follow move + scale
      _startTrackingPopover();
    } else {
      el.style.zIndex = '';
      // Round 28.5: stop tracking once the popover closes
      _stopTrackingPopover();
    }
  }

  // Round 28.5: while the popover is open, keep it glued to the video.
  // Tracks three things: (1) drag/transform on the canvas (rAF poll),
  // (2) CSS-driven resize of the .media-wrap (ResizeObserver),
  // (3) window resize + scroll (events). Per-popover closure: each
  // video's popover follows its own el, so multi-video setups don't
  // fight each other. If the user has manually moved/resized the
  // popover, _positionPopover() short-circuits and the user choice
  // is honored.
  let _popoverTrackRaf = null;
  let _popoverTrackRO = null;
  let _popoverTrackWinHandler = null;
  function _startTrackingPopover() {
    if (!listPopover.classList.contains('open')) return;
    if (_popoverTrackRaf) return; // already running
    const mediaWrap = el.querySelector('.media-wrap');
    const tick = function() {
      if (!listPopover.classList.contains('open')) {
        _popoverTrackRaf = null;
        return;
      }
      try { _positionPopover(listPopover, commentsFab); } catch (e) {}
      _popoverTrackRaf = requestAnimationFrame(tick);
    };
    _popoverTrackRaf = requestAnimationFrame(tick);
    if (mediaWrap && typeof ResizeObserver !== 'undefined') {
      try {
        _popoverTrackRO = new ResizeObserver(function() {
          if (listPopover.classList.contains('open')) {
            try { _positionPopover(listPopover, commentsFab); } catch (e) {}
          }
        });
        _popoverTrackRO.observe(mediaWrap);
      } catch (e) { _popoverTrackRO = null; }
    }
    _popoverTrackWinHandler = function() {
      if (!listPopover.classList.contains('open')) return;
      try { _positionPopover(listPopover, commentsFab); } catch (e) {}
    };
    window.addEventListener('resize', _popoverTrackWinHandler);
    window.addEventListener('scroll', _popoverTrackWinHandler, true);
  }
  function _stopTrackingPopover() {
    if (_popoverTrackRaf) {
      try { cancelAnimationFrame(_popoverTrackRaf); } catch (e) {}
      _popoverTrackRaf = null;
    }
    if (_popoverTrackRO) {
      try { _popoverTrackRO.disconnect(); } catch (e) {}
      _popoverTrackRO = null;
    }
    if (_popoverTrackWinHandler) {
      try { window.removeEventListener('resize', _popoverTrackWinHandler); } catch (e) {}
      try { window.removeEventListener('scroll', _popoverTrackWinHandler, true); } catch (e) {}
      _popoverTrackWinHandler = null;
    }
  }
  // Click on the over-comment header toggles collapse (hide textarea to save space)
  overHead.addEventListener('click', function(ev){
    overWrap.classList.toggle('collapsed');
  });
  // Expose helpers for the export flow so it can read the latest over comment
  // and the original file name. The export function may be called when the
  // popover is closed, in which case it reads from the saved state directly.
  function _getOverComment() {
    // Prefer the in-DOM textarea (most recent edit) over the saved state
    const domVal = overInput && ('value' in overInput) ? overInput.value : null;
    if (domVal != null && domVal !== '') return domVal;
    const itm = _getItem();
    const anno = (itm && itm.anno) ? itm.anno : null;
    return (anno && anno.overComment) ? anno.overComment : '';
  }
  function _getOriginalFileName() {
    const itm = _getItem();
    if (!itm) return '';
    return itm.filename || '';
  }
  // Keep the add-hint synced to the current frame while the popover is open
  // (so the user can see the frame number they're about to comment on
  // while the video is playing).
  function _refreshAddHint() {
    if (!listPopover.classList.contains('open')) return;
    try {
      const fps = getFps();
      const fIdx = Math.round((mediaEl.currentTime || 0) * fps);
      addHint.textContent = 'f ' + fIdx;
    } catch (e) {}
  }
  if (isVideo) {
    mediaEl.addEventListener('timeupdate', _refreshAddHint);
    // Round 28: keep the comment list anchored to the playhead so the
    // user can see which comment corresponds to the current frame. Each
    // popover is bound to its own mediaEl via closure, so multi-video
    // setups follow their own playhead independently.
    mediaEl.addEventListener('timeupdate', _refreshActiveComment);
    mediaEl.addEventListener('seeked', _refreshActiveComment);
    mediaEl.addEventListener('loadedmetadata', _refreshActiveComment);
  }

  // Round 28: highlight + gently scroll the comment whose frame is the
  // largest one <= the playhead. We scan once (cards are pre-sorted by
  // frame in _refreshListBody). Only scrolls if the active card isn't
  // already fully visible, so the list doesn't constantly jerk while
  // playback continues.
  function _refreshActiveComment() {
    if (!listPopover.classList.contains('open')) return;
    if (!listBody) return;
    const cards = listBody.querySelectorAll('.media-anno-comment');
    if (!cards.length) return;
    let curF = 0;
    try {
      const fps = getFps();
      curF = Math.round((mediaEl.currentTime || 0) * fps);
    } catch (e) { return; }
    let activeCard = null;
    let activeFrame = -1;
    for (let i = 0; i < cards.length; i++) {
      const cf = parseInt(cards[i].getAttribute('data-cframe') || '0', 10) || 0;
      if (cf <= curF && cf > activeFrame) {
        activeCard = cards[i];
        activeFrame = cf;
      }
    }
    for (let i = 0; i < cards.length; i++) {
      if (cards[i] !== activeCard && cards[i].classList.contains('active')) {
        cards[i].classList.remove('active');
      }
    }
    if (activeCard) {
      if (!activeCard.classList.contains('active')) {
        activeCard.classList.add('active');
      }
      // Only smooth-scroll if the card isn't already fully in view —
      // avoids list-jerk when the user is just scrubbing.
      try {
        const r = activeCard.getBoundingClientRect();
        const lr = listBody.getBoundingClientRect();
        const fullyVisible = (r.top >= lr.top && r.bottom <= lr.bottom);
        if (!fullyVisible) {
          activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      } catch (e) {}
    }
  }

  function _refreshListBody() {
    listBody.innerHTML = '';
    const _itm = _getItem();
    const anno = (_itm && _itm.anno) ? _itm.anno : null;
    const comments = (anno && Array.isArray(anno.comments)) ? anno.comments : [];
    listHeadCount.textContent = String(comments.length);
    // Sort by frame ascending so the list reads in playback order
    const sorted = comments.slice().sort((a, b) => (a.frame || 0) - (b.frame || 0));
    sorted.forEach((c) => {
      const card = _buildCommentCard(c);
      listBody.appendChild(card);
    });
    // Round 28: re-mark the active comment after a re-render
    try { _refreshActiveComment(); } catch (e) {}
  }
  function _buildCommentCard(c) {
    // Build a comment card. Layout:
    //   [snapshot thumb] [head: frame + time + actions]    row 1
    //                    [text body]                      row 2
    // The snapshot is captured at add time (canvas drawImage from
    // mediaEl) and stored as `c.snapshot` (data URL).
    const card = document.createElement('div');
    card.className = 'media-anno-comment';
    card.dataset.cid = c.id;
    // Round 28: expose via the legacy attribute name too so the existing
    // [data-anno-comment-id="..."] selector in videoAnnoAddComment's
    // auto-scroll can find this card.
    card.setAttribute('data-anno-comment-id', c.id);
    // Stash the frame number for cheap auto-follow lookup
    card.setAttribute('data-cframe', String(c.frame || 0));
    // Top row: thumbnail + main content
    const rowTop = document.createElement('div');
    rowTop.className = 'comment-row-top';
    // Snapshot thumbnail (captured at add time)
    const thumb = document.createElement('div');
    thumb.className = 'comment-thumb' + (c.snapshot ? '' : ' no-snap');
    if (c.snapshot) {
      var thumbImg = document.createElement('img');
      thumbImg.src = c.snapshot;
      thumbImg.alt = 'Frame ' + (c.frame || 0);
      thumb.appendChild(thumbImg);
    } else {
      thumb.textContent = '—';
    }
    // Frame number badge overlaid on the thumbnail's bottom-left
    const thumbFrame = document.createElement('span');
    thumbFrame.className = 'thumb-frame';
    thumbFrame.textContent = 'f ' + (c.frame || 0);
    thumb.appendChild(thumbFrame);
    thumb.title = 'Click to view full-size snapshot with annotations';
    // Click thumbnail → open the in-app lightbox so the user can see
    // the full frame + annotations at a large size. The user said:
    // "i want can choose the snap shot to check the big image, now
    // only the small pic". The lightbox also exposes a "Jump to frame"
    // button so they can still seek from there.
    thumb.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
    thumb.addEventListener('click', function(ev){
      ev.stopPropagation();
      videoAnnoOpenLightbox(c);
    });
    // Double-click jumps to the frame (for muscle memory parity with
    // the rest of the card which also seeks on click)
    thumb.addEventListener('dblclick', function(ev){
      ev.stopPropagation();
      _jumpToCommentFrame(c);
    });
    rowTop.appendChild(thumb);
    // Main column: head + body
    const main = document.createElement('div');
    main.className = 'comment-main';
    const head = document.createElement('div');
    head.className = 'media-anno-comment-head';
    // Frame chip — clickable to jump to that frame
    const frameChip = document.createElement('span');
    frameChip.className = 'frame-no';
    frameChip.textContent = 'f ' + (c.frame || 0);
    frameChip.title = 'Click to jump to this frame';
    frameChip.addEventListener('click', function(ev){
      ev.stopPropagation();
      _jumpToCommentFrame(c);
    });
    head.appendChild(frameChip);
    // Time label
    const timeLbl = document.createElement('span');
    timeLbl.className = 'time-no';
    try {
      const s = c.time || 0;
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      timeLbl.textContent = m + ':' + (sec < 10 ? '0' : '') + sec;
    } catch (e) { timeLbl.textContent = '0:00'; }
    head.appendChild(timeLbl);
    // Actions
    const actions = document.createElement('span');
    actions.className = 'actions';
    // Round 77: dedicated "Go to frame" button. The frame chip (L6791)
    // was already clickable to seek, but the user said "hard to click the
    // frame" — a 12px text chip is too small a target. Adding a real
    // button (with icon + title) gives a clear, discoverable affordance
    // for jumping back to the captured frame. The old double-click on
    // the thumbnail is still there for muscle memory.
    // Round 78: use onclick (not addEventListener) for consistency with
    // the in-player list at L11751 and to avoid event-delegation conflicts.
    // All three buttons call the global videoAnno* functions directly and
    // stopPropagation to prevent card-level click from also jumping.
    const gotoBtn = document.createElement('button');
    gotoBtn.className = 'goto';
    gotoBtn.textContent = '▶';
    gotoBtn.title = 'Jump to this frame (' + (c.frame || 0) + ')';
    gotoBtn.onclick = function(ev){ ev.stopPropagation(); try { videoAnnoJumpToComment(c.id); } catch(e){} };
    actions.appendChild(gotoBtn);
    // Translate button
    const tBtn = document.createElement('button');
    tBtn.className = 'tr';
    tBtn.textContent = '🌐';
    tBtn.title = 'Translate';
    tBtn.onclick = function(ev){ ev.stopPropagation(); try { if (typeof videoAnnoTranslateComment === 'function') videoAnnoTranslateComment(c.id); } catch(e){} };
    actions.appendChild(tBtn);
    // Delete
    const delBtn = document.createElement('button');
    delBtn.className = 'del';
    delBtn.textContent = '🗑';
    delBtn.title = 'Delete';
    delBtn.onclick = function(ev){ ev.stopPropagation(); try { if (typeof videoAnnoDeleteComment === 'function') videoAnnoDeleteComment(c.id); } catch(e){} };
    actions.appendChild(delBtn);
    head.appendChild(actions);
    main.appendChild(head);
    // Body — show translation if available, otherwise original.
    // The user said "I only need the chinese replace the original english"
    // — so we display ONE line per comment: the translation if it exists,
    // otherwise the source text. No second line, no "原:" prefix.
    const body = document.createElement('div');
    body.className = 'media-anno-comment-text';
    const hasTr = !!(c.translation && c.translation !== c.text);
    if (hasTr) {
      body.classList.add('is-translation');
      if (!c.originalText) c.originalText = c.text;
      body.textContent = c.translation;
      body.title = 'Translation: ' + c.translation;
    } else if (c.text) {
      body.textContent = c.text;
      body.title = c.text;
    } else {
      body.classList.add('placeholder');
      body.textContent = 'Click to type…';
      body.title = '';
    }
    // Inline edit: SINGLE click to edit (the user said "i need to see it
    // clear and can edit that"). Press Enter to commit, Esc to cancel.
    // Clicking a button (translate / delete) stopPropagation so it
    // doesn't accidentally trigger edit.
    body.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
    body.addEventListener('click', function(ev){
      if (ev.target.closest('button')) return;
      if (body.getAttribute('contenteditable') === 'true') return;
      ev.stopPropagation();
      ev.preventDefault();
      // Clear placeholder text so user starts from empty
      if (body.classList.contains('placeholder')) {
        body.classList.remove('placeholder');
        body.textContent = '';
      }
      body.setAttribute('contenteditable', 'true');
      body.focus();
      try {
        const range = document.createRange();
        range.selectNodeContents(body);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (e) {}
    });
    body.addEventListener('blur', function(){
      if (body.getAttribute('contenteditable') !== 'true') return;
      body.setAttribute('contenteditable', 'false');
      let newText = (body.textContent || '').trim();
      if (newText && newText !== (c.text || '')) {
        if (typeof videoAnnoUpdateComment === 'function') {
          videoAnnoUpdateComment(c.id, newText);
        } else {
          c.text = newText;
          scheduleAutoSave();
        }
      } else if (!newText && !(c.text || '')) {
        // Was empty, still empty — restore placeholder
        body.classList.add('placeholder');
        body.textContent = 'Click to type…';
        body.title = '';
      } else {
        body.textContent = c.text || '';
      }
    });
    body.addEventListener('keydown', function(ev){
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        body.blur();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        if (c.text) {
          body.textContent = c.text;
          body.classList.remove('placeholder');
        } else {
          body.classList.add('placeholder');
          body.textContent = 'Click to type…';
          body.title = '';
        }
        body.setAttribute('contenteditable', 'false');
        body.blur();
      }
    });
    main.appendChild(body);
    rowTop.appendChild(main);
    card.appendChild(rowTop);
    // Card click jumps to the frame (the user said "press the button that
    // i create there should go to the frame where i typing" — so the
    // card click is the primary affordance for seek).
    card.addEventListener('click', function(ev){
      if (ev.target.closest('button')) return;
      if (body.getAttribute('contenteditable') === 'true') return;
      _jumpToCommentFrame(c);
    });
    return card;
  }
  function _jumpToCommentFrame(c) {
    // Use the existing jump function so pause + seek + highlight are handled.
    if (typeof videoAnnoJumpToComment === 'function') {
      videoAnnoJumpToComment(c.id);
    }
  }
  function _refreshBadges() {
    // The initial call at the end of buildMediaControls runs BEFORE the
    // caller has stashed `el._item = item`. At that point the helper returns
    // null and the function exits — no throw, no abort of addImage(). The
    // caller explicitly re-invokes this via `el._refreshAnnoBadges()` after
    // pushing the item into state.items, so the badge ends up correct.
    const _itm = _getItem();
    if (!_itm) return;
    const anno = (_itm && _itm.anno) ? _itm.anno : null;
    const cnt = (anno && Array.isArray(anno.comments)) ? anno.comments.length : 0;
    // Update floating "Open Comments" pill badge
    fabCount.textContent = String(cnt);
    fabCount.setAttribute('data-zero', cnt === 0 ? '1' : '0');
  }
  // Re-render the small flags on the seek bar showing where each comment is.
  // One flag per comment, positioned by frame / totalFrames. Click a flag
  // to seek the video to that frame.
  function _refreshSeekMarkers() {
    const _itm = _getItem();
    if (!_itm) return;
    if (!seekMarkers) return;
    seekMarkers.innerHTML = '';
    const anno = _itm.anno;
    const comments = (anno && Array.isArray(anno.comments)) ? anno.comments : [];
    if (!comments.length) return;
    const dur = mediaEl.duration;
    if (!isFinite(dur) || dur <= 0) return;
    const fps = getFps();
    const totalFrames = Math.max(1, Math.round(dur * fps));
    comments.forEach(c => {
      const m = document.createElement('div');
      m.className = 'media-seek-marker';
      m.title = 'f ' + c.frame + ' — ' + (c.translation || c.text || '');
      // Position as percent of total frames; clamp to [0, 100]
      let pct = (c.frame / totalFrames) * 100;
      pct = Math.max(0, Math.min(100, pct));
      m.style.left = pct + '%';
      m.addEventListener('click', function(ev){
        ev.stopPropagation();
        ev.preventDefault();
        if (typeof videoAnnoJumpToComment === 'function') {
          videoAnnoJumpToComment(c.id);
        } else {
          // Fallback: seek + pause
          try { mediaEl.pause(); } catch (e) {}
          mediaEl.currentTime = c.time || 0;
        }
      });
      // Stop mousedown bubbling so the seek-bar drag doesn't kick in
      m.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
      seekMarkers.appendChild(m);
    });
  }
  // Round 10: drawing markers — cyan diamonds on the seek bar showing
  // which frames have strokes. Distinct from the amber comment markers
  // above the bar so the user can see at a glance which frames are
  // "drawn on" vs "commented on". Click a diamond to seek to that
  // frame. Mirrors _refreshSeekMarkers' positioning math but reads
  // the per-frame strokes map (strokesByFrame).
  function _refreshDrawSeekMarkers() {
    if (!seekDrawMarkers) return;
    seekDrawMarkers.innerHTML = '';
    const _itm = _getItem();
    if (!_itm) return;
    const drawState = _itm.el && _itm.el._annoDrawState;
    const strokesByFrame = drawState ? drawState.strokesByFrame : null;
    if (!strokesByFrame) return;
    const dur = mediaEl.duration;
    if (!isFinite(dur) || dur <= 0) return;
    const fps = getFps();
    const totalFrames = Math.max(1, Math.round(dur * fps));
    // One marker per frame that has at least 1 stroke
    Object.keys(strokesByFrame).forEach(function(frameStr){
      const frame = parseInt(frameStr, 10);
      const list = strokesByFrame[frame];
      if (!list || list.length === 0) return;
      // Count drawing strokes only (not text)
      const drawCount = list.filter(function(s){ return s && s.type !== 'text'; }).length;
      if (drawCount === 0) return;
      const m = document.createElement('div');
      m.className = 'media-seek-draw-marker';
      m.title = 'f ' + frame + ' — ' + drawCount + ' stroke' + (drawCount === 1 ? '' : 's');
      let pct = (frame / totalFrames) * 100;
      pct = Math.max(0, Math.min(100, pct));
      m.style.left = pct + '%';
      m.addEventListener('click', function(ev){
        ev.stopPropagation();
        ev.preventDefault();
        try { mediaEl.pause(); } catch (e) {}
        // Round 60: use the frame-accurate seek helper. A direct
        // `currentTime = frame / fps` is at the START of the frame, so
        // the browser's keyframe snap can land at the next keyframe —
        // which often falls in the NEXT frame's time range, giving
        // `_currentFrame() = frame + 1` (the "one frame forward" bug).
        // _seekToFrameExact retries with a slightly different time if
        // the snap overshoots, so the click reliably lands on the frame
        // where the stroke was actually drawn.
        if (typeof _seekToFrameExact === 'function') {
          _seekToFrameExact(frame);
        } else {
          mediaEl.currentTime = frame / fps;
        }
      });
      m.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
      seekDrawMarkers.appendChild(m);
    });
  }
  // Round 12: text markers — green squares on the seek bar showing
  // which frames have text annotations. Walks the per-frame strokes
  // map and emits one marker per frame that has at least one text
  // stroke (text strokes are stored alongside drawing strokes in
  // strokesByFrame, distinguished by `type === 'text'`).
  function _refreshTextSeekMarkers() {
    if (!seekTextMarkers) return;
    seekTextMarkers.innerHTML = '';
    const _itm = _getItem();
    if (!_itm) return;
    const drawState = _itm.el && _itm.el._annoDrawState;
    const strokesByFrame = drawState ? drawState.strokesByFrame : null;
    if (!strokesByFrame) return;
    const dur = mediaEl.duration;
    if (!isFinite(dur) || dur <= 0) return;
    const fps = getFps();
    const totalFrames = Math.max(1, Math.round(dur * fps));
    // One marker per frame that has at least 1 text stroke
    Object.keys(strokesByFrame).forEach(function(frameStr){
      const frame = parseInt(frameStr, 10);
      const list = strokesByFrame[frame];
      if (!list || list.length === 0) return;
      const textStrokes = list.filter(function(s){ return s && s.type === 'text' && (s.text || '').trim(); });
      if (textStrokes.length === 0) return;
      const m = document.createElement('div');
      m.className = 'media-seek-text-marker';
      // Show the first text in the tooltip for quick identification
      const firstText = (textStrokes[0].text || '').slice(0, 30);
      m.title = 'f ' + frame + ' — "' + firstText + '"' + (textStrokes.length > 1 ? ' +' + (textStrokes.length - 1) : '');
      let pct = (frame / totalFrames) * 100;
      pct = Math.max(0, Math.min(100, pct));
      m.style.left = pct + '%';
      m.addEventListener('click', function(ev){
        ev.stopPropagation();
        ev.preventDefault();
        try { mediaEl.pause(); } catch (e) {}
        // Round 60: same frame-accurate seek as the draw marker above.
        // Without this, clicking a green text square lands one frame
        // past the text (the browser snaps to the next keyframe).
        if (typeof _seekToFrameExact === 'function') {
          _seekToFrameExact(frame);
        } else {
          mediaEl.currentTime = frame / fps;
        }
      });
      m.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
      seekTextMarkers.appendChild(m);
    });
  }
  // Round 12: refresh both draw AND text markers together. Used
  // after any stroke commit / undo / clear so both marker types
  // stay in sync with strokesByFrame.
  // Round 12: refresh both draw + text seek markers at once. Used
  // by every code path that mutates strokes (text commit, pen/arrow
  // finish, undo, clear) so the seek bar always reflects the current
  // per-frame state.
  function _refreshAllSeekMarkers() {
    try { _refreshDrawSeekMarkers(); } catch (e) {}
    try { _refreshTextSeekMarkers(); } catch (e) {}
  }
  el._refreshTextSeekMarkers = _refreshTextSeekMarkers;
  // Wire up the floating 💬 pill — toggles the list popover.
  commentsFab.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
  commentsFab.addEventListener('click', function(ev){
    ev.stopPropagation(); ev.preventDefault();
    _setListOpen(!listPopover.classList.contains('open'));
  });
  // Stash refs on element so other code (videoAnnoAddComment, etc) can
  // refresh the popovers / badges after a change.
  el._annoListPopover = listPopover;
  el._annoListBody = listBody;
  el._annoCommentsFab = commentsFab;
  el._seekMarkers = seekMarkers;
  el._seekDrawMarkers = seekDrawMarkers;
  el._seekTextMarkers = seekTextMarkers;
  el._setListOpen = _setListOpen;
  el._refreshListBody = _refreshListBody;
  el._refreshAnnoBadges = _refreshBadges;
  el._refreshSeekMarkers = _refreshSeekMarkers;
  el._refreshDrawSeekMarkers = _refreshDrawSeekMarkers;
  el._refreshTextSeekMarkers = _refreshTextSeekMarkers;
  el._refreshAllSeekMarkers = _refreshAllSeekMarkers;
  el._videoEl = mediaEl;
  // Re-position the popover when the user hasn't moved it. Called by
  // global handlers (pan, item-move, window-resize). Once the user drags
  // the popover themselves, we leave it where they put it.
  el._repositionAnnoPopovers = function() {
    if (listPopover.classList.contains('open')) _positionPopover(listPopover, commentsFab);
  };
  // Initial badge + markers
  _refreshBadges();
  // Build markers once the video duration is known (loadedmetadata or
  // when refreshTimeLabels first succeeds). Falls back to an empty bar
  // while we wait.
  if (isVideo) {
    const _tryMarkers = () => {
      try { _refreshSeekMarkers(); } catch (e) {}
      // Round 10: also render the drawing markers once duration is known
      try { _refreshAllSeekMarkers(); } catch (e) {}
      // Round 12: text markers too
      try { _refreshTextSeekMarkers(); } catch (e) {}
    };
    if (mediaEl.readyState >= 1) {
      // Duration may not be known yet even at readyState 1; defer a tick.
      setTimeout(_tryMarkers, 50);
    }
    mediaEl.addEventListener('loadedmetadata', _tryMarkers, { once: true });
  }
  // ── Stage B: popover is PERSISTENT ──
  // The user wants the comment window to STAY VISIBLE ("i need to see
  // it clear"). We no longer auto-close on outside click. Closing is
  // explicit: click the ✕ in the head, or press Esc.
  // Esc closes the popover (or exits draw mode, if draw mode is on)
  document.addEventListener('keydown', function(ev){
    if (ev.key === 'Escape') {
      if (el._annoDrawState && el._annoDrawState.mode !== 'off' && el._exitDrawMode) {
        el._exitDrawMode();
      } else if (listPopover.classList.contains('open')) { _setListOpen(false); }
    }
  });
  // ── Stage B: keyboard shortcuts ──
  //   M : toggle the comments popover
  //   C : open the popover and focus the add input (so the user can
  //       start typing a new comment at the current frame)
  //   D : toggle the draw / annotation tool
  // These work whenever a video item is the selected item. They are
  // intentionally blocked when the user is typing in an input /
  // contenteditable so they don't interfere with text editing.
  document.addEventListener('keydown', function(ev){
    if (ev.key !== 'm' && ev.key !== 'M' && ev.key !== 'c' && ev.key !== 'C'
        && ev.key !== 'h' && ev.key !== 'H'
        && ev.key !== 'f' && ev.key !== 'F') return;
    // Don't hijack if the user is typing somewhere
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' ||
              (a.getAttribute && a.getAttribute('contenteditable') === 'true'))) {
      return;
    }
    // Only when a video is selected
    const _itm = _getItem();
    if (!_itm || !_itm.video) return;
    if (ev.key === 'm' || ev.key === 'M') {
      ev.preventDefault();
      _setListOpen(!listPopover.classList.contains('open'));
    } else if (ev.key === 'h' || ev.key === 'H') {
      // Clean mode toggle — hide/show all controls for distraction-free viewing
      ev.preventDefault();
      if (el._toggleCleanMode) {
        try { el._toggleCleanMode(); } catch (e) {}
      } else {
        el.classList.toggle('clean-mode');
      }
    // ── F key intentionally NOT handled here ──
    // The global handler (line ~23049) maps F → center/frame selection
    // and Shift+F → app fullscreen. Letting the event bubble up to the
    // global handler is the correct behavior — the card should not steal
    // the F key just because a media item is selected.
    }
  });

  // ── Re-position popover when the window is resized ──
  // The popover is `position: fixed` so it would otherwise stay glued to
  // its old coordinates while the video / canvas resize around it.
  window.addEventListener('resize', function() {
    if (listPopover.classList.contains('open')) _positionPopover(listPopover, commentsFab);
  });

  // ── helpers ──
  // Per-item display mode: 'time' shows 0:00, 'frame' shows f 1234.
  // Persisted on the element so the choice survives the user clicking around.
  el._timeMode = 'time';
  function getFps() {
    // Prefer the cached _kraftedFps; if not yet detected, fall back to 30.
    var f = (mediaEl && mediaEl._kraftedFps) ? mediaEl._kraftedFps : 30;
    return Math.max(12, Math.min(120, f));
  }
  // Round 60: frame-accurate seek for marker clicks. The browser's keyframe
  // snap can put the actual rendered frame 1+ away from the requested
  // `frame / fps` time (especially for compressed codecs with sparse
  // keyframes — e.g. a keyframe at 5.033 when we asked for 5.0 lands on
  // frame 5.999 → Math.floor → frame 5, but a keyframe at 5.034 lands on
  // frame 6.00 → Math.floor → frame 6, which is the "one frame forward"
  // the user reported). The slider click avoided this by routing through
  // `_snapToFrame` (which floors to the start of the frame) — but markers
  // are positioned at exact frame boundaries, so flooring gives the same
  // value, and the snap can still overshoot. This helper retries: after
  // each `seeked`, check the actual frame; if wrong, try a slightly
  // different time (half a frame back if we overshot, one full frame
  // forward if we undershot) and re-check. Up to 4 attempts, then give
  // up and accept whatever the browser landed on.
  //
  // State is tracked on `mediaEl._seekExactState` so a new marker click
  // supersedes any in-flight retry loop from a previous click (we cancel
  // the pending setTimeout and the old state's identity check fails).
  function _seekToFrameExact(targetFrame) {
    if (!isFinite(mediaEl.duration) || mediaEl.duration <= 0) return;
    var fpsVal = getFps();
    if (!fpsVal || fpsVal <= 0) fpsVal = 30;
    // Cancel any previous retry loop
    if (mediaEl._seekExactTimer) {
      clearTimeout(mediaEl._seekExactTimer);
      mediaEl._seekExactTimer = null;
    }
    var state = { attempts: 0, maxAttempts: 4, target: targetFrame, fps: fpsVal, lastDir: 0, mag: 0.5 };
    mediaEl._seekExactState = state;
    function check() {
      // Superseded by a newer _seekToFrameExact call
      if (mediaEl._seekExactState !== state) return;
      var actualFrame = Math.floor(mediaEl.currentTime * state.fps);
      if (actualFrame === state.target) {
        mediaEl._seekExactState = null;
        mediaEl._seekExactTimer = null;
        return; // success
      }
      state.attempts++;
      if (state.attempts >= state.maxAttempts) {
        mediaEl._seekExactState = null;
        mediaEl._seekExactTimer = null;
        return; // give up
      }
      // Decide which direction to nudge. Overshot (actualFrame > target)
      // → ask for a time BEFORE the target. Undershot → ask for a time
      // AFTER the target. Magnitude grows if the same direction keeps
      // misfiring (handles the rare case where a keyframe is 2+ frames
      // away from the target).
      var dir = (actualFrame > state.target) ? -1 : 1;
      if (state.lastDir === dir) {
        state.mag = Math.min(3, state.mag + 0.5);
      } else {
        state.mag = 0.5;
      }
      state.lastDir = dir;
      mediaEl.currentTime = (state.target + dir * state.mag) / state.fps;
      mediaEl._seekExactTimer = setTimeout(check, 30);
    }
    mediaEl.currentTime = state.target / state.fps;
    mediaEl._seekExactTimer = setTimeout(check, 30);
  }
  function fmt(s) {
    if (el._timeMode === 'frame') {
      // Show current frame index, e.g. "f 1234 / 3600"
      if (!isFinite(s) || !isFinite(mediaEl.duration) || mediaEl.duration <= 0) return 'f 0 / 0';
      var fps = getFps();
      var fIdx = Math.round(s * fps);
      var fTotal = Math.round(mediaEl.duration * fps);
      return 'f ' + fIdx + ' / ' + fTotal;
    }
    if (!isFinite(s)) return '0:00';
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }
  // After metadata loads, refresh both labels and the FPS chip.
  function refreshTimeLabels() {
    if (!isFinite(mediaEl.duration)) return;
    tDur.textContent = fmt(mediaEl.duration);
    if (tCur) tCur.textContent = fmt(mediaEl.currentTime);
    if (fpsChip) fpsChip.textContent = getFps() + ' fps';
  }
  // First paint: even if duration hasn't loaded yet, show what we have so the
  // trim row doesn't look empty while the user waits for metadata.
  refreshInPlayerTrimUI();
  // Make the time labels clickable to toggle between 0:00 and f 1234.
  // Use a CSS class so the cursor signals it's interactive.
  tCur.classList.add('media-time-clickable');
  tDur.classList.add('media-time-clickable');
  var _toggleTime = function(ev) {
    if (ev) { ev.stopPropagation(); ev.preventDefault(); }
    el._timeMode = (el._timeMode === 'time') ? 'frame' : 'time';
    refreshTimeLabels();
  };
  tCur.addEventListener('click', _toggleTime);
  tDur.addEventListener('click', _toggleTime);

  // ── FPS chip (small label between duration and volume, e.g. "30 fps") ──
  // Round 58: click cycles through 24 → 25 → 30 → 50 → 60 → auto so the
  // user can always get back to auto-detect (the previous version only
  // re-ran detection, so a wrong auto-detect left them stuck with no way
  // to recover without reloading the video). Visual state follows the
  // data-mode attribute (auto = cyan •, manual = amber ✎).
  var fpsChip = null;
  if (isVideo) {
    fpsChip = document.createElement('span');
    fpsChip.className = 'media-fps-chip';
    fpsChip.textContent = '30 fps';
    fpsChip.setAttribute('data-mode', 'auto');
    fpsChip.title = 'Frame rate. Click to cycle 24→25→30→50→60→auto. Right-click to reset to auto-detect.';
    ctrlsRow.appendChild(fpsChip);
    // Run the actual detection heuristic (extract of the same logic used
    // on metadata load + chip click). Returns a number clamped to [12,120].
    function _runFpsDetection() {
      var detectedFps = 30;
      try {
        if (typeof mediaEl.getVideoPlaybackQuality === 'function') {
          var q = mediaEl.getVideoPlaybackQuality();
          if (q && q.totalVideoFrames > 0 && mediaEl.duration > 0) {
            detectedFps = Math.round(q.totalVideoFrames / mediaEl.duration);
          }
        }
      } catch (e) {}
      if (!detectedFps || detectedFps <= 0) {
        var h = mediaEl.videoHeight || mediaEl.height || 720;
        if (h >= 2160) detectedFps = 60;
        else if (h >= 1080) detectedFps = 30;
        else if (h >= 720) detectedFps = 30;
        else detectedFps = 24;
      }
      return Math.max(12, Math.min(120, detectedFps));
    }
    // Refresh the chip's text + mode indicator. Centralized so any code
    // path that changes _kraftedFps (loadedmetadata, click, right-click,
    // undo) can keep the chip in sync via this single helper.
    function _refreshFpsChip() {
      if (!fpsChip) return;
      var f = getFps();
      fpsChip.textContent = f + ' fps';
      // Mark manual if user explicitly set it, otherwise auto.
      fpsChip.setAttribute('data-mode', mediaEl._kraftedFpsManual ? 'manual' : 'auto');
    }
    // Cycle: index 0..4 = manual values, index 5 = auto-detect.
    // Tracking the index on the media element so the next click on the
    // SAME video continues from where the last click left off (rather
    // than always starting at the same value).
    var _FPS_CYCLE = [24, 25, 30, 50, 60];
    var _FPS_AUTO_IDX = _FPS_CYCLE.length;  // sentinel: "auto"
    function _nextCycleIndex() {
      if (typeof mediaEl._kraftedFpsCycleIdx !== 'number') {
        // First click after load: figure out where to start based on current.
        var cur = getFps();
        var idx = _FPS_CYCLE.indexOf(cur);
        // -1 if no match (e.g. 23.97, 29.97, 60 detected by browser) — fall through
        // to the closest cycle value. We pick the next-in-cycle from the closest.
        if (idx < 0) {
          // Pick the cycle value nearest to current.
          var best = 0, bestD = Infinity;
          for (var i = 0; i < _FPS_CYCLE.length; i++) {
            var d = Math.abs(_FPS_CYCLE[i] - cur);
            if (d < bestD) { bestD = d; best = i; }
          }
          idx = best;
        }
        // After showing current, advance by one so the first click moves.
        mediaEl._kraftedFpsCycleIdx = (idx + 1) % (_FPS_CYCLE.length + 1);
      } else {
        mediaEl._kraftedFpsCycleIdx =
          (mediaEl._kraftedFpsCycleIdx + 1) % (_FPS_CYCLE.length + 1);
      }
      return mediaEl._kraftedFpsCycleIdx;
    }
    function _setManualFps(f) {
      mediaEl._kraftedFps = f;
      mediaEl._kraftedFpsManual = true;
      _refreshFpsChip();
      refreshTimeLabels();
      if (typeof toast === 'function') toast('Frame rate: ' + f + ' fps (manual)');
    }
    function _setAutoFps() {
      try { delete mediaEl._kraftedFps; } catch (e) { mediaEl._kraftedFps = undefined; }
      try { delete mediaEl._kraftedFpsManual; } catch (e) { mediaEl._kraftedFpsManual = false; }
      mediaEl._kraftedFps = _runFpsDetection();
      // Re-init cycle index so the next click after auto lands on a sensible value
      mediaEl._kraftedFpsCycleIdx = undefined;
      _refreshFpsChip();
      refreshTimeLabels();
      if (typeof toast === 'function') toast('Frame rate: ' + mediaEl._kraftedFps + ' fps (auto)');
    }
    fpsChip.addEventListener('click', function(ev) {
      ev.stopPropagation(); ev.preventDefault();
      var idx = _nextCycleIndex();
      if (idx === _FPS_AUTO_IDX) {
        _setAutoFps();
      } else {
        _setManualFps(_FPS_CYCLE[idx]);
      }
    });
    // Right-click (or shift-click) → reset to auto-detect immediately.
    // Provides an explicit escape hatch if the user wants the default
    // back without clicking through the whole cycle.
    fpsChip.addEventListener('contextmenu', function(ev) {
      ev.stopPropagation(); ev.preventDefault();
      _setAutoFps();
    });
  }

  // ── In-player trim mini-timeline (drag handles, click to seek) ──
  // This is the LIVE trim UI; the right-panel trim timeline becomes read-only.
  function refreshInPlayerTrimUI() {
    if (!isVideo) return;
    var dur = mediaEl.duration;
    if (!isFinite(dur) || dur <= 0) return;
    var _itm = _getItem();
    var ts = (_itm && typeof _itm.trimStart === 'number') ? _itm.trimStart : 0;
    var te = (_itm && typeof _itm.trimEnd === 'number') ? _itm.trimEnd : dur;
    if (te > dur) te = dur;
    if (ts < 0) ts = 0;
    if (te <= ts) te = dur;
    var startPct = (ts / dur) * 100;
    var endPct = (te / dur) * 100;
    trimRegion.style.left = startPct + '%';
    trimRegion.style.width = (endPct - startPct) + '%';
    // Playhead
    var phPct = Math.max(0, Math.min(100, (mediaEl.currentTime / dur) * 100));
    trimPlayheadEl.style.left = phPct + '%';
    // Labels
    trimStartInfo.textContent = fmt(ts);
    trimEndInfo.textContent = fmt(te);
    // Round 17: also update the main-seek-bar trim UI. Position
    // the two handles at their respective percentages, and size
    // the two dimmed overlays to cover the regions OUTSIDE the
    // trim range. Without this, the main bar's handles stay at
    // 0/100% even after the user trims via the property panel
    // or the mini bar.
    mainTrimStartHandle.style.left = startPct + '%';
    mainTrimEndHandle.style.left = endPct + '%';
    // Left overlay: from 0% to startPct
    mainTrimLeftOverlay.style.left = '0%';
    mainTrimLeftOverlay.style.width = startPct + '%';
    // Right overlay: from endPct to 100%
    mainTrimRightOverlay.style.left = endPct + '%';
    mainTrimRightOverlay.style.width = (100 - endPct) + '%';
  }
  // Click on the mini bar (not on a handle) → seek to that time
  trimMini.addEventListener('mousedown', function(ev) {
    if (ev.target.classList.contains('trim-handle')) return; // handle drag will own this
    ev.stopPropagation(); ev.preventDefault();
    if (!isFinite(mediaEl.duration) || mediaEl.duration <= 0) return;
    var rect = trimMini.getBoundingClientRect();
    var pct = (ev.clientX - rect.left) / rect.width;
    pct = Math.max(0, Math.min(1, pct));
    mediaEl.currentTime = pct * mediaEl.duration;
    mediaEl.pause();
    mediaEl.muted = false;
    refreshInPlayerTrimUI();
  });
  // Drag a trim handle
  function dragHandle(handleEl, whichSide) {
    handleEl.addEventListener('mousedown', function(ev) {
      ev.stopPropagation(); ev.preventDefault();
      if (!isFinite(mediaEl.duration) || mediaEl.duration <= 0) return;
      var dur = mediaEl.duration;
      var _itm = _getItem();
      if (!_itm) return;
      var ts = (typeof _itm.trimStart === 'number') ? _itm.trimStart : 0;
      var te = (typeof _itm.trimEnd === 'number') ? _itm.trimEnd : dur;
      var onMove = function(e) {
        var rect = trimMini.getBoundingClientRect();
        var pct = (e.clientX - rect.left) / rect.width;
        pct = Math.max(0, Math.min(1, pct));
        var newTime = pct * dur;
        if (whichSide === 'start') {
          // Keep at least 0.1s of clip
          ts = Math.max(0, Math.min(te - 0.1, newTime));
        } else {
          // Keep at least 0.1s of clip
          te = Math.min(dur, Math.max(ts + 0.1, newTime));
        }
        _itm.trimStart = ts;
        _itm.trimEnd = te;
        refreshInPlayerTrimUI();
        // Also keep the right-panel timeline in sync so Save/Export use the right bounds
        if (typeof updateVideoTimeline === 'function') updateVideoTimeline();
      };
      var onUp = function() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
  dragHandle(trimStartHandle, 'start');
  dragHandle(trimEndHandle, 'end');

  // Round 17: drag handlers for the MAIN-seek-bar trim handles.
  // Same data model (item.trimStart / item.trimEnd) and same
  // 0.1s minimum clip as the mini bar — just on the primary
  // timeline so the user doesn't need a second row. The handlers
  // stop event propagation so the seek bar's seek-to-x logic
  // (which fires on mousedown of the bar) doesn't also fire when
  // the user grabs a handle.
  function dragMainHandle(handleEl, whichSide) {
    handleEl.addEventListener('mousedown', function(ev) {
      ev.stopPropagation(); ev.preventDefault();
      if (!isFinite(mediaEl.duration) || mediaEl.duration <= 0) return;
      var dur = mediaEl.duration;
      var _itm = _getItem();
      if (!_itm) return;
      var ts = (typeof _itm.trimStart === 'number') ? _itm.trimStart : 0;
      var te = (typeof _itm.trimEnd === 'number') ? _itm.trimEnd : dur;
      var track = handleEl.parentElement;  // the .media-seek-track
      var onMove = function(e) {
        var rect = track.getBoundingClientRect();
        var pct = (e.clientX - rect.left) / rect.width;
        pct = Math.max(0, Math.min(1, pct));
        var newTime = pct * dur;
        if (whichSide === 'start') {
          ts = Math.max(0, Math.min(te - 0.1, newTime));
        } else {
          te = Math.min(dur, Math.max(ts + 0.1, newTime));
        }
        _itm.trimStart = ts;
        _itm.trimEnd = te;
        // Refresh the main-bar UI (overlays + handles) AND the
        // mini-bar UI (region + labels) so both stay in sync.
        refreshInPlayerTrimUI();
        if (typeof updateVideoTimeline === 'function') updateVideoTimeline();
        try { scheduleAutoSave(); } catch (e) {}
      };
      var onUp = function() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
  dragMainHandle(mainTrimStartHandle, 'start');
  dragMainHandle(mainTrimEndHandle, 'end');
  // Reset trim button
  trimResetBtn.addEventListener('click', function(ev) {
    ev.stopPropagation(); ev.preventDefault();
    if (!isFinite(mediaEl.duration) || mediaEl.duration <= 0) return;
    var _itm = _getItem();
    if (!_itm) return;
    _itm.trimStart = 0;
    _itm.trimEnd = mediaEl.duration;
    refreshInPlayerTrimUI();
    if (typeof updateVideoTimeline === 'function') updateVideoTimeline();
  });
  // Toggle trim info labels (start/end) between 0:00 and f 1234 — same as the
  // main time labels. Click either trim info to flip the mode for this video.
  trimStartInfo.style.cursor = 'pointer';
  trimEndInfo.style.cursor = 'pointer';
  trimStartInfo.title = 'Click to toggle 0:00 ↔ f 1234';
  trimEndInfo.title = 'Click to toggle 0:00 ↔ f 1234';
  function _toggleTrimInfo(ev) {
    ev.stopPropagation(); ev.preventDefault();
    el._timeMode = (el._timeMode === 'time') ? 'frame' : 'time';
    refreshTimeLabels();
    refreshInPlayerTrimUI();
  }
  trimStartInfo.addEventListener('click', _toggleTrimInfo);
  trimEndInfo.addEventListener('click', _toggleTrimInfo);

  // ── video-specific wiring ──
  if (isVideo) {
    // Update duration once metadata is loaded
    mediaEl.addEventListener('loadedmetadata', function() {
      tDur.textContent = fmt(mediaEl.duration);
      // Auto-detect FPS on metadata load so the chip shows the real number
      // immediately (not just "30 fps" until the user presses an arrow key).
      // Same heuristic as the FPS-chip click handler above.
      if (!mediaEl._kraftedFps) {
        var detectedFps = 30;
        try {
          if (typeof mediaEl.getVideoPlaybackQuality === 'function') {
            var q = mediaEl.getVideoPlaybackQuality();
            if (q && q.totalVideoFrames > 0 && mediaEl.duration > 0) {
              detectedFps = Math.round(q.totalVideoFrames / mediaEl.duration);
            }
          }
        } catch (e) {}
        if (!detectedFps || detectedFps <= 0) {
          var h = mediaEl.videoHeight || 0;
          if (h >= 2160) detectedFps = 60;
          else if (h >= 1080) detectedFps = 30;
          else if (h >= 720) detectedFps = 30;
          else detectedFps = 24;
        }
        mediaEl._kraftedFps = Math.max(12, Math.min(120, detectedFps));
        // On initial metadata load this is auto-detected, not manually set.
        mediaEl._kraftedFpsManual = false;
      }
      // Round 58: use the helper so data-mode gets set too.
      if (typeof _refreshFpsChip === 'function') _refreshFpsChip();
      else if (fpsChip) fpsChip.textContent = getFps() + ' fps';
      // If the right panel is open, refresh the panel's FPS label too
      if (typeof refreshVideoPanelTimes === 'function') refreshVideoPanelTimes();
      refreshInPlayerTrimUI();
    });

    // Time update → fill + labels
    mediaEl.addEventListener('timeupdate', function() {
      if (!mediaEl.duration) return;
      // Don't fight the user mid-seek — let the drag own the fill bar.
      // timeupdate keeps firing while the video is paused, and the drag's
      // updateSeekUI is what should win until mouseup.
      if (seeking) return;
      var pct = (mediaEl.currentTime / mediaEl.duration * 100);
      fill.style.width = pct + '%';
      tCur.textContent = fmt(mediaEl.currentTime);
      refreshInPlayerTrimUI();
      // Round 57: keep the cinema-style frame / timecode overlay in sync.
      // Format F-number from detected FPS and the timecode as m:ss.cc
      // (centisecond precision — matches what NLEs use). Always show
      // both regardless of the per-item time/frame toggle, so the
      // overlay is the single source of truth for the user.
      if (frameCodeDisplay) {
        var _fps = getFps();
        var _dur = isFinite(mediaEl.duration) ? mediaEl.duration : 0;
        var _fIdx = Math.max(0, Math.round(mediaEl.currentTime * _fps));
        var _fTotal = Math.max(0, Math.round(_dur * _fps));
        var _m = Math.floor(mediaEl.currentTime / 60);
        var _sec = Math.floor(mediaEl.currentTime % 60);
        var _cs = Math.floor((mediaEl.currentTime - Math.floor(mediaEl.currentTime)) * 100);
        var _timeStr = _m + ':' + (_sec < 10 ? '0' : '') + _sec + '.' + (_cs < 10 ? '0' : '') + _cs;
        var _fcCur = frameCodeDisplay.querySelector('.fc-cur');
        var _fcTotal = frameCodeDisplay.querySelector('.fc-total');
        var _fcTime = frameCodeDisplay.querySelector('.fc-time');
        if (_fcCur)   _fcCur.textContent = 'F ' + _fIdx;
        if (_fcTotal) _fcTotal.textContent = '/ ' + _fTotal;
        if (_fcTime)  _fcTime.textContent = _timeStr;
        // Round 68: also update the info bar above the video
        if (infoBar) {
          var _ibFcur = infoBar.querySelector('.ib-fcur');
          var _ibFtot = infoBar.querySelector('.ib-ftot');
          var _ibTime = infoBar.querySelector('.ib-time');
          var _ibFps  = infoBar.querySelector('.ib-fps');
          if (_ibFcur) _ibFcur.textContent = 'F ' + _fIdx;
          if (_ibFtot) _ibFtot.textContent = '/ ' + _fTotal;
          if (_ibTime) _ibTime.textContent = _timeStr;
          if (_ibFps)  _ibFps.textContent = _fps + ' fps';
        }
      }
    });

    // Play / pause button
    btn.addEventListener('mousedown', function(ev) { ev.stopPropagation(); ev.preventDefault(); });
    btn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      if (mediaEl.paused) {
        mediaEl.muted = false;
        mediaEl.muted = false;
        mediaEl.play().catch(function(){});
      }
      else { mediaEl.pause(); }
    });
    mediaEl.addEventListener('play', function() { btn.innerHTML = '&#9192;'; });
    mediaEl.addEventListener('pause', function() {
      btn.innerHTML = '&#9654;';
    });
    mediaEl.addEventListener('ended', function() { btn.innerHTML = '&#9654;'; });
    // Round 58: playhead-position label visibility.
    // Show while playing — that's the primary use case (the user wants
    // to see "which frame am I on right now" while watching the video).
    // Hide on pause and ended. The label is also kept visible during
    // drag (handled by the mousedown handler adding the .show class) and
    // while the video is the selected item (handled by the selection
    // handlers in refreshSelection, which add/remove .show on the
    // playheadLabel of the previously/newly-selected video). This way
    // the label is always visible WHENEVER the user cares about the
    // exact playhead position, never just floating in space.
    mediaEl.addEventListener('play', function() {
      if (playheadLabel) playheadLabel.classList.add('show');
    });
    mediaEl.addEventListener('pause', function() {
      if (playheadLabel) playheadLabel.classList.remove('show');
    });
    mediaEl.addEventListener('ended', function() {
      if (playheadLabel) playheadLabel.classList.remove('show');
    });
    // Round 57: keep the cinema frame/timecode overlay visible while
    // the video is playing. The CSS `.item.selected .media-frame-display`
    // rule handles the "selected" case, and `.media-frame-display.show`
    // handles "actively playing" — so the user sees the frame number
    // during playback even if they haven't clicked the video.
    if (frameCodeDisplay) {
      mediaEl.addEventListener('play', function() { frameCodeDisplay.classList.add('show'); });
      mediaEl.addEventListener('pause', function() { frameCodeDisplay.classList.remove('show'); });
      mediaEl.addEventListener('ended', function() { frameCodeDisplay.classList.remove('show'); });
    }

    // Double-click toggle play
    el.addEventListener('dblclick', function(ev) {
      ev.stopPropagation();
      if (mediaEl.paused) { mediaEl.muted = false; mediaEl.play(); } else { mediaEl.pause(); }
    });

    // ── Seek bar drag ──
    // State machine:
    //   `dragActive` — true between mousedown and mouseup. Mid-drag seeked
    //     events must NOT release the lock or sync UI (the user is still
    //     dragging).
    //   `seeking` — true while we're blocking timeupdate from touching the
    //     fill bar. Held from mousedown until EITHER the right `seeked`
    //     event fires OR the safety timeout fires.
    //   `seekDragTarget` — the last position the user dropped at. Used to
    //     tell our `seeked` event apart from a stale `seeked` fired by
    //     a frame-step click (or any other seek not initiated by us).
    //     When currentTime is close to seekDragTarget at `seeked` time, it's
    //     ours; when it's far, it's stale and we ignore it.
    var seeking = false;
    var dragActive = false;
    var seekDragTarget = 0;
    var seekTimeout = null;
    function updateSeekUI(pct) {
      if (fill) fill.style.width = (pct * 100) + '%';
      if (tCur) {
        var t = pct * (mediaEl.duration || 0);
        // Respect the current display mode (0:00 vs f 1234)
        tCur.textContent = fmt(t);
      }
      // Round 58: keep the playhead-position label in sync. Single source
      // of truth = wherever updateSeekUI is called (timeupdate, drag,
      // frame-step, hover-to-snap). Cheap (one DOM write + one querySelector
      // for the inner spans) so it doesn't noticeably tax playback.
      if (typeof updatePlayheadLabel === 'function') updatePlayheadLabel(pct);
    }
    // How close (in seconds) `currentTime` must be to `seekDragTarget` for
    // a `seeked` event to count as "ours". Generous enough to absorb normal
    // keyframe snapping (browser can land a few frames away from the drop
    // point) but tight enough to reject a stale seeked from a frame-step
    // click that targeted a different time.
    var SEEK_TOLERANCE = 0.5; // seconds
    function getDragPct() {
      if (!isFinite(mediaEl.duration) || mediaEl.duration <= 0) return 0;
      return seekDragTarget / mediaEl.duration;
    }
    function isOurSeek() {
      if (!isFinite(mediaEl.duration) || mediaEl.duration <= 0) return true;
      return Math.abs(mediaEl.currentTime - seekDragTarget) <= SEEK_TOLERANCE;
    }
    // Apply seek IMMEDIATELY on every mousemove (no rAF throttle).
    // currentTime setter is cheap — the browser debounces internally, and
    // rAF-throttling in the old code made the fill bar jump in big steps
    // and the user-perceived latency was way too high. The earlier rAF
    // pattern was also gating on `readyState >= 1` which silently dropped
    // seeks during initial metadata load.
    // Round 38: snap to FLOOR (not round). Strokes are stored at the frame
    // returned by `_currentFrame()` which uses Math.floor(currentTime*fps).
    // If the slider click snapped to Math.round, a stroke drawn at frame 3.7
    // would be stored at frame 3 (floor) but the click at the same position
    // would land on frame 4 (round) — off by one. The user reported
    // "stroke 1, 2 ok, 3 not good, 4 ok, 5 not good" — a textbook pattern
    // for this mismatch: only the strokes whose decimal crossed the .5
    // boundary (3.7 → 4, 5.6 → 6) went missing, the others were fine
    // because floor and round agreed. Floor here matches the storage
    // function exactly, so the click and the stroke are always on the
    // same frame.
    function _snapToFrame(t) {
      if (!isFinite(mediaEl.duration) || mediaEl.duration <= 0) return t;
      var fps = (typeof getCurrentFps === 'function') ? getCurrentFps()
            : (mediaEl._kraftedFps || 30);
      if (!fps || fps <= 0) return t;
      var totalFrames = Math.max(1, Math.floor(mediaEl.duration * fps));
      var frame = Math.floor(t * fps);
      if (frame < 0) frame = 0;
      if (frame > totalFrames) frame = totalFrames;
      return frame / fps;
    }
    function seekToX(clientX, snap) {
      var rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      var pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      // Apply to video immediately. Browser will clip to [0, duration].
      // Set even if duration isn't ready — it will be applied once metadata loads.
      if (isFinite(mediaEl.duration) && mediaEl.duration > 0) {
        var t = pct * mediaEl.duration;
        if (snap) t = _snapToFrame(t);
        mediaEl.currentTime = t;
        seekDragTarget = t;
        updateSeekUI(t / mediaEl.duration);
        // Round 77: keep the cinema-style F/timestamp overlay in sync
        // during the drag too. Without this the overlay (e.g. "F 3224")
        // only updates after mouseup, because the timeupdate listener
        // is gated by `seeking` to avoid fighting the drag's fill bar.
        // The fill bar is already driven by updateSeekUI above; updating
        // the overlay here is read-only and can't fight anything.
        if (frameCodeDisplay) {
          var _fps = getFps();
          var _dur = mediaEl.duration;
          var _fIdx = Math.max(0, Math.round(t * _fps));
          var _fTotal = Math.max(0, Math.round(_dur * _fps));
          var _m = Math.floor(t / 60);
          var _sec = Math.floor(t % 60);
          var _cs = Math.floor((t - Math.floor(t)) * 100);
          var _timeStr = _m + ':' + (_sec < 10 ? '0' : '') + _sec + '.' + (_cs < 10 ? '0' : '') + _cs;
          var _fcCur = frameCodeDisplay.querySelector('.fc-cur');
          var _fcTotal = frameCodeDisplay.querySelector('.fc-total');
          var _fcTime = frameCodeDisplay.querySelector('.fc-time');
          if (_fcCur)   _fcCur.textContent = 'F ' + _fIdx;
          if (_fcTotal) _fcTotal.textContent = '/ ' + _fTotal;
          if (_fcTime)  _fcTime.textContent = _timeStr;
          // Round 68: also update the info bar above the video
          if (infoBar) {
            var _ibFcur2 = infoBar.querySelector('.ib-fcur');
            var _ibFtot2 = infoBar.querySelector('.ib-ftot');
            var _ibTime2 = infoBar.querySelector('.ib-time');
            var _ibFps2  = infoBar.querySelector('.ib-fps');
            if (_ibFcur2) _ibFcur2.textContent = 'F ' + _fIdx;
            if (_ibFtot2) _ibFtot2.textContent = '/ ' + _fTotal;
            if (_ibTime2) _ibTime2.textContent = _timeStr;
            if (_ibFps2)  _ibFps2.textContent = _fps + ' fps';
          }
        }
      } else {
        updateSeekUI(pct);
      }
    }
    seekBar.addEventListener('mousedown', function(ev) {
      ev.stopPropagation(); ev.preventDefault();
      dragActive = true;
      seeking = true;
      seekBar.classList.add('seeking');
      // Round 58: show the playhead label during a drag so the user
      // sees the exact frame they're scrubbing to (the cursor's hover
      // tooltip + the playhead's label both show, at different positions,
      // which is fine — they're styled distinctly).
      if (playheadLabel) playheadLabel.classList.add('show');
      // Cancel any leftover timeout from a previous drag
      if (seekTimeout) { clearTimeout(seekTimeout); seekTimeout = null; }
      // Pause so user can inspect the exact frame (RV Player / QuickTime pattern)
      if (!mediaEl.paused) mediaEl.pause();
      // Round 37: snap the initial click to a frame boundary. The drag's
      // mousemove handler below passes snap=false so scrubbing stays smooth.
      seekToX(ev.clientX, true);
      var onMove = function(e) { if (dragActive) seekToX(e.clientX, false); };
      var onUp = function() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        // We're no longer actively dragging. From here, the next `seeked`
        // event that matches our drop position is the one to release on.
        // Until then, `seeking` stays true so timeupdate doesn't fight us.
        dragActive = false;
        // Round 58: hide the playhead label after drag ends — UNLESS
        // the video is now playing (in which case the play listener
        // will re-add the class). If the video stays paused, hide it
        // so the label doesn't sit there while the user moves on.
        // We check after a microtask to give the browser a chance to
        // toggle play state if the drag triggered it (rare, but the
        // pause above in mousedown should prevent it).
        if (playheadLabel) {
          // Defer slightly so any subsequent play/pause event from the
          // drag release has time to fire first. Without this we'd
          // race with the play listener and potentially hide then
          // immediately show.
          setTimeout(function() {
            if (playheadLabel && !playheadLabel._forceVisible && mediaEl.paused) {
              playheadLabel.classList.remove('show');
            }
          }, 0);
        }
        // Safety net: if no matching `seeked` ever fires (e.g. click at
        // same position, browser in a weird state, or a stale seeked
        // keeps blocking us), release after a short timeout.
        if (seekTimeout) clearTimeout(seekTimeout);
        seekTimeout = setTimeout(function() {
          if (seeking && !dragActive) {
            seeking = false;
            seekBar.classList.remove('seeking');
            if (isFinite(mediaEl.duration) && mediaEl.duration > 0) {
              updateSeekUI(mediaEl.currentTime / mediaEl.duration);
            }
          }
        }, 250);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    // Release the seeking lock and snap the fill to the real currentTime
    // when the browser has finished OUR seek. Other seeks (frame-step
    // clicks, autoplay-driven seek, anything not initiated by this drag)
    // fire their own `seeked` events — we filter those out with a
    // tolerance check against `seekDragTarget` so they don't snap the
    // UI to a stale position.
    function onSeeked() {
      // Mid-drag: the user is still moving the mouse. Any `seeked` from
      // intermediate seeks during the drag must not release the lock or
      // sync UI — the drag isn't done yet, and the fill is already being
      // driven by seekToX.
      if (dragActive) return;
      if (!seeking) return;
      // Is this the `seeked` from OUR drag, or a stale one from a
      // frame-step click (or any other seek) that happened to be in
      // flight when the user started dragging? Compare currentTime to
      // the last position the user actually dropped at.
      if (!isOurSeek()) {
        // Stale. Don't touch the lock, don't sync UI. The next matching
        // `seeked` (or the timeout) will handle it.
        return;
      }
      if (seekTimeout) { clearTimeout(seekTimeout); seekTimeout = null; }
      seeking = false;
      seekBar.classList.remove('seeking');
      if (isFinite(mediaEl.duration) && mediaEl.duration > 0) {
        var actualPct = mediaEl.currentTime / mediaEl.duration;
        updateSeekUI(actualPct);
      }
    }
    mediaEl.addEventListener('seeked', onSeeked);

    // ── Hover/drag tooltip (frame + time) ──
    // Round 48: as the user moves the cursor along the seek bar, a small
    // tooltip floats above the bar showing the frame number + time at
    // that X position. The tooltip stays visible during a drag (via the
    // `.seeking` class added in the mousedown handler) so the user can
    // read the exact frame they're scrubbing to even when the cursor
    // leaves the bar. Format: "F 123" on top (accent purple) and
    // "0:04.10" below (white, tabular numerals for stable width).
    //
    // The frame number uses the same FPS as the stroke storage
    // (`getFps()` here == `_kraftedFps` with a 30fps fallback) so the
    // tooltip frame matches what `_currentFrame()` would return at
    // that time — no off-by-one between the tooltip and the strokes.
    function fmtTT(s) {
      if (!isFinite(s) || s < 0) s = 0;
      var m = Math.floor(s / 60);
      var sec = Math.floor(s % 60);
      var cs = Math.floor((s * 100) % 100);
      return m + ':' + (sec < 10 ? '0' : '') + sec + '.' + (cs < 10 ? '0' : '') + cs;
    }
    function updateSeekTooltip(clientX) {
      if (!isFinite(mediaEl.duration) || mediaEl.duration <= 0) return;
      var trackRect = track.getBoundingClientRect();
      if (trackRect.width <= 0) return;
      var pct = Math.max(0, Math.min(1, (clientX - trackRect.left) / trackRect.width));
      var t = pct * mediaEl.duration;
      // Frame index — matches the storage convention (floor of t*fps)
      var fps = getFps();
      var frame = Math.floor(t * fps);
      // Position tooltip centered on the cursor X within the seekBar.
      // Clamp horizontally so it never overflows the bar's edges.
      var barRect = seekBar.getBoundingClientRect();
      var xInBar = clientX - barRect.left;
      var ttWidth = seekTooltip.offsetWidth || 70;
      var halfW = ttWidth / 2;
      var clampedX = Math.max(halfW + 2, Math.min(barRect.width - halfW - 2, xInBar));
      seekTooltip.style.left = clampedX + 'px';
      var frameEl = seekTooltip.querySelector('.tt-frame');
      var timeEl = seekTooltip.querySelector('.tt-time');
      if (frameEl) frameEl.textContent = 'F ' + frame;
      if (timeEl) timeEl.textContent = fmtTT(t);
    }
    // Hover → update tooltip
    seekBar.addEventListener('mousemove', function(ev) {
      updateSeekTooltip(ev.clientX);
    });
    // ── Playhead-position label (round 58) ──
    // Distinct from the hover/drag tooltip above: this one follows the
    // VIDEO PLAYHEAD, not the cursor. It moves during playback (via
    // timeupdate → updateSeekUI), stays in place during drag, and lets
    // the user see the exact frame/time at the actual current position
    // — not where their cursor is.
    //
    // Hidden by default; toggled on via .show class by:
    //   - the play handler (so it's visible while playing)
    //   - the mousedown handler (so it's visible during drag)
    //   - the selection handler (so it's visible when the video is selected)
    // Hidden off by pause / ended / deselect.
    function updatePlayheadLabel(pct) {
      if (!playheadLabel) return;
      // Need a valid duration to compute frame + time. Skip silently
      // until metadata loads — the play/pause listeners will show the
      // label at the right time anyway.
      if (!isFinite(mediaEl.duration) || mediaEl.duration <= 0) return;
      pct = Math.max(0, Math.min(1, pct));
      var t = pct * mediaEl.duration;
      // Use the SAME frame convention as the hover tooltip and the
      // stroke storage function (floor of t*fps) so the playhead label,
      // the hover tooltip, and drawn strokes all agree on the frame
      // number at the same position.
      var fps = (typeof getFps === 'function') ? getFps() : (mediaEl._kraftedFps || 30);
      if (!fps || fps <= 0) fps = 30;
      var frame = Math.floor(t * fps);
      var plFrame = playheadLabel.querySelector('.pl-frame');
      var plTime = playheadLabel.querySelector('.pl-time');
      if (plFrame) plFrame.textContent = 'F ' + frame;
      if (plTime) plTime.textContent = fmtTT(t);
      // Position: same as the hover tooltip (left + translateX(-50%)),
      // but anchored to the bar's full width via percentage so the
      // label moves with the playhead, not with the cursor. We use %
      // (not pixels) so we don't have to read getBoundingClientRect on
      // every timeupdate (which would force layout reflow).
      playheadLabel.style.left = (pct * 100) + '%';
    }
    // During a drag the cursor can leave the bar; the document-level
    // mousemove (`onMove` above) keeps the fill bar in sync, but the
    // tooltip is owned by seekBar's mousemove. We hook the document
    // mousemove ONLY while seeking is active so the tooltip keeps
    // following the cursor as it scrubs. Reuses the existing onMove
    // by re-reading clientX from the last mousemove (cached via
    // `lastClientX` if available, else we attach a parallel listener).
    // Cheapest fix: just add a parallel document-level listener that
    // re-runs the same update on the latest event.
    var tooltipOnMove = function(e) { if (dragActive) updateSeekTooltip(e.clientX); };
    document.addEventListener('mousemove', tooltipOnMove);
    // Cleanup when the controls are torn down (e.g. item deleted).
    // We piggyback on the existing `seeking` lifecycle: once seeking
    // is released and the drag is fully done, the listener is harmless
    // (it checks dragActive) but we don't bother removing it on a
    // per-drag basis — it costs <0.01ms per mousemove.
  }

  // (Frame-step buttons REMOVED — trackpad two-finger swipe is now the
  // primary way to scrub. Mouse wheel with shift+drag still works via the
  // global handler; arrow keys still work for keyboard users.)

  // ── GIF: click opens trim tool ──
  if (isGif) {
    btn.title = 'Trim / Edit GIF';
    btn.addEventListener('mousedown', function(ev) { ev.stopPropagation(); ev.preventDefault(); });
    btn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      var it = state.items.find(function(i) { return i.el === el; });
      if (it) { selectOnly(it.id); trimGifSelected(); }
    });
  }
}
