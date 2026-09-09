#!/usr/bin/env node
/**
 * The plan, the status file and the backlog must agree.
 *
 * ── THE MARKER, AND WHY `[!]` RATHER THAN `[~]` ────────────────────────────
 *
 * A backlog row whose Item begins `**Unmet:**` says: this slice's plan promises
 * something the code does not do. `[~]` would be wrong — the slice is not being
 * worked on, it shipped. `[x]` would be a lie. `[!]` is "closed except for a
 * named clause": not done, not building.
 *
 * The second direction is what stops `[!]` becoming somewhere to hide. A slice
 * may wear it only while a row NAMES the clause. Drop the row without building
 * the thing and this audit fails from the other side.
 *
 * The effect is that closing a slice forces a three-way choice, out loud:
 * build the clause, amend the plan's Done line, or do not tick the box. There
 * is no fourth option, and "call it done and remember the caveat" was the
 * fourth option on every project that ever drifted.
 */
import { config, read, reporter } from './_lib.mjs';

const cfg = config();
const r = reporter('status');

const roadmap = read(cfg.docs.roadmap);
const status = read(cfg.docs.status);
const backlog = read(cfg.docs.backlog) ?? '';

if (roadmap === null || status === null) {
  console.log(`— skipped: ${cfg.docs.roadmap} or ${cfg.docs.status} not found`);
  process.exit(0);
}

const ID = cfg.docs.slicePattern;

/* ── planned: slice ids inside the roadmap's slice section ──────────────── */
const start = roadmap.indexOf(cfg.docs.slicesSection);
const rest = start === -1 ? roadmap : roadmap.slice(start + cfg.docs.slicesSection.length);
const nextPart = rest.search(/^## /m);
const section = nextPart === -1 ? rest : rest.slice(0, nextPart);
const planned = [...new Set([...section.matchAll(new RegExp(`\\*\\*(${ID})\\s`, 'g'))].map((m) => m[1]))];

/* ── tracked: slice ids mentioned anywhere in the status file ───────────── */
const tracked = [...new Set([...status.matchAll(new RegExp(`\\*\\*(${ID})\\*\\*`, 'g'))].map((m) => m[1]))];

for (const id of planned) {
  if (!tracked.includes(id)) r.error(`${id} is in the plan but not in ${cfg.docs.status}`);
}
for (const id of tracked) {
  if (!planned.includes(id)) r.error(`${id} is in ${cfg.docs.status} but not in the plan`);
}

/* ── the counter must match the ticked boxes ────────────────────────────── */
const done = [...status.matchAll(/^\|\s*\[x\]/gim)].length;
const header = status.match(/slices done:\s*(\d+)\s*\/\s*(\d+)/i);
if (header === null) {
  r.error(`${cfg.docs.status} header is missing the "slices done: N / M" counter`);
} else {
  if (Number(header[1]) !== done) {
    r.error(`header says ${header[1]} done, ${done} box(es) are ticked`);
  }
  if (Number(header[2]) !== planned.length) {
    r.error(`header total is ${header[2]}, the plan has ${planned.length} slice(s)`);
  }
}

/* ── one slice building at a time ───────────────────────────────────────── */
const building = [...status.matchAll(new RegExp(`^\\|\\s*\\[~\\][^|]*\\|\\s*\\*\\*(${ID})\\*\\*`, 'gim'))];
if (building.length > 1) {
  r.error(`${building.length} slices marked building at once (${building.map((m) => m[1]).join(', ')}) — one slice per session`);
}

/* ── the unmet rows, and the gate in both directions ────────────────────── */
const unmet = new Map();
for (const line of backlog.split('\n')) {
  if (!line.startsWith('|')) continue;
  if (/^\|[\s|:-]*$/.test(line)) continue;
  // A struck-through row, or one marked CLOSED, has released its tick.
  if (/~~|CLOSED/.test(line)) continue;
  const cells = line.split('|').map((c) => c.trim());
  const item = cells[1];
  const dest = cells[3];
  if (!item?.startsWith('**Unmet:**')) continue;
  for (const m of (dest ?? '').matchAll(new RegExp(ID, 'g'))) {
    if (!unmet.has(m[0])) unmet.set(m[0], []);
    unmet.get(m[0]).push(item);
  }
}

const boxOf = (id) => {
  const m = status.match(new RegExp(`^\\|\\s*\\[([x~!\\s])\\][^|]*\\|\\s*\\*\\*${id}\\*\\*`, 'm'));
  return m === null ? null : m[1];
};

for (const id of planned) {
  const box = boxOf(id);
  const rows = unmet.get(id) ?? [];
  if (box === 'x' && rows.length > 0) {
    r.error(`${id} is [x] with an unmet clause on file — ${rows.length} row(s): ${rows[0]}`);
  }
  if (box === '!' && rows.length === 0) {
    r.error(`${id} is [!] but no ${cfg.docs.backlog} row starting "**Unmet:**" names the clause`);
  }
}

/* ── warnings: rows filed against a slice that is already done, or unknown ─ */
for (const [id, rows] of unmet) {
  if (!planned.includes(id)) {
    r.warn(`${rows.length} row(s) filed at ${id}, which is not a slice in the plan — undeclared scope`);
  }
}

console.log(`status: ${planned.length} slice(s) planned, ${done} done, ${building.length} building`);
console.log(`unmet: ${unmet.size} slice(s) with a named open clause`);
if (r.finish()) r.ok(`${cfg.docs.status} agrees with the plan`);
