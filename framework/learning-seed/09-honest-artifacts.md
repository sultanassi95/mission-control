# Honest Artifacts - Never Force a Green

## Lesson: Never delete a control, column, or feature to hide a bug. Fix the cause, or get explicit founder sign-off before removing UI.

**Context:** A defective control was "fixed" in a draft by removing it. The founder's correction was categorical: amputation is not a fix; it silently trades a visible defect for an invisible capability loss the founder never approved.

**Transferable rule:** A bug in feature X is never authorization to remove feature X. Fix the cause; if removal genuinely seems right, that is a product decision - present it and wait.

**Confidence:** high   ·   **Promote?** yes

## Lesson: Wire every stat end-to-end to its natural source; no dummies, stubs, or fake zeros.

**Context:** A dashboard draft shipped a metric hardcoded to a placeholder because the real source needed one more join.

**Transferable rule:** A number a founder can see is a claim. Every stat is wired to its real source or it does not ship; dropping a metric entirely is the founder's product call, not the implementer's shortcut. A fake zero is worse than an empty state - it reads as truth.

**Confidence:** high   ·   **Promote?** yes

## Lesson: Never code around a data or environment failure to force a QA green. Golden-path QA runs from a clean slate.

**Context:** An end-to-end QA hit a data-shape failure mid-run; the tempting move was to special-case the bad record so the run could finish green.

**Transferable rule:** A QA run's job is to tell the truth about the system. Coding around a failure converts the QA from an instrument into a decoration. Reset to a clean slate, run the golden path (one item first, then the batch), and let failures fail - each one is the product surfacing a real defect. Workarounds go in the defect ticket, not the test path.

**Confidence:** high   ·   **Promote?** yes
