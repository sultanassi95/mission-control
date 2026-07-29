# <project> - scripts record

> What lives in this project's ticket `scripts/` folders, and why. Those folders are
> gitignored along with the rest of `_command/`, so this file is the only thing that
> remembers a script exists and what it was for. One entry per script that still
> exists; delete the entry when you delete the script. Linked from the front hub's
> Repo map.

## `<name>` (<ID>)

Path: `tasks/<ID>-<slug>/scripts/<name>`

**Run:** `<the exact command, composed for this machine>`

**What:** <what it does, in a sentence or two.>

**Why:** <what was slow, unreproducible, or unsafe without it. This is the entry's
real payload: it is what stops a later session writing the same script again from
scratch.>

**Caveats:** <what would surprise the next person. Credentials or tools it needs,
what it must never be pointed at, how long it takes, what it leaves behind.>
