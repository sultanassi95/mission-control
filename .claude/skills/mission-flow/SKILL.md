---
name: mission-flow
description: >-
  The standard playbook for turning a bug, task, or enhancement into a
  merged-ready PR on any front. Runs the fixed 8-phase sequence: classify,
  investigate (systematic debugging OR brainstorming), ticket, branch,
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
- **`--parent <key>` (optional).** Files the ticket directly under the named
  epic or parent task. Marginally-small bugs and tasks that belong to a larger
  effort take this route rather than getting an orphan ticket; the Jira path
  derives the child TYPE from this parent exactly as it would from a given one.
- **`--confirm` (optional flag).** Restores two approval gates for this
  invocation: before creating the ticket, and before creating the PR. Off
  by default. Reach for it when the task is genuinely underspecified and
  you want to see the draft before it lands, not as routine practice.
- **`--full-auto` (optional flag; alias: `--auto`).** Accepted and has no
  effect: autonomous execution is the default. Retained so existing
  invocations keep parsing. It does not affect the triggers in "When the
  flow stops", which apply regardless of any flag.
- **`--inline` (optional flag).** Runs every phase in one context, the way this
  flow worked before it delegated. Reach for it to compare cost on the same
  ticket, or when a ticket is too small for a dispatch to pay for itself. It
  changes WHO does the work and nothing else: the stop triggers, the Phase-5
  acceptance-criteria check and every evidence requirement are identical either
  way.
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

## How this flow runs - orchestration, not execution

The orchestrator holds the plan and the integrated picture. It delegates the
phases that read and write in bulk, and keeps the ones where delegating would
break a rule. `framework/CONSTITUTION.md` section 5 is the model; this table is
where this flow complies with it instead of describing it.

| Phase | Disposition | Routing (`roles.md`) | Why |
|---|---|---|---|
| 0 classify | inline | - | one decision, reads nothing |
| 1 investigate | **dispatched** | mid · high (bug) / mid · medium (task) | the largest reading surface in the flow |
| 2 ticket | inline | - | the ticket is the plan, and holding the plan is what the orchestrator is for |
| 3 branch | **never delegated** | - | a git write, and hard rule 8's upstream check lives here |
| 4 implement | **dispatched**, one per logical unit | mid · high; frontier for load-bearing logic | mechanical once the approach is settled |
| 5 review | **dispatched** | per Phase 5's own sizing ladder | already the pattern; that ladder is the single source for reviewer count and tier |
| 6 verify | **hybrid** | mid · low for the run | an agent may run the gauntlet; the orchestrator runs the terminal assertion itself |
| 7 push + PR | **never delegated** | - | outward-facing, and the autonomy carve-out is the orchestrator's alone |
| 8 capture | inline | - | judgment about structural versus state, on a small input |

Escalate a row on evidence that the cheaper tier actually failed, never on
anxiety, and never above the `CONSTITUTION.local.md` section 2 ceilings. Under
`--spend lean` each dispatched row steps one tier down.

Each phase also states its own disposition where that phase is read, because this
document is consulted at a phase rather than start to finish. **This table is
authoritative** if the two ever disagree.

Every disposition in this document, here and at the phases, reads "unless
`--inline`". That flag collapses all of them to inline for one invocation, so a
reader who enters at a phase heading is not following an instruction the
invocation has already overridden.

**Three things are never delegated and never summarised.** Each is a place where
a relayed claim would quietly replace evidence:

- **The diff.** A DISPATCHED reviewer receives a diff file the orchestrator
  generated into the session scratchpad (`git diff <base>..HEAD > <path>`), so
  the agent cannot scope its own input. A description of a change is not the
  change, and the difference is where real defects hide. Phase 5's other path,
  the in-session code-review skill, derives its own range against the live tree:
  that is allowed and often right, but the cannot-scope-its-own-input protection
  does not apply to it. Pick knowingly rather than assuming both paths carry the
  same guarantees.
- **The terminal assertion.** Phase 6 may delegate running the gauntlet, but the
  orchestrator itself runs the one command that proves the artifact the user
  consumes, and pastes that output. Evidence-before-claims does not survive a
  relay, and `CONSTITUTION.local.md` rule 2 puts the round trip on the
  orchestrator by name. Phase 6's integration and e2e evidence may be produced by
  a dispatch, but it lands as ARTIFACTS the record points at - the literal status
  and body, the screenshot, the server log line - never as an agent's word that a
  flow passed. "The e2e suite is green" from a sub-agent is inferred-done, which
  Phase 6 already refuses.
- **The acceptance-criteria verdicts.** Phase 5's criteria check stays inline. A
  sub-agent cannot close a ticket, so it cannot be the thing that says a ticket
  is satisfied.

### The record protocol

Every dispatch returns exactly one record, written to

    <ticket-folder>/records/NN-<scope>-<agent>.md

in the format `framework/kit/_record-schema.md` specifies, filename included.
**The orchestrator reads the record; it does not read the work.** That is the
entire mechanism by which its context stays small, and skipping it turns a
dispatch into a detour that costs more than doing the work inline.

**Phase 1 dispatches before that folder exists.** The ticket folder is created in
Phase 2, and on the trackerless path the `<ID>` in its name is not even assigned
until then, so a Phase-1 record has nowhere to land. It goes to the session
scratchpad, which is where temp artifacts belong anyway, and Phase 2 moves it
into `records/` as it creates the folder. Any phase dispatched before Phase 2
follows the same route.

The rules that make a record safe to integrate from live in
`_record-schema.md`, because they bind every skill that dispatches and not just
this one: point rather than characterise, cap at 150 lines, minimum context in,
and re-decompose past about two prior records. Read them there; this flow adds
nothing to them.

**Who writes the file.** An agent type with no `Write` tool cannot author its own
record, and those are the RIGHT types for Phase 1 and Phase 5 under the safety
table below. So the normal path is that the agent returns the record as its final
message and the ORCHESTRATOR persists it. That is not a workaround; it is what
keeping an investigating agent write-free costs, and it is cheap.

**A record over cap, or absent, stops the phase.** Check the line count before
integrating anything. The remedy is re-decomposition, never a bigger cap: an
over-cap record means the brief was scoped too wide, and accepting it hands the
orchestrator the second context this whole arrangement exists to avoid. Note the
honest limit - nothing mechanical enforces the cap, so it holds only while the
orchestrator actually checks.

**A dispatch that returns `status: failed` also stops the phase.** Read the
reason, then choose: re-dispatch with an agent type that has the missing
capability, re-decompose, or do it inline. A failed dispatch costs a full round
trip and returns no work, so it is a decision point, not a gap to route around.

The record is also the audit trail, so it carries the model and effort it ran at
and the tokens it used. That is what lets `/spend` tally a flow afterwards
instead of estimating it.

### Dispatch safety - the least-capable agent that can do the job

A prose constraint on a sub-agent is not a control: on 2026-07-24 an agent
briefed READ-ONLY ran `git stash -u` in the working tree
(`CONSTITUTION.local.md` section 2). So pick the weakest tool set that can still
do the phase, and remove the need rather than restating the ban.

| The phase needs to | Dispatch it with |
|---|---|
| read and map only | an agent type carrying no `Bash` at all |
| investigate, running commands | an agent type with no `Edit` or `Write`. `Bash` remains, so this reduces the blast radius rather than removing it |
| implement | its own git worktree on its own branch, so the main tree is not reachable |
| review | a pre-generated diff file and the paths, never a live working tree |

**The outbound gap is open, and naming it is the only honest thing to do here.**
A dispatched agent inherits the parent's git credentials, so isolating its tree
does not isolate the remote. `framework/roles.md` carries that fact and the probe
behind it; this table does not restate it, because two independently worded copies
of one constraint drift apart.

The consequence for THIS flow: an implement agent that runs `git push` is not
contained by its worktree, and pushing to a base branch that deploys is an
unreviewed release (hard rule 8). So the outbound risk is covered by the
enumerated ban below, which is prose, plus verification after the fact. That is
weaker than every other row in this table and must not be written up as though it
were not. An implement dispatch is the one place in this flow where a rule is
doing work a control should be doing.

**Every shell-capable dispatch also carries the enumerated ban**, naming the
commands rather than gesturing at care. On git: no `stash`, `checkout`, `reset`,
`restore`, `clean`, `switch`, `add`, `commit`, `push`. An implement dispatch is
the one exception, and only for `add` and `commit` inside its own worktree,
because that is the phase's job.

A Phase-6 dispatch needs its own clause, because its destructive move is not a
git command: **do not tear down the local stack.** No `docker compose down`, no
`pkill`, no killing a dev server or a database container. The founder is often
live-testing against that stack, so a teardown between phases reads as a product
outage; verification brings things up and leaves them up.

All of it is prose, and prose is not a control - it rides ALONGSIDE the
structural controls above, never instead of them
(`CONSTITUTION.local.md` section 2 requires both).

**Verify every working tree after any phase that dispatched a shell-capable
agent.** That is detection rather than prevention, and it is the last line.

**The identity header.** Sub-agents inherit neither `CONSTITUTION.md` nor the
project `CLAUDE.md`, so every dispatch leads with a header: front, repo, trust,
path, current branch, the git rule, the IO contract, and one platform line from
`_command/machine.local.md`. Compose it ONCE per invocation from the spoke and
reuse it for every dispatch in that flow - assembling it per dispatch is how a
field ends up blank. A spoke with blank required fields is not dispatch-ready:
the flow stops there rather than dispatching an agent that is acting as nobody.

### Sizing, and the tally at the end

State the sizing before the first dispatch of a phase, in the orchestrator's own
output: `N agents x model x effort`, within the `CONSTITUTION.local.md` section 2
ceilings and the `framework/roles.md` presets. Not in the record - the record is
authored by the agent and does not exist yet. Inside this flow the fan-out is
already authorised, so this is a statement rather than a request.

**The orchestrator tallies the tokens, because it is the only one that can see
them.** A dispatched agent cannot observe its own consumption; the harness
reports usage back to the parent when it reports at all. So the orchestrator
notes what came back per dispatch and closes Phase 8 with the tally. Where the
harness surfaces nothing, the tally says so and stops there: never invent a
number (`/spend` step 1, `CONSTITUTION.local.md` rule 6). The record carries the
model and effort it ran at, which it does know.

Delegation is meant to cut what the orchestrator spends reprocessing a long
context on every turn; whether it cuts the TOTAL across all agents is an
empirical question, and a flow that cannot say what it spent cannot answer it.
Compare against an `--inline` run on a comparable ticket, never against an
estimate.

## Phase 0 - Classify the work

Classify with the same five-kind vocabulary `/triage` uses at intake - one
classification language from inbox to PR. Pick one:

- **Bug** (a defect / regression against shipped behaviour): invoke a
  systematic-debugging discipline for Phase 1 (the superpowers plugin
  ships one as `superpowers:systematic-debugging`).
- **Task / Enhancement** (new work, feature, cleanup, migration): invoke a
  brainstorming discipline for Phase 1 (`superpowers:brainstorming`).
- **Decision-for-founder** (a product or scope decision wearing a task's
  clothes): EXIT the flow - present the decision with its options and
  evidence, and build nothing until it is made. A decision never silently
  becomes a task.
- **Info-only** (nothing to build - a fact, a status, a pointer): EXIT the
  flow - route the fact to the layer that owns it (progress log, hub, spoke;
  `framework/continuity-stack.md`) and say where it went.

The two exits are verdicts, not failures: naming why an item is not
flow-shaped is this phase doing its job. Epic-sized work gains its own exit
when the epic playbook exists (MC-017); until then, materially-multi-ticket
scope found here is the "scope exceeds the description" stop.

Announce the classification WITH its one-line rationale - "defect against
shipped behaviour: <what shipped, what broke>" or "new work: <what does not
exist yet>" - before Phase 1, so a misroute is contestable before the
investigation spends anything. If genuinely ambiguous, ask.

**Reclassification.** Phase-1 evidence that flips the class (a "task" that is
really a defect; a "bug" that is really an undecided product behaviour)
re-enters this phase: announce the new classification with its rationale and
continue on the SAME ticket - one issue = one ticket, however many
classifications it takes (`_command/learning/04`). The Phase-1 discipline
switches with it; work already done remains evidence.

## Phase 1 - Investigate (produces: root cause OR agreed approach)

**Dispatched.** One investigator, whose record is what Phase 2 builds the ticket
from. Split into two only when a ticket has genuinely independent sub-questions.

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

### First: is the issue already tracked? (every path)

Search the tracker for an existing ticket owning this ISSUE before creating
anything - JQL / `gh issue list --search` on the failing surface's terms, plus
the project's own board. A hit means EXTEND that ticket and its open PR: a
change of approach is a continuation of the same unit of work, never a new
ticket (`_command/learning/04` - a ticket filed as attempt #2 at an
already-tracked issue was rejected in plain words). New tickets are for new,
distinct work.

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

- **Verifiable criteria** - each acceptance criterion names its evidence type
  as it is written: a test, a command output, a `file:line`, or
  `runtime - Phase 6`. Phase 5's per-criterion verdicts are mechanical only
  when the criterion said up front what satisfies it; "works correctly" can
  never earn a `met`.
- **The terminal assertion** - one line naming the command that proves the
  artifact the user consumes. Declared here, executed at Phase 6; a better one
  discovered later is a logged deviation, never a silent swap.
- **Parent output claims** - when the parent declares an output list (an epic
  implementing a plan phase), name which of those outputs THIS ticket claims.
  A phase split across tickets silently drops whatever no ticket claimed
  (`_command/learning/17`); the claim line makes the remainder a visible diff.

Create it. Under `--confirm`, present the drafted title and description
first and wait for an explicit go.

## Phase 3 - Branch

**Never delegated.** This phase writes to git, and the upstream check below is
hard rule 8.

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

**Dispatched, one agent per logical unit, each in its own worktree on its own
branch** off the ticket branch, whether one unit runs or several. Uniform on
purpose: git refuses to check out one branch in two worktrees
(`fatal: ... is already used by worktree at ...`), so per-unit branches are what
makes more than one agent possible at all, and a single unit taking the same
route means the common case is not the unprotected one.

The orchestrator merges each unit's branch back into the ticket branch as its
record arrives - fast-forward when one unit ran - because Phase 5's diff and
Phase 7's push both read the ticket branch, and a commit that never lands there
is a commit nothing reviews. The commit rules below bind the agent, and the
orchestrator verifies every tree afterwards.

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

Two checks gate this phase, and `--auto` waives neither: the ticket's
acceptance criteria are verified before any reviewer is dispatched, and the
diff gets a distinct engineering-principles pass alongside the correctness
review.

### Verify the acceptance criteria first

Reviewers read a diff for quality. Nothing else in this flow asks whether the
diff does what the ticket asked, so a change can be correct, well tested, and
still answer the wrong question. Discovering that after paying for review is
the expensive ordering.

The orchestrator runs this itself, before any dispatch: it already holds both
the ticket and the diff, and a sub-agent cannot close a ticket in any case
(`CONSTITUTION.local.md` rule 2). Escalate to one spec-compliance reviewer (mid
tier · medium, `framework/roles.md`) only when the diff exceeds ~1500 lines or
the ticket carries more than ~8 criteria.

Report every criterion on its own line, with exactly one verdict:

| Verdict | What it requires |
|---|---|
| **met** | the literal evidence: `file:line`, the test that covers it, or the command output |
| **not met** | what is missing. This stops the phase |
| **not verifiable here** | why, plus the Phase 6 command that will settle it |

`not verifiable here` is the verdict that rots if left loose, so it is bounded:
legitimate ONLY for a criterion that needs runtime evidence Phase 6 produces.
Anything settleable by reading the diff is settled now, and a criterion marked
`met` with no evidence beside it is not met. Every deferred criterion is
carried into the Phase 6 run list and ticked at the Phase 7 Definition of Done
settle, so it cannot evaporate on the way to the PR.

A `not met` verdict is not a new kind of stop. It is the "acceptance criteria
cannot be satisfied as written" trigger in "When the flow stops", found earlier
and cheaper: name the criterion, present the choice, and wait. Do NOT dispatch
reviewers at a diff that does not satisfy its own ticket, and do not waive this
gate for `--auto` or `--spend lean`.

### Size the batch before dispatching it

State the fan-out for the whole phase in one line in the record BEFORE the
first dispatch, covering the correctness reviewers and the principles pass
together: `N agents x model x effort ~ tokens`, within the
`CONSTITUTION.local.md` section 2 ceilings and the presets in
`framework/roles.md`. The criteria check above adds no agents at its default,
because it runs inline; say so rather than leaving it uncounted.

### Dispatch the reviewers

Run your code-review skill with fixes applied (`/code-review --fix` where
available; absent a review skill, dispatch one focused reviewer sub-agent
per the sizing table below).

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

### The engineering-principles pass

Correctness review catches defects. It does not catch a change that duplicates
logic the repo already has, or one that puts a responsibility in the wrong
place, so those pass review today because nobody is asked to look for them.
This is a distinct pass (Quality review, `framework/roles.md`) in the same
batch as the correctness reviewers, never an extra paragraph bolted onto one
of their prompts.

It reports per principle considered - single responsibility, the open-closed,
substitution, interface-segregation and dependency-inversion principles where
they bear on the change, DRY, and responsibility placement - with one of three
verdicts:

- **violated**, at `file:line`, naming the concrete counterpart: the existing
  code being duplicated, or the module that should own the behaviour.
- **applies, clean.**
- **not applicable**, and why.

A violation with no named counterpart is not reportable, and `not applicable`
is the honest answer for most small diffs. A generic assertion that the change
"follows SOLID" is not a finding, and neither is a violation manufactured to
fill the report; both are the vacuous-assertion failure mode
(`CONSTITUTION.local.md` rule 5) in a reviewer's clothing.

### Apply the findings

Verify each candidate finding against the diff before applying. Skip
refuted / out-of-scope / speculative findings - state the reason for each
skip. If fixes land, commit them as
`chore(<key>): code-review polish for <component>` (a single commit for
the review pass).

## Phase 6 - Verify locally (produces: literal green terminal output)

**Hybrid.** An agent may run the gauntlet and return its literal output; the
orchestrator runs the terminal assertion itself. See "How this flow runs".

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

**Never delegated.** Pushing and opening a PR are outward-facing, and the
autonomy carve-out belongs to the orchestrator alone.

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
| every project on the front | the hub, `_command/portfolio/<front>/_front.md`, under `## Cross-repo constraints` or a new `## Structural notes`. **Never `## Status`** - `/debrief` owns it and caps it at 5 lines |
| this repo only | the spoke, `_command/portfolio/<front>/[<project>/]<project>.md`, in `gotchas` or "How to work in it" |

**The bar is structural, not eventful.** A fact belongs here only if it
changes when the PROJECT's shape changes, never when you merely do work -
the reference-versus-state split in `framework/continuity-stack.md`. "The
RDS is VPC-private, so a data change ships as a migration" is structural.
"AI-1628 shipped on Tuesday" is state and belongs in `progress.md`. If a
future session would not act differently for knowing it, do not write it.

Three tie-breakers for the cases the bar alone does not settle:

- **A value is never structural; the mechanism that produces it is.** A
  rotated credential, a current endpoint, a token: never written here, and
  a secret never enters `_command/` at all. "Credentials come from the
  deploy role, not the developer's shell" is the structural half, and it is
  the half that keeps being true.
- **A defect somebody will fix is state; a defect nobody owns is
  structural.** "CI skips lint on forked PRs" belongs here only when no
  ticket owns fixing it. If a ticket owns it, the ticket is the record.
- **Generic doctrine already carried by this skill or `framework/` is not
  re-written per front.** Check before writing: a front-specific echo of a
  rule that already applies everywhere adds noise and rots separately.

This step is the reference layer only. `progress.md` still takes state at
`/debrief`, and transferable method still goes to the learning log at
`/learn-from-session`. One fact, one layer.

Read the destination before writing. Where an entry already covers the
ground, sharpen that entry rather than appending a near-duplicate. Also
check `_command/learning/` for a pending entry whose `Destination` names
this front's context: if one exists, that fact already has an owner in
`/promote-learnings` and writing it here too produces the duplicate both
skills are trying to avoid.

**Write nothing when the ticket taught nothing structural, and say so in the
report.** Most tickets teach nothing structural, and an invented entry is
worse than an empty one because it dilutes the entries that matter. The
close call, not the easy one: "this endpoint was slower than expected under
the seed data" feels like a finding and is not structural. It is one
observation about one dataset, it will not still be true after the next
index or the next seed, and no future session should change its approach for
it. That is a no. If the profiling instead established that the table has no
index on the column every read filters by, that is a yes.

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
- End with the per-phase tally from the records: which phase ran at which model
  and effort, and what it spent. One line per dispatch, and say `--inline` when
  the flow did not dispatch at all.

## Autonomy scope

A single `/mission-flow` invocation grants commit + push + `gh pr create`
authority for THIS ticket only. A dispatched agent inherits a strict subset: it
may commit inside its own worktree and nothing else. Push and PR stay with the
orchestrator, which is why an implement dispatch carries no usable git
credentials rather than a note asking it to refrain. When the PR is open (or the founder closes
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
