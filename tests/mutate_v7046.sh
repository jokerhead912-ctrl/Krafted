#!/bin/zsh
# Mutation check for test_v7046.js — deliberately break the source, confirm the
# suite goes red, restore. A suite that cannot fail is not a suite.
#
#   "The Present stuff: renaming is really inconvenient, they're all called
#    View 1 2 3 4 and I have to rename every one. Can the renaming be better?
#    And maybe a simple colour so I can find things quickly. My end goal is
#    convenience. Like, after I add a Present step it should just open the
#    rename field for me."
#
# Most of these mutations do not corrupt data — they restore the INCONVENIENCE.
# A prompt() coming back, a field that does not open, a name that is always
# "View 4", a colour that silently fails to persist. If any of them can come
# back without the suite going red, the annoyance can too.
#
# NOTE: never run against the dev file; we always mutate a throwaway copy.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate46
mkdir -p $TMP
cp kraftpub-v6.8.0.html $TMP/mut.html
cp Krafted/docs/sw.js $TMP/sw.js

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html KRAFTED_SW=$TMP/sw.js $NODE Krafted/tests/test_v7046.js 2>&1 | tail -3 | tr '\n' ' ')
  if echo "$out" | grep -q "ALL PASS"; then
    print "  NOT CAUGHT  <- $1"
    NOTCAUGHT=$((NOTCAUGHT + 1))
  else
    print "  caught      <- $1"
  fi
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-v6.8.0.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PY'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate46/mut.html'
s = open(p, encoding='utf-8').read()
n = s.count(old)
if n != want:
    print('    !! anchor matched %d times, want %d' % (n, want)); sys.exit(2)
open(p, 'w', encoding='utf-8').write(s.replace(old, new))
PY
  if [ $? -ne 0 ]; then print "  SKIPPED (anchor)  <- $1"; ANCHORFAIL=$((ANCHORFAIL + 1)); return; fi
  run "$1"
}

NOTCAUGHT=0
ANCHORFAIL=0
print "mutation check: v7.0.46 suite (naming a view, and one view shape instead of six)"

# ── ONE SHAPE, NOT SIX ─────────────────────────────────────────────────
# The whole point of the collapse: these six used to be hand-spelled, and any
# one of them drifting back means a field that is saved but never loaded.

mutate "the manifest path hand-spells the view shape again" \
  "    manifest.views = (state.views || []).map(serializeView);" \
  "    manifest.views = (state.views || []).map(function(v) { return { id: v.id, name: v.name || '', ids: (v.ids || []).slice(), panX: v.panX, panY: v.panY, zoom: v.zoom, createdAt: v.createdAt || '' }; });"

mutate "the undo snapshot hand-spells the view shape again" \
  "    views: (state.views || []).map(serializeView),
    drawStrokes: G.drawStrokes," \
  "    views: (state.views || []).map(v => ({ id: v.id, name: v.name || '', ids: (v.ids || []).slice(), panX: v.panX, panY: v.panY, zoom: v.zoom, createdAt: v.createdAt || '' })),
    drawStrokes: G.drawStrokes,"

mutate "both .kpak save paths hand-spell the view shape again" \
  "    views: (state.views || []).map(serializeView),
    nextViewId: G.nextViewId," \
  "    views: (state.views || []).map(v => ({ id: v.id, name: v.name || '', ids: (v.ids || []).slice(), panX: v.panX, panY: v.panY, zoom: v.zoom, createdAt: v.createdAt || '' })),
    nextViewId: G.nextViewId," 2

mutate "the undo restore hand-spells the view shape again" \
  "  state.views = (snap.views || []).map(function (v) { return deserializeView(v); });" \
  "  state.views = (snap.views || []).map(function (v) { return { id: v.id, name: v.name || '', ids: (v.ids || []).slice(), panX: v.panX, panY: v.panY, zoom: v.zoom, createdAt: v.createdAt || '' }; });"

mutate "the .kpak load hand-spells the view shape again" \
  "      state.views.push(deserializeView(vd, _remapId));" \
  "      state.views.push({ id: vd.id, name: vd.name || '', ids: (vd.ids || []).map(_remapId), panX: vd.panX, panY: vd.panY, zoom: vd.zoom, createdAt: vd.createdAt || '' });"

mutate "serializeView forgets the colour (a colour that saves but never reloads)" \
  "    color: v.color || ''," \
  "    color: '',"

mutate "serializeView forgets updatedAt (the old silent drop)" \
  "    updatedAt: v.updatedAt || ''," \
  "    updatedAt: '',"

mutate "deserializeView forgets the colour (v7.0.46 boards lose their colours)" \
  "    color: vd.color || ''," \
  "    color: '',"

mutate "deserializeView ignores the id remapper (views point at nothing after import)" \
  "    ids: (vd.ids || []).map(map)," \
  "    ids: (vd.ids || []),"

mutate "deserializeView forgets to default the remapper" \
  "  const map = (typeof remap === 'function') ? remap : function (x) { return x; };" \
  "  const map = remap;"

# ── NAMING: THE REPORTED ANNOYANCE ─────────────────────────────────────

mutate "THE COMPLAINT: window.prompt comes back" \
  "function renameViewAt(index) { return beginViewRename(index); }" \
  "function renameViewAt(index) { const v = _viewsList()[index]; if (!v) return false; let n = window.prompt('Name this view', v.name || ''); if (n === null) return false; n = String(n).trim().slice(0, 60); if (!n) return false; try { pushUndo(); } catch (e) {} v.name = n; try { scheduleAutoSave(); } catch (e) {} renderViewsPanel(); return true; }"

mutate "THE COMPLAINT: every new view is called View N again" \
  "    name: suggested," \
  "    name: 'View ' + (state.views.length + 1),"

# v7.0.46: the line lost its `!state._present` prefix when the guard moved to
# the top of the function (it now refuses the save outright instead of
# building a view and skipping only the rename). Anchor on the line as it is.
mutate "THE COMPLAINT: saving does not open the name field" \
  "  beginViewRename(state.views.length - 1);" \
  "  renderViewsPanel();"

mutate "THE COMPLAINT: the field opens but you have to click into it first" \
  "      try { inp.focus(); inp.select(); inp.scrollIntoView({ block: 'nearest' }); } catch (e) {}" \
  "      try { inp.select(); inp.scrollIntoView({ block: 'nearest' }); } catch (e) {}"

mutate "THE COMPLAINT: the field opens but the old name is not selected, so typing appends" \
  "      try { inp.focus(); inp.select(); inp.scrollIntoView({ block: 'nearest' }); } catch (e) {}" \
  "      try { inp.focus(); inp.scrollIntoView({ block: 'nearest' }); } catch (e) {}"

mutate "editing is keyed on position, so a re-render retargets the wrong row" \
  "  state._viewEditingId = v.id;" \
  "  state._viewEditingId = index;"

mutate "renaming a collapsed rail stays collapsed (you type into a hidden field)" \
  "  if (panel) panel.classList.remove('collapsed');" \
  "  if (false) panel.classList.remove('collapsed');"

mutate "renaming is allowed mid-presentation and fights the tape" \
  "  if (state._present) return false;" \
  "  if (false) return false;"

mutate "the editor is closed after the undo step, so blur commits twice" \
  "  state._viewEditingId = 0;                  // cleared first: blur re-enters
  const v = _viewsList().filter(function (x) { return x.id === id; })[0];" \
  "  const v = _viewsList().filter(function (x) { return x.id === id; })[0];
  state._viewEditingId = 0;"

mutate "cancelling still commits the edit" \
  "  if (v && !cancelled) {" \
  "  if (v) {"

mutate "a name is no longer trimmed" \
  "    const next = String(value == null ? '' : value).trim().slice(0, 60);" \
  "    const next = String(value == null ? '' : value).slice(0, 60);"

mutate "a name is no longer capped at 60" \
  "    const next = String(value == null ? '' : value).trim().slice(0, 60);" \
  "    const next = String(value == null ? '' : value).trim();"

mutate "committing an unchanged name takes an undo step (junk history)" \
  "    if (next && next !== v.name) {" \
  "    if (next) {"

mutate "Enter no longer commits" \
  "        if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }" \
  "        if (ev.key === 'Enter') { ev.preventDefault(); }"

mutate "Escape commits instead of discarding" \
  "        else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }" \
  "        else if (ev.key === 'Escape') { ev.preventDefault(); finish(true); }"

mutate "Tab no longer steps to the next name" \
  "          if (next >= 0 && next < list.length) beginViewRename(next);" \
  "          if (false) beginViewRename(next);"

mutate "clicking away discards what was typed" \
  "        if (state._viewEditingId !== v.id) return;   // Enter already finished
        finish(true);" \
  "        if (state._viewEditingId !== v.id) return;   // Enter already finished"

# ── COLOUR ─────────────────────────────────────────────────────────────

mutate "the palette loses its clear option, so a colour can never be undone" \
  "var VIEW_COLORS = ['', '#00e5ff', '#ffdd44', '#ff6b6b', '#51cf66', '#cc5de8', '#ff922b', '#74c0fc', '#ffffff'];" \
  "var VIEW_COLORS = ['#00e5ff', '#ffdd44', '#ff6b6b', '#51cf66', '#cc5de8', '#ff922b', '#74c0fc', '#ffffff'];"

mutate "viewColor trusts any string, so a malformed colour reaches the DOM" \
  "  return (c && VIEW_COLORS.indexOf(c) >= 0) ? c : '';" \
  "  return c || '';"

mutate "the wash is opaque, so the number inside the chip disappears" \
  "  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',0.20)';" \
  "  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',0.95)';"

mutate "an unparseable colour is passed through instead of dropped" \
  "  if (!m) return 'transparent';" \
  "  if (!m) return String(hex || '');"

mutate "colouring a view is not undoable" \
  "  try { pushUndo(); } catch (e) {}
  v.color = c;" \
  "  v.color = c;"

mutate "the swatch strip stays open after you pick" \
  "  state._viewSwatchId = 0;
  if (viewColor(v) === c) { renderViewsPanel(); return false; }" \
  "  if (viewColor(v) === c) { renderViewsPanel(); return false; }"

mutate "re-picking the colour it already has takes a second undo step" \
  "  if (viewColor(v) === c) { renderViewsPanel(); return false; }" \
  "  if (false) { renderViewsPanel(); return false; }"

mutate "the chip is not marked tinted, so a coloured row looks like an uncoloured one" \
  "    num.className = 'view-num' + (col ? ' tinted' : '');" \
  "    num.className = 'view-num';"

mutate "the chip never takes the view colour" \
  "    if (col) {
      num.style.color = col;" \
  "    if (false) {
      num.style.color = col;"

mutate "clicking the chip does nothing" \
  "      state._viewSwatchId = (state._viewSwatchId === v.id) ? 0 : v.id;" \
  "      state._viewSwatchId = 0;"

mutate "the swatch strip renders nothing" \
  "      VIEW_COLORS.forEach(function (c) {" \
  "      [].forEach(function (c) {"

mutate "deleting a row leaves the editor dangling on a view that is gone" \
  "  if (state._viewEditingId === v.id) state._viewEditingId = 0;" \
  "  if (false) state._viewEditingId = 0;"

mutate "deleting a row leaves the swatch strip dangling" \
  "  if (state._viewSwatchId === v.id) state._viewSwatchId = 0;" \
  "  if (false) state._viewSwatchId = 0;"

# ── THE PANEL AND F2 ───────────────────────────────────────────────────

mutate "the rail header stops counting the views" \
  "  if (headText) headText.textContent = list.length ? ('Views ' + list.length) : 'Views';" \
  "  if (headText) headText.textContent = 'Views';"

mutate "the presented shot scrolls out of sight on a long tape" \
  "    try { activeRow.scrollIntoView({ block: 'nearest' }); } catch (e) {}" \
  "    /* the tape walks away */"

mutate "F2 is no longer bound" \
  "  if (ev.key !== 'F2' || ev.ctrlKey || ev.metaKey || ev.altKey) return;" \
  "  if (ev.key !== 'F13' || ev.ctrlKey || ev.metaKey || ev.altKey) return;"

mutate "F2 is registered on the bubble phase, so a board hotkey eats it" \
  "  beginViewRename(i);
}, true);" \
  "  beginViewRename(i);
}, false);"

mutate "F2 hijacks the keys while you are typing in a field" \
  "  if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;" \
  "  if (false) return;"

# ── THE HOTKEY ─────────────────────────────────────────────────────────
# "或者有個快捷鍵，譬如我揀咗呢張圖，某個快捷鍵就自動加咗落 present 即刻就可以改名"
# The action existed and was bound to nothing. These mutations take the key
# away again, or hand it to something else.

mutate "THE COMPLAINT: adding a shot has no key at all again" \
  "{ id: 'view-save',           category: 'View',  label: 'Add Shot To Present',      keys: [{ key: 'p' }] }," \
  "{ id: 'view-save',           category: 'View',  label: 'Add Shot To Present',      keys: [] },"

mutate "playing the tape has no key again" \
  "{ id: 'view-present',        category: 'View',  label: 'Present Views',            keys: [{ key: 'p', shift: true }] }," \
  "{ id: 'view-present',        category: 'View',  label: 'Present Views',            keys: [] },"

mutate "P and Shift+P are swapped, so the plain key plays instead of adds" \
  "{ id: 'view-present',        category: 'View',  label: 'Present Views',            keys: [{ key: 'p', shift: true }] }," \
  "{ id: 'view-present',        category: 'View',  label: 'Present Views',            keys: [{ key: 'p' }] },"

# A second claim on the same combo is decided by object iteration order —
# invisible in the UI, and one of the two silently never fires.
mutate "a second shortcut claims P, so one of the two silently never fires" \
  "{ id: 'view-toggle-panel',   category: 'View',  label: 'Toggle Views Panel',       keys: [] }," \
  "{ id: 'view-toggle-panel',   category: 'View',  label: 'Toggle Views Panel',       keys: [{ key: 'p' }] },"

# ── THE RUNNING ORDER ──────────────────────────────────────────────────
# "全部都係 view 1234 我每次都要重新改" — the number was never the problem,
# having to type it every single time was.

mutate "THE COMPLAINT: every view is numbered by hand again" \
  "  const suggested = String(name || suggestViewName(ids) || nextViewNameInSequence() ||" \
  "  const suggested = String(name || suggestViewName(ids) ||"

mutate "the sequence drops zero padding, so a padded list stops sorting" \
  "    if (digits.length > 1 && digits.charAt(0) === '0') {" \
  "    if (false) {"

mutate "the sequence continues from the FIRST view, not the last" \
  "  const prev = String((list[list.length - 1] || {}).name || '').trim();" \
  "  const prev = String((list[0] || {}).name || '').trim();"

mutate "the sequence offers a name the tape already has" \
  "    if (!taken[name]) break;" \
  "    if (true) break;"

mutate "a runaway suggestion is no longer capped" \
  "  return String(name || '').slice(0, 60);" \
  "  return String(name || '');"

# ── THE SAFETY LOCK ────────────────────────────────────────────────────
# A bare letter is only safe because the typing guard runs first. Narrow the
# guard and every word containing a "p" starts creating views mid-caption.

mutate "the typing guard stops covering board text, so P fires while you type" \
  "  if (ae && (ae.contentEditable === 'true' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) {" \
  "  if (ae && (ae.tagName === 'INPUT')) {"

# ── ADDING A SHOT MID-PITCH ────────────────────────────────────────────
# Half-refusing it built an unnamed row into a live running order.

mutate "adding a shot mid-pitch is allowed again (unnamed row in a live tape)" \
  "  if (state._present) {
    try { toast('Stop the presentation before adding a shot'); } catch (e) {}
    return null;
  }
" \
  ""

# ── DISCOVERABILITY ────────────────────────────────────────────────────
# A key nobody can find out about is not a shortcut.

mutate "the ＋ button stops naming the key" \
  'title="Add the selected items to Present (P) — the name field opens ready to type"' \
  'title="Save the current selection as a view"'

mutate "the empty rail points at the ＋ button again instead of the key" \
  "then press <b>P</b> to add it to Present" \
  "then press <b>＋</b> to save a view"

mutate "the help panel stops naming P" \
  "'<tr><td style=\"padding:4px 0;color:#888;\"><b>P</b></td>" \
  "'<tr><td style=\"padding:4px 0;color:#888;\">＋ in the Views rail</td>"

mutate "the help panel stops naming Shift+P" \
  "'<tr><td style=\"padding:4px 0;color:#888;\"><b>Shift+P</b></td>" \
  "'<tr><td style=\"padding:4px 0;color:#888;\">▶ Present</td>"

mutate "the Present button stops naming its key" \
  'title="Play the views in order (Shift+P)"' \
  'title="Play the views in order"'

mutate "a refused save stops saying which key to press" \
  "toast('Select what this shot should frame, then press P')" \
  "toast('Select the items this view should frame first')"

# ── VERSION ────────────────────────────────────────────────────────────
# v7.0.46: the anchor has to name the version the source now carries. Left at
# 7.0.45 it silently matches 0 times and this mutation stops testing anything.
mutate "KRAFTED_VERSION not bumped" \
  "var KRAFTED_VERSION = '7.0.46';" \
  "var KRAFTED_VERSION = '7.0.45';"

print ""
if [ $ANCHORFAIL -ne 0 ]; then
  print "SKIPPED $ANCHORFAIL (anchor did not match — a skipped mutation is not a passing one)"
fi
if [ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ]; then
  print "ALL MUTATIONS CAUGHT"
else
  print "$NOTCAUGHT NOT CAUGHT"
fi
