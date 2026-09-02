#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_pages_v7_5_0.py — 证明 GitHub Pages 真係出 v7.5.0，唔係出个 cache。

点解要有呢支
------------
push 完就当部署完係最贵嘅假设：Pages 要 rebuild，CDN 有 cache，SW 亦会揦住旧档。
「打开个网见到 7.5.0」证明唔到啲嘢 —— 版本号係三个字符，改咗都可以係空壳。
所以呢支做三层断言：

  1. 身份    —— title / KRAFTED_VERSION / sw.js 三个位都係 7.5.0
  2. 行为    —— v7.5.0 真正新增嘅锚点齐晒（folder drop 路由、counter latch、
                image revoke、off-screen cull、alias-aware byte guard）
  3. 字节    —— 服务器嗰份同本地 docs/kraftpub.html 完全一样（长度 + sha256）

第 3 层係最紧要嘅一层：只要 sha 对得上，第 1、2 层其实已经隐含 —— 但 1、2 层坏嘅时候
佢会即刻讲得出係「边样嘢唔见」，而净係一个 sha mismatch 只会讲「唔同」。两者都要。

点解第 2 层对 v7.5.0 特别重要
------------------------------
v7.4.0 嘅 folder block 功能，全套测试绿灯、锚点全中，但功能一次都冇跑过 ——
`pending` counter 永远返唔到 0，所以 completion callback 从来冇 fire。
**锚点证明段码存在，证明唔到段码会跑。** 呢支脚本净係做静态检查，所以佢只能证明
「啲 code 上咗线」，证明唔到「啲 code 跑得起」；后者由 test_v7_5_0.js 用真嘅
FileSystemEntry mock 去钉，mutate_v7_5_0.sh 用 30 个变异去证明个网捉得到。

版本号由 argv 或者 tests/.version_state 推导，唔硬编码 —— version_scan.py 会改写
裸 MAJOR.MINOR.PATCH 字面量（SKILL rule 17）。

用法
----
  python3 Krafted/tests/verify_pages_v7_5_0.py            # 用 .version_state 嘅 current
  python3 Krafted/tests/verify_pages_v7_5_0.py 7.5.0
  python3 Krafted/tests/verify_pages_v7_5_0.py --retries 10 --wait 20
"""

import hashlib
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
KRAFTED = os.path.normpath(os.path.join(HERE, '..'))

URL = 'https://jokerhead912-ctrl.github.io/Krafted/kraftpub.html'
SW_URL = 'https://jokerhead912-ctrl.github.io/Krafted/sw.js'
LOCAL = os.path.join(KRAFTED, 'docs', 'kraftpub.html')

# v7.5.0 真正新增嘅行为锚点。呢啲名一改，呢支脚本要跟住改 —— 咁样好过一支
# 永远绿嘅脚本。每一条都对应一个用户报过嘅病：
#
#   folder drop 冇反应      -> _dropEntries / _dropHasDirectory / 路由 / settled latch
#   pinterest 拖落去冇反应   -> （见下：呢个唔係锚点问题，係 toast；靠 code 层断言）
#   拖几张图再拣几张就崩     -> cleanupImageItem / _cullOffscreenImages /
#                              scheduleImageCull / _ensureAllImagesLive /
#                             仍然要存在嘅 stillHeld guard / 2048 上限
BEHAVIOUR = [
    'function _dropEntries(dt)',
    'function _dropHasDirectory(entries)',
    '_handleEntryDrop(e, _dirEntries)',
    'var settled = false;',
    'function cleanupImageItem(item, revokeBlob)',
    'function _cullOffscreenImages()',
    'function scheduleImageCull()',
    'function _ensureAllImagesLive()',
    'if (!stillHeld) _mediaBlobBytes -=',
    'const IMAGE_MAX_EDGE_LOCAL = 2048;',
    'var _MEDIA_BLOB_CACHE_MAX_ENTRIES = 96;',
]

# 呢三条係「旧码已经唔可以再出现」嘅反面断言。佢哋出现 = 我修嘅嘢被回滚咗，
# 而第 1、2 层全部都睇唔出（因为新码仲喺度，只不过多咗旧码）。
FORBIDDEN = [
    'pending = entries.length',
    'pending += batch.length',
]


def arg(name, default):
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return default


def wanted_version():
    for a in sys.argv[1:]:
        if not a.startswith('-') and a.count('.') == 2:
            return a
    state = os.path.join(HERE, '.version_state')
    with open(state, encoding='utf-8') as f:
        return json.load(f)['current']


def fetch(url):
    # cache-buster：Pages 前面有 CDN，唔加个 query 有机会攞到旧档而以为部署失败
    bust = url + ('&' if '?' in url else '?') + 'cb=' + str(int(time.time()))
    req = urllib.request.Request(bust, headers={
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'User-Agent': 'krafted-deploy-verify',
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def attempt(version):
    """返回 (ok, [讯息...])。ok=False 代表要再等。"""
    msgs = []
    hard = []

    try:
        served = fetch(URL)
    except Exception as e:
        return False, ['fetch failed: %s' % e]

    text = served.decode('utf-8', 'replace')

    # ── 1. 身份 ────────────────────────────────────────────────────────────
    ident = [
        ('<title>', '<title>Krafted v%s</title>' % version),
        ('KRAFTED_VERSION', "var KRAFTED_VERSION = '%s';" % version),
    ]
    for label, needle in ident:
        if needle in text:
            msgs.append('  ok   %-18s %s' % (label, version))
        else:
            hard.append('%s does not say %s' % (label, version))

    # ── 2. 行为 ────────────────────────────────────────────────────────────
    missing = [b for b in BEHAVIOUR if b not in text]
    if missing:
        hard.append('%d v7.5.0 anchor(s) missing: %s' % (len(missing), ', '.join(missing)))
    else:
        msgs.append('  ok   %-18s %d/%d present' % ('behaviour', len(BEHAVIOUR), len(BEHAVIOUR)))

    rolled_back = [f for f in FORBIDDEN if f in text]
    if rolled_back:
        hard.append('v7.4.0 bug is back: %s' % ', '.join(rolled_back))
    else:
        msgs.append('  ok   %-18s %d checked, none present' % ('no-rollback', len(FORBIDDEN)))

    # ── 3. 字节 ────────────────────────────────────────────────────────────
    with open(LOCAL, 'rb') as f:
        local = f.read()
    ls, ss = hashlib.sha256(local).hexdigest(), hashlib.sha256(served).hexdigest()
    if len(local) != len(served):
        hard.append('length differs: local %d vs served %d' % (len(local), len(served)))
    elif ls != ss:
        hard.append('same length but sha differs: %s vs %s' % (ls[:12], ss[:12]))
    else:
        msgs.append('  ok   %-18s %d bytes  sha %s' % ('byte-identical', len(served), ss[:12]))

    # ── sw.js ─────────────────────────────────────────────────────────────
    try:
        sw = fetch(SW_URL).decode('utf-8', 'replace')
        for label, needle in (('sw CACHE_NAME', "krafted-v%s-" % version),
                              ('sw APP_VERSION', "APP_VERSION = '%s'" % version)):
            if needle in sw:
                msgs.append('  ok   %-18s %s' % (label, version))
            else:
                hard.append('%s does not say %s' % (label, version))
    except Exception as e:
        hard.append('sw.js fetch failed: %s' % e)

    return (not hard), msgs + ['  !!   ' + h for h in hard]


def main():
    version = wanted_version()
    retries = int(arg('--retries', '8'))
    wait = int(arg('--wait', '20'))

    print('verify_pages: expecting v%s at %s' % (version, URL))
    print('-' * 66)

    for i in range(1, retries + 1):
        ok, msgs = attempt(version)
        print('attempt %d/%d' % (i, retries))
        for m in msgs:
            print(m)
        if ok:
            print('-' * 66)
            print('  PAGES OK - v%s is live and byte-identical to docs/kraftpub.html' % version)
            return 0
        if i < retries:
            print('  ... waiting %ds for Pages to rebuild' % wait)
            time.sleep(wait)
        print()

    print('-' * 66)
    print('  PAGES NOT VERIFIED after %d attempt(s)' % retries)
    return 1


if __name__ == '__main__':
    sys.exit(main())
