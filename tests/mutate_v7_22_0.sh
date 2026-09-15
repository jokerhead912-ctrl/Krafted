#!/bin/zsh
# Mutation check for test_v7_22_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.22.0 promises:
#   1. a lib-row thumbnail is NEVER the full-resolution original (150 rows x a
#      4000px source was ~618 MB of live bitmaps and the renderer OOM'd);
#   2. one sizing rule, long side capped at LIB_THUMB_MAX_SIDE, never upscaled;
#   3. one cache per item, so re-rendering the panel on every keystroke does
#      not re-decode; a changed source invalidates it; a failed decode is
#      cached as null so 150 broken rows are not retried forever;
#   4. concurrency is capped, and the decoded original is RELEASED before the
#      next one starts (otherwise the real peak is CAP + 1);
#   5. the glyph fallback lives in one function, so the no-image path and the
#      failed-decode path cannot drift apart.
# If any mutation below survives, the suite is decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7220
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_22_0.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7220/mut.html'
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

CAUGHT=0; NOTCAUGHT=0; FRAGILE=0; SKIP=0; ANCHORFAIL=0
. Krafted/tests/mutlib.sh

# ── group A: the cap and the sizing rule ──────────────────────────────────
mutate "A1 thumbnail cap raised to 960 (no longer a thumbnail)" \
  "var LIB_THUMB_MAX_SIDE = 96;" "var LIB_THUMB_MAX_SIDE = 960;"

mutate "A2 sizing uses the SHORT side, so a 4000x3000 source stays huge" \
  "  var m = Math.max(w, h);" "  var m = Math.min(w, h);"

mutate "A3 small images get upscaled to the cap" \
  "  if (m <= cap) return { w: w, h: h };" "  if (false) return { w: w, h: h };"

mutate "A4 the floor of 1 is dropped, so a 1x1000 image becomes 0x96" \
  "  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };" \
  "  return { w: Math.round(w * k), h: Math.round(h * k) };"

mutate "A5 input is no longer clamped, so 0x0 flows straight through" \
  "  w = Math.max(1, w | 0);
  h = Math.max(1, h | 0);
  cap = Math.max(1, cap | 0);" \
  "  w = w | 0;
  h = h | 0;
  cap = cap | 0;"

# ── group B: the cache ────────────────────────────────────────────────────
mutate "B1 a done cache entry is never served (re-decode on every keystroke)" \
  "    if (entry.state === 'done') { try { cb(entry.url); } catch (e) {} return entry.url; }" \
  "    if (false) { try { cb(entry.url); } catch (e) {} return entry.url; }"

mutate "B2 the entry is never written to the cache" \
  "  libThumbSet(it, entry);" "  ;"

mutate "B3 a CHANGED source is not invalidated (stale thumbnail served)" \
  "  if (entry && entry.src === src) {" "  if (entry) {"

mutate "B4 a failed decode is NOT cached as null (150 broken rows retry forever)" \
  "  img.onerror = function () { finish(null); };" \
  "  img.onerror = function () { finish(job.src); };"

mutate "B5 no source still waits forever instead of answering null" \
  "  if (!src) { try { cb(null); } catch (e) {} return null; }" \
  "  if (!src) { return null; }"

mutate "B6 the job is never queued, so nothing is ever decoded" \
  "  _libThumbQueue.push({ entry: entry, src: src });" "  ;"

mutate "B7 pending callers do not piggyback (3 callers = 3 decodes)" \
  "    entry.cbs.push(cb);
    return null;" \
  "    return null;"

# ── group C: the actual downscale ─────────────────────────────────────────
mutate "C1 drawImage uses the source size, so the canvas is 4000x3000" \
  "    try { cx.drawImage(img, 0, 0, fit.w, fit.h); } catch (e) { finish(job.src); return; }" \
  "    try { cx.drawImage(img, 0, 0); } catch (e) { finish(job.src); return; }"

mutate "C2 the canvas is sized from the source, not from the fit" \
  "    cv.width = fit.w;
    cv.height = fit.h;" \
  "    cv.width = iw;
    cv.height = ih;"

mutate "C3 toDataURL is sabotaged, so the original is handed back" \
  "    try { out = cv.toDataURL('image/jpeg', LIB_THUMB_JPEG_Q); } catch (e) { out = ''; }" \
  "    out = '';"

mutate "C4 small images are pointlessly re-encoded" \
  "    if (fit.w >= iw && fit.h >= ih) { finish(job.src); return; }" \
  "    if (false) { finish(job.src); return; }"

mutate "C5 an unmeasurable image is treated as broken instead of as-is" \
  "    if (!iw || !ih) { finish(job.src); return; }" \
  "    if (!iw || !ih) { finish(null); return; }"

# ── group D: memory actually released, concurrency actually capped ─────────
mutate "D1 the decoded original is not released (peak becomes CAP + 1)" \
  "    done();
    img = null;" "    done();"

mutate "D2 the pump runs inside the finished decode's stack" \
  "      setTimeout(function () { _libThumbPump(); }, 0);" "      _libThumbPump();"

mutate "D3 the concurrency cap is removed entirely" \
  "var LIB_THUMB_CONCURRENCY = 4;" "var LIB_THUMB_CONCURRENCY = 999;"

# ── group E: the rendered row ─────────────────────────────────────────────
mutate "E1 THE ORIGINAL BUG: the row points <img> at the full-resolution src" \
  "      var im = document.createElement('img');
      im.draggable = false;" \
  "      var im = document.createElement('img');
      im.src = src;
      im.draggable = false;"

mutate "E2 the row does not ask the thumbnail pipeline at all" \
  "      libThumbFor(it, function (u) {" "      libThumbSrc(it); (function (u) {"

mutate "E3 a late callback is applied to a row that has been re-rendered away" \
  "        if (token !== listEl._libRenderToken) return;" "        if (false) return;"

# E7/E8 pin the regression the LIVE smoke test found (round 4): guarding on
# isConnected instead of the render generation silently dropped every
# thumbnail on every render after the first, because a cached hit calls back
# synchronously while the row is still being built.
mutate "E7 the render generation is never bumped (all rows share one token)" \
  "  listEl._libRenderToken = (listEl._libRenderToken | 0) + 1;" "  ;"

mutate "E8 the row captures a bogus token, so no thumbnail is ever installed" \
  "      var token = listEl._libRenderToken;" "      var token = -1;"

mutate "E9 REGRESSION: guard on isConnected again (drops every cached thumbnail)" \
  "        if (token !== listEl._libRenderToken) return;" \
  "        if (!im.isConnected) return;"

mutate "E4 the glyph fallback is skipped, so a failed decode leaves an empty box" \
  "        if (im.parentNode) im.parentNode.removeChild(im);
        showGlyph();" \
  "        if (im.parentNode) im.parentNode.removeChild(im);"

mutate "E5 isText no longer wins over type" \
  "  if (isText) return 'T';" "  if (false) return 'T';"

mutate "E6 video no longer gets its own glyph" \
  "  if (t === 'video') return '\\u25B6';" "  if (t === 'video') return '?';"

cp kraftpub-dev.html $TMP/mut.html
print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
