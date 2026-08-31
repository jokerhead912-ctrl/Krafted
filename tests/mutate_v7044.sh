#!/bin/zsh
# Mutation check for test_v7044.js — deliberately break the source, confirm the
# suite goes red, restore. A suite that cannot fail is not a suite.
#
# This one is aimed at a fix that was reported as "it works the first time".
# Every previous attempt at this area PASSED a manual smoke test and then
# failed on the second press. If these assertions do not go red when the
# mechanism is removed, they are decoration and they will not catch the next
# regression either.
#
# NOTE: never run against the dev file; we always mutate a throwaway copy.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate44
mkdir -p $TMP
cp kraftpub-v6.8.0.html $TMP/mut.html
cp Krafted/docs/sw.js $TMP/sw.js

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html KRAFTED_SW=$TMP/sw.js $NODE Krafted/tests/test_v7044.js 2>&1 | tail -3 | tr '\n' ' ')
  if echo "$out" | grep -q "0 failed"; then
    print "  NOT CAUGHT  <- $1"
    NOTCAUGHT=$((NOTCAUGHT + 1))
  else
    print "  caught      <- $1"
  fi
}

mutate() { # mutate(label, python_old, python_new)
  cp kraftpub-v6.8.0.html $TMP/mut.html
  $PY - "$2" "$3" <<'PY'
import sys
old, new = sys.argv[1], sys.argv[2]
p = '/tmp/krafted-mutate44/mut.html'
s = open(p, encoding='utf-8').read()
n = s.count(old)
if n != 1:
    print('    !! anchor matched %d times' % n); sys.exit(2)
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
  if [ $? -ne 0 ]; then print "  SKIPPED (anchor)  <- $1"; ANCHORFAIL=$((ANCHORFAIL + 1)); return; fi
  run "$1"
}

NOTCAUGHT=0
ANCHORFAIL=0
print "mutation check: v7.0.44 suite (trim range that can grow + a real reset)"

# ── the reported bug, reintroduced three different ways ───────────────────

# The handler body is indented 4, not 6 — and "if (v.paused) return;" alone is
# not unique in a 37K-line file, so every anchor here carries a neighbour line.
mutate "THE CAGE IS BACK: the loop runs while paused too" \
  "    if (state.selected.has(item.id)) updateVideoPlayhead(item);
    if (v.paused) return;" \
  "    if (state.selected.has(item.id)) updateVideoPlayhead(item);"

mutate "THE CLAMP IS BACK: a conflict is clamped one gap short" \
  "  if (conflict && markIsSet(it, which === 'in' ? 'out' : 'in', dur)) {" \
  "  if (false) {"

mutate "THE COLLAPSE, spelled differently: clearing parks the far edge one gap away" \
  "    if (plan.which === 'in') { it.trimStart = plan.val; it.trimEnd = dur; }
    else { it.trimStart = 0; it.trimEnd = plan.val; }" \
  "    if (plan.which === 'in') { it.trimStart = plan.val; it.trimEnd = plan.val + 0.05; }
    else { it.trimStart = plan.val - 0.05; it.trimEnd = plan.val; }"

mutate "THE PLAYHEAD DRAG IS BACK: marking moves the playhead onto the mark" \
  "  if (which === 'in') { it.trimStart = val; } else { it.trimEnd = val; }" \
  "  if (which === 'in') { it.trimStart = val; if (it.video) it.video.currentTime = val; } else { it.trimEnd = val; }"

# ── the conflict rule ─────────────────────────────────────────────────────

mutate "conflict ignores whether the other mark is even set" \
  "  if (conflict && markIsSet(it, which === 'in' ? 'out' : 'in', dur)) {" \
  "  if (conflict) {"

mutate "markIsSet claims everything is set" \
  "  if (which === 'in') return (typeof it.trimStart === 'number' && it.trimStart > 0.001);" \
  "  if (which === 'in') return true;"

mutate "the conflict test is inverted (only non-conflicts clear)" \
  "  const conflict = (which === 'in') ? (raw >= te - TRIM_MIN_GAP)
                                    : (raw <= ts + TRIM_MIN_GAP);" \
  "  const conflict = (which === 'in') ? (raw < te - TRIM_MIN_GAP)
                                    : (raw > ts + TRIM_MIN_GAP);"

mutate "the plan reports the wrong cleared value" \
  "             oppWas: (which === 'in') ? te : ts };" \
  "             oppWas: (which === 'in') ? ts : te };"

mutate "applyTrimPlan clears the other end as well" \
  "    else { it.trimStart = 0; it.trimEnd = plan.val; }" \
  "    else { it.trimStart = 0; it.trimEnd = 0; }"

mutate "applyTrimPlan drops the null guard" \
  "function applyTrimPlan(it, plan, dur) {
  if (!plan) return;" \
  "function applyTrimPlan(it, plan, dur) {"

mutate "the planner stops asking the shared clamp" \
  "  const val = clampTrimMark(it, which, raw, dur);" \
  "  const val = raw;"

mutate "TRIM_MIN_GAP widened to a fifth of a second" \
  "var TRIM_MIN_GAP = 0.05;" \
  "var TRIM_MIN_GAP = 0.2;"

mutate "planTrimMark accepts a NaN duration" \
  "function planTrimMark(it, which, t, dur) {
  if (!isFinite(dur) || dur <= 0) return null;" \
  "function planTrimMark(it, which, t, dur) {"

# ── the cage: seed vs tick ────────────────────────────────────────────────

mutate "the playhead refresh moves below the pause guard" \
  "    if (state.selected.has(item.id)) updateVideoPlayhead(item);
    if (v.paused) return;" \
  "    if (v.paused) return;
    if (state.selected.has(item.id)) updateVideoPlayhead(item);"

mutate "the playing loop is dropped entirely" \
  "    if (v.currentTime >= te) {
      v.currentTime = ts;
    }" \
  "    /* loop removed */"

# ...and "if (v._kraftedSuppressTrimLoop) return;" appears twice (the tick
# handler and the play handler), so it needs its neighbour to disambiguate.
mutate "the capture escape hatch is ignored" \
  "    if (v.paused) return;
    if (v._kraftedSuppressTrimLoop) return;" \
  "    if (v.paused) return;"

# ── the reset, and clearing one end ───────────────────────────────────────

mutate "clearTrimMark clears BOTH ends (the half-a-trim is thrown away)" \
  "    if (which === 'in') { it.trimStart = 0; }
    else { it.trimEnd = dur; }" \
  "    it.trimStart = 0; it.trimEnd = dur;"

mutate "clearTrimMark is not undoable" \
  "function clearTrimMark(which) {
  const vids = selectedVideoItems();
  if (!vids.length) { try { toast('Select a video first'); } catch (e) {} return false; }
  try { pushUndo(); } catch (e) {}" \
  "function clearTrimMark(which) {
  const vids = selectedVideoItems();
  if (!vids.length) { try { toast('Select a video first'); } catch (e) {} return false; }"

mutate "clearTrimMark is not persisted" \
  "  refreshTrimUIFor(vids);
  try { scheduleAutoSave(); } catch (e) {}
  try {
    toast((which === 'in' ? 'In' : 'Out') + ' point cleared · '" \
  "  refreshTrimUIFor(vids);
  try {
    toast((which === 'in' ? 'In' : 'Out') + ' point cleared · '"

mutate "clearTrimMark reports success when it did nothing" \
  "  if (!vids.length) { try { toast('Select a video first'); } catch (e) {} return false; }
  try { pushUndo(); } catch (e) {}
  vids.forEach(function (it) {
    const dur = (it.video && isFinite(it.video.duration)) ? it.video.duration : 0;" \
  "  if (!vids.length) { try { toast('Select a video first'); } catch (e) {} return true; }
  try { pushUndo(); } catch (e) {}
  vids.forEach(function (it) {
    const dur = (it.video && isFinite(it.video.duration)) ? it.video.duration : 0;"

mutate "the reset is not undoable (the pre-.44 shape)" \
  "    try { pushUndo(); } catch (e) {}
    _itm.trimStart = 0;" \
  "    _itm.trimStart = 0;"

mutate "the reset is not persisted (the pre-.44 shape)" \
  "    refreshInPlayerTrimUI();
    if (typeof updateVideoTimeline === 'function') updateVideoTimeline();
    try { scheduleAutoSave(); } catch (e) {}" \
  "    refreshInPlayerTrimUI();
    if (typeof updateVideoTimeline === 'function') updateVideoTimeline();"

mutate "Shift+I / Shift+O stop reaching clearTrimMark" \
  "      var _ioHit = e.shiftKey ? clearTrimMark(_ioWhich) : trimHotkey(_ioWhich);" \
  "      var _ioHit = trimHotkey(_ioWhich);"

mutate "I and O are swapped" \
  "      var _ioWhich = (_ioKey === 'i') ? 'in' : 'out';" \
  "      var _ioWhich = (_ioKey === 'i') ? 'out' : 'in';"

mutate "the typing guard is bypassed (I/O fires inside a text box)" \
  "    if (!typingIO) {" \
  "    if (true) {"

mutate "the bare keys clear instead of marking" \
  "      var _ioHit = e.shiftKey ? clearTrimMark(_ioWhich) : trimHotkey(_ioWhich);" \
  "      var _ioHit = e.shiftKey ? trimHotkey(_ioWhich) : clearTrimMark(_ioWhich);"

mutate "the context menu loses Clear In Point" \
  "html += \`<div class=\"ctx-item\" onclick=\"clearTrimMark('in');hideCtx()\"" \
  "html += \`<div class=\"ctx-item\" onclick=\"clearTrimSelected();hideCtx()\""

# ── one drag, not two ─────────────────────────────────────────────────────

mutate "the drag bypasses the shared planner" \
  "        var plan = planTrimMark(_itm, which, pct * dur, dur);" \
  "        var plan = { which: which, val: clampTrimMark(_itm, which, pct * dur, dur), clearsOpp: false, oppWas: null };"

mutate "the drag stops applying through the shared applier" \
  "        applyTrimPlan(_itm, plan, dur);" \
  "        applyTrimMark(_itm, plan.which, plan.val);"

mutate "the drag is persisted on every pixel again" \
  "      var onUp = function() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        try { scheduleAutoSave(); } catch (e) {}
      };" \
  "      var onUp = function() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };"

mutate "a drag takes no undo step" \
  "      var _itm = _getItem();
      if (!_itm) return;
      try { pushUndo(); } catch (e) {}" \
  "      var _itm = _getItem();
      if (!_itm) return;"

mutate "a second hand-rolled drag copy comes back" \
  "  buildTrimDrag(mainTrimEndHandle, 'out', null);" \
  "  buildTrimDrag(mainTrimEndHandle, 'out', null);
  function dragMainHandle() {}"

# ── the menu path ─────────────────────────────────────────────────────────

mutate "setTrimFromPlayhead stops planning (clamps straight onto the mark)" \
  "    const p = planTrimMark(it, which, t, v.duration);" \
  "    const p = { which: which, val: clampTrimMark(it, which, t, v.duration), clearsOpp: false, oppWas: null };"

mutate "setTrimFromPlayhead stops applying through the shared applier" \
  "  plan.forEach(function (e) { applyTrimPlan(e.it, e.p, e.dur); });" \
  "  plan.forEach(function (e) { applyTrimMark(e.it, e.p.which, e.p.val); });"

# ── version ───────────────────────────────────────────────────────────────

# v7.0.46: the anchor has to name the version the source now carries. Left at
# 7.0.44 it silently matches 0 times and this mutation stops testing anything.
mutate "KRAFTED_VERSION not bumped" \
  "var KRAFTED_VERSION = '7.0.50';" \
  "var KRAFTED_VERSION = '7.0.49';"

# ── done ──────────────────────────────────────────────────────────────────
cp kraftpub-v6.8.0.html $TMP/mut.html
print ""
if [ $NOTCAUGHT -eq 0 ]; then
  print "ALL MUTATIONS CAUGHT"
else
  print "$NOTCAUGHT MUTATION(S) NOT CAUGHT"
fi
if [ $ANCHORFAIL -ne 0 ]; then
  print "$ANCHORFAIL ANCHOR(S) FAILED TO MATCH - fix the script"
fi
print ""
print "restore: re-running the suite against the untouched dev file"
$NODE Krafted/tests/test_v7044.js 2>&1 | tail -2
