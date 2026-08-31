#!/bin/zsh
# Mutation check for test_v7048.js (A/B compare lock) — deliberately break the
# source, confirm the suite goes red, restore. A suite that cannot fail is not
# a suite.
#
#   "Pressing hold, it's very easy to touch the image by accident, and it
#    copies those two images onto the board."
#
# Every mutation here restores a piece of that bug: a lock that ships off, a
# press that still reaches the board, an image that can still be dragged, an
# icon that never shows the locked state. If any of them can come back without
# the suite going red, the duplication can come back too.
#
# WHY PYTHON AND NOT A `mutate` HELPER LIKE THE OTHER SCRIPTS HERE
#   Several of these anchors span multiple lines (the comment plus the
#   classList call must go together, or the mutation leaves an orphaned
#   comment and the anchor silently stops matching). zsh string arguments
#   cannot carry embedded newlines safely, so the replacements are driven from
#   Python, which sees the file exactly as the suite does.
#
# TWO MUTATIONS THAT WERE TRIED AND DELIBERATELY LEFT OUT
#   They passed the suite while it was still green, which is how we found two
#   assertions that were too loose to prove anything:
#     * deleting `el.classList.add('locked')` from _abEnsureEl — the bare
#       substring was still satisfied by the two item-locking calls at the top
#       of the file
#     * dropping `user-drag:none` from the #ab-compare.locked rule — the bare
#       substring was still satisfied by the unrelated `.item img` rule
#   The suite now scopes the first to the _abEnsureEl body and asserts the
#   second as a whole rule. Both are in the list below and both are caught.
#
# NOTE: never run against the dev file; we always mutate a throwaway copy.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate48
mkdir -p $TMP

# The suite reads the dev file by default; point it at the throwaway copy
# through the optional argv[2] it already supports.
cp kraftpub-v6.8.0.html $TMP/mut.html

$PY - "$TMP/mut.html" <<'PYEOF'
import subprocess, sys, shutil

SRC = sys.argv[1]
BAK = SRC + '.orig'
shutil.copy2(SRC, BAK)
orig = open(SRC, encoding='utf-8').read()
NODE = '/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node'
SUITE = 'Krafted/tests/test_v7048.js'

muts = [
    ('the lock does not ship enabled',
     "dragging: false, locked: true }", "dragging: false, locked: false }"),
    # Anchored on the classList line plus the line after it, not on the
    # comment above it: that comment carries an em dash, and matching it
    # meant one typo was all it took to turn this into a silent SKIPPED.
    ('the element is not created locked',
     "  el.classList.add('locked');\n  el.innerHTML =",
     "  // mutated\n  el.innerHTML ="),
    ('the button does not ship active',
     'class="ab-lock active"', 'class="ab-lock"'),
    ('the press is no longer default-prevented',
     "    if (_ab.locked) ev.preventDefault();", "    // mutated"),
    ('the press is allowed to propagate to the board',
     "    ev.stopPropagation();\n    if (_ab.locked) ev.preventDefault();",
     "    // mutated\n    if (_ab.locked) ev.preventDefault();"),
    ('locked images can still be dragged',
     "-webkit-user-drag:none; user-drag:none; pointer-events:none; }",
     "pointer-events:none; }"),
    ('the locked stage no longer blocks touch gestures',
     "#ab-compare.locked #ab-stage { touch-action:none; }", "/* mutated */"),
    ('the icon never shows the closed lock',
     "locked ? '\\uD83D\\udd12' : '\\uD83D\\udd13'", "'\\uD83D\\udd13'"),
    ('abSyncLockUI stops setting the locked class',
     "  _ab.el.classList.toggle('locked', locked);", "  // mutated"),
    ('opening no longer re-syncs the lock UI',
     "  abSyncLockUI();\n  try { document.body.style.overflow", "  try { document.body.style.overflow"),
    ('the L key stops working',
     "  if (k === 'l' || k === 'L') { ev.preventDefault(); ev.stopPropagation(); abToggleLock(); return; }",
     "  // mutated"),
    ('abToggleLock hand-rolls the class instead of delegating',
     "  _ab.locked = !_ab.locked;\n  abSyncLockUI();",
     "  _ab.locked = !_ab.locked;\n  _ab.el.classList.toggle('locked', _ab.locked);"),
]

# ── NO VERSION MUTATIONS ───────────────────────────────────────────────
# test_v7048.js carries no version-identity assertions, so there is nothing
# here to mutate. Nine release suites pin the version and each has its own
# mutate script; duplicating that here only fights version_scan.py, which
# recognises mutation blocks by the `mutate` / `mutsw` shell helper and so
# reads every version in this Python list as a claim about what the app
# currently is - turning the "revert to the previous version" targets into
# stale anchors. Focused suite, focused mutations.

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
        n = len([l for l in r.stdout.split('\n') if l.startswith('  FAIL')])
        print('caught             %-52s %d assertion(s)' % (label, n))
        caught += 1
    else:
        print('NOT CAUGHT         ' + label)

shutil.copy2(BAK, SRC)
print('')
print('---- %d/%d caught, %d skipped (anchor)' % (caught, len(muts), skipped))
PYEOF
