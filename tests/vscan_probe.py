#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
vscan_probe.py - expose version_scan.py's internals to the JS test suite.

WHY THIS EXISTS
    The version policy is enforced by version_scan.py, which is Python. The
    test suite is Node. The alternative to this probe is for the suite to
    re-implement the policy in JavaScript and assert on that - which would be
    a second hand-written copy of the rule, and the two would drift. Then the
    suite would go green while the thing it claims to test does something else,
    which is the exact failure this project keeps getting bitten by.

    So the suite drives the real module and asserts on real output. This file
    is only a CLI shim; it contains no policy of its own.

    Keep it a .py: version_scan.target_files() scans Krafted/tests for .js and
    .sh to bump, and a probe that rewrites itself on every release would be
    confusing at best.

USAGE
    vscan_probe.py scan   <file> <current> <nxt> <mode> <cur_major> <prev>
    vscan_probe.py own    <filename>
    vscan_probe.py next   <version> <kind>
    vscan_probe.py policy <version> <kind>

    Prints one JSON object on stdout.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import version_scan as vs  # noqa: E402


def cmd_scan(args):
    path, current, nxt, mode, cur_major, prev = args[:6]
    findings, changes, newtext = vs.scan_file(
        path, current, nxt, mode=mode, cur_major=cur_major, prev=prev)
    return {
        'findings': findings,
        'changes': [{'line': c[0], 'old': c[1], 'new': c[2], 'kind': c[3],
                     'text': c[4]} for c in changes],
        'newtext': newtext,
    }


def cmd_own(args):
    return {'own': vs.own_version(args[0])}


def cmd_next(args):
    return {'next': vs.next_v(args[0], args[1] if len(args) > 1 else 'patch')}


def cmd_policy(args):
    return {'error': vs.policy_error(args[0], args[1] if len(args) > 1 else 'patch')}


def cmd_helpers(_args):
    """Everything the suite wants to pin in one round trip."""
    return {
        'patch_max': vs.PATCH_MAX,
        'state_file': os.path.basename(vs.STATE_FILE),
        'dev_html': os.path.basename(vs.DEV_HTML),
    }


COMMANDS = {
    'scan': cmd_scan,
    'own': cmd_own,
    'next': cmd_next,
    'policy': cmd_policy,
    'helpers': cmd_helpers,
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        sys.stderr.write('usage: vscan_probe.py <%s> [args...]\n'
                         % '|'.join(sorted(COMMANDS)))
        return 2
    print(json.dumps(COMMANDS[sys.argv[1]](sys.argv[2:])))
    return 0


if __name__ == '__main__':
    sys.exit(main())
