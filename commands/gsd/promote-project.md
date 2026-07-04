---
name: gsd:promote-project
description: Promote an approved idea note into an Active project with scaffolding and status update
argument-hint: "<idea-note> [--slug <name>] [--code-dir <path>] [--vault <path>]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

<objective>
Graduate an approved idea from `Projects/Ideas/` into a real project under
`Projects/Active/`: scaffold the project folder (README + PROGRESS tracking), stamp the
source idea note's frontmatter, and leave the pipeline consistent.

This is the `/promote-project` step from the AI Project Orchestrator lifecycle — the
human has already said yes; this command does the bookkeeping properly.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/promote-project.md
@~/.claude/get-shit-done/references/orchestrator-vault.md
</execution_context>

<context>
Arguments: $ARGUMENTS

- `<idea-note>` (required): filename, title, or unambiguous fragment of the idea note
- `--slug <name>`: project folder name (default: derived from title, kebab-case)
- `--code-dir <path>`: where code will live if outside the vault (recorded, not created)
- `--vault <path>`: vault override (else resolved per orchestrator-vault.md)
</context>

<process>
**Follow the promote-project workflow** from
`@~/.claude/get-shit-done/workflows/promote-project.md`.

The workflow handles:
1. Vault + idea note resolution (with disambiguation)
2. Light requirements gathering (from the note first, the user second)
3. Project scaffolding under `Projects/Active/<slug>/` (README.md, PROGRESS.md)
4. Idea note frontmatter update (`stage: building`, `decision: build`, `promoted`,
   `promoted_to`) and `## Promotion` section
5. Consistency checks (no duplicate active project, no orphan links)
</process>
