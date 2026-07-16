const { chromium } = require('playwright-core');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const errors = [];
  page.on('pageerror', err => { errors.push(err.message); });
  const consoleLogs = [];
  page.on('console', msg => { 
    if (msg.type() === 'error' || msg.type() === 'warning') 
      consoleLogs.push('[' + msg.type() + '] ' + msg.text()); 
  });

  await page.goto('https://jokerhead912-ctrl.github.io/Krafted/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  console.log('=== PAGE LOADED ===');
  console.log('Title:', await page.title());
  console.log('URL:', page.url());
  console.log('Errors:', errors.length);
  console.log('Console:', consoleLogs.length);
  consoleLogs.forEach(l => console.log(l));
  
  // Dismiss welcome
  await page.evaluate(() => {
    const w = document.getElementById('welcome');
    if (w) { const btn = w.querySelector('button, .btn'); if (btn) btn.click(); }
  });
  await page.waitForTimeout(500);

  // ====== CHECK DROP HANDLERS ======
  console.log('\n=== DROP HANDLER CHECK ===');
  const handlerCheck = await page.evaluate(() => {
    const vp = document.getElementById('viewport');
    const w = document.getElementById('welcome');
    
    // Test dragover on welcome
    const dt1 = new DataTransfer();
    dt1.items.add(new File(['x'], 'x.png', { type: 'image/png' }));
    const evt1 = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt1 });
    if (w) w.dispatchEvent(evt1);
    
    // Test dragover on viewport
    const dt2 = new DataTransfer();
    dt2.items.add(new File(['y'], 'y.png', { type: 'image/png' }));
    const evt2 = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt2 });
    if (vp) vp.dispatchEvent(evt2);
    
    // Test _isFileDrag
    const isfd1 = typeof _isFileDrag === 'function' ? _isFileDrag(evt1) : 'no _isFileDrag';
    
    return {
      hasViewport: !!vp,
      hasWelcome: !!w,
      welcomeDragoverPrevented: evt1.defaultPrevented,
      viewportDragoverPrevented: evt2.defaultPrevented,
      isFileDragResult: isfd1,
      hasHandleFileDrop: typeof _handleFileDrop === 'function',
      hasHandleEntryDrop: typeof _handleEntryDrop === 'function',
      viewportDropListener: !!vp?.ondrop || true, // can't directly check
      welcomeDropListener: !!w?.ondrop || true,
    };
  });
  console.log(JSON.stringify(handlerCheck, null, 2));

  // ====== TEST IMAGE DROP ======
  console.log('\n=== IMAGE DROP TEST ===');
  const imgResult = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 30; c.height = 30;
    c.getContext('2d').fillStyle = 'blue';
    c.getContext('2d').fillRect(0, 0, 30, 30);
    const b64 = c.toDataURL().split(',')[1];
    const bytes = new Uint8Array(b64.length);
    for (let i = 0; i < b64.length; i++) bytes[i] = b64.charCodeAt(i);
    
    const file = new File([bytes], 'test.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    
    // Simulate full drag sequence: dragenter → dragover → drop
    const vp = document.getElementById('viewport');
    const w = document.getElementById('welcome');
    
    // dragenter on document
    const de = new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt });
    document.dispatchEvent(de);
    
    // dragover on viewport
    const dv = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
    if (vp) vp.dispatchEvent(dv);
    
    // drop on viewport
    const dp = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 500, clientY: 300 });
    if (vp) vp.dispatchEvent(dp);
    
    return {
      dragenterPrevented: de.defaultPrevented,
      viewportDragoverPrevented: dv.defaultPrevented,
      dropPrevented: dp.defaultPrevented,
      filesInDT: dt.files.length,
      itemsInDT: dt.items.length,
      itemKind: dt.items[0]?.kind,
    };
  });
  console.log(JSON.stringify(imgResult, null, 2));
  
  // Wait for async image processing
  await page.waitForTimeout(2500);
  
  const afterImg = await page.evaluate(() => ({
    itemsCount: state.items.length,
    imageItems: state.items.filter(i => !i.isVideo && !i.isAudio).length,
  }));
  console.log('After image drop:', JSON.stringify(afterImg));

  // ====== TEST VIDEO DROP ======
  console.log('\n=== VIDEO DROP TEST ===');
  const vidBuf = fs.readFileSync('/tmp/krafted-drop-test/test-video.mp4');
  const vidResult = await page.evaluate((b64) => {
    const bytes = new Uint8Array(b64.length);
    for (let i = 0; i < b64.length; i++) bytes[i] = b64.charCodeAt(i);
    const file = new File([bytes], 'test.mp4', { type: 'video/mp4' });
    const dt = new DataTransfer();
    dt.items.add(file);
    
    const vp = document.getElementById('viewport');
    const dp = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 600, clientY: 400 });
    if (vp) vp.dispatchEvent(dp);
    
    return { dropPrevented: dp.defaultPrevented, filesInDT: dt.files.length };
  }, vidBuf.toString('base64'));
  
  await page.waitForTimeout(3000);
  
  const afterVid = await page.evaluate(() => ({
    itemsCount: state.items.length,
    videoItems: state.items.filter(i => i.isVideo).length,
    imageItems: state.items.filter(i => !i.isVideo && !i.isAudio).length,
  }));
  console.log('After video drop:', JSON.stringify(afterVid));
  console.log('Video drop result:', JSON.stringify(vidResult));

  // ====== CHECK VIEWPORT DROP CODE ======
  console.log('\n=== VIEWPORT DROP LISTENER ===');
  const vpDropCheck = await page.evaluate(() => {
    const vp = document.getElementById('viewport');
    // Check if drop fires correctly by looking at the source
    // Read the drop handler from the actual page
    const scripts = [...document.querySelectorAll('script')];
    // Can't read inline script content via DOM, but can check if handler exists
    return {
      vpExists: !!vp,
      vpId: vp?.id,
      vpStyle: vp ? {
        pointerEvents: window.getComputedStyle(vp).pointerEvents,
        zIndex: window.getComputedStyle(vp).zIndex,
        position: window.getComputedStyle(vp).position,
        width: window.getComputedStyle(vp).width,
        height: window.getComputedStyle(vp).height,
      } : null,
    };
  });
  console.log(JSON.stringify(vpDropCheck, null, 2));

  // ====== CHECK WELCOME DROP LISTENER ======
  console.log('\n=== WELCOME DROP TEST ===');
  const welcomeDrop = await page.evaluate(() => {
    // Reset welcome to visible
    const w = document.getElementById('welcome');
    if (!w) return { error: 'no welcome' };
    w.style.display = 'flex';
    w.classList.remove('fading');
    
    const c = document.createElement('canvas');
    c.width = 20; c.height = 20;
    c.getContext('2d').fillStyle = 'green';
    c.getContext('2d').fillRect(0, 0, 20, 20);
    const b64 = c.toDataURL().split(',')[1];
    const bytes = new Uint8Array(b64.length);
    for (let i = 0; i < b64.length; i++) bytes[i] = b64.charCodeAt(i);
    const file = new File([bytes], 'green.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    
    // Drop directly on welcome
    const dp = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 400, clientY: 200 });
    w.dispatchEvent(dp);
    
    return {
      dropPrevented: dp.defaultPrevented,
      welcomeDisplay: window.getComputedStyle(w).display,
    };
  });
  console.log(JSON.stringify(welcomeDrop, null, 2));
  
  await page.waitForTimeout(2000);
  const afterWelcome = await page.evaluate(() => ({
    itemsCount: state.items.length,
  }));
  console.log('After welcome drop:', JSON.stringify(afterWelcome));

  // ====== FINAL SUMMARY ======
  console.log('\n========================================');
  console.log('TOTAL ITEMS:', afterWelcome.itemsCount);
  console.log('PAGE ERRORS:', errors.length);
  errors.forEach(e => console.log('  ERROR:', e));
  consoleLogs.filter(l => l.includes('error')).forEach(l => console.log('  CONSOLE:', l));
  
  await browser.close();
})();
