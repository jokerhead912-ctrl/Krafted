/**
 * Krafted v4 → KraftedFormat Integration Bridge
 * Drop-in replacement for Krafted v4.0's inline save/load functions.
 */
(function() {
  'use strict';
  var KF = window.KraftedFormat;
  if (!KF) { console.error('[KraftedBridge] KraftedFormat not loaded.'); return; }
  // G, state, paperState are top-level consts in the concatenated build
  // scope (declared in core-state.js). In ES module form the bridge would
  // `import { G, state, paperState } from './core-state.js'`; in the
  // built script those bindings live in the outer script scope and are
  // visible to this IIFE via the scope chain at call time. We capture
  // `G` once via a getter that always reads window.G (which the
  // core-state.js file assigns after this IIFE runs), so by the time
  // saveBoardV5 / loadBoardFileV5 fire, G is fully populated.
  Object.defineProperty(window, '_bridgeResolveG', { value: function() { return window.G || G; } });
  var G = window.G || {};
  console.log('[KraftedBridge] Initializing v4→v5 integration...');

  function waitForKraftedState(maxAttempts) {
    var attempts = maxAttempts || 100;
    return new Promise(function(resolve, reject) {
      function check() {
        try {
          if (typeof state !== 'undefined' && state && state.items) { console.log('[KraftedBridge] Krafted state detected (' + state.items.length + ' items)'); resolve(); return; }
        } catch(e) { /* state not initialized yet (TDZ), keep waiting */ }
        attempts--; if (attempts <= 0) { console.warn('[KraftedBridge] Timed out waiting for Krafted state — patching anyway'); resolve(); return; }
        setTimeout(check, 100);
      }
      check();
    });
  }

  function v4StateToManifest() {
    var K = KF.Schema;
    var manifest = K.createEmptyManifest();
    manifest.canvas = { width: 1920, height: 1080, backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim() || '#1a1a1a' };
    manifest.viewport = { zoom: state.zoom || 1.0, panX: (state.pan || { x: 0, y: 0 }).x || 0, panY: (state.pan || { x: 0, y: 0 }).y || 0 };
    if (paperState && paperState.enabled) { manifest.canvas.width = paperState.width || 1920; manifest.canvas.height = paperState.height || 1080; manifest.canvas.backgroundColor = paperState.color || '#1a1a1a'; }
    var items = state.items || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var node = { id: it.id || 'item_' + i, x: it.x, y: it.y, w: it.w, h: it.h, rot: it.rot || 0, natW: it.natW, natH: it.natH, cropX: it.cropX, cropY: it.cropY, cropW: it.cropW, cropH: it.cropH, opacity: it.opacity !== undefined ? it.opacity : 1, zIndex: it.z || 0, locked: it.locked || false, flipH: it.flipH || false, flipV: it.flipV || false, visible: true, filename: it.filename || '', trimStart: it.trimStart || 0, trimEnd: it.trimEnd || 0, playbackRate: it.playbackRate || 1, fps: (it.video && it.video._kraftedFps) ? it.video._kraftedFps : null, fpsManual: !!(it.video && it.video._kraftedFpsManual), isGif: it.isGif || false, adjustments: { brightness: it.brightness !== undefined ? it.brightness : 100, contrast: it.contrast !== undefined ? it.contrast : 100, saturate: it.saturate !== undefined ? it.saturate : 100, hueRotate: it.hueRotate || 0, blur: it.blur || 0, sepia: it.sepia || 0, grayscale: it.grayscale || 0, temp: it.temp || 0, vignette: it.vignette || 0, shadow: it.shadow || 0, highlight: it.highlight || 0, grain: it.grain || 0 } };
      if (it.masks && it.masks.length) { node.masks = it.masks.map(function(m) { return { id: m.id, name: m.name, enabled: m.enabled, type: m.type, color: m.color, tolerance: m.tolerance, feather: m.feather, brushData: m.brushData, brushSize: m.brushSize, brightness: m.brightness, contrast: m.contrast, saturate: m.saturate, temp: m.temp, shadow: m.shadow, highlight: m.highlight, hueRotate: m.hueRotate, sepia: m.sepia, tintColor: m.tintColor, tintStrength: m.tintStrength }; }); }
      if (it.anno) { node.anno = { comments: (it.anno.comments || []).map(function(c) { return { id: c.id, frame: c.frame, time: c.time, text: c.text, translation: c.translation, translationDir: c.translationDir, originalText: c.originalText, snapshot: c.snapshot, annoStrokes: c.annoStrokes }; }) }; }
      if (it.isVideo && it.el && it.el._annoDrawState) { var sbf = it.el._annoDrawState.strokesByFrame; if (sbf) { node._annoStrokesByFrame = {}; Object.keys(sbf).forEach(function(f) { if (sbf[f] && sbf[f].length) { node._annoStrokesByFrame[f] = sbf[f].map(function(s) { return { type: s.type, color: s.color, size: s.size, points: (s.points || []).map(function(p) { return [p[0], p[1]]; }), text: s.text || '' }; }); } }); } }
      if (it.type === 'draw') { node.type = 'draw'; node.strokeId = it.strokeId; node.drawMode = it.drawMode; node.drawColor = it.drawColor; node.drawSize = it.drawSize; node.drawOpacity = it.drawOpacity; node.drawArrowHead = it.drawArrowHead; }
      else if (it.isVideo) { node.type = 'video'; node.assetId = it.id; }
      else if (it.isAudio) { node.type = 'audio'; node.assetId = it.id; node.audioName = it.audioName || it.filename || ''; node.filename = it.filename || it.audioName || ''; }
      else if (it.isLink) { node.type = 'link'; node.linkUrl = it.linkUrl || ''; node.linkTitle = it.linkTitle || ''; node.linkDesc = it.linkDesc || ''; }
      else { node.type = 'image'; node.assetId = it.id; }
      if (it.src && it.src.startsWith('blob:')) { node._src = it.src; }
      manifest.nodes.push(node);
    }
    var texts = state.texts || [];
    for (var j = 0; j < texts.length; j++) { var t = texts[j]; manifest.texts.push({ id: t.id, x: t.x, y: t.y, w: t.w, h: t.h, z: t.z, font: t.font, size: t.size, bold: t.bold, italic: t.italic, underline: t.underline, strike: t.strike, highlight: t.highlight, highlightColor: t.highlightColor, shadow: t.shadow, bg: t.bg, outline: t.outline, uppercase: t.uppercase, color: t.color, align: t.align, html: t.el ? t.el.innerHTML : '', content: t.el ? t.el.textContent : '', userResized: t.userResized || false }); }
    manifest.drawStrokes = (window.G && window.G.drawStrokes) || [];
    manifest.todos = (state.todos || []).map(function(td) { return { id: td.id, x: td.x, y: td.y, w: td.w, h: td.h, z: td.z, rot: td.rot || 0, opacity: td.opacity !== undefined ? td.opacity : 1, locked: td.locked || false, title: td.title || '', items: (td.items || []).map(function(it) { return { text: it.text, done: it.done }; }) }; });
    manifest.mindmaps = (state.mindmaps || []).map(function(mm) { return { id: mm.id, x: mm.x, y: mm.y, w: mm.w, h: mm.h, z: mm.z, rot: mm.rot || 0, opacity: mm.opacity !== undefined ? mm.opacity : 1, locked: mm.locked || false, title: mm.title || '', nodes: (mm.nodes || []).map(function(nn) { return { id: nn.id, text: nn.text, x: nn.x, y: nn.y, w: nn.w, h: nn.h, color: nn.color, textColor: nn.textColor, parentId: nn.parentId || null, img: nn.img || null, imgW: nn.imgW || 0, imgH: nn.imgH || 0, audio: nn.audio || null, audioName: nn.audioName || null }; }), connections: (mm.connections || []).map(function(c) { return { id: c.id, from: c.from, to: c.to, color: c.color }; }), nextNodeId: mm.nextNodeId || 1, nextConnId: mm.nextConnId || 1 }; });
    manifest.paper = { enabled: paperState.enabled, autoFit: paperState.autoFit, width: paperState.width, height: paperState.height, color: paperState.color };
    manifest.canvasBg = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim() || '#1a1a1a';
    var groups = state.groups || [];
    for (var k = 0; k < groups.length; k++) { var g = groups[k]; manifest.groups.push({ id: g.id, color: g.color, memberIds: g.memberIds ? g.memberIds.slice() : [] }); }
    manifest.counter = { nextId: (window.G && window.G.nextId) || 1, nextZ: (window.G && window.G.nextZ) || 1, nextStrokeId: (window.G && window.G.nextStrokeId) || 1, nextGroupId: (window.G && window.G.nextGroupId) || 1 };
    // CRITICAL: serialize relations into the V5 manifest (save path)
    manifest.relations = (state.relations || []).map(function(r) {
      return {
        id: r.id, fromId: r.fromId, toId: r.toId,
        fromAnchor: r.fromAnchor || 'right', toAnchor: r.toAnchor || 'left',
        label: r.label || '',
        style: r.style || 'orthogonal',
        color: r.color || '#00e5ff',
        lineWidth: r.lineWidth || 6,
        labelSize: r.labelSize || 16
      };
    });
    return manifest;
  }

  function manifestToV4Restore(manifest) {
    var data = { _kraftedVersion: 4, items: [], texts: [], drawStrokes: manifest.drawStrokes || [], groups: [], nextId: manifest.counter ? manifest.counter.nextId : 1, nextZ: manifest.counter ? manifest.counter.nextZ : 1, nextStrokeId: manifest.counter ? manifest.counter.nextStrokeId : 1, nextGroupId: manifest.counter ? manifest.counter.nextGroupId : 1, pan: { x: (manifest.viewport || {}).panX || 0, y: (manifest.viewport || {}).panY || 0 }, zoom: (manifest.viewport || {}).zoom || 1.0, paper: { enabled: (manifest.paper || {}).enabled || false, autoFit: (manifest.paper || {}).autoFit !== false, width: (manifest.paper || {}).width || (manifest.canvas || {}).width || 1920, height: (manifest.paper || {}).height || (manifest.canvas || {}).height || 1080, color: (manifest.paper || {}).color || (manifest.canvas || {}).backgroundColor || '#1a1a1a' }, canvasBg: manifest.canvasBg || (manifest.canvas || {}).backgroundColor || '#1a1a1a' };
    var nodes = manifest.nodes || [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var resolvedSrc = n._blobUrl || undefined;
      if (!resolvedSrc && n.src && (n.src.startsWith('blob:') || n.src.startsWith('data:'))) { resolvedSrc = n.src; }
      if (!resolvedSrc && n.mediaData) { try { var arr = n.mediaData.split(','); var mime = (arr[0].match(/:(.*?);/) || [])[1] || 'application/octet-stream'; var bin = atob(arr[1] || arr[0]); var bytes = new Uint8Array(bin.length); for (var k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k); resolvedSrc = URL.createObjectURL(new Blob([bytes], { type: mime })); } catch (e) {} }
      var savedW = n.w > 0 ? n.w : (n.natW || 100);
      var savedH = n.h > 0 ? n.h : (n.natH || 100);
      var item = { id: n.id, x: n.x || 0, y: n.y || 0, w: savedW, h: savedH, natW: n.natW, natH: n.natH, cropX: n.cropX, cropY: n.cropY, cropW: n.cropW, cropH: n.cropH, rot: n.rot || 0, opacity: n.opacity !== undefined ? n.opacity : 1, z: n.zIndex || 0, locked: n.locked || false, flipH: n.flipH || false, flipV: n.flipV || false, trimStart: n.trimStart || 0, trimEnd: n.trimEnd || 0, playbackRate: n.playbackRate || 1, fps: n.fps || null, fpsManual: n.fpsManual || false, isGif: n.isGif || false, brightness: (n.adjustments || {}).brightness, contrast: (n.adjustments || {}).contrast, saturate: (n.adjustments || {}).saturate, hueRotate: (n.adjustments || {}).hueRotate, blur: (n.adjustments || {}).blur, sepia: (n.adjustments || {}).sepia, grayscale: (n.adjustments || {}).grayscale, temp: (n.adjustments || {}).temp, vignette: (n.adjustments || {}).vignette, shadow: (n.adjustments || {}).shadow, highlight: (n.adjustments || {}).highlight, grain: (n.adjustments || {}).grain, filename: n.filename || n.audioName || '', isVideo: n.type === 'video', isAudio: n.type === 'audio', audioName: n.audioName || n.filename || '', isLink: n.type === 'link', linkUrl: n.linkUrl || '', linkTitle: n.linkTitle || '', linkDesc: n.linkDesc || '', anno: n.anno ? { comments: (n.anno.comments || []).map(function(c) { return { id: c.id, frame: c.frame, time: c.time, text: c.text || '', translation: c.translation || '', translationDir: c.translationDir || '', originalText: c.originalText || '', snapshot: c.snapshot || '', annoStrokes: Array.isArray(c.annoStrokes) ? c.annoStrokes.filter(Boolean).map(function(s) { return { type: s.type, color: s.color, size: s.size, points: Array.isArray(s.points) ? s.points.map(function(p) { return [p[0], p[1]]; }) : [], text: s.text || '' }; }) : [] }; }) } : undefined, _annoStrokesByFrame: n._annoStrokesByFrame || undefined, masks: n.masks ? n.masks.map(function(m) { return { id: m.id, name: m.name, enabled: m.enabled, type: m.type, color: m.color, tolerance: m.tolerance, feather: m.feather, brushData: m.brushData, brushSize: m.brushSize, brightness: m.brightness, contrast: m.contrast, saturate: m.saturate, temp: m.temp, shadow: m.shadow, highlight: m.highlight, hueRotate: m.hueRotate, sepia: m.sepia, tintColor: m.tintColor, tintStrength: m.tintStrength }; }) : undefined, type: n.type === 'draw' ? 'draw' : undefined, strokeId: n.strokeId, drawMode: n.drawMode, drawColor: n.drawColor, drawSize: n.drawSize, drawOpacity: n.drawOpacity, drawArrowHead: n.drawArrowHead, src: resolvedSrc };
      data.items.push(item);
    }
    var texts = manifest.texts || [];
    for (var ti = 0; ti < texts.length; ti++) { var t = texts[ti]; data.texts.push({ id: t.id, x: t.x, y: t.y, w: t.w, h: t.h, z: t.z, font: t.font, size: t.size, bold: t.bold, italic: t.italic, underline: t.underline, strike: t.strike, highlight: t.highlight, highlightColor: t.highlightColor, shadow: t.shadow, bg: t.bg, outline: t.outline, uppercase: t.uppercase, color: t.color, align: t.align, html: t.html || '', content: t.content || '', userResized: t.userResized || false }); }
    var todos = manifest.todos || []; for (var ti2 = 0; ti2 < todos.length; ti2++) { data.todos = data.todos || []; data.todos.push(todos[ti2]); }
    var mindmaps = manifest.mindmaps || []; for (var ti3 = 0; ti3 < mindmaps.length; ti3++) { data.mindmaps = data.mindmaps || []; data.mindmaps.push(mindmaps[ti3]); }
    var groups = manifest.groups || []; for (var j = 0; j < groups.length; j++) { data.groups.push({ id: groups[j].id, color: groups[j].color, memberIds: groups[j].memberIds ? groups[j].memberIds.slice() : [] }); }
    // CRITICAL: copy relations across (V5 manifest → V4 restore shape)
    data.relations = (manifest.relations || []).map(function(r) {
      return {
        id: r.id, fromId: r.fromId, toId: r.toId,
        fromAnchor: r.fromAnchor || 'right', toAnchor: r.toAnchor || 'left',
        label: r.label || '',
        style: r.style || 'orthogonal',
        color: r.color || '#00e5ff',
        lineWidth: r.lineWidth || 6,
        labelSize: r.labelSize || 16
      };
    });
    return data;
  }

  window.saveBoardV5 = async function() {
    var choice = await showSaveLockPrompt(); if (choice === 'cancel') return;
    var counts = countMediaItems();
    var prog = document.createElement('div'); prog.className = 'save-progress'; prog.innerHTML = '<div class="pct">Preparing save...</div>'; document.body.appendChild(prog);
    function updateProg(txt) { prog.innerHTML = '<div class="pct">' + txt + '</div>'; }
    try {
      var fname = 'krafted_' + new Date().toISOString().slice(0, 10) + '.kpak';
      var fileHandle = null, handleName = null;
      if (window.showSaveFilePicker) { updateProg('Choose where to save...'); var h = await KF.Writer.requestSaveHandle(fname); if (h.cancelled) { toast('Save cancelled'); return; } fileHandle = h.handle; handleName = h.name; }
      var manifest = v4StateToManifest();
      var mediaFetcher = async function(node) {
        var item = (state.items || []).find(function(it) { return it.id === node.id; }); if (!item) return null;
        if (item.src && (item.src.startsWith('blob:') || item.src.startsWith('data:'))) { try { var resp = await fetch(item.src); if (resp.ok) return await resp.blob(); } catch (e) {} }
        var elSrc = (item.img && item.img.src) || (item.video && item.video.src) || null;
        if (elSrc && (elSrc.startsWith('blob:') || elSrc.startsWith('data:'))) { try { var resp2 = await fetch(elSrc); if (resp2.ok) return await resp2.blob(); } catch (e) {} }
        if (item._origBlob) return item._origBlob;
        if (item.mediaData && typeof item.mediaData === 'string') { try { var arr = item.mediaData.split(','); var mime = (arr[0].match(/:(.*?);/) || [])[1] || 'application/octet-stream'; var bin = atob(arr[1] || arr[0]); var bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new Blob([bytes], { type: mime }); } catch (e) {} }
        return null;
      };
      var result = await KF.Writer.buildKpak(manifest, { mediaFetcher: mediaFetcher, compression: 'STORE', onProgress: function(evt) { updateProg(evt.message); } });
      var zipBlob = result.zipBlob;
      if (choice === 'lock') { updateProg('Encrypting with password...'); var password = KF.Writer.generatePassword(8); zipBlob = await KF.Writer.encryptWithLock(zipBlob, password); await showPasswordDisplayModal(password); }
      updateProg('Writing ' + KF.Writer.formatBytes(zipBlob.size) + '...'); await new Promise(function(r) { setTimeout(r, 0); });
      if (fileHandle) { await KF.Writer.writeToHandle(fileHandle, zipBlob); toast('Saved \u2714 ' + handleName + ' (' + KF.Writer.formatBytes(zipBlob.size) + ')'); }
      else { await KF.Writer.downloadBlob(zipBlob, fname); toast('Downloaded \u2192 ' + fname); }
    } catch (err) { console.error('[KraftedBridge] Save failed:', err); updateProg('Error: ' + (err.message || 'unknown')); toast('Save failed: ' + (err.message || 'unknown error')); await new Promise(function(r) { setTimeout(r, 3000); }); }
    finally { try { prog.remove(); } catch (e) {} }
  };

  window.loadBoardFileV5 = async function(event) {
    var file = event.target.files[0]; if (!file) return;
    var isLarge = file.size > 5 * 1024 * 1024; var prog = null;
    if (isLarge) { prog = document.createElement('div'); prog.className = 'save-progress'; prog.innerHTML = '<div class="pct">Loading ' + KF.Writer.formatBytes(file.size) + '...</div>'; document.body.appendChild(prog); }
    try {
      var result = await KF.Reader.loadFile(file, { onProgress: function(evt) { if (prog) prog.innerHTML = '<div class="pct">' + evt.message + '</div>'; }, passwordProvider: async function() { var pw = await showUnlockModal(); return pw === false ? false : pw; }, masterPassword: (typeof KRAFTED_MASTER_PASSWORD !== 'undefined') ? KRAFTED_MASTER_PASSWORD : null });
      var data = manifestToV4Restore(result.manifest); restoreBoard(data);
      var msg = 'Loaded ' + KF.Writer.formatBytes(file.size); if (result.restoredCount > 0) msg += ' (' + result.restoredCount + ' media restored)'; toast(msg);
    } catch (err) {
      if (err.message === 'Load cancelled by user' || err.message === 'Load cancelled') { toast('Load cancelled'); }
      else { console.error('[KraftedBridge] Load failed:', err); toast('Error loading: ' + (err.message || 'unknown error')); }
    } finally { try { prog && prog.remove(); } catch (e) {} event.target.value = ''; }
  };

  waitForKraftedState().then(function() {
    window._saveBoardLegacy = window.saveBoard; window._loadBoardFileLegacy = window.loadBoardFile;
    window.saveBoard = window.saveBoardV5; window.loadBoardFile = window.loadBoardFileV5;
    console.log('[KraftedBridge] Integration active — save/load now uses KraftedFormat engine.');
    console.log('[KraftedBridge] Schema v' + KF.Schema.VERSION + ' | ' + state.items.length + ' items on board.');
  });
})();