
import { state } from './core-state.js';

// PASTE FROM CLIPBOARD (handles Explorer files, screenshots, text, URLs, internal items)
document.addEventListener('paste', e => {
  if (!e.clipboardData) return;

  // If user is actively typing inside a text-item (cursor inside, editing mode, HAS SELECTION),
  // let the browser handle it. v5.5: only return if there's actually a caret/selection INSIDE the
  // text-item — otherwise the user wants to paste on the canvas, so blur the text-item and fall
  // through to our paste handler. Without this, any external text paste (when a stale text-item
  // still has focus but no selection) is silently swallowed by the text-item's contentEditable.
  const ae = document.activeElement;
  const isOurText = ae && ae.contentEditable === 'true' && ae.classList.contains('text-item');
  if (isOurText) {
    if (ae.classList.contains('editing')) {
      const sel = window.getSelection();
      let hasSelectionInText = false;
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (ae.contains(range.commonAncestorContainer)) {
          hasSelectionInText = true;
        }
      }
      if (hasSelectionInText) return; // genuine in-text paste — let browser handle
      // No active selection in this text-item — blur it, handle paste on canvas
      ae.blur();
    }
  }

  // If some other contentEditable is focused (but NOT our text-item), blur it first
  // so our paste handler can take over
  if (ae && ae.contentEditable === 'true' && !ae.classList.contains('text-item')) return;

  hideWelcome();
  const items = e.clipboardData.items;
  const files = e.clipboardData.files;

  try {
  // Helper: attach image to selected mindmap node
  function attachToMindmap(blob) {
    for (const mm of (state.mindmaps || [])) {
      if (mm.selectedNodeId && mm.el) {
        const node = mm.nodes.find(n => n.id === mm.selectedNodeId);
        if (node) return { mm, node };
      }
    }
    return null;
  }

  // Helper: detect file type from extension when MIME type is empty
  function fileType(f) {
    if (f.type) return f.type;
    const n = (f.name || '').toLowerCase();
    if (!n) return '';
    if (/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|tiff|tif|avif|heic)$/i.test(n)) return 'image/' + (n.split('.').pop());
    if (/\.(mp4|webm|ogv|mov|avi|mkv|wmv|flv)$/i.test(n)) return 'video/' + (n.split('.').pop());
    if (/\.(mp3|wav|aiff|aif|flac|ogg|m4a|wma)$/i.test(n)) return 'audio/' + (n.split('.').pop());
    return '';
  }

  // ── 0) IN-APP COPY INTERCEPT — Round 20 ──
  // If the user just copied something in the app (within 3s), ALWAYS use
  // state.clipboard. Rounds 17 and 19 tried to mirror the copy to the
  // SYSTEM clipboard via navigator.clipboard.write, then checked a flag
  // to decide whether to trust the system clipboard or fall back. But
  // that flag is unreliable: on Mac file:// in Chrome and Safari the
  // write is silently blocked (or "succeeds" without actually overwriting
  // the system clipboard), so the paste event keeps delivering whatever
  // was on the system clipboard before — i.e., the OLD image. The user
  // has hit this 3 times.
  //
  // The fix: short-circuit the entire paste logic for 3s after an in-app
  // copy. After 3s the system clipboard is trusted again so external
  // pastes (screenshots, browser copy-image) still work. This matches
  // the behavior of triggerPaste() (right-click / toolbar Paste).
  // v5.5: also check WHAT the user is pasting — if the system clipboard
  // has text/plain content and state.clipboard only has internal items
  // (images/videos/text-items), don't intercept. The user likely copied
  // text from another app (chat, browser, etc.) and wants it on canvas.
  {
    const recentCopy = state.clipboardTime && (Date.now() - state.clipboardTime) < 3000;
    if (state.clipboard && state.clipboard.length > 0 && recentCopy) {
      // Check if the incoming paste has text — if so and our internal
      // clipboard does NOT have text, it's an external text paste
      let hasIncomingText = false;
      for (const item of items) {
        if (item.type === 'text/plain' || item.type === 'text/html') { hasIncomingText = true; break; }
      }
      const hasInternalText = state.clipboard.some(c => c.type === 'text');
      if (hasIncomingText && !hasInternalText) {
        // External text paste — let it fall through to text handler below
      } else {
        e.preventDefault();
        pasteClipboard();
        return;
      }
    }
  }

  // ── 0) FILE PASTE from Explorer (files array + items array fallback) ──
  // Chrome may expose only 1 file in e.clipboardData.files when multiple are copied from Explorer.
  // Merge both sources: files[] and items[] (kind==='file') to capture all files.
  const allPastedFiles = [];
  const seenNames = new Set();
  // First pass: files array
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.name && !seenNames.has(f.name)) { seenNames.add(f.name); allPastedFiles.push(f); }
    else if (!f.name) allPastedFiles.push(f); // unnamed (screenshot)
  }
  // Second pass: items array (kind === 'file') — may contain additional files Chrome didn't put in files[]
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'file') {
      const f = it.getAsFile();
      if (f) {
        if (f.name && !seenNames.has(f.name)) { seenNames.add(f.name); allPastedFiles.push(f); }
        else if (!f.name && files.length === 0) allPastedFiles.push(f); // screenshot via items
      }
    }
  }
  if (allPastedFiles.length > 0) {
    const imageFiles = [], videoFiles = [], audioFiles = [];
    for (const f of allPastedFiles) {
      const ft = fileType(f);
      if (ft.startsWith('image/')) imageFiles.push(f);
      else if (ft.startsWith('video/')) videoFiles.push(f);
      else if (ft.startsWith('audio/')) audioFiles.push(f);
    }
    if (imageFiles.length > 0 || videoFiles.length > 0 || audioFiles.length > 0) {
      e.preventDefault();
      const { x, y } = getPasteXY();
      // Process images SEQUENTIALLY (one at a time) to avoid memory crash on 20+ images.
      // Same reason as the drop handler: parallel FileReader+Image decodes + undo bloat.
      // One undo snapshot at batch start → single undo reverts the whole paste.
      if (imageFiles.length > 0) pushUndo();
      let imgIdx = 0;
      (function processNextImage() {
        if (imgIdx >= imageFiles.length) return;
        const f = imageFiles[imgIdx];
        const px = x + imgIdx * 20, py = y + imgIdx * 20;
        const isLast = (imgIdx === imageFiles.length - 1);
        const reader = new FileReader();
        reader.onload = ev => {
          const img = new Image();
          img.onload = () => {
            addImage(ev.target.result, img.naturalWidth, img.naturalHeight, px, py, false, isLast);
            imgIdx++;
            setTimeout(processNextImage, 30);
          };
          img.onerror = () => { imgIdx++; setTimeout(processNextImage, 30); };
          img.src = ev.target.result;
        };
        reader.onerror = () => { imgIdx++; setTimeout(processNextImage, 30); };
        reader.readAsDataURL(f);
      })();
      // Video: read as base64 data URL so it persists like images (not blob URL).
      if (videoFiles.length > 0) pushUndo();
      let vIdx = 0;
      let videoOffset = imageFiles.length;
      (function processNextVideo() {
        if (vIdx >= videoFiles.length) return;
        const f = videoFiles[vIdx];
        const curOffset = videoOffset + vIdx;
        const px = x + curOffset * 20, py = y + curOffset * 20;
        const isLast = (vIdx === videoFiles.length - 1);
        const blobUrl = URL.createObjectURL(f);
        const tmpVid = document.createElement('video');
        tmpVid.preload = 'metadata'; tmpVid.muted = true;
        tmpVid.src = blobUrl;
        let done = false;
        const finish = (w, h) => {
          if (done) return; done = true;
          tmpVid.removeAttribute('src'); tmpVid.load();
          // Capture the original file name so the export can use it
          const newItem = addImage(blobUrl, w, h, px, py, true, isLast);
          if (newItem && f && f.name) {
            newItem.filename = f.name;
            // Round 13: push the file name to the player badge
            try { if (newItem.el && newItem.el._setFilenameBadge) newItem.el._setFilenameBadge(f.name); } catch (e) {}
          }
          vIdx++;
          setTimeout(processNextVideo, 100);
        };
        tmpVid.onloadedmetadata = () => finish(tmpVid.videoWidth || 640, tmpVid.videoHeight || 360);
        tmpVid.onerror = () => { URL.revokeObjectURL(blobUrl); vIdx++; setTimeout(processNextVideo, 100); };
        setTimeout(() => { if (!done) finish(640, 360); }, 15000);
      })();
      audioFiles.forEach(f => {
        const curOffset = videoOffset + videoFiles.length + audioFiles.indexOf(f);
        const px = x + curOffset * 20, py = y + curOffset * 20;
        const reader = new FileReader();
        reader.onload = ev => addAudioItem(ev.target.result, f.name, px, py);
        reader.readAsDataURL(f);
      });
      toast('Pasted ' + (imageFiles.length + videoFiles.length + audioFiles.length) + ' files');
      return;
    }
  }

  // ── 1) TEXT paste first (non-URL → text item, URL → link card) ──
  // Process text BEFORE images — PPT/rich-text clipboard often has both text + preview image
  for (const item of items) {
    if (item.type === 'text/plain' || item.type === 'text/html' || item.type === 'text/richtext' || item.type === 'text' || item.type === 'text/rtf') {
      e.preventDefault(); // preventDefault BEFORE getAsString — stop browser default paste immediately
      const itemType = item.type; // capture for callback (some browsers recycle the item)
      item.getAsString(raw => {
        try {
            let trimmed = raw.trim();
            if (!trimmed) return;
            // If it's HTML or RTF, strip tags/formatting for plain text
            if (itemType === 'text/html' || itemType === 'text/richtext' || itemType === 'text/rtf') {
              trimmed = trimmed.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
            }
            // Also strip RTF control sequences if present
            if (itemType === 'text/rtf') {
              trimmed = trimmed.replace(/\{\\[^{}]*\}/g, '').replace(/\\[a-z]+/gi, '').replace(/[{}]/g, '').trim();
            }
            if (!trimmed) return;
            // URL detection
            if (/^https?:\/\/[^\s]+$/i.test(trimmed) || /^www\.[^\s]+\.[a-z]{2,}/i.test(trimmed) ||
                /^[a-z0-9-]+\.[a-z]{2,}[^\s]*$/i.test(trimmed)) {
              let url = trimmed;
              if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
              const { x, y } = getPasteXY();
              addLinkCard(url, { x, y });
              toast('Pasted link');
            } else {
              // Plain text — create a text item at mouse position (noFocus so next Ctrl+V still works)
              const { x, y } = getPasteXY();
              // Pre-calculate init width by measuring the WIDEST line
              // (not just the first line — multi-line text needs the widest line's width)
              const measureEl = document.createElement('span');
              measureEl.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:' +
                textTool.size + 'px/' + '1.5 ' + textTool.font;
              document.body.appendChild(measureEl);
              let widestLineW = 0;
              for (const line of trimmed.split('\n')) {
                measureEl.textContent = line;
                widestLineW = Math.max(widestLineW, measureEl.offsetWidth);
              }
              document.body.removeChild(measureEl);
              const initW = Math.min(520, Math.max(120, widestLineW + 40));
              const tx = addText(x, y, trimmed, { noFocus: true, initW: initW });
              // Auto-size after DOM settles
              requestAnimationFrame(() => {
                autoGrowTextItem(tx);
                refreshSelection();
              });
              toast('Pasted text');
            }
          } catch (err) {
            console.error('Text paste error:', err);
            toast('Failed to paste text');
          }
        });
        return;
      }
    }

  // ── 2) Image from clipboard (screenshot, browser copy-image) ──
  // Round 20: the in-app-copy intercept at the top of this handler
  // (Section 0) already routes recent in-app copies to state.clipboard.
  // If we reach here, the user is NOT pasting a recent in-app copy —
  // either they copied externally (screenshot, browser copy-image) or
  // the 3s window has expired. So we can trust e.clipboardData and
  // read the image from the system clipboard normally.
  for (const item of items) {
    if (!item.type.startsWith('image/')) continue;
    e.preventDefault();
    const blob = item.getAsFile();
    const target = attachToMindmap(blob);
    if (target) {
      const reader = new FileReader();
      reader.onload = ev => {
        const tmpImg = new Image();
        tmpImg.onload = () => {
          pushUndo();
          target.node.img = ev.target.result;
          target.node.imgW = tmpImg.naturalWidth;
          target.node.imgH = tmpImg.naturalHeight;
          const dispH = Math.min(80, tmpImg.naturalHeight * (120 / Math.max(tmpImg.naturalWidth, 1)));
          target.node.h = Math.max(36, dispH + 24);
          renderMindMap(target.mm);
          mmAutoFit(target.mm);
          scheduleAutoSave();
          toast('Image attached to idea: ' + (target.node.text || ''));
        };
        tmpImg.src = ev.target.result;
      };
      reader.readAsDataURL(blob);
      return;
    }
    // Place on canvas at cursor
    const { x, y } = getPasteXY();
    // v5.5: Use blob URL instead of base64 data URL to avoid memory bloat
    const blobUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      addImage(blobUrl, img.naturalWidth, img.naturalHeight, x, y);
      toast('Pasted image ' + img.naturalWidth + 'x' + img.naturalHeight);
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      toast('Failed to paste image');
    };
    img.src = blobUrl;
    return;
  }

  // ── 2b) Audio from clipboard ──
  for (const item of items) {
    if (!item.type.startsWith('audio/')) continue;
    e.preventDefault();
    const blob = item.getAsFile();
    const target = attachToMindmap(blob);
    if (target) {
      const reader = new FileReader();
      reader.onload = ev => {
        pushUndo();
        target.node.audio = ev.target.result;
        target.node.audioName = (blob.name || 'Audio').length > 20 ? (blob.name || 'Audio').substring(0, 17) + '...' : (blob.name || 'Audio');
        const baseH = target.node.img ? Math.max(36, 24 + 24) : 36;
        target.node.h = baseH + 28;
        renderMindMap(target.mm);
        mmAutoFit(target.mm);
        scheduleAutoSave();
        toast('Audio attached to idea: ' + (target.node.text || ''));
      };
      reader.readAsDataURL(blob);
      return;
    }
    toast('Select a mind map node first to attach audio');
    return;
  }

  // ── 3) Fallback: internal clipboard (only if e.clipboardData is TRULY empty) ──
  // Round 20: the in-app-copy intercept at the top of this handler
  // already routed recent in-app copies to state.clipboard. So if we
  // reach here with a non-empty clipboard event, we should NOT use
  // state.clipboard — that was the source of the "old image gets pasted"
  // bug on Mac (Safari often delivers the image via items[] but with
  // an unrecognised type, and the handler used to fall through to
  // state.clipboard which was stale from a previous in-app copy). Now
  // we only consult state.clipboard when the paste event has NO data
  // at all (e.g., a synthetic paste from the keyboard handler on a
  // non-secure context).
  if (state.clipboard && files.length === 0 && items.length === 0) {
    e.preventDefault();
    pasteClipboard();
    return;
  }
  } catch (err) {
    console.error('[PASTE] Handler error:', err);
    try { toast('Paste failed'); } catch (e2) {}
  }
});
