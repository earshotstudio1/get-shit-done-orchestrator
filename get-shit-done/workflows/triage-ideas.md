<purpose>
Turn an untriaged pile of Obsidian idea captures into a single reviewable routing report:
what's a real project, what it would cost, what it's worth, and where it should go next.
The human approves routing; this workflow never moves notes itself.
</purpose>

<required_reading>
Read `references/orchestrator-vault.md` (vault resolution, folder semantics, frontmatter
schema, safety rules) before starting.
</required_reading>

<process>

<step name="resolve_vault">
Resolve the vault root per orchestrator-vault.md. Verify `<vault>/Projects/Ideas/` exists.
If it doesn't, stop and tell the user what path was tried.

Set:
- `IDEAS_DIR = <vault>/Projects/Ideas`
- `ACTIVE_DIR = <vault>/Projects/Active`
- `REPORT_PATH = <vault>/Maintenance/Reports/YYYY-MM-DD-idea-triage.md` (today's date;
  if the file exists, append `-2`, `-3`, ...)
</step>

<step name="enumerate_ideas">
List every `*.md` in `IDEAS_DIR` (non-recursive). For each, read the full note: frontmatter
(title, created, stage, decision, area, tags, source) and body (Core Idea, Key Takeaways,
Raw Source, and any richer sections — some captures are one-liners, some are full design docs).

Note the information density: a 40-line voice capture and a 300-line design doc with decided
scope are different maturity levels even if both sit in Ideas/.
</step>

<step name="detect_already_promoted">
List entries in `ACTIVE_DIR`. Match idea notes against active projects by slug/title
similarity and by `promoted_to` / `related_notes` frontmatter.

Any idea with a matching active project is classified **already-promoted** — its routing
recommendation is "reconcile frontmatter" (set `stage: building`, `decision: build`,
`promoted_to:`) rather than a fresh route. Never score an already-promoted idea as if it
were new; that would produce duplicate-project recommendations.
</step>

<step name="include_externals">
For each `--include <path>`: confirm the directory exists, then read enough to characterize
it (README, package.json/pyproject, git log tail if it's a repo). Classify it like an idea,
but flag `origin: external` and note whether it already has vault representation. External
projects that are clearly active and unrepresented get routing "create project note under
Active/". Dead external projects get routing "archive".
</step>

<step name="classify_and_score">
For each idea (and external), produce:

**Classification** — one of:
- `project` — a buildable thing with a plausible outcome
- `reference` — useful capture, not a project (route to Knowledge/ or keep as reference)
- `duplicate` — subsumed by another idea/project (name it)
- `already-promoted` — see detect_already_promoted

**Effort** (projects only) — order-of-magnitude, from the note text plus judgment:
- `S` — a weekend or less
- `M` — 1-3 weekends
- `L` — multi-week side project
- `XL` — months / needs sustained commitment or external dependencies

**Impact** (projects only) — `low` / `medium` / `high`, judged against what the vault says
the user cares about (time saved, learning, income, infrastructure leverage). One sentence
of justification, grounded in the note.

**Maturity** — `raw capture` / `developing` / `spec-ready` (has scope, decisions, success
criteria).

**Recommended route** — one of the pipeline folders (Backlog / Awaiting Approval / promote
to Active now / stay in Ideas pending X / Archive), plus a one-line reason. Promote-now
should be rare: only when the note is spec-ready AND effort is S/M AND nothing blocks it.

**Confidence** — high/medium/low in your own classification, so the human knows where to
look hardest.
</step>

<step name="write_report">
Render the report from `templates/triage-report.md` to `REPORT_PATH`. Every idea gets a row
in the summary table and a short per-idea section. Include a "Proposed actions" checklist at
the end — one checkbox per concrete move, so the human can tick and execute (or feed
approved lines to `/gsd:promote-project`).
</step>

<step name="offer_stamp">
Ask the user (AskUserQuestion) whether to stamp `triaged: YYYY-MM-DD` into each scored
note's frontmatter. Only write if approved. This is the only write to idea notes this
workflow is allowed to make.

If running non-interactively (dry-run, overnight session), skip the stamp — report only.
</step>

<step name="done">
Print the report path and the top 3 recommendations inline so the user sees the headline
without opening the file.
</step>

</process>
