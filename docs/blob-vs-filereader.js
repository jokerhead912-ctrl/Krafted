const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  page.on('pageerror', err => { console.log('[PAGE]', err.message); });

  await page.goto('https://jokerhead912-ctrl.github.io/Krafted/kraftpub.html', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  await page.evaluate(() => {
    const w = document.getElementById('welcome');
    if (w) { const btn = w.querySelector('button, .btn'); if (btn) btn.click(); }
  });
  await page.waitForTimeout(500);

  // ====== TEST: blob URL image loading ======
  console.log('\n=== BLOB URL IMAGE TEST ===');
  const blobTest = await page.evaluate(async () => {
    const results = [];
    
    // Create a canvas-based PNG
    const c = document.createElement('canvas');
    c.width = 30; c.height = 30;
    c.getContext('2d').fillStyle = 'red';
    c.getContext('2d').fillRect(0, 0, 30, 30);
    const dataUrl = c.toDataURL();
    
    // Convert to blob
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    results.push('blob created: size=' + blob.size + ' type=' + blob.type);
    
    const blobUrl = URL.createObjectURL(blob);
    results.push('blobUrl: ' + blobUrl);
    
    // Test 1: Image with blob URL
    const p1 = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve('blob-onload OK: ' + img.naturalWidth + 'x' + img.naturalHeight);
      img.onerror = () => resolve('blob-onerror FAILED');
      img.src = blobUrl;
      setTimeout(() => resolve('blob-timeout'), 3000);
    });
    
    // Test 2: Image with data URL
    const p2 = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve('data-onload OK: ' + img.naturalWidth + 'x' + img.naturalHeight);
      img.onerror = () => resolve('data-onerror FAILED');
      img.src = dataUrl;
      setTimeout(() => resolve('data-timeout'), 3000);
    });
    
    // Test 3: File -> blob -> Image
    const p3 = new Promise((resolve) => {
      const bytes = new Uint8Array(180);
      for (let i = 0; i < 180; i++) bytes[i] = 65 + (i % 26);
      const file = new File([bytes], 'test.png', { type: 'image/png' });
      const fu = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve('file-blob-onload OK: ' + img.naturalWidth + 'x' + img.naturalHeight);
      img.onerror = () => resolve('file-blob-onerror FAILED');
      img.src = fu;
      setTimeout(() => resolve('file-blob-timeout'), 3000);
    });
    
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    results.push(r1, r2, r3);
    
    URL.revokeObjectURL(blobUrl);
    
    return results;
  });
  blobTest.forEach(l => console.log('  ' + l));

  // ====== FIX: Use FileReader + data URL instead of blob URL ======
  console.log('\n=== FIXED DROP: FileReader approach ===');
  const fixedResult = await page.evaluate(async () => {
    const log = [];
    
    // Override _handleFileDrop to use FileReader
    const origHandleFileDrop = window._handleFileDrop;
    window._handleFileDrop = function(e, files) {
      log.push('fixed _handleFileDrop called with ' + files.length + ' files');
      
      const imageFiles = [];
      files.forEach((file, idx) => {
        if (file.type.startsWith('image/')) imageFiles.push({ file, idx });
      });
      
      const dropX0 = (e.clientX - state.pan.x) / state.zoom;
      const dropY0 = (e.clientY - state.pan.y) / state.zoom;
      
      if (imageFiles.length > 0) pushUndo();
      let imgIdx = 0;
      
      function processNextImage() {
        if (imgIdx >= imageFiles.length) { log.push('all images processed'); return; }
        const { file, idx } = imageFiles[imgIdx];
        const dropX = dropX0 + idx * 20;
        const dropY = dropY0 + idx * 20;
        const isLast = (imgIdx === imageFiles.length - 1);
        
        // Use FileReader instead of blob URL
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target.result;
          const img = new Image();
          img.onload = () => {
            log.push('image loaded via FileReader: ' + img.naturalWidth + 'x' + img.naturalHeight);
            addImage(dataUrl, img.naturalWidth, img.naturalHeight, dropX, dropY, false, isLast);
            imgIdx++;
            setTimeout(processNextImage, 30);
          };
          img.onerror = () => {
            log.push('image error via FileReader');
            imgIdx++;
            setTimeout(processNextImage, 30);
          };
          img.src = dataUrl;
        };
        reader.onerror = () => {
          log.push('FileReader error');
          imgIdx++;
          setTimeout(processNextImage, 30);
        };
        reader.readAsDataURL(file);
      }
      
      if (imageFiles.length > 0) processNextImage();
    };
    
    // Now drop
    const c = document.createElement('canvas');
    c.width = 40; c.height = 40;
    c.getContext('2d').fillStyle = 'orange';
    c.getContext('2d').fillRect(0, 0, 40, 40);
    const b64 = c.toDataURL().split(',')[1];
    const bytes = new Uint8Array(b64.length);
    for (let i = 0; i < b64.length; i++) bytes[i] = b64.charCodeAt(i);
    const file = new File([bytes], 'orange.png', { type: 'image/png' });
    
    _handleFileDrop({ clientX: 350, clientY: 250 }, [file]);
    
    return new Promise((resolve) => {
      setTimeout(() => {
        log.push('After 2s: items=' + state.items.length);
        resolve(log);
      }, 2000);
    });
  });
  
  fixedResult.forEach(l => console.log('  ' + l));
  
  const final = await page.evaluate(() => ({
    itemsCount: state.items.length,
  }));
  console.log('\nFinal items:', final.itemsCount);
  console.log(final.itemsCount > 0 ? '✅ FileReader approach WORKS!' : '❌ Still failed');

  await browser.close();
})();
