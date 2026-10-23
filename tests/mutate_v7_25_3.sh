#!/bin/zsh
# Mutation check for test_v7_25_3.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.25.3 promises:
#   1. every selector in the file that owns a blur is listed in the override
#      (the drift gate — the part that keeps this true next year);
#   2. the override really switches the blur off, -webkit- twin included;
#   3. the body class tracks "something is decoding", and an ended clip does
#      not count;
#   4. the listeners see every play/pause, which only works because they are
#      registered in the capture phase (media events do not bubble).
# If any mutation below survives, the suite is decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7253
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_25_3.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7253/mut.html'
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

# ── group A: the drift gate ───────────────────────────────────────────────
# A1 is the real miss the gate found on its first run.
mutate "A1 #mobile-toolbar-left is dropped from the override" \
  "body.media-playing #mobile-toolbar-left,
body.media-playing #mobile-toolbar-right," \
  "body.media-playing #mobile-toolbar-right,"

# A2 is the future: somebody adds a frosted panel and forgets the override.
mutate "A2 a brand new frosted panel appears and nobody lists it" \
  "#text-quick-bar .board-tag-entry { flex-wrap:nowrap; }" \
  "#text-quick-bar .board-tag-entry { flex-wrap:nowrap; }
.some-new-glass-panel { position:fixed; backdrop-filter: blur(8px); }"

mutate "A3 the whole override rule is deleted" \
  "body.media-playing .media-anno-toolbar," \
  "body.media-playing-x .media-anno-toolbar,"

mutate "A4 the override keeps a little blur instead of none" \
  "  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}" \
  "  backdrop-filter: blur(1px);
  -webkit-backdrop-filter: blur(1px);
}"

mutate "A5 the -webkit- twin is dropped (Safari keeps blurring)" \
  "  backdrop-filter: none;
  -webkit-backdrop-filter: none;" \
  "  backdrop-filter: none;"

# ── group B: the toggle ───────────────────────────────────────────────────
mutate "B1 the class is stuck on (>= 0 instead of > 0)" \
  "mediaPlayingCount() > 0" \
  "mediaPlayingCount() >= 0"

mutate "B2 an ended clip still counts as decoding" \
  "if (!v.paused && !v.ended) n++;" \
  "if (!v.paused) n++;"

mutate "B3 sync() never touches the class" \
  "document.body.classList.toggle('media-playing', mediaPlayingCount() > 0);" \
  ";"

mutate "B4 'pause' is no longer listened for" \
  "['play', 'playing', 'pause', 'ended', 'emptied']" \
  "['play', 'playing', 'ended', 'emptied']"

# B5 is the subtle one: media events do not bubble, so without capture this
# one document-level listener hears nothing and the whole feature dies.
mutate "B5 the listeners drop out of the capture phase" \
  "document.addEventListener(ev, syncMediaPlayingClass, true);" \
  "document.addEventListener(ev, syncMediaPlayingClass, false);"

cp kraftpub-dev.html $TMP/mut.html
print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
