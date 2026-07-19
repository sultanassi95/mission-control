---
name: retro
description: >-
  The weekly close (~30 minutes, typically Friday): shipped / live / stuck
  per front against the week's objectives, an optional scoreboard update,
  a week-scale lessons sweep via learn-from-session, and a proposed set of
  next-week objectives that the founder locks. Use whenever the founder
  types /retro, says "close the week", "weekly review", or "Friday retro".
---

# Retro

The week's honest mirror. A retro that only celebrates is a newsletter;
this one states what shipped, what is live in users' hands, what is stuck
and why, and what the week taught.

## Scope

`--front <name>`: one front's week only (its shipped/stuck, its lessons,
its next-week objective). Unscoped (default): the whole portfolio.

**Dials:** `--spend lean` = shipped/stuck bullets only · `standard`
(default) = the full retro · `deep` = adds the week-scale lessons sweep
and a `/spend` meter read. `--thinking` (default high - a retro is
synthesis) and `--verbosity` per the universal grammar.

## Step 1 - Gather

- `_command/daily/today.md` + `trackers/fronts.md` - the week's intent.
- Each active front's `progress.md` - what actually happened.
- The week's `learning/` additions - what was already captured.

## Step 2 - Shipped / Live / Stuck, per front

Three buckets, evidence attached:
- **Shipped** - merged, deployed, delivered. Name the artifact, not the
  effort ("the export endpoint is live", not "worked on exports").
- **Live** - in use; note any real usage signal (a user, a run, a number).
- **Stuck** - blocked or slower than intended, with the honest reason:
  founder-gated? under-scoped? a real technical wall? Stuck items with
  fuzzy reasons get one clarifying question each, now.

If the founder keeps a scoreboard (revenue, users, runway - typically a
tracker in `_command/trackers/`), update it in this pass. If they don't,
skip without comment - the scoreboard is the founder's choice, not a
requirement.

## Step 3 - The week-scale lessons sweep

Invoke `/learn-from-session` scoped to the whole week ("scan the week's
sessions and progress entries, not just today"). The weekly pass catches
patterns single sessions miss: the same friction three days running, a
routing choice that kept paying off, a front that consistently overruns
its slot.

## Step 4 - Propose next week, then WAIT

- Next week's objective per front (primary front first).
- Anything to explicitly drop or park (saying it out loud is the point -
  a parked item is a decision; a silently rotting item is a debt).
- **Founder-gated items older than two weeks** (their dates live in
  `today.md`): each gets flagged "decide or drop" - a gated item is a
  decision waiting, and waiting is also a decision.
- Any cadence items due (a promotion pass via `/promote-learnings` if
  lessons have been reinforcing, a `/preflight` if the instance took a
  beating this week).

Present and STOP for the founder's lock. On approval, write the locked
objectives into `today.md` (and the board if postures changed), so Monday's
`/briefing` opens onto a decided week.
