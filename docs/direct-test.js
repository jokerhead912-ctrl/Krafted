const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const errors = [];
  page.on('pageerror', err => { console.log('[PAGE]', err.message); errors.push(err.message); });
  page.on('console', msg => { console.log('[' + msg.type() + ']', msg.text()); });

  await page.goto('https://jokerhead912-ctrl.github.io/Krafted/kraftpub.html', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  // Dismiss welcome
  await page.evaluate(() => {
    const w = document.getElementById('welcome');
    if (w) { const btn = w.querySelector('button, .btn'); if (btn) btn.click(); }
  });
  await page.waitForTimeout(500);

  // ====== DIRECT TEST: addImage ======
  console.log('\n=== DIRECT addImage TEST ===');
  const directAdd = await page.evaluate(() => {
    // Test: can we call addImage directly?
    const c = document.createElement('canvas');
    c.width = 50; c.height = 50;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'red';
    ctx.fillRect(0, 0, 50, 50);
    const blobUrl = c.toDataURL();
    
    try {
      addImage(blobUrl, 50, 50, 200, 200, false);
      return {
        addImageExists: typeof addImage === 'function',
        itemsAfter: state.items.length,
        firstItem: state.items[0] ? { x: state.items[0].x, y: state.items[0].y, w: state.items[0].w, h: state.items[0].h } : null,
      };
    } catch(e) {
      return { error: e.message, stack: e.stack };
    }
  });
  console.log('Direct addImage:', JSON.stringify(directAdd, null, 2));

  if (directAdd.itemsAfter === 0) {
    console.log('❌ addImage FAILED — function exists but no items created');
  } else {
    console.log('✅ addImage works');
  }

  // ====== TEST: _handleFileDrop directly ======
  console.log('\n=== DIRECT _handleFileDrop TEST ===');
  const directDrop = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 30; c.height = 30;
    c.getContext('2d').fillStyle = 'green';
    c.getContext('2d').fillRect(0, 0, 30, 30);
    const b64 = c.toDataURL().split(',')[1];
    const bytes = new Uint8Array(b64.length);
    for (let i = 0; i < b64.length; i++) bytes[i] = b64.charCodeAt(i);
    const file = new File([bytes], 'green.png', { type: 'image/png' });
    
    const beforeCount = state.items.length;
    
    try {
      _handleFileDrop({ clientX: 400, clientY: 300 }, [file]);
      return { 
        beforeCount, 
        _handleFileDropExists: typeof _handleFileDrop === 'function',
        called: true 
      };
    } catch(e) {
      return { error: e.message, stack: e.stack };
    }
  });
  console.log('Direct drop:', JSON.stringify(directDrop, null, 2));
  
  // Wait for async processing
  await page.waitForTimeout(2000);
  
  const afterDirect = await page.evaluate(() => ({
    itemsCount: state.items.length,
    items: state.items.map(i => ({ id: i.id, x: i.x, y: i.y, isVideo: i.isVideo })),
  }));
  console.log('After direct drop:', JSON.stringify(afterDirect, null, 2));

  // ====== TEST: Image onload in headless ======
  console.log('\n=== IMAGE ONLOAD TEST ===');
  const imgOnload = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const c = document.createElement('canvas');
      c.width = 20; c.height = 20;
      c.getContext('2d').fillStyle = 'blue';
      c.getContext('2d').fillRect(0, 0, 20, 20);
      const dataUrl = c.toDataURL();
      
      const img = new Image();
      img.onload = () => {
        resolve({ 
          onloadFired: true, 
          naturalWidth: img.naturalWidth, 
          naturalHeight: img.naturalHeight 
        });
      };
      img.onerror = (e) => {
        resolve({ onloadFired: false, onerrorFired: true, error: 'Image load failed' });
      };
      img.src = dataUrl;
      
      setTimeout(() => {
        resolve({ timeout: true });
      }, 3000);
    });
  });
  console.log('Image onload:', JSON.stringify(imgOnload));

  await browser.close();
})();
