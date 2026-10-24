#!/bin/zsh
# Mutation check for test_v7_26_1.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.26.1 promises:
#   1. "<base>_proxy.<ext>" is recognised, case-insensitively, and nothing
#      else is (a false positive silently eats a file's own card);
#   2. the base name ignores the extension, which is the only thing that
#      differs between an original and its proxy;
#   3. in one drop, a proxy wins and its original does not become a card;
#   4. the flag survives undo, .kpak save, board serialize AND reload — four
#      writers and one reader, all by hand;
#   5. the drop path applies the plan before making any card, and says so.
# If any mutation below survives, the suite is decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7261
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_26_1.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7261/mut.html'
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

# ── group A: the suffix rule ──────────────────────────────────────────────
mutate "A1 the suffix loses its underscore (false positives everywhere)" \
  "const PROXY_SUFFIX = '_proxy';" \
  "const PROXY_SUFFIX = 'proxy';"

mutate "A2 the match is case-sensitive again (PROXY no longer counts)" \
  "if (base.slice(-PROXY_SUFFIX.length).toLowerCase() !== PROXY_SUFFIX) return null;" \
  "if (base.slice(-PROXY_SUFFIX.length) !== PROXY_SUFFIX) return null;"

mutate "A3 a file that is only the suffix stops being rejected" \
  "  if (base.length <= PROXY_SUFFIX.length) return null;" \
  "  ;"

mutate "A4 the base name uses the FIRST dot instead of the last" \
  "function mediaBaseName(filename) {
  const s = String(filename || '');
  const dot = s.lastIndexOf('.');" \
  "function mediaBaseName(filename) {
  const s = String(filename || '');
  const dot = s.indexOf('.');"

# ── group B: the pairing decision ─────────────────────────────────────────
mutate "B1 the original is no longer claimed, so both become cards" \
  "    if (orig) claimed[orig] = true;" \
  "    ;"

# v7.30.0: the plan entry grew an `originalPath`, so the anchor has to carry
# it too. (An ANCHOR MISS here is a SKIP, and a SKIP is a pass, not a catch.)
mutate "B2 the proxy is skipped too (the batch imports nothing)" \
  "    plan[p.name] = { isProxy: true, originalName: orig, originalPath: ((orig && pathsByName) ? (pathsByName[orig] || '') : ''), skip: false };" \
  "    plan[p.name] = { isProxy: true, originalName: orig, originalPath: ((orig && pathsByName) ? (pathsByName[orig] || '') : ''), skip: true };"

mutate "B3 the proxy forgets which original it stands for" \
  "    const orig = originalByBase[p.base] || null;" \
  "    const orig = null;"

# ── group C: the four writers and the reader ──────────────────────────────
# The undo snapshot, the .kpak manifest and the board serializer share one
# needle; dropping all three at once is the "somebody forgot" case.
mutate "C1 the three shared writers stop carrying the flag" \
  "isGif: i.isGif || false, isAudio: i.isAudio || false, isProxy: i.isProxy || false, originalName: i.originalName || ''," \
  "isGif: i.isGif || false, isAudio: i.isAudio || false," 3

mutate "C2 the node writer stops carrying the flag" \
  "isGif: it.isGif || false, isProxy: it.isProxy || false, originalName: it.originalName || '', adjustments:" \
  "isGif: it.isGif || false, adjustments:"

mutate "C3 the load reader stops restoring the flag" \
  "isGif: n.isGif || false, isProxy: n.isProxy || false, originalName: n.originalName || '', brightness:" \
  "isGif: n.isGif || false, brightness:"

# ── group D: the drop path ────────────────────────────────────────────────
mutate "D1 the plan is computed but the batch is never filtered" \
  "  videoFiles = videoFiles.filter(_keepInBatch);" \
  "  ;"

mutate "D2 the user is not told which files were paired away" \
  "  if (_proxySkipped.length > 0) {" \
  "  if (false) {"

mutate "D3 the surviving card is never stamped as a proxy" \
  "      newItem.isProxy = true;" \
  "      ;"

mutate "D4 the surviving card forgets its original" \
  "      newItem.originalName = _pp.originalName || '';" \
  "      ;"

cp kraftpub-dev.html $TMP/mut.html
print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
