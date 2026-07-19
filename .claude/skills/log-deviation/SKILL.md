---
name: log-deviation
description: >-
  Captures a deviation - anything that changed from what was approved - in
  the canonical register format: a Master Tracker row plus a body section
  (Problem / Why / Resolution / Anti-patterns rejected), logged BEFORE the
  fix is attempted. Use whenever a plan and reality diverge: a discovery
  invalidates an assumption, a scope item moves, a verification fails, or
  the founder or the session says "log a deviation".
---

# Log Deviation

Every drift from plan is logged; drift that isn't logged becomes invisible
damage. The full protocol lives in
`framework/kit/doctrine/deviations-protocol.md` - this skill is the
one-call way to follow it correctly.

## The iron ordering

**Log first, fix second.** The moment a deviation is recognized - before
the fix attempt, even if the fix is trivial. During verification: when an
expectation fails, the row is written BEFORE the fix.

## What counts

Code that doesn't match its plan; a test that doesn't match its test plan;
a decision reversed mid-execution; a scope item added, removed, or
deferred; a discovery that invalidates a prior assumption. Small ones
count (a renamed variable referenced in three plan files IS a deviation).
Not counted: typo fixes, formatting, pure whitespace. If in doubt: log -
a noisy register costs less than invisible drift.

## The write

Target: the current project's `deviations-register.md` (create it from
`framework/kit/templates/_deviations-register.md.template` if absent).

1. **Master Tracker row:**
   `| ID | Discovered | Phase | Discovery Source | Status | Consolidated | Summary |`
   - ID: `<PHASE>-<SOURCE>-<N>` (e.g. `P3-IMPL-2`); Discovery Source is
     one of `Implementation` / `Pre-Pass` / `Test-Run` / `Plan-Review`,
     set at creation and never edited; Status starts `Open`;
     Consolidated starts `No`; Summary is one imperative sentence.
2. **Body section** under `### <ID> - <one-line summary>`:
   - **Problem** - what was found, specific, with file paths and lines.
   - **Why (intent)** - what the plan meant to achieve and how this
     slipped through. Usually the most valuable section for future
     sessions.
   - **Resolution** - what changed to fix it (filled when fixed).
   - **Anti-patterns rejected** - fixes considered and rejected, with
     reasons, so the same dead end isn't re-walked next time.

## After the write

Confirm the row + body to the founder in two lines, then proceed to the
fix (or the escalation, if the deviation changes scope - scope changes are
the founder's call, not the register's).
