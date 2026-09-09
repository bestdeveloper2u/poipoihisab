# Backlog

Everything deferred, and why.

**Scope is frozen per release.** Adding a line here is free. Building it
mid-release is not. Anything that arrives mid-release becomes a line here and is
considered at the next boundary.

Without that rule this file is a wishlist. With it, it is the pressure release
valve that lets you say "not now" without losing the idea — which is what
actually stops mid-release scope reversal.

## Two kinds of row

**`**Unmet:**` rows** name a clause the plan promises and the code does not do.
They are load-bearing: `scripts/audit-status.mjs` reads them, and a slice may
wear `[!]` only while one of these names its open clause. Start the Item cell
with the literal text `**Unmet:**` — the audit matches that prefix exactly.

To release the tick when the clause is finally built, strike the row through or
annotate it as closed. Do not delete it: a struck row records that the gap
existed and was closed; a deleted one is a gap that was never admitted.

**Every other row** is ordinary deferred work. It holds nothing back and never
blocks a tick.

The **Consider at** column names the slice this is FILED AGAINST — the one it
blocks, not the one that will eventually clear it.

## Open clauses

| Item | Raised | Consider at | Note |
| ---- | ------ | ----------- | ---- |
| ~~**Unmet:** R2.1 DoD 1 — not viewed at 1440 / 980 / 375px~~ | 2026-09-09 | R2.1 | **Closed 2026-09-09.** Inspected in Bengali at all three widths and in English at 375px. The warning banner, eight-tile KPI grid, quick links and recent-activity card stayed inside the viewport; the 980/375px bottom tab bar left the page end unobscured. No horizontal overflow at any width. |
| ~~**Unmet:** R2.1 session-end verification — 7 auth-cookie web tests fail before fetch~~ | 2026-09-09 | R2.1 | **Closed 2026-09-09.** Node's native `Request` rejects jsdom's `AbortSignal`; the timeout method itself exists. The shared test setup now uses Node's matching abort classes. All 17 affected auth tests pass with production auth and its four-second timeout unchanged. |
| **Unmet:** R2.2 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.2 | Built and machine-verified, never rendered in a browser: the roster table, its floating bulk bar and the two confirmation modals. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |
| **Unmet:** R2.3 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.3 | Built and machine-verified, never rendered in a browser: the inspector header, the eight summary cells and the four record tabs. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |
| **Unmet:** R2.4 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.4 | Built and machine-verified, never rendered in a browser: the twelve-column trend chart and the four ranked distribution lists. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |
| **Unmet:** R2.5 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.5 | Built and machine-verified, never rendered in a browser: the taxonomy table with its share bars and the merge modal. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |
| **Unmet:** R2.6 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.6 | Built and machine-verified, never rendered in a browser: the export card, the CSV dropzone and the import preview table. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |
| **Unmet:** R2.7 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.7 | Built and machine-verified, never rendered in a browser: the audit table, its filter select and the pager. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |
| **Unmet:** R2.8 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.8 | Built and machine-verified, never rendered in a browser: the admin list with grant-source column and the candidate list. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |
| **Unmet:** R2.9 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.9 | Built and machine-verified, never rendered in a browser: the session table and its two stat tiles. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |
| **Unmet:** R2.10 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.10 | Built and machine-verified, never rendered in a browser: the warning list and the three configuration panels. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |
| **Unmet:** R3.1 Done — never run against a real spreadsheet | 2026-09-09 | R3.1 | Every test drives a mocked Sheets API, so the contract is pinned but the round trip is not: the service-account share, the tab-title match against real Bengali sheet names, and how Google parses an ISO date and a decimal string under USER_ENTERED in the owner's locale are all unverified. Clearing it is one sync against a copy of the workbook, checking that the month's total is unchanged after syncing twice. Cost of leaving it: the first real sync could fail on a detail no unit test can see. |
| **Unmet:** R2.11 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.11 | Built and machine-verified, never rendered in a browser: the two integration cards and the status pills. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |

| **Unmet:** R3.2 Done — never run against a real spreadsheet | 2026-09-09 | R3.2 | The three ledger tabs are proven twice on paper and not once in practice: every formula was recalculated in LibreOffice against sample rows, and every write is pinned by a mocked-Google test. What no mock can show is the round trip — whether Google's tab-title match accepts `ধার-দেনা` and `পুনরাবৃত্ত খরচ` exactly as written, whether a `USER_ENTERED` write is *accepted and flagged* rather than rejected by a cell whose data validation is set to reject invalid input (this code assumes accepted-and-flagged), and how the settle date and next-run date parse in the owner's spreadsheet locale. Clearing it is one full sync against a copy of the new template, checking that the debt panel's totals match the app's ধার-দেনা screen and that a second sync changes nothing. Cost of leaving it: the first real sync could fail on a detail no unit test can see. |

## Deferred work

| Item | Raised | Consider at | Note |
| ---- | ------ | ----------- | ---- |
| The sheet covers one year; a month outside it refuses the whole sync | 2026-09-09 | R3.3 | The template has twelve month tabs for ২০২৬ and a yearly summary built for that one year. An expense dated 2027 refuses the sync by name, which is honest and is not the same as usable. Creating the tab would need `sheets.batchUpdate`'s `duplicateSheet` to carry the formulas, dropdowns and conditional formats across, plus a decision about what the yearly summary becomes once there is more than one year. Filed rather than built because R3.2's job was the three missing record types, not the calendar. |
| The sheet can hold the ledger but not reproduce the app's behaviour | 2026-09-09 | — | Recorded so the fallback is not mistaken for a replacement. After R3.2 the sheet holds every record type the app does, but recurring rules do not materialize themselves there, a debt's partial payment has to be typed into the বাকি cell by hand, and nothing enforces the app's own validation on a row typed straight into the sheet. `GET /export/backup.json` stays the only full-fidelity, restorable copy. |
| Version labels disagree across shipped surfaces | 2026-09-09 | R3 | The R2.1 browser pass showed `v0.6.0` from `packages/core/src/brand.ts` while the web package, API settings and `.env.example` say `0.28.0`; mobile's `app.json` also says `0.6.0`. The version chip therefore does not identify the deployed build consistently. Filed rather than fixed because R2.1 is a visual-verification slice and the one-slice rule forbids folding release-version policy into it. |
| No CI: `pnpm verify` runs only on a developer machine | 2026-09-09 | R3 | There is no `.github/workflows`, so every gate in this repo is voluntary. The audit layer is worth roughly half of what it should be until a push runs it. Blocked on nothing — it is one workflow file calling `pnpm verify` plus `uv sync`. The reason it is filed rather than built: it arrived mid-R2. |
| Retro-verify R1 against this Definition of Done | 2026-09-09 | R3 | R1's twelve boxes read `[x]` because the slices are shipped, in production, and each has a Done clause a test already proves. They were never walked against points 1–4 of the current DoD, which did not exist when they were built. Not an open clause — the plan makes no promise R1 breaks — but the ticks are softer than R2's will be once its eleven rows above are cleared. |
| Migrate to Vercel Services rather than the `api/index.py` shim | 2026-09-09 | R3 | Closed decision D2 keeps the API same-origin, and Services gets that with separate per-service builds, so a CSS change stops rebuilding the Python function. Costs: the shim goes, `functions.regions` moves into the service block, and the feature needs the Services permission on the plan. Not urgent — the coupling costs build minutes, not correctness. |
| `/admin/security` scans at most 300 profiles, one KV round trip each | 2026-09-09 | R3 | The per-user session index has no reverse mapping, so listing live sessions across the platform is O(users) lookups. Fine at current scale and it will quietly stop being the whole truth as the user count grows — the page reports how many it scanned, which is what keeps it honest rather than wrong. A reverse index would fix it and is not worth a schema change yet. |
| Category merge has no undo | 2026-09-09 | R3 | `POST /admin/categories/merge` rewrites `expenses.cat` for every user in one statement. The audit row records the from/to pair and the affected count, so the merge is reconstructible by hand, but there is no one-click reverse. Deliberate for now: the reverse of a merge is ambiguous once two source values have been folded into one. |
| The mobile app has no admin surface | 2026-09-09 | — | Intentional, recorded so it is not mistaken for an omission. D5 makes superadmin an operator role, and operators work from a desktop. `apps/mobile` carries the member screens only. |
| Confirm the Supabase project region matches the API's pinned Vercel region | 2026-09-09 | R3 | The region is `functions["api/index.py"].regions` in `vercel.json` and it has already moved once (Seoul to Mumbai) since this row was written, so the row names the source rather than the value — a figure copied into prose goes stale the first time somebody tunes it. If the database sits elsewhere, round-trip latency dominates the pooler and NullPool work already done. One console check, filed because it is an infrastructure fact nobody has written down. |
