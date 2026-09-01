#!/bin/zsh
# Mutation check for test_v7052.js (v7.0.52 — the Library keeps up with the
# board) — deliberately break the source, confirm the suite goes red, restore.
# A suite that cannot fail is not a suite.
#
#   "The Library list refreshes when the board changes, its highlight follows
#    the selection, it remembers whether you opened it, and it stays affordable
#    on a 300-item board."
#
# Every mutation below restores one of the four defects v7.0.52 fixed. If any
# of them can come back without the suite going red, the fix can come back
# undone. The interesting ones here are the BEHAVIOURAL mutations (2, 3, 4, 7):
# they leave every string the suite greps for in place and only change what the
# code does, so only the executable assertions can catch them.
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
TMP=/tmp/krafted-mutate52
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
SUITE = 'Krafted/tests/test_v7052.js'

muts = [
    # ── 1. the funnel is unplugged: the list goes stale again ────────
    ('the board changing no longer refreshes the Library (stale list returns)',
     "  try { requestLibraryRefresh(); } catch (e) {}\n",
     ""),

    # ── 2. BEHAVIOURAL: the debounce guard is removed ────────────────
    #   Every string the suite greps for is still present; only the
    #   coalescing is gone. Only the executable check can see this.
    ('three changes in one frame queue three rebuilds again',
     "  if (_libRefreshPending) return;\n",
     ""),

    # ── 3. BEHAVIOURAL: the rebuild runs synchronously ───────────────
    #   Replace BOTH lines. Swapping only the if-line leaves a dangling
    #   `else`, and a syntax error would "catch" this mutation without a
    #   single assertion ever running.
    ('the list is rebuilt synchronously on every mutation',
     "  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);\n"
     "  else setTimeout(run, 60);",
     "  run();"),

    # ── 4. BEHAVIOURAL: a collapsed panel rebuilds anyway ────────────
    ('a collapsed panel still queues rebuilds, paying for them on open',
     "  if (!p || p.classList.contains('collapsed')) return;\n"
     "  if (_libRefreshPending) return;",
     "  if (!p) return;\n"
     "  if (_libRefreshPending) return;"),

    # ── 5. the selection hook is unplugged: no more 'where am I' ─────
    ('selecting on the board no longer moves the Library highlight',
     "  try { libSyncActive(); } catch (e) {}\n",
     ""),

    # ── 6. BEHAVIOURAL: libSyncActive loses its early-out ────────────
    ('libSyncActive re-walks every row even when the selection has not moved',
     "  if (id === _libActiveId) return;\n",
     ""),

    # ── 7. BEHAVIOURAL: libSyncActive starts rebuilding DOM ──────────
    #   This is the failure mode that would make marquee-select stutter:
    #   the "cheap" sync silently becomes a full list rebuild per pointermove.
    ('libSyncActive rebuilds the list instead of flipping a class',
     "  var found = null;",
     "  var found = null;\n  document.createElement('div');"),

    # ── 8. rows lose the id libSyncActive maps them by ───────────────
    ('rows no longer carry their item id, so the highlight cannot be moved',
     "    row.setAttribute('data-id', String(it.id));\n",
     ""),

    # ── 9. the row cap is dropped ────────────────────────────────────
    ('the row cap is dropped: 300 full-size thumbnails per keystroke',
     "  var shown = items.length > LIB_ROW_CAP ? items.slice(0, LIB_ROW_CAP) : items;\n"
     "  shown.forEach(function (it) {",
     "  var shown = items;\n"
     "  items.forEach(function (it) {"),

    # ── 10. the hidden-rows footer disappears ────────────────────────
    ('the list is silently truncated with no "N more" note',
     "  if (items.length > shown.length) {\n"
     "    var more = document.createElement('div');",
     "  if (false) {\n"
     "    var more = document.createElement('div');"),

    # ── 11. the panel forgets whether you opened it ──────────────────
    ('the open/closed choice is no longer read back at boot (amnesia)',
     "try { collapsed = localStorage.getItem('krafted_library_collapsed') !== '0'; } catch (e) {}",
     "var collapsed = true;"),

    # ── 12. the boot restore is removed entirely ─────────────────────
    ('the boot restore IIFE is gone',
     "(function initLibraryPanel() {",
     "(function initLibraryPanelRemoved() {"),

    # ── 13. presenting no longer hides the index ─────────────────────
    ('presenting leaves the full board index on screen',
     "  try { document.body.classList.add('presenting'); } catch (e) {}",
     ""),

    # ── 14. the present-mode CSS rule is dropped ─────────────────────
    ('the presenting CSS rule is removed',
     "body.presenting #library-panel { display:none; }",
     "body.presenting #library-panel { display:flex; }"),

    # ── 15. a row click stops flying to the item ─────────────────────
    ('clicking a Library row selects but never reveals the item',
     "      selectOnly(it.id);\n"
     "      revealItem(it);",
     "      selectOnly(it.id);"),
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
        # for a mutation that actually tripped several - hiding how much of
        # the suite each defect is worth.
        n = len([l for l in r.stdout.split('\n') if l.strip().startswith('FAIL')])
        print('caught             %-64s %d assertion(s)' % (label, n))
        caught += 1
    else:
        print('NOT CAUGHT         ' + label)

shutil.copy2(BAK, SRC)
print('')
print('---- %d/%d caught, %d skipped (anchor)' % (caught, len(muts), skipped))
PYEOF
