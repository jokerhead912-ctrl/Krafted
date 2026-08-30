#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
memory_guard.py — 睇住 .workbuddy/memory/ 嘅体积同索引完整性。

点解要有呢支脚本
----------------
2026-08-31 发现两件事：

1. MEMORY.md 胀到 174 行 / 16.4KB，而注入到 context 嘅净系一份旧快照（当时个档仲係
   ~2.2KB）。无论机制係「截断」定係「缓存」，结果一样：**档太大 = 当下嘅规则冇入到
   context**，而呢个失败系静默嘅 —— 冇报错、冇警告，净系个 agent 唔知啲规则存在。

2. 记忆档同时做紧三份工：索引（去边度搵）、规则（乜唔可以犯）、档案（点解咁做）。
   三份工塞落同一个机制，就一定会胀。

所以规则唔係「记得keep细」，而係：**超预算就 exit 1**，挂落 run_all.sh，每个 release 都会跑。
同一条教训 as shell 嘅 `\|`：要紧嘅规则住喺会跑嘅文件度，唔好住喺会忘记嘅头壳度。
（呢个 docstring 必须係 raw string，否则里面个反斜杠+竖线会出 SyntaxWarning ——
正正就係第 7 条讲嗰个病，换咗个语言再咬一次。）

预算
----
  MEMORY.md        60 行 /  5000 字符   永远注入 —— 最严
  MEMORY-*.md     200 行 / 16000 字符   按需读取 —— 每次读都烧 context
  日誌 YYYY-MM-DD  400 行               档案 —— 超 30 日要蒸餾再删

仲check一样嘢：**索引完整性**。memory/ 里每个 MEMORY-*.md 都要喺 MEMORY.md 被提到，
否则个 agent 根本唔知嗰个主题档存在 —— 開咗档等如冇開。

用法
----
  python3 Krafted/tests/memory_guard.py             # 超预算 exit 1
  python3 Krafted/tests/memory_guard.py --strict    # 日誌债都当致命
  python3 Krafted/tests/memory_guard.py --snapshot  # 先备份去 backups/，再检查

点解要 --snapshot
----------------
记忆档住喺工作区层（`.workbuddy/memory/`），**唔喺 `Krafted/` 嘅 git repo 入面** ——
即係冇版本控制。而根目录嗰堆 .md 都一样。写烂咗冇得还原。
rule 3 讲「改动前先备份」，但备份一只 1.9MB 嘅 html 好自然，备份 2.8KB 嘅记忆档
好易唔记得 —— 所以摆落脚本，等 run_all.sh 每次 release 自动做。留最近 N 份。
"""

import os
import re
import shutil
import sys
from datetime import date, datetime, timedelta

# tests/ 的上一级是 Krafted/，再上一级是工作区根
HERE = os.path.dirname(os.path.abspath(__file__))
MEMDIR = os.path.normpath(os.path.join(HERE, '..', '..', '.workbuddy', 'memory'))

INDEX_MAX_LINES = 60
INDEX_MAX_CHARS = 5000
TOPIC_MAX_LINES = 200
TOPIC_MAX_CHARS = 16000
DAILY_MAX_LINES = 400
DAILY_DISTILL_AFTER_DAYS = 30

DAILY_RE = re.compile(r'^(\d{4})-(\d{2})-(\d{2})\.md$')

SNAPSHOT_KEEP = 10


def snapshot(workspace):
    """把 memory/ 复制去 backups/memory-<时间戳>/，留最近 SNAPSHOT_KEEP 份。"""
    backups = os.path.join(workspace, 'backups')
    os.makedirs(backups, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    dest = os.path.join(backups, 'memory-' + stamp)
    shutil.copytree(MEMDIR, dest)

    # 只 prune 我哋自己产生嘅 memory-* 备份，唔好掂用户嘅 html 备份
    old = sorted(p for p in os.listdir(backups)
                 if p.startswith('memory-')
                 and os.path.isdir(os.path.join(backups, p)))
    dropped = 0
    for p in old[:-SNAPSHOT_KEEP]:
        shutil.rmtree(os.path.join(backups, p))
        dropped += 1
    print('memory_guard: snapshot -> backups/%s%s'
          % (os.path.basename(dest),
             '  (dropped %d older)' % dropped if dropped else ''))
    return dest


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


class Report(object):
    def __init__(self):
        self.fatal = []        # 超预算 / 索引唔完整 —— 会令 run_all.sh 红
        self.advisory = []     # 日誌未蒸餾 —— 每次跑都印出嚟，但唔阻出货
        self.rows = []

    def add(self, path, kind, detail, advisory=False):
        (self.advisory if advisory else self.fatal).append((path, kind, detail))

    def row(self, path, lines, chars, note):
        self.rows.append((path, lines, chars, note))


def main():
    if not os.path.isdir(MEMDIR):
        print('memory_guard: no memory dir at %s' % MEMDIR)
        return 0

    if '--snapshot' in sys.argv:
        snapshot(os.path.join(HERE, '..', '..'))

    names = sorted(n for n in os.listdir(MEMDIR) if n.endswith('.md'))
    index_path = os.path.join(MEMDIR, 'MEMORY.md')
    rep = Report()

    if 'MEMORY.md' not in names:
        print('memory_guard: MEMORY.md is missing')
        return 1

    index_text = read(index_path)

    for name in names:
        path = os.path.join(MEMDIR, name)
        text = read(path)
        lines = text.count('\n') + (0 if text.endswith('\n') else 1)
        chars = len(text)

        m = DAILY_RE.match(name)
        if m:
            note = 'daily log (archive)'
            rep.row(name, lines, chars, note)
            # 日誌係档案层，唔会注入、唔会按需读 —— 佢胀大只係还债问题，
            # 唔会令 agent 静默失效，所以列为 advisory。--strict 会升呢做致命。
            if lines > DAILY_MAX_LINES:
                rep.add(name, 'daily too long',
                        '%d lines > %d — 蒸餾入主题档再删' % (lines, DAILY_MAX_LINES),
                        advisory=True)
            when = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3))).date()
            age = (date.today() - when).days
            if age > DAILY_DISTILL_AFTER_DAYS:
                rep.add(name, 'daily not distilled',
                        '%d 日前（>%d 日）— 应蒸餾入主题档再删' % (age, DAILY_DISTILL_AFTER_DAYS),
                        advisory=True)
            continue

        if name == 'MEMORY.md':
            note = 'INDEX (always injected)'
            rep.row(name, lines, chars, note)
            if lines > INDEX_MAX_LINES:
                rep.add(name, 'index too long',
                        '%d lines > %d — why/how 搬去 SKILL.md 或主题档' % (lines, INDEX_MAX_LINES))
            if chars > INDEX_MAX_CHARS:
                rep.add(name, 'index too big',
                        '%d chars > %d' % (chars, INDEX_MAX_CHARS))
            continue

        # 主题档
        note = 'topic'
        rep.row(name, lines, chars, note)
        if lines > TOPIC_MAX_LINES:
            rep.add(name, 'topic too long',
                    '%d lines > %d — 拆档' % (lines, TOPIC_MAX_LINES))
        if chars > TOPIC_MAX_CHARS:
            rep.add(name, 'topic too big',
                    '%d chars > %d — 拆档' % (chars, TOPIC_MAX_CHARS))
        # 索引完整性：呢个档有没有被 MEMORY.md 提到？
        if name not in index_text:
            rep.add(name, 'not in index',
                    'MEMORY.md 冇提到 %s — agent 唔知佢存在' % name)

    # ── 打印 ──────────────────────────────────────────────────────────────
    print('memory_guard: %s' % os.path.relpath(MEMDIR, os.path.join(HERE, '..', '..')))
    print('-' * 62)
    for name, lines, chars, note in rep.rows:
        flag = ''
        limit = INDEX_MAX_LINES if name == 'MEMORY.md' else (
            DAILY_MAX_LINES if DAILY_RE.match(name) else TOPIC_MAX_LINES)
        if lines > limit:
            flag = '  <-- over budget'
        print('  %-22s %5d lines  %7d chars   %-26s%s'
              % (name, lines, chars, note, flag))
    total = sum(r[2] for r in rep.rows)
    print('-' * 62)
    print('  total %d chars across %d files' % (total, len(rep.rows)))

    strict = '--strict' in sys.argv
    if strict:
        # 日誌债都当致命 —— 等债还清之后 run_all.sh 应该转用呢个 mode
        rep.fatal.extend(rep.advisory)
        rep.advisory = []

    if rep.advisory:
        print()
        print('  %d advisory (日誌档案层，唔阻出货):' % len(rep.advisory))
        for name, kind, detail in rep.advisory:
            print('    ~  %-20s %-22s %s' % (name, kind, detail))

    if rep.fatal:
        print()
        print('  %d violation(s):' % len(rep.fatal))
        for name, kind, detail in rep.fatal:
            print('    !! %-20s %-22s %s' % (name, kind, detail))
        print()
        print('  MEMORY.md 係索引档 —— 只放「去边度搵」+「乜唔可以犯」。')
        print('  why / how / 历史搬去 SKILL.md 或 git log。')
        return 1

    print()
    print('  memory OK' + ('  (strict)' if strict else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
