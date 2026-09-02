#!/bin/zsh
# Mutation check for test_v7_2_0.js (chrome insets) — deliberately undo each
# part of the refactor, confirm the suite goes red, restore. A suite that
# cannot fail is not a suite.
#
# WHAT IS BEING BROKEN
#   kraftpub-dev.html, because that is where the collisions lived. Each
#   mutation puts one hardcoded coordinate back, or removes one published
#   variable, and the suite must notice.
#
# TWO RULES THAT KEEP THESE HONEST
#   1. If an anchor is missing the mutation is SKIPPED, and a skip is reported
#      loudly. A skipped mutation is a test that has quietly stopped testing.
#   2. The mutated file is the real dev file, so it is restored from a copy
#      taken before the first edit, and restored again on the way out.
#
# NOTE ON SYNTAX
#   Unlike mutate_v7_1_0.sh this needs no compile() check: the suite asserts on
#   source strings and never executes the app's JavaScript, so a mutation
#   cannot "trip" an assertion by making the file unparseable.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TARGET=kraftpub-dev.html
BAK=Krafted/tests/.kraftpub-dev.mutbak
SUITE=Krafted/tests/test_v7_2_0.js

cp "$TARGET" "$BAK"
trap 'cp "$BAK" "$TARGET"; rm -f "$BAK"' EXIT INT TERM

$PY - "$TARGET" "$SUITE" <<'PYEOF'
import subprocess, sys, shutil

SRC, SUITE = sys.argv[1], sys.argv[2]
BAK = SRC + '.orig'
shutil.copy2(SRC, BAK)
NODE = '/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node'

MINIMAP_VAR = "#minimap-panel { position:fixed; bottom:calc(12px + var(--rail-bottom, 0px)); right:12px; width:236px;"
MINIMAP_OLD = "#minimap-panel { position:fixed; bottom:12px; right:12px; width:236px;"

PROPS_VAR = "#props { position:fixed; top:calc(12px + var(--right-top, 0px)); right:12px; width:250px;"
PROPS_OLD = "#props { position:fixed; top:12px; right:12px; width:250px;"

PROPS_MAXH = "max-height:calc(100vh - 24px - var(--right-top, 0px) - var(--minimap-h, 0px) - var(--rail-bottom, 0px))"
PROPS_MAXH_NO_MM = "max-height:calc(100vh - 24px - var(--right-top, 0px) - var(--rail-bottom, 0px))"

STATUS_HEAD = "#status { font-size:10px;"
STATUS_OLD = "#status { position:fixed; bottom:42px; right:12px; font-size:10px;"

ZOOM_HEAD = "#zoom-step-widget {\n  display: flex; align-items: center; gap: 8px;"
ZOOM_OLD = "#zoom-step-widget {\n  position: fixed; bottom: 14px; left: 12px;\n  display: flex; align-items: center; gap: 8px;"

PUBLISH = "  root.style.setProperty('--rail-bottom', (barH + gap) + 'px');"
PUBLISH_GONE = "  /* mutated: the media bar height is no longer published */"

POPOVER_NEW = "    const barH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rail-bottom')) || 0;"
POPOVER_OLD = ("    const mediaBar = document.getElementById('media-bar');\n"
               "    const barH = (mediaBar && mediaBar.classList.contains('active')) ? mediaBar.offsetHeight : 0;")

COLLAPSE_NEW = ("#media-bar.collapsed .media-bar-ctrls,\n"
                "#media-bar.collapsed .media-sep,\n"
                "#media-bar.collapsed .media-list { display:none; }")
COLLAPSE_LEAK = ("#media-bar.collapsed .media-bar-ctrls,\n"
                 "#media-bar.collapsed .media-sep { display:none; }")

LIST_NEW = "#media-bar .media-list { display:flex; gap:4px; overflow-x:auto; flex:0 1 auto; max-width:55%; padding:2px 0; }"
LIST_OLD = "#media-bar .media-list { display:flex; gap:4px; overflow-x:auto; flex:1; padding:2px 0; }"

CAPTURE_NEW = "#capture-result { position:fixed; bottom:calc(20px + var(--rail-bottom, 0px) + var(--status-h, 0px)); left:20px;"
CAPTURE_OLD = "#capture-result { position:fixed; bottom:20px; left:20px;"

STRIP_NEW = ('<div id="view-status-bar">\n'
             '<div id="status">Zoom: 100% | Items: 0 | Undo: 0</div>\n'
             '<div id="zoom-step-widget">')
STRIP_BROKEN = ('<div id="status">Zoom: 100% | Items: 0 | Undo: 0</div>\n'
                '<div id="view-status-bar">\n'
                '<div id="zoom-step-widget">')

LIB_NEW = "z-index:9999998; max-height:calc((100vh - 24px) * 0.55); display:flex; flex-direction:column;"
LIB_OLD = "z-index:9999998; max-height:calc(100vh - 130px); display:flex; flex-direction:column;"

muts = [
    # ── 1. THE MINIMAP GOES BACK UNDER THE MEDIA BAR ──────────────────
    # The reported bug: with a video on the board, the bar covered the map's
    # lower third. A hardcoded bottom is the bug, not a cosmetic choice.
    ('the minimap hardcodes bottom:12px again',
     MINIMAP_VAR, MINIMAP_OLD),

    # ── 2. PROPS GOES BACK ON TOP OF THE LIBRARY ──────────────────────
    # The one the user hit: props (w250, z9999999) sat exactly where the
    # Library (w248, z9999998) was, so the Library was simply invisible.
    ('props hardcodes top:12px again, covering the Library',
     PROPS_VAR, PROPS_OLD),

    # ── 3. PROPS FORGETS THE MINIMAP EXISTS ───────────────────────────
    ('props height budget stops subtracting the minimap',
     PROPS_MAXH, PROPS_MAXH_NO_MM),

    # ── 4. THE STATUS PILL BECOMES AN OVERLAY AGAIN ───────────────────
    # It used to sit at bottom:42px right:12px — inside the minimap's
    # rectangle. The user reported it as "blocking".
    ('the status pill pins itself bottom-right again',
     STATUS_HEAD, STATUS_OLD),

    # ── 5. THE ZOOM WIDGET BECOMES AN OVERLAY AGAIN ───────────────────
    # Unreported but the same bug: bottom:14px left:12px put it under the
    # media bar. It belongs to the strip now.
    ('the zoom widget pins itself bottom-left again',
     ZOOM_HEAD, ZOOM_OLD),

    # ── 6. THE AUTHORITY STOPS PUBLISHING ─────────────────────────────
    # If nothing writes --rail-bottom, every calc() silently falls back to
    # its 0 default and all four collisions come back at once.
    ('the media bar height is no longer published',
     PUBLISH, PUBLISH_GONE),

    # ── 7. THE THIRD MEASUREMENT COMES BACK ───────────────────────────
    # The popover used to measure the bar itself. Three places measuring the
    # same bar is how two of them ended up buried under it.
    ('the popover measures the media bar itself again',
     POPOVER_NEW, POPOVER_OLD),

    # ── 8. COLLAPSING LEAKS THE MEDIA LIST ────────────────────────────
    ('collapsing the bar no longer hides the media list',
     COLLAPSE_NEW, COLLAPSE_LEAK),

    # ── 9. THE TOGGLE DISAPPEARS ──────────────────────────────────────
    ('toggleMediaBar is renamed away',
     'function toggleMediaBar() {', 'function toggleMediaBarDisabled() {'),

    # ── 10. THE LIST CAN PUSH THE CONTROLS OFF AGAIN ──────────────────
    # "Lots of videos" used to shove Play All / Pause All out of sight.
    ('the media list grows unbounded again',
     LIST_NEW, LIST_OLD),

    # ── 11. THE CAPTURE RESULT FORGETS THE STRIP ──────────────────────
    ('the capture result goes back to bottom:20px',
     CAPTURE_NEW, CAPTURE_OLD),

    # ── 12. THE STRIP STOPS ENCLOSING THE READOUT ─────────────────────
    # Moving the wrapper below #status leaves the readout outside it, which
    # is a DOM-level regression no string search would catch.
    ('the readout is left outside the status strip',
     STRIP_NEW, STRIP_BROKEN),

    # ── 13. THE LIBRARY TAKES THE WHOLE COLUMN AGAIN ──────────────────
    ('the Library is no longer capped, leaving props no room',
     LIB_NEW, LIB_OLD),
]

caught = 0
skipped = 0
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
# ── machine-readable verdict ─────────────────────────────────────────────
# The one line run_all.sh reads, plus the exit code it gates on. A skipped
# anchor counts as BAD: a mutation that never ran proves nothing at all.
_holes = len(muts) - caught - skipped
print('MUTVERDICT %s holes=%d skipped=%d caught=%d total=%d'
      % ('ok' if (_holes == 0 and skipped == 0) else 'BAD',
         _holes, skipped, caught, len(muts)))
sys.exit(0 if (_holes == 0 and skipped == 0) else 1)

PYEOF
