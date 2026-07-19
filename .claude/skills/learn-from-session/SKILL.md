---
name: learn-from-session
description: >-
  Learns from the current session. Scans it for genuine lessons, runs each
  candidate through a mandatory 8-rule critique gate (no dups, no useless
  learning, no destructive habits, and more), then writes each survivor to
  the lesson store whose job it matches: short advisory facts to session
  memory, transferable CTO method to the _command/learning/ log. Never
  writes standing doctrine (that is /promote-learnings, founder-gated).
  Use whenever the founder types /learn-from-session, asks to "capture
  lessons", or at the end of /debrief, which invokes this as its final step.
---

# Learn From Session

Distills what this session actually taught, guards hard against writing a
bad lesson, and saves each survivor to the correct store. This skill never
touches doctrine files (`framework/CONSTITUTION.md`, `CONSTITUTION.local.md`,
`CLAUDE.md`); promoting a lesson into standing rules is `/promote-learnings`,
and it always requires founder sign-off.

## Mission Control has two lesson stores, not one

A lesson is not always a memory. The continuity stack gives each layer
exactly one job, so route each survivor to the store whose job it matches:

- **Session memory** - the harness's auto-memory directory for this
  workspace (the directory whose MEMORY.md loads into your session context,
  under `~/.claude/projects/<workspace-slug>/memory/`) plus its `MEMORY.md`
  index. Short, one-fact-per-file, auto-loaded into every session. This is
  where advisory FACTS live: how the founder works (`user`), a correction or
  preference the founder gave (`feedback`), a fact scoped to one front or
  repo (`project`), or a durable technical pin such as a version or account
  id (`reference`). If your harness has no auto-memory feature, route
  advisory facts to a notes section in `_command/CONSTITUTION.local.md`
  or into the learning log instead - never let them silently vanish.
- **The learning log** - `<portfolio-root>/_command/learning/`, indexed by
  its `README.md` (`<portfolio-root>` is the repo root holding `framework/`
  and `_command/`). Transferable CTO METHOD, cross-project: routing
  (model x effort), decomposition and context isolation, the IO / record
  contract, session mechanics and recovery, founder-facing reporting.
  Written to TEACH a future AI CTO, not merely to be recalled. This is the
  home of the CONSTITUTION's "capture every lesson" directive and the
  destination the wind-down doctrine names
  (`framework/learning-seed/04-continuity-is-part-of-done.md`).

The test: a fact that only helps a future session ACT correctly is memory;
a method that TRANSFERS to the next project of this class is a learning
entry. A single insight can warrant BOTH - the full teaching artifact in
`learning/` and a one-line recall hook in memory - but never force a
double-write for something that is genuinely only one or the other.

## Phase 1: Scan the session

Read back over the session and list every candidate lesson. Look for:

- Something the founder explicitly corrected ("no, that's wrong",
  "actually do X instead").
- Something the founder explicitly confirmed as a preference or fact.
- A mistake that cost real time or a retry (wrong file touched, wrong
  assumption, a fix that needed reverting).
- A pattern that recurred more than once this session.
- A durable project or reference fact worth keeping for future sessions
  (a path, a version pin, an account id, an architectural fact).
- A transferable METHOD that would help on the next project of this class:
  a routing call that paid off or was over/under-powered, a decomposition
  that worked, an IO-contract fit or leak, a session-mechanics recovery, a
  founder-reporting framing that landed.

Write out each candidate as one line: what happened, and the lesson it
would imply. Do not filter or route yet, just list.

## Phase 2: The critique gate (mandatory, the heart of this skill)

Before writing a single candidate to disk, read BOTH indexes in full:
`MEMORY.md` in the session-memory directory, and the learning log's
`README.md` plus its existing entry files. Then, for EACH candidate from
Phase 1, verify ALL EIGHT of the following. A candidate that fails any one
gets reframed or dropped, never written as-is.

1. **No dups.** Check both indexes for an existing entry on the same
   topic. If one exists in either store, plan to update that file in
   Phase 3 rather than create a duplicate.
2. **No useless learning.** The actionability bar: if no future session
   would decide anything differently because of this lesson, drop it. Cap
   the session at the few lessons that clear the bar; volume is not value.
3. **No destructive habits.** The lesson must never push a future session
   toward deleting things, skipping checks, cutting corners, or amputating
   a feature to make something pass. If a candidate reads that way, drop
   it or rewrite it to state the safe version instead.
4. **Not an over-generalized one-off.** A one-time product call by the
   founder is a project fact about that occasion, never a universal
   engineering rule. The archetype to avoid: a founder once dropped a
   single metric (a honeypot) as a product decision, and it got recorded
   as "never ship a metric with no data source, drop it" - a wrong
   universal built from a scoped call. Ask: would this lesson still be
   true if the situation were slightly different?
5. **The founder's actual intent, not your inference.** If you are not
   sure why the founder said or did something, do not guess at the
   generalized reason. Ask directly, or skip the candidate this round.
6. **Evidence-cited.** Every lesson names the literal in-session evidence
   it came from (the correction, the failing output, the retry). A lesson
   without evidence is an opinion.
7. **Scoped truth.** Record the scope the lesson held in (this repo, this
   stack, this situation). Universalizing a scoped truth is
   `/promote-learnings`' job, done deliberately and founder-gated - not
   capture's job, done by accident.
8. **No confidential content.** Names from private conversations, pasted
   dialog, secrets, keys, and personal stakes never enter a lesson.
   Extract the anonymized task or method only.

For every candidate, state the verdict explicitly: **PASS** (write as
drafted), **REFRAME** (write with the corrected framing, saying what
changed and why), or **DROP** (do not write, saying which rule it failed).
Show this list in your output before proceeding to Phase 3 - it is the
audit trail for this run.

## Phase 3: Route and write the survivors

For each PASS or REFRAME candidate, first decide the store (per the two
stores above), then write it.

### If it is an advisory fact: session memory

- Decide the memory `metadata.type`: `user` (a standing fact about how the
  founder works), `feedback` (a correction or preference), `project` (a
  fact scoped to one front/repo), or `reference` (a durable technical
  fact).
- If updating an existing memory (per the Phase 2 dedup check), edit that
  file in place rather than creating a new one.
- If creating a new memory file, write it to the session-memory directory
  as `<kebab-case-name>.md` with frontmatter:
  ```
  ---
  name: <kebab-case-name>
  description: "<one or two sentence hook, matching the file's topic>"
  metadata:
    type: <user|feedback|project|reference>
  ---
  ```
- Body: the fact itself, plainly stated. For `feedback` and `project`
  types, include a **Why:** line (the reasoning) and a **How to apply:**
  line (what a future session should actually do differently). Link
  related memories with `[[other-memory-name]]` where relevant.
- Append exactly one new bullet to `MEMORY.md`, matching the existing
  index style: `- [Title](file.md) - one-line hook.` Add it in the same
  pass, do not batch this for later.

### If it is a transferable method lesson: the learning log

- Use the learning log's entry schema (from its `README.md`):
  ```markdown
  ## Lesson: <the transferable rule, in one sentence>
  **Context:** <where it came from - phase, task, model/effort used>
  **What happened:** <the observation, with the evidence>
  **Transferable rule:** <the method to reuse on the next project of this class>
  **Confidence:** low | medium | high   ·   **Promote?** yes | no
  ```
- If the lesson clearly fits an existing file in `_command/learning/`
  (per the Phase 2 read), APPEND the entry to that file. Otherwise create
  a new standalone file `_command/learning/<NN>-<kebab-slug>.md` using the
  next available `NN-` number, opening with a one-line
  `> Captured <date> from <trigger>` note, then the schema entry.
- Set **Promote?** honestly: `yes` marks it as a candidate that
  `/promote-learnings` should later weigh for standing doctrine.

### If it genuinely warrants both

Write the full teaching artifact in `learning/` AND a one-line recall hook
in memory that links to it. Do this only when both jobs are real (the
method transfers AND a future session needs to recall the fact fast); do
not double-write out of habit.

### Applies to everything you write

No em dashes, no en dashes, anywhere. Use ", ", ": ", or " - " instead.

## Phase 4: Report

Give the founder a short, direct summary:

- **Saved to memory:** each new or updated memory file, one line each.
- **Saved to learning/:** each new or appended learning entry, one line
  each, with its **Promote?** flag.
- **Reframed:** each candidate that survived only in a corrected form,
  with the original and corrected framings side by side.
- **Dropped:** each candidate that failed the gate, with the specific
  rule it failed (by number).

Close by confirming the session's learning is captured in both stores as
routed. This skill only performs the learn step; it does not end the
session.
