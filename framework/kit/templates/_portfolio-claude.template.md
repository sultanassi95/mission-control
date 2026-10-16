# Operating instructions - <FOUNDER-NAME>'s Mission Control (portfolio root)

> This is `_command/CLAUDE.operating.md`, loaded every session by the import
> on the last line of the shipped root `CLAUDE.md`, which is never edited.
> It is gitignored with the rest of the instance. The portfolio root is
> where sessions open; the operating system lives in `_command/`, doctrine
> in `framework/` (pulled from upstream, never edited). The imports at the
> bottom load the rules and current state automatically; each resolves
> from this file's folder, `_command/`.

## Orient (every session)
1. **The rules** - `framework/CONSTITUTION.md` + `_command/CONSTITUTION.local.md` *(auto-loaded below)*
2. **Where we are today** - `_command/daily/today.md` *(auto-loaded below)*
3. **The board** - `_command/trackers/fronts.md` *(auto-loaded below)*
4. On demand: `_command/mental-model.md` (the whole picture) ·
   `framework/roles.md` (before dispatching sub-agents) ·
   `framework/task-board.md` (the work queues, and the epic folder shape) ·
   `framework/continuity-stack.md` · `.claude/skills/README.md` (the rituals).

**Delivery has three altitudes.** `/mission-flow` runs one ticket to a
checks-green PR; `/epic-flow` plans work bigger than one ticket into a
founder-locked fragment tree and executes each fragment as a mission-flow
child; `/product-flow` takes a product from an idea to launch, running each
epic as an epic-flow run. `/console` staffs a kept-alive Controller per front
when several fronts run at once. Where a front declares standards via
`/compliance-ref`, the review, verify and PR steps read that profile; fronts
declaring nothing pay nothing.

## The fronts
> Every front is a folder in the gitignored `fronts/` container, with its
> repos inside it: `fronts/<front>/<repo>`, even for a single repo
> (`framework/task-board.md`, front placement).

<PLACEHOLDER-FRONTS: one bullet per front - name, posture, one line, and its
folder `fronts/<front>/`; mark any registered-in-place front with its
external path note>

Within a project, that project's own CLAUDE.md is more specific and wins
(precedence: framework/CONSTITUTION.md, section 3).

## Session edges
- Ending a session where real work happened? Run `/debrief` first -
  continuity is part of done.
- Starting the day? `/briefing` locks the objective.
- `_command/machine.local.md` is THIS machine's platform contract
  (auto-detected, gitignored). Missing or wrong-OS? Regenerate it by
  detection before composing commands (`framework/platform.md`).

## Non-negotiables (full text in framework/CONSTITUTION.md)
Evidence before claims · no self-approval · plan before spend ·
right-size every sub-agent · diagram-first · no silent shortcuts · the
git rule (no git writes unasked; branch-first carve-out only).

---

@../framework/CONSTITUTION.md
@../framework/engineering-standard.md
@CONSTITUTION.local.md
@machine.local.md
@daily/today.md
@trackers/fronts.md
