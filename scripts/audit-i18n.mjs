#!/usr/bin/env node
/**
 * The dictionaries and the code must agree, in both directions, in both
 * languages.
 *
 * ── THE INCIDENT ───────────────────────────────────────────────────────────
 *
 * `adminActiveUsers` — "সক্রিয় (৩০ দিন)" — sat in the web dictionary in both
 * languages while `/admin/stats` never returned the number behind it. The KPI
 * tile rendered `undefined` from the day it shipped. Nothing caught it: the
 * key existed, so no lookup failed; the tile rendered, so no test threw.
 *
 * Three directions matter, and only the first is obvious:
 *
 *   1. A key used by the code and missing from the dictionary — renders the raw
 *      key name to the user.
 *   2. A key in `bn` but not `en`, or the reverse — renders correctly for half
 *      the users and falls back for the other half. Bengali is the first
 *      language here (decision D1), so an `en`-only key is not a smaller bug
 *      than a `bn`-only one.
 *   3. A key in the dictionary that nothing uses. This is the one people skip.
 *      It is how a dictionary reaches 458 entries of which some describe
 *      screens that no longer exist and some, like the one above, describe data
 *      that never arrived. Dead keys are also how a label survives the deletion
 *      of the thing it labelled, ready to be wired to the wrong field later.
 *
 * Deliberately NOT checked: whether the two translations mean the same thing.
 * No script can do that, and pretending otherwise would make this audit a
 * place people stop looking.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CODE, ROOT, config, read, reporter, walk } from './_lib.mjs';

const cfg = config();
const r = reporter('i18n');
const spec = cfg.i18n;

if (!spec?.webDict) {
  console.log('— skipped: no "i18n" block in audit.config.json');
  process.exit(0);
}

/**
 * Keys per language from a dictionary of the shape
 * `export const W = { bn: { key: "…" }, en: { … } } as const`.
 *
 * Brace counting rather than a regex over the whole file: the values contain
 * braces, quotes and `{n}` placeholders, and a single regex over 1000 lines of
 * that was the first version of this function and it silently under-counted.
 */
function keysByLang(src, langs) {
  const out = new Map(langs.map((l) => [l, new Set()]));
  for (const lang of langs) {
    const open = src.search(new RegExp(`^\\s{2}${lang}:\\s*\\{`, 'm'));
    if (open === -1) continue;
    let depth = 0;
    let i = src.indexOf('{', open);
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = src.slice(start, i);
    // Top-level entries only: two-space indent inside the language object.
    for (const m of body.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9_]*)\s*:/gm)) {
      out.get(lang).add(m[1]);
    }
  }
  return out;
}

let errorsBefore = 0;
const report = (label, path, langs, callers, dictVars = []) => {
  const src = read(path);
  if (src === null) {
    r.error(`${path} not found`);
    return;
  }
  const byLang = keysByLang(src, langs);
  const sizes = langs.map((l) => `${l} ${byLang.get(l).size}`).join(', ');

  // ── parity between languages ──────────────────────────────────────────
  const union = new Set(langs.flatMap((l) => [...byLang.get(l)]));
  for (const key of union) {
    const missing = langs.filter((l) => !byLang.get(l).has(key));
    if (missing.length > 0) {
      r.error(`${label}: "${key}" is missing from ${missing.join(' and ')} in ${path}`);
    }
  }

  /* ── both directions against the call sites ────────────────────────────
     Two ways a key is reached, and missing the second one cost this audit 73
     false errors on its first run:

       w(lang, "adminInspect")                     — a direct lookup
       W[lang].statToday                           — straight off the dictionary
       <AdminEmpty messageKey="noBudget" />        — the key travels as a prop
       THEME_OPTIONS.map((o) => w(lang, o.labelKey))  — and as table data

     The second form cost a false positive on the first run of this audit:
     Dashboard.tsx reads eleven keys as `W[lang].x` rather than through `w()`,
     and reporting those as dead would have been the audit's own bug reported
     as the codebase's.

     The second form is real and common here, and no textual scan can follow it.
     So a key counts as used if it is looked up directly OR if its exact name
     appears as a string literal anywhere in the source. That is deliberately
     conservative: it can miss a dead key whose name is also an unrelated
     string, and it will not invent one. An audit that fires falsely gets
     disabled, and a disabled audit is a lie in the config — a rule that
     under-reports stays usable, one that over-reports does not. */
  const used = new Set();
  const literals = new Set();
  let scanned = 0;
  for (const dir of cfg.sourceDirs) {
    for (const file of walk(dir, (f) => CODE.test(f))) {
      scanned++;
      const src2 = readFileSync(join(ROOT, file), 'utf8');
      for (const fn of callers) {
        for (const m of src2.matchAll(new RegExp(`\\b${fn}\\s*\\(\\s*[A-Za-z_$][\\w$.]*\\s*,\\s*["']([A-Za-z][A-Za-z0-9_]*)["']`, 'g'))) {
          used.add(m[1]);
        }
      }
      for (const m of src2.matchAll(/["']([A-Za-z][A-Za-z0-9_]{2,})["']/g)) literals.add(m[1]);
      // `W[lang].key` / `DICT[lang].key` — a lookup that never mentions w()/t().
      for (const v of dictVars) {
        for (const m of src2.matchAll(new RegExp(`\\b${v}\\[[^\\]]+\\]\\.([A-Za-z][A-Za-z0-9_]*)`, 'g'))) {
          used.add(m[1]);
        }
      }
    }
  }

  const defined = byLang.get(langs[0]);
  for (const key of used) {
    if (!defined.has(key)) {
      r.error(`${label}: ${callers.join('/')}(…, "${key}") is called but "${key}" is not in ${path}`);
    }
  }
  let dead = 0;
  let indirect = 0;
  const orphans = [];
  for (const key of defined) {
    if (used.has(key)) continue;
    if (literals.has(key)) {
      indirect++;
      continue;
    }
    dead++;
    orphans.push(key);
  }

  /* RATCHET, do not block (rule 4 for adding an audit). The orphaned keys are
     prototype leftovers in R1's dictionary, and clearing them mid-R2 is exactly
     the "quickly also fix something else" the one rule forbids. So the known
     count is baselined and only an INCREASE fails: a new dead key cannot be
     added, and the number can only go down. Lower the baseline when you delete
     them; the audit fails if the baseline is higher than reality, so it cannot
     be left stale. */
  const baseline = (spec.orphanBaseline ?? {})[label] ?? 0;
  if (dead > baseline) {
    for (const key of orphans) {
      r.error(`${label}: "${key}" is defined in ${path} but its name appears nowhere in the source`);
    }
    r.error(`${label}: ${dead} orphaned key(s), baseline is ${baseline} — a new dead key was added`);
  } else if (dead < baseline) {
    r.error(`${label}: ${dead} orphaned key(s) but the baseline still says ${baseline} — lower it in audit.config.json`);
  } else if (dead > 0) {
    r.warn(`${label}: ${dead} orphaned key(s) held at baseline — see BACKLOG.md`);
  }

  console.log(
    `${label}: ${sizes}; ${used.size} looked up directly, ${indirect} reached indirectly, ${dead} orphaned, ${scanned} file(s) scanned`,
  );
};

report('web', spec.webDict, spec.langs ?? ['bn', 'en'], ['w'], spec.webDictVars ?? ['W']);
if (spec.coreDict) {
  report('core', spec.coreDict, spec.langs ?? ['bn', 'en'], ['t'], spec.coreDictVars ?? ['DICT']);
}

void errorsBefore;
if (r.finish()) r.ok('every key exists in every language, and every defined key is used');
