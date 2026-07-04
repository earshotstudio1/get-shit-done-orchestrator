<purpose>
Do the bookkeeping of promotion correctly and completely: an approved idea becomes an
Active project with a scaffold a future working session (or `/gsd:new-project`) can pick up,
and the source idea note reflects reality. No half-promoted states.
</purpose>

<required_reading>
Read `references/orchestrator-vault.md` (vault resolution, promotion precedent, frontmatter
keys, safety rules) before starting.
</required_reading>

<process>

<step name="resolve_inputs">
Resolve the vault per orchestrator-vault.md. Locate the idea note in `Projects/Ideas/` by
exact filename, then title match, then fragment match. If more than one note matches, list
matches and ask the user; never guess between candidates.

Derive `SLUG` from `--slug` or kebab-case of the note title (drop date prefix and filler
words). Set `PROJECT_DIR = <vault>/Projects/Active/<SLUG>`.

**Guard:** if `PROJECT_DIR` already exists, or an Active project already matches this idea,
stop and report — reconciliation is manual, not overwrite.
</step>

<step name="gather_requirements">
Light requirements, not a full spec. Priority order:

1. **From the note** — many idea notes already contain Outcome, MVP Scope, Decisions Made.
   Extract: one-line outcome, 3-6 requirements, first milestone, known non-goals.
2. **From the user** — only ask (AskUserQuestion) for what the note doesn't answer:
   outcome if missing, first milestone if unclear. One round of questions, not an interview.

If running non-interactively, use the note content plus conservative defaults and mark
assumptions explicitly in the README under "Assumptions (unconfirmed)".
</step>

<step name="scaffold_project">
Create `PROJECT_DIR` and render from `templates/promoted-project.md`:

- `README.md` — what/why, requirements, first milestone, non-goals, link back to idea note,
  `code_location` if `--code-dir` given
- `PROGRESS.md` — status header (`stage`, `next_action`), task checklist seeded from the
  first milestone, empty log section with today's entry: "Promoted from idea note"

Do not create a code repo or `.planning/` here — that's `/gsd:new-project`'s job, run from
the code directory when building starts. Promotion is vault bookkeeping.
</step>

<step name="update_idea_note">
Edit the source idea note:

- Frontmatter: `stage: building`, `decision: build`, `updated: <today>`,
  `promoted: <today>`, `promoted_to: Projects/Active/<SLUG>`
- Append section:

```markdown
## Promotion

Promoted to [[<SLUG>/README|Projects/Active/<SLUG>]] on <today>.
```

Keep the note in `Ideas/` (promotion precedent — links stay stable; the pipeline reads
`stage`).
</step>

<step name="verify">
Check before declaring success:
- `PROJECT_DIR/README.md` and `PROGRESS.md` exist and contain no unrendered placeholders
- Idea note frontmatter parses (YAML intact) and contains the four new/changed keys
- Exactly one Active entry now matches this idea
</step>

<step name="done">
Report: project path, files created, idea note changes, and the suggested next command
(`/gsd:new-project` from the code directory when ready to build).
</step>

</process>
