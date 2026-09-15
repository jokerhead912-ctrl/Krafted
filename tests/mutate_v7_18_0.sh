#!/bin/zsh
# Mutation check for test_v7_18_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.18.0 promises: (1) .md/.markdown render and .txt stays plain, (2) GFM
# tables become real tables with per-column alignment, (3) headings get real
# levels and inline markup is real markup, (4) everything is escaped first so a
# hostile .md cannot inject markup, (5) the rendered HTML round-trips through
# sanitizeTextHtml(), (6) rendered <-> source flips and editing the rendered
# text drops the stale source on purpose, (7) doc-card identity persists so a
# reload keeps the height cap. If any mutation survives, the suite is
# decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
# Backticks are otherwise command substitution in zsh.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7180
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_18_0.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7180/mut.html'
s = open(p, encoding='utf-8').read()
n = s.count(old)
if n != want:
    print('    !! anchor matched %d times, want %d' % (n, want)); sys.exit(2)
open(p, 'w', encoding='utf-8').write(s.replace(old, new))
PYEOF
  if [ $? -ne 0 ]; then print "  SKIPPED (anchor)  <- $1"; ANCHORFAIL=$((ANCHORFAIL + 1)); return; fi
  run "$1"
}

# judge()/tally_judged() live in mutlib.sh — one copy, not one per script.
. Krafted/tests/mutlib.sh
NOTCAUGHT=0
ANCHORFAIL=0
CAUGHT=0
FRAGILE=0
EQUIV=0
print "mutation check: v7.21.0 suite (.md renders as markdown)"

# ── (1) which files render ────────────────────────────────────────────────

mutate ".md is no longer recognised as markdown (the feature is dead)" \
"return !!f && /\.(md|markdown)\$/i.test(String((f && f.name) || ''));" \
"return !!f && /\.(mdx)\$/i.test(String((f && f.name) || ''));"

mutate "every imported file goes down the plain-text path" \
"      var isMd = isMarkdownFile(file);" \
"      var isMd = false;"

mutate "the renderer is never called (markdown is flattened anyway)" \
"      var body = isMd ? renderMarkdownToHtml(raw) : stripMarkdownToPlain(raw);" \
"      var body = stripMarkdownToPlain(raw);"

mutate "the card never records a render mode" \
"      tx.mdMode = isMd ? 'rendered' : '';" \
"      tx.mdMode = '';"

mutate "the card never keeps the original markdown" \
"      tx.mdSrc = isMd ? String(raw) : '';" \
"      tx.mdSrc = '';"

mutate "the rendered HTML is never written into the card" \
"      if (isMd) tx.el.innerHTML = sanitizeTextHtml(body);" \
"      ;"

mutate "the card is never marked as a doc card" \
"      tx.docCard = true;" \
"      ;"

mutate "the classes are not re-derived after import" \
"      if (isMd) tx.el.innerHTML = sanitizeTextHtml(body);
      syncDocCardClasses(tx);" \
"      if (isMd) tx.el.innerHTML = sanitizeTextHtml(body);"

# ── (2) the renderer: blocks ──────────────────────────────────────────────

mutate "headings lose their level (everything renders as a paragraph)" \
"      out.push('<h' + lv + '>' + inlineMd(h[2].replace(/\s+#+\s*\$/, '')) + '</h' + lv + '>');" \
"      out.push('<p>' + inlineMd(h[2].replace(/\s+#+\s*\$/, '')) + '</p>');"

mutate "every heading collapses to h1" \
"      var lv = Math.min(h[1].length, 6);" \
"      var lv = 1;"

mutate "a fenced code block loses its pre/code" \
"      out.push('<pre><code>' + escMd(buf.join('\n')) + '</code></pre>');" \
"      out.push('<p>' + escMd(buf.join('\n')) + '</p>');"

mutate "a blockquote is no longer a blockquote" \
"      out.push('<blockquote>' + renderMarkdownToHtml(qb.join('\n')) + '</blockquote>');" \
"      out.push('<p>' + renderMarkdownToHtml(qb.join('\n')) + '</p>');"

mutate "a horizontal rule renders as nothing" \
"    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*\$/.test(line)) { out.push('<hr>'); i++; continue; }" \
"    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*\$/.test(line)) { out.push(''); i++; continue; }"

mutate "paragraphs are no longer paragraphs" \
"    out.push('<p>' + inlineMd(para.join('\n')) + '</p>');" \
"    out.push('<div>' + inlineMd(para.join('\n')) + '</div>');"

mutate "a soft line break is flattened to a space" \
"    out.push('<p>' + inlineMd(para.join('\n')) + '</p>');" \
"    out.push('<p>' + inlineMd(para.join(' ')) + '</p>');"

mutate "blocks are joined with newlines (pre-wrap then injects phantom gaps)" \
"  return out.join('');" \
"  return out.join('\n');"

mutate "CRLF is no longer normalised (Windows .md gains phantom lines)" \
"  var src = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n').replace(/\t/g, '    ');" \
"  var src = String(raw == null ? '' : raw).replace(/\t/g, '    ');"

# ── (3) the renderer: inline ──────────────────────────────────────────────

mutate "**bold** is no longer marked up" \
"  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>\$1</strong>');" \
""

mutate "*emphasis* is no longer marked up" \
"  t = t.replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?!\*)/g, '\$1<em>\$2</em>');" \
""

mutate "inline code is no longer marked up" \
"  t = t.replace(/\`([^\`]+)\`/g, '<code>\$1</code>');" \
""

mutate "strikethrough is no longer marked up" \
"  t = t.replace(/~~([^~]+)~~/g, '<del>\$1</del>');" \
""

mutate "angle brackets are no longer escaped (markup injection)" \
"    .replace(/&/g, '&amp;').replace(/</g, '&lt;')" \
"    .replace(/&/g, '&amp;')"

mutate "ampersands are no longer escaped" \
"    .replace(/&/g, '&amp;').replace(/</g, '&lt;')" \
"    .replace(/</g, '&lt;')"

mutate "javascript: URLs are passed straight through" \
"  if (/^[#/]/.test(t) || /^\.{1,2}\//.test(t)) return t;
  return '#';" \
"  return t;"

mutate "an image is dropped entirely instead of showing its alt text" \
"    return '<span>[' + (a || 'image') + ']</span>';" \
"    return '';"

# ── (4) the renderer: tables ──────────────────────────────────────────────

mutate "tables are never detected (back to a wall of pipes)" \
"    if (line.indexOf('|') >= 0 && i + 1 < lines.length &&" \
"    if (false && line.indexOf('|') >= 0 && i + 1 < lines.length &&"

mutate "a table renders as a paragraph instead" \
"      out.push('<table><thead><tr>' + th + '</tr></thead><tbody>' + tb + '</tbody></table>');" \
"      out.push('<p>' + th + tb + '</p>');"

mutate "the thead/tbody split is lost" \
"      out.push('<table><thead><tr>' + th + '</tr></thead><tbody>' + tb + '</tbody></table>');" \
"      out.push('<table><tr>' + th + '</tr>' + tb + '</table>');"

mutate "column alignment is dropped" \
"        th += '<th' + (align[c1] ? ' style=\"text-align:' + align[c1] + '\"' : '') + '>' + inlineMd(head[c1]) + '</th>';" \
"        th += '<th>' + inlineMd(head[c1]) + '</th>';"

mutate "a centred column reports left" \
"  if (l && r) return 'center';" \
"  if (l && r) return 'left';"

mutate "a right-aligned column reports left" \
"  if (r) return 'right';" \
"  if (r) return 'left';"

mutate "escMd stops coercing null, so a short table row reads undefined" \
"  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')" \
"  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')"

mutate "a table swallows the paragraph that follows it" \
"lines[i].indexOf('|') >= 0 && lines[i].trim() !== ''" \
"lines[i].trim() !== ''"

# ── (5) the renderer: lists ───────────────────────────────────────────────

mutate "an ordered list renders as a bullet list" \
"  var tag = ordered ? 'ol' : 'ul';" \
"  var tag = 'ul';"

mutate "nested list items are flattened" \
"    if (kids.length) s += mdRenderList(kids, !!kids[0].ordered);" \
"    ;"

mutate "a lazy continuation is dropped" \
"        if (flat.length && /^\s{2,}\S/.test(lines[i])) {" \
"        if (false) {"

mutate "a blank line inside a list ends the list" \
"          if (nx < lines.length && MD_LIST_RE.test(lines[nx])) { i++; continue; }" \
"          break;"

# ── (6) sanitizer round-trip ──────────────────────────────────────────────

mutate "the sanitizer drops table tags (a reload loses every table)" \
"      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'a'];" \
"      'a'];"

mutate "the sanitizer drops heading tags" \
"      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote', 'hr'," \
"      'ul', 'ol', 'li', 'code', 'pre', 'blockquote', 'hr',"

mutate "the sanitizer drops hr (a rule vanishes on reload)" \
"'pre', 'blockquote', 'hr'," \
"'pre', 'blockquote',"

mutate "every href survives the sanitizer" \
"      if (/^(https?:|mailto:)/i.test(href) || /^[#/]/.test(href) || /^\.{1,2}\//.test(href)) {" \
"      if (true) {"

mutate "no href survives the sanitizer (links go dead on reload)" \
"      if (/^(https?:|mailto:)/i.test(href) || /^[#/]/.test(href) || /^\.{1,2}\//.test(href)) {" \
"      if (false) {"

# ── (7) rendered <-> source ───────────────────────────────────────────────

mutate "switching to source is ignored" \
"  tx.mdMode = (mode === 'source') ? 'source' : 'rendered';" \
"  tx.mdMode = 'rendered';"

mutate "source mode writes an empty card instead of the raw markdown" \
"  if (tx.mdMode === 'source') tx.el.textContent = tx.mdSrc;" \
"  if (tx.mdMode === 'source') tx.el.textContent = '';"

mutate "rendered mode never re-renders" \
"  else tx.el.innerHTML = sanitizeTextHtml(renderMarkdownToHtml(tx.mdSrc));" \
"  ;"

mutate "a card with no source can still be switched" \
"  if (!tx || !tx.el || typeof tx.mdSrc !== 'string' || !tx.mdSrc) return false;" \
"  if (!tx) return false;"

mutate "the context-menu toggle is disconnected" \
"      docCardSetMode(list[i], list[i].mdMode === 'source' ? 'rendered' : 'source');" \
"      ;"

mutate "editing a rendered card keeps the stale source" \
"    if (el.classList.contains('md-source')) tx.mdSrc = el.textContent;
    else if (tx.mdSrc) tx.mdSrc = '';
    if (tx.mdSrc === '') tx.mdMode = '';" \
"    ;"

mutate "editing the source no longer updates it" \
"    if (el.classList.contains('md-source')) tx.mdSrc = el.textContent;" \
"    if (false) tx.mdSrc = el.textContent;"

mutate "the stale render mode is left behind after an edit" \
"    if (tx.mdSrc === '') tx.mdMode = '';" \
"    ;"

# ── (8) persistence ───────────────────────────────────────────────────────

mutate "docCard is never saved" \
"  out.docCard = !!t.docCard;" \
"  out.docCard = false;"

mutate "an unknown mdMode is saved verbatim" \
"  out.mdMode = (t.mdMode === 'rendered' || t.mdMode === 'source') ? t.mdMode : '';" \
"  out.mdMode = t.mdMode;"

mutate "mdSrc is never saved" \
"  out.mdSrc = typeof t.mdSrc === 'string' ? t.mdSrc : '';" \
"  out.mdSrc = '';"

mutate "every restored card becomes a doc card" \
"  tx.docCard = !!data.docCard;" \
"  tx.docCard = true;"

mutate "an unknown restored mode is passed through" \
"  tx.mdMode = (data.mdMode === 'rendered' || data.mdMode === 'source') ? data.mdMode : '';" \
"  tx.mdMode = data.mdMode || '';"

mutate "a non-string restored source is passed through" \
"  tx.mdSrc = typeof data.mdSrc === 'string' ? data.mdSrc : '';" \
"  tx.mdSrc = data.mdSrc || '';"

# ── (9) class re-derivation ───────────────────────────────────────────────

mutate "no card is ever a doc card again" \
"  var wantDoc = !!tx.docCard;" \
"  var wantDoc = false;"

mutate "the rendered class is never derived" \
"  var wantRen = wantDoc && tx.mdMode === 'rendered';" \
"  var wantRen = false;"

mutate "the source class is never derived" \
"  var wantSrc = wantDoc && tx.mdMode === 'source';" \
"  var wantSrc = false;"

mutate "the doc-card class is never derived" \
"  if (el.classList.contains('doc-card') !== wantDoc) el.classList.toggle('doc-card', wantDoc);" \
"  ;"

mutate "updateItemStyle no longer re-derives the classes" \
"  if (isTextItem) syncDocCardClasses(item);" \
"  ;"

mutate "the context-menu entry is removed" \
"      html += \`<div class=\"ctx-item\" onclick=\"toggleDocCardSource(\${sel[0].id});hideCtx()\">\${_isSrc ? 'Show rendered' : 'Show markdown source'}</div>\`;" \
"      ;"

print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
