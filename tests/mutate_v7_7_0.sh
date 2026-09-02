#!/bin/zsh
# Mutation check for test_v7_7_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
#   "想擺文件夾落去嘅時候...默認做一次tidy,然之後大家唔好重疊"
#   "我刪除呢圖但係佢早刪除唔到"  (the group box + label stayed after delete)
#
# Two behaviours: folder-drop auto-tidy, and delete disposes an empty group.
# Every mutation below restores one half of the old world.
#
# NOTE: never run against the dev file; we always mutate a throwaway copy.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate770
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html
cp Krafted/docs/sw.js $TMP/sw.js

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html KRAFTED_SW=$TMP/sw.js $NODE Krafted/tests/test_v7_7_0.js 2>&1)
  if [ "$EQUIV" -eq 1 ]; then judge_equiv "$1" "$out"; else judge "$1" "$out"; fi
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PY'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate770/mut.html'
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
print "mutation check: v7.7.0 suite (folder auto-tidy + delete disposes group)"

# ── FOLDER AUTO-TIDY: THE COMPLAINT (items stay overlapping) ──────────────

mutate "the import never arms the auto-tidy (items stay as a cascade stack)" \
  "  if (sorted.length) _armFolderTidy(sorted.length);
  _handleFileDrop(e, sorted);" \
  "  _handleFileDrop(e, sorted);"

mutate "the resolver tidies a single dropped item (resizes a lone reference)" \
  "    if (_ids.length >= 2) {" \
  "    if (_ids.length >= 1) {"

mutate "the resolver never runs tidySelection (the new items stay overlapping)" \
  "      _ids.forEach(function (i) { state.selected.add(i); });
      tidySelection();
    }" \
  "      _ids.forEach(function (i) { state.selected.add(i); });
      /* tidy skipped */
    }"

mutate "a failed decode never closes the import (tidy never fires)" \
  "    } catch(e) {
      console.warn('[FileDrop] Image decode failed:', file.name, e.message);
      _maybeTidy(null);
    }" \
  "    } catch(e) {
      console.warn('[FileDrop] Image decode failed:', file.name, e.message);
    }"

# ── DELETE DISPOSES THE GROUP ────────────────────────────────────────────

mutate "deleting the last member keeps the group alive (stale box stays)" \
  "      if (_dg.memberIds.size < 2) {" \
  "      if (_dg.memberIds.size < 1) {"

mutate "the deleted item is never removed from the group (membership lies)" \
  "      _dg.memberIds.delete(i.id);
      if (_dg.memberIds.size < 2) {" \
  "      /* _dg.memberIds.delete(i.id); */
      if (_dg.memberIds.size < 2) {"

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
if [ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ]; then
  print "MUTVERDICT ok  holes=0 skipped=0 caught=$CAUGHT fragile=$FRAGILE"
  exit 0
fi
print "MUTVERDICT BAD holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit 1
