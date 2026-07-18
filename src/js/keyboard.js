import { distributeItems, normalizeSize, stackItems, tetrisAlign } from './alignment.js';
import { captureScreen, getPasteXY } from './capture.js';
import { copySelected, duplicateSelected } from './clipboard.js';
import { deleteSelected } from './delete.js';
import { groupSelected, ungroupSelected } from './groups.js';
import { hideHelp, showHelp } from './help.js';
import { hideHelp, showHelp } from './init.js';
import { addMindMap } from './mindmap.js';
import { _deleteRelation, _exitRelationTool } from './relations.js';
import { clearSelection, getSelectedItems, refreshSelection } from './selection.js';
import { setTool } from './tools.js';
import { translateSelectedText } from './translation.js';
import { state, textTool, viewport, captureResultPanel } from './core-state.js';
import { applyCutExtract, applyLassoExtract, cancelCut, cancelLasso, closeLasso, undoLassoPoint } from './cut-lasso.js';
import { videoAnnoEnsure, videoAnnoGetItemUnderCursor, videoAnnoJumpToNextComment, videoAnnoJumpToPrevComment } from './frame-comments.js';
import { pushUndo, redo, undo } from './undo-redo.js';
import { tidySelection } from './layout-tidy.js';
import { applyCrop, exitCrop, exitReframe } from './reframe-crop.js';
import { addLinkCard, addText, autoGrowTextItem, openLinkModal, updateItemStyle } from './add-items.js';
import { frameSelection } from './canvas-view.js';
import { saveBoard, scheduleAutoSave } from './save-load.js';
import { formatTime, formatVideoTimeForLabel } from './video-trim.js';
import { toggleAppFullscreen, toggleGrid } from './grid-fs.js';
import { hideCtx, toast } from './ui-utils.js';

// ── Shortcut Registry dispatcher ─────────────────────────────

// v5.5.1: check whether the cursor is currently over a video frame
// (.media-wrap) of any video item. Uses bounding-rect hit-test
// because the video has pointer-events:none and .media-wrap is
// transparent, so elementFromPoint penetrates straight through.
function _videoUnderCursor() {
  if (!state || !state.mouse || !state.items) return false;
  var mx = state.mouse.x, my = state.mouse.y;
  for (var i = 0; i < state.items.length; i++) {
    var it = state.items[i];
    if (!it || !it.video || !it.el || !it.el._annoDrawState) continue;
    var mw = it.el.querySelector('.media-wrap');
    if (!mw) continue;
    var r = mw.getBoundingClientRect();
    if (mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom) {
      return true;
    }
  }
  return false;
}

// v5.5.1: check whether any selected item is a video.
function _videoSelected() {
  if (!state || !state.selected || !state.items) return false;
  var found = false;
  state.selected.forEach(function(id) {
    if (found) return;
    var it = state.items.find(function(i) { return i.id === id; });
    if (it && (it.video || it.isVideo)) found = true;
  });
  return found;
}

// R79: lookup the active shortcut registry and dispatch the
// matching action. Returns true if a shortcut was handled.
// Called at the top of the keydown handler so user-customised
// shortcuts always take priority over the legacy hardcoded
// logic below.
function _dispatchShortcut(e) {
  var reg = (typeof window !== 'undefined' && window.ShortcutRegistry) ? window.ShortcutRegistry : {};
  var matchedId = null;
  var matchedKeys = null;
  // Walk every shortcut; find the first one whose key combo matches.
  var ids = Object.keys(reg);
  for (var i = 0; i < ids.length; i++) {
    var entry = reg[ids[i]];
    if (!entry || !entry.keys) continue;
    for (var j = 0; j < entry.keys.length; j++) {
      var k = entry.keys[j];
      // Match modifiers: ctrl OR meta is treated as "modifier key"
      // (Cmd on Mac, Ctrl on Win). If the shortcut expects ctrl and
      // the user pressed meta (or vice versa), we match — because
      // Platform.zoomKey already maps Cmd→metaKey, Ctrl→ctrlKey.
      var wantCtrl = !!k.ctrl;
      var wantMeta = !!k.meta;
      var wantShift = !!k.shift;
      var wantAlt = !!k.alt;
      var gotCtrl = !!e.ctrlKey;
      var gotMeta = !!e.metaKey;
      var gotShift = !!e.shiftKey;
      var gotAlt = !!e.altKey;
      // If the shortcut wants ctrl OR meta, accept either.
      // If it wants BOTH, require both.
      var modOk = true;
      if (wantCtrl && wantMeta) {
        modOk = gotCtrl && gotMeta;
      } else if (wantCtrl || wantMeta) {
        modOk = gotCtrl || gotMeta;
      } else {
        modOk = !gotCtrl && !gotMeta;
      }
      modOk = modOk && (wantShift === gotShift) && (wantAlt === gotAlt);
      // Key match (case-insensitive for letters)
      var keyOk = (k.key === e.key) || (k.key.toUpperCase && k.key.toLowerCase() === e.key.toLowerCase());
      if (modOk && keyOk) {
        matchedId = entry.id;
        matchedKeys = entry.keys;
        break;
      }
    }
    if (matchedId) break;
  }
  if (!matchedId) return false;

  // ── Dispatch action ────────────────────────────────────────
  // edit-paste MUST NOT preventDefault — the native paste event needs
  // to fire so paste-handler.js can read clipboardData.
  // tool-text / tool-draw: if cursor is over a video frame, bail out
  // so the plain D/T handler can enter video annotation mode instead
  // of switching the global canvas tool.
  if (matchedId === 'tool-text' || matchedId === 'tool-draw') {
    if (_videoUnderCursor()) return false; // let plain D/T handler take over
  }
  // All other shortcuts prevent the default browser behavior.
  if (matchedId !== 'edit-paste') e.preventDefault();
  switch (matchedId) {
    // Tools
    case 'tool-select':      setTool('select'); return true;
    case 'tool-text':        setTool('text'); return true;
    case 'tool-draw':        setTool('draw'); return true;
    case 'tool-export':      setTool('export'); return true;
    case 'tool-capture':     setTool('capture'); return true;
    case 'tool-screen-cap':  captureScreen(); return true;
    case 'tool-cut':         setTool('cut'); return true;
    case 'tool-lasso':       setTool('lasso'); return true;
    case 'tool-mindmap':     addMindMap(); return true;
    case 'tool-relation':    setTool('relation'); return true;
    case 'tool-link':        openLinkModal(); return true;
    case 'tool-grid':        toggleGrid(); return true;
    case 'tool-fullscreen':  toggleAppFullscreen(); return true;
    case 'tool-frame-sel':   frameSelection(); return true;
    // Edit
    case 'edit-undo':        undo(); return true;
    case 'edit-redo':        redo(); return true;
    case 'edit-redo-alt':    redo(); return true;
    case 'edit-copy':        copySelected(); return true;
    case 'edit-paste':       return true; // handled by native paste event
    case 'edit-duplicate':   duplicateSelected(); return true;
    case 'edit-delete':      deleteSelected(); return true;
    case 'edit-select-all':  state.selected.clear(); var all = []; [].push.apply(all, state.items); [].push.apply(all, state.texts); [].push.apply(all, state.todos||[]); [].push.apply(all, state.mindmaps||[]); all.forEach(function(i){ state.selected.add(i.id); }); refreshSelection(); return true;
    // File
    case 'file-save':        if (typeof saveBoard === 'function') saveBoard(); return true;
    case 'file-save-as':     if (typeof setTool === 'function') setTool('capture'); return true; // Shift+Ctrl+S = screen cap
    case 'file-open':        if (typeof loadBoard === 'function') loadBoard(); return true;
    // Group
    case 'group-group':      groupSelected(); return true;
    case 'group-ungroup':    ungroupSelected(); return true;
    // Arrange
    case 'arrange-tidy':     tidySelection(); return true;
    case 'arrange-tetris-up':    tetrisAlign('up'); return true;
    case 'arrange-tetris-down':  tetrisAlign('down'); return true;
    case 'arrange-tetris-left':  tetrisAlign('left'); return true;
    case 'arrange-tetris-right': tetrisAlign('right'); return true;
    case 'arrange-dist-h':   distributeItems('h'); return true;
    case 'arrange-dist-v':   distributeItems('v'); return true;
    case 'arrange-norm-size':  normalizeSize('size'); return true;
    case 'arrange-norm-scale': normalizeSize('scale'); return true;
    case 'arrange-norm-h':   normalizeSize('height'); return true;
    case 'arrange-norm-w':   normalizeSize('width'); return true;
    case 'arrange-stack':    stackItems(); return true;
    // Navigation
    case 'nav-pan-space':
      // v5.5.1: if a video is selected, let the legacy spacebar handler
      // (below) handle play/pause. Only pan if no video is selected.
      if (_videoSelected()) return false;
      state.spaceDown = true; viewport.style.cursor = 'grab'; return true;
    case 'nav-help':         if (typeof showHelp === 'function') showHelp(); return true;
    case 'nav-esc':          clearSelection(); hideCtx(); if (typeof hideHelp === 'function') hideHelp(); captureResultPanel.classList.remove('show'); _exitRelationTool(); if (state.tool !== 'select') setTool('select'); return true;
    // Translate
    case 'translate-en-zh':  translateSelectedText('en', 'zh'); return true;
    // Media
    case 'media-frame-left':       /* handled by existing logic */ return false;
    case 'media-frame-right':      /* handled by existing logic */ return false;
    case 'media-frame-10-left':    /* handled by existing logic */ return false;
    case 'media-frame-10-right':   /* handled by existing logic */ return false;
    case 'media-trim-i':           /* handled by existing logic */ return false;
    case 'media-trim-o':           /* handled by existing logic */ return false;
    default: return false;
  }
}

// ============================================================
//  KEYBOARD
// ============================================================
document.addEventListener('keydown', e => {
  // Don't intercept when typing in text
  // Round 15: added TEXTAREA — the draw text tool spawns a <textarea>
  // overlay, and single-letter hotkeys (v, t, d, e, c, x, l, m, s, etc.)
  // were being intercepted while the user typed, switching tools
  // underneath their fingers.
  if (e.target.contentEditable === 'true' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
    // Allow translate shortcut even while editing text
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'T' || e.key === 't')) {
      e.preventDefault();
      translateSelectedText('en', 'zh');
      return;
    }
    if (e.key === 'Escape') e.target.blur();
    return;
  }

  // R79: try the shortcut registry first. If the user has remapped
  // a shortcut, the registry dispatches it and the legacy hardcoded
  // logic below is skipped for that key combo.
  if (_dispatchShortcut(e)) return;

  if (e.key === ' ' && !state.spaceDown) {
    state.spaceDown = true;
    // Spacebar plays/pauses the selected video (if any). If no video is
    // selected, fall through to the pan behavior below.
    if (!cutState && !lassoState && !state.reframing && !state.cropping) {
      var vidItem = null;
      state.selected.forEach(function(id) {
        var it = state.items.find(function(i) { return i.id === id; });
        if (it && it.isVideo && it.video) { vidItem = it; }
      });
      if (vidItem && vidItem.video) {
        e.preventDefault();
        if (vidItem.video.paused) {
          vidItem.video.muted = false;
          vidItem.video.play().catch(function() {});
        } else {
          vidItem.video.pause();
        }
        return;
      }
    }
    // No video selected — switch to pan mode (grab cursor)
    viewport.style.cursor = 'grab';
    e.preventDefault();
    return;
  }
  // Free cut shortcuts
  if (cutState) {
    if (e.key === 'Escape') { cancelCut(); setTool('select'); return; }
    if (e.key === 'Enter') { applyCutExtract(); return; }
    return;
  }
  // Lasso shortcuts
  if (lassoState) {
    if (e.key === 'Escape') { cancelLasso(); setTool('select'); return; }
    if (e.key === 'Enter') { if (lassoState.points.length >= 3) { closeLasso(); applyLassoExtract(); } return; }
    if (e.key === 'Backspace' || e.key === 'z' || e.key === 'Z') { e.preventDefault(); undoLassoPoint(); return; }
    return;
  }

  // Reframe shortcuts
  if (state.reframing) {
    if (e.key === 'Enter') { e.preventDefault(); exitReframe(true); return; }
    if (e.key === 'Escape') { e.preventDefault(); exitReframe(false); return; }
    return;
  }

  // Crop shortcuts
  if (state.cropping) {
    if (e.key === 'Enter') { e.preventDefault(); applyCrop(); return; }
    if (e.key === 'Escape') { e.preventDefault(); exitCrop(false); return; }
    return;
  }

  if (e.key === 'Escape') { clearSelection(); hideCtx(); hideHelp(); captureResultPanel.classList.remove('show'); _exitRelationTool(); if (state.tool !== 'select') setTool('select'); return; }
  // Video frame-step: arrow keys seek frame-by-frame (debounced, non-blocking).
  // Round 56: skip the block when a modifier is held (Ctrl/Cmd/Alt).
  // Without this guard the video handler intercepts Ctrl+Left/Right
  // and breaks the symmetric case logic — Up/Down fall through to
  // tetris/distribute/normalize but Left/Right get stolen here. The
  // same bug hits Mac because Cmd fires `metaKey`, so the four
  // directions stay asymmetric on Mac too. With this guard, the
  // modifier-arrow block below (line ~19297) handles all four
  // directions the same way on both platforms.
  //
  // Round 67: focus check simplified. We only need to bail out when
  // the user is ACTUALLY typing in a text input (where arrow keys
  // move the text cursor). The previous check used `document.activeElement`
  // which on Mac Safari can report the play button / seek bar div
  // as the active element after a click — causing arrow keys to
  // silently no-op even though the user is clearly in the video
  // context. We now check `e.target` (the actual element that
  // received the keydown) and only bail out for real text-input
  // cases (INPUT / TEXTAREA / contenteditable). Everything else —
  // including a div or button anywhere on the page — falls through
  // to the frame-step logic, which is what the user expects.
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
      !e.ctrlKey && !e.metaKey && !e.altKey) {
    // Don't steal arrow keys from a text input / contenteditable (e.g.
    // editing a text item) — those need arrow keys for cursor movement.
    var ae = e.target;
    var isTyping = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' ||
                          (ae.getAttribute && ae.getAttribute('contenteditable') === 'true'));
    if (isTyping) return;
    var vidItem = null;
    state.selected.forEach(function(id) {
      var it = state.items.find(function(i) { return i.id === id; });
      if (it && it.isVideo && it.video) { vidItem = it; }
    });
    if (vidItem && vidItem.video) {
      e.preventDefault();
      var vid = vidItem.video;
      if (!vid.paused) vid.pause();
      // Detect frame duration: try metadata, fallback to adaptive
      if (!vid._kraftedFps) {
        var detectedFps = 30;
        // Method 1: getVideoPlaybackQuality (Chrome/Edge)
        if (vid.getVideoPlaybackQuality) {
          try {
            var q = vid.getVideoPlaybackQuality();
            if (q.totalVideoFrames > 0 && vid.duration > 0) {
              detectedFps = Math.round(q.totalVideoFrames / vid.duration);
            }
          } catch(ex) {}
        }
        // Method 2: heuristic based on video height (common rates)
        if (detectedFps <= 0 || detectedFps > 120) {
          var h = vid.videoHeight || 0;
          if (h >= 2160)      detectedFps = 60;  // 4K often 60fps
          else if (h >= 1080) detectedFps = 30;  // 1080p often 30fps
          else if (h >= 720)  detectedFps = 30;  // 720p often 30fps
          else                  detectedFps = 24;  // lower res often 24fps
        }
        vid._kraftedFps = Math.max(12, Math.min(120, detectedFps));
      }
      var frameTime = 1 / vid._kraftedFps;
      var frames = e.shiftKey ? 10 : 1;
      var delta = frameTime * frames;
      var targetTime = e.key === 'ArrowLeft'
        ? Math.max(0, vid.currentTime - delta)
        : Math.min(vid.duration || 1e9, vid.currentTime + delta);
      // Instant UI update: update seek bar + time label + frame-code
      // overlay immediately. Format respects the per-item display mode
      // (0:00 vs f 1234) for the in-bar label, while the cinema-style
      // overlay ALWAYS shows F + time together (its own format).
      (function() {
        var item = vidItem;
        if (item && item.el) {
          var bar = item.el.querySelector('.media-seek-fill');
          var tCur = item.el.querySelector('.media-time-cur');
          if (bar) bar.style.width = (targetTime / (vid.duration || 1) * 100) + '%';
          if (tCur) {
            tCur.textContent = formatVideoTimeForLabel(item.el, vid, targetTime);
          }
          // Round 57: keep the cinema frame/timecode overlay in sync
          // with the optimistic target. Same calc as the timeupdate
          // listener so the overlay and the in-bar label agree.
          var fcd = item.el.querySelector('.media-frame-display');
          if (fcd) {
            var _fps = vid._kraftedFps || 30;
            var _dur = isFinite(vid.duration) ? vid.duration : 0;
            var _fIdx = Math.max(0, Math.round(targetTime * _fps));
            var _fTotal = Math.max(0, Math.round(_dur * _fps));
            var _m = Math.floor(targetTime / 60);
            var _sec = Math.floor(targetTime % 60);
            var _cs = Math.floor((targetTime - Math.floor(targetTime)) * 100);
            var _timeStr = _m + ':' + (_sec < 10 ? '0' : '') + _sec + '.' + (_cs < 10 ? '0' : '') + _cs;
            var _fcCur = fcd.querySelector('.fc-cur');
            var _fcTotal = fcd.querySelector('.fc-total');
            var _fcTime = fcd.querySelector('.fc-time');
            if (_fcCur)   _fcCur.textContent = 'F ' + _fIdx;
            if (_fcTotal) _fcTotal.textContent = '/ ' + _fTotal;
            if (_fcTime)  _fcTime.textContent = _timeStr;
            // Round 68: sync the info bar too
            var _ib = item.el.querySelector('.media-info-bar');
            if (_ib) {
              var _ibFcur = _ib.querySelector('.ib-fcur');
              var _ibFtot = _ib.querySelector('.ib-ftot');
              var _ibTime = _ib.querySelector('.ib-time');
              var _ibFps  = _ib.querySelector('.ib-fps');
              if (_ibFcur) _ibFcur.textContent = 'F ' + _fIdx;
              if (_ibFtot) _ibFtot.textContent = '/ ' + _fTotal;
              if (_ibTime) _ibTime.textContent = _timeStr;
              if (_ibFps)  _ibFps.textContent = _fps + ' fps';
            }
          }
        }
      })();
      // Round 57: REMOVED the 30ms trailing debounce. It added
      // perceptible latency on the first press (you'd feel a 30ms
      // gap before the seek actually fired), which made frame-step
      // feel "slow and not smooth". Now we fire the seek IMMEDIATELY
      // on every keypress, and use a simple in-flight lock so rapid
      // OS key-repeat doesn't pile overlapping seeks onto the
      // browser (which is what makes seeks feel laggy). If the user
      // presses the key again while a seek is still in flight, we
      // remember ONE queued target — the seeked handler will pick it
      // up after the current seek completes. This is the same
      // pattern NLEs use for jog-wheel input: coalesce at the
      // browser boundary, not before it.
      //
      // We also use `requestVideoFrameCallback` (RVFC) when
      // available. RVFC fires on the actual rendered video frame,
      // so the seek lands on a frame boundary instead of mid-frame.
      // Combined with the in-flight lock, this makes frame-step
      // feel truly frame-accurate at the video's natural rate.
      // Frame-step: seek immediately. On Windows, `seeked` can be
      // slower to fire than on Mac, causing the _seekInFlight lock
      // to stall rapid key-repeat. For frame-step we bypass the lock
      // entirely — each arrow press is a discrete seek that directly
      // sets currentTime. The browser naturally coalesces rapid
      // currentTime writes, so this stays smooth without the lock.
      clearTimeout(vid._seekTimer);
      vid._seeking = true;
      vid.currentTime = targetTime;
      // On seeked: clear flag, process pending target if different.
      // Also include a safety net: if `seeked` doesn't fire within 500ms,
      // clear _seeking so the NEXT arrow press isn't blocked.
      if (!vid._seekedListener) {
        vid._seekedListener = true;
        var clearSeekingSafety = function() {
          if (vid._seekSafetyTimer) { clearTimeout(vid._seekSafetyTimer); vid._seekSafetyTimer = null; }
        };
        vid.addEventListener('seeked', function() {
          clearSeekingSafety();
          vid._seeking = false;
          // Sync UI to actual currentTime (in case instant update was off).
          // Use formatVideoTimeForLabel so the user's chosen display mode
          // (0:00 vs f 1234) is preserved after a seek completes.
          var item = state.items.find(function(it) { return it.video === vid; });
          if (item && item.el) {
            var bar = item.el.querySelector('.media-seek-fill');
            var tCur = item.el.querySelector('.media-time-cur');
            var pct = vid.duration ? vid.currentTime / vid.duration : 0;
            if (bar) bar.style.width = (pct * 100) + '%';
            if (tCur) {
              tCur.textContent = formatVideoTimeForLabel(item.el, vid, vid.currentTime);
            }
            // Round 57: also sync the cinema frame/timecode overlay to
            // the actual currentTime after a seek. The optimistic
            // update in the keydown handler used the requested target,
            // which on a keyframe-snap codec might differ from where
            // the browser actually landed. Re-sync to the real value
            // so the overlay never lies about which frame is shown.
            var fcd = item.el.querySelector('.media-frame-display');
            if (fcd) {
              var _fps = vid._kraftedFps || 30;
              var _dur = isFinite(vid.duration) ? vid.duration : 0;
              var _fIdx = Math.max(0, Math.round(vid.currentTime * _fps));
              var _fTotal = Math.max(0, Math.round(_dur * _fps));
              var _m = Math.floor(vid.currentTime / 60);
              var _sec = Math.floor(vid.currentTime % 60);
              var _cs = Math.floor((vid.currentTime - Math.floor(vid.currentTime)) * 100);
              var _timeStr = _m + ':' + (_sec < 10 ? '0' : '') + _sec + '.' + (_cs < 10 ? '0' : '') + _cs;
              var _fcCur = fcd.querySelector('.fc-cur');
              var _fcTotal = fcd.querySelector('.fc-total');
              var _fcTime = fcd.querySelector('.fc-time');
              if (_fcCur)   _fcCur.textContent = 'F ' + _fIdx;
              if (_fcTotal) _fcTotal.textContent = '/ ' + _fTotal;
              if (_fcTime)  _fcTime.textContent = _timeStr;
              // Round 68: sync the info bar too (post-seek re-sync)
              var _ib2 = item.el.querySelector('.media-info-bar');
              if (_ib2) {
                var _ibFcur2 = _ib2.querySelector('.ib-fcur');
                var _ibFtot2 = _ib2.querySelector('.ib-ftot');
                var _ibTime2 = _ib2.querySelector('.ib-time');
                var _ibFps2  = _ib2.querySelector('.ib-fps');
                if (_ibFcur2) _ibFcur2.textContent = 'F ' + _fIdx;
                if (_ibFtot2) _ibFtot2.textContent = '/ ' + _fTotal;
                if (_ibTime2) _ibTime2.textContent = _timeStr;
                if (_ibFps2)  _ibFps2.textContent = _fps + ' fps';
              }
            }
          }
          // v3.8 fix: removed the chain re-seek block that tried to seek
          // again if currentTime didn't exactly match _seekTarget. The
          // browser's keyframe-snap means currentTime can never land at
          // the exact 1/30s target, so the chain looped forever and
          // caused the visible "jump back" after every arrow press.
          // We now accept whatever position the browser actually lands
          // on (which the seeked event has already synced the UI to
          // above). For a typical video, this lands on the nearest
          // keyframe — coarser than frame-accurate, but stable.
          //
          // Frame-step is now lock-free (see keydown handler above).
        });
        vid.addEventListener('ended', function() { vid._seeking = false; clearSeekingSafety(); });
      }
      // Per-seek safety: if `seeked` doesn't fire within 500ms of a
      // pending seek, clear `_seeking` so the next arrow press isn't
      // blocked. This protects against the seeked event being lost.
      if (vid._seekSafetyTimer) clearTimeout(vid._seekSafetyTimer);
      vid._seekSafetyTimer = setTimeout(function() {
        vid._seeking = false;
        vid._seekQueuedTarget = null;
        vid._seekSafetyTimer = null;
      }, 500);
      return;
    }
  }
  if (e.ctrlKey || e.metaKey) {
    // Ctrl combos
    if (e.altKey && e.shiftKey) {
      // Distribute
      if (e.key === 'ArrowUp') { e.preventDefault(); distributeItems('h'); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); distributeItems('v'); return; }
    }
    if (e.altKey) {
      // Normalize
      if (e.key === 'ArrowUp') { e.preventDefault(); normalizeSize('size'); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); normalizeSize('scale'); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); normalizeSize('height'); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); normalizeSize('width'); return; }
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); stackItems(); return; }
      return;
    }
    // Ctrl+Arrow: Tetris-snap (Round 43). Each selected item moves in
    // the chosen direction independently and stops at the first
    // item it would touch (X/Y preserved on the perpendicular axis,
    // hit item doesn't move). If nothing's in the way, the item
    // snaps to the canvas edge in that direction.
    if (e.key === 'ArrowUp') { e.preventDefault(); tetrisAlign('up'); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); tetrisAlign('down'); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); tetrisAlign('left'); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); tetrisAlign('right'); return; }
    if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); redo(); return; }
    if (e.key === 'c' || e.key === 'C') { e.preventDefault(); copySelected(); return; }
    if (e.key === 'v' || e.key === 'V') {
      // v5.5: don't intercept Ctrl+V — let the native paste event fire.
      // paste-handler.js listens for the 'paste' event and handles text
      // (creating text boxes), URLs (link cards), images, and files. The
      // native paste event's clipboardData.getAsString() does NOT require
      // clipboard-read permission — unlike navigator.clipboard.readText().
      //
      // The in-app copy intercept in paste-handler.js (3-second window)
      // already checks whether the incoming paste has text while the
      // internal clipboard doesn't — if so, it lets the external text
      // paste fall through to the text handler. So we don't need to
      // bypass it here.
      return;
    }
    if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      if (e.shiftKey) { duplicateSelected(); return; }
      // Ctrl+D → Draw tool (Round R-N: was plain D, now Ctrl+D so plain
      // "d" can be typed in text/comment inputs without hijacking the
      // canvas into draw mode). Skip the board's draw tool if a video
      // is the selected item — the video has its own annotation draw
      // handler (registered later on the video element) that cycles
      // annotation draw mode. Activating the board's draw tool would
      // paint its white toolbar overlay over the video and block all
      // interactions.
      var _hasVideoSelD = false;
      try {
        if (state && state.selected && state.items) {
          state.selected.forEach(function(id) {
            var it = state.items.find(function(i) { return i.id === id; });
            if (it && (it.video || it.isVideo)) { _hasVideoSelD = true; }
          });
        }
      } catch (_eD) { /* fail-open */ }
      if (_hasVideoSelD) return;
      setTool('draw');
      return;
    }
    if (e.key === 'g' || e.key === 'G') { e.preventDefault(); if (e.shiftKey) ungroupSelected(); else groupSelected(); return; }
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); if (e.shiftKey) setTool('capture'); else saveBoard(); return; }
    if (e.key === 'a' || e.key === 'A') { e.preventDefault(); state.selected.clear(); [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])].forEach(i => state.selected.add(i.id)); refreshSelection(); return; }
    if (e.key === 'e' || e.key === 'E') { e.preventDefault(); setTool('export'); return; }
    if (e.key === 'l' || e.key === 'L') { e.preventDefault(); openLinkModal(); return; }
    if ((e.key === 'T' || e.key === 't') && e.shiftKey) { e.preventDefault(); translateSelectedText('en', 'zh'); return; }
    // Ctrl+Shift+U = Tidy selected items (masonry layout)
    if (e.shiftKey && (e.key === 'U' || e.key === 'u')) { e.preventDefault(); tidySelection(); return; }
    return;
  }

  // ── Plain D / T key: video annotation shortcuts ──
  // D → toggle pen mode (draw directly on video frame)
  // T → toggle text mode (type text on video frame)
  // These are handled HERE (global handler) instead of the per-video
  // keydown listener (which had cross-platform issues on Windows).
  // Skips when typing in an input.
  // Priority: selected video > hovered video (no pre-select needed).
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    if (e.key === 'd' || e.key === 'D' || e.key === 't' || e.key === 'T') {
      var aeDT = document.activeElement;
      if (aeDT && (aeDT.tagName === 'INPUT' || aeDT.tagName === 'TEXTAREA' ||
                   (aeDT.getAttribute && aeDT.getAttribute('contenteditable') === 'true'))) {
        // typing — let the character through
      } else {
        // Find video: selected first, then hovered
        var _selVidDT = null;
        if (state && state.selected && state.items) {
          state.selected.forEach(function(sid) {
            if (_selVidDT) return;
            var it = state.items.find(function(i) { return i.id === sid; });
            if (it && it.video && it.el && it.el._annoDrawState) { _selVidDT = it; }
          });
        }
        // v5.5: if no selected video, try hover detection — user shouldn't
        // need to click-select the video first. Just hover + press T/D.
        // Only consider the mouse on the VIDEO FRAME (.media-wrap), not
        // over the toolbar UI inside the video player.
        // v5.5.1: Use bounding-rect hit-test instead of elementFromPoint
        // because .media-wrap is transparent (no background) and the <video>
        // has pointer-events:none, so elementFromPoint penetrates straight
        // through to whatever is behind the video frame.
        if (!_selVidDT && state && state.mouse && state.items) {
          var mx = state.mouse.x, my = state.mouse.y;
          for (var hi = 0; hi < state.items.length; hi++) {
            var hit = state.items[hi];
            if (!hit || !hit.video || !hit.el || !hit.el._annoDrawState) continue;
            var mw = hit.el.querySelector('.media-wrap');
            if (!mw) continue;
            var r = mw.getBoundingClientRect();
            if (mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom) {
              _selVidDT = hit;
              break;
            }
          }
        }
        if (_selVidDT) {
          e.preventDefault();
          // Mark this T/D press as handled so the downstream canvas
          // selection-aware handler doesn't double-toggle.
          window.__kraftedTDKeyHandled = true;
          setTimeout(function(){ window.__kraftedTDKeyHandled = false; }, 0);
          var sDT = _selVidDT.el._annoDrawState;
          var targetMode = (e.key === 'd' || e.key === 'D') ? 'pen' : 'text';
          // Exactly the same logic as clicking the toolbar T/D button:
          // toggle the mode and call _applyDrawMode. Nothing else.
          sDT.mode = (sDT.mode === targetMode) ? 'off' : targetMode;
          if (_selVidDT.el._applyDrawMode) _selVidDT.el._applyDrawMode();
          // Exit draw mode on all OTHER videos
          try {
            if (state && state.items) {
              state.items.forEach(function(other) {
                if (other && other.el && other.el !== _selVidDT.el && other.el._annoDrawState
                    && other.el._annoDrawState.mode && other.el._annoDrawState.mode !== 'off'
                    && typeof other.el._exitDrawMode === 'function') {
                  other.el._exitDrawMode();
                }
              });
            }
          } catch(e) {}
        }
      }
    }
  }

  // Round 34: i/o trim hotkey (was: per-video keydown listener that
  // leaked and raced when multiple videos were on the board). This is
  // a SINGLE GLOBAL handler — exactly one place where i/o are checked.
  //   i / I  →  set trim START to current playhead
  //   o / O  →  set trim END   to current playhead
  // Round 39: relaxed the "where can the cursor be" rule. Originally
  // the cursor had to be exactly on the 4px seek bar or thin trim
  // mini — too tight, users thought the hotkey was broken. Now any
  // hover over the video's controls bar or video wrap counts, and a
  // pure-keyboard press (no cursor at all) also works as long as a
  // video is selected. The video-SELECTED check stays the primary
  // gate so i/o only trims the selected video.
  // Round 40: read the time from CURSOR X on the slider, not the
  // playhead. NLE convention — where you hover is where the mark
  // goes. Previously the second i press did nothing because the user
  // moved the cursor to a new position but the playhead hadn't
  // changed, so the handler wrote the same value back. Now the
  // cursor X drives the trim, so every press picks up the user's
  // new mark position. Pure-keyboard presses (no cursor) still fall
  // back to the playhead.
  // Active ONLY when:
  //   • No Ctrl/Meta/Alt modifier (so Ctrl+I/O still work for the browser)
  //   • Not typing in an INPUT / TEXTAREA / contenteditable
  //   • A video is the currently SELECTED item
  //   • The cursor is over the selected video (controls or wrap) OR
  //     there's no cursor at all (pure-keyboard press)
  // The cursor test uses document.elementFromPoint() because ev.target
  // on a keydown is the FOCUSED element (e.g. the play button), not
  // the element under the cursor.
  // Round 39: i/o trim hotkey — accepts cursor anywhere within the
  // SELECTED video's UI (controls bar, seek bar, trim mini bar, or the
  // video wrap itself). Round 34's stricter check ("cursor must be on
  // .media-seek-bar OR .media-trim-mini") silently failed when the
  // user's cursor was a few pixels off the 4px seek bar — the handler
  // exited and the user thought the hotkey was broken. The expanded
  // zone matches Premiere/Final Cut mental model: "if I'm hovering the
  // video player, i/o means trim in/out". The video SELECTED check is
  // still the primary gate — i/o only trims the selected video.
  if ((e.key === 'i' || e.key === 'I' || e.key === 'o' || e.key === 'O')
      && !e.ctrlKey && !e.metaKey && !e.altKey) {
    var aeIO = document.activeElement;
    if (aeIO && (aeIO.tagName === 'INPUT' || aeIO.tagName === 'TEXTAREA' ||
                 (aeIO.getAttribute && aeIO.getAttribute('contenteditable') === 'true'))) {
      // typing somewhere — let the i/o character be typed normally
    } else {
      // Find the selected video
      var vidItemIO = null;
      try {
        if (state && state.selected && state.items) {
          state.selected.forEach(function(id) {
            var it = state.items.find(function(i) { return i.id === id; });
            if (it && it.video && it.isVideo) { vidItemIO = it; }
          });
        }
      } catch (_eIO1) {}
      if (vidItemIO && vidItemIO.el) {
        // Accept cursor over ANY of the player's UI sub-areas. The
        // seek bar is only 4px tall, the trim mini is a thin strip —
        // requiring the user to land their cursor on those tiny targets
        // is a UX trap. The whole controls bar + the video wrap count.
        var seekBarIO   = vidItemIO.el.querySelector('.media-seek-bar');
        var trimMiniIO  = vidItemIO.el.querySelector('.media-trim-mini');
        var ctrlsIO     = vidItemIO.el.querySelector('.media-controls');
        var wrapIO      = vidItemIO.el.querySelector('.media-wrap');
        function _isInsideIO(container) {
          if (!container) return false;
          var node = null;
          try { node = document.elementFromPoint(e.clientX, e.clientY); } catch (_eX) { return false; }
          if (!node) return false;
          return node === container || container.contains(node);
        }
        var overTimeline = _isInsideIO(seekBarIO) || _isInsideIO(trimMiniIO)
                        || _isInsideIO(ctrlsIO)   || _isInsideIO(wrapIO);
        // Keyboard-without-cursor fallback: if no clientX/Y (e.g. key
        // pressed from the keyboard without moving the mouse), still
        // fire if a video is selected. The "selected video" check is
        // already our intent signal — the cursor test was only there
        // to disambiguate when multiple videos are on the board.
        var noCursor = (typeof e.clientX !== 'number' || typeof e.clientY !== 'number');
        if (overTimeline || noCursor) {
          // Cursor is over the timeline of the selected video — do the trim.
          e.preventDefault();
          e.stopPropagation();
          var mediaElIO = vidItemIO.video;
          if (isFinite(mediaElIO.duration) && mediaElIO.duration > 0) {
            try { if (!mediaElIO.paused) mediaElIO.pause(); } catch (_eP) {}
            var durIO = mediaElIO.duration;
            // Round 40: read the time from the CURSOR X on the slider
            // (seek bar or trim mini bar), falling back to the playhead.
            // NLE convention — Premiere/Final Cut/Avid all use "where I
            // hover = where the in/out goes" for I/O keyboard shortcuts.
            // The previous code always read `mediaElIO.currentTime`, which
            // produced this bug: on the first i press the cursor was at
            // the playhead, trim got set, all good. On the second press
            // the user moved the cursor to a new position on the slider
            // (intent: "mark this point as the new in") but the playhead
            // hadn't moved (no click-to-scrub in between), so the handler
            // read the OLD currentTime, set trim to the same value, and
            // the user concluded "i/o doesn't work after the first press".
            // The cursor-X path matches the user's mental model and lets
            // them re-mark the trim by simply moving the mouse to a new
            // position and pressing i/o — no scrubbing required.
            var tIO = null;
            if (!noCursor) {
              try {
                var nodeIO = document.elementFromPoint(e.clientX, e.clientY);
                function _tFromTrackIO(trackEl) {
                  if (!trackEl) return null;
                  var rect = trackEl.getBoundingClientRect();
                  if (rect.width <= 0) return null;
                  if (nodeIO !== trackEl && !trackEl.contains(nodeIO)) return null;
                  var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  return pct * durIO;
                }
                tIO = _tFromTrackIO(seekBarIO);
                if (tIO == null) tIO = _tFromTrackIO(trimMiniIO);
              } catch (_eTC) { tIO = null; }
            }
            if (tIO == null) tIO = Math.max(0, Math.min(durIO, mediaElIO.currentTime || 0));
            var whichIO = (e.key === 'i' || e.key === 'I') ? 'start' : 'end';
            if (whichIO === 'start') {
              var currentEndIO = (typeof vidItemIO.trimEnd === 'number') ? vidItemIO.trimEnd : durIO;
              vidItemIO.trimStart = Math.min(tIO, Math.max(0, currentEndIO - 0.05));
            } else {
              var currentStartIO = (typeof vidItemIO.trimStart === 'number') ? vidItemIO.trimStart : 0;
              vidItemIO.trimEnd = Math.max(tIO, Math.min(durIO, currentStartIO + 0.05));
            }
            // In-place UI refresh — we can't call the closure-local
            // refreshInPlayerTrimUI(), so replicate the bits we need
            // by querying the DOM directly. The timeupdate listener will
            // re-sync on the next playback tick, but this gives the user
            // immediate visual feedback (handle moves, region re-sizes,
            // time labels update, handle flashes cyan).
            try {
              var tsIO = (typeof vidItemIO.trimStart === 'number') ? vidItemIO.trimStart : 0;
              var teIO = (typeof vidItemIO.trimEnd === 'number') ? vidItemIO.trimEnd : durIO;
              if (teIO > durIO) teIO = durIO;
              if (tsIO < 0) tsIO = 0;
              if (teIO <= tsIO) teIO = durIO;
              var startPctIO = (tsIO / durIO) * 100;
              var endPctIO   = (teIO / durIO) * 100;
              // Mini bar
              var trimRegionIO = vidItemIO.el.querySelector('.media-trim-mini .trim-region');
              if (trimRegionIO) { trimRegionIO.style.left = startPctIO + '%'; trimRegionIO.style.width = (endPctIO - startPctIO) + '%'; }
              var trimStartInfoIO = vidItemIO.el.querySelector('.media-trim-mini .media-trim-info.start');
              var trimEndInfoIO   = vidItemIO.el.querySelector('.media-trim-mini .media-trim-info.end');
              if (trimStartInfoIO) trimStartInfoIO.textContent = formatTime(tsIO);
              if (trimEndInfoIO)   trimEndInfoIO.textContent   = formatTime(teIO);
              // Main seek bar
              var mainStartIO = vidItemIO.el.querySelector('.media-seek-track .trim-handle-start');
              var mainEndIO   = vidItemIO.el.querySelector('.media-seek-track .trim-handle-end');
              if (mainStartIO) mainStartIO.style.left = startPctIO + '%';
              if (mainEndIO)   mainEndIO.style.left   = endPctIO   + '%';
              var mainLeftIO  = vidItemIO.el.querySelector('.media-seek-track .trim-overlay-left');
              var mainRightIO = vidItemIO.el.querySelector('.media-seek-track .trim-overlay-right');
              if (mainLeftIO)  mainLeftIO.style.width  = startPctIO + '%';
              if (mainRightIO) { mainRightIO.style.left = endPctIO + '%'; mainRightIO.style.width = (100 - endPctIO) + '%'; }
            } catch (_eUI) {}
            // Flash the trim handle for visual confirmation
            try {
              var flashHandleIO = vidItemIO.el.querySelector('.media-trim-mini .trim-handle-' + whichIO);
              if (flashHandleIO) {
                flashHandleIO.classList.add('trim-handle-flash');
                setTimeout(function(){ try { flashHandleIO.classList.remove('trim-handle-flash'); } catch (_eFH) {} }, 450);
              }
            } catch (_eF) {}
            // Toast
            try {
              var vIO = (whichIO === 'start') ? vidItemIO.trimStart : vidItemIO.trimEnd;
              toast('Trim ' + whichIO + ' set to ' + formatTime(vIO));
            } catch (_eT) {}
            // Auto-save
            try { scheduleAutoSave(); } catch (_eS) {}
          }
        }
      }
    }
  }

  // Single keys
  if (e.key === 'v' || e.key === 'V') setTool('select');
  else if (e.key === 't' || e.key === 'T') {
    // Round 34: T is DOUBLE-MAPPED.
    //   • Main handler:  T → setTool('text') (canvas text mode)
    //   • Video handler:  T → enter video annotation text mode when
    //     the mouse is hovering over ANY video (selected or not).
    // v5.5: removed the selected.size > 0 requirement — hover alone
    // is enough. User shouldn't need to click-select first.
    var _hasVideoSelT = false;
    try {
      // Skip if the plain D/T handler already handled this keypress
      if (window.__kraftedTDKeyHandled) { return; }
      if (state && state.mouse) {
        var mouseEl = document.elementFromPoint(state.mouse.x, state.mouse.y);
        if (mouseEl) {
          // v5.5: only enter video text mode when the mouse is over the
          // actual VIDEO FRAME area (.media-wrap), NOT over the player's
          // toolbar UI. Previously, hovering over the toolbar buttons
          // (color picker, T/D, S/M/L size) would still register the
          // closest('.item.has-media') match — so the keyboard T would
          // hijack clicks meant for the toolbar. Now we require the
          // mouse to be on the video frame itself.
          var hitMediaWrap = mouseEl.closest('.media-wrap');
          if (hitMediaWrap && state.items) {
            // Find the video item whose el contains this media-wrap
            for (var ti = 0; ti < state.items.length; ti++) {
              if (_hasVideoSelT) break;
              var it = state.items[ti];
              if (it && (it.video || it.isVideo) && it.el && it.el.contains(hitMediaWrap) && it.el._annoDrawState) {
                _hasVideoSelT = true;
                // Toggle: if already in text mode, turn off; otherwise enter text mode
                if (it.el._annoDrawState.mode === 'text') {
                  it.el._annoDrawState.mode = 'off';
                } else {
                  it.el._annoDrawState.mode = 'text';
                }
                if (typeof it.el._applyDrawMode === 'function') it.el._applyDrawMode();
              }
            }
          }
        }
      }
    } catch (_eT) { /* fail-open: fall through */ }
    if (_hasVideoSelT) return;            // ← yield to video annotation text mode
    setTool('text');
  }
  // Review Mode: J/K — jump between video comments (like Premiere markers)
  // J = previous comment frame, K = next comment frame.
  // Works by detecting which video the mouse is hovering over — no need to
  // select the video first. Just hover + press J/K.
  else if (e.key === 'j' || e.key === 'J') {
    e.preventDefault();
    var _rvItem = videoAnnoGetItemUnderCursor(e);
    if (!_rvItem) { toast('Review Mode: hover over a video first'); return; }
    var _anno = videoAnnoEnsure(_rvItem);
    var _comms = (_anno && Array.isArray(_anno.comments)) ? _anno.comments : [];
    if (!_comms.length) { toast('Review Mode: no comments on this video'); return; }
    videoAnnoJumpToPrevComment(_rvItem);
  }
  else if (e.key === 'k' || e.key === 'K') {
    e.preventDefault();
    var _rvItem2 = videoAnnoGetItemUnderCursor(e);
    if (!_rvItem2) { toast('Review Mode: hover over a video first'); return; }
    var _anno2 = videoAnnoEnsure(_rvItem2);
    var _comms2 = (_anno2 && Array.isArray(_anno2.comments)) ? _anno2.comments : [];
    if (!_comms2.length) { toast('Review Mode: no comments on this video'); return; }
    videoAnnoJumpToNextComment(_rvItem2);
  }
  else if (e.key === 'e' || e.key === 'E') setTool('export');
  // NOTE: Draw tool is bound to Ctrl+D (and Ctrl+Shift+D = Duplicate) — see
  // the Ctrl block above. Plain D no longer activates Draw so typing "d"
  // in a text/comment input doesn't accidentally switch to draw mode.
  else if (e.key === 'c' || e.key === 'C') {
    // C = capture tool (always). Shift+C = captureScreen.
    // No longer yields to per-video comment handler — C is capture only.
    if (e.shiftKey) { captureScreen(); return; }
    setTool('capture');
  }
  else if (e.key === 'x' || e.key === 'X') setTool('cut');
  else if (e.key === 'l' || e.key === 'L') setTool('lasso');
  else if (e.key === 'm' || e.key === 'M') addMindMap();
  else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); setTool('relation'); }
  else if (e.key === 'g' || e.key === 'G') toggleGrid();
  else if (e.key === 'h' || e.key === 'H') {
    // H = help, Shift+H = frame selection (also available via F)
    if (e.shiftKey) {
      e.preventDefault();
      frameSelection();
    } else {
      showHelp();
    }
  }
  else if (e.key === 'f' || e.key === 'F') {
    // F = center/frame selection (restored to original behavior)
    // Shift+F = app-level fullscreen toggle
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (e.shiftKey) {
      toggleAppFullscreen();
    } else {
      frameSelection();
    }
  }
  // Ctrl+Shift+U / Cmd+Shift+U = Tidy selected items (masonry layout)
  else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'U' || e.key === 'u')) {
    e.preventDefault();
    tidySelection();
  }
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selectedRelation) { _deleteRelation(state.selectedRelation); return; }
    deleteSelected();
  }
  // Arrow nudge
  else if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
    e.preventDefault();
    const sel = getSelectedItems();
    if (sel.length === 0) return;
    const step = e.shiftKey ? 20 : 2;
    pushUndo();
    sel.forEach(item => {
      if (e.key === 'ArrowLeft') item.x -= step;
      if (e.key === 'ArrowRight') item.x += step;
      if (e.key === 'ArrowUp') item.y -= step;
      if (e.key === 'ArrowDown') item.y += step;
      updateItemStyle(item);
    });
    scheduleAutoSave();
  }
});

document.addEventListener('keyup', e => {
  if (e.key === ' ') { state.spaceDown = false; viewport.style.cursor = 'default'; }
});

// Close context menu on outside click
document.addEventListener('mousedown', e => {
  if (!e.target.closest('#ctx-menu')) hideCtx();
});
