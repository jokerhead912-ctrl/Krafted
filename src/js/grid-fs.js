
import { canvas } from './core-state.js';
import { toast } from './ui-utils.js';

// ============================================================
//  GRID
// ============================================================
export function toggleGrid() {
  canvas.classList.toggle('grid');
  toast(canvas.classList.contains('grid') ? '▦ Grid on' : '▫ Grid off');
}

// ── App-level fullscreen toggle ──
// Makes the entire Krafted app fill the screen (hides browser chrome).
// Press Esc or click the button again to exit.
export function toggleAppFullscreen() {
  var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl) {
    if (document.exitFullscreen) { document.exitFullscreen(); }
    else if (document.webkitExitFullscreen) { document.webkitExitFullscreen(); }
  } else {
    var el = document.documentElement;
    if (el.requestFullscreen) { el.requestFullscreen(); }
    else if (el.webkitRequestFullscreen) { el.webkitRequestFullscreen(); }
  }
}
// Sync the toolbar fullscreen button icon on fullscreen change
export function _syncAppFsIcon() {
  var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  var btn = document.getElementById('btn-fullscreen');
  if (!btn) return;
  var svg = btn.querySelector('svg');
  if (fsEl) {
    // Collapse icon — exit fullscreen
    svg.innerHTML = '<path d="M5 3v3M5 3H2M5 3L2 6M11 13v-3M11 13h3M11 13l3-3"/>';
    btn.title = 'Exit fullscreen (Esc)';
  } else {
    // Expand icon — enter fullscreen
    svg.innerHTML = '<path d="M3 3v4M3 3h4M3 3l4 4M13 13v-4M13 13H9M13 13l-4-4"/>';
    btn.title = 'Fullscreen (F)';
  }
}
document.addEventListener('fullscreenchange', _syncAppFsIcon);
document.addEventListener('webkitfullscreenchange', _syncAppFsIcon);

// Marker so user can confirm new code is loaded (check DevTools console)
console.log('%c[Krafted v5.5] Fullscreen feature loaded — press F to toggle',
  'color:#22c55e;font-weight:bold;font-size:13px;');

window.toggleGrid = toggleGrid;
window.toggleAppFullscreen = toggleAppFullscreen;
