#!/usr/bin/env python3
"""Put a Mac result next to a Windows one, case by case.

The two runs use the SAME script and the SAME cases but usually DIFFERENT
input files (my footage folder is not your footage folder). So for each row
this says which numbers are comparable and which are not:

  COMPARABLE      the behaviour does not depend on which file was used
                  (e.g. "did the .mxf get skipped: yes/no")
  INPUTS DIFFER   two real numbers that were measured on different bytes --
                  read them side by side, do not subtract them

Usage: python3 compare.py results/result_mac.json results/result_win.json
"""
import json
import sys

COMPARABLE = {
    ('C1_load', 'coldMs'): 'inputs differ (network + this machine)',
    ('C1_load', 'warmMs'): 'inputs differ',
    ('C1_load', 'appVersion'): 'comparable',
    ('C1_load', 'codecs'): 'comparable',
    ('C2_board_load', 'itemsLoaded'): 'inputs differ (different board)',
    ('C2_board_load', 'msToItems'): 'inputs differ',
    ('C2_board_load', 'msToSettled'): 'inputs differ',
    ('C2_board_load', 'longTasksDuringLoad'): 'comparable',
    ('C3_pan_zoom', 'frames'): 'comparable in shape (vsync-bound on both)',
    ('C3_pan_zoom', 'longTasks'): 'comparable',
    ('C4_mime_probe', 'probes'): 'comparable -- this is the W1 question',
    ('C5b_real_decode', 'loaded'): 'comparable',
    ('C6_heap_3snapshots', 'monotonicRise'): 'comparable',
    ('C7_soak', 'longTasksOver200ms'): 'comparable',
}


def flat(cases):
    out = {}
    for c in cases:
        name = c.get('case')
        for k, v in c.items():
            if k in ('case', 'at'):
                continue
            out[(name, k)] = v
    return out


def fmt(v):
    s = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v
    return s if len(s) <= 90 else s[:87] + '...'


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    a = flat(json.load(open(sys.argv[1], encoding='utf-8'))['cases'])
    b = flat(json.load(open(sys.argv[2], encoding='utf-8'))['cases'])
    keys = sorted(set(a) | set(b), key=lambda k: (k[0], k[1]))
    print('%-22s %-14s | %-42s | %s' % ('case', 'field', sys.argv[1].split('/')[-1], sys.argv[2].split('/')[-1]))
    print('-' * 150)
    for k in keys:
        va = a.get(k, '—')
        vb = b.get(k, '—')
        note = COMPARABLE.get(k, '')
        same = 'SAME' if va == vb else 'DIFF'
        print('%-22s %-14s | %-42s | %-42s | %s %s'
              % (k[0], k[1], fmt(va), fmt(vb), same, note))
    return 0


if __name__ == '__main__':
    sys.exit(main())
