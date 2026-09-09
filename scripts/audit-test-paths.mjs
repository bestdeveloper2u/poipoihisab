#!/usr/bin/env node
/**
 * A spec that reads a repo file must resolve it FROM ITS OWN LOCATION, never
 * relative to the working directory.
 *
 * A cwd-relative literal passes from the repo root and fails from anywhere
 * else: from the package directory, from an IDE runner, from a watch process
 * started in a subfolder. It usually fails as "file not found" on a path that
 * plainly exists, which reads as a broken checkout.
 *
 * The check is disk-verified rather than textual: a string counts as a repo
 * path only if it resolves from the root AND does not resolve from the spec's
 * own directory. That keeps ordinary strings — a URL path, a fixture name, a
 * route under test — out of the results.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT, config, reporter, walk } from './_lib.mjs';

const cfg = config();
const r = reporter('test-paths');
const roots = [...new Set([...cfg.sourceDirs, '.'])];

const specs = new Set();
for (const dir of roots) {
  for (const f of walk(dir, (n) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(n))) specs.add(f);
}

let naming = 0;
for (const spec of specs) {
  const src = readFileSync(join(ROOT, spec), 'utf8');
  const safe = /import\.meta\.url|__dirname/.test(src);
  let flagged = false;

  for (const m of src.matchAll(/['"`]([^'"`\n]*\/[^'"`\n]*)['"`]/g)) {
    const literal = m[1];
    if (literal.startsWith('.') || literal.startsWith('@') || literal.includes('://')) continue;
    if (!existsSync(join(ROOT, literal))) continue;
    if (existsSync(join(ROOT, dirname(spec), literal))) continue;
    flagged = true;
    if (!safe) {
      r.error(`${spec} names "${literal}", which resolves only from the repo root — use new URL('...', import.meta.url)`);
    }
  }
  if (flagged) naming++;
}

console.log(`test-paths: ${specs.size} spec(s), ${naming} naming a repo file`);
if (r.finish()) r.ok('every spec that reads a repo file resolves it from its own location');
