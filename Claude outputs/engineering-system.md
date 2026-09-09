# Setting up another app the way Hunter Gamer is set up

What actually makes that repo work is not the stack. It is that **every rule is
traceable to a specific failure, and every rule that can be mechanised has a
script behind it.** A rule that lives only in prose gets forgotten by the third
week. A rule with a gate behind it cannot be.

Nothing below is copy-paste. The *shapes* transfer; the contents have to be
earned by your app's own failures. Copying Hunter Gamer's fourteen constraints
into a project that never had those fourteen problems produces a document
nobody believes, which is worse than no document.

---

## 1. The document set — four files, four different jobs

The single most transferable thing. Four files, and the discipline that each one
answers exactly one question.

| File | Answers | Changes |
|---|---|---|
| `CLAUDE.md` | How do we work? | Rarely. ~125 lines. Short on purpose. |
| `<PROJECT>_ROADMAP.md` | What are we building? | At release boundaries only. |
| `STATUS.md` | What is actually built, and what was learned? | Every session. |
| `BACKLOG.md` | What did we decide not to do yet, and why? | Whenever something is deferred. |

The split matters more than the contents. The common failure is one giant
README that is simultaneously a plan, a status report and a style guide — and
therefore trusted for none of the three, because you cannot tell which parts are
aspiration and which are fact.

**`CLAUDE.md` must stay short.** Hunter Gamer's is 125 lines with nine headings:
the one rule, session start, session end, definition of done, absolute
constraints, where things are, scope, honesty requirements. If it grows past
~150 lines it stops being read, and an unread working agreement is just a
liability with a filename.

**`STATUS.md` is a narrative, not a checklist.** Its entries record what was
tried, what the premise was, and where the premise turned out to be wrong. That
last part is the valuable half: a status file that only records successes
teaches nothing and quietly re-invites every mistake it does not mention.

**`BACKLOG.md` opens with the rule that makes it work:**

> Scope is frozen per release. Adding a line here is free. Building it
> mid-release is not.

Without that sentence a backlog is a wishlist. With it, it is the pressure
release valve that lets you say "no, not now" without losing the idea — which is
what actually stops mid-release scope reversal.

---

## 2. A Definition of Done that a person cannot argue with

Hunter Gamer's has ten points. The number is not the point; these properties are:

- **Every point is binary.** "Renders correctly at 1440 / 980 / 375px" — you
  either looked at three widths or you did not. Compare "the UI should be
  responsive", which is unfalsifiable and therefore always satisfied.
- **Several are about states, not features.** "Every state handled: loading,
  empty, error, populated, permission-denied." Most shipped bugs live in the
  four states nobody opened.
- **One forbids fixtures outright.** "Every value comes from the database. No
  hardcoded copy, no invented numbers." This single line prevents more rot than
  any other, because a hardcoded array looks identical today and still looks
  identical after the endpoint behind it breaks.
- **One demands you have seen it full.** "The seed populates it — you have seen
  it full." A screen you have only seen empty is a screen you have not tested.
- **The failure path is explicit.** "Every mutation works, and its failure path
  shows a real message that says what did _not_ happen."
- **Tests are named for the case that matters.** "Authorisation enforced, with a
  test for the **denied** case."
- **Documentation is in the same commit**, not "after".

Write yours before writing the roadmap. Six to ten points. If a point cannot be
checked in under a minute by someone who did not write the code, rewrite it.

---

## 3. Absolute constraints — derived, never copied

Hunter Gamer has fourteen. Each one is a paragraph, and each paragraph names the
incident that produced it. Two examples of the shape:

> **A `GRANT` and its policy ship in the same statement, or neither ships.**
> Granting a table you have not policied is worse than leaving it ungranted:
> ungranted fails loudly with `permission denied` on the first call;
> granted-and-unpolicied returns zero rows on SELECT and dies on `WITH CHECK` on
> INSERT — a screen that renders empty with nothing in the log. Three tables were
> found in this state.

> **A component with no `<style>` is not built.** Six shipped that way last time
> and every form rendered as unstyled inline HTML.

Notice what makes these work: **the consequence is described concretely, and the
count is real.** "Three tables were found in this state" is why the rule is
obeyed. "Follow best practices for authorization" is why rules are not.

**How to derive yours:** for the next month, every time something breaks, ask
"what rule, followed mechanically, would have prevented this?" Write that rule
with the incident attached. You will have eight to twelve within a month, and
they will be *yours* — which is the only kind anyone follows.

One constraint worth stealing on principle regardless of stack: **decide which
decisions are closed, and say so.** Hunter Gamer's #13 is "The frontend is Nuxt.
This was re-decided on 18 Aug 2026 and is closed" — followed by the analysis
showing nine of ten cited failures were wiring problems that recur under any
framework. Without a closed-decision list, every hard week reopens the stack
choice.

---

## 4. The audit layer — this is the actual force multiplier

Nineteen scripts in `scripts/`, run by one `audit.mjs`, wired into `pnpm verify`.
This is what separates the setup from "we wrote a good CONTRIBUTING.md".

**The rule that generates them: when something wrong gets through review, do not
just fix it — write the script that makes that class of mistake impossible.**
Every one of the nineteen exists because something specific got through.

### The ones that transfer to almost any project

| Audit | Catches |
|---|---|
| `audit-deps` | A file imports a workspace package its own `package.json` does not declare. Works locally, fails on a fresh `install` on someone else's machine. |
| `audit-env` | **Both directions**: a variable the code validates that is missing from `.env.example`, *and* a variable in `.env.example` nothing reads. The second direction is the one people skip and the one that leaves dead config for years. |
| `audit-test-wiring` | A test config whose `include` is unscoped, that does not exclude the build output (so a spec and its compiled copy both run), or that carries `--passWithNoTests` while specs exist. |
| `audit-test-paths` | A spec that resolves a repo file relative to the working directory instead of its own location — passes from the root, fails from anywhere else. |
| `audit-status` | The plan and the status file disagree; the "done" counter and the ticked boxes disagree. |
| `audit-vocabulary` | One domain word, everywhere, including comments. Hunter Gamer's is `streamer`, never `creator`. Sounds trivial; two names for one concept is how a schema splits in half. |
| `audit-ci` | The CI config calls something that does not exist. |

### The ones to reinvent for your own app

Not the code — the *idea*: find the invariant nobody can hold in their head, and
mechanise it. Hunter Gamer's app-specific ones are:

- **`audit-rls`** — every table has a policy or is on an allowlist *with a
  written reason*; an allowlisted table must hold no grant.
- **`audit-scoped-css`** — a scoped CSS rule that is written, parsed, and never
  applied because a generated stylesheet outranks it on specificity. 74
  instances were found the day this was written. No human review finds these.
- **`audit-strings`** — every `t('key')` has a seeded row, and every seeded row
  is used. Both directions again.
- **`audit-renderers`** — a published, indexable route whose template has no
  renderer. This is the "silently blank page" gate.
- **`audit-coverage`** — every screen in the design maps to a planned slice.

### Rules for writing an audit

1. **Run it from `pnpm verify`, or it does not exist.** An audit nobody runs is
   a file.
2. **Check both directions.** Almost every valuable audit above is bidirectional.
   Unused-and-declared is as much a bug as used-and-undeclared.
3. **Print what passed, not just what failed.** `renderers: 9 dispatch arms, 15
   templated routes seeded ✓` tells you the audit is still looking at the right
   thing. A silent pass is indistinguishable from a broken audit.
4. **Ratchet, do not block.** For a rule you cannot satisfy today, baseline the
   known count and fail only on an increase. `audit-scoped-css` carries a
   `KNOWN` number that only goes down.
5. **An escape hatch must be data, not a skip list.** `audit-renderers` lets a
   route out via its actual `noindex` flag, not via a list of filenames. A skip
   list rots; a data condition stays true.

---

## 5. The slice format — four clauses, and one of them is a trap

Every screen in Part 7 of the roadmap is written as:

- **UI** — what is on the screen, concretely, listing components.
- **Does** — the behavioural and architectural requirements. *This is where the
  hard constraints live*: "ranking is an `ORDER BY`, never a per-request
  recomputation", "the SSRF guard lives at the socket after DNS resolution, not
  as a string check on the hostname".
- **Data** — the tables and packages it touches.
- **Done** — **one falsifiable sentence.**

The Done clause is the whole design. Examples:

> a submitted hostname that resolves to a private address is rejected by the
> guard, proven by a test that resolves to `127.0.0.1`.

> changing a weight in `@hg/domain` moves this page and every streamer's score
> together, and rewording the prose needs no deploy.

> the page is correct within one sweep interval and costs one query, with the
> platform APIs down.

Each names an observation someone could actually make. Write these before
writing code and half the design arguments never happen.

**The trap:** a Done clause with several conjuncts, where one of them has no
subject yet. "moves this page **and every streamer's score**" was unsatisfiable
for weeks because nothing computed a score at all. Which leads directly to:

---

## 6. The three-state marker, and the gate that makes it honest

Most projects have done / not done. That is not enough, because the interesting
state is "shipped, works, and one named clause is still open" — and with two
states that becomes a tick, and the open clause is lost.

```
[ ] not started   [~] building   [x] done (all DoD points)
[!] closed except for a named UI or Does clause
```

`[!]` counts as neither done nor building. And the gate is **two-directional**:

- a `[x]` with an open `**Unmet:**` row in the backlog → build fails
- a `[!]` with **no** such row → build fails

The second half is what stops `[!]` becoming a place to hide. You may wear it
only while a backlog row *names the clause you did not build*. Delete the row
without building the thing and the audit fails from the other side.

The effect is that closing a slice forces a three-way choice, out loud: **build
the clause, amend the plan's Done line, or do not tick the box.** There is no
fourth option, and "we'll call it done and remember the caveat" was the fourth
option on every project that ever drifted.

Add a counter to the status header (`slices done: 21 / 87`) and have the audit
check it against the actual ticked boxes. It costs four lines and makes a
silently ticked box impossible.

---

## 7. Code conventions that exist to make verification possible

These are not style preferences. Each one exists so that something can be
checked cheaply.

**Ports and adapters at every I/O boundary.** A job handler takes an interface;
the database implementation is a separate file. Consequence: the decisions —
what happens when the write fails, does a replay change anything, is the retry
permanent or transient — are unit-testable with a hand-written fake, in
milliseconds, with no container. The SQL is then proven once, separately,
against a real database. Without this split, every behavioural question needs
Docker, which means it gets asked on one person's machine and nowhere else.

**Comments record what was tried and failed, not what the code does.** This is
the single highest-value convention in the repo and the least common. Real
example, above a SQL query:

> A star expands at PARSE time, so `SELECT *` here is not a slow query — it is
> `42501 permission denied`, raised before execution and aborting the whole
> statement even against an empty table. That is the exact shape of the 500 that
> ran on `/games` from the day its slice shipped.

Six months later that comment prevents the same bug. `// select the columns`
prevents nothing. **Write the comment at the moment you understand the failure**
— that understanding does not survive the week.

**One place per concept.** Money, scores, market rules each defined in exactly
one package, imported everywhere. Then a rule like "changing a weight moves the
page and the stored value together" is structurally true rather than something
you check.

**Money is an integer in the smallest unit, converted in exactly one place per
direction.** Never float. This is worth adopting on day one of any app that
touches money, because retrofitting it is a schema migration plus an audit of
every arithmetic expression in the codebase.

**Contract first.** Schemas defined once (Zod), generating both the API types
and the clients. Nothing is implemented before its schema exists. A CI job
diffs the generated output so a contract change cannot land silently.

---

## 8. Loss prevention — cheap, and you will need it

Two commits of uncommitted work were destroyed by a merge in this project. The
fix was a 100-line script wired to `pnpm wip`:

- snapshots the working tree to a `refs/wip/<timestamp>` ref via a temporary index
- **never touches HEAD, the index, or any file** — this is the whole design
  constraint, and it is why it is not `git stash` (stash mutates the working
  tree, which is exactly what you cannot afford when you are already nervous)
- respects `.gitignore`, keeps the last 40, and never fails its caller
- `--list` prints ready-to-run recovery commands

Run it before anything risky. The lesson that produced the `--list` flag is worth
having for free: **recovery instructions with a placeholder in them are not
recovery instructions.** The first version printed `git show refs/wip/<ts>`, the
placeholder was pasted literally, and in PowerShell `<` is a reserved operator —
so the recovery path failed twice in two different ways at the worst moment.
Print the real command with the real timestamp already in it.

---

## 9. Order of adoption

Do not do all of this at once. Roughly:

**Day one** — `CLAUDE.md` with the one rule and the Definition of Done.
`STATUS.md` and `BACKLOG.md`, even nearly empty. The `wip` snapshot script.

**Week one** — the roadmap in slice format with Done clauses. `pnpm verify` as
one command that runs everything. Two or three audits: `audit-deps`,
`audit-env`, `audit-test-wiring` are the cheapest and catch real things
immediately.

**Ongoing, and this is the actual practice** — every time something breaks:
1. fix it,
2. write the constraint with the incident attached, and
3. **if it can be mechanised, write the script in the same session.**

Step 3 is the whole system. Everything else is scaffolding around it.

**At each release boundary** — read the backlog, promote or re-file. Check that
every `[!]` still has its `**Unmet:**` row and that the row is still true. Rows
go stale; Hunter Gamer has rows whose own reasoning was later proved wrong by
execution, and those corrections are appended rather than replacing the
original — so the record shows the reasoning changed, not just the conclusion.

---

## 10. What this costs, honestly

- **Sessions are slower.** One slice, finished, with the audits green, is less
  visible output per day than three slices half-built.
- **The documents need real maintenance.** A stale STATUS.md is worse than none,
  because it is believed.
- **The audits need care.** An audit that fires falsely gets disabled, and a
  disabled audit is a lie in the config.
- **It suits long-lived, correctness-sensitive projects.** For a two-week
  prototype it is overhead with no payback.

The thing it buys is specific and hard to get any other way: **you can leave the
project for three weeks, come back, read `STATUS.md`, and know exactly what is
true** — including which of your previous conclusions turned out to be wrong.
That property is what makes an agent-heavy workflow safe, because an agent that
reads the same four files reaches the same conclusions you would.

---

## Minimum viable version

If you take only five things to the next app:

1. **Four files, four jobs** — working agreement, plan, status, backlog.
2. **A Definition of Done where every point is binary.**
3. **`pnpm verify` as one command**, and it must be green to commit.
4. **Every rule that can be a script, is a script** — written in the same
   session as the bug that motivated it.
5. **Comments that record the failure, not the mechanism.**

The rest is elaboration on those.
