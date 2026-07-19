---
name: spend
description: >-
  The token-economy report: tallies which model x effort did which task -
  from the session's dispatch records - flags violations of the routing
  doctrine (frontier models on mechanical work, un-sized fan-outs), states
  the burn honestly, and ends with one routing adjustment to adopt. Use
  whenever the founder types /spend, asks "what did this session cost",
  "where did the tokens go", or at the end of a heavy multi-agent day.
---

# Spend

Cost discipline is doctrine (`framework/routing-grid.md`: "token economy
is a tracked metric"). This skill is the meter. It reads the records the
doctrine already requires - every dispatch record carries its model x
effort dials per `framework/kit/_record-schema.md` - and reports what the
work actually cost in routing terms.

## Scope

`--front <name>`: tally only dispatches attributable to that front (by
the identity header on each record). Unscoped (default): everything.

## Step 1 - Gather the evidence

- This session's dispatches: every sub-agent or review fan-out visible in
  the session, with its model, effort (where known), and task.
- For a `--week` scope: the week's records and progress entries that name
  dispatches.
- Harness-reported token usage where the environment surfaces it (usage
  panels, transcript reports). Never invent numbers: if only rough
  estimates are possible, label them as estimates.

**If records are missing their dials, that IS the finding** - report the
gap first; a spend report cannot be better than its records.

## Step 2 - The tally

One table: task, model x effort used, roughly proportional weight
(tokens where known, else S/M/L), and the `framework/roles.md` preset for
that task class.

## Step 3 - Flag the mismatches

- **Over-routing:** frontier model or high effort on mechanical work
  (transcription, copying, reformatting, simple fixes).
- **Un-sized fan-outs:** any parallel batch that ran without a stated
  N x model x effort and an explicit go - a doctrine violation regardless
  of outcome.
- **Under-routing that cost a retry:** a cheap dispatch that failed and
  was re-run higher - honest to report, since the retry doubles the price.
- **Escalations without evidence:** re-runs on a bigger model where the
  smaller output had not actually failed.

State the burn plainly. No soft-pedaling: "roughly 60 percent of today's
tokens went to review fan-out on small diffs" is the sentence the founder
needs, not "usage was somewhat elevated."

## Step 4 - One adjustment

End with exactly ONE routing adjustment to adopt (not five) - the change
with the biggest expected saving, worded as a rule the founder can approve
into practice (and, if it keeps proving out, promote via
`/promote-learnings`). One adjustment per report keeps the dial-turning
deliberate.
