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
everything the ticket owns lives in it. This file and scripts/ are the two names
worth versioning; anything else you put beside them is payload and is gitignored,
whatever you call it. Same for every front, whatever its trust or tracker. Note
that inside _command/ the whole instance is local, this record included. See
framework/task-board.md.

External tracker (tracker: jira | github)? Delete Context/Acceptance/Out-of-scope
below, replace with a one-line pointer:  > Tracked in: JIRA <KEY> - <url>
and KEEP the Definition of Done checklist - the folder is the local artifact
home + the enforcement gate, never a mirror of the external ticket.
-->

## Context

<why this exists - the observation, the ask, or the evidence that filed it>

## Acceptance criteria

- <verifiable outcome, one per line>

## Definition of Done (the integration-truth floor)

Each line satisfied with evidence, or marked N/A with a reason, before `done`.
An instance may bind a sharper version in `_command/CONSTITUTION.local.md`.

- [ ] **Real path, end to end** - no stub/mock on the critical path; every
  external boundary got one live integration pass; any stub is `[STUB]` and the
  ticket stays open.
- [ ] **Whole vertical slice** - both sides wired and verified against the
  acceptance criteria, proven by >=1 test exercising the actual serialized
  request across the boundary (not two mocks of the same idea) + request
  validation (a contract violation is a clean 4xx, not a 500).
- [ ] **Terminal artifact verified** - queried the thing the user consumes,
  broken down by the unit that can partially fail; a green checkpoint is a
  promise, not a receipt.
- [ ] **Designed for scale** - bulk semantics, idempotency, backpressure
  considered; N rows is one bulk call plus a queue, never N requests.
- [ ] **Tested at the altitude of the risk** - user-critical flows have e2e; the
  plan named the altitude and why.
- [ ] **No guess worn as a finding** - root cause shown with literal evidence;
  assumptions labelled; the outward artifacts (commit, PR, tracker) read as an
  engineer authored them, zero process vocabulary.

## Working files

All of them beside this file, in `tasks/<ID>-<slug>/`.

Tracked:

- `scripts/` - repro / verify / one-off scripts (prevention infrastructure).

Gitignored - these three by convention, and anything else placed beside them:

- `samples/` - inputs, fixtures, datasets.
- `artifacts/` - generated outputs, exports, dumps, logs.
- `screenshots/` - QA / verification images.

## Evidence log

<the literal verification output - commands run and what they printed - pasted,
not summarized. For bugs: what was observed, where, reproducible or not.>

## Out of scope

<what this task deliberately does NOT cover>
