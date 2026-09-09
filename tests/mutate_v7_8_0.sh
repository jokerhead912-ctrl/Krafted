#!/bin/zsh
# Mutation check for test_v7_8_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
#   "剪咗佢出嚟之後...旋轉,然之後我再剪...位置唔一樣"   (the AABB bug)
#   "我想可以有拆除我唔要嘅地方"                        (knock out)
#
# Every mutation below restores one half of the OLD world: the axis-aligned
# measurement, the inherited rotation, the painted-over hole, the missing
# undo. If any of them survives, the suite is decoration.
#
# NOTE: never run against the dev file; we always mutate a throwaway copy.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate780
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html
cp Krafted/docs/sw.js $TMP/sw.js

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html KRAFTED_SW=$TMP/sw.js $NODE Krafted/tests/test_v7_8_0.js 2>&1)
  if [ "$EQUIV" -eq 1 ]; then judge_equiv "$1" "$out"; else judge "$1" "$out"; fi
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PY'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate780/mut.html'
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
print "mutation check: v7.12.0 suite (pixel-accurate cut/lasso + knock out)"

# ── THE COMPLAINT: a cut from a rotated source lands somewhere else ───────

mutate "object-fit ignored — cover crops, but the mapper maps the whole box" \
  "    fx = fy = f;" \
  "    fx = boxW / natW; fy = boxH / natH;"

mutate "object-position ignored — the crop offset is dropped" \
  "  if (v && v.indexOf('%') >= 0) return free * ((parseFloat(v) || 0) / 100);" \
  "  if (v && v.indexOf('%') >= 0) return 0;"

mutate "reframe ignored — the inner <img> transform is dropped" \
  "  var tImg = (cs.transform && cs.transform !== 'none') ? cs.transform : '';" \
  "  var tImg = '';"

mutate "the output transform forgets the screen offset (crop lands at the origin)" \
  "    e: (M.e - sL) * k, f: (M.f - sT) * k" \
  "    e: M.e * k, f: M.f * k"

mutate "the crop renders at screen resolution, not source resolution" \
  "  let k = 1 / g;" \
  "  let k = 1;"

mutate "the polygon no longer clips — a cut-out becomes a full rectangle" \
  "    traceNat();
    ctx.clip();" \
  "    traceNat();
    /* ctx.clip(); */"

mutate "the copy is placed on the item origin instead of the drawn pixels" \
  "    worldX = wTL.x;" \
  "    worldX = item.x;"

mutate "beside placement uses a screen-space offset instead of world" \
  "    worldX = item.x + item.w + 20 / (state.zoom || 1);" \
  "    worldX = item.x + item.w + 20 / (state.zoom || 1) * (state.zoom || 1);"

# ── THE DRIFT: the extracted copy keeps the rotation, so the NEXT cut ──────
# ── reads an already-rotated image through a second rotation ──────────────

mutate "the copy inherits the source rotation (baked pixels spun a second time)" \
  "  newItem.rot = 0;" \
  "  newItem.rot = item.rot || 0;"

mutate "the copy inherits the horizontal flip" \
  "  newItem.flipH = false;" \
  "  newItem.flipH = item.flipH || false;"

mutate "the copy inherits the vertical flip" \
  "  newItem.flipV = false;" \
  "  newItem.flipV = item.flipV || false;"

# v7.9.0: this guard now lives in the one shared renderer (renderItemRegion),
# so breaking it breaks cut, lasso AND export together. knockOut still keeps
# its own copy further down — it renders the full source, not a crop.
mutate "a shape drawn off the image is no longer refused (empty item)" \
  "  if (nR < 0 || nB < 0 || nL > natW || nT > natH) return fail('Selection is outside the image');

  // Render at the source's own resolution" \
  "  /* guard removed */

  // Render at the source's own resolution"

mutate "the border thickness is no longer floored (hairline on a small cut)" \
  "      ctx.lineWidth = Math.max(2, Math.round(Math.min(outW, outH) * 0.012));" \
  "      ctx.lineWidth = 1;"

# ── KNOCK OUT ────────────────────────────────────────────────────────────

mutate "the hole is painted over instead of SUBTRACTED (opaque, not transparent)" \
  "    ctx.drawImage(imgEl, 0, 0, natW, natH);
    ctx.globalCompositeOperation = 'destination-out';" \
  "    ctx.drawImage(imgEl, 0, 0, natW, natH);
    ctx.globalCompositeOperation = 'source-over';"

mutate "the knock-out canvas is not the full natural size (framing goes stale)" \
  "  cv.width = natW; cv.height = natH;" \
  "  cv.width = natW / 2; cv.height = natH / 2;"

mutate "knock out is not undoable (the old pixels are gone for good)" \
  "  // Undo FIRST: the snapshot has to hold the pixels we are about to throw away.
  pushUndo();" \
  "  /* pushUndo(); */"

mutate "the new pixels never reach KPAK save (the hole vanishes on reload)" \
  "  item._sourceBlob = blob;
  item._fileSize = blob.size;
  item.img.src = url;" \
  "  item._fileSize = blob.size;
  item.img.src = url;"

# v7.8.0: the save estimate and the autosave size guard both read it._fileSize,
# so a knock-out has to record the size of the PNG it just encoded. Drop the
# line and the estimate keeps quoting the pre-knock-out bytes - the same stale
# number that made the v7.2.1 progress bar claim 735 MB for a 3.8 MB board.
# test_v7_2_1.js finds this one too; it pins the invariant for every path that
# hands an item a Blob, knock-out included.
mutate "knock out records no size, so the save estimate keeps the old bytes" \
  "  item._sourceBlob = blob;
  item._fileSize = blob.size;
  item.img.src = url;" \
  "  item._sourceBlob = blob;
  item.img.src = url;"

mutate "the visible <img> is never swapped (the hole is invisible until reload)" \
  "  item.img.src = url;" \
  "  /* item.img.src = url; */"

mutate "a hole drawn off the image is no longer refused" \
  "  if (nR < 0 || nB < 0 || nL > natW || nT > natH) { toast('Selection is outside the image'); return null; }

  const cv = document.createElement('canvas');
  cv.width = natW; cv.height = natH;" \
  "  /* guard removed */

  const cv = document.createElement('canvas');
  cv.width = natW; cv.height = natH;"

# ── UI WIRING ────────────────────────────────────────────────────────────

mutate "the cut Knock out button is never shown or hidden" \
  "  cutKnockBtn.style.display = v;" \
  "  /* cutKnockBtn.style.display = v; */"

mutate "the lasso Knock out button is never shown or hidden" \
  "  lassoKnockBtn.style.display = v;" \
  "  /* lassoKnockBtn.style.display = v; */"

# NB: the suite greps for the literal, so the mutant has to DELETE the text.
# Wrapping it in a comment leaves the string present and the grep still passes —
# 病根四：缺席唔等于发现; a mutation that changes nothing is not a mutation.
mutate "Knock out is left untranslated" \
  "    'Knock out': '挖空',
" \
  ""

# ── VERSION ──────────────────────────────────────────────────────────────
# The anchor names the version the source now carries; version_scan.py moves
# it at every bump. Left stale it matches 0 times and tests nothing.
mutate "KRAFTED_VERSION not bumped" \
  "var KRAFTED_VERSION = '7.12.0';" \
  "var KRAFTED_VERSION = '7.11.0';"

print ""
if [ $ANCHORFAIL -ne 0 ]; then
  print "SKIPPED $ANCHORFAIL (anchor did not match — a skipped mutation is not a passing one)"
fi
if [ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ]; then
  print "ALL MUTATIONS CAUGHT"
else
  print "$NOTCAUGHT NOT CAUGHT"
fi

# ── machine-readable verdict ─────────────────────────────────────────────
if [ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ]; then
  print "MUTVERDICT ok  holes=0 skipped=0 caught=$CAUGHT fragile=$FRAGILE"
  exit 0
fi
print "MUTVERDICT BAD holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit 1
