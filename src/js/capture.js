
import { state, G, captureBox, captureOverlay, captureHint, captureResultPanel, captureResultImg, captureResultInfo, canvas, canvasContent, viewport } from './core-state.js';
import { toast } from './ui-utils.js';
import { scheduleAutoSave } from './save-load.js';
import { addImage } from './add-items.js';
import { setTool } from './tools.js';

// ============================================================
//  CAPTURE AREA — drag to select, then capture as PNG
// ============================================================
export function updateCapture(e) {
  if (!G.captureDrag) return;
  const x1 = Math.min(G.captureDrag.startX, e.clientX);
  const y1 = Math.min(G.captureDrag.startY, e.clientY);
  const w = Math.abs(e.clientX - G.captureDrag.startX);
  const h = Math.abs(e.clientY - G.captureDrag.startY);

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

export function finishCapture(e) {
  if (!G.captureDrag) return;
  const x1 = Math.min(G.captureDrag.startX, e.clientX);
  const y1 = Math.min(G.captureDrag.startY, e.clientY);
  const w = Math.abs(e.clientX - G.captureDrag.startX);
  const h = Math.abs(e.clientY - G.captureDrag.startY);
  captureBox.style.display = 'none';
  captureOverlay.style.display = 'none';
  G.captureDrag = null;
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

export function captureArea(sx, sy, sw, sh) {
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
  // High-res capture: scale=2 doubles the output resolution so images
  // and text stay sharp when the user pastes the capture into a doc or
  // opens it full-screen. The on-screen crop rectangle still shows the
  // 1:1 pixel dimensions — the 2x scale only affects the exported PNG.
  const scale = 2;
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
  G.drawStrokes.forEach(stroke => {
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
  G.captureResultCanvas = cv;

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

export function saveCaptureResult() {
  if (!G.captureResultCanvas) return;
  try {
    const link = document.createElement('a');
    link.download = 'krafted_capture_' + Date.now() + '.png';
    link.href = G.captureResultCanvas.toDataURL('image/png');
    link.click();
    toast('Saved as PNG');
  } catch(e) {
    toast('Cannot save — canvas tainted by cross-origin image');
  }
  captureResultPanel.classList.remove('show');
  G.captureResultCanvas = null;
  // Reset preview image display for next capture
  captureResultImg.style.display = '';
}

export function discardCaptureResult() {
  captureResultPanel.classList.remove('show');
  G.captureResultCanvas = null;
  // Clear clipboard image if possible
  try { navigator.clipboard.writeText(''); } catch(e) {}
  toast('Capture discarded');
}

// Drop the captured canvas directly onto the board as a new image item.
// This is the "paste the capture result" workflow — but unlike the
// Ctrl+V round-trip (which can fail if the system clipboard write was
// blocked, e.g. on file:// in some Chrome versions, or if the user
// pressed Ctrl+V before the async clipboard write finished), this path
// uses the live G.captureResultCanvas in memory. The result: a single
// click, no race conditions, no clipboard permission prompts.
//
// Position: the captured image is dropped at the cursor's world
// coordinates (same as paste), so the user can mouse over to where
// they want the capture to land, click the button, and it's there.
export function pasteCaptureToBoard() {
  if (!G.captureResultCanvas) { toast('No capture to paste'); return; }
  let dataUrl;
  try {
    dataUrl = G.captureResultCanvas.toDataURL('image/png');
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
    G.captureResultCanvas = null;
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
export function getPasteXY() {
  return {
    x: (G.lastScreenX - state.pan.x) / state.zoom,
    y: (G.lastScreenY - state.pan.y) / state.zoom
  };
}

// Helper: toggle "capturing" mode — hides all media UI (per-item controls bar,
// type badge, global media player) so they don't bleed into the captured image
// or screen capture. CSS rule at body.capturing handles the actual hiding.
export function setCaptureMode(on) {
  document.body.classList.toggle('capturing', !!on);
}

export async function captureScreen() {
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

