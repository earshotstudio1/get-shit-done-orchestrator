<purpose>

Launch a hands-off run of the current milestone. Conducts the up-front decision review
in *this* session — where the user actually is — then hands off to the controller loop
(`gsd-run.js`), which spawns one fresh headless session per cycle until the milestone
completes, a blocker needs a human, or the cycle cap is reached.

The split matters: the review has to happen where someone can answer it. A cycle spawned
by the controller is headless, so anything that asks a question there stalls the run.

</purpose>

<required_reading>

Read all files referenced by the invoking prompt's execution_context before starting.
The up-front review reuses the `prefront_review` step of `autonomous.md` — read that
workflow rather than reimplementing the review here.

</required_reading>

<process>

<step name="preconditions" priority="first">

## 1. Check the project is ready

```bash
ls .planning/ROADMAP.md .planning/STATE.md 2>/dev/null
```

**If either is missing:** stop and tell the user which one, and what to run:

```
No milestone to run yet.

  /gsd:new-project     — define what you're building (once per project)
  /gsd:new-milestone   — define the phases for this milestone

Then run /gsd:marathon again.
```

Do not attempt to create either. This command drives an existing milestone.

Check Claude Code is reachable as a command, since the controller spawns it:

```bash
command -v claude >/dev/null 2>&1 && echo found || echo missing
```

**If missing:** stop and tell the user the `claude` command is not on PATH, so the
controller cannot spawn sessions. `/gsd:autonomous` still works inside this session.

</step>

<step name="parse_arguments">

## 2. Parse arguments

From `$ARGUMENTS`:
- `--cycles N` → `CYCLES`
- `--mode batched|unattended` → `MODE` (default `batched`)
- `--dry-run` → `DRY_RUN`

```bash
AUTONOMY=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" autonomy mode --mode ${MODE})
```

Parse `max_cycles` for the default when `--cycles` was not given.

</step>

<step name="survey">

## 3. Survey the work

```bash
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" init milestone-op)
ROADMAP=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" roadmap analyze)
```

Parse `milestone_version`, `milestone_name`, `phase_count`, and the `phases` array.
Filter to incomplete phases exactly as `autonomous.md` does.

**If no incomplete phases remain:** display `Milestone {version} is already complete — nothing to run.` and exit.

Check for an interrupted run:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" autonomy status
```

**If `status` is `blocked`:** display the reason and ask via AskUserQuestion whether to
continue anyway ("the blocker may still be there") or stop so they can deal with it.
On stop, exit cleanly.

Display the plan:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► MARATHON
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 Milestone: {version} — {name}
 To do:     {N} of {phase_count} phases
 Mode:      {mode}
 Cycles:    up to {cycles} sessions

 {list of incomplete phases, one per line}
```

</step>

<step name="upfront_review">

## 4. Up-front review

**Skip if `MODE` is `unattended`** — that mode deliberately reviews nothing. Warn once:
`Unattended — every decision will use the recommended answer. See DECISIONS-DEFERRED.md afterwards.`

**Otherwise** run the `prefront_review` step of `autonomous.md` exactly as written: skip
infrastructure phases, generate grey areas and recommendations for the rest, present them
as one table grouped by phase, and write the accepted answers to
`.planning/AUTONOMY-PREFERENCES.md`.

This is the one substantial pause of the whole run, and it is the point of `batched` mode:
answer once here and the cycles never stop to ask.

**If the user chooses "Discuss phase by phase instead"** in that review, do not launch the
controller. Tell them:

```
Staying interactive — run /gsd:autonomous to work through phases in this session.
```

and exit. A phase-by-phase discussion needs a session with a human in it.

</step>

<step name="confirm_launch">

## 5. Confirm

Summarise exactly what is about to happen, then ask via AskUserQuestion:

```
Ready to run.

 {N} phases, up to {cycles} sessions, {mode} mode.
 Decisions: {M} accepted up front{, or "none — unattended"}.

 The run will stop on its own if a phase is blocked, the milestone audit finds
 gaps, or the cycle cap is reached. It will not delete files, push, or deploy.
```

- **question:** "Start the run?"
- **options:** "Start" / "Dry run first — show what it would do" / "Cancel"

**On "Cancel":** exit cleanly. The up-front review is saved either way.

**On "Dry run first":** set `DRY_RUN`, proceed to launch, then re-ask this question once
the dry run output is displayed.

</step>

<step name="launch">

## 6. Launch the controller

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-run.js" \
  --mode ${MODE} --max-cycles ${CYCLES} --quiet ${DRY_RUN:+--dry-run}
```

`--quiet` matters: without it every cycle's full transcript streams back into this
session and floods its context. Cycle output goes to `.planning/autonomous-run.log`
instead, and only the per-cycle summary lines come back here.

Run this as a single long-running command. Do not poll, do not spawn subagents, and do
not run other work while it executes — the controller is the run.

</step>

<step name="report">

## 7. Report the outcome

Read the controller's exit code and the sentinel:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" autonomy status
```

| Exit | Report |
|------|--------|
| 0 | `✅ Milestone {version} complete.` |
| 1 | The controller could not start — show its stderr verbatim. |
| 2 | `⛔ Stopped: {reason}` plus the phase, and what the user needs to do. |
| 3 | `⏸ Cycle cap reached — {N} phases remain. Run /gsd:marathon again to continue.` |

Then, in every case, report what happened without you:

```bash
wc -l < .planning/DECISIONS-DEFERRED.md 2>/dev/null
```

Display the count of decision rows and the path, and say plainly that they should read it
before shipping the milestone. If any rows are `verify.human_needed`, list those phases —
they have items nobody has manually tested.

Point at `.planning/autonomous-run.log` for the full transcript, and `/gsd:progress` for
the current roadmap state.

</step>

</process>

<success_criteria>
- [ ] Refuses to run without ROADMAP.md and STATE.md, naming the command that creates them
- [ ] Refuses to run when `claude` is not on PATH, and says `/gsd:autonomous` still works
- [ ] Surveys incomplete phases and displays them before doing anything
- [ ] A prior `blocked` status is surfaced and the user chooses whether to continue
- [ ] Up-front review runs in THIS session, where a user can answer it
- [ ] Review is skipped in unattended mode, with a warning
- [ ] "Discuss phase by phase" exits to /gsd:autonomous rather than launching the controller
- [ ] Launch is confirmed, with a dry-run option, before any session is spawned
- [ ] Controller invoked with --quiet so cycle transcripts do not flood this session
- [ ] Outcome reported per exit code, including the deferred-decision count and path
</success_criteria>
