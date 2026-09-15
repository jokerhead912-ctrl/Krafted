#!/bin/zsh
# Mutation check for test_v7_10_1.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
#   "right click: download source file now is double function, u can remove it"
#
# Every mutation below puts one half of the OLD world back: the unconditional
# per-item entry, the image branch, the selection-wide count, the two shapes
# of predicate. If any of them survives, the suite is decoration.
#
# Two traps this script is built around:
#   * wrapping the original in /* */ leaves the string in the file, so a
#     has() needle still matches — the mutation "changed" nothing. DELETE text.
#   * a needle containing a BACKTICK must be single-quoted: zsh performs
#     command substitution inside double quotes.
#
# NOTE: never run against the dev file; we always mutate a throwaway copy.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7101
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_10_1.js 2>&1)
  if [ "$EQUIV" -eq 1 ]; then judge_equiv "$1" "$out"; else judge "$1" "$out"; fi
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7101/mut.html'
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
print "mutation check: v7.22.0 suite (the duplicate export entry)"

# ── THE COMPLAINT: the same bytes offered twice ───────────────────────────

mutate "the media entry is offered for every selection again (the duplicate)" \
  '    if (hasMedia) html += `<div class="ctx-item" onclick="exportMediaSelected();hideCtx()">Save media files…</div>`;' \
  '    html += `<div class="ctx-item" onclick="exportMediaSelected();hideCtx()">Save media files…</div>`;'

mutate "hasMedia is true for everything, so images get the entry back" \
  "    return i && (i.isVideo || i.isAudio || i.type === 'video' || i.type === 'audio');" \
  "    return true;"

mutate "the old duplicate label comes back" \
  ">Save media files…</div>" \
  ">Download Source File</div>"

mutate "the media export takes images again" \
  "    return !!(it && it.src && (isVid(it) || isAud(it)));" \
  "    return !!(it && it.src);"

mutate "the media export walks the whole selection instead of the filtered one" \
  "  media.forEach((item, _di) => {" \
  "  sel.forEach((item, _di) => {"

mutate "the image entries count every selected item again, not real images" \
  "    const _selImages = getSelectedImages().filter(i => i && i.img && i.src).length;" \
  "    const _selImages = getSelectedImages().filter(i => i && i.src).length;"

# ── the two shapes of item: isVideo/isAudio and type ──────────────────────

mutate "the video branch stops recognising the type-only .kpak shape" \
  "    } else if (isVid(item)) {" \
  "    } else if (item.isVideo) {"

mutate "the audio branch stops recognising the type-only .kpak shape" \
  "    if (isAud(item)) {" \
  "    if (item.isAudio) {"

# ── the bookkeeping ───────────────────────────────────────────────────────

mutate "the toast counts the selection instead of what was written" \
  "  toast('Downloading ' + media.length + ' file(s)');" \
  "  toast('Downloading ' + sel.length + ' file(s)');"

mutate "the new label is no longer translated" \
  "    'Save media files…': '储存媒体档…'," \
  ""

print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
