
import { state } from './core-state.js';
import { toast } from './ui-utils.js';

// ── Sanitize text-item innerHTML on restore ──
// Text items can contain inline <span style="color:.."> from per-word recolor.
// We need to preserve those formatting spans, but block any XSS surface.
// Allowlist: <span style="color:..."> only — strip everything else including
// <script>, on* event attributes, javascript: URLs, and any non-whitelisted
// tags. contenteditable's allowed tags are already narrow, but restoring via
// innerHTML bypasses that surface, so this is a hard gate.
export function sanitizeTextHtml(html) {
  if (!html) return '';
  // Drop any tag that's not a span or a line break, plus any on* attribute
  // anywhere in the string. Two passes for safety.
  let clean = String(html)
    .replace(/<\s*(script|iframe|object|embed|link|style|meta|form|input|button|svg|img|video|audio|source|frame|frameset)\b[^>]*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed|link|style|meta|form|input|button|svg|img|video|audio|source|frame|frameset)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, 'about:blank#')
    .replace(/data\s*:\s*text\/html/gi, 'about:blank#');
  // Now drop any tag that isn't <span>, <br>, <b>, <i>, <u>, <font>, or <strike>.
  // We keep the tag and its style/color attributes; drop anything else.
  //
  // Round 69: added 'div' (and 'p') to the allowlist. Send to Board creates
  // combined text items whose rich HTML is two inline-styled <div>s (one for
  // the "[ f N · M:SS ]" chip, one for the body comment). Before this fix the
  // sanitizer stripped <div> tags entirely, so on undo the inner HTML
  // collapsed to one line of plain text and autoGrowTextItem recomputed a
  // wrong width + height for the merged content — visible as "the text box
  // changes text and sides on Ctrl+Z". We need the divs (and their inline
  // styles) to round-trip through undo/redo, paste-import, and reload.
  clean = clean.replace(/<(\/?)([a-z][a-z0-9]*)([^>]*?)>/gi, function(m, slash, tag, attrs) {
    const t = tag.toLowerCase();
    const allowed = ['span', 'br', 'b', 'i', 'u', 'strong', 'em', 'font', 's', 'strike', 'mark', 'div', 'p'];
    if (allowed.indexOf(t) === -1) return '';
    if (t === 'br') return '<br>';
    // For allowed tags, only keep style="..." and color="..." attributes
    const keptAttrs = [];
    const styleMatch = attrs.match(/style\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (styleMatch) {
      let s = styleMatch[2] || styleMatch[3] || '';
      // Drop url() / expression() / @import from style
      s = s.replace(/url\s*\([^)]*\)/gi, '')
           .replace(/expression\s*\([^)]*\)/gi, '')
           .replace(/@import/gi, '');
      // Round 69: whitelist style properties. Without this, a div with
      // style="position:absolute;left:-9999px" (or any malicious positioning
      // trick) could survive sanitization. Only keep properties that are
      // safe to put on inline text / block content: typography (font/color/
      // line-height/letter-spacing/white-space/word-break/word-spacing),
      // box-model for spacing (margin/padding), alignment (text-align/
      // vertical-align), background (color only — no url), and a few
      // harmless display values. Drop everything else (position, top/left,
      // transform, z-index, opacity, filter, animation, etc.).
      if (s) {
        const decls = s.split(';');
        const safeDecls = [];
        for (const decl of decls) {
          const colon = decl.indexOf(':');
          if (colon < 0) continue;
          const prop = decl.slice(0, colon).trim().toLowerCase();
          const val = decl.slice(colon + 1).trim();
          if (!prop || !val) continue;
          // Allowlist of safe properties (prefix-matched so font-size
          // matches "font", "font-size", "font-weight", etc.)
          const safe = (
            prop === 'color' ||
            prop.startsWith('font') ||           // font, font-size, font-weight, font-style, font-family
            prop === 'line-height' ||
            prop === 'letter-spacing' ||
            prop === 'word-spacing' ||
            prop === 'white-space' ||
            prop === 'word-break' ||
            prop === 'word-wrap' ||
            prop === 'overflow-wrap' ||
            prop === 'text-align' ||
            prop === 'text-decoration' ||
            prop === 'text-transform' ||
            prop === 'vertical-align' ||
            prop === 'text-indent' ||
            prop.startsWith('margin') ||         // margin, margin-top, etc.
            prop.startsWith('padding') ||        // padding, padding-top, etc.
            prop === 'background-color' ||
            prop === 'background' ||             // only color values pass (no url because we stripped it above)
            prop === 'display' ||
            prop === 'list-style' ||
            prop === 'list-style-type'
          );
          if (!safe) continue;
          // Reject display values that could break layout (no flex/grid
          // abuse via inline styles on text). Block, inline, inline-block,
          // none, list-item are all safe for our storyboard.
          if (prop === 'display') {
            const dv = val.replace(/!important/gi, '').trim().toLowerCase();
            if (['block', 'inline', 'inline-block', 'none', 'list-item', 'inherit'].indexOf(dv) === -1) continue;
          }
          // Reject color values with url(...) (already stripped above, but
          // belt-and-suspenders), expression(), or javascript:
          if (/expression\s*\(/i.test(val)) continue;
          if (/javascript\s*:/i.test(val)) continue;
          safeDecls.push(prop + ':' + val);
        }
        if (safeDecls.length) keptAttrs.push('style="' + safeDecls.join(';') + '"');
      }
    }
    const colorMatch = attrs.match(/(?:^|\s)color\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (colorMatch) {
      const c = (colorMatch[2] || colorMatch[3] || '').trim();
      // Only allow #rgb, #rrggbb, or named CSS colors (no scripts)
      if (/^(#[0-9a-f]{3,8}|rgba?\([^)]+\)|[a-z]{3,30})$/i.test(c)) {
        keptAttrs.push('color="' + c + '"');
      }
    }
    const faceMatch = attrs.match(/(?:^|\s)face\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (faceMatch) {
      const f = (faceMatch[2] || faceMatch[3] || '').trim();
      if (/^[a-z0-9 ,'"\-_]{1,80}$/i.test(f)) keptAttrs.push('face="' + f + '"');
    }
    return '<' + slash + t + (keptAttrs.length ? ' ' + keptAttrs.join(' ') : '') + '>';
  });
  return clean;
}

// Toggle the Alt+Left-drag canvas-pan shortcut (mainly for MacBook trackpads).
// Persists the choice in localStorage so the user's preference survives reloads.
export function toggleAltPan() {
  state.altPanEnabled = !state.altPanEnabled;
  try {
    var v = state.altPanEnabled ? '1' : '0';
    localStorage.setItem('krafted_alt_pan', v);
    if (window.KraftedStorage) window.KraftedStorage.setItem('krafted_alt_pan', v).catch(function(){});
  } catch (e) {}
  toast('Alt+Left pan: ' + (state.altPanEnabled ? 'ON — hold Option and drag to pan' : 'OFF'));
  updateAltPanBadge();
}

// Small status badge in the bottom-right so the user knows when alt-pan is on.
export function updateAltPanBadge() {
  let badge = document.getElementById('alt-pan-badge');
  if (!state.altPanEnabled) {
    if (badge) badge.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'alt-pan-badge';
    badge.style.cssText = 'position:fixed;bottom:10px;right:10px;background:rgba(0,229,255,0.12);color:#00e5ff;border:1px solid rgba(0,229,255,0.4);padding:4px 9px;border-radius:6px;font-size:10px;font-family:Inter,sans-serif;z-index:9999998;pointer-events:none;letter-spacing:0.3px;box-shadow:0 2px 8px rgba(0,229,255,0.15);';
    document.body.appendChild(badge);
  }
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  badge.textContent = isMac ? '⌥ + drag = pan canvas' : 'Alt + drag = pan canvas';
}
