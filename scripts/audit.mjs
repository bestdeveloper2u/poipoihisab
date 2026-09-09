#!/usr/bin/env node
/**
 * Runs every audit, one exit code.
 *
 * Runs them ALL even after one fails, rather than stopping at the first. Five
 * separate blocked commits, discovered one per attempt, is what makes a wiring
 * problem feel like an architecture problem. One report, every problem, each
 * with its own fix.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './_lib.mjs';

const here = join(ROOT, 'scripts');
const audits = readdirSync(here)
  .filter((f) => f.startsWith('audit-') && f.endsWith('.mjs'))
  .sort();

if (audits.length === 0) {
  console.log('no audit-*.mjs scripts found in scripts/');
  process.exit(1);
}

const failed = [];
for (const audit of audits) {
  console.log(`\n── ${audit} ${'─'.repeat(Math.max(0, 44 - audit.length))}`);
  const run = spawnSync(process.execPath, [join(here, audit)], {
    stdio: 'inherit',
    cwd: ROOT,
  });
  if (run.status !== 0) failed.push(audit);
}

console.log('');
if (failed.length > 0) {
  console.log(`✗ ${failed.length} audit(s) failed: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`✓ all ${audits.length} audits passed`);
