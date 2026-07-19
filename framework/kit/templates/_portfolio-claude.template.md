# CLAUDE.md - <FOUNDER-NAME>'s Mission Control (portfolio root)

> Auto-loaded when a session opens here. This is the portfolio root; the
> operating system lives in `_command/`, doctrine in `framework/` (pulled
> from upstream, never edited). The imports at the bottom load the rules
> and current state automatically.

## Orient (every session)
1. **The rules** - `framework/CONSTITUTION.md` + `_command/CONSTITUTION.local.md` *(auto-loaded below)*
2. **Where we are today** - `_command/daily/today.md` *(auto-loaded below)*
3. **The board** - `_command/trackers/fronts.md` *(auto-loaded below)*
4. On demand: `_command/mental-model.md` (the whole picture) ·
   `framework/roles.md` (before dispatching sub-agents) ·
   `framework/task-board.md` (the work queues) ·
   `framework/continuity-stack.md` · `.claude/skills/README.md` (the rituals).

## The fronts
<PLACEHOLDER-FRONTS: one bullet per front - name, posture, one line;
mark any registered-in-place front with its external path note>

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

@framework/CONSTITUTION.md
@framework/engineering-standard.md
@_command/CONSTITUTION.local.md
@_command/machine.local.md
@_command/daily/today.md
@_command/trackers/fronts.md
