import { removeBrushCanvas } from './masking.js';
import { updateAutoFitPaper } from './paper.js';
import { getSelectedItems, refreshSelection } from './selection.js';
import { state, canvasContent } from './core-state.js';
import { scheduleAutoSave } from './save-load.js';
import { toast } from './ui-utils.js';
import { updateMediaBar } from './media-bar.js';
import { scheduleAutoSave } from './save-load.js';
import { removeStrokeById } from './draw-items.js';
import { redrawDrawLayer } from './draw-layer.js';
import { pushUndo } from './undo-redo.js';

// ============================================================
//  DELETE
// ============================================================
// Clean up video resources for a single item (pause, revoke blob URL)
export function cleanupVideoItem(item, revokeBlob) {
  if (!item.video) return;
  if (revokeBlob === undefined) revokeBlob = true;
  item.video.pause();
  const vsrc = item.video.src;
  item.video.removeAttribute('src');
  item.video.load();
  // Round 53: only revoke the blob URL when the item is truly being
  // discarded (deleteSelected, board clear). cleanupAllItems() also runs
  // during restoreSnapshot, and the snapshot being restored still holds
  // a reference to the same blob URL — revoking here would break the
  // freshly-restored <video> element (it'd silently fail to load, the
  // player goes black, and the user sees the mov as "lost"). The blob
  // stays alive as long as the undo stack references it; the URLs
  // eventually get reclaimed when the page unloads.
  if (revokeBlob && vsrc && vsrc.startsWith('blob:')) URL.revokeObjectURL(vsrc);
}
// Detach the comments popover (lives on <body>) for an item.
// We must remove it explicitly when the item is removed, because the
// popover is NO LONGER a child of the item element (it was moved to
// <body> to escape the item's transform stacking context). Without
// this, deleted items would leave orphaned popovers floating on screen.
export function removeAnnoPopoversFor(item) {
  if (!item || !item.el) return;
  const l = item.el._annoListPopover;
  if (l && l.parentNode) l.parentNode.removeChild(l);
  item.el._annoListPopover = null;
  // Also reset the floating pill ref so a new item doesn't inherit a
  // stale fab reference from the deleted one (e.g. through getSelection).
  item.el._annoCommentsFab = null;
}
// Walk every state item and re-position any open annotation popover.
// Called on pan, item-move, and resize so the popover stays parallel to
// the video. Only items with an open popover do real work.
export function repositionAllAnnoPopovers() {
  if (!state || !state.items) return;
  state.items.forEach(it => {
    if (it && it.el && typeof it.el._repositionAnnoPopovers === 'function') {
      it.el._repositionAnnoPopovers();
    }
  });
}
// Round 52: walk every state item and re-position the floating annotation
// toolbar (the "draw panel" beside the player). The toolbar lives on <body>
// at position: fixed, sized by --tb-scale. When the canvas zooms, the
// video's screen-pixel BCR changes, so we must re-run _positionToolbar to
// re-apply the scale and re-snap the left/top. Cheap: the function early-
// returns if the toolbar is hidden or the video is off-screen.
export function repositionAllAnnoToolbars() {
  if (!state || !state.items) return;
  state.items.forEach(it => {
    if (it && it.el && typeof it.el._repositionAnnoToolbar === 'function') {
      try { it.el._repositionAnnoToolbar(); } catch (e) {}
    }
  });
}
// Clean up all items (for board clear / restore)
export function cleanupAllItems() {
  state.items.forEach(i => {
    // Round 53: pass revokeBlob=false — this runs during restoreSnapshot
    // (board clear is a separate path). The snapshot being restored may
    // still hold the same blob URL, so we must not invalidate it here.
    cleanupVideoItem(i, false);
    removeAnnoPopoversFor(i);
    // R72: tear down body-attached per-item UI before removing the card.
    // Without this the draw toolbar (annoToolbar), cursor ring, and any
    // open text editor (with its floating translate button) would stay
    // floating on body after undo — the user reported "the draw panel
    // stays on the screen" and "the mov player will close" (the open
    // editor on the OLD element was a stale reference). Each helper is
    // guarded so it's safe to call when the element is already gone or
    // never existed.
    try {
      if (i._annoToolbar && i._annoToolbar.parentNode) {
        i._annoToolbar.parentNode.removeChild(i._annoToolbar);
      }
    } catch (e) {}
    try {
      if (i._annoCursorRing && i._annoCursorRing.parentNode) {
        i._annoCursorRing.parentNode.removeChild(i._annoCursorRing);
      }
    } catch (e) {}
    try {
      if (i._textEditorEl && i._textEditorEl.parentNode) {
        // The editor's _commit/_cancel path also removes its trBtn, but
        // that code expects a live item. Just yank both from body.
        if (i._textEditorEl._trBtn && i._textEditorEl._trBtn.parentNode) {
          i._textEditorEl._trBtn.parentNode.removeChild(i._textEditorEl._trBtn);
        }
        i._textEditorEl.parentNode.removeChild(i._textEditorEl);
      }
    } catch (e) {}
    i.el.remove();
  });
  state.texts.forEach(t => t.el.remove());
  (state.todos||[]).forEach(t => t.el.remove());
  (state.mindmaps||[]).forEach(t => t.el.remove());
  // R72: also sweep any orphan body-attached elements that didn't get
  // a tracker. Draw toolbars created before this fix were never stashed
  // on el, so the per-item loop above wouldn't catch them on undo.
  // R75: toolbar + cursor ring now live inside wrap (not document.body)
  // so they're visible during player fullscreen. Cleanup is handled by
  // the per-item remove loop above — removing the item removes wrap which
  // removes both children. This fallback cleanup scans the whole document
  // just in case an orphan was left behind by an earlier code path.
  try {
    document.querySelectorAll('.media-anno-toolbar').forEach(tb => {
      // Only remove if no item references it
      const stillUsed = state.items.some(it => it._annoToolbar === tb);
      if (!stillUsed && tb.parentNode) tb.parentNode.removeChild(tb);
    });
    document.querySelectorAll('.media-anno-cursor-ring').forEach(cr => {
      const stillUsed = state.items.some(it => it._annoCursorRing === cr);
      if (!stillUsed && cr.parentNode) cr.parentNode.removeChild(cr);
    });
  } catch (e) {}
}

export function deleteSelected() {
  const sel = getSelectedItems();
  if (sel.length === 0) return;
  pushUndo();
  // Clean up mask editing
  maskPickColorActive = false; maskBrushActive = false; activeMaskId = null;
  removeBrushCanvas();
  document.getElementById('viewport').classList.remove('mask-pick-mode');
  sel.forEach(i => {
    cleanupVideoItem(i);
    removeAnnoPopoversFor(i);
    // R72: also tear down body-attached per-item UI (draw toolbar,
    // cursor ring, text editor). Same fix as cleanupAllItems — without
    // this, deleting a video that had the draw panel open leaves the
    // orphaned toolbar on body.
    try {
      if (i._annoToolbar && i._annoToolbar.parentNode) {
        i._annoToolbar.parentNode.removeChild(i._annoToolbar);
      }
    } catch (e) {}
    try {
      if (i._annoCursorRing && i._annoCursorRing.parentNode) {
        i._annoCursorRing.parentNode.removeChild(i._annoCursorRing);
      }
    } catch (e) {}
    try {
      if (i._textEditorEl && i._textEditorEl.parentNode) {
        if (i._textEditorEl._trBtn && i._textEditorEl._trBtn.parentNode) {
          i._textEditorEl._trBtn.parentNode.removeChild(i._textEditorEl._trBtn);
        }
        i._textEditorEl.parentNode.removeChild(i._textEditorEl);
      }
    } catch (e) {}
    i.el.remove();
    // Remove associated text handle container
    const hCont = canvas.querySelector('.text-handles[data-owner="' + i.id + '"]');
    if (hCont) hCont.remove();
    if (i.type === 'draw') {
      removeStrokeById(i.strokeId);
      state.items = state.items.filter(x => x.id !== i.id);
    } else if (i.img || i.video) state.items = state.items.filter(x => x.id !== i.id);
    else if (i.el && i.el.classList.contains('todo-item')) state.todos = (state.todos||[]).filter(x => x.id !== i.id);
    else if (i.el && i.el.classList.contains('mindmap-item')) state.mindmaps = (state.mindmaps||[]).filter(x => x.id !== i.id);
    else state.texts = state.texts.filter(x => x.id !== i.id);
  });
  // Redraw the draw canvas so the removed stroke actually disappears
  redrawDrawLayer();
  state.selected.clear();
  refreshSelection();
  scheduleAutoSave();
  updateMediaBar();
  updateAutoFitPaper();
}

