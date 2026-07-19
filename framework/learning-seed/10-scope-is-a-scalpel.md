# Scope Is a Scalpel

## Lesson: Interpret a founder override as a scalpel, not a blanket.

**Context:** The founder said "don't do testing" on a delivery run. The session read it as "skip all verification." What the founder meant: skip the two heavyweight items (browser end-to-end + manual smoke), NOT code review, NOT unit tests.

**Transferable rule:** An override names the specific thing the founder wants skipped. Everything not named stays. When the boundary is genuinely unclear, ask one precise question ("skip only the browser e2e, or unit tests too?") - a scalpel question costs one line; a blanket misread costs a re-run.

**Confidence:** high   ·   **Promote?** yes

## Lesson: One delivery flow = one ticket = one branch. New mid-flow work stays on the current branch or gets asked about.

**Context:** Mid-delivery, adjacent work surfaced and the tempting move was to open a second ticket and branch unprompted.

**Transferable rule:** Never create a ticket or branch unprompted. One flow invocation carries authority for exactly one ticket and one branch; anything new that surfaces either rides the current branch (if it is genuinely in scope) or gets presented as a candidate for its own flow later.

**Confidence:** high   ·   **Promote?** yes

## Lesson: Drive the CURRENT ticket proactively; defer everything outside it. And "implement X first" is ordering, not a stop-gate.

**Context:** Two complementary corrections. One session under-drove (waiting for instructions on the active ticket); another over-drove (drifting into adjacent improvements). A third paused mid-feature because the founder had said "build X first," reading it as "build X, then stop."

**Transferable rule:** Within the active ticket: proactive, no permission-asking, finish the whole workflow before reporting. Outside the active ticket: log it, defer it, never build it. "X first" means X is the first item of the sequence you finish, not the last item you do.

**Confidence:** high   ·   **Promote?** yes
