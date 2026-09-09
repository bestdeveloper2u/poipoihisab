#!/usr/bin/env node
/**
 * Snapshot the working tree to a git ref, so a merge cannot eat uncommitted
 * work.
 *
 * ── WHY NOT `git stash` ────────────────────────────────────────────────────
 *
 * Because stash MUTATES THE WORKING TREE, and the moment you want a safety net
 * is the moment you can least afford your files to move. This writes a commit
 * object out of a TEMPORARY INDEX and points a ref at it. It never touches
 * HEAD, never touches the real index, never touches a file on disk. Running it
 * is unobservable except for the new ref.
 *
 * ── WHY IT NEVER FAILS ITS CALLER ──────────────────────────────────────────
 *
 * It is meant to be wired in front of risky operations. A safety net that can
 * abort the thing it protects is worse than no net, so every failure path here
 * prints and exits 0.
 *
 * Usage:
 *   node scripts/wip-snapshot.mjs            snapshot now
 *   node scripts/wip-snapshot.mjs --list     list snapshots with runnable recovery commands
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEEP = 40;
const PREFIX = 'refs/wip/';

function git(args, env = {}) {
  return spawnSync('git', args, { encoding: 'utf8', env: { ...process.env, ...env } });
}

function bail(message) {
  console.log(`wip: ${message}`);
  process.exit(0); // never fail the caller
}

if (git(['rev-parse', '--git-dir']).status !== 0) bail('not a git repository — nothing to snapshot');

/* ── --list ────────────────────────────────────────────────────────────────
   Printing the command with the REAL ref already substituted is the whole
   point of this branch. A first version printed `git show refs/wip/<ts>`; the
   placeholder was pasted literally, git answered "ambiguous argument", and in
   PowerShell `<` is a reserved redirection operator, so the recovery path
   failed twice in two different ways at the worst possible moment.
   Recovery instructions with a placeholder in them are not instructions. */
if (process.argv.includes('--list')) {
  const refs = git(['for-each-ref', '--sort=-creatordate', '--format=%(refname)\t%(creatordate:iso)', PREFIX]);
  const lines = refs.stdout.trim().split('\n').filter(Boolean);
  if (lines.length === 0) bail('no snapshots yet');
  console.log(`${lines.length} snapshot(s), newest first:\n`);
  for (const line of lines) {
    const [ref, date] = line.split('\t');
    const stat = git(['show', '--stat', '--oneline', ref]);
    const files = (stat.stdout.match(/(\d+) files? changed/) ?? [null, '?'])[1];
    console.log(`  ${date}  ${files} file(s)`);
    console.log(`    inspect:  git show --stat ${ref}`);
    console.log(`    diff:     git diff HEAD ${ref}`);
    console.log(`    one file: git checkout ${ref} -- path/to/file`);
    console.log(`    all:      git checkout ${ref} -- .`);
    console.log('');
  }
  process.exit(0);
}

/* ── snapshot ─────────────────────────────────────────────────────────────── */
const head = git(['rev-parse', 'HEAD']);
if (head.status !== 0) bail('no commits yet — nothing to snapshot against');

const dirty = git(['status', '--porcelain']);
if (dirty.stdout.trim() === '') bail('working tree matches HEAD — nothing to snapshot');

// A temporary index, so the real one is untouched. `git add -A` against
// GIT_INDEX_FILE stages into the temp file and leaves the user's staged/unstaged
// split exactly as it was.
const dir = mkdtempSync(join(tmpdir(), 'wip-'));
const index = join(dir, 'index');
const env = { GIT_INDEX_FILE: index };

try {
  if (git(['read-tree', 'HEAD'], env).status !== 0) bail('could not read HEAD into a temporary index');
  if (git(['add', '-A'], env).status !== 0) bail('could not stage the working tree');

  const tree = git(['write-tree'], env);
  if (tree.status !== 0) bail('could not write the tree object');
  const treeId = tree.stdout.trim();

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15);
  const ref = `${PREFIX}${stamp}`;

  const commit = git(['commit-tree', treeId, '-p', head.stdout.trim(), '-m', `wip snapshot ${stamp}`]);
  if (commit.status !== 0) bail('could not write the commit object');

  if (git(['update-ref', ref, commit.stdout.trim()]).status !== 0) bail('could not update the ref');

  const count = dirty.stdout.trim().split('\n').length;
  console.log(`wip: ${ref} (${count} file(s)) — recover with: git show --stat ${ref}`);
  console.log(`wip: all snapshots — node scripts/wip-snapshot.mjs --list`);

  // Prune oldest beyond KEEP.
  const all = git(['for-each-ref', '--sort=-creatordate', '--format=%(refname)', PREFIX])
    .stdout.trim().split('\n').filter(Boolean);
  for (const old of all.slice(KEEP)) git(['update-ref', '-d', old]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
