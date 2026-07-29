---
id: T-001
title: resolve offline-sync conflicts by field-level merge
state: in-progress
size: M
created: 2026-07-19
updated: 2026-07-19
branch: feat/t-001-offline-sync
pr:
parent:
---

## Context

Two devices editing the same plot note offline currently last-write-wins
on sync, and the earlier device's soil-sample readings vanish. Observed
in Mara's own field test (two tablets, one plot, both offline for the
afternoon). Losing sample data is the one failure an agronomist will not
forgive.

## Acceptance criteria

- Concurrent edits to DIFFERENT fields of the same note both survive a
  sync (field-level merge, not row-level).
- A true same-field conflict keeps both values and surfaces a pick-one
  prompt on next open; nothing is silently discarded.
- Sync of 200 notes with 20 conflicts completes under 5 seconds on the
  reference device.

## Definition of Done (the integration-truth floor)

- [ ] **Real path, end to end** - two real devices sync against the real
  server, not a merge unit test alone.
- [ ] **Whole vertical slice** - the merge runs client-side AND the server
  accepts the merged payload; one test sends the actual serialized sync body.
- [ ] **Terminal artifact verified** - after sync, the note row on device A
  shows BOTH edits (query the stored note, not the sync event count).
- [ ] **Designed for scale** - 200-note sync batches, no per-note round trip.
- [ ] **Tested at the altitude of the risk** - e2e for the conflict path (data
  loss is unforgivable); unit for the field-merge function.
- [ ] **No guess worn as a finding** - the "earlier readings vanish" cause shown
  with a captured before/after, not inferred.

## Working files

All of them beside this file, in `tasks/<ID>-<slug>/`. None of them is tracked,
because `_command/` is gitignored in full.

- `scripts/` - `repro-sync-conflict.sh`, recorded in the project's `scripts.md`
  with what it does and why, since git will not remember it.
- `samples/` - two exported note rows that reproduce the collision.
- `artifacts/` - the merged output the script writes for comparison.
- `screenshots/` - the field report showing the lost edit.

## Evidence log

Repro (`scripts/repro-sync-conflict.sh`): tablet A and tablet B both open
plot 14 offline; A edits pH, B edits moisture; A syncs, then B syncs; A's pH
edit is gone. Reproduced 3 of 3 attempts on build 0.9.2. Captured payloads in
`samples/` (gitignored, local only).

## Out of scope

- Merge UI polish beyond the pick-one prompt.
- Conflict handling for photos (tracked separately as T-002 groundwork).
