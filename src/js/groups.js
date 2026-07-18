import { getSelectedItems } from './selection.js';
import { state, colors, G, canvasContent } from './core-state.js';
import { scheduleAutoSave } from './save-load.js';
import { toast } from './ui-utils.js';;
import { updateItemStyle } from './add-items.js';
import { pushUndo } from './undo-redo.js';

// ============================================================
//  GROUPS
// ============================================================
const GROUP_COLORS = ['#ff4444','#44ff44','#4488ff','#ffaa00','#ff44ff','#44ffff','#ff8844','#88ff44','#aa44ff','#ffff44'];

export function groupSelected() {
  const sel = getSelectedItems();
  if (sel.length < 2) { toast('Select 2+ items to group'); return; }
  pushUndo();
  // Check if any item is already in a group — if so, add to existing group
  let existingGroup = null;
  for (const item of sel) {
    existingGroup = state.groups.find(g => g.memberIds.has(item.id));
    if (existingGroup) break;
  }
  if (existingGroup) {
    // Add all items to existing group
    sel.forEach(item => existingGroup.memberIds.add(item.id));
  } else {
    // Create new group
    const gid = G.nextGroupId++;
    const color = GROUP_COLORS[(gid - 1) % GROUP_COLORS.length];
    const borderEl = document.createElement('div');
    borderEl.className = 'group-border';
    borderEl.style.borderColor = color;
    canvasContent.appendChild(borderEl);
    const group = { id: gid, color, memberIds: new Set(sel.map(i => i.id)), borderEl };
    state.groups.push(group);
  }
  updateAllGroupBorders();
  scheduleAutoSave();
  toast('Grouped ' + sel.length + ' items');
}

export function ungroupSelected() {
  const sel = getSelectedItems();
  if (sel.length === 0) { toast('Select items to ungroup'); return; }
  pushUndo();
  const groupsToRemove = new Set();
  for (const item of sel) {
    const g = state.groups.find(g => g.memberIds.has(item.id));
    if (g) {
      g.memberIds.delete(item.id);
      if (g.memberIds.size < 2) groupsToRemove.add(g.id);
    }
  }
  // Remove groups with < 2 members
  state.groups = state.groups.filter(g => {
    if (groupsToRemove.has(g.id)) {
      g.borderEl.remove();
      return false;
    }
    return true;
  });
  updateAllGroupBorders();
  scheduleAutoSave();
  toast('Ungrouped');
}

export function getGroupForItem(id) {
  return state.groups.find(g => g.memberIds.has(id));
}

export function updateAllGroupBorders() {
  state.groups.forEach(g => updateGroupBorder(g));
}

export function updateGroupBorder(group) {
  const allItems = [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])];
  const members = allItems.filter(i => group.memberIds.has(i.id));
  if (members.length === 0) { group.borderEl.style.display = 'none'; return; }
  // Calculate bounding box of all member items
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const m of members) {
    const el = m.el;
    const r = el.getBoundingClientRect();
    // Convert screen coords to canvas coords
    const canvasRect = canvasContent.getBoundingClientRect();
    const sx = (r.left - canvasRect.left) / state.zoom;
    const sy = (r.top - canvasRect.top) / state.zoom;
    const sw = r.width / state.zoom;
    const sh = r.height / state.zoom;
    if (sx < minX) minX = sx;
    if (sy < minY) minY = sy;
    if (sx + sw > maxX) maxX = sx + sw;
    if (sy + sh > maxY) maxY = sy + sh;
  }
  const pad = 8;
  group.borderEl.style.display = 'block';
  group.borderEl.style.left = (minX - pad) + 'px';
  group.borderEl.style.top = (minY - pad) + 'px';
  group.borderEl.style.width = (maxX - minX + pad * 2) + 'px';
  group.borderEl.style.height = (maxY - minY + pad * 2) + 'px';
  group.borderEl.style.borderColor = group.color;
}

export function setGroupColor(color) {
  const sel = getSelectedItems();
  if (sel.length === 0) return;
  const g = state.groups.find(g => sel.some(i => g.memberIds.has(i.id)));
  if (!g) return;
  g.color = color;
  g.borderEl.style.borderColor = color;
  scheduleAutoSave();
}

// Move all group members when one is moved
export function moveGroupMembers(movedItem, dx, dy) {
  const group = getGroupForItem(movedItem.id);
  if (!group) return;
  const allItems = [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])];
  group.memberIds.forEach(mid => {
    if (mid === movedItem.id) return;
    const member = allItems.find(i => i.id === mid);
    if (member) {
      member.x += dx;
      member.y += dy;
      updateItemStyle(member);
    }
  });
  updateGroupBorder(group);
}

