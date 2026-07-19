# Engineering Principles

> These are the non-negotiable rules for every project that uses this kit. They were earned through real failure modes on prior projects - every principle here exists because skipping it cost time at some point. Do not relax them for "small" projects; small projects are where they were learned to begin with.

---

## Principle 1 - Evidence Before Claims

Never claim "tests pass," "build succeeds," "deployed correctly," or "step complete" without running the verification AND showing the output. The output goes in the response, not summarized - the literal command, the literal stdout/stderr, the literal exit code.

**Failure mode this prevents:** Claude says "tests pass" when they were never run, or were run with a different config than the user thinks. Discovered three plans later when something downstream breaks.

**Discipline:** Every plan file's "Verification" section has command lines. Run them. Paste the output. Then mark complete.

---

## Principle 2 - Source First

Before writing anything new, check existing project assets and external references for prior art. Adapt; don't reinvent.

The check sequence:
1. Does this project already have an artifact that overlaps?
2. Do the project's own docs and reference materials already answer this?
3. Did another front in the portfolio solve this? (Check the learning log - `_command/learning/` - and the other fronts' docs.)
4. Only then: invent.

**Failure mode this prevents:** Two different implementations of the same thing, scattered across the project, that drift apart over time.

**Tag:** When referencing a decision derived from a source, tag it `[REF]` with the source path. When inventing, tag `[NEW]`.

---

## Principle 3 - Gate-Locked Phases

No phase starts until ALL prerequisites are ✅. No step within a phase starts until the prior step's gate is met.

**Failure mode this prevents:** Half-done architecture decisions getting baked into code, requiring expensive retrofits.

**Discipline:** Gates are enforced by the project's recorded state (`progress.md` and the board). If work shows in progress while an earlier gate is not approved, the work stops and surfaces to the user.

---

## Principle 4 - Implement Exactly

Do not add features, abstractions, error handling, or scope beyond what the approved plan specifies. Scope creep is the #1 failure mode for solo and small-team projects. Resist by default.

If during execution a real need surfaces that isn't in the plan:
1. Stop work.
2. Log it as a deviation (Discovery Source = Implementation).
3. Surface to user for plan amendment.
4. Resume only after the plan is amended and re-approved.

**Failure mode this prevents:** A 2-day task turning into 2 weeks because "while I was in there I also..."

---

## Principle 5 - No Self-Approval

Claude never marks a phase, step, or plan as ✅ Complete on its own authority. The user approves; Claude logs the approval.

**Failure mode this prevents:** Phases marked done that aren't actually done, surfaced only when downstream work depends on them.

**Discipline:** Claude proposes completion → presents evidence → waits for explicit user approval → then writes the progress.md entry.

---

## Principle 6 - Log Deviations

Every deviation gets logged in `deviations-register.md` BEFORE the fix is attempted. Four types:

| Discovery Source | When it's used |
|---|---|
| `Implementation` | Surfaced while executing a plan step |
| `Pre-Pass` | Surfaced by the pre-verification read: before running a verification plan, read it against the current state of the artifacts; drift found in that read logs here |
| `Test-Run` | Surfaced when a test assertion failed |
| `Plan-Review` | Surfaced when reviewing a plan against current reality |

The canonical row format and body section are defined in `deviations-protocol.md`.

**Failure mode this prevents:** Drift accumulates silently. Three months later nobody remembers why a thing diverged from the plan.

---

## Principle 7 - Test Plans Before Code

For any work that produces shippable code, no implementation starts until:
1. The work's test plan exists in full.
2. The user has explicitly approved it.

The test plan is the spec. Code is what you write to make the test plan pass.

**Failure mode this prevents:** Code that ships, then gets tests retrofitted to match what the code happens to do. The tests don't catch real bugs because they were written to pass, not to verify intent.

**Note:** For non-code phases (product spec, design, content), the equivalent gate is a phase-plan with success criteria and verification steps approved before work begins.

---

## Principle 8 - Deviations Propagate

Every deviation logged during a phase's lifecycle must reach `Consolidated = 🔵 Yes` in `deviations-register.md` before the phase flips to ✅ Complete.

This means: when a decision changes mid-work, every plan file in the project is swept and synced. The `Consolidated` column tracks this:

| State | Meaning |
|---|---|
| 🔵 Yes | Propagated. Every plan file is consistent with this deviation's resolution. |
| ⚪ No | Pending. The deviation was logged but the sweep hasn't run. |
| ❓ Legacy | Predates the Consolidated discipline. Needs its first sweep to confirm. |

**Failure mode this prevents:** A decision changes in Phase 4. Phase 2's plan file still says the old thing. Phase 6 reads Phase 2's plan and rebuilds against the old decision.

---

## Principle 9 - Real-Evidence-Only

Every claim in a project artifact about reality (a buyer's pain, a competitor's behavior, a user's preference, a market's size) must cite a real, specific, verifiable source. No invented testimonials. No hypothetical personas with hypothetical pain points. No "users probably want..." prose.

What counts as real evidence (examples - adapt per project):

- A specific Chrome Web Store review with the URL
- A specific Reddit thread with the URL and quoted text
- A specific competitor's pricing page snapshot with the date
- A real conversation transcript (with permission)
- A documented industry report with the citation
- A real customer email or DM
- A real analytics screenshot from the project's own data (once it exists)

What does NOT count:

- "Users in this segment typically want X..." (unverifiable generalization)
- "A hypothetical user named Sarah, 28, would..." (invented persona)
- "Industry reports suggest..." (no specific citation)
- "It's well-known that..." (unverifiable claim)

**Failure mode this prevents:** Building products against imagined customers. The #1 cause of startup failure.

**Discipline:** This is logged as `RULE-REAL-EVIDENCE-ONLY` in the deviations register from project start, status 🟢 Closed (it's a rule, not a defect). Every artifact that violates it goes back for citation.

**Per-project adaptation:** Some projects have a stricter version of this principle (e.g., a "real-fixture-only" rule for test data on a data-heavy engine). The project's own CLAUDE.md may add specific instances under this umbrella principle.
