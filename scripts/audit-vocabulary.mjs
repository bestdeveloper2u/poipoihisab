#!/usr/bin/env node
/**
 * One word per concept, everywhere — schema, routes, UI copy AND comments.
 *
 * This looks like style policing and is not. Two names for one idea is how a
 * model splits in half: one half of the code grows around `customer` and the
 * other around `client`, a join appears between them, and by the time anybody
 * notices, renaming is a migration.
 *
 * Comments count. A comment using the abandoned word teaches it to the next
 * person who reads the file, and to any agent working from it.
 *
 * Configure in audit.config.json:
 *   "vocabulary": [
 *     { "use": "streamer", "instead": ["creator", "influencer"],
 *       "allow": ["/creators", "CreatorStudio"] }
 *   ]
 * `allow` is for genuine exceptions — a third-party API's own field name, a
 * legacy URL you still redirect. Each one should be worth defending out loud.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, config, reporter, walk } from './_lib.mjs';

const cfg = config();
const r = reporter('vocabulary');

if (cfg.vocabulary.length === 0) {
  console.log('— skipped: no "vocabulary" rules configured');
  process.exit(0);
}

const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|astro|sql|prisma|md|json|yml|yaml|html|css)$/;
const roots = [...new Set([...cfg.sourceDirs, '.'])];
const files = new Set();
for (const dir of roots) for (const f of walk(dir, (n) => TEXT.test(n))) files.add(f);

let hits = 0;
for (const file of files) {
  // The audit's own rules file will always contain the banned words.
  if (file.endsWith('audit.config.json') || file.endsWith('audit-vocabulary.mjs')) continue;
  const src = readFileSync(join(ROOT, file), 'utf8');

  for (const rule of cfg.vocabulary) {
    let text = src;
    for (const allowed of rule.allow ?? []) text = text.split(allowed).join('');
    for (const banned of rule.instead ?? []) {
      /*
        WHOLE WORDS ONLY, and this cost a false positive on its first run.
        A bare /creator/i matches `creatordate` — a git format specifier in a
        script that has nothing to do with the domain. An audit that fires
        falsely gets disabled, and a disabled audit is a lie in the config, so
        the boundary is not a refinement: it is what makes the rule usable.
        Non-global regex, rebuilt per line, because a /g/ regex carries
        lastIndex between .test() calls and skips every other match.
      */
      const re = new RegExp(`\\b${banned}\\b`, 'i');
      text.split('\n').forEach((line, i) => {
        if (re.test(line)) {
          hits++;
          r.error(`${file}:${i + 1} says "${banned}" — the word is "${rule.use}"`);
        }
      });
    }
  }
}

console.log(`vocabulary: ${files.size} file(s) scanned, ${cfg.vocabulary.length} rule(s), ${hits} hit(s)`);
if (r.finish()) r.ok('one word per concept, everywhere it describes this system');
