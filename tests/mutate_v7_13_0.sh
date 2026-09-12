#!/bin/zsh
# Mutation check for test_v7_13_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# Every mutation below breaks one promise v7.13.0 makes: the zip parses, the
# note you typed is the note that ships, the clipboard carries what the board
# shows. If any of them survives, the suite is decoration.
#
# NOTE: never run against the dev file; we always mutate a throwaway copy.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7130
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_13_0.js 2>&1)
  if [ "$EQUIV" -eq 1 ]; then judge_equiv "$1" "$out"; else judge "$1" "$out"; fi
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7130/mut.html'
s = open(p, encoding='utf-8').read()
n = s.count(old)
if n != want:
    print('    !! anchor matched %d times, want %d' % (n, want)); sys.exit(2)
open(p, 'w', encoding='utf-8').write(s.replace(old, new))
PYEOF
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
print "mutation check: v7.16.0 suite (per-image notes, zip, copy-what-you-see)"

# ── the zip writer ────────────────────────────────────────────────────────

mutate "zip entries are marked deflate but stored raw (unreadable archive)" \
  "        lv.setUint16(8, 0, true);    // method = stored" \
  "        lv.setUint16(8, 8, true);    // method = stored"

mutate "the local header carries a zero crc (every unzipper complains)" \
  "        lv.setUint32(14, crc, true);" \
  "        lv.setUint32(14, 0, true);"

mutate "the EOCD claims the archive is empty" \
  "      ev.setUint16(8, files.length, true);" \
  "      ev.setUint16(8, 0, true);"

# ── per-image typing + write-back ─────────────────────────────────────────

# The changed-gate and the pushUndo line share a prefix, so each anchor is
# long enough to be unique on its own.
mutate "the write-back never pushes undo (a typed note cannot be undone)" \
  "  if (!changed) return;
  try { pushUndo(); } catch (e) {}
  for (let i = 0; i < items.length; i++) {" \
  "  if (!changed) return;
  for (let i = 0; i < items.length; i++) {"

mutate "the write-back pushes undo even when nothing changed (undo noise)" \
  "  if (!changed) return;
  try { pushUndo(); } catch (e) {}" \
  "  try { pushUndo(); } catch (e) {}"

mutate "typed rows are ignored — the stored note always wins" \
  "    const el = document.getElementById('notes-row-' + i);
    return el ? String(el.value || '') : String((it && it.note) || '');" \
  "    return String((it && it.note) || '');"

mutate "rows are no longer prefilled (the existing note looks lost)" \
  "  ta.value = String((it && it.note) || '');" \
  "  ta.value = '';"

# ── the contact sheet ─────────────────────────────────────────────────────

mutate "the grid rounds down (10 images get 3 columns and overflow)" \
  "  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));" \
  "  const cols = Math.max(1, Math.floor(Math.sqrt(n)));"

mutate "the long-edge cap is gone (a 25-image sheet is 4644px)" \
  "const COPY_SHEET_MAX_SIDE = 4096;" \
  "const COPY_SHEET_MAX_SIDE = 999999;"

mutate "fit crops instead of containing (max instead of min)" \
  "  const s = Math.min(rect.w / iw, rect.h / ih);" \
  "  const s = Math.max(rect.w / iw, rect.h / ih);"

mutate "the sheet has no background (transparent gaps paste as black/white)" \
  "  ctx.fillStyle = opts.bg || '#0d0d0f';
  ctx.fillRect(0, 0, cv.width, cv.height);" \
  "  ctx.fillStyle = opts.bg || '#0d0d0f';"

mutate "shrinkCanvas never shrinks (multi-copy holds full-res bakes)" \
  "  if (s >= 1) return cv;" \
  "  if (true) return cv;"

# ── copy what you see ─────────────────────────────────────────────────────

# Observable because the suite asserts the draws reference the SHRUNK canvases
# and that the single path never fetches the original.
mutate "the copy path no longer bakes through the renderer" \
  "  const r = renderItemRegion(item, [
    _geoApply(aff, 0, 0), _geoApply(aff, w, 0),
    _geoApply(aff, w, h), _geoApply(aff, 0, h)
  ], {});" \
  "  const r = null;"

mutate "the multi-selection keeps full-resolution bakes (memory bomb)" \
  "    baked.push(multi ? shrinkCanvas(cv, COPY_SHEET_CELL * 2) : cv);" \
  "    baked.push(cv);"

mutate "a single unreadable image copies nothing (fallback deleted)" \
  "    if (items.length === 1 && items[0].src) {" \
  "    if (false) {"

print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
