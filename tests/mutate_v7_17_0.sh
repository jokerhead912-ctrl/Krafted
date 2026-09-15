#!/bin/zsh
# Mutation check for test_v7_17_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.17.0 promises: (1) only .md / .markdown / .txt are board text, (2) markers
# are stripped to plain text, (3) one file becomes one named, capped, scrollable
# card fanned out from the drop point, (4) nothing fails silently — empty,
# unreadable, oversized and unusable all end in a toast or a confirm, (5) the
# height cap lives in growTextHeightToFit so editing honours it, (6) the wheel
# gate only eats the wheel while the card can still move and never for pinch.
# If any mutation survives, the suite is decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` so the shell
# hands the literal regex replacement through to Python. Backticks are avoided
# entirely (they are command substitution in zsh).
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7170
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_17_0.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7170/mut.html'
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
print "mutation check: v7.24.0 suite (.md / .txt as board text)"

# ── (1) the gate: what counts as board text ──────────────────────────────

mutate ".md is no longer a doc file (the feature is dead for the main format)" \
"return !!f && /\.(md|markdown|txt)\$/i.test(String((f && f.name) || ''));" \
"return !!f && /\.(txt)\$/i.test(String((f && f.name) || ''));"

mutate "the drop handler stops pulling .md out of the dropped list" \
"const _docTextFiles = files.filter(function (f) { return isDocTextFile(f); });" \
"const _docTextFiles = [];"

# ── (2) stripping: markers become plain text ─────────────────────────────

mutate "headings lose their bar (the .md shape is gone)" \
"      parts.push(indent + '▎' + body.replace(/^#{1,6}\s+/, ''));" \
"      parts.push(indent + body.replace(/^#{1,6}\s+/, ''));"

mutate "a heading no longer gets a blank line before it" \
"      if (i > 0) parts.push('');" \
"      ;"

mutate "list items lose their bullet" \
"    if (/^([-*+])\s+/.test(body)) { parts.push(indent + '• ' + body.replace(/^([-*+])\s+/, '')); continue; }" \
"    if (/^([-*+])\s+/.test(body)) { parts.push(indent + body.replace(/^([-*+])\s+/, '')); continue; }"

mutate "bold ** markers survive into the card" \
"      .replace(/\*\*([^*]+)\*\*/g, '\$1')" \
"      "

mutate "a horizontal rule becomes nothing instead of a rule" \
"if (/^(-{3,}|\*{3,}|_{3,})\s*\$/.test(body)) { parts.push('————'); continue; }" \
"if (/^(-{3,}|\*{3,}|_{3,})\s*\$/.test(body)) { parts.push(''); continue; }"

mutate "a quote is no longer indented" \
"    if (/^>\s?/.test(body)) { parts.push(indent + '  ' + body.replace(/^>\s?/, '')); continue; }" \
"    if (/^>\s?/.test(body)) { parts.push(indent + body.replace(/^>\s?/, '')); continue; }"

mutate "CRLF is no longer normalised (Windows .md gains phantom lines)" \
"  var lines = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n').split('\n');" \
"  var lines = String(raw == null ? '' : raw).split('\n');"

mutate "runs of blank lines stop collapsing" \
"  return parts.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s+\$/, '');" \
"  return parts.join('\n').replace(/^\n+/, '').replace(/\s+\$/, '');"

mutate "leading blank lines are no longer trimmed" \
".replace(/^\n+/, '').replace(/\s+\$/, '');" \
".replace(/\s+\$/, '');"

mutate "trailing whitespace is no longer trimmed" \
".replace(/^\n+/, '').replace(/\s+\$/, '');" \
".replace(/^\n+/, '');"

# ── (3) one file, one card ───────────────────────────────────────────────

mutate "the card never gets the .doc-card class (no cap, no scroll)" \
"      syncDocCardClasses(tx);" \
"      ;"

mutate "the card is not named after the file" \
"      tx.name = String(file.name || '').replace(/\.[^.]+\$/, '');" \
"      ;"

mutate "importing steals the caret (noFocus ignored)" \
"      var tx = addText(at.x, at.y, isMd ? '' : body, { noFocus: true, initW: DOC_TEXT_W });" \
"      var tx = addText(at.x, at.y, isMd ? '' : body, { initW: DOC_TEXT_W });"

mutate "the card is not created at the doc width" \
"      var tx = addText(at.x, at.y, isMd ? '' : body, { noFocus: true, initW: DOC_TEXT_W });" \
"      var tx = addText(at.x, at.y, isMd ? '' : body, { noFocus: true });"

mutate "the card is never auto-grown (it stays one line tall)" \
"      requestAnimationFrame(function () { autoGrowTextItem(tx); });" \
"      ;"

mutate "the drop fan-out is gone (every card lands on the same spot)" \
"return { x: dropX0 + i * (DOC_TEXT_W + 24), y: dropY0 };" \
"return { x: dropX0, y: dropY0 };"

mutate "the drop handler never creates the cards at all" \
"    importDocTextFiles(_docTextFiles, function (i) { return { x: dropX0 + i * (DOC_TEXT_W + 24), y: dropY0 }; });" \
"    ;"

mutate "a null entry in the dropped list is no longer skipped" \
"  (files || []).forEach(function (file, i) {
    if (!file) return;" \
"  (files || []).forEach(function (file, i) {
    ;"

# ── (4) nothing fails silently ───────────────────────────────────────────

mutate "an empty file toasts nothing (it just vanishes)" \
"      if (!String(raw == null ? '' : raw).trim() || !body) {
        try { toast(boardTextLabel('Empty file: ', '空档案：') + (file.name || '')); } catch (e) {}
        return;
      }" \
"      if (!String(raw == null ? '' : raw).trim() || !body) {
        return;
      }"

mutate "an unreadable file toasts nothing" \
"      try { toast(boardTextLabel('Could not read ', '读唔到 ') + (file.name || '')); } catch (e) {}" \
"      ;"

mutate "a successful import toasts nothing" \
"      try { toast(boardTextLabel('Imported ', '已汇入 ') + (file.name || '')); } catch (e) {}" \
"      ;"

mutate "an oversized file never asks first" \
"    if (file.size && file.size > DOC_TEXT_MAX_BYTES) {" \
"    if (false) {"

mutate "cancelling the oversize confirm imports it anyway" \
"      if (!ok) return;" \
"      ;"

mutate "an unusable drop says nothing (the old silent behaviour)" \
"  if (_skipped > 0) {" \
"  if (false) {"

mutate "doc files are counted as skipped even though they are used" \
"  const _skipped = files.length - (imageFiles.length + videoFiles.length + audioFiles.length + _docTextFiles.length);" \
"  const _skipped = files.length - (imageFiles.length + videoFiles.length + audioFiles.length);"

mutate "the Import Text menu entry is disconnected from its input" \
"getElementById('file-text-input').click();hideCtx()" \
"hideCtx()"

# ── (5) the height cap ───────────────────────────────────────────────────

mutate "the cap is ignored (a long .md grows two screens tall)" \
"  const _capH = el.classList.contains('doc-card') ? DOC_TEXT_MAX_H : Infinity;" \
"  const _capH = Infinity;"

mutate "the cap is applied to every text item, not just doc cards" \
"  const _capH = el.classList.contains('doc-card') ? DOC_TEXT_MAX_H : Infinity;" \
"  const _capH = DOC_TEXT_MAX_H;"

mutate "the 32px floor is gone (an empty card collapses to nothing)" \
"  const _naturalH = Math.max(32, Math.ceil(el.scrollHeight) + 2);" \
"  const _naturalH = Math.ceil(el.scrollHeight) + 2;"

mutate "the doc card stops scrolling itself while you type in it" \
".text-item.doc-card.editing { overflow-y:auto !important; }" \
".text-item.doc-card.editing { }"

# ── (6) the wheel gate ───────────────────────────────────────────────────

mutate "the wheel gate is gone (a long card can never be scrolled)" \
"  if (_docCard && docCardCanScroll(_docCard, e)) return;" \
"  ;"

mutate "the gate traps the wheel (a card at its end still eats it)" \
"  if (_docCard && docCardCanScroll(_docCard, e)) return;" \
"  if (_docCard) return;"

mutate "the gate never finds the card (target lookup disabled)" \
"  return t.closest('.text-item.doc-card');" \
"  return null;"

mutate "a card at its bottom keeps eating downward scrolls" \
"  return el.scrollTop + el.clientHeight < el.scrollHeight - 1;" \
"  return true;"

mutate "a card at its top keeps eating upward scrolls" \
"  if (dy < 0) return el.scrollTop > 0;" \
"  if (dy < 0) return true;"

mutate "pinch / Cmd zoom loses to the card scroll" \
"  if (e.ctrlKey || e.metaKey) return false;" \
"  ;"

mutate "the card steals the wheel mid-drag" \
"  if (state.dragging) return false;" \
"  ;"

mutate "a horizontal wheel hijacks the gesture" \
"  if (!dy) return false;" \
"  ;"

mutate "a card whose content fits still claims the wheel" \
"  if (el.scrollHeight <= el.clientHeight + 1) return false;" \
"  ;"

print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
