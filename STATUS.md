# Status

Legend: `[ ]` not started · `[~]` building · `[x]` done (every
Definition-of-Done point, pushed) · `[!]` **closed except for a named UI or Does
clause** — see the `**Unmet:**` rows in `BACKLOG.md`.

`[!]` does not count as done and does not count as building, and
`scripts/audit-status.mjs` refuses it **in both directions**: a `[x]` with an
open `**Unmet:**` row fails, and a `[!]` with no such row fails too. That second
half is what stops `[!]` becoming somewhere to hide.

**Current release: R2** · slices done: 13 / 23 · building: **nothing**

---

## Slices

| Done | Slice | Route | Kind |
| ---- | ----- | ----- | ---- |
| [x]  | **R1.1** Login and registration | `/login` | screen |
| [x]  | **R1.2** Dashboard | `/` | screen |
| [x]  | **R1.3** Expense list | `/expenses` | screen |
| [x]  | **R1.4** Monthly hisab | `/month` | screen |
| [x]  | **R1.5** Reports | `/report` | screen |
| [x]  | **R1.6** Debts | `/debts` | screen |
| [x]  | **R1.7** Budget | `/budget` | screen |
| [x]  | **R1.8** Recurring expenses | `/recurring` | screen |
| [x]  | **R1.9** Settings | `/settings` | screen |
| [x]  | **R1.10** Bengali voice entry | overlay | feature |
| [x]  | **R1.11** Offline-first shell | PWA | feature |
| [x]  | **R1.12** Google Sheets sync | `/settings` | feature |
| [x]  | **R2.1** Admin overview | `/admin` | screen |
| [!]  | **R2.2** Users roster | `/admin/users` | screen |
| [!]  | **R2.3** User inspector | `/admin/users/:userId` | screen |
| [!]  | **R2.4** Platform analytics | `/admin/analytics` | screen |
| [!]  | **R2.5** Category taxonomy | `/admin/categories` | screen |
| [!]  | **R2.6** Data import and export | `/admin/data` | screen |
| [!]  | **R2.7** Audit log | `/admin/audit` | screen |
| [!]  | **R2.8** Admins and roles | `/admin/roles` | screen |
| [!]  | **R2.9** Sessions and security | `/admin/security` | screen |
| [!]  | **R2.10** System health | `/admin/system` | screen |
| [!]  | **R2.11** Integrations | `/admin/integrations` | screen |

<!--
Keep the counter above in step with the ticked boxes — the audit compares them.
Ticking a box is a THREE-part edit: this row, the counter, and the BACKLOG row
(struck through, or annotated CLOSED). That is deliberate. It forces the choice
out loud at closure time: build the clause, amend the plan's Done line, or do
not tick the box.
-->

---

## Log

Newest first. One entry per session. A narrative, not a checklist: what was
tried, what the premise was, and **where the premise turned out to be wrong**.

### 2026-09-09 (visual review) — **R2.1 is visually verified, and its verification blocker was a test-runtime mismatch.**

The seeded local superadmin path showed the deployment warning above every
number, with both the MemoryKV and SQLite fallbacks named. At 1440px the 236px
sidebar and four-column KPI rows held; at 980px the sidebar became the four-item
bottom tab bar and the main surface took the full width; at 375px the two-column
tiles, warning text, quick links and recent-activity card stayed inside the
viewport with bottom padding clear of the fixed tab bar. There was no horizontal
overflow at any width. Bengali and English were both inspected at 375px.

**The premise that failed was in the roadmap, not the UI.** R2.1 promised nine
KPI tiles, but the deliberate implementation renders eight tiles containing ten
metrics: new users belongs under total users, and current-month volume belongs
under total volume. Splitting either contextual number into a ninth tile would
make the information hierarchy worse and break the balanced 4×2 desktop grid,
so `ROADMAP.md` now records the screen that actually exists.

**The verification diagnosis also needed correcting.** The first run had seven
auth-cookie failures before fetch. `AbortSignal.timeout` exists in jsdom, but
Node's native `Request` rejects a jsdom signal as the wrong class. A direct
reproduction produced `Expected signal to be an instance of AbortSignal`.
The shared test setup now obtains Node's abort classes through
`node:util`'s native controller factory, keeping them compatible with Node's
fetch classes. All 17 tests in the affected suites pass without changing the
production authentication code or removing its four-second timeout.

**Final verification:** `pnpm verify` passes: nine audits, web/mobile
typechecks, ESLint, 10 core tests, 548 web tests, Ruff, and 297 API tests
(six optional PostgreSQL tests skipped). Python checks used an isolated Windows
environment with the frozen `uv.lock`; the existing Linux environment was
left in place. Existing uncommitted Sheets work was preserved separately.

### 2026-09-09 — **This document set was retrofitted onto a project that was already shipping, and the retrofit immediately caught three things a green build had been hiding.**

The four documents and the `scripts/` audit layer went in today. The honest
reason to adopt them mid-flight rather than at a boundary: R2 was built and
verified entirely by machine — 292 API tests, 548 web tests, both typecheckers,
ESLint, a production build — and every one of those was green while the three
defects below were live. Machine-green is not the same as true.

**What the audits found on their first run.** `audit-test-wiring` failed on both
test configurations: neither `apps/web/vite.config.ts` nor
`packages/core/vitest.config.ts` excluded build output, and the web config had
no explicit `include` at all — Vitest's defaults were doing the scoping, which
means `pnpm verify` could not check it. Both are now explicit, and the web
config names `src/` and `tests/` because the 60 spec files live in two places.
Spec count before and after: 62 across the repo, unchanged — the explicit globs
match exactly what the defaults were matching, which is the point.

`audit-env` needed replacing rather than configuring, and this is the most
useful thing learned today. The shipped version scans JavaScript for
`process.env.X`. Two thirds of this application's configuration is a lowercase
field on a pydantic `Settings` class plus an `env_prefix`, so the string
`POIPOIHISAB_DATABASE_URL` appears nowhere in the Python at all. Run
unmodified, the audit found two variables and reported all thirteen API
variables as dead config — thirteen false errors, which is exactly how an audit
gets disabled. It now derives the API's variable names from the Settings fields.
Result: 15 declared, 15 read, agreeing in both directions.

**Where a previous conclusion in this session was wrong.** The last-superadmin
guard was written, reviewed and committed before it became clear it could not
fire. Every caller filters its own id out of the target list, so the acting
admin always supplied the one remaining admin the check was looking for. The
guard was rewritten around the failure that *is* reachable — an admin whose
access comes only from `POIPOIHISAB_SUPERADMIN_EMAILS` demoting every DB-flagged
admin, after which a change to that variable locks everyone out — and it now has
three assertions that trip it. The original reasoning is left in this entry
rather than edited out: the lesson is that "I wrote a guard" and "the guard can
fire" are different claims, and only the second one has a test.

**What is NOT done, and why eleven boxes read `[!]`.** Every R2 screen is code
complete with passing tests, and not one of them has been looked at in a
browser. Definition-of-Done point 1 asks for three widths, viewed. That was not
done, so the boxes cannot read `[x]` — see the eleven `**Unmet:**` rows in
`BACKLOG.md`. This is the marker doing its job on its first day: the alternative
was eleven ticks and a caveat in a sentence nobody would find in three weeks.

**Two more the audits found, both after this entry was first drafted.**

`audit-i18n` reported 35 orphaned dictionary keys. Seventeen of those were the
audit's own bug: `Dashboard.tsx` reads eleven keys as `W[lang].statToday`
rather than through `w()`, and the scan only knew about `w()` and about keys
travelling as props. Reporting those would have been the audit accusing the
codebase of the audit's mistake, which is how an audit gets disabled. With the
third access pattern added, 18 were real — and eight of those were dead keys
this session had created itself while splitting the admin screen apart
(`navAdmin`, `adminSub`, `adminUserId`, `adminClose`, `adminUserBadge`,
`adminImportModalTitle`, `adminUserViewBanner`, `adminShare`). One of them,
`adminUserViewBanner`, was a label added and never rendered — the exact defect
constraint 2 in `CLAUDE.md` was written about, committed the same day the
constraint was. Those eight are deleted; the remaining ten are R1 prototype
leftovers, baselined at 10 rather than cleared, because clearing R1 debt during
R2 is what the one rule forbids. The baseline fails if it is higher than
reality too, so it cannot be left stale after a cleanup.

`.gitignore` line 20 was `.env*`, which silently swallowed the `.env.example`
written an hour earlier. The audit layer's declared side and a fresh clone's
only instructions were both untracked and would have been lost on the next
machine. `!.env.example` now follows it.

**Also today.** `.gitattributes` now pins line endings, after files written from
a Linux shell landed as LF in a CRLF working tree — harmless to git, which
normalises before comparing, but it left the checkout with mixed endings and
made `git status` in a non-Windows shell report 253 modified files that were
byte-identical in content.

**Verification, and where it had to be split.** All nine audits pass. The rest
of `verify` was proven green in two places for the reason `CLAUDE.md` now
records: this checkout's `node_modules` holds win32-only esbuild and rollup
binaries, so Vitest and Vite cannot run against it from a Linux shell. The API
gates ran here — Ruff clean, 292 passed, 6 skipped. The JavaScript gates ran
against a clean install of the same source: both typecheckers clean, ESLint
clean, 548 tests across 60 files, 10 core tests. The web spec count was 60
before the explicit `include` globs and 60 after, which is the evidence that
making the scoping explicit changed what `verify` can check and not what it
runs.
