#!/bin/zsh
# Mutation check for test_v7_5_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
#   "folder drops import; a URL-less drag says so on screen; off-screen
#    images release their decoded bitmaps; deleted images release their
#    bytes; the media blob cache is an LRU."
#
# This script exists because the v7.4.0 folder feature shipped green and
# never worked. That suite matched the source; this one executes the
# functions, so every mutation below is judged by whether the executing
# suite notices the behaviour coming back, not by whether a line changed.
#
# WHY PYTHON AND NOT A `mutate` HELPER
#   Several anchors span multiple lines. zsh string arguments cannot carry
#   embedded newlines safely, and an anchor that silently stops matching is
#   a SKIPPED, which is worse than a FAIL. So the edits are driven from
#   Python, which sees the file exactly as the suite does.
#
# NOTE: never run against the dev file; we always mutate a throwaway copy.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate750
mkdir -p $TMP

cp kraftpub-dev.html $TMP/mut.html

$PY - "$TMP/mut.html" <<'PYEOF'
import subprocess, sys, shutil

SRC = sys.argv[1]
BAK = SRC + '.orig'
shutil.copy2(SRC, BAK)
orig = open(SRC, encoding='utf-8').read()
NODE = '/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node'
SUITE = 'Krafted/tests/test_v7_5_0.js'

muts = [
    # ── 1-4. the folder-drop counter (the v7.4.0 bug, four ways) ──────
    ('the counter is seeded with entries.length again (v7.4.0 bug)',
     "  var pending = 0;\n  var settled = false;",
     "  var pending = entries.length;\n  var settled = false;"),

    ('a directory batch is no longer walked (children never collected)',
     "          batch.forEach(function(subEntry) { readEntry(subEntry, subPath); });\n",
     ""),

    ('an exhausted directory reader never settles (the drop hangs)',
     "          if (batch.length === 0) { settle(); return; }",
     "          if (batch.length === 0) { return; }"),

    ('settle() decrements but never finishes (v7.4.0 silent no-op)',
     "  function settle() {\n"
     "    pending--;\n"
     "    if (pending <= 0 && !settled) { settled = true; _finishFolderImport(e, allFiles); }\n"
     "  }",
     "  function settle() {\n"
     "    pending--;\n"
     "  }"),

    ('the finish fires on the FIRST completion, before the walk is done',
     "    if (pending <= 0 && !settled) { settled = true; _finishFolderImport(e, allFiles); }",
     "    if (!settled) { settled = true; _finishFolderImport(e, allFiles); }"),

    # ── 5-6. the window capture listener routing ─────────────────────
    ('directory drops fall through to the flat-file path again',
     "  if (_dirEntries && _dropHasDirectory(_dirEntries)) {",
     "  if (_dirEntries && false) {"),

    ('the folder drop is detected but never handed to the reader',
     "    try { _handleEntryDrop(e, _dirEntries); } catch (err) { console.warn('[FileDrop] folder drop error:', err); }",
     "    /* mutated: reader never called */"),

    # ── 7. the URL-less drag goes quiet again ─────────────────────────
    ('a drag with no image URL is silent again (console only)',
     "    try {\n      toast((_isZhUI()",
     "    try {\n      void((_isZhUI()"),

    # ── 8-14. off-screen culling ─────────────────────────────────────
    ('the src attribute is never detached, so nothing is ever culled',
     "          img.removeAttribute('src');\n          it._imgCulled = true;",
     "          /* mutated: nothing released */"),

    ('a culled image is never marked, so it can never be restored',
     "          it._imgCulled = true;",
     "          /* mutated: no marker */"),

    ('an image scrolled back into view is never restored',
     "      } else if (it._imgCulled) {",
     "      } else if (false) {"),

    ('the minimum-item floor is gone, so tiny boards get culled too',
     "    if (items.length < IMG_CULL_MIN_ITEMS) { _ensureAllImagesLive(); return; }",
     "    if (false) { }"),

    ('remote images are culled too (a re-fetch and a flicker every pan)',
     "      if (typeof s !== 'string' || s === '' ||\n"
     "          (s.indexOf('blob:') !== 0 && s.indexOf('data:') !== 0)) continue;",
     "      if (typeof s !== 'string' || s === '') continue;"),

    ('the cull margin collapses to the screen edge',
     "    const mx = vw * IMG_CULL_MARGIN, my = vh * IMG_CULL_MARGIN;",
     "    const mx = 0, my = 0;"),

    ('_ensureAllImagesLive stops restoring anything',
     "    for (let i = 0; i < items.length; i++) {\n"
     "      const it = items[i];\n"
     "      if (!it || !it._imgCulled || !it.img) continue;\n"
     "      it.img.src = it.src;\n"
     "      it._imgCulled = false;\n"
     "    }",
     "    /* mutated: nothing restored */"),

    ('panning and zooming no longer re-run the cull',
     "  // v7.5.0: the visible set changed, so the culling decision is stale.\n"
     "  scheduleImageCull();",
     "  /* mutated: stale cull */"),

    ('bulk image export no longer un-culls first',
     "  // v7.5.0: off-screen images have their src detached; put every one back\n"
     "  // before reading pixels out of them.\n"
     "  _ensureAllImagesLive();",
     "  /* mutated: export reads culled images */"),

    # ── 15-19. image revoke on delete ────────────────────────────────
    ('a deleted image keeps its blob URL alive forever (the leak)',
     "    URL.revokeObjectURL(isrc);",
     "    /* mutated: never revoked */"),

    ('the URL is revoked even with no bytes banked (Ctrl+Z breaks)',
     "  if (_cacheMediaBlob(isrc, item._sourceBlob || _mediaBlobByUrl.get(isrc))) {",
     "  if (true) {"),

    ('non-blob srcs get revoked too',
     "  if (typeof isrc !== 'string' || isrc.indexOf('blob:') !== 0) return;",
     "  /* mutated: any src */"),

    ('videos are double-handled by the image revoke path',
     "  if (!item || item.isVideo || item.video) return;   // video owns its own path",
     "  if (!item) return;"),

    ('deleteSelected no longer revokes the deleted image',
     "    cleanupImageItem(i);\n",
     ""),

    # ── 20-21. the media blob cache ──────────────────────────────────
    ('the cache goes back to FIFO (a touched entry can be evicted)',
     "    if (_mediaBlobByUrl.has(src)) {\n"
     "      var kept = _mediaBlobByUrl.get(src);\n"
     "      _mediaBlobByUrl.delete(src);\n"
     "      _mediaBlobByUrl.set(src, kept);\n"
     "    }",
     "    /* mutated: no recency bump */"),

    ('aliases charge the byte budget twice (it drifts negative)',
     "    if (!stillHeld) _mediaBlobBytes -= (b && b.size) || 0;",
     "    _mediaBlobBytes -= (b && b.size) || 0;"),

    # ── 22-26. the constants ─────────────────────────────────────────
    ('the import edge cap goes back to 4096',
     "const IMAGE_MAX_EDGE_LOCAL = 2048;",
     "const IMAGE_MAX_EDGE_LOCAL = 4096;"),

    ('the undo budget goes back to 300 MB',
     "const _UNDO_MAX_BYTES = 80 * 1024 * 1024;",
     "const _UNDO_MAX_BYTES = 300 * 1024 * 1024;"),

    ('the media blob cache entry cap goes back to 64',
     "var _MEDIA_BLOB_CACHE_MAX_ENTRIES = 96;",
     "var _MEDIA_BLOB_CACHE_MAX_ENTRIES = 64;"),

    ('the cull margin goes to zero',
     "const IMG_CULL_MARGIN = 1.5;",
     "const IMG_CULL_MARGIN = 0;"),

    ('the cull floor goes to zero',
     "const IMG_CULL_MIN_ITEMS = 40;",
     "const IMG_CULL_MIN_ITEMS = 0;"),

    # ── 27. the containment guard ────────────────────────────────────
    ('content-visibility lands on .item (breaks BCR hit testing)',
     ".item { position:absolute; cursor:move;",
     ".item { content-visibility:auto; position:absolute; cursor:move;"),
]

caught = 0
skipped = 0
notcaught = []
for label, old, new in muts:
    n = orig.count(old)
    if n != 1:
        print('SKIPPED (anchor x%d)  %s' % (n, label))
        skipped += 1
        continue
    open(SRC, 'w', encoding='utf-8').write(orig.replace(old, new, 1))
    r = subprocess.run([NODE, SUITE, SRC], capture_output=True, text=True)
    # Judge by exit code OR a FAIL line: the suite sets the code, but a
    # mutation that only trips a section() catch must still count.
    # NB: strip() first — FAIL lines are indented, so startswith('  FAIL')
    # matches nothing and reports 0 assertions for a real catch.
    nf = len([l for l in r.stdout.split('\n') if l.strip().startswith('FAIL')])
    if r.returncode != 0 or nf > 0:
        print('caught             %-62s %d assertion(s)' % (label, nf))
        caught += 1
    else:
        print('NOT CAUGHT         ' + label)
        notcaught.append(label)

shutil.copy2(BAK, SRC)
print('')
# The holes are named individually below, which is the useful part.
#
# HISTORY: this summary used to have to avoid the phrase "NOT CAUGHT"
# entirely, because run_all.sh judged every mutation script by
# `grep -c "NOT CAUGHT"` over the whole output — so a tail reading
# "0 NOT CAUGHT" made a clean run look like one mutation missed. As of
# 2026-09-02 the gate reads the MUTVERDICT line and the exit code instead
# (see run_all.sh), so the wording here is free again. The constraint was
# real, it was undocumented outside this comment, and it silently stopped
# being true the moment the gate changed — which is how a stale comment
# turns into a trap.
print('---- %d/%d caught, %d skipped (anchor)'
      % (caught, len(muts), skipped))
if notcaught:
    for l in notcaught:
        print('  HOLE: ' + l)
# ── machine-readable verdict ─────────────────────────────────────────────
# The one line run_all.sh reads, plus the exit code it gates on. A skipped
# anchor counts as BAD: a mutation that never ran proves nothing at all.
_holes = len(muts) - caught - skipped
print('MUTVERDICT %s holes=%d skipped=%d caught=%d total=%d'
      % ('ok' if (_holes == 0 and skipped == 0) else 'BAD',
         _holes, skipped, caught, len(muts)))
sys.exit(0 if (_holes == 0 and skipped == 0) else 1)

PYEOF
