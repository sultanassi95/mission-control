---
name: mission-flow
description: >-
  The standard playbook for turning a bug, task, or enhancement into a
  merged-ready PR on any front. Runs the fixed 8-phase sequence: classify,
  triage (systematic debugging OR brainstorming), ticket, branch,
  phase-commits, code review with fixes, local verification gauntlet, PR,
  link back and capture what the ticket taught about the front. Works with
  Jira, GitHub Issues, or no tracker at all. Runs
  autonomously end to end within the invocation's scope, stopping only on
  critical misalignment or a blocking impediment. Use whenever the founder
  types /mission-flow - with or without flags - and gives a description of
  a defect / task / enhancement plus a tracker reference (or says
  trackerless).
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
- **`--confirm` (optional flag).** Restores two approval gates for this
  invocation: before creating the ticket, and before creating the PR. Off
  by default. Reach for it when the task is genuinely underspecified and
  you want to see the draft before it lands, not as routine practice.
- **`--full-auto` (optional flag; alias: `--auto`).** Accepted and has no
  effect: autonomous execution is the default. Retained so existing
  invocations keep parsing. It does not affect the triggers in "When the
  flow stops", which apply regardless of any flag.
- **`--spend <lean|standard|deep>` (optional).** lean = reviewer cap 1,
  tightest prose; standard (default) = the Phase-5 sizing table as-is;
  deep = the full multi-angle review sweep. **`--deep-review` remains as
  an alias for `--spend deep`.** `--thinking` (default high - Phase 1 is
  root-cause work) and `--verbosity` per the universal grammar (the stop
  triggers and evidence pastes are discipline at every tier).
- **`with Override: <clauses>` suffix (freeform).** Per-invocation
  overrides the founder types after the flags. Interpret each override as
  a scalpel, not a blanket (see
  `framework/learning-seed/10-scope-is-a-scalpel.md`): it names the
  specific thing to skip or change; everything not named stays. Note in
  the Phase-8 report which clauses were honoured.

## When the flow stops

This flow is a CTO-grade orchestrator. While the task is clear it runs from
Phase 0 to Phase 8 without asking permission: it does not present drafts for
sign-off, and it does not check in at phase boundaries. Autonomy is the
default, not a flag. A ticket draft the flow is confident in gets created; a
PR body the flow is confident in gets opened.

It stops for exactly two reasons.

**Critical misalignment** - what is about to ship diverges from what was
asked. STOP, name which of the four it contradicts, present the choice, and
wait. The triggers are exhaustive:

| Trigger | What it contradicts |
|---|---|
| Evidence shows the requested mechanism is unsafe or will not achieve the goal | the prompt |
| A genuine design fork the request does not settle: a data-model or schema choice, a cross-cutting behaviour matrix (Phase 1) | the plan |
| The ticket's acceptance criteria cannot be satisfied as written | the given ticket |
| Scope found mid-flow materially exceeds what was described | the idea for the ticket |
| An irreversible or outward-facing action is required that this invocation does not cover: a merge, a production write, a message to a third party | the prompt |

**A blocking impediment** - the flow cannot proceed at all. STOP and report.
These report an obstacle rather than asking to proceed, so no flag waives
them. The founder may unblock or waive one after it is reported, which is
their call on a reported obstacle, never a gate the flow opens on its own:

| Phase | Impediment |
|---|---|
| 0 | the description is missing, or the tracker situation is unclear |
| 2 | Jira path with no parent and no existing ticket |
| 6 | the local stack genuinely cannot be brought up |
| any | a phase's gate fails |

Anything not on these two lists is not a reason to stop. A phase boundary is
not a check-in, a draft is not a submission, and a decision the request
already settled is not re-opened. `--confirm` adds back the two ticket and PR
gates for one invocation without changing either list.

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

**Real telemetry first (deployed fronts).** When the front runs a deployed
backend with an observability surface - prod logs (CloudWatch / App Runner /
etc.), an error tracker, or metrics - pull the ACTUAL server error and its
frequency + latency signature as PRIMARY evidence before theorizing from
source. The literal error usually names the failing layer in one query and
refutes the plausible-but-wrong guess (a status-guard theory died this way on
AI-1502: the guards were fine; the real cause was `raw-body: request aborted`
500s from instance saturation, visible only in the logs + metrics). Confirm
read access up front (it may need an interactive cloud login the founder runs);
keep any confidential payloads in the session scratch, never in `_command/`.

**For tasks/enhancements (via brainstorming):** align on intent,
requirements, and shape before writing code. Produce a short agreed
approach (what's in scope, what's not, one or two concrete design
choices).

**Cross-cutting behaviour change (audit before you proceed).** When a ticket
expands from a point fix into a change across a MATRIX - every status x role, a
whole permission surface, controls that must match state - the design fork is
not one choice, it is the entire target matrix. That is critical misalignment
with the plan: stop and settle it. Never carry a fix forward autonomously when
its correct end-state is still an undecided product decision. First AUDIT the
actual current behaviour from real evidence (read the gating code; drive the
running UI), present a current-state-vs-target matrix, and get the founder's
per-cell sign-off. THEN implement the agreed matrix. (Lived: a narrow "closed
cases are read-only" fix the founder expanded into a full controls-leak pass
across every case status x viewer role.)

**Production-execution reality (decide HOW it runs in prod, at ticket time).**
Before settling the approach, establish how the change will actually execute in
the DEPLOYED environment, not just locally - the runtime path and its
constraints. A solution that works on the laptop but cannot run in prod is a
planning defect, and the cheapest place to catch it is here, not in review or
after merge. If the work touches prod data, infra, a job, or anything beyond a
pure code change, name the execution mechanism in the ticket and design to it:
- **Reachability:** is the prod datastore VPC-private (reachable only in-VPC),
  behind a bastion, or public? A one-off prod data change on a VPC-private RDS
  is a data MIGRATION run by the migrate-on-deploy mechanism, never a laptop
  `npm run` script that has no route to it.
- **Where it runs:** a job runs where the scheduler/worker runs; a migration
  runs via the deploy path; a backfill uses the project's established in-VPC
  path. Match the design to that, not to local convenience.
- **What exists:** the secrets, roles, network, and deploy hooks the change
  will rely on. If you don't know the deployed topology, read the infra
  (`infra/`, the spoke, machine profile) BEFORE choosing the design.
The failure this prevents: shipping a prod backfill as an unrunnable laptop
script because the ticket never asked "how does this reach prod?" (AI-1508).

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

The task id is `T-NNN` at that board's next number, and it is the `<key>`
for branches, commits, and the PR. State `ready` (this flow is about to
work it), the full description as the body per the floor below. Regenerate
`_board.md`. The ticket folder itself is created by the step in "All
paths" below, which applies here too.

### All paths

**Create the local ticket folder. Every path, every tracker.** From
`framework/kit/templates/_task.template.md`, create

```
_command/portfolio/<front>/[<project>/]tasks/<ID>-<slug>/ticket.md
```

where `<ID>` is the tracker key (`AI-1639`, `#214`) or the native task id
(`T-NNN`). See `framework/task-board.md` for the folder layout.

With an external tracker, replace Context / Acceptance criteria /
Out-of-scope with the one-line pointer `> Tracked in: JIRA <KEY> - <url>`
and **keep the Definition of Done checklist**. The remote issue is where
the work is tracked; this folder is where the work is measured, and the
checklist is the only thing that makes the integration-truth floor
enforceable per ticket rather than remembered. A ticket folder without
`ticket.md` leaves that floor unenforced for that ticket, which is the
common way a front ends up with tasks and no checklist at all.

Draft with:
- **Specific title** - a Conventional-Commits-friendly imperative that
  mirrors the eventual PR title.
- **Comprehensive description** - context / evidence / repro / expected /
  actual / proposed fix / test plan / acceptance criteria / out-of-scope /
  references, plus a **rollout/execution mechanism** whenever the work runs in
  or against prod (how it deploys and runs there - migration, job, backfill
  path - per the Phase-1 production-execution check). No placeholders. (See
  `framework/learning-seed/11-delivery-hygiene.md`.)

Create it. Under `--confirm`, present the drafted title and description
first and wait for an explicit go.

## Phase 3 - Branch

From the repo root:

```
git status                                # must be clean, or founder-approved to stash
git fetch origin
git switch -c <type>/<key>-<kebab-slug> --no-track origin/<base-branch>
git rev-parse --abbrev-ref '@{upstream}'  # must NOT name the base branch
```

- **`--no-track` is not optional.** `git checkout -b <name> origin/<base>`
  sets the new branch's upstream to BASE, so every later `git push` from it
  aims at the base branch. Where the base also triggers a deploy, that push
  is an unreviewed production release. The `rev-parse` above must either
  error with "no upstream configured" or name the new branch; if it prints
  the base branch, re-point it before doing any work. This is a correction
  the flow makes on its own and notes in the Phase-8 report, not a stop; if
  it cannot be re-pointed, that is a failed gate. Say out loud which branch
  the upstream names before leaving this phase.
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
```

Paste the literal terminal output - evidence before claims. Do NOT claim
green without pasting; do NOT push if anything is red.

**Integration + e2e QA - REQUIRED when API or UI behaviour changed, and never
skipped for autonomy.** The unit/typecheck/lint gauntlet is the FLOOR, never
the ceiling, for a user-facing change (hard rules 1 + 5). Unit-green with a
mocked boundary is not "verified". Stand up the real stack locally and:
- **Backend (over the wire):** exercise the actual changed endpoints against
  the running api + db with `curl`/httpie - the happy path AND at least one
  failure/edge case the change targets. Paste the literal status + body. A
  contract proven only by a mocked unit test is not proven (hard rule 2).
- **Full flow (browser / Playwright):** drive the real UI through the
  user-visible path the ticket describes, INCLUDING the failure path the fix
  targets. Inject the failure client-side (a `window.fetch` override returning
  the exact status + body) - it reaches error states the UI itself gates
  against reaching, and lets you assert BOTH the friendly message AND the
  absence of any raw server detail on the page. Before asserting anything
  role-gated, assert the acting identity first (the dev-user switcher /
  logged-in user - a wrong-role default reads as a bug). Prefer seeding an
  exact precondition via the API/DB over clicking the UI into it.
  Paste/screenshot the outcome and any relevant server log line.

If the local stack genuinely cannot be brought up, that is a STOP-and-report
blocker (the founder decides to unblock or waive) - never a silent skip, and
never inferred-done from unit green. This is the Phase-6 manual smoke made a
firm gate; it was under-specified and got skipped once (AI-1502).

**The local stack is shared.** It is the founder's stack too, and it is often
running while they test. Do NOT switch branches or edit watched files while the
founder is live-testing without flagging it: a `--watch` dev server restarts
under the change and every in-flight request fails with a network-level error
that looks like a product bug. When a founder reports a network-level failure -
a raw "Failed to fetch", not a 4xx/5xx - first check the server's own
restart/health log and reproduce the endpoint over the wire before theorizing
about the client path; then separate the (often environmental) trigger from any
real bug it surfaced.

## Phase 7 - Push + PR

### Reconcile the ticket + PR to what shipped (conditional)

The ticket was written in Phase 2, before the code existed. If the
implementation diverged - scope added or dropped, an approach or parameter
changed, a deferred behaviour got built - the ticket description is now
stale. Before drafting the PR body: update the ticket (or task file)
so it describes the behaviour actually delivered, and write the PR body to
the final shipped state. Skip only when nothing changed. A ticket or PR
that describes behaviour the code does not have is a defect in the
deliverable, not just stale prose. This applies on every run.

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

### Settle the Definition of Done checklist first

Before drafting the PR, open the ticket's `ticket.md` and resolve every line
of its Definition of Done checklist. Each line is either ticked with the
evidence that satisfies it (the literal output, the query, the request and
response - Phase 6 produced most of it), or marked `N/A` with the reason it
does not apply. A line left blank is an open ticket, not a finished one, and
`Real path, end to end` in particular stays unticked while any `[STUB]`
remains.

This is the step that makes the checklist enforceable instead of decorative.
Writing the file at Phase 2 and never reading it back leaves the whole floor
resting on recall.

### Open the PR

`gh pr create` with the drafted title and body. Under `--confirm`, present
them first and wait for an explicit go.

Once created: do NOT request review, tag reviewers, mark ready, or
auto-merge - those stay with the founder. Merging is outward-facing and
outside every invocation's scope.

## Phase 8 - Link back + capture (produces: two-way traceability, current front context)

### Link back

- Jira: post a comment on the ticket with the PR URL. GitHub Issues: the
  closing keyword already links; add a one-line comment if the issue is a
  long-running tracker. Native board: fill the task's `pr:` field, set
  state `review`, regenerate `_board.md` (state `done` comes when the
  founder merges).

### Update the front's context

A ticket teaches things about the front it ran on: how the project deploys,
which path reaches its data, which branch is a deploy trigger, which
constraint bit this time. None of that survives unless it lands where the
next session reads it before touching the project.

Choose ONE destination per fact, by what the fact binds:

| The fact binds | Destination |
|---|---|
| every project on the front | the hub, `_command/portfolio/<front>/_front.md` |
| this repo only | the spoke, `_command/portfolio/<front>/[<project>/]<project>.md`, in `gotchas` or "How to work in it" |

**The bar is structural, not eventful.** A fact belongs here only if it
changes when the PROJECT's shape changes, never when you merely do work -
the reference-versus-state split in `framework/continuity-stack.md`. "The
RDS is VPC-private, so a data change ships as a migration" is structural.
"AI-1628 shipped on Tuesday" is state and belongs in `progress.md`. If a
future session would not act differently for knowing it, do not write it.

This step is the reference layer only. `progress.md` still takes state at
`/debrief`, and transferable method still goes to the learning log at
`/learn-from-session`. One fact, one layer.

Read the destination before writing. Where an entry already covers the
ground, sharpen that entry rather than appending a near-duplicate.

**Write nothing when the ticket taught nothing structural, and say so in the
report.** Most tickets teach nothing structural, and an invented entry is
worse than an empty one because it dilutes the entries that matter.

**Never write into the front's own repo under `fronts/`.** A defect in a
front's code is a ticket on that front. This step writes only to the
management repo.

Confidential fronts stay pointers-only: nothing employer-owned enters
`_command/` beyond what that front's IP-boundary rules already permit.

### Report

- Report to the founder: key + PR URL + verification snapshot
  (typecheck/lint/test counts) + which manual smoke scenarios are still
  pending on their side + what was written to front context, or that
  nothing structural was learned.

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
- Do NOT invent a stop. The two lists in "When the flow stops" are
  exhaustive; a phase boundary is not a check-in.
- Under `--confirm`, do NOT infer approval from a "yes" said three messages
  earlier - approval is per-gate, in-moment.
- If any phase's gate fails, STOP and report; do not paper over it.

## Related doctrine

- `framework/learning-seed/10-scope-is-a-scalpel.md` - narrow overrides;
  one flow = one ticket = one branch.
- `framework/learning-seed/11-delivery-hygiene.md` - title + description
  floor; review fan-out sizing; frugal comments.
- `framework/learning-seed/07-evidence-discipline.md` - the bug-path
  Phase 0/1 anchor.
- `framework/roles.md` - reviewer model x effort presets.
