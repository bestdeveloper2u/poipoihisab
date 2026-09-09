#!/usr/bin/env node
/**
 * Every route in the admin router must take the superadmin dependency.
 *
 * ── WHY THIS IS A SCRIPT ───────────────────────────────────────────────────
 *
 * Authorisation in this application lives at the API layer and nowhere else.
 * Decision D3 chose our own auth over Supabase Auth, which means there is no
 * row-level security underneath to catch a mistake: the FastAPI dependency IS
 * the enforcement. One handler that forgets `SuperAdminDep` returns every
 * user's expense history, debts and email to any account that can log in.
 *
 * And forgetting it is easy in exactly the way that matters — the parameter is
 * unused inside most handlers, so it is written as `_: SuperAdminDep` and
 * carries no other purpose. There is nothing in the body that breaks when it is
 * missing, no test that fails unless somebody wrote the denied-case test, and
 * the endpoint works perfectly for the admin who is developing it.
 *
 * The router grew from 16 endpoints to 26 in one session. That is the point at
 * which a human reading the diff stops being a reliable check.
 *
 * The check is structural rather than clever: find every `@router.<verb>`
 * decorator, take the parameter list of the function beneath it, and require
 * the dependency's name to appear in it.
 */
import { config, read, reporter } from './_lib.mjs';

const cfg = config();
const r = reporter('superadmin');
const api = cfg.api ?? {};

if (!api.adminRouter || !api.adminDep) {
  console.log('— skipped: no "api.adminRouter" / "api.adminDep" in audit.config.json');
  process.exit(0);
}

const src = read(api.adminRouter);
if (src === null) {
  r.error(`${api.adminRouter} not found`);
  r.finish();
  process.exit(1);
}

const lines = src.split('\n');
let routes = 0;
let guarded = 0;

for (let i = 0; i < lines.length; i++) {
  const decorator = lines[i].match(/^@router\.(get|post|put|patch|delete)\(/);
  if (decorator === null) continue;

  // Walk to the `def`, then collect the parameter list up to its closing
  // paren. A signature here spans several lines, so a single-line regex would
  // read the first parameter and call it the whole list.
  let j = i;
  while (j < lines.length && !/^(async\s+)?def\s/.test(lines[j])) j++;
  if (j >= lines.length) {
    r.error(`${api.adminRouter}:${i + 1} — @router.${decorator[1]} with no function beneath it`);
    continue;
  }
  const name = (lines[j].match(/def\s+([A-Za-z_][A-Za-z0-9_]*)/) ?? [])[1] ?? '?';
  let params = '';
  let k = j;
  let depth = 0;
  let started = false;
  for (; k < lines.length; k++) {
    for (const ch of lines[k]) {
      if (ch === '(') {
        depth++;
        started = true;
      } else if (ch === ')') depth--;
    }
    params += lines[k] + '\n';
    if (started && depth === 0) break;
  }

  routes++;
  if (params.includes(api.adminDep)) {
    guarded++;
  } else {
    r.error(`${name}() at ${api.adminRouter}:${j + 1} does not take ${api.adminDep} — the route is open to any authenticated account`);
  }
  i = k;
}

if (routes === 0) {
  r.error(`no @router routes found in ${api.adminRouter} — the parser has drifted from the file`);
}

console.log(`superadmin: ${guarded}/${routes} route(s) in ${api.adminRouter} take ${api.adminDep}`);
if (r.finish()) r.ok(`every admin route is gated by ${api.adminDep}`);
