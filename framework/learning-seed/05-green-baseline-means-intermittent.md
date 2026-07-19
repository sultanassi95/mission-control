# A Green Baseline on the Same Commit Means "Intermittent," Not "Regression"

## Lesson: When a bug is blamed on a recent change, first prove the change is even the variable - before reproducing-to-fix.

**Context:** A failure was framed as a regression a feature branch introduced: "the engine ran clean for ages; it broke only on this branch." The directed plan: run the paid end-to-end on the branch, reproduce the regression, fix it.

**What happened:** Before spending a cent, two read-only checks overturned the premise:
- **git:** the branch's last commit predated the failure, working tree clean - no code had changed between the good day and the bad day.
- **the branch's own benchmark records:** a 5-run end-to-end had passed 5/5 GREEN the day before, on the exact commit that "broke" 4/5 the day after. The new failures were network errors and a third-party timeout, with zero rate-limit responses.

Same code, one run 5/5 and the next 1/5 means **intermittent / environmental**, not a deterministic regression that a green e2e would expose or fix. Re-running to green would have proven nothing; it may just pass on a good day.

**Transferable rule:**
1. **`git log` / `status` first** - did the suspect code actually change between the good run and the bad run? Identical commit means NOT a code regression.
2. **Find a prior green run on that same commit** (benchmarks, CI, logs). A green baseline on the same code means the failure is intermittent or conditional (network, load, ordering, resource lifecycle).
3. **Re-aim:** detect-first (make the failure observable so a green run can't hide it), then reproduce under the conditions that actually trigger it, then root-cause. Don't burn a paid end-to-end hoping the bug shows.

The orchestrator's value here was not executing the plan faster - it was catching, with two cheap checks, that the plan's premise was wrong, and re-aiming before spending. "Defend positions with evidence; capitulation isn't service." A green-baseline check belongs in every "regression" intake.

**Confidence:** high   ·   **Promote?** yes
