/*
 * diag_proxy_pair_v7_27_0.js — READ-ONLY probe (diagnostic, not a suite).
 *
 * Question: does dropping an original + its proxy produce ONE card, marked as
 * a proxy, remembering the original?
 *
 * Why this has to be run in a real browser: test_v7_26_1.js proves
 * planProxyPairs() computes the right plan and proves the drop handler is
 * wired to it. It cannot prove the whole thing end to end, and the failure
 * mode here is the bad kind — a file silently not becoming a card, which
 * looks identical to "the app ignored my file".
 *
 * Run:
 *   NODE_PATH=/Users/kincheung/.workbuddy/binaries/node/workspace/node_modules \
 *     /Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node \
 *     Krafted/tests/diag_proxy_pair_v7_27_0.js
 */
'use strict';

const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTML = process.env.KRAFTED_HTML
  ? path.resolve(process.env.KRAFTED_HTML)
  : path.resolve(__dirname, '../../kraftpub-dev.html');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files',
           '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 1512, height: 900 },
  });
  const page = await browser.newPage();
  page.on('pageerror', () => {});
  await page.goto('file://' + HTML, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.state && window.state.items, { timeout: 60000 });

  console.log('Krafted proxy-pair probe — ' + path.basename(HTML) + '\n');

  async function drop(names) {
    await page.evaluate(() => { window.state.items.length = 0; });
    return page.evaluate(async (names) => {
      const dt = new DataTransfer();
      for (const n of names) {
        // A tiny but real webm-ish blob with the right MIME so it is routed
        // down the video chain, which is where the pairing lives.
        const blob = new Blob([new Uint8Array([26, 69, 223, 163, 1, 0, 0, 0])], { type: 'video/webm' });
        dt.items.add(new File([blob], n, { type: 'video/webm' }));
      }
      const target = document.getElementById('viewport') || document.body;
      target.dispatchEvent(new DragEvent('drop', {
        dataTransfer: dt, bubbles: true, cancelable: true, clientX: 700, clientY: 450,
      }));
      await new Promise(r => setTimeout(r, 2500));
      return window.state.items.map(i => ({
        name: i.name || i.filename || '',
        isProxy: !!i.isProxy,
        originalName: i.originalName || '',
      }));
    }, names);
  }

  function report(label, items, expect) {
    console.log(label);
    items.forEach(i => console.log('   card: ' + (i.name || '(unnamed)') +
      (i.isProxy ? '  [PROXY -> ' + (i.originalName || 'none') + ']' : '')));
    let okCount = true;
    if (items.length !== expect.cards) { okCount = false; }
    const msg = '   -> ' + items.length + ' card(s), expected ' + expect.cards +
      (expect.proxy ? ', marked PROXY' : '') +
      (expect.original ? ', original=' + expect.original : '');
    if (expect.proxy && !(items.length === 1 && items[0].isProxy)) okCount = false;
    if (expect.original && !(items.length === 1 && items[0].originalName === expect.original)) okCount = false;
    console.log(msg + '   ' + (okCount ? 'OK' : 'MISMATCH'));
    return okCount;
  }

  let allOk = true;

  // 1. original + proxy together -> ONE card, the proxy, remembering the original
  let items = await drop(['shot01.mov', 'shot01_proxy.mp4']);
  allOk = report('1. drop  shot01.mov + shot01_proxy.mp4', items,
                 { cards: 1, proxy: true, original: 'shot01.mov' }) && allOk;

  // 2. the proxy on its own -> still a card, still marked, but no original
  items = await drop(['shot02_proxy.mp4']);
  allOk = report('2. drop  shot02_proxy.mp4 (alone)', items,
                 { cards: 1, proxy: true, original: '' }) && allOk;

  // 3. two unrelated clips -> two cards, nothing marked
  items = await drop(['a.mov', 'b.mov']);
  allOk = report('3. drop  a.mov + b.mov (no proxies)', items, { cards: 2 }) && allOk;

  // 4. a proxy whose original is not in the batch -> the original is untouched
  items = await drop(['shot03_proxy.mp4', 'other.mov']);
  allOk = report('4. drop  shot03_proxy.mp4 + other.mov', items, { cards: 2 }) && allOk;

  console.log('\nPROXY PAIRING ' + (allOk ? 'PASS' : 'FAIL'));
  await browser.close();
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.log('PROBE FAILED: ' + (e && e.message)); process.exit(1); });
