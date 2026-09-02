#!/bin/zsh
# Mutation check for test_v7_4_0.js — deliberately undo each part of the
# named-block feature, confirm the suite goes red, restore. A suite that
# cannot fail is not a suite.
#
# WHAT IS BEING BROKEN
#   kraftpub-dev.html. Three regions: the shared group plumbing
#   (serializeGroup / makeGroupEl / disposeGroupEl) that the refactor funnels
#   every group through, the folder-block helpers (folderGroupKey /
#   addItemToFolderGroup) and the folder-major import sort, plus the chip's
#   counter-scale arithmetic in updateGroupBorder.
#
# TWO RULES THAT KEEP THESE HONEST
#   1. If an anchor is missing the mutation is SKIPPED, and a skip is
#      reported loudly. A skipped mutation is a test that has quietly
#      stopped testing.
#   2. The mutated file is the real dev file, so it is restored from a copy
#      taken before the first edit, and restored again on the way out.
#
# A CRASH IS NOT A CATCH
#   Some mutations make the suite throw instead of printing a FAIL line. The
#   runner below scores a non-zero exit as a catch, but prints how many FAIL
#   lines came with it: `0 assertion(s)` means the process died before the
#   report and every assertion after the crash was silently skipped.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TARGET=kraftpub-dev.html
BAK=Krafted/tests/.kraftpub-dev.mutbak
SUITE=Krafted/tests/test_v7_4_0.js

cp "$TARGET" "$BAK"
trap 'cp "$BAK" "$TARGET"; rm -f "$BAK"' EXIT INT TERM

$PY - "$TARGET" "$SUITE" <<'PYEOF'
import subprocess, sys, shutil

SRC, SUITE = sys.argv[1], sys.argv[2]
BAK = SRC + '.orig'
shutil.copy2(SRC, BAK)
NODE = '/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node'

# ── the shared group plumbing ──────────────────────────────────────────────
SER_NAME  = "  return { id: g.id, color: g.color, name: g.name || '', memberIds: [...g.memberIds] };\n"
MK_LABEL  = "  canvasContent.appendChild(labelEl);\n"
MK_SHOW   = "  labelEl.style.display = gd.name ? 'block' : 'none';\n"
MK_NAME   = "  const group = { id: gd.id, color: gd.color, name: gd.name || '', memberIds: new Set(gd.memberIds || []), borderEl: borderEl, labelEl: labelEl };\n"
DSP_LABEL = "  if (g.labelEl && g.labelEl.remove) g.labelEl.remove();\n"
UNDO_NAME = "      state.groups.push(makeGroupEl({ id: gd.id, color: gd.color, name: gd.name, memberIds: gd.memberIds }));\n"
LOAD_NAME = "      state.groups.push(makeGroupEl({ id: _gid, color: gd.color, name: gd.name, memberIds: (gd.memberIds || []).map(_remapId) }));\n"
SER_CALL  = "groups: state.groups.map(serializeGroup),"
GS_LIT    = "    const group = makeGroupEl({ id: gid, color: color, name: '', memberIds: sel.map(i => i.id) });\n"
UNGROUP   = "      disposeGroupEl(g);\n"
UNDO_LIT  = "state.groups.push(makeGroupEl({ id: gd.id, color: gd.color, name: gd.name, memberIds: gd.memberIds }));"

# ── the folder block ───────────────────────────────────────────────────────
KEY_FULL  = "  return folderTagsFromPath(path).join('/');\n"
GUARD2    = "  if (!item || !key) return;\n"
MATCH     = "    if (state.groups[i].folderKey === key) { g = state.groups[i]; break; }\n"
STAMP     = "    g.folderKey = key;\n"
NEWGRP    = "  if (!g) {\n    var gid = G.nextGroupId++;\n"
DEBOUNCE  = "  if (_folderBorderTimer) return;\n"

# ── the folder-major sort ──────────────────────────────────────────────────
CMP_KEY   = "    if (ka !== kb) return ka < kb ? -1 : 1;\n"
CMP_TYPE  = "    return _importTypeRank(a) - _importTypeRank(b);\n"
RANK_IMG  = "    if (f.type && f.type.indexOf('image/') === 0) return 0;\n"

# ── the chip's counter-scale ───────────────────────────────────────────────
SCALE     = "      group.labelEl.style.transform = 'scale(' + (1 / _z) + ')';\n"
TOP_GAP   = "      group.labelEl.style.top = (minY - pad - _lh - 4 / _z) + 'px';\n"
Z_CHIP    = "z-index:9998"
MD_STOP   = "  labelEl.addEventListener('mousedown', function (e) { e.stopPropagation(); });\n"

# ── renaming ───────────────────────────────────────────────────────────────
UNDO_PUSH = "  if (el.isContentEditable) return;\n  try { pushUndo(); } catch (e) {}\n"
COMMIT    = "    if (commit && txt) group.name = txt;\n"
ESCAPE    = "    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }\n"

muts = [
    # the refactor — every one of these is a copy of the old hand-written shape
    ('the name never reaches disk',                    SER_NAME,  "  return { id: g.id, color: g.color, memberIds: [...g.memberIds] };\n"),
    ('the member Set is written instead of an array',  SER_NAME,  "  return { id: g.id, color: g.color, name: g.name || '', memberIds: g.memberIds };\n"),
    ('the chip is never added to the canvas',          MK_LABEL,  ''),
    ('a nameless group shows an empty chip',           MK_SHOW,   "  labelEl.style.display = 'block';\n"),
    ('a rebuilt group forgets its name',               MK_NAME,   "  const group = { id: gd.id, color: gd.color, name: '', memberIds: new Set(gd.memberIds || []), borderEl: borderEl, labelEl: labelEl };\n"),
    ('dispose leaks the chip (the old border-only bug)', DSP_LABEL, ''),
    ('undo restore drops the name',                    UNDO_NAME, "      state.groups.push(makeGroupEl({ id: gd.id, color: gd.color, memberIds: gd.memberIds }));\n"),
    ('load restore drops the name',                    LOAD_NAME, "      state.groups.push(makeGroupEl({ id: _gid, color: gd.color, memberIds: (gd.memberIds || []).map(_remapId) }));\n"),
    ('a serialiser hand-writes the group shape again', SER_CALL,  "groups: state.groups.map(g => ({ id: g.id, color: g.color, memberIds: [...g.memberIds] })),"),
    ('groupSelected hand-writes the group shape again', GS_LIT,   "    const group = { id: gid, color, memberIds: new Set(sel.map(i => i.id)) };\n"),
    ('ungroup destroys the border by hand again',      UNGROUP,   "      g.borderEl.remove();\n"),

    # the block key and reuse rules
    ('the key is the leaf folder, not the full path',  KEY_FULL,  "  return folderTagsFromPath(path).slice(-1).join('/');\n"),
    ('the key is the top folder, not the full path',   KEY_FULL,  "  return folderTagsFromPath(path).slice(0, 1).join('/');\n"),
    ('every file opens its own block',                 NEWGRP,    "  if (true) {\n    var gid = G.nextGroupId++;\n"),
    ('blocks are matched by name, not by key',         MATCH,     "    if (state.groups[i].name === key) { g = state.groups[i]; break; }\n"),
    ('a loose file gets a nameless block',             GUARD2,    "  if (!item) return;\n"),
    ('the key is never stamped, so nothing is reused', STAMP,     ''),
    ('the border refresh is not coalesced',            DEBOUNCE,  ''),

    # the folder-major sort
    ('the sort stops grouping by folder',              CMP_KEY,   "    if (false) return ka < kb ? -1 : 1;\n"),
    ('type order is reversed inside a folder',         CMP_TYPE,  "    return _importTypeRank(b) - _importTypeRank(a);\n"),
    ('images sort after video and audio',              RANK_IMG,  "    if (f.type && f.type.indexOf('image/') === 0) return 2;\n"),

    # the chip's counter-scale
    ('the chip scales with the canvas, not against it', SCALE,    "      group.labelEl.style.transform = 'scale(' + _z + ')';\n"),
    ('the gap above the border is not zoom-corrected', TOP_GAP,   "      group.labelEl.style.top = (minY - pad - _lh - 4) + 'px';\n"),
    ('the chip height is not zoom-corrected',          TOP_GAP,   "      group.labelEl.style.top = (minY - pad - _lh / _z - 4 / _z) + 'px';\n"),
    ('the chip drops behind the items',                Z_CHIP,    "z-index:0"),
    ('mousedown on the chip reaches the canvas',       MD_STOP,   "  labelEl.addEventListener('mousedown', function (e) {});\n"),

    # renaming
    ('an empty rename blanks the name',                COMMIT,    "    group.name = txt;\n"),
    ('Escape commits instead of reverting',            ESCAPE,    "    else if (e.key === 'Escape') { e.preventDefault(); finish(true); }\n"),
    ('renaming does not push undo',                    UNDO_PUSH, "  if (el.isContentEditable) return;\n"),
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
