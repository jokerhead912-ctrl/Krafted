#!/bin/zsh
# Mutation check for test_v7_12_0.js — deliberately break the source, confirm
# the suite goes red, restore. A suite that cannot fail is not a suite.
#
#   "i want add funtion whne i selection couples of image and i can 好似放喺
#    comment 度嘅一個欄可以打意見，然之後好似comment咁樣 export html"
#
# Every mutation below puts one half of the OLD world back, or breaks one
# promise the report makes: reading order, no dropped images, no unescaped
# text, one stylesheet. If any of them survives, the suite is decoration.
#
# Reminder from v7.10.1: wrapping the original in /* */ leaves the string in
# the file, so a has() needle still matches. DELETE text.
#
# NOTE: never run against the dev file; we always mutate a throwaway copy.
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate7120
mkdir -p $TMP
cp kraftpub-dev.html $TMP/mut.html

run() {   # run(label)
  local out
  out=$(KRAFTED_HTML=$TMP/mut.html $NODE Krafted/tests/test_v7_12_0.js 2>&1)
  if [ "$EQUIV" -eq 1 ]; then judge_equiv "$1" "$out"; else judge "$1" "$out"; fi
  tally_judged
}

mutate() { # mutate(label, old, new, [count])
  cp kraftpub-dev.html $TMP/mut.html
  $PY - "$2" "$3" "${4:-1}" <<'PYEOF'
import sys
old, new, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = '/tmp/krafted-mutate7120/mut.html'
s = open(p, encoding='utf-8').read()
n = s.count(old)
if n != want:
    print('    !! anchor matched %d times, want %d' % (n, want)); sys.exit(2)
open(p, 'w', encoding='utf-8').write(s.replace(old, new))
PYEOF
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
print "mutation check: v7.19.0 suite (image notes report)"

# ── reading order ─────────────────────────────────────────────────────────

mutate "every item becomes its own row (plain y-sort, the jitter bug)" \
  '    if (!cur || top >= cur.bottom) {' \
  '    if (true) {'

mutate "rows are no longer sorted left-to-right" \
  "    rows[r].items.sort(function (a, b) { return ((a && a.x) || 0) - ((b && b.x) || 0); });" \
  ''

# Multi-line, and it contains single quotes — so it is passed in DOUBLE quotes
# (zsh only does command substitution on backticks inside those, and there are
# none here). An earlier version dropped the opening paren without its closing
# one and produced an ILLEGAL MUTATION: a file that does not parse proves
# nothing, and mutlib is right to say so.
mutate "the report keeps selection order instead of reading order" \
  "  return notesReadingOrder(sel.filter(function (i) {
    if (!i || !i.img || !i.src) return false;
    return !(i.isVideo || i.isAudio || i.type === 'video' || i.type === 'audio');
  }));" \
  "  return sel.filter(function (i) {
    if (!i || !i.img || !i.src) return false;
    return !(i.isVideo || i.isAudio || i.type === 'video' || i.type === 'audio');
  });"

# ── what gets in ──────────────────────────────────────────────────────────

# Needs the fixture that carries a poster image (vid2) to be observable: media
# items are built with img: null, so the pixel check alone would already drop
# them and this mutation would change nothing.
mutate "video and audio are no longer excluded" \
  "    return !(i.isVideo || i.isAudio || i.type === 'video' || i.type === 'audio');" \
  '    return true;'

mutate "items with no pixels are no longer filtered out" \
  '    if (!i || !i.img || !i.src) return false;' \
  ''

mutate "images without a note are dropped instead of marked" \
  "            (note ? escapeHtml(note) : '<span style=\"opacity:.45;font-style:italic\">(no comment)</span>') +" \
  '            escapeHtml(note) +'

mutate "the note is rendered raw (no escaping)" \
  '            (note ? escapeHtml(note)' \
  '            (note ? note'

mutate "the overall comment is dropped on the way to the document" \
  "    overComment: String(overComment || '').trim()," \
  "    overComment: '',"

mutate "a blank overall comment renders an empty gradient card again" \
  "  const overComment = String(opts.overComment || '').trim();" \
  "  const overComment = opts.overComment || '';"

# ── the size gate ─────────────────────────────────────────────────────────

mutate "the 25 MB gate is out of reach, so nothing is ever offered" \
  '  if (total > NOTES_MAX_BYTES) {' \
  '  if (total > NOTES_MAX_BYTES * 1000) {'

mutate "base64 padding is not discounted (every image over-counted)" \
  '  return Math.max(0, Math.floor(b64.length * 3 / 4) - pad);' \
  '  return Math.max(0, Math.floor(b64.length * 3 / 4));'

# ── one stylesheet, two reports ───────────────────────────────────────────

mutate "the image report gets its own (truncated) copy of the stylesheet" \
  "    ...REPORT_SHARED_CSS,
'</style>',
'</head>',
'<body>',
'  <div class=\"page\">',
'    <div class=\"head\">',
'      <div class=\"logo\">🖼</div>'," \
  "    ...REPORT_SHARED_CSS.slice(0, 5),
'</style>',
'</head>',
'<body>',
'  <div class=\"page\">',
'    <div class=\"head\">',
'      <div class=\"logo\">🖼</div>',"

mutate "the image report loses the lightbox" \
  "    ...REPORT_LIGHTBOX_JS,
'  <\/script>',
'</body>',
'</html>',
  ].join('\\n');
}

// Mail and chat attachments" \
  "'  <\/script>',
'</body>',
'</html>',
  ].join('\\n');
}

// Mail and chat attachments"

# ── the dialog ────────────────────────────────────────────────────────────

# v7.13.0 renamed the variable (text → overall) when the dialog grew per-image
# rows; the behaviour under test is unchanged: what is typed must be read.
mutate "the dialog's textarea is never read" \
  "  const overall = ta ? String(ta.value || '') : '';" \
  "  const overall = '';"

print "MUTVERDICT $([ $NOTCAUGHT -eq 0 ] && [ $ANCHORFAIL -eq 0 ] && echo ok || echo BAD)  holes=$NOTCAUGHT skipped=$ANCHORFAIL caught=$CAUGHT fragile=$FRAGILE"
exit $((NOTCAUGHT + ANCHORFAIL))
