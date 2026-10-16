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

**Dials:** `--spend lean` = checks 1 and 6 only (imports + machine profile, and
the ignore gate, which is one script, available where `pwsh` is installed - see
check 6) ·
`standard` (default) = all checks · `deep` = adds the full
board-consistency scan and the cold-read self-summary. `--verbosity` per
the universal grammar - PASS/FAIL evidence is discipline at every tier.

## The checks (in order)

1. **Imports resolve.** The root `CLAUDE.md` is the shipped file, never
   edited: its last line imports the operating file,
   `_command/CLAUDE.operating.md`, which carries the six imports as the
   template writes them (`framework/kit/templates/_portfolio-claude.template.md`).
   Claude Code resolves an import from the folder of the file that holds
   it, so from `_command/` the two doctrine files read `../framework/...`
   and the four instance files are siblings (`CONSTITUTION.local.md`,
   `machine.local.md`, and the day pointer and board under `daily/` and
   `trackers/`). Verify the operating file and every import target exist,
   each resolved from the folder of the file that imports it. A broken
   import silently unloads doctrine (Claude Code skips a missing import
   without a notice) - this is the highest-stakes check. Then two things
   the files cannot show: that this session loaded them (the operating
   file's text and the six files are in your context, each under its own
   path), and that the root file carries no local edit.
   Run `git diff --quiet HEAD -- CLAUDE.md` and read its exit status on its
   own line: 0 passes; 1 is a FAIL, because the next pull that updates
   `CLAUDE.md` is refused over the edit. The fix: move any operating text
   into `_command/CLAUDE.operating.md`, then `git restore CLAUDE.md`.
   Exception with a heal: a missing `machine.local.md`, or one whose `os:`
   does not match the running OS, is not a failure - REGENERATE it by
   detection on the spot (`framework/platform.md` rule 4), then continue.
   The reference gate for the repo paths and links a document names is
   `bash tools/check-refs.sh [path ...]` (`tools/README.md`).
2. **Board and spokes agree.** Every front row in `trackers/fronts.md`
   has a hub (`portfolio/<front>/_front.md`); every project named in a
   hub has a spoke (housed per the structure rule in
   `framework/task-board.md`); every spoke has git-memory (base branch,
   convention, remote) or an explicit `N/A`, plus a `tracker:` field.
   Every spoke's `path:` exists: `fronts/<front>/<repo>` for a moved-in
   repo, the external path for a registered-in-place one. Every front's
   folder holds its repos: run `bash tools/check-fronts.sh` (on Windows,
   `python tools\check-fronts.py`; it has no PowerShell twin yet). Exit 0
   required; paste the output. It reports a front folder that is itself a
   repo and a worktree at the top of `fronts/`, each with the commands that
   fix it; preflight proposes those moves and never makes them (scoped with
   `--front`, only the lines naming that front count). Multi-project
   fronts: `_map.md` exists, and its `mapped:` date is fresh (older than
   ~30 days, or older than the front's last structural change = flagged
   for a `/map-front` re-run, not failed).
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
   `bash tools/leak-sweep.sh instance`
   (on Windows, `powershell -Command ".\tools\leak-sweep.ps1 instance"`;
   instance mode reads `_command/`, the operating file included, and the
   root `CLAUDE.md` in both, so the two are equivalent here). Exit 0
   required; paste the output.
6. **The instance cannot be committed.** Run
   `bash tools/check-ignores.sh` (on Windows,
   `powershell -Command ".\tools\check-ignores.ps1"`; both read the same lists).
   Exit 0 required; paste the output. Then two things the gate cannot
   see, being about this clone rather than the rules: `git ls-files _command` must print nothing (anything listed is
   already in the index) and `git status --porcelain _command` must print nothing
   either (a `??` is untracked but not ignored, one `git add -A` from a commit).
7. **Doctrine currency.** If `framework/` was recently pulled, read
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

## Also audit the surfaces the epic layer added

Five surfaces exist now that predate no check: the project's
`deviations.md` register (present where drift has been logged, format per
`/log-deviation`), any epic folder under `tasks/` (its stage documents each
carry a `status:` header, and a `locked` document edited without a logged
deviation is a finding), each fragment brief's state field (a brief reading
`in-progress` with no branch behind it is stale), and a front's declared
compliance or quality profile block (declared standards with no reader is a
finding, as is a profile naming a collector that no PR evidence reaches), and
the console fleet's folder `_command/fleet/`, where a fleet has run (the audit
log, the app's state file and the uploaded photos), which only Flight and the
app write.
