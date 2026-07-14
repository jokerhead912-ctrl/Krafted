
// ============================================================
//  HELP PANEL — hotkeys, guide & shortcut editor
//  v5.4 R79 — tabs: Guide | Shortcuts
// ============================================================

import { Platform } from './core-state.js';

export function showHelp() {
  var overlay = document.getElementById('help-overlay');
  if (!overlay) return;
  // Build content on first show; reuse on subsequent shows.
  if (!overlay._built) _buildHelpContent(overlay);
  overlay.style.display = 'flex';
  // Default to the Guide tab
  _switchTab('guide');
}

export function hideHelp() {
  var overlay = document.getElementById('help-overlay');
  if (overlay) overlay.style.display = 'none';
}

// ── Internal ─────────────────────────────────────────────────

function _buildHelpContent(overlay) {
  overlay._built = true;
  // Clear existing inline content
  overlay.innerHTML = '';

  var box = document.createElement('div');
  box.style.cssText = 'background:#14142a;border:1px solid rgba(0,229,255,0.3);border-radius:16px;padding:24px 28px;max-width:720px;max-height:85vh;overflow-y:auto;color:#e0e0e0;font-family:Inter,sans-serif;box-shadow:0 24px 80px rgba(0,0,0,0.6);width:90vw;';

  // Header
  var header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
  var title = document.createElement('h2');
  title.style.cssText = 'margin:0;font-size:22px;font-weight:700;color:#00e5ff;letter-spacing:0.5px;';
  title.textContent = 'KRAFTED — Help';
  var closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.cssText = 'background:none;border:none;color:#888;font-size:24px;cursor:pointer;padding:0 4px;';
  closeBtn.onclick = hideHelp;
  header.appendChild(title);
  header.appendChild(closeBtn);
  box.appendChild(header);

  // Tabs
  var tabs = document.createElement('div');
  tabs.style.cssText = 'display:flex;gap:0;margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.1);';
  ['guide','shortcuts'].forEach(function(tabId){
    var t = document.createElement('button');
    t.className = 'help-tab';
    t.setAttribute('data-tab', tabId);
    t.textContent = tabId === 'guide' ? '📖 Guide' : '⌨️ Shortcuts';
    t.style.cssText = 'background:none;border:none;color:#888;padding:8px 16px;font-size:13px;cursor:pointer;border-bottom:2px solid transparent;transition:all 0.15s;';
    t.onclick = function(){ _switchTab(tabId); };
    tabs.appendChild(t);
  });
  box.appendChild(tabs);

  // Tab panels container
  var panels = document.createElement('div');
  panels.id = 'help-panels';

  // ── GUIDE TAB ──────────────────────────────────────────────
  var guidePanel = document.createElement('div');
  guidePanel.id = 'help-panel-guide';
  guidePanel.className = 'help-panel';
  guidePanel.innerHTML = _guideHTML();
  panels.appendChild(guidePanel);

  // ── SHORTCUTS TAB ──────────────────────────────────────────
  var scPanel = document.createElement('div');
  scPanel.id = 'help-panel-shortcuts';
  scPanel.className = 'help-panel';
  scPanel.style.display = 'none';
  scPanel.innerHTML = '<div style="text-align:center;color:#888;padding:20px;">Loading shortcuts…</div>';
  panels.appendChild(scPanel);

  box.appendChild(panels);

  // Footer
  var footer = document.createElement('p');
  footer.style.cssText = 'margin-top:20px;font-size:10px;color:#555;text-align:center;';
  footer.textContent = 'Krafted v5.4 — by Joker Head Studios';
  box.appendChild(footer);

  overlay.appendChild(box);
  overlay.onclick = function(ev){ if (ev.target === overlay) hideHelp(); };
}

function _guideHTML() {
  return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">' +
    '<div>' +
      '<h3 style="color:#00e5ff;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;">Tools</h3>' +
      '<table style="width:100%;font-size:12px;border-collapse:collapse;">' +
        '<tr><td style="padding:4px 0;color:#888;">V</td><td style="padding:4px 0;">Select & Move</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">T</td><td style="padding:4px 0;">Text Tool</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">' + Platform.zoomMod + '+D</td><td style="padding:4px 0;">Draw (pen/arrow/box)</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">E</td><td style="padding:4px 0;">Export Area</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">C</td><td style="padding:4px 0;">Capture Area</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">Shift+C</td><td style="padding:4px 0;">Screen Capture</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">X</td><td style="padding:4px 0;">Free Shape Cut</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">L</td><td style="padding:4px 0;">Lasso Cut</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">M</td><td style="padding:4px 0;">Mind Map</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">R</td><td style="padding:4px 0;">Relation Line</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">' + Platform.zoomMod + '+L</td><td style="padding:4px 0;">Add Link</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">H</td><td style="padding:4px 0;">Help / Shortcuts</td></tr>' +
      '</table>' +
    '</div>' +
    '<div>' +
      '<h3 style="color:#00e5ff;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;">Actions</h3>' +
      '<table style="width:100%;font-size:12px;border-collapse:collapse;">' +
        '<tr><td style="padding:4px 0;color:#888;">' + Platform.zoomMod + '+Z</td><td style="padding:4px 0;">Undo</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">' + Platform.zoomMod + '+Y</td><td style="padding:4px 0;">Redo</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">' + Platform.zoomMod + '+S</td><td style="padding:4px 0;">Save Board</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">' + Platform.zoomMod + '+O</td><td style="padding:4px 0;">Open Board</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">' + Platform.zoomMod + '+G</td><td style="padding:4px 0;">Group</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">' + Platform.zoomMod + '+Shift+G</td><td style="padding:4px 0;">Ungroup</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">' + Platform.zoomMod + '+Shift+D</td><td style="padding:4px 0;">Duplicate</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">' + Platform.zoomMod + '+Shift+U</td><td style="padding:4px 0;">Tidy Selected</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">' + Platform.zoomMod + '+Shift+T</td><td style="padding:4px 0;">Translate EN→中文</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">G</td><td style="padding:4px 0;">Toggle Grid</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">Shift+F</td><td style="padding:4px 0;">Fullscreen</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">F</td><td style="padding:4px 0;">Frame Selection</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">Del</td><td style="padding:4px 0;">Delete Selected</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">Space (hold)</td><td style="padding:4px 0;">Pan Canvas</td></tr>' +
      '</table>' +
    '</div>' +
  '</div>' +
  '<div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.1);">' +
    '<h3 style="color:#00e5ff;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Mouse / Touch</h3>' +
    '<table style="width:100%;font-size:12px;border-collapse:collapse;">' +
      '<tr><td style="padding:4px 0;color:#888;">Scroll Wheel</td><td style="padding:4px 0;">Zoom in/out</td></tr>' +
      '<tr><td style="padding:4px 0;color:#888;">' + Platform.zoomMod + '+Wheel</td><td style="padding:4px 0;">Zoom (modifier key)</td></tr>' +
      '<tr><td style="padding:4px 0;color:#888;">Middle-drag</td><td style="padding:4px 0;">Pan canvas</td></tr>' +
      '<tr><td style="padding:4px 0;color:#888;">Right-click item</td><td style="padding:4px 0;">Context menu</td></tr>' +
      (Platform.trackpad ?
        '<tr><td style="padding:4px 0;color:#888;">Pinch (trackpad)</td><td style="padding:4px 0;">Zoom (natural)</td></tr>' +
        '<tr><td style="padding:4px 0;color:#888;">Two-finger drag</td><td style="padding:4px 0;">Pan (trackpad)</td></tr>'
      : '') +
    '</table>' +
  '</div>';
}

// ── Tab switching ────────────────────────────────────────────
function _switchTab(tabId) {
  var tabs = document.querySelectorAll('#help-overlay .help-tab');
  tabs.forEach(function(t){
    t.style.color = t.getAttribute('data-tab') === tabId ? '#00e5ff' : '#888';
    t.style.borderBottomColor = t.getAttribute('data-tab') === tabId ? '#00e5ff' : 'transparent';
  });
  var panels = document.querySelectorAll('#help-panels .help-panel');
  panels.forEach(function(p){ p.style.display = 'none'; });
  var panel = document.getElementById('help-panel-' + tabId);
  if (panel) panel.style.display = '';

  // Build shortcut editor on first visit
  if (tabId === 'shortcuts' && !panel._built) {
    _buildShortcutEditor(panel);
    panel._built = true;
  }
}

// ── Shortcut Editor ──────────────────────────────────────────
function _buildShortcutEditor(panel) {
  var reg = (typeof window !== 'undefined' && window.ShortcutRegistry) ? window.ShortcutRegistry : {};
  var defaults = (typeof window !== 'undefined' && window.DEFAULT_SHORTCUTS) ? window.DEFAULT_SHORTCUTS : [];

  // Build a lookup for defaults
  var defaultMap = {};
  defaults.forEach(function(d){ defaultMap[d.id] = d; });

  // Group by category
  var cats = {};
  var catOrder = ['Tools','Edit','File','Group','Arrange','Navigation','Translate','Media'];
  catOrder.forEach(function(c){ cats[c] = []; });
  Object.keys(reg).forEach(function(id){
    var e = reg[id];
    var cat = e.category || 'Other';
    if (!cats[cat]) { cats[cat] = []; catOrder.push(cat); }
    cats[cat].push(e);
  });

  var html = '';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
  html += '<span style="font-size:11px;color:#888;">Click a shortcut to rebind — press the new key combo, then Enter to save or Esc to cancel.</span>';
  html += '<button onclick="if(window._kraftedResetAllShortcuts){window._kraftedResetAllShortcuts()}" style="background:rgba(255,80,80,0.15);border:1px solid rgba(255,80,80,0.3);color:#ff5050;font-size:11px;padding:4px 10px;border-radius:4px;cursor:pointer;">Reset All</button>';
  html += '</div>';

  catOrder.forEach(function(cat){
    var entries = cats[cat];
    if (!entries || !entries.length) return;
    html += '<h4 style="color:#00e5ff;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;margin:12px 0 6px;border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:4px;">' + cat + '</h4>';
    html += '<table style="width:100%;font-size:12px;border-collapse:collapse;">';
    entries.forEach(function(e){
      var def = defaultMap[e.id];
      var defaultKeys = null;
      if (def) {
        defaultKeys = (Platform.mac && def.macKeys) ? def.macKeys : def.keys;
      }
      var isCustom = !!e.userDefined;
      var keyStr = _formatKeyCombo(e.keys);
      var defStr = defaultKeys ? _formatKeyCombo(defaultKeys) : '';
      html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.03);">';
      html += '<td style="padding:6px 8px 6px 0;color:#e0e0e0;white-space:nowrap;">' + e.label + '</td>';
      html += '<td style="padding:6px 4px;color:' + (isCustom ? '#7c8cf0' : '#888') + ';font-family:monospace;font-size:11px;white-space:nowrap;cursor:pointer;" class="sc-key" data-id="' + e.id + '" title="Click to rebind">' + keyStr + '</td>';
      if (isCustom) {
        html += '<td style="padding:6px 4px;"><button class="sc-reset" data-id="' + e.id + '" title="Reset to default (' + defStr + ')" style="background:none;border:none;color:#ff5050;font-size:14px;cursor:pointer;padding:0 4px;">↩</button></td>';
      } else {
        html += '<td style="padding:6px 4px;"></td>';
      }
      html += '</tr>';
    });
    html += '</table>';
  });

  panel.innerHTML = html;

  // ── Wire up click handlers ──────────────────────────────────
  panel.querySelectorAll('.sc-key').forEach(function(el){
    el.addEventListener('click', function(){
      var id = el.getAttribute('data-id');
      _startKeyCapture(el, id);
    });
  });
  panel.querySelectorAll('.sc-reset').forEach(function(el){
    el.addEventListener('click', function(ev){
      ev.stopPropagation();
      var id = el.getAttribute('data-id');
      if (typeof window._kraftedResetShortcut === 'function') {
        window._kraftedResetShortcut(id);
        _rebuildShortcutPanel(panel);
      }
    });
  });

  // Global reset
  window._kraftedResetAllShortcuts = function(){
    if (typeof window._kraftedResetAllSC === 'function') {
      window._kraftedResetAllSC();
      _rebuildShortcutPanel(panel);
    }
  };
  window._kraftedResetShortcut = function(id){
    if (typeof window.resetShortcutSC === 'function') {
      window.resetShortcutSC(id);
    }
  };
}

// ── Key capture mode ─────────────────────────────────────────
var _captureState = null;

function _startKeyCapture(el, id) {
  if (_captureState) {
    _captureState.el.style.outline = '';
    _captureState.el.style.background = '';
  }
  _captureState = { el: el, id: id };
  el.style.outline = '2px solid #7c8cf0';
  el.style.background = 'rgba(124,140,240,0.15)';
  el.textContent = 'Press keys…';

  // Capture next keydown
  function _onCapture(e) {
    if (e.key === 'Escape') {
      _cancelCapture();
      return;
    }
    if (e.key === 'Enter') {
      _commitCapture();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    // Build key object
    var k = {
      key: e.key,
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
      meta: e.metaKey,
    };
    _captureState.keys = [k];
    el.textContent = _formatKeyCombo([k]);
  }

  function _commitCapture() {
    document.removeEventListener('keydown', _onCapture, true);
    if (_captureState && _captureState.keys && _captureState.keys.length > 0) {
      var id = _captureState.id;
      var keys = _captureState.keys;
      // Persist
      try {
        var overrides = {};
        try { var raw = localStorage.getItem('krafted_shortcuts'); if (raw) overrides = JSON.parse(raw); } catch(e){}
        overrides[id] = keys;
        localStorage.setItem('krafted_shortcuts', JSON.stringify(overrides));
      } catch(e){}
      // Rebuild registry
      if (typeof window._kraftedRebuildShortcuts === 'function') {
        window._kraftedRebuildShortcuts();
      }
    }
    _clearCapture();
  }

  function _cancelCapture() {
    document.removeEventListener('keydown', _onCapture, true);
    _clearCapture();
  }

  document.addEventListener('keydown', _onCapture, true);
  window._captureCommit = _commitCapture;
  window._captureCancel = _cancelCapture;
}

function _clearCapture() {
  if (_captureState) {
    _captureState.el.style.outline = '';
    _captureState.el.style.background = '';
    _captureState = null;
    // Rebuild the panel to show updated keys
    var panel = document.getElementById('help-panel-shortcuts');
    if (panel) _rebuildShortcutPanel(panel);
  }
}

function _rebuildShortcutPanel(panel) {
  panel._built = false;
  _buildShortcutEditor(panel);
  panel._built = true;
}

// ── Helpers ──────────────────────────────────────────────────
function _formatKeyCombo(keys) {
  if (!keys || !keys.length) return '—';
  return keys.map(function(k){
    var parts = [];
    if (k.ctrl) parts.push(Platform.mac ? '⌃' : 'Ctrl');
    if (k.meta) parts.push(Platform.mac ? '⌘' : 'Win');
    if (k.alt) parts.push(Platform.mac ? '⌥' : 'Alt');
    if (k.shift) parts.push(Platform.mac ? '⇧' : 'Shift');
    var kn = k.key;
    if (kn === ' ') kn = 'Space';
    if (kn === 'ArrowUp') kn = '↑';
    if (kn === 'ArrowDown') kn = '↓';
    if (kn === 'ArrowLeft') kn = '←';
    if (kn === 'ArrowRight') kn = '→';
    if (kn === 'Escape') kn = 'Esc';
    if (kn === 'Delete') kn = 'Del';
    if (kn === 'Backspace') kn = '⌫';
    parts.push(kn);
    return parts.join(Platform.mac ? '' : '+');
  }).join('  ');
}
