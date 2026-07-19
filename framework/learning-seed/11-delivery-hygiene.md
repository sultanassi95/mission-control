# Delivery Hygiene

## Lesson: Every task artifact (ticket, PR, tracker row) gets a specific title + a comprehensive description. No placeholders.

**Context:** A standing founder rule after thin tickets ("fix the bug") cost review time reconstructing context that the author had and discarded.

**Transferable rule:** The title is a Conventional-Commits-friendly imperative that mirrors the eventual PR title; the description carries context, evidence, repro, expected vs actual, proposed approach, test plan, acceptance criteria, and out-of-scope. The five minutes at filing time repay themselves at every later read.

**Confidence:** high   ·   **Promote?** yes

## Lesson: Size review fan-out to the diff; one broad reviewer beats five overlapping ones on typical work.

**Context:** A moderate diff (roughly 560 lines) was reviewed by five parallel angle-reviewers; most findings overlapped and the tokens bought no additional finding classes.

**Transferable rule:** Up to ~500 changed lines or a typical bug fix: ONE focused reviewer (correctness + silent-failure combined). 500 to 1500 lines or multiple layers: two. Only a genuinely architectural change earns three to five angles, and a full multi-angle sweep is reserved for pre-release, explicitly flagged. Save the fan-out for changes with genuinely different failure modes at different layers.

**Confidence:** high   ·   **Promote?** yes

## Lesson: Comments are frugal by default; the commit message and PR body carry the reasoning.

**Transferable rule:** Default NO comment; when one is warranted, ONE tight line stating a constraint the code cannot show - never a docstring block on internal code, never a section-header comment, never "talking to the reviewer." Context, reasoning, and contract notes go in the commit message and PR body, where they inform without rotting in source.

**Confidence:** high   ·   **Promote?** yes

## Lesson: A bulk action is ONE request and ONE transaction, never a fan-out of per-item calls.

**Context:** An "assign N items" feature drafted as N sequential client calls: slow, partially-failing, unatomic.

**Transferable rule:** Assign/import/list N items is one request carrying the N, one server-side transaction, one success-or-failure. If the API only offers per-item calls, build the bulk endpoint or wrap the loop server-side; never ship the client-side fan-out.

**Confidence:** high   ·   **Promote?** yes
