---
name: gsd:marathon
description: Run this milestone to completion across multiple sessions, hands-off
argument-hint: "[--cycles N] [--mode batched|unattended] [--dry-run]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Task
---
<objective>
Drive the current milestone to completion without supervision. Reviews every user-facing decision with you once, up front, then hands the work to a controller loop that spawns as many fresh Claude sessions as it takes — each with a clean context window, each resuming exactly where the last stopped.

This is the hands-off entry point. `/gsd:autonomous` runs phases inside *this* session and stops when the context window fills; `/gsd:marathon` runs it across as many sessions as the work needs.

**Creates/Updates:**
- `.planning/AUTONOMY-PREFERENCES.md` — your answers from the up-front review
- `.planning/DECISIONS-DEFERRED.md` — every decision made without you
- `.planning/AUTONOMOUS-LOG.md` — one row per cycle
- `.planning/autonomous-run.log` — full transcript of every cycle
- Phase artifacts and code, as each phase executes

**After:** The milestone is complete, or the run stopped with a reason you need to act on.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/marathon.md
@~/.claude/get-shit-done/workflows/autonomous.md
@~/.claude/get-shit-done/references/autonomy.md
</execution_context>

<context>
Optional flags:
- `--cycles N` — maximum sessions to spawn. Default: `autonomy.max_cycles` from config, or 10.
- `--mode batched|unattended` — `batched` (default) reviews user-facing decisions with you once before starting. `unattended` skips the review entirely and takes the recommended answer everywhere.
- `--dry-run` — show what would run, spawn nothing.

Run `/gsd:new-project` and `/gsd:new-milestone` first — this drives an existing milestone, it does not create one.
</context>

<process>
Execute the marathon workflow from @~/.claude/get-shit-done/workflows/marathon.md end-to-end.
Preserve all workflow gates (preconditions, up-front review, launch confirmation, outcome report).
</process>
