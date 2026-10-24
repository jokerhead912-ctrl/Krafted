#!/bin/zsh
# Mutation check for test_v7_29_1.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.29.0 group B promises:
#   B3  a swap that cannot play the original rolls back: proxy back on the
#       element, the ORIG claim cleared, the chip reset, and the user told;
#   B3  a successful swap takes the error handler off again;
#   B4  one reused <input>, reset before every click, listeners taken off
#       after settling, and cancelling resolves instead of hanging.
# If any mutation below survives, the suite is decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7291
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_29_1.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7291/mut.html'
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

# ── group A: the failed swap ──────────────────────────────────────────────
mutate "A1 the error listener is never attached (a broken conform says nothing)" \
  "  v.addEventListener('error', _swapFailed);" \
  "  ;"

mutate "A2 the rollback leaves the dead URL on the element" \
  "    v.src = item.src;" \
  "    ;"

mutate "A3 the rollback leaves the card claiming ORIG" \
  "    item._showingOriginal = false;" \
  "    ;"

mutate "A4 the rollback never tells the user" \
  "    toast(boardTextLabel('Could not play the original — back on the proxy',
                         '原檔播唔到 — 返返去代理檔'));" \
  "    ;"

mutate "A5 a late loadedmetadata can still resurrect a playhead" \
  "    v.removeEventListener('error', _swapFailed);
    try {" \
  "    ;
    try {"

# ── group B: the picker ───────────────────────────────────────────────────
mutate "B1 a new <input> per call (the old leak)" \
  "    if (!_filePicker) {" \
  "    if (true) {"

mutate "B2 the input is not reset, so picking the same file twice is silent" \
  "    inp.value = '';" \
  "    ;"

mutate "B3 listeners are left on, so one dialog can resolve the next pick" \
  "      inp.removeEventListener('change', onChange);" \
  "      ;"

mutate "B4 cancelling the dialog leaves the promise pending forever" \
  "    inp.addEventListener('cancel', onCancel);" \
  "    ;"

cp kraftpub-dev.html $TMP/mut.html
print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
