#!/bin/zsh
# Mutation check for test_v7_21_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.21.0 promises:
#   1. fps is resolved from the video being annotated, NEVER from the board
#      selection (the original bug: getCurrentFps() reads getSelectedImages()[0]);
#   2. one verified seek that reports the time ACTUALLY reached and refuses to
#      settle while the drift exceeds tolerance;
#   3. one batch Snap that stores the captured time, not the requested one,
#      commits any open text editor first, suppresses the trim loop, and
#      restores the playhead;
#   4. time is the single truth for a comment anchor, frame is derived;
#   5. a comment id knows its own video, so delete / edit / jump work with two
#      or more clips on the board, and no failure is silent;
#   6. ↻ re-snaps one comment without deleting it.
# If any mutation below survives, the suite is decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7210
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_21_0.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7210/mut.html'
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

# ── group A0: ordering + export fps (added with the release, pinned same day) ─

mutate "export + send-to-board order by frame again" \
  "  const comments = (anno.comments || []).slice().sort(function (a, b) {
    return videoAnnoCommentTime(a, item) - videoAnnoCommentTime(b, item);
  });" \
  "  const comments = (anno.comments || []).slice().sort(function (a, b) {
    return (a.frame || 0) - (b.frame || 0);
  });" 2

mutate "J/K navigation orders by frame again" \
  "  return comments.slice().sort(function (a, b) {
    return videoAnnoCommentTime(a, item) - videoAnnoCommentTime(b, item);
  });" \
  "  return comments.slice().sort(function (a, b) {
    return (a.frame || 0) - (b.frame || 0);
  });"

mutate "the popover list orders by frame again" \
  "    const sorted = comments.slice().sort(function (a, b) {
      return videoAnnoCommentTime(a, _itm) - videoAnnoCommentTime(b, _itm);
    });" \
  "    const sorted = comments.slice().sort(function (a, b) {
      return (a.frame || 0) - (b.frame || 0);
    });"

mutate "export fps comes from the board selection again" \
  "  // wrong clip. One definition: the clip's own fps.
  const fps = videoAnnoFpsFor(item);" \
  "  // wrong clip. One definition: the clip's own fps.
  const fps = (typeof getCurrentFps === 'function') ? getCurrentFps() : (v._kraftedFps || 30);"

# ── group A: the fps definition (the original bug) ──────────────────────────
mutate "fps goes back to a flat 30 for every clip" \
"  if (el && el._kraftedFps && isFinite(el._kraftedFps) && el._kraftedFps > 0) return el._kraftedFps;" \
"  if (el && el._kraftedFps && isFinite(el._kraftedFps) && el._kraftedFps > 0) return 30;"

mutate "fps comes from the board selection again (the exact v7.22.0 bug)" \
"  return videoAnnoFpsForEl(item && item.video);" \
"  return videoAnnoFpsForEl((getSelectedImages()[0] || {}).video);"

mutate "_currentFrame — the stroke KEY — goes back to a fixed fps" \
"      const fps = videoAnnoFpsForEl(mediaEl);
      return Math.max(0, Math.floor((mediaEl.currentTime || 0) * fps));" \
"      const fps = 30;
      return Math.max(0, Math.floor((mediaEl.currentTime || 0) * fps));"

mutate "the frame indicator silently disagrees with _currentFrame" \
"      const fps = videoAnnoFpsForEl(mediaEl);
      const f = Math.max(0, Math.floor((mediaEl.currentTime || 0) * fps));" \
"      const fps = 30;
      const f = Math.max(0, Math.floor((mediaEl.currentTime || 0) * fps));"

# ── group B: the verified seek ──────────────────────────────────────────────
mutate "the seek accepts a frame it never reached" \
"      if (Math.abs(actual - target) > drift) return;" \
"      ;"

mutate "the seek reports the time it ASKED for, not the one it reached" \
"      afterFrame(function () { done(actual, true); });" \
"      afterFrame(function () { done(target, true); });"

mutate "a timed-out seek is reported as success" \
"        done((typeof v.currentTime === 'number') ? v.currentTime : 0, false);" \
"        done((typeof v.currentTime === 'number') ? v.currentTime : 0, true);"

mutate "the seek never gives up (timeout removed)" \
"      timer = setTimeout(function () {" \
"      timer = null && setTimeout(function () {"

# ── group C: the batch Snap stores what it captured ─────────────────────────
mutate "Snap stores the requested time instead of the captured one" \
"    time: actual," \
"    time: targetTime,"

mutate "Snap stores the requested frame number instead of the derived one" \
"    frame: Math.max(0, Math.round(actual * fps))," \
"    frame: frame,"

mutate "Snap stops recording the drift, so a bad capture goes silent" \
"    snapDrift: actual - targetTime," \
"    snapDrift: 0,"

mutate "Snap stops committing the open text editor" \
"  if (item.el && item.el._commitTextEditor && item.el._textEditorEl) {
    try { item.el._commitTextEditor(true); } catch (e) {}
  }
  const v = item.video;
  const fps = videoAnnoFpsFor(item);" \
"  const v = item.video;
  const fps = videoAnnoFpsFor(item);"

# Backticks in an anchor are command substitution in zsh — the `const dur =`
# tail disambiguates the batch copy from the re-snap copy without one.
mutate "Snap stops suppressing the trim loop" \
"  v._kraftedSuppressTrimLoop = true;
  try { v.pause(); } catch (e) {}
  try { pushUndo(); } catch (e) {}

  const dur = (typeof v.duration" \
"  v._kraftedSuppressTrimLoop = false;
  try { v.pause(); } catch (e) {}
  try { pushUndo(); } catch (e) {}

  const dur = (typeof v.duration"

mutate "re-snap stops suppressing the trim loop" \
"  v._kraftedSuppressTrimLoop = true;
  try { v.pause(); } catch (e) {}
  try { pushUndo(); } catch (e) {}
  return videoAnnoSeekTo(v, target, 0.5)" \
"  v._kraftedSuppressTrimLoop = false;
  try { v.pause(); } catch (e) {}
  try { pushUndo(); } catch (e) {}
  return videoAnnoSeekTo(v, target, 0.5)"

mutate "the trim loop suppression is set after the captures, not before" \
"  const restore = function () {
    v._kraftedSuppressTrimLoop = prevSuppress;" \
"  const restore = function () {
    v._kraftedSuppressTrimLoop = true;"

mutate "Snap leaves the playhead where the last capture put it" \
"    v._kraftedSuppressTrimLoop = prevSuppress;
    try { v.currentTime = origTime; } catch (e) {}
    if (!wasPaused) { try { resumeMediaEl(v); } catch (e) {} }
  };" \
"    v._kraftedSuppressTrimLoop = prevSuppress;
    if (!wasPaused) { try { resumeMediaEl(v); } catch (e) {} }
  };"

mutate "Snap duplicates a frame that already has a comment" \
"  const newFrames = framesWithStrokes.filter(function (f) { return !existing[f]; });" \
"  const newFrames = framesWithStrokes.slice();"

# ── group D: the comment id knows its own video ─────────────────────────────
mutate "the owner lookup stops finding anything" \
"      if (cs[j] && cs[j].id === id) return it;" \
"      if (cs[j] && cs[j].id === id) return null;"

mutate "delete goes silent again when the comment is not on the resolved clip" \
"  if (idx === -1) { toast('Comment not found on this video'); return; }" \
"  if (idx === -1) { return; }"

mutate "delete goes silent again when it cannot find an owner" \
"  if (!item) { toast('Cannot delete — select the video this comment belongs to'); return; }" \
"  if (!item) { return; }"

mutate "delete falls back to the old selection-only lookup" \
"  const item = videoAnnoFindCommentOwner(id) || videoAnnoGetSelected();
  if (!item) { toast('Cannot delete — select the video this comment belongs to'); return; }" \
"  const item = videoAnnoGetSelected();
  if (!item) { toast('Cannot delete — select the video this comment belongs to'); return; }"

mutate "the multi-selection fallback in videoAnnoGetSelected is removed" \
"  if (sel.length > 1) {
    const selVideos = sel.filter(function (i) { return i && i.isVideo; });
    if (selVideos.length === 1) return selVideos[0];
  }" \
"  ;"

# ── group E: time is the truth ──────────────────────────────────────────────
mutate "the stored frame overrides the stored time (frame becomes truth again)" \
"  if (c && typeof c.time === 'number' && isFinite(c.time)) return c.time;" \
"  if (c && typeof c.time === 'number' && isFinite(c.time)) return (c.frame || 0) / 25;"

mutate "the displayed frame stops being derived from time" \
"  return Math.max(0, Math.round(videoAnnoCommentTime(c, item) * videoAnnoFpsFor(item)));" \
"  return Math.max(0, Math.round(c.frame || 0));"

mutate "jump reads c.time raw, breaking pre-v7.22.0 files" \
"  v.currentTime = videoAnnoCommentTime(c, item);" \
"  v.currentTime = c.time;"

mutate "the comment list sorts by frame again" \
"    anno.comments.sort(function (a, b) {
      return videoAnnoCommentTime(a, item) - videoAnnoCommentTime(b, item);
    });" \
"    anno.comments.sort(function (a, b) {
      return (a.frame || 0) - (b.frame || 0);
    });"

mutate "the list stops deriving its displayed frame numbers" \
"    const _cf = videoAnnoCommentFrame(c, item);" \
"    const _cf = c.frame || 0;"

# ── group F: re-snap and the one-Snap rule ──────────────────────────────────
mutate "re-snap keeps the old snapshot instead of capturing a new one" \
"    if (snap) c.snapshot = snap;" \
"    ;"

mutate "re-snap records the requested time rather than the captured one" \
"    c.time = actual;
    c.targetTime = actual;" \
"    c.time = target;
    c.targetTime = target;"

mutate "both Snap buttons stop calling the shared batch (duplication returns)" \
"      if (typeof videoAnnoSnapBatch === 'function') await videoAnnoSnapBatch(itm);" \
"      if (false) await videoAnnoSnapBatch(itm);" 2

print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
