#!/bin/zsh
# Mutation check for test_v7051.js (P0-2 Reference metadata + P1-1 Library) —
# deliberately break the source, confirm the suite goes red, restore.
# A suite that cannot fail is not a suite.
#
#   "item gets name / note / tag (Properties Reference section, above Transform)
#    + a searchable Library sidebar (thumb + name + tag, click a row -> fly there)."
#
# Every mutation below restores one piece of that. If any of them can come back
# without the suite going red, the feature can come back broken too.
#
# WHY PYTHON AND NOT A `mutate` HELPER
#   Several anchors span multiple lines. zsh string arguments cannot carry
#   embedded newlines safely, and an anchor that silently stops matching is a
#   SKIPPED, which is worse than a FAIL. So the edits are driven from Python,
#   which sees the file exactly as the suite does.
#
# ── NO VERSION MUTATIONS ───────────────────────────────────────────────
#   This suite carries no version-identity assertion, so there is nothing to
#   revert. Other release suites pin the version and each has its own mutate
#   script; a focused suite keeps focused mutations.
#
# NOTE: never run against the dev file; we always mutate a throwaway copy.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate51
mkdir -p $TMP

# The suite reads the dev file by default; point it at the throwaway copy
# through the optional argv[2] it already supports.
cp kraftpub-dev.html $TMP/mut.html

$PY - "$TMP/mut.html" <<'PYEOF'
import subprocess, sys, shutil

SRC = sys.argv[1]
BAK = SRC + '.orig'
shutil.copy2(SRC, BAK)
orig = open(SRC, encoding='utf-8').read()
NODE = '/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node'
SUITE = 'Krafted/tests/test_v7051.js'

muts = [
    # ── 1. setItemMeta stops writing the name ────────────────────────
    ('setItemMeta stops writing the name field',
     "if (field === 'name') it.name = value || '';",
     "if (field === 'name') { /* mutated */ }"),

    # ── 2. setItemMeta stops auto-saving (single writer, multi-line anchor)
    ('editing metadata no longer triggers an auto-save',
     "  sel.forEach(function (it) {\n"
     "    if (field === 'name') it.name = value || '';\n"
     "    else if (field === 'note') it.note = value || '';\n"
     "    else if (field === 'tags') it.tags = splitTags(value);\n"
     "  });\n"
     "  try { scheduleAutoSave(); } catch (e) {}",
     "  sel.forEach(function (it) {\n"
     "    if (field === 'name') it.name = value || '';\n"
     "    else if (field === 'note') it.note = value || '';\n"
     "    else if (field === 'tags') it.tags = splitTags(value);\n"
     "  });\n"
     "  /* auto-save removed */"),

    # ── 3. splitTags stops trimming / dropping empties ───────────────
    ('splitTags stops trimming and dropping empty tags',
     "return String(s).split(',').map(function (t) { return t.trim(); }).filter(function (t) { return t.length; });",
     "return String(s).split(',');"),

    # ── 4. the Reference section marker is gone (reorder / removal) ──
    ('the Reference section marker is removed, so the order lock is moot',
     "<!-- REFERENCE (P0-2",
     "<!-- REFERENCE-X (P0-2"),

    # ── 5. the Name input writes the wrong field ─────────────────────
    ('the Name input is wired to the note field instead of name',
     "oninput=\"setItemMeta('name', this.value)\"",
     "oninput=\"setItemMeta('note', this.value)\""),

    # ── 6. updatePropsPanel stops filling the Note field ─────────────
    ('selecting an item no longer repopulates the Note field',
     "var pnote = document.getElementById('prop-note'); if (pnote) pnote.value = item.note || '';",
     "/* mutated */"),

    # ── 7. the Library search stops re-rendering ─────────────────────
    ('typing in the Library search no longer re-renders it',
     "oninput=\"renderLibraryPanel()\"",
     "oninput=\"\""),

    # ── 8. renderLibraryPanel matches only the name ─────────────────
    ('the Library filter ignores note and tags',
     "var hay = [it.name, it.note, (it.tags || []).join(' ')].join(' ').toLowerCase();",
     "var hay = [it.name].join(' ').toLowerCase();"),

    # ── 9. a Library row click no longer flies to the item ──────────
    # v7.0.52: the row click no longer calls renderLibraryPanel() itself -
    # the highlight is now moved by libSyncActive(), which refreshSelection()
    # drives. The anchor follows the new shape.
    ('clicking a Library row selects but never reveals the item',
     "      selectOnly(it.id);\n"
     "      revealItem(it);",
     "      selectOnly(it.id);"),

    # ── 10. one save path drops name / note / tags ──────────────────
    ('one of the three save paths drops the metadata fields',
     "frameOn: i.frameOn || false, frameZ: i.frameZ || 1, frameRot: i.frameRot || 0, frameX: i.frameX || 0, frameY: i.frameY || 0, name: i.name || '', note: i.note || '', tags: i.tags ? i.tags.slice() : [],",
     "frameOn: i.frameOn || false, frameZ: i.frameZ || 1, frameRot: i.frameRot || 0, frameX: i.frameX || 0, frameY: i.frameY || 0,"),

    # ── 11. the registry entry is renamed ───────────────────────────
    ('the Library toggle disappears from the shortcut registry',
     "{ id: 'library-toggle-panel', category: 'View',  label: 'Toggle Library Panel',     keys: [] },",
     "{ id: 'library-toggle-panel-x', category: 'View',  label: 'Toggle Library Panel',     keys: [] },"),

    # ── 12. the dispatch case is renamed ────────────────────────────
    ('the registry no longer dispatches the Library toggle',
     "case 'library-toggle-panel':   toggleLibraryPanel(); return true;",
     "case 'library-toggle-panel-x':   toggleLibraryPanel(); return true;"),
]

caught = 0
skipped = 0
for label, old, new in muts:
    if old not in orig:
        print('SKIPPED (anchor)  ' + label)
        skipped += 1
        continue
    open(SRC, 'w', encoding='utf-8').write(orig.replace(old, new, 1))
    r = subprocess.run([NODE, SUITE, SRC], capture_output=True, text=True)
    if r.returncode != 0:
        # NB: strip first. The suite indents FAIL lines by four spaces, so a
        # startswith('  FAIL') test matches nothing and reports "0 assertions"
        # for a mutation that actually tripped several.
        n = len([l for l in r.stdout.split('\n') if l.strip().startswith('FAIL')])
        print('caught             %-64s %d assertion(s)' % (label, n))
        caught += 1
    else:
        print('NOT CAUGHT         ' + label)

shutil.copy2(BAK, SRC)
print('')
print('---- %d/%d caught, %d skipped (anchor)' % (caught, len(muts), skipped))
PYEOF
