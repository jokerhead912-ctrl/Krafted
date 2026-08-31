#!/bin/zsh
# Mutation check for test_v7053.js (v7.0.53 — minimap) — deliberately break the
# source, confirm the suite goes red, restore. A suite that cannot fail is not
# a suite.
#
#   "Every object drawn at board scale, a viewport box you can grab and drag to
#    pan, click elsewhere to jump, and Library search hits tinted on the map."
#
# The mutations here lean on GEOMETRY, because that is where this feature can
# fail while still looking perfect: a map that draws beautifully and flies the
# camera somewhere else is worse than no map. Sign flips, a max where a min
# belongs, and a delta replaced by an absolute are all invisible in the source
# and obvious in the round-trip assertions.
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
TMP=/tmp/krafted-mutate53
mkdir -p $TMP

cp kraftpub-v6.8.0.html $TMP/mut.html

$PY - "$TMP/mut.html" <<'PYEOF'
import subprocess, sys, shutil

SRC = sys.argv[1]
BAK = SRC + '.orig'
shutil.copy2(SRC, BAK)
orig = open(SRC, encoding='utf-8').read()
NODE = '/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node'
SUITE = 'Krafted/tests/test_v7053.js'

# The four refresh hooks share one line of code, so each anchor carries the
# comment above it. An anchor with no context would hit the wrong one.
UC_HOOK = ("  if (state.reframing && state.reframing._tb) rfPositionToolbar();\n"
           "  // v7.0.53: the map's viewport box is a view of the camera, so every camera\n"
           "  // tick is a repaint. Coalesced to one paint per frame inside the callee.\n"
           "  try { requestMinimapRefresh(); } catch (e) {}")
RS_HOOK = ("  try { libSyncActive(); } catch (e) {}\n"
           "  // v7.0.53: the map tints the selected item too.\n"
           "  try { requestMinimapRefresh(); } catch (e) {}")
SAS_HOOK = ("  try { requestLibraryRefresh(); } catch (e) {}\n"
            "  try { requestMinimapRefresh(); } catch (e) {}")
RLP_HOOK = ("  // The minimap tints search hits, so a new query is also a new map.\n"
            "  try { requestMinimapRefresh(); } catch (e) {}")

muts = [
    # ── 1. GEOMETRY: the screen->world inversion loses a sign ────────
    ('miniViewportRect stops inverting the pan (sign flip)',
     "  x0: (0 - state.pan.x) / z, y0: (0 - state.pan.y) / z,",
     "  x0: (0 + state.pan.x) / z, y0: (0 + state.pan.y) / z,"),

    # ── 2. GEOMETRY: centring divides instead of multiplying ─────────
    ('miniCenterOn solves pan with the wrong operator',
     "  state.pan.x = (window.innerWidth || 0) / 2 - z * wx;",
     "  state.pan.x = (window.innerWidth || 0) / 2 - z / wx;"),

    # ── 3. GEOMETRY: the fit drops the viewport from the union ───────
    ('the fit covers content only, so the viewport box can fall off-canvas',
     "  minX = Math.min(bb.minX, v.x0); minY = Math.min(bb.minY, v.y0);",
     "  minX = bb.minX; minY = bb.minY;"),

    # ── 4. GEOMETRY: the fit drops the far corner from the union ─────
    ('the fit ignores where the viewport ends',
     "  maxX = Math.max(bb.maxX, v.x1); maxY = Math.max(bb.maxY, v.y1);",
     "  maxX = bb.maxX; maxY = bb.maxY;"),

    # ── 5. GEOMETRY: aspect ratio inverted (max where min belongs) ───
    ('the fit stops preserving aspect ratio and overflows the canvas',
     "  var s = Math.min(W / bw, H / bh);",
     "  var s = Math.max(W / bw, H / bh);"),

    # ── 6. the drag stops freezing the mapping (feedback loop) ───────
    ('miniToWorld ignores the frozen mapping, so a drag chases itself',
     "  var m = (_miniDrag && _miniDrag.map) ? _miniDrag.map : _miniMap;",
     "  var m = _miniMap;"),

    # ── 7. the drag jumps to the cursor instead of moving by delta ───
    ('dragging teleports the camera to the cursor instead of tracking it',
     "  miniCenterOn(_miniDrag.cx + (w.x - _miniDrag.wx), _miniDrag.cy + (w.y - _miniDrag.wy));",
     "  miniCenterOn(w.x, w.y);"),

    # ── 8. the repaint recomputes mid-drag ───────────────────────────
    ('drawMinimap recomputes the fit during a drag, sliding the map away',
     "  var m = (_miniDrag && _miniDrag.map) ? _miniDrag.map : miniComputeMap(W, H);",
     "  var m = miniComputeMap(W, H);"),

    # ── 9. the viewport box is frozen instead of repainted ───────────
    ('the viewport box stops moving while you drag it',
     "  var v = miniViewportRect();",
     "  var v = { x0: 0, y0: 0, x1: 0, y1: 0 };"),

    # ── 10. the Library grows its own second copy of the filter ──────
    ('the Library filter is hand-written again, free to drift from the map',
     "    return libMatches(it, q);",
     "    var hay = [it.name, it.note, (it.tags || [])].join(' ').toLowerCase();\n"
     "    return hay.indexOf(q) >= 0;"),

    # ── 11. the search stops covering tags and notes ─────────────────
    ('the minimap tint only looks at names, so note/tag hits go untinted',
     "    if (!libMatches(it, q)) return;",
     "    if (String(it.name || '').toLowerCase().indexOf(q) < 0) return;"),

    # ── 12. an empty query stops meaning "everything" ────────────────
    ('libMatches drops the empty-query short circuit',
     "function libMatches(it, q) {\n  if (!q) return true;",
     "function libMatches(it, q) {"),

    # ── 13. BEHAVIOURAL: the repaint debounce guard is removed ───────
    ('two changes in one frame paint the map twice',
     "function requestMinimapRefresh() {\n"
     "  var p = document.getElementById('minimap-panel');\n"
     "  if (!p || p.classList.contains('collapsed')) return;\n"
     "  if (_miniRaf) return;",
     "function requestMinimapRefresh() {\n"
     "  var p = document.getElementById('minimap-panel');\n"
     "  if (!p || p.classList.contains('collapsed')) return;"),

    # ── 14. BEHAVIOURAL: a collapsed map paints anyway ───────────────
    ('a collapsed minimap still paints on every camera tick',
     "function requestMinimapRefresh() {\n"
     "  var p = document.getElementById('minimap-panel');\n"
     "  if (!p || p.classList.contains('collapsed')) return;",
     "function requestMinimapRefresh() {\n"
     "  var p = document.getElementById('minimap-panel');\n"
     "  if (!p) return;"),

    # ── 15-18. the four refresh hooks, each unplugged on its own ─────
    ('the camera no longer repaints the map (a stale viewport box)',
     UC_HOOK,
     "  if (state.reframing && state.reframing._tb) rfPositionToolbar();"),
    ('board mutations no longer repaint the map (a stale board)',
     SAS_HOOK, "  try { requestLibraryRefresh(); } catch (e) {}"),
    ('selection changes no longer repaint the map (a stale highlight)',
     RS_HOOK, "  try { libSyncActive(); } catch (e) {}"),
    ('a new search no longer repaints the map (stale tint)',
     RLP_HOOK, ""),

    # ── 19. text and to-dos vanish from the map ──────────────────────
    ('text and to-dos are dropped, so a text board maps as empty',
     "  [state.texts, state.todos].forEach(function (list) {\n"
     "    (list || []).forEach(function (t) {\n"
     "      if (!(t.w > 0) || !(t.h > 0)) return;\n"
     "      out.push({ id: t.id, x: t.x, y: t.y, w: t.w, h: t.h });\n"
     "    });\n"
     "  });", ""),

    # ── 20. small rectangles collapse to nothing ─────────────────────
    ('distant rectangles shrink below one pixel and disappear',
     "Math.max(1.5, r.w * m.s)", "r.w * m.s"),

    # ── 21. the map stays on screen while pitching ───────────────────
    ('presenting leaves the minimap on screen',
     "body.presenting #minimap-panel { display:none; }",
     "body.presenting #minimap-panel { display:flex; }"),

    # ── 22. the shortcut registry entry is renamed ───────────────────
    ('the minimap toggle disappears from the shortcut registry',
     "id: 'minimap-toggle-panel', category: 'View',",
     "id: 'minimap-toggle-panel-x', category: 'View',"),

    # ── 23. the boot restore is gone ─────────────────────────────────
    ('the minimap forgets whether you opened it',
     "(function initMinimapPanel() {",
     "(function initMinimapPanelGone() {"),

    # ── 24. touch drags scroll the page instead of panning ───────────
    #   Anchor the WHOLE rule, not the bare declaration: `touch-action:none`
    #   appears on five elements here, and replacing the first hit would
    #   quietly mutate #viewport instead of the minimap.
    ('the minimap canvas loses touch-action, so a touch drag scrolls the page',
     "#minimap-canvas { display:block; width:220px; height:145px; border-radius:6px; "
     "background:rgba(0,0,0,0.3); border:1px solid var(--border-subtle); cursor:crosshair; touch-action:none; }",
     "#minimap-canvas { display:block; width:220px; height:145px; border-radius:6px; "
     "background:rgba(0,0,0,0.3); border:1px solid var(--border-subtle); cursor:crosshair; }"),
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
        n = len([l for l in r.stdout.split('\n') if l.strip().startswith('FAIL')])
        print('caught             %-62s %d assertion(s)' % (label, n))
        caught += 1
    else:
        print('NOT CAUGHT         ' + label)

shutil.copy2(BAK, SRC)
print('')
print('---- %d/%d caught, %d skipped (anchor)' % (caught, len(muts), skipped))
PYEOF
