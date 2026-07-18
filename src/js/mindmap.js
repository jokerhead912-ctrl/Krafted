import { getSelectedItems, selectOnly } from './selection.js';
import { translateText } from './translation.js';
import { state, G, canvasContent } from './core-state.js';
import { scheduleAutoSave } from './save-load.js';
import { toast } from './ui-utils.js';;
import { updateItemStyle } from './add-items.js';
import { pushUndo } from './undo-redo.js';

// ============================================================
//  MIND MAP — XMind-style brainstorm tool
// ============================================================
const MM_COLORS = ['#7c8cf0','#e74c3c','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e84393','#fdcb6e'];
let mmDragState = null; // { mm, node, startX, startY, origX, origY } for node drag
let mmConnectState = null; // { mm, fromId, svg, tempPath } for connector drag

export function addMindMap(x, y) {
  pushUndo();
  window.hideWelcome();
  const el = document.createElement('div');
  el.className = 'mindmap-item';
  canvasContent.appendChild(el);
  const cx = x !== undefined ? x : (window.innerWidth/2 - 200 - state.pan.x) / state.zoom;
  const cy = y !== undefined ? y : (window.innerHeight/2 - 150 - state.pan.y) / state.zoom;
  const mm = {
    id: G.nextId++, el,
    x: cx, y: cy, w: 560, h: 400, z: G.nextZ++,
    rot: 0, opacity: 1, locked: false,
    title: 'Brainstorm',
    nodes: [],
    connections: [],
    nextNodeId: 1,
    nextConnId: 1,
    selectedNodeId: null,
  };
  state.mindmaps = state.mindmaps || [];
  state.mindmaps.push(mm);
  // Create root node
  mmAddNode(mm, null, mm.w/2 - 60, 20);
  renderMindMap(mm);
  updateItemStyle(mm);
  selectOnly(mm.id);
  scheduleAutoSave();
  return mm;
}

export function mmAddNode(mm, parentId, x, y, text) {
  const isRoot = !parentId;
  const node = {
    id: 'mmn-' + mm.nextNodeId++,
    text: text || (isRoot ? 'Central Idea' : 'New Idea'),
    x: x !== undefined ? x : (mm.w/2 - 60 + (Math.random()-0.5)*100),
    y: y !== undefined ? y : (120 + Math.random()*80),
    w: isRoot ? 130 : 110,
    h: 36,
    color: isRoot ? MM_COLORS[0] : MM_COLORS[mm.nodes.length % MM_COLORS.length],
    textColor: '#ffffff',
    parentId: parentId || null,
    img: null,
    imgW: 0,
    imgH: 0,
    audio: null,
    audioName: null,
  };
  mm.nodes.push(node);
  if (parentId) {
    mm.connections.push({
      id: 'mmc-' + mm.nextConnId++,
      from: parentId,
      to: node.id,
      color: node.color,
    });
  }
  mm.selectedNodeId = node.id;
  return node;
}

export function renderMindMap(mm) {
  const el = mm.el;
  el.innerHTML = '';

  // Header — acts as a drag handle for the whole mind map (like a window title bar).
  // Buttons and the title input below have their own e.stopPropagation() so they
  // won't trigger the drag; clicks on empty header space bubble up and drag the
  // whole mind map.
  const header = document.createElement('div');
  header.className = 'mindmap-header';
  // (no stopPropagation here — let mousedown bubble up to the mind map drag handler)
  header.style.cursor = 'move';

  const titleInput = document.createElement('input');
  titleInput.className = 'mindmap-title';
  titleInput.type = 'text';
  titleInput.value = mm.title || '';
  titleInput.placeholder = 'Mind map title';
  titleInput.oninput = (e) => { mm.title = e.target.value; scheduleAutoSave(); };
  titleInput.onmousedown = (e) => e.stopPropagation();
  header.appendChild(titleInput);

  const addBtn = document.createElement('button');
  addBtn.className = 'mindmap-add-btn';
  addBtn.textContent = '+ Add Idea';
  addBtn.title = 'Add a new idea node connected to selected';
  addBtn.onmousedown = (e) => e.stopPropagation();
  addBtn.onclick = (e) => {
    e.stopPropagation();
    pushUndo();
    const parent = mm.selectedNodeId ? mm.nodes.find(n => n.id === mm.selectedNodeId) : mm.nodes[0];
    const parentNodeId = parent ? parent.id : null;
    const px = parent ? parent.x + parent.w/2 - 55 : mm.w/2 - 55;
    const py = parent ? parent.y + parent.h + 30 : 80;
    mmAddNode(mm, parentNodeId, px, py);
    renderMindMap(mm);
    scheduleAutoSave();
  };
  header.appendChild(addBtn);

  // Fit button — auto-resize to show all nodes
  const fitBtn = document.createElement('button');
  fitBtn.className = 'mm-fit-btn';
  fitBtn.textContent = 'Fit';
  fitBtn.title = 'Auto-resize to fit all ideas';
  fitBtn.onmousedown = (e) => e.stopPropagation();
  fitBtn.onclick = (e) => {
    e.stopPropagation();
    mmAutoFit(mm, true); // allowShrink=true for manual Fit button
    scheduleAutoSave();
  };
  header.appendChild(fitBtn);

  // Translate buttons — same translate function as text items
  const trEnBtn = document.createElement('button');
  trEnBtn.className = 'mm-translate-btn';
  trEnBtn.textContent = '中→EN';
  trEnBtn.title = 'Translate selected node to English';
  trEnBtn.onmousedown = (e) => e.stopPropagation();
  trEnBtn.onclick = (e) => { e.stopPropagation(); mmTranslateSelectedNode(mm, 'zh', 'en'); };
  header.appendChild(trEnBtn);

  const trZhBtn = document.createElement('button');
  trZhBtn.className = 'mm-translate-btn';
  trZhBtn.textContent = 'EN→中';
  trZhBtn.title = 'Translate selected node to 中文';
  trZhBtn.onmousedown = (e) => e.stopPropagation();
  trZhBtn.onclick = (e) => { e.stopPropagation(); mmTranslateSelectedNode(mm, 'en', 'zh'); };
  header.appendChild(trZhBtn);

  el.appendChild(header);

  // Canvas area
  const canvasDiv = document.createElement('div');
  canvasDiv.className = 'mindmap-canvas';

  // SVG layer for connectors
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('mm-svg-layer');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  // Arrow marker definition
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  mm.connections.forEach(c => {
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'arrow-' + c.id);
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('refX', '7');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M0,0 L8,3 L0,6 Z');
    path.setAttribute('fill', c.color || '#7c8cf0');
    marker.appendChild(path);
    defs.appendChild(marker);
  });
  svg.appendChild(defs);

  // Draw connection paths
  mm.connections.forEach(c => {
    const from = mm.nodes.find(n => n.id === c.from);
    const to = mm.nodes.find(n => n.id === c.to);
    if (!from || !to) return;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('data-conn-id', c.id);
    path.setAttribute('stroke', c.color || '#7c8cf0');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', 'url(#arrow-' + c.id + ')');
    path.style.pointerEvents = 'stroke';
    path.style.cursor = 'pointer';
    path.onclick = (e) => {
      e.stopPropagation();
      // Click on connector → delete it
      pushUndo();
      mm.connections = mm.connections.filter(x => x.id !== c.id);
      renderMindMap(mm);
      scheduleAutoSave();
    };
    svg.appendChild(path);
  });
  canvasDiv.appendChild(svg);

  // Draw nodes
  mm.nodes.forEach(node => {
    const nodeEl = document.createElement('div');
    nodeEl.className = 'mm-node';
    nodeEl.dataset.nodeId = node.id;
    nodeEl.style.background = node.color;
    nodeEl.style.color = node.textColor;
    nodeEl.style.left = node.x + 'px';
    nodeEl.style.top = node.y + 'px';
    nodeEl.style.minWidth = node.w + 'px';
    nodeEl.style.minHeight = node.h + 'px';
    if (mm.selectedNodeId === node.id) nodeEl.classList.add('mm-selected');

    // Image (if attached)
    if (node.img) {
      const imgEl = document.createElement('img');
      imgEl.className = 'mm-node-img';
      imgEl.src = node.img;
      imgEl.draggable = false;
      nodeEl.appendChild(imgEl);
      // Remove image button
      const rmBtn = document.createElement('div');
      rmBtn.className = 'mm-img-remove';
      rmBtn.innerHTML = '&times;';
      rmBtn.title = 'Remove image';
      rmBtn.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
      rmBtn.onclick = (e) => {
        e.stopPropagation();
        pushUndo();
        node.img = null; node.imgW = 0; node.imgH = 0;
        node.h = 36;
        renderMindMap(mm);
        mmAutoFit(mm);
        scheduleAutoSave();
      };
      nodeEl.appendChild(rmBtn);
    }

    // Audio player (if attached)
    if (node.audio) {
      const audioWrap = document.createElement('div');
      audioWrap.className = 'mm-audio-wrap';
      audioWrap.onmousedown = (e) => e.stopPropagation();

      const player = document.createElement('div');
      player.className = 'mm-audio-player';

      // Play/pause button
      const playBtn = document.createElement('button');
      playBtn.className = 'mm-audio-play';
      playBtn.innerHTML = '&#9658;';
      playBtn.title = 'Play / Pause';

      // Hidden audio element
      const audioEl = document.createElement('audio');
      audioEl.src = node.audio;
      audioEl.preload = 'metadata';

      // Seek bar
      const seekBar = document.createElement('div');
      seekBar.className = 'mm-audio-seek';
      const progress = document.createElement('div');
      progress.className = 'mm-audio-progress';
      seekBar.appendChild(progress);

      // Time label
      const timeLabel = document.createElement('span');
      timeLabel.className = 'mm-audio-time';
      timeLabel.textContent = '0:00';

      // Filename label
      const nameLabel = document.createElement('span');
      nameLabel.className = 'mm-audio-label';
      nameLabel.textContent = node.audioName || 'Audio';

      let isPlaying = false;
      playBtn.onclick = (e) => {
        e.stopPropagation();
        if (isPlaying) {
          audioEl.pause();
        } else {
          audioEl.play().catch(() => toast('Cannot play this audio format in browser'));
        }
      };
      audioEl.onplay = () => { isPlaying = true; playBtn.innerHTML = '&#10074;&#10074;'; };
      audioEl.onpause = () => { isPlaying = false; playBtn.innerHTML = '&#9658;'; };
      audioEl.onended = () => { isPlaying = false; playBtn.innerHTML = '&#9658;'; progress.style.width = '0%'; timeLabel.textContent = '0:00'; };
      audioEl.ontimeupdate = () => {
        if (audioEl.duration) {
          progress.style.width = (audioEl.currentTime / audioEl.duration * 100) + '%';
          const m = Math.floor(audioEl.currentTime / 60);
          const s = Math.floor(audioEl.currentTime % 60);
          timeLabel.textContent = m + ':' + String(s).padStart(2, '0');
        }
      };
      seekBar.onclick = (e) => {
        e.stopPropagation();
        if (audioEl.duration) {
          const rect = seekBar.getBoundingClientRect();
          audioEl.currentTime = ((e.clientX - rect.left) / rect.width) * audioEl.duration;
        }
      };

      player.appendChild(playBtn);
      player.appendChild(nameLabel);
      player.appendChild(seekBar);
      player.appendChild(timeLabel);
      // Volume control for mind-map audio
      const mmVolWrap = document.createElement('div');
      mmVolWrap.className = 'mm-audio-volume-wrap';
      const mmVolBtn = document.createElement('button');
      mmVolBtn.className = 'mm-audio-volume-btn';
      mmVolBtn.innerHTML = '&#128264;';
      mmVolBtn.title = 'Volume';
      const mmVolPop = document.createElement('div');
      mmVolPop.className = 'mm-audio-volume-popover';
      const mmVolSlider = document.createElement('input');
      mmVolSlider.type = 'range'; mmVolSlider.min = '0'; mmVolSlider.max = '1'; mmVolSlider.step = '0.01';
      mmVolSlider.value = String(audioEl.volume);
      mmVolSlider.className = 'mm-audio-volume-slider';
      mmVolSlider.title = 'Volume';
      mmVolSlider.addEventListener('input', function() {
        audioEl.volume = parseFloat(mmVolSlider.value);
        audioEl.muted = false;
        mmVolBtn.innerHTML = audioEl.volume === 0 ? '&#128263;' : '&#128264;';
      });
      mmVolBtn.addEventListener('click', function(ev) {
        ev.stopPropagation();
        if (audioEl.volume > 0) { audioEl.volume = 0; mmVolSlider.value = '0'; mmVolBtn.innerHTML = '&#128263;'; }
        else { audioEl.volume = 0.7; mmVolSlider.value = '0.7'; mmVolBtn.innerHTML = '&#128264;'; }
      });
      mmVolPop.appendChild(mmVolSlider);
      mmVolWrap.appendChild(mmVolBtn);
      mmVolWrap.appendChild(mmVolPop);
      player.appendChild(mmVolWrap);
      audioWrap.appendChild(player);
      nodeEl.appendChild(audioWrap);

      // Remove audio button
      const rmAudio = document.createElement('div');
      rmAudio.className = 'mm-audio-remove';
      rmAudio.innerHTML = '&times;';
      rmAudio.title = 'Remove audio';
      rmAudio.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
      rmAudio.onclick = (e) => {
        e.stopPropagation();
        pushUndo();
        node.audio = null; node.audioName = null;
        node.h = node.img ? Math.max(36, 24 + 24) : 36;
        renderMindMap(mm);
        mmAutoFit(mm);
        scheduleAutoSave();
      };
      nodeEl.appendChild(rmAudio);
    }

    // Text content
    const textEl = document.createElement('span');
    textEl.className = 'mm-node-text';
    textEl.textContent = node.text;
    nodeEl.appendChild(textEl);

    // Image upload button (always present, appears on hover)
    const imgBtn = document.createElement('div');
    imgBtn.className = 'mm-img-btn';
    imgBtn.innerHTML = '&#128247;';
    imgBtn.title = 'Attach image';
    imgBtn.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
    imgBtn.onclick = (e) => {
      e.stopPropagation();
      mmSelectNode(mm, node.id);
      // Trigger file input
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.style.display = 'none';
      fileInput.onchange = (ev) => {
        const file = ev.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (r) => {
          pushUndo();
          const tmpImg = new Image();
          tmpImg.onload = () => {
            node.img = r.target.result;
            node.imgW = tmpImg.naturalWidth;
            node.imgH = tmpImg.naturalHeight;
            // Adjust node height to fit image
            const imgDisplayH = Math.min(80, tmpImg.naturalHeight * (120 / Math.max(tmpImg.naturalWidth, 1)));
            node.h = Math.max(36, imgDisplayH + 24);
            renderMindMap(mm);
            mmAutoFit(mm);
            scheduleAutoSave();
          };
          tmpImg.src = r.target.result;
        };
        reader.readAsDataURL(file);
      };
      document.body.appendChild(fileInput);
      fileInput.click();
      document.body.removeChild(fileInput);
    };
    nodeEl.appendChild(imgBtn);

    // Audio upload button (always present, appears on hover)
    const audBtn = document.createElement('div');
    audBtn.className = 'mm-audio-btn';
    audBtn.innerHTML = '&#9835;';
    audBtn.title = 'Attach audio (MP3/WAV/AIFF)';
    audBtn.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
    audBtn.onclick = (e) => {
      e.stopPropagation();
      mmSelectNode(mm, node.id);
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'audio/*,.mp3,.wav,.aiff,.aif,.m4a,.ogg,.flac';
      fileInput.style.display = 'none';
      fileInput.onchange = (ev) => {
        const file = ev.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (r) => {
          pushUndo();
          node.audio = r.target.result;
          node.audioName = file.name.length > 20 ? file.name.substring(0, 17) + '...' : file.name;
          // Adjust node height to fit audio player
          const baseH = node.img ? Math.max(36, 24 + 24) : 36;
          node.h = baseH + 28;
          renderMindMap(mm);
          mmAutoFit(mm);
          scheduleAutoSave();
          toast('Audio attached: ' + file.name);
        };
        reader.readAsDataURL(file);
      };
      document.body.appendChild(fileInput);
      fileInput.click();
      document.body.removeChild(fileInput);
    };
    nodeEl.appendChild(audBtn);

    // Connect dot (for dragging connections)
    const dot = document.createElement('div');
    dot.className = 'mm-connect-dot';
    dot.title = 'Drag to connect';
    dot.onmousedown = (e) => {
      e.stopPropagation();
      e.preventDefault();
      mmStartConnect(mm, node.id, e, canvasDiv);
    };
    nodeEl.appendChild(dot);

    // Drag-and-drop image files onto node
    nodeEl.ondragover = (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        e.stopPropagation();
        nodeEl.style.outline = '2px dashed #fff';
      }
    };
    nodeEl.ondragleave = (e) => {
      nodeEl.style.outline = '';
    };
    nodeEl.ondrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      nodeEl.style.outline = '';
      const file = e.dataTransfer.files[0];
      if (!file) return;
      // Check if it's an audio file
      if (file.type.startsWith('audio/') || /\.(mp3|wav|aiff?|m4a|ogg|flac)$/i.test(file.name)) {
        const reader = new FileReader();
        reader.onload = (r) => {
          pushUndo();
          node.audio = r.target.result;
          node.audioName = file.name.length > 20 ? file.name.substring(0, 17) + '...' : file.name;
          const baseH = node.img ? Math.max(36, 24 + 24) : 36;
          node.h = baseH + 28;
          mmSelectNode(mm, node.id);
          renderMindMap(mm);
          mmAutoFit(mm);
          scheduleAutoSave();
          toast('Audio attached to: ' + (node.text || ''));
        };
        reader.readAsDataURL(file);
        return;
      }
      // Otherwise treat as image
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (r) => {
        pushUndo();
        const tmpImg = new Image();
        tmpImg.onload = () => {
          node.img = r.target.result;
          node.imgW = tmpImg.naturalWidth;
          node.imgH = tmpImg.naturalHeight;
          const imgDispH = Math.min(80, tmpImg.naturalHeight * (120 / Math.max(tmpImg.naturalWidth, 1)));
          node.h = Math.max(36, imgDispH + 24);
          mmSelectNode(mm, node.id);
          renderMindMap(mm);
          mmAutoFit(mm);
          scheduleAutoSave();
          toast('Image attached to: ' + (node.text || ''));
        };
        tmpImg.src = r.target.result;
      };
      reader.readAsDataURL(file);
    };

    // Node drag
    nodeEl.onmousedown = (e) => {
      if (nodeEl.classList.contains('mm-editing')) return;
      e.stopPropagation();
      e.preventDefault();
      mmSelectNode(mm, node.id);
      mmDragState = {
        mm, node, nodeEl, canvasDiv,
        startX: e.clientX, startY: e.clientY,
        origX: node.x, origY: node.y,
      };
    };

    // Double-click to edit
    nodeEl.ondblclick = (e) => {
      e.stopPropagation();
      mmEditNode(mm, node, nodeEl);
    };

    canvasDiv.appendChild(nodeEl);
  });

  // Double-click on empty canvas to add node
  canvasDiv.ondblclick = (e) => {
    if (e.target !== canvasDiv && !e.target.classList.contains('mm-svg-layer')) return;
    e.stopPropagation();
    pushUndo();
    const rect = canvasDiv.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / state.zoom - 55;
    const ny = (e.clientY - rect.top) / state.zoom - 18;
    const parent = mm.selectedNodeId ? mm.nodes.find(n => n.id === mm.selectedNodeId) : mm.nodes[0];
    mmAddNode(mm, parent ? parent.id : null, nx, ny);
    renderMindMap(mm);
    scheduleAutoSave();
  };

  el.appendChild(canvasDiv);

  // Color palette row
  const colorRow = document.createElement('div');
  colorRow.className = 'mm-color-row';
  colorRow.onmousedown = (e) => e.stopPropagation();
  const colorLabel = document.createElement('span');
  colorLabel.className = 'mm-color-label';
  colorLabel.textContent = 'Color:';
  colorRow.appendChild(colorLabel);
  MM_COLORS.forEach(color => {
    const dot = document.createElement('div');
    dot.className = 'mm-color-dot';
    dot.style.background = color;
    const selNode = mm.selectedNodeId ? mm.nodes.find(n => n.id === mm.selectedNodeId) : null;
    if (selNode && selNode.color === color) dot.classList.add('active');
    dot.onclick = (e) => {
      e.stopPropagation();
      if (!selNode) return;
      pushUndo();
      selNode.color = color;
      // Update connections from this node
      mm.connections.forEach(c => {
        if (c.from === selNode.id) c.color = color;
      });
      renderMindMap(mm);
      scheduleAutoSave();
    };
    dot.onmousedown = (e) => e.stopPropagation();
    colorRow.appendChild(dot);
  });
  // Delete node button
  const delBtn = document.createElement('button');
  delBtn.className = 'mm-del-btn';
  delBtn.textContent = 'Delete Node';
  delBtn.title = 'Delete selected idea node and its connections';
  delBtn.onmousedown = (e) => e.stopPropagation();
  delBtn.onclick = (e) => {
    e.stopPropagation();
    if (!mm.selectedNodeId) { toast('Select a node first'); return; }
    if (mm.nodes.length <= 1) { toast('Cannot delete the last node'); return; }
    pushUndo();
    mmDeleteNode(mm, mm.selectedNodeId);
    renderMindMap(mm);
    scheduleAutoSave();
  };
  colorRow.appendChild(delBtn);
  el.appendChild(colorRow);

  // Footer with counters
  const footer = document.createElement('div');
  footer.className = 'mm-footer';
  footer.onmousedown = (e) => e.stopPropagation();
  const countText = document.createElement('span');
  countText.textContent = mm.nodes.length + ' ideas \u00b7 ' + mm.connections.length + ' connections';
  footer.appendChild(countText);
  const hint = document.createElement('span');
  hint.textContent = 'Double-click to add \u00b7 Drag dot to connect \u00b7 \uD83D\uDCF7 image / \u266B audio on node \u00b7 Drop or paste';
  hint.style.opacity = '0.6';
  footer.appendChild(hint);
  el.appendChild(footer);

  // Auto-fit container to show all nodes, then update connectors
  mmAutoFit(mm);
}

export function mmUpdateConnectors(mm, canvasDiv) {
  if (!canvasDiv) canvasDiv = mm.el.querySelector('.mindmap-canvas');
  if (!canvasDiv) return;
  const svg = canvasDiv.querySelector('.mm-svg-layer');
  if (!svg) return;
  const paths = svg.querySelectorAll('path[data-conn-id]');
  paths.forEach(path => {
    const c = mm.connections.find(x => x.id === path.dataset.connId);
    if (!c) return;
    const from = mm.nodes.find(n => n.id === c.from);
    const to = mm.nodes.find(n => n.id === c.to);
    if (!from || !to) return;
    const fromEl = canvasDiv.querySelector('[data-node-id="' + from.id + '"]');
    const toEl = canvasDiv.querySelector('[data-node-id="' + to.id + '"]');
    if (!fromEl || !toEl) return;
    const fromR = fromEl.getBoundingClientRect();
    const toR = toEl.getBoundingClientRect();
    const canvasR = canvasDiv.getBoundingClientRect();
    const fx = (fromR.left + fromR.width/2 - canvasR.left) / state.zoom;
    const fy = (fromR.top + fromR.height/2 - canvasR.top) / state.zoom;
    const tx = (toR.left + toR.width/2 - canvasR.left) / state.zoom;
    const ty = (toR.top + toR.height/2 - canvasR.top) / state.zoom;
    // Calculate edge intersection points (from node borders)
    const dx = tx - fx, dy = ty - fy;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    // From node edge
    const fromHW = (fromR.width/2) / state.zoom;
    const fromHH = (fromR.height/2) / state.zoom;
    const fromT = Math.min(fromHW / Math.abs(ux || 0.001), fromHH / Math.abs(uy || 0.001));
    const toHW = (toR.width/2) / state.zoom;
    const toHH = (toR.height/2) / state.zoom;
    const toT = Math.min(toHW / Math.abs(ux || 0.001), toHH / Math.abs(uy || 0.001));
    const sx = fx + ux * fromT, sy = fy + uy * fromT;
    const ex = tx - ux * toT, ey = ty - uy * toT;
    // Curved path (bezier)
    const mx = (sx + ex) / 2;
    const pathD = 'M' + sx + ',' + sy + ' Q' + mx + ',' + sy + ' ' + ex + ',' + ey;
    path.setAttribute('d', pathD);
  });
}

export function mmAutoFit(mm, allowShrink) {
  if (!mm.nodes || mm.nodes.length === 0) return;
  // Calculate bounding box from node data
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  mm.nodes.forEach(n => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + (n.w || 110));
    maxY = Math.max(maxY, n.y + (n.h || 36));
  });
  const pad = 25;
  // Shift nodes so minimum position is (pad, pad)
  if (minX < pad || minY < pad) {
    const shiftX = minX < pad ? (pad - minX) : 0;
    const shiftY = minY < pad ? (pad - minY) : 0;
    mm.nodes.forEach(n => { n.x += shiftX; n.y += shiftY; });
    maxX += shiftX; maxY += shiftY;
  }
  // Calculate required size (header ~30px + color row ~26px + footer ~22px = 78px chrome)
  const chromeH = 78;
  const needW = Math.max(400, maxX + pad);
  const needH = Math.max(300, maxY + pad + chromeH);
  // Only grow by default; allow shrink when Fit button is clicked
  mm.w = allowShrink ? needW : Math.max(mm.w || 400, needW);
  mm.h = allowShrink ? needH : Math.max(mm.h || 300, needH);
  updateItemStyle(mm);
  // Update node DOM positions (in case they were shifted)
  mm.nodes.forEach(n => {
    const nodeEl = mm.el.querySelector('[data-node-id="' + n.id + '"]');
    if (nodeEl) {
      nodeEl.style.left = n.x + 'px';
      nodeEl.style.top = n.y + 'px';
    }
  });
  // Update connectors after layout settles
  requestAnimationFrame(() => mmUpdateConnectors(mm));
}

export function mmSelectNode(mm, nodeId) {
  mm.selectedNodeId = nodeId;
  mm.el.querySelectorAll('.mm-node').forEach(el => {
    el.classList.toggle('mm-selected', el.dataset.nodeId === nodeId);
  });
  // Update color palette active state
  const node = mm.nodes.find(n => n.id === nodeId);
  if (node) {
    mm.el.querySelectorAll('.mm-color-dot').forEach(dot => {
      dot.classList.toggle('active', dot.style.background === node.color || rgbToHex(dot.style.background) === node.color);
    });
  }
}

export function rgbToHex(rgb) {
  if (!rgb || rgb.startsWith('#')) return rgb;
  const m = rgb.match(/\d+/g);
  if (!m) return rgb;
  return '#' + m.slice(0,3).map(x => parseInt(x).toString(16).padStart(2,'0')).join('');
}

export function mmEditNode(mm, node, nodeEl) {
  // Find or create the text span
  let textEl = nodeEl.querySelector('.mm-node-text');
  if (!textEl) {
    textEl = document.createElement('span');
    textEl.className = 'mm-node-text';
    textEl.textContent = node.text;
    nodeEl.appendChild(textEl);
  }
  nodeEl.classList.add('mm-editing');
  textEl.contentEditable = true;
  textEl.spellcheck = false;
  textEl.focus();
  // Select all text in the text span
  const range = document.createRange();
  range.selectNodeContents(textEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  textEl.onblur = () => {
    nodeEl.classList.remove('mm-editing');
    textEl.contentEditable = false;
    node.text = textEl.textContent.trim() || 'Idea';
    textEl.textContent = node.text;
    scheduleAutoSave();
  };
  textEl.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); textEl.blur(); }
    if (e.key === 'Escape') { textEl.textContent = node.text; textEl.blur(); }
  };
  textEl.onmousedown = (e) => { e.stopPropagation(); };
}

export function mmDeleteNode(mm, nodeId) {
  mm.nodes = mm.nodes.filter(n => n.id !== nodeId);
  mm.connections = mm.connections.filter(c => c.from !== nodeId && c.to !== nodeId);
  if (mm.selectedNodeId === nodeId) {
    mm.selectedNodeId = mm.nodes.length > 0 ? mm.nodes[0].id : null;
  }
}

// Translate the selected mind-map node using the same translateText() API
// that the text items use. Reuses the translationCache to keep things fast.
export async function mmTranslateSelectedNode(mm, fromLang, toLang) {
  const node = mm.selectedNodeId ? mm.nodes.find(n => n.id === mm.selectedNodeId) : null;
  if (!node) { toast('Select a node first'); return; }
  const text = (node.text || '').trim();
  if (!text) { toast('Node is empty — nothing to translate'); return; }
  const sl = fromLang === 'zh' ? 'zh-CN' : fromLang;
  const tl = toLang === 'zh' ? 'zh-CN' : toLang;
  const cacheKey = sl + '|' + tl + '|' + text;
  const langLabel = toLang === 'zh' ? '中文' : 'English';
  // Try cache first for instant feedback
  if (typeof translationCache !== 'undefined' && translationCache.has(cacheKey)) {
    pushUndo();
    node.text = translationCache.get(cacheKey);
    renderMindMap(mm);
    scheduleAutoSave();
    toast('Translated to ' + langLabel);
    return;
  }
  toast('Translating…');
  try {
    const translated = await translateText(text, fromLang, toLang);
    if (translated && translated !== text) {
      pushUndo();
      node.text = translated;
      renderMindMap(mm);
      scheduleAutoSave();
      toast('Translated to ' + langLabel);
    } else {
      toast('Translation returned no change');
    }
  } catch (err) {
    console.warn('Mind-map translate failed:', err);
    toast('Translation failed — try again or use 🌐 in Text panel');
  }
}

export function mmStartConnect(mm, fromId, e, canvasDiv) {
  mmConnectState = { mm, fromId, canvasDiv };
  // Create temporary SVG for drawing
  let tempSvg = canvasDiv.querySelector('.mm-temp-line');
  if (!tempSvg) {
    tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    tempSvg.classList.add('mm-temp-line');
    tempSvg.setAttribute('width', '100%');
    tempSvg.setAttribute('height', '100%');
    canvasDiv.appendChild(tempSvg);
  }
  tempSvg.innerHTML = '';
  const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  tempPath.setAttribute('stroke', '#fff');
  tempPath.setAttribute('stroke-width', '2');
  tempPath.setAttribute('stroke-dasharray', '4,3');
  tempPath.setAttribute('fill', 'none');
  tempSvg.appendChild(tempPath);
  mmConnectState.tempSvg = tempSvg;
  mmConnectState.tempPath = tempPath;
  mmConnectState.canvasRect = canvasDiv.getBoundingClientRect();
}

// Global mousemove for node drag and connector draw
document.addEventListener('mousemove', (e) => {
  if (mmDragState) {
    const { mm, node, nodeEl, canvasDiv, startX, startY, origX, origY } = mmDragState;
    const dx = (e.clientX - startX) / state.zoom;
    const dy = (e.clientY - startY) / state.zoom;
    node.x = origX + dx;
    node.y = origY + dy;
    // Clamp minimum only — allow nodes to extend beyond current bounds (autoFit will grow container)
    node.x = Math.max(0, node.x);
    node.y = Math.max(0, node.y);
    nodeEl.style.left = node.x + 'px';
    nodeEl.style.top = node.y + 'px';
    mmUpdateConnectors(mm, canvasDiv);
    return;
  }
  if (mmConnectState) {
    const { mm, fromId, canvasDiv, tempPath, canvasRect } = mmConnectState;
    const from = mm.nodes.find(n => n.id === fromId);
    if (!from) return;
    const fromEl = canvasDiv.querySelector('[data-node-id="' + fromId + '"]');
    if (!fromEl) return;
    const fromR = fromEl.getBoundingClientRect();
    const fx = (fromR.left + fromR.width/2 - canvasRect.left) / state.zoom;
    const fy = (fromR.top + fromR.height/2 - canvasRect.top) / state.zoom;
    const tx = (e.clientX - canvasRect.left) / state.zoom;
    const ty = (e.clientY - canvasRect.top) / state.zoom;
    tempPath.setAttribute('d', 'M' + fx + ',' + fy + ' L' + tx + ',' + ty);
  }
});

// Global mouseup for node drag and connector drop
document.addEventListener('mouseup', (e) => {
  if (mmDragState) {
    const draggedMm = mmDragState.mm;
    mmDragState = null;
    mmAutoFit(draggedMm);
    scheduleAutoSave();
  }
  if (mmConnectState) {
    const { mm, fromId, canvasDiv, tempSvg } = mmConnectState;
    // Find target node under mouse
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const targetNodeEl = target ? target.closest('.mm-node') : null;
    if (targetNodeEl && targetNodeEl.dataset.nodeId) {
      const toId = targetNodeEl.dataset.nodeId;
      if (toId !== fromId) {
        // Check if connection already exists
        const exists = mm.connections.find(c => c.from === fromId && c.to === toId);
        if (!exists) {
          pushUndo();
          const from = mm.nodes.find(n => n.id === fromId);
          mm.connections.push({
            id: 'mmc-' + mm.nextConnId++,
            from: fromId,
            to: toId,
            color: from ? from.color : '#7c8cf0',
          });
          renderMindMap(mm);
          scheduleAutoSave();
        }
      }
    }
    if (tempSvg) tempSvg.innerHTML = '';
    mmConnectState = null;
  }
});

window.addMindMap = addMindMap;
