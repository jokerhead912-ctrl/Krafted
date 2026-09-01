#!/bin/zsh
# Mutation check for test_v7_1_0.js (the version policy) — deliberately break
# version_scan.py, confirm the suite goes red, restore. A suite that cannot
# fail is not a suite.
#
# WHAT IS DIFFERENT HERE
#   Every other mutate script breaks kraftpub-dev.html. This one breaks
#   version_scan.py, because that is where the policy lives. The suite drives
#   the real module through vscan_probe.py, so a mutation is caught by real
#   output, not by a source string going missing.
#
# TWO RULES THAT KEEP THESE HONEST
#   1. Every mutation must stay VALID PYTHON. A SyntaxError makes the probe
#      throw, the suite exits non-zero, and the harness prints "caught" —
#      for a mutation that tripped zero assertions. That is a false green.
#      Check the assertion counts below; anything reporting 0 is suspect.
#   2. The mutated file is the real one, so it is restored from a copy taken
#      before the first edit, and restored again on the way out.
#
# NOTE: this never touches kraftpub-dev.html.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TARGET=Krafted/tests/version_scan.py
BAK=Krafted/tests/.version_scan.py.mutbak
SUITE=Krafted/tests/test_v7_1_0.js

cp "$TARGET" "$BAK"
trap 'cp "$BAK" "$TARGET"; rm -f "$BAK"' EXIT INT TERM

$PY - "$TARGET" "$SUITE" <<'PYEOF'
import subprocess, sys, shutil

SRC, SUITE = sys.argv[1], sys.argv[2]
BAK = SRC + '.orig'
shutil.copy2(SRC, BAK)
orig = open(SRC, encoding='utf-8').read()
NODE = '/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node'
PY = '/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3'

FILTER = ("            if cur_major and ver.split('.')[0] != cur_major:\n"
          "                continue")
HISTORY = ("            elif is_comment:\n"
           "                kind = 'history'          # never touched")
NEWOWN = ("    m = re.search(r'_v(\\d+)_(\\d+)_(\\d+)(?:_|\\.)', base)\n"
          "    if m:\n"
          "        return '%s.%s.%s' % m.groups()\n")

muts = [
    # ── 1. THE BLIND SPOT COMES BACK ──────────────────────────────────
    # The bug this release exists to fix. A hard-coded 7.0 prefix means that
    # from 7.1.0 onwards the scanner matches nothing and still exits 0.
    ('the candidate filter goes back to a hard-coded 7.0 prefix',
     FILTER,
     "            if not ver.startswith('7.0.'):\n                continue"),

    # ── 2. THE FILTER IS REMOVED ALTOGETHER ───────────────────────────
    # Then every 3-part number in the tree is a candidate, including the
    # commented-out legacy `var KRAFTED_VERSION = '6.0.2';` in the app file.
    ('the major filter is dropped, so any 3-part number is a candidate',
     FILTER,
     "            pass"),

    # ── 3. THE PATCH CAP IS REMOVED ───────────────────────────────────
    ('the patch cap stops being enforced',
     "    if kind == 'patch' and c + 1 > PATCH_MAX:",
     "    if False:"),

    # ── 4. THE CAP IS RAISED ──────────────────────────────────────────
    # Raising it "just a bit" is how the creep comes back.
    ('the patch cap is quietly raised',
     "PATCH_MAX = 9",
     "PATCH_MAX = 99"),

    # ── 5. A MINOR NO LONGER RESETS THE PATCH ─────────────────────────
    # This is the single rule that stops 7.0.53 from ever happening again.
    ('a minor carries the old patch instead of resetting it',
     "        return vstr((a, b + 1, 0))",
     "        return vstr((a, b + 1, c))"),

    # ── 6. A MAJOR NO LONGER RESETS ANYTHING ──────────────────────────
    ('a major carries the old minor and patch',
     "        return vstr((a + 1, 0, 0))",
     "        return vstr((a + 1, b, c))"),

    # ── 7. THE PREVIOUS VERSION IS COMPUTED AGAIN ─────────────────────
    # `patch - 1` is what test_v7047.js did. One minor bump later it yields
    # the CURRENT version and asserts sw.js must not contain it.
    ('the previous version is computed by subtracting one again',
     "    prev = args.prev or load_prev()",
     "    prev = vstr((vkey(current)[0], vkey(current)[1], max(0, vkey(current)[2] - 1)))"),

    # ── 8. PROVENANCE COMMENTS START MOVING ───────────────────────────
    # A `// v7.0.53:` comment records which release introduced some code.
    # Bumping it rewrites history, and it would be rewritten every release.
    ('provenance comments are bumped along with the identity',
     HISTORY,
     HISTORY + "\n                new = nxt"),

    # ── 9. THE NEW TEST-FILE NAMING STOPS PARSING ─────────────────────
    ('own_version loses the underscored naming convention',
     NEWOWN,
     ""),

    # ── 10. THE CAP RULE STOPS BEING STATED ───────────────────────────
    # The policy is printed on every run precisely so it cannot be forgotten.
    ('the policy text stops explaining the cap',
     "patch is capped at {cap}; the tenth fix rolls the minor",
     "patch is capped at {cap}"),

    # ── 11. THE REVERT ANCHOR STOPS BEING RECOGNISED ─────────────────
    # Then the second identity in a mutate block is treated as a plain one,
    # and every "previous version is gone" check silently checks nothing.
    ('the revert anchor in a mutate block is no longer detected',
     "                if in_block and block_idn == 2:",
     "                if False:"),

    # ── 12. THE STATE FILE STOPS BEING WRITTEN ────────────────────────
    # Next release then has no idea what it replaced.
    ('the bump stops recording the version it replaced',
     "            save_state(nxt, current)",
     "            pass"),
]

caught = 0
skipped = 0
for label, old, new in muts:
    if old not in orig:
        print('SKIPPED (anchor)  ' + label)
        skipped += 1
        continue
    mutated = orig.replace(old, new, 1)
    open(SRC, 'w', encoding='utf-8').write(mutated)

    # A mutation that will not compile is not a behaviour mutation - it would
    # be "caught" by a traceback with zero assertions behind it.
    #
    # compile() in-process rather than `python -m py_compile`: py_compile
    # WRITES __pycache__ next to the source, and a directory of stale bytecode
    # inside the tests directory is exactly the kind of litter that makes a
    # later failure impossible to read.
    try:
        compile(mutated, SRC, 'exec')
    except SyntaxError:
        print('BROKEN MUTATION   %-64s (SyntaxError)' % label)
        skipped += 1
        continue

    r = subprocess.run([NODE, SUITE], capture_output=True, text=True)
    if r.returncode != 0:
        # strip() first: the suite indents FAIL lines by four spaces, so a
        # startswith('  FAIL') test matches nothing and reports 0 assertions
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
