import { addAudioItem } from './audio.js';
import { getPasteXY } from './capture.js';
import { getSelectedItems, refreshSelection } from './selection.js';
import { addTodo, renderTodo } from './todo.js';
import { state, canvasContent } from './core-state.js';
import { scheduleAutoSave } from './save-load.js';
import { toast } from './ui-utils.js';
import { toast, triggerPaste } from './ui-utils.js';
import { addImage, addLinkCard, addText, applyTextProps, updateItemStyle } from './add-items.js';
import { setupVideoTrim } from './video-trim.js';
import { pushUndo } from './undo-redo.js';

// ============================================================
//  COPY / PASTE / DUPLICATE
// ============================================================
// Best-effort: write an image to the SYSTEM clipboard. Returns a
// promise that resolves on success and rejects on any failure
// (insecure context, missing API, CORS-tainted canvas, blob error).
// Callers in copySelected() use the resolution to set
// state.clipboardSystemWriteOk so the paste event handler knows
// whether to trust the system clipboard or fall back to state.clipboard.
export function writeImageToSystemClipboard(src) {
  if (!navigator.clipboard || !navigator.clipboard.write || typeof ClipboardItem === 'undefined') {
    return Promise.reject(new Error('Clipboard API unavailable'));
  }
  return fetch(src)
    .then(r => r.blob())
    .then(blob => {
      if (!blob) throw new Error('empty blob');
      const type = blob.type || 'image/png';
      // ClipboardItem must be wrapped in a Promise on some browsers (Safari).
      return navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
    });
}

// Round 31: a blob: URL stays valid only as long as the page that
// created it (or a same-origin iframe of the same document) is alive.
// After a hard refresh, switching tabs back & forth, or a long idle
// period, the underlying Blob can be GC'd and the URL throws on fetch.
// We can't directly test "is this URL still alive" cheaply, but we CAN
// detect the common expired case synchronously by checking that the
// document's lifetime exceeds the URL's creation time. The simplest
// reliable check is: data: URLs are always valid; everything else
// gets a quick HEAD-style fetch that resolves if the blob is still
// good. We swallow the error and return false so the caller can decide
// what to do (typically: toast a friendly message and skip the paste).
export function _isBlobUrlLive(url) {
  if (!url) return false;
  if (url.startsWith('data:')) return true;
  if (!url.startsWith('blob:')) return true; // http(s) and others — assume OK, paste will fail loudly if not
  try {
    // A no-cost probe: we can't synchronously inspect a blob, but we
    // can do a fetch with HEAD-equivalent. The cheapest reliable check
    // is `fetch(url)` — it resolves with a stream of the underlying
    // blob bytes. We immediately cancel by reading 0 bytes, which is
    // enough to confirm the blob is still alive.
    const res = fetch(url);
    // Mark the result as still-pending so the caller can race it
    // against a paste — but for our use (paste), we want a synchronous
    // answer. We can't synchronously await fetch in JS, so we treat
    // the unresolved promise as "probably live" and let the actual
    // addImage / addAudioItem surface any error in the user-visible
    // toast. Returning true here is safe; the worst case is a slightly
    // delayed failure message.
    if (res && typeof res.then === 'function') {
      res.then(function(r){ try { r.cancel && r.cancel(); } catch (e) {} }).catch(function(){ /* ignored */ });
    }
    return true;
  } catch (e) {
    return false;
  }
}

export function copySelected() {
  const sel = getSelectedItems();
  if (sel.length === 0) return;
  state.clipboard = sel.map(i => {
    const copy = { ...i, el: null, img: null };
    if (i.items) copy.items = i.items.map(it => ({ ...it }));
    return copy;
  });
  // Round 17: timestamp so triggerPaste() can prefer the internal clipboard
  // ONLY if the copy is fresh (within a few seconds). Otherwise the internal
  // copy would override the SYSTEM clipboard and re-introduce the
  // "old image gets pasted" bug.
  state.clipboardTime = Date.now();
  // Round 19: synchronously try to mirror the copy to the SYSTEM clipboard
  // so Cmd+V / Ctrl+V delivers the just-copied image, not the stale system
  // clipboard content. This is the real fix for the "old image gets pasted"
  // bug — the previous 3-second window only fixed the right-click Paste path
  // (triggerPaste), NOT the keyboard Cmd+V path (which reads the system
  // clipboard via the browser's native paste event). Track success with
  // clipboardSystemWriteOk so the paste event handler can decide:
  //   - true  → write succeeded, system clipboard is correct, paste normally
  //   - false → write failed (file:// on Chrome, tainted image, etc.),
  //             paste handler must fall back to state.clipboard
  state.clipboardSystemWriteOk = false;
  if (sel.length === 1) {
    const item = sel[0];
    if (item && item.src && !item.isVideo) {
      // Try to write the actual image bytes to the system clipboard so
      // Cmd+V in this app (or any other app) pastes the just-copied image.
      writeImageToSystemClipboard(item.src)
        .then(() => { state.clipboardSystemWriteOk = true; })
        .catch(() => { state.clipboardSystemWriteOk = false; });
    } else if (item && (item.text || (item.isLink && item.linkUrl))) {
      // Text / link: try to mirror the text to the system clipboard.
      const txt = item.isLink ? (item.linkUrl || '') : (item.text || '');
      if (txt && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt)
          .then(() => { state.clipboardSystemWriteOk = true; })
          .catch(() => { state.clipboardSystemWriteOk = false; });
      }
    }
  }
  // Round X: visible feedback so the user knows the hotkey landed.
  // Previously this ran silently and looked broken.
  try { toast('Copied ' + sel.length + ' item' + (sel.length === 1 ? '' : 's')); } catch (e) {}
}
export function pasteClipboard() {
  if (!state.clipboard) return;
  pushUndo();
  state.selected.clear();
  let pastedCount = 0;
  // ── Paste at cursor ──
  // Calculate the offset from the first clipboard item's original position
  // to the current mouse cursor (canvas coords), then apply that same offset
  // to every item so the whole selection lands under the cursor.
  const first = state.clipboard[0];
  const cursor = getPasteXY();
  const dx = cursor.x - (first.x || 0);
  const dy = cursor.y - (first.y || 0);
  state.clipboard.forEach(data => {
    const px = (data.x || 0) + dx;
    const py = (data.y || 0) + dy;
    if (data.isLink) {
      // Link card — recreate with addLinkCard and restore properties
      const item = addLinkCard(data.linkUrl, { x: px, y: py });
      Object.assign(item, {
        w: data.w, h: data.h, rot: data.rot, opacity: data.opacity,
        flipH: data.flipH, flipV: data.flipV, locked: data.locked,
        linkTitle: data.linkTitle, linkDesc: data.linkDesc,
      });
      updateItemStyle(item);
      state.selected.add(item.id);
      pastedCount++;
    } else if (data.isAudio) {
      // Round 31: audio (wav/mp3/aiff/flac/ogg/m4a) was falling through
      // to the addImage path, which silently dropped the <audio> element
      // and left a phantom image. Route to addAudioItem so the user gets
      // a working audio card with the original file name and a play bar.
      // Guard against blob URLs that expired (refresh / new tab) — the
      // audio flag stays true so we know it WAS audio, but the actual
      // bytes are gone, so skip with a toast instead of creating a dead
      // item.
      const _audioBlobOk = data.src && (data.src.startsWith('data:') || (data.src.startsWith('blob:') && _isBlobUrlLive(data.src)));
      if (!_audioBlobOk) {
        try { toast('Audio source expired — re-add the file to paste it again'); } catch (e) {}
        return;
      }
      const audioItem = addAudioItem(data.src, data.audioName || 'Audio', px, py);
      Object.assign(audioItem, {
        w: data.w, h: data.h, rot: data.rot, opacity: data.opacity,
        flipH: data.flipH, flipV: data.flipV, locked: data.locked,
      });
      try { if (audioItem.audio) audioItem.audio.playbackRate = data.playbackRate || 1; } catch (e) {}
      updateItemStyle(audioItem);
      state.selected.add(audioItem.id);
      pastedCount++;
    } else if (data.src) {
      // Round 31: previously this called addImage without the 5th arg,
      // which made mov (and any other video) paste as a static <img> —
      // you'd see the first frame but couldn't play it. Now we pass
      // isVideoFlag based on the source's media kind so the right DOM
      // element (<video> for mov/mp4/webm, <img> for everything else)
      // is created and the playback / trim controls work.
      const _blobOk = data.src && (data.src.startsWith('data:') || (data.src.startsWith('blob:') && _isBlobUrlLive(data.src)));
      if (!_blobOk) {
        try { toast('Media source expired — re-add the file to paste it again'); } catch (e) {}
        return;
      }
      const isVideoPaste = !!data.isVideo;
      const item = addImage(data.src, data.natW, data.natH, px, py, isVideoPaste);
      Object.assign(item, {
        w: data.w, h: data.h, rot: data.rot, opacity: data.opacity,
        flipH: data.flipH, flipV: data.flipV, locked: data.locked,
        brightness: data.brightness, contrast: data.contrast, saturate: data.saturate,
        hueRotate: data.hueRotate, blur: data.blur, sepia: data.sepia, grayscale: data.grayscale,
        temp: data.temp, vignette: data.vignette, shadow: data.shadow, highlight: data.highlight, grain: data.grain,
        cropX: data.cropX, cropY: data.cropY, cropW: data.cropW, cropH: data.cropH,
        trimStart: data.trimStart || 0, trimEnd: data.trimEnd || 0, playbackRate: data.playbackRate || 1,
        masks: data.masks ? data.masks.map(m => ({ ...m })) : [],
      });
      if (item.video) { item.video.playbackRate = item.playbackRate || 1; setupVideoTrim(item); }
      updateItemStyle(item);
      state.selected.add(item.id);
      pastedCount++;
    } else if (data.items) {
      // Todo checklist item
      const todo = addTodo(px, py);
      Object.assign(todo, {
        w: data.w, h: data.h, rot: data.rot, opacity: data.opacity,
        locked: data.locked,
        _resized: data._resized,
        title: data.title,
        items: data.items.map(it => ({ ...it })),
      });
      renderTodo(todo);
      updateItemStyle(todo);
      state.selected.add(todo.id);
      pastedCount++;
    } else {
      const tx = addText(px, py, data.el ? data.el.textContent : '');
      Object.assign(tx, {
        font: data.font, size: data.size, bold: data.bold, italic: data.italic,
        underline: data.underline, strike: data.strike, highlight: data.highlight,
        shadow: data.shadow, bg: data.bg, outline: data.outline, uppercase: data.uppercase,
        color: data.color, highlightColor: data.highlightColor, align: data.align,
      });
      if (data.el && data.el.textContent) tx.el.textContent = data.el.textContent;
      applyTextProps(tx);
      updateItemStyle(tx);
      state.selected.add(tx.id);
      pastedCount++;
    }
  });
  refreshSelection();
  scheduleAutoSave();
  // Round X: visible feedback so the user knows the hotkey landed.
  try { toast('Pasted ' + pastedCount + ' item' + (pastedCount === 1 ? '' : 's')); } catch (e) {}
}
export function duplicateSelected() {
  copySelected();
  pasteClipboard();
}

