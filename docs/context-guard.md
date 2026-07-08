# Context Guard (fork addition)

Token-aware context-window guard for long-running GSD/orchestrator sessions. Supersedes
the upstream [context monitor](context-monitor.md) with three additions:

1. **Absolute token counting** read directly from the session transcript JSONL — the
   upstream bridge file only carries percentages, only for the main session, and only
   when the GSD statusline is registered. Percentages also stop being useful on
   large-context models (150k tokens barely moves the needle on a 1M window).
2. **Autonomous same-step handover** instructions in GSD/orchestrator contexts (cwd has
   `.planning/`): at the soft limit the agent is told to finish the current atomic
   action, record a "still in step X" handover entry in the progress artifact, and
   delegate the remainder to a fresh agent — see
   `get-shit-done/references/context-handover.md`. Non-GSD sessions keep upstream-style
   advisory wording (inform the user, don't commandeer).
3. **Active CLI mode** (`--status`) so workflows and agents can check usage *between
   steps* instead of waiting for the hook: `/gsd:context-status` wraps this.

## Thresholds

| Trigger | Soft | Hard |
|---------|------|------|
| Tokens (transcript) | `GSD_CTX_SOFT_TOKENS` (default **150000**) | `GSD_CTX_HARD_TOKENS` (default **250000**) |
| Remaining % (bridge) | <= 35% | <= 25% |

Whichever source crosses first wins (OR). On 200k-window models the percentage triggers
fire long before 250k tokens is reachable; on 1M-window models the token triggers do the
work. Soft = wrap up + hand over; hard = stop now + hand over.

## Behavior

- **Soft**: fires immediately the first time, then debounced (max one warning per 5 tool
  calls per session). Escalation to hard bypasses debounce.
- **Hard**: fires on every tool call (deliberate pressure — the agent should be writing
  its handover, which takes few calls).
- Token source: last main-chain assistant entry's `message.usage`
  (`input + cache_read + cache_creation + output`) — i.e. the context size of the most
  recent API turn. Sidechain entries are skipped. Reads the transcript tail (1MB → 16MB →
  full) so huge transcripts stay cheap.
- Any error, missing file, or malformed input → exit 0, no output. The guard never
  blocks tool execution.

## Modes

| Mode | When | Message style |
|------|------|---------------|
| `handover` | cwd contains `.planning/`, or `GSD_CONTEXT_GUARD_MODE=handover` | Autonomous same-step handover per `references/context-handover.md` |
| `advisory` | everything else, or `GSD_CONTEXT_GUARD_MODE=advisory` | Upstream-style: warn, wrap up, inform the user |

## CLI

```bash
node hooks/gsd-context-guard.js --status [--transcript <path>] [--dir <project-dir>] [--session <id>]
```

Prints JSON: `context_tokens`, `soft_limit_tokens`, `hard_limit_tokens`,
`bridge_remaining_pct`, `level` (`ok|soft|hard|unknown`), `mode`, `source`
(`transcript|bridge|none`). Without `--transcript` it uses the newest `*.jsonl` under
`~/.claude/projects/<munged-project-dir>/` — a heuristic: with parallel subagents the
newest file may be another agent's transcript. `unknown` means no data; don't guess.

## Registration (Claude Code)

Replace the upstream monitor's PostToolUse entry in `~/.claude/settings.json` (running
both = duplicate warnings once the bridge thresholds trip):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"C:/Users/user/.claude/hooks/gsd-context-guard.js\""
          }
        ]
      }
    ]
  }
}
```

Copy `hooks/gsd-context-guard.js` to `~/.claude/hooks/` first (same convention as the
other GSD hooks). The statusline registration is unchanged — the guard still uses its
bridge file as a fallback/extra signal.

## Limitations

- The token count is the context size of the **last completed** API turn — it lags by
  one turn and can't see tokens being streamed right now. Treat it as a floor.
- Subagent coverage depends on what `transcript_path` the harness passes for
  subagent-originated tool events; the handover *protocol* therefore also instructs
  long-running subagents to self-check via `--status` between tasks rather than relying
  on the hook alone.
- Percentage fallback requires the GSD statusline (bridge file) and only exists for the
  main session.

## Tests

`tests/context-guard.test.cjs` — 20 cases covering token math, thresholds, env
overrides, debounce/escalation, sidechain skipping, tail-reading with oversized lines,
bridge fallback/staleness, malformed input, and the CLI contract. Run:

```bash
node tests/context-guard.test.cjs
```
