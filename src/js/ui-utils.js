
import { state, canvas, ctxMenu, toastEl } from './core-state.js';

// ============================================================
//  TOAST
// ============================================================
export function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), 2000);
}

// PASTE TRIGGER — reads the SYSTEM clipboard (that's what the user is pasting).
// Only falls back to the internal state.clipboard if the system clipboard is
// empty OR the user just did an in-app copy within the last 3 seconds.
export async function triggerPaste() {
  hideWelcome();
  // Internal clipboard is used for in-app "duplicate" workflows (Ctrl+D).
  // For explicit Paste actions (toolbar / right-click), the user expects
  // whatever is in the system clipboard. So we only honor state.clipboard
  // if it was just populated (within 3 seconds of copySelected), which
  // covers the right-click Copy → right-click Paste use case without
  // overriding external copies that have since landed on the system clipboard.
  const recentCopy = state.clipboardTime && (Date.now() - state.clipboardTime) < 3000;
  if (state.clipboard && state.clipboard.length > 0 && recentCopy) {
    pasteClipboard();
    return;
  }
  // Try modern Clipboard API (works on HTTPS / localhost / secure contexts)
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const clips = await navigator.clipboard.read();
      for (const clip of clips) {
        for (const type of clip.types) {
          if (type.startsWith('image/')) {
            const blob = await clip.getType(type);
            const pasteX = (G.lastScreenX - state.pan.x) / state.zoom;
            const pasteY = (G.lastScreenY - state.pan.y) / state.zoom;
            const reader = new FileReader();
            reader.onload = ev => {
              const img = new Image();
              img.onload = () => {
                addImage(ev.target.result, img.naturalWidth, img.naturalHeight, pasteX, pasteY);
          toast('Pasted from clipboard ' + img.naturalWidth + 'x' + img.naturalHeight);
              };
    img.onerror = () => toast('Failed to paste image');
              img.src = ev.target.result;
            };
            reader.readAsDataURL(blob);
            return;
          }
        }
      }
    }
  } catch (err) {
    // Clipboard API denied or unavailable — fall through to internal clipboard
  }
  // Last resort: internal clipboard (only if system clipboard was empty)
  if (state.clipboard) {
    pasteClipboard();
  } else {
    toast('Use Ctrl+V to paste from clipboard');
  }
}

// ============================================================
//  CONTEXT MENU
// ============================================================
export function showCtx(x, y) {
  if (!ctxMenu) return;
  const sel = getSelectedItems();
  const hasItems = sel.length > 0;
  const hasImages = getSelectedImages().length > 0;
  let html = '';
  if (hasItems) {
    html += `<div class="ctx-item" onclick="duplicateSelected();hideCtx()">Duplicate <kbd>Ctrl+Shift+D</kbd></div>`;
    html += `<div class="ctx-item" onclick="copySelected();hideCtx()">Copy <kbd>Ctrl+C</kbd></div>`;
    html += `<div class="ctx-item" onclick="triggerPaste();hideCtx()">Paste <kbd>Ctrl+V</kbd></div>`;
    html += `<div class="ctx-sep"></div>`;
    html += `<div class="ctx-item" onclick="toggleAltPan();hideCtx()">${state.altPanEnabled ? '✓' : '○'} Alt+Left Pan (Mac trackpad)</div>`;
    html += `<div class="ctx-group">`;
    html += `<div class="ctx-item" onclick="alignItems('left');hideCtx()" title="Align Left">Left</div>`;
    html += `<div class="ctx-item" onclick="alignItems('hcenter');hideCtx()" title="Align Center H">Center</div>`;
    html += `<div class="ctx-item" onclick="alignItems('right');hideCtx()" title="Align Right">Right</div>`;
    html += `<div class="ctx-item" onclick="alignItems('top');hideCtx()" title="Align Top">Top</div>`;
    html += `<div class="ctx-item" onclick="alignItems('vcenter');hideCtx()" title="Align Middle">Middle</div>`;
    html += `<div class="ctx-item" onclick="alignItems('bottom');hideCtx()" title="Align Bottom">Bottom</div>`;
    html += `</div>`;
    html += `<div class="ctx-sep"></div>`;
    html += `<div class="ctx-item" onclick="normalizeSize('size');hideCtx()">Same Size <kbd>Ctrl+Alt+↑</kbd></div>`;
    html += `<div class="ctx-item" onclick="layoutColumn();hideCtx()">Column Layout</div>`;
    html += `<div class="ctx-item" onclick="layoutRow();hideCtx()">Row Layout</div>`;
    html += `<div class="ctx-item" onclick="layoutGrid();hideCtx()">Grid Layout</div>`;
    html += `<div class="ctx-item" onclick="distributeItems('h');hideCtx()">Distribute H</div>`;
    html += `<div class="ctx-item" onclick="distributeItems('v');hideCtx()">Distribute V</div>`;
    html += `<div class="ctx-item" onclick="tidySelection();hideCtx()">🧹 Tidy Selected</div>`;
    html += `<div class="ctx-sep"></div>`;
    if (hasImages && getSelectedImages()[0] && getSelectedImages()[0].src && getSelectedImages()[0].src.includes('image/gif')) html += `<div class="ctx-item" onclick="trimGifSelected();hideCtx()">Trim GIF</div>`;
    html += `<div class="ctx-item" onclick="exportMediaSelected();hideCtx()">Download Source File</div>`;
    if (hasImages) html += `<div class="ctx-item" onclick="enterCrop(getSelectedImages()[0]);hideCtx()">Crop Image <kbd>C</kbd></div>`;
    if (hasImages) html += `<div class="ctx-item" onclick="enterReframe(getSelectedImages()[0]);hideCtx()">Reframe Image <kbd>Enter</kbd></div>`;
    html += `<div class="ctx-item" onclick="toggleLock();hideCtx()">Lock/Unlock</div>`;
    html += `<div class="ctx-item" onclick="flipH();hideCtx()">Flip H</div>`;
    html += `<div class="ctx-item" onclick="flipV();hideCtx()">Flip V</div>`;
    // Translate option for text items
    const hasTexts = sel.some(i => !i.img);
    if (hasTexts) html += `<div class="ctx-item" onclick="translateSelectedText('en','zh');hideCtx()">Translate EN→中</div>`;
    html += `<div class="ctx-sep"></div>`;
    html += `<div class="ctx-item" onclick="groupSelected();hideCtx()">Group <kbd>Ctrl+G</kbd></div>`;
    html += `<div class="ctx-item" onclick="ungroupSelected();hideCtx()">Ungroup <kbd>Ctrl+⇧+G</kbd></div>`;
    html += `<div class="ctx-sep"></div>`;
    html += `<div class="ctx-item" onclick="layerOrder('front');hideCtx()">Bring to Front</div>`;
    html += `<div class="ctx-item" onclick="layerOrder('back');hideCtx()">Send to Back</div>`;
    html += `<div class="ctx-sep"></div>`;
    html += `<div class="ctx-item" onclick="deleteSelected();hideCtx()" style="color:var(--danger)">Delete <kbd>Del</kbd></div>`;
  } else {
    html += `<div class="ctx-item" onclick="triggerPaste();hideCtx()">Paste <kbd>Ctrl+V</kbd></div>`;
    html += `<div class="ctx-item" onclick="document.getElementById('file-audio-input').click();hideCtx()">Import Audio</div>`;
    html += `<div class="ctx-item" onclick="saveBoard();hideCtx()">Save Board</div>`;
    // Save all images (or selected) to a chosen local folder
    const _imgCount = (typeof getSelectedImages === 'function' ? getSelectedImages() : []).length || state.items.filter(i => i && i.img && i.src && !i.isVideo).length;
    const _ctxTitle = hasFileSystemAccess() ? 'Save images to a local folder (Chrome / Edge on Win + Mac)' : 'Folder picker unavailable — will download each image instead';
    html += `<div class="ctx-item" onclick="exportAllImagesToFolder();hideCtx()" title="${_ctxTitle}">Save Images to Folder…${_imgCount > 0 ? ' <kbd style="opacity:.4">' + _imgCount + '</kbd>' : ''}</div>`;
    html += `<div class="ctx-item" onclick="document.getElementById('file-load').click();hideCtx()">Load Board</div>`;
    html += `<div class="ctx-item" onclick="tidyAll();hideCtx()">🧹 Tidy All</div>`;
    html += `<div class="ctx-sep"></div>`;
    html += `<div class="ctx-item" onclick="showHelp();hideCtx()">Help & Shortcuts <kbd>H</kbd></div>`;
    html += `<div class="ctx-sep"></div>`;
    html += `<div class="ctx-item" onclick="toggleAltPan();hideCtx()">${state.altPanEnabled ? '✓' : '○'} Alt+Left Pan (Mac trackpad)</div>`;
    html += `<div class="ctx-item" onclick="toggleRelations();hideCtx()">🔗 Toggle Relations</div>`;
  }
  ctxMenu.innerHTML = html;
  ctxMenu.style.left = x + 'px';
  ctxMenu.style.top = y + 'px';
  ctxMenu.style.display = 'block';
}
export function hideCtx() { if (ctxMenu) ctxMenu.style.display = 'none'; }

window.showCtx = showCtx;
window.hideCtx = hideCtx;
window.toast = toast;
window.triggerPaste = triggerPaste;
