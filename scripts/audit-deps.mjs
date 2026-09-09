#!/usr/bin/env node
/**
 * Every workspace package a file IMPORTS must be DECLARED by the package that
 * contains it.
 *
 * A monorepo hoists, so an undeclared import resolves perfectly on the machine
 * that wrote it. The failure appears at install time on somebody else's
 * machine, as "Cannot find module" in a file that reads correctly — which sends
 * them looking in the wrong place.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CODE, ROOT, config, reporter, walk, workspaceDirs } from './_lib.mjs';

const cfg = config();
const r = reporter('deps');
const dirs = workspaceDirs(cfg);

if (dirs.length === 0) {
  console.log('— skipped: no workspaces configured (set "workspaces" in audit.config.json)');
  process.exit(0);
}

/* Every workspace package name, so we only judge INTERNAL imports. A missing
   third-party dependency is npm's job to notice; a missing internal one is
   nobody's. */
const own = new Map();
for (const dir of dirs) {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
    if (pkg.name) own.set(pkg.name, dir);
  } catch {
    r.error(`${dir}/package.json is unreadable`);
  }
}

const IMPORT = /(?:from|import\s*\(?|require\s*\()\s*['"]([^'"]+)['"]/g;
let checked = 0;
let found = 0;

for (const [name, dir] of own) {
  const pkg = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);

  for (const file of walk(dir, (f) => CODE.test(f))) {
    checked++;
    const src = readFileSync(join(ROOT, file), 'utf8');
    for (const m of src.matchAll(IMPORT)) {
      const spec = m[1];
      // Resolve `@scope/pkg/sub` back to `@scope/pkg`.
      const base = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (!own.has(base)) continue;
      found++;
      if (base === name) continue; // a package importing itself by name is a different bug
      if (!declared.has(base)) {
        r.error(`${file} imports ${base}, which ${dir}/package.json does not declare`);
      }
    }
  }
}

console.log(`deps: ${own.size} workspace(s), ${checked} file(s), ${found} internal import(s)`);
if (r.finish()) r.ok('every workspace import is declared by the package that makes it');
