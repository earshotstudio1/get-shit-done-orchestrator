# Autonomy Modes

GSD workflows pause at roughly fifteen decision points. In an interactive session that
is the feature — it is where the quality comes from. In a headless `claude -p` cycle
there is nobody to answer, so every pause has to resolve to a documented default or the
run stalls until it times out.

This reference is the human-readable half of the policy. The machine-readable half is
`get-shit-done/bin/lib/autonomy.cjs`, and the two must agree — the workflow asks the CLI,
never its own memory:

```bash
GATE=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" autonomy resolve verify.gaps_found)
```

## Modes

| Mode | When | Behaviour |
|------|------|-----------|
| `supervised` | Default. Any interactive session. | Every gate asks. Identical to upstream. |
| `batched` | Default for `gsd-run.js`. | User-facing grey areas are front-loaded into one review before the run; everything after resolves automatically. |
| `unattended` | Throwaway projects, or work whose intermediate choices you genuinely don't care about. | Nothing asks. Every gate takes its default and is logged. |

Resolution order: `--mode` flag → `GSD_AUTONOMY_MODE` env → `.planning/config.json`
`autonomy.mode` → `supervised`.

Supervised is the fallback on purpose. A session that has never heard of this feature —
or one where the config is missing or malformed — must behave exactly as it did before.

## Gate policy

| Gate | supervised | batched | unattended |
|------|-----------|---------|------------|
| `discuss.grey_area` | ask | accept¹ | accept¹ |
| `plan.missing_context` | ask | **stop** | **stop** |
| `plan.ui_spec_missing` | ask | defer | defer |
| `verify.human_needed` | ask | defer | defer |
| `verify.gaps_found` | ask | retry once → defer | retry once → defer |
| `audit.gaps_found` | ask | **stop** | **stop** |
| `audit.tech_debt` | ask | **stop** | **stop** |
| `milestone.cleanup` | ask | dry-run | dry-run |
| `blocker` | ask | **stop** | **stop** |

¹ `smart_discuss` already pre-selects a recommended answer per question, reasoned from
prior CONTEXT.md decisions and the codebase scout. Accepting is choosing that
recommendation — not choosing at random. In `batched`, answers captured in the up-front
review win over the recommendation.

### Why some gates stop rather than defer

**Missing context.** If discuss produced no CONTEXT.md, planning would proceed on
inference alone. That is how a run produces ten confident phases of the wrong thing.

**Audit gaps and tech debt.** Deferring these means marking a milestone shipped while
knowing it isn't. The milestone boundary is the natural place for a human to look, and
the phases already done are not wasted — the next run resumes from them.

**Blockers.** A blocker is by definition something the run could not resolve. Stopping
cleanly with a reason costs one cycle; looping on it costs all of them.

Stop is not failure. It writes `blocked` plus a reason to the sentinel, the controller
exits 2, and you get told what needs you.

### What never happens unattended

Deleting files (cleanup is dry-run only), pushing, opening PRs, deploying. The
controller does none of these and no gate can authorise them.

## Status sentinel

`.planning/.autonomous-status.json` is how a cycle tells the controller what happened —
terminal banners are invisible to a parent process.

```json
{ "status": "blocked", "reason": "...", "phase": "7", "milestone": "v1.2", "updated_at": "..." }
```

`continue` (more work remains) · `complete` (milestone done) · `blocked` (needs you).

Every exit path of `autonomous.md` writes it. A cycle that leaves it untouched has told
the controller nothing; two such cycles in a row are treated as a stall and the run stops.

## Decision trail

Every gate resolved without you appends a row to `.planning/DECISIONS-DEFERRED.md`:
when, phase, gate, action, note. This file is as much a deliverable of an unattended run
as the code is — it is the only way to find out what was decided on your behalf. Read it
before shipping the milestone.

## The honest limitation

In `batched` and `unattended`, `discuss.grey_area` resolves to a recommendation nobody
reviewed at the moment it was applied. On infrastructure phases this is close to free —
the workflow already detects those and skips discussion entirely. On user-facing phases
it is a real quality risk, which is what the up-front review in `batched` exists to
absorb. If a project is mostly interface work and you care about the interface, run
`batched` and take the review seriously, or stay supervised.
