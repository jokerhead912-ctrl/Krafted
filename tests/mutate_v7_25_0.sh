#!/bin/zsh
# Mutation check for test_v7_25_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.25.0 promises:
#   1. committing a text annotation LEAVES the card's draw mode (so the
#      annotation canvas stops covering the <video>);
#   2. it reuses the ONE existing writer (_exitDrawMode) instead of adding a
#      fourth hand-rolled copy of "mode='off' + _applyDrawMode()" (病根一);
#   3. placing another text while one is open still chains (skipExitTextMode);
#   4. the board tool is still reset to select;
#   5. the overlay really is pointer-events:none outside draw mode.
# If any mutation below survives, the suite is decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7250
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_25_0.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7250/mut.html'
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

# ── group A: the actual bug, restored ─────────────────────────────────────
# A1 IS the reported defect: the card stays in draw mode, the canvas keeps
# pointer-events:auto over the video, every click spawns another editor.
mutate "A1 the exit writer is never called (THE BUG: video unusable after a comment)" \
  "        try { if (typeof _exitDrawMode === 'function') _exitDrawMode(); } catch (e) {}" \
  "        ;"

# 病根一: a fourth hand-rolled copy of "leave draw mode". This one sets the
# mode but skips _applyDrawMode(), so the class, the cursor ring and the dim
# overlay all stay — the video LOOKS usable and still is not.
mutate "A2 the commit hand-writes mode='off' without _applyDrawMode (病根一, 4th copy)" \
  "        try { if (typeof _exitDrawMode === 'function') _exitDrawMode(); } catch (e) {}" \
  "        try { el._annoDrawState.mode = 'off'; } catch (e) {}"

mutate "A3 the exit is unconditional (placing a second text kicks you out)" \
  "      if (!skipExitTextMode) {" "      if (true) {"

mutate "A4 the exit never runs (skipExitTextMode inverted)" \
  "      if (!skipExitTextMode) {" "      if (skipExitTextMode) {"

mutate "A5 the board tool is no longer reset to select" \
  "        try { setTool('select'); } catch (e) {}" "        ;"

mutate "A6 the typeof guard is dropped (a build without the writer bricks a commit)" \
  "        try { if (typeof _exitDrawMode === 'function') _exitDrawMode(); } catch (e) {}" \
  "        try { _exitDrawMode(); } catch (e) {}"

# ── group B: the writer itself ────────────────────────────────────────────
mutate "B1 the writer does not re-apply the draw-mode UI (dim + ring stay on)" \
  "      el._annoDrawState.mode = 'off';
      _applyDrawMode();" \
  "      el._annoDrawState.mode = 'off';"

mutate "B2 the writer leaves the mode untouched (a button that does nothing)" \
  "      el._annoDrawState.mode = 'off';
      _applyDrawMode();" \
  "      _applyDrawMode();"

mutate "B3 the writer drops into text mode instead of leaving draw mode" \
  "      el._annoDrawState.mode = 'off';
      _applyDrawMode();" \
  "      el._annoDrawState.mode = 'text';
      _applyDrawMode();"

mutate "B4 the writer is no longer exposed on the item (Esc / clean mode break)" \
  "    el._exitDrawMode = _exitDrawMode;" "    ;"

# ── group C: the CSS the whole fix depends on ─────────────────────────────
# If the canvas is clickable by default, no amount of mode bookkeeping saves
# the video: the overlay covers it regardless.
mutate "C1 the annotation canvas is clickable by default (it eats every click)" \
  "  pointer-events: none;       /* off by default */" \
  "  pointer-events: auto;       /* off by default */"

cp kraftpub-dev.html $TMP/mut.html
print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
