---
name: promote-learnings
description: >-
  Promotes accumulated learnings and memories into top-level standing rules
  that load in every session. Reviews both lesson stores - session memory
  and the _command/learning/ log - selects the highest-value,
  repeatedly-reinforced lessons, and drafts them as rules for
  _command/CONSTITUTION.local.md, so they bind every request instead of
  relying on advisory recall. Always pauses for explicit founder sign-off
  before editing doctrine (no self-approval). Use whenever the founder
  types /promote-learnings or asks to turn lessons into standing rules.
---

# Promote Learnings

Mission Control keeps lessons in two stores, both advisory. Session
**memory** (`MEMORY.md` and its linked files in the harness's auto-memory
directory) holds short facts that get auto-loaded and can still be missed.
The **learning log** (`<portfolio-root>/_command/learning/`) holds
transferable CTO method, written to teach a future AI CTO. Standing rules,
by contrast, bind every session and every request. This skill is the
promotion path from either store into standing rules, and it is
deliberately slow and gated: doctrine changes are a plan change, and the
CONSTITUTION forbids self-approval on those.

**Where promotions land:** `framework/CONSTITUTION.md` is upstream
doctrine, pulled and never edited; your standing rules live in
`_command/CONSTITUTION.local.md`, which loads alongside it every session.
Promotion writes there, and only there.

## Phase 1: Read

- Read `MEMORY.md` in full in the session-memory directory (the auto-memory
  directory whose MEMORY.md loads into your session context), then open
  every linked memory file that looks like a candidate for a standing rule
  (feedback and reference types are the usual source; pure
  situational/project facts rarely qualify).
- Read the learning log at `<portfolio-root>/_command/learning/` - its
  `README.md` index and every entry file - plus the shipped seed at
  `framework/learning-seed/` for context. Learning entries are the STRONGER
  source of doctrine candidates: they are already framed as transferable
  rules and carry **Confidence** and **Promote?** fields. An entry marked
  `Confidence: high` and `Promote? yes` is a prime candidate; weigh it
  first.
- Read the current `framework/CONSTITUTION.md` AND
  `_command/CONSTITUTION.local.md` in full, noting existing rules so you
  do not duplicate one.

## Phase 2: Select promotion candidates

A lesson only qualifies if it passes ALL of the following:

1. **Reinforced more than once, or clearly high-stakes on its own.** A
   lesson mentioned once in passing, with no repeat and no major cost if
   ignored, stays where it is. A lesson that has bitten more than once, or
   that guards against a large one-time cost (token burn, data loss, a
   compliance issue), is a candidate.
2. **Genuinely generalizable as a standing rule.** It must hold across
   fronts and situations, not just the one repo or one moment it came
   from.
3. **Not already encoded.** Check the framework CONSTITUTION and the
   local file first; if a rule already covers it, skip.
4. **Non-destructive** (the same gate as `/learn-from-session`). Never
   promote a lesson that would push future sessions toward deleting
   things, skipping checks, or cutting corners. And never promote an
   over-generalized one-off or product-specific decision into doctrine.

Explicitly exclude: situational or ephemeral facts (a one-time workaround,
a fact scoped to a repo that will be retired), and anything where you are
not confident the founder would actually endorse it as a rule binding
every future session. When in doubt, leave it where it is and do not
propose it.

## Phase 3: Draft

For each surviving candidate, write:

- **Exact rule text**, worded the way it should appear in
  `CONSTITUTION.local.md` (imperative, no em or en dashes, matching the
  file's existing tone).
- **Target location**: which section of `CONSTITUTION.local.md` it slots
  into, and its proposed number if it is a new numbered item.
- **One-line rationale**: why this earns standing-rule status, tied to the
  Phase 2 criteria.
- **Source lesson**: a link to the memory file(s) and/or learning-log
  entry it is drawn from.

Present the full set of drafts together as a numbered list before doing
anything else.

## Phase 4: PAUSE for founder sign-off (mandatory)

This is not optional and not a formality. Do not edit
`CONSTITUTION.local.md` until the founder explicitly approves. Present the
numbered drafts and stop. The founder may approve all, approve a subset by
number, reject some, or ask for wording changes. Wait for their explicit
reply before proceeding. Silence or an unrelated reply is not approval.

## Phase 5: Edit (only after approval)

For each approved item only:

- Edit `_command/CONSTITUTION.local.md`, inserting the (possibly
  founder-revised) rule text into the agreed section, matching the file's
  existing numbering and formatting conventions. Never touch
  `framework/CONSTITUTION.md` - it is upstream, pulled, not yours to edit.
- No em dashes, no en dashes, anywhere in the inserted text.
- Do not touch, remove, or renumber anything the founder did not approve.
- Go back to each source lesson - the memory file and/or the learning-log
  entry - and add a short note that the lesson is now also a standing rule
  (name the section and item), so the lesson and the doctrine stay
  traceable to each other. Do not delete or shrink the source file; it
  still serves as the detailed record. The standing rule is the enforced
  summary.

Report to the founder exactly what was promoted (rule text + location),
what was proposed but not approved, and confirm the edit was limited to
the approved items.
