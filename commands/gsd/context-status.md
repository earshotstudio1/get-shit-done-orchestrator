---
name: gsd:context-status
description: Check the current session's context-window usage in absolute tokens and route to the handover protocol when limits are crossed
argument-hint: "[--transcript <path>] [--dir <project-dir>]"
allowed-tools:
  - Bash
  - Read
---

<objective>
Give the agent (and the human) an honest read of how full the current context window is,
in absolute tokens, and route to the context-handover protocol when the soft or hard
limit is crossed.

This is the **active-check** half of the fork's context guard — any workflow can run it
between steps. The **passive** half is the `gsd-context-guard.js` PostToolUse hook, which
injects the same thresholds automatically after every tool call.
</objective>

<execution_context>
@~/.claude/get-shit-done/references/context-handover.md
</execution_context>

<context>
Arguments: $ARGUMENTS

- `--transcript <path>`: exact transcript JSONL to measure (default: newest transcript
  for the project directory)
- `--dir <project-dir>`: project directory used for transcript discovery (default: cwd)

Thresholds come from env (`GSD_CTX_SOFT_TOKENS`, default 150000; `GSD_CTX_HARD_TOKENS`,
default 250000).
</context>

<process>

1. **Run the guard CLI** (installed copy first, fork copy as fallback):

```bash
node "$HOME/.claude/hooks/gsd-context-guard.js" --status --dir "$(pwd)" 2>/dev/null \
  || node "<path-to-this-repo>/hooks/gsd-context-guard.js" --status --dir "$(pwd)"
```

Pass through `--transcript` / `--dir` arguments if the user supplied them.

2. **Present the result** as a short table: `context_tokens`, soft/hard limits, `level`
   (`ok` / `soft` / `hard` / `unknown`), `source` (`transcript` / `bridge` / `none`).

   - If `source` is `none` or `level` is `unknown`: report honestly that no transcript
     was found and the estimate is unavailable. Do not guess a number.
   - The token count is the last API turn's full context size (input + cache +
     output) — it lags the true current size by one turn. Treat it as a floor.

3. **Route on level:**

   - `ok` — keep working; re-check after the current step if in a long-running workflow.
   - `soft` — finish ONLY the current atomic action, then follow
     `references/context-handover.md`: same-step handover entry + delegate the remainder.
   - `hard` — stop immediately; follow `references/context-handover.md` now.

</process>
