
// ============================================================
//  HELP PANEL — hotkeys & function guide
// ============================================================
export function showHelp() {
  const overlay = document.getElementById('help-overlay');
  if (overlay) overlay.style.display = 'flex';
}
export function hideHelp() {
  const overlay = document.getElementById('help-overlay');
  if (overlay) overlay.style.display = 'none';
}
