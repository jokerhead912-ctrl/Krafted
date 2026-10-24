#!/bin/zsh
# Mutation check for test_v7_29_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
# v7.29.0 group A promises:
#   1. dropOriginalLink revokes AND deletes, and is the only way out;
#   2. re-linking a card does not orphan the previous URL;
#   3. a real delete releases the link, a restore does NOT (Ctrl+Z guard);
#   4. _dropFiles remembers video only;
#   5. _dropFiles is bounded, and a re-drop refreshes the entry;
#   6. a remembered file must agree on size, or we ask;
#   7. the import records the original's size.
# If any mutation below survives, the suite is decoration.
#
# zsh note: `$` inside these double-quoted anchors is written `\$` and a
# backtick is written \` so the shell hands the literal text to Python.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7290
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_29_0.js 2>&1)
  judge "$1" "$out"
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7290/mut.html'
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

# ── group A: dropping a link ──────────────────────────────────────────────
mutate "A1 the URL is never revoked (the bytes stay pinned)" \
  "  if (link.url) URL.revokeObjectURL(link.url);" \
  "  ;"

mutate "A2 the entry is never deleted (the registry grows forever)" \
  "  proxyOriginals.delete(itemId);" \
  "  ;"

mutate "A3 dropOriginalLink is a no-op" \
  "  const link = proxyOriginals.get(itemId);
  if (!link) return false;" \
  "  const link = null;
  if (!link) return false;"

mutate "A4 re-linking orphans the previous URL" \
  "  dropOriginalLink(item.id);" \
  "  ;"

# ── group B: the delete / restore split ───────────────────────────────────
mutate "B1 a restore drops the link too (Delete -> Ctrl+Z loses the original)" \
  "  if (revokeBlob && item) dropOriginalLink(item.id);" \
  "  if (item) dropOriginalLink(item.id);"

mutate "B2 a real delete keeps the link (leak)" \
  "  if (revokeBlob && item) dropOriginalLink(item.id);" \
  "  ;"

# ── group C: _dropFiles hygiene ───────────────────────────────────────────
mutate "C1 every dropped file is remembered, not just video" \
  "    if (!(f.type && f.type.indexOf('video/') === 0)) return;" \
  "    ;"

mutate "C2 the registry is unbounded" \
  "    while (_dropFiles.size > _DROP_FILES_MAX) {" \
  "    while (false) {"

# v7.30.0: the pool is keyed by dropKeyOf now, so the anchor says `key`.
mutate "C3 a re-drop does not refresh the entry (the newest is evicted first)" \
  "    if (_dropFiles.has(key)) _dropFiles.delete(key);" \
  "    ;"

# ── group D: identity ─────────────────────────────────────────────────────
# v7.30.0: the rule moved into originalFileFor() and the `want &&` guard is
# now a separate line, so the size test on its own is the anchor.
mutate "D1 the size is ignored — any file with the same name will do" \
  "  return (remembered.size === want) ? remembered : null;" \
  "  return remembered;"

mutate "D2 the original's size is never recorded, so nothing can ever match" \
  "      if (_of && typeof _of.size === 'number') newItem.originalSize = _of.size;" \
  "      ;"

# ── group E: v7.29.1 — one lookup, a pool big enough for one board ────────
# v7.30.0: there are TWO `const already = rememberedOriginalFor(item);` lines
# now (the batch planner and the single-card linker). Anchor the one inside
# linkOriginalForItem by taking its function head with it, or the count is 2
# and this silently becomes a SKIP -- which is a pass, not a catch.
mutate "E1 the linker hand-rolls the lookup instead of calling the helper" \
  "  if (!item || !item.isProxy) return Promise.resolve(false);
  const already = rememberedOriginalFor(item);" \
  "  if (!item || !item.isProxy) return Promise.resolve(false);
  const already = _dropFiles.get(String(item.originalName || '').trim());"

mutate "E2 the pool shrinks back to 200 (one board's worth does not fit)" \
  "const _DROP_FILES_MAX = 600;" \
  "const _DROP_FILES_MAX = 200;"

mutate "E3 a re-drop keeps the OLD file (the one just dropped is ignored)" \
  "    if (_dropFiles.has(key)) _dropFiles.delete(key);" \
  "    if (_dropFiles.has(key)) return;"

# ── group F: v7.30.0 — the path travels with the card ─────────────────────
mutate "F1 the card forgets where its original came from" \
  "      newItem.originalPath = _pp.originalPath || '';" \
  "      newItem.originalPath = '';"

mutate "F2 the import looks the pool up by the bare name again" \
  "      const _of = _dropFiles.get(newItem.originalPath || newItem.originalName);" \
  "      const _of = _dropFiles.get(newItem.originalName);"

cp kraftpub-dev.html $TMP/mut.html
print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
