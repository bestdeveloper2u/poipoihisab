# The audit layer

Node built-ins only, on purpose: an audit layer that needs `npm install` to run
is an audit layer that does not run on the machine where it matters.

`pnpm run audit` runs every `audit-*.mjs` here and returns one exit code. It
runs them **all** even after one fails, rather than stopping at the first —
five blocked commits discovered one per attempt is what makes a wiring problem
feel like an architecture problem and produces a rewrite proposal. One report,
every problem, each with its own fix.

`audit` and `doctor` collide with pnpm's own built-in commands, so both need
`pnpm run`. `pnpm audit` silently runs pnpm's dependency scanner instead, and
reports success having checked nothing this repo cares about.

## What each script enforces

| Script | Catches |
|---|---|
| `audit.mjs` | runs every other audit; one exit code |
| `audit-deps.mjs` | a file imports a workspace package its own `package.json` does not declare — works locally, breaks on a fresh install |
| `audit-env.mjs` | **both directions, both runtimes**: a variable the code reads that is missing from `.env.example`, and a variable in `.env.example` nothing reads. Derives the API's names from the pydantic `Settings` fields plus `env_prefix`, because `POIPOIHISAB_DATABASE_URL` appears nowhere in the Python |
| `audit-i18n.mjs` | a key missing from `bn` or `en`; a key the code looks up that no dictionary defines; a key defined that nothing reaches. Understands three access patterns — `w(lang, "k")`, `W[lang].k`, and a key travelling as a prop or table data |
| `audit-migrations.mjs` | a model table no migration creates (invisible locally, 500 in production — Alembic does not run on a Vercel deploy); a branched revision history, which fails `upgrade head` at deploy time |
| `audit-status.mjs` | the plan and the status file disagree; the done counter and the ticked boxes disagree; more than one slice building; a slice ticked `[x]` with an open unmet clause, **or** marked `[!]` with no clause named |
| `audit-superadmin.mjs` | a route in the admin router that does not take `SuperAdminDep`. The parameter is unused inside most handlers, so nothing in the body breaks when it is missing and the endpoint works perfectly for the admin developing it |
| `audit-test-paths.mjs` | a spec that resolves a repo file relative to the working directory instead of its own location |
| `audit-test-wiring.mjs` | a test config that is unscoped, does not exclude build output, or carries `--passWithNoTests` while specs exist |
| `audit-vocabulary.mjs` | the wrong word for a concept, anywhere, including comments |
| `doctor.mjs` | not an audit — every toolchain problem in one report, each with its fix |
| `wip-snapshot.mjs` | not an audit — snapshots the working tree to a git ref without touching HEAD, the index, or any file |

## Rules for adding your own

1. **Wire it into `verify`, or it does not exist.** An audit nobody runs is a
   file.
2. **Check both directions.** Unused-and-declared is as much a bug as
   used-and-undeclared. Every valuable audit above is bidirectional.
3. **Print what passed, not just what failed.** `superadmin: 21/21 route(s)`
   tells you the audit is still looking at the right thing. A silent pass is
   indistinguishable from a broken audit, or from one whose glob stopped
   matching six months ago.
4. **Ratchet, do not block.** For a rule you cannot satisfy today, baseline the
   known count and fail only on an increase. `audit-i18n` carries
   `orphanBaseline` for ten R1 leftovers, and fails if the baseline is *higher*
   than reality too, so it cannot be left stale after a cleanup.
5. **An escape hatch must be data, not a filename list.** `audit-vocabulary`
   lets the retired name through in its backticked form — how a document refers
   to a token rather than using it — not via a list of exempt files. A skip
   list rots; a condition read from the thing itself stays true.

## The practice that matters more than any of the above

When something wrong gets through review, do not just fix it — **write the
script that makes that class of mistake impossible, in the same session.**
Every audit here exists because something specific got through:

- `audit-i18n` — `adminActiveUsers` shipped as a label with no field behind it,
  rendering `undefined` in a KPI tile.
- `audit-superadmin` — the admin router went from 16 endpoints to 26 in one
  session, which is past the point where reading the diff is a reliable check.
- `audit-env` — an empty `POIPOIHISAB_KV_URL` falls back to in-process session
  storage, which on serverless signs every user out on each cold start with no
  error anywhere.
- `audit-test-wiring` — both test configs were relying on Vitest's implicit
  defaults for scoping, so `verify` could not check what the suite actually ran.
