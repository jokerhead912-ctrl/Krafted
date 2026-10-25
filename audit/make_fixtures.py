#!/usr/bin/env python3
"""
Build the audit fixture tree from REAL footage bytes.

WHAT IS REAL AND WHAT IS NOT (read this before citing any result):
  * every file's BYTES are real -- copied verbatim from the director's own
    footage folder, never generated;
  * the FOLDER TREE and the NAMES are constructed by this script, because the
    real folder turned out to contain none of the cases we need (see
    scan_oil19.py output: 0 same-name-different-folder, 0 case variants,
    0 files named *_proxy).

So: "the bytes are real, the tree is built". Anything measured on this tree
proves how Krafted behaves on those bytes. It does NOT prove how often the
director's real folder hits those cases.

Usage: python3 make_fixtures.py
"""
import hashlib
import json
import os
import shutil
import sys

SRC_ROOT = os.path.expanduser('~/Documents/deta_force/yang1/oil19')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'footage')

# target name -> (source rel path, why this case exists)
CASES = [
    # P2 -- same basename, different folder, DIFFERENT size. If the pool key
    # collapses to the name, one take silently becomes the other.
    ('takeA/shot01.mp4', '05_video_edit/out_edit_v1.mp4',
     'P2: same name as takeB/shot01.mp4, different folder, size 14313976 vs 18002861'),
    ('takeA/shot01_proxy.mp4', '07_run_3s/final/19_oil_3s_SMOOTH24_1080p.mp4',
     'proxy for takeA/shot01 (PROXY_SUFFIX is _proxy, matched case-insensitively)'),
    ('takeB/shot01.mp4', '05_video_edit/out_omni_v1.mp4',
     'P2: the take that gets lost if the key is the name alone'),
    ('takeB/shot01_proxy.mp4', '07_run_3s/final/19_oil_3s_FULL_1080p.mp4',
     'proxy for takeB/shot01'),

    # W2 -- case variants. mediaBaseName() is case-SENSITIVE, proxyBaseName()
    # is not, so Shot01.mp4 will not find SHOT01_proxy.mp4.
    ('CaseTest/Shot01.mp4', '05_video_edit/out_style_v1.mp4',
     'W2: capital S -- the pair below is uppercase and must still match'),
    ('CaseTest/SHOT01_proxy.mp4', '07_run_3s/final/19_oil_3s_PICTURE_1920x818.mp4',
     'W2: proxy in a different case from its original'),

    # Size collision -- two REAL files, identical size, different bytes.
    # Neither name nor size can tell them apart; only the folder path can.
    ('twinsA/shot02.mp4', '09_run_full/final/19_oil_FULL_v2_1080p.mp4',
     'size collision: 51553100 bytes, sha256 d618711d...'),
    ('twinsB/shot02.mp4', '09_run_full/final/19_oil_FULL_v2plain_1080p.mp4',
     'size collision: 51553100 bytes, sha256 4554eca0... (same size, different bytes)'),

    # W1 -- MIME detection. Same real bytes under three extensions.
    # .mxf is deliberately NOT a container Chrome can map; the question is
    # whether file.type comes back empty and what the user then sees.
    ('mimes/shot03.mxf', '_rejected_20261010/MOTE_MOTION_TEST_2x.mp4',
     'W1: unmapped extension -- does file.type come back empty?'),
    ('mimes/shot04.mov', '_rejected_20261010/MOTE_MOTION_TEST_2x.mp4',
     'W1: .mov is usually mapped to video/quicktime -- control for .mxf'),
    ('mimes/shot05.mp4', '_rejected_20261010/MOTE_MOTION_TEST_2x.mp4',
     'W1: control -- definitely mapped'),
]


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    if not os.path.isdir(SRC_ROOT):
        print('SOURCE FOOTAGE FOLDER MISSING: ' + SRC_ROOT, file=sys.stderr)
        return 2
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)

    manifest = {'sourceRoot': SRC_ROOT, 'note': __doc__.strip().split('\n')[0], 'files': []}
    missing = []
    for target, src_rel, why in CASES:
        src = os.path.join(SRC_ROOT, src_rel)
        if not os.path.isfile(src):
            missing.append(src_rel)
            continue
        dst = os.path.join(OUT, target)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(src, dst)
        manifest['files'].append({
            'target': target,
            'sourceRel': src_rel,
            'size': os.path.getsize(dst),
            'sha256': sha256_of(dst),
            'why': why,
        })

    if missing:
        print('MISSING SOURCES: ' + ', '.join(missing), file=sys.stderr)
        return 2

    man_path = os.path.join(os.path.dirname(OUT), 'footage_manifest.json')
    with open(man_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=1)
    total = sum(x['size'] for x in manifest['files'])
    print('built %d fixture files, %.1f MB' % (len(manifest['files']), total / 1e6))
    print('manifest: ' + man_path)
    for x in manifest['files']:
        print('  %-28s %10d  %s  <- %s' % (x['target'], x['size'], x['sha256'][:12], x['sourceRel']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
