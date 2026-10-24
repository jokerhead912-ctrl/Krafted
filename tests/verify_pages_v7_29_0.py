#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_pages_v7_29_0.py — 证明 GitHub Pages 真系出 v7.29.0，唔系出个 cache。

三层断言（理由见 verify_pages_v7_6_0.py 档头）：

  1. 身份    —— title / KRAFTED_VERSION / sw.js 三个位都系新版本
  2. 行为    —— A/B/C 三组嘅锚点齐晒：
                A  dropOriginalLink 唯一定义 + 真删除先 release + 记得嘅档要过 size
                B  swap 失败会 rollback + picker 得一个会重用
                C  proxyCardsInSelection 复数 + trim 跟 clip + fps 跟档
  3. 字节    —— 服务器嗰份同本地 docs/kraftpub.html 完全一样（长度 + sha256）

版本号由 argv 或者 tests/.version_state 推导，唔硬编码 —— version_scan.py 会改写
裸 MAJOR.MINOR.PATCH 字面量（SKILL rule 17）。

用法
----
  python3 Krafted/tests/verify_pages_v7_29_0.py
  python3 Krafted/tests/verify_pages_v7_29_0.py --retries 10 --wait 20
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

# 每一条锚点对应一个失效模式：
#   dropOriginalLink                 —— 冇呢个，删卡就留低一条 blob URL 永远唔放
#   revokeBlob && item               —— 冇呢个 guard，Ctrl+Z 会变黑卡（v7.0.39 嗰条）
#   _DROP_FILES_MAX / video only     —— 冇呢两个，_dropFiles 会记住成个 session 嘅 PSD
#   remembered.size === want         —— 同名唔同 size 会静默连错档
#   _filePicker                      —— 冇呢个，每次开 picker 都生一个新的（cancel 就漏）
#   _swapFailed / addEventListener('error'  —— 播唔到原檔会静静留低一个讲大话嘅 ORIG
#   proxyCardsInSelection            —— 单数版净搞第一张卡
#   fitTrimToDuration                —— trim 唔跟新 duration
#   _count                           —— 菜单唔讲会掂几多张卡
BEHAVIOUR = [
    'function dropOriginalLink(itemId) {',
    'if (revokeBlob && item) dropOriginalLink(item.id);',
    'const _DROP_FILES_MAX = 200;',
    "if (!(f.type && f.type.indexOf('video/') === 0)) return;",
    'const already = (remembered && want && remembered.size === want) ? remembered : null;',
    'let _filePicker = null;',
    'v.addEventListener(\'error\', _swapFailed);',
    'function proxyCardsInSelection() {',
    'function fitTrimToDuration(item, v) {',
    '    fitTrimToDuration(item, v);',
    'const _count = _proxyCards.length > 1 ? (\' (\' + _proxyCards.length + \')\') : \'\';',
]

# 反面断言：退化形态唔可以出现。
FORBIDDEN = [
    'function proxyCardInSelection() {',          # 单数 helper 返生 —— 净搞第一张卡
    'it.isProxy && it.isVideo) return it;',       # 同上，first-card-only
    'const already = (name && _dropFiles.get(name)) || null;',  # 净对名，唔对 size
    'inp.remove();',                              # 每个 picker 一个新 input，cancel 就漏
    'v.src = item.src = item._showingOriginal',   # swap 写埋 item.src（snapshot 会讲大话）
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
        hard.append('%d lifecycle anchor(s) missing: %s' % (len(missing), ', '.join(missing)))
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

    return len(hard) == 0, msgs + ['  FAIL ' + h for h in hard]


def main():
    version = wanted_version()
    retries = int(arg('--retries', '10'))
    wait = int(arg('--wait', '20'))
    print('verify_pages_v7_29_0 — want v%s on Pages' % version)
    for i in range(1, retries + 1):
        ok, msgs = attempt(version)
        print('\nattempt %d/%d' % (i, retries))
        for m in msgs:
            print(m)
        if ok:
            print('\nPAGES OK — v%s is live' % version)
            return 0
        if i < retries:
            print('  ...waiting %ds (CDN cache)' % wait)
            time.sleep(wait)
    print('\nPAGES NOT OK')
    return 1


if __name__ == '__main__':
    sys.exit(main())
