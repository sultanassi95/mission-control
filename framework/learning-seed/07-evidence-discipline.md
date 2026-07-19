# Evidence Discipline - Root Cause Before Fixes; Repros and Logs Can Lie

## Lesson: For ANY defect, prove the cause with literal evidence before proposing a single fix. Guessing is the slow path that ships new bugs.

**Context:** A standing correction earned across multiple fronts: fixes proposed from theory cost founder corrections and retries; fixes proposed from instrumented evidence landed first time.

**What happened:** The pattern repeated enough to become doctrine: reproduce the failure, instrument the boundaries, isolate ONE variable, prove the cause, THEN make one fix and verify it. Every time a session skipped ahead to a plausible fix, the "fix" treated a symptom and the defect resurfaced wearing different clothes.

**Transferable rule:** Systematic debugging is the DEFAULT method for any defect (test failure, wrong output, flaky behavior, build break), not a heavyweight reserved for hard cases. No fix before the cause is shown with literal evidence.

**Confidence:** high   ·   **Promote?** yes

## Lesson: A synthetic reproduction that doesn't reproduce the bug is evidence about your repro, not about the bug.

**What happened:** A founder-observed UI bug refused to reproduce under synthetic events - because synthetic events miss what real input carries (trusted-event flags, native gesture timing, focus order). Diagnosing from the failed synthetic repro would have concluded "cannot reproduce, probably fixed."

**Transferable rule:** When a synthetic repro does not reproduce a human-observed bug, ship the human a paste-able probe (a DevTools snippet, a logging build) and diagnose from the REAL trace. Do not downgrade the bug because your imitation of it passes.

**Confidence:** high   ·   **Promote?** yes

## Lesson: A one-time old ERROR line in a log is not current state.

**What happened:** A session found an ERROR in a log snapshot and reported the system "still broken" - but the line was hours old, from before the fix, and successor lines after that timestamp showed clean runs. The claim extrapolated a stale snapshot into a present-tense fact.

**Transferable rule:** Before claiming "still broken" from a log, query for successor lines AFTER the timestamp of the error you found. A log is a history, not a status; the newest relevant line is the status.

**Confidence:** high   ·   **Promote?** yes
