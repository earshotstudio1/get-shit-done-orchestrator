# get-shit-done-orchestrator

A personal fork of [get-shit-done-cc](./README.md) v1.24.0 that extends GSD with the
**AI Project Orchestrator** idea-lifecycle skills described in
`vault/Projects/Ideas/2026-06-29-AI-Project-Orchestrator.md`.

The upstream GSD system manages a project once you're building it (`.planning/`, phases,
plans, execution). This fork adds the stages *before* that: ideas captured in an Obsidian
vault get triaged, routed, and promoted into the vault's project pipeline — manually
triggered, per the design note's "do everything manually first" principle.

## What's new vs upstream

| Addition | Purpose |
|----------|---------|
| `commands/gsd/triage-ideas.md` + `workflows/triage-ideas.md` | `/gsd:triage-ideas` — classify + score every idea capture, propose routing, write a report |
| `commands/gsd/promote-project.md` + `workflows/promote-project.md` | `/gsd:promote-project` — scaffold an Active project from an approved idea, stamp the idea note |
| `references/orchestrator-vault.md` | Shared vault conventions (folders, frontmatter schema, safety rules) |
| `templates/triage-report.md`, `templates/promoted-project.md` | Output templates |
| Help entries | Both commands documented in `/gsd:help` |
| `hooks/gsd-context-guard.js` + `commands/gsd/context-status.md` + `references/context-handover.md` | **Context guard** (added 2026-07-08): token-aware limits (150k soft / 250k hard, env-overridable) read from the session transcript; autonomous same-step handover protocol for GSD/orchestrator contexts; `/gsd:context-status` active check. Supersedes upstream `gsd-context-monitor.js` when registered — see `docs/context-guard.md`. Tests: `tests/context-guard.test.cjs` |

Everything else is unmodified upstream. The fork history starts from a clean baseline
commit of the upstream snapshot, so `git log` shows exactly what diverged.

## Lifecycle coverage after this fork

```
Capture (vault Inbox/Ideas)          — existing capture bot
    ▼
Triage            /gsd:triage-ideas  ← THIS FORK (manual, on demand)
    ▼
Human review      (read the triage report, tick actions)
    ▼
Promote           /gsd:promote-project ← THIS FORK
    ▼
Build             /gsd:new-project → plan-phase → execute-phase   — upstream GSD
    ▼
Verify / Progress /gsd:verify-work, /gsd:progress                 — upstream GSD
```

Still unbuilt (deliberately, manual-first): triage cron, research agent, deep-review layer,
TDD-gate skill, PM/Telegram interface, maintenance mode, daily digest.

## Install / use

Not installed anywhere by default. Options:

- Point a Claude Code session at this repo and ask it to follow a workflow directly
  (how the first live triage run was done).
- Run `node bin/install.js` to install the fork to `~/.claude/` — this **replaces** the
  stock GSD install (same `commands/gsd/` namespace, superset of its commands). Decide
  deliberately; the stock install at `GSD/get-shit-done-main` remains untouched either way.

## Upstreaming question (for the human)

If the orchestrator skills prove out, either (a) keep this fork as the installed GSD and
rebase on upstream releases, or (b) extract the orchestrator pieces into a standalone
skill pack that coexists with stock GSD. (b) is cleaner long-term; (a) is less work now.
