# Working agreement — Poi Poi Hisab

Short on purpose. `ROADMAP.md` is the plan; this is how we work on it. All of it
exists because work outruns verification, and a project dies at the point where
nobody can say what is actually true about it any more.

## The one rule

**One slice per session, finished.** Done means every Definition-of-Done point
below, not "the code is written". If a slice is too big for a session, it was
two slices. Do not start a second. Do not "quickly also fix" something else. Do
not refactor and add a feature in the same session.

## Session start

1. `git pull`
2. `pnpm doctor` — every toolchain problem in one report, each with its fix. A
   wiring problem found one blocked commit at a time feels like a framework
   problem and invites a rewrite.
3. Read the slice in `ROADMAP.md` Part 5 — UI, Does, Data, Done.
4. Read `STATUS.md`: what the slice touches, and which previous conclusions
   turned out to be wrong.

## Session end

1. `pnpm verify` — must pass. Audits, both typecheckers, both linters, both test
   suites (TypeScript and Python).
2. Update `STATUS.md` in the same commit as the code.
3. Commit **and push**. Never end a session with unpushed commits.

`pnpm wip` before anything risky: snapshots the working tree to a git ref
without touching HEAD, the index, or any file.

## Definition of Done

Binary — you either did it or you did not.

1. **Renders at 1440 / 980 / 375px.** Three widths, looked at. The sidebar
   becomes the bottom tab bar at 1024px, so 980 is not optional.
2. **Every state handled**: loading, empty, error, populated, and under
   `/admin`, permission-denied.
3. **Bengali and English both read correctly.** Every key in both dictionaries;
   numerals through `toBnDigits` in bn.
4. **Offline path decided.** Either the mutation goes through the outbox, or the
   slice says in `ROADMAP.md` why it must not.
5. **Every value comes from the API.** No fixtures, no hardcoded copy, no
   invented numbers.
6. **Every mutation's failure path shows a real message saying what did _not_
   happen.**
7. **Authorisation enforced server-side, with a test for the DENIED case.** An
   SPA route guard is a convenience, never the enforcement.
8. **Contracts regenerated** — `dump_openapi.py`, `pnpm generate:client`, every
   consumer compiles — in the same commit.
9. **`STATUS.md` updated in the same commit.**
10. **Committed and pushed.**

## Absolute constraints

Breaking one is a defect regardless of whether tests pass. Each names the
failure that produced it. Add an entry the same day something breaks, or you
will not add it.

1. **A guard needs a test that makes it fire.** The first last-superadmin guard
   could not fire at all: every caller filters its own id out of the targets, so
   the acting admin always supplied the one remaining admin the check looked
   for. Decoration in a security path is worse than an absence — it stops the
   next person looking.

2. **A label with no field behind it is a broken screen.** `adminActiveUsers`
   shipped in the dictionary while `/admin/stats` never returned the number; the
   tile rendered `undefined`. `audit-i18n.mjs` checks both directions — the
   reverse one is how a dictionary reaches 458 entries of which some lie.

3. **A fixture in the wrong shape makes its assertions vacuous.** The admin test
   stubbed `total_users` where the API emits `totalUsers`; every KPI assertion
   read `undefined` and passed. Fixtures use the shape the API actually returns.

4. **A silent fallback is an outage with no symptom.** Empty
   `POIPOIHISAB_KV_URL` falls back to in-process `MemoryKV`: on serverless that
   signs everyone out each cold start and resets the brute-force limiter, and
   nothing says so. A fallback that changes correctness rather than performance
   must be visible — `/admin/system` reports the live backend.

5. **The API stays same-origin with the web app.** The refresh cookie is
   `SameSite=Lax` with no `Domain`; `vercel.json` sets `connect-src 'self'`.
   Move the API to its own origin and the browser withholds the cookie on
   refresh, logging every user out after 900s. `VITE_API_URL` is empty on
   purpose — closed decision **D2**.

6. **The audit trail commits in the same transaction as the action.** Rows are
   staged on the caller's session. A trail written afterwards can record an
   action that rolled back, or miss one that did not.
   `POST /admin/users/bulk-delete` cascades irreversible deletes over an
   arbitrary id list and existed for weeks with no record of who ran it.

7. **One name per concept** — schema, routes, UI copy, comments. The
   `khoroch` → `poipoihisab` rename is gated by `audit-vocabulary.mjs`; cheap
   now, expensive during the rename.

8. **Money is a decimal string on the wire and `Numeric(12,2)` in the
   database.** Never a float, never a JS `number` in transit. `fmtTaka` is the
   only place a display string is made.

9. **`expenses.cat` is free text and drifting.** `grp` is constrained to the
   `ExpenseGroup` literal; `cat` takes any 1–80 characters, is what the Bengali
   voice parser writes, and is what every report groups by — so "রিক্সা" and
   "রিকশা" are two categories to the database and one thing to a person. Reuse
   an existing value where one fits. `/admin/categories` shows and merges drift.

10. **Every route under `/admin` carries `SuperAdminDep`.** Gated by
    `audit-superadmin.mjs`. One omission exposes every user's expense history to
    any authenticated account.

11. **Every model table has a migration, and `ensure_schema_ready` creates what
    a serverless deploy needs before its first request.** Alembic does not run
    on a Vercel deploy, so a model without a migration works locally against a
    recreated SQLite file and 500s in production.

12. **Closed decisions stay closed.** The list is `ROADMAP.md` Part 2, each with
    a date and its reasoning. Without it every hard week reopens the stack.

## Scope

**Frozen per release.** Anything arriving mid-release becomes a `BACKLOG.md`
line, considered at the next boundary — never merged into the release in flight.
If asked for something outside the current release, say so and file it.

## Honesty requirements

- If you cannot run something, say so. Unverified code is a draft. This
  checkout's `node_modules` holds win32-only esbuild and rollup binaries, so
  Vitest and Vite cannot run from a Linux shell against it — say that rather
  than reporting a suite you did not execute.
- If a check fails, report the failure. Never call work done because it was
  written.
- If the plan and the code disagree, the code is the truth and the plan is a
  bug. Say which.

## Comments

Comments record **what was tried and why it failed**, not what the code does.

    // BAD:  count the superadmins
    // GOOD: DB-flagged admins only. Counting the env allowlist too made this
    //       guard unfireable — the acting admin is never in the target list,
    //       so it always supplied the one remaining admin the check wanted.

Write it the moment you understand the failure; that understanding does not
survive the week.

## Where things are

| Need | Look in |
|---|---|
| What a slice must do | `ROADMAP.md` Part 5 |
| Closed decisions | `ROADMAP.md` Part 2 |
| What is actually built | `STATUS.md` |
| Deferred work, and why | `BACKLOG.md` |
| Why a rule exists | this file, the constraint's own paragraph |
| What a gate checks | the docstring in its `scripts/audit-*.mjs` |
