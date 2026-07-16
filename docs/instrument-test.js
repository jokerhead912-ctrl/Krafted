const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  page.on('pageerror', err => { console.log('[PAGE]', err.message); });
  page.on('console', msg => { console.log('[' + msg.type() + ']', msg.text()); });

  await page.goto('https://jokerhead912-ctrl.github.io/Krafted/kraftpub.html', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  await page.evaluate(() => {
    const w = document.getElementById('welcome');
    if (w) { const btn = w.querySelector('button, .btn'); if (btn) btn.click(); }
  });
  await page.waitForTimeout(500);

  // ====== DEBUG: Instrument _handleFileDrop ======
  console.log('\n=== INSTRUMENTED DROP TEST ===');
  
  const debugResult = await page.evaluate(async () => {
    const log = [];
    const origHandleFileDrop = _handleFileDrop;
    
    // Override to add logging
    window._handleFileDrop = function(e, files) {
      log.push('_handleFileDrop called with ' + files.length + ' files');
      files.forEach((f, i) => log.push('  file[' + i + ']: name=' + f.name + ' type=' + f.type + ' size=' + f.size));
      
      // Check what addImage does
      const origAddImage = addImage;
      window.addImage = function(src, natW, natH, x, y, isVideo, isLast) {
        log.push('addImage called: isVideo=' + isVideo + ' w=' + natW + ' h=' + natH + ' x=' + x + ' y=' + y);
        const result = origAddImage(src, natW, natH, x, y, isVideo, isLast);
        log.push('addImage returned: ' + (result ? 'item id=' + result.id : 'null'));
        return result;
      };
      
      origHandleFileDrop(e, files);
    };
    
    // Now simulate a drop
    const c = document.createElement('canvas');
    c.width = 25; c.height = 25;
    c.getContext('2d').fillStyle = 'purple';
    c.getContext('2d').fillRect(0, 0, 25, 25);
    const b64 = c.toDataURL().split(',')[1];
    const bytes = new Uint8Array(b64.length);
    for (let i = 0; i < b64.length; i++) bytes[i] = b64.charCodeAt(i);
    const file = new File([bytes], 'debug.png', { type: 'image/png' });
    
    // Call directly
    _handleFileDrop({ clientX: 300, clientY: 200 }, [file]);
    
    // Wait a bit
    return new Promise((resolve) => {
      setTimeout(() => {
        log.push('After 2s: itemsCount=' + state.items.length);
        resolve(log);
      }, 2000);
    });
  });
  
  debugResult.forEach(l => console.log('  ' + l));
  
  const final = await page.evaluate(() => ({
    itemsCount: state.items.length,
    items: state.items.map(i => ({ id: i.id, x: i.x, y: i.y, w: i.w, h: i.h, isVideo: i.isVideo, hasImg: !!i.img })),
  }));
  console.log('Final:', JSON.stringify(final, null, 2));

  await browser.close();
})();
