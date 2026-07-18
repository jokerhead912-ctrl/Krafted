import { getSelectedItems } from './selection.js';
import { state } from './core-state.js';
import { toast } from './ui-utils.js';

// ============================================================
//  EXPORT MEDIA — download original source files
// ============================================================
export function exportMediaSelected() {
  const sel = getSelectedItems();
  if (sel.length === 0) { toast('Select an item first'); return; }
  sel.forEach(item => {
    if (!item.src) return;
    let ext = 'bin';
    let name = 'export_' + Date.now();
    if (item.isAudio) {
      name = item.audioName || 'audio';
      if (item.src.startsWith('data:')) {
        const m = item.src.match(/^data:audio\/(\w+)/);
        if (m) ext = m[1];
      } else {
        ext = item.src.split('.').pop().split('?')[0] || 'mp3';
      }
    } else if (item.isVideo) {
      name = 'video_' + Date.now();
      if (item.src.startsWith('data:')) {
        const m = item.src.match(/^data:video\/(\w+)/);
        if (m) ext = m[1];
      } else {
        ext = item.src.split('.').pop().split('?')[0] || 'mp4';
      }
    } else if (item.src) {
      name = 'image_' + Date.now();
      if (item.src.startsWith('data:')) {
        const m = item.src.match(/^data:image\/(\w+)/);
        if (m) ext = m[1];
      } else {
        ext = item.src.split('.').pop().split('?')[0] || 'png';
      }
    }
    // Convert data URI or blob URL to download
    const link = document.createElement('a');
    link.download = name.replace(/\.[^.]+$/, '') + '.' + ext;
    link.href = item.src;
    link.click();
  });
  toast('Downloading ' + sel.length + ' file(s)');
}

window.exportMediaSelected = exportMediaSelected;

