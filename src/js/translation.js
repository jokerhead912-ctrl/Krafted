import { getSelectedItems } from './selection.js';
import { state } from './core-state.js';
import { toast } from './ui-utils.js';
import { scheduleAutoSave } from './save-load.js';
import { getEditingText } from './text-style.js';
import { autoGrowTextItem } from './add-items.js';
import { pushUndo } from './undo-redo.js';

// ============================================================
//  TRANSLATE (EN ↔ ZH, multi-API with cache for instant repeat)
// ============================================================
const translationCache = new Map(); // "from|to|text" -> translation
export async function translateSelectedText(fromLang, toLang) {
  // Support translating the currently-edited text item, or selected text items
  let sel;
  const focusedEl = document.activeElement;
  if (focusedEl && focusedEl.classList && focusedEl.classList.contains('text-item')) {
    const tx = state.texts.find(t => t.el === focusedEl);
    if (tx) sel = [tx];
  }
  if (!sel || sel.length === 0) {
    sel = getSelectedItems().filter(i => i.el && i.el.classList.contains('text-item'));
  }
  if (!sel || sel.length === 0) {
    // Last fallback: find the currently editing text item
    const editingTx = getEditingText();
    if (editingTx) sel = [editingTx];
  }
  if (sel.length === 0) { toast('Select or edit a text item first'); return; }

  // Show loading on all translate buttons (toolbar, quick-bar, props panel)
  const btns = document.querySelectorAll('#ts-translate, #tqb-translate, [onclick*="translateSelectedText"]');
  const origTexts = new Map();
  btns.forEach(b => { origTexts.set(b, b.textContent); b.textContent = '⏳'; b.disabled = true; });

  const langLabel = (toLang === 'zh' || toLang === 'zh-CN') ? '中文' : 'English';
  let translatedCount = 0;
  let skippedEmpty = 0;
  try {
    // Translate in parallel (faster when multiple items selected)
    await Promise.all(sel.map(async (tx) => {
      const originalText = tx.el.textContent;
      const text = originalText.trim();
      if (!text) { skippedEmpty++; return; }
      // Quick cache hit = instant
      const sl = fromLang === 'zh' ? 'zh-CN' : fromLang;
      const tl = toLang === 'zh' ? 'zh-CN' : toLang;
      const cacheKey = sl + '|' + tl + '|' + text;
      if (translationCache.has(cacheKey)) {
        pushUndo();
        tx.el.textContent = translationCache.get(cacheKey);
        autoGrowTextItem(tx);
        scheduleAutoSave();
        translatedCount++;
        return;
      }
      // Network call: dim the text as visual feedback
      const origColor = tx.el.style.color;
      tx.el.style.opacity = '0.5';
      try {
        const translated = await translateText(text, fromLang, toLang);
        if (translated && translated !== text) {
          pushUndo();
          tx.el.textContent = translated;
          autoGrowTextItem(tx);
          scheduleAutoSave();
          translatedCount++;
        }
      } catch (err) {
        console.warn('Translate failed for one item:', err.message);
      } finally {
        tx.el.style.opacity = '';
      }
    }));
    if (translatedCount > 0) {
      toast('Translated to ' + langLabel + ' (' + translatedCount + ')');
    } else if (skippedEmpty > 0) {
      toast('Text is empty — nothing to translate');
    } else {
      // All inline providers failed — open Google Translate in a new tab as a guaranteed fallback
      const allText = sel.map(t => t.el.textContent).filter(s => s && s.trim()).join('\n');
      if (allText) {
        const sl = fromLang === 'zh' ? 'zh-CN' : fromLang;
        const tl = toLang === 'zh' ? 'zh-CN' : toLang;
        openGoogleTranslate(allText, sl, tl);
        toast('Opened Google Translate in a new tab — copy result back');
      } else {
        toast('Text is empty — nothing to translate');
      }
    }
  } catch (err) {
    console.error('Translation error:', err);
    toast('Translation failed: ' + err.message);
  } finally {
    btns.forEach(b => { b.textContent = origTexts.get(b); b.disabled = false; });
  }
}

export async function translateText(text, fromLang, toLang) {
  const sl = fromLang === 'zh' ? 'zh-CN' : fromLang;
  const tl = toLang === 'zh' ? 'zh-CN' : toLang;
  const cacheKey = sl + '|' + tl + '|' + text;

  // 1) Instant cache lookup (very fast for repeat translations)
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  // Split long text for providers with length limits
  const chunks = splitTextChunks(text, 500);
  let combined = '';

  // 2) Try a list of providers, JSONP first (works from file://) then fetch
  //    Each provider is given a 7s budget. We try fetch providers in parallel
  //    with JSONP ones so the fastest one wins.
  const jsonpProviders = [
    { name: 'MyMemory+JSONP', build: (chunk) => ({ url: 'https://jsonp.afeld.me/?callback=__mmcb&url=' + encodeURIComponent('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(chunk) + '&langpair=' + sl + '|' + tl), parse: parseMyMemory }) },
    { name: 'MyMemory direct', build: (chunk) => ({ url: 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(chunk) + '&langpair=' + sl + '|' + tl, parse: parseMyMemory }) },
  ];
  const fetchProviders = [
    { name: 'Lingva',   build: (chunk) => ({ url: 'https://lingva.ml/api/v1/' + sl + '/' + tl + '/' + encodeURIComponent(chunk), parse: parseLingva }) },
    { name: 'Google',   build: (chunk) => ({ url: 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' + sl + '&tl=' + tl + '&dt=t&q=' + encodeURIComponent(chunk), parse: parseGoogle }) },
  ];

  const fetchWithTimeout = (url, ms) => Promise.race([
    fetch(url, { method: 'GET' }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ]);

  // Try each provider (sequentially), translate all chunks with the first that works
  for (const p of jsonpProviders) {
    try {
      combined = '';
      for (const chunk of chunks) {
        const req = p.build(chunk);
        const data = await jsonpRequest(req.url, 7000);
        const part = req.parse(data);
        if (part) combined += part + ' ';
      }
      combined = combined.trim();
      if (combined) {
        translationCache.set(cacheKey, combined);
        return combined;
      }
    } catch (e) { console.warn('[' + p.name + ']', e.message); }
  }

  for (const p of fetchProviders) {
    try {
      combined = '';
      let ok = true;
      for (const chunk of chunks) {
        const req = p.build(chunk);
        const resp = await fetchWithTimeout(req.url, 6000);
        if (!resp.ok) { ok = false; break; }
        const data = await resp.json();
        const part = req.parse(data);
        if (!part) { ok = false; break; }
        combined += part + ' ';
      }
      if (ok && combined.trim()) {
        combined = combined.trim();
        translationCache.set(cacheKey, combined);
        return combined;
      }
    } catch (e) { console.warn('[' + p.name + ']', e.message); }
  }

  throw new Error('All providers failed');
}

// JSONP helper — works from file:// because <script src=...> is not CORS-restricted
export function jsonpRequest(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cbName = '__mmcb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const cleanup = () => {
      try { delete window[cbName]; } catch(e) { window[cbName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('JSONP timeout')); }, timeoutMs);
    window[cbName] = function(data) { cleanup(); resolve(data); };
    const script = document.createElement('script');
    script.src = url.replace('__mmcb', cbName);
    script.onerror = () => { cleanup(); reject(new Error('JSONP load error')); };
    document.head.appendChild(script);
  });
}

export function parseMyMemory(data) {
  if (data && data.responseData && data.responseData.translatedText) return data.responseData.translatedText;
  return '';
}
export function parseLingva(data) {
  if (data && data.translation) return data.translation;
  return '';
}
export function parseGoogle(data) {
  if (data && data[0] && Array.isArray(data[0])) {
    let r = '';
    for (const seg of data[0]) if (seg && seg[0]) r += seg[0];
    return r;
  }
  return '';
}

// Open Google Translate in a new tab with the text pre-filled (always works, even from file://)
export function openGoogleTranslate(text, fromLang, toLang) {
  const sl = fromLang === 'zh' ? 'zh-CN' : fromLang;
  const tl = toLang === 'zh' ? 'zh-CN' : toLang;
  const url = 'https://translate.google.com/?sl=' + sl + '&tl=' + tl + '&text=' + encodeURIComponent(text) + '&op=translate';
  window.open(url, '_blank');
}

// Same as above but reads the text from the current selection / editing text item
export function openInGoogleTranslate(fromLang, toLang) {
  let text = '';
  const focusedEl = document.activeElement;
  if (focusedEl && focusedEl.classList && focusedEl.classList.contains('text-item')) {
    text = focusedEl.textContent.trim();
  }
  if (!text) {
    const sel = getSelectedItems().filter(i => i.el && i.el.classList.contains('text-item'));
    if (sel.length) text = sel.map(t => t.el.textContent).join('\n').trim();
  }
  if (!text) {
    const editingTx = getEditingText();
    if (editingTx) text = editingTx.el.textContent.trim();
  }
  if (!text) { toast('Select or edit a text item first'); return; }
  openGoogleTranslate(text, fromLang, toLang);
  toast('Opened Google Translate — copy result back');
}

export async function translateViaLingva(text, sl, tl) {
  // Legacy fetch fallback
  const url = 'https://lingva.ml/api/v1/' + sl + '/' + tl + '/' + encodeURIComponent(text);
  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return parseLingva(await resp.json());
}

export async function translateViaMyMemory(text, sl, tl) {
  // Legacy fetch fallback
  const chunks = splitTextChunks(text, 500);
  let result = '';
  for (const chunk of chunks) {
    const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(chunk) + '&langpair=' + sl + '|' + tl;
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const part = parseMyMemory(await resp.json());
    if (!part) throw new Error('Empty response');
    result += part + ' ';
  }
  return result.trim();
}

export async function translateViaGoogle(text, sl, tl) {
  // Legacy fetch fallback
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' + sl + '&tl=' + tl + '&dt=t&q=' + encodeURIComponent(text);
  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return parseGoogle(await resp.json());
}
export function splitTextChunks(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    // Find a good break point (sentence end, then space)
    let breakAt = remaining.lastIndexOf('.', maxLen);
    if (breakAt < maxLen * 0.3) breakAt = remaining.lastIndexOf(' ', maxLen);
    if (breakAt < maxLen * 0.3) breakAt = maxLen;
    chunks.push(remaining.substring(0, breakAt + 1).trim());
    remaining = remaining.substring(breakAt + 1).trim();
  }
  return chunks;
}

