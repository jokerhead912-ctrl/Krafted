#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
version_scan.py - scan and bump the Krafted version number.

WHY THIS EXISTS
    Bumping the version by hand needs two shell commands, and both of them have
    a trap that has already bitten this project many times:

      1. `grep -E 'a\\|b'`  - in this shell `\\|` is NOT alternation, only a bare
         `|` under -E is. Every hand-typed alternation silently returns nothing.
      2. `perl -i -pe 's/A\\.B\\.C/A.B.C/g'` - misses the ESCAPED form
         `A\\.B\\.C` that suites carry in their regexes, and a global s/// on
         the app file would also rewrite the ~400 historical `// v7.0.XX:`
         comments that must stay where they are.

    So: never hand-type the regex again. This script knows the difference.

THE ONE RULE THAT MATTERS
    A version string is either an IDENTITY or HISTORY:

      IDENTITY - this position names the version the app currently IS. It must
                 always equal the current version, or the anchor that uses it
                 matches nothing and the mutation silently stops testing
                 anything (which is worse than having no mutation at all).
      HISTORY  - `// v7.0.33: ...` style comments recording which release
                 introduced a piece of code. These never move.

    Bumping rewrites IDENTITY positions only.

VERSION POLICY  (MAJOR.MINOR.PATCH)
      major - breaks something a user relies on: the .kpak format, the
              save/load contract, or an existing behaviour being reworked
      minor - a new capability, or a visible change to how something works
      patch - a bug fix, an internal change, or tests only

      * patch RESETS TO 0 when minor or major moves.
      * patch is CAPPED AT 9; the tenth fix rolls the minor.

    The cap and the reset are the whole point. Before this policy the third
    digit did all the work and never reset, so the version crept to 7.0.53 and
    told you nothing: a rework, a new panel and a one-line fix all looked
    identical. With a cap and a reset, `7.1.3` reads as "the first feature
    batch after 7.0, plus three fixes" - and it can never grow into another
    7.0.53.

    The rules live here, in a file that runs, because a rule written in a doc
    gets forgotten and a rule that blocks the release does not.

USAGE
    python3 Krafted/tests/version_scan.py                       # report, read-only
    python3 Krafted/tests/version_scan.py --bump               # patch (default)
    python3 Krafted/tests/version_scan.py --bump minor         # 7.0.53 -> 7.1.0
    python3 Krafted/tests/version_scan.py --bump major         # 7.1.0  -> 8.0.0
    python3 Krafted/tests/version_scan.py --bump --to 7.1.0
    python3 Krafted/tests/version_scan.py --bump --prev 7.0.53 # reseed the state file
    python3 Krafted/tests/version_scan.py --fix-stale --write  # repair anchors only
    python3 Krafted/tests/version_scan.py --files              # also list every hit

    Nothing is written unless --bump or --write is given.

WHY THERE IS A STATE FILE
    "The previous version" cannot be computed by subtracting one any more.
    Before 7.1.0 the previous release was 7.0.53, not 7.0.9 - so `patch - 1`
    produces a number that never existed, and every mutate script carrying an
    identity-revert anchor reports a false STALE that blocks the bump. So the
    previous version is recorded at each bump into .version_state. If that
    file is missing the script refuses to guess; pass --prev once to reseed it.

EXIT CODE
    0  clean
    1  STALE anchors found - mutations that no longer test anything
    2  cannot determine the current version, or the previous version
    3  the requested bump breaks the version policy (patch cap)
"""

import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEV_HTML = os.path.join(ROOT, 'kraftpub-dev.html')
SW_JS = os.path.join(ROOT, 'Krafted', 'docs', 'sw.js')
TESTS = os.path.join(ROOT, 'Krafted', 'tests')
STATE_FILE = os.path.join(TESTS, '.version_state')

# The tenth fix rolls the minor. See VERSION POLICY above.
PATCH_MAX = 9

# Matches BOTH the plain form `X.Y.Z` and the escaped form `X\.Y\.Z`
# that suites carry inside their regexes. Written without a literal
# version on purpose: this file is itself a bump target, so any
# example number here gets rewritten at the next release and turns
# into a lie (this docstring once claimed a _v7047 file mapped to the
# release after it, which its own regex can never produce).
VER = re.compile(r'(\d+(?:\\?\.\d+){2})')

# Positions that name the version the app currently IS. `{}` is the version.
# Order matters only for reporting.
IDENTITY_TEMPLATES = [
    "var KRAFTED_VERSION = '{}';",
    "<title>Krafted v{}</title>",
    "const APP_VERSION = '{}';",
    "krafted-v{}-",
]

# This one names a version but lives on a comment line, so it must be matched
# BEFORE the "it's a comment, leave it alone" rule and not be swallowed by it.
COMMENT_IDENTITY_TEMPLATES = [
    "// Krafted v{} Service Worker",
]


def _compile(templates):
    out = []
    for t in templates:
        parts = t.split('{}')
        out.append(re.compile(
            r'(\d+(?:\\?\.\d+){2})'.join(re.escape(p) for p in parts)))
    return out


IDENTITY_RES = _compile(IDENTITY_TEMPLATES)
COMMENT_IDENTITY_RES = _compile(COMMENT_IDENTITY_TEMPLATES)

# `<!--` must be here: the app file carries `<!-- PRESENT HUD (vX.Y.Z) -->`
# style banners, and a bare `//`-only list would read those as code.
COMMENT_PREFIXES = ('//', '#', '/*', '*', '<!--')

POLICY = """KRAFTED VERSION POLICY  (MAJOR.MINOR.PATCH)
  major  breaks something a user relies on: .kpak format, save/load contract,
         or an existing behaviour being reworked
  minor  a new capability, or a visible change to how something works
  patch  a bug fix, an internal change, or tests only

  patch resets to 0 when minor or major moves
  patch is capped at {cap}; the tenth fix rolls the minor"""


def vkey(v):
    return tuple(int(x) for x in v.split('.'))


def vstr(k):
    return '.'.join(str(x) for x in k)


def next_v(v, kind='patch'):
    a, b, c = vkey(v)
    if kind == 'major':
        return vstr((a + 1, 0, 0))
    if kind == 'minor':
        return vstr((a, b + 1, 0))
    return vstr((a, b, c + 1))


def policy_error(v, kind):
    """Return a message if this bump breaks the policy, else None."""
    if kind not in ('patch', 'minor', 'major'):
        return 'unknown bump kind %r' % kind
    a, b, c = vkey(v)
    if kind == 'patch' and c + 1 > PATCH_MAX:
        return ('patch would become %d but the cap is %d.\n'
                '         Ten fixes is a minor: use --bump minor (-> %s)'
                % (c + 1, PATCH_MAX, vstr((a, b + 1, 0))))
    return None


def read_current(path=DEV_HTML):
    with open(path, encoding='utf-8') as fh:
        m = re.search(r"var KRAFTED_VERSION = '([^']+)';", fh.read())
    if not m:
        sys.exit('version_scan: cannot find KRAFTED_VERSION in ' + path)
    return m.group(1)


def load_prev():
    """The previous released version, as recorded by the last bump."""
    try:
        with open(STATE_FILE, encoding='utf-8') as fh:
            return json.load(fh).get('prev')
    except (OSError, ValueError):
        return None


def save_state(current, prev):
    with open(STATE_FILE, 'w', encoding='utf-8') as fh:
        json.dump({'current': current, 'prev': prev}, fh, indent=2)
        fh.write('\n')


def target_files():
    files = [DEV_HTML, SW_JS]
    for name in sorted(os.listdir(TESTS)):
        if name.endswith(('.js', '.sh')) and name != 'version_scan.py':
            files.append(os.path.join(TESTS, name))
    return files


def own_version(path):
    """The release a test file belongs to, from its name.

    Two conventions, because renaming fifteen existing suites just to make the
    parser tidy would be churn with no payoff:

      new  test_v7_1_0.js      -> 7.1.0   (dots as underscores, any digit width)
      old  test_v7053.js       -> 7.0.53  (runs of digits, single-digit minor)
           test_v7038_tidy.js  -> 7.0.38
    """
    base = os.path.basename(path)
    m = re.search(r'_v(\d+)_(\d+)_(\d+)(?:_|\.)', base)
    if m:
        return '%s.%s.%s' % m.groups()
    m = re.search(r'_v(\d)(\d)(\d+)(?:_|\.)', base)
    if m:
        return '%s.%s.%s' % m.groups()
    return None


def identity_spans(line):
    """Map start offset -> (end offset, survives_on_a_comment_line).

    The second field separates `// Krafted vX.Y.Z Service Worker` (an identity
    that happens to be spelled as a comment) from an identity template that only
    shows up inside a comment - the latter is history, not identity.
    """
    spans = {}
    for rx in COMMENT_IDENTITY_RES:
        for im in rx.finditer(line):
            spans[im.start(1)] = (im.end(1), True)
    for rx in IDENTITY_RES:
        for im in rx.finditer(line):
            spans[im.start(1)] = (im.end(1), False)
    return spans


def scan_file(path, current, nxt, mode='bump', cur_major=None, prev=None):
    """Return (findings, changes, newtext).

    A change is (lineno, old, new, kind, snippet). Edits are collected first and
    applied back-to-front, because replacing a version changes the length of
    the line and every later offset with it.

    mode 'bump'      - identity goes to `nxt`; a revert anchor goes to `current`
                       (after the bump, `current` IS the previous version).
    mode 'fix-stale' - the version does not move; every stale anchor is pulled
                       to the value it should already have had. Use this when
                       the scan reports stale anchors but there is no release
                       to bump to yet.
    """
    own = own_version(path)
    findings, changes = [], []
    with open(path, encoding='utf-8') as fh:
        lines = fh.read().split('\n')

    in_block = False        # inside a mutate/mutsw call
    block_idn = 0           # which identity this is: 1st = old, 2nd = new

    for n, line in enumerate(lines, 1):
        stripped = line.strip()
        if re.match(r'^(mutate|mutsw)\s', stripped):
            in_block, block_idn = True, 0

        idn = identity_spans(line)
        is_comment = stripped.startswith(COMMENT_PREFIXES)
        edits = []

        for m in VER.finditer(line):
            raw = m.group(1)
            ver = raw.replace('\\', '')
            # Which version numbers are even candidates. Derived from the
            # current major rather than hard-coded:
            #
            #   THIS USED TO SAY `if not ver.startswith('7.0.'): continue`.
            #   The day the version became 7.1.0 that line made the scanner
            #   skip EVERY version in EVERY file - it printed "0 stale,
            #   nothing to bump" and exited 0, so the stale-anchor guard
            #   looked healthy while testing nothing at all. A version check
            #   that silently narrows to the empty set is worse than no
            #   check.
            #
            #   Matching the major alone also keeps us away from `6.0.2`,
            #   which is a commented-out legacy declaration in the app file,
            #   not a Krafted version.
            if cur_major and ver.split('.')[0] != cur_major:
                continue
            new, want = None, ver
            hit = idn.get(m.start())
            if hit and (hit[1] or not is_comment):
                block_idn += 1
                if in_block and block_idn == 2:
                    # The "new" side of a mutation: revert to the PREVIOUS
                    # version. Before the bump that is `prev`; after it, the
                    # outgoing current - which is what we must write.
                    kind, want = 'identity-revert', prev
                    new = prev if mode == 'fix-stale' else current
                else:
                    kind, want = 'identity', current
                    new = current if mode == 'fix-stale' else nxt
            elif is_comment:
                kind = 'history'          # never touched
            else:
                kind = 'bare'
                if mode != 'bump':
                    pass              # fix-stale never touches loose versions
                elif ver == current:
                    new = nxt
                elif prev and ver == prev and own == current:
                    # "the previous version is gone" assertions ride along,
                    # but only in the suite that belongs to this release.
                    new = current

            findings.append({
                'line': n, 'ver': ver, 'kind': kind, 'want': want,
                'stale': kind in ('identity', 'identity-revert') and ver != want,
                'text': stripped[:88],
            })
            if new and new != ver:
                changes.append((n, ver, new, kind, stripped[:88]))
                sep = '\\.' if '\\.' in raw else '.'
                edits.append((m.start(), m.end(), sep.join(new.split('.'))))

        for start, end, repl in reversed(edits):
            line = line[:start] + repl + line[end:]

        if in_block and not stripped.endswith('\\'):
            in_block = False
        lines[n - 1] = line

    return findings, changes, '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bump', nargs='?', const='patch', default=None,
                    choices=['patch', 'minor', 'major'],
                    help='bump and WRITE. Optional kind, default patch.')
    ap.add_argument('--fix-stale', action='store_true',
                    help='repair stale anchors instead of moving the version')
    ap.add_argument('--write', action='store_true',
                    help='actually write; without it everything is a dry run')
    ap.add_argument('--to', help='explicit target version, e.g. 7.1.0')
    ap.add_argument('--prev', help='explicit previous version; reseeds the state file')
    ap.add_argument('--files', action='store_true', help='list every hit, not just problems')
    args = ap.parse_args()

    current = read_current()
    mode = 'fix-stale' if args.fix_stale else 'bump'
    kind = args.bump or 'patch'

    print(POLICY.format(cap=PATCH_MAX))
    print('')

    if args.to:
        try:
            if len(vkey(args.to)) != 3:
                raise ValueError
        except ValueError:
            sys.exit('version_scan: --to must be MAJOR.MINOR.PATCH, got %r' % args.to)
        nxt = args.to
    elif mode == 'fix-stale':
        nxt = current
    else:
        bad = policy_error(current, kind)
        if bad:
            print('POLICY: %s --bump %s refused.' % (current, kind))
            print('         %s' % bad)
            return 3
        nxt = next_v(current, kind)

    cur_major = current.split('.')[0]
    prev = args.prev or load_prev()
    if not prev:
        print('version_scan: cannot determine the previous version.')
        print('  %s is missing or empty, and it cannot be computed:' % STATE_FILE)
        print('  the predecessor of a new minor is the last patch of the old one.')
        print('  Reseed it once with:  --bump minor --prev <the version live now>')
        return 2

    print('current %s   ->   %s   (kind: %s, previous: %s)' % (current, nxt, kind, prev))
    print('')

    total_stale = 0
    total_change = 0
    for path in target_files():
        findings, changes, newtext = scan_file(
            path, current, nxt, mode, cur_major=cur_major, prev=prev)
        rel = os.path.relpath(path, ROOT)
        stales = [f for f in findings if f['stale']]
        if not stales and not changes and not args.files:
            continue
        own = own_version(path)
        head = '%s%s' % (rel, ('  [own %s]' % own) if own else '')
        print(head)
        for f in stales:
            total_stale += 1
            print('   STALE  line %-5d %-9s is %s, must be %s' %
                  (f['line'], f['kind'], f['ver'], f['want']))
            print('          %s' % f['text'])
        for (ln, old, new, kind_s, text) in changes:
            total_change += 1
            print('   bump   line %-5d %-9s %s -> %s' % (ln, kind_s, old, new))
            if args.files:
                print('          %s' % text)
        print('')

    print('-' * 62)
    print('%d identity anchor(s) stale, %d occurrence(s) to bump' % (total_stale, total_change))

    write = args.write or args.bump
    if write and total_change:
        for path in target_files():
            _, changes, newtext = scan_file(
                path, current, nxt, mode, cur_major=cur_major, prev=prev)
            if changes:
                with open(path, 'w', encoding='utf-8') as fh:
                    fh.write(newtext)
        print('written: %s -> %s' % (current, nxt))
        if mode == 'bump':
            save_state(nxt, current)
            print('state:   .version_state now prev=%s' % current)
    elif write:
        print('nothing to write')
    else:
        print('dry run - pass --write (or --bump) to write')

    if total_stale:
        print('')
        print('A stale anchor matches 0 times, so that mutation tests nothing.')
        print('Fix these before the bump, or the suite is lying to you.')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
