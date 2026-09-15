#!/bin/zsh
# Mutation check for test_v7_23_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.23.0 promises:
#   1. one inverse-transform helper pair (kraftedLocalBasis / kraftedClientToLocal)
#      and NOT a hand-rolled copy of the CSS transform chain;
#   2. the basis is MEASURED (three zero-size probes), so rotation, flip, board
#      zoom and any nesting are handled by the browser's own maths rather than
#      by us re-deriving anything;
#   3. probes are created once per element, are zero-size and swallow no events;
#   4. a degenerate basis answers null instead of dividing by zero and lying;
#   5. _canvasPoint maps the pointer into WRAP-LOCAL space and never touches
#      getBoundingClientRect — the axis-aligned box is what caused the bug;
#   6. paper mode does not clamp, the plain path does.
# If any mutation below survives, the suite is decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7230
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_23_0.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7230/mut.html'
s = open(p, encoding='utf-8').read()
n = s.count(old)
if n != want:
    print('ANCHOR MISS (count=%d, want=%d): %r' % (n, want, old[:70]))
    sys.exit(2)
open(p, 'w', encoding='utf-8').write(s.replace(old, new))
PYEOF
  if [ $? -ne 0 ]; then
    SKIP=$((SKIP + 1)); ANCHORFAIL=$((ANCHORFAIL + 1))
    echo "SKIPPED (anchor): $1"
    return
  fi
  run "$1"
}

CAUGHT=0; NOTCAUGHT=0; FRAGILE=0; SKIP=0; ANCHORFAIL=0; EQUIV=0
. Krafted/tests/mutlib.sh

# ── group A: the inverse ─────────────────────────────────────────────────
mutate "A1 the determinant sign is flipped (det = ab + cd instead of ab - cd)" \
  "var det = b.ax * b.by - b.bx * b.ay;" \
  "var det = b.ax * b.by + b.bx * b.ay;"

mutate "A2 the inverse forgets to divide by det (a 2x board zoom answers 2x)" \
  "  return [(dx * b.by - b.bx * dy) / det, (b.ax * dy - dx * b.ay) / det];" \
  "  return [(dx * b.by - b.bx * dy), (b.ax * dy - dx * b.ay)];"

mutate "A3 the numerator uses the wrong partner column (rotations come back skewed)" \
  "  return [(dx * b.by - b.bx * dy) / det, (b.ax * dy - dx * b.ay) / det];" \
  "  return [(dx * b.by - b.ay * dy) / det, (b.ax * dy - dx * b.bx) / det];"

mutate "A4 the degenerate basis is no longer guarded (0/0 = NaN is handed back)" \
  "  var det = b.ax * b.by - b.bx * b.ay;
  if (!det || !isFinite(det)) return null;" \
  "  var det = b.ax * b.by - b.bx * b.ay;
  if (false) return null;"

mutate "A5 a missing basis answers [0,0] instead of null (silently lands at the corner)" \
  "  if (!b) return null;" "  if (!b) return [0, 0];"

# ── group B: the measured basis itself ───────────────────────────────────
mutate "B1 the two axis probes are swapped (x and y come back transposed)" \
  "var offs = [[0, 0], [KRAFTED_PROBE_BASIS, 0], [0, KRAFTED_PROBE_BASIS]];" \
  "var offs = [[0, 0], [0, KRAFTED_PROBE_BASIS], [KRAFTED_PROBE_BASIS, 0]];"

mutate "B2 the probes are not cached (every pointermove appends three more divs)" \
  "    el._kraftedProbes = m;" "    ;"

mutate "B3 the origin is read from the rect's size instead of its position" \
  "    ox: o.left, oy: o.top," "    ox: o.width, oy: o.height,"

mutate "B4 the axis vector is not divided by the basis length (16x too long)" \
  "    ax: (px.left - o.left) / KRAFTED_PROBE_BASIS," \
  "    ax: (px.left - o.left),"

mutate "B5 the probes are given a real size (they could shift the card's layout)" \
  "      d.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;left:' +" \
  "      d.style.cssText = 'position:absolute;width:2px;height:2px;pointer-events:none;left:' +"

mutate "B6 the probes swallow pointer events (the pen would hit a probe, not the canvas)" \
  "width:0;height:0;pointer-events:none;left:' +" \
  "width:0;height:0;left:' +"

mutate "B7 the basis length is zero, so all three probes pile up on the origin" \
  "var KRAFTED_PROBE_BASIS = 16;" "var KRAFTED_PROBE_BASIS = 0;"

# ── group C: the wiring in _canvasPoint ──────────────────────────────────
mutate "C1 THE ORIGINAL BUG: back to (clientX - canvasRect.left) on the AABB" \
  "      const p = kraftedClientToLocal(wrap, ev.clientX, ev.clientY);
      if (!p) return [0, 0];" \
  "      const cr = annoCanvas.getBoundingClientRect();
      const p = [ev.clientX - cr.left, ev.clientY - cr.top];
      if (!p) return [0, 0];"

mutate "C2 paper mode clamps, so a stroke on the black margin snaps to the frame edge" \
  "          (p[0] - R.left) / (R.width || 1),
          (p[1] - R.top) / (R.height || 1)," \
  "          Math.max(0, Math.min(1, (p[0] - R.left) / (R.width || 1))),
          Math.max(0, Math.min(1, (p[1] - R.top) / (R.height || 1))),"

mutate "C3 the plain path stops clamping, so a stroke can be filed outside [0,1]" \
  "        Math.max(0, Math.min(1, (p[0] - r.left) / (r.width || 1))),
        Math.max(0, Math.min(1, (p[1] - r.top) / (r.height || 1)))," \
  "        (p[0] - r.left) / (r.width || 1),
        (p[1] - r.top) / (r.height || 1),"

mutate "C4 no basis answers null, so a pointerdown with no layout throws downstream" \
  "      if (!p) return [0, 0];" "      if (!p) return null;"

# ── group D: one definition, not two (病根一) ─────────────────────────────
# A second copy of the helper is the classic drift: the A version gets fixed,
# the B version keeps shipping. S1e exists to shout the moment a second one
# appears, so prove it does.
mutate "D1 a SECOND kraftedClientToLocal appears (the copy nobody will fix)" \
  "function kraftedClientToLocal(el, clientX, clientY, basis) {" \
  "function kraftedClientToLocal(el, clientX, clientY, basis) { }
function kraftedClientToLocal(el, clientX, clientY, basis) {"

cp kraftpub-dev.html $TMP/mut.html
print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
