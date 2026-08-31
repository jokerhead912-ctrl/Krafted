#!/bin/zsh
# Mutation check for test_v7047.js — deliberately break the source, confirm the
# suite goes red, restore. A suite that cannot fail is not a suite.
#
#   "I talk and press next myself."
#
# Every mutation here restores a piece of the old annoyance: the 4.6-second
# clock, a tape that runs away from you, a clicker key that does nothing, a
# HUD you cannot see, a button that ends the tape you just started. If any of
# them can come back without the suite going red, the annoyance can too.
#
# Two mutations are deliberately NOT in here, because they are equivalent
# mutants — the source changes but no behaviour does, so the suite is right to
# stay green and including them would only teach it to cry wolf:
#   * presentScheduleNext's `if (!p || !p.auto) return;` -> `if (!p) return;`
#     (every caller already checks p.auto)
#   * the last-shot `if (i === p.index)` guard -> `if (false)`
#     (both branches land on the same index)
#   * presentGoTo's `clearTimeout` -> nothing
#     (every path that can schedule a timer also clears it, and auto-off
#      always leaves p.timer null, so there is never a stale timer to leave
#      behind — the clear is defensive, not live)
#
# NOTE: never run against the dev file; we always mutate a throwaway copy.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate47
mkdir -p $TMP
cp kraftpub-v6.8.0.html $TMP/mut.html
cp Krafted/docs/sw.js $TMP/sw.js

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html KRAFTED_SW=$TMP/sw.js $NODE Krafted/tests/test_v7047.js 2>&1 | tail -3 | tr '\n' ' ')
  if echo "$out" | grep -q "ALL PASS"; then
    print "  NOT CAUGHT  <- $1"
    NOTCAUGHT=$((NOTCAUGHT + 1))
  else
    print "  caught      <- $1"
  fi
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-v6.8.0.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PY'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate47/mut.html'
s = open(p, encoding='utf-8').read()
n = s.count(old)
if n != want:
    print('    !! anchor matched %d times, want %d' % (n, want)); sys.exit(2)
open(p, 'w', encoding='utf-8').write(s.replace(old, new))
PY
  if [ $? -ne 0 ]; then print "  SKIPPED (anchor)  <- $1"; ANCHORFAIL=$((ANCHORFAIL + 1)); return; fi
  run "$1"
}

# sw.js lives in a different file, so it needs its own path.
mutsw() { # mutsw(label, old, new)
  cp Krafted/docs/sw.js $TMP/sw.js
  $PY - "$2" "$3" <<'PY'
import sys
old, new = sys.argv[1], sys.argv[2]
p = '/tmp/krafted-mutate47/sw.js'
s = open(p, encoding='utf-8').read()
if s.count(old) != 1:
    print('    !! sw anchor matched %d times' % s.count(old)); sys.exit(2)
open(p, 'w', encoding='utf-8').write(s.replace(old, new))
PY
  if [ $? -ne 0 ]; then print "  SKIPPED (anchor)  <- $1"; ANCHORFAIL=$((ANCHORFAIL + 1)); return; fi
  run "$1"
}

NOTCAUGHT=0
ANCHORFAIL=0
print "mutation check: v7.0.50 suite (the tape waits for you)"

# ── THE DEFAULT ────────────────────────────────────────────────────────
# These four are the feature. If any survives, the tape runs away again.

mutate "auto-play becomes the default again" \
  "var PRESENT_AUTO_DEFAULT = false;" \
  "var PRESENT_AUTO_DEFAULT = true;"

mutate "the tape ignores the default and always starts in auto" \
  "auto: PRESENT_AUTO_DEFAULT };" \
  "auto: true };"

mutate "the auto flag is never stored on the tape" \
  "auto: PRESENT_AUTO_DEFAULT };" \
  "};"

mutate "presentAdvance schedules the clock again whatever the mode" \
  "  if (i < 0) i = 0;
  p.index = i;
  gotoView(i);
  renderPresentHud();
  if (p.auto) presentScheduleNext();" \
  "  if (i < 0) i = 0;
  p.index = i;
  gotoView(i);
  renderPresentHud();
  presentScheduleNext();"

mutate "presentScheduleNext never runs" \
  "  if (!p || !p.auto) return;" \
  "  return;"

mutate "the dwell is described as unconditional again" \
  "// auto-play only: how long a shot holds" \
  "// how long a shot holds before advancing"

# ── THE END OF THE TAPE ────────────────────────────────────────────────

mutate "a manual tape ends at the last shot again" \
  "    if (p.auto) {" \
  "    if (true) {"

mutate "an auto tape clamps instead of ending" \
  "    if (p.auto) {" \
  "    if (false) {"

mutate "the last shot stops the tape instead of holding it" \
  "    i = list.length - 1;" \
  "    stopPresent(); return;"

mutate "the end-of-tape message disappears" \
  "'End of presentation'" \
  "'Done'"

# ── JUMPING ────────────────────────────────────────────────────────────

mutate "jumping no longer clamps below the first shot" \
  "  if (i < 0) i = 0;
  if (i > list.length - 1) i = list.length - 1;" \
  "  if (i > list.length - 1) i = list.length - 1;"

mutate "jumping no longer clamps past the last shot" \
  "  if (i < 0) i = 0;
  if (i > list.length - 1) i = list.length - 1;" \
  "  if (i < 0) i = 0;"

mutate "jumping while auto is on does not restart the clock" \
  "  if (i > list.length - 1) i = list.length - 1;
  if (p.timer) { clearTimeout(p.timer); p.timer = null; }
  p.index = i;
  gotoView(i);
  renderPresentHud();
  if (p.auto) presentScheduleNext();" \
  "  if (i > list.length - 1) i = list.length - 1;
  if (p.timer) { clearTimeout(p.timer); p.timer = null; }
  p.index = i;
  gotoView(i);
  renderPresentHud();"

# ── THE KEYS ───────────────────────────────────────────────────────────

mutate "Page Down stops advancing (the presenter clicker dies)" \
  "k === 'PageDown' ||" \
  ""

mutate "Page Up stops stepping back" \
  "k === 'ArrowUp' || k === 'PageUp' ||" \
  "k === 'ArrowUp' ||"

mutate "Arrow Down stops advancing" \
  "k === 'ArrowDown' || k === 'PageDown' ||" \
  "k === 'PageDown' ||"

mutate "N stops advancing" \
  "k === 'n' || k === 'N') {" \
  "false) {"

mutate "P stops stepping back" \
  "k === 'p' || k === 'P') {" \
  "false) {"

mutate "A stops toggling auto-play" \
  "if (k === 'a' || k === 'A')" \
  "if (false)"

mutate "Home stops working" \
  "if (k === 'Home')" \
  "if (false)"

mutate "End stops working" \
  "if (k === 'End')" \
  "if (false)"

mutate "the number keys stop jumping" \
  "if (k.length === 1 && k >= '0' && k <= '9') {" \
  "if (false) {"

mutate "'0' means the first shot instead of the tenth" \
  "(k === '0' ? 10 : parseInt(k, 10)) - 1" \
  "(k === '0' ? 1 : parseInt(k, 10)) - 1"

# The bare `if (k === 'Escape')` appears twice in this file — a second
# handler spells it the same way for the same reason — so the anchor has to
# carry the body with it or it mutates the wrong one.
mutate "Escape stops ending the tape" \
  "if (k === 'Escape') { ev.preventDefault(); ev.stopPropagation(); stopPresent(); return; }" \
  "if (false) { ev.preventDefault(); ev.stopPropagation(); stopPresent(); return; }"

mutate "the tape swallows browser shortcuts again" \
  "    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;" \
  ""

mutate "the tape eats typing again" \
  "    const ae = document.activeElement;
    if (ae && (ae.contentEditable === 'true' || ae.tagName === 'INPUT' ||
               ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return;" \
  ""

mutate "the next key is no longer consumed" \
  "ev.preventDefault(); ev.stopPropagation(); presentAdvance(1); return;" \
  "presentAdvance(1); return;"

mutate "the previous key is no longer consumed" \
  "ev.preventDefault(); ev.stopPropagation(); presentAdvance(-1); return;" \
  "presentAdvance(-1); return;"

# ── THE HUD ────────────────────────────────────────────────────────────

mutate "the HUD never appears" \
  "  hud.classList.add('show');" \
  ""

mutate "the HUD never goes away" \
  "if (!p) { hud.classList.remove('show'); return; }" \
  "if (!p) { return; }"

mutate "the shot counter is off by one" \
  "ctEl.textContent = (p.index + 1) + ' / ' + list.length;" \
  "ctEl.textContent = (p.index + 2) + ' / ' + list.length;"

mutate "the HUD stops naming the shot" \
  "nmEl.textContent = (cur && cur.name) || ('Shot ' + (p.index + 1));" \
  "nmEl.textContent = 'Shot';"

mutate "the next-shot preview disappears" \
  "('Next: ' + ((nx && nx.name) || ('Shot ' + (p.index + 2))) + ' · Space to advance')" \
  "('Space to advance')"

mutate "the auto hint stops saying how to get control back" \
  "('Auto — ' + (PRESENT_DWELL_MS / 1000) + 's a shot · A to stop')" \
  "('Auto')"

mutate "the last-shot hint disappears" \
  "'Last shot · Esc to stop'" \
  "'End'"

mutate "the play button never becomes a pause button" \
  "playEl.textContent = p.auto ? '❚❚' : '▶';" \
  "playEl.textContent = '▶';"

mutate "the HUD builds markup out of a shot name" \
  "nmEl.textContent = (cur && cur.name) || ('Shot ' + (p.index + 1));" \
  "nmEl.innerHTML = (cur && cur.name) || ('Shot ' + (p.index + 1));"

mutate "the shot colour stops reaching the HUD" \
  "nmEl.style.color = viewColor(cur || {}) || '';" \
  "nmEl.style.color = '';"

# ── THE HUD MUST NOT END ITS OWN TAPE ──────────────────────────────────

mutate "clicking the HUD next button ends the tape" \
  "      if (hud && ev.target && hud.contains(ev.target)) return;" \
  ""

mutate "clicking the views rail ends the tape" \
  "      if (panel && ev.target && panel.contains(ev.target)) return;" \
  ""

# ── THE HUD MARKUP AND STYLING ─────────────────────────────────────────

mutate "the next button stops calling presentAdvance" \
  'onclick="presentAdvance(1)"' \
  'onclick=""'

mutate "the play button stops calling presentToggleAuto" \
  'onclick="presentToggleAuto()"' \
  'onclick=""'

mutate "the previous button stops calling presentAdvance" \
  'onclick="presentAdvance(-1)"' \
  'onclick=""'

mutate "a HUD node is renamed, so the renderer writes to nothing" \
  'id="present-count"' \
  'id="present-pos"'

mutate "the HUD loses its fixed position" \
  "#present-hud { position:fixed;" \
  "#present-hud {"

mutate "the HUD shows even when no tape is running" \
  "#present-hud.show { display:flex;" \
  "#present-hud { display:flex;"

# ── DISCOVERABILITY ────────────────────────────────────────────────────
# The old build taught everyone that the tape advances by itself. A tape that
# holds forever with no instruction reads as a hung app.

mutate "starting the tape says nothing" \
  "  try {
    toast(list.length + (list.length === 1 ? ' shot — ' : ' shots — ') +
          'Space or → for the next one, Esc to stop');
  } catch (e) {}" \
  ""

mutate "the driving hint stops naming the keys" \
  "'Space or → for the next one, Esc to stop'" \
  "'Presenting'"

mutate "the Present button stops saying the tape waits for you" \
  "Present the views — you advance it, Space or → for the next shot (Shift+P)" \
  "Play the views in order (Shift+P)"

mutate "the help panel drops Page Down" \
  "<b>Space</b> / → / Page Down" \
  "<b>Space</b> / →"

mutate "the help panel stops saying a clicker works" \
  "a presenter clicker works" \
  "next view"

mutate "the help panel drops Home and End" \
  "<b>Home</b> / <b>End</b>" \
  ""

mutate "the help panel drops A" \
  "Auto-play on a 4s clock" \
  "Auto-play"

mutate "an empty tape no longer says why it would not start" \
  "'Save a view first — select items, then +'" \
  "'Nothing to present'"

# ── VERSION ────────────────────────────────────────────────────────────

mutate "the app version does not move" \
  "var KRAFTED_VERSION = '7.0.50';" \
  "var KRAFTED_VERSION = '7.0.49';"

mutate "the title does not move" \
  "<title>Krafted v7.0.50</title>" \
  "<title>Krafted v7.0.49</title>"

mutsw "the service worker cache is not bumped" \
  "krafted-v7.0.50-" \
  "krafted-v7.0.49-"

print ""
print "────────────────────────────────────────────"
if [ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ]; then
  print "ALL MUTATIONS CAUGHT"
else
  print "NOT CAUGHT: $NOTCAUGHT    SKIPPED (anchor): $ANCHORFAIL"
fi
