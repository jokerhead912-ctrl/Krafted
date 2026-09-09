"""Live GitHub Pages verification for Krafted.

Fetches the deployed page + sw.js over HTTPS and asserts the shipped bytes
match the local deploy copy, and that the current release's anchors are
really there.

VERSION-AGNOSTIC BY CONSTRUCTION. The expected version is derived from the
local deploy copy and the local sw.js, never written down here. v7.12.0
shipped with four hardcoded '7.11.0' strings; the release was fine and the
verifier still went red, which is a gate you learn to ignore. What a live
check should assert is that the deployed page agrees with what you built --
not that it spells a number you remembered to edit.
"""
import hashlib
import os
import re
import sys
import urllib.request

ROOT = '/Users/kincheung/WorkBuddy/2026-07-25-10-53-37'
DOCS = os.path.join(ROOT, 'Krafted', 'docs')
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


def read(path):
    with open(path, 'rb') as f:
        return f.read().decode('utf-8', 'replace')


def one(pattern, text, label):
    m = re.search(pattern, text)
    check(m is not None, 'found %s' % label)
    return m.group(1) if m else None


print('[0] expected version comes from the local build, not from this file')
local_path = os.path.join(DOCS, 'kraftpub.html')
local_bytes = open(local_path, 'rb').read()
local = local_bytes.decode('utf-8', 'replace')
VERSION = one(r"KRAFTED_VERSION\s*=\s*'([^']+)'", local, 'local KRAFTED_VERSION')
check(bool(re.match(r'^\d+\.\d+\.\d+$', VERSION or '')),
      'derived a well-formed semver (%r)' % VERSION)
LOCAL_TITLE = one(r'<title>([^<]*)</title>', local, 'local <title>')
check(LOCAL_TITLE == 'Krafted v' + (VERSION or '?'),
      'local title matches its own version constant (%r)' % LOCAL_TITLE)

local_sw = read(os.path.join(DOCS, 'sw.js'))
SW_VERSION = one(r"APP_VERSION\s*=\s*'([^']+)'", local_sw, 'local sw APP_VERSION')
SW_CACHE = one(r"CACHE_NAME\s*=\s*'([^']+)'", local_sw, 'local sw CACHE_NAME')
check(SW_VERSION == VERSION, 'sw.js agrees with the page (%r vs %r)' % (SW_VERSION, VERSION))
check((SW_CACHE or '').startswith('krafted-v' + (VERSION or '?')),
      'cache name carries the same version (%r)' % SW_CACHE)

print('\n[1] deployed bytes == local deploy copy')
local_md5 = hashlib.md5(local_bytes).hexdigest()
pages = fetch(BASE)
pages_md5 = hashlib.md5(pages).hexdigest()
print('  local  %s  %d bytes' % (local_md5, len(local_bytes)))
print('  pages  %s  %d bytes' % (pages_md5, len(pages)))
check(pages_md5 == local_md5, 'deployed md5 identical to local docs copy')
check(len(pages) == len(local_bytes), 'deployed size identical (%d)' % len(local_bytes))

t = pages.decode('utf-8', 'replace')

print('\n[2] version anchors (compared against the local build)')
m = re.search(r'<title>([^<]*)</title>', t)
check(m is not None and m.group(1) == LOCAL_TITLE, 'title is %r (got %r)' % (LOCAL_TITLE, m.group(1) if m else None))
m = re.search(r"KRAFTED_VERSION\s*=\s*'([^']+)'", t)
check(m is not None and m.group(1) == VERSION, 'KRAFTED_VERSION = %s (got %r)' % (VERSION, m.group(1) if m else None))

print('\n[3] v7.11.0 crop fix is still shipped')
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

print('\n[5] service worker (compared against the local copy)')
sw = fetch(SW).decode('utf-8', 'replace')
m = re.search(r"APP_VERSION\s*=\s*'([^']+)'", sw)
check(m is not None and m.group(1) == SW_VERSION, 'sw APP_VERSION = %s (got %r)' % (SW_VERSION, m.group(1) if m else None))
m = re.search(r"CACHE_NAME\s*=\s*'([^']+)'", sw)
check(m is not None and m.group(1) == SW_CACHE, 'sw CACHE_NAME = %r (got %r)' % (SW_CACHE, m.group(1) if m else None))

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
