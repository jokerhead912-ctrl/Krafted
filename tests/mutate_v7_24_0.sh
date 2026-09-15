#!/bin/zsh
# Mutation check for test_v7_24_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.24.0 promises:
#   1. the Rotate row has ONE writer (syncRotationUI) feeding BOTH control
#      surfaces, so the slider and the typed box cannot disagree;
#   2. typing an exact angle works, and garbage input moves nothing;
#   3. one drag = one undo step, not one per pointer sample;
#   4. resetRotation zeroes the whole selection and is undoable;
#   5. the rotate HANDLE (which writes item.rot directly) also syncs the row.
# If any mutation below survives, the suite is decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7240
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_24_0.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7240/mut.html'
s = open(p, encoding='utf-8').read()
n = s.count(old)
if n != want:
    print('ANCHOR MISS (count=%d, want=%d): %r' % (n, want, old[:70]))
    sys.exit(2)
open(p, 'w', encoding='utf-8').write(s.replace(old, new))
PYEOF
  if [ $? -ne 0 ]; then
    SKIP=$((SKIP + 1)); ANCHORFAIL=$((ANCHORFAIL + 1))
    echo "SKIPPED (anchor): $1"
    return
  fi
  run "$1"
}

CAUGHT=0; NOTCAUGHT=0; FRAGILE=0; SKIP=0; ANCHORFAIL=0; EQUIV=0
. Krafted/tests/mutlib.sh

# ── group A: the single writer ────────────────────────────────────────────
mutate "A1 the slider is pinned to 0 (the row lies about the real angle)" \
  "  if (s) s.value = deg;" "  if (s) s.value = 0;"

mutate "A2 the typed box is no longer rounded to 0.1 (12.34 shows as 12.34)" \
  "  if (n && document.activeElement !== n) n.value = Math.round((+deg || 0) * 10) / 10;" \
  "  if (n && document.activeElement !== n) n.value = (+deg || 0);"

mutate "A3 the activeElement guard is dropped (typing fights the caret)" \
  "  if (n && document.activeElement !== n) n.value = Math.round((+deg || 0) * 10) / 10;" \
  "  if (n) n.value = Math.round((+deg || 0) * 10) / 10;"

# 病根一: a second writer is how the two surfaces drift apart. Prove the
# "one writer" claim is load-bearing by making the panel write the slider
# directly again, bypassing syncRotationUI.
mutate "A4 updatePropsPanel hand-writes the slider again (two writers, 病根一)" \
  "    syncRotationUI(item.rot);" \
  "    document.getElementById('prop-rotate').value = 0;"

# ── group B: setRotation ──────────────────────────────────────────────────
mutate "B1 the applied value is dropped (every rotate becomes 0)" \
  "  sel.forEach(i => { i.rot = n; updateItemStyle(i); });" \
  "  sel.forEach(i => { i.rot = 0; updateItemStyle(i); });"

mutate "B2 the string from the control is not parsed ('45' + 0 concatenation / string rot)" \
  "  var n = (typeof v === 'number') ? v : parseFloat(v);" \
  "  var n = v;"

mutate "B3 the NaN guard is gone (typing garbage zeroes the rotation)" \
  "  if (!isFinite(n)) { syncRotationUI(sel.length ? sel[0].rot : 0); return; }" \
  "  if (false) { syncRotationUI(sel.length ? sel[0].rot : 0); return; }"

mutate "B4 setRotation forgets to sync the row (the controls go stale)" \
  "  syncRotationUI(n);" "  ;"

mutate "B5 no undo is pushed (a rotate can no longer be undone)" \
  "  if (sel.length && !sel[0]._rotDragging) { pushUndo(); sel[0]._rotDragging = true; }" \
  "  if (sel.length && !sel[0]._rotDragging) { sel[0]._rotDragging = true; }"

mutate "B6 the quiet period never closes the gesture (a second drag gets no undo)" \
  "    sel[0]._rotTimer = setTimeout(() => { sel[0]._rotDragging = false; }, 300);" \
  "    sel[0]._rotTimer = setTimeout(() => { sel[0]._rotDragging = true; }, 300);"

mutate "B7 every sample of a drag pushes its own undo (300 undo steps per slider drag)" \
  "  if (sel.length && !sel[0]._rotDragging) { pushUndo(); sel[0]._rotDragging = true; }" \
  "  if (sel.length) { pushUndo(); sel[0]._rotDragging = true; }"

mutate "B8 setRotation stops scheduling an autosave" \
  "  syncRotationUI(n);
  if (sel[0]) {" \
  "  syncRotationUI(n);
  if (false) {"

# ── group C: resetRotation ────────────────────────────────────────────────
mutate "C1 the reset does not actually reset (it is a no-op button)" \
  "  sel.forEach(i => { i.rot = 0; updateItemStyle(i); });" \
  "  sel.forEach(i => { updateItemStyle(i); });"

mutate "C2 the reset is not undoable" \
  "  pushUndo();
  sel.forEach(i => { i.rot = 0; updateItemStyle(i); });" \
  "  sel.forEach(i => { i.rot = 0; updateItemStyle(i); });"

mutate "C3 the reset runs on an empty selection (a stray undo step)" \
  "  const sel = getSelectedItems();
  if (!sel.length) return;
  pushUndo();" \
  "  const sel = getSelectedItems();
  pushUndo();"

mutate "C4 the reset forgets to sync the row (the button works, the row lies)" \
  "  syncRotationUI(0);" "  ;"

# ── group D: the markup is wired ──────────────────────────────────────────
mutate "D1 the typed box is dead (a number field that does nothing)" \
  "onchange=\"setRotation(this.value)\"" "onchange=\"\""

mutate "D2 the reset button is dead" \
  "onclick=\"resetRotation()\"" "onclick=\"\""

mutate "D3 the typed box is a text field (no arrow keys, no numeric keypad)" \
  "type=\"number\" id=\"prop-rotate-num\"" "type=\"text\" id=\"prop-rotate-num\""

# ── group E: the handle-drag path ─────────────────────────────────────────
# The rotate handle writes item.rot itself. Without this sync the row shows
# the angle from BEFORE the drag — the exact staleness this release exists to
# remove, and invisible to any test that only looks at the panel controls.
mutate "E1 the rotate-handle drag end stops syncing the row (stale angle)" \
  "      syncRotationUI(state.dragging.item.rot);" "      ;"

cp kraftpub-dev.html $TMP/mut.html
print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
