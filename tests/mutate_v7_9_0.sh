#!/bin/zsh
# Mutation check for test_v7_9_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
#   "我選擇好多圖片保存到本機,儲存的格式睇唔到"
#
# Every mutation below restores one half of the OLD world: the GUID extension,
# the selection-blind menu, the pre-edit bytes, the 300 download prompts, the
# silent overwrite of two files with the same name. If any of them survives,
# the suite is decoration.
#
# Two traps this script is built around (both cost a round last time):
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
TMP=/tmp/krafted-mutate790
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html
cp Krafted/docs/sw.js $TMP/sw.js

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html KRAFTED_SW=$TMP/sw.js $NODE Krafted/tests/test_v7_9_0.js 2>&1)
  if [ "$EQUIV" -eq 1 ]; then judge_equiv "$1" "$out"; else judge "$1" "$out"; fi
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PY'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate790/mut.html'
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
print "mutation check: v7.9.0 suite (export = the pixels you saw)"

# ── THE COMPLAINT: the saved files could not be opened ────────────────────

mutate "Download Source File takes the extension from the blob: URL again (the GUID tail)" \
  "      ext = extFromName(name, 'png');" \
  "      ext = item.src.split('.').pop().split('?')[0] || 'png';"

mutate "extFromName stops validating — any tail becomes an extension" \
  "  return /^[a-z0-9]{2,5}\$/.test(e) ? e : (fallback || '');" \
  "  return e;"

mutate "the mime table forgets jpeg -> jpg (Windows does not know .jpeg)" \
  "  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg'," \
  "  'image/png': 'png', 'image/jpeg': 'jpeg', 'image/jpg': 'jpg',"

mutate "extFromMime drops the lookup table and trusts the mime subtype" \
  "  if (EXPORT_MIME_EXT[m]) return EXPORT_MIME_EXT[m];" \
  ""

mutate "exportBaseName ignores the original file name" \
  "  var n = stripExt((item && (item.filename || item.name)) || '').trim();" \
  "  var n = '';"

mutate "duplicate file names overwrite each other again" \
  "    while (seen[nm.toLowerCase()]) { nm = base + '_' + k; k++; }" \
  ""

mutate "the suffix counter is case-sensitive, so a and A collide on Windows" \
  "    while (seen[nm.toLowerCase()]) { nm = base + '_' + k; k++; }
    seen[nm.toLowerCase()] = true;" \
  "    while (seen[nm]) { nm = base + '_' + k; k++; }
    seen[nm] = true;"

# ── THE COMPLAINT: the exported image was not the one on the board ────────

mutate "the item quad collapses a corner — the exported crop is the wrong shape" \
  "    _geoProbe(item.el, 'left:' + W + 'px;top:0;')," \
  "    _geoProbe(item.el, 'left:' + W + 'px;top:' + H + 'px;'),"

mutate "the renderer ignores the colour grade it was handed" \
  "    if (opts.filter) ctx.filter = opts.filter;" \
  ""

mutate "bake never passes the grade — an exported image pops back to ungraded" \
  "    filter: (f === mediaFilterString({})) ? '' : f" \
  "    filter: ''"

mutate "bake always sets ctx.filter, even with no grade" \
  "    filter: (f === mediaFilterString({})) ? '' : f" \
  "    filter: f"

mutate "bake emits JPEG instead of PNG" \
  "    try { r.canvas.toBlob(function (b) { res(b); }, 'image/png'); }" \
  "    try { r.canvas.toBlob(function (b) { res(b); }, 'image/jpeg'); }"

mutate "bake stops releasing the canvas — 300 of them pile up" \
  "  try { r.canvas.width = 0; r.canvas.height = 0; } catch (e) {}" \
  ""

# ── the driver: selection, format, sink, cancel ──────────────────────────

mutate "the selection is ignored — every export is the whole board" \
  "  if (sel && sel.length > 0) {" \
  "  if (false && sel && sel.length > 0) {"

mutate "a baked export takes the extension from the source file, not PNG" \
  "        ext = 'png';" \
  "        ext = extFromName(images[i].filename, 'png');"

mutate "the driver forgets to de-duplicate names" \
  "  const names = dedupeExportNames(images.map((it, i) => exportBaseName(it, i)));" \
  "  const names = images.map((it, i) => exportBaseName(it, i));"

mutate "original mode ignores the blob's real type" \
  "        ext = extFromMime(blob.type, extFromName(images[i].filename, 'png'));" \
  "        ext = 'png';"

mutate "Safari and Firefox get 300 download prompts again instead of one zip" \
  "  if (hasFileSystemAccess()) {" \
  "  if (true) {"

mutate "the zip is named .png so nothing recognises it" \
  "    'krafted-images') + '.zip';" \
  "    'krafted-images') + '.png';"

mutate "the zip is handed over with the wrong mime" \
  "kraftedSaveFile({ filename: zipName, blob: zipBlob, mime: 'application/zip' });" \
  "kraftedSaveFile({ filename: zipName, blob: zipBlob, mime: 'image/png' });"

mutate "cancel is ignored — the loop runs to the end anyway" \
  "    if (prog.cancelled()) break;" \
  ""

mutate "the progress card is built without a cancel handler" \
  "    onCancel: function () {}" \
  "    onCancel: null"

mutate "off-screen images are never un-culled, so they export blank" \
  "  _ensureAllImagesLive();
  // Determine which images to export" \
  "  // Determine which images to export"

# ── the menu ─────────────────────────────────────────────────────────────

mutate "the export entries vanish from the SELECTION menu again" \
  "    if (hasImages) html += exportMenuEntries(getSelectedImages().filter(i => i && i.src).length);" \
  ""

mutate "the entries are offered even with nothing to export" \
  "function exportMenuEntries(n) {
  if (!n) return '';" \
  "function exportMenuEntries(n) {
  if (false) return '';"

mutate "the count chip shows a placeholder instead of the real number" \
  "  const chip = ' <kbd style=\"opacity:.4\">' + n + '</kbd>';" \
  "  const chip = ' <kbd style=\"opacity:.4\">N</kbd>';"

mutate "the menu entry stops naming the format" \
  "Save images as PNG…' + chip" \
  "Save images…' + chip"

mutate "the PNG entry is translated no more" \
  "    'Save images as PNG…': '储存为 PNG 图片…'," \
  ""

print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo PROBLEM)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
