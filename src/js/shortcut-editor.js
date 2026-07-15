
// ============================================================
//  SHORTCUT EDITOR — customizable keyboard shortcuts
//  v5.4 R79 — user can remap any shortcut from the Help panel.
//  All shortcuts read from ShortcutRegistry; user overrides
//  are persisted to localStorage.
// ============================================================

import { Platform } from './core-state.js';

// ── Default shortcut registry ────────────────────────────────
// Each entry: { id, label, category, defaultKeys, macKeys?, action }
// - defaultKeys: array of { key, ctrl, shift, alt, meta } objects
// - macKeys: optional Mac-specific override (Cmd instead of Ctrl)
// - action: function name to call
// When Platform.mac is true AND macKeys is provided, macKeys wins.
// Otherwise defaultKeys is used, with ctrl→cmd on Mac automatically.

const DEFAULT_SHORTCUTS = [
  // === TOOLS ===
  { id: 'tool-select',     category: 'Tools', label: 'Select & Move',            keys: [{ key: 'v' }] },
  { id: 'tool-text',       category: 'Tools', label: 'Text Tool',                keys: [{ key: 't' }] },
  { id: 'tool-draw',       category: 'Tools', label: 'Draw Tool',                keys: [{ key: 'd', ctrl: true }], macKeys: [{ key: 'd', meta: true }] },
  { id: 'tool-export',     category: 'Tools', label: 'Export Area',              keys: [{ key: 'e' }] },
  { id: 'tool-capture',    category: 'Tools', label: 'Capture Area',             keys: [{ key: 'c' }] },
  { id: 'tool-screen-cap', category: 'Tools', label: 'Screen Capture',           keys: [{ key: 'c', shift: true }] },
  { id: 'tool-cut',        category: 'Tools', label: 'Free Shape Cut',           keys: [{ key: 'x' }] },
  { id: 'tool-lasso',      category: 'Tools', label: 'Lasso Cut',                keys: [{ key: 'l' }] },
  { id: 'tool-mindmap',    category: 'Tools', label: 'Mind Map',                 keys: [{ key: 'm' }] },
  { id: 'tool-relation',   category: 'Tools', label: 'Relation Line',            keys: [{ key: 'r' }] },
  { id: 'tool-link',       category: 'Tools', label: 'Add Link Card',            keys: [{ key: 'l', ctrl: true }], macKeys: [{ key: 'l', meta: true }] },
  { id: 'tool-grid',       category: 'Tools', label: 'Toggle Grid',              keys: [{ key: 'g' }] },
  { id: 'tool-fullscreen', category: 'Tools', label: 'Fullscreen',               keys: [{ key: 'f', shift: true }] },
  { id: 'tool-frame-sel',  category: 'Tools', label: 'Frame Selection',          keys: [{ key: 'f' }] },

  // === EDIT ===
  { id: 'edit-undo',       category: 'Edit', label: 'Undo',                      keys: [{ key: 'z', ctrl: true }], macKeys: [{ key: 'z', meta: true }] },
  { id: 'edit-redo',       category: 'Edit', label: 'Redo',                      keys: [{ key: 'y', ctrl: true }], macKeys: [{ key: 'y', meta: true }] },
  { id: 'edit-redo-alt',   category: 'Edit', label: 'Redo (Shift+Undo)',         keys: [{ key: 'z', ctrl: true, shift: true }], macKeys: [{ key: 'z', meta: true, shift: true }] },
  { id: 'edit-copy',       category: 'Edit', label: 'Copy',                      keys: [{ key: 'c', ctrl: true }], macKeys: [{ key: 'c', meta: true }] },
  { id: 'edit-paste',      category: 'Edit', label: 'Paste',                     keys: [{ key: 'v', ctrl: true }], macKeys: [{ key: 'v', meta: true }] },
  { id: 'edit-duplicate',  category: 'Edit', label: 'Duplicate',                 keys: [{ key: 'd', ctrl: true, shift: true }], macKeys: [{ key: 'd', meta: true, shift: true }] },
  { id: 'edit-delete',     category: 'Edit', label: 'Delete Selected',           keys: [{ key: 'Delete' }, { key: 'Backspace' }] },
  { id: 'edit-select-all', category: 'Edit', label: 'Select All',                keys: [{ key: 'a', ctrl: true }], macKeys: [{ key: 'a', meta: true }] },

  // === FILE ===
  { id: 'file-save',       category: 'File', label: 'Save Board',                keys: [{ key: 's', ctrl: true }], macKeys: [{ key: 's', meta: true }] },
  { id: 'file-save-as',    category: 'File', label: 'Save As…',                  keys: [{ key: 's', ctrl: true, shift: true }], macKeys: [{ key: 's', meta: true, shift: true }] },
  { id: 'file-open',       category: 'File', label: 'Open Board',                keys: [{ key: 'o', ctrl: true }], macKeys: [{ key: 'o', meta: true }] },

  // === GROUP ===
  { id: 'group-group',     category: 'Group', label: 'Group Selected',           keys: [{ key: 'g', ctrl: true }], macKeys: [{ key: 'g', meta: true }] },
  { id: 'group-ungroup',   category: 'Group', label: 'Ungroup',                  keys: [{ key: 'g', ctrl: true, shift: true }], macKeys: [{ key: 'g', meta: true, shift: true }] },

  // === ARRANGE ===
  { id: 'arrange-tidy',    category: 'Arrange', label: 'Tidy Selection',         keys: [{ key: 'u', ctrl: true, shift: true }], macKeys: [{ key: 'u', meta: true, shift: true }] },
  { id: 'arrange-tetris-up',    category: 'Arrange', label: 'Tetris Align Up',    keys: [{ key: 'ArrowUp', ctrl: true }], macKeys: [{ key: 'ArrowUp', meta: true }] },
  { id: 'arrange-tetris-down',  category: 'Arrange', label: 'Tetris Align Down',  keys: [{ key: 'ArrowDown', ctrl: true }], macKeys: [{ key: 'ArrowDown', meta: true }] },
  { id: 'arrange-tetris-left',  category: 'Arrange', label: 'Tetris Align Left',  keys: [{ key: 'ArrowLeft', ctrl: true }], macKeys: [{ key: 'ArrowLeft', meta: true }] },
  { id: 'arrange-tetris-right', category: 'Arrange', label: 'Tetris Align Right', keys: [{ key: 'ArrowRight', ctrl: true }], macKeys: [{ key: 'ArrowRight', meta: true }] },
  { id: 'arrange-dist-h',  category: 'Arrange', label: 'Distribute Horizontal',  keys: [{ key: 'ArrowUp', ctrl: true, alt: true, shift: true }] },
  { id: 'arrange-dist-v',  category: 'Arrange', label: 'Distribute Vertical',    keys: [{ key: 'ArrowDown', ctrl: true, alt: true, shift: true }] },
  { id: 'arrange-norm-size',  category: 'Arrange', label: 'Normalize Size',      keys: [{ key: 'ArrowUp', ctrl: true, alt: true }] },
  { id: 'arrange-norm-scale', category: 'Arrange', label: 'Normalize Scale',     keys: [{ key: 'ArrowDown', ctrl: true, alt: true }] },
  { id: 'arrange-norm-h',  category: 'Arrange', label: 'Normalize Height',       keys: [{ key: 'ArrowLeft', ctrl: true, alt: true }] },
  { id: 'arrange-norm-w',  category: 'Arrange', label: 'Normalize Width',        keys: [{ key: 'ArrowRight', ctrl: true, alt: true }] },
  { id: 'arrange-stack',   category: 'Arrange', label: 'Stack Items',            keys: [{ key: 's', ctrl: true, alt: true }] },

  // === NAVIGATION ===
  { id: 'nav-pan-space',   category: 'Navigation', label: 'Pan Canvas (hold)',   keys: [{ key: ' ' }] },
  { id: 'nav-help',        category: 'Navigation', label: 'Show Help / Shortcuts', keys: [{ key: 'h' }] },
  { id: 'nav-esc',         category: 'Navigation', label: 'Cancel / Deselect',   keys: [{ key: 'Escape' }] },

  // === TRANSLATE ===
  { id: 'translate-en-zh', category: 'Translate', label: 'Translate EN→中文',    keys: [{ key: 't', ctrl: true, shift: true }], macKeys: [{ key: 't', meta: true, shift: true }] },

  // === MEDIA ===
  { id: 'media-frame-left',  category: 'Media', label: 'Frame Step Left',       keys: [{ key: 'ArrowLeft' }] },
  { id: 'media-frame-right', category: 'Media', label: 'Frame Step Right',      keys: [{ key: 'ArrowRight' }] },
  { id: 'media-frame-10-left',  category: 'Media', label: 'Jump 10 Frames Left',  keys: [{ key: 'ArrowLeft', shift: true }] },
  { id: 'media-frame-10-right', category: 'Media', label: 'Jump 10 Frames Right', keys: [{ key: 'ArrowRight', shift: true }] },
  { id: 'media-trim-i',    category: 'Media', label: 'Trim In Point',            keys: [{ key: 'i' }] },
  { id: 'media-trim-o',    category: 'Media', label: 'Trim Out Point',           keys: [{ key: 'o' }] },
];

// ── Runtime registry ─────────────────────────────────────────
// On init, defaults are merged with localStorage overrides.
export let ShortcutRegistry = {};

function _loadOverrides() {
  try {
    const raw = (window.KraftedStorage && window.KraftedStorage.getItemSync('krafted_shortcuts')) || localStorage.getItem('krafted_shortcuts');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {};
}

function _saveOverrides(overrides) {
  try {
    var val = JSON.stringify(overrides);
    localStorage.setItem('krafted_shortcuts', val);
    if (window.KraftedStorage) window.KraftedStorage.setItem('krafted_shortcuts', val).catch(function(){});
  } catch (e) {}
}

// Build the active shortcut map from defaults + overrides.
// For each shortcut id, if the user has an override array, use it.
// Otherwise pick macKeys on Mac, defaultKeys on Win.
function _rebuildRegistry() {
  const overrides = _loadOverrides();
  const out = {};
  DEFAULT_SHORTCUTS.forEach(function(def){
    const userKeys = overrides[def.id];
    if (userKeys && Array.isArray(userKeys) && userKeys.length > 0) {
      out[def.id] = { id: def.id, label: def.label, category: def.category, keys: userKeys, userDefined: true };
    } else if (Platform.mac && def.macKeys) {
      out[def.id] = { id: def.id, label: def.label, category: def.category, keys: def.macKeys, userDefined: false };
    } else {
      out[def.id] = { id: def.id, label: def.label, category: def.category, keys: def.keys, userDefined: false };
    }
  });
  ShortcutRegistry = out;
  // Expose globally so the keyboard handler can read it
  if (typeof window !== 'undefined') window.ShortcutRegistry = ShortcutRegistry;
  if (typeof window !== 'undefined') window.DEFAULT_SHORTCUTS = DEFAULT_SHORTCUTS;
}

// ── Public API ───────────────────────────────────────────────

// Reset ONE shortcut to default
export function resetShortcut(id) {
  const overrides = _loadOverrides();
  delete overrides[id];
  _saveOverrides(overrides);
  _rebuildRegistry();
}

// Set a custom key binding for a shortcut
// keysArr: array of { key, ctrl, shift, alt, meta }
export function setShortcut(id, keysArr) {
  const overrides = _loadOverrides();
  overrides[id] = keysArr;
  _saveOverrides(overrides);
  _rebuildRegistry();
}

// Reset ALL shortcuts to default
export function resetAllShortcuts() {
  try { localStorage.removeItem('krafted_shortcuts'); } catch (e) {}
  try { if (window.KraftedStorage) window.KraftedStorage.removeItem('krafted_shortcuts').catch(function(){}); } catch (e) {}
  _rebuildRegistry();
}

// Format a key combo for display
export function formatKeyCombo(keys) {
  if (!keys || !keys.length) return '—';
  return keys.map(function(k){
    const parts = [];
    if (k.ctrl) parts.push(Platform.mac ? '⌃' : 'Ctrl');
    if (k.meta) parts.push(Platform.mac ? '⌘' : 'Win');
    if (k.alt) parts.push(Platform.mac ? '⌥' : 'Alt');
    if (k.shift) parts.push(Platform.mac ? '⇧' : 'Shift');
    let keyName = k.key;
    if (keyName === ' ') keyName = 'Space';
    if (keyName === 'ArrowUp') keyName = '↑';
    if (keyName === 'ArrowDown') keyName = '↓';
    if (keyName === 'ArrowLeft') keyName = '←';
    if (keyName === 'ArrowRight') keyName = '→';
    if (keyName === 'Escape') keyName = 'Esc';
    if (keyName === 'Delete') keyName = 'Del';
    if (keyName === 'Backspace') keyName = '⌫';
    parts.push(keyName);
    return parts.join(Platform.mac ? '' : '+');
  }).join('  ');
}

// ── Init ─────────────────────────────────────────────────────
_rebuildRegistry();
console.log('[INIT] Shortcut Registry:', Object.keys(ShortcutRegistry).length, 'shortcuts loaded');

// Expose global helpers for the shortcut editor UI
if (typeof window !== 'undefined') {
  window._kraftedRebuildShortcuts = _rebuildRegistry;
  window.resetShortcutSC = resetShortcut;
  window.resetAllShortcutsSC = resetAllShortcuts;
}
