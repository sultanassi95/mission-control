---
name: mission-flow
description: >-
  The standard playbook for turning a bug, task, or enhancement into a
  merged-ready PR on any front. Runs the fixed 8-phase sequence: classify,
  triage (systematic debugging OR brainstorming), ticket, branch,
  phase-commits, code review with fixes, local verification gauntlet, PR,
  link back. Works with Jira, GitHub Issues, or no tracker at all. Two
  default pause points (before creating the ticket, before creating the PR)
  unless --full-auto is passed; everything else runs autonomously within
  the invocation's scope. Use whenever the founder types /mission-flow -
  with or without flags - and gives a description of a defect / task /
  enhancement plus a tracker reference (or says trackerless).
---

# Mission Flow

The standing playbook for turning a bug / task / enhancement into a
merged-ready PR on any front. Sequence executed in fixed order - never
skip a phase, never reorder, never invent new phases.

## Inputs

- **Description of the work.** What to fix, build, or improve. Required.
- **Tracker reference.** One of:
  - **Jira:** an existing ticket key OR a parent to file a new child under.
  - **GitHub Issues:** an existing issue number OR the tracking issue /
    milestone to file under.
  - **Trackerless:** say so; the flow files the task on the project's
    own board (`_command/portfolio/<front>/[<project>/]tasks/` - see
    `framework/task-board.md`) instead.
- **`--full-auto` (optional flag; alias: `--auto`).** Skips both default
  pause points; the flow runs end-to-end without stopping. Default (no
  flag) = partial autonomy with pauses.
- **`--spend <lean|standard|deep>` (optional).** lean = reviewer cap 1,
  tightest prose; standard (default) = the Phase-5 sizing table as-is;
  deep = the full multi-angle review sweep. **`--deep-review` remains as
  an alias for `--spend deep`.** `--thinking` (default high - Phase 1 is
  root-cause work) and `--verbosity` per the universal grammar (the
  pause points and evidence pastes are discipline at every tier).
- **`with Override: <clauses>` suffix (freeform).** Per-invocation
  overrides the founder types after the flags. Interpret each override as
  a scalpel, not a blanket (see
  `framework/learning-seed/10-scope-is-a-scalpel.md`): it names the
  specific thing to skip or change; everything not named stays. Note in
  the Phase-8 report which clauses were honoured.

If the description is missing, or the tracker situation is unclear, STOP
and ask the founder before Phase 0.

## Phase 0 - Classify the work

Pick one:

- **Bug** (a defect / regression against shipped behaviour): invoke a
  systematic-debugging discipline for Phase 1 (the superpowers plugin
  ships one as `superpowers:systematic-debugging`).
- **Task / Enhancement** (new work, feature, cleanup, migration): invoke a
  brainstorming discipline for Phase 1 (`superpowers:brainstorming`).

Announce the classification before Phase 1. If genuinely ambiguous, ask.

## Phase 1 - Triage (produces: root cause OR agreed approach)

**For bugs (via systematic debugging):** reproduce, gather evidence at
every component boundary, trace to the root cause, paste literal proof.
**NO fixes yet - the Iron Law.**

**For tasks/enhancements (via brainstorming):** align on intent,
requirements, and shape before writing code. Produce a short agreed
approach (what's in scope, what's not, one or two concrete design
choices).

**Blast radius (mapped fronts):** if the project's front has a
`_map.md`, read it. A change touching a surface on any INBOUND edge is a
**breaking-risk change**: name the impacted dependents in the ticket,
and per the cross-front pattern (`framework/task-board.md`) each
affected project gets its own task - or the founder explicitly accepts
the risk, in writing, in the ticket.

Deliverable: a paragraph the Phase-2 ticket description can be built on.

## Phase 2 - Ticket (produces: a tracked unit of work, In Progress)

### Jira path

Determine child issue type by reading the parent - do NOT assume:
`getJiraIssue(parent)` for `issuetype.name` + `hierarchyLevel`.

| Given parent | Child issue type |
| --- | --- |
| **Epic** (hierarchyLevel 1) | **Task** (default) or **Bug** / **Story** if the work-kind clearly fits |
| **Task / Story / Bug** (hierarchyLevel 0) | **Subtask** (hierarchyLevel -1) |
| **Subtask** (hierarchyLevel -1) | Not allowed - re-parent to the subtask's parent |
| **No parent + no existing ticket** | STOP; ask which epic/task/story/bug |

Issue-type heuristic when creating under an Epic: **Bug** = a defect,
evidence-driven; **Task** = a scoped engineering chunk; **Story** = a
user-facing capability from the user's perspective.

Once created: transition to In Progress (read
`getTransitionsForJiraIssue` to discover the transition id - never assume
one), and assign to the founder or the named owner.

### GitHub Issues path

`gh issue create --title "<specific imperative title>" --body "<the full
description>"` with the same title + description floor as Jira; link the
parent tracking issue or milestone in the body; add the founder as
assignee. Move to the In Progress column if a project board exists.

### Trackerless path (the native board)

Create `T-NNN-<slug>.md` from `framework/kit/templates/_task.template.md`
in the project's `tasks/` folder - NNN is that board's next number, state
`ready` (this flow is about to work it), the full description as the body
per the floor below. Regenerate `_board.md`. The task id `T-NNN` is the
`<key>` for branches, commits, and the PR.

### All paths

Draft with:
- **Specific title** - a Conventional-Commits-friendly imperative that
  mirrors the eventual PR title.
- **Comprehensive description** - context / evidence / repro / expected /
  actual / proposed fix / test plan / acceptance criteria / out-of-scope /
  references. No placeholders. (See
  `framework/learning-seed/11-delivery-hygiene.md`.)

### PAUSE POINT 1 - before creating the ticket

Present the drafted title + description to the founder for approval,
UNLESS `--full-auto` was passed. Wait for an explicit "go" before
creating anything.

## Phase 3 - Branch

From the repo root:

```
git status                                # must be clean, or founder-approved to stash
git fetch origin
git checkout -b <type>/<key>-<kebab-slug> origin/<base-branch>
```

- `base-branch` comes from the repo's spoke
  (`_command/portfolio/<front>/[<project>/]<project>.md`) if one exists;
  fallback = `origin/main`. Native-board tickets: fill the task's
  `branch:` field and set state `in-progress` now.
- `<type>` matches the intended commit prefix (`fix`, `feat`, `chore`,
  `refactor`, `docs`, `test`).
- `<key>` is the ticket key / issue number / WL id, lowercased;
  `<kebab-slug>` is a short-hand of the summary. Example:
  `feat/tick-214-forward-invite-params`.

## Phase 4 - Implement (produces: 1-N phase commits, all green in isolation)

**Bugs (TDD-shaped):**
1. `test(<key>): <failing test that pins the root cause>` - the RED test
   that proves the root cause is real.
2. `fix(<key>): <root-cause description>` - the minimal fix that turns it
   green.

**Tasks / enhancements:** one commit per subtask or logical unit:
`feat(<key>): ...`, `refactor(<key>): ...`, `chore(<key>): ...`, or
`docs(<key>): ...` as fits.

Commit rules (all types):
- **Conventional Commits + lowercase key.** Shape:
  `<type>(<key>): <lowercase imperative>`. Preserve canonical case for
  product names and API identifiers; everything else lowercase.
- **NEVER any AI-attribution trailer** (no `Co-Authored-By: <an AI>`, no
  "generated with" lines) or any process leakage - commits and PRs read as
  deliberately engineer-authored.
- **`git add` is scoped to explicit paths.** Never `-A` / `.` -
  accidental secret files, artifact bundles, and agent-internal files are
  the reason.
- Each commit must build green in isolation - no broken intermediate
  states that would fail `git bisect`.
- **Comments are frugal by default** (see
  `framework/learning-seed/11-delivery-hygiene.md`): default NO comment;
  when warranted, ONE tight line, never a docstring block. Context and
  reasoning go in the COMMIT MESSAGE + PR BODY, not the source file.

## Phase 5 - Code review

Run your code-review skill with fixes applied (`/code-review --fix` where
available; absent a review skill, dispatch one focused reviewer sub-agent
per the sizing table below). Announce the fan-out budget BEFORE
dispatching any review agents (state N x model x effort; see
`framework/roles.md`).

**Default sizing (conservative - the founder pays for every reviewer):**

- **Up to ~500 changed lines or a typical bug-fix / small feature:**
  **1 focused reviewer** (correctness + silent-failure combined; the cheap
  tier is fine).
- **500-1500 lines or touches multiple layers:** **2 focused reviewers**
  (correctness OR silent-failure, plus one specialty: cross-file
  consistency, test coverage, or clarity).
- **Over 1500 lines or an architectural / cross-cutting change:** 3-5
  angles.
- **`--deep-review` flag:** the full multi-angle recall sweep. Reserved
  for pre-release / high-stakes changes.

Rationale: on a moderate diff, five reviewers burn tokens without
producing five distinct classes of finding; most overlap. Prefer one agent
that reasons broadly for typical work; save the fan-out for changes with
genuinely different failure modes at different layers.

Verify each candidate finding against the diff before applying. Skip
refuted / out-of-scope / speculative findings - state the reason for each
skip. If fixes land, commit them as
`chore(<key>): code-review polish for <component>` (a single commit for
the review pass).

## Phase 6 - Verify locally (produces: literal green terminal output)

Run the repo's own gauntlet, respecting any Node/tool version pin the repo
declares (check the project's CLAUDE.md, the spoke, and your memory for
pins), with every command composed for THIS machine - shell dialect and
tool availability per `_command/machine.local.md`:

```
[version-manager use <pinned-version>]   # if pinned
<typecheck>                              # tsc, mypy, cargo check, ...
<lint>                                   # eslint, ruff, clippy, ...
<tests>                                  # vitest, pytest, cargo test, ...
[+ manual smoke]                         # if UI / runtime behaviour changed
```

Paste the literal terminal output - evidence before claims. Do NOT claim
green without pasting; do NOT push if anything is red.

## Phase 7 - Push + PR

### Reconcile the ticket + PR to what shipped (conditional)

The ticket was written in Phase 2, before the code existed. If the
implementation diverged - scope added or dropped, an approach or parameter
changed, a deferred behaviour got built - the ticket description is now
stale. Before drafting the PR body: update the ticket (or task file)
so it describes the behaviour actually delivered, and write the PR body to
the final shipped state. Skip only when nothing changed. A ticket or PR
that describes behaviour the code does not have is a defect in the
deliverable, not just stale prose. This applies on every run, including
`--full-auto`.

- `git push -u origin <branch>` - confirm the remote accepted.
- Confirm `gh auth status` is on the account that owns the target repo;
  switch with `gh auth switch --user <account>` if needed (record the
  account mapping in the repo's spoke).
- Draft the PR body mirroring the ticket description shape:
  **Summary / Root cause / Fix / Blast radius / Test plan / Out of
  scope / References.** (Blast radius: the impacted dependents from
  `_map.md`, or "none - no mapped surface touched"; omit the section for
  unmapped fronts.)
  Include the closing keyword your tracker links on
  (`Closes #<n>` for GitHub Issues; the ticket key for Jira integration;
  the WL id for trackerless).
- Title: identical Conventional-Commits shape to the primary commit
  (`<type>(<key>): <lowercase description>`).

### PAUSE POINT 2 - before creating the PR

Present the drafted PR title + body to the founder for approval, UNLESS
`--full-auto` was passed. Wait for an explicit "go" before `gh pr create`.

Once created: do NOT request review, tag reviewers, mark ready, or
auto-merge - those stay with the founder.

## Phase 8 - Link back (produces: two-way traceability)

- Jira: post a comment on the ticket with the PR URL. GitHub Issues: the
  closing keyword already links; add a one-line comment if the issue is a
  long-running tracker. Native board: fill the task's `pr:` field, set
  state `review`, regenerate `_board.md` (state `done` comes when the
  founder merges).
- Report to the founder: key + PR URL + verification snapshot
  (typecheck/lint/test counts) + which manual smoke scenarios are still
  pending on their side.

## Autonomy scope

A single `/mission-flow` invocation grants commit + push + `gh pr create`
authority for THIS ticket only. When the PR is open (or the founder closes
the loop), autonomy expires. Next task = re-ask. This skill is the
explicit carve-out from the standing "no git writes unasked" default; the
carve-out is exactly as wide as one invocation.

## Ordering rules

- Do NOT skip phases; do NOT reorder.
- Do NOT batch phase commits into a single commit "to save time" - commit
  hygiene is the deliverable.
- Do NOT bypass the pause points by inferring approval from a "yes" said
  three messages earlier - approval is per-pause-point, in-moment.
- If any phase's gate fails, STOP and report; do not paper over it.

## Related doctrine

- `framework/learning-seed/10-scope-is-a-scalpel.md` - narrow overrides;
  one flow = one ticket = one branch.
- `framework/learning-seed/11-delivery-hygiene.md` - title + description
  floor; review fan-out sizing; frugal comments.
- `framework/learning-seed/07-evidence-discipline.md` - the bug-path
  Phase 0/1 anchor.
- `framework/roles.md` - reviewer model x effort presets.
