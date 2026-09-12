#!/bin/zsh
# Mutation check for test_v7_16_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.16.0 promises: (1) chip click copies that tag, (2) dblclick copies the
# union once (and cancels the single copy), (3) ×-button clicks are never
# copies, (4) copy failure is never silent, (5) append/replace bumps recents,
# remove does not, (6) recents lead the datalist. If any mutation survives,
# the suite is decoration.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7160
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_16_0.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7160/mut.html'
s = open(p, encoding='utf-8').read()
n = s.count(old)
if n != want:
    print('    !! anchor matched %d times, want %d' % (n, want)); sys.exit(2)
open(p, 'w', encoding='utf-8').write(s.replace(old, new))
PYEOF
  if [ $? -ne 0 ]; then print "  SKIPPED (anchor)  <- $1"; ANCHORFAIL=$((ANCHORFAIL + 1)); return; fi
  run "$1"
}

# judge()/tally_judged() live in mutlib.sh — one copy, not one per script.
. Krafted/tests/mutlib.sh
NOTCAUGHT=0
ANCHORFAIL=0
CAUGHT=0
FRAGILE=0
EQUIV=0
print "mutation check: v7.16.0 suite (chip copy + recent tags)"

# ── (1) single-click copy ────────────────────────────────────────────────

mutate "chip click never copies (the feature is dead)" \
"          copyBoardTagText(tag, boardTextLabel('Copied: ', '已复制：') + tag);" \
"          ;"

mutate "the ×-button guard is gone (removing also copies)" \
"        if (event.target === remove || copyTimer) return;" \
"        if (copyTimer) return;"

# ── (2) double-click union ───────────────────────────────────────────────

mutate "dblclick copies just one tag instead of the union" \
"        copyBoardTagText(entries.map(function (entry2) { return entry2[0]; }).join(', ')," \
"        copyBoardTagText(tag," \
1

mutate "dblclick does not cancel the pending single copy (double toast)" \
"        if (copyTimer) { clearTimeout(copyTimer); copyTimer = null; }" \
"        ;"

# ── (3) copy failure is never silent ─────────────────────────────────────

mutate "a failed copy swallows the toast" \
"  var fail = function () { toast(failLabel); };" \
"  var fail = function () {};"

# ── (4) recents bump discipline ──────────────────────────────────────────

mutate "append/replace never bumps the recent list" \
"  if (mode !== 'remove') bumpRecentTags(tags);" \
"  ;"

mutate "remove also bumps (recent list fills with deleted tags)" \
"  if (mode !== 'remove') bumpRecentTags(tags);" \
"  bumpRecentTags(tags);"

# ── (5) recents lead the datalist ────────────────────────────────────────

mutate "recents do not lead the datalist (orderer ignores them)" \
"  recentBoardTagList().forEach(function (t) { if (!seen[t]) { seen[t] = 1; out.push(t); } });" \
"  ;"

mutate "the datalist bypasses the recents-first orderer" \
"  var suggestions = orderBoardTagSuggestions(boardTagValues(" \
"  var suggestions = (boardTagValues("

# EQUIVALENT (documented, not a hole): a listSignature prefix of the recents was
# tried and removed — `suggestions` already encodes the recents (they lead the
# list), so any recents change also changes the suggestions string. A mutation
# dropping the prefix survives every input; the guard was dead weight.

print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
