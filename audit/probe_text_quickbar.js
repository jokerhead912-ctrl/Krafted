// Measure, do not guess: the user reports that in the text quick bar the
// colour control is DISABLED (screenshot 2026-11-09), and wants the Label
// preset to allow choosing a colour. Also asked: check ALL quick-bar
// functions actually work.
//
// Reading says: disabled = !texts.some(tx => !tx.locked) (line ~24481) --
// so with one unlocked text selected NOTHING should be disabled. A reading
// and a report that disagree are exactly when you measure.
//
// This probe drives the REAL bar in real Chrome:
//   1. addText() -> select -> measure every control's disabled/mixed/value
//   2. click Label preset -> measure again -> try to set a colour
//   3. same for Title / Body presets
//   4. font / size / bold / align / tags / Done round-trips
//   5. a LOCKED text -> the whole bar must be disabled (sanity)
// Verdict lists every control that is disabled when it should not be.

const fs = require('fs');
const path = require('path');
const puppeteer = require('/Users/kincheung/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core');

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTML = process.env.KRAFTED_HTML || path.join(__dirname, '..', '..', 'kraftpub-dev.html');
const OUT = path.join(__dirname, 'results', 'probe_text_quickbar_' + (process.env.TAG || 'mac') + '.json');
const R = { html: HTML, startedAt: new Date().toISOString(), errors: [] };

function writeOut() {
  R.finishedAt = new Date().toISOString();
  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(R, null, 2)); }
  catch (e) { console.error('write failed: ' + e.message); }
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => R.errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') R.errors.push('console: ' + m.text()); });
    await page.goto('file://' + path.resolve(HTML), { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForFunction(() => typeof window.addText === 'function' && typeof window.applyBoardTextPreset === 'function', { timeout: 30000 });

    // Measure helper: runs INSIDE the page, reads the real DOM.
    const measure = () => page.evaluate(() => {
      const g = id => document.getElementById(id);
      const picker = g('tqb-custom-color');
      const one = el => el ? {
        disabled: !!el.disabled, value: el.value || null,
        mixed: el.dataset ? el.dataset.mixed : undefined,
        active: el.classList.contains('active'),
        visible: !!(el.offsetWidth || el.offsetHeight),
      } : null;
      const bar = g('text-quick-bar');
      const texts = (typeof selectedBoardTexts === 'function') ? selectedBoardTexts() : [];
      return {
        barActive: bar ? bar.classList.contains('active') : null,
        selectedTextCount: texts.length,
        lockedFlags: texts.map(t => !!t.locked),
        font: one(g('tqb-font')),
        size: one(g('tqb-size-input')),
        bold: one(g('tqb-bold')),
        colorPicker: one(picker),
        colorMixedLabelHidden: g('tqb-color-mixed') ? g('tqb-color-mixed').hidden : null,
        align: one(g('tqb-align')),
        presetTitle: one(document.querySelector('[data-text-preset="title"]')),
        presetBody: one(document.querySelector('[data-text-preset="body"]')),
        presetLabel: one(document.querySelector('[data-text-preset="label"]')),
        done: one(g('tqb-done')),
        tagsInput: one(g('tqb-tags')),
        item: (texts[0] || {}),
        itemStyle: texts[0] && texts[0].el ? {
          color: getComputedStyle(texts[0].el).color,
          fontWeight: getComputedStyle(texts[0].el).fontWeight,
          fontSize: getComputedStyle(texts[0].el).fontSize,
          bg: texts[0].bg, textPreset: texts[0].textPreset,
        } : null,
      };
    });

    // ---- Step 1: fresh text, selected, unlocked -------------------------
    await page.evaluate(() => {
      // start from a clean selection
      if (typeof clearSelection === 'function') try { clearSelection(); } catch (e) {}
      const tx = window.addText(200, 200, 'probe text', { noFocus: true });
      if (typeof selectOnly === 'function') selectOnly(tx.id);
      if (typeof syncBoardTextUI === 'function') syncBoardTextUI();
    });
    await new Promise(r => setTimeout(r, 250));
    R.step1_freshSelected = await measure();

    // ---- Step 2: click the real Label button, then try a colour --------
    await page.evaluate(() => { document.querySelector('[data-text-preset="label"]').click(); });
    await new Promise(r => setTimeout(r, 150));
    R.step2_afterLabel = await measure();
    // set colour through the same entry point the input's onchange uses
    R.step2_setColor = await page.evaluate(() => {
      const n = window.setTextProp('color', '#44ddff');
      if (typeof syncBoardTextUI === 'function') syncBoardTextUI();
      const t = selectedBoardTexts()[0];
      return { changed: n, color: t && t.color, computed: getComputedStyle(t.el).color };
    });
    await new Promise(r => setTimeout(r, 100));
    R.step2_afterSetColor = await measure();
    // and through the REAL input event, as the user would fire it
    R.step2_pickerEvent = await page.evaluate(() => {
      const p = document.getElementById('tqb-custom-color');
      p.disabled = false; // measure what the EVENT does, not the flag
      p.value = '#ff8800';
      p.dispatchEvent(new Event('change', { bubbles: true }));
      const t = selectedBoardTexts()[0];
      return { color: t && t.color, computed: getComputedStyle(t.el).color };
    });

    // ---- Step 3: Title and Body presets ---------------------------------
    await page.evaluate(() => { document.querySelector('[data-text-preset="title"]').click(); });
    await new Promise(r => setTimeout(r, 150));
    R.step3_afterTitle = await measure();
    await page.evaluate(() => { document.querySelector('[data-text-preset="body"]').click(); });
    await new Promise(r => setTimeout(r, 150));
    R.step3_afterBody = await measure();

    // ---- Step 4: the rest of the bar ------------------------------------
    R.step4_roundtrips = {};
    R.step4_roundtrips.size = await page.evaluate(() => {
      const inp = document.getElementById('tqb-size-input');
      inp.value = '40'; inp.dispatchEvent(new Event('change', { bubbles: true }));
      const t = selectedBoardTexts()[0];
      return { applied: t && t.size };
    });
    R.step4_roundtrips.font = await page.evaluate(() => {
      const sel = document.getElementById('tqb-font');
      const opt = Array.from(sel.options).find(o => o.value && o.value !== '');
      if (!opt) return { skipped: 'no font options' };
      sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
      const t = selectedBoardTexts()[0];
      return { tried: opt.value, applied: t && t.font };
    });
    R.step4_roundtrips.bold = await page.evaluate(() => {
      const before = selectedBoardTexts()[0].bold;
      document.getElementById('tqb-bold').click();
      return { before, after: selectedBoardTexts()[0].bold };
    });
    R.step4_roundtrips.align = await page.evaluate(() => {
      const sel = document.getElementById('tqb-align');
      sel.value = 'center'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { applied: selectedBoardTexts()[0].align };
    });
    R.step4_roundtrips.tags = await page.evaluate(() => {
      const inp = document.getElementById('tqb-tags');
      inp.value = 'qc-probe'; inp.dispatchEvent(new Event('change', { bubbles: true }));
      const btn = document.querySelector('#tqb-tag-controls [data-tag-mode="append"]');
      if (btn) btn.click();
      return { tags: selectedBoardTexts()[0].tags };
    });

    // ---- Step 5: locked text -> the bar SHOULD disable ------------------
    await page.evaluate(() => {
      const t = selectedBoardTexts()[0];
      t.locked = true;
      if (typeof syncBoardTextUI === 'function') syncBoardTextUI();
    });
    await new Promise(r => setTimeout(r, 120));
    R.step5_locked = await measure();
    await page.evaluate(() => {
      const t = selectedBoardTexts()[0]; if (t) t.locked = false;
      if (typeof syncBoardTextUI === 'function') syncBoardTextUI();
    });

    // ---- Verdict --------------------------------------------------------
    R.verdict = await page.evaluate(() => {
      const texts = selectedBoardTexts();
      const shouldDisable = !texts.some(t => !t.locked);
      const bad = [];
      document.querySelectorAll('#text-quick-bar [data-text-style-control]').forEach(el => {
        if (!shouldDisable && el.disabled && (el.offsetWidth || el.offsetHeight))
          bad.push(el.id || el.dataset.textPreset || el.tagName);
      });
      return { shouldDisable, visibleButDisabled: bad };
    });

    R.ok = R.verdict.visibleButDisabled.length === 0
      && R.step2_setColor.changed === 1
      && R.step2_pickerEvent.color === '#ff8800';
  } catch (e) {
    R.errors.push('fatal: ' + (e && e.message));
  } finally {
    await browser.close().catch(() => {});
    writeOut();
    console.log('verdict:', JSON.stringify(R.verdict));
    console.log('ok:', R.ok);
    if (R.errors.length) console.log('errors:', R.errors.slice(0, 6));
  }
})();
