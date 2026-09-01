#!/usr/bin/env node
/*
 * test_v7048.js — A/B compare lock (v7.0.48).
 *
 * WHY THIS SUITE EXISTS
 *   Hold-to-compare put a finger on the image area, and that press reached
 *   the board underneath, duplicating both compared images onto the canvas.
 *   The fix has two halves that must both hold:
 *
 *     1. the lock is ON by default (the user must not have to remember),
 *     2. when locked, the stage swallows the event entirely.
 *
 *   Half 1 is the one that rots silently — a future edit to `_ab` init or to
 *   the button markup drops the default and nothing anywhere complains.
 *   So abSyncLockUI is executed for real against a mocked element rather
 *   than merely being checked for existence.
 *
 * Usage:  node test_v7048.js [path-to-kraftpub.html]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2]
  || path.resolve(__dirname, '../../kraftpub-dev.html');
const SRC = fs.readFileSync(FILE, 'utf8');
const ROOT = path.resolve(__dirname, '../..');

let pass = 0;
const fails = [];
function ok(cond, label) { if (cond) { pass++; } else { fails.push(label); } }
function eq(a, b, label) {
  ok(a === b, `${label}  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}
function has(needle, label, hay) {
  ok((hay || SRC).indexOf(needle) >= 0, `${label}  (missing: ${JSON.stringify(needle.slice(0, 70))})`);
}

// ── extract a shipped top-level function by brace matching ─────────────
function fnFull(name, hay) {
  const i = hay.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let d = 0, started = false;
  for (let j = i; j < hay.length; j++) {
    const c = hay[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return hay.slice(i, j + 1); }
  }
  return '';
}

// ── a DOM element mock with just enough surface for abSyncLockUI ───────
function mockEl() {
  const cls = new Set();
  const icon = { textContent: '' };
  const btn = {
    title: '',
    classList: {
      toggle(name, on) { if (on) { btn._cls.add(name); } else { btn._cls.delete(name); } },
      add(n) { btn._cls.add(n); },
      contains(n) { return btn._cls.has(n); },
    },
    _cls: new Set(),
    querySelector(sel) { return sel === '.ab-lock-icon' ? icon : null; },
  };
  return {
    _cls: cls,
    _btn: btn,
    _icon: icon,
    classList: {
      add(...n) { n.forEach(x => cls.add(x)); },
      remove(...n) { n.forEach(x => cls.delete(x)); },
      toggle(name, on) { if (on) { cls.add(name); } else { cls.delete(name); } },
      contains(n) { return cls.has(n); },
    },
    querySelector(sel) { return sel === '#ab-lock' ? btn : null; },
  };
}

// NOTE: no version-identity assertions here on purpose. Nine release suites
// (test_v7038 .. test_v7047) already pin KRAFTED_VERSION, the title and the
// three sw.js positions, and each is mutation-tested by its own script. This
// suite is about one thing - the compare lock - the way test_v7038_tidy.js is
// about tidy and nothing else. Duplicating the version checks here would also
// mean duplicating them in a mutate script, and version_scan.py only reads
// mutation blocks written with the `mutate`/`mutsw` shell helper, which this
// script's Python-driven harness is not.

// ═══ 1. the lock defaults to ON ════════════════════════════════════════
// Independent of the init object: the shipped markup must ALSO start locked,
// otherwise there is one paint of the unlocked state before JS catches up.
has("dragging: false, locked: true }", '_ab.locked starts true');
has('class="ab-lock active"', 'the lock button ships in the active (locked) state');

// Scoped to _abEnsureEl on purpose. A bare search for
// `el.classList.add('locked')` matches three places — the two item-locking
// calls at the top of the file satisfy it even when this one is deleted,
// so the assertion would prove nothing.
const ensureSrc = fnFull('_abEnsureEl', SRC);
ok(ensureSrc.length > 0, '_abEnsureEl exists');
ok(/classList\.add\('locked'\)/.test(ensureSrc),
   '_abEnsureEl creates the element already locked');

// ═══ 2. the CSS that actually blocks the board ═════════════════════════
// These three are the whole mechanism. Losing any one reopens the bug.
// Each is asserted as a FULL rule: the substring `user-drag:none` alone is
// already satisfied by the unrelated `.item img` rule near the top, which
// would let this rule be deleted without a single complaint.
has('#ab-compare.locked #ab-stage img { -webkit-user-drag:none; user-drag:none; pointer-events:none; }',
    'locked images cannot be dragged');
has('#ab-compare.locked #ab-stage { touch-action:none; }', 'locked stage blocks touch gestures');

// ═══ 3. the stage swallows the event when locked ═══════════════════════
const holdBlock = SRC.slice(SRC.indexOf("stage.addEventListener('pointerdown'"),
                            SRC.indexOf("window.addEventListener('pointerup'"));
has("if (_ab.locked) ev.preventDefault();",
    'hold pointerdown calls preventDefault when locked', holdBlock);
has("ev.stopPropagation();",
    'hold pointerdown stops propagation (the board never sees it)', holdBlock);

// ═══ 4. abSyncLockUI — executed, not merely asserted to exist ═══════════
const syncSrc = fnFull('abSyncLockUI', SRC);
const toggleSrc = fnFull('abToggleLock', SRC);
ok(syncSrc.length > 0, 'abSyncLockUI exists');
ok(toggleSrc.length > 0, 'abToggleLock exists');

if (syncSrc && toggleSrc) {
  const sandbox = {};
  const runner = new Function('_ab', `
    ${syncSrc}
    ${toggleSrc}
    return { sync: abSyncLockUI, toggle: abToggleLock };
  `);

  // locked -> closed lock icon, active button, locked class on the element
  const a = mockEl();
  const api1 = runner({ el: a, locked: true });
  api1.sync();
  ok(a._cls.has('locked'), 'abSyncLockUI adds .locked to the element when locked');
  ok(a._btn._cls.has('active'), 'abSyncLockUI marks the button active when locked');
  eq(a._icon.textContent, '\u{1F512}', 'abSyncLockUI shows the closed lock when locked');
  ok(/blocked/i.test(a._btn.title), 'the locked title says board interaction is blocked');

  // unlocked -> open lock icon, inactive button, no locked class
  const b = mockEl();
  const api2 = runner({ el: b, locked: false });
  api2.sync();
  ok(!b._cls.has('locked'), 'abSyncLockUI removes .locked when unlocked');
  ok(!b._btn._cls.has('active'), 'abSyncLockUI clears the active class when unlocked');
  eq(b._icon.textContent, '\u{1F513}', 'abSyncLockUI shows the open lock when unlocked');
  ok(/Unlocked/i.test(b._btn.title), 'the unlocked title says dragging may reach the board');

  // toggling flips the flag and re-renders through the SAME helper
  const c = mockEl();
  const state = { el: c, locked: true };
  const api3 = runner(state);
  api3.sync();
  ok(c._cls.has('locked'), 'setup: starts locked');
  state.locked = !state.locked;
  api3.sync();
  ok(!c._cls.has('locked'), 'after the flag flips, abSyncLockUI clears .locked');

  // the shipped abToggleLock must delegate to abSyncLockUI, not hand-roll it —
  // two render paths is exactly how this project's icons drift out of sync.
  ok(!/\.classList\.(add|remove)\('locked'/.test(toggleSrc),
     'abToggleLock does not hand-roll the class; it calls abSyncLockUI');
  ok(/abSyncLockUI\(\)/.test(toggleSrc), 'abToggleLock calls abSyncLockUI');
}

// ═══ 5. openABCompare re-syncs, so the UI cannot drift ═════════════════
const openSrc = fnFull('openABCompare', SRC);
ok(openSrc.length > 0, 'openABCompare exists');
if (openSrc) {
  ok(/abSyncLockUI\(\)/.test(openSrc),
     'openABCompare re-syncs the lock UI on every open');
}

// ═══ 6. the keyboard path reaches the same function ════════════════════
has("if (k === 'l' || k === 'L')", 'the L key is handled');
const keyRegion = SRC.slice(SRC.indexOf("if (k === 'l' || k === 'L')"),
                            SRC.indexOf("if (k === 'l' || k === 'L')") + 120);
has('abToggleLock()', 'the L key calls abToggleLock', keyRegion);

console.log(`\ntest_v7048 — ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  fails.forEach(f => console.log('  FAIL  ' + f));
  process.exit(1);
}
console.log('ALL PASS');
