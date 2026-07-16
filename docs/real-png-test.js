const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://jokerhead912-ctrl.github.io/Krafted/kraftpub.html', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  await page.evaluate(() => {
    const w = document.getElementById('welcome');
    if (w) { const btn = w.querySelector('button, .btn'); if (btn) btn.click(); }
  });
  await page.waitForTimeout(500);

  // ====== PRECISE TEST: File with REAL PNG bytes ======
  console.log('=== REAL PNG FILE TEST ===');
  const realTest = await page.evaluate(async () => {
    const log = [];
    
    // Create a REAL PNG via canvas
    const c = document.createElement('canvas');
    c.width = 30; c.height = 30;
    c.getContext('2d').fillStyle = '#ff00ff';
    c.getContext('2d').fillRect(0, 0, 30, 30);
    const dataUrl = c.toDataURL('image/png'); // real PNG
    
    // Method A: File from REAL bytes
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    log.push('blob size: ' + blob.size + ' type: ' + blob.type);
    
    // Create File from blob
    const fileFromBlob = new File([blob], 'real.png', { type: 'image/png' });
    const fileBlobUrl = URL.createObjectURL(fileFromBlob);
    
    const pA = new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve('A: File(real-blob) onload OK: ' + img.naturalWidth + 'x' + img.naturalHeight);
      img.onerror = () => resolve('A: File(real-blob) onerror FAILED');
      img.src = fileBlobUrl;
      setTimeout(() => resolve('A: timeout'), 3000);
    });
    
    // Method B: File from base64-decoded bytes
    const b64 = dataUrl.split(',')[1];
    const binStr = atob(b64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
    const fileFromBytes = new File([bytes], 'frombytes.png', { type: 'image/png' });
    const bytesBlobUrl = URL.createObjectURL(fileFromBytes);
    
    const pB = new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve('B: File(bytes) onload OK: ' + img.naturalWidth + 'x' + img.naturalHeight);
      img.onerror = () => resolve('B: File(bytes) onerror FAILED');
      img.src = bytesBlobUrl;
      setTimeout(() => resolve('B: timeout'), 3000);
    });
    
    // Method C: Direct blob URL (not wrapped in File)
    const directBlobUrl = URL.createObjectURL(blob);
    const pC = new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve('C: Direct blob onload OK: ' + img.naturalWidth + 'x' + img.naturalHeight);
      img.onerror = () => resolve('C: Direct blob onerror FAILED');
      img.src = directBlobUrl;
      setTimeout(() => resolve('C: timeout'), 3000);
    });
    
    const results = await Promise.all([pA, pB, pC]);
    log.push(...results);
    
    // Now test: does processNextImage work with real PNG?
    // Override and test
    const origHandleFileDrop = _handleFileDrop;
    
    return new Promise((resolve) => {
      // Instrument addImage
      const origAddImage = addImage;
      window.addImage = function() {
        log.push('addImage called: ' + JSON.stringify([...arguments].slice(0, 5)));
        return origAddImage.apply(this, arguments);
      };
      
      // Call with real PNG file
      _handleFileDrop({ clientX: 500, clientY: 300 }, [fileFromBlob]);
      
      setTimeout(() => {
        log.push('items after 3s: ' + state.items.length);
        resolve(log);
      }, 3000);
    });
  });
  
  realTest.forEach(l => console.log('  ' + l));

  await browser.close();
})();
