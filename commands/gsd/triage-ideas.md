---
name: gsd:triage-ideas
description: Triage Obsidian idea captures — classify project-worthiness, estimate effort/impact, propose routing
argument-hint: "[vault-path] [--include <external-path>...]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

<objective>
Read every note in the vault's `Projects/Ideas/` folder, classify each capture as
project-worthy or not, estimate effort and impact for the project-worthy ones, and produce a
proposed-routing report for human review.

This is the manual-first replacement for the "triage cron" in the AI Project Orchestrator
design: a human runs it on demand; nothing is moved or deleted automatically.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/triage-ideas.md
@~/.claude/get-shit-done/references/orchestrator-vault.md
</execution_context>

<context>
Arguments: $ARGUMENTS

- Optional first argument: vault path (else resolved per orchestrator-vault.md)
- Optional `--include <path>` (repeatable): external project directories to triage alongside
  the Ideas folder, so real-but-unrepresented projects show up in the same report
</context>

<process>
**Follow the triage-ideas workflow** from `@~/.claude/get-shit-done/workflows/triage-ideas.md`.

The workflow handles:
1. Vault resolution and idea enumeration
2. Cross-referencing `Projects/Active/` to detect already-promoted ideas
3. Classification, effort/impact scoring, and routing recommendation per note
4. External project inclusion (`--include`)
5. Report generation into the vault's reports directory
6. Optional `triaged:` frontmatter stamping (with user approval only)
</process>
