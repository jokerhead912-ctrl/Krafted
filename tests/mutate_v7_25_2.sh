#!/bin/zsh
# Mutation check for test_v7_25_2.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.25.2 promises:
#   1. while the card is on screen the toolbar follow loop keeps working;
#   2. the moment the card leaves the DOM it stops re-arming, and clears its
#      handle, so the buildMediaControls closure can be collected;
#   3. a hidden toolbar still polls but does no work, and resumes when shown;
#   4. a toolbar the user dragged is left where they put it.
# If any mutation below survives, the suite is decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7252
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_25_2.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7252/mut.html'
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

# ── group A: the leak itself ──────────────────────────────────────────────
# A1 is the bug restored verbatim: the loop re-arms unconditionally.
mutate "A1 the loop re-arms forever again (the zombie leak, restored)" \
  "      if (!annoToolbar || !annoToolbar.isConnected) { _tbRafId = 0; return; }" \
  "      ;"

mutate "A2 the isConnected half is dropped (only a missing toolbar stops it)" \
  "      if (!annoToolbar || !annoToolbar.isConnected) { _tbRafId = 0; return; }" \
  "      if (!annoToolbar) { _tbRafId = 0; return; }"

mutate "A3 it stops but keeps the stale handle (nothing is released)" \
  "      if (!annoToolbar || !annoToolbar.isConnected) { _tbRafId = 0; return; }" \
  "      if (!annoToolbar || !annoToolbar.isConnected) { return; }"

# ── group B: the work it is supposed to keep doing ────────────────────────
mutate "B1 the toolbar is never repositioned (the loop spins and does nothing)" \
  "            _positionToolbar();" \
  "            ;"

mutate "B2 a hidden toolbar stops polling too (it can never resume)" \
  "        if (annoToolbar && annoToolbar.style.display !== 'none') {" \
  "        if (annoToolbar && annoToolbar.style.display === 'none') {"

mutate "B3 a dragged toolbar is snapped back (the custom position is lost)" \
  "          if (!el._annoDrawState || !el._annoDrawState.toolbarPos) {" \
  "          if (true) {"

# ── group C: the wiring ───────────────────────────────────────────────────
# The bare line matches twice (the 6-space re-arm inside the loop contains it
# as a substring), so the anchor has to carry the closing brace above it.
mutate "C1 the loop is never started at all" \
  "    }
    _tbRafId = requestAnimationFrame(_tbFollowLoop);" \
  "    }
    _tbRafId = 0;"

cp kraftpub-dev.html $TMP/mut.html
print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
