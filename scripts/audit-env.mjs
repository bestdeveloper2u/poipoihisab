#!/usr/bin/env node
/**
 * Environment variables, checked in BOTH directions, across BOTH runtimes.
 *
 * The forward direction is obvious: a variable the code reads that is missing
 * from the example file is a fresh clone that boots and then dies somewhere
 * unrelated.
 *
 * The reverse direction is the one people skip and the one that costs more. A
 * variable in the example file that nothing reads is dead config: it gets
 * copied into every real environment, set to a plausible value, and believed.
 * Somebody eventually changes it to fix something and nothing happens, which
 * is a worse afternoon than a missing variable.
 *
 * ── WHY THIS REPLACES THE SHIPPED audit-env.mjs ────────────────────────────
 *
 * The kit's version scans JavaScript for `process.env.X` / `import.meta.env.X`.
 * Two thirds of this application's configuration is not shaped like that: the
 * API reads its settings through pydantic-settings, where the source of truth
 * is a lowercase FIELD on the Settings class plus an `env_prefix`, and the
 * string "POIPOIHISAB_DATABASE_URL" appears nowhere in the Python at all.
 *
 * Run unmodified, the JS-only scan finds two variables, so all thirteen API
 * variables come back as "in .env.example but nothing reads it" — thirteen
 * false errors on the first run. The rule for adding audits says an escape
 * hatch must be data rather than a skip list, so the fix is to read the real
 * source of truth (the Settings fields) rather than to ignore the prefix.
 *
 * This matters beyond tidiness. POIPOIHISAB_KV_URL left unset makes the API
 * fall back to in-process MemoryKV, which on serverless signs every user out
 * on each cold start and silently resets the brute-force limiter. A variable
 * whose absence is that expensive has to be in the example file, and the only
 * thing that keeps it there is a gate.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CODE, ROOT, config, read, reporter, walk } from './_lib.mjs';

const cfg = config();
const r = reporter('env');
const example = read(cfg.envExample);

if (example === null) {
  console.log(`— skipped: ${cfg.envExample} not found`);
  process.exit(0);
}

const declared = new Set();
for (const line of example.split('\n')) {
  const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
  if (m) declared.add(m[1]);
}

const used = new Map(); // name -> where we saw it, for the error message
const see = (name, where) => {
  if (!used.has(name)) used.set(name, where);
};
const ignore = new Set(cfg.envIgnore);
let scanned = 0;

/* ── JavaScript / TypeScript ────────────────────────────────────────────── */
for (const dir of cfg.sourceDirs) {
  for (const file of walk(dir, (f) => CODE.test(f))) {
    scanned++;
    const src = readFileSync(join(ROOT, file), 'utf8');
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) see(m[1], file);
    for (const m of src.matchAll(/process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g)) see(m[1], file);
    for (const m of src.matchAll(/import\.meta\.env\.([A-Z][A-Z0-9_]*)/g)) see(m[1], file);
  }
}

/* ── Python: pydantic-settings fields, prefixed ─────────────────────────────
   A field on the Settings class IS the variable, once the prefix is applied.
   `model_config` is the settings block itself, not a setting. */
const api = cfg.api ?? {};
let apiFields = 0;
if (api.settings) {
  const src = read(api.settings);
  if (src === null) {
    r.error(`${api.settings} not found — the API's settings are the source of truth for its variables`);
  } else {
    scanned++;
    const prefix = api.envPrefix ?? '';
    const body = src.slice(src.search(/^class Settings\b/m));
    for (const m of body.matchAll(/^    ([a-z][a-z0-9_]*)\s*:/gm)) {
      if (m[1] === 'model_config') continue;
      apiFields++;
      see(prefix + m[1].toUpperCase(), api.settings);
    }
    if (apiFields === 0) {
      r.error(`no Settings fields parsed from ${api.settings} — the parser has drifted from the file`);
    }
  }
}

for (const [name, where] of used) {
  if (ignore.has(name)) continue;
  if (!declared.has(name)) r.error(`${name} is read by ${where} but missing from ${cfg.envExample}`);
}
for (const name of declared) {
  if (ignore.has(name)) continue;
  if (!used.has(name)) r.error(`${name} is in ${cfg.envExample} but nothing reads it`);
}

console.log(`env: ${declared.size} declared, ${used.size} read (${apiFields} API settings field(s)), ${scanned} file(s) scanned`);
if (r.finish()) r.ok(`${cfg.envExample} and the code agree, in both directions, across both runtimes`);
