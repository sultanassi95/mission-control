---
name: retire-front
description: >-
  Retires a front from the active portfolio: founder-gated archiving of
  its hub, spokes, and boards to _command/portfolio/_archive/ with
  history intact, its board row moved to the Archived section, and its
  removal from the daily rotation and the operating file's front list.
  Use when an engagement ends, an experiment concludes, or a product
  sunsets - whenever the founder says "retire <front>", "close <front>",
  or "archive <front>".
---

# Retire Front

Fronts are born (`/new-front`) and fronts die - a consulting engagement
ends, an experiment concludes, a product sunsets. Retirement preserves
the record and clears the attention: the archive IS the engagement's
history (spokes, boards, done tasks), and the rotation stops paying for
a front that no longer exists.

## Step 1 - Confirm scope (founder-gated, always)

Name the front and show exactly what will move:
- `_command/portfolio/<front>/` - the hub, every spoke, every `tasks/`
  board and task file (done and dropped included - they are the record).
- Its row in `trackers/fronts.md`, its line(s) in `daily/today.md`, and its
  bullet in the `## The fronts` list of the operating file
  `_command/CLAUDE.operating.md`, with any registered-in-place note.

State what does NOT move: the project repos themselves (the founder's
code stays wherever it lives - retiring a front never touches a repo),
and any external tracker (Jira/GitHub state is the other system's
record).

**STOP.** Wait for the founder's explicit go. Retirement is reversible,
but it is still a portfolio decision.

## Step 2 - Archive

If a console is staffed on the front (`/console list`), stand it down first
with `/console stand-down <sign>`, so its handoff lands in the front's
`progress.md` before the archive moves it.

1. Move `_command/portfolio/<front>/` to
   `_command/portfolio/_archive/<front>/` (create `_archive/` on first
   use). History travels whole - nothing is deleted, ever.
2. Move the front's board row to the `## Archived` section of
   `trackers/fronts.md`: one line - front, retirement date, and a link
   to the archived hub.
3. Remove the front's line(s) from `daily/today.md`; lift any of its
   founder-gated items into the closing report instead (they do not
   silently vanish).
4. Remove the front's bullet from the `## The fronts` list in
   `_command/CLAUDE.operating.md`, its registered-in-place note with it:
   every session boots with that list, and a retired front is not on it.
5. Update `_command/mental-model.md`'s fronts branch.

## Step 3 - Close the record

- Append a final entry to each of the front's `progress.md` files: the
  retirement date, the reason in one line, and where the archive lives.
- Report to the founder: what moved, the archive path, any gated items
  that were still open, and the un-retire path.

## Un-retiring

Move `_archive/<front>/` back to `portfolio/<front>/`, restore the board
row from the Archived section, re-add the today.md line and the front's
bullet in `_command/CLAUDE.operating.md` (its note too, when registered
in place). Task history resumes exactly where it stopped - task ids never
changed.
