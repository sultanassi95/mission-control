---
name: as-built
description: >-
  Promotes a fully-implemented AND verified plan into a living as-built
  doc - the final design plus the rationale that still matters - then
  retires the plan file, so one living doc replaces a rotting future-tense
  plan. Use when a plan's work is done and verified and the founder types
  /as-built, says "promote the plan", or asks why a shipped feature's plan
  is still lying around.
---

# As-Built

A plan is future-tense intent; once shipped it rots and becomes a second,
drifting source of truth. The fix is a *promotion*: one living doc that
carries the final design and the still-relevant why, with the obsolete
scaffolding (phase steps, resolved open questions, TBDs) dropped.

## Preconditions (hard)

- The plan is **fully implemented AND verified** - literal verification
  evidence exists (test output, a live run, a gate log). Partial work
  stays a plan; this skill refuses politely and says what remains.
- The plan file is committed (git history archives the original), OR - for
  an uncommitted repo - the promotion explicitly confirms the as-built doc
  absorbed everything before any removal.

## The promotion

Write `docs/features/<feature>.md` (or the project's equivalent home):

1. **What it is** - the shipped behavior, present tense, diagram-first
   (per `framework/visualization-contract.md`).
2. **The design** - the final architecture as built, not as first planned.
3. **The why that still matters** - decisions made, alternatives rejected
   and why, constraints that shaped it. This is a promotion, not a
   downgrade: losing the rationale would make it a mere usage doc.
4. **Deliberately dropped:** phase steps, task checklists, resolved
   "open questions", superseded drafts - name none of them; they are what
   rots.

Cross-check the deviations register: any deviation that reshaped this
feature has its resolution reflected in the as-built text.

## The retirement (STOP gate)

Present the as-built doc + the removal list (the plan file, any stale
design drafts) and WAIT for founder approval before deleting anything.
Deletion without a gate is exactly the destructive habit the doctrine
bans. On approval: remove the plan file, link the as-built doc from the
project's README or docs index, and note the promotion in `progress.md`.
