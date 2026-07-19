---
name: debrief
description: >-
  The evening wind-down (~15 minutes): roll up what actually happened into
  each touched project's progress.md, rewrite the daily pointer for
  tomorrow, surface founder-gated items, then capture the session's
  lessons by invoking learn-from-session as the final step. Use whenever
  the founder types /debrief, says "wrap up the day", "handoff", "end of
  day", or is about to leave the session after real work happened.
---

# Debrief

Continuity is part of done (`framework/learning-seed/04-continuity-is-part-of-done.md`).
The debrief is the hygiene tail that lets tomorrow's cold session resume
in seconds - run it as a literal checklist, self-triggered, never waiting
to be audited.

## Scope

`--front <name>` / `--project <name>`. **Scoped:** update ONLY that
slice - its task states + boards, its `progress.md`, its hub Status
block (max 5 lines), its one-line board row. A scoped debrief NEVER
touches `daily/today.md`: the day's consolidating debrief owns it. This
is also the concurrent-sessions convention - parallel per-front sessions
each run their scoped debrief; the last (or a dedicated) session runs
the unscoped one. **Unscoped (default):** the consolidating debrief -
all touched slices, then the `today.md` rewrite.

## Step 1 - Roll up state (per touched front)

For each project this session touched, append to its `progress.md`:
- what moved (with the literal evidence: test counts, gate outputs, PR
  links - claims carry receipts),
- what is now next,
- anything deferred, with the reason.

Three persistence layers, three jobs - do not flatten them:
- **State** goes to `progress.md` (this step).
- **Method** goes to `learning/` (Step 4).
- **Product docs**: if this session changed what a README or overview
  claims (a feature landed, a design phase closed), update the doc NOW - a
  stale entry-point doc actively misleads.

Then the front-facing surfaces, to their caps: the hub's `## Status`
block (max 5 lines - the front's narrative lives HERE, not on the board)
and the front's one-line row in `trackers/fronts.md`.

## Step 2 - Update the queues + rewrite the daily pointer

Tasks touched this session get their states updated (started =
`in-progress`, stuck = `blocked` with the reason, PR opened = `review`,
merged = `done`) and the affected `_board.md`s regenerated - the queue a
cold session reads tomorrow must be true tonight.

`_command/daily/today.md` gets rewritten (not appended): tomorrow's next
action per front + the standing objective, referencing task ids. It is a
pointer, not a log. If the board (`trackers/fronts.md`) drifted from
reality today, fix its rows in the same pass.

## Step 3 - Surface founder-gated items

List, in one short block, everything that now waits on the founder: a PR
to review, a credential to rotate, a decision to make, a payment gate.
These items go at the TOP of `today.md` under a "Founder-gated" heading,
**each carrying its date**, so they cannot silently rot (`/retro` flags
any older than two weeks). Scoped debriefs hold their gated items in the
hub Status block instead; the consolidating debrief lifts them into
`today.md`.

## Step 4 - Capture the lessons (mandatory final step)

Invoke `/learn-from-session`. It scans the session, runs every candidate
through its 8-rule critique gate, and routes survivors to the right store
(session memory vs `_command/learning/`). The debrief is not complete
until it has run and reported.

## Step 5 - Close

One line back to the founder: the campsite is clean, tomorrow starts at
`today.md`, and anything founder-gated is named. Nothing else - the
debrief's value is that it is short.
