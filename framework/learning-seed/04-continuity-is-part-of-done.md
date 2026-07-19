# Continuity and Lessons Capture Is Part of "Done"

## Lesson: The session wind-down hygiene pass (lessons to learning/, product docs current, backlog updated, portfolio rolled up) is part of the work. Self-trigger it - don't wait to be audited.

**Context:** A long, high-output autonomous build session: a product built end to end, live-wired, and committed in scoped commits, with per-project state kept current throughout.

**What happened:** Build momentum crowded out the *other* persistence layers. Until the founder asked five audit questions ("is progress tracked? is it documented? are enhancements tracked? did we extract lessons?"), the session had NOT: extracted any transferable lesson to `learning/`, fixed the stale product README (it still said "not yet scoped for build" after the thing was built and live), opened a post-build enhancement backlog, or rolled progress up to the portfolio board. State was current; method and consumer-facing docs were not.

The distinction that got lost - three persistence layers, not one:
- **State** (`progress.md`): what happened on the project. *(kept current)*
- **Method** (`learning/`): what transfers to the next project. *(skipped)*
- **Product docs** (README / overview / backlog): what a consumer needs to understand and extend the thing. *(left stale at the design phase)*

A stale entry-point doc is worse than none - it actively misleads; a reader trusts the README over the reality.

**Transferable rule:** "Done" for a build session has a **hygiene tail**, run as a literal checklist before declaring the ceiling reached - the same reflex as running verification before claiming a fix works:
1. Lessons to `learning/` (method, distinct from state).
2. Product docs current: README/overview reflect *as-built*, not the last design phase.
3. Enhancement backlog: every `NOTE: deferred` and every reviewer "acceptable for v0" is an entry.
4. Progress rolled up: per-project AND the portfolio board.

Don't make the founder audit for these. The wind-down pass is to continuity what verification-before-completion is to correctness. (In this system, `/debrief` runs the pass and finishes by invoking `/learn-from-session`.)

**Confidence:** high (the founder caught a real gap)   ·   **Promote?** yes
