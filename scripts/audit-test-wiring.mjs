#!/usr/bin/env node
/**
 * A test suite that runs is not the same as a test suite that runs everything.
 *
 * Four ways a green run means nothing, all of them silent:
 *
 *   1. `--passWithNoTests` in a package that HAS tests — the day a glob breaks,
 *      the suite reports success having executed zero files.
 *   2. No exclusion of build output — a spec and its compiled copy both run, so
 *      the count doubles and a stale copy can pass after the source stopped.
 *   3. An unscoped `include` — the runner walks the whole tree looking for
 *      specs, which is slow until the day it picks up a fixture and fails.
 *   4. A package whose test script exists but whose config does not.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, config, exists, reporter, walk, workspaceDirs } from './_lib.mjs';

const cfg = config();
const r = reporter('test-wiring');
const dirs = [...workspaceDirs(cfg), '.'];
/*
  ADAPTED for this repo, twice.

  1. `vite.config.ts` is in the list. A Vitest-in-Vite project declares its
     `test` block there and ships no vitest.config at all — apps/web does.
     Without this entry the audit reports "has specs but no runner config" on a
     completely normal setup, and an audit that fires falsely gets disabled,
     which is worse than not having it.

  2. `testDir` may be a list. apps/web keeps unit specs beside their source in
     `src/` and screen-level specs in `tests/` (60 files across the two);
     packages/core keeps its two in `src/`. A single directory cannot describe
     that, and forcing one would mean moving 60 files to satisfy a tool.
*/
const CONFIGS = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs', 'vite.config.ts', 'vite.config.js', 'jest.config.ts', 'jest.config.js', 'jest.config.mjs', 'jest.config.json'];
const testDirs = (cfg) => (Array.isArray(cfg.testDir) ? cfg.testDir : [cfg.testDir]);

let runners = 0;
let specs = 0;

for (const dir of dirs) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  const script = pkg.scripts?.test ?? '';
  if (!/vitest|jest/.test(script)) continue;
  runners++;

  const dirsWithSpecs = [];
  const here = [];
  for (const td of testDirs(cfg)) {
    const found = walk(join(dir, td), (f) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(f));
    if (found.length > 0) dirsWithSpecs.push(td);
    here.push(...found);
  }
  specs += here.length;

  if (/--passWithNoTests/.test(script) && here.length > 0) {
    r.error(`${dir}: test script carries --passWithNoTests and ${here.length} spec(s) exist — a broken glob would report success`);
  }
  if (!/--passWithNoTests/.test(script) && here.length === 0) {
    r.warn(`${dir}: no specs under ${testDirs(cfg).join('/, ')}/ and no --passWithNoTests — the run will fail rather than skip`);
  }

  const found = CONFIGS.find((c) => exists(join(dir, c)));
  if (found === undefined) {
    if (here.length > 0) r.error(`${dir}: runs a test runner and has specs, but no runner config`);
    continue;
  }

  const conf = readFileSync(join(ROOT, dir, found), 'utf8');
  if (!/dist|build|\.output/.test(conf)) {
    r.error(`${dir}/${found}: nothing excludes build output — a spec and its compiled copy will both run`);
  }
  const include = conf.match(/include\s*:\s*\[([^\]]*)\]/s);
  if (include === null) {
    r.warn(`${dir}/${found}: no explicit include — the runner walks the whole package`);
  } else {
    /* Every directory that actually holds specs must be named. Checking only
       one of them would let a whole spec directory fall out of the run while
       the audit stayed green. */
    for (const td of dirsWithSpecs) {
      if (!include[1].includes(td)) {
        r.error(`${dir}/${found}: include does not name ${td}/, which holds spec files`);
      }
    }
  }
}

if (runners === 0) {
  console.log('— skipped: no package runs vitest or jest');
  process.exit(0);
}
console.log(`test-wiring: ${runners} package(s) run a test runner, ${specs} spec file(s) between them`);
if (r.finish()) r.ok('every test run is scoped, excludes its build output, and cannot pass empty');
