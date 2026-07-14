import { getSelectedImages, getSelectedItems } from './selection.js';
import { state, textTool } from './core-state.js';
import { scheduleAutoSave } from './save-load.js';
import { toast } from './ui-utils.js';
import { applyTextProps } from './add-items.js';
import { pushUndo } from './undo-redo.js';
import { scheduleAutoSave } from './save-load.js';
import { pushUndo } from './undo-redo.js';
import { applyTextProps } from './add-items.js';

// ============================================================
//  TEXT TOOL
// ============================================================
export function toggleTextStyle(style) {
  textTool[style] = !textTool[style];
  document.getElementById('ts-' + style.replace('highlight','highlight').replace('uppercase','upper')).classList.toggle('active', textTool[style]);
  applyTextStyleToSelected();
}
export function setTextProp(prop, val) {
  textTool[prop] = val;
  applyTextStyleToSelected();
  // Round 54/55: keep both size dropdowns (main toolbar #text-size-select,
  // quick bar #tqb-size-input) and the active-state in sync so the three
  // UIs never drift apart. The hidden #text-size number input is also
  // synced for back-compat with any code that still reads its `.value`.
  if (prop === 'size') {
    const tsEl = document.getElementById('text-size');
    if (tsEl) tsEl.value = val;
    _setSizeSelectValue(document.getElementById('text-size-select'), val);
    _setSizeSelectValue(document.getElementById('tqb-size-input'), val);
    updateTextSizeActive(val);
  }
}
export function setTextAlign(align) {
  textTool.align = align;
  ['l','c','r'].forEach(a => document.getElementById('ts-align-' + a).classList.toggle('active', align === {l:'left',c:'center',r:'right'}[a]));
  applyTextStyleToSelected();
}
export function applyTextStyleToSelected() {
  const sel = getSelectedItems().filter(i => i.el && i.el.classList.contains('text-item'));
  sel.forEach(tx => {
    Object.assign(tx, {
      font: textTool.font, size: textTool.size, bold: textTool.bold, italic: textTool.italic,
      underline: textTool.underline, strike: textTool.strike, highlight: textTool.highlight,
      shadow: textTool.shadow, bg: textTool.bg, outline: textTool.outline, uppercase: textTool.uppercase,
      color: textTool.color, highlightColor: textTool.highlightColor, align: textTool.align,
    });
    applyTextProps(tx);
  });
  scheduleAutoSave();
}
export function showTextColorPicker(target) {
  textTool.activeColorTarget = target;
  const grid = document.getElementById('text-color-grid');
  grid.innerHTML = '';
  colors.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch';
    sw.style.background = c;
    if (textTool[target] === c) sw.classList.add('active');
    sw.onclick = () => {
      textTool[target] = c;
      grid.style.display = 'none';
      applyTextStyleToSelected();
    };
    grid.appendChild(sw);
  });
  grid.style.display = grid.style.display === 'grid' ? 'none' : 'grid';
}
export function initTextToolbar() {
  const grid = document.getElementById('text-color-grid');
  // Close on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('#ts-color-btn') && !e.target.closest('#ts-hlcolor-btn') && !e.target.closest('#text-color-grid')) {
      grid.style.display = 'none';
    }
  });
}

// ============================================================
//  TEXT INLINE SIZE & COLOR (while editing)
// ============================================================
export function getEditingText() {
  const editingEl = document.querySelector('.text-item.editing') || (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('text-item') ? document.activeElement : null);
  if (editingEl) return state.texts.find(t => t.el === editingEl);
  return null;
}

export function applyInlineSize(px) {
  // Round 54: `px` is the user-facing on-screen size. Stored value is
  // ALSO on-screen (rendering code divides by zoom at display time).
  // Round 55: also sync the hidden #text-size number input (back-compat)
  // and the size dropdowns so the UIs stay in sync.
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) {
    // No selection — apply to entire text item
    setTextProp('size', px);
    // Fallback: if nothing was selected, apply to the currently editing text item directly
    const editingTx = getEditingText();
    if (editingTx && !state.selected.has(editingTx.id)) {
      editingTx.size = px;
      applyTextProps(editingTx);
      scheduleAutoSave();
    }
    const tsEl = document.getElementById('text-size');
    if (tsEl) tsEl.value = px;
    _setSizeSelectValue(document.getElementById('text-size-select'), px);
    _setSizeSelectValue(document.getElementById('tqb-size-input'), px);
    updateTextSizeActive(px);
    return;
  }
  // Has selection — wrap in a span
  const range = sel.getRangeAt(0);
  const span = document.createElement('span');
  span.style.fontSize = px + 'px';
  try {
    range.surroundContents(span);
    sel.removeAllRanges();
  } catch(e) {
    // surroundContents fails on partial selections — fallback
    document.execCommand('fontSize', false, '7');
    const fonts = document.querySelectorAll('font[size="7"]');
    fonts.forEach(f => {
      const s = document.createElement('span');
      s.style.fontSize = px + 'px';
      while (f.firstChild) s.appendChild(f.firstChild);
      f.replaceWith(s);
    });
  }
  updateTextSizeActive(px);
  // Also update the text item's default size
  const editingTx = getEditingText();
  if (editingTx) editingTx.size = px;
  scheduleAutoSave();
}

// Round 55: helper for syncing the size <select> dropdowns (text-size-select
// in the main toolbar, tqb-size-input in the quick bar). When the user
// picks a value that isn't in the option list (e.g. 18, 22, 36, 56…),
// we add a temporary option so the dropdown reflects reality instead of
// silently going blank. The temporary option is reused if the same value
// is set again.
export function _setSizeSelectValue(el, val) {
  if (!el || el.tagName !== 'SELECT') return;
  const v = String(val);
  if (![...el.options].some(o => o.value === v)) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  }
  el.value = v;
}

// Round 54: snap the active state of size buttons in the quick bar
// to the closest preset. If `px` doesn't match any preset (e.g. user
// typed a custom value in the number input), clear all active states.
export const TQB_PRESETS = [8, 10, 12, 16, 20, 24, 32, 48, 64, 80, 96];
export function updateTextSizeActive(px) {
  document.querySelectorAll('.tqb-size').forEach(b => {
    b.classList.toggle('active', b.textContent === String(px));
  });
}
// Step the current text size up/down through the preset list.
export function stepTextSize(dir) {
  const cur = textTool.size || 24;
  // Find closest preset
  let idx = 0;
  let bestDiff = Infinity;
  TQB_PRESETS.forEach((p, i) => {
    const d = Math.abs(p - cur);
    if (d < bestDiff) { bestDiff = d; idx = i; }
  });
  // If current is bigger than largest preset, append it
  if (cur > TQB_PRESETS[TQB_PRESETS.length - 1]) idx = TQB_PRESETS.length - 1;
  const next = TQB_PRESETS[Math.max(0, Math.min(TQB_PRESETS.length - 1, idx + dir))];
  // Update slider + tool state + quick bar
  // Round 55: also sync the new size <select> dropdowns.
  textTool.size = next;
  const tsEl = document.getElementById('text-size');
  if (tsEl) tsEl.value = next;
  _setSizeSelectValue(document.getElementById('text-size-select'), next);
  _setSizeSelectValue(document.getElementById('tqb-size-input'), next);
  applyInlineSize(next);
}

export function applyInlineColor(color) {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) {
    // No selection — apply to entire text item
    textTool.color = color;
    applyTextStyleToSelected();
    // Fallback: if nothing was selected, apply to the currently editing text item directly
    const editingTx = getEditingText();
    if (editingTx && !state.selected.has(editingTx.id)) {
      editingTx.color = color;
      applyTextProps(editingTx);
      scheduleAutoSave();
    }
    const ccEl = document.getElementById('tqb-custom-color');
    if (ccEl) ccEl.value = color;
    return;
  }
  // Has selection — use execCommand for inline color (creates <span style="color:..">)
  document.execCommand('foreColor', false, color);
  // NOTE: We do NOT overwrite the editing text's default `color` here.
  // The default color applies to NEW text the user types; the inline <span>
  // already records the per-word color and will be saved via innerHTML.
  // Previously this also updated tx.color — that overwrote the previous
  // default with whatever was just picked, which corrupted multi-color text
  // items on reload.
  scheduleAutoSave();
}

export function showTextQuickBar(show) {
  document.getElementById('text-quick-bar').classList.toggle('active', show);
}

export function updateTextQuickBarActive() {
  // Round 55: sync the active size button + both size <select> dropdowns
  // (quick bar #tqb-size-input + main toolbar #text-size-select) to the
  // current textTool.size.
  updateTextSizeActive(textTool.size);
  _setSizeSelectValue(document.getElementById('text-size-select'), textTool.size);
  _setSizeSelectValue(document.getElementById('tqb-size-input'), textTool.size);
}

// ============================================================
//  TEXT COLOR PALETTE — apply color to selected text items
// ============================================================
export function updateTextColorPalette() {
  const palette = document.getElementById('text-color-palette');
  if (!palette) return;
  // Find any selected or editing text item
  const sel = getSelectedItems().filter(i => i.el && i.el.classList.contains('text-item'));
  // If nothing selected, check the currently editing text item
  let targetCount = sel.length;
  if (targetCount === 0) {
    const ed = getEditingText();
    if (ed) { sel.push(ed); targetCount = 1; }
  }
  if (targetCount === 0) {
    palette.classList.remove('active');
    return;
  }
  palette.classList.add('active');
  // Show which item(s) we're targeting
  const lbl = document.getElementById('tcp-target-label');
  if (lbl) lbl.textContent = targetCount > 1 ? `(${targetCount} items)` : '';
  // Highlight the swatch matching the first selected text's color
  const firstColor = (sel[0].color || '#ffffff').toLowerCase();
  palette.querySelectorAll('.tcp-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color && sw.dataset.color.toLowerCase() === firstColor);
  });
  const picker = document.getElementById('tcp-custom-color');
  if (picker) picker.value = /^#[0-9a-f]{6}$/i.test(firstColor) ? firstColor : '#ffffff';
}

export function applyTextColorToSelected(hexColor) {
  if (!/^#[0-9a-f]{6}$/i.test(hexColor)) return;
  const sel = getSelectedItems().filter(i => i.el && i.el.classList.contains('text-item'));
  let targets = sel;
  if (targets.length === 0) {
    const ed = getEditingText();
    if (ed) targets = [ed];
  }
  if (targets.length === 0) { toast('Select a text item first'); return; }
  pushUndo();
  // Also update the new-item default so future texts use this color
  textTool.color = hexColor;
  targets.forEach(tx => {
    tx.color = hexColor;
    applyTextProps(tx);
  });
  scheduleAutoSave();
  updateTextColorPalette();
  // Update visual active swatch
  document.querySelectorAll('#text-color-palette .tcp-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color && sw.dataset.color.toLowerCase() === hexColor.toLowerCase());
  });
  const picker = document.getElementById('tcp-custom-color');
  if (picker) picker.value = hexColor;
}

// Wire up palette swatches + custom picker (run after DOM is ready)
(function initTextColorPalette() {
  // Use a small delay to ensure DOM is built
  setTimeout(() => {
    const palette = document.getElementById('text-color-palette');
    if (!palette) return;
    palette.querySelectorAll('.tcp-swatch').forEach(sw => {
      sw.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
      sw.onclick = (e) => {
        e.stopPropagation();
        applyTextColorToSelected(sw.dataset.color);
      };
    });
    const picker = document.getElementById('tcp-custom-color');
    if (picker) {
      picker.onmousedown = (e) => e.stopPropagation();
      picker.oninput = (e) => {
        applyTextColorToSelected(e.target.value);
      };
    }
  }, 0);
})();
