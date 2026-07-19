# Deviations Protocol

> Every drift from plan is logged. This is how the project learns. Drift that isn't logged becomes invisible damage.

---

## What Counts As a Deviation

Anything that changed from what was approved:
- Code that doesn't match its plan file
- A test that doesn't match its test plan
- An artifact that doesn't match its phase plan
- A decision that was reversed or modified mid-execution
- A scope item that was added, removed, or deferred
- A discovery that invalidates a prior assumption

**Small deviations count.** A typo correction isn't a deviation, but a renamed variable that's referenced in three plan files IS. Err on the side of logging.

---

## Discovery Sources (set at row creation, never edited)

| Source | When it's used |
|---|---|
| `Implementation` | Surfaced while executing a plan step. "I was building X and discovered Y." |
| `Pre-Pass` | Surfaced by the pre-verification read: before running a verification plan, read it against the current state of the artifacts. "Reading the plan against current state, I noticed Z." |
| `Test-Run` | Surfaced when a verification assertion failed. "Step 3.4 expected A but got B." |
| `Plan-Review` | Surfaced during a deliberate plan review session. "Reading Phase 2's plan in light of Phase 4's discoveries, I see C is now wrong." |

The Discovery Source is the row's permanent identity. If a deviation discovered during Implementation needs further work in Test-Run, that's a NEW row, not an edit.

---

## Consolidated States

| State | Meaning | When it's set |
|---|---|---|
| ⚪ No | Pending. Logged but not yet swept across plan files. | On row creation. |
| 🔵 Yes | Propagated. All plan files are consistent with this deviation's resolution. | After the Hardening sweep. |
| ❓ Legacy | Predates the Consolidated discipline. Needs its first sweep to confirm. | On import from older projects. |

A 🔵 can flip back to ⚪ if a later change re-introduces drift. The Hardening Sweep Log captures these flips.

---

## Canonical Row Format

The `deviations-register.md` Master Tracker table:

```
| ID | Discovered | Scope | Discovery Source | Status | Consolidated | Summary |
```

| Column | Format | Notes |
|---|---|---|
| `ID` | `<SCOPE>-<SOURCE>-<N>` e.g. `P3-IMPL-2` or `EXPORT-RUN-1` | Unique within project. SCOPE is `P<n>` when the project runs numbered phases, else a short milestone tag. SOURCE is `IMPL`/`PRE`/`RUN`/`REVIEW`. N increments per (Scope, Source). |
| `Discovered` | `YYYY-MM-DD` | Date of first logging. Never edited. |
| `Scope` | `Phase N` or the milestone tag | The scope active when discovered. |
| `Discovery Source` | One of the four above | Never edited. |
| `Status` | `🔴 Open` / `🟡 In Progress` / `🟢 Closed` | Workflow state. |
| `Consolidated` | `⚪ No` / `🔵 Yes` / `❓ Legacy` | See above. |
| `Summary` | One sentence. Imperative voice. | "Replace `cost = base × 1.07^owned` with `cost = base × growth^owned` in plan file P3.2." |

---

## Canonical Body Section

Every row in the Master Tracker has a corresponding body section in `deviations-register.md`:

```markdown
### P3-IMPL-2 - <one-line summary>

**Problem**
What was found. Be specific. Cite file paths and line numbers if applicable.

**Why (intent)**
What was the plan supposed to achieve here? Why did the divergence happen? This is the
"how this slipped through" analysis - usually the most valuable section for future Claude
sessions reading the register.

**Resolution**
What changed to fix it. Concrete: file edits, plan amendments, code changes. Include
commit hash if applicable.

**Anti-patterns rejected**
Other fixes that were considered and rejected, with reasons. This prevents the same
alternative from being re-attempted next time the issue surfaces.
```

The body section is the deviation's permanent record. The Master Tracker row is the index.

---

## Pre-Seeded Rules

Some entries are not defects but rules logged for visibility. Example: `RULE-REAL-EVIDENCE-ONLY` (Principle 9). These get pre-seeded into the register at project bootstrap with:

- `ID`: `RULE-<NAME>` (no phase prefix)
- `Status`: `🟢 Closed` (rules don't have an open state)
- `Consolidated`: `🔵 Yes` from creation
- `Summary`: one-line description of the rule

The body section describes the rule, the failure mode it prevents, and how to apply it.

---

## When To Log

**During execution:** the moment a deviation is recognized. Before the fix attempt. Even if the fix is "trivial" - log first, fix second.

**During verification:** when an `Expect:` line fails. Log the deviation BEFORE writing the fix.

**During plan review:** as discoveries surface. Don't batch them.

**During hardening:** the sweep itself doesn't create new deviations; it processes existing ones. But if a sweep surfaces a previously-unnoticed drift, log it as a new `Plan-Review` deviation.

---

## When NOT To Log

- Typo fixes that don't change meaning
- Markdown formatting adjustments
- Pure whitespace / linting changes
- Trivial naming changes that don't appear in other plan files

If in doubt: log. The cost of a noisy register is far lower than the cost of invisible drift.

---

## Hardening Sweep Discipline

The Hardening sweep (run before promoting a phase or milestone) operates on the register, not the codebase. It reads each ⚪/❓ row and verifies that every plan file is consistent with that row's Resolution.

When the sweep finds a contradiction:
1. Edit the plan file in place.
2. Note the edit in the Hardening Sweep Log.
3. After the sweep completes, flip the row to 🔵.

When the sweep is clean:
- No edits needed.
- Row flips to 🔵.

The sweep log is append-only. Each phase's promotion produces one sweep log entry.
