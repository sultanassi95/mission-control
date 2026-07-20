---
name: briefing
description: >-
  The morning ritual (~15 minutes): read the board and today's pointer,
  review anything that landed since the last session, report state per
  front in one line each, propose today's ONE objective plus a next action
  per front, and wait for the founder to lock it. Use whenever the founder
  types /briefing, says "start my day", "morning", "mission control", or
  opens a session asking where things stand. With --week (or on a Monday),
  also propose the week's objective per front.
---

# Briefing

The morning standup with your AI team. Fifteen minutes that buy a focused
day: the board is read, the noise is compressed, one objective is locked.

## Scope

`--front <name>` / `--project <name>` (names match the `portfolio/`
directories; a bare project name resolves to its front when unambiguous,
else ask). **Unscoped (default):** the whole portfolio, with the rotation
rule below. **Scoped:** that front's queues + hub Status only; propose
that front's day and stop.

**Dials:** `--spend lean` = primary + surprises only, queues skipped ·
`standard` (default) = the rotation rule · `deep` = every front, full
queue detail. `--thinking` (default medium - proposal judgment) and
`--verbosity` per the universal grammar (README).

**The rotation rule (unscoped):** propose next actions for the PRIMARY
front, today's rotation front(s), and any front with a surprise (a red
CI run, a partner's commit, an expired credential). Every other front
gets ONE collective standing line ("N fronts standing, no changes") -
not a row each. Parked/dormant postures are skipped unless something
changed. Not every front, every day.

## Step 1 - Read (no questions yet)

- `_command/daily/today.md` - yesterday's pointer: what was supposed to be
  next.
- `_command/trackers/fronts.md` - the board.
- Each active project's `tasks/_board.md` - the queue: `ready`,
  `in-progress`, and `blocked` are the rows a briefing cares about.
- Anything that finished since the last session: background output, CI
  results, review feedback the founder pasted, overnight notes.
- For any front whose state looks stale or contradictory, check its
  `progress.md` before reporting - never brief from a hunch.

## Step 2 - Report state per front

One line each, plain language, specifics over labels:
`<front> - <where it actually stands> - <the one thing that would move it>`.

Flag loudly anything that changed out from under the plan (a red CI run, a
partner's commit, an expired credential). Surprises belong at the top of a
briefing, not the bottom.

## Step 3 - Propose, then WAIT for the lock

- **Today's ONE objective** - the single thing that, if it ships today,
  makes the day a win. Portfolio discipline: the primary front gets the
  deep block; secondary fronts get deliberate, scoped touches.
- **Next action per front** - one line each, concrete enough to start
  without thinking, drawn from the queues (`ready` first; `blocked`
  called out with what unblocks it), referencing task ids.
- With `--week` (or on Mondays): the week's objective per front, plus
  anything on a cadence (a scoreboard update, a retro due Friday).

Present the proposal and STOP. The founder locks it, edits it, or reorders
it - their call, not yours. Silence is not a lock.

## Step 4 - Write the locked version

Rewrite `_command/daily/today.md` with the locked objective + next actions
(a pointer, not a log - history lives in each project's `progress.md`),
respecting the caps: one line per active front, non-rotation fronts as
one standing count, gated items dated. If a board row drifted, restore it
to its one line. Confirm in one line: the day is loaded.
