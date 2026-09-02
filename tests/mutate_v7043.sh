#!/bin/zsh
# Mutation check for test_v7043.js — deliberately break the source, confirm the
# suite goes red, restore. A suite that cannot fail is not a suite.
#
# This one matters more than most: every broken version of Restore passed a
# visual smoke test. The empty shells looked like a board. If these assertions
# do not go red when the mechanism is removed, they are decoration.
#
# NOTE: never run against the dev file; we always mutate a throwaway copy.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate43
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html
cp Krafted/docs/sw.js $TMP/sw.js

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html KRAFTED_SW=$TMP/sw.js $NODE Krafted/tests/test_v7043.js 2>&1)
  # The verdict is judged in mutlib.sh, one copy for every script here. The
  # detector used to live inline in each of them, and it was blind: it only
  # looked for the suite's bottom-of-file tally, so a mutation that killed the
  # suite mid-file scored as "not caught" no matter how many `FAIL:` lines had
  # already been printed above it. That hid 12 real catches for a release.
  # See judge() in mutlib.sh — it accepts printed failures as evidence and
  # reports the missing summary separately as FRAGILE.
  if [ "$EQUIV" -eq 1 ]; then judge_equiv "$1" "$out"; else judge "$1" "$out"; fi
  tally_judged
}

mutate() { # mutate(label, python_old, python_new)
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" <<'PY'
import sys
old, new = sys.argv[1], sys.argv[2]
p = '/tmp/krafted-mutate43/mut.html'
s = open(p, encoding='utf-8').read()
n = s.count(old)
if n != 1:
    print('    !! anchor matched %d times' % n); sys.exit(2)
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
  if [ $? -ne 0 ]; then print "  SKIPPED (anchor)  <- $1"; ANCHORFAIL=$((ANCHORFAIL + 1)); return; fi
  run "$1"
}

# judge()/judge_equiv()/tally_judged() live in mutlib.sh — one copy, not
# one per script. 病根一：一个行为 N 份手写副本，每份都会各自漂移。
. Krafted/tests/mutlib.sh
NOTCAUGHT=0
ANCHORFAIL=0
CAUGHT=0
FRAGILE=0
EQUIV=0
print "mutation check: v7.0.43 suite (Restore / autosave media)"

# ── the original bug, reintroduced ────────────────────────────────────────

mutate "THE BUG: serializeBoard blanks src again" \
  "src: (i.src && i.src.indexOf('blob:') === 0) ? (AUTOSAVE_MEDIA_PREFIX + i.id) : (i.src || '')," \
  "src: (i.src && i.src.indexOf('blob:') === 0) ? '' : (i.src || ''),"

mutate "THE BUG: serializeBoard sets videoLost on blob media" \
  "      // v7.0.43: v5.5 used to clear d.src here and set videoLost/imageLost," \
  "      if (i.isVideo && i.src) { d.src = ''; d.videoLost = true; }
      // v7.0.43: v5.5 used to clear d.src here and set videoLost/imageLost,"

mutate "sentinel prefix changed, so nothing round-trips" \
  "const AUTOSAVE_MEDIA_PREFIX = 'autosave-media:';" \
  "const AUTOSAVE_MEDIA_PREFIX = 'am:';"

# ── the write path ────────────────────────────────────────────────────────

mutate "scheduleAutoSave never mirrors the bytes" \
  "      persistAutosaveMedia();" \
  "      /* persistAutosaveMedia(); */"

mutate "every autosave re-reads every blob (no _asMediaSavedFor guard)" \
  "    if (it._asMediaSavedFor === it.src) return Promise.resolve();" \
  "    /* guard removed */"

mutate "the mirror guard records even a failure" \
  "        return KS.saveMediaBlob(it.id, b).then(function() {
          it._asMediaSavedFor = it.src;
        });" \
  "        it._asMediaSavedFor = it.src;
        return KS.saveMediaBlob(it.id, b);"

mutate "oversize pre-flight removed (2GB clip read into RAM)" \
  "    if (it._fileSize && it._fileSize > AUTOSAVE_MAX_BLOB_BYTES) {" \
  "    if (false && it._fileSize && it._fileSize > AUTOSAVE_MAX_BLOB_BYTES) {"

mutate "garbage collection removed (deleted items leak their blobs)" \
  "    return KS.listMediaKeys().then(function(keys) {" \
  "    return Promise.resolve([]).then(function(keys) {"

mutate "media items include data: URLs (unnecessary IndexedDB traffic)" \
  "    return it && it.src && typeof it.src === 'string' && it.src.indexOf('blob:') === 0;" \
  "    return it && it.src && typeof it.src === 'string';"

mutate "blobs keyed by raw id instead of String(id)" \
  "        return KS.saveMediaBlob(it.id, b).then(function() {" \
  "        return KS.saveMediaBlob(Number(it.id), b).then(function() {"

# ── the read path ─────────────────────────────────────────────────────────

mutate "rehydrate skips ready() — the IndexedDB open race" \
  "  return KS.ready().then(function() {
    return Promise.all(items.map(function(d) {
      if (!d || typeof d.src !== 'string' || d.src.indexOf(AUTOSAVE_MEDIA_PREFIX) !== 0) {
        return Promise.resolve(false);
      }
      return KS.getMediaBlob(d.src.slice(AUTOSAVE_MEDIA_PREFIX.length))" \
  "  return Promise.resolve(null).then(function() {
    return Promise.all(items.map(function(d) {
      if (!d || typeof d.src !== 'string' || d.src.indexOf(AUTOSAVE_MEDIA_PREFIX) !== 0) {
        return Promise.resolve(false);
      }
      return KS.getMediaBlob(d.src.slice(AUTOSAVE_MEDIA_PREFIX.length))"

mutate "rehydrate leaves the sentinel in place instead of an object URL" \
  "          if (blob) { d.src = URL.createObjectURL(blob); return true; }" \
  "          if (blob) { return true; }"

mutate "lost media keeps its sentinel (broken element, not placeholder)" \
  "  d.src = '';
  if (d.isVideo || d.isAudio) { d.videoLost = true; } else { d.imageLost = true; }" \
  "  if (d.isVideo || d.isAudio) { d.videoLost = true; } else { d.imageLost = true; }"

mutate "lost video flagged imageLost (wrong placeholder branch)" \
  "  if (d.isVideo || d.isAudio) { d.videoLost = true; } else { d.imageLost = true; }" \
  "  d.imageLost = true;"

mutate "markAutosaveMediaLost applies to non-sentinel srcs too" \
  "  if (d.src.indexOf(AUTOSAVE_MEDIA_PREFIX) !== 0) return;" \
  "  /* scope check removed */"

# Rewritten 2026-09-02. The old replacement was a bare ")", which left a
# dangling paren and made the whole file unparseable. A mutation that cannot be
# executed proves nothing, and for a release the suite took the blame — it was
# reported as a hole. Dropping the catch IS the behaviour under test: the
# rejection propagates to the outer .catch, so one dead blob takes the entire
# rehydrate down instead of degrading shot by shot.
mutate "a failed blob read rejects instead of degrading" \
  "        })
        .catch(function() { markAutosaveMediaLost(d); return false; });" \
  "        });"

mutate "probe counts the sentinels instead of the hits" \
  "  }).then(function(hits) {
    var found = hits.filter(Boolean).length;
    return { sentinels: ids.length, found: found, lost: ids.length - found };
  }).catch(function() {
    return { sentinels: ids.length, found: 0, lost: ids.length };
  });" \
  "  }).then(function(hits) {
    var found = ids.length;
    return { sentinels: ids.length, found: found, lost: 0 };
  }).catch(function() {
    return { sentinels: ids.length, found: 0, lost: ids.length };
  });"

# ── the welcome-screen offer ──────────────────────────────────────────────

mutate "offerAutoSave offers the button even when nothing is recoverable" \
  "    if (p.sentinels > 0 && p.found === 0 && extra === 0) {" \
  "    if (false) {"

mutate "offerAutoSave counts items only (text-only boards discarded)" \
  "  const extra = (data.texts || []).length + (data.todos || []).length +
                (data.mindmaps || []).length;" \
  "  const extra = 0;"

mutate "offerAutoSave never probes" \
  "  probeAutosaveMedia(data).then(function(p) {" \
  "  Promise.resolve({ sentinels: 0, found: 0, lost: 0 }).then(function(p) {"

mutate "loadAutoSave leaves the autosave in place (offer returns forever)" \
  "    discardAutoSave();
    toast('Restored autosave · ' + n + ' item'" \
  "    /* discardAutoSave(); */
    toast('Restored autosave · ' + n + ' item'"

mutate "loadAutoSave restores before rehydrating" \
  "  rehydrateAutosaveMedia(data).then(function(res) {
    restoreBoard(data, false);" \
  "  Promise.resolve({ lost: 0 }).then(function(res) {
    restoreBoard(data, false);"

# ── the storage layer ─────────────────────────────────────────────────────

mutate "DB_VERSION not bumped — the media store is never created" \
  "  var DB_VERSION = 2;" \
  "  var DB_VERSION = 1;"

mutate "onupgradeneeded does not create the media store" \
  "        if (!d.objectStoreNames.contains(MEDIA_STORE_NAME)) {
          d.createObjectStore(MEDIA_STORE_NAME, { keyPath: 'key' });" \
  "        if (false) {
          d.createObjectStore(MEDIA_STORE_NAME, { keyPath: 'key' });"

mutate "listMediaKeys removed from the public API" \
  "    listMediaKeys: listMediaKeys," \
  "    /* listMediaKeys: listMediaKeys, */"

mutate "ready() removed from the public API" \
  "    ready: function() {
      return openDB().catch(function() { return null; });
    }" \
  "    /* ready removed */"

mutate "getMediaBlob exposed under the wrong name" \
  "    getMediaBlob: getMediaBlob," \
  "    /* getMediaBlob: getMediaBlob, */"

# ── restore control ───────────────────────────────────────────────────────
cp kraftpub-dev.html $TMP/mut.html
print ""
if [ $NOTCAUGHT -eq 0 ]; then
  print "ALL MUTATIONS CAUGHT"
else
  print "$NOTCAUGHT MUTATION(S) NOT CAUGHT"
fi
print ""
print "restore: re-running the suite against the untouched dev file"
$NODE Krafted/tests/test_v7043.js 2>&1 | tail -2

# ── machine-readable verdict ─────────────────────────────────────────────
# The one line run_all.sh reads, plus the exit code it gates on. Placed last
# on purpose: the restore run above has to happen first. A skipped anchor
# counts as BAD - a mutation that never ran proves nothing at all.
if [ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ]; then
  print "MUTVERDICT ok  holes=0 skipped=0 caught=$CAUGHT fragile=$FRAGILE"
  if [ $FRAGILE -gt 0 ]; then
    print ""
    print "  WARNING: $FRAGILE mutation(s) were caught only because the suite printed"
    print "  failures before dying. Every one of those is a top-level call that throws"
    print "  and takes the whole file with it. Guard them and this warning goes away."
  fi
  exit 0
fi
print "MUTVERDICT BAD holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit 1
