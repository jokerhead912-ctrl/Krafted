#!/bin/zsh
# Mutation check for test_v7_6_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
#   "我其實就係因為自己group嘅時候想加返個group個名 … 然之後接落本身面板上面"
#
# The feature is two gestures: creation opens the rename, and the Properties
# panel carries a Group row. Every mutation below restores one half of the
# old world — a hand-made group that cannot be named.
#
# NOTE: never run against the dev file; we always mutate a throwaway copy.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate760
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html
cp Krafted/docs/sw.js $TMP/sw.js

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html KRAFTED_SW=$TMP/sw.js $NODE Krafted/tests/test_v7_6_0.js 2>&1)
  # The verdict is judged in mutlib.sh, one copy for every script here.
  if [ "$EQUIV" -eq 1 ]; then judge_equiv "$1" "$out"; else judge "$1" "$out"; fi
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PY'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate760/mut.html'
s = open(p, encoding='utf-8').read()
n = s.count(old)
if n != want:
    print('    !! anchor matched %d times, want %d' % (n, want)); sys.exit(2)
open(p, 'w', encoding='utf-8').write(s.replace(old, new))
PY
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
print "mutation check: v7.7.0 suite (naming a hand-made group)"

# ── CREATION OPENS THE RENAME ────────────────────────────────────────────

mutate "THE COMPLAINT: grouping does not open the rename (the old world)" \
  "  if (newGroup) beginGroupRename(newGroup);" \
  "  if (newGroup) { /* the chip never opens */ }"

# ── A HIDDEN CHIP CANNOT BE FOCUSED ─────────────────────────────────────

mutate "the rename opens on a hidden chip (focus() on display:none is a no-op)" \
  "  el.style.display = 'block';
  updateGroupBorder(group);
  el.focus();" \
  "  updateGroupBorder(group);
  el.focus();"

# ── THE CHIP STAYS VISIBLE MID-RENAME ────────────────────────────────────

mutate "a nameless chip mid-rename is hidden again (you type into nothing)" \
  "    if (!group.name && !editing) {" \
  "    if (!group.name) {"

# ── THE PANEL ROW ────────────────────────────────────────────────────────

mutate "the panel row answers a selection that spans two groups" \
  "    if (g && g !== mine) return null;" \
  "    if (false) return null;"

mutate "the panel writer keeps the whitespace you typed around the name" \
  "  g.name = String(value || '').trim();" \
  "  g.name = String(value || '');"

mutate "the panel writer never re-places the chip (clearing the field leaves a stale chip)" \
  "  if (g.labelEl) g.labelEl.textContent = g.name;
  updateGroupBorder(g);
  scheduleAutoSave();
}" \
  "  if (g.labelEl) g.labelEl.textContent = g.name;
  scheduleAutoSave();
}"

# ── VERSION ──────────────────────────────────────────────────────────────
# The anchor names the version the source now carries; version_scan.py moves
# it at every bump. Left stale it matches 0 times and tests nothing.
mutate "KRAFTED_VERSION not bumped" \
  "var KRAFTED_VERSION = '7.7.0';" \
  "var KRAFTED_VERSION = '7.6.0';"

print ""
if [ $ANCHORFAIL -ne 0 ]; then
  print "SKIPPED $ANCHORFAIL (anchor did not match — a skipped mutation is not a passing one)"
fi
if [ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ]; then
  print "ALL MUTATIONS CAUGHT"
else
  print "$NOTCAUGHT NOT CAUGHT"
fi

# ── machine-readable verdict ─────────────────────────────────────────────
# The one line run_all.sh reads, plus the exit code it gates on. A skipped
# anchor counts as BAD — a mutation that never ran proves nothing at all.
if [ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ]; then
  print "MUTVERDICT ok  holes=0 skipped=0 caught=$CAUGHT fragile=$FRAGILE"
  exit 0
fi
print "MUTVERDICT BAD holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit 1
