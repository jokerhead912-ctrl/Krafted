// Final audit: vendored code excluded, functions de-duplicated, and every big
// function cross-referenced against the test suite.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// acorn is an optional dependency and ESM ignores NODE_PATH, so resolve
// it from the managed node workspace explicitly when a plain import
// fails. The gate (review_lint.py) has NO dependencies on purpose;
// this deep-audit script is allowed to need one.
const require = createRequire(import.meta.url);
const ACORN_PATHS = [
  'acorn',
  '/Users/kincheung/.workbuddy/binaries/node/workspace/node_modules/acorn',
];
let acorn = null;
for (const p of ACORN_PATHS) {
  try { acorn = require(p); break; } catch (e) { /* try next */ }
}
if (!acorn) {
  console.error('audit_ast: acorn not found. Install it with:');
  console.error('  npm --prefix ~/.workbuddy/binaries/node/workspace install acorn');
  process.exit(2);
}

const ROOT = '/Users/kincheung/WorkBuddy/2026-07-25-10-53-37';
const SRC = path.join(ROOT, 'kraftpub-dev.html');
const raw = fs.readFileSync(SRC, 'utf8');

const blocks = [];
const re = /<script\b([^>]*)>/gi;
let m;
while ((m = re.exec(raw))) {
  const attrs = m[1] || '';
  // only plain JS: no type, or an explicitly JS-ish type
  const ty = (attrs.match(/type\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
  if (ty && !/^(text\/javascript|application\/javascript|module)$/i.test(ty)) continue;
  const a = m.index + m[0].length;
  const closeRe = /<\/script\s*>/gi;
  closeRe.lastIndex = a;
  const c = closeRe.exec(raw);
  if (!c) continue;                       // unterminated -> not a real block
  let nl = 0;
  for (let i = 0; i < a; i++) if (raw[i] === '\n') nl++;
  blocks.push({ offset: nl, code: raw.slice(a, c.index), tag: m[0] });
}

const BRANCH = new Set(['IfStatement', 'ForStatement', 'ForInStatement',
  'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'TryStatement',
  'SwitchCase', 'ConditionalExpression']);
const FN = new Set(['FunctionDeclaration', 'FunctionExpression',
  'ArrowFunctionExpression']);

const funcs = [];
let emptyCatch = 0, catchTotal = 0, looseEq = 0, topDecls = 0, maxDepth = 0;
const fails = [];
let parsedLines = 0, vendoredLines = 0, parsedBlocks = 0;

// `count` gates the GLOBAL tallies. Per-function branch walks must run with
// count=false, otherwise every try/catch inside a function is counted twice
// (once by the per-function walk, once by the whole-file walk) — that is how
// an earlier run reported 2,078 catch clauses when there are ~700.
function walk(node, depth, acc, count) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const c of node) walk(c, depth, acc, count); return; }
  if (typeof node.type !== 'string') return;
  if (!FN.has(node.type) && depth > maxDepth) maxDepth = depth;
  if (BRANCH.has(node.type)) acc.n++;
  if (node.type === 'LogicalExpression' &&
      (node.operator === '&&' || node.operator === '||')) acc.n++;
  if (count) {
    if (node.type === 'CatchClause') {
      catchTotal++;
      const b = node.body && node.body.body;
      if (!b || b.length === 0) emptyCatch++;
    }
    if (node.type === 'BinaryExpression' &&
        (node.operator === '==' || node.operator === '!=')) looseEq++;
  }
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'range') continue;
    const v = node[k];
    if (v && typeof v === 'object') walk(v, depth + 1, acc, count);
  }
}

for (const blk of blocks) {
  const code = blk.code;
  if (code.trim().length < 30) continue;
  const lines = code.split('\n');
  // Blank out minified/vendored MEGA-lines (JSZip &co) instead of dropping
  // the whole block - dropping it would skip the entire application.
  let vend = 0;
  const kept = lines.map(l => { if (l.length > 400) { vend++; return ''; } return l; });
  vendoredLines += vend;
  const src = kept.join('\n');
  let ast;
  try {
    ast = acorn.parse(src, {
      ecmaVersion: 'latest', sourceType: 'script', locations: true,
      allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true,
      allowSuperOutsideMethod: true, allowHashBang: true,
    });
  } catch (e) {
    fails.push({ line: blk.offset + 1, msg: String(e.message).slice(0, 90) });
    continue;
  }
  parsedBlocks++;
  parsedLines += lines.length;
  topDecls += ast.body.length;
  (function collect(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(collect); return; }
    if (typeof node.type !== 'string') return;
    if (FN.has(node.type)) {
      const nm = node.id && node.id.name ? node.id.name : '<anon>';
      const acc = { n: 0 };
      walk(node.body, 1, acc, false);
      funcs.push({
        name: nm,
        start: node.loc.start.line + blk.offset,
        end: node.loc.end.line + blk.offset,
        lines: node.loc.end.line - node.loc.start.line + 1,
        branches: acc.n,
      });
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'range') continue;
      const v = node[k];
      if (v && typeof v === 'object') collect(v);
    }
  })(ast);
  walk(ast, 0, { n: 0 }, true);
}

// de-duplicate identical (name,start,end)
const seen = new Set();
const uf = funcs.filter(f => {
  const k = f.name + ':' + f.start + ':' + f.end;
  if (seen.has(k)) return false;
  seen.add(k); return true;
});

console.log('parsed blocks     :', parsedBlocks, '· lines:', parsedLines,
            '· vendored lines skipped:', vendoredLines);
console.log('parse failures    :', fails.length);
fails.forEach(f => console.log('   line', f.line, '->', f.msg));
console.log('functions         :', uf.length);
console.log('catch clauses     :', catchTotal, '· empty:', emptyCatch,
            '(' + (100 * emptyCatch / Math.max(catchTotal, 1)).toFixed(1) + '%)');
console.log('loose == / !=     :', looseEq);
console.log('top-level decls   :', topDecls);
console.log('max nesting depth :', maxDepth);

const ls = uf.map(f => f.lines).sort((a, b) => a - b);
const q = p => ls[Math.min(ls.length - 1, Math.floor(ls.length * p))];
console.log('\nfunction length   : median %d | p90 %d | p95 %d | p99 %d | max %d',
  q(0.5), q(0.9), q(0.95), q(0.99), ls[ls.length - 1]);
const tot = ls.reduce((a, b) => a + b, 0);
for (const th of [50, 100, 200]) {
  const g = uf.filter(f => f.lines > th);
  console.log('  >%d lines: %d fns (%s%% of fn lines)', th, g.length,
    (100 * g.reduce((a, f) => a + f.lines, 0) / Math.max(tot, 1)).toFixed(1));
}

// --- cross-reference the biggest functions against the test suite --------
const testDir = path.join(ROOT, 'Krafted/tests');
const testFiles = fs.readdirSync(testDir)
  .filter(f => /^(test_|smoke_|mutate_)/.test(f))
  .map(f => path.join(testDir, f));
let testBlob = '';
for (const f of testFiles) testBlob += fs.readFileSync(f, 'utf8') + '\n';
console.log('\ntest files read   :', testFiles.length,
            '·', testBlob.length, 'chars');

const named = uf.filter(f => f.name !== '<anon>');
named.sort((a, b) => b.lines - a.lines);
const top = named.slice(0, 20);
console.log('\n  %s %s %s %s',
  'function'.padEnd(30), 'lines'.padStart(6), 'branch'.padStart(7),
  '  referenced in tests?');
let untested = 0;
for (const f of top) {
  const re2 = new RegExp('\\b' + f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
  const hit = re2.test(testBlob);
  if (!hit) untested++;
  console.log('  %s %s %s   L%d-%d  %s',
    f.name.slice(0, 30).padEnd(30), String(f.lines).padStart(6),
    String(f.branches).padStart(7), f.start, f.end,
    hit ? 'yes' : 'NO  <-- no test mentions it');
}
console.log('\n  %d of the 20 largest named functions are never mentioned in any test',
  untested);

// overall: of all named functions >100 lines, how many are unmentioned
const big = named.filter(f => f.lines > 100);
const bigUn = big.filter(f => !new RegExp('\\b' +
  f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(testBlob));
console.log('  %d of %d named functions >100 lines are never mentioned in any test',
  bigUn.length, big.length);
console.log('  they are: ' + bigUn.map(f => f.name + '(L' + f.start + ')').join(', '));
