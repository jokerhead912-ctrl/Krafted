#!/usr/bin/env python3
"""
Prove the GitHub Pages build is v7.30.3 and the text quick-bar fixes are in it.

Two layers, because one is not enough:
  BEHAVIOUR  -- the new code is present;
  FORBIDDEN  -- the OLD code is gone (a fix that left the old line behind has
                not happened yet, and the old line is what actually runs).

Carries the v7.30.2 and v7.30.1 anchors forward as rollback protection.
"""
import hashlib
import re
import sys
import urllib.request

URL = 'https://jokerhead912-ctrl.github.io/Krafted/kraftpub.html'
LOCAL = 'Krafted/docs/kraftpub.html'

BEHAVIOUR = [
    # v7.30.3 -- the lock note exists, is wired to a real unlock, and hides
    'lockNote.hidden = !(disabled && texts.length > 0);',
    'onclick="unlockSelectedBoardTexts()"',
    'function unlockSelectedBoardTexts() {',
    '  texts.forEach(function (tx) { tx.locked = false; updateItemStyle(tx); });',
    # ...and the BG colour picker is wired to highlightColor
    'onchange="setTextProp(\'highlightColor\',this.value)"',
    'function syncBoardColorControl(picker, labelId, value) {',
    '  syncBoardColorControl(document.getElementById(\'tqb-hl-color\'), \'tqb-hl-mixed\', hlColor);',
    # v7.30.2 -- carried forward as rollback protection
    '<input type="checkbox" id="lasso-border-toggle">',
    "const withBorder = document.getElementById('lasso-border-toggle').checked;",
    # v7.30.1 -- carried forward as rollback protection
    "  if (dir) return dir + '/' + name;",
    "    const orig = originalByBase[p.base] || originalByLower[p.base.toLowerCase()] || null;",
]

FORBIDDEN = [
    # v7.30.2 shipped bug: the box defaulted to on
    '<input type="checkbox" id="lasso-border-toggle" checked>',
    # v7.30.3 shipped bug: the mixed-state hiding keyed on the old ID only
    '#text-quick-bar .mixed-color #tqb-custom-color { opacity:0; }',
    # a lasso that ignores the box and always strokes
    "    border: true,",
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


def fetch():
    """urllib first; curl as a fallback.

    Python's urllib has been seen to fail here with
    `ssl.SSLError: [SSL] record layer failure` while curl fetches the very same
    URL fine, so a fetch that cannot reach the network is not evidence about
    the Pages build -- and a verifier that cannot run is a verifier that gets
    skipped. Both paths are recorded so the report can never be mistaken for a
    result.
    """
    try:
        return urllib.request.urlopen(URL, timeout=120).read(), 'urllib'
    except Exception as e:
        print('  urllib failed (%s) -- falling back to curl' % e)
        import subprocess
        return subprocess.run(['curl', '-sS', '--max-time', '120', URL],
                              stdout=subprocess.PIPE, check=True).stdout, 'curl'


def main():
    remote, how = fetch()
    print('  fetched via: %s' % how)
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

    ok = not miss and not rb and m and m.group(1) == '7.30.3' and same
    print('\n%s' % ('PAGES OK — v7.30.3 is live' if ok else 'PAGES PROBLEM — see above'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
