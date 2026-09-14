#!/bin/zsh
# Mutation check for test_v7_19_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.19.0 promises: (1) the Move grip follows during a MOVE drag (shared
# syncTextHandleBox on both style paths), (2) click 1 on a text card selects
# only, (3) an already-selected card hands the gesture back so the canvas can
# arm a move drag (drag = move, 3px micro-click = edit), (4) editing cards and
# the text TOOL keep one-click caret behaviour, decided BEFORE the other
# editor's blur can flip the tool, (5) only an EDITING card keeps native text
# gestures on body click, (6) the micro-click edit entry lives in the move
# mouseup. If any mutation survives, the suite is decoration.
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
mutate "an already-selected card no longer hands the gesture back" \
"  return false; // already selected: the canvas mousedown arms the move drag" \
"  return true; // already selected: the canvas mousedown arms the move drag"

mutate "click 1 reverts to one-click-to-edit" \
"    selectOnly(tx.id);
    return true; // click 1 selects; the NEXT click or drag on the body acts" \
"    selectOnly(tx.id);
    tx.el.focus({preventScroll:true});
    return true; // click 1 selects; the NEXT click or drag on the body acts"

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

mutate "arming a move drag no longer records the edit candidate" \
"_textEditCandidate: (!textGrip && itemEl.classList.contains('text-item')) ? item : null," \
"_textEditCandidate: null,"

mutate "the micro-click no longer enters edit" \
"if (_etx && _etx.el && !_etx.el.classList.contains('editing')) _etx.el.focus({ preventScroll: true });" \
";"

print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
