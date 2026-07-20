---
name: new-front
description: >-
  Onboard a new project (front) into an existing mission-control
  portfolio: a short detect-first interview, then the front hub, per-repo
  spokes with git-memory, a board row, and a today entry. Use whenever the
  founder says "add a front", "new project", "onboard <name> into the
  portfolio", or points at a repo that is not yet on the board.
---

# New Front

Adds one project to the portfolio with the same rigor LIFTOFF applied to
the originals - without re-running liftoff. Detect first, ask only what a
repo cannot answer, and stop for approval before the front goes live.

## Preconditions

- `_command/` exists (if not: this portfolio has not lifted off - run
  `LIFTOFF.md` instead).
- Read `framework/CONSTITUTION.md`, `_command/trackers/fronts.md`, and
  `_command/daily/today.md` first, so the new front lands in the real
  current picture.
- Adding a project to an EXISTING front? Same skill: the intake runs per
  project, and Step 4's promotion rule handles the restructure.

## Step 1 - Intake (ask only the path)

Ask: *where does the project live right now?* (a path, or "no repo yet",
or "not a code project").

**Detect-first scan** (for an existing repo): read, in place, without
modifying anything:
- `git remote -v`, the default branch, and recent branch names (to infer
  the branch convention),
- the manifest (package.json / pyproject / go.mod / ...) for name, runtime
  pins, and scripts,
- the README and any TODO/backlog file,
- branches ahead of the base and the last few commit subjects (to draft
  the front's current state + next action from evidence).

Present the pre-filled spoke draft: *"here is what I found - correct
anything."* Confirming beats answering.

## Step 2 - The move-in-or-register choice (approval gate)

Offer, with the exact command shown:

> I'd bring it into the portfolio root so every session sees it:
> `mv <current-path> ./<front-name>` - it stays its own git repo,
> untouched; the portfolio repo cannot even see its files (the allowlist
> .gitignore). Move it, or register it where it is?

- **Move-in (recommended):** run the move only after an explicit yes.
- **Register-in-place:** the spoke records the external absolute path,
  and the root `CLAUDE.md` gains a note that this front's directory must
  be added to sessions that work on it.
- **Non-git fronts** (a design folder, a course, a consulting gig) are
  first-class: hub without git-memory, spoke fields marked `N/A`.

## Step 3 - Ask only what a repo cannot answer

One question at a time:
- **Trust level:** yours / partnered / employer / stakeholder (a venture
  where you present rather than push). If employer: note the IP boundary
  explicitly in the hub (employer-owned code and secrets stay
  confidential, separate from your own projects). Confidential fronts'
  spokes carry pointers and process, never payloads - no client or
  employer code, deliverable text, or secrets in `_command/`.
- **Posture:** active / maintenance / present-don't-push (for fronts with
  stakeholders where you propose rather than act).
- **Stakes:** why this front matters, one line.
- **Tracker:** detect-then-confirm ("I see GitHub issue templates here -
  is GitHub Issues this project's tracker, or should I run its native
  board?"). Recorded as the spoke's `tracker:` field: `tasks` / `jira` /
  `github`. One tracker per project, never both.
- **Next action:** confirm the evidence-drafted one, or take theirs.

## Step 4 - Write

Using `framework/kit/templates/_front.template.md`,
`_repo-context.template.md`, and `_board.template.md`:
- `_command/portfolio/<front>/_front.md` - the hub: big picture, project
  map, posture, trust.
- One spoke per project - deep context + git-memory (base branch, branch
  convention, remote/host, account mapping; git facts live ONLY here) +
  the `tracker:` field (`tasks` for the native board, or `jira` /
  `github` when an external tracker governs). **Structure rule:** a
  single-project front keeps the spoke beside the hub
  (`<front>/<project>.md`); a multi-project front houses each project in
  its own directory (`<front>/<project>/<project>.md`).
- A `tasks/` folder beside each spoke, seeded with `_board.md` (empty is
  correct; see `framework/task-board.md`).
- **The promotion rule:** when this skill adds a SECOND project to a
  single-project front, restructure in the same pass - create the
  housing directories and move each spoke + `tasks/` into its own. Task
  ids and history survive (a task's identity is its filename).
- Append the front's ONE-line row to `_command/trackers/fronts.md` (the
  index format from `framework/kit/templates/_fronts-board.template.md` -
  narrative goes in the hub's Status block, never the board).
- Append the front's next action to `_command/daily/today.md` (one line).
- Update the fronts branch of `_command/mental-model.md`.
- (The mirror skill is `/retire-front` - fronts leave the portfolio with
  the same rigor they join it.)
- Multi-project front? Suggest the follow-up:
  `/map-front --front <name>` (depth 1) - so a change to one project
  never blindsides its dependents.

## Step 5 - STOP gate, then verify

Present the written files for founder review - no self-approval; the
front is not live until the founder says so. On approval, re-read the
board and state the new front's next action back in one line, proving the
instance is coherent.
