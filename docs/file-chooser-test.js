const { chromium } = require('playwright-core');
const fs = require('fs');

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

  // ====== REAL FILE DROP via file chooser ======
  console.log('=== REAL FILE DROP (file chooser) ===');
  
  // Create a real PNG file
  const testPng = '/tmp/krafted-drop-test/test-image.png';
  console.log('Test file:', testPng, '(' + fs.statSync(testPng).size + ' bytes)');
  
  // Create a file input and trigger it
  const [fileChooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 5000 }),
    page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.click();
      // Remove after use
      setTimeout(() => input.remove(), 5000);
    })
  ]);
  
  await fileChooser.setFiles(testPng);
  
  // Wait for load handler
  await page.waitForTimeout(2000);
  
  const afterUpload = await page.evaluate(() => ({
    itemsCount: state.items.length,
    items: state.items.map(i => ({ id: i.id, x: i.x, y: i.y, w: i.w, h: i.h, isVideo: i.isVideo })),
  }));
  console.log('After file chooser:', JSON.stringify(afterUpload));

  // ====== Check: does the page have a file input handler? ======
  console.log('\n=== FILE INPUT HANDLER CHECK ===');
  const inputHandlerCheck = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="file"]');
    const hiddenInputs = [...inputs].map(i => ({ 
      id: i.id, 
      className: i.className, 
      onChange: !!i.onchange,
      accept: i.accept 
    }));
    return {
      fileInputs: hiddenInputs,
      loadBoardExists: typeof loadBoard === 'function',
      loadBoardFileExists: typeof loadBoardFile === 'function',
    };
  });
  console.log(JSON.stringify(inputHandlerCheck, null, 2));

  // If no file input handler, add one for testing
  if (afterUpload.itemsCount === 0) {
    console.log('No file input handler found. Adding temporary one...');
    const result = await page.evaluate(() => {
      // Create a hidden file input and add change listener that calls _handleFileDrop
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'image/*,video/*,audio/*';
      input.style.position = 'fixed';
      input.style.top = '0';
      input.style.left = '0';
      input.style.opacity = '0';
      input.style.zIndex = '99999';
      input.id = 'krafted-file-input';
      document.body.appendChild(input);
      
      input.addEventListener('change', (e) => {
        const files = [...e.target.files];
        if (files.length > 0) {
          _handleFileDrop({ clientX: 500, clientY: 300 }, files);
        }
        input.value = ''; // reset so same file can be selected again
      });
      
      return { inputAdded: true, inputId: input.id };
    });
    console.log(JSON.stringify(result));
    
    // Now try again with file chooser
    const [fc2] = await Promise.all([
      page.waitForFileChooser({ timeout: 5000 }),
      page.evaluate(() => {
        const input = document.getElementById('krafted-file-input');
        if (input) input.click();
      })
    ]);
    await fc2.setFiles(testPng);
    await page.waitForTimeout(3000);
    
    const after2 = await page.evaluate(() => ({
      itemsCount: state.items.length,
      items: state.items.map(i => ({ id: i.id, w: i.w, h: i.h })),
    }));
    console.log('After file input drop:', JSON.stringify(after2));
    
    if (after2.itemsCount > 0) {
      console.log('✅ Real file via file input WORKS — issue is ONLY with drag-and-drop event');
    }
  }

  await browser.close();
})();
