---
id: T-<NNN>
title: <specific imperative title - mirrors the eventual PR title>
state: backlog
size: <S|M|L>
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
branch:
pr:
parent:
---

<!--
This file instantiates as tasks/<ID>-<slug>/ticket.md - the ticket is a FOLDER, and
everything the ticket owns lives in it. None of it is tracked: _command/ is
gitignored in full, this record included. Scripts stay discoverable through the
project's scripts.md record rather than through git history. Same for every front,
whatever its trust or tracker. See framework/task-board.md.

External tracker (tracker: jira | github)? Delete Context/Acceptance/Out-of-scope
below, replace with a one-line pointer:  > Tracked in: JIRA <KEY> - <url>
and KEEP the Definition of Done checklist - the folder is the local artifact
home + the enforcement gate, never a mirror of the external ticket.
-->

## Context

<why this exists - the observation, the ask, or the evidence that filed it>

## Acceptance criteria

- <verifiable outcome> - evidence: <test | command output | file:line | runtime - Phase 6>

**Terminal assertion:** <the one command that proves the artifact the user
consumes - declared at ticket time, executed at Phase 6>

## Definition of Done (the integration-truth floor)

Each line satisfied with evidence, or marked N/A with a reason, before `done`.
An instance may bind a sharper version in `_command/CONSTITUTION.local.md`.

- [ ] **Real path, end to end** - no stub/mock on the critical path; every
  external boundary got one live integration pass against a non-production
  instance or a downloaded copy, never a production system; any stub is
  `[STUB]` and the ticket stays open.
- [ ] **Whole vertical slice** - both sides wired and verified against the
  acceptance criteria, proven by >=1 test exercising the actual serialized
  request across the boundary (not two mocks of the same idea) + request
  validation (a contract violation is a clean 4xx, not a 500).
- [ ] **Production-execution reality** - established at design time how this
  runs in the DEPLOYED environment: reachability, where jobs and migrations
  execute, the secrets/roles/deploy hooks it relies on. A bulk or one-off data
  change runs inside the deployed system (a migration the deploy path executes,
  an endpoint the service exposes, a job the scheduler runs), never a script run
  from a laptop. Works-locally-but-cannot-run-in-prod is a planning defect.
- [ ] **Terminal artifact verified** - queried the thing the user consumes,
  broken down by the unit that can partially fail; a green checkpoint is a
  promise, not a receipt.
- [ ] **Designed for scale** - bulk semantics, idempotency, backpressure
  considered; N rows is one bulk call plus a queue, never N requests.
- [ ] **Tested at the altitude of the risk** - user-critical flows have e2e; the
  plan named the altitude and why. At least one new assertion was proven able
  to fail: break what it guards, see red, restore. A threshold equal to the
  current value, a mock missing the key the code reaches for, or an expectation
  computed from config that is empty at run time are all green and vacuous.
- [ ] **No guess worn as a finding** - root cause shown with literal evidence;
  assumptions labelled; the outward artifacts (commit, PR, tracker) read as an
  engineer authored them, zero process vocabulary.

## Working files

All of them beside this file, in `tasks/<ID>-<slug>/`. None of them is tracked,
because `_command/` is gitignored in full.

- `scripts/` - repro / verify / one-off scripts. Record each one in the project's
  `scripts.md`, with why it exists.
- `samples/` - inputs, fixtures, datasets.
- `artifacts/` - generated outputs, exports, dumps, logs.
- `screenshots/` - QA / verification images.

## Evidence log

<the literal verification output - commands run and what they printed - pasted,
not summarized. For bugs: what was observed, where, reproducible or not.>

## Out of scope

<what this task deliberately does NOT cover>
