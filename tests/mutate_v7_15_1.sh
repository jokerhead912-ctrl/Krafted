#!/bin/zsh
# Mutation check for test_v7_15_1.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.15.1 promises: (1) a stuck IME flag cannot kill tag button clicks,
# (2) a no-op tag action toasts instead of staying silent, (3) the quick bar
# never covers the Move grip. If any mutation survives, the suite is decoration.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7151
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_15_1.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7151/mut.html'
s = open(p, encoding='utf-8').read()
n = s.count(old)
if n != want:
    print('    !! anchor matched %d times, want %d' % (n, want)); sys.exit(2)
open(p, 'w', encoding='utf-8').write(s.replace(old, new))
PYEOF
  if [ $? -ne 0 ]; then print "  SKIPPED (anchor)  <- $1"; ANCHORFAIL=$((ANCHORFAIL + 1)); return; fi
  run "$1"
}

# judge()/judge_equiv()/tally_judged() live in mutlib.sh — one copy, not
# one per script. 病根一：一个行为 N 份手写副本，每份都会各自漂移。
. Krafted/tests/mutlib.sh
NOTCAUGHT=0
ANCHORFAIL=0
CAUGHT=0
FRAGILE=0
EQUIV=0
print "mutation check: v7.19.0 suite (tag quick-bar fixes)"

# ── (1) IME flush ────────────────────────────────────────────────────────

mutate "the IME flush line is deleted (stuck flag kills every click)" \
"        button.addEventListener('click', function () {
          input.dataset.composing = '';" \
"        button.addEventListener('click', function () {"

mutate "the flush happens after the submit (guard still blocks)" \
"          input.dataset.composing = '';
          submitBoardTags(root, button.dataset.tagMode);" \
"          submitBoardTags(root, button.dataset.tagMode);
          input.dataset.composing = '';"

# ── (2) no-op toast ──────────────────────────────────────────────────────

mutate "the no-op toast is voided (silence again reads as a dead button)" \
  "toast(boardTextLabel('No tag changes'" \
  "void(boardTextLabel('No tag changes'"

mutate "the no-op toast fires with the wrong message" \
  "toast(boardTextLabel('No tag changes'" \
  "toast(boardTextLabel('Xo tag changes'"

# ── (3) grip-aware placement ─────────────────────────────────────────────

mutate "the grip bound collapses back to the box top (bar covers Move again)" \
  "var topBound = gripTop < minY ? gripTop : minY;" \
  "var topBound = minY;"

mutate "the vertical fallback ignores the grip bound" \
  "        y = above >= below ? topBound - gap - box.height : maxY + gap;" \
  "        y = above >= below ? minY - gap - box.height : maxY + gap;"

# ── guards in mutateSelectedTags ─────────────────────────────────────────

mutate "the mode whitelist is dropped (bogus mode silently rewrites tags)" \
  "  if (['append','remove','replace'].indexOf(mode) < 0) return 0;" \
  "  if (false) return 0;"

mutate "the empty-value guard is dropped (empty append toasts + treats as replace)" \
  "  if (mode !== 'replace' && !tags.length) return 0;" \
  "  if (false) return 0;"

mutate "replace never asks for confirmation" \
  "  if (mode === 'replace' && !window.confirm(" \
  "  if (false && !window.confirm("

print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
