#!/bin/zsh
# Mutation check for test_v7_14_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# Every mutation below breaks one promise v7.14.0 makes: the bar hides, the
# pill restores it, and the choice survives a reload. If any of them
# survives, the suite is decoration.
#
# NOTE: never run against the dev file; we always mutate a throwaway copy.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7140
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_14_0.js 2>&1)
  if [ "$EQUIV" -eq 1 ]; then judge_equiv "$1" "$out"; else judge "$1" "$out"; fi
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7140/mut.html'
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
print "mutation check: v7.16.0 suite (collapsible toolbar)"

# ── the collapsed state ─────────────────────────────────────────────────

mutate "a collapsed toolbar stays fully visible" \
  "#toolbar.collapsed { display:none; }" \
  "#toolbar.collapsed { display:block; }"

mutate "the pill is always on screen (collapsed or not)" \
  "#toolbar-expand { position:fixed; top:12px; left:50%; transform:translateX(-50%); display:none;" \
  "#toolbar-expand { position:fixed; top:12px; left:50%; transform:translateX(-50%); display:flex;"

# ── the two buttons ─────────────────────────────────────────────────────

mutate "the collapse button expands instead (bar can never hide)" \
  '<button onclick="setToolbarCollapsed(true)" id="btn-toolbar-collapse"' \
  '<button onclick="setToolbarCollapsed(false)" id="btn-toolbar-collapse"'

mutate "the pill collapses instead of expanding (bar can never come back)" \
  '<button id="toolbar-expand" onclick="setToolbarCollapsed(false)"' \
  '<button id="toolbar-expand" onclick="setToolbarCollapsed(true)"'

# ── the toggle itself ───────────────────────────────────────────────────

mutate "the pill never appears (collapsed bar with no way back)" \
  "  pill.classList.toggle('show', !!collapsed);" \
  "  void 0;"

mutate "the force arg is dropped (collapsing twice re-opens the bar)" \
  "  tb.classList.toggle('collapsed', !!collapsed);" \
  "  tb.classList.toggle('collapsed');"

mutate "the null guard is dropped (a missing element crashes the toggle)" \
  "  if (!tb || !pill) return;" \
  "  if (false) return;"

# ── persistence ─────────────────────────────────────────────────────────

mutate "the state is stored under the wrong key (never restored)" \
  "  try { localStorage.setItem('krafted_toolbar_collapsed', collapsed ? '1' : '0'); } catch(e) {}" \
  "  try { localStorage.setItem('krafted_toolbar_collapsedX', collapsed ? '1' : '0'); } catch(e) {}"

mutate "restore is inverted (collapsed users get the bar, expanded users lose it)" \
  "    if (localStorage.getItem('krafted_toolbar_collapsed') === '1') {" \
  "    if (localStorage.getItem('krafted_toolbar_collapsed') === '0') {"

print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
