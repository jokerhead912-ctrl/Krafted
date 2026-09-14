#!/bin/zsh
# Mutation check for test_v7_20_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.20.0 promises: a board text card that is NOT being edited behaves exactly
# like an IMAGE card —
#   1. one body press hands the gesture back to the canvas (select + arm a
#      move drag in the SAME gesture) AND preventDefaults, so the
#      contentEditable body can neither focus nor paint a text selection;
#   2. editing is DOUBLE-CLICK only;
#   3. corner handles scale the card like an image (aspect-locked), with the
#      font following through the single definition scaleBoardTextFontSize()
#      on BOTH the single-card and the multi-select path;
#   4. the affordance matches: the card shows the grab cursor.
# If any mutation below survives, the suite is decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7200
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_20_0.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7200/mut.html'
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

CAUGHT=0; NOTCAUGHT=0; FRAGILE=0; SKIP=0; ANCHORFAIL=0
. Krafted/tests/mutlib.sh

# ── group A: scaleBoardTextFontSize (executed for real by S1) ───────────────
mutate "the font clamps are removed" \
"  const next = Math.max(4, Math.min(800, Math.round(baseSize * scale * 10) / 10));" \
"  const next = Math.round(baseSize * scale * 10) / 10;"

mutate "a zero / NaN scale is no longer rejected" \
"  if (!scale || !isFinite(scale) || scale <= 0) return;" \
"  ;"

mutate "a missing base size is no longer rejected" \
"  if (!tx || typeof baseSize !== 'number' || !isFinite(baseSize)) return;" \
"  if (!tx) return;"

mutate "the helper writes the base size instead of the scaled one" \
"  tx.size = next;" \
"  tx.size = baseSize;"

mutate "the helper never repaints the DOM" \
"  if (tx.el) applyTextProps(tx);" \
"  ;"

mutate "the tenth-of-a-pixel rounding is dropped" \
"Math.round(baseSize * scale * 10) / 10" \
"Math.round(baseSize * scale * 10)"

mutate "someone renames the one definition" \
"function scaleBoardTextFontSize(tx, baseSize, scale) {" \
"function scaleBoardTextFontSize2(tx, baseSize, scale) {"

# ── group B: the corner handles (executed for real by S2) ──────────────────
mutate "one corner handle goes missing" \
"['nw','ne','sw','se'].forEach(dir => {" \
"['nw','ne','sw'].forEach(dir => {"

mutate "the corners lose the text-handle marker" \
"    handle.dataset.dir = dir;
    handle.dataset.textHandle = '1';
    handle.title = boardTextLabel('Scale text; font scales too', '整体缩放，字号同步放大');" \
"    handle.dataset.dir = dir;
    handle.title = boardTextLabel('Scale text; font scales too', '整体缩放，字号同步放大');"

mutate "multi-selected cards get per-card handles too" \
"  if (moveOnly) return;" \
"  ;"

# ── group C: the resize wiring (S3 structural pins) ────────────────────────
mutate "the single-card path stops scaling the font" \
"      if (d._textScale0) scaleBoardTextFontSize(d.item, d._textScale0.size, w / d.origW);" \
"      ;"

mutate "the multi-select path stops scaling the font" \
"        if (s.isText && dir.length === 2 && !freeScale) scaleBoardTextFontSize(s.item, s.size0, scaleX);" \
"        ;"

mutate "multi snaps forget which cards are text" \
"            isText: !!(s.el && s.el.classList.contains('text-item'))," \
"            isText: false,"

mutate "multi snaps forget the start font size" \
"            size0: s.size," \
"            size0: 0,"

mutate "the corner drag no longer snapshots the start size" \
"_textScale0: (item.el && item.el.classList.contains('text-item') && dir.length === 2 && !multiData) ? { size: item.size, w: item.w } : null };" \
"_textScale0: null };"

mutate "a text corner drag is no longer aspect-locked" \
"    if (d._textScale0 && !e.shiftKey && dir.length === 2) {" \
"    if (false) {"

mutate "the aspect-lock maths is dropped" \
"      h = w / (d.origW / d.origH);" \
"      h = w;"

# ── group D: the press itself (executed for real by S6) ────────────────────
mutate "the press no longer hands back to the canvas" \
"  e.preventDefault();
  return false;
}" \
"  return true;
}"

mutate "the press no longer preventDefaults (the card focuses again)" \
"  e.preventDefault();
  return false;
}" \
"  return false;
}"

mutate "an editing card loses its caret" \
"    tx.el.focus({preventScroll:true});
    return true;" \
"    return true;"

# ── group E: double-click is the only way in ───────────────────────────────
mutate "the Move grip tooltip stops teaching double-click" \
"boardTextLabel('Drag to move; double-click text to edit'" \
"boardTextLabel('Drag to move'"

mutate "double-click no longer enters edit" \
"      textEl.classList.add('editing');" \
"      ;"

mutate "the dblclick listener is renamed away" \
"viewport.addEventListener('dblclick', e => {" \
"viewport.addEventListener('dblclick2', e => {"

# ── group F: the ratchet and the affordance ────────────────────────────────
mutate "someone re-adds the v7.20.0 micro-click edit (ratchet)" \
"  e.preventDefault();
  return false;
}" \
"  e.preventDefault();
  var _etx = null;
  return false;
}"

mutate "the card goes back to the text I-beam cursor" \
".text-item { position:absolute; cursor:grab;" \
".text-item { position:absolute; cursor:text;"

print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
