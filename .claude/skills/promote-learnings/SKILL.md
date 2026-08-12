---
name: promote-learnings
description: >-
  Use whenever the founder types /promote-learnings, asks to turn
  accumulated lessons, learnings or memories into standing rules that bind
  every session, or asks why a captured lesson keeps recurring anyway.
  Also use when a promotion pass is due at a weekly or monthly cadence.
  Always founder-gated: this skill never self-approves a doctrine change.
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

**Every lesson is promotable. The question is where to, not whether.**
There are two destinations, and choosing between them is the first decision
of every draft.

- **Portfolio doctrine** - a lesson about METHOD, true across fronts. It
  lands in `_command/CONSTITUTION.local.md`, or in the product file that
  actually carries the method: `framework/` doctrine, `framework/roles.md`,
  a `framework/kit/` template, a flow under `.claude/skills/`.
  `framework/CONSTITUTION.md` is upstream, pulled and never edited in an
  operating instance.
- **Front context** - a lesson about ONE front or project: its deploy
  mechanism, its access path, its constraints, its traps. It lands in that
  front's context under `_command/portfolio/<front>/`, in the hub
  `_front.md` for a front-wide fact or the spoke `<project>.md` (its
  `gotchas`, or "How to work in it") for a repo-scoped one. That context is
  read whenever the front is opened and travels in every sub-agent dispatch
  header for it.

**Never promote a lesson by changing the front's own repo.** Repos under
`fronts/` hold product code and change through a ticket and a flow, never
through this skill. A learning ABOUT a front becomes context in the
management repo, where the next session reads it before touching that front.

**A promotion has two halves.** Writing the rule is the first. The second
is repairing the artifact that will otherwise keep emitting the failure:
the step a flow prescribes, the command a phase tells a session to run, the
checklist a ticket instantiates. A rule added while its artifact still
emits the defect has moved the text and changed nothing, because the lesson
was already advisory and a standing rule no flow enforces is advisory too.
Both halves are drafted in Phase 3 and both wait for the same sign-off.

## Dials

`--thinking` (default high - doctrine selection is high stakes) and
`--verbosity` per the universal grammar; the founder sign-off pause is
discipline at every tier.

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

## Phase 2: Route each candidate

Work through every lesson in both stores. The checks below decide WHERE a
lesson goes and whether it is ready, not whether it survives at all.

1. **Does it hold across fronts?** Yes routes it to doctrine. No routes it
   to front context. This is a routing question and never a rejection: a
   lesson true of one repo is not a failed doctrine candidate, it is a
   correct front-context entry, and demoting it to context is a promotion.
2. **Reinforced more than once, or high-stakes on its own?** A doctrine
   rule needs this, because a standing rule competes for attention with
   every other standing rule. Front context does not: one observation about
   one front's deploy path earns its place the first time it is seen.
3. **Not already encoded.** Check the framework CONSTITUTION, the local
   file, and the destination front's hub and spoke. If it is already there,
   sharpen the existing entry rather than adding a second one.
4. **Non-destructive.** Never promote a lesson that would push future
   sessions toward deleting things, skipping checks, or cutting corners.
   This is a true gate at both destinations, not a routing question.

Genuinely ephemeral facts still stay put: a one-time workaround, or a fact
scoped to a repo about to be retired.

**Cap the DOCTRINE batch at five per run**, ranked by what the failure
costs each time it recurs, and name the ones you held back in one line each
so the remainder is a known queue rather than a silent drop. Front-context
entries are not capped: they are scoped, cheap, and read only by sessions
already working that front.

## Phase 3: Draft

Each surviving candidate is a draft with SIX fields. A draft missing a
field is not ready to present.

- **Rule text** - the exact wording as it should appear in
  `CONSTITUTION.local.md` (imperative, no em or en dashes, matching the
  file's existing tone).
- **Destination** - `doctrine` or `front context`, from the Phase 2 route,
  and the exact file it lands in. For `doctrine`: which section of
  `CONSTITUTION.local.md`, as a new numbered item with its proposed number
  or folded into a named existing item, quoting the sentence it joins; say
  so here if the method is carried by a product file instead. For `front
  context`: which front, and whether the hub `_front.md` or a named
  spoke `<project>.md`, and under which heading or field. Prefer folding
  into what exists; a short set of rules is read and a long one is skimmed.
- **Enforcement tier** - `mechanical`, `binding`, or `advisory`, per the
  tiers named in `CONSTITUTION.local.md` section 1, plus the one thing that
  makes it that tier. `mechanical` names the hook or static check that runs
  regardless of the session's state. `binding` names the gate that refuses
  to pass without it, and carries the exact Definition-of-Done line to add
  to `framework/kit/templates/_task.template.md`. `advisory` states plainly
  that nothing but recall enforces this, which is the same tier the lesson
  already had.
- **Artifact that will re-emit** - the file and line that will produce this
  failure again, and the exact amendment that stops it. Go and find it:
  grep the flows, templates and checklists for the command, step or wording
  the lesson contradicts. A lesson about a git command has a git command
  somewhere in a flow; a lesson about a test has a test checklist. If the
  artifact sits under `framework/`, it is upstream here, so write the
  amendment as a dated gated item addressed to the product repo rather than
  an edit. If you cannot name an artifact, write `none` followed by the
  files and patterns you searched, so the claim is checkable.
- **Rationale** - one line, tied to the Phase 2 criteria.
- **Source lesson** - the memory file and/or learning-log entry it is drawn
  from.

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
- For a `front context` destination, write the entry into that front's hub
  or spoke under `_command/portfolio/<front>/`, in the instance, in this
  pass. Keep it to the pointer style those files already use.
- Apply the approved **artifact amendment**, routed by where the artifact
  lives. An artifact under `_command/**` is this instance's own and is
  edited here. An artifact that is part of the product (`framework/**`,
  `.claude/skills/**`, `tools/**`) is authored in the product repo on a
  branch, never patched in place in an operating instance, where the next
  pull would clobber it and no one else would ever receive it. An artifact
  you do not maintain goes to the founder as a dated gated item. Name which
  of the three routes each amendment took.
- **Never edit a repo under `fronts/` to carry a promotion.** A defect in a
  front's own code is a ticket for that front, raised through its flow. If
  a promotion seems to need one, the lesson was routed wrong: record the
  front-context entry, and name the ticket the code fix belongs to.
- If the approved tier is `binding`, add its Definition-of-Done line to
  `framework/kit/templates/_task.template.md` by that same product route,
  so the ticket gate enforces the rule instead of merely recording it.
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
the approved items. For each promoted rule also report its enforcement
tier, the artifact that was amended, and which of the three routes that
amendment took. A promotion reported without its artifact half is not
finished being reported.
