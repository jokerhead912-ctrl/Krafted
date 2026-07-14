
import { state, canvasContent } from './core-state.js';
import { toast } from './ui-utils.js';

// ============================================================
//  RELATION LINES — XMind-style connector lines between items
// ============================================================
// Data model:
//   state.relations = [{
//     id, fromId, toId, fromAnchor, toAnchor, label, style, color
//   }]
// Styles: 'straight' | 'orthogonal' | 'curved' | 'dashed'
// Anchors: 'auto' | 'top' | 'bottom' | 'left' | 'right' | 'center'
//
// The SVG layer #relation-svg sits inside #viewport and follows
// pan/zoom via its parent transform. Lines are drawn in world
// coordinates — the SVG viewport matches the canvas size.
//
// Endpoints are computed DYNAMICALLY from item positions — no
// absolute coords stored. This means group moves, zoom, nudge,
// and tidy all work without any extra code.

const RELATION_STYLES = [
  { id: 'orthogonal', name: '直角折线', icon: '┗' },
  { id: 'straight',   name: '直线',     icon: '━' },
  { id: 'curved',     name: '曲线',     icon: '╰' },
  { id: 'dashed',     name: '虚线',     icon: '┅' },
];

// Ensure relations array exists
export function _ensureRelations() {
  if (!state.relations) state.relations = [];
}

// Get the bounding rect of an item in world coordinates
export function _getItemWorldRect(item) {
  return {
    x: item.x, y: item.y,
    w: item.w || (item.el ? item.el.offsetWidth : 200),
    h: item.h || (item.el ? item.el.offsetHeight : 150),
  };
}

// Compute anchor point on an item's edge
export function _getAnchorPoint(item, anchor) {
  var r = _getItemWorldRect(item);
  if (!anchor || anchor === 'auto') {
    // auto will be resolved later based on relative positions
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }
  switch (anchor) {
    case 'top':    return { x: r.x + r.w / 2, y: r.y };
    case 'bottom': return { x: r.x + r.w / 2, y: r.y + r.h };
    case 'left':   return { x: r.x, y: r.y + r.h / 2 };
    case 'right':  return { x: r.x + r.w, y: r.y + r.h / 2 };
    case 'center': return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    default:       return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }
}

// Auto-pick best anchors based on relative positions
export function _autoAnchor(fromItem, toItem) {
  var fr = _getItemWorldRect(fromItem);
  var tr = _getItemWorldRect(toItem);
  var fc = { x: fr.x + fr.w / 2, y: fr.y + fr.h / 2 };
  var tc = { x: tr.x + tr.w / 2, y: tr.y + tr.h / 2 };
  var dx = tc.x - fc.x;
  var dy = tc.y - fc.y;
  var fromA, toA;
  if (Math.abs(dx) >= Math.abs(dy)) {
    fromA = dx > 0 ? 'right' : 'left';
    toA   = dx > 0 ? 'left' : 'right';
  } else {
    fromA = dy > 0 ? 'bottom' : 'top';
    toA   = dy > 0 ? 'top' : 'bottom';
  }
  return { from: fromA, to: toA };
}

// Compute endpoint positions for a relation
export function _getRelationEndpoints(rel) {
  var fromItem = null, toItem = null;
  for (var i = 0; i < state.items.length; i++) {
    if (state.items[i].id === rel.fromId) fromItem = state.items[i];
    if (state.items[i].id === rel.toId) toItem = state.items[i];
  }
  if (!fromItem || !toItem) return null;
  var fromA = rel.fromAnchor, toA = rel.toAnchor;
  if (!fromA || fromA === 'auto' || !toA || toA === 'auto') {
    var auto = _autoAnchor(fromItem, toItem);
    if (!fromA || fromA === 'auto') fromA = auto.from;
    if (!toA || toA === 'auto') toA = auto.to;
  }
  return {
    from: _getAnchorPoint(fromItem, fromA),
    to: _getAnchorPoint(toItem, toA),
    fromItem: fromItem, toItem: toItem,
    fromAnchor: fromA, toAnchor: toA,
  };
}

// Build orthogonal path (XMind-style right-angle line)
export function _buildOrthogonalPath(p1, p2) {
  var dx = p2.x - p1.x;
  var dy = p2.y - p1.y;
  var mx = p1.x + dx / 2;
  var my = p1.y + dy / 2;
  // Decide orientation: horizontal-first or vertical-first
  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal dominant: go horizontal first
    return [
      'M', p1.x, p1.y,
      'L', mx, p1.y,
      'L', mx, p2.y,
      'L', p2.x, p2.y,
    ].join(' ');
  } else {
    // Vertical dominant: go vertical first
    return [
      'M', p1.x, p1.y,
      'L', p1.x, my,
      'L', p2.x, my,
      'L', p2.x, p2.y,
    ].join(' ');
  }
}

// Build curved path (simple quadratic bezier)
export function _buildCurvedPath(p1, p2) {
  var dx = p2.x - p1.x;
  var dy = p2.y - p1.y;
  var dist = Math.sqrt(dx * dx + dy * dy);
  var cpOffset = Math.min(dist * 0.4, 200);
  var cp1x, cp1y;
  // Curve direction based on anchor orientation
  if (Math.abs(dx) > Math.abs(dy)) {
    cp1x = p1.x + dx / 2;
    cp1y = p1.y;
  } else {
    cp1x = p1.x;
    cp1y = p1.y + dy / 2;
  }
  return 'M ' + p1.x + ' ' + p1.y + ' Q ' + cp1x + ' ' + cp1y + ' ' + p2.x + ' ' + p2.y;
}

// Build arrowhead triangle path
export function _buildArrowhead(p1, p2, size) {
  size = size || 8;
  var dx = p2.x - p1.x;
  var dy = p2.y - p1.y;
  var len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return '';
  var ux = dx / len, uy = dy / len;
  var tipX = p2.x, tipY = p2.y;
  var baseX = tipX - ux * size;
  var baseY = tipY - uy * size;
  var nx = -uy * (size * 0.45);
  var ny =  ux * (size * 0.45);
  return (baseX + nx) + ',' + (baseY + ny) + ' ' + tipX + ',' + tipY + ' ' + (baseX - nx) + ',' + (baseY - ny);
}

// Render all relations into the SVG layer
// Lines use world coordinates + 50000 offset (matching #canvas OFF)
export function renderRelations() {
  var svg = document.getElementById('relation-svg');
  if (!svg) return;
  _ensureRelations();
  var OFF = 50000;
  svg.innerHTML = '';
  if (!state.relations.length) return;
  // Guard: skip if items haven't loaded yet (async restore)
  if (!state.items || !state.items.length) return;

  // Build a defs section for arrowhead markers
  var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  var marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.setAttribute('id', 'rel-arrow-marker');
  marker.setAttribute('markerWidth', '8');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('refX', '8');
  marker.setAttribute('refY', '3');
  marker.setAttribute('orient', 'auto');
  var arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrowPath.setAttribute('d', 'M0,0 L8,3 L0,6 L2,3 Z');
  arrowPath.setAttribute('fill', '#00e5ff');
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  for (var i = 0; i < state.relations.length; i++) {
    var rel = state.relations[i];
    var ep = _getRelationEndpoints(rel);
    if (!ep) continue;
    var p1 = { x: ep.from.x + OFF, y: ep.from.y + OFF };
    var p2 = { x: ep.to.x + OFF, y: ep.to.y + OFF };
    var isSelected = (state.selectedRelation === rel.id);
    var style = rel.style || 'orthogonal';
    var color = rel.color || '#00e5ff';
    var lw = rel.lineWidth || 3;

    // Group for this relation
    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-rel-id', rel.id);
    g.setAttribute('class', 'rel-group');

    // Build path based on style
    var d;
    switch (style) {
      case 'curved':  d = _buildCurvedPath(p1, p2); break;
      case 'straight':
      case 'dashed':  d = 'M ' + p1.x + ' ' + p1.y + ' L ' + p2.x + ' ' + p2.y; break;
      default:        d = _buildOrthogonalPath(p1, p2); break;
    }

    // Invisible fat hit path — makes clicking the line much easier
    var hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.setAttribute('d', d);
    hit.setAttribute('class', 'rel-hit');
    hit.setAttribute('data-rel-id', rel.id);
    hit.addEventListener('click', function(e) {
      e.stopPropagation();
      _selectRelation(this.getAttribute('data-rel-id'));
    });
    hit.addEventListener('dblclick', function(e) {
      e.stopPropagation();
      _editRelationLabel(this.getAttribute('data-rel-id'));
    });
    hit.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      e.stopPropagation();
      _showRelationCtxMenu(e, this.getAttribute('data-rel-id'));
    });
    g.appendChild(hit);

    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'rel-line' + (style === 'dashed' ? ' dashed' : '') + (isSelected ? ' selected' : ''));
    path.setAttribute('stroke', color);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-width', isSelected ? String(lw + 1) : String(lw));
    if (style === 'dashed') path.setAttribute('stroke-dasharray', '6 4');
    path.setAttribute('data-rel-id', rel.id);
    path.addEventListener('click', function(e) {
      e.stopPropagation();
      _selectRelation(this.getAttribute('data-rel-id'));
    });
    path.addEventListener('dblclick', function(e) {
      e.stopPropagation();
      _editRelationLabel(this.getAttribute('data-rel-id'));
    });
    path.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      e.stopPropagation();
      _showRelationCtxMenu(e, this.getAttribute('data-rel-id'));
    });
    g.appendChild(path);

    // Arrowhead polygon at the to-end
    var arrowPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    arrowPoly.setAttribute('points', _buildArrowhead(p1, p2, 10));
    arrowPoly.setAttribute('class', 'rel-arrow');
    arrowPoly.setAttribute('fill', color);
    g.appendChild(arrowPoly);

    // Label (if any)
    if (rel.label) {
      var labelSize = rel.labelSize || 20;
      var mx = (p1.x + p2.x) / 2;
      var my = (p1.y + p2.y) / 2;
      var labelText = rel.label.length > 40 ? rel.label.substring(0, 40) + '…' : rel.label;
      var charW = labelSize * 0.58;
      var textW = Math.min(labelText.length * charW, 300);
      var textH = labelSize + 6;
      var bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', mx - textW / 2 - 6);
      bg.setAttribute('y', my - textH / 2 - 1);
      bg.setAttribute('width', textW + 12);
      bg.setAttribute('height', textH + 2);
      bg.setAttribute('class', 'rel-label-bg');
      g.appendChild(bg);
      var txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', mx);
      txt.setAttribute('y', my + labelSize * 0.35);
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('class', 'rel-label-text');
      txt.setAttribute('font-size', labelSize + 'px');
      txt.textContent = labelText;
      g.appendChild(txt);
    }

    svg.appendChild(g);
  }
}

// Select a relation by ID
export function _selectRelation(id) {
  _ensureRelations();
  state.selectedRelation = (state.selectedRelation === id) ? null : id;
  // Deselect items when selecting a relation
  if (state.selectedRelation) {
    state.selected.clear();
    refreshSelection();
  }
  renderRelations();
}

// Show context menu for a relation line
export function _showRelationCtxMenu(e, id) {
  _selectRelation(id);
  var menu = document.getElementById('ctx-menu');
  if (!menu) return;
  var rel = (state.relations || []).find(function(r) { return r.id === id; });
  if (!rel) return;
  var curStyle = rel.style || 'orthogonal';
  var curColor = rel.color || '#00e5ff';
  var curWidth = rel.lineWidth || 6;
  var colors = ['#00e5ff','#ffdd44','#ff6b6b','#51cf66','#cc5de8','#ff922b','#74c0fc','#ffffff'];
  var html = '<div class="ctx-section">Style</div>';
  for (var i = 0; i < RELATION_STYLES.length; i++) {
    var s = RELATION_STYLES[i];
    html += '<div class="ctx-item' + (s.id === curStyle ? ' ctx-checked' : '') + '" onclick="(function(){ _setRelationStyle(\'' + id + '\',\'' + s.id + '\'); hideCtx(); })()">' + s.icon + ' ' + s.name + '</div>';
  }
  html += '<div class="ctx-sep"></div>';
  html += '<div class="ctx-section">Width</div>';
  html += '<div class="ctx-item" onclick="(function(){ _setRelationWidth(\'' + id + '\',4); hideCtx(); })()">' + (curWidth===4?'✓ ':'') + 'Thin (4px)</div>';
  html += '<div class="ctx-item" onclick="(function(){ _setRelationWidth(\'' + id + '\',6); hideCtx(); })()">' + (curWidth===6?'✓ ':'') + 'Normal (6px)</div>';
  html += '<div class="ctx-item" onclick="(function(){ _setRelationWidth(\'' + id + '\',10); hideCtx(); })()">' + (curWidth===10?'✓ ':'') + 'Thick (10px)</div>';
  html += '<div class="ctx-sep"></div>';
  html += '<div class="ctx-section">Color</div><div style="display:flex;flex-wrap:wrap;gap:3px;padding:4px 8px;">';
  for (var c = 0; c < colors.length; c++) {
    html += '<div onclick="(function(){ _setRelationColor(\'' + id + '\',\'' + colors[c] + '\'); hideCtx(); })()" style="width:18px;height:18px;border-radius:3px;background:' + colors[c] + ';cursor:pointer;border:1px solid ' + (curColor===colors[c]?'#fff':'#444') + ';" title="' + colors[c] + '"></div>';
  }
  html += '</div>';
  html += '<div class="ctx-sep"></div>';
  html += '<div class="ctx-section">Label</div>';
  html += '<div class="ctx-item" onclick="(function(){ _editRelationLabel(\'' + id + '\'); hideCtx(); })()">✏️ Edit Label Text</div>';
  html += '<div class="ctx-item ctx-submenu-trigger" onclick="event.stopPropagation();(function(btn){ var sm=btn.nextElementSibling; if(sm){ sm.style.display=sm.style.display===&quot;block&quot;?&quot;none&quot;:&quot;block&quot;; } })(this)">🔤 Label Size (' + (rel.labelSize||16) + 'px) ▸</div>';
  html += '<div class="ctx-submenu" style="display:none;padding-left:12px;">';
  var _lsSizes = [12, 14, 16, 20, 24, 32, 48, 64];
  for (var ls = 0; ls < _lsSizes.length; ls++) {
    var _lsz = _lsSizes[ls];
    var _lmark = (rel.labelSize === _lsz) ? '✓ ' : '';
    html += '<div class="ctx-item" onclick="(function(){ _setRelationLabelSize(\'' + id + '\',' + _lsz + '); hideCtx(); })()">' + _lmark + _lsz + 'px</div>';
  }
  html += '</div>';
  html += '<div class="ctx-sep"></div>';
  html += '<div class="ctx-item ctx-danger" onclick="(function(){ _deleteRelation(\'' + id + '\'); hideCtx(); })()">🗑 Delete Relation</div>';
  menu.innerHTML = html;
  menu.style.display = 'block';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.style.zIndex = '99999999';
}

export function _setRelationStyle(id, style) {
  _ensureRelations();
  var rel = state.relations.find(function(r) { return r.id === id; });
  if (rel) { rel.style = style; }
  renderRelations();
  scheduleAutoSave();
}

export function _setRelationWidth(id, w) {
  _ensureRelations();
  var rel = state.relations.find(function(r) { return r.id === id; });
  if (rel) { rel.lineWidth = w; }
  renderRelations();
  scheduleAutoSave();
}

export function _setRelationColor(id, color) {
  _ensureRelations();
  var rel = state.relations.find(function(r) { return r.id === id; });
  if (rel) { rel.color = color; }
  renderRelations();
  scheduleAutoSave();
}

export function _setRelationLabelSize(id, size) {
  _ensureRelations();
  var rel = state.relations.find(function(r) { return r.id === id; });
  if (!rel) return;
  if (size === undefined || size === null) {
    // legacy cycle behaviour (single click with no size arg)
    var cur = rel.labelSize || 16;
    var sizes = [14, 16, 20, 24, 32, 48];
    var idx = sizes.indexOf(cur);
    var next = sizes[(idx + 1) % sizes.length];
    rel.labelSize = next;
  } else {
    rel.labelSize = size;
  }
  renderRelations();
  scheduleAutoSave();
  toast('Label: ' + rel.labelSize + 'px');
}

// Inline label editor — replaces prompt() to avoid double-click hang
export function _editRelationLabel(id) {
  _ensureRelations();
  var rel = state.relations.find(function(r) { return r.id === id; });
  if (!rel) return;
  // Remove any existing editor
  var existing = document.getElementById('rel-label-editor');
  if (existing) existing.remove();
  // Find the label midpoint in screen coords
  var ep = _getRelationEndpoints(rel);
  if (!ep) return;
  var OFF = 50000;
  var mx = (ep.from.x + ep.to.x) / 2 + OFF;
  var my = (ep.from.y + ep.to.y) / 2 + OFF;
  // Convert world to screen
  var screenX = mx * state.zoom + state.pan.x + OFF - OFF * state.zoom;
  var screenY = my * state.zoom + state.pan.y + OFF - OFF * state.zoom;

  var editor = document.createElement('div');
  editor.id = 'rel-label-editor';
  editor.style.cssText = 'position:fixed;z-index:99999999;background:#1a1a2e;border:1px solid #00e5ff;border-radius:6px;padding:6px 8px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
  editor.style.left = Math.max(10, Math.min(screenX - 100, window.innerWidth - 220)) + 'px';
  editor.style.top = Math.max(10, Math.min(screenY - 20, window.innerHeight - 60)) + 'px';
  editor.innerHTML = '<input id="rel-label-input" value="' + (rel.label||'').replace(/"/g,'&quot;') + '" style="background:#0d0d1a;border:1px solid #333;color:#fff;padding:4px 8px;border-radius:4px;font-size:12px;width:200px;font-family:Inter,sans-serif;" placeholder="Label text…" autofocus>' +
    '<div style="display:flex;gap:4px;margin-top:4px;">' +
    '<button onclick="(function(){ var v=document.getElementById(\'rel-label-input\').value.trim(); _commitRelationLabel(\'' + id + '\',v); })()" style="background:#00e5ff;color:#000;border:none;padding:3px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;">OK</button>' +
    '<button onclick="(function(){ document.getElementById(\'rel-label-editor\').remove(); })()" style="background:#333;color:#fff;border:none;padding:3px 10px;border-radius:4px;cursor:pointer;font-size:11px;">Cancel</button>' +
    '</div>';
  document.body.appendChild(editor);
  var inp = document.getElementById('rel-label-input');
  if (inp) {
    inp.focus();
    inp.select();
    inp.addEventListener('keydown', function(ev) {
      if (ev.key === 'Enter') { _commitRelationLabel(id, inp.value.trim()); }
      if (ev.key === 'Escape') { editor.remove(); }
    });
  }
}

export function _commitRelationLabel(id, value) {
  _ensureRelations();
  var rel = state.relations.find(function(r) { return r.id === id; });
  if (rel) { rel.label = value; }
  var editor = document.getElementById('rel-label-editor');
  if (editor) editor.remove();
  renderRelations();
  scheduleAutoSave();
}

export function _deleteRelation(id) {
  _ensureRelations();
  state.relations = state.relations.filter(function(r) { return r.id !== id; });
  if (state.selectedRelation === id) state.selectedRelation = null;
  renderRelations();
  scheduleAutoSave();
  toast('Relation deleted');
}

// Relation tool state
var relationTool = { fromId: null, fromItem: null };

export function _startRelationTool() {
  relationTool.fromId = null;
  relationTool.fromItem = null;
  state.selectedRelation = null;
  document.body.classList.add('relation-mode');
  toast('Click first item, then second item to connect');
}

export function _exitRelationTool() {
  relationTool.fromId = null;
  relationTool.fromItem = null;
  document.body.classList.remove('relation-mode');
  setTool('select');
}

// Handle click in relation mode — pick first or second item
export function _handleRelationClick(target) {
  var itemEl = target.closest('.item');
  if (!itemEl) return;
  // Find the item in state
  var item = null;
  for (var i = 0; i < state.items.length; i++) {
    if (state.items[i].el === itemEl) { item = state.items[i]; break; }
  }
  if (!item) return;

  if (!relationTool.fromId) {
    // First click — set source
    relationTool.fromId = item.id;
    relationTool.fromItem = item;
    itemEl.style.outline = '2px solid #00e5ff';
    itemEl.style.outlineOffset = '3px';
    toast('Now click the target item');
  } else if (item.id !== relationTool.fromId) {
    // Second click — create relation
    _ensureRelations();
    var auto = _autoAnchor(relationTool.fromItem, item);
    var rel = {
      id: 'rel_' + Date.now(),
      fromId: relationTool.fromId,
      toId: item.id,
      fromAnchor: auto.from,
      toAnchor: auto.to,
      label: '',
      style: 'orthogonal',
      color: '#00e5ff',
    };
    state.relations.push(rel);
    // Clear outline
    if (relationTool.fromItem && relationTool.fromItem.el) {
      relationTool.fromItem.el.style.outline = '';
    }
    relationTool.fromId = null;
    relationTool.fromItem = null;
    renderRelations();
    scheduleAutoSave();
    _exitRelationTool();
    toast('Relation created — double-click line to add label');
  }
}

// Toggle hide/show all relations
export function toggleRelations() {
  var svg = document.getElementById('relation-svg');
  if (!svg) return;
  if (svg.style.display === 'none') {
    svg.style.display = '';
    toast('Relations shown');
  } else {
    svg.style.display = 'none';
    toast('Relations hidden');
  }
}

