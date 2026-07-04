# Triage Report Template

Template for `<vault>/Maintenance/Reports/YYYY-MM-DD-idea-triage.md` — output of
`/gsd:triage-ideas`.

<template>

```markdown
---
title: Idea Triage — [YYYY-MM-DD]
date: '[YYYY-MM-DD]'
type: triage-report
domain: project
status: active
workflow: gsd-orchestrator
created: '[YYYY-MM-DD]'
updated: '[YYYY-MM-DD]'
---

# Idea Triage — [YYYY-MM-DD]

Scanned: `Projects/Ideas/` ([N] notes) [+ M external projects]
Tool: `/gsd:triage-ideas` (get-shit-done-orchestrator fork)

## Summary

| Idea | Class | Maturity | Effort | Impact | Route | Confidence |
|------|-------|----------|--------|--------|-------|------------|
| [[note-name]] | project | raw capture | M | medium | Backlog | high |

## Per-Idea Detail

### [[note-name]] — [Title]

- **Classification:** [project / reference / duplicate / already-promoted] — [one line why]
- **Maturity:** [raw capture / developing / spec-ready]
- **Effort:** [S/M/L/XL] — [what drives the estimate]
- **Impact:** [low/medium/high] — [grounded in what the user cares about]
- **Route:** [folder / action] — [reason]
- **Next action if approved:** [one concrete step]

## Proposed Actions

- [ ] [Move X to Backlog]
- [ ] [Promote Y via /gsd:promote-project]
- [ ] [Reconcile frontmatter on already-promoted Z]

## Notes for the Human

[Anything ambiguous, low-confidence calls, duplicates suspected but not certain.]
```

</template>
