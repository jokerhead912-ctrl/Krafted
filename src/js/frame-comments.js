import { images, kraftedSaveFile, triggerDownload } from './init.js';
import { updateAutoFitPaper } from './paper.js';
import { clearSelection, getSelectedImages, getSelectedItems, refreshSelection, selectOnly } from './selection.js';
import { translateText } from './translation.js';
import { state, canvasContent, canvas, toastEl } from './core-state.js';

import { captureSnapshot, pushUndo, undo } from './undo-redo.js';
import { updateCanvas, updateStatus } from './canvas-view.js';
import { state, viewport } from './core-state.js';
import { getCurrentFps, updateVideoPlayhead, updateVideoTimeline } from './video-trim.js';
import { addImage, addText, autoGrowTextItem, updateItemStyle } from './add-items.js';
import { scheduleAutoSave } from './save-load.js';
import { toast } from './ui-utils.js';

// ============================================================
//  VIDEO FRAME COMMENTS — per-frame text annotations (DRAW removed)
// ============================================================
//
// Per-video annotation data lives on `item.anno`:
//   anno = {
//     comments: [{ id, frame, time, text, translation, translationDir, createdAt }],
//   }
//
// Comments model:
//   - Each comment is anchored to a specific frame number (not pixel coords).
//   - Clicking a comment in the list popover seeks the video to that frame
//     and pauses, so the user can see the frame.
//   - Translation is opt-in: `translation` field holds the auto-translated
//     text in the opposite script (zh↔en). Toggle button per comment.
//
// (Drawing model removed per user request: "remove the draw funtion on the
// mp4..it very bad". Strokes / texts / mode are no longer tracked.)

export const videoAnno = {
  item: null,           // currently selected video item
};

export function videoAnnoGetSelected() {
  // Returns the currently selected video item (or null)
  const sel = getSelectedImages();
  return (sel.length === 1 && sel[0].isVideo) ? sel[0] : null;
}

export function videoAnnoEnsure(item) {
  if (!item.anno) {
    item.anno = { comments: [] };
  }
  // Backfill: if the item was annotated before the comments feature, the
  // comments array may be missing. Don't clobber existing data.
  if (!Array.isArray(item.anno.comments)) item.anno.comments = [];
  return item.anno;
}

// No-op stub kept for any callers that still reference videoAnnoRedraw.
// (The draw canvas was removed; there is nothing to redraw now.)
export function videoAnnoRedraw(_item) { /* no-op: draw function removed */ }

export function videoAnnoSetMode(_mode) { /* no-op: draw mode removed */ }
export function videoAnnoSetColor(_c)   { /* no-op: draw color removed */ }
export function videoAnnoSetSize(_s)    { /* no-op: draw size removed */ }
export function videoAnnoClear()        { toast('Nothing to clear (draw removed)'); }
export function videoAnnoUndo()         { toast('Nothing to undo (draw removed)'); }

// (DRAW FUNCTIONS REMOVED: videoAnnoRedraw, videoAnnoSetMode, videoAnnoSetColor,
//  videoAnnoSetSize, videoAnnoLocalCoords, videoAnnoAttachPointer,
//  videoAnnoDropText — all replaced by no-op stubs above)

// ─── FRAME COMMENTS ──────────────────────────────────────────────
// Comments are saved per video, anchored to a frame number. Click any
// comment in the right-panel list to seek back to its frame.

export function videoAnnoGetCurrentFrame() {
  const item = videoAnnoGetSelected();
  if (!item || !item.video) return 0;
  const v = item.video;
  const fps = (typeof getCurrentFps === 'function') ? getCurrentFps() : (v._kraftedFps || 30);
  return Math.max(0, Math.floor((v.currentTime || 0) * fps));
}

export function videoAnnoAddComment(text, targetItem) {
  const t = (text || '').trim();
  // Empty text is allowed — user can add a snap-only frame comment
  // Round 13 fix: allow caller to pass in a specific item so the popover
  // (which belongs to ONE video) can add to its own video instead of
  // whichever video happens to be selected at click time. With multiple
  // videos on the board, videoAnnoGetSelected() can return a different
  // video than the one the popover is anchored to, and the comment
  // would silently land on the wrong one.
  const item = targetItem || videoAnnoGetSelected();
  if (!item) { toast('Select a video first'); return; }
  if (!item.video) { toast('Video not ready yet — wait for it to load'); return; }
  const anno = videoAnnoEnsure(item);
  const fps = (typeof getCurrentFps === 'function') ? getCurrentFps() : (item.video._kraftedFps || 30);
  const frame = Math.max(0, Math.floor((item.video.currentTime || 0) * fps));
  // ── Capture a snapshot of the current video frame ──
  // The user wants each comment to travel with a small image of the
  // frame it's anchored to, so they can show suppliers exactly which
  // frame they're talking about. We grab a JPEG of the current frame
  // from the <video> element via canvas.drawImage. The snapshot is
  // embedded as a base64 data URL directly on the comment object.
  // If the user drew annotations on the frame via the Draw tool, we
  // composite them onto the snapshot here so the comment travels with
  // both the frame AND the markup.
  const drawState = (item.el && item.el._annoDrawState) || null;
  // Round 9: capture comments at video native resolution (was 800px).
  // The user reported snapshots looked blurry/low-res — the root cause
  // was downscaling a 1080p/4K source to a fixed 800px cap. Now we pass
  // maxW=0 so videoAnnoCaptureSnapshot uses the video's full native
  // dimensions, keeping strokes + text sharp.
  const SNAPPY_SNAP_MAX_W = 0;
  // Round 10 + R86 fix: use the already-computed `frame` from the target
  // video (line above) instead of videoAnnoGetCurrentFrame() which uses
  // videoAnnoGetSelected() — with multiple MOV players on the board the
  // selected video may be different from the target, causing strokes from
  // the wrong frame to be captured (empty or mismatched).
  const _frame = frame;
  const strokes = (drawState && drawState.strokesByFrame) ? (drawState.strokesByFrame[_frame] || []) : [];
  let snapshot = '';
  try {
    snapshot = videoAnnoCaptureSnapshot(item.video, SNAPPY_SNAP_MAX_W, strokes);
  } catch (e) {
    console.warn('Snapshot capture failed:', e);
  }
  pushUndo();
  anno.comments.push({
    id: 'c-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    frame: frame,
    time: item.video.currentTime || 0,
    text: t,
    translation: '',
    translationDir: '',
    createdAt: Date.now(),
    snapshot: snapshot,
    // Stroke data is stored as normalized [0,1] coords so it can be
    // re-rendered at any size (thumbnail, lightbox, export). Strokes
    // are kept on the comment as the source of truth for re-renders.
    annoStrokes: strokes.map(s => ({
      type: s.type, color: s.color, size: s.size,
      points: s.points.map(p => [p[0], p[1]]),
      text: s.text || '',
    })),
  });
  // Keep the list sorted by frame (so the timeline view makes sense)
  anno.comments.sort((a, b) => a.frame - b.frame);
  scheduleAutoSave();
  videoAnnoRefreshCommentList(item, anno.comments[anno.comments.length - 1].id);
  // After saving, clear the current strokes and exit draw mode so the
  // next comment starts from a clean slate (the saved strokes live on
  // the comment object now).
  if (drawState) {
    drawState.strokes = [];
    if (item.el._refreshDrawBtnBadge) item.el._refreshDrawBtnBadge();
    if (item.el._renderAnnoCanvas) item.el._renderAnnoCanvas();
    if (item.el._exitDrawMode) item.el._exitDrawMode();
  }
  // Auto-scroll the in-player list to the new comment so the user can see it
  const listEl = (item.el && item.el._annoCommentsList) || document.getElementById('video-anno-comments-list');
  if (listEl) {
    // Round 28: try the new data-cid first (popover cards), then fall
    // back to the legacy data-anno-comment-id (older in-player list).
    const newId = anno.comments[anno.comments.length - 1].id;
    let newEl = listEl.querySelector('[data-cid="' + newId + '"]');
    if (!newEl) newEl = listEl.querySelector('[data-anno-comment-id="' + newId + '"]');
    if (newEl && newEl.scrollIntoView) newEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  // Stage B: refresh the unified list popover and the FAB badge, and
  // auto-open the list popover (so the user immediately sees their new
  // comment with its snapshot thumbnail). The popover is now persistent
  // — it stays open after this.
  if (item.el) {
    if (item.el._refreshListBody) item.el._refreshListBody();
    if (item.el._refreshAnnoBadges) item.el._refreshAnnoBadges();
    if (item.el._refreshSeekMarkers) item.el._refreshSeekMarkers();
    // Round 10: also refresh the drawing markers (the strokes just
    // got saved onto the comment, so the marker is still there but
    // any new strokes on a fresh frame will now show up too).
    if (item.el._refreshDrawSeekMarkers) {
      try { item.el._refreshAllSeekMarkers(); } catch (e) {}
    }
    if (item.el._setListOpen) item.el._setListOpen(true);
    // Re-position so the popover auto-grows when crossing the 4-comment
    // threshold (see _positionPopover for the size formula).
    if (item.el._repositionAnnoPopovers) item.el._repositionAnnoPopovers();
  }
  const annoNote = strokes.length > 0
    ? ' (with ' + strokes.length + ' annotation' + (strokes.length === 1 ? '' : 's') + ')'
    : '';
  toast('Comment added at frame ' + frame + annoNote);
}

// ── Capture a snapshot of the video at the current frame ──
// Returns a JPEG data URL (e.g. "data:image/jpeg;base64,...") at the
// given max-width. Used by videoAnnoAddComment (per-comment) and
// videoAnnoExportComments (per-comment, with higher res if needed).
//
// If `strokes` is passed, the snapshot is composited with the user's
// annotations drawn on top — so the snapshot+strokes travel together
// as a single self-contained image (no overlay needed at view time).
// `strokes` is an array of {type, color, size, points} where points
// are normalized to [0,1] (relative to the captured frame).
export function videoAnnoCaptureSnapshot(videoEl, maxW, strokes) {
  if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) return '';
  // Don't try to capture before the video has data
  if (videoEl.readyState < 2) return '';
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  // Use the video's native resolution as the floor — never downscale
  // below the source dimensions. Passing maxW=0 means "no downscale at
  // all" (the captured snapshot is 1:1 with the video source). This
  // keeps annotations crisp and text legible in the comment list.
  const effectiveMaxW = Math.max(maxW || 0, w);
  const ratio = Math.min(1, effectiveMaxW / w);
  const cw = Math.max(2, Math.round(w * ratio));
  const ch = Math.max(2, Math.round(h * ratio));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  // Letterbox the image so the snapshot isn't stretched
  const vRatio = w / h;
  const cRatio = cw / ch;
  let dx = 0, dy = 0, dw = cw, dh = ch;
  if (vRatio > cRatio) {
    // Source is wider — fit by width, letterbox top/bottom
    dh = cw / vRatio;
    dy = (ch - dh) / 2;
  } else {
    // Source is taller — fit by height, pillarbox left/right
    dw = ch * vRatio;
    dx = (cw - dw) / 2;
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cw, ch);
  try { ctx.drawImage(videoEl, dx, dy, dw, dh); } catch (e) { return ''; }
  // ── Composite user-drawn annotations on top of the snapshot ──
  // Strokes are stored in normalized [0,1] coords (relative to the
  // captured frame). We map them onto the canvas using the same
  // letterboxed region the snapshot occupies so arrows line up with
  // the visual content even though the canvas is letterboxed.
  if (strokes && strokes.length > 0 && dw > 0 && dh > 0) {
    // Compute the "content rect" inside the canvas (the region the
    // actual video pixel data occupies, after letterboxing). Strokes
    // use coords inside this content rect, not the full canvas.
    try {
      ctx.save();
      // Clip to the content rect so strokes don't bleed into the
      // black letterbox bars
      ctx.beginPath();
      ctx.rect(dx, dy, dw, dh);
      ctx.clip();
      // Translate so stroke (0,0) maps to content top-left
      ctx.translate(dx, dy);
      // Scale so stroke (1,1) maps to content bottom-right
      const sx = dw, sy = dh;
      strokes.forEach(stk => {
        if (!stk || !stk.points || stk.points.length === 0) return;
        ctx.strokeStyle = stk.color || '#ff4444';
        ctx.fillStyle = stk.color || '#ff4444';
        // Scale stroke width so it stays visible at the export size —
        // strokes were drawn at the on-screen pixel size; on a small
        // export they should be proportionally smaller.
        const sw = Math.max(1, (stk.size || 4) * Math.min(sx, sy) / 400);
        ctx.lineWidth = sw;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // Convert normalized pts → pixel pts in the content rect
        const pts = stk.points.map(p => [p[0] * sx, p[1] * sy]);
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
          const angle = Math.atan2(y1 - y0, x1 - x0);
          const headLen = Math.max(8, sw * 3.2);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 - headLen * Math.cos(angle - Math.PI / 6), y1 - headLen * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(x1 - headLen * Math.cos(angle + Math.PI / 6), y1 - headLen * Math.sin(angle + Math.PI / 6));
          ctx.closePath();
          ctx.fill();
        } else if (stk.type === 'box') {
          if (pts.length < 2) return;
          const [bx0, by0] = pts[0];
          const [bx1, by1] = pts[pts.length - 1];
          ctx.strokeRect(Math.min(bx0, bx1), Math.min(by0, by1), Math.abs(bx1 - bx0), Math.abs(by1 - by0));
        } else if (stk.type === 'circle') {
          if (pts.length < 2) return;
          const [cx0, cy0] = pts[0];
          const [cx1, cy1] = pts[pts.length - 1];
          const ccx = (cx0 + cx1) / 2, ccy = (cy0 + cy1) / 2;
          const crx = Math.max(0.5, Math.abs(cx1 - cx0) / 2);
          const cry = Math.max(0.5, Math.abs(cy1 - cy0) / 2);
          ctx.beginPath();
          ctx.ellipse(ccx, ccy, crx, cry, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (stk.type === 'text') {
          const [tx, ty] = pts[0];
          const txt = (stk.text || '').trim();
          if (!txt) return;
          const fontSize = Math.max(10, (stk.size || 4) * 4);
          ctx.font = '600 ' + fontSize + 'px -apple-system, "SF Pro Display", system-ui, sans-serif';
          ctx.textBaseline = 'top';
          const metrics = ctx.measureText(txt);
          const padX = 5, padY = 3;
          const bgW = metrics.width + padX * 2;
          const bgH = fontSize * 1.15 + padY * 2;
          ctx.save();
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          const rx = 4;
          ctx.beginPath();
          ctx.moveTo(tx + rx, ty);
          ctx.lineTo(tx + bgW - rx, ty);
          ctx.quadraticCurveTo(tx + bgW, ty, tx + bgW, ty + rx);
          ctx.lineTo(tx + bgW, ty + bgH - rx);
          ctx.quadraticCurveTo(tx + bgW, ty + bgH, tx + bgW - rx, ty + bgH);
          ctx.lineTo(tx + rx, ty + bgH);
          ctx.quadraticCurveTo(tx, ty + bgH, tx, ty + bgH - rx);
          ctx.lineTo(tx, ty + rx);
          ctx.quadraticCurveTo(tx, ty, tx + rx, ty);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          ctx.fillStyle = stk.color || '#fff';
          ctx.fillText(txt, tx + padX, ty + padY);
        }
      });
      ctx.restore();
    } catch (e) {
      // If compositing fails for any reason, fall through and return
      // the raw snapshot — never block the user from saving a comment.
      try { ctx.restore(); } catch (e2) {}
      console.warn('Stroke compositing failed:', e);
    }
  }
  try {
    // JPEG at 0.82 quality — bumped from 0.78 so the annotations stay
    // legible in the export. Strokes are vector-ish so JPEG artifacts
    // around them are more visible than around a photo.
    return c.toDataURL('image/jpeg', 0.82);
  } catch (e) {
    return '';
  }
}

// ── Global helper: render an array of strokes onto any 2D context ──
// Used by the video export to bake per-frame drawings into the
// exported .webm. The same logic is also used by videoAnnoCaptureSnapshot
// (which has its own inline version with extra letterboxing handling).
// This global version is a flat, no-letterbox renderer that just draws
// the strokes into the supplied context with normalized [0,1] coords
// mapped to the given (cw, ch) dimensions. The caller is responsible
// for clearing / transform / clip if they need letterboxing.
export function _renderStrokesToCtx(ctx, strokes, cw, ch) {
  if (!ctx || !strokes || strokes.length === 0) return;
  strokes.forEach(stk => {
    if (!stk || !stk.points || stk.points.length === 0) return;
    ctx.strokeStyle = stk.color || '#ff4444';
    ctx.fillStyle = stk.color || '#ff4444';
    const sw = Math.max(1, (stk.size || 4));
    ctx.lineWidth = sw;
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
      const angle = Math.atan2(y1 - y0, x1 - x0);
      const headLen = Math.max(10, sw * 3.2);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - headLen * Math.cos(angle - Math.PI / 6), y1 - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(x1 - headLen * Math.cos(angle + Math.PI / 6), y1 - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    } else if (stk.type === 'box') {
      if (pts.length < 2) return;
      const [x0, y0] = pts[0];
      const [x1, y1] = pts[pts.length - 1];
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    } else if (stk.type === 'circle') {
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
      // R86: render text annotations into export/composited output
      const [tx, ty] = pts[0];
      const txt = (stk.text || '').trim();
      if (!txt) return;
      const fontSize = Math.max(14, (stk.size || 4) * 5);
      ctx.font = '600 ' + fontSize + 'px -apple-system, "SF Pro Display", system-ui, sans-serif';
      ctx.textBaseline = 'top';
      const metrics = ctx.measureText(txt);
      const padX = 6, padY = 4;
      const bgW = metrics.width + padX * 2;
      const bgH = fontSize * 1.15 + padY * 2;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const radius = 5;
      ctx.beginPath();
      ctx.moveTo(tx + radius, ty);
      ctx.lineTo(tx + bgW - radius, ty);
      ctx.quadraticCurveTo(tx + bgW, ty, tx + bgW, ty + radius);
      ctx.lineTo(tx + bgW, ty + bgH - radius);
      ctx.quadraticCurveTo(tx + bgW, ty + bgH, tx + bgW - radius, ty + bgH);
      ctx.lineTo(tx + radius, ty + bgH);
      ctx.quadraticCurveTo(tx, ty + bgH, tx, ty + bgH - radius);
      ctx.lineTo(tx, ty + radius);
      ctx.quadraticCurveTo(tx, ty, tx + radius, ty);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = stk.color || '#fff';
      ctx.fillText(txt, tx + padX, ty + padY);
    }
  });
}

// ── Export frame comments to a supplier-friendly HTML report ──
// The user asked to be able to send the comments to the supplier with
// frame numbers + snapshot images + text. We build a self-contained
// HTML file with:
//   - A header showing the ORIGINAL video file name, duration, fps, and total comments
//   - An "Overall Comment" block at the top (whatever the user typed in
//     the popover's "Over Comment" field) so the supplier sees the
//     high-level feedback first
//   - One card per comment, ordered by frame, with:
//     - The snapshot image (base64-embedded JPEG at 1280px so the
//       displayed 720px stays sharp on retina screens)
//     - Frame # and timecode
//     - The comment text (translation if available, otherwise original)
//   - Clean dark styling so it prints well and looks like a real review doc
// The file downloads as `<videoBaseName>-frame-comments.html` (using
// the original file name without the extension) and can be opened /
// printed / attached to a Slack message / emailed.
async function videoAnnoExportComments() {
  const item = videoAnnoGetSelected();
  if (!item) { toast('Select a video first'); return; }
  if (!item.video) { toast('Video not ready yet'); return; }
  const anno = videoAnnoEnsure(item);
  const comments = (anno.comments || []).slice().sort((a, b) => (a.frame || 0) - (b.frame || 0));
  if (comments.length === 0) {
    toast('No comments to export — add at least one frame comment first');
    return;
  }
  // Pull the over-comment from the popover textarea if it's still open
  // (the textarea has the latest unsaved edit) — otherwise read the
  // saved value on the item. Trim and treat empty as no comment.
  let overComment = '';
  try {
    if (item.el && item.el._getOverComment) overComment = item.el._getOverComment() || '';
  } catch (e) {}
  if (!overComment && anno.overComment) overComment = anno.overComment;
  overComment = String(overComment || '').trim();
  // Capture fresh, higher-res snapshots for every comment. We use the
  // stored `time` (seconds) to seek the video to each frame, capture,
  // and continue. If the seek fails (video no longer loaded), we fall
  // back to the per-comment stored snapshot.
  const v = item.video;
  const fps = (typeof getCurrentFps === 'function') ? getCurrentFps() : (v._kraftedFps || 30);
  const prevTime = v.currentTime;
  const wasPaused = v.paused;
  try { v.pause(); } catch (e) {}
  // Show a toast — capturing N frames can take a beat for longer videos
  toast('Capturing ' + comments.length + ' frame snapshot' + (comments.length === 1 ? '' : 's') + '…');
  // Capture at 1280px so the displayed 720px snapshot is sharp on retina
  // screens and stays legible when zoomed in. This is ~3x the previous
  // resolution (was 720px) and matches the user's request for a "bigger
  // preview that's easy to read".
  const EXPORT_SNAP_MAX_W = 0; // 0 = use video native resolution
  const captureOne = (c) => new Promise((resolve) => {
    // For each comment, seek the video to its exact time then capture.
    // We chain via rAF so the video has time to actually paint the new
    // frame before we drawImage from it.
    const tryCapture = (tries) => {
      if (tries <= 0) { resolve(c.snapshot || ''); return; }
      try {
        // readyState >= 2 (HAVE_CURRENT_DATA) is enough to drawImage
        if (v.readyState >= 2 && Math.abs((v.currentTime || 0) - (c.time || 0)) < 0.05) {
          // Seek succeeded and the new frame is painted — grab it.
          // We pass the comment's stored strokes so the fresh capture
          // includes the same annotations the user drew.
          const dataUrl = videoAnnoCaptureSnapshot(v, EXPORT_SNAP_MAX_W, c.annoStrokes);
          resolve(dataUrl || c.snapshot || '');
        } else if (tries < 5) {
          setTimeout(() => tryCapture(tries - 1), 80);
        } else {
          setTimeout(() => tryCapture(tries - 1), 40);
        }
      } catch (e) { resolve(c.snapshot || ''); }
    };
    try {
      v.currentTime = c.time || 0;
    } catch (e) { resolve(c.snapshot || ''); return; }
    setTimeout(() => tryCapture(12), 60);
  });
  // Chain the captures so we don't fight the video decoder
  (async () => {
    const results = [];
    for (let i = 0; i < comments.length; i++) {
      results.push(await captureOne(comments[i]));
    }
    // Restore the user's previous playhead + play state
    try { v.currentTime = prevTime; } catch (e) {}
    if (!wasPaused) { try { v.play().catch(() => {}); } catch (e) {} }
    // Build the HTML report
    // ── Derive the file name for both display and download ──
    // Use the original file name if known (item.filename is set by
    // drag-drop / paste with the actual file name from the user's disk).
    // Fall back to item.name or a generic "video" placeholder.
    // The display name keeps the extension (e.g. "my-clip.mp4") so the
    // export header looks like a real review doc. The download name
    // strips the extension so we don't get "my-clip.mp4-frame-comments.html"
    // — that just looks ugly.
    const rawFileName = (item.filename || item.name || 'video').toString();
    const safeFileName = rawFileName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'video';
    const dotIdx = safeFileName.lastIndexOf('.');
    const baseName = (dotIdx > 0) ? safeFileName.slice(0, dotIdx) : safeFileName;
    const extName = (dotIdx > 0) ? safeFileName.slice(dotIdx) : '';
    const displayName = safeFileName;       // shown in the report header
    const downloadBase = baseName || 'video'; // used for the download filename
    const dur = (isFinite(v.duration) ? v.duration : 0);
    const m = Math.floor(dur / 60);
    const sec = Math.floor(dur % 60);
    const durStr = m + ':' + (sec < 10 ? '0' : '') + sec;
    const exportedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const rows = comments.map((c, i) => {
      const snap = results[i] || c.snapshot || '';
      const ct = c.time || 0;
      const cm = Math.floor(ct / 60);
      const cs = Math.floor(ct % 60);
      const timeStr = cm + ':' + (cs < 10 ? '0' : '') + cs;
      const hasTr = !!(c.translation && c.translation !== c.text);
      const textHtml = escapeHtml(hasTr ? c.translation : (c.text || ''));
      const trDir = hasTr ? ('<div class="tr-dir">' + escapeHtml((c.translationDir || '').toUpperCase()) + ' translation</div>') : '';
      const snapHtml = snap
        ? ('<img class="snap" src="' + snap + '" alt="frame ' + c.frame + '"/>')
        : ('<div class="snap no-snap">no snapshot</div>');
      const annoBadge = (c.annoStrokes && c.annoStrokes.length)
        ? ('<div class="anno-badge">✏ ' + c.annoStrokes.length + ' mark' + (c.annoStrokes.length === 1 ? '' : 's') + '</div>')
        : '';
      const snapClick = snap
        ? (' data-snap="' + escapeHtml(snap) + '" onclick="exLbOpen(this.getAttribute(\'data-snap\'))"')
        : '';
      return (
        '<div class="row">' +
          '<div class="snap-wrap"' + snapClick + '>' + snapHtml +
            '<div class="frame-badge">f ' + (c.frame || 0) + '</div>' +
            annoBadge +
          '</div>' +
          '<div class="content">' +
            '<div class="meta">' +
              '<span class="time">' + timeStr + '</span>' +
              '<span class="sep">·</span>' +
              '<span class="idx">#' + (i + 1) + ' of ' + comments.length + '</span>' +
            '</div>' +
            '<div class="text">' + textHtml + '</div>' +
            trDir +
          '</div>' +
        '</div>'
      );
    }).join('');
    const html = buildExportHtml({
      videoName: displayName, videoBase: downloadBase, fileExt: extName,
      durStr, commentsCount: comments.length,
      fps: Math.round(fps), exportedAt, rows,
      overComment: overComment,
    });
    // Round 28.7: native save dialog (Chrome/Edge on Mac + Windows).
    // Falls back to the classic <a download> on Safari/Firefox.
    try {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const result = await kraftedSaveFile({
        filename: downloadBase + '-frame-comments.html',
        blob: blob,
        mime: 'text/html',
        description: 'Frame comments report (HTML)',
      });
      if (result === 'cancelled') return; // user closed the picker — no toast
      const verb = result === 'saved' ? 'Saved' : 'Downloaded';
      toast(verb + ' ' + comments.length + ' comment' + (comments.length === 1 ? '' : 's') + (overComment ? ' + over comment' : '') + (result === 'fallback' ? ' (default location)' : ''));
    } catch (e) {
      console.error('Export download failed:', e);
      toast('Export failed: ' + e.message);
    }
  })();
}

// ── Export video with per-frame drawings baked in ──
// The user wants to be able to send a SUPPLIER a video that has their
// frame-by-frame annotations composited directly onto the footage — not
// just snapshots. We use MediaRecorder on a canvas.captureStream() to
// record the video in real-time, drawing the per-frame strokes on top
// of each frame. The result is a .mp4 file (H.264/AVC) that the
// supplier can play in any modern browser or video tool.
//
// Why real-time (not seek-and-capture)?
//   The video element is a black box — we can't directly read encoded
//   frames. We have to play the video, sample the pixels with drawImage
//   on a canvas, and let MediaRecorder capture the result. This means
//   the export runs at video speed (so a 30s video takes ~30s to
//   "export"). We show a progress toast so the user knows what's
//   happening and they can cancel if they need to.
//
// Output: .mp4 only (H.264 / AVC). The user asked us to drop the WebM
//   fallback — suppliers expect MP4 and Chrome 126+ supports it in
//   MediaRecorder. If the browser doesn't support MP4 we surface a
//   clear error instead of silently writing WebM.
async function videoAnnoExportVideo() {
  const item = videoAnnoGetSelected();
  if (!item) { toast('Select a video first'); return; }
  if (!item.video) { toast('Video not ready yet'); return; }
  if (typeof MediaRecorder === 'undefined') {
    toast('Video export not supported in this browser');
    return;
  }
  const anno = videoAnnoEnsure(item);
  const drawState = item.el && item.el._annoDrawState;
  const strokesByFrame = (drawState && drawState.strokesByFrame) || {};
  const hasAnyStrokes = Object.keys(strokesByFrame).some(k => (strokesByFrame[k] || []).length > 0);
  if (!hasAnyStrokes) {
    toast('No drawings to export — draw on at least one frame first');
    return;
  }
  const v = item.video;
  const fps = (typeof getCurrentFps === 'function') ? getCurrentFps() : (v._kraftedFps || 30);
  // Derive file name (same logic as HTML report export)
  const rawFileName = (item.filename || item.name || 'video').toString();
  const safeFileName = rawFileName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'video';
  const dotIdx = safeFileName.lastIndexOf('.');
  const baseName = (dotIdx > 0) ? safeFileName.slice(0, dotIdx) : safeFileName;
  const dur = (isFinite(v.duration) ? v.duration : 0);
  if (!dur || dur <= 0) { toast('Video duration unknown — wait for it to load'); return; }
  // ── Build the composite canvas ──
  // Match the video's native resolution for a 1:1 export so the
  // baked-in strokes and text stay crisp. For 4K sources this can
  // produce large canvases — we cap at 2560px on the longest edge
  // to keep memory reasonable on older machines while still being
  // 2× sharper than the previous 1280px cap.
  const MAX_DIM = 2560;
  const aspect = (v.videoWidth || 1280) / (v.videoHeight || 720);
  let outW = Math.min(MAX_DIM, v.videoWidth || 1280);
  let outH = Math.round(outW / aspect);
  if (outH > MAX_DIM) { outH = MAX_DIM; outW = Math.round(outH * aspect); }
  const canvas = document.createElement('canvas');
  canvas.width = outW; canvas.height = outH;
  const ctx = canvas.getContext('2d');
  // Round 67: MP4-only codec list. The user explicitly asked to drop
  // WebM as an export format — suppliers expect MP4 and Chrome 126+
  // supports MediaRecorder with H.264/AVC. We try the most-compatible
  // profile first (avc1.42E01E = Baseline 3.0, playable in every modern
  // player), then fall back to generic H.264 and plain video/mp4. No
  // WebM, no VP8/VP9. If the browser supports none of these, the
  // export aborts with a clear error message below.
  const mimeCandidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=avc1',
    'video/mp4;codecs=h264',
    'video/mp4',
  ];
  const mime = mimeCandidates.find(m => {
    try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; }
  }) || '';
  if (!mime) {
    toast('Your browser does not support MP4 video export — try the latest Chrome');
    return;
  }
  // MP4 only — no more WebM fallback.
  const fileExt = 'mp4';
  let recorder;
  try {
    const stream = canvas.captureStream(30);
    recorder = new MediaRecorder(stream, { mimeType: mime });
  } catch (e) {
    toast('Could not start video export: ' + e.message);
    return;
  }
  const chunks = [];
  recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
  const finished = new Promise((resolve) => { recorder.onstop = () => resolve(); });
  // ── Pre-acquire the save handle WHILE we're in a user gesture ──
  // Round 65: `showSaveFilePicker` requires a recent user activation.
  // If we waited until AFTER the recorder finishes (which can be 30+
  // seconds for long clips), Chrome would silently reject the call as
  // "not user-activated" — and the user would see "100% complete" and
  // then nothing, which is the bug they reported. Solution: open the
  // picker NOW (still inside the export-button click handler), get the
  // file handle, then do the recording, then write the blob to the
  // handle when done. If the user cancels the picker, abort the
  // whole export cleanly.
  const saveFilename = baseName + '-with-drawings.' + fileExt;
  let saveHandle = null;
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      saveHandle = await window.showSaveFilePicker({
        suggestedName: saveFilename,
        types: [{
          description: 'MP4 video with annotations baked in',
          accept: { 'video/mp4': ['.mp4'] },
        }],
      });
    } catch (e) {
      if (e && (e.name === 'AbortError' || e.code === 20 || e.code === 'ABORT_ERR')) {
        // User closed the picker — abort the export without doing any work.
        return;
      }
      console.warn('showSaveFilePicker failed, will fall back to download:', e);
      saveHandle = null;
    }
  }
  // ── Render loop ──
  // Plays the video from start and draws each frame + its strokes onto
  // the composite canvas. The MediaRecorder samples the canvas stream
  // ~30 times per second, producing a smooth exported video.
  const prevTime = v.currentTime;
  const wasPaused = v.paused;
  const prevMuted = v.muted;
  let cancelled = false;
  // The cancel button (replaces the export button while running)
  const exportBtn = document.querySelector('.video-anno-popover .export-comments-btn, .video-anno-popover .popover-btn-export');
  let cancelBtn = null;
  if (exportBtn) {
    cancelBtn = document.createElement('button');
    cancelBtn.className = exportBtn.className;
    cancelBtn.textContent = '⏹ Stop export';
    cancelBtn.style.background = '#ff5252';
    cancelBtn.style.color = '#fff';
    exportBtn.parentNode.replaceChild(cancelBtn, exportBtn);
    cancelBtn.addEventListener('click', () => { cancelled = true; });
  }
  const restoreUi = () => {
    if (cancelBtn && exportBtn && cancelBtn.parentNode) {
      try { cancelBtn.parentNode.replaceChild(exportBtn, cancelBtn); } catch (e) {}
    }
  };
  // Progress toast — a small overlay that shows "Exporting video… 34%"
  const prog = document.createElement('div');
  prog.className = 'video-export-progress';
  prog.innerHTML = '<div class="pct">Preparing export…</div>';
  document.body.appendChild(prog);
  const updateProg = (pct) => {
    prog.innerHTML = '<div class="pct">Exporting video… ' + Math.round(pct) + '%</div><div class="bar"><div class="fill" style="width:' + pct + '%"></div></div>';
  };
  // Pause video so the loop can drive playback
  try { v.pause(); } catch (e) {}
  // Mute audio during export to avoid feedback (we're recording the
  // canvas stream, not the audio track, so audio would be lost anyway —
  // muting prevents any audio artifacts from the export)
  try { v.muted = true; } catch (e) {}
  // Seek to start
  const seekTo = (t) => new Promise((resolve) => {
    const onSeeked = () => { v.removeEventListener('seeked', onSeeked); resolve(); };
    v.addEventListener('seeked', onSeeked);
    try { v.currentTime = t; } catch (e) { v.removeEventListener('seeked', onSeeked); resolve(); }
  });
  const renderFrame = () => {
    // Draw the current video frame, then the strokes for that frame on top
    try { ctx.drawImage(v, 0, 0, outW, outH); } catch (e) {}
    const cf = Math.max(0, Math.floor((v.currentTime || 0) * fps));
    const frameStrokes = strokesByFrame[cf] || [];
    // Use the same renderer as the on-screen canvas
    if (typeof _renderStrokesToCtx === 'function') {
      _renderStrokesToCtx(ctx, frameStrokes, outW, outH);
    } else if (frameStrokes.length) {
      // Fallback: simple line stroke if the renderer isn't available
      frameStrokes.forEach(st => {
        if (!st.pts || st.pts.length < 2) return;
        ctx.strokeStyle = st.color || '#ff4444';
        ctx.lineWidth = (st.size || 4) * (outW / 1280);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(st.pts[0][0] * outW, st.pts[0][1] * outH);
        for (let i = 1; i < st.pts.length; i++) {
          ctx.lineTo(st.pts[i][0] * outW, st.pts[i][1] * outH);
        }
        ctx.stroke();
      });
    }
  };
  // ── Drive the playback ──
  (async () => {
    try {
      await seekTo(0);
      recorder.start(250); // gather chunks every 250ms
      try { await v.play(); } catch (e) { throw new Error('Could not play video for export'); }
      const startMs = performance.now();
      const totalMs = dur * 1000;
      // RAF loop — render every frame while video plays
      const loop = () => {
        if (cancelled) {
          try { v.pause(); } catch (e) {}
          try { recorder.stop(); } catch (e) {}
          return;
        }
        renderFrame();
        const elapsed = performance.now() - startMs;
        const pct = Math.min(100, (elapsed / totalMs) * 100);
        updateProg(pct);
        if (v.ended || v.currentTime >= dur - 0.05) {
          // One last frame so the final image is captured
          renderFrame();
          try { recorder.stop(); } catch (e) {}
          return;
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      await finished;
      // Round 65: write the blob to the handle we acquired up-front
      // (still in user gesture). If we didn't get a handle, fall back
      // to a regular <a download>.
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/mp4' });
      const fmtLabel = 'MP4';
      let result;
      if (saveHandle) {
        try {
          const w = await saveHandle.createWritable();
          try { await w.write(blob); } finally { try { await w.close(); } catch (e) {} }
          result = 'saved';
          toast('Video saved as ' + fmtLabel + ' (' + Math.round(blob.size / 1024) + ' KB)');
        } catch (e) {
          console.warn('Write to handle failed, falling back to download:', e);
          try { triggerDownload(blob, saveFilename); } catch (e2) {}
          result = 'fallback';
          toast('Video downloaded as ' + fmtLabel + ' (' + Math.round(blob.size / 1024) + ' KB)');
        }
      } else {
        try { triggerDownload(blob, saveFilename); result = 'fallback'; }
        catch (e) { result = 'cancelled'; }
        if (result === 'fallback') {
          toast('Video downloaded as ' + fmtLabel + ' (' + Math.round(blob.size / 1024) + ' KB)');
        } else {
          toast('Video export cancelled');
        }
      }
    } catch (e) {
      console.error('Video export failed:', e);
      toast('Export failed: ' + e.message);
    } finally {
      // Restore state
      try { v.pause(); } catch (e) {}
      try { v.currentTime = prevTime; } catch (e) {}
      try { v.muted = prevMuted; } catch (e) {}
      if (!wasPaused) { try { v.play().catch(() => {}); } catch (e) {} }
      try { prog.remove(); } catch (e) {}
      restoreUi();
    }
  })();
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildExportHtml({ videoName, videoBase, fileExt, durStr, commentsCount, fps, exportedAt, rows, overComment }) {
  // Compute the h1 HTML (with styled extension) OUTSIDE the string array
  // so the nested single quotes in the span don't break the outer template
  // strings. The escapeHtml wrapper makes the file name safe; we then split
  // it on the last dot to color the extension with the accent.
  const _safeName = escapeHtml(videoName || '');
  const _dotPos = _safeName.lastIndexOf('.');
  const h1Html = (_dotPos > 0)
    ? (_safeName.slice(0, _dotPos) + '<span class="ext">' + _safeName.slice(_dotPos) + '</span>')
    : _safeName;
  // Build the over-comment block as a string (empty if user didn't type one)
  const overBlockHtml = overComment
    ? ('    <div class="over-block">' +
       '      <div class="over-title">📝 (overall comment)</div>' +
       '      <div class="over-body">' + escapeHtml(overComment) + '</div>' +
       '    </div>')
    : '';
  return [
'<!DOCTYPE html>',
'<html lang="en">',
'<head>',
'<meta charset="utf-8"/>',
'<meta name="viewport" content="width=device-width,initial-scale=1"/>',
'<title>' + escapeHtml(videoName) + ' — Frame Comments</title>',
'<style>',
'  :root { --accent: #00e5ff; --accent-2: #7c5cfc; --bg: #0d0d0f; --bg-card: #18181c; --bg-card-h: #1f1f25; --bg-over: #1c1c25; --text: #f1f1f4; --text-dim: #b9b9c2; --text-subtle: #888894; --border: rgba(255,255,255,0.08); --border-2: rgba(255,255,255,0.12); }',
'  * { box-sizing: border-box; }',
'  body { margin: 0; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, "PingFang HK", "Microsoft YaHei", sans-serif; padding: 0; }',
'  .page { max-width: 1080px; margin: 0 auto; padding: 36px 28px 64px; }',
'  /* ── Header ── */',
'  .head { display: flex; align-items: center; gap: 18px; padding-bottom: 22px; border-bottom: 1px solid var(--border); margin-bottom: 24px; }',
'  .head .logo { width: 46px; height: 46px; background: linear-gradient(135deg, var(--accent), var(--accent-2)); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0; }',
'  .head h1 { font-size: 26px; font-weight: 800; margin: 0 0 6px; color: var(--text); letter-spacing: -0.4px; }',
'  .head h1 .ext { color: var(--accent); font-weight: 700; }',
'  .head .sub { font-size: 13px; color: var(--text-dim); line-height: 1.5; }',
'  .head .sub b { color: var(--accent); font-weight: 700; }',
'  .head .right { margin-left: auto; text-align: right; font-size: 11.5px; color: var(--text-dim); line-height: 1.6; white-space: nowrap; }',
'  /* ── Over Comment (overall feedback) block ── */',
'  .over-block { background: linear-gradient(135deg, rgba(0,229,255,0.10) 0%, rgba(124,92,252,0.10) 100%); border: 1px solid var(--border-2); border-left: 3px solid var(--accent); border-radius: 10px; padding: 18px 22px; margin-bottom: 28px; }',
'  .over-block .over-title { font-size: 11px; font-weight: 800; color: var(--accent); text-transform: uppercase; letter-spacing: 1.4px; margin-bottom: 8px; }',
'  .over-block .over-body { font-size: 15.5px; line-height: 1.7; color: var(--text); white-space: pre-wrap; word-wrap: break-word; }',
'  /* ── Comments list ── */',
'  .row { display: flex; gap: 22px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 16px; align-items: flex-start; transition: background 0.15s, border-color 0.15s; }',
'  .row:hover { background: var(--bg-card-h); border-color: var(--border-2); }',
'  /* ── Snapshots: 720px wide so they\'re big enough to read details ── */',
'  .snap-wrap { flex-shrink: 0; position: relative; width: 720px; max-width: 100%; }',
'  .snap { display: block; width: 720px; max-width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--border); background: #000; cursor: zoom-in; transition: transform 0.15s, border-color 0.15s; }',
'  .snap:hover { transform: translateY(-1px); border-color: var(--accent); }',
'  .snap.no-snap { height: 405px; display: flex; align-items: center; justify-content: center; color: var(--text-dim); font-size: 13px; font-style: italic; }',
'  .frame-badge { position: absolute; left: 10px; bottom: 8px; background: rgba(0,0,0,0.82); color: var(--accent); font-size: 12px; font-weight: 700; padding: 3px 9px; border-radius: 5px; font-family: "SF Mono", Menlo, Consolas, monospace; letter-spacing: 0.3px; }',
'  .anno-badge { position: absolute; right: 10px; bottom: 8px; background: rgba(0,229,255,0.92); color: #000; font-size: 10.5px; font-weight: 800; padding: 3px 8px; border-radius: 5px; font-family: "SF Mono", Menlo, Consolas, monospace; }',
'  /* ── Comment text column ── */',
'  .content { flex: 1; min-width: 0; padding-top: 4px; }',
'  .meta { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-dim); margin-bottom: 10px; }',
'  .meta .time { font-family: "SF Mono", Menlo, Consolas, monospace; color: var(--accent); font-weight: 700; font-size: 14px; }',
'  .meta .sep { opacity: 0.4; }',
'  .meta .idx { color: var(--text-dim); }',
'  .text { font-size: 16px; line-height: 1.65; color: var(--text); word-wrap: break-word; white-space: pre-wrap; }',
'  .tr-dir { font-size: 11px; color: var(--text-dim); margin-top: 8px; font-style: italic; }',
'  .foot { margin-top: 40px; padding-top: 18px; border-top: 1px solid var(--border); font-size: 11.5px; color: var(--text-dim); text-align: center; letter-spacing: 0.3px; }',
'  .foot b { color: var(--accent); }',
'  /* ── ZIP download button (round 28.7) ── */',
'  .head-actions { margin-top: 14px; display: flex; gap: 10px; flex-wrap: wrap; }',
'  .zip-btn { display: inline-flex; align-items: center; gap: 8px; background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #000; border: none; padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s; letter-spacing: 0.2px; box-shadow: 0 4px 14px rgba(0,229,255,0.18); }',
'  .zip-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(0,229,255,0.30); }',
'  .zip-btn:active { transform: translateY(0); }',
'  .zip-btn:disabled { opacity: 0.5; cursor: wait; transform: none; box-shadow: none; }',
'  .zip-btn .zip-icon { font-size: 15px; }',
'  .zip-hint { color: var(--text-subtle); font-size: 11.5px; align-self: center; }',
'  /* ── Lightbox (click snapshot to view full size) ── */',
'  .ex-lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.94); display: none; align-items: center; justify-content: center; z-index: 100000005; padding: 20px; }',
'  .ex-lightbox.open { display: flex; }',
'  .ex-lightbox img { max-width: 96vw; max-height: 92vh; border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,0.7); }',
'  .ex-lightbox .ex-lb-close { position: absolute; top: 18px; right: 18px; width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.25); color: #fff; font-size: 20px; cursor: pointer; display: flex; align-items: center; justify-content: center; }',
'  .ex-lightbox .ex-lb-close:hover { background: rgba(255,255,255,0.2); }',
'  .ex-lightbox .ex-lb-hint { position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%); color: rgba(255,255,255,0.55); font-size: 11px; letter-spacing: 0.4px; }',
'  @media print {',
'    body { background: #fff; color: #111; }',
'    .row { background: #fafafa; border-color: #ddd; }',
'    .head { border-color: #ddd; }',
'    .head h1, .text { color: #111; }',
'    .text { font-size: 13px; }',
'    .frame-badge { background: #222; }',
'    .snap { border-color: #ccc; }',
'    .over-block { background: #f5f5f5; border-color: #ddd; }',
'    .ex-lightbox { display: none !important; }',
'  }',
'  @media (max-width: 780px) {',
'    .row { flex-direction: column; }',
'    .snap-wrap { width: 100%; }',
'    .snap { width: 100%; }',
'  }',
'</style>',
'</head>',
'<body>',
'  <div class="page">',
'    <div class="head">',
'      <div class="logo">💬</div>',
'      <div style="min-width:0;flex:1;">',
'        <h1>' + h1Html + '</h1>',
'        <div class="sub">Frame-by-frame review · <b>' + commentsCount + '</b> comment' + (commentsCount === 1 ? '' : 's') + ' · duration ' + escapeHtml(durStr) + ' · ' + fps + ' fps</div>',
'      </div>',
'      <div class="right">',
'        Exported<br/>' + escapeHtml(exportedAt),
'      </div>',
'    </div>',
    '    <!-- Over Comment block: only rendered when the user typed one -->',
    overBlockHtml,
    '    <!-- Round 28.7: ZIP download button — bundles every snapshot into one archive -->',
    '    <div class="head-actions">',
    '      <button class="zip-btn" id="zipBtn" type="button" title="Bundle every per-frame snapshot into a single .zip file">',
    '        <span class="zip-icon">📦</span><span>Download all snapshots (.zip)</span>',
    '      </button>',
    '      <span class="zip-hint" id="zipHint">one JPG per comment, named with the frame number</span>',
    '    </div>',
    '    <div class="rows">' + rows + '</div>',
    '    <div class="foot">Generated by <b>Krafted</b></div>',
'  </div>',
'  <div class="ex-lightbox" id="ex-lightbox" onclick="exLbClose(event)">',
'    <button class="ex-lb-close" onclick="exLbClose(event)" title="Close (Esc)">×</button>',
'    <img id="ex-lightbox-img" alt="frame" />',
'    <div class="ex-lb-hint">Click anywhere or press Esc to close</div>',
'  </div>',
'  <script>',
'    function exLbOpen(src) {',
'      var lb = document.getElementById("ex-lightbox");',
'      var img = document.getElementById("ex-lightbox-img");',
'      if (!lb || !img) return;',
'      img.src = src;',
'      lb.classList.add("open");',
'      try { document.body.style.overflow = "hidden"; } catch (e) {}',
'    }',
'    function exLbClose(ev) {',
'      if (ev && ev.target && ev.target.tagName === "IMG") return;',
'      var lb = document.getElementById("ex-lightbox");',
'      if (!lb) return;',
'      lb.classList.remove("open");',
'      try { document.body.style.overflow = ""; } catch (e) {}',
'    }',
    '    document.addEventListener("keydown", function(e) {',
    '      if (e.key === "Escape") exLbClose();',
    '    });',
    '    // Round 28.7: in-page ZIP writer (STORED mode, no compression).',
    '    // Each entry has a local file header + raw file bytes, followed by',
    '    // a central directory + end-of-central-dir record. PNG data URLs',
    '    // are already compressed by the codec so STORED is the right',
    '    // choice — re-deflating wouldn\'t shrink them. ~80 lines of code,',
    '    // no deps, works in any modern browser (including offline).',
    '    var CRC_TABLE = (function() {',
    '      var t = new Uint32Array(256);',
    '      for (var n = 0; n < 256; n++) {',
    '        var c = n;',
    '        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);',
    '        t[n] = c >>> 0;',
    '      }',
    '      return t;',
    '    })();',
    '    function crc32(bytes) {',
    '      var c = 0xFFFFFFFF;',
    '      for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);',
    '      return (c ^ 0xFFFFFFFF) >>> 0;',
    '    }',
    '    function dataUrlToBytes(dataUrl) {',
    '      var idx = dataUrl.indexOf(",");',
    '      if (idx < 0) return null;',
    '      var b64 = dataUrl.slice(idx + 1);',
    '      var bin = atob(b64);',
    '      var out = new Uint8Array(bin.length);',
    '      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);',
    '      return out;',
    '    }',
    '    function dosTime(d) {',
    '      return ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() / 2) & 0x1F);',
    '    }',
    '    function dosDate(d) {',
    '      return (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0xF) << 5) | (d.getDate() & 0x1F);',
    '    }',
    '    function buildZip(files) {',
    '      var now = new Date();',
    '      var dt = dosTime(now), dd = dosDate(now);',
    '      var localParts = [];',
    '      var centralParts = [];',
    '      var offset = 0;',
    '      var totalUncompressed = 0;',
    '      for (var i = 0; i < files.length; i++) {',
    '        var f = files[i];',
    '        var nameBytes = new TextEncoder().encode(f.name);',
    '        var data = f.data;',
    '        var crc = crc32(data);',
    '        var size = data.length;',
    '        totalUncompressed += size;',
    '        // Local file header (30 + name)',
    '        var lh = new Uint8Array(30 + nameBytes.length);',
    '        var lv = new DataView(lh.buffer);',
    '        lv.setUint32(0, 0x04034b50, true);',
    '        lv.setUint16(4, 20, true);   // version needed',
    '        lv.setUint16(6, 0, true);    // gp flag',
    '        lv.setUint16(8, 0, true);    // method = stored',
    '        lv.setUint16(10, dt, true);  // mod time',
    '        lv.setUint16(12, dd, true);  // mod date',
    '        lv.setUint32(14, crc, true);',
    '        lv.setUint32(18, size, true);',
    '        lv.setUint32(22, size, true);',
    '        lv.setUint16(26, nameBytes.length, true);',
    '        lv.setUint16(28, 0, true);   // extra len',
    '        lh.set(nameBytes, 30);',
    '        localParts.push(lh);',
    '        localParts.push(data);',
    '        // Central directory entry (46 + name)',
    '        var ch = new Uint8Array(46 + nameBytes.length);',
    '        var cv = new DataView(ch.buffer);',
    '        cv.setUint32(0, 0x02014b50, true);',
    '        cv.setUint16(4, 20, true);   // version made by',
    '        cv.setUint16(6, 20, true);   // version needed',
    '        cv.setUint16(8, 0, true);',
    '        cv.setUint16(10, 0, true);',
    '        cv.setUint16(12, dt, true);',
    '        cv.setUint16(14, dd, true);',
    '        cv.setUint32(16, crc, true);',
    '        cv.setUint32(20, size, true);',
    '        cv.setUint32(24, size, true);',
    '        cv.setUint16(28, nameBytes.length, true);',
    '        cv.setUint16(30, 0, true);   // extra',
    '        cv.setUint16(32, 0, true);   // comment',
    '        cv.setUint16(34, 0, true);   // disk start',
    '        cv.setUint16(36, 0, true);   // internal attrs',
    '        cv.setUint32(38, 0, true);   // external attrs',
    '        cv.setUint32(42, offset, true);',
    '        ch.set(nameBytes, 46);',
    '        centralParts.push(ch);',
    '        offset += lh.length + data.length;',
    '      }',
    '      var centralSize = centralParts.reduce(function(s, p) { return s + p.length; }, 0);',
    '      var centralOffset = offset;',
    '      // End of central dir (22 bytes)',
    '      var eocd = new Uint8Array(22);',
    '      var ev = new DataView(eocd.buffer);',
    '      ev.setUint32(0, 0x06054b50, true);',
    '      ev.setUint16(4, 0, true);',
    '      ev.setUint16(6, 0, true);',
    '      ev.setUint16(8, files.length, true);',
    '      ev.setUint16(10, files.length, true);',
    '      ev.setUint32(12, centralSize, true);',
    '      ev.setUint32(16, centralOffset, true);',
    '      ev.setUint16(20, 0, true);',
    '      // Concat everything',
    '      var totalSize = offset + centralSize + eocd.length;',
    '      var out = new Uint8Array(totalSize);',
    '      var pos = 0;',
    '      for (var j = 0; j < localParts.length; j++) {',
    '        out.set(localParts[j], pos); pos += localParts[j].length;',
    '      }',
    '      for (var k = 0; k < centralParts.length; k++) {',
    '        out.set(centralParts[k], pos); pos += centralParts[k].length;',
    '      }',
    '      out.set(eocd, pos);',
    '      return out;',
    '    }',
    '    function downloadZip() {',
    '      var btn = document.getElementById("zipBtn");',
    '      var hint = document.getElementById("zipHint");',
    '      if (btn) { btn.disabled = true; btn.querySelector("span:last-child").textContent = "Bundling…"; }',
    '      try {',
    '        // Bundle EVERY per-frame snapshot, even when the bytes are',
    '        // identical. Round 28.7 used a `seen` dedup that dropped any',
    '        // data URL we had already added, which meant multiple comments',
    '        // anchored to the same frame (or comments whose export capture',
    '        // fell back to the same stored snapshot) collapsed into a',
    '        // single file in the archive. We now keep every entry and use',
    '        // a 2-digit sequence number in the filename so duplicates are',
    '        // still distinct on disk.',
    '        var snaps = document.querySelectorAll(".snap-wrap[data-snap]");',
    '        var files = [];',
    '        for (var i = 0; i < snaps.length; i++) {',
    '          var el = snaps[i];',
    '          var dataUrl = el.getAttribute("data-snap");',
    '          if (!dataUrl) continue;',
    '          var badge = el.querySelector(".frame-badge");',
    '          var frameNum = badge ? badge.textContent.replace(/[^0-9]/g, "") : (i + 1);',
    '          var bytes = dataUrlToBytes(dataUrl);',
    '          if (!bytes) continue;',
    '          var ext = (dataUrl.indexOf("image/jpeg") >= 0) ? "jpg" : "png";',
    '          var name = "frame-" + String(frameNum).padStart(5, "0") + "-" + String(i + 1).padStart(2, "0") + "." + ext;',
    '          files.push({ name: name, data: bytes });',
    '        }',
    '        if (files.length === 0) {',
    '          if (hint) hint.textContent = "No snapshots to bundle";',
    '          if (btn) { btn.disabled = false; btn.querySelector("span:last-child").textContent = "Download all snapshots (.zip)"; }',
    '          return;',
    '        }',
    '        var zipBytes = buildZip(files);',
    '        var blob = new Blob([zipBytes], { type: "application/zip" });',
    '        var url = URL.createObjectURL(blob);',
    '        var a = document.createElement("a");',
    '        a.href = url;',
    '        var pageTitle = (document.title || "krafted-report").replace(/[^a-zA-Z0-9._-]+/g, "_");',
    '        a.download = pageTitle.replace(/\\.html?$/, "") + "-snapshots.zip";',
    '        document.body.appendChild(a); a.click();',
    '        setTimeout(function () { try { a.remove(); URL.revokeObjectURL(url); } catch (e) {} }, 1500);',
    '        if (hint) hint.textContent = "Downloaded " + files.length + " snapshot" + (files.length === 1 ? "" : "s") + " (" + Math.round(blob.size / 1024) + " KB)";',
    '        if (btn) { btn.disabled = false; btn.querySelector("span:last-child").textContent = "Download again"; }',
    '      } catch (e) {',
    '        console.error("ZIP build failed", e);',
    '        if (hint) hint.textContent = "ZIP build failed: " + e.message;',
    '        if (btn) { btn.disabled = false; btn.querySelector("span:last-child").textContent = "Download all snapshots (.zip)"; }',
    '      }',
    '    }',
    '    (function () {',
    '      var btn = document.getElementById("zipBtn");',
    '      if (btn) btn.addEventListener("click", downloadZip);',
    '      var snaps = document.querySelectorAll(".snap-wrap[data-snap]");',
    '      var hint = document.getElementById("zipHint");',
    '      if (hint && snaps.length) hint.textContent = snaps.length + " snapshot" + (snaps.length === 1 ? "" : "s") + " ready, one JPG per comment";',
    '    })();',
    '  <\/script>',
'</body>',
'</html>',
  ].join('\n');
}

export function videoAnnoDeleteComment(id) {
  const item = videoAnnoGetSelected();
  if (!item) return;
  const anno = videoAnnoEnsure(item);
  const idx = anno.comments.findIndex(c => c.id === id);
  if (idx === -1) return;
  pushUndo();
  anno.comments.splice(idx, 1);
  scheduleAutoSave();
  videoAnnoRefreshCommentList(item);
  // Stage A: refresh popover list + badges + seek markers
  if (item.el) {
    if (item.el._refreshListBody) item.el._refreshListBody();
    if (item.el._refreshAnnoBadges) item.el._refreshAnnoBadges();
    if (item.el._refreshSeekMarkers) item.el._refreshSeekMarkers();
    // Re-position so the popover shrinks back when dropping below the
    // 4-comment auto-grow threshold (see _positionPopover).
    if (item.el._repositionAnnoPopovers) item.el._repositionAnnoPopovers();
  }
  toast('Comment removed');
}

// Stage A: update an existing comment's text (used by inline edit).
export function videoAnnoUpdateComment(id, newText) {
  const item = videoAnnoGetSelected();
  if (!item) return;
  const anno = videoAnnoEnsure(item);
  const c = anno.comments.find(x => x.id === id);
  if (!c) return;
  const t = (newText || '').trim();
  if (!t) { toast('Comment cannot be empty'); return; }
  if (t === (c.text || '')) return;
  c.text = t;
  // Clear the translation since the source text changed
  c.translation = '';
  c.translationDir = '';
  scheduleAutoSave();
  // Refresh BOTH the in-player list and the popover list
  videoAnnoRefreshCommentList(item, id);
  if (item.el) {
    if (item.el._refreshListBody) item.el._refreshListBody();
    if (item.el._refreshAnnoBadges) item.el._refreshAnnoBadges();
    if (item.el._refreshSeekMarkers) item.el._refreshSeekMarkers();
  }
  toast('Comment updated');
}

// ── Send comments to the canvas as an editable storyboard ──
// User asked (Round 65): "i want to add a funtion that i can trans this
// content like the layout on the canvas, the snap is the images and the
// text is on the app like i drag the image to the app and text beside,
// it can edit". Goal: clear, editable view to capture for the supplier.
//
// Round 68 redesign: the original was a single tall column of 360x203
// images + 440-wide text blocks. That got unusable past 8 comments
// (column ran off the bottom of a 1080p canvas) and the image/text
// scales were mismatched. The new layout is a 2-COLUMN storyboard with
// 160x90 thumbnail-sized images (matching the popover comment-list
// thumbnail at `.media-anno-comment .comment-thumb`, line 876) and
// proportionally-scaled text:
//   • 1 image per pair (the frame snap)
//   • 1 COMBINED text box per pair: a small dimmed chip on top
//     ("[ f 141 · 0:04 ]") + the body text in 12px white below it,
//     rendered as one contentEditable with two inline-styled <div>s.
//     User asked to "combine the time/frame with the comment, don't
//     separate to two text boxes" — this keeps chip + body as one
//     draggable, editable unit.
//   • Text box WIDTH is auto-fitted to the actual content (min 100px
//     for the chip line, max 200px — slightly wider than the 160px
//     image so 1-line comments still look balanced) — no more long
//     blank tails next to 3-letter words like "sad" / "asd".
//   • Image-left, text-right within each pair; pairs flow down in
//     two parallel columns; each column tracks its own Y so long
//     text in one row doesn't break the other column.
//
// Round 69 fix: the image scale on the board now matches the popover
// comment-list thumbnail (160x90 vs the previous 240x135). User said:
// "the pic on the app the scale of it is not right, it should be same
// as the screen and on the comment list". All other dims (gaps, text
// width, font sizes) scale down proportionally so the layout still
// looks clean with the smaller image.
//
// All items are independent (no grouping) — move / delete / edit
// any of them freely. One undo reverts the whole batch.
// Escape a user string for safe insertion into innerHTML. Prevents
// breaking the DOM when the comment text contains characters like
// "<", ">", "&" etc. (e.g. user types "<hey>" — without escaping
// that would close the body div and leak markup into the chip).
export function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

// autoFitTextItem — shrink-wrap a text item's WIDTH to its content
// and grow its HEIGHT to fit wrapped lines. Different from
// autoGrowTextItem (the default text helper) in two ways:
//   1) Width is shrink-wrapped to the actual content (not held at
//      the initial width). A 3-letter comment becomes a ~110px box,
//      not the default 300px.
//   2) Lower minimum width (110px vs 120px) so short chips still
//      shrink tightly.
//
// How it works:
//   a) Set CSS width to maxW / zoom so the content lays out at the
//      widest allowed column.
//   b) Read el.scrollWidth — that's the natural width of the longest
//      line of content (in CSS pixels at the current zoom). Convert
//      back to on-screen pixels by multiplying by zoom.
//   c) Clamp to [minW, maxW] and write back to tx.w. Re-render at
//      that width and read scrollHeight for tx.h.
//   d) Sync the text-handle container (the 6 resize handles sit in
//      a sibling <div> with explicit width/height).
//
// Round 68 use case: the Send to Board feature creates one text
// item per comment, populated with rich HTML (chip + body). The
// text box needs to fit tightly to the comment so the storyboard
// doesn't have huge blank tails next to 3-letter words like "sad".
export function autoFitTextItem(tx, opts) {
  opts = opts || {};
  const minW = opts.minW != null ? opts.minW : 80;
  const maxW = opts.maxW != null ? opts.maxW : 400;
  const padAdj = opts.padAdj != null ? opts.padAdj : 4;   // breathing room in on-screen px
  const _tz = Math.max(0.02, Math.min(10, state.zoom || 1));
  const el = tx.el;
  if (!el || !el.isConnected) return;
  // Save originals so we can restore on no-op (mirrors autoGrowTextItem)
  const origW = el.style.width;
  const origH = el.style.height;
  // Step 1 — lay out at maxW so the content can use the full allowed
  // column. height:auto lets scrollHeight reflect natural wrap.
  el.style.width = (maxW / _tz) + 'px';
  el.style.height = 'auto';
  void el.offsetWidth;  // force reflow
  // Step 2 — read natural width (longest line). scrollWidth includes
  // padding (4px 10px from .text-item CSS) so add a tiny breathing
  // room to avoid clipping descenders.
  const naturalWOS = el.scrollWidth * _tz;
  const finalWOS = Math.max(minW, Math.min(maxW, Math.ceil(naturalWOS + padAdj)));
  // Step 3 — re-render at the chosen width to measure wrap height
  el.style.width = (finalWOS / _tz) + 'px';
  el.style.height = 'auto';
  void el.offsetWidth;
  const naturalHOS = el.scrollHeight * _tz;
  const finalHOS = Math.max(20, Math.ceil(naturalHOS + 4));
  // No-op fast path — avoid touching tx.w/tx.h on micro-changes
  if (tx.w === finalWOS && tx.h === finalHOS) {
    el.style.width = origW;
    el.style.height = origH;
    return;
  }
  // Step 4 — write back. tx.w/tx.h are on-screen (zoom-100) values;
  // updateItemStyle converts to CSS pixels via /zoom.
  tx.w = finalWOS;
  tx.h = finalHOS;
  updateItemStyle(tx);
  // Sync the text-handle container (sibling div holding the 6 resize
  // dots) so they hug the new box bounds.
  const hCont = el.parentElement ? el.parentElement.querySelector('.text-handles[data-owner="' + tx.id + '"]') : null;
  if (hCont) {
    hCont.style.width = (tx.w / _tz) + 'px';
    hCont.style.height = (tx.h / _tz) + 'px';
  }
  updateAutoFitPaper();
}

async function videoAnnoSendToBoard() {
  const item = videoAnnoGetSelected();
  if (!item) { toast('Select a video first'); return; }
  if (!item.video) { toast('Video not ready yet'); return; }
  const anno = videoAnnoEnsure(item);
  const comments = (anno.comments || []).slice().sort((a, b) => (a.frame || 0) - (b.frame || 0));
  if (comments.length === 0) {
    toast('No comments to send — add at least one frame comment first');
    return;
  }
  // ── 1) Get a dataUrl for every comment ─────────────────────────
  // R73: switched from "always fresh-capture" to "use c.snapshot
  // directly, fall back to fresh capture only if snapshot is empty".
  // The stored `c.snapshot` was captured at comment-creation time
  // WITH the annotation strokes already baked in (see
  // videoAnnoAddComment), so it's exactly what the user expects to
  // see. Two reasons to prefer it:
  //   • RELIABLE: the user reported "the pic is loss and error" after
  //     Send to Board. The root cause was the fresh-capture loop:
  //     for 30+ comments it has to seek the video 30 times, and
  //     any comment whose seek doesn't land within 12 retries falls
  //     back to c.snapshot — but several of them would race and
  //     resolve with '' (empty), causing the entire pair (image +
  //     text) to be skipped with `if (!dataUrl) continue;`. The user
  //     saw fewer pairs than expected and the remaining images
  //     looked "lost" because their colY got desynced.
  //   • FASTER: no 30× seek-and-wait cycle. For 30 comments at
  //     ~200ms each that's ~6s the user spent staring at "Capturing
  //     snapshots…". Now it's instant.
  //   • SAME CONTENT: c.snapshot is the 800px JPEG with strokes
  //     baked in, captured at the exact frame the user commented
  //     on. The fresh capture would produce the same thing (same
  //     strokes, same frame, same 800px quality), so no visual
  //     difference.
  const v = item.video;
  const prevTime = v.currentTime;
  const wasPaused = v.paused;
  const SNAP_MAX_W = 0; // 0 = use video native resolution
  const captureOne = (c) => new Promise((resolve) => {
    // Fast path: c.snapshot exists and is a valid data URL → use it
    if (c.snapshot && c.snapshot.startsWith('data:image/')) {
      resolve(c.snapshot);
      return;
    }
    // Slow path: legacy comments without a baked-in snapshot, OR
    // the snapshot is somehow not a data URL (corrupted?). Try to
    // fresh-capture from the video. This only happens for very old
    // comments or edge cases.
    if (!v) { resolve(''); return; }
    const tryCapture = (tries) => {
      if (tries <= 0) { resolve(''); return; }
      try {
        if (v.readyState >= 2 && Math.abs((v.currentTime || 0) - (c.time || 0)) < 0.05) {
          const dataUrl = videoAnnoCaptureSnapshot(v, SNAP_MAX_W, c.annoStrokes);
          resolve(dataUrl || '');
        } else if (tries > 7) {
          // Start with longer waits (video needs time to seek) and
          // tighten up. R73: was inverted (80ms then 40ms) which
          // gave up too early on slow seeks.
          setTimeout(() => tryCapture(tries - 1), 120);
        } else {
          setTimeout(() => tryCapture(tries - 1), 60);
        }
      } catch (e) { resolve(''); }
    };
    try { v.currentTime = c.time || 0; } catch (e) { resolve(''); return; }
    setTimeout(() => tryCapture(10), 80);
  });
  // Pause once for all captures, but only if we actually need to
  // fresh-capture any comment. The fast path doesn't touch the
  // video, so we can skip the pause/play round-trip entirely.
  const needsFreshCapture = comments.some(c => !c.snapshot || !c.snapshot.startsWith('data:image/'));
  if (needsFreshCapture) {
    try { v.pause(); } catch (e) {}
    toast('Capturing ' + comments.length + ' snapshot' + (comments.length === 1 ? '' : 's') + '…');
  }
  const dataUrls = [];
  for (let i = 0; i < comments.length; i++) {
    dataUrls.push(await captureOne(comments[i]));
  }
  // Restore the user's previous playhead + play state (only if we
  // disturbed the video above)
  if (needsFreshCapture) {
    try { v.currentTime = prevTime; } catch (e) {}
    if (!wasPaused) { try { v.play().catch(() => {}); } catch (e) {} }
  }
  // ── 2) Layout params — 2-COLUMN storyboard, Figma-style ─────────
  // Round 68 redesign (user ref @image#1): the previous version was a
  // single tall column of 360x203 images + 440-wide text blocks. That
  // layout worked for 3-5 comments but got unusable past 8 (the column
  // ran off the bottom of a 1080p canvas) and the image/text scales
  // were mismatched — the image dominated the text, making the body
  // hard to read. New rules:
  //
  //   • ALWAYS 2 columns (regardless of count), so 30+ snaps stay
  //     compact and the user can see the whole storyboard without
  //     endless vertical scrolling.
  //   • Image 160x90 (16:9) — matches the popover comment-list
  //     thumbnail size EXACTLY (see `.media-anno-comment .comment-thumb`
  //     at line 876). The user asked: "the pic on the app the scale
  //     of it is not right, it should be same as the screen and on
  //     the comment list" — so we read the popover's width/height
  //     directly and reuse them. Now the user sees the same-sized
  //     thumbnail in the popover, in the lightbox, and on the board.
  //     (Popover's three size variants are 128/160/192 wide; we use
  //     160 to match the default medium size. If a future change
  //     makes the popover default different, just update the two
  //     numbers below.)
  //   • ONE text block per pair, not two: a tiny dimmed chip on top
  //     ("[ f 141 · 0:04 ]") and the body text below it in 14px
  //     white, both rendered inside a single contentEditable via
  //     two inline-styled <div> children. The user can edit the
  //     whole text as a single unit, drag it as a single unit, and
  //     style it as a single unit — matches their request "the
  //     time and frame number need to combine with the comment,
  //     don't separate to two text boxes".
  //   • AUTO-FIT width (was: fixed 300px). The previous version left
  //     a long blank tail to the right of short comments like
  //     "sad" / "asd" / "dsf" — looked like the box was sized for
  //     a paragraph, not a 3-letter word. New rules: width =
  //     max(minW, natural content width, capped to maxW) so the
  //     box shrink-wraps to whatever the user typed. minW=100 is
  //     just wide enough for the chip line "[ f 1276 · 0:42 ]";
  //     maxW=200 is slightly wider than the 160px image (16:9
  //     thumb) so the body can wrap to one more line for longer
  //     comments while the layout still looks balanced.
  //   • Font sizes are proportional to the image (the 10px chip +
  //     12px body match a 160x90 thumbnail so the text doesn't
  //     dominate). Body 12px is the comfortable reading size next
  //     to a thumbnail of this scale.
  //   • DYNAMIC row height: each column tracks its own running Y so
  //     long text in row 3 of the left column doesn't break the
  //     right column. The next row in a column starts after the
  //     LONGER of image or (chip + gap + body) of the previous row.
  //   • 30+ snaps: layout stays clean because (a) 2 columns keeps
  //     horizontal density, (b) per-pair size is capped so total
  //     height ≈ ceil(N/2) * 110px which is ~5px/row — a 30-pair
  //     storyboard is ~1.6k tall, a 60-pair is ~3.3k, both pan
  //     smoothly on the canvas. The viewport re-centers on the
  //     layout's midpoint so the user lands in the middle, not
  //     the top corner.
  const COLS = 2;                 // always 2 columns
  // Round 78: use the VIDEO'S actual aspect ratio instead of forcing 16:9
  // so portrait videos (e.g. 9:16 phone clips) render correctly and the
  // 800px-wide captured snapshot doesn't get stretched/squished. Capped
  // at 480px on-screen so a 30-pair storyboard still fits comfortably.
  const VW = (v && v.videoWidth) ? v.videoWidth : 1920;
  const VH = (v && v.videoHeight) ? v.videoHeight : 1080;
  const IMG_MAX_W = 480;
  const IMG_W = Math.min(IMG_MAX_W, VW);
  const IMG_H = Math.max(60, Math.round(IMG_W * VH / VW));
  const TEXT_GAP = 12;            // horizontal gap between image and text
  const TEXT_MIN_W = 100;         // min text width — long enough for "[ f NNNN · M:SS ]"
  const TEXT_MAX_W = 200;         // max text width — ~25% wider than image (16:9 thumb)
  const CHIP_BODY_GAP = 7;        // vertical gap between chip and body
  const ROW_GAP = 18;             // vertical gap between rows in a column
  const COL_GAP = 56;             // distance from the right edge of the video
                                   // (also used as the gap between the 2 columns)
  const CHIP_FONT = 18;           // small dimmed chip ("[ f 141 · 0:04 ]")
  const BODY_FONT = 22;           // body comment text — matches popover fs-medium
  // PAIR_W uses TEXT_MAX_W (not actual text width) so the two columns
  // are always separated by the same distance regardless of how short
  // or long each comment is. The text box's actual width varies per
  // pair (auto-fit), but the IMAGE position is fixed → the user sees
  // two clean columns of images, with text extending to its natural
  // width into the white space between the columns.
  const PAIR_W = IMG_W + TEXT_GAP + TEXT_MAX_W;   // total horizontal span of one pair
  // Anchor: right edge of the video, aligned to the top of the video
  const startX = (item.x + item.w) + COL_GAP;
  const startY = item.y;
  // ── 3) Capture pre-batch state for a single-undo batch ────────
  // Each addImage / addText below pushes its own snapshot. After the
  // batch we collapse all those intermediate snapshots down to one
  // pre-batch snapshot, so Ctrl+Z reverts the whole storyboard in a
  // single step (matches the user's mental model of "I sent N comments
  // to the board" = one action).
  const preBatchSnap = captureSnapshot();
  const initialUndoLen = state.undoStack.length;
  const newItemIds = [];
  // Per-column running Y. Each column advances its OWN Y as pairs
  // are added, so a 6-line text in row 3 of the left column doesn't
  // push the right column's row 3 down — they stay independent.
  const colY = [startY, startY];
  let actualRowsRendered = 0;  // total row count actually placed (for viewport pan)
  for (let i = 0; i < comments.length; i++) {
    const c = comments[i];
    const dataUrl = dataUrls[i];
    if (!dataUrl) continue;
    const col = i % COLS;            // 0 = left, 1 = right
    const rowY = colY[col];
    const colX = startX + col * (PAIR_W + COL_GAP);
    const isLastInBatch = (i === comments.length - 1);
    // ── Image: pass natW=400/natH=225 (16:9) so addImage doesn't resize
    // (its maxW is 720). The image src is the high-res 800px JPEG, so it
    // stays sharp when the user zooms in on the board.
    const imgItem = addImage(dataUrl, 400, 225, colX, rowY, false, isLastInBatch);
    if (imgItem) {
      imgItem.w = IMG_W;
      imgItem.h = IMG_H;
      // R73: match the popover comment-list thumbnail EXACTLY. The
      // popover uses a <div> with `background-image: url(snap);
      // background-size: contain; background-color: #000`, which
      // letterboxes non-16:9 sources inside a 160×90 box. The
      // on-board image was previously using a plain <img> with
      // `width:100%; height:100%` — that STRETCHES non-16:9
      // sources, making them look wider/taller than the popover
      // thumb even though both are "160×90". The user said: "the
      // pic on the app the scale of the it is not right, it
      // should be same as the screen and on the comment list".
      // Fix: add `object-fit: contain` (mirrors background-size:
      // contain) and a black bg (mirrors background: #000) on the
      // <img> AND the container, so the letterbox bars look
      // identical in both places.
      try {
        if (imgItem.img) {
          imgItem.img.style.objectFit = 'contain';
          imgItem.img.style.backgroundColor = '#000';
          // R73: defense-in-depth for "image is loss and error".
          // If the browser can't decode the data URL (corrupt
          // JPEG, data URL too long, etc.) the <img> fires
          // `error` and renders a broken-image icon. Swap to a
          // styled placeholder div with the frame number so the
          // user sees something useful instead of a red X. The
          // popover uses the same `.no-snap` pattern (line 912).
          imgItem.img.onerror = function() {
            try {
              const ph = document.createElement('div');
              ph.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.4);font-size:10px;font-family:Inter,sans-serif;background:linear-gradient(135deg,rgba(255,255,255,0.04),rgba(255,255,255,0.08));pointer-events:none;';
              ph.textContent = 'f ' + (c.frame || 0);
              imgItem.el.appendChild(ph);
              imgItem.img.style.display = 'none';
            } catch (e) {}
          };
          // R73: also check synchronously in case the image
          // already failed (e.g. empty src, decode error caught
          // synchronously). `complete && naturalWidth === 0` is
          // the standard "broken image" detection pattern.
          if (imgItem.img.complete && imgItem.img.naturalWidth === 0 && imgItem.img.src) {
            imgItem.img.onerror();
          }
        }
        imgItem.el.style.backgroundColor = '#000';
      } catch (e) {}
      updateItemStyle(imgItem);
      newItemIds.push(imgItem.id);
    }
    // ── Text: translation if available, otherwise the original.
    // The user asked to COMBINE the time/frame chip with the comment
    // body into a single text box (not two separate boxes). We achieve
    // that by creating ONE text item and populating it with rich HTML:
    // a dimmed <div> for the chip line and a white <div> for the body
    // text. The whole thing is one contentEditable — the user can
    // edit / move / style it as a single unit, and the chip + body
    // can never drift apart because they're inside the same DOM node.
    const m = Math.floor((c.time || 0) / 60);
    const s = Math.floor((c.time || 0) % 60);
    const timeStr = m + ':' + (s < 10 ? '0' : '') + s;
    const hasTranslation = !!(c.translation && c.translation !== c.text);
    const body = (hasTranslation ? c.translation : c.text || '').trim();
    const textX = colX + IMG_W + TEXT_GAP;
    // ── Build the combined HTML ────────────────────────────────────
    // Font sizes are FIXED CSS values (NOT divided by zoom). The
    // canvas transform:scale(zoom) naturally scales them — same as
    // images/videos on the board. Round 54's on-screen-constant
    // convention (via applyTextProps) is for text-tool items; Board
    // storyboard elements should scale with the canvas so they stay
    // proportional regardless of zoom.
    // We escape the body text to prevent user input from breaking the
    // HTML structure (e.g. typing "<" would otherwise close the body
    // div and leak into the chip). The chip text is purely numeric
    // (frame#, mm:ss) so no escaping needed.
    const chipText = '[ f ' + c.frame + ' · ' + timeStr + ' ]';
    const chipHTML = '<div style="color:rgba(255,255,255,0.55);font-size:' + CHIP_FONT + 'px;line-height:1.35;letter-spacing:0.02em;white-space:nowrap;">' + chipText + '</div>';
    const bodyHTML = body ? '<div style="color:#ffffff;font-size:' + BODY_FONT + 'px;line-height:1.4;margin-top:' + CHIP_BODY_GAP + 'px;white-space:pre-wrap;word-break:break-word;">' + escapeHTML(body) + '</div>' : '';
    // ── Create the text item (use a tiny initW so the auto-fit step
    // measures the natural width from a known loose state, not from
    // the default 300px which would already be wider than most chips).
    const textItem = addText(textX, rowY, '', { noFocus: true, initW: 50 });
    if (textItem) {
      // Replace the empty textContent with the rich HTML. addText
      // already pushed a snapshot; autoFitTextItem will update the
      // size; the undo batch in step 4 collapses both into one.
      textItem.el.innerHTML = chipHTML + bodyHTML;
      // Auto-fit: shrink width to the longest line of content (clamped
      // to [TEXT_MIN_W, TEXT_MAX_W]) and grow height for wrapped lines.
      // autoFitTextItem is the dedicated helper for storyboard-style
      // text; falls back to autoGrowTextItem (which always uses
      // minW=120) if the helper isn't present.
      if (typeof autoFitTextItem === 'function') {
        autoFitTextItem(textItem, { minW: TEXT_MIN_W, maxW: TEXT_MAX_W });
      } else if (typeof autoGrowTextItem === 'function') {
        textItem.w = TEXT_MAX_W;
        autoGrowTextItem(textItem);
      }
      // Lock the width so future keystrokes only grow height (not
      // re-shrink the box). The user can still manually drag a
      // resize handle if they want a different width.
      textItem._autoGrowLocked = true;
      newItemIds.push(textItem.id);
    }
    // ── Advance this column's Y by the LONGER of image or text item.
    // Variable text width means variable text height too (multi-line
    // body → taller box). Using max() keeps both columns balanced.
    const textH = textItem ? (textItem.h || 0) : 0;
    const pairH = Math.max(IMG_H, textH);
    colY[col] = rowY + pairH + ROW_GAP;
    if (col === COLS - 1) actualRowsRendered++;
  }
  // ── 4) Collapse intermediate undo snapshots → single pre-batch ──
  // The addImage / addText calls each pushed their own snapshot. We
  // truncate the stack to what it was before the batch and push our
  // single pre-batch snapshot on top, so Ctrl+Z reverts the whole
  // storyboard in one step.
  try {
    state.undoStack.length = initialUndoLen;
    state.undoStack.push(preBatchSnap);
    state.redoStack = [];
    updateStatus();
  } catch (e) {}
  // ── 5) Select all the new items so the user sees the result ─────
  // (Per user choice: separate items, NOT grouped. They can move /
  // delete / edit each one independently — image / chip / body are
  // 3 siblings per pair, all independently selectable.)
  if (newItemIds.length > 0) {
    // Select all new items at once. We bypass the per-item toggleSelect
    // (which calls refreshSelection on every call, expensive for 90+
    // items) by populating state.selected directly and refreshing once.
    try { clearSelection(); } catch (e) {}
    newItemIds.forEach(id => { state.selected.add(id); });
    refreshSelection();
  }
  // ── 6) Pan the viewport to the new layout so the user sees it ──
  // Center on the midpoint of the 2-column block. For 30+ pairs the
  // block is tall — landing in the middle lets the user immediately
  // see the top half + scroll/pan to the rest. We use max(colY) so
  // the pan accounts for uneven column heights from long text.
  try {
    const finalY = Math.max(colY[0], colY[1]);
    const totalH = finalY - startY;
    const blockW = COLS * PAIR_W + (COLS - 1) * COL_GAP;
    const centerX = startX + blockW / 2;
    const centerY = startY + totalH / 2;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    state.pan.x = viewportW / 2 - centerX * state.zoom;
    state.pan.y = viewportH / 2 - centerY * state.zoom;
    // updateCanvas() is the canonical function for refreshing the
    // viewport transform after pan/zoom changes.
    if (typeof updateCanvas === 'function') updateCanvas();
  } catch (e) {}
  toast('Sent ' + comments.length + ' comment' + (comments.length === 1 ? '' : 's') + ' to board as a 2-column storyboard — click any text to edit (time chip + comment are combined in one box)');
  // Auto-close the comment list popover so the user can see the board result immediately
  try { if (item.el && item.el._setListOpen) item.el._setListOpen(false); } catch(e) {}
}

export function videoAnnoJumpToComment(id) {
  const item = videoAnnoGetSelected();
  if (!item || !item.video) return;
  const anno = videoAnnoEnsure(item);
  const c = anno.comments.find(x => x.id === id);
  if (!c) return;
  const v = item.video;
  // Pause + seek. Use the stored time for accuracy (frame*fps can drift due
  // to keyframe intervals on some codecs).
  try { v.pause(); } catch (err) {}
  v.currentTime = c.time;
  // Pause the playback toggle button label so it reads "▶ Play"
  const playBtn = document.getElementById('btn-video-anno-play');
  if (playBtn) playBtn.textContent = '▶ Play';
  const orig = document.getElementById('btn-video-play');
  if (orig) orig.textContent = '▶️ Play';
  // (Draw was removed — we don't open a separate Draw toolbar after jumping.
  //  The list popover (if open) is enough to see which comment is active.)
  // Briefly mark the comment as active in the UI so the user sees what they jumped to
  videoAnnoRefreshCommentList(item, id);
  // Show the translation (if any) as the displayed text; show the original on
  // hover via the "↺" button. The user said "keep the chinese and remove the
  // english" — so the translation is the primary line.
  const dispText = c.translation || c.text;
  toast('Jumped to frame ' + c.frame + ' — comment: ' + dispText);
}

// ── Review Mode: J/K to jump between comments ──
// Press J to jump to the previous comment frame, K for the next.
// Only active when a single video is selected and has comments.
// This gives directors/reviewers a fast keyboard-driven way to
// scan through all commented frames — like Premiere's "Go to Next
// Marker" workflow but for video annotation comments.

export function videoAnnoGetSortedComments(item) {
  if (!item) return null;
  const anno = videoAnnoEnsure(item);
  const comments = (anno && Array.isArray(anno.comments)) ? anno.comments : [];
  if (!comments.length) return null;
  // Sort by frame ascending so J/K navigation is predictable
  return comments.slice().sort(function(a, b) { return (a.frame || 0) - (b.frame || 0); });
}

export function videoAnnoJumpToNextComment(item) {
  if (!item) return false;
  const sorted = videoAnnoGetSortedComments(item);
  if (!sorted) return false;
  if (!item.video) return false;
  var curTime = item.video.currentTime;
  // Find the first comment whose time is > currentTime (with a small
  // epsilon so we don't skip the current frame's comment)
  var next = null;
  for (var i = 0; i < sorted.length; i++) {
    if (sorted[i].time > curTime + 0.001) { next = sorted[i]; break; }
  }
  // Wrap: if no later comment, go to the first one
  if (!next) next = sorted[0];
  videoAnnoJumpToComment(next.id);
  // Toast with position info
  var idx = sorted.indexOf(next) + 1;
  toast('Comment ' + idx + '/' + sorted.length + ' — Frame ' + next.frame);
  _showReviewOverlay(item, next, idx, sorted.length);
  return true;
}

export function videoAnnoJumpToPrevComment(item) {
  if (!item) return false;
  const sorted = videoAnnoGetSortedComments(item);
  if (!sorted) return false;
  if (!item.video) return false;
  var curTime = item.video.currentTime;
  // Find the last comment whose time is < currentTime
  var prev = null;
  for (var i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].time < curTime - 0.001) { prev = sorted[i]; break; }
  }
  // Wrap: if no earlier comment, go to the last one
  if (!prev) prev = sorted[sorted.length - 1];
  videoAnnoJumpToComment(prev.id);
  // Toast with position info
  var idx = sorted.indexOf(prev) + 1;
  toast('Comment ' + idx + '/' + sorted.length + ' — Frame ' + prev.frame);
  _showReviewOverlay(item, prev, idx, sorted.length);
  return true;
}

// Show a brief overlay ON the video (top-center) with the comment text
// so the user sees the feedback right where they're looking — not just
// at the page bottom toast. Auto-fades after 1.4s.
export function _showReviewOverlay(item, comment, idx, total) {
  if (!item || !item.el) return;
  var host = item.el;
  // Remove any existing overlay so rapid J/K presses don't stack
  var existing = host.querySelector('.review-mode-overlay');
  if (existing) existing.remove();
  var overlay = document.createElement('div');
  overlay.className = 'review-mode-overlay';
  var dispText = (comment && (comment.translation || comment.text)) || '(no text)';
  var shortText = (dispText.length > 60) ? dispText.substring(0, 60) + '…' : dispText;
  overlay.innerHTML = '<div class="rmo-position">Comment ' + idx + ' / ' + total + ' — Frame ' + (comment.frame || 0) + '</div><div class="rmo-text">' + shortText.replace(/[<>&]/g, function(c) { return ({'<':'&lt;','>':'&gt;','&':'&amp;'})[c]; }) + '</div>';
  host.appendChild(overlay);
  setTimeout(function() {
    if (overlay && overlay.parentNode) {
      overlay.classList.add('rmo-fading');
      setTimeout(function() { if (overlay && overlay.parentNode) overlay.remove(); }, 300);
    }
  }, 1400);
}

// Helper: find the video item under the mouse cursor (used by J/K Review Mode).
// Returns the item object or null. Works whether the video is selected or not —
// just needs the mouse hovering over any video on the board.
export function videoAnnoGetItemUnderCursor(e) {
  if (!state || !state.items) return null;
  // Use e.clientX/Y from the keydown event (mouse position at time of keypress)
  var cx = (typeof e.clientX === 'number') ? e.clientX : (state.mouse ? state.mouse.x : -1);
  var cy = (typeof e.clientY === 'number') ? e.clientY : (state.mouse ? state.mouse.y : -1);
  if (cx < 0 || cy < 0) return null;
  var el = document.elementFromPoint(cx, cy);
  if (!el) return null;
  // Walk up to find the .item container
  var itemEl = el.closest('.item');
  if (!itemEl) return null;
  // Find the matching item in state.items
  for (var i = 0; i < state.items.length; i++) {
    if (state.items[i].el === itemEl && (state.items[i].video || state.items[i].isVideo)) {
      return state.items[i];
    }
  }
  return null;
}

// ── Lightbox: full-size view of a single comment's snapshot+strokes ──
// The user said "i want can choose the snap shot to check the big image,
// now only the small pic". The lightbox shows the full snapshot (with
// any annotation strokes composited on top) at the largest size that
// fits the viewport, plus the frame # / time / comment text on the
// right, plus quick action buttons (Jump to frame, Export this one).
//
// Implementation: a single shared lightbox DOM element portaled to
// <body>. We rebuild the image area each time from the comment's
// stored snapshot + strokes (so the lightbox always matches what was
// saved, regardless of any later video frame changes).
export let _videoAnnoLightboxEl = null;
export function _videoAnnoEnsureLightbox() {
  if (_videoAnnoLightboxEl) return _videoAnnoLightboxEl;
  const lb = document.createElement('div');
  lb.className = 'video-anno-lightbox';
  lb.addEventListener('click', function(ev) {
    // Click on backdrop (not on image/info) closes the lightbox
    if (ev.target === lb) _videoAnnoCloseLightbox();
  });
  const closeBtn = document.createElement('button');
  closeBtn.className = 'lb-close';
  closeBtn.innerHTML = '×';
  closeBtn.title = 'Close (Esc)';
  closeBtn.addEventListener('click', function(ev){ ev.stopPropagation(); _videoAnnoCloseLightbox(); });
  lb.appendChild(closeBtn);
  const stage = document.createElement('div');
  stage.className = 'lb-stage';
  const imgWrap = document.createElement('div');
  imgWrap.className = 'lb-img-wrap';
  // Round 6: zoom bar — − / + buttons, fit/actual toggle, % readout
  const zoomBar = document.createElement('div');
  zoomBar.className = 'lb-zoom-bar';
  zoomBar.innerHTML =
    '<button class="lb-zoom-out" title="Zoom out">−</button>' +
    '<span class="lb-zoom-label">Fit</span>' +
    '<button class="lb-zoom-in" title="Zoom in">+</button>' +
    '<button class="lb-zoom-fit toggle active" title="Fit to screen (0)">Fit</button>' +
    '<button class="lb-zoom-actual toggle" title="Actual size (1)">1:1</button>' +
    '<button class="lb-zoom-reset" title="Reset zoom (0)">↺</button>';
  imgWrap.appendChild(zoomBar);
  stage.appendChild(imgWrap);
  const info = document.createElement('div');
  info.className = 'lb-info';
  stage.appendChild(info);
  lb.appendChild(stage);
  document.body.appendChild(lb);
  // Esc closes
  document.addEventListener('keydown', function(ev) {
    if (ev.key === 'Escape' && lb.classList.contains('open')) {
      _videoAnnoCloseLightbox();
    }
  });
  _videoAnnoLightboxEl = lb;
  return lb;
}
export function _videoAnnoCloseLightbox() {
  if (!_videoAnnoLightboxEl) return;
  _videoAnnoLightboxEl.classList.remove('open');
  try { document.body.style.overflow = ''; } catch (e) {}
}

// Round 6: lightbox image zoom helpers.
// `_lbMountImage` wraps an image element (canvas or <img>) in a
// `.lb-img-inner` div so we can resize it for zoom, then wires up
// the zoom controls. `_lbSetupZoom` does the actual zoom math and
// event binding. The zoom bar lives in the lightbox DOM (created
// once in `_videoAnnoEnsureLightbox`) and is preserved across
// image mounts.
export function _lbMountImage(imgWrap, imgEl) {
  // Preserve the zoom bar (added once in _videoAnnoEnsureLightbox)
  const _zb = imgWrap.querySelector('.lb-zoom-bar');
  // Clear only the image content, keep the zoom bar
  Array.from(imgWrap.children).forEach(ch => {
    if (!ch.classList.contains('lb-zoom-bar')) imgWrap.removeChild(ch);
  });
  if (_zb && _zb.parentNode !== imgWrap) imgWrap.appendChild(_zb);
  // Create the inner container that holds the image and gets sized
  // on zoom. We size BOTH the inner div and the image to the visual
  // zoom dimensions (not just transform:scale) so the scrollable
  // wrap can show scrollbars when the image is larger than the wrap.
  const lbInner = document.createElement('div');
  lbInner.className = 'lb-img-inner';
  lbInner.appendChild(imgEl);
  imgWrap.appendChild(lbInner);
  // Make the wrap focusable so keyboard shortcuts work
  try { imgWrap.setAttribute('tabindex', '0'); } catch (e) {}
  // Set up zoom logic
  _lbSetupZoom(imgWrap, lbInner, imgEl);
}

export function _lbSetupZoom(imgWrap, lbInner, imgEl) {
  const zoomBar = imgWrap.querySelector('.lb-zoom-bar');
  if (!zoomBar) return;
  const zoomLabel = zoomBar.querySelector('.lb-zoom-label');
  const zoomInBtn = zoomBar.querySelector('.lb-zoom-in');
  const zoomOutBtn = zoomBar.querySelector('.lb-zoom-out');
  const zoomFitBtn = zoomBar.querySelector('.lb-zoom-fit');
  const zoomActualBtn = zoomBar.querySelector('.lb-zoom-actual');
  const zoomResetBtn = zoomBar.querySelector('.lb-zoom-reset');

  // Get natural dimensions of the image
  const getDims = () => {
    if (imgEl.tagName === 'IMG') {
      return {
        w: imgEl.naturalWidth || imgEl.width || 720,
        h: imgEl.naturalHeight || imgEl.height || 405
      };
    } else {
      return { w: imgEl.width || 720, h: imgEl.height || 405 };
    }
  };

  let lbZoom = 1;
  let lbMode = 'fit';

  function _setZoom(zoom, mode) {
    lbZoom = zoom;
    lbMode = mode || 'custom';
    const dims = getDims();
    const w = Math.max(1, Math.round(dims.w * zoom));
    const h = Math.max(1, Math.round(dims.h * zoom));
    // Size the inner div and image to match the visual zoom
    lbInner.style.width = w + 'px';
    lbInner.style.height = h + 'px';
    imgEl.style.width = w + 'px';
    imgEl.style.height = h + 'px';
    lbInner.classList.toggle('zoomed', zoom > 1.01);
    // Update the label
    if (mode === 'fit') zoomLabel.textContent = 'Fit';
    else if (mode === 'actual') zoomLabel.textContent = '1:1';
    else zoomLabel.textContent = Math.round(zoom * 100) + '%';
    // Update toggle buttons
    zoomFitBtn.classList.toggle('active', mode === 'fit');
    zoomActualBtn.classList.toggle('active', mode === 'actual');
  }

  function _fitToScreen() {
    const dims = getDims();
    // Use clientWidth/Height but fall back to a sensible default
    // if the wrap hasn't laid out yet
    const wrapW = Math.max(200, (imgWrap.clientWidth || 600) - 24);
    const wrapH = Math.max(200, (imgWrap.clientHeight || 400) - 24);
    const zoomW = wrapW / dims.w;
    const zoomH = wrapH / dims.h;
    const zoom = Math.min(1, zoomW, zoomH);
    _setZoom(Math.max(0.05, zoom), 'fit');
    // Reset scroll to top-left
    try { imgWrap.scrollLeft = 0; imgWrap.scrollTop = 0; } catch (e) {}
  }

  // Round 9 fix: always fit-to-window as the default, even if the image
  // is small enough to show at 1:1. The user wants the preview to be
  // LARGE by default — a 320px-wide snapshot shouldn't sit at 320px on
  // a 1280px screen. Round 8's "1:1 if it fits" was a step too far in
  // the other direction; the user explicitly said "the snap preview
  // need full size". So we now always scale up to fill the available
  // viewport space. The "1:1" button is still there as the escape
  // hatch for users who want exact-pixel size.
  function _initialSize() {
    const dims = getDims();
    // 90% of viewport (accounting for the info column + padding + gap
    // which together take ~360px on desktop, ~0px on mobile if stacked)
    const isMobile = window.innerWidth <= 720;
    const infoW = isMobile ? 0 : 360;
    const maxW = Math.max(200, window.innerWidth - infoW - 48);
    const maxH = Math.max(200, window.innerHeight * 0.88);
    const zoomW = maxW / dims.w;
    const zoomH = maxH / dims.h;
    // Always scale up to fill. No upper cap — a 320px image on a 4K
    // screen legitimately wants to be ~5x bigger to fill the view.
    // If the image is very small (e.g. 100x100), the resulting zoom
    // might be > 8x; we still cap at 8x to avoid pathological
    // upscaling (and the user can manually zoom in further if needed).
    const zoom = Math.max(0.05, Math.min(8, Math.min(zoomW, zoomH)));
    _setZoom(zoom, 'fit');
    try { imgWrap.scrollLeft = 0; imgWrap.scrollTop = 0; } catch (e) {}
  }

  function _actualSize() {
    _setZoom(1, 'actual');
  }

  // Wire up buttons
  zoomInBtn.addEventListener('click', function() {
    _setZoom(Math.min(8, lbZoom * 1.25), 'custom');
  });
  zoomOutBtn.addEventListener('click', function() {
    _setZoom(Math.max(0.05, lbZoom / 1.25), 'custom');
  });
  zoomFitBtn.addEventListener('click', _fitToScreen);
  zoomActualBtn.addEventListener('click', _actualSize);
  zoomResetBtn.addEventListener('click', _fitToScreen);

  // Scroll-to-zoom (Ctrl/Cmd + wheel)
  imgWrap.addEventListener('wheel', function(ev) {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    const delta = ev.deltaY > 0 ? 0.9 : 1.1;
    _setZoom(Math.max(0.05, Math.min(8, lbZoom * delta)), 'custom');
  }, { passive: false });

  // Keyboard shortcuts (+/-/0/1)
  imgWrap.addEventListener('keydown', function(ev) {
    if (ev.key === '+' || ev.key === '=') {
      _setZoom(Math.min(8, lbZoom * 1.25), 'custom');
      ev.preventDefault();
    } else if (ev.key === '-' || ev.key === '_') {
      _setZoom(Math.max(0.05, lbZoom / 1.25), 'custom');
      ev.preventDefault();
    } else if (ev.key === '0') {
      _fitToScreen();
      ev.preventDefault();
    } else if (ev.key === '1') {
      _actualSize();
      ev.preventDefault();
    }
  });

  // Initial size after layout settles (the lightbox needs a frame
  // to compute its size before we can fit the image).
  // Round 8: use _initialSize() so 1:1 actual is used when it fits.
  requestAnimationFrame(function() {
    setTimeout(_initialSize, 50);
  });
}
export function videoAnnoOpenLightbox(c) {
  if (!c) return;
  const lb = _videoAnnoEnsureLightbox();
  const imgWrap = lb.querySelector('.lb-img-wrap');
  const info = lb.querySelector('.lb-info');
  // Round 6: clear previous content but preserve the zoom bar (added
  // once in _videoAnnoEnsureLightbox). The image-mount helper also
  // preserves it, but clearing here too avoids a flash of the old
  // image before the new one loads.
  Array.from(imgWrap.children).forEach(ch => {
    if (!ch.classList.contains('lb-zoom-bar')) imgWrap.removeChild(ch);
  });
  info.innerHTML = '';
  // Render the snapshot + strokes into a canvas so we can show the
  // annotation overlay at full size. The stored `c.snapshot` is the
  // baked-in version (already has strokes). We draw it directly into
  // a canvas, then overlay the strokes again on top in case the user
  // wants to see them in a different color/size — but actually the
  // baked snapshot already shows them, so we just display the image.
  // ── Build a composite image (snapshot + strokes re-rendered) ──
  // We rebuild from `c.snapshot` + `c.annoStrokes` so the lightbox
  // shows exactly what was saved, not what the video currently shows
  // (the video may have moved on, or the file may have been reloaded).
  const cw = c.snapshot ? 720 : 0;
  if (c.snapshot) {
    // Load the snapshot into an Image, then composite strokes
    const tmpImg = new Image();
    tmpImg.onload = function() {
      const ratio = Math.min(1, cw / tmpImg.naturalWidth);
      const dw = Math.max(1, Math.round(tmpImg.naturalWidth * ratio));
      const dh = Math.max(1, Math.round(tmpImg.naturalHeight * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = dw; canvas.height = dh;
      const ctx = canvas.getContext('2d');
      try { ctx.drawImage(tmpImg, 0, 0, dw, dh); } catch (e) {}
      // Overlay strokes (they're already baked in, but re-rendering
      // them on top in slightly bolder form keeps them crisp on the
      // large display)
      if (c.annoStrokes && c.annoStrokes.length) {
        const strokes = c.annoStrokes;
        const sx = dw, sy = dh;
        strokes.forEach(stk => {
          if (!stk || !stk.points || stk.points.length === 0) return;
          ctx.strokeStyle = stk.color || '#ff4444';
          ctx.fillStyle = stk.color || '#ff4444';
          const sw = Math.max(1.5, (stk.size || 4) * Math.min(sx, sy) / 400 * 1.3);
          ctx.lineWidth = sw;
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          const pts = stk.points.map(p => [p[0] * sx, p[1] * sy]);
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
            ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
            const angle = Math.atan2(y1 - y0, x1 - x0);
            const headLen = Math.max(10, sw * 3.2);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x1 - headLen * Math.cos(angle - Math.PI / 6), y1 - headLen * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(x1 - headLen * Math.cos(angle + Math.PI / 6), y1 - headLen * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fill();
          } else if (stk.type === 'box') {
            if (pts.length < 2) return;
            const [bx0, by0] = pts[0];
            const [bx1, by1] = pts[pts.length - 1];
            ctx.strokeRect(Math.min(bx0, bx1), Math.min(by0, by1), Math.abs(bx1 - bx0), Math.abs(by1 - by0));
          } else if (stk.type === 'circle') {
            if (pts.length < 2) return;
            const [cx0, cy0] = pts[0];
            const [cx1, cy1] = pts[pts.length - 1];
            const ccx = (cx0 + cx1) / 2, ccy = (cy0 + cy1) / 2;
            const crx = Math.max(0.5, Math.abs(cx1 - cx0) / 2);
            const cry = Math.max(0.5, Math.abs(cy1 - cy0) / 2);
            ctx.beginPath();
            ctx.ellipse(ccx, ccy, crx, cry, 0, 0, Math.PI * 2);
            ctx.stroke();
          } else if (stk.type === 'text') {
            const [tx, ty] = pts[0];
            const txt = (stk.text || '').trim();
            if (!txt) return;
            const fontSize = Math.max(12, (stk.size || 4) * 4.5);
            ctx.font = '600 ' + fontSize + 'px -apple-system, "SF Pro Display", system-ui, sans-serif';
            ctx.textBaseline = 'top';
            const metrics = ctx.measureText(txt);
            const padX = 6, padY = 4;
            const bgW = metrics.width + padX * 2;
            const bgH = fontSize * 1.15 + padY * 2;
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            const rx = 4;
            ctx.beginPath();
            ctx.moveTo(tx + rx, ty);
            ctx.lineTo(tx + bgW - rx, ty);
            ctx.quadraticCurveTo(tx + bgW, ty, tx + bgW, ty + rx);
            ctx.lineTo(tx + bgW, ty + bgH - rx);
            ctx.quadraticCurveTo(tx + bgW, ty + bgH, tx + bgW - rx, ty + bgH);
            ctx.lineTo(tx + rx, ty + bgH);
            ctx.quadraticCurveTo(tx, ty + bgH, tx, ty + bgH - rx);
            ctx.lineTo(tx, ty + rx);
            ctx.quadraticCurveTo(tx, ty, tx + rx, ty);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            ctx.fillStyle = stk.color || '#fff';
            ctx.fillText(txt, tx + padX, ty + padY);
          }
        });
      }
      // Round 6: mount the canvas via the zoom helper (preserves the
      // zoom bar, wraps the canvas in a transformable inner div, and
      // wires up zoom controls). The helper sets the image size to
      // match the natural dimensions; the user can then zoom in/out.
      _lbMountImage(imgWrap, canvas);
    };
    tmpImg.onerror = function() {
      // Fallback: just show the snapshot as an <img> with zoom support
      const fallback = new Image();
      fallback.alt = 'frame ' + (c.frame || 0);
      fallback.onload = function() { _lbMountImage(imgWrap, fallback); };
      fallback.onerror = function() {
        imgWrap.innerHTML = '<div style="color:#999;padding:40px;font-size:13px;">Failed to load snapshot</div>';
      };
      fallback.src = c.snapshot;
    };
    tmpImg.src = c.snapshot;
  } else {
    imgWrap.innerHTML = '<div style="color:#999;padding:40px;font-size:13px;">No snapshot for this comment</div>';
  }
  // Build info column: frame chip, time, text, actions
  const frameChip = document.createElement('span');
  frameChip.className = 'lb-frame';
  frameChip.textContent = 'f ' + (c.frame || 0);
  info.appendChild(frameChip);
  const ct = c.time || 0;
  const m = Math.floor(ct / 60), s = Math.floor(ct % 60);
  const timeStr = m + ':' + (s < 10 ? '0' : '') + s;
  const timeEl = document.createElement('div');
  timeEl.className = 'lb-time';
  timeEl.textContent = timeStr;
  info.appendChild(timeEl);
  const text = document.createElement('div');
  text.className = 'lb-text';
  const hasTr = !!(c.translation && c.translation !== c.text);
  text.textContent = hasTr ? c.translation : (c.text || '');
  info.appendChild(text);
  if (hasTr) {
    const trDir = document.createElement('div');
    trDir.style.cssText = 'font-size:10.5px;color:#b9b9c2;margin-top:6px;font-style:italic;';
    trDir.textContent = (c.translationDir || '').toUpperCase() + ' translation';
    info.appendChild(trDir);
  }
  if (c.annoStrokes && c.annoStrokes.length) {
    const annoMeta = document.createElement('div');
    annoMeta.style.cssText = 'font-size:11px;color:#00e5ff;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.08);';
    annoMeta.textContent = '✏ ' + c.annoStrokes.length + ' annotation' + (c.annoStrokes.length === 1 ? '' : 's') + ' drawn on this frame';
    info.appendChild(annoMeta);
  }
  // Actions
  const actions = document.createElement('div');
  actions.className = 'lb-actions';
  const jumpBtn = document.createElement('button');
  jumpBtn.textContent = '⏵ Jump to frame';
  jumpBtn.addEventListener('click', function(ev) {
    ev.stopPropagation();
    _videoAnnoCloseLightbox();
    if (typeof videoAnnoJumpToComment === 'function') videoAnnoJumpToComment(c.id);
  });
  actions.appendChild(jumpBtn);
  const dlBtn = document.createElement('button');
  dlBtn.textContent = '⤓ Download image';
  dlBtn.addEventListener('click', function(ev) {
    ev.stopPropagation();
    // Build a clean composite at high res and download
    if (!c.snapshot) { toast('No image to download'); return; }
    const dlImg = new Image();
    dlImg.onload = function() {
      const maxW = 1280;
      const ratio = Math.min(1, maxW / dlImg.naturalWidth);
      const dw = Math.max(1, Math.round(dlImg.naturalWidth * ratio));
      const dh = Math.max(1, Math.round(dlImg.naturalHeight * ratio));
      const c2 = document.createElement('canvas');
      c2.width = dw; c2.height = dh;
      const cx = c2.getContext('2d');
      try { cx.drawImage(dlImg, 0, 0, dw, dh); } catch (e) {}
      try {
        const dataUrl = c2.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'frame-' + (c.frame || 0) + '.png';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { try { document.body.removeChild(a); } catch (e) {} }, 100);
      } catch (e) { toast('Download failed'); }
    };
    dlImg.src = c.snapshot;
  });
  actions.appendChild(dlBtn);
  const closeBtn2 = document.createElement('button');
  closeBtn2.textContent = 'Close';
  closeBtn2.className = 'primary';
  closeBtn2.addEventListener('click', function(ev){ ev.stopPropagation(); _videoAnnoCloseLightbox(); });
  actions.appendChild(closeBtn2);
  info.appendChild(actions);
  // Open
  lb.classList.add('open');
  try { document.body.style.overflow = 'hidden'; } catch (e) {}
}

async function videoAnnoTranslateComment(id) {
  const item = videoAnnoGetSelected();
  if (!item) return;
  const anno = videoAnnoEnsure(item);
  const c = anno.comments.find(x => x.id === id);
  if (!c || !c.text) return;
  // Detect direction: if text contains CJK, translate zh→en; otherwise en→zh
  const hasCjk = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(c.text);
  const fromLang = hasCjk ? 'zh' : 'en';
  const toLang = hasCjk ? 'en' : 'zh';
  const langLabel = toLang === 'zh' ? '中文' : 'English';
  // Visual loading state
  const el = document.querySelector('[data-anno-comment-id="' + id + '"] .media-anno-comment-translation');
  if (el) { el.classList.add('loading'); el.textContent = 'Translating…'; }
  // Use the same cache key format as the mind-map translator
  const cacheKey = (fromLang === 'zh' ? 'zh-CN' : fromLang) + '|' + (toLang === 'zh' ? 'zh-CN' : toLang) + '|' + c.text;
  try {
    let translated = null;
    if (typeof translationCache !== 'undefined' && translationCache.has(cacheKey)) {
      translated = translationCache.get(cacheKey);
    } else {
      translated = await translateText(c.text, fromLang, toLang);
    }
    if (translated && translated !== c.text) {
      c.translation = translated;
      c.translationDir = fromLang + '-' + toLang;
      scheduleAutoSave();
      videoAnnoRefreshCommentList(item, id);
      // Stage A: refresh popover list and the seek-bar markers (so the
      // tooltip text on each flag matches the new translation)
      if (item.el) {
        if (item.el._refreshListBody) item.el._refreshListBody();
        if (item.el._refreshSeekMarkers) item.el._refreshSeekMarkers();
      }
      toast('Translated to ' + langLabel);
    } else {
      if (el) { el.classList.remove('loading'); el.textContent = 'No translation available'; }
      toast('Translation returned no change');
    }
  } catch (err) {
    console.warn('Comment translation failed:', err);
    if (el) { el.classList.remove('loading'); el.textContent = 'Translation failed — try again'; }
    toast('Translation failed');
  }
}

export function videoAnnoRefreshCommentList(item, highlightId) {
  // Resolve the in-player list element from the item. The right-panel element
  // is kept as a fallback for legacy callers but is no longer the source of truth.
  let list = (item && item.el && item.el._annoCommentsList) || document.getElementById('video-anno-comments-list');
  const empty = document.getElementById('video-anno-comments-empty');
  if (!list) {
    // Stage A: even if the in-player list isn't found, still refresh the
    // new popover list (which is the primary UI for Stage A).
    if (item && item.el && item.el._refreshListBody) item.el._refreshListBody();
    if (item && item.el && item.el._refreshAnnoBadges) item.el._refreshAnnoBadges();
    return;
  }
  // If no video selected, hide the list
  if (!item) {
    list.innerHTML = '';
    if (empty) { empty.style.display = 'block'; empty.textContent = 'Select a video to add frame-by-frame comments. Each comment is anchored to a frame number — click any comment to jump back to that frame.'; }
    return;
  }
  const anno = videoAnnoEnsure(item);
  if (empty) empty.style.display = anno.comments.length === 0 ? 'block' : 'none';
  if (empty && anno.comments.length === 0) {
    empty.textContent = 'No comments yet. Pause the video, then use 💬 Add to mark this frame.';
  }
  // Update the head badge (the listBtn badge is refreshed via _refreshAnnoBadges)
  if (item.el && item.el._annoCommentsHead) {
    const badgeEl = item.el._annoCommentsHead.querySelector('.badge');
    if (badgeEl) badgeEl.textContent = String(anno.comments.length);
  }
  // Sort: by frame (already sorted, but defensive)
  const comments = anno.comments.slice().sort((a, b) => a.frame - b.frame);
  list.innerHTML = '';
  comments.forEach(c => {
    const wrap = document.createElement('div');
    wrap.className = 'media-anno-comment' + (highlightId && c.id === highlightId ? ' active' : '');
    wrap.setAttribute('data-anno-comment-id', c.id);
    wrap.setAttribute('data-cid', c.id);
    wrap.setAttribute('data-cframe', String(c.frame || 0));
    const fps = (item.video && item.video._kraftedFps) || 30;
    const tt = c.time || 0;
    const m = Math.floor(tt / 60), s = Math.floor(tt % 60);
    const timeStr = m + ':' + (s < 10 ? '0' : '') + s;
    const hasTranslation = !!(c.translation && c.translation !== c.text);
    if (hasTranslation && !c.originalText) c.originalText = c.text;

    // Row top: snapshot thumbnail + main content (same layout as popover)
    const rowTop = document.createElement('div');
    rowTop.className = 'comment-row-top';

    // Snapshot thumbnail
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
    const thumbFrame = document.createElement('span');
    thumbFrame.className = 'thumb-frame';
    thumbFrame.textContent = 'f ' + (c.frame || 0);
    thumb.appendChild(thumbFrame);
    thumb.title = 'Click to view full-size snapshot with annotations';
    thumb.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
    thumb.addEventListener('click', function(ev){
      ev.stopPropagation();
      videoAnnoOpenLightbox(c);
    });
    thumb.addEventListener('dblclick', function(ev){
      ev.stopPropagation();
      videoAnnoJumpToComment(c.id);
    });
    rowTop.appendChild(thumb);

    // Main column
    const main = document.createElement('div');
    main.className = 'comment-main';

    const head = document.createElement('div');
    head.className = 'media-anno-comment-head';
    head.innerHTML =
      '<span class="frame-no" title="Jump to this frame">f ' + c.frame + '</span>' +
      '<span class="time-no" title="' + timeStr + '">' + timeStr + '</span>' +
      '<div class="actions">' +
        '<button class="goto" title="Jump to this frame (' + c.frame + ')">▶</button>' +
        '<button class="tr-btn" title="' + (hasTranslation ? 'Re-translate' : (/[\u4e00-\u9fff]/.test(c.text || '') ? 'Translate to English' : '翻译成中文')) + '">🌐</button>' +
        '<button class="del" title="Delete comment">×</button>' +
      '</div>';
    head.querySelector('.frame-no').onclick = (e) => { e.stopPropagation(); videoAnnoJumpToComment(c.id); };
    head.querySelector('.time-no').onclick = (e) => { e.stopPropagation(); videoAnnoJumpToComment(c.id); };
    head.querySelector('.goto').onclick = (e) => { e.stopPropagation(); try { videoAnnoJumpToComment(c.id); } catch(e){} };
    head.querySelector('.tr-btn').onclick = (e) => { e.stopPropagation(); videoAnnoTranslateComment(c.id); };
    head.querySelector('.del').onclick = (e) => { e.stopPropagation(); videoAnnoDeleteComment(c.id); };
    main.appendChild(head);

    const txt = document.createElement('div');
    txt.className = 'media-anno-comment-text' + (hasTranslation ? ' is-translation' : '');
    txt.textContent = hasTranslation ? c.translation : c.text;
    txt.title = hasTranslation ? 'Translation: ' + c.translation : c.text;
    main.appendChild(txt);
    rowTop.appendChild(main);
    wrap.appendChild(rowTop);

    wrap.addEventListener('click', function(ev){
      if (ev.target.closest('button')) return;
      if (ev.target.closest('.comment-thumb')) return;
      videoAnnoJumpToComment(c.id);
    });
    list.appendChild(wrap);
  });
  // Stage A: also refresh the new popover list + badges so the popover
  // and the listBtn badge stay in sync.
  if (item && item.el) {
    if (item.el._refreshListBody) item.el._refreshListBody();
    if (item.el._refreshAnnoBadges) item.el._refreshAnnoBadges();
  }
}

// (DRAW-only videoAnnoClear / videoAnnoUndo bodies removed — they only cleared
//  strokes/texts. Stub versions above just toast. No need for full impls.)

export function videoStep(direction) {
  // Step the selected video by one frame
  const item = videoAnnoGetSelected();
  if (!item || !item.video) return;
  const v = item.video;
  if (!v.paused) v.pause();
  // Detect or reuse FPS (same heuristic as keyboard frame-step)
  if (!v._kraftedFps) {
    let fps = 30;
    if (v.getVideoPlaybackQuality) {
      try {
        const q = v.getVideoPlaybackQuality();
        if (q.totalVideoFrames > 0 && v.duration > 0) fps = Math.round(q.totalVideoFrames / v.duration);
      } catch (err) {}
    }
    if (fps <= 0 || fps > 120) {
      const h = v.videoHeight || 0;
      if (h >= 1080) fps = 30; else if (h >= 720) fps = 30; else fps = 24;
    }
    v._kraftedFps = Math.max(12, Math.min(120, fps));
  }
  const frameTime = 1 / v._kraftedFps;
  const target = direction > 0
    ? Math.min(v.duration || 1e9, v.currentTime + frameTime)
    : Math.max(0, v.currentTime - frameTime);
  v.currentTime = target;
}

export function videoTogglePlay() {
  const item = videoAnnoGetSelected();
  if (!item || !item.video) return;
  const v = item.video;
  if (v.paused) {
    v.muted = false;
    v.play().catch(() => {});
  } else { v.pause(); }
  const playBtn = document.getElementById('btn-video-anno-play');
  if (playBtn) playBtn.textContent = v.paused ? '▶ Play' : '⏸ Pause';
  // Sync the original video play button label too
  const orig = document.getElementById('btn-video-play');
  if (orig) orig.textContent = v.paused ? '▶️ Play' : '⏸ Pause';
}

export function videoAnnoSaveProject() {
  const item = videoAnnoGetSelected();
  if (!item) { toast('Select a video first'); return; }
  const anno = videoAnnoEnsure(item);
  // Build a project blob: video src + comments metadata
  // (Draw was removed — only frame comments are saved now.)
  const project = {
    app: 'Krafted',
    version: 1,
    type: 'video-comments-project',
    savedAt: new Date().toISOString(),
    video: {
      src: item.src,           // Could be data: URL, blob: URL, or http(s)
      natW: item.natW,
      natH: item.natH,
      w: item.w,
      h: item.h,
    },
    annotation: {
      comments: anno.comments.map(c => ({
        id: c.id, frame: c.frame, time: c.time, text: c.text,
        translation: c.translation || '', translationDir: c.translationDir || '',
        createdAt: c.createdAt,
      })),
    },
  };
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'krafted-comments-' + Date.now() + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Comments saved — load it later to continue editing');
}

// (videoAnnoExportMp4 removed — draw was removed, so there's nothing to bake
//  into the video. To export the original video, the user can right-click
//  → "Save video as…" on the video element, or use the browser's built-in
//  download.)

// (Draw was removed — all videoAnnoSyncToSelection / selectOnly hooks /
//  clearSelection hooks / window resize listener / restoreSnapshot hooks /
//  addImage hooks are gone. There is no canvas, no pointer handlers, no
//  mode to sync. The frame-comment popover (Add / List) and the right-column
//  Save button work directly off `item.anno.comments`.)
export function updateVideoControls(item) {
  if (!item || !item.video) return;
  const v = item.video;
  document.getElementById('btn-video-play').textContent = v.paused ? '▶️ Play' : '⏸ Pause';
  document.getElementById('prop-video-vol').value = v.muted ? 0 : Math.round(v.volume * 100);
  document.getElementById('prop-video-vol-val').textContent = v.muted ? '0%' : Math.round(v.volume * 100) + '%';
  // Update speed selector
  const speedSel = document.getElementById('prop-video-speed');
  if (speedSel) speedSel.value = String(item.playbackRate || 1);
  // Update timeline
  updateVideoTimeline(item);
  updateVideoPlayhead(item);
}
