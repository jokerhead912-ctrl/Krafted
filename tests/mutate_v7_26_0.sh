#!/bin/zsh
# Mutation check for test_v7_26_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.26.0 / A3-c promises:
#   1. the default is 6 and it sits inside the clamp range;
#   2. maxConcurrentVideos() clamps every value, including garbage from a
#      hand-edited storage entry, and never returns 0 (that would pause a
#      video the instant the user pressed play);
#   3. no read site kept the old constant — five of them used to;
#   4. the input's min/max cannot drift from the constants;
#   5. the widget seeds, clamps, persists, and only toasts real changes.
# If any mutation below survives, the suite is decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7260
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_26_0.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7260/mut.html'
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

# ── group A: the number itself ────────────────────────────────────────────
mutate "A1 the default goes back to the old hard-coded 4" \
  "const DEFAULT_MAX_CONCURRENT_VIDEOS = 6;" \
  "const DEFAULT_MAX_CONCURRENT_VIDEOS = 4;"

mutate "A2 the floor is dropped to 0 (0 would pause on play)" \
  "const MAX_CONCURRENT_VIDEOS_MIN = 1;" \
  "const MAX_CONCURRENT_VIDEOS_MIN = 0;"

mutate "A3 the ceiling is raised past the documented hardware range" \
  "const MAX_CONCURRENT_VIDEOS_MAX = 12;" \
  "const MAX_CONCURRENT_VIDEOS_MAX = 64;"

# ── group B: the clamp ────────────────────────────────────────────────────
mutate "B1 the accessor stops clamping (returns whatever it was given)" \
  "  return Math.max(MAX_CONCURRENT_VIDEOS_MIN,
                  Math.min(MAX_CONCURRENT_VIDEOS_MAX, n));" \
  "  return n;"

mutate "B2 the NaN guard is dropped (garbage leaks through as NaN)" \
  "  if (!isFinite(n)) return DEFAULT_MAX_CONCURRENT_VIDEOS;" \
  "  ;"

mutate "B3 the accessor ignores the setting and always returns the default" \
  "  const n = parseInt(state && state.maxConcurrentVideos, 10);" \
  "  const n = NaN;"

# ── group C: the five read sites ──────────────────────────────────────────
mutate "C1 the budget early-out reverts to a literal" \
  "  if (playing.length <= maxConcurrentVideos()) return 0;" \
  "  if (playing.length <= 4) return 0;"

mutate "C2 the eviction count reverts to a literal" \
  "  var need = playing.length - maxConcurrentVideos();" \
  "  var need = playing.length - 4;"

mutate "C3 playAllMedia reverts to a literal" \
  "    if (videoCount < maxConcurrentVideos()) {" \
  "    if (videoCount < 4) {"

# ── group D: the widget ───────────────────────────────────────────────────
mutate "D1 the widget stops clamping what the user typed" \
  "      const clamped = Math.max(MAX_CONCURRENT_VIDEOS_MIN,
                               Math.min(MAX_CONCURRENT_VIDEOS_MAX, n));" \
  "      const clamped = n;"

mutate "D2 the widget stops persisting" \
  "        localStorage.setItem('krafted_max_videos', String(clamped));" \
  "        ;"

mutate "D3 the widget no longer seeds the input from state" \
  "    input.value = String(state.maxConcurrentVideos);
    input.addEventListener('change', function(ev){" \
  "    input.addEventListener('change', function(ev){"

mutate "D4 the markup min/max drift from the constants" \
  "<input id=\"max-videos-input\" type=\"number\" min=\"1\" max=\"12\" step=\"1\" value=\"6\" />" \
  "<input id=\"max-videos-input\" type=\"number\" min=\"1\" max=\"20\" step=\"1\" value=\"6\" />"

cp kraftpub-dev.html $TMP/mut.html
print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
