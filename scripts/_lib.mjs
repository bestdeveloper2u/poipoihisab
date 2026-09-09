/**
 * Shared plumbing for the audits. Node built-ins only, on purpose: an audit
 * layer that needs `npm install` to run is an audit layer that does not run on
 * the machine where it matters.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The repo root, resolved from THIS FILE rather than from `process.cwd()`.
 *
 * Every path below hangs off it. Resolving from cwd would make each audit pass
 * from the root and fail from anywhere else — which is the exact defect
 * `audit-test-paths.mjs` exists to catch, and an audit that commits it has no
 * standing to complain.
 */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  docs: {
    roadmap: 'ROADMAP.md',
    status: 'STATUS.md',
    backlog: 'BACKLOG.md',
    slicesSection: '## Part 5',
    slicePattern: 'R\\d+\\.\\d+',
  },
  workspaces: [],
  envExample: '.env.example',
  envIgnore: [],
  vocabulary: [],
  sourceDirs: ['apps', 'packages', 'src', 'lib'],
  testDir: 'test',
};

export function config() {
  let raw = {};
  try {
    raw = JSON.parse(readFileSync(join(ROOT, 'audit.config.json'), 'utf8'));
  } catch {
    // Absent is fine and means "defaults". Malformed is not, and throws here
    // rather than surfacing later as an audit that silently checked nothing.
  }
  return { ...DEFAULTS, ...raw, docs: { ...DEFAULTS.docs, ...(raw.docs ?? {}) } };
}

export function read(path) {
  try {
    return readFileSync(join(ROOT, path), 'utf8');
  } catch {
    return null;
  }
}

export function exists(path) {
  try {
    statSync(join(ROOT, path));
    return true;
  } catch {
    return false;
  }
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output',
  'coverage', '.turbo', 'generated', '.venv', '__pycache__', 'vendor',
]);

/** Every file under `dir` whose name matches `test`, skipping build output. */
export function walk(dir, test, out = []) {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(rel, test, out);
    } else if (test(entry.name, rel)) {
      out.push(rel);
    }
  }
  return out;
}

/** Directories matching the `apps/*`-style globs in the config. */
export function workspaceDirs(cfg) {
  const dirs = [];
  for (const pattern of cfg.workspaces) {
    if (!pattern.endsWith('/*')) {
      if (exists(join(pattern, 'package.json'))) dirs.push(pattern);
      continue;
    }
    const parent = pattern.slice(0, -2);
    let entries;
    try {
      entries = readdirSync(join(ROOT, parent), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const dir = join(parent, entry.name);
      if (exists(join(dir, 'package.json'))) dirs.push(dir);
    }
  }
  return dirs;
}

export const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte|astro)$/;

/**
 * One reporter, so every audit's output looks the same.
 *
 * `ok()` exists and is used deliberately: an audit that prints nothing on
 * success is indistinguishable from an audit that is broken, or from one whose
 * glob stopped matching six months ago.
 */
export function reporter(name) {
  const errors = [];
  const warnings = [];
  return {
    error: (msg) => errors.push(msg),
    warn: (msg) => warnings.push(msg),
    note: (msg) => console.log(`  ${msg}`),
    ok: (msg) => console.log(`✓ ${msg}`),
    skip: (why) => console.log(`— skipped: ${why}`),
    finish() {
      for (const w of warnings) console.log(`  ⚠ ${w}`);
      for (const e of errors) console.log(`  ✗ ${e}`);
      if (errors.length > 0) {
        console.log(`\n${name}: ${errors.length} error(s)`);
        process.exitCode = 1;
      }
      return errors.length === 0;
    },
  };
}

export { relative };
