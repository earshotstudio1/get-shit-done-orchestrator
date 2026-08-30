# Autonomous Runs

Run a milestone to completion across multiple headless Claude Code sessions, without
typing "continue".

## The problem this solves

`/gsd:autonomous` already drives phases end to end — discuss, plan, execute, verify, then
the milestone lifecycle. Two things stopped it being genuinely hands-off:

1. **It only lives as long as one session.** When the context guard fires it writes a
   handover file and stops. Something has to start the next session to consume it.
2. **It asks a lot.** Around fifteen decision points across the workflows it invokes. In
   an interactive session those are the feature. In a headless `claude -p` cycle there is
   nobody to answer, and the run stalls until it times out.

`gsd-run.js` fixes the first. Autonomy modes fix the second.

## Quick start

Set the project up interactively — this part stays human, and it's the part that decides
whether the rest is worth anything:

```bash
cd ~/projects/my-app
claude
  /gsd:new-project
  /gsd:new-milestone
```

Then hand it over:

```bash
node ~/.claude/get-shit-done/bin/gsd-run.js --max-cycles 12
```

Each cycle spawns a fresh `claude -p` with a clean context window. Continuity comes from
`.planning/` on disk, which is where GSD keeps it anyway — a fresh window per cycle is
better than one long conversation, because quality stops degrading as the window fills.

Add `--dry-run` first to see exactly what it would invoke.

## Modes

| Mode | Behaviour |
|------|-----------|
| `supervised` | Every gate asks. Identical to upstream. The default everywhere except `gsd-run.js`. |
| `batched` | **Default for runs.** One up-front review of every user-facing decision, then no stopping. |
| `unattended` | Nothing asks. Every gate takes its default and is logged. |

```bash
node ~/.claude/get-shit-done/bin/gsd-run.js --mode unattended --max-cycles 20
```

Or persist it: `node gsd-tools.cjs config-set autonomy.mode batched`.

### What batched actually does

Before any code is written, it walks every incomplete phase, skips the infrastructure
ones (the workflow already detects those), and presents every remaining grey area as one
table with a recommendation per question. You accept or change them once. The answers go
to `.planning/AUTONOMY-PREFERENCES.md` and the run proceeds without stopping again.

One fifteen-minute sitting instead of thirty interruptions, without handing the design
decisions over entirely. If you'd rather discuss phase by phase after seeing the table,
the review offers that and falls back to supervised.

Full gate-by-gate policy: `get-shit-done/references/autonomy.md`.

## What it will not do unattended

- **Delete anything.** Cleanup runs dry-run only.
- **Complete a milestone with known gaps or tech debt.** The audit stops the run instead.
- **Plan a phase with no CONTEXT.md.** That means inferring your design preferences and
  building on the guess.
- **Push, open PRs, or deploy.** The controller has no such code path.

## When a run stops

Each cycle writes `.planning/.autonomous-status.json`. The controller reads it and exits:

| Exit | Meaning |
|------|---------|
| 0 | Milestone complete |
| 1 | Usage or precondition error |
| 2 | Blocked — a reason is printed, and the phases already done stand |
| 3 | Cycle cap reached — re-run to continue |

Two cycles that update no status are treated as a stall and stop the run, so a crash loop
can't burn your whole cap.

## Afterwards

- `.planning/DECISIONS-DEFERRED.md` — every decision made without you: when, phase, gate,
  action, note. **Read this before shipping.** It's as much a deliverable of the run as
  the code.
- `.planning/AUTONOMOUS-LOG.md` — one row per cycle.
- `.planning/AUTONOMY-PREFERENCES.md` — what you accepted in the up-front review.

## Running it safely

Use a dedicated branch, and prefer a container or VM. `--permission-mode` is passed
straight through to Claude Code; the default here is `acceptEdits`. Anthropic recommends
`bypassPermissions` only inside an isolated environment, and an autonomous loop with
unrestricted access to your whole machine is not a good trade.

## The honest limitation

In `batched` and `unattended`, grey areas resolve to a recommendation that nobody reviewed
at the moment it was applied. `smart_discuss` computes those recommendations from prior
CONTEXT.md decisions and a codebase scout, so they are reasoned rather than random — but
they are not your judgement. On infrastructure phases this costs nothing. On a project
that is mostly interface work, run `batched` and take the up-front review seriously.
