# -*- coding: utf-8 -*-
"""v7.9.0 Pages 部署後驗證 —— identity + behaviour 錨點 + byte-identical。

只讀，唔改任何檔。exit 0 = 全部過。
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEV = os.path.join(ROOT, 'kraftpub-dev.html')
DEPLOY = os.path.join(ROOT, 'Krafted', 'kraftpub.html')
DOCS = os.path.join(ROOT, 'Krafted', 'docs', 'kraftpub.html')
SW = os.path.join(ROOT, 'Krafted', 'docs', 'sw.js')

fails = []
checks = [0]


def ok(cond, label):
    checks[0] += 1
    if not cond:
        fails.append(label)
        print('  FAIL  %s' % label)
    else:
        print('  ok    %s' % label)


def read(p):
    with open(p, 'rb') as f:
        return f.read()


def has(b, needle, label):
    ok(needle in b, label)


def lacks(b, needle, label):
    ok(needle not in b, label)


print('v7.9.0 Pages verify')
print('-' * 62)

for p in (DEV, DEPLOY, DOCS, SW):
    ok(os.path.exists(p), 'exists: %s' % os.path.relpath(p, ROOT))

if fails:
    print('\nmissing files, abort')
    sys.exit(1)

dev = read(DEV)
dep = read(DEPLOY)
doc = read(DOCS)
sw = read(SW)

# ---- 1. byte-identical 三份 ----
print('\n[1] byte-identical')
ok(len(dev) == len(dep) == len(doc), 'all three copies same byte length (%d)' % len(dev))
ok(dev == dep, 'dev == Krafted/kraftpub.html')
ok(dev == doc, 'dev == Krafted/docs/kraftpub.html')
ok(b' data-page-node-id' not in dev, 'no data-page-node-id left in shipped file')

# ---- 2. identity anchors ----
print('\n[2] identity anchors')
has(dev, b'<title>Krafted v7.9.0</title>', 'title says v7.9.0')
has(dev, b"var KRAFTED_VERSION = '7.9.0';", 'KRAFTED_VERSION = 7.9.0')
has(sw, b"const APP_VERSION = '7.9.0';", 'sw APP_VERSION = 7.9.0')
ok(re.search(rb"const CACHE_NAME = 'krafted-v7\.9\.0-'", sw) is not None,
   'sw CACHE_NAME says krafted-v7.9.0-')
ok(dev.count(b'7.9.0') >= 2, 'dev mentions 7.9.0 at least twice (%d)' % dev.count(b'7.9.0'))

# ---- 3. the old broken menu item is gone ----
print('\n[3] old export path removed')
lacks(dev, b'Save Images to Folder', 'no "Save Images to Folder" string left')

# ---- 4. behaviour anchors: the three bug fixes ----
print('\n[4] behaviour anchors')

# (a) export menu reachable when a selection exists
ok(re.search(rb'function exportMenuEntries\(', dev) is not None,
   'exportMenuEntries() exists (shared by both menu branches)')
ok(dev.count(b'exportMenuEntries(') >= 3,
   'exportMenuEntries defined + called in both branches (%d)' % dev.count(b'exportMenuEntries('))

# (b) no more src.split('.').pop() guessing. NB: the string still appears in
#     two COMMENTS that describe the bug — pin the live line, not the phrase.
lacks(dev, b"ext = item.src.split('.').pop()",
      "no live src.split('.').pop() extension guessing (image, video or audio)")
has(dev, b"ext = extFromName(name, 'mp3');", "audio reads the extension from its own name")
has(dev, b"ext = extFromName(name, 'mp4');", "video reads the extension from its own name")

# (c) bake uses the one shared renderer, never re-derives geometry
ok(re.search(rb'function renderItemRegion\(', dev) is not None,
   'renderItemRegion() exists (one renderer shared by cut/lasso/export)')
ok(dev.count(b'function renderItemRegion(') == 1, 'exactly one renderItemRegion definition')
ok(dev.count(b'itemPixelGeometry(') >= 3,
   'itemPixelGeometry call sites present (%d)' % dev.count(b'itemPixelGeometry('))
ok(re.search(rb'async function bakeItemToBlob\(item\)', dev) is not None,
   'bakeItemToBlob() exists')
has(dev, b"r.canvas.toBlob(b => res(b), 'image/png')", 'bake always writes PNG')

# (d) original-file export is a separate menu item
has(dev, b'Save original files', 'separate "Save original files" menu item')
ok(re.search(rb'function exportOriginalFilesToFolder\(', dev) is not None,
   'exportOriginalFilesToFolder() exists')

# (e) zip fallback for Safari/Firefox
has(dev, b"compression: 'STORE'", 'zip sink uses STORE (PNG already compressed)')
has(dev, b"'application/zip'", 'zip mime wired up')

# (f) cancel
has(dev, b'opts.onCancel', 'progress UI supports onCancel')
ok(re.search(rb'function exportAllImagesToFolder\(opts\)', dev) is not None,
   'exportAllImagesToFolder takes opts')

# ---- 5. i18n ----
print('\n[5] i18n')
has(dev, b'Save images as PNG', 'zh dictionary has "Save images as PNG" key')
has(dev, b'Save original files', 'zh dictionary has "Save original files" key')

print('-' * 62)
if fails:
    print('FAILED %d/%d' % (len(fails), checks[0]))
    for f in fails:
        print('  - %s' % f)
    sys.exit(1)
print('ALL PASS (%d checks)' % checks[0])
sys.exit(0)
