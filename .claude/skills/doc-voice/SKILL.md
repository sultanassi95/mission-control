---
name: doc-voice
description: >-
  Rewrites a deliverable document into a neutral, professional, impersonal
  register - the way a company's own product docs read - removing
  AI-to-reader phrasing, reassurance filler, process leakage, and
  machine-authorship tells (em dashes, ellipses). Presents a before/after
  diff for approval before overwriting. Use when a doc is about to ship to
  teammates, users, or a repo, and the founder types /doc-voice or says
  "make this read professional / CTO-authored".
---

# Doc Voice

Deliverables represent senior authorship. A README that chats with its
reader ("don't worry, you only do this once!") or narrates its own
assembly ("we then added...") undermines that portrayal. This skill is
the register pass.

**Dials:** `--thinking` (default medium) and `--verbosity` per the
universal grammar; the before/after approval gate holds at every tier.

## What gets rewritten

- **AI-to-reader conversational patterns:** "you'll see...", "don't
  worry", "that's it!", "let's...", "we'll now...". State system behavior
  and procedures directly.
- **Reassurance filler:** any sentence whose only job is to soothe.
  Confidence in docs comes from precision, not comfort noises.
- **Process leakage:** how the doc or feature came to be ("after some
  iteration...", "it was decided..."), tool/assistant references,
  session narration. The doc describes the system, not its authoring.
- **Machine-authorship tells:** em dashes (U+2014), en dashes (U+2013),
  ellipsis (U+2026) - replaced with ", ", ": ", " - ", or "...". Also
  uniform bullet rhythm and hedging stacks ("may potentially").
- **Vague loaded labels** ("some considerations", "edge cases apply"):
  replaced with the actual specifics, per
  `framework/learning-seed/06-communicate-plainly.md`.

## What stays

- Standard technical-writing imperatives inside numbered or bulleted
  steps ("Create the bucket", "Run `npm ci`") - those are correct and not
  the target.
- All technical content, exactly. The register pass changes voice, never
  facts. If a fact looks wrong mid-pass, flag it separately - do not
  silently "fix" content under the cover of a style pass.

## The pass

1. Read the whole doc first; list the violations found (grouped by the
   categories above) so the founder sees what will change and why.
2. Rewrite in place, section by section, preserving structure and all
   diagrams (diagram-first stays; this skill never removes a diagram).
3. Present the before/after for the most-changed sections plus the full
   violation list. **Founder approves before the overwrite** - the
   original is theirs.
