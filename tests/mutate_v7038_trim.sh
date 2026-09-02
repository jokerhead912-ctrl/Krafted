#!/bin/bash
# Mutation check for the trim assertions in test_v7038.js.
#
# HISTORY (and why this file has to be re-anchored by hand)
#   The three original assertions pinned the OLD inline clamp that used to
#   live inside setTrimFromPlayhead. When that clamp was extracted into the
#   shared clampTrimMark(), those assertions went stale — they were asserting
#   on source text, not behaviour. They were rewritten for the new shape.
#   Then v7.0.44 added one more hop: both doors now go through planTrimMark(),
#   and planTrimMark() is the layer that asks clampTrimMark(), because a
#   request can also be a CONFLICT (a mark landing across the opposite one),
#   which is not a number to clamp at all.
#
#   The TEST was re-anchored for v7.0.44. THIS SCRIPT WAS NOT. #1 and #2 kept
#   looking for `const val = clampTrimMark(...)` and matched 0 times, so both
#   mutations silently stopped existing — and because nothing turned that into
#   a failure, run_all.sh printed "caught all" for months. A mutation script
#   that mutates nothing is worse than no mutation script: it reports
#   coverage it does not have.
#
#   Fixed 2026-09-02. The lesson is now enforced mechanically: every script in
#   this directory prints one MUTVERDICT line and exits non-zero when a
#   mutation was skipped or not caught (see run_all.sh).
#
# WHY THE ANCHORS CARRY THEIR PRECEDING LINE
#   The bare planTrimMark() call also occurs in trimHotkey(), so the anchor
#   has to be unique or the mutation is ambiguous. python_swap exits 2 on any
#   count other than exactly 1 — that is deliberate: a stale anchor must be
#   loud.
#
# Usage:  tests/mutate_v7038_trim.sh
set -u

cd "$(dirname "$0")/../.." || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
SRC=kraftpub-dev.html
WORK=/tmp/krafted-mutate38
rm -rf "$WORK"; mkdir -p "$WORK"
MUT="$WORK/mut.html"

HOLES=0
SKIPPED=0

# run <label> — the suite MUST go red. A mutation that passes is a hole.
run() {
  local out
  out=$("$NODE" Krafted/tests/test_v7038.js "$MUT" 2>&1)
  # A catch has to be PROVEN, not assumed from the absence of a pass: a suite
  # that dies before printing anything also fails to say "ALL PASS", and would
  # be scored as a catch. test_v7038 prints "N passed, M failed", so a non-zero
  # failure count is the signal worth trusting. NOTE: -E with a bare | . In
  # this shell `\|` is NOT alternation.
  if printf '%s' "$out" | grep -qE "FAILURES: [1-9]|[0-9]*[1-9][0-9]* (failed|FAILED)"; then
    printf '  caught      %s  <- %s\n' \
      "$(printf '%s' "$out" | grep -oE "FAILURES: [0-9]+|[0-9]+ (failed|FAILED)" | head -1)" "$1"
    printf '%s\n' "$out" | grep '^  FAIL' | sed 's/^/                /'
    return 0
  fi
  if printf '%s' "$out" | grep -qE "ALL PASS"; then
    printf '  NOT CAUGHT  <- %s\n' "$1"
    HOLES=$((HOLES + 1))
    return 1
  fi
  printf '  UNPROVEN    <- %s\n' "$1"
  printf '%s\n' "$out" | tail -4 | sed 's/^/                /'
  HOLES=$((HOLES + 1))
  return 1
}

anchor_miss() {
  printf '  SKIPPED (anchor)  <- %s\n' "$1"
  SKIPPED=$((SKIPPED + 1))
}

# python_swap <old> <new> <label> — old must match EXACTLY once.
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

# python_swap_n <old> <new> <n> <label> — old must match EXACTLY n times, and
# every one of them is replaced. Needed when the assertion pins a shape that
# occurs on more than one line (the two toast strings both carry plan.length);
# mutating only one of them would leave the assertion green and report a
# mutation that mutated half of what it claimed.
python_swap_n() {
  /Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3 - "$MUT" "$1" "$2" "$3" "$4" <<'PY'
import sys
path, old, new, want, label = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5]
s = open(path, encoding='utf-8').read()
n = s.count(old)
if n != want:
    sys.stderr.write('ANCHOR MISS (%d matches, want %d) [%s]: %r\n' % (n, want, label, old[:80]))
    sys.exit(2)
open(path, 'w', encoding='utf-8').write(s.replace(old, new))
PY
}

# The one line run_all.sh reads, plus the exit code it gates on.
verdict() {
  if [ "$HOLES" -eq 0 ] && [ "$SKIPPED" -eq 0 ]; then
    printf 'MUTVERDICT ok  holes=0 skipped=0\n'
    exit 0
  fi
  printf 'MUTVERDICT BAD holes=%d skipped=%d\n' "$HOLES" "$SKIPPED"
  exit 1
}

echo "mutation check: test_v7038 trim assertions (re-anchored for v7.0.44)"

# 1. the menu stops planning through the shared planner.
cp "$SRC" "$MUT"
if python_swap '    const t = Math.max(0, Math.min(v.duration, v.currentTime || 0));
    const p = planTrimMark(it, which, t, v.duration);' \
'    const t = Math.max(0, Math.min(v.duration, v.currentTime || 0));
    const p = { val: t, clearsOpp: false, oppWas: 0 };' 'drop planTrimMark delegation'; then
  run "the menu stops planning through the shared planTrimMark"
else
  anchor_miss 'drop planTrimMark delegation'
fi

# 2. a hand-rolled in-point clamp creeps back into the menu path.
#    planTrimMark is left in place on purpose: this mutation must trip the
#    "no private clamp" assertion and nothing else, otherwise it is not
#    proving what its label claims.
cp "$SRC" "$MUT"
if python_swap '    const t = Math.max(0, Math.min(v.duration, v.currentTime || 0));
    const p = planTrimMark(it, which, t, v.duration);' \
'    const t = Math.max(0, Math.min(v.duration, v.currentTime || 0));
    const te = (typeof it.trimEnd === "number" && it.trimEnd > 0) ? it.trimEnd : v.duration;
    const _legacy = Math.min(t, te - 0.1);
    const p = planTrimMark(it, which, t, v.duration);' 'reintroduce inline clamp'; then
  run "a private in-point clamp comes back in the menu path"
else
  anchor_miss 'reintroduce inline clamp'
fi

# 3. the gap constant is inlined again (the drift this refactor exists to kill).
#    Both lines live in clampTrimMark, which is what the assertion reads; the
#    two TRIM_MIN_GAP uses in planTrimMark are a different claim and are left
#    alone so this mutation stays targeted.
cp "$SRC" "$MUT"
if python_swap '    val = Math.max(0, Math.min(val, Math.max(0, te - TRIM_MIN_GAP)));' \
               '    val = Math.max(0, Math.min(val, Math.max(0, te - 0.1)));' 'inline the gap' \
   && python_swap '    val = Math.min(dur, Math.max(val, Math.min(dur, ts + TRIM_MIN_GAP)));' \
                  '    val = Math.min(dur, Math.max(val, Math.min(dur, ts + 0.1)));' 'inline the gap 2'; then
  run "TRIM_MIN_GAP is replaced by a literal again"
else
  anchor_miss 'inline the gap'
fi

# 4. the "only push undo when something moves" guard loses its plan.length form.
#    Behaviour-preserving on purpose: this is a structural assertion, so the
#    mutation must preserve behaviour and only change the source shape.
#    plan.length occurs FIVE times across three lines — the guard plus two
#    toast strings that each mention it twice. All of them have to go, or the
#    assertion stays green and this mutation reports a catch it did not earn.
cp "$SRC" "$MUT"
if python_swap '  if (!plan.length) {' '  if (!plan || !plan[0]) {' 'reshape the guard' \
   && python_swap_n "(plan.length > 1 ? ' · ' + plan.length + ' clips' : '')" "''" 2 'drop the counts'; then
  run "the undo-step guard no longer reads plan.length"
else
  anchor_miss 'drop plan.length'
fi

echo
echo "restoring…"
rm -rf "$WORK"
"$NODE" Krafted/tests/test_v7038.js 2>&1 | tail -3
echo
verdict
