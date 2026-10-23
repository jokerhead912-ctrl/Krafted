#!/bin/zsh
# Mutation check for test_v7_25_1.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.25.1 promises:
#   1. cropEncodeMime (was applyCrop:36735) — a crop keeps the format the
#      picture actually is, instead of re-encoding everything as PNG because
#      the mime was sniffed out of a blob: URL that never matches /^data:/;
#   2. buildManifest (was:38518) — a data: URL is NOT copied into
#      manifest.json, because the packer already writes those bytes into
#      media/<id> (the 100MB board that saved as 700MB);
#   3. the tail of applyCrop — the pre-crop _sourceBlob is dropped and the new
#      byte size recorded, or saveBoardV6 saves the UNCROPPED original.
# If any mutation below survives, the suite is decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7251
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_25_1.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7251/mut.html'
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

# ── group A: cropEncodeMime (was applyCrop 36735) ─────────────────────────
# A1 is the bug itself, restored verbatim: every crop comes back as PNG.
mutate "A1 every re-encode is forced to PNG (the 5-10x JPEG bug, restored)" \
  "    return (m === 'image/jpeg' || m === 'image/webp') ? m : 'image/png';" \
  "    return 'image/png';"

mutate "A2 the imported Blob is ignored (a dropped JPEG has no data: URL)" \
  "  if (sb instanceof Blob && sb.type) return writable(sb.type);" \
  "  if (false) return writable(sb.type);"

mutate "A3 an already-inlined data: URL is ignored (crop of a crop)" \
  "  if (inline) return writable(inline);" \
  "  if (false) return writable(inline);"

mutate "A4 the .jpg / .jpeg extension is no longer recognised" \
  "  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';" \
  "  if (ext === 'jpg' || ext === 'jpeg') return 'image/png';"

mutate "A5 the .webp extension is no longer recognised" \
  "  if (ext === 'webp') return 'image/webp';" \
  "  if (ext === 'webp') return 'image/png';"

# A canvas cannot encode GIF/AVIF. Claiming it can hands back PNG bytes under
# a format label nobody checks, which is worse than an honest PNG.
mutate "A6 GIF is claimed as writable (a PNG labelled image/gif)" \
  "    return (m === 'image/jpeg' || m === 'image/webp') ? m : 'image/png';" \
  "    return (m === 'image/jpeg' || m === 'image/webp' || m === 'image/gif') ? m : 'image/png';"

# 病根一: applyCrop hand-writing its own mime sniff is how this drifted in the
# first place. Prove the "one writer" claim is load-bearing.
mutate "A7 applyCrop hand-writes the mime again (two writers, 病根一)" \
  "    const mime = cropEncodeMime(item);" \
  "    const mime = 'image/png';"

# ── group B: dataUrlByteLength (the ONE base64 counter) ───────────────────
mutate "B1 the base64 is not decoded (400 chars reported as 400 bytes)" \
  "  return Math.max(0, Math.floor(b64.length * 3 / 4) - pad);" \
  "  return b64.length;"

mutate "B2 the two-character pad is ignored (a shorter file reported as longer)" \
  "  if (b64.slice(-2) === '==') pad = 2;" \
  "  if (false) pad = 2;"

mutate "B3 the one-character pad is ignored" \
  "  else if (b64.slice(-1) === '=') pad = 1;" \
  "  else if (false) pad = 1;"

mutate "B4 the header is counted as data (the 'data:image/png;base64,' prefix)" \
  "  const b64 = (comma >= 0) ? s.slice(comma + 1) : s;" \
  "  const b64 = s;"

# ── group C: buildManifest (was 38518) ────────────────────────────────────
# C1 is the bug itself, restored verbatim: the bytes go in twice.
mutate "C1 the data: URL is copied into the manifest again (the 2.33x, restored)" \
  "    d.src = (typeof i.src === 'string' && i.src.startsWith('data:')) ? '' : i.src;" \
  "    d.src = i.src;"

mutate "C2 src is dropped for everything (link images lose their only copy)" \
  "    d.src = (typeof i.src === 'string' && i.src.startsWith('data:')) ? '' : i.src;" \
  "    d.src = '';"

mutate "C3 the test is inverted (cropped bytes kept, remote ones thrown away)" \
  "    d.src = (typeof i.src === 'string' && i.src.startsWith('data:')) ? '' : i.src;" \
  "    d.src = (typeof i.src === 'string' && i.src.startsWith('data:')) ? i.src : '';"

# ── group D: the tail of applyCrop ────────────────────────────────────────
# D1 is the bug itself: saveBoardV6 prefers _sourceBlob over fetch(src), so a
# stale Blob is what lands in media/<id> — the UNCROPPED original.
mutate "D1 the pre-crop Blob is kept (the zip saves the UNCROPPED original)" \
  "  item._sourceBlob = null;" \
  "  item._sourceBlob = item._sourceBlob;"

mutate "D2 the byte size is not recorded (the save estimate falls back to 5MB)" \
  "  item._fileSize = dataUrlByteLength(newSrc);" \
  "  item._fileSize = 0;"

mutate "D3 the size is the base64 length, not the decoded length" \
  "  item._fileSize = dataUrlByteLength(newSrc);" \
  "  item._fileSize = newSrc.length;"

# 病根一 again: this release DID hand-write a second copy of the counter next
# to applyCrop. Prove the "one counter" claim is load-bearing by restoring it.
mutate "D6 the crop hand-rolls its own byte arithmetic again (病根一)" \
  "  item._fileSize = dataUrlByteLength(newSrc);" \
  "  item._fileSize = Math.round(newSrc.length * 3 / 4);"

mutate "D4 the legacy pan is left on (migrateLegacyCrop reframes the crop)" \
  "  item.cropX = 0; item.cropY = 0;" \
  "  item.cropX = item.cropX; item.cropY = item.cropY;"

mutate "D5 the <img> is left pointing at the pre-crop pixels" \
  "  if (item.img) item.img.src = newSrc;" \
  "  if (false) item.img.src = newSrc;"

cp kraftpub-dev.html $TMP/mut.html
print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
