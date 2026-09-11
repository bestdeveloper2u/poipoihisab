# Status

Legend: `[ ]` not started · `[~]` building · `[x]` done (every
Definition-of-Done point, pushed) · `[!]` **closed except for a named UI or Does
clause** — see the `**Unmet:**` rows in `BACKLOG.md`.

`[!]` does not count as done and does not count as building, and
`scripts/audit-status.mjs` refuses it **in both directions**: a `[x]` with an
open `**Unmet:**` row fails, and a `[!]` with no such row fails too. That second
half is what stops `[!]` becoming somewhere to hide.

**Current release: R2** (plus R3.1–R3.5, pulled forward on request) · slices done: 19 / 28 · building: **nothing**

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
| [x]  | **R2.2** Users roster | `/admin/users` | screen |
| [x]  | **R2.3** User inspector | `/admin/users/:userId` | screen |
| [x]  | **R2.4** Platform analytics | `/admin/analytics` | screen |
| [x]  | **R2.5** Category taxonomy | `/admin/categories` | screen |
| [!]  | **R2.6** Data import and export | `/admin/data` | screen |
| [!]  | **R2.7** Audit log | `/admin/audit` | screen |
| [!]  | **R2.8** Admins and roles | `/admin/roles` | screen |
| [!]  | **R2.9** Sessions and security | `/admin/security` | screen |
| [!]  | **R2.10** System health | `/admin/system` | screen |
| [!]  | **R2.11** Integrations | `/admin/integrations` | screen |
| [!]  | **R3.1** Sheets sync into month tabs | `POST /export/sheets` | endpoint |
| [!]  | **R3.2** The sheet as a standalone ledger | `POST /export/sheets` | endpoint |
| [!]  | **R3.3** Multi-year Sheets ledger | `POST /export/sheets` | endpoint |
| [x]  | **R3.4** Continuous integration | GitHub Actions | workflow |
| [x]  | **R3.5** Consistent release labels | `/settings` | maintenance |

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

### 2026-09-11 (R2.5) — **A success timeout survived leaving the categories screen.**

The category taxonomy verification closes the next admin browser clause.
Synthetic categories covered long unbroken names (over 80 characters), multiple
groups per category, empty taxonomy, and duplicate spellings. The taxonomy
table, share bars, drift warning banner and merge modal were checked across 1440,
980 and 375px viewports in both Bengali and English.

Long category names now wrap with break-words to prevent table and modal blowout
on mobile viewports (375px). Group codes use existing localized catalogs rather
than raw English keys. The merge action button now provides an accessible name
specifying which category is targeted. A success timer cleanup effect was added
so navigating away before the 5-second notification expires cancels the pending
timer, eliminating unmounted component state updates.

Four added web tests cover success timer cancellation on route unmount,
localized category groups, long category break-words containment in both table
and modal, empty states and API error banners. Full web test suite passes with
579 tests across all 60 test files. Production web build and all audit gates
pass cleanly. R2.6 is next.

### 2026-09-11 (R2.4) — **A zero month still had a bar.**

The analytics verification begun on September 10 closes the next admin browser
clause. Synthetic local records covered twelve months across a year boundary,
one empty month, Bengali categories, an 80-character unbroken category/name and
a long email. The chart/table, three ranked distribution panels, debt tiles and
top-spender list were inspected at 375, 980 and 1440px. Bengali and English were
checked; the temporary account's language was restored to Bengali. No real
database, owner credentials, Google Sheet or moderation action was used.

The long name stretched the phone document to 932px. Bounded grid tracks,
wrapping labels/identities and stacked phone amounts now keep content at 360px
inside the 375px viewport; the table alone scrolls horizontally. Group/payment
codes use existing localized catalogs. The trend had a two-percent minimum bar
for zero and a one-taka minimum scale for fractional values. Both distortions
are removed, and analytics ranking bars can likewise have zero length without
changing the shared component's existing default elsewhere.

Chart QA also found that scope was missing from the labels. The trend includes
the current incomplete month, but rankings are all-time and bar lengths are
relative to each panel's largest amount. Debt totals include settled rows, so
they are labeled recorded amounts rather than receivable/payable balances.
The named exact-value table remains available to assistive technology; the
chart geometry is decorative. No API calculation, permission or schema changed.

Seven added UI cases exercise zero/fractional bars in both languages, long
identities and large totals, loading-to-empty, failed reads and member denial.
Two API cases pin empty zero-filled months, year/window boundaries, all-time
rankings and settled debt amounts, alongside existing aggregate-only and denied
tests. Local `pnpm verify` passes 574 web, 10 core, 368 API and 28 audit tests
(980 total), with 7 optional API skips, all 10 audits, both typecheckers and
both linters. OpenAPI/client regeneration is unchanged; production build passes.
The browser console was clear on the resumed desktop check. Doctor still names
the absent root `.env`; explicit temporary local settings were used for QA.
Personal `Claude outputs/` workbooks and the synthetic QA database remain outside
the commit. R2.5 is next; live Sheets clauses remain open.

### 2026-09-10 (R2.3) — **An empty tab was sometimes a failed request.**

The next-task request closes the inspector's browser-verification clause. The
local synthetic QA database supplied an 80-character unbroken name, a long email,
expenses, receivable/payable debts, a maximum-size budget and a paused recurring
rule. The identity, eight summary cells and all four populated tabs were viewed
at 1440, 980 and 375px, with Bengali and English checked. The phone document had
been 890px wide; wrapping identity and money now keeps it within the viewport
(360px content at 375px). Table-only horizontal scrolling remains intentional.
All three moderation confirmations fit the phone and were cancelled; no browser
moderation action was submitted. Back navigation and the empty self-inspector
were also checked, including both database and environment grant sources.

The promised grant source had no field behind it. The additive `adminSources`
contract now reports both sources using the same case-insensitive allowlist
semantics as authorization; no permission rule or database schema changed.
Secondary request failures no longer impersonate empty record lists, and changing
the user URL clears stale identity and records. A rejected clipboard write no
longer claims success. Expense groups and recurring frequencies now use existing
translations, paused rules say paused, and Bengali next-run dates use Bengali
digits. Seven added web cases cover partial errors, long identities/localization,
clipboard failure and a same-component route change; five API cases cover all
grant combinations and member denial across all four inspector reads.

Validation: regenerated OpenAPI and the TypeScript client; `pnpm verify` passes
567 web, 10 core, 366 API and 28 audit tests (971 total), with 7 optional API skips,
all 10 audits, both typecheckers and both linters. `pnpm build:web` passes.
The local Node 24 / temporary Windows Python environment was used; doctor still
notes the absent root `.env`, and QA used explicit local-only settings instead.
Restarting the temporary API invalidated its in-memory session; signing in again
restored QA, and the subsequent browser error/warning log was empty. Screenshots,
the synthetic database and personal `Claude outputs/` workbooks stay outside the
commit. Live Google Sheets verification remains open in R3.1–R3.3.

The first hosted Linux run (34445244796) then failed after test teardown: a
roster success-message timeout still called React after `window` was destroyed.
This pre-existing timer leak escaped local verification. The debugging pass
reproduced it with a failing timer-cleanup assertion; the success timeout now
belongs to an effect that cancels it on message replacement or route unmount.
This narrowly scoped CI blocker is included in the R2.3 follow-up, not a new
slice. The new regression passes with cleanup and the full local gates rerun.

### 2026-09-10 (R2.2) — **A table fitting its container did not mean its dialogs fit.**

The next-task request closes the oldest admin browser-verification clause. A
temporary SQLite database supplied eight synthetic accounts, including the acting
admin, a suspended account, Bengali names and an unbroken 80-character name.
The roster, floating bulk bar, single-user confirmation and bulk confirmation
were inspected at 1440, 980 and 375px. The owner approved switching the QA account
between Bengali and English; no real account or production database was used.

The long name stretched the desktop table and made the phone single-user dialog
948px wide inside a 358px panel. The bulk dialog acquired a horizontal scrollbar
inside its affected-user list, while the phone bulk buttons squeezed their labels
onto multiple lines. Names are now bounded in the table (full text remains in the
link and title), wrap in both confirmations, and leave IDs their own bounded space.
The bulk bar uses the available phone width and wraps whole buttons above the tab
bar. Table-only horizontal scrolling remains intentional; the page and dialogs
do not overflow. Search and individual selection controls now have translated
accessible labels.

A regression test also exposed hidden bulk targets after searching: selected IDs
survived while their names disappeared from the confirmation. Search edits now
clear selection, and each response removes IDs selected from stale rows during
the request. The failing test was observed before the fix. Eight added web cases
cover long identities/cancellation in both languages, self-selection refusal,
search selection and delayed responses, loading-to-empty, an API error and denied
member access. Cancellation assertions are scoped to roster mutations so the
shell's ordinary session-probe POST is not mistaken for a moderation action.

The final browser pass verified search, empty results, restored results, both
languages, selection and cancellation. The acting admin stayed unselectable;
dialogs stayed above navigation, and the browser console had no warnings/errors.
No delete or permission-changing action was submitted through the browser;
mutation outcomes and server authorization remain covered by the automated tests.
Screenshots and synthetic data stay outside the repository.

Verification: 559 web, 10 core, 361 API and 28 audit tests; 7 optional API skips.
All ten audits, both typechecks and linters, and the production build pass.
OpenAPI/client contracts regenerated unchanged. `doctor` still reports the absent
root `.env`; the gate used the temporary Windows Python environment. Personal
workbooks were neither modified nor staged. Other admin and live-Google clauses
remain open; this session closes R2.2 only.

### 2026-09-10 (R3.5) — **A release label needs a consistency check.**

The next-task request selects the version-label backlog item. The mismatch was
larger than the visible `v0.6.0` chip: the shared and Python packages still said
`0.3.0`, and mobile's missing-Expo fallback said `0.9.0-dev`. All committed release
metadata now agrees with the existing web/API release, `0.28.0`. Mobile still
prefers packaged Expo metadata, with the shared release as its fallback. Explicit
API runtime version overrides remain supported; `.env.example` now explains that
they do not relabel a built frontend. No native build numbers or deployment settings
changed, and no dependency versions were upgraded.

The new audit checks eleven surfaces, including the Python lockfile and OpenAPI.
It immediately caught the old editable-package version in `uv.lock`; refreshing
that metadata changed only the package's version. Twenty-eight Node built-in tests
exercise every source's drift/missing cases, malformed declarations, coordinated
bumps, CRLF and a real CLI invocation outside the repository root. That last test
also proves the path invariant flagged by the existing test-path audit; none of
the audit rules were weakened. Two Settings tests cover the shared label in both
languages, and an API test preserves explicit runtime overrides.

Browser QA used a temporary SQLite database and synthetic account, not the owner's
ledger. The first registration exposed missing tables in this fresh QA database;
creating its test schema resolved setup without changing application startup.
Settings was viewed at 1440, 980 and 375px; Bengali-to-English interaction retained
`v0.28.0`, both header and footer labels were visible, and no horizontal overflow,
framework overlay or browser warning/error was observed. Screenshots are outside
the repository. Native execution was not attempted; Expo metadata is audited and
the mobile typecheck passes, as scoped in the plan.

The complete gate passes: 28 audit tests, all ten audits, 551 web, 10 core and
361 API tests, with 7 optional API skips; both typechecks and linters pass. The
production web build passes, and regenerated OpenAPI/client contracts are unchanged.
Root `.env` remains absent (`doctor` reports it); verification used the temporary
Windows Python environment. Personal workbook files remain untouched and untracked.
Live Google workbook clauses remain open and are not part of this slice.

### 2026-09-09 (R3.4) — **The gate needs a fresh runner.**

The next-task request selects the unblocked CI backlog item. `Verify` now defines
Linux and Windows jobs for pushes, pull requests and manual dispatch. Both install
locked dependencies, compare regenerated OpenAPI/client contracts, run the repository
gate, and build the web bundle. Action implementations are SHA-pinned; the token is
read-only and checkout credentials are not persisted. No production secrets,
deployment steps, branch-protection changes or application changes are included.

Local YAML assertions validate the triggers, permissions, pins and non-optional
gates. The standalone actionlint process could not start on this host (access
denied), so no actionlint result is claimed. GitHub's run API is readable, but
Actions policy inspection returns 403, but the actual workflow was accepted and
[run 34384774609](https://github.com/bestdeveloper2u/poipoihisab/actions/runs/34384774609)
passed on both hosted runners (Linux 1m29s, Windows 3m5s), including the generated
contract check and production build. That run exposed the pnpm action's deprecated
Node 20 runtime, so its pin was updated to compatible v5 using Node 24. Local
verification also passed: 549 web, 10 core, 360 API tests, 7 optional API skips,
all nine audits, both typechecks, both linters and the production web build.
Root `.env` is still absent; `doctor` reports it, while the hermetic test suite
does not require it. No application contracts changed when regenerated.

The deployment checklist kept this change read-only and separate from deployment:
`main` is not protected, and no required-check policy or Vercel trigger was changed.
The README explains the check names, optional skips, failure inspection and normal
revert path. Personal workbook files remain untracked and were not uploaded.

### 2026-09-09 (R3.3) — **A new year needs more than renamed month tabs.**

The owner selected a separate summary per year. Read-only inspection of the supplied
workbook found that monthly date validation explicitly names 2026; duplicating a
tab without changing that rule would reject the year it claims to represent. The
rollover planner now duplicates twelve months, clears inherited inputs/comments
(including rows below the sync capacity), updates month titles and leap-aware date
rules, and builds one summary with copied formulas, dimensions, conditional formats
and explicitly retargeted chart series. The original summary stays unchanged. The
budget month registry and picker expand without changing its selected month; occupied
registry-extension cells cause a refusal. Partial years and unsupported templates
are not silently repaired.

All month/ledger overflow checks precede structural writes. Preparation is one Google
batch, followed by the existing values batch. A failed or timed-out second call does
not trigger deletion: empty prepared tabs may remain, or the write may already have
committed. A retry inspects metadata and reuses the year. The response adds
`created_tabs`; OpenAPI and the TypeScript contract were regenerated. No UI layout
changed, no production credentials were read, and neither personal XLSX was modified
or staged. Documentation now names rollover limits and the native-Google smoke test.

Verification: the full gate passes (549 web, 10 core, 360 API tests; 7 optional API
skips), including 126 focused Sheets tests. `pnpm run doctor` still reports the
missing root `.env`; test verification used the existing temporary Windows Python
environment, not the Linux `.venv` in the repository. No live Google round trip was
run. R3.3 is `[!]` with the precise remaining clause in `BACKLOG.md`, not marked done.

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
