#!/usr/bin/env node
/**
 * One report of every toolchain problem, each with its fix.
 *
 * ── WHY THIS EXISTS AS A SCRIPT AND NOT A PARAGRAPH IN A README ────────────
 *
 * Because toolchain problems are discovered ONE BLOCKED COMMIT AT A TIME. You
 * fix the node version, hit the missing install, fix that, hit the missing env
 * file. Four separate failures over an afternoon feel like a framework that
 * does not work, and that feeling is what produces a rewrite proposal. Seen
 * together in one output they are obviously four small things.
 *
 * So it never stops at the first problem. It collects everything and prints it
 * with a fix per line.
 *
 * EXTEND THIS. The checks below are the ones true of every project; the
 * valuable ones are yours — is the database reachable, is the container
 * running, is the generated client newer than the schema that produced it. Add
 * a check the first time you have to explain a setup problem to someone.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, config, exists } from './_lib.mjs';

const cfg = config();
const problems = [];
const ok = [];

const need = (label, condition, fix) => (condition ? ok.push(label) : problems.push({ label, fix }));

/* Node version, read from package.json's own engines field rather than
   hardcoded — a doctor that disagrees with the manifest is one more thing to
   reconcile. */
let engines = null;
try {
  engines = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).engines?.node ?? null;
} catch {
  problems.push({ label: 'package.json', fix: 'missing or unparseable at the repo root' });
}
if (engines) {
  const want = Number((engines.match(/(\d+)/) ?? [])[1]);
  const have = Number(process.versions.node.split('.')[0]);
  need(`node ${process.versions.node} (want ${engines})`, have >= want,
    `install node ${want} or newer — nvm use ${want}`);
}

need('dependencies installed', exists('node_modules'),
  'run your package manager install');

if (cfg.envExample) {
  need(`${cfg.envExample} present`, exists(cfg.envExample),
    `create ${cfg.envExample} — the audits and a fresh clone both read it`);
  const real = cfg.envExample.replace(/\.example$/, '');
  if (real !== cfg.envExample) {
    need(`${real} present`, exists(real),
      `cp ${cfg.envExample} ${real} and fill in the values`);
  }
}

for (const [label, path] of [['plan', cfg.docs.roadmap], ['status', cfg.docs.status], ['backlog', cfg.docs.backlog]]) {
  need(`${label} (${path})`, exists(path), `create ${path} — see the starter kit`);
}

const git = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' });
need('git repository', git.status === 0, 'git init — the snapshot script needs one');

if (git.status === 0) {
  const ahead = spawnSync('git', ['log', '--oneline', '@{u}..'], { encoding: 'utf8' });
  if (ahead.status === 0 && ahead.stdout.trim() !== '') {
    problems.push({
      label: `${ahead.stdout.trim().split('\n').length} unpushed commit(s)`,
      fix: 'git push — never end a session with unpushed commits',
    });
  }
}

for (const line of ok) console.log(`  ✓ ${line}`);
if (problems.length === 0) {
  console.log('\n✓ doctor: nothing to fix');
  process.exit(0);
}
console.log('');
for (const p of problems) console.log(`  ✗ ${p.label}\n      fix: ${p.fix}`);
console.log(`\n✗ doctor: ${problems.length} problem(s)`);
process.exit(1);
