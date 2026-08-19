# get-shit-done-orchestrator

> A personal fork of [get-shit-done-cc](https://github.com/glittercowboy/get-shit-done) v1.24.0 by its original authors, MIT licensed. Upstream's own documentation is preserved at [UPSTREAM-README.md](UPSTREAM-README.md). Everything in this repo that is not listed below is unmodified upstream code.

## What this fork adds

Upstream GSD manages a project once you have decided to build it: phases, plans, execution, verification. It starts at the point where you already know what you are making.

This fork adds the stages before that, and one safeguard for long sessions.

**Idea lifecycle.** `/gsd:triage-ideas` reads every idea captured in an Obsidian vault, classifies each one for project-worthiness, estimates effort and impact, and writes a report proposing where each should go. `/gsd:promote-project` takes an approved idea and scaffolds it into a real Active project, stamping the original note so the trail back is intact.

**Context guard.** A token-aware hook that reads actual usage from the session transcript and enforces soft and hard thresholds (150k and 250k by default, overridable by environment variable). Past the limit it triggers a handover protocol that writes state out and hands off within the same step, rather than degrading quietly as the window fills. `/gsd:context-status` gives an active check. This supersedes upstream's context monitor when registered.

Both were built manual-first on purpose: triggered on demand, not on a cron, until the behaviour has proved itself.

## Why it exists

I had a vault full of captured ideas and a build system that only started once an idea had already become a project. The gap between those two was me, doing it inconsistently. The triage layer closes it.

The context guard came out of a different problem: long autonomous runs failing near the end of a session in ways that were hard to recover from.

## Architecture

- **Additive, not invasive** — the fork history starts from a clean baseline commit of the upstream snapshot, so `git log` shows precisely what diverged and rebasing on a new upstream release stays tractable.
- **New commands follow upstream's own structure** — a `commands/gsd/*.md` entry paired with a `workflows/*.md` implementation, so they are indistinguishable from native commands at the call site and appear in `/gsd:help`.
- **Vault conventions are centralised** in `get-shit-done/references/orchestrator-vault.md` — folder layout, frontmatter schema and safety rules in one place rather than duplicated across both workflows.
- **The context guard is a hook, not a wrapper** (`hooks/gsd-context-guard.js`) — it reads the transcript rather than instrumenting the agent, so it fails safe if the format shifts. Covered by `tests/context-guard.test.cjs`.

## Status

Seven commits on top of upstream. Used in anger for real triage runs. The remaining orchestrator design (research agent, deep review, TDD gate, daily digest) is deliberately unbuilt while the manual version proves out.

Open question I have not settled: keep this as the installed GSD and rebase on upstream releases, or extract the orchestrator pieces into a standalone skill pack that coexists with stock GSD. The second is cleaner long-term.

## Install

`node bin/install.js` installs this fork to `~/.claude/`, replacing a stock GSD install (same command namespace, superset of its commands). Or point a Claude Code session at this repo and have it follow a workflow directly, which is how the first live triage run happened.
