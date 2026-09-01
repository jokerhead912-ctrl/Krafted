#!/bin/zsh
# Mutation check for test_v7_2_1.js — deliberately undo each part of the two
# fixes, confirm the suite goes red, restore. A suite that cannot fail is not
# a suite.
#
# WHAT IS BEING BROKEN
#   kraftpub-dev.html, because that is where both fixes live. Each mutation
#   removes one recorded size, reorders one branch, drops one release, or
#   bypasses the queue — and the suite must notice.
#
# TWO RULES THAT KEEP THESE HONEST
#   1. If an anchor is missing the mutation is SKIPPED, and a skip is
#      reported loudly. A skipped mutation is a test that has quietly stopped
#      testing.
#   2. The mutated file is the real dev file, so it is restored from a copy
#      taken before the first edit, and restored again on the way out.
#
# NOTE ON SYNTAX
#   No compile() check is needed: the suite asserts on source strings and
#   never executes the app's JavaScript, so a mutation cannot "trip" an
#   assertion by making the file unparseable.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TARGET=kraftpub-dev.html
BAK=Krafted/tests/.kraftpub-dev.mutbak
SUITE=Krafted/tests/test_v7_2_1.js

cp "$TARGET" "$BAK"
trap 'cp "$BAK" "$TARGET"; rm -f "$BAK"' EXIT INT TERM

$PY - "$TARGET" "$SUITE" <<'PYEOF'
import subprocess, sys, shutil

SRC, SUITE = sys.argv[1], sys.argv[2]
BAK = SRC + '.orig'
shutil.copy2(SRC, BAK)
NODE = '/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node'

# ── fix A: _fileSize recorded on every load path ────────────────────────────
A2 = "          dataItem._fileSize = stableMediaBlob.size;\n"
A3 = "          item._fileSize = stableBlob.size;\n"
A4 = "            dataItem._fileSize = blob.size;\n"
A5 = "            item._fileSize = blob.size;\n"

FALLBACK = "    else if (it._sourceBlob && it._sourceBlob.size) { estTotalBytes += it._sourceBlob.size; }\n"

# reorder: push the Blob fallback to the very end so the 5 MB guess wins
ORDER_OLD = (
    "    else if (it._sourceBlob && it._sourceBlob.size) { estTotalBytes += it._sourceBlob.size; }\n"
    "    else if (it.src && it.src.startsWith('data:')) {\n"
    "      const b64Len = it.src.indexOf(';base64,') >= 0 ? it.src.split(',')[1]?.length || 0 : 0;\n"
    "      estTotalBytes += Math.round(b64Len * 0.75);\n"
    "    } else if (it.src && it.src.startsWith('blob:')) {\n"
    "      estTotalBytes += it.isVideo ? 80 * 1024 * 1024 : 5 * 1024 * 1024;\n"
    "    }\n"
)
ORDER_NEW = (
    "    else if (it.src && it.src.startsWith('data:')) {\n"
    "      const b64Len = it.src.indexOf(';base64,') >= 0 ? it.src.split(',')[1]?.length || 0 : 0;\n"
    "      estTotalBytes += Math.round(b64Len * 0.75);\n"
    "    } else if (it.src && it.src.startsWith('blob:')) {\n"
    "      estTotalBytes += it.isVideo ? 80 * 1024 * 1024 : 5 * 1024 * 1024;\n"
    "    } else if (it._sourceBlob && it._sourceBlob.size) { estTotalBytes += it._sourceBlob.size; }\n"
)

# ── fix B: decode release + serial queue ────────────────────────────────────
CLOSE_BMP = "release: function () { try { bmp.close(); } catch (e) {} } };"
CLOSE_BMP_BAD = "release: function () { /* mutated: bitmap never closed */ } };"

CLOSE_IMG = "release: function () { try { img.src = ''; } catch (e) {} } });"
CLOSE_IMG_BAD = "release: function () { /* mutated: img never released */ } });"

# release AFTER the async IndexedDB write — the exact shape that let the peak build
ORDER_REL_OLD = (
    "          try { decoded.release(); } catch (e) {}\n"
    "          if (_tmpUrl) { _release(_tmpUrl); _tmpUrl = null; }\n"
    "          _dragImgStore.putAndGet(outBlob).then(function (diskBlob) {\n"
)
ORDER_REL_NEW = (
    "          _dragImgStore.putAndGet(outBlob).then(function (diskBlob) {\n"
    "          try { decoded.release(); } catch (e) {}\n"
    "          if (_tmpUrl) { _release(_tmpUrl); _tmpUrl = null; }\n"
)

QUEUE_DECL = "var _webDragQueue = { busy: false, pending: [] };\n"
QUEUE_CALL = "  _enqueueWebDrag(function () {"
QUEUE_CALL_BAD = "  void (function () {"
RETURN_CHAIN = "    return _tryAcquire(0)"
RETURN_CHAIN_BAD = "    void _tryAcquire(0)"

# restore the old un-released <img> decode
OLD_DECODE = "          img.src = _tmpUrl;\n"
OLD_DECODE_BAD = "          img.src = _tmpUrl;\n          img.src = tmpUrl;\n"

# the local path was already correct; make sure the suite still pins it
LOCAL_CLOSE = "          bitmap.close();  // release as soon as we are done drawing it"
LOCAL_CLOSE_BAD = "          /* mutated: bitmap never closed */"
LOCAL_PACE = "    setTimeout(processNextImage, 50);"
LOCAL_PACE_BAD = "    /* mutated: no pacing between images */"

muts = [
    ('drop _fileSize on v6 kpak media load',        A2, ''),
    ('drop _fileSize on v6 lazy video load',        A3, ''),
    ('drop _fileSize on legacy media load',         A4, ''),
    ('drop _fileSize on legacy lazy video load',    A5, ''),
    ('drop the _sourceBlob.size fallback',          FALLBACK, ''),
    ('reorder: 5 MB guess wins over the real Blob', ORDER_OLD, ORDER_NEW),
    ('bitmap is never closed',                      CLOSE_BMP, CLOSE_BMP_BAD),
    ('img fallback is never released',              CLOSE_IMG, CLOSE_IMG_BAD),
    ('release moved after the IndexedDB write',     ORDER_REL_OLD, ORDER_REL_NEW),
    ('queue declaration removed',                   QUEUE_DECL, ''),
    ('call site bypasses the queue',                QUEUE_CALL, QUEUE_CALL_BAD),
    ('queued job stops returning its promise',      RETURN_CHAIN, RETURN_CHAIN_BAD),
    ('old un-released img decode restored',         OLD_DECODE, OLD_DECODE_BAD),
    ('local drop stops closing its bitmap',         LOCAL_CLOSE, LOCAL_CLOSE_BAD),
    ('local drop stops pacing itself',              LOCAL_PACE, LOCAL_PACE_BAD),
]

caught = 0
skipped = 0

print('mutating %s, checked by %s' % (SRC, SUITE))
print('')

for label, old, new in muts:
    src = open(SRC, encoding='utf-8').read()
    if old not in src:
        print('SKIPPED (anchor)   ' + label)
        skipped += 1
        continue
    open(SRC, 'w', encoding='utf-8').write(src.replace(old, new, 1))

    r = subprocess.run([NODE, SUITE], capture_output=True, text=True)
    if r.returncode != 0:
        # strip() first: the suite indents FAIL lines, so a startswith('FAIL')
        # test would match nothing and report 0 for a mutation that tripped
        # several assertions.
        n = len([l for l in r.stdout.split('\n') if l.strip().startswith('FAIL')])
        print('caught             %-58s %d assertion(s)' % (label, n))
        caught += 1
    else:
        print('NOT CAUGHT         ' + label)

    shutil.copy2(BAK, SRC)

print('')
print('---- %d/%d caught, %d skipped (anchor)' % (caught, len(muts), skipped))
PYEOF
