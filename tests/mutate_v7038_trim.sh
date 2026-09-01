#!/bin/bash
# Mutation check for the v7.0.41 rework of the trim assertions in test_v7038.js.
#
# The three original assertions pinned the OLD inline clamp that used to live
# inside setTrimFromPlayhead. When that clamp was extracted into the shared
# clampTrimMark(), those assertions went stale — they were asserting on source
# text, not behaviour. They have been rewritten to assert the new architecture.
#
# This script proves the replacements are not vacuous: each mutation below is a
# deliberate breakage, and the suite MUST fail. A mutation that passes means the
# assertion is dead weight.
#
# Usage:  tests/mutate_v7038_trim.sh
set -u

cd "$(dirname "$0")/../.." || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
SRC=kraftpub-dev.html
WORK=/tmp/krafted-mutate38
rm -rf "$WORK"; mkdir -p "$WORK"
MUT="$WORK/mut.html"

run() {  # run <label>
  local out
  out=$("$NODE" Krafted/tests/test_v7038.js "$MUT" 2>&1)
  if printf '%s' "$out" | grep -q "ALL PASS"; then
    printf '  NOT CAUGHT  <- %s\n' "$1"
    return 1
  fi
  printf '  caught      <- %s\n' "$1"
  printf '%s\n' "$out" | grep '^  FAIL' | sed 's/^/                /'
  return 0
}

# swap(old, new, label) — must match old EXACTLY once, or the mutation is bogus
# (which would silently turn a real check into a skipped one).
python_swap() {
  /Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3 - "$MUT" "$1" "$2" "$3" <<'PY'
import sys
path, old, new, label = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
s = open(path, encoding='utf-8').read()
n = s.count(old)
if n != 1:
    sys.stderr.write('ANCHOR MISS (%d matches) [%s]: %r\n' % (n, label, old[:80]))
    sys.exit(2)
open(path, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
}

echo "mutation check: test_v7038 trim assertions (v7.0.41 rework)"
fails=0

# 1. the menu stops delegating to the shared clamp.
#    The bare clamp call also occurs in trimHotkey(), so the anchor has to carry
#    the preceding line to be unique — the swap helper exits 2 otherwise.
cp "$SRC" "$MUT"
python_swap '    const t = Math.max(0, Math.min(v.duration, v.currentTime || 0));
    const val = clampTrimMark(it, which, t, v.duration);' \
'    const t = Math.max(0, Math.min(v.duration, v.currentTime || 0));
    const val = t;' 'drop clampTrimMark delegation' || exit 2
run "the menu stops clamping through the shared clampTrimMark" || fails=$((fails+1))

# 2. a hand-rolled in-point clamp creeps back into the menu path
cp "$SRC" "$MUT"
python_swap '    const t = Math.max(0, Math.min(v.duration, v.currentTime || 0));
    const val = clampTrimMark(it, which, t, v.duration);' \
'    const t = Math.max(0, Math.min(v.duration, v.currentTime || 0));
    const te = (typeof it.trimEnd === "number" && it.trimEnd > 0) ? it.trimEnd : v.duration;
    const _legacy = Math.min(t, te - 0.1);
    const val = clampTrimMark(it, which, t, v.duration);' 'reintroduce inline clamp' || exit 2
run "a private in-point clamp comes back in the menu path" || fails=$((fails+1))

# 3. the gap constant is inlined again (the drift this refactor exists to kill)
cp "$SRC" "$MUT"
python_swap '    val = Math.max(0, Math.min(val, Math.max(0, te - TRIM_MIN_GAP)));' \
            '    val = Math.max(0, Math.min(val, Math.max(0, te - 0.1)));' 'inline the gap' || exit 2
python_swap '    val = Math.min(dur, Math.max(val, Math.min(dur, ts + TRIM_MIN_GAP)));' \
            '    val = Math.min(dur, Math.max(val, Math.min(dur, ts + 0.1)));' 'inline the gap 2' || exit 2
run "TRIM_MIN_GAP is replaced by a literal again" || fails=$((fails+1))

# 4. the "only push undo when something moves" guard loses its plan.length form.
#    Behaviour-preserving on purpose: this is a structural assertion, so the
#    mutation must preserve behaviour and only change the source shape.
cp "$SRC" "$MUT"
python_swap '  if (!plan.length) {' '  if (!plan || !plan[0]) {' 'reshape the guard' || exit 2
python_swap "(plan.length > 1 ? ' · ' + plan.length + ' clips' : '')" "''" 'drop the count' || exit 2
run "the undo-step guard no longer reads plan.length" || fails=$((fails+1))

echo
echo "restoring…"
rm -rf "$WORK"
"$NODE" Krafted/tests/test_v7038.js 2>&1 | tail -3
echo
if [ "$fails" -ne 0 ]; then
  echo "MUTATION CHECK FAILED: $fails mutation(s) not caught"
  exit 1
fi
echo "all mutations caught"
