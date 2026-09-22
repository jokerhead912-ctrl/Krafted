#!/usr/bin/env python3
"""Mechanical pre-review gate for Krafted (and any single-file HTML app).

WHY A RATCHET, NOT A LINT
-------------------------
The app is 42k lines with 1,467 empty `catch {}` blocks, 1,524 `var`
declarations and 111 loose `==`. A lint that fails on those would be red
forever, and a permanently-red gate gets ignored within a week (病根③: a gate
that never went red is not a gate; the mirror image is a gate that is always
red, which is not a gate either).

So: **the pile must not grow.** Every metric is measured, frozen into
review_baseline.json, and the run fails only when a number goes UP. Cleaning
an existing smell lowers the baseline (`--update-baseline`) and permanently
locks the improvement in.

Hard rules are different: they are absolute and always fail (no baseline
needed) because they are either never legitimate or already at zero.

USAGE
    python3 review_lint.py                     # gate (default file)
    python3 review_lint.py --file other.html   # gate another project
    python3 review_lint.py --update-baseline   # after cleaning something up
    python3 review_lint.py --print             # just show the numbers

EXIT CODES
    0 pass   1 regression / hard violation   2 usage or IO error

Zero third-party dependencies on purpose: this runs on every machine, in CI,
and in five years' time.
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_FILE = os.path.normpath(
    os.path.join(HERE, os.pardir, os.pardir, 'kraftpub-dev.html'))
BASELINE = os.path.join(HERE, 'review_baseline.json')

# Lines longer than this are minified/vendored payloads (JSZip & co). They are
# excluded from every count, otherwise one 400 KB line drowns the signal.
VENDORED_LINE_CHARS = 400

# ---------------------------------------------------------------------------
# Ratchet rules: (key, regex, human description)
# `direction` is always "must not increase".
# ---------------------------------------------------------------------------
RATCHET_RULES = [
    ('lines',            None,
     'file size in lines (single-file app: this is your module count)'),
    ('bytes',            None,
     'file size in bytes'),
    ('empty_catch',      r'catch\s*\([^)]*\)\s*\{\s*\}',
     'catch blocks with an empty body — swallowed errors'),
    ('console_log',      r'(^|[^\w.])console\.log\s*\(',
     'console.log left in shipped code'),
    ('var_decl',         r'(^|[^\w.])var\s+\w',
     'var declarations (use let/const)'),
    ('loose_eq',         r'(?<![=!<>])==(?!=)|(?<![=!])!=(?!=)',
     'loose == / != (use === / !==)'),
    ('todo_marker',      r'\b(TODO|FIXME|HACK|XXX)\b',
     'TODO/FIXME/HACK markers'),
    ('inner_html',       r'\.innerHTML\s*=',
     '.innerHTML assignment (must go through a sanitiser)'),
    ('magic_timeout',    r'setTimeout\s*\([^,]+,\s*\d+\s*\)',
     'setTimeout with a literal delay'),
]

# ---------------------------------------------------------------------------
# Hard rules: always zero. No baseline, no excuses.
# ---------------------------------------------------------------------------
HARD_RULES = [
    ('debugger',         r'(^|[^\w.])debugger\b',
     'debugger statement'),
    ('eval',             r'(^|[^\w.])eval\s*\(',
     'eval()'),
    ('new_function',     r'new\s+Function\s*\(',
     'new Function() — same code-injection surface as eval'),
    ('page_node_id',     r'\sdata-page-node-id',
     'preview-injected data-page-node-id attribute (never ship these)'),
    ('alert',            r'(^|[^\w.])alert\s*\(',
     'alert() — blocking, and never a real error path'),
]


def read_lines(path):
    try:
        with open(path, encoding='utf-8', errors='replace') as fh:
            raw = fh.read()
    except OSError as exc:
        sys.stderr.write('review_lint: cannot read %s: %s\n' % (path, exc))
        sys.exit(2)
    return raw, raw.split('\n')


def vendored_mask(lines):
    """Set of line indices that belong to minified/vendored payloads."""
    bad = set()
    for i, line in enumerate(lines):
        if len(line) > VENDORED_LINE_CHARS:
            for d in range(-1, 2):          # a hair of context either side
                if 0 <= i + d < len(lines):
                    bad.add(i + d)
    return bad


def measure(path):
    raw, lines = read_lines(path)
    vend = vendored_mask(lines)
    # Match against the TEXT, not line by line: a rule like empty_catch must
    # also see `} catch (e) {` where the `}` is on the NEXT line. Line-based
    # counting under-reported these by ~3x (527 regex vs 1467 AST).
    keep_text = '\n'.join(l for i, l in enumerate(lines) if i not in vend)

    out = {
        'lines': len(lines),
        'bytes': len(raw.encode('utf-8')),
        'vendored_lines': len(vend),
    }
    for key, rx, _desc in RATCHET_RULES:
        if rx is None:
            continue
        out[key] = len(re.findall(rx, keep_text))
    for key, rx, _desc in HARD_RULES:
        out[key] = len(re.findall(rx, keep_text))
    return out


def load_baseline():
    if not os.path.exists(BASELINE):
        return None
    try:
        with open(BASELINE, encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError) as exc:
        sys.stderr.write('review_lint: bad baseline %s: %s\n' % (BASELINE, exc))
        sys.exit(2)


def main():
    ap = argparse.ArgumentParser(description='Krafted mechanical review gate')
    ap.add_argument('--file', default=DEFAULT_FILE)
    ap.add_argument('--baseline', default=BASELINE)
    ap.add_argument('--update-baseline', action='store_true',
                    help='freeze the CURRENT numbers as the new baseline')
    ap.add_argument('--print', dest='show', action='store_true',
                    help='print the numbers and exit 0')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()

    if not os.path.exists(args.file):
        sys.stderr.write('review_lint: no such file: %s\n' % args.file)
        sys.exit(2)

    now = measure(args.file)

    if args.json:
        print(json.dumps(now, indent=2))
        return 0

    if args.update_baseline:
        with open(args.baseline, 'w', encoding='utf-8') as fh:
            json.dump(now, fh, indent=2, sort_keys=True)
            fh.write('\n')
        print('review_lint: baseline written to %s' % args.baseline)
        for k in sorted(now):
            print('  %-16s %d' % (k, now[k]))
        return 0

    base = load_baseline()
    src = os.path.basename(args.file)
    print('review_lint · %s' % src)
    print('  %-16s %10s %10s %8s' % ('metric', 'baseline', 'now', 'delta'))

    regressions = []
    improvements = []
    if base is None:
        print('  (no baseline yet — run with --update-baseline to freeze one)')
        for key, _rx, desc in RATCHET_RULES:
            print('  %-16s %10s %10d' % (key, '-', now[key]))
    else:
        for key, _rx, desc in RATCHET_RULES:
            b = base.get(key)
            n = now[key]
            if b is None:
                print('  %-16s %10s %10d   (new metric)' % (key, '-', n))
                continue
            d = n - b
            flag = ''
            if d > 0:
                flag = '  <-- REGRESSION'
                regressions.append((key, b, n, desc))
            elif d < 0:
                flag = '  (improved)'
                improvements.append((key, b, n))
            print('  %-16s %10d %10d %+8d%s' % (key, b, n, d, flag))

    hard = [(k, now[k], d) for k, _rx, d in HARD_RULES if now[k] > 0]
    print()
    if hard:
        print('  HARD RULES (must be zero, no baseline):')
        for k, n, d in hard:
            print('    🔴 %-14s %d  — %s' % (k, n, d))
    else:
        print('  hard rules: all zero ✅')

    if args.show:
        return 0

    if base is None:
        print('\nRESULT: no baseline — nothing to compare against.')
        return 0

    if regressions:
        print('\nRESULT: FAIL — %d metric(s) got worse:' % len(regressions))
        for key, b, n, desc in regressions:
            print('  🔴 %s: %d -> %d (+%d) — %s' % (key, b, n, n - b, desc))
        print('\n  Fix the new occurrences, or — if an increase is genuinely')
        print('  unavoidable — fix double the amount elsewhere and run')
        print('  --update-baseline so the debt is recorded, not hidden.')
        return 1

    if hard:
        print('\nRESULT: FAIL — hard rule violation (see above).')
        return 1

    msg = 'PASS'
    if improvements:
        msg += ' (%d metric(s) improved — run --update-baseline to lock them in)'
        print('\nRESULT: ' + msg % len(improvements))
    else:
        print('\nRESULT: PASS — no regression against the baseline.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
