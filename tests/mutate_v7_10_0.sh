#!/bin/zsh
# Mutation check for test_v7_10_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
#   "mac 用鼠標時, zoom in out, i want it should be same as window"
#
# Every mutation below restores one half of the OLD world: the pan gate that
# never asked the classifier, the direction that followed naturalScroll even
# for a mouse, the pinch ramp that swallowed small notches, the pause that
# wiped a locked device. If any of them survives, the suite is decoration.
#
# Two traps this script is built around (both cost a round before):
#   * wrapping the original in /* */ leaves the string in the file, so a
#     has() needle still matches — the mutation "changed" nothing. DELETE text.
#   * a one-line anchor can be a SUBSTRING of a deeper-indented twin, so the
#     mutation lands in the wrong place. Prefer the whole statement.
#
# NOTE: never run against the dev file; we always mutate a throwaway copy.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7100
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html
cp Krafted/docs/sw.js $TMP/sw.js

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html KRAFTED_SW=$TMP/sw.js $NODE Krafted/tests/test_v7_10_0.js 2>&1)
  if [ "$EQUIV" -eq 1 ]; then judge_equiv "$1" "$out"; else judge "$1" "$out"; fi
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PY'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7100/mut.html'
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
print "mutation check: v7.22.0 suite (Mac mouse = Windows mouse)"

# ── THE COMPLAINT: on macOS a plain wheel panned ──────────────────────────

mutate "the pan gate stops asking the classifier (the actual reported bug)" \
  "      ? (_twoFingerPan || (e.deltaMode === 0 && !macWheelLikeMouse && !_WheelKind.isMouse))" \
  "      ? (_twoFingerPan || (e.deltaMode === 0 && !macWheelLikeMouse))"

mutate "the classifier stops running on every event" \
  "  _WheelKind.classify(e);" \
  ""

mutate "a pinned mouse no longer overrides the heuristic" \
  "      if (m === 'mouse') return true;" \
  "      if (m === 'mouse') return false;"

# ── the lock: one event must not be enough ───────────────────────────────

mutate "MOUSE_LOCK drops to zero, so any single event locks" \
  "  const MOUSE_LOCK = 0.68;" \
  "  const MOUSE_LOCK = 0;"

mutate "isMouse ignores the lock and trusts any verdict" \
  "      return verdict === 'mouse' && confidence >= MOUSE_LOCK;" \
  "      return verdict === 'mouse';"

mutate "a pause wipes the verdict again, so notch one pans every time" \
  "    if (gap > 600) { recent = []; }" \
  "    if (gap > 600) { confidence = 0; verdict = 'unknown'; recent = []; }"

# ── the two flick guards ─────────────────────────────────────────────────

mutate "magnitude scores as a notch again, so a fast flick locks as a mouse" \
  "    if (ady >= NOTCH_FLOOR && gap > 30) score += 2;" \
  "    if (ady >= NOTCH_FLOOR) score += 2;"

mutate "the exact-repeat tell needs three samples again" \
  "    if (recent.length >= 2) {
      const uniq = new Set(recent.map(v => Math.round(v)));" \
  "    if (recent.length >= 3) {
      const uniq = new Set(recent.map(v => Math.round(v)));"

# ── direction: scroll up must zoom in ────────────────────────────────────

mutate "wheelZoomDelta follows naturalScroll even for a mouse" \
  "  return (_WheelKind.isMouse || !state.naturalScroll) ? e.deltaY : -e.deltaY;" \
  "  return state.naturalScroll ? -e.deltaY : e.deltaY;"

mutate "wheelZoomDelta inverts the mouse direction" \
  "  return (_WheelKind.isMouse || !state.naturalScroll) ? e.deltaY : -e.deltaY;" \
  "  return (_WheelKind.isMouse || !state.naturalScroll) ? -e.deltaY : -e.deltaY;"

mutate "the Cmd branch inlines the old naturalScroll expression again" \
  "    const rawDY = wheelZoomDelta(e);
    zoomBy(rawDY < 0 ? s : 1 / s, wheelCx, wheelCy);
    return;" \
  "    const rawDY = state.naturalScroll ? -e.deltaY : e.deltaY;
    zoomBy(rawDY < 0 ? s : 1 / s, wheelCx, wheelCy);
    return;"

# ── Ctrl + wheel must be zoomStep, not the pinch ramp ────────────────────

mutate "a locked mouse is dragged back into the pinch ramp" \
  "    const macPinch = Platform.mac && e.deltaMode === 0 && !_WheelKind.isMouse &&
      (strongTrackpadPinch || !forceMouseMode);" \
  "    const macPinch = Platform.mac && e.deltaMode === 0 &&
      (strongTrackpadPinch || !forceMouseMode);"

# ── Shift + wheel is horizontal pan ──────────────────────────────────────

mutate "Shift+wheel is gated on line mode only, so a mouse can never reach it" \
  "    if (e.shiftKey && (e.deltaMode !== 0 || _WheelKind.isMouse)) {" \
  "    if (e.shiftKey && e.deltaMode !== 0) {"

# ── Windows must not move ────────────────────────────────────────────────

mutate "the Windows pan gate widens to any pixel-mode wheel" \
  "      : (_twoFingerPan && e.deltaMode === 0)) {" \
  "      : (_twoFingerPan || e.deltaMode === 0)) {"

print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo PROBLEM)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
