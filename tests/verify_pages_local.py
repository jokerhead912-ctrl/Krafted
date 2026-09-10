# -*- coding: utf-8 -*-
"""Pages 部署後驗證（本地三份副本）—— identity + behaviour 錨點 + byte-identical。

只讀，唔改任何檔。exit 0 = 全部過。

版本係由 dev 檔 DERIVE，唔係硬編碼。理由（memory rule 12）：釘死一個 minor 嘅閘門，
喺 minor 一 bump 嗰刻就靜默變成空集合 —— 比冇閘門更衰。而且呢支係 .py，
`version_scan.py --bump` 淨識改 .js，唔會幫佢 bump（v7.10.0 就係咁紅咗 4 條）。
呢支腳本嘅職責係「三個身份位互相一致」，唔係「版本係 7.x.y」。
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


print('Pages verify (local copies)')
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
# Derived, never hardcoded: a gate pinned to one minor silently becomes an
# empty set the moment the minor is bumped (memory rule 12), and version_scan
# does not touch .py. The job is "the three identity sites agree".
print('\n[2] identity anchors')
_vm = re.search(rb"var KRAFTED_VERSION = '([0-9]+\.[0-9]+\.[0-9]+)';", dev)
ok(_vm is not None, 'dev declares KRAFTED_VERSION')
if _vm is None:
    print('\ncannot derive a version, abort')
    sys.exit(1)
VER = _vm.group(1).decode('ascii')
_vp = [int(x) for x in VER.split('.')]
print('  ..    derived version %s' % VER)
ok(_vp[0] > 7 or (_vp[0] == 7 and _vp[1] >= 9),
   'version is at least the one these checks were written for (%s, want >= 7.9.0)' % VER)
has(dev, ('<title>Krafted v%s</title>' % VER).encode('ascii'),
    'title matches KRAFTED_VERSION (%s)' % VER)
has(sw, ("const APP_VERSION = '%s';" % VER).encode('ascii'),
    'sw APP_VERSION matches dev (%s)' % VER)
ok(re.search(("const CACHE_NAME = 'krafted-v%s-'" % re.escape(VER)).encode('ascii'),
             sw) is not None,
   'sw CACHE_NAME matches dev (krafted-v%s-)' % VER)
ok(dev.count(VER.encode('ascii')) >= 2,
   'dev mentions %s at least twice (%d)' % (VER, dev.count(VER.encode('ascii'))))

# ---- 3. the old broken menu item is gone ----
print('\n[3] old export path removed')
lacks(dev, b'Save Images to Folder', 'no "Save Images to Folder" string left')

# ---- 3b. v7.10.1: the duplicate "Download Source File" is gone ----
# It duplicated "Save original files" on IMAGES (v7.9.0 writes the same bytes),
# but it was the ONLY way out for video/audio: those items are built with
# img: null, and every image export filters on item.img. So the entry was
# narrowed, not deleted. Whole-file scope here; the wiring is pinned by
# test_v7_10_1.js + mutate_v7_10_1.sh.
print('\n[3b] v7.10.1 the duplicate is gone, media-only keeps a way out')
lacks(dev, b'Download Source File', 'no "Download Source File" string left anywhere')
lacks(dev, b'\xe4\xb8\x8b\xe8\xbd\xbd\xe5\x8e\x9f\xe5\xa7\x8b\xe6\xa1\xa3',
      'zh dictionary no longer carries 下载原始档')
has(dev, b'Save media files', 'renamed entry "Save media files…" present')
has(dev, b'\xe5\x82\xa8\xe5\xad\x98\xe5\xaa\x92\xe4\xbd\x93\xe6\xa1\xa3',
    'zh dictionary carries 储存媒体档…')
has(dev, b'const isVid = function (it)',
    'one shared isVid() predicate (filter and branch agree, .kpak type-only works)')
lacks(dev, b'} else if (item.src) {',
      'the image branch of exportMediaSelected() is really deleted')

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

# ---- 4b. v7.11.0 — C crop reads the pixels you saw ----
# 「c capture 功能有問題,佢截嘅圖同我真實有啲唔同,當我用了 <Reframe> 呢兩個功能」
# 病根：applyCrop() 自己一份 hand-rolled capture（natW / item.w 塞落 drawImage
# 切 item.src），而 reframe 係 non-destructive（淨係 <img> 嘅 CSS transform，
# item.src 仲係成張原圖）→ 兩邊嘅 ratio 講嘅唔係同一件事，cut 咗去原圖左上角。
# 呢度釘死「改咗」同「冇咗」兩邊。
print('\n[4b] v7.11.0 — C crop captures what was on the board')
ok(re.search(rb'function itemLocalToScreen\(item\)', dev) is not None,
   'itemLocalToScreen() exists (item-local px -> screen px)')
ok(dev.count(b'function itemLocalToScreen(') == 1, 'exactly one itemLocalToScreen definition')
has(dev, b'renderItemRegion(item, screenPts, {',
    'applyCrop reads pixels through the shared renderer')
# The two halves of the OLD world, pinned in the negative. A positive anchor
# right after keeps them from quietly becoming an empty set.
ok(re.search(rb'function applyCrop\(\)', dev) is not None,
   'applyCrop() still exists (the negative needles below are not vacuous)')
ok(dev.count(b'drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)') == 0,
   'the old hand-rolled drawImage capture is gone')
ok(dev.count(b'const ratioX = item.natW / item.w') == 0,
   'the wrong natW/item.w ratio is gone')
# bake-then-reset (v7.8.0's rule): a baked crop must drop the framing that
# produced it, or the same pan/zoom/rotate is applied a second time.
has(dev, b'rfSetFrameFields(item, { on: false, z: 1, rot: 0, x: 0, y: 0 });',
    'applyCrop resets framing after baking, through the single writer')

# ---- 4c. v7.12.0 — image notes report, one stylesheet not two ----
# 「我選擇啲圖片right click 撳個掣 → 好似comment咁樣 export html」
# 病根①嘅守門口：image report 同 video report 必須共用同一份 CSS / lightbox。
# 所以呢度釘嘅係「兩邊都 spread 同一個常數」，而唔係「段碼存在」。
print('\n[4c] v7.12.0 — image notes report shares the report shell')
has(dev, 'const REPORT_SHARED_CSS = ['.encode('utf-8'), 'REPORT_SHARED_CSS exists')
has(dev, 'const REPORT_LIGHTBOX_JS = ['.encode('utf-8'), 'REPORT_LIGHTBOX_JS exists')
ok(dev.count(b'const REPORT_SHARED_CSS = [') == 1, 'exactly one shared stylesheet')
ok(dev.count(b'const REPORT_LIGHTBOX_JS = [') == 1, 'exactly one lightbox script')
# Two spreads, one per builder. One spread would mean the other report still
# owns a private copy that will drift.
ok(dev.count(b'...REPORT_SHARED_CSS,') == 2, 'both builders spread the stylesheet')
ok(dev.count(b'...REPORT_LIGHTBOX_JS,') == 2, 'both builders spread the lightbox')
# And the originals are gone from where they used to sit inline.
ok(dev.count(b"'  :root { --accent: #00e5ff;") == 1,
   'the accent rule lives once, inside the shared array')
ok(dev.count(b"'    function exLbOpen(src) {',") == 1,
   'exLbOpen lives once, inside the shared array')
has(dev, 'function buildNotesExportHtml('.encode('utf-8'), 'buildNotesExportHtml() exists')
has(dev, 'async function exportNotesAsHtml('.encode('utf-8'), 'exportNotesAsHtml() exists')
has(dev, 'function notesReadingOrder('.encode('utf-8'), 'notesReadingOrder() exists')
has(dev, 'function openNotesExportDialog('.encode('utf-8'), 'openNotesExportDialog() exists')
has(dev, '📝 Export notes as HTML…'.encode('utf-8'), 'context-menu entry exists')
has(dev, '📝 匯出圖文備註 HTML…'.encode('utf-8'), 'zh dictionary carries the entry')
# No new field: the report reads the note that already exists on the item,
# so .kpak needs no schema change and old boards keep working.
has(dev, b'it.note)', 'the report reads item.note, it stores nothing new')

# ---- 4d. v7.13.0 — per-image typing, zip on the image report, copy what you see ----
# 「一樣可以每一張圖都打字,同埋個HTML 可以下載全部圖片,另外想問吓可唔可以
#  喺個app裏面選擇圖片copy,paste在微信?」
print('\n[4d] v7.13.0 — per-image notes, shared zip, bake-to-clipboard')
# A: one textarea per image, written back onto the item (one undo step).
has(dev, b'function notesWriteBack(', 'notesWriteBack() exists')
has(dev, b'function notesDialogRow(', 'notesDialogRow() exists')
has(dev, 'saved back onto each image'.encode('utf-8'),
    'the dialog says typing is written back')
# B: the zip writer moved into the shared script — one copy, two buttons.
ok(dev.count(b'function buildZip(files)') == 1, 'exactly one zip writer')
ok(dev.count(b'id="zipBtn" type="button"') == 2, 'both reports carry the zip button')
has(dev, b'data-prefix="image"', 'the image report prefixes its zip entries image-*')
# C: Cmd+C bakes through the ONE renderer; a multi-selection becomes one
# contact sheet (ceil-sqrt grid, 4096px cap, board background).
has(dev, b'async function copySelectionAsImage(', 'copySelectionAsImage() exists')
has(dev, b'function composeContactSheet(', 'composeContactSheet() exists')
has(dev, b'const COPY_SHEET_MAX_SIDE = 4096;', 'the sheet is capped at 4096px')
has(dev, b'    copySelectionAsImage()', 'copySelected() hands images to the bake path')

# ---- 4e. v7.14.0 — collapsible toolbar ----
# 「這工具難有時候擋住畫面，想增加收起按鍵功能」
# 同 props/library/minimap 一個模式：class toggle + localStorage 記住。
print('\n[4e] v7.14.0 — collapsible toolbar')
ok(dev.count(b'function setToolbarCollapsed(collapsed) {') == 1,
   'one setToolbarCollapsed()')
ok(dev.count(b'id="btn-toolbar-collapse"') == 1, 'one collapse button in the toolbar')
ok(dev.count(b'id="toolbar-expand"') >= 1, 'the expand pill exists')
ok(dev.count(b'#toolbar.collapsed { display:none; }') == 1,
   'the collapsed state hides the bar')
ok(dev.count(b'#toolbar-expand.show { display:flex; }') == 1,
   'the pill appears via .show')
ok(dev.count(b'krafted_toolbar_collapsed') >= 2,
   'state persisted and restored (%d)' % dev.count(b'krafted_toolbar_collapsed'))

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
