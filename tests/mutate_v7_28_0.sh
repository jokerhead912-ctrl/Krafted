#!/bin/zsh
# Mutation check for test_v7_28_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.28.0 promises:
#   1. the original's File is remembered before the pairing drops it;
#   2. "Link original" is instant when the original came in the same drag;
#   3. swap moves the LIVE video element and leaves item.src alone, so undo
#      puts the proxy back;
#   4. swap keeps the playhead and the play/pause state;
#   5. the chip says which file is on screen;
#   6. one menu entry, driven by one "which card" helper.
# If any mutation below survives, the suite is decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7280
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_28_0.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7280/mut.html'
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

# ── group A: remembering the original ─────────────────────────────────────
mutate "A1 the drop never records the files it was given" \
  "  noteDroppedFiles(files);" \
  "  ;"

mutate "A2 files are filed under the wrong name" \
  "    _dropFiles.set(f.name, f);" \
  "    _dropFiles.set(f.name + '?', f);"

# v7.29.0: the lookup now also insists the size agrees, so the anchor moved.
mutate "A3 the same-drag lookup is gone (everyone gets a picker)" \
  "  const already = (remembered && want && remembered.size === want) ? remembered : null;" \
  "  const already = null;"

mutate "A4 the link has no usable URL" \
  "const url = URL.createObjectURL(file);" \
  "const url = '';"

# ── group B: the swap ─────────────────────────────────────────────────────
mutate "B1 swap only ever goes one way (no way back to the proxy)" \
  "  v.src = item._showingOriginal ? item.src : link.url;" \
  "  v.src = link.url;"

mutate "B2 swap writes item.src too, so a snapshot carries it (undo lies)" \
  "  v.src = item._showingOriginal ? item.src : link.url;" \
  "  v.src = item.src = item._showingOriginal ? item.src : link.url;"

mutate "B3 the swap flag is never set" \
  "  item._showingOriginal = !item._showingOriginal;" \
  "  ;"

mutate "B4 an unlinked card can still 'swap'" \
  "  if (!link || !item || !item.video) return false;" \
  "  if (!item || !item.video) return false;"

mutate "B5 the playhead is lost on swap" \
  "      v.currentTime = Math.min(t, dur);" \
  "      v.currentTime = 0;"

mutate "B6 a playing clip stops dead after the swap" \
  "    if (wasPlaying) resumeMediaEl(v);" \
  "    ;"

# ── group C: the chip ─────────────────────────────────────────────────────
mutate "C1 the chip never says the original is on screen" \
  "    chip.textContent = showing ? 'ORIG' : 'PROXY';" \
  "    chip.textContent = 'PROXY';"

mutate "C2 the ORIG state latches on" \
  "  infoBar.classList.toggle('has-orig', showing);" \
  "  if (showing) infoBar.classList.add('has-orig');"

# ── group D: the menu ─────────────────────────────────────────────────────
# v7.29.0: the helper is plural now.
mutate "D1 the helper never finds a proxy card (menu entry is dead)" \
  "    if (it && it.isProxy && it.isVideo) out.push(it);" \
  "    if (false) out.push(it);"

cp kraftpub-dev.html $TMP/mut.html
print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
