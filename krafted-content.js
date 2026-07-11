// ============================================================
//  TEXT TOOL
// ============================================================
function toggleTextStyle(style) {
  textTool[style] = !textTool[style];
  document.getElementById('ts-' + style.replace('highlight','highlight').replace('uppercase','upper')).classList.toggle('active', textTool[style]);
  applyTextStyleToSelected();
}
function setTextProp(prop, val) {
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
function setTextAlign(align) {
  textTool.align = align;
  ['l','c','r'].forEach(a => document.getElementById('ts-align-' + a).classList.toggle('active', align === {l:'left',c:'center',r:'right'}[a]));
  applyTextStyleToSelected();
}
function applyTextStyleToSelected() {
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
function showTextColorPicker(target) {
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
function initTextToolbar() {
  const grid = document.getElementById('text-color-grid');
  // Close on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('#ts-color-btn') && !e.target.closest('#ts-hlcolor-btn') && !e.target.closest('#text-color-grid')) {
      grid.style.display = 'none';
    }
  });
}

// ============================================================
//  TRANSLATE (EN ↔ ZH, multi-API with cache for instant repeat)
// ============================================================
const translationCache = new Map(); // "from|to|text" -> translation
async function translateSelectedText(fromLang, toLang) {
  // Support translating the currently-edited text item, or selected text items
  let sel;
  const focusedEl = document.activeElement;
  if (focusedEl && focusedEl.classList && focusedEl.classList.contains('text-item')) {
    const tx = state.texts.find(t => t.el === focusedEl);
    if (tx) sel = [tx];
  }
  if (!sel || sel.length === 0) {
    sel = getSelectedItems().filter(i => i.el && i.el.classList.contains('text-item'));
  }
  if (!sel || sel.length === 0) {
    // Last fallback: find the currently editing text item
    const editingTx = getEditingText();
    if (editingTx) sel = [editingTx];
  }
  if (sel.length === 0) { toast('Select or edit a text item first'); return; }

  // Show loading on all translate buttons (toolbar, quick-bar, props panel)
  const btns = document.querySelectorAll('#ts-translate, #tqb-translate, [onclick*="translateSelectedText"]');
  const origTexts = new Map();
  btns.forEach(b => { origTexts.set(b, b.textContent); b.textContent = '⏳'; b.disabled = true; });

  const langLabel = (toLang === 'zh' || toLang === 'zh-CN') ? '中文' : 'English';
  let translatedCount = 0;
  let skippedEmpty = 0;
  try {
    // Translate in parallel (faster when multiple items selected)
    await Promise.all(sel.map(async (tx) => {
      const originalText = tx.el.textContent;
      const text = originalText.trim();
      if (!text) { skippedEmpty++; return; }
      // Quick cache hit = instant
      const sl = fromLang === 'zh' ? 'zh-CN' : fromLang;
      const tl = toLang === 'zh' ? 'zh-CN' : toLang;
      const cacheKey = sl + '|' + tl + '|' + text;
      if (translationCache.has(cacheKey)) {
        pushUndo();
        tx.el.textContent = translationCache.get(cacheKey);
        autoGrowTextItem(tx);
        scheduleAutoSave();
        translatedCount++;
        return;
      }
      // Network call: dim the text as visual feedback
      const origColor = tx.el.style.color;
      tx.el.style.opacity = '0.5';
      try {
        const translated = await translateText(text, fromLang, toLang);
        if (translated && translated !== text) {
          pushUndo();
          tx.el.textContent = translated;
          autoGrowTextItem(tx);
          scheduleAutoSave();
          translatedCount++;
        }
      } catch (err) {
        console.warn('Translate failed for one item:', err.message);
      } finally {
        tx.el.style.opacity = '';
      }
    }));
    if (translatedCount > 0) {
      toast('Translated to ' + langLabel + ' (' + translatedCount + ')');
    } else if (skippedEmpty > 0) {
      toast('Text is empty — nothing to translate');
    } else {
      // All inline providers failed — open Google Translate in a new tab as a guaranteed fallback
      const allText = sel.map(t => t.el.textContent).filter(s => s && s.trim()).join('\n');
      if (allText) {
        const sl = fromLang === 'zh' ? 'zh-CN' : fromLang;
        const tl = toLang === 'zh' ? 'zh-CN' : toLang;
        openGoogleTranslate(allText, sl, tl);
        toast('Opened Google Translate in a new tab — copy result back');
      } else {
        toast('Text is empty — nothing to translate');
      }
    }
  } catch (err) {
    console.error('Translation error:', err);
    toast('Translation failed: ' + err.message);
  } finally {
    btns.forEach(b => { b.textContent = origTexts.get(b); b.disabled = false; });
  }
}

async function translateText(text, fromLang, toLang) {
  const sl = fromLang === 'zh' ? 'zh-CN' : fromLang;
  const tl = toLang === 'zh' ? 'zh-CN' : toLang;
  const cacheKey = sl + '|' + tl + '|' + text;

  // 1) Instant cache lookup (very fast for repeat translations)
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  // Split long text for providers with length limits
  const chunks = splitTextChunks(text, 500);
  let combined = '';

  // 2) Try a list of providers, JSONP first (works from file://) then fetch
  //    Each provider is given a 7s budget. We try fetch providers in parallel
  //    with JSONP ones so the fastest one wins.
  const jsonpProviders = [
    { name: 'MyMemory+JSONP', build: (chunk) => ({ url: 'https://jsonp.afeld.me/?callback=__mmcb&url=' + encodeURIComponent('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(chunk) + '&langpair=' + sl + '|' + tl), parse: parseMyMemory }) },
    { name: 'MyMemory direct', build: (chunk) => ({ url: 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(chunk) + '&langpair=' + sl + '|' + tl, parse: parseMyMemory }) },
  ];
  const fetchProviders = [
    { name: 'Lingva',   build: (chunk) => ({ url: 'https://lingva.ml/api/v1/' + sl + '/' + tl + '/' + encodeURIComponent(chunk), parse: parseLingva }) },
    { name: 'Google',   build: (chunk) => ({ url: 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' + sl + '&tl=' + tl + '&dt=t&q=' + encodeURIComponent(chunk), parse: parseGoogle }) },
  ];

  const fetchWithTimeout = (url, ms) => Promise.race([
    fetch(url, { method: 'GET' }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ]);

  // Try each provider (sequentially), translate all chunks with the first that works
  for (const p of jsonpProviders) {
    try {
      combined = '';
      for (const chunk of chunks) {
        const req = p.build(chunk);
        const data = await jsonpRequest(req.url, 7000);
        const part = req.parse(data);
        if (part) combined += part + ' ';
      }
      combined = combined.trim();
      if (combined) {
        translationCache.set(cacheKey, combined);
        return combined;
      }
    } catch (e) { console.warn('[' + p.name + ']', e.message); }
  }

  for (const p of fetchProviders) {
    try {
      combined = '';
      let ok = true;
      for (const chunk of chunks) {
        const req = p.build(chunk);
        const resp = await fetchWithTimeout(req.url, 6000);
        if (!resp.ok) { ok = false; break; }
        const data = await resp.json();
        const part = req.parse(data);
        if (!part) { ok = false; break; }
        combined += part + ' ';
      }
      if (ok && combined.trim()) {
        combined = combined.trim();
        translationCache.set(cacheKey, combined);
        return combined;
      }
    } catch (e) { console.warn('[' + p.name + ']', e.message); }
  }

  throw new Error('All providers failed');
}

// JSONP helper — works from file:// because <script src=...> is not CORS-restricted
function jsonpRequest(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cbName = '__mmcb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const cleanup = () => {
      try { delete window[cbName]; } catch(e) { window[cbName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('JSONP timeout')); }, timeoutMs);
    window[cbName] = function(data) { cleanup(); resolve(data); };
    const script = document.createElement('script');
    script.src = url.replace('__mmcb', cbName);
    script.onerror = () => { cleanup(); reject(new Error('JSONP load error')); };
    document.head.appendChild(script);
  });
}

function parseMyMemory(data) {
  if (data && data.responseData && data.responseData.translatedText) return data.responseData.translatedText;
  return '';
}
function parseLingva(data) {
  if (data && data.translation) return data.translation;
  return '';
}
function parseGoogle(data) {
  if (data && data[0] && Array.isArray(data[0])) {
    let r = '';
    for (const seg of data[0]) if (seg && seg[0]) r += seg[0];
    return r;
  }
  return '';
}

// Open Google Translate in a new tab with the text pre-filled (always works, even from file://)
function openGoogleTranslate(text, fromLang, toLang) {
  const sl = fromLang === 'zh' ? 'zh-CN' : fromLang;
  const tl = toLang === 'zh' ? 'zh-CN' : toLang;
  const url = 'https://translate.google.com/?sl=' + sl + '&tl=' + tl + '&text=' + encodeURIComponent(text) + '&op=translate';
  window.open(url, '_blank');
}

// Same as above but reads the text from the current selection / editing text item
function openInGoogleTranslate(fromLang, toLang) {
  let text = '';
  const focusedEl = document.activeElement;
  if (focusedEl && focusedEl.classList && focusedEl.classList.contains('text-item')) {
    text = focusedEl.textContent.trim();
  }
  if (!text) {
    const sel = getSelectedItems().filter(i => i.el && i.el.classList.contains('text-item'));
    if (sel.length) text = sel.map(t => t.el.textContent).join('\n').trim();
  }
  if (!text) {
    const editingTx = getEditingText();
    if (editingTx) text = editingTx.el.textContent.trim();
  }
  if (!text) { toast('Select or edit a text item first'); return; }
  openGoogleTranslate(text, fromLang, toLang);
  toast('Opened Google Translate — copy result back');
}

async function translateViaLingva(text, sl, tl) {
  // Legacy fetch fallback
  const url = 'https://lingva.ml/api/v1/' + sl + '/' + tl + '/' + encodeURIComponent(text);
  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return parseLingva(await resp.json());
}

async function translateViaMyMemory(text, sl, tl) {
  // Legacy fetch fallback
  const chunks = splitTextChunks(text, 500);
  let result = '';
  for (const chunk of chunks) {
    const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(chunk) + '&langpair=' + sl + '|' + tl;
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const part = parseMyMemory(await resp.json());
    if (!part) throw new Error('Empty response');
    result += part + ' ';
  }
  return result.trim();
}

async function translateViaGoogle(text, sl, tl) {
  // Legacy fetch fallback
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' + sl + '&tl=' + tl + '&dt=t&q=' + encodeURIComponent(text);
  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return parseGoogle(await resp.json());
}
function splitTextChunks(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    // Find a good break point (sentence end, then space)
    let breakAt = remaining.lastIndexOf('.', maxLen);
    if (breakAt < maxLen * 0.3) breakAt = remaining.lastIndexOf(' ', maxLen);
    if (breakAt < maxLen * 0.3) breakAt = maxLen;
    chunks.push(remaining.substring(0, breakAt + 1).trim());
    remaining = remaining.substring(breakAt + 1).trim();
  }
  return chunks;
}

// ============================================================
//  DRAWING
// ============================================================
function setDrawMode(mode) {
  drawTool.mode = mode;
  ['pen','arrow','box','eraser'].forEach(m => {
    const btn = document.getElementById('dm-' + m);
    if (btn) btn.classList.toggle('active', mode === m);
  });
}
function getDrawCtx() {
  const ctx = drawLayer.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
function redrawDrawLayer() {
  const ctx = getDrawCtx();
  ctx.clearRect(0, 0, drawLayer.width, drawLayer.height);
  drawStrokes.forEach(stroke => {
    if (stroke.points.length < 2) return;
    ctx.globalAlpha = stroke.opacity;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (stroke.mode === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      // Draw as freehand path
      ctx.beginPath();
      stroke.points.forEach((p, i) => {
        const sx = p[0] * state.zoom + state.pan.x;
        const sy = p[1] * state.zoom + state.pan.y;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
    } else if (stroke.mode === 'arrow') {
      ctx.globalCompositeOperation = 'source-over';
      const p0 = stroke.points[0], p1 = stroke.points[1];
      const sx0 = p0[0] * state.zoom + state.pan.x;
      const sy0 = p0[1] * state.zoom + state.pan.y;
      const sx1 = p1[0] * state.zoom + state.pan.x;
      const sy1 = p1[1] * state.zoom + state.pan.y;
      // Draw line
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.stroke();
      // Draw arrowhead
      const angle = Math.atan2(sy1 - sy0, sx1 - sx0);
      const headLen = stroke.arrowHead || drawTool.arrowHead || 15;
      const spread = Math.PI / 7; // ~25 degrees
      ctx.beginPath();
      ctx.moveTo(sx1, sy1);
      ctx.lineTo(sx1 - headLen * Math.cos(angle - spread), sy1 - headLen * Math.sin(angle - spread));
      ctx.lineTo(sx1 - headLen * Math.cos(angle + spread), sy1 - headLen * Math.sin(angle + spread));
      ctx.closePath();
      ctx.fill();
    } else if (stroke.mode === 'box') {
      ctx.globalCompositeOperation = 'source-over';
      const p0 = stroke.points[0], p1 = stroke.points[1];
      const sx0 = p0[0] * state.zoom + state.pan.x;
      const sy0 = p0[1] * state.zoom + state.pan.y;
      const sx1 = p1[0] * state.zoom + state.pan.x;
      const sy1 = p1[1] * state.zoom + state.pan.y;
      const bx = Math.min(sx0, sx1), by = Math.min(sy0, sy1);
      const bw = Math.abs(sx1 - sx0), bh = Math.abs(sy1 - sy0);
      ctx.strokeRect(bx, by, bw, bh);
    } else {
      // Pen: freehand path with optional per-point pressure (variable line width)
      ctx.globalCompositeOperation = 'source-over';
      const hasPressure = stroke.points[0] && stroke.points[0].length >= 3;
      if (hasPressure) {
        // Variable-width pen — draw each segment with its own line width
        for (let i = 1; i < stroke.points.length; i++) {
          const p0 = stroke.points[i - 1];
          const p1 = stroke.points[i];
          const sx0 = p0[0] * state.zoom + state.pan.x;
          const sy0 = p0[1] * state.zoom + state.pan.y;
          const sx1 = p1[0] * state.zoom + state.pan.x;
          const sy1 = p1[1] * state.zoom + state.pan.y;
          // Average pressure of segment endpoints
          const pr = ((p0[2] || 0.5) + (p1[2] || 0.5)) / 2;
          // Clamp pressure and map to lineWidth: 0.0 → 30% of size, 0.5 → 80%, 1.0 → 100%
          const w = stroke.size * (0.3 + 0.7 * Math.min(1, Math.max(0, pr)));
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(sx0, sy0);
          ctx.lineTo(sx1, sy1);
          ctx.stroke();
        }
      } else {
        // Constant width (mouse / no pressure)
        ctx.lineWidth = stroke.size;
        ctx.beginPath();
        stroke.points.forEach((p, i) => {
          const sx = p[0] * state.zoom + state.pan.x;
          const sy = p[1] * state.zoom + state.pan.y;
          if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        });
        ctx.stroke();
      }
    }
  });
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  // Draw hovered stroke highlight
  if (hoveredStroke && !currentStroke && !drawMoveState) {
    const hs = hoveredStroke;
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = (hs.size || 3) + 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([6, 4]);
    if (hs.mode === 'arrow' && hs.points.length >= 2) {
      const p0 = hs.points[0], p1 = hs.points[1];
      const sx0 = p0[0] * state.zoom + state.pan.x, sy0 = p0[1] * state.zoom + state.pan.y;
      const sx1 = p1[0] * state.zoom + state.pan.x, sy1 = p1[1] * state.zoom + state.pan.y;
      ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.lineTo(sx1, sy1); ctx.stroke();
    } else if (hs.mode === 'box' && hs.points.length >= 2) {
      const p0 = hs.points[0], p1 = hs.points[1];
      const sx0 = p0[0] * state.zoom + state.pan.x, sy0 = p0[1] * state.zoom + state.pan.y;
      const sx1 = p1[0] * state.zoom + state.pan.x, sy1 = p1[1] * state.zoom + state.pan.y;
      ctx.strokeRect(Math.min(sx0,sx1), Math.min(sy0,sy1), Math.abs(sx1-sx0), Math.abs(sy1-sy0));
    } else if (hs.mode === 'pen') {
      ctx.beginPath();
      hs.points.forEach((p, i) => {
        const sx = p[0] * state.zoom + state.pan.x, sy = p[1] * state.zoom + state.pan.y;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
}
function undoDraw() {
  if (drawStrokes.length === 0) return;
  const removed = drawStrokes.pop();
  // Remove associated draw item if exists
  if (removed.strokeId) {
    const drawItem = state.items.find(i => i.type === 'draw' && i.strokeId === removed.strokeId);
    if (drawItem) { drawItem.el.remove(); state.items = state.items.filter(i => i !== drawItem); }
  }
  redrawDrawLayer();
}
function clearDraw() {
  // Remove all associated draw items
  drawStrokes.forEach(s => {
    if (s.strokeId) {
      const drawItem = state.items.find(i => i.type === 'draw' && i.strokeId === s.strokeId);
      if (drawItem) { drawItem.el.remove(); state.items = state.items.filter(i => i !== drawItem); }
    }
  });
  drawStrokes = [];
  redrawDrawLayer();
}

// ============================================================
//  CREATE DRAW ITEM — convert stroke into selectable/grooupable item
// ============================================================
function createDrawItem(stroke) {
  // Compute bounding box from points
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  stroke.points.forEach(p => {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  });
  // Add padding based on stroke size + hit target needs
  const pad = Math.max(stroke.size * 1.5, 12);
  const x = minX - pad;
  const y = minY - pad;
  const w = Math.max(maxX - minX + pad * 2, 20);
  const h = Math.max(maxY - minY + pad * 2, 20);
  
  const el = document.createElement('div');
  el.className = 'item draw-item';
  el.style.cssText = 'background:transparent;border:none;pointer-events:auto;';
  canvasContent.appendChild(el);
  
  const item = {
    id: nextId++, el, type: 'draw',
    x, y, w, h, rot: 0, opacity: 1, flipH: false, flipV: false, locked: false,
    z: nextZ++,
    strokeId: stroke.strokeId,
    drawMode: stroke.mode,
    drawColor: stroke.color,
    drawSize: stroke.size,
    drawOpacity: stroke.opacity,
    drawArrowHead: stroke.arrowHead || 0,
  };
  state.items.push(item);
  updateItemStyle(item);
  return item;
}

// Helper: find stroke by strokeId
function findStrokeById(strokeId) {
  return drawStrokes.find(s => s.strokeId === strokeId) || null;
}

// Remove stroke by strokeId
function removeStrokeById(strokeId) {
  drawStrokes = drawStrokes.filter(s => s.strokeId !== strokeId);
}

// Update stroke points from draw item position changes
function syncStrokeFromDrawItem(item) {
  const stroke = findStrokeById(item.strokeId);
  if (!stroke) return;
  // Compute the original center vs new center delta
  const pad = Math.max(stroke.size * 1.5, 12);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  stroke.points.forEach(p => {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  });
  const oldCx = minX + (maxX - minX) / 2;
  const oldCy = minY + (maxY - minY) / 2;
  const newCx = item.x + item.w / 2;
  const newCy = item.y + item.h / 2;
  const dx = newCx - oldCx;
  const dy = newCy - oldCy;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
  stroke.points = stroke.points.map(p => [p[0] + dx, p[1] + dy]);
  // Update item's bbox to match
  item.x += dx; item.y += dy;
  redrawDrawLayer();
}

// ============================================================
//  DRAW STROKE HIT-TESTING & MOVE
// ============================================================
const HIT_THRESHOLD = 8; // pixels in screen space

function hitTestStrokes(wx, wy) {
  // Check all strokes, return the topmost one under cursor
  const sx = wx * state.zoom + state.pan.x;
  const sy = wy * state.zoom + state.pan.y;
  // Check in reverse order (topmost first)
  for (let i = drawStrokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    if (s.mode === 'eraser') continue;
    if (s.mode === 'pen' && s.points.length >= 2) {
      for (let j = 1; j < s.points.length; j++) {
        const p0 = s.points[j-1], p1 = s.points[j];
        const x0 = p0[0] * state.zoom + state.pan.x, y0 = p0[1] * state.zoom + state.pan.y;
        const x1 = p1[0] * state.zoom + state.pan.x, y1 = p1[1] * state.zoom + state.pan.y;
        if (distToSegment(sx, sy, x0, y0, x1, y1) < HIT_THRESHOLD + s.size / 2) return s;
      }
    } else if (s.mode === 'arrow' && s.points.length >= 2) {
      const p0 = s.points[0], p1 = s.points[1];
      const x0 = p0[0] * state.zoom + state.pan.x, y0 = p0[1] * state.zoom + state.pan.y;
      const x1 = p1[0] * state.zoom + state.pan.x, y1 = p1[1] * state.zoom + state.pan.y;
      if (distToSegment(sx, sy, x0, y0, x1, y1) < HIT_THRESHOLD + s.size / 2) return s;
      // Also check arrowhead
      const angle = Math.atan2(y1 - y0, x1 - x0);
      const headLen = s.arrowHead || 15;
      const spread = Math.PI / 7;
      const ax1 = x1 - headLen * Math.cos(angle - spread), ay1 = y1 - headLen * Math.sin(angle - spread);
      const ax2 = x1 - headLen * Math.cos(angle + spread), ay2 = y1 - headLen * Math.sin(angle + spread);
      if (distToSegment(sx, sy, x1, y1, ax1, ay1) < HIT_THRESHOLD + s.size / 2) return s;
      if (distToSegment(sx, sy, x1, y1, ax2, ay2) < HIT_THRESHOLD + s.size / 2) return s;
    } else if (s.mode === 'box' && s.points.length >= 2) {
      const p0 = s.points[0], p1 = s.points[1];
      const x0 = p0[0] * state.zoom + state.pan.x, y0 = p0[1] * state.zoom + state.pan.y;
      const x1 = p1[0] * state.zoom + state.pan.x, y1 = p1[1] * state.zoom + state.pan.y;
      const bx = Math.min(x0,x1), by = Math.min(y0,y1), bw = Math.abs(x1-x0), bh = Math.abs(y1-y0);
      // Check all 4 edges
      if (distToSegment(sx, sy, bx, by, bx+bw, by) < HIT_THRESHOLD + s.size/2) return s;
      if (distToSegment(sx, sy, bx+bw, by, bx+bw, by+bh) < HIT_THRESHOLD + s.size/2) return s;
      if (distToSegment(sx, sy, bx+bw, by+bh, bx, by+bh) < HIT_THRESHOLD + s.size/2) return s;
      if (distToSegment(sx, sy, bx, by+bh, bx, by) < HIT_THRESHOLD + s.size/2) return s;
    }
  }
  return null;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function moveStroke(stroke, dx, dy) {
  stroke.points = stroke.points.map(p => [p[0] + dx, p[1] + dy]);
}
// ============================================================
//  FREE SHAPE CUT — draw a freehand path on an image, extract
// ============================================================
let cutState = null; // { itemId, points: [], isDragging, closed }
const cutOverlay = document.getElementById('cut-overlay');
const cutSvg = document.getElementById('cut-svg');
const cutPathEl = document.getElementById('cut-path');
const cutFillPathEl = document.getElementById('cut-fill-path');
const cutPanel = document.getElementById('cut-panel');
const cutTargetHighlight = document.getElementById('cut-target-highlight');
const cutPreviewMask = document.getElementById('cut-preview-mask');
const cutExtractBtn = document.getElementById('cut-extract-btn');
const cutRedrawBtn = document.getElementById('cut-redraw-btn');
const cutHint = document.getElementById('cut-hint');

function enterCutMode(item) {
  cancelCut();
  cutState = { itemId: item.id, points: [], isDragging: false, closed: false };
  cutOverlay.classList.add('active');
  cutPanel.classList.add('active');
  cutExtractBtn.style.display = 'none';
  cutRedrawBtn.style.display = 'none';
  cutHint.textContent = 'Draw on image to cut';
  updateCutTargetHighlight();
}

function updateCutTargetHighlight() {
  if (!cutState) { cutTargetHighlight.classList.remove('active'); return; }
  const item = state.items.find(i => i.id === cutState.itemId);
  if (!item) { cutTargetHighlight.classList.remove('active'); return; }
  const r = item.el.getBoundingClientRect();
  cutTargetHighlight.classList.add('active');
  cutTargetHighlight.style.left = (r.left - 2) + 'px';
  cutTargetHighlight.style.top = (r.top - 2) + 'px';
  cutTargetHighlight.style.width = (r.width + 4) + 'px';
  cutTargetHighlight.style.height = (r.height + 4) + 'px';
}

function getCutItem() {
  if (!cutState) return null;
  return state.items.find(i => i.id === cutState.itemId);
}

function cancelCut() {
  cutState = null;
  cutOverlay.classList.remove('active');
  cutPanel.classList.remove('active');
  cutTargetHighlight.classList.remove('active');
  cutPreviewMask.classList.remove('active');
  cutPathEl.setAttribute('d', '');
  cutFillPathEl.setAttribute('d', '');
  cutExtractBtn.style.display = 'none';
  cutRedrawBtn.style.display = 'none';
}

function clearCutPath() {
  if (!cutState) return;
  cutState.points = [];
  cutState.closed = false;
  cutPathEl.setAttribute('d', '');
  cutPathEl.classList.remove('closed');
  cutFillPathEl.setAttribute('d', '');
  cutPreviewMask.classList.remove('active');
  cutExtractBtn.style.display = 'none';
  cutRedrawBtn.style.display = 'none';
  cutHint.textContent = 'Draw on image to cut';
}

// Start drawing path on the image
function startCutDraw(clientX, clientY) {
  if (!cutState) return;
  cutState.points = [{ x: clientX, y: clientY }];
  cutState.isDragging = true;
  cutState.closed = false;
  cutPathEl.setAttribute('d', 'M ' + clientX + ' ' + clientY);
  cutPathEl.classList.remove('closed');
  cutFillPathEl.setAttribute('d', '');
  cutPreviewMask.classList.remove('active');
  cutExtractBtn.style.display = 'none';
  cutRedrawBtn.style.display = 'none';
}

// Update path while dragging
function updateCutDraw(clientX, clientY) {
  if (!cutState || !cutState.isDragging) return;
  const pts = cutState.points;
  const last = pts[pts.length - 1];
  // Only add point if moved enough (reduce point count for performance)
  const dx = clientX - last.x, dy = clientY - last.y;
  if (dx * dx + dy * dy < 4) return;
  pts.push({ x: clientX, y: clientY });
  // Build SVG path — smooth via simple line-to for real-time
  let d = 'M ' + pts[0].x + ' ' + pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    d += ' L ' + pts[i].x + ' ' + pts[i].y;
  }
  cutPathEl.setAttribute('d', d);
}

// Finish drawing path — close it
function endCutDraw() {
  if (!cutState || !cutState.isDragging) return;
  cutState.isDragging = false;
  if (cutState.points.length < 3) {
    // Too few points — reset
    clearCutPath();
    return;
  }
  cutState.closed = true;
  // Close the path visually
  let d = 'M ' + cutState.points[0].x + ' ' + cutState.points[0].y;
  for (let i = 1; i < cutState.points.length; i++) {
    d += ' L ' + cutState.points[i].x + ' ' + cutState.points[i].y;
  }
  d += ' Z';
  cutPathEl.setAttribute('d', d);
  cutPathEl.classList.add('closed');
  cutFillPathEl.setAttribute('d', d);
  // Show extract + redraw buttons
  cutExtractBtn.style.display = '';
  cutRedrawBtn.style.display = '';
  cutHint.textContent = 'Extract or redraw';
}

// Extract the area inside the freehand path as a new image item
function applyCutExtract() {
  const item = getCutItem();
  if (!item || !cutState || !cutState.closed || cutState.points.length < 3) return;
  const imgEl = item.el.querySelector('img');
  if (!imgEl || !imgEl.complete) { toast('Image not loaded'); return; }
  const imgW = imgEl.naturalWidth || item.natW;
  const imgH = imgEl.naturalHeight || item.natH;
  const r = item.el.getBoundingClientRect();
  // Convert screen points to image pixel coordinates
  const imgPoints = cutState.points.map(p => ({
    x: ((p.x - r.left) / r.width) * imgW,
    y: ((p.y - r.top) / r.height) * imgH
  }));
  try {
    // Create full-resolution canvas
    const cv = document.createElement('canvas');
    cv.width = imgW; cv.height = imgH;
    const ctx = cv.getContext('2d');
    // Draw the path and clip
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(imgPoints[0].x, imgPoints[0].y);
    for (let i = 1; i < imgPoints.length; i++) {
      ctx.lineTo(imgPoints[i].x, imgPoints[i].y);
    }
    ctx.closePath();
    ctx.clip();
    // Draw the image clipped to the path
    ctx.drawImage(imgEl, 0, 0, imgW, imgH);
    ctx.restore();
    const dataURL = cv.toDataURL('image/png');
    const newItem = addImage(dataURL, imgW, imgH, item.x + item.w + 20 / state.zoom, item.y);
    toast('Cut shape extracted');
    // Reset for next cut
    clearCutPath();
  } catch (e) {
    toast('Cannot cut this image (cross-origin)');
  }
}

// ============================================================
//  LASSO — click points to define polygon, extract with border
// ============================================================
let lassoState = null; // { itemId, points: [{x,y}], closed }
const lassoOverlay = document.getElementById('lasso-overlay');
const lassoSvg = document.getElementById('lasso-svg');
const lassoPathEl = document.getElementById('lasso-path');
const lassoFillPathEl = document.getElementById('lasso-fill-path');
const lassoPanel = document.getElementById('lasso-panel');
const lassoTargetHighlight = document.getElementById('lasso-target-highlight');
const lassoHint = document.getElementById('lasso-hint');
const lassoExtractBtn = document.getElementById('lasso-extract-btn');
const lassoCloseBtn = document.getElementById('lasso-close-btn');
const lassoUndoBtn = document.getElementById('lasso-undo-btn');
let lassoPointEls = []; // DOM elements for point markers

function enterLassoMode(item) {
  cancelLasso();
  lassoState = { itemId: item.id, points: [], closed: false };
  lassoOverlay.classList.add('active');
  lassoPanel.classList.add('active');
  lassoExtractBtn.style.display = 'none';
  lassoCloseBtn.style.display = 'none';
  lassoUndoBtn.style.display = 'none';
  lassoHint.textContent = 'Click points on image to define cut area';
  updateLassoTargetHighlight();
}

function updateLassoTargetHighlight() {
  if (!lassoState) { lassoTargetHighlight.classList.remove('active'); return; }
  const item = state.items.find(i => i.id === lassoState.itemId);
  if (!item) { lassoTargetHighlight.classList.remove('active'); return; }
  const r = item.el.getBoundingClientRect();
  lassoTargetHighlight.classList.add('active');
  lassoTargetHighlight.style.left = (r.left - 2) + 'px';
  lassoTargetHighlight.style.top = (r.top - 2) + 'px';
  lassoTargetHighlight.style.width = (r.width + 4) + 'px';
  lassoTargetHighlight.style.height = (r.height + 4) + 'px';
}

function getLassoItem() {
  if (!lassoState) return null;
  return state.items.find(i => i.id === lassoState.itemId);
}

function cancelLasso() {
  lassoState = null;
  lassoOverlay.classList.remove('active');
  lassoPanel.classList.remove('active');
  lassoTargetHighlight.classList.remove('active');
  lassoPathEl.setAttribute('d', '');
  lassoFillPathEl.setAttribute('d', '');
  lassoExtractBtn.style.display = 'none';
  lassoCloseBtn.style.display = 'none';
  lassoUndoBtn.style.display = 'none';
  clearLassoPoints();
}

function clearLassoPoints() {
  lassoPointEls.forEach(el => el.remove());
  lassoPointEls = [];
}

function addLassoPoint(clientX, clientY) {
  if (!lassoState || lassoState.closed) return;
  // Check if clicking near first point to close
  if (lassoState.points.length >= 3) {
    const first = lassoState.points[0];
    const dx = clientX - first.x, dy = clientY - first.y;
    if (dx * dx + dy * dy < 196) { // within 14px
      closeLasso();
      return;
    }
  }
  lassoState.points.push({ x: clientX, y: clientY });
  renderLassoPath();
  renderLassoPoints();
  lassoUndoBtn.style.display = '';
  if (lassoState.points.length >= 3) {
    lassoCloseBtn.style.display = '';
  }
  lassoHint.textContent = lassoState.points.length + ' points — click to add, click first point to close';
}

function undoLassoPoint() {
  if (!lassoState || lassoState.closed || lassoState.points.length === 0) return;
  lassoState.points.pop();
  renderLassoPath();
  renderLassoPoints();
  if (lassoState.points.length < 3) lassoCloseBtn.style.display = 'none';
  if (lassoState.points.length === 0) lassoUndoBtn.style.display = 'none';
  lassoHint.textContent = lassoState.points.length + ' points — click to add';
}

function closeLasso() {
  if (!lassoState || lassoState.points.length < 3) return;
  lassoState.closed = true;
  renderLassoPath();
  renderLassoPoints();
  lassoCloseBtn.style.display = 'none';
  lassoExtractBtn.style.display = '';
  lassoHint.textContent = 'Extract or undo points';
}

function renderLassoPath() {
  if (!lassoState || lassoState.points.length === 0) {
    lassoPathEl.setAttribute('d', '');
    lassoFillPathEl.setAttribute('d', '');
    return;
  }
  const pts = lassoState.points;
  let d = 'M ' + pts[0].x + ' ' + pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    d += ' L ' + pts[i].x + ' ' + pts[i].y;
  }
  if (lassoState.closed) {
    d += ' Z';
    lassoFillPathEl.setAttribute('d', d);
  } else {
    lassoFillPathEl.setAttribute('d', '');
  }
  lassoPathEl.setAttribute('d', d);
}

function renderLassoPoints() {
  clearLassoPoints();
  if (!lassoState) return;
  lassoState.points.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'lasso-point' + (i === 0 ? ' first-point' : '');
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    if (i === 0 && lassoState.points.length >= 3 && !lassoState.closed) {
      el.onclick = (e) => { e.stopPropagation(); closeLasso(); };
    }
    document.body.appendChild(el);
    lassoPointEls.push(el);
  });
}

function applyLassoExtract() {
  const item = getLassoItem();
  if (!item || !lassoState || !lassoState.closed || lassoState.points.length < 3) return;
  const imgEl = item.el.querySelector('img');
  if (!imgEl || !imgEl.complete) { toast('Image not loaded'); return; }
  const imgW = imgEl.naturalWidth || item.natW;
  const imgH = imgEl.naturalHeight || item.natH;
  const r = item.el.getBoundingClientRect();
  const withBorder = document.getElementById('lasso-border-toggle').checked;
  const borderColor = document.getElementById('lasso-border-color').value;
  // Convert screen points to image pixel coordinates
  const imgPoints = lassoState.points.map(p => ({
    x: ((p.x - r.left) / r.width) * imgW,
    y: ((p.y - r.top) / r.height) * imgH
  }));
  try {
    const cv = document.createElement('canvas');
    cv.width = imgW; cv.height = imgH;
    const ctx = cv.getContext('2d');
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(imgPoints[0].x, imgPoints[0].y);
    for (let i = 1; i < imgPoints.length; i++) {
      ctx.lineTo(imgPoints[i].x, imgPoints[i].y);
    }
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(imgEl, 0, 0, imgW, imgH);
    ctx.restore();
    // Draw border on top (outside clip)
    if (withBorder) {
      ctx.beginPath();
      ctx.moveTo(imgPoints[0].x, imgPoints[0].y);
      for (let i = 1; i < imgPoints.length; i++) {
        ctx.lineTo(imgPoints[i].x, imgPoints[i].y);
      }
      ctx.closePath();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = Math.max(2, Math.round(imgW * 0.005));
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    const dataURL = cv.toDataURL('image/png');
    const newItem = addImage(dataURL, imgW, imgH, item.x + item.w + 20 / state.zoom, item.y);
    toast('Lasso extracted' + (withBorder ? ' with border' : ''));
    cancelLasso();
    setTool('select');
  } catch (e) {
    toast('Cannot cut this image (cross-origin)');
  }
}

// ============================================================
//  TO-DO LIST ITEMS
// ============================================================
function addTodo(x, y) {
  pushUndo();
  const el = document.createElement('div');
  el.className = 'todo-item';
  canvasContent.appendChild(el);
  const todo = {
    id: nextId++, el,
    x: x !== undefined ? x : (window.innerWidth/2 - 120 - state.pan.x) / state.zoom,
    y: y !== undefined ? y : (window.innerHeight/2 - 80 - state.pan.y) / state.zoom,
    w: 260, h: 120, z: nextZ++, rot: 0, opacity: 1,
    locked: false,
    title: 'Checklist',
    items: [{ text: '', done: false }],
  };
  state.todos = state.todos || [];
  state.todos.push(todo);
  renderTodo(todo);
  updateItemStyle(todo);
  selectOnly(todo.id);
  scheduleAutoSave();
  return todo;
}

function renderTodo(todo) {
  const el = todo.el;
  el.innerHTML = '';
  // Header
  const header = document.createElement('div');
  header.className = 'todo-header';
  const titleInput = document.createElement('input');
  titleInput.className = 'todo-title';
  titleInput.type = 'text';
  titleInput.value = todo.title || '';
  titleInput.placeholder = 'Checklist title';
  titleInput.oninput = (e) => { todo.title = e.target.value; scheduleAutoSave(); };
  titleInput.onmousedown = (e) => e.stopPropagation();
  const addBtn = document.createElement('button');
  addBtn.className = 'todo-add-btn';
  addBtn.textContent = '+ Add';
  addBtn.onmousedown = (e) => e.stopPropagation();
  addBtn.onclick = (e) => {
    e.stopPropagation();
    pushUndo();
    todo.items.push({ text: '', done: false });
    renderTodoList(todo);
    scheduleAutoSave();
    // Focus the new item
    requestAnimationFrame(() => {
      const inputs = todo.el.querySelectorAll('.todo-text');
      if (inputs.length > 0) inputs[inputs.length - 1].focus();
    });
  };
  header.appendChild(titleInput);
  header.appendChild(addBtn);
  el.appendChild(header);
  // List
  const list = document.createElement('div');
  list.className = 'todo-list';
  el.appendChild(list);
  renderTodoList(todo);
  // Make draggable
  el.addEventListener('mousedown', (e) => {
    if (e.target.closest('.todo-text') || e.target.closest('.todo-title') || e.target.closest('.todo-check') || e.target.closest('.todo-del') || e.target.closest('.todo-add-btn') || e.target.closest('.item-handle') || e.target.closest('.item-rot')) return;
    if (todo.locked) return;
    e.preventDefault();
    e.stopPropagation();
    // Select the todo item
    if (e.shiftKey) { toggleSelect(todo.id); } else { selectOnly(todo.id); }
    pushUndo();
    const startX = e.clientX, startY = e.clientY;
    const origX = todo.x, origY = todo.y;
    const onMove = (ev) => {
      todo.x = origX + (ev.clientX - startX) / state.zoom;
      todo.y = origY + (ev.clientY - startY) / state.zoom;
      updateItemStyle(todo);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      scheduleAutoSave();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function renderTodoList(todo) {
  const list = todo.el.querySelector('.todo-list');
  if (!list) return;
  list.innerHTML = '';
  let doneCount = 0;
  todo.items.forEach((item, idx) => {
    if (item.done) doneCount++;
    const row = document.createElement('div');
    row.className = 'todo-row';
    // Checkbox
    const check = document.createElement('div');
    check.className = 'todo-check' + (item.done ? ' checked' : '');
    check.onmousedown = (e) => e.stopPropagation();
    check.onclick = (e) => {
      e.stopPropagation();
      item.done = !item.done;
      renderTodoList(todo);
      scheduleAutoSave();
    };
    // Text input
    const textInput = document.createElement('input');
    textInput.className = 'todo-text' + (item.done ? ' done' : '');
    textInput.type = 'text';
    textInput.value = item.text || '';
    textInput.placeholder = 'Type a task...';
    textInput.oninput = (e) => { item.text = e.target.value; scheduleAutoSave(); };
    textInput.onmousedown = (e) => e.stopPropagation();
    textInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        pushUndo();
        todo.items.splice(idx + 1, 0, { text: '', done: false });
        renderTodoList(todo);
        scheduleAutoSave();
        requestAnimationFrame(() => {
          const inputs = todo.el.querySelectorAll('.todo-text');
          if (inputs[idx + 1]) inputs[idx + 1].focus();
        });
      }
      if (e.key === 'Backspace' && !item.text && todo.items.length > 1) {
        e.preventDefault();
        e.stopPropagation();
        pushUndo();
        todo.items.splice(idx, 1);
        renderTodoList(todo);
        scheduleAutoSave();
        requestAnimationFrame(() => {
          const inputs = todo.el.querySelectorAll('.todo-text');
          if (inputs[idx - 1]) inputs[idx - 1].focus();
        });
      }
    };
    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'todo-del';
    delBtn.textContent = '\u00d7';
    delBtn.onmousedown = (e) => e.stopPropagation();
    delBtn.onclick = (e) => {
      e.stopPropagation();
      if (todo.items.length <= 1) return;
      pushUndo();
      todo.items.splice(idx, 1);
      renderTodoList(todo);
      scheduleAutoSave();
    };
    row.appendChild(check);
    row.appendChild(textInput);
    row.appendChild(delBtn);
    list.appendChild(row);
  });
  // Progress
  const progress = document.createElement('div');
  progress.className = 'todo-progress';
  progress.textContent = doneCount + '/' + todo.items.length + ' done';
  list.appendChild(progress);
  // Auto-measure actual height for handles, canvas export, etc.
  requestAnimationFrame(() => {
    const h = todo.el.offsetHeight;
    if (h && h !== todo.h) { todo.h = h; }
  });
}

// ============================================================
//  MIND MAP — XMind-style brainstorm tool
// ============================================================
const MM_COLORS = ['#7c8cf0','#e74c3c','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e84393','#fdcb6e'];
let mmDragState = null; // { mm, node, startX, startY, origX, origY } for node drag
let mmConnectState = null; // { mm, fromId, svg, tempPath } for connector drag

function addMindMap(x, y) {
  pushUndo();
  hideWelcome();
  const el = document.createElement('div');
  el.className = 'mindmap-item';
  canvasContent.appendChild(el);
  const cx = x !== undefined ? x : (window.innerWidth/2 - 200 - state.pan.x) / state.zoom;
  const cy = y !== undefined ? y : (window.innerHeight/2 - 150 - state.pan.y) / state.zoom;
  const mm = {
    id: nextId++, el,
    x: cx, y: cy, w: 560, h: 400, z: nextZ++,
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

function mmAddNode(mm, parentId, x, y, text) {
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

function renderMindMap(mm) {
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

function mmUpdateConnectors(mm, canvasDiv) {
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

function mmAutoFit(mm, allowShrink) {
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

function mmSelectNode(mm, nodeId) {
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

function rgbToHex(rgb) {
  if (!rgb || rgb.startsWith('#')) return rgb;
  const m = rgb.match(/\d+/g);
  if (!m) return rgb;
  return '#' + m.slice(0,3).map(x => parseInt(x).toString(16).padStart(2,'0')).join('');
}

function mmEditNode(mm, node, nodeEl) {
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

function mmDeleteNode(mm, nodeId) {
  mm.nodes = mm.nodes.filter(n => n.id !== nodeId);
  mm.connections = mm.connections.filter(c => c.from !== nodeId && c.to !== nodeId);
  if (mm.selectedNodeId === nodeId) {
    mm.selectedNodeId = mm.nodes.length > 0 ? mm.nodes[0].id : null;
  }
}

// Translate the selected mind-map node using the same translateText() API
// that the text items use. Reuses the translationCache to keep things fast.
async function mmTranslateSelectedNode(mm, fromLang, toLang) {
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

function mmStartConnect(mm, fromId, e, canvasDiv) {
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

// ============================================================
//  TEXT INLINE SIZE & COLOR (while editing)
// ============================================================
function getEditingText() {
  const editingEl = document.querySelector('.text-item.editing') || (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('text-item') ? document.activeElement : null);
  if (editingEl) return state.texts.find(t => t.el === editingEl);
  return null;
}

function applyInlineSize(px) {
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
function _setSizeSelectValue(el, val) {
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
const TQB_PRESETS = [8, 10, 12, 16, 20, 24, 32, 48, 64, 80, 96];
function updateTextSizeActive(px) {
  document.querySelectorAll('.tqb-size').forEach(b => {
    b.classList.toggle('active', b.textContent === String(px));
  });
}
// Step the current text size up/down through the preset list.
function stepTextSize(dir) {
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

function applyInlineColor(color) {
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

function showTextQuickBar(show) {
  document.getElementById('text-quick-bar').classList.toggle('active', show);
}

function updateTextQuickBarActive() {
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
function updateTextColorPalette() {
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

function applyTextColorToSelected(hexColor) {
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

// ============================================================
//  EXPORT PNG
// ============================================================
function startExportDrag() {
  exportDrag = { startX: 0, startY: 0 };
  exportBox.style.display = 'block';
  exportBox.style.left = '0px'; exportBox.style.top = '0px';
  exportBox.style.width = '0px'; exportBox.style.height = '0px';
}
function updateExport(e) {
  if (!exportDrag) return;
  const x1 = Math.min(exportDrag.startX, e.clientX);
  const y1 = Math.min(exportDrag.startY, e.clientY);
  const w = Math.abs(e.clientX - exportDrag.startX);
  const h = Math.abs(e.clientY - exportDrag.startY);
  exportBox.style.left = x1 + 'px';
  exportBox.style.top = y1 + 'px';
  exportBox.style.width = w + 'px';
  exportBox.style.height = h + 'px';
}
function finishExport(e) {
  if (!exportDrag) return;
  const x1 = Math.min(exportDrag.startX, e.clientX);
  const y1 = Math.min(exportDrag.startY, e.clientY);
  const w = Math.abs(e.clientX - exportDrag.startX);
  const h = Math.abs(e.clientY - exportDrag.startY);
  exportBox.style.display = 'none';
  exportDrag = null;
  if (w < 10 || h < 10) return;
  renderExport(x1, y1, w, h);
}
// === EXPORT BACKGROUND CONTROL ===
// v3.10: user can now choose export bg color (default #2a2a3e, with a
// transparent option). Choice persists across sessions via localStorage.
const EXPORT_BG_KEY = 'krafted_export_bg';
const EXPORT_BG_TRANS_KEY = 'krafted_export_bg_transparent';
let lastExportArea = null;
let exportBgColor = '#2a2a3e';
let exportBgTransparent = false;
try {
  const saved = localStorage.getItem(EXPORT_BG_KEY);
  if (saved && /^#[0-9a-fA-F]{6}$/.test(saved)) exportBgColor = saved;
  const savedT = localStorage.getItem(EXPORT_BG_TRANS_KEY);
  if (savedT === '1') exportBgTransparent = true;
} catch(e) {}
function setExportBg(color) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color || '')) return;
  exportBgColor = color;
  exportBgTransparent = false;
  try { localStorage.setItem(EXPORT_BG_KEY, color); localStorage.setItem(EXPORT_BG_TRANS_KEY, '0'); } catch(e) {}
  syncExportBgUI();
  rerenderExport();
}
function setExportBgTransparent(on) {
  exportBgTransparent = !!on;
  try { localStorage.setItem(EXPORT_BG_TRANS_KEY, on ? '1' : '0'); } catch(e) {}
  syncExportBgUI();
  rerenderExport();
}
function syncExportBgUI() {
  const c = document.getElementById('export-bg-color');
  const t = document.getElementById('export-bg-transparent');
  if (c) c.value = exportBgColor;
  if (t) t.checked = exportBgTransparent;
}
function rerenderExport() {
  if (lastExportArea) {
    renderExport(lastExportArea.x1, lastExportArea.y1, lastExportArea.w, lastExportArea.h);
  }
}
// Apply saved prefs to the modal UI on first load
syncExportBgUI();
function renderExport(sx, sy, sw, sh) {
  // Hide media UI so it doesn't bleed into the exported PNG
  setCaptureMode(true);
  void document.body.offsetHeight; // force reflow before measuring
  try {
  const scale = 2;
  const cv = document.getElementById('export-canvas');
  cv.width = sw * scale;
  cv.height = sh * scale;
  cv.style.width = sw + 'px';
  cv.style.height = sh + 'px';
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);
  // v3.10: user-controllable export background (color or transparent)
  if (exportBgTransparent) {
    ctx.clearRect(0, 0, sw, sh);
  } else {
    ctx.fillStyle = exportBgColor;
    ctx.fillRect(0, 0, sw, sh);
  }
  // Remember the area so a color/toggle change can re-render the preview
  lastExportArea = {x1: sx, y1: sy, w: sw, h: sh};
  // Render items
  [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])].sort((a, b) => a.z - b.z).forEach(item => {
    const el = item.el;
    const r = el.getBoundingClientRect();
    const ix = r.left - sx, iy = r.top - sy;
    const iw = r.width, ih = r.height;
    if (ix + iw < 0 || iy + ih < 0 || ix > sw || iy > sh) return;
    ctx.save();
    ctx.globalAlpha = item.opacity !== undefined ? item.opacity : 1;
    const cx = ix + iw / 2, cy = iy + ih / 2;
    ctx.translate(cx, cy);
    ctx.rotate((item.rot || 0) * Math.PI / 180);
    ctx.scale(item.flipH ? -1 : 1, item.flipV ? -1 : 1);
    if (item.img || item.video) {
      // Build full filter string including temperature, shadow, highlight
      let tempFilter = '';
      const temp = item.temp || 0;
      if (temp > 0) tempFilter = ` sepia(${temp*0.3}%) saturate(${100+temp*0.5}%)`;
      else if (temp < 0) tempFilter = ` hue-rotate(${Math.abs(temp)*0.6}deg) saturate(${100+temp*0.2}%)`;
      // Shadow filter
      let shadowFilter = '';
      const shadowVal = item.shadow !== undefined ? item.shadow : 100;
      if (shadowVal !== 100) { shadowFilter = ` brightness(${100 + (shadowVal - 100) * 0.4}%)`; }
      // Highlight filter
      let highlightFilter = '';
      const highlightVal = item.highlight !== undefined ? item.highlight : 100;
      if (highlightVal !== 100) { highlightFilter = ` contrast(${100 + (highlightVal - 100) * 0.4}%)`; }
      ctx.filter = `brightness(${item.brightness||100}%) contrast(${item.contrast||100}%) saturate(${item.saturate||100}%) hue-rotate(${item.hueRotate||0}deg) blur(${item.blur||0}px) sepia(${item.sepia||0}%) grayscale(${item.grayscale||0}%)${tempFilter}${shadowFilter}${highlightFilter}`;
      const drawSrc = item.video || item.img;
      try { ctx.drawImage(drawSrc, -iw/2, -ih/2, iw, ih); } catch(e) {}
      ctx.filter = 'none';
      // Mask overlays
      drawMasksOnCanvas(ctx, item, iw, ih);
      // Vignette overlay
      if (item.vignette && item.vignette > 0) {
        const intensity = item.vignette / 100;
        const vGrad = ctx.createRadialGradient(0, 0, Math.min(iw,ih) * (0.3 + intensity * 0.2), 0, 0, Math.max(iw,ih) * 0.7);
        vGrad.addColorStop(0, 'transparent');
        vGrad.addColorStop(1, `rgba(0,0,0,${intensity * 0.8})`);
        ctx.fillStyle = vGrad;
        ctx.fillRect(-iw/2, -ih/2, iw, ih);
      }
    } else if (item.el && item.el.classList.contains('todo-item')) {
      // Todo checklist — render as card on canvas
      ctx.fillStyle = '#1e1e2e';
      ctx.fillRect(-iw/2, -ih/2, iw, ih);
      ctx.strokeStyle = '#3a3a4e';
      ctx.lineWidth = 1;
      ctx.strokeRect(-iw/2, -ih/2, iw, ih);
      ctx.fillStyle = '#e0e0e0';
      ctx.font = 'bold 13px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(item.title || 'Checklist', -iw/2 + 14, -ih/2 + 12);
      ctx.font = '12px Inter, sans-serif';
      let ty = -ih/2 + 36;
      (item.items||[]).forEach(it => {
        ctx.fillStyle = it.done ? '#888' : '#e0e0e0';
        ctx.fillText((it.done ? '[x] ' : '[ ] ') + (it.text || ''), -iw/2 + 14, ty);
        ty += 18;
      });
    } else if (item.el && item.el.classList.contains('mindmap-item')) {
      // Mind map — render as dark card with nodes and connections
      ctx.fillStyle = '#161616';
      ctx.fillRect(-iw/2, -ih/2, iw, ih);
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 1;
      ctx.strokeRect(-iw/2, -ih/2, iw, ih);
      ctx.fillStyle = '#e0e0e0';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(item.title || 'Mind Map', -iw/2 + 10, -ih/2 + 8);
      // Draw connections
      (item.connections||[]).forEach(c => {
        const from = (item.nodes||[]).find(n => n.id === c.from);
        const to = (item.nodes||[]).find(n => n.id === c.to);
        if (!from || !to) return;
        ctx.strokeStyle = c.color || '#7c8cf0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-iw/2 + from.x + (from.w||100)/2, -ih/2 + from.y + (from.h||32)/2 + 30);
        ctx.lineTo(-iw/2 + to.x + (to.w||100)/2, -ih/2 + to.y + (to.h||32)/2 + 30);
        ctx.stroke();
        // Arrow head
        const ax = -iw/2 + to.x + (to.w||100)/2, ay = -ih/2 + to.y + (to.h||32)/2 + 30;
        const angle = Math.atan2(ay - (-ih/2 + from.y + (from.h||32)/2 + 30), ax - (-iw/2 + from.x + (from.w||100)/2));
        ctx.fillStyle = c.color || '#7c8cf0';
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - 8*Math.cos(angle-0.4), ay - 8*Math.sin(angle-0.4));
        ctx.lineTo(ax - 8*Math.cos(angle+0.4), ay - 8*Math.sin(angle+0.4));
        ctx.closePath();
        ctx.fill();
      });
      // Draw nodes
      (item.nodes||[]).forEach(n => {
        ctx.fillStyle = n.color || '#7c8cf0';
        const nw = n.w || 100, nh = n.h || 32;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-iw/2 + n.x, -ih/2 + n.y + 30, nw, nh, 8);
        else ctx.rect(-iw/2 + n.x, -ih/2 + n.y + 30, nw, nh);
        ctx.fill();
        // Draw node image if present
        if (n.img) {
          try {
            const nodeImg = new Image();
            nodeImg.src = n.img;
            const imgDispW = Math.min(120, nw - 8);
            const imgDispH = Math.min(80, n.imgH * (imgDispW / Math.max(n.imgW, 1)));
            ctx.save();
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(-iw/2 + n.x + 4, -ih/2 + n.y + 34, imgDispW, imgDispH, 4);
            else ctx.rect(-iw/2 + n.x + 4, -ih/2 + n.y + 34, imgDispW, imgDispH);
            ctx.clip();
            ctx.drawImage(nodeImg, -iw/2 + n.x + 4, -ih/2 + n.y + 34, imgDispW, imgDispH);
            ctx.restore();
          } catch(e) {}
        }
        // Draw audio indicator if present
        if (n.audio) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.font = '10px Inter, sans-serif';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'top';
          ctx.fillText('\u266B', -iw/2 + n.x + nw - 4, -ih/2 + n.y + 32);
        }
        ctx.fillStyle = n.textColor || '#ffffff';
        ctx.font = '500 11.5px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(n.text || '', -iw/2 + n.x + nw/2, -ih/2 + n.y + 30 + nh - 12);
      });
    } else if (!item.isLink) {
      // Text (skip link cards without cover image)
      ctx.font = `${item.italic?'italic ':''}${item.bold?'bold ':''}${item.size}px ${item.font}`;
      ctx.fillStyle = item.color;
      ctx.textAlign = item.align || 'left';
      ctx.textBaseline = 'top';
      const text = item.el.textContent;
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        let tx = -iw/2;
        if (item.align === 'center') tx = 0;
        else if (item.align === 'right') tx = iw/2;
        ctx.fillText(line, tx, -ih/2 + i * item.size * 1.3);
      });
    }
    ctx.restore();
  });
  // Render drawing
  ctx.globalCompositeOperation = 'source-over';
  drawStrokes.forEach(stroke => {
    if (stroke.points.length < 2) return;
    ctx.globalAlpha = stroke.opacity;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (stroke.mode === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      stroke.points.forEach((p, i) => {
        const px = p[0] * state.zoom + state.pan.x - sx;
        const py = p[1] * state.zoom + state.pan.y - sy;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    } else if (stroke.mode === 'arrow') {
      ctx.globalCompositeOperation = 'source-over';
      const p0 = stroke.points[0], p1 = stroke.points[1];
      const px0 = p0[0] * state.zoom + state.pan.x - sx;
      const py0 = p0[1] * state.zoom + state.pan.y - sy;
      const px1 = p1[0] * state.zoom + state.pan.x - sx;
      const py1 = p1[1] * state.zoom + state.pan.y - sy;
      ctx.beginPath();
      ctx.moveTo(px0, py0);
      ctx.lineTo(px1, py1);
      ctx.stroke();
      const angle = Math.atan2(py1 - py0, px1 - px0);
      const headLen = stroke.arrowHead || 15;
      const spread = Math.PI / 7;
      ctx.beginPath();
      ctx.moveTo(px1, py1);
      ctx.lineTo(px1 - headLen * Math.cos(angle - spread), py1 - headLen * Math.sin(angle - spread));
      ctx.lineTo(px1 - headLen * Math.cos(angle + spread), py1 - headLen * Math.sin(angle + spread));
      ctx.closePath();
      ctx.fill();
    } else if (stroke.mode === 'box') {
      ctx.globalCompositeOperation = 'source-over';
      const p0 = stroke.points[0], p1 = stroke.points[1];
      const px0 = p0[0] * state.zoom + state.pan.x - sx;
      const py0 = p0[1] * state.zoom + state.pan.y - sy;
      const px1 = p1[0] * state.zoom + state.pan.x - sx;
      const py1 = p1[1] * state.zoom + state.pan.y - sy;
      ctx.strokeRect(Math.min(px0,px1), Math.min(py0,py1), Math.abs(px1-px0), Math.abs(py1-py0));
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      stroke.points.forEach((p, i) => {
        const px = p[0] * state.zoom + state.pan.x - sx;
        const py = p[1] * state.zoom + state.pan.y - sy;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
  });
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  document.getElementById('export-modal').classList.add('active');
  } finally {
    setCaptureMode(false);
  }
}
function downloadExport() {
  const cv = document.getElementById('export-canvas');
  const link = document.createElement('a');
  link.download = 'krafted_export_' + Date.now() + '.png';
  link.href = cv.toDataURL('image/png');
  link.click();
}
function closeExport() {
  document.getElementById('export-modal').classList.remove('active');
}

// ============================================================
//  CAPTURE AREA — drag to select, then capture as PNG
// ============================================================
function updateCapture(e) {
  if (!captureDrag) return;
  const x1 = Math.min(captureDrag.startX, e.clientX);
  const y1 = Math.min(captureDrag.startY, e.clientY);
  const w = Math.abs(e.clientX - captureDrag.startX);
  const h = Math.abs(e.clientY - captureDrag.startY);

  // Position the capture box
  captureBox.style.left = x1 + 'px';
  captureBox.style.top = y1 + 'px';
  captureBox.style.width = w + 'px';
  captureBox.style.height = h + 'px';

  // Position the dim overlay panels (4 panels around the selection)
  coPanels.top.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:' + y1 + 'px;background:rgba(0,0,0,0.5);';
  coPanels.bottom.style.cssText = 'position:fixed;top:' + (y1 + h) + 'px;left:0;width:100vw;height:' + (window.innerHeight - y1 - h) + 'px;background:rgba(0,0,0,0.5);';
  coPanels.left.style.cssText = 'position:fixed;top:' + y1 + 'px;left:0;width:' + x1 + 'px;height:' + h + 'px;background:rgba(0,0,0,0.5);';
  coPanels.right.style.cssText = 'position:fixed;top:' + y1 + 'px;left:' + (x1 + w) + 'px;width:' + (window.innerWidth - x1 - w) + 'px;height:' + h + 'px;background:rgba(0,0,0,0.5);';

  // Crosshair guide lines (extend from box edges to screen edges)
  const gv1 = document.getElementById('cb-guide-v1');
  const gv2 = document.getElementById('cb-guide-v2');
  const gh1 = document.getElementById('cb-guide-h1');
  const gh2 = document.getElementById('cb-guide-h2');
  if (gv1) { gv1.style.left = '0px'; gv1.style.top = (-y1) + 'px'; gv1.style.height = window.innerHeight + 'px'; }
  if (gv2) { gv2.style.right = '0px'; gv2.style.left = 'auto'; gv2.style.top = (-y1) + 'px'; gv2.style.height = window.innerHeight + 'px'; }
  if (gh1) { gh1.style.top = '0px'; gh1.style.left = (-x1) + 'px'; gh1.style.width = window.innerWidth + 'px'; }
  if (gh2) { gh2.style.bottom = '0px'; gh2.style.top = 'auto'; gh2.style.left = (-x1) + 'px'; gh2.style.width = window.innerWidth + 'px'; }

  // Dimension label
  let label = captureBox.querySelector('.cb-label');
  if (!label) {
    label = document.createElement('div');
    label.className = 'cb-label';
    captureBox.appendChild(label);
  }
  // Keep label inside viewport
  if (y1 < 35) { label.style.top = '4px'; label.style.left = '4px'; }
  else { label.style.top = '-30px'; label.style.left = '0'; }
  label.textContent = Math.round(w) + ' x ' + Math.round(h) + ' px';
}

function finishCapture(e) {
  if (!captureDrag) return;
  const x1 = Math.min(captureDrag.startX, e.clientX);
  const y1 = Math.min(captureDrag.startY, e.clientY);
  const w = Math.abs(e.clientX - captureDrag.startX);
  const h = Math.abs(e.clientY - captureDrag.startY);
  captureBox.style.display = 'none';
  captureOverlay.style.display = 'none';
  captureDrag = null;
  document.body.style.cursor = '';
  if (w < 10 || h < 10) {
    toast('Area too small');
    // R50: no setCaptureMode cleanup needed here — R50 stops toggling
    // capture mode entirely (per user request, controls stay visible
    // throughout the capture flow). The previous R49 guard that
    // restored controls after a tiny drag is therefore obsolete.
    return;
  }
  captureArea(x1, y1, w, h);
}

function captureArea(sx, sy, sw, sh) {
  if (sw < 10 || sh < 10) { toast('Nothing to capture'); return; }

  // R50: per user request, the per-item media controls panel must
  // stay visible during capture. captureArea's drawing now uses
  // .media-wrap BCR for the video and renders the controls bar as
  // a dark fill, so the captured output matches the on-screen state.
  //
  // The global #media-bar at the bottom of the screen is a fixed UI
  // overlay (not part of the canvas content) and must NOT bleed into
  // the capture. Hide it explicitly here, restore on exit.
  const globalMediaBar = document.getElementById('media-bar');
  const mediaBarWasActive = globalMediaBar && globalMediaBar.classList.contains('active');
  if (globalMediaBar) globalMediaBar.classList.remove('active');

  try {
  // 1:1 capture: output dimensions match the selected screen area exactly
  // (Previous scale=2 doubled the output, making captures feel "bigger than captured")
  const scale = 1;
  const cv = document.createElement('canvas');
  cv.width = Math.round(sw * scale);
  cv.height = Math.round(sh * scale);
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);

  // Background: match current theme
  const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#1a1a1a';
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, sw, sh);

  // Render all items (images, videos, texts) sorted by z-index
  [...state.items, ...state.texts, ...(state.todos||[]), ...(state.mindmaps||[])].sort((a, b) => (a.z || 1) - (b.z || 1)).forEach(item => {
    const el = item.el;
    const r = el.getBoundingClientRect();
    const ix = r.left - sx;
    const iy = r.top - sy;
    const iw = r.width;
    const ih = r.height;
    // Skip if entirely outside capture area
    if (ix + iw < 0 || iy + ih < 0 || ix > sw || iy > sh) return;

    ctx.save();
    ctx.globalAlpha = item.opacity !== undefined ? item.opacity : 1;
    const cx = ix + iw / 2;
    const cy = iy + ih / 2;
    ctx.translate(cx, cy);
    ctx.rotate((item.rot || 0) * Math.PI / 180);
    ctx.scale(item.flipH ? -1 : 1, item.flipV ? -1 : 1);

    if (item.img || item.video) {
      // Build filter string with all adjustments
      let tempFilter = '';
      const temp = item.temp || 0;
      if (temp > 0) tempFilter = ` sepia(${Math.min(100, temp*0.33)}%) saturate(${Math.min(400, 100+temp*0.5)}%)`;
      else if (temp < 0) tempFilter = ` hue-rotate(${Math.min(180, Math.abs(temp)*0.6)}deg) saturate(${Math.max(10, 100+temp*0.3)}%)`;
      let shadowFilter = '';
      const shadowVal = item.shadow !== undefined ? item.shadow : 100;
      if (shadowVal !== 100) { shadowFilter = ` brightness(${100 + (shadowVal - 100) * 0.4}%)`; }
      let highlightFilter = '';
      const highlightVal = item.highlight !== undefined ? item.highlight : 100;
      if (highlightVal !== 100) { highlightFilter = ` contrast(${100 + (highlightVal - 100) * 0.4}%)`; }
      ctx.filter = `brightness(${item.brightness||100}%) contrast(${item.contrast||100}%) saturate(${item.saturate||100}%) hue-rotate(${item.hueRotate||0}deg) blur(${item.blur||0}px) sepia(${item.sepia||0}%) grayscale(${item.grayscale||0}%)${tempFilter}${shadowFilter}${highlightFilter}`;
      const drawSrc = item.video || item.img;

      // R50: For video items, .item has two flex children — .media-wrap
      // (the video) and .media-controls (the 30-50px bottom bar). The
      // user wants the controls panel to stay visible during capture
      // (R49 hid it, which surprised them). We're inside the outer
      // transform block (translated to .item center, rotated by
      // .item.rot), so the .item spans local Y from -ih/2 to +ih/2.
      // The .media-wrap fills everything EXCEPT the controls bar at
      // the bottom. To match the on-screen state, we draw the video
      // in the top portion of the .item and fill the bottom strip
      // with a dark gradient that mirrors the controls panel styling.
      // For images, .item IS the image (no controls bar), so we draw
      // at the full .item size as before.
      const wrapEl = el.querySelector('.media-wrap');
      const isVideo = !!item.video;
      let videoH = ih;  // default: image — full .item height
      if (isVideo && wrapEl) {
        const wr = wrapEl.getBoundingClientRect();
        // In screen space, .item.bottom - .media-wrap.bottom = controlsH
        // (because the controls bar sits below .media-wrap). This is
        // true regardless of the .item's rotation, since the whole
        // stack is rotated as a single unit.
        const itemRect = el.getBoundingClientRect();
        const controlsH = Math.max(0, itemRect.height - wr.height);
        videoH = ih - controlsH;
      }

      try {
        if (drawSrc.readyState === undefined || drawSrc.readyState >= 2) {
          if (isVideo && wrapEl && videoH < ih) {
            // Video: draw at the TOP of .item in local coords
            // (y from -ih/2 to -ih/2 + videoH)
            ctx.drawImage(drawSrc, -iw/2, -ih/2, iw, videoH);
          } else {
            // Image (or video with no controls bar): full .item size
            ctx.drawImage(drawSrc, -iw/2, -ih/2, iw, ih);
          }
        }
      } catch(e) {}
      ctx.filter = 'none';
      // Vignette overlay (video only — applies to the video area, not the controls bar)
      if (item.vignette && item.vignette > 0) {
        const intensity = Math.min(item.vignette / 100, 2.0);
        const vigW = iw;
        const vigH = isVideo && wrapEl ? videoH : ih;
        const vigCy = isVideo && wrapEl ? (-ih/2 + vigH/2) : 0;
        const vGrad = ctx.createRadialGradient(0, vigCy, Math.min(vigW,vigH) * (0.3 + intensity * 0.2), 0, vigCy, Math.max(vigW,vigH) * 0.7);
        vGrad.addColorStop(0, 'transparent');
        vGrad.addColorStop(1, `rgba(0,0,0,${Math.min(1, intensity * 0.8)})`);
        ctx.fillStyle = vGrad;
        ctx.fillRect(-vigW/2, vigCy - vigH/2, vigW, vigH);
      }
      // R50: render the visible controls bar as a dark gradient in the
      // .item's local frame (local Y from -ih/2+videoH to +ih/2). Two-stop
      // gradient + 1px top border matches the live .media-controls CSS.
      if (isVideo && wrapEl && videoH < ih) {
        const ctlTop = -ih/2 + videoH;
        const ctlH = ih - videoH;
        const ctlGrad = ctx.createLinearGradient(0, ctlTop, 0, ctlTop + ctlH);
        ctlGrad.addColorStop(0, 'rgba(22,22,22,0.94)');
        ctlGrad.addColorStop(1, 'rgba(16,16,16,0.98)');
        ctx.fillStyle = ctlGrad;
        ctx.fillRect(-iw/2, ctlTop, iw, ctlH);
        // 1px top border — matches live border-top: 1px solid rgba(255,255,255,0.07)
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(-iw/2, ctlTop, iw, 1);
      }
    } else if (item.el && item.el.classList.contains('todo-item')) {
      // Todo checklist — render as card on canvas
      ctx.fillStyle = '#1e1e2e';
      ctx.fillRect(-iw/2, -ih/2, iw, ih);
      ctx.strokeStyle = '#3a3a4e';
      ctx.lineWidth = 1;
      ctx.strokeRect(-iw/2, -ih/2, iw, ih);
      ctx.fillStyle = '#e0e0e0';
      ctx.font = 'bold 13px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(item.title || 'Checklist', -iw/2 + 14, -ih/2 + 12);
      ctx.font = '12px Inter, sans-serif';
      let ty = -ih/2 + 36;
      (item.items||[]).forEach(it => {
        ctx.fillStyle = it.done ? '#888' : '#e0e0e0';
        ctx.fillText((it.done ? '[x] ' : '[ ] ') + (it.text || ''), -iw/2 + 14, ty);
        ty += 18;
      });
    } else if (item.el && item.el.classList.contains('mindmap-item')) {
      // Mind map — render as dark card with nodes and connections
      ctx.fillStyle = '#161616';
      ctx.fillRect(-iw/2, -ih/2, iw, ih);
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 1;
      ctx.strokeRect(-iw/2, -ih/2, iw, ih);
      ctx.fillStyle = '#e0e0e0';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(item.title || 'Mind Map', -iw/2 + 10, -ih/2 + 8);
      // Draw connections
      (item.connections||[]).forEach(c => {
        const from = (item.nodes||[]).find(n => n.id === c.from);
        const to = (item.nodes||[]).find(n => n.id === c.to);
        if (!from || !to) return;
        ctx.strokeStyle = c.color || '#7c8cf0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-iw/2 + from.x + (from.w||100)/2, -ih/2 + from.y + (from.h||32)/2 + 30);
        ctx.lineTo(-iw/2 + to.x + (to.w||100)/2, -ih/2 + to.y + (to.h||32)/2 + 30);
        ctx.stroke();
        // Arrow head
        const ax = -iw/2 + to.x + (to.w||100)/2, ay = -ih/2 + to.y + (to.h||32)/2 + 30;
        const angle = Math.atan2(ay - (-ih/2 + from.y + (from.h||32)/2 + 30), ax - (-iw/2 + from.x + (from.w||100)/2));
        ctx.fillStyle = c.color || '#7c8cf0';
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - 8*Math.cos(angle-0.4), ay - 8*Math.sin(angle-0.4));
        ctx.lineTo(ax - 8*Math.cos(angle+0.4), ay - 8*Math.sin(angle+0.4));
        ctx.closePath();
        ctx.fill();
      });
      // Draw nodes
      (item.nodes||[]).forEach(n => {
        ctx.fillStyle = n.color || '#7c8cf0';
        const nw = n.w || 100, nh = n.h || 32;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-iw/2 + n.x, -ih/2 + n.y + 30, nw, nh, 8);
        else ctx.rect(-iw/2 + n.x, -ih/2 + n.y + 30, nw, nh);
        ctx.fill();
        // Draw node image if present
        if (n.img) {
          try {
            const nodeImg = new Image();
            nodeImg.src = n.img;
            const imgDispW = Math.min(120, nw - 8);
            const imgDispH = Math.min(80, n.imgH * (imgDispW / Math.max(n.imgW, 1)));
            ctx.save();
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(-iw/2 + n.x + 4, -ih/2 + n.y + 34, imgDispW, imgDispH, 4);
            else ctx.rect(-iw/2 + n.x + 4, -ih/2 + n.y + 34, imgDispW, imgDispH);
            ctx.clip();
            ctx.drawImage(nodeImg, -iw/2 + n.x + 4, -ih/2 + n.y + 34, imgDispW, imgDispH);
            ctx.restore();
          } catch(e) {}
        }
        // Draw audio indicator if present
        if (n.audio) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.font = '10px Inter, sans-serif';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'top';
          ctx.fillText('\u266B', -iw/2 + n.x + nw - 4, -ih/2 + n.y + 32);
        }
        ctx.fillStyle = n.textColor || '#ffffff';
        ctx.font = '500 11.5px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(n.text || '', -iw/2 + n.x + nw/2, -ih/2 + n.y + 30 + nh - 12);
      });
    } else if (!item.isLink) {
      // Text item (skip link cards without cover image)
      ctx.font = `${item.italic?'italic ':''}${item.bold?'bold ':''}${item.size}px ${item.font}`;
      ctx.fillStyle = item.color;
      ctx.textAlign = item.align || 'left';
      ctx.textBaseline = 'top';
      // Background (highlight)
      if (item.highlight || item.bg) {
        const bg = item.highlight ? item.highlightColor : item.highlightColor + '88';
        ctx.fillStyle = bg;
        ctx.fillRect(-iw/2, -ih/2, iw, ih);
        ctx.fillStyle = item.color;
      }
      // Text shadow / outline
      if (item.outline) {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
      }
      if (item.shadow && !item.outline) {
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
      }
      const text = item.el.textContent;
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        let tx = -iw/2;
        if (item.align === 'center') tx = 0;
        else if (item.align === 'right') tx = iw/2;
        const ty = -ih/2 + i * item.size * 1.3;
        if (item.outline) { ctx.strokeText(line, tx, ty); }
        ctx.fillText(line, tx, ty);
      });
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  });

  // Render drawing strokes
  ctx.globalCompositeOperation = 'source-over';
  drawStrokes.forEach(stroke => {
    if (stroke.points.length < 2) return;
    ctx.globalAlpha = stroke.opacity;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const toScreen = (p) => [p[0] * state.zoom + state.pan.x - sx, p[1] * state.zoom + state.pan.y - sy];
    if (stroke.mode === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      stroke.points.forEach((p, i) => {
        const [px, py] = toScreen(p);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    } else if (stroke.mode === 'arrow') {
      ctx.globalCompositeOperation = 'source-over';
      const [px0, py0] = toScreen(stroke.points[0]);
      const [px1, py1] = toScreen(stroke.points[1]);
      ctx.beginPath(); ctx.moveTo(px0, py0); ctx.lineTo(px1, py1); ctx.stroke();
      const angle = Math.atan2(py1 - py0, px1 - px0);
      const headLen = stroke.arrowHead || 15;
      const spread = Math.PI / 7;
      ctx.beginPath();
      ctx.moveTo(px1, py1);
      ctx.lineTo(px1 - headLen * Math.cos(angle - spread), py1 - headLen * Math.sin(angle - spread));
      ctx.lineTo(px1 - headLen * Math.cos(angle + spread), py1 - headLen * Math.sin(angle + spread));
      ctx.closePath(); ctx.fill();
    } else if (stroke.mode === 'box') {
      ctx.globalCompositeOperation = 'source-over';
      const [px0, py0] = toScreen(stroke.points[0]);
      const [px1, py1] = toScreen(stroke.points[1]);
      ctx.strokeRect(Math.min(px0,px1), Math.min(py0,py1), Math.abs(px1-px0), Math.abs(py1-py0));
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      stroke.points.forEach((p, i) => {
        const [px, py] = toScreen(p);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
  });
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  // Store canvas for save/discard
  captureResultCanvas = cv;

  // Try to export canvas — may fail if tainted by cross-origin images (e.g. Bilibili covers)
  let dataURL;
  try {
    dataURL = cv.toDataURL('image/png');
    captureResultImg.src = dataURL;
  } catch(taintErr) {
    // Canvas is tainted — can't export as data URL or save as PNG
    captureResultImg.src = '';
    captureResultImg.style.display = 'none';
    captureResultInfo.innerHTML = '<b>Capture blocked</b><br>Cross-origin image on board prevents PNG export. Remove link cards with external covers and try again.';
    captureResultPanel.classList.add('show');
    toast('Capture failed — cross-origin image taints canvas');
    setTool('select');
    return;
  }

  // Try to copy to clipboard so user can paste anywhere
  cv.toBlob(async (blob) => {
    try {
      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);
      captureResultInfo.innerHTML = '<b>Copied to clipboard</b><br>Paste (Ctrl+V) anywhere, or save as PNG.';
    } catch(err) {
      captureResultInfo.innerHTML = '<b>Capture ready</b><br>Clipboard unavailable — save as PNG to use.';
    }
  }, 'image/png');

  // Show the result panel
  captureResultPanel.classList.add('show');
  toast('Captured ' + Math.round(sw) + 'x' + Math.round(sh) + ' — copied to clipboard');

  // Return to select tool but keep panel open
  setTool('select');
  } catch(err) {
    console.error('Capture error:', err);
    toast('Capture failed: ' + (err.message || 'unknown error'));
    setTool('select');
  } finally {
    // R50: restore the global #media-bar if it was active before the
    // capture. setCaptureMode is intentionally NOT called here — the
    // per-item media controls were never hidden in R50.
    if (globalMediaBar && mediaBarWasActive) globalMediaBar.classList.add('active');
  }
}

function saveCaptureResult() {
  if (!captureResultCanvas) return;
  try {
    const link = document.createElement('a');
    link.download = 'krafted_capture_' + Date.now() + '.png';
    link.href = captureResultCanvas.toDataURL('image/png');
    link.click();
    toast('Saved as PNG');
  } catch(e) {
    toast('Cannot save — canvas tainted by cross-origin image');
  }
  captureResultPanel.classList.remove('show');
  captureResultCanvas = null;
  // Reset preview image display for next capture
  captureResultImg.style.display = '';
}

function discardCaptureResult() {
  captureResultPanel.classList.remove('show');
  captureResultCanvas = null;
  // Clear clipboard image if possible
  try { navigator.clipboard.writeText(''); } catch(e) {}
  toast('Capture discarded');
}

// Drop the captured canvas directly onto the board as a new image item.
// This is the "paste the capture result" workflow — but unlike the
// Ctrl+V round-trip (which can fail if the system clipboard write was
// blocked, e.g. on file:// in some Chrome versions, or if the user
// pressed Ctrl+V before the async clipboard write finished), this path
// uses the live captureResultCanvas in memory. The result: a single
// click, no race conditions, no clipboard permission prompts.
//
// Position: the captured image is dropped at the cursor's world
// coordinates (same as paste), so the user can mouse over to where
// they want the capture to land, click the button, and it's there.
function pasteCaptureToBoard() {
  if (!captureResultCanvas) { toast('No capture to paste'); return; }
  let dataUrl;
  try {
    dataUrl = captureResultCanvas.toDataURL('image/png');
  } catch (e) {
    // Cross-origin taint — same as the existing in-capture guard. We
    // surface the error here so the user knows why their click didn't
    // do anything visible.
    console.error('Paste to board failed (tainted canvas):', e);
    toast('Cannot paste: canvas tainted by cross-origin image');
    return;
  }
  // Build a fresh Image to read the natural dimensions off of.
  // addImage() takes (src, natW, natH, x, y) and places the item at the
  // given world coordinates. We read the cursor world position from
  // getPasteXY() so the user can move the mouse before clicking the
  // button to control drop position. We then center the new item on
  // that world point so the drop feels natural (cursor lands on the
  // center of the image, not the top-left).
  //
  // addImage internally caps the displayed width to 720px, so a very
  // large capture (e.g. 1920x1080) gets scaled to 720x405 on the
  // board. We mirror that logic here to compute the actual on-board
  // size, so the centering math lands the IMAGE center on the cursor
  // — not the unscaled natural size's center.
  const img = new Image();
  img.onload = () => {
    const { x, y } = getPasteXY();
    const cx = x, cy = y;
    const maxW = 720;
    let dispW = img.naturalWidth, dispH = img.naturalHeight;
    if (dispW > maxW) { dispH = dispH * (maxW / dispW); dispW = maxW; }
    addImage(dataUrl, img.naturalWidth, img.naturalHeight, cx - dispW / 2, cy - dispH / 2);
    // Close the result panel and free the canvas (already saved to a
    // PNG data URL, so we don't need to keep the live canvas around).
    captureResultPanel.classList.remove('show');
    captureResultCanvas = null;
    captureResultImg.style.display = '';
    toast('Pasted capture to board · ' + img.naturalWidth + 'x' + img.naturalHeight);
  };
  img.onerror = () => {
    toast('Failed to decode capture image');
  };
  img.src = dataUrl;
}

// ============================================================
//  SCREEN CAPTURE — uses getDisplayMedia for full desktop/window screenshots
// ============================================================

// Global helper: convert screen coordinates to world coordinates for pasting
function getPasteXY() {
  return {
    x: (lastScreenX - state.pan.x) / state.zoom,
    y: (lastScreenY - state.pan.y) / state.zoom
  };
}

// Helper: toggle "capturing" mode — hides all media UI (per-item controls bar,
// type badge, global media player) so they don't bleed into the captured image
// or screen capture. CSS rule at body.capturing handles the actual hiding.
function setCaptureMode(on) {
  document.body.classList.toggle('capturing', !!on);
}

async function captureScreen() {
  setCaptureMode(true);
  try {
    // Standard getDisplayMedia API — prompts user to select screen, window, or tab
    // 'monitor' hint encourages full-screen capture; 'browser' for window capture
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'monitor',  // hint: prefer full screen over tab/window
        logicalSurface: true
      },
      audio: false,
      // Chrome-specific: explicitly allow all surface types
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      systemAudio: 'exclude'
    });
    console.log('[CAPTURE] Stream acquired, tracks:', stream.getVideoTracks().length);
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // Wait a frame for the video to render
    await new Promise(r => setTimeout(r, 300));
    // Capture a single frame
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    console.log('[CAPTURE] Video dimensions:', video.videoWidth, 'x', video.videoHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    // Stop the stream
    stream.getTracks().forEach(t => t.stop());
    video.remove();
    // Convert to data URL and add to board
    const dataUrl = canvas.toDataURL('image/png');
    const { x, y } = getPasteXY();
    const img = new Image();
    img.onload = () => {
      addImage(dataUrl, img.naturalWidth, img.naturalHeight, x, y);
      toast('Screen captured: ' + img.naturalWidth + 'x' + img.naturalHeight);
    };
    img.src = dataUrl;
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'NotAllowedError') {
      toast('Screen capture cancelled');
    } else {
      console.error('[CAPTURE] Error:', err);
      toast('Screen capture failed: ' + (err.message || 'unknown error'));
    }
  }
  setCaptureMode(false);
}
