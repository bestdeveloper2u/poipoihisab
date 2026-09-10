# Poi Poi Hisab — roadmap

## Part 0 — Why this document set exists

This project did not fail; it drifted, in the specific way a project drifts when
verification is manual. Three examples, all found in one session in September
2026 and all invisible to a green build:

- A last-superadmin guard that could not fire, because every caller filtered its
  own id out of the target list before the count ran.
- A dictionary key (`adminActiveUsers`) with no field behind it, rendering
  `undefined` in a KPI tile since the day it shipped.
- A test fixture in `snake_case` against an API that emits `camelCase`, which
  made every assertion in it compare `undefined` to nothing and pass.

None of the three is a hard bug. All three are the same shape: **something was
written, nothing checked whether it was true.** Every constraint in `CLAUDE.md`
traces to an incident like these, and every one that could be mechanised has a
script in `scripts/`.

## Part 1 — Operating rules

In `CLAUDE.md`. One slice per session; `pnpm verify` green before commit;
`STATUS.md` updated in the same commit.

Release boundaries are the only time scope changes. At each one: read
`BACKLOG.md`, promote or re-file, and check that every `[!]` still has a live
`**Unmet:**` row whose reasoning is still true.

## Part 2 — Architecture, and the decisions that are closed

pnpm 10 workspaces. `apps/web` (React 19 + Vite 6 + Tailwind v4 PWA),
`apps/api` (FastAPI + SQLAlchemy 2 async + Alembic, managed with uv),
`apps/mobile` (Expo / React Native), `packages/core` (money, i18n, brand
tokens), `packages/api-client` (typed client generated from `openapi.json`).

**D1 — Bengali is the first language, not a translation.** 2026-08. Every
dictionary carries `bn` and `en` at parity and `bn` is the default. Numerals go
through `toBnDigits`. Closed: the product is for everyday use in Bangladesh, and
a bn-second UI reads as a port.

**D2 — The API is same-origin with the web app, on one Vercel project.**
2026-09-09. The refresh cookie is `SameSite=Lax` with no `Domain`, and
`vercel.json` sets `connect-src 'self'`; splitting the API to its own origin
makes the browser withhold the cookie on refresh and logs every user out after
the 900-second access token expires. Reopening this costs an apex domain, a
cookie `Domain` attribute, a widened CSP, and per-deployment `VITE_API_URL`
wiring for every preview URL. If the coupled Python rebuild becomes the problem,
the answer is Vercel Services — separate builds, one origin — not two projects.

**D3 — Auth is ours: Argon2id + HS256 access tokens + rotating refresh
cookie.** 2026-08. Not Supabase Auth. `profiles.id` is a plain uuid rather than
a reference to `auth.users`, and authorisation lives at the API layer instead of
in RLS. Closed: the API already had to exist for the voice parser and reports,
and one identity system is cheaper than two.

**D4 — Sessions and rate-limit counters live in shared KV, not process
memory.** 2026-09. `MemoryKV` is a local-development convenience only. On
serverless it signs every user out on each cold start and resets the
brute-force limiter with no error. `POIPOIHISAB_KV_URL` is required in
production and `/admin/system` reports the live backend.

**D5 — Superadmin is an operator, not a user.** 2026-09-09. Owner: "superadmin
no need hisab entry, other user need this." A superadmin gets the admin
navigation instead of the hisab navigation and no add-expense FABs; the member
routes stay registered and reachable through the user-view item so nothing is
lost.

**D6 — Money is a decimal string on the wire, `Numeric(12,2)` in the
database.** 2026-08. Never a float, never a JS `number` in transit.

## Part 3 — Data architecture

`profiles` (identity, `lang`, `theme`, `is_superadmin`, `is_suspended`),
`expenses` (`cat` free text, `grp` constrained, `amt` numeric, `iso` date),
`debts` (`dir` lend/borrow, partial repayments, `settled_at`), `budgets`
(monthly total plus per-category limits), `recurring_expenses`, `kv_store`
(sessions and counters when KV is Postgres), `admin_audit_log` (append-only,
no foreign keys so it outlives both the admin and the deleted user).

Roles: **anonymous** (login and register only), **member** (own rows only —
every query is filtered by `user_id` from the access token), **superadmin**
(every row, every route under `/admin`, gated by `SuperAdminDep`).

Authorisation is enforced in the API, not in the database. That is a consequence
of D3 and it means the API is the only door: there is no second enforcement
layer to fall back on, which is why constraint 10 in `CLAUDE.md` is mechanised.

## Part 4 — Release plan

**R1 — the hisab itself.** Shipped and in production. Record daily expenses by
typing or by Bengali voice, see them by day and month, track debts, set budgets,
automate recurring bills, read reports, sync to Google Sheets, work offline.

**R2 — the operator shell.** Code complete, not yet visually reviewed. Splits
superadmin off from the member experience and gives the platform the oversight
it had no way to provide: an audit trail, role management, cross-user session
control, taxonomy repair, and a system-health probe.

**R3 — not yet fully scoped**, except for R3.1–R3.4 below, requested during R2:
R3.1 after a real workbook showed the export could not populate it, R3.2 after the
owner asked whether the sheet could hold everything, so that the ledger survives the
app going away. R3.3 follows that handoff, with the owner's explicit choice of
one summary per year. R3.4 takes the unblocked CI backlog item on the next-task
request. Read `BACKLOG.md` at the R2 boundary for the rest.

## Part 5 — Screen by screen

**R1.1 Login and registration** · `/login`

**UI** — email and password, a register toggle, a demo-credentials hint, the
language toggle, and inline field errors.
**Does** — Argon2id verification; a fixed-window limiter keyed by IP and email
bucket; on success an access token in memory and a rotating refresh cookie
scoped to `/api/v1/auth`; a suspended account is refused with 403, not 401.
**Data** — `profiles`; KV for the limiter and the session record.
**Done** — a wrong password consumes limiter budget and the sixth attempt in a
minute returns 429 with `Retry-After`, proven by `test_auth.py`.

**R1.2 Dashboard** · `/`

**UI** — four stat tiles (today, this month with delta, last month, year), a
budget progress card, a month comparison, per-group bars, a monthly trend.
**Does** — reads the monthly and yearly report endpoints, never recomputes
totals client-side; empty state names what would fill it.
**Data** — `expenses`, `budgets` via `/reports/*`.
**Done** — with the current month at ৳4,820 against a ৳20,000 budget the card
reads "৳15,180 বাজেটে বাকি" and the delta against last month reads "কম",
proven by `AppShell.test.tsx`.

**R1.3 Expense list** · `/expenses`

**UI** — virtualised list, search, group filter, per-row edit and delete with
undo, a manual add form, and the voice overlay.
**Does** — cursor pagination; optimistic delete with an undo window; duplicate
guard on same cat/amt/date; offline writes go to the outbox and replay in order.
**Data** — `expenses`.
**Done** — a delete shows an undo toast and the row returns if it is used before
the window closes, proven by `delete-undo.test.tsx`.

**R1.4 Monthly hisab** · `/month`

**UI** — a day-by-day matrix for the selected month with per-day and per-group
totals.
**Does** — one monthly report request per month view; the month is a URL
parameter so a view is linkable.
**Data** — `expenses` via `/reports/monthly`.
**Done** — the matrix totals equal the month total from the API, not a
client-side sum of the visible rows.

**R1.5 Reports** · `/report`

**UI** — monthly and yearly matrices, category distribution, comparative trend,
and a share action.
**Does** — server-side aggregation only; Bengali numerals throughout.
**Data** — `expenses` via `/reports/monthly` and `/reports/yearly`.
**Done** — the yearly view renders ৳49,778 from a `by_month` series without
summing it in the browser, proven by `report-screen.test.tsx`.

**R1.6 Debts** · `/debts`

**UI** — receivable (পাবো) and payable (দেবো) lists, party name, partial
repayment history, settle action, and the voice overlay for debt entry.
**Does** — `dir` decides the sign; a settled debt keeps its history rather than
being deleted; net position is derived, never stored.
**Data** — `debts`.
**Done** — settling a debt leaves its repayment rows readable and moves the net
position by exactly the outstanding amount, proven by `debts-screen.test.tsx`.

**R1.7 Budget** · `/budget`

**UI** — a monthly total limit, per-category limits, progress with a warning
band.
**Does** — the nudge fires from the crossing, not from every render; the month's
spend comes from the reports endpoint.
**Data** — `budgets`, `expenses`.
**Done** — crossing a category limit raises the nudge exactly once per month per
category, proven by `budgetNudge.test.ts`.

**R1.8 Recurring expenses** · `/recurring`

**UI** — rules with category, amount, frequency, next run, and an active toggle.
**Does** — a once-per-local-day boot run posts due rules; a rule that has
already run today is not re-posted.
**Data** — `recurring_expenses`, `expenses`.
**Done** — two boot runs on the same local day create one expense, proven by
`test_recurring.py` and `recurringRun.test.tsx`.

**R1.9 Settings** · `/settings`

**UI** — profile, language, theme, motion, voice language, payment methods,
expense groups, Sheets sync, backup and restore, live sessions, logout.
**Does** — theme honours `prefers-color-scheme` in system mode; a superadmin
sees no Sheets, backup or catalog cards (D5).
**Data** — `profiles`, KV for the session list.
**Done** — "revoke other sessions" leaves exactly the current session live and
returns 409 rather than guessing when the token carries no `sid`, proven by
`test_auth_sessions.py`.

**R1.10 Bengali voice entry** · overlay

**UI** — a full-screen overlay with live transcript, parsed fields, and one-tap
save.
**Does** — recognition runs in the browser; parsing is server-side at
`/voice/parse`; Bengali numerals and spoken amounts both resolve; an
unparseable phrase falls back to the manual form pre-filled with what was
understood.
**Data** — `expenses` via the parser.
**Done** — "মাছ ৮৯০ টাকা" yields cat "মাছ", grp food, amt 890.00, proven by
`test_voice_parse.py`.

**R1.11 Offline-first shell** · PWA

**UI** — an install chip when the browser offers one, an update toast when a new
service worker waits.
**Does** — the app shell is precached; `/api/**` is never cached, because a
cached financial figure read as current is worse than an error; writes queue in
an outbox and flush on reconnect, with Background Sync where available.
**Data** — the outbox in browser storage; `expenses`, `debts`.
**Done** — an expense added with the network down appears in the list
immediately and reaches the API once, not twice, on reconnect, proven by
`outbox.test.ts`.

**R1.12 Google Sheets sync** · in `/settings`

**UI** — a sheet URL or id field, sync-this-month and sync-all, and the service
account address to share the sheet with.
**Does** — a REST append per sync; formula injection defused in every text
column; an unconfigured deployment says so instead of failing opaquely.
**Data** — `expenses`; the service-account credential from settings.
**Done** — a category beginning with `=` arrives in the sheet as text, proven by
`test_sheets_export.py`.

**R2.1 Admin overview** · `/admin`

**UI** — a deployment warning banner first, then eight KPI tiles (ten metrics;
new users and current-month volume are contextual hints), a quick-links
grid, and the six most recent admin actions.
**Does** — the warning list comes from `/admin/system` and renders above the
numbers, because a MemoryKV fallback makes every number below it less
trustworthy; a superadmin landing on `/` is redirected here (D5).
**Data** — `/admin/stats`, `/admin/system`, `/admin/audit`.
**Done** — with `POIPOIHISAB_KV_URL` unset the page names the fallback before
any KPI, proven by `admin-screen.test.tsx`.

**R2.2 Users roster** · `/admin/users`

**UI** — a searchable table of every registered user with status, expense count,
total spend and join date; single suspend, reactivate and delete; a floating
bulk bar.
**Does** — the acting admin's own row is never selectable, because the API
refuses self-suspend and self-delete and offering the checkbox would only
mislead; bulk delete is capped at 100 targets per call and five calls per minute
per admin.
**Data** — `/admin/users`, `profiles`.
**Done** — a bulk delete of 101 ids is refused with a message naming the limit,
proven by `test_admin_oversight.py`.

**R2.3 User inspector** · `/admin/users/:userId`

**UI** — identity, grant source, eight financial summary cells, and four tabs
(expenses, debts, budgets, recurring); revoke-sessions, suspend and delete.
**Does** — a route rather than a modal, so an admin can link a colleague at a
user and the back button behaves; this is the only screen that reads one user's
individual rows.
**Data** — the four `/admin/users/{id}/*` endpoints.
**Done** — revoking sessions signs the user out everywhere and they can log
straight back in, proven by `test_admin_oversight.py`.

**R2.4 Platform analytics** · `/admin/analytics`

**UI** — a twelve-month column chart with its own data table, ranked
distributions by group, category and payment method, debt totals, and top
spenders.
**Does** — aggregate only; no individual expense row leaves this endpoint. The
month key is built in Python rather than with `strftime`/`to_char`, which spell
differently on SQLite and Postgres.
**Data** — `expenses`, `debts`, `profiles`.
**Done** — the response contains distributions and totals and no `items` array,
proven by `test_admin_oversight.py`.

**R2.5 Category taxonomy** · `/admin/categories`

**UI** — every distinct cat/grp pair with usage count, distinct users and total,
a share bar, and a merge action.
**Does** — merge rewrites `expenses.cat` for every user in one statement and is
audited with the from/to pair and the row count; a no-op merge is refused.
**Data** — `expenses`, `admin_audit_log`.
**Done** — merging "রিক্সা" into "রিকশা" leaves one pair with the combined count
and writes one `category.merge` audit row, proven by `test_admin_oversight.py`.

**R2.6 Data import and export** · `/admin/data`

**UI** — an export button, a CSV dropzone, a sample download, and a preview
table before the import runs.
**Does** — the export is itself audited, because it dumps every user's name,
email and spend in one request; formula injection defused per cell; import skips
duplicates and invalid emails and reports both counts.
**Data** — `profiles`, `admin_audit_log`.
**Done** — one export writes one `user.export` audit row carrying the row count,
proven by `test_admin_oversight.py`.

**R2.7 Audit log** · `/admin/audit`

**UI** — a filterable, paginated table of every admin action with actor, target,
affected count, detail and IP.
**Does** — read-only; there is no endpoint that edits or deletes an entry,
because a trail an admin can rewrite is not a trail. Rows are staged on the
caller's session so they commit with the action and vanish with its rollback.
**Data** — `admin_audit_log`.
**Done** — a 400 or 404 from a mutating admin endpoint leaves no row, proven by
`test_admin_oversight.py`.

**R2.8 Admins and roles** · `/admin/roles`

**UI** — current admins with their grant source, a candidate list with search, a
grant and revoke action, and the environment allowlist shown verbatim.
**Does** — revoking an env-granted admin is refused with the real cause rather
than answering 200 to a change that does nothing; the database is never left
with zero usable admins; nobody may revoke their own grant.
**Data** — `profiles`, `/admin/system` for the allowlist.
**Done** — an env-only admin cannot demote, suspend or delete the last
DB-flagged admin, proven by three calls in `test_admin_oversight.py`.

**R2.9 Sessions and security** · `/admin/security`

**UI** — live session counts per user with the longest remaining expiry, and a
revoke action per row.
**Does** — walks the per-user session index rather than guessing; users with no
live session are omitted rather than padding the list; when KV is in-process the
page says the list describes one server instance.
**Data** — KV session records, `profiles`.
**Done** — the page names the KV backend and flags it when ephemeral, proven by
`admin-screen.test.tsx`.

**R2.10 System health** · `/admin/system`

**UI** — a warning list first, then database, session store and configuration
panels.
**Does** — probes through the request's own session, so it describes the
database actually being served rather than whatever the module-level engine
points at; reports the alembic head and whether the audit table exists.
**Data** — the live connection, `Settings`, `alembic_version`.
**Done** — with KV unset the warning list names `POIPOIHISAB_KV_URL` and the
session store panel reads ephemeral, proven by `test_admin_oversight.py`.

**R2.11 Integrations** · `/admin/integrations`

**UI** — Google Sheets status with the derived service-account address, the
credential source, and voice parser status.
**Does** — never echoes the credential; inline JSON is reported as
"(inline JSON)" because that is how the serverless deploy receives it.
**Data** — `Settings`, `profiles` count.
**Done** — with the credential supplied inline the response contains
"(inline JSON)" and no `client_email` key, proven by `test_admin_oversight.py`.

**R3.1 Sheets sync into the workbook's month tabs** · `POST /export/sheets`

**UI** — none. The settings card's existing "এই মাস সিঙ্ক করুন" and "সব সিঙ্ক করুন"
buttons keep their wording; the response now also carries the tabs it replaced and any
categories the workbook cannot place in a group.
**Does** — routes each expense to the tab for its own month (`সেপ্টেম্বর ২০২৬`), writes
`A:C` and `E:F` and never column `D`, because `D` is the sheet's group lookup. The amount
goes as a number, not Bengali digits — under `USER_ENTERED` "৪৮০.০০" is text and every
`SUM` skips it. The payment enum arrives as the exact strings the sheet's dropdown
validates against. A sync replaces all 200 owned rows in one request, including empty
trailing cells, so it is idempotent without a clear-then-write failure window. Columns
`D` (formulas) and `G` (manual comments) are untouched. A month over 200 rows refuses
the whole sync before any write. Missing tabs also refuse unless R3.3 can prepare
a complete new year from the intact template; no formula-less tabs or truncation.
**Data** — `expenses` via the CSV generator's own query; the workbook's `'সেটিংস'!B2:B`
for the category check.
**Done** — syncing the same month twice leaves the sheet identical and its total
unchanged, and a category outside the workbook's list is written verbatim and named in
the response rather than being placed in a guessed group.

**R3.2 The sheet as a standalone ledger** · `POST /export/sheets`

**UI** — the Settings sync toast stops reporting a row count and nothing else: it
names what the three ledger tabs now hold, the ledger tabs this workbook does not
have, and the categories the workbook's list does not contain — the last of these
reported by the API since R3.1 and displayed nowhere until now.
**Does** — writes the app's other three record types into three whole-state tabs:
`ধার-দেনা` (rows 4–103), `বাজেট` (rows 4–53, plus the monthly total in `D2`) and
`পুনরাবৃত্ত খরচ` (rows 4–103). Those three are current state, not a month of
history, so `month` does not narrow them and every sync rewrites all three in full —
a sheet that is only current after the *right kind* of sync is not a fallback. Each
tab's computed columns are written around, exactly as column `D` is on the month
sheets: `অবস্থা` on the debt sheet, `গ্রুপ` and `মাসিক সমমান` on the recurring
sheet, the four computed columns and the unbudgeted-spend line on the budget sheet.
A workbook without these tabs is an older copy of the template, not a broken one —
its ledger tabs are skipped and named in the response and its months still sync,
where a missing MONTH tab refuses unless R3.3 can prepare a new year. A ledger tab over its row count refuses the
whole sync before writing, like a full month. Budget rows follow the workbook's own
category order. `apps/api/scripts/add_ledger_sheets.py` builds the three sheets and
names the same geometry.
**Data** — `debts`, `budgets` and `recurring_expenses`, each scoped to the caller;
`'সেটিংস'!B2:B` for the category order and the unlisted-category report.
**Done** — syncing twice writes byte-identical payloads; a record deleted in the app
clears its row rather than being left behind; a workbook with none of the three tabs
still syncs its months and names all three as skipped; and the response tells the
three cases apart — a tab written with zero records, a tab that is not there, and a
tab too full to write.

**R3.3 Multi-year Sheets ledger** · `POST /export/sheets`

**UI** — existing Settings actions; `created_tabs` in the response names newly
created months and summaries. No new screen or offline queue: Google sync remains
online-only and must report an uncertain remote outcome rather than replay silently.
**Does** — when a requested month belongs to a wholly absent year, extend the intact
2026 template with twelve duplicated, empty month tabs and a separate
`বার্ষিক সারসংক্ষেপ YYYY` (Bengali digits). Preserve the original summary. Update new
month date validation, including leap days; copy summary formulas, formatting,
dimensions and charts with new-year references; extend MonthTabs and the budget
picker without changing its selected value. Refuse partial-year reconstruction,
altered templates, registry collisions, more than ten new years per call, and
automatic years outside 1900–9999. Existing tabs retain the previous sync behavior.
All expense/ledger capacity checks happen before any write. Structural preparation
is one atomic Google batch, followed by the existing single values batch. If the
values result is uncertain, prepared months may exist; inspect and retry. Never
delete tabs to roll back an ambiguous remote outcome.
**Data** — the existing owner-scoped exports; Google sheet IDs, summary formula/chart
metadata and settings column I. No personal XLSX is uploaded or altered.
**Done** — mocked tests prove request geometry, formula/chart retargeting, leap-year
validation, collision refusal, capacity-before-write and retry without duplication.
A live disposable Google workbook must also prove new-year totals, charts, dropdowns,
unchanged old-year totals and identical results on the second sync. Until that round
trip, this slice is `[!]`, not done.

**R3.4 Continuous integration** · `.github/workflows/verify.yml`

**UI** — GitHub check results, not a product screen. No UI, translations, database
migration, production deployment or offline mutation is introduced.
**Does** — run on pushes, pull requests and manual dispatch on fresh Linux and
Windows runners. Install locked pnpm/uv dependencies, regenerate and compare the
committed API contracts, run `pnpm verify`, then build the production web bundle.
Pin action implementations by commit, grant only repository read permission,
disable persisted checkout credentials, cancel superseded runs, and bound job
duration. Use mocked external integrations and SQLite; no production secrets.
**Data** — committed source, `pnpm-lock.yaml`, `apps/api/uv.lock` and the API
contract. Caches contain downloaded dependencies, not shared `node_modules`.
**Done** — the workflow passes syntax validation and the first GitHub-hosted run
passes on both operating systems. Existing optional Postgres and template tests
remain skipped unless their prerequisites are supplied. Making the checks required
for merging is a separate owner-controlled repository-policy decision; this slice
does not change branch protection or gate Vercel deployment.

**R3.5 Consistent release labels** · `/settings`, Expo metadata and API package

**UI** — the existing web version chip and mobile version footer identify the
same committed release as the web package: `0.28.0`. No layout or translation
changes. Version strings are build metadata, not ledger values; retain their
machine-readable form in both languages. No new loading, error or permission state.
**Does** — align shared UI, workspace package, Expo and Python package versions;
use the shared release value when Expo metadata is unavailable. Audit committed
release surfaces against `apps/web/package.json`, including the API default,
example environment, OpenAPI and Python lockfile. Missing, malformed or drifting
versions fail verification. Explicit API runtime version overrides remain valid.
No native build-number increment, app-store submission or deployment-setting change.
**Data** — committed build metadata only. No API contract change or mutation,
authorization change, migration or outbox work; the static label also works offline.
**Done** — the audit has failing-case tests for every source and accepts a
coordinated release bump. Both language Settings tests pass, the web label is
viewed at 1440 / 980 / 375px, mobile typechecks, contracts regenerate unchanged,
and the complete gate and production web build pass. Native device execution is
outside this metadata-only slice; Expo metadata is checked statically.

## Part 6 — Verification

`pnpm verify` is the gate and runs, in order:

| Layer | Command | What it proves |
|---|---|---|
| Audit tests | `pnpm test:audits` | version guard accepts coordinated changes and rejects drift or missing declarations |
| Invariants | `node scripts/audit.mjs` | every audit in `scripts/`, one exit code |
| Web types | `pnpm typecheck:web` | `tsc --noEmit` across `apps/web` |
| Mobile types | `pnpm typecheck:mobile` | `tsc --noEmit` across `apps/mobile` |
| Web lint | `pnpm lint:web` | ESLint 9, including react-refresh boundaries |
| Web tests | `pnpm test:web` | 60 spec files, `src/` and `tests/` |
| Core tests | `pnpm test:core` | money and i18n helpers |
| API lint | `pnpm lint:api` | Ruff across `app` and `tests` |
| API tests | `pnpm test:api` | pytest, in-memory SQLite, fresh MemoryKV per test |

`pnpm doctor` is separate and diagnostic: it reports toolchain problems with a
fix per line rather than gating.
