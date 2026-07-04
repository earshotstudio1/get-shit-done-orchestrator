# Promoted Project Template

Templates for the two files `/gsd:promote-project` scaffolds under
`<vault>/Projects/Active/<slug>/`.

## README.md

<template>

```markdown
---
title: [Project Name]
date: '[YYYY-MM-DD]'
type: project
domain: project
area: [app | agent | infrastructure | ...]
stage: building
decision: build
status: active
promoted_from: '[[<idea-note-name>]]'
code_location: '[path — only if code lives outside the vault]'
created: '[YYYY-MM-DD]'
updated: '[YYYY-MM-DD]'
---

# [Project Name]

## Outcome

[One-line outcome from the idea note or the user. What exists when this is done?]

## Requirements

- [ ] [Requirement 1]
- [ ] [Requirement 2]
- [ ] [Requirement 3]

## First Milestone

[The smallest end-to-end thing worth building first, in 1-3 sentences.]

## Non-Goals

- [Exclusion] — [why]

## Assumptions (unconfirmed)

[Only present if promoted non-interactively — assumptions the human should confirm.]

## Links

- Idea note: [[<idea-note-name>]]
- Code: `[code_location]` (when applicable)
```

</template>

## PROGRESS.md

<template>

```markdown
---
title: [Project Name] — Progress
type: progress
domain: project
stage: building
status: active
next_action: '[first task from the milestone]'
created: '[YYYY-MM-DD]'
updated: '[YYYY-MM-DD]'
---

# Progress — [Project Name]

**Stage:** building
**Next action:** [first task]

## Tasks

- [ ] [Task 1 — seeded from first milestone]
- [ ] [Task 2]

## Log

- [YYYY-MM-DD] — Promoted from [[<idea-note-name>]] via /gsd:promote-project
```

</template>
