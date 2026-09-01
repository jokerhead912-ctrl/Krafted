#!/bin/zsh
# Mutation check for test_v7040.js — deliberately break the source, confirm the
# suite goes red, restore. A suite that cannot fail is not a suite.
# NOTE: never run against the dev file; we always mutate a throwaway copy.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html
cp Krafted/docs/sw.js $TMP/sw.js

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html KRAFTED_SW=$TMP/sw.js $NODE Krafted/tests/test_v7040.js 2>&1 | tail -3 | tr '\n' ' ')
  if echo "$out" | grep -q "ALL PASS"; then
    print "  NOT CAUGHT  <- $1"
  else
    print "  caught      ${out#*assertions) }   <- $1"
  fi
}

mutate() { # mutate(label, python_old, python_new)
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" <<'PY'
import sys
old, new = sys.argv[1], sys.argv[2]
p = '/tmp/krafted-mutate/mut.html'
s = open(p, encoding='utf-8').read()
n = s.count(old)
if n != 1:
    print('    !! anchor matched %d times' % n); sys.exit(2)
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
  if [ $? -ne 0 ]; then print "  SKIPPED (anchor)  <- $1"; return; fi
  run "$1"
}

print "mutation check: v7.0.40 suite"

mutate "capture resolves on the currentTime poll (the original bug)" \
  "      v.addEventListener('seeked', onSeeked);
      if (v.readyState >= 2 && !v.seeking && Math.abs((v.currentTime || 0) - target) < 0.02) {
        onSeeked();              // already sitting on that frame — no seek needed
      } else {
        v.currentTime = target;
      }" \
  "      v.currentTime = target;
      setTimeout(function () {
        if (!settled && v.readyState >= 2) finish(videoAnnoCaptureSnapshot(v, maxW, c.annoStrokes));
      }, 60);"

mutate "rVFC trusted alone (no timer fallback)" \
  "          rvf = v.requestVideoFrameCallback(run);
          setTimeout(run, 600);   // rVFC is not guaranteed on a paused element
          return;" \
  "          rvf = v.requestVideoFrameCallback(run);
          return;"

mutate "a seek landing far away is accepted" \
  "      if (Math.abs((v.currentTime || 0) - target) > 0.5) return;" \
  "      if (false) return;"

mutate "export stops suspending the trim loop" \
  "  // Suspend the loop for the duration of the export (see the handler above).
  v._kraftedSuppressTrimLoop = true;" \
  "  v._kraftedSuppressTrimLoop = false;"

mutate "Send-to-Board stops suspending the trim loop" \
  "    // v7.0.40: this path seeks, and a trimmed clip's timeupdate loop
    // yanks the playhead home before \`seeked\` can fire.
    v._kraftedSuppressTrimLoop = true;" \
  "    v._kraftedSuppressTrimLoop = false;"

mutate "views may upscale past 1:1" \
  "var VIEW_MAX_ZOOM = 1;" \
  "var VIEW_MAX_ZOOM = 10;"

mutate "camera zoom interpolates linearly" \
  "    applyCamera(c0x + (cx - c0x) * e, c0y + (cy - c0y) * e, z0 * Math.pow(z1 / z0, e));" \
  "    applyCamera(c0x + (cx - c0x) * e, c0y + (cy - c0y) * e, z0 + (z1 - z0) * e);"

mutate "a stale flight is not cancelled" \
  "    if (token !== state._viewFlight) return;   // a newer flight took over" \
  "    if (false) return;"

mutate "views freeze coordinates instead of following ids" \
  "    return { cx: (bb.minX + bb.maxX) / 2, cy: (bb.minY + bb.maxY) / 2, zoom: z };" \
  "    return { cx: v.panX || 0, cy: v.panY || 0, zoom: z };"

mutate "stepping back off the first shot ends the tape" \
  "  if (i >= list.length) {" \
  "  if (i >= list.length || i < 0) {"

mutate "Alt+digit matches ev.key instead of ev.code" \
  "  const code = ev.code || '';" \
  "  const code = ev.key || '';"

mutate "compare panes are fitted independently (no shared frame)" \
  "  fb.style.width = bw + 'px'; fb.style.height = bh + 'px';" \
  "  fb.style.width = (sw * 0.5) + 'px'; fb.style.height = bh + 'px';"

mutate "the wipe position is not clamped" \
  "  const pos = Math.max(0, Math.min(100, (typeof p === 'number' && isFinite(p)) ? p : 50));" \
  "  const pos = (typeof p === 'number' && isFinite(p)) ? p : 50;"

mutate "compare opens on any number of items" \
  "  return pair.length === 2 && _abItemComparable(pair[0]) && _abItemComparable(pair[1]);" \
  "  return pair.length >= 1 && _abItemComparable(pair[0] || {});"

mutate "clearing the board leaves the views behind" \
  "  state.views = [];
  state._activeViewIndex = -1;
  G.nextViewId = 1;" \
  "  void 0;"

print ""
print "restoring…"
cp kraftpub-dev.html $TMP/mut.html
KRAFTED_HTML=$TMP/mut.html KRAFTED_SW=$TMP/sw.js $NODE Krafted/tests/test_v7040.js 2>&1 | tail -2
rm -rf $TMP
