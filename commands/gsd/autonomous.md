---
name: gsd:autonomous
description: Run all remaining phases autonomously — discuss→plan→execute per phase
argument-hint: "[--from N] [--mode batched|unattended|supervised]"
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
Execute all remaining milestone phases autonomously. For each phase: discuss → plan → execute.

Pausing behaviour depends on the autonomy mode: `supervised` (default) pauses for user decisions — grey area acceptance, blockers, validation requests; `batched` front-loads every user-facing decision into one review then runs without stopping; `unattended` never asks. For a run that spans multiple sessions, drive this with `get-shit-done/bin/gsd-run.js` rather than invoking it by hand.

Uses ROADMAP.md phase discovery and Skill() flat invocations for each phase command. After all phases complete: milestone audit → complete → cleanup.

**Creates/Updates:**
- `.planning/.autonomous-status.json` — controller sentinel (complete/continue/blocked)
- `.planning/DECISIONS-DEFERRED.md` — every decision made without you
- `.planning/AUTONOMY-PREFERENCES.md` — batched mode's up-front review
- `.planning/STATE.md` — updated after each phase
- `.planning/ROADMAP.md` — progress updated after each phase
- Phase artifacts — CONTEXT.md, PLANs, SUMMARYs per phase

**After:** Milestone is complete and cleaned up.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/autonomous.md
@~/.claude/get-shit-done/references/autonomy.md
@~/.claude/get-shit-done/references/ui-brand.md
</execution_context>

<context>
Optional flags:
- `--from N` — start from phase N instead of the first incomplete phase.
- `--mode batched|unattended|supervised` — override the resolved autonomy mode for this run. `--unattended` and `--supervised` are accepted as shorthands. Without a flag the mode comes from `GSD_AUTONOMY_MODE`, then `.planning/config.json` `autonomy.mode`, then `supervised`.

Project context, phase list, and state are resolved inside the workflow using init commands (`gsd-tools.cjs init milestone-op`, `gsd-tools.cjs roadmap analyze`). No upfront context loading needed.
</context>

<process>
Execute the autonomous workflow from @~/.claude/get-shit-done/workflows/autonomous.md end-to-end.
Preserve all workflow gates (phase discovery, per-phase execution, blocker handling, progress display).
</process>
