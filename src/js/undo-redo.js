
import { state, G, canvasContent } from './core-state.js';;

// ============================================================
//  UNDO / REDO
// ============================================================
export function captureSnapshot() {
  const snap = {
    // R72: persist the current selection so undo doesn't visually
    // deselect everything. The user reported: after Ctrl+Z the
    // small panel (props) goes empty and the item loses its
    // highlight, even though the items are still there. We just
    // round-trip the IDs through Set serialization.
    selected: [...state.selected],
    items: state.items.map(i => ({
      id: i.id, x: i.x, y: i.y, w: i.w, h: i.h, rot: i.rot, opacity: i.opacity,
      flipH: i.flipH, flipV: i.flipV, locked: i.locked, z: i.z,
      type: i.type || undefined,
      strokeId: i.strokeId, drawMode: i.drawMode, drawColor: i.drawColor,
      drawSize: i.drawSize, drawOpacity: i.drawOpacity, drawArrowHead: i.drawArrowHead,
      src: i.src, natW: i.natW, natH: i.natH, isVideo: i.isVideo || false, isGif: i.isGif || false, isAudio: i.isAudio || false,
      audioName: i.audioName || i.filename || '',
      // Original file name (if known) — used by video frame-comment
      // export to name the output file and to display in the exported
      // header. Empty when not available.
      filename: i.filename || i.audioName || '',
      cropX: i.cropX, cropY: i.cropY, cropW: i.cropW, cropH: i.cropH,
      brightness: i.brightness, contrast: i.contrast, saturate: i.saturate,
      hueRotate: i.hueRotate, blur: i.blur, sepia: i.sepia, grayscale: i.grayscale,
      temp: i.temp, vignette: i.vignette, shadow: i.shadow, highlight: i.highlight, grain: i.grain,
      trimStart: i.trimStart || 0, trimEnd: i.trimEnd || 0, playbackRate: i.playbackRate || 1,
      isLink: i.isLink || false, linkUrl: i.linkUrl || '', linkTitle: i.linkTitle || '', linkDesc: i.linkDesc || '',
      // Video annotation data (frame-by-frame comments only — draw was removed)
      anno: i.anno && Array.isArray(i.anno.comments) ? {
        comments: i.anno.comments.map(c => ({
          id: c.id, frame: c.frame || 0, time: c.time || 0,
          text: c.text || '',
          translation: c.translation || '',
          translationDir: c.translationDir || '',
          // R73: persist the captured snapshot (base64 data URL) and the
          // per-frame annotation strokes. Without these the comment list
          // shows a "—" placeholder and the lightbox shows "No snapshot"
          // after undo, because the renderer at line ~6514 and the
          // lightbox at line ~11211 both read c.snapshot / c.annoStrokes
          // directly. Snapshots are tens of KB each, which is acceptable
          // for a 50-entry undo stack on desktop.
          snapshot: c.snapshot || '',
          annoStrokes: (c.annoStrokes || []).filter(Boolean).map(s => ({
            type: s.type, color: s.color, size: s.size,
            points: (s.points || []).map(p => [p[0], p[1]]),
            text: s.text || '',
          })),
          // Preserve user-edited state too so undo round-trips edits
          originalText: c.originalText || '',
        })),
      } : null,
      // R85: also snapshot the live strokesByFrame for undo/redo parity
      // with the kpak save path. Without this, draw/text strokes added
      // after the last comment are lost on undo/redo.
      _annoStrokesByFrame: (function(){
        if (!i.isVideo || !i.el || !i.el._annoDrawState) return null;
        var sbf = i.el._annoDrawState.strokesByFrame;
        if (!sbf) return null;
        var out = {};
        Object.keys(sbf).forEach(function(f){
          if (sbf[f] && sbf[f].length) {
            out[f] = sbf[f].map(function(s){
              return { type:s.type, color:s.color, size:s.size, points:(s.points||[]).map(function(p){return[p[0],p[1]]}), text:s.text||'' };
            });
          }
        });
        return Object.keys(out).length ? out : null;
      })(),
      masks: (i.masks || []).map(m => ({ id: m.id, name: m.name, enabled: m.enabled, type: m.type, color: m.color, tolerance: m.tolerance, feather: m.feather, brushData: m.brushData, brushSize: m.brushSize, brightness: m.brightness, contrast: m.contrast, saturate: m.saturate, temp: m.temp, shadow: m.shadow, highlight: m.highlight, hueRotate: m.hueRotate, sepia: m.sepia, tintColor: m.tintColor, tintStrength: m.tintStrength })),
    })),
    texts: state.texts.map(t => ({
      id: t.id, x: t.x, y: t.y, w: t.w, h: t.h, z: t.z,
      font: t.font, size: t.size, bold: t.bold, italic: t.italic,
      underline: t.underline, strike: t.strike, highlight: t.highlight,
      shadow: t.shadow, bg: t.bg, outline: t.outline, uppercase: t.uppercase,
      color: t.color, highlightColor: t.highlightColor, align: t.align,
      // Save innerHTML (preserves inline <span style="color:.."> from per-word recolor)
      // Falls back to textContent on restore for old data
      html: t.el ? t.el.innerHTML : '',
      content: t.el ? t.el.textContent : '',
      // Remember user-resized state so autoGrow respects the width on reload
      userResized: t.userResized || false,
    })),
    todos: (state.todos||[]).map(t => ({
      id: t.id, x: t.x, y: t.y, w: t.w, h: t.h, z: t.z,
      rot: t.rot || 0, opacity: t.opacity !== undefined ? t.opacity : 1, locked: t.locked || false,
      title: t.title || '', items: (t.items||[]).map(it => ({ text: it.text, done: it.done })),
    })),
    mindmaps: (state.mindmaps||[]).map(m => ({
      id: m.id, x: m.x, y: m.y, w: m.w, h: m.h, z: m.z,
      rot: m.rot || 0, opacity: m.opacity !== undefined ? m.opacity : 1, locked: m.locked || false,
      title: m.title || '', nodes: (m.nodes||[]).map(n => ({ id: n.id, text: n.text, x: n.x, y: n.y, w: n.w, h: n.h, color: n.color, textColor: n.textColor, parentId: n.parentId || null, img: n.img || null, imgW: n.imgW || 0, imgH: n.imgH || 0, audio: n.audio || null, audioName: n.audioName || null })),
      connections: (m.connections||[]).map(c => ({ id: c.id, from: c.from, to: c.to, color: c.color })),
      nextNodeId: m.nextNodeId || 1, nextConnId: m.nextConnId || 1,
    })),
    groups: state.groups.map(g => ({
      id: g.id, color: g.color, memberIds: [...g.memberIds],
    })),
    drawStrokes: G.drawStrokes,
    relations: (state.relations || []).map(function(r) { return { id: r.id, fromId: r.fromId, toId: r.toId, fromAnchor: r.fromAnchor, toAnchor: r.toAnchor, label: r.label || '', style: r.style || 'orthogonal', color: r.color || '#00e5ff', lineWidth: r.lineWidth || 6, labelSize: r.labelSize || 16 }; }),
    nextZ: G.nextZ, nextId: G.nextId, nextGroupId: G.nextGroupId, nextStrokeId: G.nextStrokeId,
  };
  return JSON.stringify(snap);
}
export function pushUndo() {
  state.undoStack.push(captureSnapshot());
  // v5.5.1: cap undo history at 100 steps to prevent memory bloat
  // on long sessions with large boards (each snapshot can be 1-5MB+)
  while (state.undoStack.length > 100) state.undoStack.shift();
  state.redoStack = [];
  updateStatus();
}
export function restoreSnapshot(snapStr) {
  const snap = JSON.parse(snapStr);
  // Remove all current items
  cleanupAllItems();
  state.items = [];
  state.texts = [];
  state.todos = [];
  state.mindmaps = [];
  state.selected.clear();
  G.nextZ = snap.nextZ;
  G.nextId = snap.nextId;
  G.nextStrokeId = snap.nextStrokeId || G.nextStrokeId;
  G.nextGroupId = snap.nextGroupId || G.nextGroupId;
  // Restore draw strokes (snapshot keeps flat array; legacy drawLayers is already collapsed in saveBoard)
  G.drawStrokes = Array.isArray(snap.drawStrokes) ? snap.drawStrokes: Array.isArray(snap.drawLayers) ? snap.drawLayers.flatMap(l => l.strokes || [])
              : [];
  // Restore items
  snap.items.forEach(data => {
    if (data.videoLost || (data.isVideo && !data.src)) return;
    if (data.type === 'draw') {
      const el = document.createElement('div');
      el.className = 'item draw-item';
      el.style.cssText = 'background:transparent;border:none;pointer-events:auto;';
      canvasContent.appendChild(el);
      const item = { ...data, el };
      state.items.push(item);
      updateItemStyle(item);
      return;
    }
    if (data.isLink) {
      // Link card item — use dedicated rebuild function
      const el = document.createElement('div');
      el.className = 'item link-card';
      canvasContent.appendChild(el);
      const item = { ...data, el, img: null, video: null };
      state.items.push(item);
      rebuildLinkCard(item);
      updateItemStyle(item);
      return;
    }
    // Round 53: audio items (wav/mp3/aiff/flac/ogg/m4a) need the
    // custom player UI (play button + seek bar + volume). The generic
    // <img> path below would silently drop the <audio> element and
    // produce a broken phantom, so route to addAudioItem which builds
    // the real player. Also handles blob-URL expiration (refresh / new
    // tab) the same way the paste path does.
    if (data.isAudio) {
      const _audioBlobOk = data.src && (data.src.startsWith('data:') || (data.src.startsWith('blob:') && _isBlobUrlLive(data.src)));
      if (!_audioBlobOk) {
        try { toast('Audio source expired — re-add the file to undo this'); } catch (e) {}
        return;
      }
      const audioItem = addAudioItem(data.src, data.audioName || 'Audio', data.x, data.y);
      Object.assign(audioItem, {
        w: data.w, h: data.h, rot: data.rot, opacity: data.opacity,
        flipH: data.flipH, flipV: data.flipV, locked: data.locked,
        z: data.z, src: data.src, natW: data.natW, natH: data.natH,
        isAudio: true, audioName: data.audioName || 'Audio',
        filename: data.filename || '',
      });
      try { if (audioItem.audio) audioItem.audio.playbackRate = data.playbackRate || 1; } catch (e) {}
      updateItemStyle(audioItem);
      return;
    }
    const el = document.createElement('div');
    el.className = 'item';
    let mediaEl;
    if (data.isVideo) {
      mediaEl = document.createElement('video');
      mediaEl.src = data.src;
      mediaEl.playsInline = true;
      mediaEl.loop = true;
      mediaEl.muted = true;
      mediaEl.preload = 'metadata';  // v5.5: metadata-only to avoid memory spike on undo/redo
      // Round 58: restore manual FPS override from snapshot. Must happen
      // BEFORE buildMediaControls so the loadedmetadata handler sees
      // _kraftedFps already set and skips auto-detect (its `if (!mediaEl._kraftedFps)`
      // guard means a pre-set value wins). Same for the manual flag so
      // the chip renders in manual mode (amber ✎) instead of auto (cyan •).
      if (data.fps) mediaEl._kraftedFps = data.fps;
      if (data.fpsManual) mediaEl._kraftedFpsManual = true;
      // R72: restore the playhead position the user was at, and
      // resume playback if they had it playing. Without this, undo
      // would jump the new <video> back to 0 and pause it — the user
      // reported "the mov player will close" because the video that
      // was playing at 1:23 suddenly became a frozen 0:00 frame.
      // The saved currentTime wins over the legacy 0.1 nudge below.
      const _savedT = (typeof data.currentTime === 'number' && isFinite(data.currentTime) && data.currentTime >= 0) ? data.currentTime : null;
      const _shouldPlay = !!data.wasPlaying;
      mediaEl.addEventListener('loadedmetadata', () => {
        try {
          if (_savedT !== null && _savedT >= 0.05) {
            mediaEl.currentTime = _savedT;
          } else if (mediaEl.currentTime < 0.05) {
            mediaEl.currentTime = 0.1;
          }
        } catch (e) {}
        if (_shouldPlay) {
          // .play() returns a promise; swallow autoplay rejections.
          try { mediaEl.play().catch(() => {}); } catch (e) {}
        }
      });
    } else {
      mediaEl = document.createElement('img');
      mediaEl.src = data.src;
    }
    mediaEl.draggable = false;
    const needsWrap = data.isVideo || data.isGif;
    if (needsWrap) {
      buildMediaControls(el, mediaEl, data.isVideo, data.isGif);
    } else {
      if (data.isVideo) {
        mediaEl.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;background:#000;object-fit:contain;';
      } else {
        mediaEl.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;';
      }
      el.appendChild(mediaEl);
    }
    canvasContent.appendChild(el);
    const item = { ...data, el, img: data.isVideo ? null : mediaEl, video: data.isVideo ? mediaEl : null };
    state.items.push(item);
    el._item = item; // stash so buildMediaControls closures can find this item
    updateItemStyle(item);
    if (data.isVideo && el._refreshAnnoBadges) {
      try { el._refreshAnnoBadges(); } catch (e) {}
    }
    // Video play/pause on double-click + trim setup
    if (data.isVideo) {
      setupVideoTrim(item);
      el.addEventListener('dblclick', () => {
        if (mediaEl.paused) { mediaEl.muted = false; mediaEl.play(); } else { mediaEl.pause(); }
      });
    }
  });
  // Restore texts
  snap.texts.forEach(data => {
    const el = document.createElement('div');
    el.className = 'text-item';
    el.contentEditable = true;
    el.spellcheck = false;
    el.setAttribute('data-placeholder', 'Type here...');
    // Restore innerHTML if available (preserves inline <span style="color:.."> for
    // per-word recolor). Fall back to textContent for older save data.
    if (data.html && data.html.trim()) {
      // Sanitize: strip <script>, on* attributes, javascript: URLs.
      // contenteditable only allows inline formatting tags so the surface is
      // already narrow; we still belt-and-suspenders with a tiny allowlist.
      el.innerHTML = sanitizeTextHtml(data.html);
    } else if (data.content) {
      el.textContent = data.content;
    }
    canvasContent.appendChild(el);
    const tx = { ...data, el };
    delete tx.content;
    delete tx.html;
    state.texts.push(tx);
    applyTextProps(tx);
    updateItemStyle(tx);
  // Auto-grow on input
  el.addEventListener('input', () => autoGrowTextItem(tx));
  el.addEventListener('focus', () => { el.classList.add('editing'); showTextQuickBar(true); updateTextQuickBarActive(); });
  el.addEventListener('blur', () => {
      el.classList.remove('editing');
      showTextQuickBar(false);
      if (!el.textContent.trim()) {
        el.remove();
        const hCont = canvas.querySelector('.text-handles[data-owner="' + tx.id + '"]');
        if (hCont) hCont.remove();
        state.texts = state.texts.filter(t => t.id !== tx.id);
        clearSelection();
      } else {
        autoGrowTextItem(tx);
      }
      if (state.tool === 'text') setTool('select');
      scheduleAutoSave();
    });
    // Initial auto-grow after render
    setTimeout(() => autoGrowTextItem(tx), 50);
  });
  // Restore todos
  state.todos = [];
  (snap.todos || []).forEach(data => {
    const el = document.createElement('div');
    el.className = 'todo-item';
    canvasContent.appendChild(el);
    const todo = {
      ...data, el,
      items: (data.items || []).map(it => ({ text: it.text || '', done: !!it.done })),
    };
    state.todos.push(todo);
    renderTodo(todo);
    updateItemStyle(todo);
  });
  // Restore mindmaps
  state.mindmaps = [];
  (snap.mindmaps || []).forEach(data => {
    const el = document.createElement('div');
    el.className = 'mindmap-item';
    canvasContent.appendChild(el);
    const mm = {
      ...data, el,
      nodes: (data.nodes || []).map(n => ({ ...n })),
      connections: (data.connections || []).map(c => ({ ...c })),
    };
    state.mindmaps.push(mm);
    renderMindMap(mm);
    updateItemStyle(mm);
  });
  // Restore groups
  state.groups.forEach(g => g.borderEl.remove());
  state.groups = [];
  if (snap.groups) {
    G.nextGroupId = snap.nextGroupId || G.nextGroupId;
    snap.groups.forEach(gd => {
      const borderEl = document.createElement('div');
      borderEl.className = 'group-border';
      borderEl.style.borderColor = gd.color;
      canvasContent.appendChild(borderEl);
      state.groups.push({ id: gd.id, color: gd.color, memberIds: new Set(gd.memberIds), borderEl });
    });
    setTimeout(() => updateAllGroupBorders(), 100);
  }
  // R72: restore the selection that was active when this snapshot was
  // taken. The IDs round-trip cleanly because all item arrays were
  // rebuilt with the same IDs above. Without this, undo would visually
  // deselect everything — the small panel (props) goes back to the
  // empty state, the resize handles vanish, the video loses its
  // highlight, and the user thinks "the mov player will close" / "all
  // functions are abnormal". A stale ID in the saved set (e.g. a text
  // item that was just deleted) is harmless — it just won't match
  // anything in the rebuilt state and gets dropped on refreshSelection.
  state.selected = new Set(Array.isArray(snap.selected) ? snap.selected : []);
  refreshSelection();
  // Re-render draw strokes (draw item DOMs were rebuilt above)
  redrawDrawLayer();
  // Restore relation lines from snapshot
  state.relations = (snap.relations || []).map(function(r) { return { id: r.id, fromId: r.fromId, toId: r.toId, fromAnchor: r.fromAnchor, toAnchor: r.toAnchor, label: r.label || '', style: r.style || 'orthogonal', color: r.color || '#00e5ff', lineWidth: r.lineWidth || 3, labelSize: r.labelSize || 16 }; });
  state.selectedRelation = null;
  renderRelations();
  scheduleAutoSave();
  updateAutoFitPaper();
  // R73: re-render the frame-comment list for any video item that has
  // annotation data. Without this, after Ctrl+Z the comment list still
  // shows the OLD comment objects (with snapshot data) even though the
  // rebuilt state.items now have the restored comments — leading to a
  // mix where some thumbnails look fine (the old DOM) and others go
  // blank (when the list is rebuilt from scratch). Call the per-item
  // refresh hook for every video so all popovers/list panels update.
  try {
    state.items.forEach(it => {
      if (it && it.isVideo && it.anno && it.el) {
        if (typeof videoAnnoRefreshCommentList === 'function') {
          videoAnnoRefreshCommentList(it);
        }
        if (it.el._refreshListBody) it.el._refreshListBody();
        if (it.el._refreshAnnoBadges) it.el._refreshAnnoBadges();
        if (it.el._refreshSeekMarkers) it.el._refreshSeekMarkers();
      }
    });
  } catch (e) { /* non-fatal */ }
}
export function undo() {
  if (state.undoStack.length === 0) return;
  state.redoStack.push(captureSnapshot());
  restoreSnapshot(state.undoStack.pop());
  updateStatus();
}
export function redo() {
  if (state.redoStack.length === 0) return;
  state.undoStack.push(captureSnapshot());
  restoreSnapshot(state.redoStack.pop());
  updateStatus();
}
