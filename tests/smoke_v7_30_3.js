#!/usr/bin/env node
/**
 * smoke_v7_30_3.js — LIVE browser check of the text quick-bar fixes.
 *
 * THE USER'S REPORT (screenshot 2026-11-09): a Label text card was selected,
 * the quick bar was up, and the colour control was dead. They also asked for
 * a way to choose the Label's BACKGROUND colour, and to "check all these
 * functions are ok to use".
 *
 * WHAT THE PROBE MEASURED BEFORE THIS FIX (probe_text_quickbar.js):
 *   - On an UNLOCKED selected text, nothing is disabled and every control
 *     round-trips (font/size/bold/colour/align/presets/tags). Colour works
 *     through both setTextProp and a real change event. So the bar itself
 *     was never broken.
 *   - On a LOCKED selected text, the whole bar goes disabled with ZERO
 *     explanation -- exactly the screenshot. routeBoardTextMouse (line ~12179)
 *     selects locked cards happily, so this state is easy to reach and
 *     impossible to diagnose from the UI.
 *   - The Label background (highlightColor) had NO picker anywhere reachable:
 *     the only one lives in the old top toolbar, which shows only when the
 *     text tool is active AND nothing is selected.
 *
 * THE FIX UNDER TEST (v7.30.3):
 *   1. lock note + Unlock button in the bar when every selected text card
 *      is locked;
 *   2. a BG colour picker (tqb-hl-color) that writes highlightColor;
 *   3. both pickers share one sync helper, so mixed-state rendering cannot
 *      drift between them.
 *
 * This smoke drives the REAL bar in real Chrome and asserts on real
 * consequences: computed colours, disabled flags, the note's visibility,
 * and a click on the real Unlock button.
 *
 * USAGE   node Krafted/tests/smoke_v7_30_3.js
 * EXIT    0 all pass · 1 failure · 2 could not run
 */

'use strict';

const path = require('path');
const fs = require('fs');
const puppeteer = require('/Users/kincheung/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core');

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTML = process.env.KRAFTED_HTML || path.join(__dirname, '..', '..', 'kraftpub-dev.html');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; failures.push(name + (detail ? ' — ' + JSON.stringify(detail) : '')); console.log('  FAIL ' + name + (detail ? ' — ' + JSON.stringify(detail) : '')); }
}

async function main() {
  if (!fs.existsSync(HTML)) { console.log('cannot run: missing ' + HTML); return 2; }
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
    defaultViewport: { width: 1600, height: 1000 },
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('file://' + path.resolve(HTML), { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForFunction(() => typeof window.addText === 'function', { timeout: 30000 });

    const measure = () => page.evaluate(() => {
      const g = id => document.getElementById(id);
      const one = el => el ? { disabled: !!el.disabled, value: el.value || null,
        mixed: el.dataset ? el.dataset.mixed : undefined,
        visible: !!(el.offsetWidth || el.offsetHeight) } : null;
      const texts = selectedBoardTexts();
      return {
        selected: texts.length, locked: texts.map(t => !!t.locked),
        color: one(g('tqb-custom-color')), hl: one(g('tqb-hl-color')),
        hlMixedHidden: g('tqb-hl-mixed') ? g('tqb-hl-mixed').hidden : null,
        lockNoteHidden: g('tqb-lock-note') ? g('tqb-lock-note').hidden : null,
        item: texts[0] ? { color: texts[0].color, hl: texts[0].highlightColor,
          bg: texts[0].bg, preset: texts[0].textPreset,
          computedColor: getComputedStyle(texts[0].el).color,
          computedBg: getComputedStyle(texts[0].el).backgroundColor } : null,
      };
    });

    // ---- 1. fresh unlocked text: everything alive ------------------------
    await page.evaluate(() => {
      const tx = window.addText(200, 200, 'smoke label', { noFocus: true });
      selectOnly(tx.id);
      syncBoardTextUI();
    });
    await new Promise(r => setTimeout(r, 200));
    let m = await measure();
    check('fresh text is selected and unlocked', m.selected === 1 && m.locked[0] === false, m);
    check('text colour picker enabled', m.color && !m.color.disabled, m.color);
    check('BG colour picker exists and enabled', m.hl && !m.hl.disabled, m.hl);
    check('lock note hidden on unlocked card', m.lockNoteHidden === true, m.lockNoteHidden);

    // ---- 2. Label preset + BG colour choice ------------------------------
    await page.evaluate(() => { document.querySelector('[data-text-preset="label"]').click(); });
    await new Promise(r => setTimeout(r, 120));
    m = await measure();
    check('Label preset applied (bg on, preset=label)', m.item && m.item.bg === true && m.item.preset === 'label', m.item);
    check('after Label, text colour picker STILL enabled (the reported bug)', m.color && !m.color.disabled, m.color);
    check('BG picker shows the label default #ffff00', m.hl && m.hl.value.toLowerCase() === '#ffff00', m.hl);
    // user picks a bg colour through the REAL input event
    await page.evaluate(() => {
      const p = document.getElementById('tqb-hl-color');
      p.value = '#ff8800';
      p.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 120));
    m = await measure();
    check('BG picker change writes highlightColor', m.item && m.item.hl === '#ff8800', m.item);
    check('label background really renders the picked colour (alpha 0x88)',
      m.item && m.item.computedBg === 'rgba(255, 136, 0, 0.533)', m.item && m.item.computedBg);

    // ---- 3. text colour still works alongside ----------------------------
    await page.evaluate(() => {
      const p = document.getElementById('tqb-custom-color');
      p.value = '#44ddff';
      p.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 100));
    m = await measure();
    check('text colour change still applies', m.item && m.item.color === '#44ddff'
      && m.item.computedColor === 'rgb(68, 221, 255)', m.item);

    // ---- 4. locked card: dead bar now EXPLAINS itself ---------------------
    await page.evaluate(() => {
      selectedBoardTexts()[0].locked = true;
      syncBoardTextUI();
    });
    await new Promise(r => setTimeout(r, 120));
    m = await measure();
    check('locked card: text picker disabled', m.color && m.color.disabled, m.color);
    check('locked card: BG picker disabled', m.hl && m.hl.disabled, m.hl);
    check('locked card: lock note VISIBLE', m.lockNoteHidden === false, m.lockNoteHidden);
    const unlockEnabled = await page.evaluate(() => {
      const b = document.getElementById('tqb-unlock');
      return b && !b.disabled && !!(b.offsetWidth || b.offsetHeight);
    });
    check('Unlock button itself is clickable', unlockEnabled === true, unlockEnabled);

    // ---- 5. the real Unlock click revives the bar ------------------------
    await page.evaluate(() => { document.getElementById('tqb-unlock').click(); });
    await new Promise(r => setTimeout(r, 150));
    m = await measure();
    check('Unlock click clears the lock', m.locked[0] === false, m.locked);
    check('after unlock the text picker is enabled again', m.color && !m.color.disabled, m.color);
    check('after unlock the lock note hides again', m.lockNoteHidden === true, m.lockNoteHidden);
    // and the bar still works end to end after the round trip
    await page.evaluate(() => {
      const p = document.getElementById('tqb-custom-color');
      p.value = '#ff4444';
      p.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 100));
    m = await measure();
    check('colour change works after unlock round trip', m.item && m.item.color === '#ff4444', m.item);

    check('no page errors during the whole run', errors.length === 0, errors.slice(0, 3));

    console.log('');
    if (fail) {
      console.log('smoke_v7_30_3: ' + fail + ' failed');
      failures.forEach(f => console.log('  - ' + f));
      return 1;
    }
    console.log('ALL PASS (' + pass + ' assertions)');
    return 0;
  } finally {
    await browser.close().catch(() => {});
  }
}

main().then(rc => process.exit(rc)).catch(e => {
  console.log('smoke_v7_30_3 crashed: ' + (e && e.message || e));
  process.exit(2);
});
