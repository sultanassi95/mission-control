# Verify Before Deferring

## Lesson: Before calling work environment-gated, blocked, or "needs new infra," check what is actually on the machine and how the thing is ALREADY shipped or built - then adopt the existing convention.

**Context:** Two same-day cases on one front. First: a dependency-lock update was deferred as "blocked on cloud access," when a read-only local credential profile already on the machine could do it. Second: a proposal to add a bundler to a frontend, when the repo already shipped fine without one (ES modules + an import map - the convention just had not been read).

**What happened:** In both cases the "blocker" dissolved under five minutes of checking: list the credential profiles and their scopes; read how the deployed artifact is actually produced. The deferral would have cost a day and the new infra would have contradicted the repo's own working convention.

**Transferable rule:** "Blocked" is a claim that requires the same evidence bar as "fixed." Before deferring or adding infrastructure:
1. Inventory what the machine already has (credential profiles, runtimes, tokens, tools) - read-only checks are free.
2. Read how the thing is ALREADY built, shipped, or deployed; the existing convention outranks your default toolchain.
3. Only then defer, naming the specific missing thing and who owns it.

**Confidence:** high (two same-day cases, both dissolved)   ·   **Promote?** yes
