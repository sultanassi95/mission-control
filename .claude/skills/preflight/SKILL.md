---
name: preflight
description: >-
  The re-runnable instance health check: verifies the portfolio's own
  wiring - CLAUDE.md imports resolve, board and spokes agree, today.md is
  fresh, no leftover placeholders - then proves coherence with a cold-read
  self-summary. Use after a framework git pull, after adding a front,
  after a messy week, or whenever the founder types /preflight or asks
  "is my setup still healthy?".
---

# Preflight

The liftoff's prove-it gate, productized: run it any time to verify the
instance a cold session would boot into. Every check reports PASS or FAIL
with evidence; a preflight that only says "looks good" has not run.

## Scope

`--front <name>`: check only that front's wiring, spokes, and boards
(checks 2-3 below, scoped). Unscoped (default): the whole instance.

**Dials:** `--spend lean` = checks 1 only (imports + machine profile) ·
`standard` (default) = all checks · `deep` = adds the full
board-consistency scan and the cold-read self-summary. `--verbosity` per
the universal grammar - PASS/FAIL evidence is discipline at every tier.

## The checks (in order)

1. **Imports resolve.** Read the root `CLAUDE.md`; verify every `@import`
   target exists (`framework/CONSTITUTION.md`,
   `framework/engineering-standard.md`, `_command/CONSTITUTION.local.md`,
   `_command/machine.local.md`, `_command/daily/today.md`,
   `_command/trackers/fronts.md`). A broken import silently unloads
   doctrine - this is the highest-stakes check. Exception with a heal: a
   missing `machine.local.md`, or one whose `os:` does not match the
   running OS, is not a failure - REGENERATE it by detection on the spot
   (`framework/platform.md` rule 4), then continue.
2. **Board and spokes agree.** Every front row in `trackers/fronts.md`
   has a hub (`portfolio/<front>/_front.md`); every project named in a
   hub has a spoke (housed per the structure rule in
   `framework/task-board.md`); every spoke has git-memory (base branch,
   convention, remote) or an explicit `N/A`, plus a `tracker:` field.
   Registered-in-place fronts: the external path still exists.
   Multi-project fronts: `_map.md` exists, and its `mapped:` date is
   fresh (older than ~30 days, or older than the front's last structural
   change = flagged for a `/map-front` re-run, not failed).
3. **Boards and caps are truthful.** For every native-tracker project:
   each `tasks/T-*.md` file appears in its `_board.md` under its actual
   state; no orphan board rows; no task stuck `in-progress` with no
   branch. For external-tracker projects: `tasks/` is unused (the
   one-tracker rule). And the size caps hold: every fronts.md row is one
   line; every hub Status block is 5 lines or fewer; today.md carries one
   line per active front + dated gated items. A blown cap is a FAIL with
   the offending file named.
4. **The pointer is fresh.** `daily/today.md` is dated, has a next action
   per active front, and its "Founder-gated" items are still real (spot
   check one or two).
5. **No leftover placeholders.** Run the instance-mode sweep:
   `powershell -Command ".\tools\leak-sweep.ps1 -Mode instance -Path _command,CLAUDE.md"`
   (or `tools/leak-sweep.sh instance`). Exit 0 required; paste the output.
6. **Doctrine currency.** If `framework/` was recently pulled, read
   `CHANGELOG.md`'s new entries for anything that contradicts
   `CONSTITUTION.local.md`; name conflicts rather than silently
   preferring either side.

## The cold-read proof

Finish by reading the instance as a stranger would and stating, from the
files alone: the board (fronts + postures, one line each), today's next
action per front, and the standing rules in one paragraph. If anything in
that summary surprises the founder, the instance - not the summary - gets
fixed.

## Report

A short table: check, PASS/FAIL, evidence. Then the cold-read summary.
FAILs come with the exact file to fix and the proposed fix, presented for
approval - preflight diagnoses, the founder decides.
