#!/bin/zsh
# Mutation check for test_v7_30_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.30.0 promises:
#   P1  a batch of proxy cards opens ONE file dialog, not one per card, and
#       the cards are matched afterwards by identity — not by pick order;
#   P2  the dropped-file pool is keyed by folder path when there is one, so
#       A/shot01.mov and B/shot01.mov are two entries instead of one.
# If any mutation below survives, the suite is decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7300
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_30_0.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7300/mut.html'
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

# ── group A: the key ──────────────────────────────────────────────────────
mutate "A1 the path is ignored — back to a bare name" \
  "  return rel || String(f.name || '').trim();" \
  "  return String(f.name || '').trim();"

mutate "A2 the pool goes back to being keyed by name" \
  "    _dropFiles.set(key, f);" \
  "    _dropFiles.set(f.name, f);"

mutate "A3 the batch pool goes back to being keyed by name" \
  "    picked.forEach(function (f) { if (f) pool.set(dropKeyOf(f), f); });" \
  "    picked.forEach(function (f) { if (f) pool.set(f.name, f); });"

mutate "A4 the card forgets where its original came from" \
  "      newItem.originalPath = _pp.originalPath || '';" \
  "      newItem.originalPath = '';"

mutate "A5 the plan stops carrying the path" \
  "originalPath: ((orig && pathsByName) ? (pathsByName[orig] || '') : ''), skip: false };" \
  "originalPath: '', skip: false };"

# ── group B: the identity rule ────────────────────────────────────────────
mutate "B1 the size is ignored — a decoy with the right name wins" \
  "  return (remembered.size === want) ? remembered : null;" \
  "  return remembered;"

mutate "B2 the pool guesses on an unknown size after all" \
  "  if (!want) return needSize ? null : remembered;" \
  "  if (!want) return remembered;"

mutate "B3 a hand-picked file is refused on an unknown size" \
  "  if (!want) return needSize ? null : remembered;" \
  "  if (!want) return null;"

# ── group C: one dialog, matched by identity ──────────────────────────────
mutate "C1 one dialog per card again (the v7.30.0 Esc farm)" \
  "  pickFiles('video/*', true).then(function (picked) {
    if (!picked) { report(true); return; }
    const pool = new Map();
    picked.forEach(function (f) { if (f) pool.set(dropKeyOf(f), f); });
    needPick.forEach(function (item) {
      const f = originalFileFor(item, pool, false);
      if (f && applyOriginalLink(item, f)) done++;
    });
    report(false);
  });" \
  "  let _ch = Promise.resolve();
  needPick.forEach(function (item) {
    _ch = _ch.then(function () {
      return pickFiles('video/*', false).then(function (picked) {
        const f = picked && picked[0];
        if (f && applyOriginalLink(item, f)) done++;
      });
    });
  });
  _ch.then(function () { report(false); });"

mutate "C2 cards are assigned by pick ORDER instead of by identity" \
  "      const f = originalFileFor(item, pool, false);
      if (f && applyOriginalLink(item, f)) done++;" \
  "      const f = picked[0];
      if (f && applyOriginalLink(item, f)) done++;"

mutate "C3 one card gets the multi-dialog too" \
  "  if (needPick.length === 1) {" \
  "  if (false) {"

mutate "C4 the picker hard-codes multiple on" \
  "    inp.multiple = !!multi;" \
  "    inp.multiple = true;"

mutate "C5 the picker ignores the multiple flag entirely" \
  "    inp.multiple = !!multi;" \
  "    ;"

cp kraftpub-dev.html $TMP/mut.html
print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
