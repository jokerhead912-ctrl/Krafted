#!/bin/zsh
# Mutation check for test_v7_27_1.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.27.1 promises:
#   1. a proxy card shows a PROXY chip, and no other card does;
#   2. the chip names the original, and says so when there is none;
#   3. the chip is refreshed from exactly ONE place, so undo / board load /
#      kpak restore all get it without anybody remembering;
#   4. 導出 — the chip cannot be baked (the renderer paints the media
#      element; the chip is also hidden under body.capturing);
#   5. 播放 — the chip sits in a pointer-events:none bar, so it cannot eat
#      a click meant for the picture.
# If any mutation below survives, the suite is decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7271
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_27_1.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7271/mut.html'
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

# ── group A: the chip's own logic ─────────────────────────────────────────
mutate "A1 every card is marked as a proxy" \
  "  const on = !!(item && item.isProxy);" \
  "  const on = true;"

mutate "A2 the chip latches on and can never come off" \
  "  infoBar.classList.toggle('has-proxy', on);" \
  "  if (on) infoBar.classList.add('has-proxy');"

mutate "A3 the tooltip stops naming the original" \
  "chip.title = orig ? ('Proxy for ' + orig) : 'Proxy" \
  "chip.title = orig ? ('Proxy for ' + orig) : ''; //"

mutate "A4 the chip has no text" \
  "    chip.textContent = 'PROXY';" \
  "    chip.textContent = '';"

mutate "A5 an unpaired proxy reads as a real clip" \
  "  const on = !!(item && item.isProxy);" \
  "  const on = !!(item && item.isProxy && item.originalName);"

# ── group B: one definition, one call site ────────────────────────────────
mutate "B1 the refresh is never scheduled (undo / load lose the chip)" \
  "  requestAnimationFrame(function () { syncProxyBadgeEl(infoBar, _getItem()); });" \
  "  ;"

mutate "B2 the refresh runs before the caller stashes el._item" \
  "syncProxyBadgeEl(infoBar, _getItem())" \
  "syncProxyBadgeEl(infoBar, null)"

mutate "B3 a second hook appears for callers to remember" \
  "  el._setFilenameBadge = _setFilenameBadge;" \
  "  el._setFilenameBadge = _setFilenameBadge;
  el._syncProxyBadge = syncProxyBadgeEl;"

# ── group C: markup + CSS ─────────────────────────────────────────────────
mutate "C1 the info bar has no chip element at all" \
  "    '<span class=\"ib-proxy\"></span>' +
" \
  ""

mutate "C2 the chip is visible on every card" \
  ".ib-proxy {
  display: none;" \
  ".ib-proxy {
  display: inline-flex;"

mutate "C3 .has-proxy no longer shows it" \
  ".item.has-media .media-info-bar.has-proxy .ib-proxy { display: inline-flex; }" \
  ""

mutate "C4 the chip can bleed into a capture" \
  "body.capturing .item.has-media .media-info-bar .ib-proxy" \
  "body.capturing .item.has-media .media-info-bar .ib-nope"

# ── group D: 導出 ────────────────────────────────────────────────────────
mutate "D1 the export paints the card element instead of the media" \
  "  const drawSrc = item.video || item.img;" \
  "  const drawSrc = item.el;"

mutate "D2 the export stops painting the media at all" \
  "ctx.drawImage(drawSrc" \
  "ctx.fillRect(0,0,0,0) || ctx.drawImage"

# ── group E: v7.27.0 must not regress ────────────────────────────────────
mutate "E1 the drop path stops stamping the item" \
  "      newItem.isProxy = true;" \
  "      ;"

cp kraftpub-dev.html $TMP/mut.html
print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
