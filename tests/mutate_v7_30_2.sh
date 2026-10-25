#!/bin/zsh
# Mutation check for test_v7_30_2.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.30.2 promises:
#   the lasso extracts WITHOUT baking a border into the pixels, so a lasso
#   cut-out looks exactly like the same shape taken with Cut. Tick the Border
#   box and you still get one.
#
# The bug was a checkbox that shipped `checked`, not a missing stroke, so the
# mutations below aim at BOTH halves: the default must be off (A), no other
# tool may start baking a stroke (B), and the control that is left must still
# be wired to something real (C/D) — otherwise the panel is a switch connected
# to nothing, which is the same complaint in a different costume.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7302
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_30_2.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7302/mut.html'
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

# ── group A: the default ─────────────────────────────────────────────────
# This is the shipped bug. If it survives, nothing here has any value.
mutate "A1 Border ships checked again (the v7.30.2 bug)" \
  'id="lasso-border-toggle"' \
  'id="lasso-border-toggle" checked'

mutate "A2 the lasso bakes a border no matter what the box says" \
  "    border: withBorder," \
  "    border: true,"

# ── group B: nobody else may start baking a stroke ───────────────────────
mutate "B1 Cut starts baking a border too" \
  "cutState.points.map(p => ({ x: p.x, y: p.y })), { place: place });" \
  "cutState.points.map(p => ({ x: p.x, y: p.y })), { place: place, border: true });"

mutate "B2 C crop starts baking a border" \
  "    onError: function (m) { toast('Crop failed: ' + m); }" \
  "    border: true, onError: function (m) { toast('Crop failed: ' + m); }"

mutate "B3 the shared forwarder decides for itself instead of forwarding" \
  "    border: opts.border," \
  "    border: true,"

# ── group C: the control still has to be wired to something ──────────────
mutate "C1 the stroke is no longer gated on the flag" \
  "    if (opts.border) {" \
  "    if (true) {"

mutate "C2 the forwarder drops the flag on the floor" \
  "    border: opts.border," \
  "    border: false,"

mutate "C3 the lasso reads a different control than the Border box" \
  "const withBorder = document.getElementById('lasso-border-toggle').checked;" \
  "const withBorder = document.getElementById('lasso-inplace-toggle').checked;"

mutate "C4 the Border box disappears from the panel" \
  '<label class="lasso-checkbox"><input type="checkbox" id="lasso-border-toggle"> Border</label>' \
  '<!-- Border box removed -->'

cp kraftpub-dev.html $TMP/mut.html
print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
