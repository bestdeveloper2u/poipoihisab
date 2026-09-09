#!/usr/bin/env node
/**
 * Every model table has a migration, and the migration chain is linear.
 *
 * ── THE FAILURE THIS PREVENTS ──────────────────────────────────────────────
 *
 * Alembic does not run on a Vercel deploy. Locally a new table appears the
 * moment `Base.metadata.create_all` runs against a fresh SQLite file, so a
 * model with no migration is invisible: the tests pass, the dev server works,
 * and production 500s on the first request that touches it.
 *
 * `ensure_schema_ready` covers the gap at startup for tables it knows about,
 * but that is a hand-maintained list. This audit is the thing that notices the
 * list has fallen behind the models.
 *
 * The second check is the chain. Two migrations sharing a `down_revision` is a
 * branch, and `alembic upgrade head` on a branched history fails with "multiple
 * heads" — at deploy time, which is the worst moment to discover a merge left
 * two revisions pointing at the same parent.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, config, read, reporter } from './_lib.mjs';

const cfg = config();
const r = reporter('migrations');
const api = cfg.api ?? {};

if (!api.modelsDir || !api.migrationsDir) {
  console.log('— skipped: no "api.modelsDir" / "api.migrationsDir" in audit.config.json');
  process.exit(0);
}

/* ── tables declared by the models ──────────────────────────────────────── */
const tables = new Map(); // table -> model file
let modelFiles;
try {
  modelFiles = readdirSync(join(ROOT, api.modelsDir)).filter((f) => f.endsWith('.py'));
} catch {
  r.error(`${api.modelsDir} not readable`);
  r.finish();
  process.exit(1);
}
for (const f of modelFiles) {
  const src = readFileSync(join(ROOT, api.modelsDir, f), 'utf8');
  for (const m of src.matchAll(/__tablename__\s*=\s*["']([a-z_][a-z0-9_]*)["']/g)) {
    tables.set(m[1], `${api.modelsDir}/${f}`);
  }
}

/* ── migrations, their revisions and their parents ──────────────────────── */
let migrationFiles;
try {
  migrationFiles = readdirSync(join(ROOT, api.migrationsDir)).filter((f) => f.endsWith('.py'));
} catch {
  r.error(`${api.migrationsDir} not readable`);
  r.finish();
  process.exit(1);
}

const all = migrationFiles.map((f) => {
  const src = readFileSync(join(ROOT, api.migrationsDir, f), 'utf8');
  return {
    file: f,
    src,
    revision: (src.match(/^revision:\s*str\s*=\s*["']([^"']+)["']/m) ?? [])[1] ?? null,
    down: (src.match(/^down_revision:\s*str\s*\|\s*None\s*=\s*(?:["']([^"']+)["']|None)/m) ?? [])[1] ?? null,
  };
});
const corpus = all.map((m) => m.src).join('\n');

/* ── forward direction: a table with no migration ───────────────────────── */
for (const [table, where] of tables) {
  // create_table("x") in a migration, or the same table created lazily by
  // ensure_schema_ready — either is a real path to the table existing.
  const inMigration = new RegExp(`create_table\\(\\s*["']${table}["']`).test(corpus);
  if (!inMigration) {
    r.error(`${table} is declared in ${where} but no migration creates it — it will not exist in production`);
  }
}

/* ── the chain must be linear ───────────────────────────────────────────── */
const byParent = new Map();
for (const m of all) {
  if (m.revision === null) {
    r.error(`${api.migrationsDir}/${m.file} declares no revision id`);
    continue;
  }
  const key = m.down ?? '<base>';
  if (!byParent.has(key)) byParent.set(key, []);
  byParent.get(key).push(m.revision);
}
for (const [parent, children] of byParent) {
  if (children.length > 1) {
    r.error(`revisions ${children.join(' and ')} both descend from ${parent} — alembic upgrade head will fail with multiple heads`);
  }
}

const revisions = new Set(all.map((m) => m.revision));
for (const m of all) {
  if (m.down !== null && !revisions.has(m.down)) {
    r.error(`${m.file} has down_revision ${m.down}, which no migration declares`);
  }
}

const heads = all.filter((m) => ![...all].some((o) => o.down === m.revision));
if (heads.length > 1) {
  r.error(`${heads.length} heads (${heads.map((h) => h.revision).join(', ')}) — the history is branched`);
}

console.log(`migrations: ${tables.size} model table(s), ${all.length} migration(s), ${heads.length} head`);
if (r.finish()) {
  r.ok(`every model table has a migration and the chain is linear (head ${heads[0]?.revision})`);
}
