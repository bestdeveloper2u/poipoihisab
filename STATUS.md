# Status

Legend: `[ ]` not started · `[~]` building · `[x]` done (every
Definition-of-Done point, pushed) · `[!]` **closed except for a named UI or Does
clause** — see the `**Unmet:**` rows in `BACKLOG.md`.

`[!]` does not count as done and does not count as building, and
`scripts/audit-status.mjs` refuses it **in both directions**: a `[x]` with an
open `**Unmet:**` row fails, and a `[!]` with no such row fails too. That second
half is what stops `[!]` becoming somewhere to hide.

**Current release: R2** (plus R3.1 and R3.2, pulled forward on request) · slices done: 13 / 25 · building: **nothing**

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
| [!]  | **R3.1** Sheets sync into month tabs | `POST /export/sheets` | endpoint |
| [!]  | **R3.2** The sheet as a standalone ledger | `POST /export/sheets` | endpoint |

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

### 2026-09-09 (R3.2 handoff review) — **A template rebuild is not a safe ledger migration.**

The R3.2 implementation was present when the owner's other-agent report arrived.
Review found that rerunning `add_ledger_sheets.py` silently dropped existing
ledger sheets, despite describing itself as safe to rerun. It now refuses
existing ledger tabs unless `--replace-ledger` explicitly requests rebuilding
them without records in a new output copy. Both in-place writes and overwriting
an existing destination are refused. Four synthetic-workbook regression tests
exercise creation, both overwrite guards, refusal, and explicit replacement;
the original workbook bytes remain unchanged. No personal workbook was modified.

Budget parsing also rejects non-finite and negative legacy limits rather than
sending `NaN` or unusable values to Sheets. The inherited malformed-limit policy
still omits those limits; this is not full-fidelity backup serialization.

Earlier admin review in this working tree found two visible defects: the roster
bulk bar overlapped mobile navigation, and the analytics chart's bars collapsed
without a definite parent height. Both have regression assertions and browser
checks. Numeric month labels and inspector expense dates now use Bengali digits
in Bengali mode. The remaining R2 visual rows stay open; this handoff does not
claim the interrupted review of every admin screen is finished.

R3.1 and R3.2 remain `[!]`: no live Google spreadsheet round trip has been run.
The next external gate is a full sync twice against an explicitly authorized,
disposable 18-sheet template copy. R3.3 remains deferred until the multi-year
summary and budget month-picker behavior are specified. Personal workbook files
under `Claude outputs/` are excluded from publication.

**Verification:** regenerated OpenAPI/client; `pnpm verify` passes all nine
audits, both typechecks, both linters, 10 core tests, 549 web tests and 323 API
tests. Seven skips are six optional PostgreSQL cases and the optional template
module. The template module was then run explicitly with openpyxl using
`uv --directory apps/api run --with openpyxl python -m pytest tests/test_ledger_template.py -q`:
all four tests passed. These structural tests do not recalculate formulas or
substitute for the live Google test.

### 2026-09-09 (ledger sync) — **The sheet held a quarter of the ledger. The question was whether it could hold all of it.**

The owner asked whether the sync could put every bit of the app's data into the
Google Sheet, so that if the website went away they could keep working from the
sheet. It could not — and the shortfall was not in the sync. The workbook had
nowhere to put debts, the budget or the recurring rules. Three of the four things
the app tracks had no column anywhere in it.

**The premise that failed was that "all data" was a sync problem.** It was a
template problem first. `apps/api/scripts/add_ledger_sheets.py` now builds three
sheets that hold those records the way the month sheets hold expenses: dropdowns
over the same `CategoryList` and `PaymentList` names, the group derived by the
same `INDEX/MATCH`, and a reconciliation line on the budget sheet naming spend in
categories with no limit set. Every formula was recalculated in LibreOffice
against sample rows before any of it was believed — the debt panel separated
৳7,500 receivable from ৳12,000 payable and netted −৳4,500, the budget sheet found
৳2,050 spent against a ৳2,000 চাল limit and ৳4,949 of September spending in
unbudgeted categories, and the recurring sheet turned an ৳18,000 yearly premium
into ৳1,500 a month and flagged the one active rule whose next date had passed.

**A second premise had to be given up in the sync.** The obvious reading of
`month` is "touch only this month", which would have meant refreshing the ledger
only on a full sync. That leaves the sheet trustworthy only after the *right kind*
of sync, with nothing on the sheet to say which kind was run last. So the three
ledger tabs are rewritten in full on every sync, and `month` narrows the expense
months and nothing else.

**Refusing a workbook without the new tabs would have been the easy consistency
and the wrong call.** A missing month tab still refuses the whole sync, because
filling the months is what the export is for. A missing ledger tab is an older
copy of the template, so it is skipped, named in the response, and its months
still sync. Telling those apart is why the response now separates a tab written
with zero records from a tab that is not there from a tab too full to write.

**One thing already in the response turned out to be invisible.** `unmapped` has
been returned since the month-tab rewrite and was displayed nowhere, so a
category the workbook does not list left its group blank and its amount in the
sheet's শ্রেণিবিন্যাসহীন line with nothing in the app ever saying so. The sync
toast now names it, along with the ledger counts and any skipped tabs.

**Verification:** nine audits pass, 86 Sheets contract tests (63 before) inside
320 API tests, 549 web tests, 10 core tests, ESLint, both typechecks and Ruff
clean. Nothing has been synced into a real spreadsheet yet: R3.2 wears `[!]` for
the same reason R3.1 does, and `BACKLOG.md` names its clause.

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

### 2026-09-09 (later) — **A real workbook arrived and showed the Sheets export could not populate it. Three bugs, each silent, each in the same direction: the sheet would look right and total wrong.**

The owner sent the workbook they actually keep — a 15-sheet Bengali
`দৈনিক খরচের হিসাব ২০২৬` with a guide, a yearly summary carrying two charts, a
settings sheet of 54 categories in 8 groups, and twelve monthly sheets. August held
104 real entries totalling ৳45,356 and September 28 totalling ৳8,694.

**The workbook's own defect was structural, not typographical.** `মোট মাসিক ব্যয়`
was `SUM($J$4:$J$11)` — the eight group subtotals — and each of those is a `SUMIF`
over a lookup column that returns `""` for any category outside `CategoryList`. So a
single unrecognised category dropped its amount out of the monthly total, out of every
percentage, out of the daily average and out of the yearly summary, while the row sat
in plain sight with its amount showing. Nothing reported a discrepancy. No row is
affected today; the structure was the bug. The total now sums the amounts directly and
a `শ্রেণিবিন্যাসহীন` line under it shows anything the groups failed to absorb, with
the offending rows highlighted. Proven by injecting a category one letter off from the
list: the old shape reported ৳8,694 and swallowed ৳250, the new one reports ৳8,944 and
names the ৳250. Every existing total came back byte-identical — ৳45,356, ৳8,694,
৳54,050 — across 4,881 formulas with zero recalculation errors.

**Where the premise was wrong about our own export.** The assumption going in was that
the sync appended in a slightly different column order. It was worse than that, in
three ways that compound. The CSV order is date, description, **group, category**; the
workbook is date, description, **category, group** — and its group column is a formula,
so appending put the group into the category dropdown and overwrote the formula with a
category name, which stops every `SUMIF` on the sheet from matching. The amount was
translated to Bengali digits, and under `USER_ENTERED` "৪৮০.০০" is text: the figure
appears and every `SUM` ignores it. And it appended, so a second sync doubled the month
— the README warned about that, which is not the same as fixing it. A test in our own
suite asserted the Bengali-digit amount as correct behaviour, so the suite was pinning
the bug in place.

**What was built.** Rows now land in the tab for their own month, in that sheet's
column order, with the amount as a number, the payment enum mapped to the exact strings
the sheet's dropdown validates against, and column D never written. A sync replaces the
month it covers rather than appending. A missing month tab and a month over 200 rows
both refuse the entire sync before any write, because a partial write leaves some
months replaced and others stale — harder to notice and harder to undo than a refusal.
Nothing creates the workbook: a tab this code fabricated would have no formulas, no
dropdowns and no row in the yearly summary, so it would look right and total nothing.

**What is NOT done.** This has never run against a real spreadsheet — every test drives
a mocked Sheets API. See the `**Unmet:**` row for R3.1.

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
