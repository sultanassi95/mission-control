---
id: T-002
title: photo capture keeps EXIF plot coordinates
state: backlog
size: S
created: 2026-07-19
updated: 2026-07-19
branch:
pr:
parent:
---

## Context

Field photos currently strip EXIF on import to save space, which also
drops the GPS block - so a photo cannot be re-associated with its plot
if the note link is lost. Agronomists sort by location first.

## Acceptance criteria

- Import preserves the GPS EXIF block (only thumbnails are stripped).
- A photo with GPS data shows its plot association in the gallery.

## Definition of Done (the integration-truth floor)

- [ ] **Real path, end to end** - import a real photo with GPS EXIF, not a
  synthetic fixture only.
- [ ] **Whole vertical slice** - importer preserves the block AND the gallery
  reads it back to show the plot.
- [ ] **Terminal artifact verified** - the stored image's EXIF GPS block is
  present after import (read it, do not assume).
- [ ] **Designed for scale** - bulk import of a day's photos, not one at a time.
- [ ] **Tested at the altitude of the risk** - unit is enough here; low blast
  radius, no data loss.
- [ ] **No guess worn as a finding** - confirm which strip step drops GPS before
  changing it.

## Working files

All of them beside this file, in `tasks/<ID>-<slug>/`. None of them is tracked,
because `_command/` is gitignored in full.

- `scripts/` - none yet; record any in the project's `scripts.md`.
- `samples/` - the three photos whose EXIF disagrees with the plot record.
- `artifacts/` - the extracted coordinate table.
- `screenshots/` - the map view putting a plot in the wrong field.

## Evidence log

(not a bug - enhancement filed from Mara's field notes, week 28)

## Out of scope

- Reverse-geocoding or map views.
