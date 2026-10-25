#!/usr/bin/env python3
"""
Prove the GitHub Pages build is v7.30.1 and the two fixes are really in it.

Two layers, because one is not enough:
  BEHAVIOUR  -- the new code is present;
  FORBIDDEN  -- the OLD code is gone (a fix that left the old line behind has
                not happened yet, and the old line is what actually runs).

Also checks the three copies agree and records the sha, so "which build did we
measure" is answerable later.
"""
import hashlib
import re
import sys
import urllib.request

URL = 'https://jokerhead912-ctrl.github.io/Krafted/kraftpub.html'
LOCAL = 'Krafted/docs/kraftpub.html'

BEHAVIOUR = [
    # P2 -- the folder path is read, and it is a folder so the name is appended
    "const dir = (typeof f._kraftedPath === 'string') ? f._kraftedPath.trim().replace(/\\/+$/, '') : '';",
    "  if (dir) return dir + '/' + name;",
    "  return rel || name;",
    # W2 -- two-level pairing, exact case first
    "  const originalByLower = Object.create(null);",
    "    if (b && !(bk in originalByLower)) originalByLower[bk] = n;",
    "    const orig = originalByBase[p.base] || originalByLower[p.base.toLowerCase()] || null;",
]

FORBIDDEN = [
    # the v7.30.0 key that never saw a folder path
    "  return rel || String(f.name || '').trim();",
    # the intermediate fix: case-insensitive only, which is order-dependent
    "    const orig = originalByBase[p.base.toLowerCase()] || null;",
    # the lie in the comment
    "Chrome fills `webkitRelativePath` when a folder is dragged in",
]


def code_only(s):
    """Strip comments -- but with a bound, or a stray '/*' in a string eats
    half the file (measured: 42% once)."""
    out = []
    i = 0
    n = len(s)
    while i < n:
        if s.startswith('/*', i):
            j = s.find('*/', i + 2)
            i = (j + 2) if (j >= 0 and j - i < 4000) else i + 2
        elif s.startswith('//', i):
            j = s.find('\n', i)
            i = n if j < 0 else j
        else:
            out.append(s[i])
            i += 1
    return ''.join(out)


def main():
    remote = urllib.request.urlopen(URL, timeout=120).read()
    text = remote.decode('utf-8')
    code = code_only(text)
    print('PAGES: %s' % URL)
    print('  bytes: %d   sha256: %s' % (len(remote), hashlib.sha256(remote).hexdigest()[:12]))
    m = re.search(r"<title>Krafted v([0-9.]+)</title>", text)
    print('  <title> version: %s' % (m.group(1) if m else 'NOT FOUND'))

    miss = [b for b in BEHAVIOUR if b not in code]
    rb = [f for f in FORBIDDEN if f in code]
    print('  behaviour: %d/%d present' % (len(BEHAVIOUR) - len(miss), len(BEHAVIOUR)))
    for x in miss:
        print('    MISSING: %s' % x)
    print('  forbidden: %d checked, %d present' % (len(FORBIDDEN), len(rb)))
    for x in rb:
        print('    ROLLBACK: %s' % x)

    try:
        local = open(LOCAL, 'rb').read()
        same = hashlib.sha256(local).hexdigest() == hashlib.sha256(remote).hexdigest()
        print('  local copy identical to Pages: %s' % same)
    except OSError as e:
        print('  local copy: %s' % e)
        same = False

    ok = not miss and not rb and m and m.group(1) == '7.30.1' and same
    print('\n%s' % ('PAGES OK — v7.30.1 is live' if ok else 'PAGES PROBLEM — see above'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
