#!/bin/zsh
# Mutation check for test_v7051.js (Reference metadata + Library contract).
set -u
cd /Users/kincheung/WorkBuddy/2026-07-25-10-53-37 || exit 1
NODE=/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node
PY=/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3
TMP=/tmp/krafted-mutate51
mkdir -p "$TMP"
cp kraftpub-dev.html "$TMP/mut.html"

$PY - "$TMP/mut.html" <<'PYEOF'
import subprocess, sys, shutil

SRC = sys.argv[1]
BAK = SRC + '.orig'
shutil.copy2(SRC, BAK)
orig = open(SRC, encoding='utf-8').read()
NODE = '/Users/kincheung/.workbuddy/binaries/node/versions/22.12.0/bin/node'
SUITE = 'Krafted/tests/test_v7051.js'

muts = [
    ('tags route append became replace',
     "if (field === 'tags') return mutateSelectedTags('append', value);",
     "if (field === 'tags') return mutateSelectedTags('replace', value);"),

    ('unknown field guard removed',
     "if (field !== 'name' && field !== 'note') return 0;",
     "/* unknown-field guard removed */"),

    ('target filter ignores locked/no-op protection',
     "var targets = getSelectedItems().filter(function (it) { return !it.locked && (it[field] || '') !== value; });",
     "var targets = getSelectedItems();"),

    ('metadata writes not field-aware anymore',
     "targets.forEach(function (it) { it[field] = value; });",
     "targets.forEach(function (it) { it.name = value; });"),

    ('properties tags input loses shared tag contract',
     "<input type=\"text\" id=\"prop-tags\" data-tag-input list=\"board-tag-suggestions\" maxlength=\"200\" autocomplete=\"off\">",
     "<input type=\"text\" id=\"prop-tags\" list=\"board-tag-suggestions\" maxlength=\"200\" autocomplete=\"off\">"),

    ('updatePropsPanel stops delegating metadata refresh',
     "  const item = sel[0];\n  renderTagControls();",
     "  const item = sel[0];"),

    ('libMatches drops text body matching',
     "var body = isText ? (it.el ? it.el.textContent : (it.content || '')) : '';",
     "var body = '';"),

    ('libMatches drops boardTagValues fallback',
     "var tags = (typeof boardTagValues === 'function') ? boardTagValues(it.tags) : ((it.tags || []).filter(Boolean));",
     "var tags = [];"),

    ('renderLibraryPanel fallback source removed',
     "var source = (typeof libraryItems === 'function') ? libraryItems() : (state.items || []).concat(state.texts || []);\n  var items = source.filter(function (it) {",
     "var source = libraryItems();\n  var items = source.filter(function (it) {"),

    ('one save path drops metadata fields',
     "name: i.name || '', note: i.note || '', tags: i.tags ? i.tags.slice() : [],",
     ""),
]

caught = 0
skipped = 0

for label, old, new in muts:
    c = orig.count(old)
    if c < 1:
        print('SKIPPED (anchor=0)  ' + label)
        skipped += 1
        continue
    open(SRC, 'w', encoding='utf-8').write(orig.replace(old, new, 1))
    r = subprocess.run([NODE, SUITE, SRC], capture_output=True, text=True)
    if r.returncode != 0:
        n = len([l for l in r.stdout.split('\n') if l.strip().startswith('FAIL')])
        print('caught             %-64s %d assertion(s)' % (label, n))
        caught += 1
    else:
        print('NOT CAUGHT         ' + label)

shutil.copy2(BAK, SRC)
print('')
print('---- %d/%d caught, %d skipped (anchor)' % (caught, len(muts), skipped))
holes = len(muts) - caught - skipped
print('MUTVERDICT %s holes=%d skipped=%d caught=%d total=%d' % (
    'ok' if (holes == 0 and skipped == 0) else 'BAD', holes, skipped, caught, len(muts)
))
sys.exit(0 if (holes == 0 and skipped == 0) else 1)
PYEOF
