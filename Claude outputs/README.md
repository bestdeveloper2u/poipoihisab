# Project rules — a drop-in starter kit

Four documents and eight scripts. No dependencies beyond Node 18+. Nothing here
knows anything about your stack.

## Install

1. Copy `CLAUDE.md`, `ROADMAP.md`, `STATUS.md`, `BACKLOG.md` to your repo root.
2. Copy `scripts/` to your repo root (merge if you already have one).
3. Copy `audit.config.json` to your repo root and edit it — it is the only file
   with project-specific values in it.
4. Add to `package.json`:

```json
{
  "scripts": {
    "audit": "node scripts/audit.mjs",
    "wip": "node scripts/wip-snapshot.mjs",
    "verify": "npm run audit && npm run format:check && npm run lint && npm run typecheck && npm test"
  }
}
```

5. Run `node scripts/audit.mjs`. It will fail. That is correct — fix what it
   names, one at a time.

## What each script enforces

| Script | Catches |
|---|---|
| `audit.mjs` | runs every other audit; one exit code |
| `audit-status.mjs` | the plan and the status file disagree; the done counter and the ticked boxes disagree; a slice ticked done with an open unmet clause, **or** marked `[!]` with no clause named |
| `audit-deps.mjs` | a file imports a workspace package its own `package.json` does not declare — works locally, breaks on a fresh install |
| `audit-env.mjs` | **both directions**: a variable the code reads that is missing from the example file, and a variable in the example file nothing reads |
| `audit-test-wiring.mjs` | a test config that is unscoped, does not exclude build output, or carries `--passWithNoTests` while specs exist |
| `audit-test-paths.mjs` | a spec that resolves a repo file relative to the working directory instead of its own location |
| `audit-vocabulary.mjs` | the wrong word for a concept, anywhere, including comments |
| `wip-snapshot.mjs` | not an audit — snapshots the working tree to a git ref without touching HEAD, the index, or any file |

## Rules for adding your own audit

1. **Wire it into `verify`, or it does not exist.**
2. **Check both directions.** Unused-and-declared is as much a bug as
   used-and-undeclared.
3. **Print what passed, not just what failed.** A silent pass is
   indistinguishable from a broken audit.
4. **Ratchet, do not block.** For a rule you cannot satisfy today, baseline the
   known count and fail only on an increase.
5. **An escape hatch must be data, not a filename list.** A skip list rots; a
   condition read from the thing itself stays true.

The practice that matters more than any of the above: **when something wrong gets
through review, do not just fix it — write the script that makes that class of
mistake impossible, in the same session.**
