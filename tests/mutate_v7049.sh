#!/bin/zsh
# Mutation check for test_v7049.js (Reframe) — deliberately break the source,
# confirm the suite goes red, restore. A suite that cannot fail is not a suite.
#
#   "I can't control the rotation, the live preview doesn't match what I end up
#    with, and it turns into a blank frame."
#
# Every mutation below restores one piece of that. If any of them can come back
# without the suite going red, the bug can come back too.
#
# WHY PYTHON AND NOT A `mutate` HELPER LIKE THE OLDER SCRIPTS HERE
#   Most of these anchors span multiple lines — the clamp especially, where the
#   rotate / clamp / rotate-back trio only means anything as a unit. zsh string
#   arguments cannot carry embedded newlines safely, and an anchor that silently
#   stops matching is a SKIPPED, which is worse than a FAIL. So the edits are
#   driven from Python, which sees the file exactly as the suite does.
#
# WHY ONE MUTATION IS LISTED TWICE (pan delegation)
#   The drag can fail by stopping delegation OR by writing a transform of its
#   own. They are different regressions with the same anchor, so both are here.
#   Each mutation starts from the pristine copy, so the shared anchor is fine.
#
# ── NO VERSION MUTATIONS ───────────────────────────────────────────────
#   This suite carries no version-identity assertion, so there is nothing to
#   revert. Nine release suites pin the version and each has its own mutate
#   script; duplicating that here only fights version_scan.py, which recognises
#   mutation blocks by the `mutate` / `mutsw` shell helper and would read every
#   version in this Python list as a claim about what the app currently is.
#   Focused suite, focused mutations.
#
# NOTE: never run against the dev file; we always mutate a throwaway copy.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate49
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
SUITE = 'Krafted/tests/test_v7049.js'

muts = [
    # ── 1. the blank frame ────────────────────────────────────────────
    ('the zoom floor is gone, so the image can be smaller than the frame',
     "function framingMinZoom() { return 1; }",
     "function framingMinZoom() { return 0.2; }"),
    ('rotation no longer grows the scale, so corners fall outside the image',
     "  var s = Math.max(b.sMin, framingBaseScale(b) * z);",
     "  var s = framingBaseScale(b) * z;"),
    # The one that was actually wrong on the first cut: clamping in the frame's
    # space sweeps a ROTATED rectangle as if it were axis-aligned, and the
    # image slides out from under the frame. ~4356 of the sweep's cases.
    ('the pan is clamped in the frame space instead of the rotated space',
     "  var ux = g.c * txs + g.sn * tys;\n"
     "  var uy = -g.sn * txs + g.c * tys;\n"
     "  ux = Math.max(-g.budgetX, Math.min(g.budgetX, ux));\n"
     "  uy = Math.max(-g.budgetY, Math.min(g.budgetY, uy));\n"
     "  // back to the frame's space (t = R(r) * tau)\n"
     "  var tx = g.c * ux - g.sn * uy;\n"
     "  var ty = g.sn * ux + g.c * uy;",
     "  var ux = txs;\n"
     "  var uy = tys;\n"
     "  ux = Math.max(-g.budgetX, Math.min(g.budgetX, ux));\n"
     "  uy = Math.max(-g.budgetY, Math.min(g.budgetY, uy));\n"
     "  var tx = ux;\n"
     "  var ty = uy;"),

    # ── 2. what you see is not what you get ───────────────────────────
    ('the drag ignores board zoom, so the image lags the cursor',
     "    const dx = (e.clientX - rf.startX) / z;",
     "    const dx = (e.clientX - rf.startX);"),
    ('the drag writes its own transform again',
     "    rf.items.forEach(it => rfSetPan(it, nx, ny));\n    return;",
     "    rf.items.forEach(it => { it.img.style.transform = 'translate(' + nx + 'px,' + ny + 'px)'; });\n    return;"),
    ('the drag stops delegating, so the pan is never clamped',
     "    rf.items.forEach(it => rfSetPan(it, nx, ny));",
     "    rf.items.forEach(it => { it.frameX = nx; it.frameY = ny; });"),
    ('the applied path goes back to object-fit:cover',
     "  img.style.objectFit = '';",
     "  img.style.objectFit = 'cover';"),

    # ── 3. it does not survive a reload ───────────────────────────────
    ('updateItemStyle stops re-applying the framing, so a reload loses it',
     "  if (!item.isVideo && item.img) applyImageFraming(item);",
     "  // mutated"),
    ('one save path drops the framing fields',
     "frameOn: i.frameOn || false, frameZ: i.frameZ || 1,",
     "frameOn: false, frameZ: i.frameZ || 1,"),
    ('the load path drops the framing fields',
     "frameOn: n.frameOn || false, frameZ: n.frameZ || 1, frameRot: n.frameRot || 0, frameX: n.frameX || 0, frameY: n.frameY || 0,",
     "frameOn: false, frameZ: 1, frameRot: 0, frameX: 0, frameY: 0,"),
    ('migration runs on cropX 0 / cropY 0, silently reframing every old board',
     "  if (!item.cropX && !item.cropY) return;",
     "  // mutated"),

    # ── 4. cancel that is not a cancel ────────────────────────────────
    # Anchored on the whole `if (!apply)` block: the bare restore line used to
    # appear in exitReframe AND in the toolbar Reset, so replacing the first
    # hit mutated the wrong one and the suite stayed green.
    ('Esc restores only the pan, keeping half the edit',
     "    if (!apply) {\n"
     "      var s = rf.snap[i];\n"
     "      rfSetFrameFields(it, s);\n"
     "    }",
     "    if (!apply) {\n"
     "      var s = rf.snap[i];\n"
     "      it.frameX = s.x; it.frameY = s.y;\n"
     "    }"),
    ('the single field writer forgets the zoom and the rotation',
     "  if (f.on !== undefined) it.frameOn = !!f.on;\n"
     "  it.frameZ = f.z || 1;\n"
     "  it.frameRot = f.rot || 0;\n"
     "  it.frameX = f.x || 0;",
     "  if (f.on !== undefined) it.frameOn = !!f.on;\n"
     "  it.frameX = f.x || 0;"),
    ('the toolbar Reset hand-writes its own copy again',
     "    rf.items.forEach(function (it, i) {\n"
     "      rfSetFrameFields(it, rf.snap[i]);\n"
     "    });\n"
     "    rfSyncUI();",
     "    rf.items.forEach(function (it, i) {\n"
     "      var s = rf.snap[i];\n"
     "      it.frameOn = s.on; it.frameZ = s.z; it.frameRot = s.rot; it.frameX = s.x; it.frameY = s.y;\n"
     "      applyImageFraming(it);\n"
     "    });\n"
     "    rfSyncUI();"),
    ('Hold:original stops capturing frameOn',
     "      return { on: !!it.frameOn, z: it.frameZ, rot: it.frameRot, x: it.frameX, y: it.frameY };",
     "      return { z: it.frameZ, rot: it.frameRot, x: it.frameX, y: it.frameY };"),
    ('the snapshot forgets the zoom, so Esc cannot put it back',
     "return { on: !!it.frameOn, z: it.frameZ || 1, rot: it.frameRot || 0, x: it.frameX || 0, y: it.frameY || 0 };",
     "return { on: !!it.frameOn, z: 1, rot: it.frameRot || 0, x: it.frameX || 0, y: it.frameY || 0 };"),

    # ── 5. entry points ───────────────────────────────────────────────
    ('the context menu silently drops the rest of the selection',
     "enterReframe(getSelectedImages());",
     "enterReframe(getSelectedImages()[0]);"),
    ('reframe disappears from the shortcut registry',
     "id: 'edit-reframe',", "id: 'edit-reframe-x',"),
    ('the wheel stops owning zoom, so it zooms the board instead',
     "  if (state.reframing) {\n"
     "    e.preventDefault();\n"
     "    const rf = state.reframing;\n"
     "    const step = e.shiftKey ? 0.02 : 0.08;\n"
     "    const dir = (e.deltaY > 0) ? -1 : 1;\n"
     "    rf.items.forEach(function (it) { rfSetZoom(it, (it.frameZ || 1) * (1 + dir * step)); });\n"
     "    rfSyncUI();\n"
     "    return;\n"
     "  }",
     "  // mutated"),

    # ── 6. a second implementation creeps back in ─────────────────────
    ('rfSetPan hand-rolls its own clamp',
     "  var p = framingClampPan(item, x, y);",
     "  var limX = 1e6, limY = 1e6;\n"
     "  var p = { x: Math.max(-limX, Math.min(limX, x || 0)), y: Math.max(-limY, Math.min(limY, y || 0)) };"),
    ('rfSetRotation stops painting through the shared applier',
     "function rfSetRotation(item, deg) {\n"
     "  item.frameRot = deg || 0;\n"
     "  item.frameOn = true;\n"
     "  applyImageFraming(item);\n"
     "}",
     "function rfSetRotation(item, deg) {\n"
     "  item.frameRot = deg || 0;\n"
     "  item.frameOn = true;\n"
     "}"),

    # ── 7. the chrome ─────────────────────────────────────────────────
    ('the frame stops clipping its image',
     ".item.framed { overflow:hidden; }", "/* mutated */"),
    ('the toolbar goes back inside .item, where overflow:hidden clips it (Safari bug returns)',
     "  document.body.appendChild(tb);",
     "  el.appendChild(tb);"),
    ('a press on the toolbar starts a board drag again',
     "    if (e.target && e.target.closest && e.target.closest('.rf-toolbar')) return;",
     "    // mutated"),
    ('one gesture goes back to carrying two meanings',
     "      rf.mode = e.altKey ? 'rotate' : 'pan';",
     "      rf.mode = 'pan';"),

    # ── 8. the reset and the creators disagree again ───────────────────
    ('the reset blanks object-fit, so cancelling a reframe stretches the image',
     "  item.img.style.cssText = ITEM_IMG_BASE_CSS;",
     "  item.img.style.objectFit = '';"),
    ('one image creator drifts back to a literal of its own',
     "mediaEl.style.cssText = ITEM_IMG_BASE_CSS;",
     "mediaEl.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;object-fit:cover;';"),
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
        n = len([l for l in r.stdout.split('\n') if l.startswith('  FAIL')])
        print('caught             %-64s %d assertion(s)' % (label, n))
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
