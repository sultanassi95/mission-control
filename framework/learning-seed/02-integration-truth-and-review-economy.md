# Integration Truth + Review Economy

## Lesson: "Compiles" and "unit-green" are necessary but NOT sufficient - the real test is first contact with the live dependency. Re-verify on every integration boundary.

**Context:** Building a client app against a separate engine's API, via subagent-driven execution (mid-tier implementers, two-stage review), then wiring it live.

**What happened:** Four times in one session, work that was *declared done and unit-green* failed at the first integration boundary:
1. The API client: "50 tests passing," all against MOCKS. The first live call exposed three real bugs: the auth response had a different shape than the mock, a field arrived JSON-string-encoded, and the base URL needed a path prefix. The mocks returned convenient fakes, so the tests were green AND wrong.
2. The worker "booted" per its gate, but had no runtime installed - the classes were never actually served.
3. The progress file said "build not started" while two stages were already built.
4. A migration was "written" but never applied; it failed on the first real deploy (the database could not auto-cast the old column default).

**Transferable rule:** Treat "compiles + unit tests pass" as a *checkpoint*, not *done*. "Done" requires **one live integration pass per boundary**: the API call against the real service, the process actually booting and serving, the migration actually applying. On resume, re-verify inherited green before building on it.

Diagnostic corollary: **a good fix migrates the failure class outward.** When a fix moves an endpoint from a 500 (your code) to a 429 (the environment's quota), your layer is done. Read the failure's *class*, not just pass/fail.

**Confidence:** high (four cases, one session)   ·   **Promote?** yes

## Lesson: Bug SHAPES travel across layers - fix one, sweep every symmetric site, and budget one cross-cutting review per subsystem.

**What happened:** A quality review caught a boundary function returning a degenerate-but-plausible result for out-of-range input (the whole video as a "clip") and it was fixed - but its **symmetric twin** on the IN side survived, *and its spec test asserted the wrong expected value, so the test could never catch it.* A holistic review one layer up, by a different reviewer, caught the twin.

**Transferable rule:** Once you name a bug *shape*, enumerate every symmetric or analogous site - IN has an OUT, start has an end, the write path has a read path - and check them all. Budget one cross-cutting review pass over a subsystem, not only per-unit reviews. A test asserting the *wrong* expected value is worse than no test; it is a green light on a bug.

**Confidence:** high   ·   **Promote?** yes

## Lesson: Right-size review depth to risk - review depth is a third dial alongside model x effort.

**What happened:** Across ~12 implementer tasks: full two-stage review (spec reviewer, then quality reviewer) on the load-bearing hero logic caught real bugs; a lighter combined single-reviewer pass on small, tested, mechanical diffs was proportionate and still caught real issues. Docs got a code-read plus founder live-QA.

**Transferable rule:** Heavy two-stage review for new core logic, security/correctness-critical code, and the make-or-break feature; lighter combined review for small fixes, config, and mechanical threading. **Log the choice as deliberate, never a silent skip.** A misplaced reviewer wastes a few thousand tokens; a missed heavy review on the hero ships a silent bug.

**Confidence:** medium-high   ·   **Promote?** yes

## Lesson: When swapping a mock for the real dependency, test with a DISTINCTIVE input and assert the output reflects that input.

**What happened:** A real LLM on bad input hallucinates plausibly, and that is worse than an error: an empty transcript reached the model (a DTO drift meant the real text never arrived; the unit mock returned canned output regardless), and the model returned a confident, correctly formatted, completely off-topic result that sailed through a naive "something came back" check. Separately: a wire contract was unit-green on BOTH sides and still broken, because each side mocked its own idea of the contract and no test ever sent one real serialized request across the boundary.

**Transferable rule:** Distinctive input, output-reflects-input assertion, on every mock-to-real swap. A contract needs at least one test (or a shared/generated type) that exercises the ACTUAL serialized request across the boundary - two independent mocks of "the same idea" prove nothing about agreement. Add request validation so a contract violation is a clean 4xx, not a 500. And when a black-box dependency surprises you, read its pipeline and test plan end to end, not one file, before concluding what the consumer must do.

**Confidence:** high   ·   **Promote?** yes
