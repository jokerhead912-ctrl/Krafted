"""Live GitHub Pages verification for Krafted v7.11.0.

Fetches the deployed page + sw.js over HTTPS and asserts the shipped bytes
match the local deploy copy, and that the v7.11.0 anchors are really there.
"""
import hashlib
import re
import sys
import urllib.request

BASE = 'https://jokerhead912-ctrl.github.io/Krafted/kraftpub.html'
SW = 'https://jokerhead912-ctrl.github.io/Krafted/sw.js'

fails = []


CHECKS = [0]


def check(cond, label):
    CHECKS[0] += 1
    print(('  PASS  ' if cond else '  FAIL  ') + label)
    if not cond:
        fails.append(label)


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'krafted-verify/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def md5of(path):
    with open(path, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()


print('[1] deployed bytes == local deploy copy')
local_path = '/Users/kincheung/WorkBuddy/2026-07-25-10-53-37/Krafted/docs/kraftpub.html'
local_md5 = md5of(local_path)
local_size = len(open(local_path, 'rb').read())
pages = fetch(BASE)
pages_md5 = hashlib.md5(pages).hexdigest()
print('  local  %s  %d bytes' % (local_md5, local_size))
print('  pages  %s  %d bytes' % (pages_md5, len(pages)))
check(pages_md5 == local_md5, 'deployed md5 identical to local docs copy')
check(len(pages) == local_size, 'deployed size identical (%d)' % local_size)

t = pages.decode('utf-8', 'replace')

print('\n[2] version anchors')
m = re.search(r'<title>([^<]*)</title>', t)
check(m is not None and m.group(1) == 'Krafted v7.11.0', 'title is "Krafted v7.11.0" (got %r)' % (m.group(1) if m else None))
m = re.search(r"KRAFTED_VERSION\s*=\s*'([^']+)'", t)
check(m is not None and m.group(1) == '7.11.0', 'KRAFTED_VERSION = 7.11.0 (got %r)' % (m.group(1) if m else None))

print('\n[3] v7.11.0 crop fix is really shipped')
check('function itemLocalToScreen(' in t, 'itemLocalToScreen() helper present')
check('renderItemRegion(item, screenPts, {' in t, 'applyCrop routes through renderItemRegion')
check('_geoProbe' in t, 'screen conversion uses the DOM probe (not getBoundingClientRect)')
# The old hand-rolled capture loaded item.src and cut it with a display ratio.
check('const ratioX = item.natW / item.w;' not in t, 'the old natW/item.w ratio capture is gone')
check('ctx2d.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)' not in t, 'the old drawImage-from-original cut is gone')

print('\n[4] v7.10.1 anchors survive (no regression)')
check('Save media files' in t, 'media-only entry "Save media files" still present')
check('Download Source File' not in t, 'the removed duplicate has not come back')
check('const isVid = function (it)' in t, 'shared isVid() predicate still present')

print('\n[5] service worker')
sw = fetch(SW).decode('utf-8', 'replace')
m = re.search(r"APP_VERSION\s*=\s*'([^']+)'", sw)
check(m is not None and m.group(1) == '7.11.0', 'sw APP_VERSION = 7.11.0 (got %r)' % (m.group(1) if m else None))
m = re.search(r"CACHE_NAME\s*=\s*'([^']+)'", sw)
check(m is not None and m.group(1).startswith('krafted-v7.11.0'), 'sw CACHE_NAME bumps to krafted-v7.11.0 (got %r)' % (m.group(1) if m else None))

print('\n[6] v7.12.0 image notes report')
check('const REPORT_SHARED_CSS = [' in t, 'REPORT_SHARED_CSS present')
check('const REPORT_LIGHTBOX_JS = [' in t, 'REPORT_LIGHTBOX_JS present')
check(t.count('...REPORT_SHARED_CSS,') == 2, 'both builders spread the one stylesheet')
check(t.count('...REPORT_LIGHTBOX_JS,') == 2, 'both builders spread the one lightbox')
check('function buildNotesExportHtml(' in t, 'buildNotesExportHtml() present')
check('async function exportNotesAsHtml(' in t, 'exportNotesAsHtml() present')
check('function notesReadingOrder(' in t, 'notesReadingOrder() present')
check('function openNotesExportDialog(' in t, 'openNotesExportDialog() present')
check('\U0001F4DD Export notes as HTML\u2026' in t, 'context-menu entry present')
check('\U0001F4DD \u532f\u51fa\u5716\u6587\u5099\u8a3b HTML\u2026' in t, 'zh dictionary carries the entry')
check(t.count('const REPORT_SHARED_CSS = [') == 1, 'exactly one shared stylesheet')
check(t.count("'  :root { --accent: #00e5ff;") == 1,
      'the accent rule lives once, inside the shared array')

print('\n%s (%d checks, %d failed)' % ('ALL PASS' if not fails else 'FAILURES', CHECKS[0], len(fails)))
sys.exit(1 if fails else 0)
