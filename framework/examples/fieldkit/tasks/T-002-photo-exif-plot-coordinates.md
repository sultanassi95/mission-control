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

## Evidence (bugs only)

(not a bug - enhancement filed from Mara's field notes, week 28)

## Out of scope

- Reverse-geocoding or map views.
