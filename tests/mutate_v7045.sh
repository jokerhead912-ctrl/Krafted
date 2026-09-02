#!/bin/zsh
# Mutation check for test_v7045.js — deliberately break the source, confirm the
# suite goes red, restore. A suite that cannot fail is not a suite.
#
#   "Sometimes when I save it's unstable and it writes a 0 KB file. First get
#    rid of that. Then, if a save really does fail, make it raise an alarm and
#    ask me — otherwise I have no idea the file is already destroyed."
#
# The failure this is guarding against was never a wrong byte, it was a wrong
# MESSAGE: a destroyed file reported as "Saved ✔". So most of these mutations
# do not corrupt data, they restore the silence — a swallowed throw, an
# ungated success toast, a warning that fades in two seconds. If any of them
# can come back without the suite going red, the silence can too.
#
# NOTE: never run against the dev file; we always mutate a throwaway copy.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate45
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html
cp Krafted/docs/sw.js $TMP/sw.js

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html KRAFTED_SW=$TMP/sw.js $NODE Krafted/tests/test_v7045.js 2>&1 | tail -3 | tr '\n' ' ')
  if echo "$out" | grep -q "0 failed"; then
    print "  NOT CAUGHT  <- $1"
    NOTCAUGHT=$((NOTCAUGHT + 1))
  else
    print "  caught      <- $1"
  fi
}

mutate() { # mutate(label, python_old, python_new)
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" <<'PY'
import sys
old, new = sys.argv[1], sys.argv[2]
p = '/tmp/krafted-mutate45/mut.html'
s = open(p, encoding='utf-8').read()
n = s.count(old)
if n != 1:
    print('    !! anchor matched %d times' % n); sys.exit(2)
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
  if [ $? -ne 0 ]; then print "  SKIPPED (anchor)  <- $1"; ANCHORFAIL=$((ANCHORFAIL + 1)); return; fi
  run "$1"
}

NOTCAUGHT=0
ANCHORFAIL=0
print "mutation check: v7.0.46 suite (a 0 KB save can no longer report success)"

# ── THE REPORTED BUG, reintroduced five different ways ──────────────────

mutate "THE BUG: 0 bytes is accepted as a successful save" \
  "  if (size === 0) { v.reason = 'the file was written with 0 bytes — nothing was saved'; return v; }" \
  "  if (size === 0) { v.ok = true; v.reason = ''; return v; }"

# The exact historical shape: readKpakV6Index ALWAYS throws on a 0-byte file
# (no footer to find), the old code caught it, logged it, and carried on.
mutate "THE ORIGINAL SILENCE: the read-back throw is swallowed again" \
  "  } catch (e) {
    v.reason = (e && e.message) ? e.message : 'the file could not be read back after writing';
    return v;
  }" \
  "  } catch (e) {
    v.ok = true; v.reason = '';
    return v;
  }"

mutate "the truncation floor is gone (a 10-byte file parses)" \
  "  if (size < KPAK_MIN_BYTES) { v.reason = 'only ' + size + ' bytes were written — the file is truncated'; return v; }" \
  "  if (false) { v.reason = 'truncated'; return v; }"

mutate "KPAK_MIN_BYTES lowered to zero" \
  "const KPAK_MIN_BYTES = 64;" \
  "const KPAK_MIN_BYTES = 0;"

# Footer intact, index intact, media bytes missing. Every byte present is
# correct — nothing but the out-of-bounds check can see it. This is what a
# save that ran out of disk actually looks like.
mutate "the out-of-bounds check is gone" \
  "    if (!(e.size > 0) || e.offset < 0 || (e.offset + e.size) > size) bad++;" \
  "    if (false) bad++;"

mutate "out-of-bounds entries are counted but waved through" \
  "  if (bad > 0) { v.reason = bad + ' of ' + entries.length + ' files point outside the file'; return v; }" \
  "  if (false) { v.reason = bad + ' of ' + entries.length + ' files point outside the file'; return v; }"

# ── the short-write check ───────────────────────────────────────────────
# Two thresholds on purpose: the absolute one stops accounting drift from
# alarming, the 1% one stops a genuinely short write on a tiny board from
# being waved through. Dropping either one breaks it in a different way.

mutate "the short-write check never fires" \
  "  if (shortBy > 65536 && shortBy > expectedBytes * 0.01) {" \
  "  if (false) {"

mutate "every byte of drift alarms (thresholds dropped)" \
  "  if (shortBy > 65536 && shortBy > expectedBytes * 0.01) {" \
  "  if (shortBy > 0) {"

mutate "the absolute floor is dropped — 1 MB missing from 1 GB alarms" \
  "  if (shortBy > 65536 && shortBy > expectedBytes * 0.01) {" \
  "  if (shortBy > expectedBytes * 0.01) {"

mutate "the 1% floor is dropped — 200 bytes of drift on 1 MB alarms" \
  "  if (shortBy > 65536 && shortBy > expectedBytes * 0.01) {" \
  "  if (shortBy > 65536) {"

mutate "an unknown expected size alarms anyway" \
  "  if (!v || !v.ok || !(expectedBytes > 0)) return v;" \
  "  if (!v || !v.ok) return v;"

mutate "_finishSave stops applying the short-write check" \
  "  const v = applyShortWriteCheck(o.verdict, o.expectedBytes);" \
  "  const v = o.verdict;"

# ── success is gated on the verdict ─────────────────────────────────────

mutate "success is reported whatever the verdict says" \
  "  if (!v || !v.ok) {" \
  "  if (false) {"

mutate "_finishSave reports success even on failure" \
  "    });
    return false;
  }" \
  "    });
    return true;
  }"

mutate "missing media is saved silently" \
  "  if (missing.length > 0) {" \
  "  if (false) {"

mutate "the damage to the chosen destination is never mentioned" \
  "  if (o.destWarning) problems.push(escapeHtml(o.destWarning));" \
  "  /* destWarning dropped */"

mutate "a save with problems gets the plain success toast again" \
  "  if (problems.length > 0) {" \
  "  if (false) {"

mutate "the emergency manifest backup is gone" \
  "  if (o.manifestJson) { try { await _writeEmergencyBackup(o.manifestJson); } catch (e) {} }" \
  "  /* no backup */"

# ── the alarm has to be actionable, not just loud ───────────────────────
# An alarm that says "save failed" without numbers is not actionable: the
# user cannot check a file they have not been told is broken.

mutate "the alarm stops saying how big the file used to be" \
  "  if (o.prevBytes > 0) {" \
  "  if (false) {"

mutate "the alarm stops saying how many bytes landed" \
  "  facts += '<div class=\"krafted-save-alarm-row\"><span>' + (zh ? '\u5be6\u969b\u5beb\u4e86' : 'Bytes written') + '</span><b>' + wrote + '</b></div>';" \
  "  /* bytes written dropped */"

mutate "the alarm stops giving a reason" \
  "  facts += '<div class=\"krafted-save-alarm-row\"><span>' + (zh ? '\u539f\u56e0' : 'Reason') + '</span><b>' + escapeHtml(o.reason || 'unknown') + '</b></div>';" \
  "  /* reason dropped */"

mutate "the headline stops saying the file cannot be trusted" \
  "'SAVE FAILED \u2014 DO NOT TRUST THIS FILE'" \
  "'SAVE FAILED'"

mutate "the recovery action disappears" \
  "  actions.appendChild(btnCopy);" \
  "  /* no recovery */"

mutate "the recovery action stops being the primary button" \
  "  btnCopy.className = 'primary';" \
  "  btnCopy.className = '';"

mutate "the last verified copy is never offered" \
  "  if (_lastGoodSaveBlob && _lastGoodSaveBlob.blob && _lastGoodSaveBlob.blob.size > 0) {" \
  "  if (false) {"

# The banner outlives the modal — that is the whole point of having one.
mutate "the alarm leaves nothing behind once dismissed" \
  "  _showSaveBanner('fatal',
    (zh ? '<b>\u4fdd\u5b58\u5931\u6557</b> \u2014\u2014 ' : '<b>SAVE FAILED</b> \u2014 ') +
    escapeHtml(o.fname || '') + ' ' + (zh ? '\u5beb\u4e86 ' : 'wrote ') + wrote +
    (zh ? '\uff0c\u6a94\u6848\u5df2\u7d93\u640d\u6bc0\u3002' : ', and the file is damaged.') +
    ' ' + escapeHtml(o.reason || ''));" \
  "  /* no banner */"

mutate "a fatal save is downgraded to a warning" \
  "  _showSaveBanner('fatal'," \
  "  _showSaveBanner('warn',"

mutate "the Chinese alarm is a stub" \
  "'\u4fdd\u5b58\u5931\u6557 \u2014\u2014 \u5440\u597d\u4fe1\u5462\u500b\u6a94\u6848'" \
  "'\u5931\u6557'"

# ── persistence lives in the stylesheet ─────────────────────────────────
# A warning the user can scroll past is not an alarm.

mutate "the banner is not pinned across the top" \
  "  position: fixed; top: 0; left: 0; right: 0; z-index: 999999998;" \
  "  position: relative; z-index: 999999998;"

mutate "the banner sits below the board UI" \
  "  position: fixed; top: 0; left: 0; right: 0; z-index: 999999998;" \
  "  position: fixed; top: 0; left: 0; right: 0; z-index: 1;"

mutate "a failed save is amber, not red" \
  ".krafted-save-banner.is-fatal { background: #b3261e; }" \
  ".krafted-save-banner.is-fatal { background: #8a6100; }"

mutate "the banner animates itself away" \
  "  position: fixed; top: 0; left: 0; right: 0; z-index: 999999998;" \
  "  position: fixed; top: 0; left: 0; right: 0; z-index: 999999998; animation: kfade 3s forwards;"

mutate "the alarm can hide behind the banner" \
  "  position: fixed; inset: 0; z-index: 1000000000;" \
  "  position: fixed; inset: 0; z-index: 1;"

# ── the write paths ─────────────────────────────────────────────────────

mutate "the swallowed verify is back on the stream path" \
  "        const verdict = await verifyKpakOutput(writtenFile);" \
  "        let verdict = { ok: true, reason: '', size: 0, entries: 0, bad: 0 };
        try { verdict = await verifyKpakOutput(writtenFile); } catch (e) { console.error('[SAVE V6] stream verify threw:', e.message); }"

mutate "the blob path reads the index itself and ignores the answer" \
  "      const verdict = await verifyKpakOutput(blob);" \
  "      const verdict = { ok: true, reason: '', size: blob.size, entries: 1, bad: 0 };"

mutate "the stream path stops reporting through _finishSave" \
  "        const streamGood = await _finishSave({" \
  "        const streamGood = true; if (false) await _finishSave({"

mutate "saveBoardV6 prints the success toast itself again" \
  "      const verdict = await verifyKpakOutput(blob);" \
  "      const verdict = await verifyKpakOutput(blob);
      toast('Saved \u2714 ' + fname);"

mutate "the download is no longer gated on the verdict" \
  "      if (good) {" \
  "      if (true) {"

mutate "the refusal to ship an unverified file goes silent" \
  "        console.error('[SAVE V6] refusing to download a package that did not verify:', formatBytes(blob.size));" \
  "        /* silent */"

# Without the pre-overwrite size the alarm can name what replaced the file
# but not what was lost, and a 239 MB board reads as "0 bytes" with no scale.
mutate "the pre-overwrite size is never recorded" \
  "        try { prevBytes = (await saveHandle.getFile()).size || 0; } catch (e) {}" \
  "        /* prevBytes not recorded */"

# Two places drop the quick-save handle: when the stream throws, and when the
# file it wrote fails verification. Either one left behind aims the next
# Ctrl+S at the file that was just damaged.
mutate "a failed verify leaves the handle aiming at the damaged file" \
  "        if (!streamGood) {
          // The destination is committed and broken. Drop the quick-save handle
          // so the next Ctrl+S asks where to go instead of silently aiming at
          // the file we just damaged.
          state._saveHandle = null;
        }" \
  "        if (!streamGood) {
          /* handle kept */
        }"

mutate "a thrown stream leaves the handle aiming at the damaged file" \
  "        console.warn('[SAVE V6] stream failed, falling back to blob:', e.name, e.message);
        state._saveHandle = null;" \
  "        console.warn('[SAVE V6] stream failed, falling back to blob:', e.name, e.message);"

mutate "a thrown save only toasts for two seconds again" \
  "    _showSaveAlarm({
      fname: fname,
      bytes: 0,
      prevBytes: 0," \
  "    toast('Save failed: ' + (err.message || 'unknown')); if (false) _showSaveAlarm({
      fname: fname,
      bytes: 0,
      prevBytes: 0,"

# ── the download race ───────────────────────────────────────────────────
# The browser drains a blob lazily while it writes the file, so revoking the
# URL on a fixed timer truncates anything the disk had not absorbed yet.
# That is the same 0 KB symptom, arriving from the other direction.

mutate "triggerDownload revokes after one second again" \
  "  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 60000);" \
  "  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);"

mutate "downloadBlob revokes on a 5-second timer again" \
  "      _releaseLastSaveObjectUrl();
      _lastSaveObjectUrl = url;
      resolve(true);" \
  "      setTimeout(() => URL.revokeObjectURL(url), 5000);
      resolve(true);"

# ── one engine, not two ─────────────────────────────────────────────────
# saveBoardV5 used to be a complete second save engine: its own builder, its
# own write, its own download, and a "Saved ✔" toast that verified nothing.
# Nothing called it, but it was exported, so anything reaching in from
# outside got the one path that could still write a broken file and call it
# saved.

mutate "the legacy V5 engine comes back" \
  "  window.saveBoardV5 = async function() {
    return saveBoardV6({ forceNew: true });
  };" \
  "  window.saveBoardV5 = async function() {
    try { await KF.Writer.buildKpak(); } catch (e) {}
    toast('Saved \u2714 legacy');
    return true;
  };"

# ── version ─────────────────────────────────────────────────────────────
# Left at the previous version this anchor matches 0 times and the mutation
# stops testing anything, which is worse than no mutation at all.
mutate "KRAFTED_VERSION not bumped" \
  "var KRAFTED_VERSION = '7.4.0';" \
  "var KRAFTED_VERSION = '7.3.0';"

# ── done ────────────────────────────────────────────────────────────────
cp kraftpub-dev.html $TMP/mut.html
print ""
if [ $NOTCAUGHT -eq 0 ]; then
  print "ALL MUTATIONS CAUGHT"
else
  print "$NOTCAUGHT MUTATION(S) NOT CAUGHT"
fi
if [ $ANCHORFAIL -ne 0 ]; then
  print "$ANCHORFAIL ANCHOR(S) FAILED TO MATCH - fix the script"
fi
print ""
print "restore: re-running the suite against the untouched dev file"
$NODE Krafted/tests/test_v7045.js 2>&1 | tail -2
