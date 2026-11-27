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

`--week`: the week's records and progress entries rather than only this
session (Step 1).

## Step 1 - Gather the evidence

- This session's dispatches: every sub-agent or review fan-out visible in
  the session, with its model, effort (where known), and task.
- For a `--week` scope: the week's records and progress entries that name
  dispatches.
- **Measured usage**: run `node tools/spend.mjs` (this session, from
  `CLAUDE_CODE_SESSION_ID`) or `node tools/spend.mjs --session <id|path>`. It
  reads Claude Code's own transcripts and returns one line per agent (the main
  session and each subagent, labelled by the description it was started with)
  and model: calls, and input, cache-read, cache-write and output tokens, then a
  per-model total. `--sessions` gives one line per recent session for a `--week`
  scope. Transcripts carry no effort setting, so the effort of a dispatch comes
  from its record. These are the API's own counts, so they outrank every
  estimate below; price them with the model ladder in
  `_command/CONSTITUTION.local.md` section 2 (per MTok, input and output).
  Cache reads and writes are priced at the input rate unless that ladder
  says otherwise, and the report says which rate it used.
- Harness-reported token usage where the environment surfaces it (usage
  panels, transcript reports). Never invent numbers: if only rough
  estimates are possible, label them as estimates.

**If records are missing their dials, that IS the finding** - report the
gap first; a spend report cannot be better than its records.

## Step 2 - The tally

One table: task, model x effort used, roughly proportional weight
(measured tokens and their price where the transcripts have them, else tokens
where known, else S/M/L), and the `framework/roles.md` preset for that task
class. Each row says whether its numbers are measured or estimated.

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

## Epic runs aggregate per child

An epic run writes one set of dispatch records per CHILD, all on one branch.
Report it as a per-child table (child key, model x effort, tokens) plus the
epic total, so an expensive child is visible rather than averaged away. The
no-invented-numbers rule is unchanged: where the harness surfaced nothing, say
so for that child rather than estimating it.
