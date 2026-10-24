#!/bin/zsh
# Mutation check for test_v7_29_2.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.29.0 group C promises:
#   C5  every selected proxy card is acted on, the menu says how many, and a
#       partly-linked selection is linked rather than half-swapped;
#   C5  three cards open three dialogs ONE AT A TIME (one picker, reused);
#   C6  a swap refits the trim to the new duration and drops a frame rate
#       that was auto-detected from the proxy — but keeps a manual one.
# If any mutation below survives, the suite is decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7292
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_29_2.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7292/mut.html'
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

# ── group A: the selection ────────────────────────────────────────────────
mutate "A1 back to first-card-only (the v7.30.0 bug)" \
  "    if (it && it.isProxy && it.isVideo) out.push(it);" \
  "    if (it && it.isProxy && it.isVideo && !out.length) out.push(it);"

mutate "A2 the menu never shows a count" \
  "      const _count = _proxyCards.length > 1 ? (' (' + _proxyCards.length + ')') : '';" \
  "      const _count = '';"

mutate "A3 a partly-linked selection offers the swap anyway (half a conform)" \
  "      const _linked = _proxyCards.every(function (it) { return proxyOriginals.has(it.id); });" \
  "      const _linked = _proxyCards.some(function (it) { return proxyOriginals.has(it.id); });"

# ── group B: acting on all of them ────────────────────────────────────────
# v7.30.0 deleted: the sequential chain is gone, so "one dialog per card" is
# no longer a thing that can be broken here. The property it protected --
# three cards mean ONE dialog -- is now pinned by test_v7_30_0 block 4 and
# mutate_v7_30_0 C1, which re-introduces the sequential version on purpose.
# Deleting a mutation is allowed only after checking the replacement exists.

mutate "B2 the swap only moves the first card again" \
  "    if (swapProxyMedia(it)) moved++;" \
  "    if (swapProxyMedia(cards[0])) moved++;"

mutate "B3 an unlinked card in the selection is ignored instead of linked" \
  "  if (missing.length) { linkOriginalSelected(); return; }" \
  "  if (false) { linkOriginalSelected(); return; }"

mutate "B4 the swap toast drops the count" \
  "  const many = (cards.length > 1) ? (' (' + cards.length + ')') : '';" \
  "  const many = '';"

mutate "B5 a partial link claims every card was linked" \
  "          : ('Linked ' + done + ' of ' + cards.length +" \
  "          : ('Linked ' + cards.length + ' of ' + cards.length +"

# ── group C: the numbers that belong to the file ──────────────────────────
mutate "C1 a trimEnd past the new end is left alone" \
  "    item.trimEnd = dur;" \
  "    ;"

mutate "C2 a trimStart the clip does not have is left alone" \
  "    item.trimStart = 0;" \
  "    ;"

mutate "C3 every trim is flattened to the full duration (an unset one filled in)" \
  "  if (typeof item.trimEnd === 'number' && item.trimEnd > dur) {" \
  "  if (typeof item.trimEnd === 'number' && item.trimEnd >= 0) {"

mutate "C4 the stale auto-detected frame rate is kept" \
  "  if (!v._kraftedFpsManual) {" \
  "  if (false) {"

# ── group D: v7.29.1 — one target, an honest label, a batch you can stop ──
mutate "D1 the swap goes back to a per-card toggle (the v7.30.0 bug)" \
  "    if (!!it._showingOriginal === toOrig) return;   // already at the target" \
  "    if (false) return;"

mutate "D2 the direction is picked from SOME card instead of every card" \
  "  const toOrig = !cards.every(function (it) { return it._showingOriginal; });" \
  "  const toOrig = !cards.some(function (it) { return it._showingOriginal; });"

mutate "D3 the menu promises 'back to proxy' on a mixed selection" \
  "      const _allOrig = _proxyCards.every(function (it) { return it._showingOriginal; });" \
  "      const _allOrig = _proxyCards.some(function (it) { return it._showingOriginal; });"

# v7.30.0: `showProgress` and `stopped` are gone -- one dialog replaced the
# loop that needed them. What they protected is still worth protecting, so the
# anchors moved to the lines that carry it now.
mutate "D4 the batch never says how big the job is" \
  "  toast(boardTextLabel('Picking originals for ' + needPick.length + ' clips — Esc to stop'," \
  "  if (false) toast(boardTextLabel('Picking originals for ' + needPick.length + ' clips — Esc to stop',"

mutate "D5 a dialog is opened even when every card is already in hand" \
  "  if (!needPick.length) { report(false); return; }" \
  "  if (false) { report(false); return; }"

mutate "D6 a cancelled dialog still claims something was linked" \
  "    if (!done) return;   // nothing linked: the dialog was cancelled, so say nothing" \
  "    if (false) return;"

mutate "D7 the planner misses a card, so it never gets a file" \
  "    else needPick.push(item);" \
  "    else if (false) needPick.push(item);"

cp kraftpub-dev.html $TMP/mut.html
print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
