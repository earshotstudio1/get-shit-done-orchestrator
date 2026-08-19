# Orchestrator Vault Conventions

Shared conventions for the Orchestrator skills (`/gsd:triage-ideas`, `/gsd:promote-project`).
These skills operate on an Obsidian vault, not on a `.planning/` project directory.

## Vault Resolution

Resolve the vault root in this order:

1. Explicit path passed as a command argument
2. `~/.claude/orchestrator.config.json` → `vault` key
3. Ask the user

Config file shape:

```json
{
  "vault": "C:/path/to/your/vault",
  "projects_root": "Projects",
  "reports_dir": "Maintenance/Reports"
}
```

`projects_root` and `reports_dir` are relative to `vault` and default to the values shown.

## Pipeline Folders

All relative to `<vault>/<projects_root>/`:

| Folder | Meaning |
|--------|---------|
| `Ideas/` | Captured project ideas, not yet triaged or awaiting development |
| `Backlog/` | Project-worthy, not starting soon; parked deliberately |
| `Awaiting Approval/` | Triage/research done; needs a human yes/no |
| `Active/` | Being built now — one folder (or note) per project |
| `Paused/` | Started, deliberately on hold |
| `Shipped/` | Done and in use |
| `Archive/` | Dead, dropped, or superseded |

## Note Frontmatter Schema

Project-idea notes use this frontmatter (observed vault convention — do not invent new keys
when an existing one fits):

```yaml
type: project-idea        # or: project (promoted), reference, capture
domain: project
area: app | agent | infrastructure | ...
stage: captured | developing | building | paused | shipped
decision: undecided | build | hold | drop
status: active | archived
created: 'YYYY-MM-DD'
updated: 'YYYY-MM-DD'
```

Keys the Orchestrator skills may add:

```yaml
promoted: 'YYYY-MM-DD'            # date the idea was promoted
promoted_to: 'Projects/Active/<slug>'  # vault-relative path of the project folder/note
code_location: 'C:/path/to/repo'  # where the code lives, when outside the vault
triaged: 'YYYY-MM-DD'             # date of last triage pass that scored this note
```

## Promotion Precedent

Already-promoted projects (`personal-assistant-agent`, `ai-command-center`) keep their idea
note in `Ideas/` with `stage: building`, `decision: build`, and have a project folder under
`Active/`. Follow that precedent: **promotion updates the idea note in place and creates the
project folder — it does not move or delete the idea note.** Obsidian links stay stable and
the dashboard pipeline reads `stage`, not folder location.

## External Projects

Real projects whose code lives outside the vault (e.g. under `projects/`) are
represented in the pipeline by a **project note** (single `.md` file) under `Active/` with
`code_location` in frontmatter, rather than a full folder. The note carries the same
README-level content (what/why/status/next action).

## Safety Rules

- Triage is **read-only** against notes: it writes exactly one report file and (optionally,
  with user approval) a `triaged:` frontmatter stamp. It never moves, renames, or deletes notes.
- Promotion touches exactly two places: the new project folder it creates, and the source
  idea note's frontmatter + a `## Promotion` section appended to it.
- Neither skill runs on a schedule. They are invoked by a human, per the manual-first
  principle in the AI Project Orchestrator design note.
