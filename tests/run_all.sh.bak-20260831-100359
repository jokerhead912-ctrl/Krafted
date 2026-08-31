#!/bin/zsh
# Run every Krafted suite and every mutation script in one pass, then report
# the health of the whole net.
#
# WHY THIS EXISTS
#   A mutation anchor can be killed by ANY source change, not just a version
#   bump. mutate_v7041.sh lost six of its eighteen anchors when v7.0.44 folded
#   the two hand-written trim-marker implementations into one shared applier -
#   nobody noticed for months, because nobody re-ran it. Six mutations were
#   reporting nothing while the script still printed a reassuring tail.
#
#   So: one command, every script, no way to forget one.
#
# USAGE
#   zsh Krafted/tests/run_all.sh            # everything
#   zsh Krafted/tests/run_all.sh --suites   # suites only (fast)
#   zsh Krafted/tests/run_all.sh --muts     # mutation scripts only (slow)
#
# EXIT CODE
#   0  every suite passed, every mutation was caught with no skips, every
#      version anchor is current, and every memory file is inside budget
#   1  something failed, was not caught, was skipped, went stale, or grew too
#      big to be injected whole

set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3

ONLY=${1:-all}

PASS=0
FAIL=0
FAILED_SUITES=""
MUT_OK=0
MUT_BAD=0
BAD_MUTS=""
TOTAL_SKIPS=0
TOTAL_NOTCAUGHT=0

# ── suites ────────────────────────────────────────────────────────────────
if [ "$ONLY" = "all" ] || [ "$ONLY" = "--suites" ]; then
  print "── SUITES ────────────────────────────────────────────"
  for f in Krafted/tests/test_v7*.js; do
    out=$($NODE "$f" 2>&1)
    rc=$?
    # NOTE: -E with a bare | . In this shell `\|` is NOT alternation.
    if [ $rc -eq 0 ] && print -r -- "$out" | grep -qE "0 failed|ALL PASS"; then
      print "   pass   $(basename $f)   $(print -r -- "$out" | grep -oE '[0-9]+ (passed|assertions)' | head -1)"
      PASS=$((PASS + 1))
    else
      print "   FAIL   $(basename $f)"
      print -r -- "$out" | grep -iE "fail|expect" | head -5 | sed 's/^/           /'
      FAIL=$((FAIL + 1))
      FAILED_SUITES="$FAILED_SUITES $(basename $f)"
    fi
  done
  print ""
fi

# ── mutation scripts ──────────────────────────────────────────────────────
if [ "$ONLY" = "all" ] || [ "$ONLY" = "--muts" ]; then
  print "── MUTATIONS ─────────────────────────────────────────"
  for f in Krafted/tests/mutate_v7*.sh; do
    out=$(zsh "$f" 2>&1)
    skips=$(print -r -- "$out" | grep -c "SKIPPED")
    notcaught=$(print -r -- "$out" | grep -c "NOT CAUGHT")
    TOTAL_SKIPS=$((TOTAL_SKIPS + skips))
    TOTAL_NOTCAUGHT=$((TOTAL_NOTCAUGHT + notcaught))
    if [ "$skips" -eq 0 ] && [ "$notcaught" -eq 0 ]; then
      print "   caught all   $(basename $f)"
      MUT_OK=$((MUT_OK + 1))
    else
      print "   PROBLEM      $(basename $f)   skipped=$skips  not-caught=$notcaught"
      print -r -- "$out" | grep -E "SKIPPED|NOT CAUGHT" | head -12 | sed 's/^/           /'
      MUT_BAD=$((MUT_BAD + 1))
      BAD_MUTS="$BAD_MUTS $(basename $f)"
    fi
  done
  print ""
fi

# ── version anchors ───────────────────────────────────────────────────────
if [ "$ONLY" = "all" ] || [ "$ONLY" = "--suites" ]; then
  print "── VERSION ANCHORS ───────────────────────────────────"
  $PY Krafted/tests/version_scan.py
  VRC=$?
  print ""
fi

# ── memory budgets ────────────────────────────────────────────────────────
# WHY: MEMORY.md 係唯一会自动注入嘅记忆档。佢一胀大，注入嘅就会变成一份旧快照
# （或者被截断）—— 无论边个，结果都係**当下嘅规则冇入到 context**，而且系静默嘅：
# 冇报错、冇警告，净係个 agent 唔知嗰啲规则存在。2026-08-31 发现 MEMORY.md 已经
# 174 行，而注入嗰份仲停喺 .41 嗰代。
# 所以预算要写喺呢支会跑嘅脚本度，唔好写喺一份会胀大嘅记忆档度 —— 同一条教训
# as `\|`。
if [ "$ONLY" = "all" ] || [ "$ONLY" = "--suites" ]; then
  print "── MEMORY BUDGETS ────────────────────────────────────"
  # --snapshot: memory/ 住喺工作区层，唔喺 Krafted/ 嘅 git repo 入面 —— 冇版本控制。
  # 备份一只 1.9MB 嘅 html 好自然，备份 2.8KB 嘅记忆档好易唔记得，所以摆落脚本。
  $PY Krafted/tests/memory_guard.py --snapshot
  MRC=$?
  print ""
fi

print "══════════════════════════════════════════════════════"
print "suites      $PASS passed, $FAIL failed"
print "mutations   $MUT_OK clean, $MUT_BAD with problems"
print "            $TOTAL_SKIPS skipped anchor(s), $TOTAL_NOTCAUGHT not caught"

if [ "$FAIL" -eq 0 ] && [ "$MUT_BAD" -eq 0 ] && [ "${VRC:-0}" -eq 0 ] \
   && [ "${MRC:-0}" -eq 0 ]; then
  print ""
  print "ALL GREEN"
  exit 0
fi
print ""
print "NOT GREEN — see above"
exit 1
