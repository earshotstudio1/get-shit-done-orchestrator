# Context Handover Protocol

When a long-running session or agent approaches its context-window limit mid-step,
continuity beats completion: record exactly where you are IN the step, then hand the
remainder to a fresh agent. GSD state lives in files precisely so that no single context
window has to survive a whole project.

Triggered by any of: a `CONTEXT GUARD — SOFT/HARD LIMIT` message (gsd-context-guard
hook), `/gsd:context-status` reporting level `soft`/`hard`, or an explicit checkpoint in
a workflow.

## Thresholds

- **SOFT** (default 150k tokens, or ≤35% window remaining): finish ONLY the current
  atomic action, then hand over.
- **HARD** (default 250k tokens, or ≤25% remaining): stop immediately; hand over now.

An **atomic action** is the smallest thing that leaves no file half-written: the current
file edit, the current command, the current single test run. The current TASK is NOT an
atomic action. If the warning arrives between actions, the atomic action is already done.

## The handover, in order

1. **Write the handover entry** (exact shape below) into:
   - Phase execution: `.planning/phases/<current>/.continue-here.md` — the file
     `/gsd:resume-work` reads. Overwrite a stale one if present.
   - Orchestrator/vault work (no phase dir): append the same block to the project's
     `PROGRESS.md` under `## Log`.
2. **Point STATE.md at it** — one line under Current Position:
   `Handover: see phases/<current>/.continue-here.md (context limit, still in <step>)`.
   Do not rewrite STATE.md into prose.
3. **Commit** (if the project commits planning docs):
   `wip(<phase>): context handover — still in <step>`.
4. **Delegate the remainder:**
   - **Orchestrator (main session):** spawn a fresh agent of the same type this step
     would normally use. Its prompt = the handoff entry path + the files it must read.
     Do not paste conversation history into it.
   - **Subagent (executor/researcher/planner):** STOP and return immediately; end your
     final message with the `## HANDOVER` block (same content as the entry) so the
     orchestrator spawns your successor.
5. **After delegating** (orchestrator): coordination only — receive results, update
   state, spawn the next agent. No new heavy work in this context.

## Handover entry (exact shape)

```markdown
---
handover_reason: context-limit
still_in_step: <plan/task or workflow/step id — e.g. "03-02 task 3 (filler detector)">
status: in_progress   # the step is NOT complete
written_at: <timestamp>
---

## Context handover — still in step: <id>

**Done so far in this step:** <specific: files written, decisions made, what works>
**Not done:** <what remains of THIS step, then which tasks/steps follow it>
**Exact next action:** <the first concrete thing the successor does>
**Files touched this session:** <paths>
**Open questions / anomalies:** <note them here — do NOT investigate them now>
```

The successor reads this entry, cheaply verifies the "Done so far" claims, continues from
"Exact next action", and resolves/deletes the entry when the step truly completes. Only
the successor may mark the step `[x]`.

## Non-negotiables

- Never mark the handed-over step complete. `still_in_step` means still in the step.
- Never fabricate or "quickly finish" work to make state look consistent before handing
  over.
- Anomalies you notice go in "Open questions" — investigating them now is new work.
- The handover entry is the ONLY deliverable of a context-limited context. It is small
  (≤30 lines). Writing it costs almost nothing; finishing "one small task" does not.

## Rationalizations (all observed in baseline testing)

| Excuse | Reality |
|--------|---------|
| "This task is small and well-specified — finishing it is the highest-leverage use of what's left" | Finishing it took ~18 tool calls in baseline testing. A fresh agent does the same work with a full window and can still verify itself. Hand it over. |
| "I should investigate this inconsistency I just noticed first" | Investigation is new work. Write it into Open questions and hand over. |
| "A detailed STATE.md rewrite is the best possible handoff" | `/gsd:resume-work` reads `.continue-here.md`, not prose archaeology. Use the recipe. |
| "The next session will figure it out from my notes" | Passive notes are not a handover. Delegate (spawn a successor, or HANDOVER-return) so the step actually continues. |
| "Writing a handover costs tokens too" | ~30 lines versus an open-ended task: two orders of magnitude cheaper. |

## Red flags — STOP and hand over

- You just read a CONTEXT GUARD warning and are about to open another file "quickly"
- You are implementing anything after the warning
- You are checking `[x]` on the step you're inside
- You are explaining your state in chat instead of writing the entry

**Advisory mode is different:** in non-GSD sessions the guard deliberately does NOT
instruct autonomous handover — there you inform the user and let them decide
(upstream behavior, preserved).
