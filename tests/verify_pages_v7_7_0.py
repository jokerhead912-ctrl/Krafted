#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_pages_v7_7_0.py — 证明 GitHub Pages 真係出 v7.7.0，唔係出个 cache。

三层断言（同 v7.6.0 嗰支一样嘅理由，细节见 verify_pages_v7_6_0.py 档头）：

  1. 身份    —— title / KRAFTED_VERSION / sw.js 三个位都係新版本
  2. 行为    —— v7.7.0 真正新增嘅锚点齐晒（folder drop 自动 tidy +
               delete 时 group 跟随成员解散）
  3. 字节    —— 服务器嗰份同本地 docs/kraftpub.html 完全一样（长度 + sha256）

版本号由 argv 或者 tests/.version_state 推导，唔硬编码 —— version_scan.py 会改写
裸 MAJOR.MINOR.PATCH 字面量（SKILL rule 17）。

用法
----
  python3 Krafted/tests/verify_pages_v7_7_0.py            # 用 .version_state 嘅 current
  python3 Krafted/tests/verify_pages_v7_7_0.py --retries 10 --wait 20
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

# v7.7.0 真正新增嘅行为锚点。呢啲名一改，呢支脚本要跟住改。每一条都对应
# 用户报过嘅病：
#
#   摆多個文件夹入去会叠到乱、重叠       -> _finishFolderImport 会 _armFolderTidy /
#       _maybeTidy 喺每个 add 之后报数 / 收齐先 tidySelection
#   删图之后个 group 框连 label 残留     -> deleteSelected 入面 _dg = groups.find(...)
#       memberIds.delete / size < 2 解体 / updateAllGroupBorders 之后重排
BEHAVIOUR = [
    'if (sorted.length) _armFolderTidy(sorted.length);',
    '_maybeTidy(_it.id)',
    'function _maybeTidy(id) {',
    "const _dg = state.groups.find(g => g.memberIds.has(i.id));",
    'if (_dg.memberIds.size < 2) {',
    'updateAllGroupBorders();',
]

# 反面断言：旧世界嘅标记唔可以再出现。v7.7.0 之前，deleteSelected 完全唔碰
# group membership，所以入面冇 `_dg.memberIds` 呢句；若果佢消失就系新行为被回滚。
FORBIDDEN = []


def code_only(text):
    """剝走 JS 註释，先好對 code 做断言（理由同陷阱见 verify_pages_v7_6_0.py）。"""
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
        hard.append('%d v7.7.0 anchor(s) missing: %s' % (len(missing), ', '.join(missing)))
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
