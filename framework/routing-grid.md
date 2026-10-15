# Routing Grid - model x effort

> The token-economy core. **Two independent dials, both set deliberately for every sub-agent.** The defaults below were earned empirically on the source system's real orchestration runs.

```mermaid
flowchart TB
  T{Task class?}
  T -->|mechanical: fetch, extract, copy, reformat| M["cheap tier / mid tier · low"]
  T -->|breadth: discover, mine, audit, assemble| B["mid tier · medium"]
  T -->|high-judgment: cross-source reasoning| J["frontier tier · high"]
  T -->|deepest synthesis under ambiguity| D["frontier tier · xhigh (max only if evals show headroom)"]
  T -->|orchestration: plan, route, integrate, report| O["frontier-class · high (xhigh for final synthesis)"]
```

## The two dials

- **`model:`** - *which* brain: the cheap tier / the mid tier / the frontier tier (or a full model ID, or `inherit`).
- **`effort:`** - *how hard it thinks*: `low` / `medium` / `high` / `xhigh` / `max`. **State it on every dispatch.** Defaults differ by model generation (the current frontier-tier model answers at `medium` on the API where its predecessor answered at `high`) and the harness default moves between versions, so a dispatch that omits effort inherits a number nobody chose. The Agent tool takes `effort` directly; on a harness where it does not, the dial reaches a dispatch only through its prompt. Cheap, mechanical work steps *down* explicitly - that's where the savings hide.

Orthogonal: a cheap model at high effort, or a strong model at low effort, are both valid. Don't assume "bigger model = more thinking."

Per invocation, skills surface the effort dial as `--thinking <low|medium|high|xhigh|max>` (the skills README's universal dials): it sets deliberation depth in the running session and the literal effort on dispatches; it cannot re-dial the harness's own session effort - a large mismatch is surfaced, never silently fought.

## Rules of thumb

- **Escalate on evidence, not anxiety.** Start at the lowest model + effort that could plausibly hold the bar; only re-run higher if the output *actually* fails. Record the escalation as a lesson.
- **High-judgment does not mean max effort.** A rubric is a scaffold that lets you hold *effort down* while keeping the *model up*.
- **Token economy is a tracked metric.** Each status report states roughly which model x effort did which task and why. (The `/spend` skill reads this from the dispatch records.)

## Proven defaults (evidence: the source system's routing lessons)

| Lesson | Rule |
|---|---|
| The frontier model earned its cost **exactly once** on a five-stage research run - at the rubric-bounded scoring step; `max` there would have bought nothing | Reserve the frontier model for the one step where judgment is cross-source AND the cost of a plausible-but-wrong answer is highest |
| The mid tier held the bar for **all** breadth + assembly; escalation never fired | Default breadth/assembly to mid-tier; escalating "to be safe" burns the budget the discipline exists to protect |
| A generic executor + `model` override survived custom-agent failure mid-session | Keep task prompts portable; the model dial is the durable lever, the named-agent wrapper is convenience |
| Long single-shot generation timed out; interleaved write-one-section-per-call completed | Stage long input+output generation (Write, then Edit-append per section). Each tool call resets the idle timer |

## Per-session ceilings (levers)

- `CLAUDE_CODE_SUBAGENT_MODEL=<model>` - pin every sub-agent's model.
- `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL=<model>` - pin every Workflow agent's model. [UNVERIFIED] the variable name and the harness version that introduced it; check your harness's settings reference before relying on it.
- `CLAUDE_CODE_EFFORT_LEVEL=low|medium` - pin effort globally.
- `/effort low|medium|high|xhigh|max` - interactive thinking depth (`low/med/high` persist; `max` resets at session end).
- Resolution priority (both dials): env var > invocation > frontmatter > session default.

## Fan-out is where the budget dies

> A mis-sized single sub-agent wastes cents. A mis-sized **fan-out** wastes the window. A real incident from the source system: one saved research **workflow** fired **107 agents at frontier-model max effort** and burned roughly 60 percent of the token window in a single opaque call - because saved workflows and global skills set **no model override**, so their agent calls **inherited the session model + max effort**.

**The hazard's cause is gone; the discipline is not.** The one-call fan-out tool now takes a `model` and an `effort` per `agent()` call, a hard `budget` ceiling that throws when spent, and an env pin for every workflow agent. So the recommendation is no longer a blanket deny: admit it only when every `agent()` call states model and effort, the script sets a `budget`, and the batch gets the sizing heads-up like any other parallel batch. A script missing any of the three is the 107-agent shape and stays denied. Your instance's `CONSTITUTION.local.md` records which way you chose. The console fleet's guard goes further: a Controller or its back room is refused the Workflow tool outright, so a workflow is only ever run by Flight.

**Incremental, per-agent-sized dispatch stays the default:**
- **Per-task dials are native** - each dispatch carries its own `model` (+ effort where supported). This IS the two-dial control one-call fan-outs lack.
- **Visible + incremental** - agents are dispatched one (or a few) at a time and each is reported back, so a runaway burn cannot happen silently.
- **Plan-before-spend still applies** - for any *parallel* batch, state the size (# agents x model x effort) and get an explicit go first.
- **The Controller back-room budget is a standing go.** Staffing a Controller states its budget (`/console staff --budget`, default 4, at most 20): the number of its own sub-agents it may keep in flight without asking Flight. The fleet guard denies a spawn past it, so the budget is a control and not a request. The founder's go at staffing, on the sized line `<n> Controllers x model x effort, back-room budget <b> each`, covers the budget; a Controller needing more reports it as a blocker rather than batching past it, and is restaffed with a larger `--budget`.
