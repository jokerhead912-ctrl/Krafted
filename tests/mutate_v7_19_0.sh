#!/bin/zsh
# Mutation check for test_v7_19_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# What this script still guards after v7.20.0 landed:
#   (1) the Move grip follows during a MOVE drag — ONE syncTextHandleBox
#       shared by both the lightweight and the full updateItemStyle paths;
#   (2) a body press on a NON-editing text card hands the gesture back to the
#       canvas AND preventDefaults, so the contentEditable body can neither
#       focus (which would add .editing) nor paint a native text selection;
#   (3) an EDITING card and the text TOOL keep one-click caret behaviour,
#       decided BEFORE the other editor's blur can flip the tool;
#   (4) only an EDITING card keeps native text gestures on body click;
#   (5) the v7.19.0 micro-click machinery stays DELETED — two mutants below
#       deliberately re-add it, which is the only way a count-0 gate can ever
#       go red (rule: a gate that has never failed is not a gate).
#
# v7.20.0 changed the SHAPE of (2): the "click 1 selects, click 2 acts" stage
# is gone, editing is double-click only. Two mutants that attacked the old
# stage were removed (rule 14b) and replaced with ones that attack the new
# line; the deleted behaviour is pinned by the count-0 gates in S3 of the
# suite and by test_v7_20_0.js S4/S6.
#
# If any mutation survives, the suite is decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7190
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_19_0.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7190/mut.html'
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

# ── group 1: the Move-grip follow fix ───────────────────────────────────────
mutate "lightweight drag no longer syncs the grip box" \
"    if (el.classList.contains('text-item')) syncTextHandleBox(item);" \
"    ;"

mutate "the helper gates itself shut" \
"  if (!el || !el.classList.contains('text-item')) return;" \
"  if (true) return;"

mutate "the helper writes a stale position" \
"    hCont.style.left = item.x + 'px';" \
"    hCont.style.left = '0px';"

# ── group 2: two-stage body clicks ─────────────────────────────────────────
# v7.20.0 DELETED the two-stage rule these two used to attack - there is no
# "click 1 selects, click 2 acts" any more, so both anchors are gone (rule
# 14b: a mutant whose behaviour was deliberately reversed is removed, but only
# once the REVERSE is pinned - it is, by the count-0 gates in group 3 below and
# by test_v7_20_0.js S4/S6). These two hit the same line from the new angle.
mutate "the hand-back no longer preventDefaults" \
"  e.preventDefault();
  return false;" \
"  return false;"

mutate "the press no longer hands back to the canvas" \
"  e.preventDefault();
  return false;" \
"  return true;"

mutate "editing cards lose one-click caret behaviour" \
"  if (oneClickEdit) {" \
"  if (false) {"

mutate "the other editor is no longer blurred" \
"  if (editingOther && editingOther !== tx) editingOther.el.blur();" \
"  void 0;"

# ── group 3: the canvas drag lifecycle wiring ───────────────────────────────
mutate "any text body click keeps native gestures again" \
"itemEl.classList.contains('text-item') && itemEl.classList.contains('editing');" \
"itemEl.classList.contains('text-item');"

# Same rule 14b treatment: the candidate and the mouseup entry were DELETED in
# v7.20.0, so these mutants now run the other way round - they RE-ADD the
# deleted machinery, which is exactly what the count-0 gates in test_v7_19_0.js
# S3 exist to catch. A gate that has never gone red is not a gate.
mutate "someone re-adds the micro-click edit candidate" \
"  e.preventDefault();
  return false;" \
"  e.preventDefault();
  var _textEditCandidate = 1;
  return false;"

mutate "someone re-adds the mouseup edit entry" \
"  e.preventDefault();
  return false;" \
"  e.preventDefault();
  var _etx = 1;
  return false;"

print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
