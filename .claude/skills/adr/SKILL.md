---
name: adr
description: >-
  Records an architecture/decision record in two minutes from the kit
  template: context, the decision, alternatives rejected with reasons,
  and consequences - then links it from the relevant spoke or plan. Use
  whenever a decision worth remembering gets made and the founder types
  /adr, says "record this decision", or a session is about to act on a
  choice between real alternatives.
---

# ADR

A decision without a record becomes a mystery with a maintenance cost.
The ADR is two minutes at decision time that saves an archaeology session
later - and it is the difference between "we chose X" and "we chose X
over Y because Z, and Z may stop being true."

## When to write one

- A choice between real alternatives was made (library, architecture,
  contract shape, storage, a build-vs-buy).
- A constraint forced a design ("the platform's rules forbid X, so...").
- A reviewer or founder asked "why is it like this?" and the answer was
  not written anywhere.

Not for: trivial choices with no losing alternative, or product decisions
that belong in the tracker (those are the founder's record).

## The write

From `framework/kit/_adr.template.md`:

1. **Title + number:** `docs/adr/NNNN-<kebab-slug>.md` in the current
   project (or `_command/adr/` for portfolio-level decisions). Number
   sequentially; never reuse.
2. **Status:** proposed / accepted / superseded-by-NNNN. Never delete a
   superseded ADR - mark it.
3. **Context:** the forces in play, plainly stated (specifics over
   labels).
4. **Decision:** what was decided, present tense, one paragraph.
5. **Consequences:** what becomes easier, what becomes harder, the
   trade-offs explicitly accepted, follow-up work created.
6. **Alternatives considered:** each with the concrete reason it lost.
   This section prevents the same alternative being re-litigated next
   quarter.

## After the write

Link the ADR from the thing it governs (the spoke, the plan, the as-built
doc) and confirm to the founder in one line: number, title, where it
lives. If the decision was the founder's and the wording infers their
intent anywhere, show them the Context + Decision text before filing.
