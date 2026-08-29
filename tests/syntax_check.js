#!/usr/bin/env node
/*
 * syntax_check.js — parse every inline <script> in a single-file HTML app.
 *
 * Usage:  node syntax_check.js <path-to.html>
 *
 * Krafted is one HTML file with several inline scripts. An unbalanced
 * brace introduced by a surgical edit is invisible until the browser
 * throws at load, and then the whole app is dead. This catches it in
 * one second instead.
 *
 * Exit code 0 = clean, 1 = syntax errors found.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');

const file = process.argv[2];
if (!file) { console.error('usage: node syntax_check.js <file.html>'); process.exit(2); }

const src = fs.readFileSync(file, 'utf8');

// Collect inline scripts that are NOT type="module", NOT src=, and NOT a
// non-JS type (application/json templates, etc).
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const blocks = [];
let m;
while ((m = re.exec(src)) !== null) {
  const attrs = m[1] || '';
  const body = m[2] || '';
  if (/\bsrc\s*=/i.test(attrs)) continue;
  if (/type\s*=\s*["']?(?!text\/javascript|module|application\/javascript)/i.test(attrs)) continue;
  if (!body.trim()) continue;
  const line = src.slice(0, m.index).split('\n').length;
  blocks.push({ line, body, isModule: /type\s*=\s*["']?module/i.test(attrs) });
}

let errors = 0;
blocks.forEach((b, i) => {
  try {
    if (b.isModule) new vm.SourceTextModule(b.body);
    else new vm.Script(b.body, { filename: `inline#${i + 1}` });
  } catch (e) {
    errors++;
    console.error(`  inline#${i + 1} (starts line ${b.line}): ${e.message}`);
  }
});

console.log(`Checked ${blocks.length} inline scripts, ${errors} syntax error(s).`);
process.exit(errors ? 1 : 0);
