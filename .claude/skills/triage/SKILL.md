---
name: triage
description: >-
  Turns a messy inbox into board-ready work: the founder pastes anything -
  ideas, bug reports, asks, meeting notes, a voice-note transcript - and
  each item gets a front assignment, a classification (bug / task /
  enhancement), a size guess, and a proposed next action, presented as one
  table behind a STOP gate before anything is written. Use whenever the
  founder types /triage or dumps a list of mixed items ("here's everything
  on my mind", "notes from the call").
---

# Triage

Multi-front intake. A single-repo tool triages into one backlog; a
portfolio triages across fronts first - the routing IS the value.

## Scope

`--front <name>` / `--project <name>`: constrain intake to that slice -
items are routed within it, and anything that clearly belongs elsewhere
is flagged `OUT OF SCOPE -> <front>` in the table rather than filed.
Unscoped (default): items route to any front.

**Dials:** `--spend lean` = classify only, smallest table · `standard`
(default) = the full triage · `deep` = adds a duplicate scan,
per-item dependents lookups, and - for items naming an existing repo
surface - an already-delivered scan (`git log origin/<base> --grep`):
work the base branch already contains is flagged, not filed. `--thinking` (default medium -
classification judgment) and `--verbosity` per the universal grammar -
the STOP gate table is discipline, shown at every tier.

## Step 1 - Parse, don't invent

Split the paste into atomic items. Rules:
- Never invent an item that is not in the founder's text.
- Never merge two items because they look related - flag the relation
  instead.
- An ambiguous item gets ONE precise clarifying question, asked in the
  triage table's notes column, not a guess.
- Confidential content (names from private conversations, dialog) is
  extracted to the anonymized task only; the source text is never copied
  into board files.

## Step 2 - Classify each item

| Column | Values |
|---|---|
| Front | one of the board's fronts, or `NEW FRONT?` (flag, don't create) |
| Kind | bug / task / enhancement / decision-for-founder / info-only |
| Size | S (under an hour) / M (a session) / L (multi-session, needs a plan) / EPIC (the correct shape is several tickets) |
| Next action | one concrete line, startable without thinking |
| Notes | the clarifying question, a duplicate flag, or a dependency |

Bugs get the evidence bar: what was observed, where, reproducible or not.
An item that is really a product decision is labeled `decision-for-founder`
and never silently becomes a task.

## Step 3 - Present the table, STOP

The full table, ordered by front then size, before ANY file is written.
The founder approves all, edits rows, or drops items. Silence is not
approval.

## Step 4 - Write (approved rows only)

- Board-worthy items: a task file (`T-NNN-<slug>.md` from
  `framework/kit/templates/_task.template.md`) in the right project's
  `tasks/` folder - state `backlog`, or `ready` when the founder locked
  scope during this triage - and `_board.md` regenerated. Filing on a
  mapped project: append one line to the task body -
  `Dependents: <list> (see _map.md)`. Projects whose
  spoke says `tracker: jira|github`: file in the external tracker
  instead (one tracker per project, never both).
- Today-relevant items: a line in `daily/today.md` under the right front,
  referencing the task id.
- Items ready for delivery: hand the founder the one-line
  `/mission-flow <description> + <tracker ref>` invocation for each, one
  flow per item - never start the flows unasked.
- EPIC-sized items: hand `/epic-flow <description>` instead - a single task
  file cannot hold work whose correct shape is several tickets, and filing it
  as one L task is how a plan's remainder gets lost. Never start the epic
  unasked either.
- `NEW FRONT?` items: point at `/new-front`, founder's call.

Close with counts: N items in, N routed, N dropped, N awaiting answers.
