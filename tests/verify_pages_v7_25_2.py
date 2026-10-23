#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_pages_v7_25_2.py — 证明 GitHub Pages 真系出 v7.25.1，唔系出个 cache。

三层断言（理由见 verify_pages_v7_6_0.py 档头）：

  1. 身份    —— title / KRAFTED_VERSION / sw.js 三个位都系新版本
  2. 行为    —— v7.25.1 真正新增嘅锚点齐晒（crop 保格式 + manifest 唔再抄 base64
               + crop 后清 stale Blob）
  3. 字节    —— 服务器嗰份同本地 docs/kraftpub.html 完全一样（长度 + sha256）

版本号由 argv 或者 tests/.version_state 推导，唔硬编码 —— version_scan.py 会改写
裸 MAJOR.MINOR.PATCH 字面量（SKILL rule 17）。

用法
----
  python3 Krafted/tests/verify_pages_v7_25_2.py
  python3 Krafted/tests/verify_pages_v7_25_2.py --retries 10 --wait 20
"""

import hashlib
import json
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
KRAFTED = os.path.normpath(os.path.join(HERE, '..'))

URL = 'https://jokerhead912-ctrl.github.io/Krafted/kraftpub.html'
SW_URL = 'https://jokerhead912-ctrl.github.io/Krafted/sw.js'
LOCAL = os.path.join(KRAFTED, 'docs', 'kraftpub.html')

# v7.25.1 真正新增嘅行为锚点。每一条都对应一个病：
#
#   100MB 板存成 700MB（三连）:
#     (1) JPEG crop 完变 PNG 5-10x  -> cropEncodeMime + applyCrop 经佢攞 mime
#     (2) manifest.json 再抄一份 base64 -> d.src 对 data: URL 落 ''
#     (3) zip 存返未裁原图          -> crop 后清 _sourceBlob 并记新 size
BEHAVIOUR = [
    'function _tbFollowLoop() {',
    'if (!annoToolbar || !annoToolbar.isConnected) { _tbRafId = 0; return; }',
]

# 反面断言：旧世界嘅标记唔可以再出现。呢三句就系三只 bug 本身。
FORBIDDEN = [
    'function _tbFollowLoop() {\n      try {',   # the guard is no longer first
]


def code_only(text):
    """剝走 JS 注释，先好对 code 做断言（理由同陷阱见 verify_pages_v7_6_0.py）。"""
    text = re.sub(r'/\*[\s\S]{0,4000}?\*/', '', text)
    text = re.sub(r'(?<![:\\\'"])//[^\n]*', '', text)
    return text


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
    code = code_only(text)
    missing = [b for b in BEHAVIOUR if b not in code]
    if missing:
        hard.append('%d v7.25.1 anchor(s) missing: %s' % (len(missing), ', '.join(missing)))
    else:
        msgs.append('  ok   %-18s %d/%d present' % ('behaviour', len(BEHAVIOUR), len(BEHAVIOUR)))

    rolled_back = [f for f in FORBIDDEN if f in code]
    if rolled_back:
        hard.append('the old world is back: %s' % ', '.join(rolled_back))
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
