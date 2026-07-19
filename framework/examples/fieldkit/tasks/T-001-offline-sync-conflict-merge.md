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

## Evidence (bugs only)

Repro: tablet A and tablet B both open plot 14 offline; A edits pH, B
edits moisture; A syncs, then B syncs; A's pH edit is gone. Reproduced
3 of 3 attempts on build 0.9.2.

## Out of scope

- Merge UI polish beyond the pick-one prompt.
- Conflict handling for photos (tracked separately as T-002 groundwork).
