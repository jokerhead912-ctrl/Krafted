#!/bin/zsh
# Mutation check for test_v7_3_0.js — deliberately undo each part of the
# folder-name fix, confirm the suite goes red, restore. A suite that cannot
# fail is not a suite.
#
# WHAT IS BEING BROKEN
#   kraftpub-dev.html, because that is where the whole fix lives: one path
#   reader (folderTagsFromPath), one merger (mergeTags), one writer
#   (applyImportMeta), nine call sites and the import toast.
#
# TWO RULES THAT KEEP THESE HONEST
#   1. If an anchor is missing the mutation is SKIPPED, and a skip is
#      reported loudly. A skipped mutation is a test that has quietly
#      stopped testing.
#   2. The mutated file is the real dev file, so it is restored from a copy
#      taken before the first edit, and restored again on the way out.
#
# NOTE ON SYNTAX
#   Most mutations here are single-token deletions, so they cannot make the
#   file unparseable. The ones that swap a whole expression keep a valid
#   expression in place for the same reason.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TARGET=kraftpub-dev.html
BAK=Krafted/tests/.kraftpub-dev.mutbak
SUITE=Krafted/tests/test_v7_3_0.js

cp "$TARGET" "$BAK"
trap 'cp "$BAK" "$TARGET"; rm -f "$BAK"' EXIT INT TERM

$PY - "$TARGET" "$SUITE" <<'PYEOF'
import subprocess, sys, shutil

SRC, SUITE = sys.argv[1], sys.argv[2]
BAK = SRC + '.orig'
shutil.copy2(SRC, BAK)
NODE = '/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node'

# ── folderTagsFromPath ─────────────────────────────────────────────────────
SPLIT   = "  return String(path).split('/')\n"
MAP     = "    .map(function (s) { return s.trim().replace(/,/g, ' ').replace(/\\s+/g, ' '); })\n"
FILTER  = "    .filter(function (s) { return s.length && s !== '.' && s !== '..'; });\n"

# ── mergeTags ──────────────────────────────────────────────────────────────
COPY    = "  var out = (existing && existing.length) ? existing.slice() : [];\n"
CMP     = "      if (String(out[i]).toLowerCase() === String(t).toLowerCase()) { seen = true; break; }\n"
DEDUP   = "    if (!seen) out.push(t);\n"

# ── applyImportMeta ────────────────────────────────────────────────────────
GUARD   = "  if (!item || !file) return item;\n"
NAMEIF  = "  if (!item.filename && file.name) {\n"
SETNAME = "    item.filename = file.name;\n"
BADGE   = "    try { if (item.el && item.el._setFilenameBadge) item.el._setFilenameBadge(file.name); } catch (e) {}\n"
READ    = "  var ftags = folderTagsFromPath(file._kraftedPath);\n"
WRITE   = "    item.tags = mergeTags(item.tags, ftags);\n"
AUTOSAVE= "    try { scheduleAutoSave(); } catch (e) {}\n"

# ── call sites ─────────────────────────────────────────────────────────────
DROP_GIF  = "applyImportMeta(addImage(blobUrl, w, h, at.x, at.y, false, isLast, file.size, true, file), file);"
DROP_GIF_B= "addImage(blobUrl, w, h, at.x, at.y, false, isLast, file.size, true, file);"
PASTE_AUD = "applyImportMeta(addAudioItem(blobUrl, f.name, at.x, at.y, f.size, f), f);"
PASTE_A_B = "addAudioItem(blobUrl, f.name, at.x, at.y, f.size, f);"
DROP_VID  = "applyImportMeta(newItem, file);"
DROP_V_B  = "if (newItem && file && file.name) { newItem.filename = file.name; }"

# ── the import toast ───────────────────────────────────────────────────────
# v7.4.0 appended the block count to this toast, so the anchor now has to
# reach past it. A stale anchor is SKIPPED, and a skipped mutation is a test
# that has quietly stopped testing.
TOAST_TAG = "' - folder name saved as tag' + _fBlockLabel);"
TOAST_READ = "      var _segs = folderTagsFromPath(f._kraftedPath);\n"

muts = [
    ('path split on the wrong separator',        SPLIT,    "  return String(path).split('-')\n"),
    ('commas no longer sanitised',               MAP,      "    .map(function (s) { return s.trim().replace(/\\s+/g, ' '); })\n"),
    ('whitespace no longer collapsed',           MAP,      "    .map(function (s) { return s.trim().replace(/,/g, ' '); })\n"),
    ('segments no longer trimmed',               MAP,      "    .map(function (s) { return s.replace(/,/g, ' ').replace(/\\s+/g, ' '); })\n"),
    ('"." and ".." become tags',                 FILTER,   "    .filter(function (s) { return s.length; })\n"),
    ('merge mutates the array it was handed',    COPY,     "  var out = (existing && existing.length) ? existing : [];\n"),
    ('merge becomes case-sensitive',             CMP,      "      if (String(out[i]) === String(t)) { seen = true; break; }\n"),
    ('merge stops de-duplicating',               DEDUP,    "    out.push(t);\n"),
    ('the file name is never recorded',          SETNAME,  ''),
    ('an existing file name is overwritten',     NAMEIF,   "  if (file.name) {\n"),
    ('the media badge is never updated',         BADGE,    ''),
    ('the folder path is never read',            READ,     '  var ftags = [];\n'),
    ('existing tags are overwritten',            WRITE,    '    item.tags = ftags;\n'),
    ('no save is scheduled after tagging',       AUTOSAVE, ''),
    ('the null-file guard is dropped',           GUARD,    '  if (!item) return item;\n'),
    ('the drop image site bypasses the writer',  DROP_GIF, DROP_GIF_B),
    ('the paste audio site bypasses the writer', PASTE_AUD, PASTE_A_B),
    ('the drop video site hand-rolls filename',  DROP_VID, DROP_V_B),
    ('the toast stops saying the name was kept', TOAST_TAG, "' + _fBlockLabel);"),
    ('the toast stops reading the folder path',  TOAST_READ, ''),
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
