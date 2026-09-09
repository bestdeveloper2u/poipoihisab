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
| **Unmet:** R2.1 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.1 | Built and machine-verified, never rendered in a browser: the overview's warning banner, KPI grid and quick-links grid. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |
| **Unmet:** R2.2 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.2 | Built and machine-verified, never rendered in a browser: the roster table, its floating bulk bar and the two confirmation modals. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |
| **Unmet:** R2.3 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.3 | Built and machine-verified, never rendered in a browser: the inspector header, the eight summary cells and the four record tabs. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |
| **Unmet:** R2.4 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.4 | Built and machine-verified, never rendered in a browser: the twelve-column trend chart and the four ranked distribution lists. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |
| **Unmet:** R2.5 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.5 | Built and machine-verified, never rendered in a browser: the taxonomy table with its share bars and the merge modal. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |
| **Unmet:** R2.6 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.6 | Built and machine-verified, never rendered in a browser: the export card, the CSV dropzone and the import preview table. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |
| **Unmet:** R2.7 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.7 | Built and machine-verified, never rendered in a browser: the audit table, its filter select and the pager. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |
| **Unmet:** R2.8 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.8 | Built and machine-verified, never rendered in a browser: the admin list with grant-source column and the candidate list. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |
| **Unmet:** R2.9 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.9 | Built and machine-verified, never rendered in a browser: the session table and its two stat tiles. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |
| **Unmet:** R2.10 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.10 | Built and machine-verified, never rendered in a browser: the warning list and the three configuration panels. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |
| **Unmet:** R2.11 DoD 1 — not viewed at 1440 / 980 / 375px | 2026-09-09 | R2.11 | Built and machine-verified, never rendered in a browser: the two integration cards and the status pills. Cost of leaving it: a layout break on one width ships silently, and the admin shell is the one surface with no user to report it. Clearing it is one pass with the viewport at three widths, ticking the box per screen as it is seen. |

## Deferred work

| Item | Raised | Consider at | Note |
| ---- | ------ | ----------- | ---- |
| No CI: `pnpm verify` runs only on a developer machine | 2026-09-09 | R3 | There is no `.github/workflows`, so every gate in this repo is voluntary. The audit layer is worth roughly half of what it should be until a push runs it. Blocked on nothing — it is one workflow file calling `pnpm verify` plus `uv sync`. The reason it is filed rather than built: it arrived mid-R2. |
| Retro-verify R1 against this Definition of Done | 2026-09-09 | R3 | R1's twelve boxes read `[x]` because the slices are shipped, in production, and each has a Done clause a test already proves. They were never walked against points 1–4 of the current DoD, which did not exist when they were built. Not an open clause — the plan makes no promise R1 breaks — but the ticks are softer than R2's will be once its eleven rows above are cleared. |
| Migrate to Vercel Services rather than the `api/index.py` shim | 2026-09-09 | R3 | Closed decision D2 keeps the API same-origin, and Services gets that with separate per-service builds, so a CSS change stops rebuilding the Python function. Costs: the shim goes, `functions.regions` moves into the service block, and the feature needs the Services permission on the plan. Not urgent — the coupling costs build minutes, not correctness. |
| `/admin/security` scans at most 300 profiles, one KV round trip each | 2026-09-09 | R3 | The per-user session index has no reverse mapping, so listing live sessions across the platform is O(users) lookups. Fine at current scale and it will quietly stop being the whole truth as the user count grows — the page reports how many it scanned, which is what keeps it honest rather than wrong. A reverse index would fix it and is not worth a schema change yet. |
| Category merge has no undo | 2026-09-09 | R3 | `POST /admin/categories/merge` rewrites `expenses.cat` for every user in one statement. The audit row records the from/to pair and the affected count, so the merge is reconstructible by hand, but there is no one-click reverse. Deliberate for now: the reverse of a merge is ambiguous once two source values have been folded into one. |
| The mobile app has no admin surface | 2026-09-09 | — | Intentional, recorded so it is not mistaken for an omission. D5 makes superadmin an operator role, and operators work from a desktop. `apps/mobile` carries the member screens only. |
| Confirm the Supabase project region matches the API's `icn1` | 2026-09-09 | R3 | The function is pinned to Seoul. If the database sits in another region, round-trip latency dominates the NullPool and pooler work already done. One console check; filed because it is an infrastructure fact nobody has written down. |
