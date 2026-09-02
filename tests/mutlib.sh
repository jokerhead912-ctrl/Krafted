#!/bin/zsh
# mutlib.sh — shared helpers for the Krafted mutate_*.sh scripts.
#
# Kept in ONE place on purpose. The run/mutate pair is already copied across
# every mutate_v7*.sh (historical, and rewriting all eight at once is a
# separate job); anything NEW goes here so the next copy is not a ninth.
# 病根一：一个行为 N 份手写副本 —— 每一份都会各自漂移。
#
# Sourced *after* the script has defined run()/mutate() and set NOTCAUGHT.
# Requires run() to branch on $EQUIV (see mutate_v7044.sh).

# An EQUIVALENT mutant is one that provably cannot be caught: the behaviour it
# removes is already produced by something else, so deleting it changes nothing
# observable. It is not a hole in the suite — it is a redundant line.
#
# Do not use this to silence a mutation you could not be bothered to catch.
# The claim must be EXECUTED, not argued: run both builds over a matrix of
# inputs and diff the answers. Two mutants in this suite were annotated this
# way on 2026-09-02 (planTrimMark's NaN guard, applyShortWriteCheck's
# unknown-size guard), each after a probe that ran ~90 cases through both
# builds and got identical output.
#
# `STALE EQUIV` is the ratchet: the moment the redundancy goes away (someone
# deletes the other guard), the suite catches it and this annotation fails
# loudly instead of quietly lying forever.
mutate_equivalent() { # mutate_equivalent(label, python_old, python_new)
  EQUIV=1
  mutate "$1" "$2" "$3"
  EQUIV=0
}

# ── VERDICT ─────────────────────────────────────────────────────────────
# judge <label> <captured output>  -> prints one verdict line, sets JUDGED to
#   caught | fragile | notcaught | unproven
#
# WHY "FRAGILE" EXISTS (2026-09-02). Every suite prints its tally at the very
# BOTTOM of the file. So a mutation that makes a bare top-level call throw
# kills the module before that line is reached — even when five `FAIL:` lines
# were already printed above it. The old detector only looked for the tally,
# so it scored those as "not caught" and they went unreported for a release.
# The evidence was on the screen the whole time; the detector was blind to it.
#
# So: a printed per-failure line is itself proof, and the missing summary is
# reported as a SEPARATE defect (the suite cannot survive its own failure)
# rather than being allowed to swallow the evidence.
#
# The two spellings below are both real: most suites print '  FAIL: ', the
# v7038 family prints '  FAIL  '.
judge() { # judge(label, captured_output)
  local label="$1" out="$2" n
  # (0) The mutated file does not even PARSE. That is not a behaviour change,
  #     it is a typo in the mutation — nothing ran, so nothing was asked.
  #     Found 2026-09-02 in mutate_v7043.sh: `.catch(...)` was replaced with a
  #     bare `)`, leaving a dangling paren. It had been scored as a suite hole
  #     for a release. A mutation that cannot be executed is a broken mutation.
  if print -r -- "$out" | grep -qE "^SyntaxError: "; then
    print "  ILLEGAL MUTATION  <- $label"
    print "        the mutated source does not parse, so nothing ran and nothing was"
    print "        proven. This is a typo in the mutation, not a hole in the suite."
    print -r -- "$out" | grep -E "^SyntaxError: " | head -1 | sed 's/^/                /'
    JUDGED=illegal
    return
  fi
  # (1) The suite reached its own tally and it is non-zero: a clean catch.
  #     This is the ORIGINAL test, kept first so the new path below can only
  #     ever widen the verdict, never turn an old "caught" into a new hole.
  if print -r -- "$out" | grep -qE "FAILURES: [1-9]|[0-9]*[1-9][0-9]* (failed|FAILED)"; then
    print "  caught      $(print -r -- "$out" | grep -oE "FAILURES: [0-9]+|[0-9]+ (failed|FAILED)" | head -1)  <- $label"
    JUDGED=caught
    return
  fi
  # (2) Failures were printed but the tally never came: the suite died on the
  #     way. Real evidence, fragile suite.
  if print -r -- "$out" | grep -qE "^  FAIL[: ]"; then
    n=$(print -r -- "$out" | grep -cE "^  FAIL[: ]" 2>/dev/null || true)
    print "  caught ($n) but FRAGILE  <- $label"
    print "        failures were printed and then the suite died before its summary."
    print "        The evidence is real, so this counts as caught — but the suite does"
    print "        not survive its own failure. Guard the top-level call that threw."
    JUDGED=fragile
    return
  fi
  if print -r -- "$out" | grep -qE "ALL PASS"; then
    print "  NOT CAUGHT  <- $label"
    JUDGED=notcaught
    return
  fi
  print "  UNPROVEN    <- $label"
  print -r -- "$out" | tail -4 | sed 's/^/                /'
  JUDGED=unproven
}

# The EQUIVALENT branch. An annotated-equivalent mutation that the suite
# catches is STALE: the redundancy it relied on is gone, so the line became
# load-bearing. That is a hole — the annotation is now a lie.
judge_equiv() { # judge_equiv(label, captured_output)
  if print -r -- "$2" | grep -qE "^  FAIL[: ]"; then
    print "  STALE EQUIV <- $1"
    print "        annotated EQUIVALENT but the suite caught it — the guard became"
    print "        load-bearing. Convert this back to mutate()."
    JUDGED=equiv_stale
  else
    print "  equivalent  <- $1"
    JUDGED=equivalent
  fi
}

# Verdict -> counters. Call this right after judge()/judge_equiv().
#   caught, equivalent -> not a hole
#   fragile            -> not a hole, but flagged: the suite died mid-file
#   everything else    -> a hole
tally_judged() {
  case "$JUDGED" in
    caught)     CAUGHT=$((CAUGHT + 1)) ;;
    equivalent) CAUGHT=$((CAUGHT + 1)) ;;
    fragile)    CAUGHT=$((CAUGHT + 1)); FRAGILE=$((FRAGILE + 1)) ;;
    *)          NOTCAUGHT=$((NOTCAUGHT + 1)) ;;
  esac
}
