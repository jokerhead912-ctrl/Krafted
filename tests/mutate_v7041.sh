#!/bin/zsh
# Mutation check for test_v7041.js — deliberately break the source, confirm the
# suite goes red, restore. A suite that cannot fail is not a suite.
# NOTE: never run against the dev file; we always mutate a throwaway copy.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate41
mkdir -p $TMP
cp kraftpub-v6.8.0.html $TMP/mut.html
cp Krafted/docs/sw.js $TMP/sw.js

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html KRAFTED_SW=$TMP/sw.js $NODE Krafted/tests/test_v7041.js 2>&1 | tail -3 | tr '\n' ' ')
  if echo "$out" | grep -q "ALL PASS"; then
    print "  NOT CAUGHT  <- $1"
  else
    print "  caught      <- $1"
  fi
}

mutate() { # mutate(label, python_old, python_new)
  cp kraftpub-v6.8.0.html $TMP/mut.html
  $PY - "$2" "$3" <<'PY'
import sys
old, new = sys.argv[1], sys.argv[2]
p = '/tmp/krafted-mutate41/mut.html'
s = open(p, encoding='utf-8').read()
n = s.count(old)
if n != 1:
    print('    !! anchor matched %d times' % n); sys.exit(2)
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
  if [ $? -ne 0 ]; then print "  SKIPPED (anchor)  <- $1"; return; fi
  run "$1"
}

print "mutation check: v7.0.41 suite (I/O trim hotkey)"

# ── the two mechanisms behind the reported bug ────────────────────────────

mutate "cursor time is never read — every press falls back to the playhead" \
  "  const onSeek = timeIn(item.el.querySelector('.media-seek-bar'), '.media-seek-track');
  if (onSeek != null) return onSeek;
  return timeIn(item.el.querySelector('.media-trim-mini'), null);" \
  "  return null;
  const onSeek = timeIn(item.el.querySelector('.media-seek-bar'), '.media-seek-track');
  if (onSeek != null) return onSeek;
  return timeIn(item.el.querySelector('.media-trim-mini'), null);"

mutate "the no-op press reports success instead of saying how to move it" \
  "      toast('Trim ' + which + ' stays at ' + formatTime(val)
        + ' — move the playhead, or hover the timeline and press '
        + (which === 'in' ? 'I' : 'O') + '.');" \
  "      toast('Trim ' + which + ' ' + formatTime(val));"

mutate "a place with no time axis is treated as time 0" \
  "  if (!node) return null;" \
  "  if (!node) return 0;"

mutate "a never-moved (0,0) pointer counts as a real pointer" \
  "  if (state && state.mouse && (state.mouse.x || state.mouse.y)) {" \
  "  if (state && state.mouse) {"

mutate "a hidden (zero-width) timeline is accepted as a time source" \
  "    if (rect.width <= 0) return null;" \
  "    if (false) return null;"

# ── the shared mark primitives ────────────────────────────────────────────

mutate "TRIM_MIN_GAP drifts back to the old 0.1s" \
  "var TRIM_MIN_GAP = 0.05;   // shortest legal segment, seconds" \
  "var TRIM_MIN_GAP = 0.1;"

mutate "the segment is allowed to invert (in point past the out point)" \
  "    val = Math.max(0, Math.min(val, Math.max(0, te - TRIM_MIN_GAP)));" \
  "    val = Math.max(0, Math.min(val, dur));"

mutate "the out point is allowed to invert (before the in point)" \
  "    val = Math.min(dur, Math.max(val, Math.min(dur, ts + TRIM_MIN_GAP)));" \
  "    val = Math.min(dur, Math.max(val, 0));"

mutate "an unset out edge reads as 0 instead of the whole clip" \
  "  return (typeof it.trimEnd === 'number' && it.trimEnd > 0) ? it.trimEnd : dur;" \
  "  return (typeof it.trimEnd === 'number') ? it.trimEnd : dur;"

mutate "the playhead is left outside the segment it will loop" \
  "    if (v && (v.currentTime || 0) < val) { try { v.currentTime = val; } catch (e) {} }" \
  "    void 0;"

# ── undo discipline ───────────────────────────────────────────────────────

mutate "the hotkey stops taking an undo step" \
  "  if (moved) {
    try { pushUndo(); } catch (e) {}
    applyTrimMark(it, which, val);" \
  "  if (moved) {
    void 0;
    applyTrimMark(it, which, val);"

mutate "an undo step is pushed even when nothing moves" \
  "  const moved = Math.abs(val - trimEdgeOf(it, which, v.duration)) > 0.001;
  if (moved) {
    try { pushUndo(); } catch (e) {}
    applyTrimMark(it, which, val);" \
  "  const moved = Math.abs(val - trimEdgeOf(it, which, v.duration)) > 0.001;
  try { pushUndo(); } catch (e) {}
  if (moved) {
    applyTrimMark(it, which, val);"

mutate "the menu pushes an undo step even when nothing moves" \
  "  if (!plan.length) {
    try {
      toast(skipped ? 'Video not ready yet'
                    : 'Trim ' + which + ' is already at the playhead');
    } catch (e) {}
    return;
  }
  try { pushUndo(); } catch (e) {}" \
  "  try { pushUndo(); } catch (e) {}
  if (!plan.length) {
    try {
      toast(skipped ? 'Video not ready yet'
                    : 'Trim ' + which + ' is already at the playhead');
    } catch (e) {}
    return;
  }"

# ── one implementation, not two ───────────────────────────────────────────

mutate "the hotkey stops repainting through refreshTrimUIFor" \
  "    applyTrimMark(it, which, val);
    refreshTrimUIFor([it]);" \
  "    applyTrimMark(it, which, val);"

mutate "the menu starts reading the cursor (the two paths diverge)" \
  "    const t = Math.max(0, Math.min(v.duration, v.currentTime || 0));" \
  "    const t = (trimTimeAtPointer(it) != null) ? trimTimeAtPointer(it) : Math.max(0, Math.min(v.duration, v.currentTime || 0));"

mutate "the dispatcher stops delegating to trimHotkey" \
  "    if (!typingIO && trimHotkey((e.key === 'i' || e.key === 'I') ? 'in' : 'out')) {" \
  "    if (false) {"

mutate "the palette entries go dead again" \
  "    case 'media-trim-i':           setTrimFromPlayhead('in');  return true;" \
  "    case 'media-trim-i':           return false;"

# ── version ───────────────────────────────────────────────────────────────

mutate "the version bump is forgotten" \
  "var KRAFTED_VERSION = '7.0.47';" \
  "var KRAFTED_VERSION = '7.0.46';"

print ""
print "restoring…"
cp kraftpub-v6.8.0.html $TMP/mut.html
KRAFTED_HTML=$TMP/mut.html KRAFTED_SW=$TMP/sw.js $NODE Krafted/tests/test_v7041.js 2>&1 | tail -2
rm -rf $TMP
