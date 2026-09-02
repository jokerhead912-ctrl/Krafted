#!/bin/zsh
# Negative control for the judge() in mutlib.sh. Four canned outputs, four
# expected verdicts. A detector that has never gone red is not a detector, so
# every branch here has to be shown to reach its own answer.
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
. Krafted/tests/mutlib.sh
NOTCAUGHT=0; ANCHORFAIL=0; CAUGHT=0; FRAGILE=0; EQUIV=0

FAILS=0
expect() { # expect(want, got, label)
  if [ "$1" = "$2" ]; then
    print "  ok    $3 -> $2"
  else
    print "  FAIL  $3 -> got $2, want $1"
    FAILS=$((FAILS + 1))
  fi
}

print "judge() negative control"

# 1. the mutated file does not parse -> ILLEGAL, not a suite hole
judge "unparseable" "undefined:87
        );
        ^

SyntaxError: Unexpected token ')'
    at new Function (<anonymous>)" > /dev/null
expect illegal "$JUDGED" "SyntaxError in the mutated source"

# 2. failures printed, summary never reached -> FRAGILE
judge "died mid-file" "Krafted v7.7.0
  FAIL: a manual tape holds on the last shot  (got null, want 2)
  FAIL: and it schedules nothing  (got 1, want 0)
TypeError: Cannot read properties of null" > /dev/null
expect fragile "$JUDGED" "failures printed and then the suite died"

# 3. a clean non-zero tally -> caught
judge "clean red" "Krafted v7.7.0
  FAIL: the chip is not marked tinted

1 FAILED, 200 passed" > /dev/null
expect caught "$JUDGED" "reached its tally and it was non-zero"

# 4. ALL PASS -> not caught
judge "green" "Krafted v7.7.0

ALL PASS (200 assertions)" > /dev/null
expect notcaught "$JUDGED" "the suite stayed green"

# 5. nothing at all -> unproven
judge "void" "" > /dev/null
expect unproven "$JUDGED" "no output whatsoever"

print ""
if [ $FAILS -eq 0 ]; then
  print "JUDGE CONTROL: ALL 5 BRANCHES REACH THEIR OWN VERDICT"
  exit 0
fi
print "JUDGE CONTROL: $FAILS BRANCH(E) WRONG"
exit 1
