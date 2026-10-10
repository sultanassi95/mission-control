# Sub-agent IO Record Schema

> Every sub-agent returns **exactly one** Markdown record. It is the audit trail - the "responsible CTO who reports" made literal.

**Filename:** `records/NN-<scope>-<agent>.md` (zero-padded sequence, so the trail reads in order).

## The brief - a hypothesis the agent can falsify

The record answers a brief, and the brief states a mechanism the orchestrator
has not executed. Write it so the agent can refute it, and read a refutation as
information rather than as the agent getting it wrong. Every brief carries
three parts, in this order:

```markdown
**Goal:** <the outcome, binding>
**Constraints:** <what must stay true - scope, files, bans, budgets - binding>
**Mechanism as belief:** <the orchestrator's current belief about HOW, each
item with the check that would settle it - "bound the client to one attempt,
and assert the attempt count in a test", never "set max_attempts to 1">
```

The agent holds the API, the file and the error message, so it is better placed
than the brief to be right about mechanism. When its evidence contradicts the
brief, the record says so (`status: brief refuted`, below) and the orchestrator
changes the brief AND the ticket's acceptance criteria, not only the code: a
criterion derived from a wrong mechanism fails a correct implementation at
review. Three briefs were refuted by their agents in one real session - a retry
key that counted retries rather than attempts, a shared helper hardened in
place that changed two unrelated production paths, a bucket assumed mesh-only
that also carried documents - and each refutation was cheaper than the defect.

A reviewer's brief adds one line: any finding the reviewer cannot settle from
the diff carries the one command that would confirm or refute it. A conditional
finding costs a command to close; an unhedged wrong one costs an argument or a
change.

## The record

```markdown
---
task: <one line - what this agent was asked to do>
agent: <agent name>
model_used: <model x effort as dispatched + reason in 3-6 words>
effort_used: <low|medium|high|xhigh|max + reason in 3-6 words>
inputs: <exact files / sections / URLs consumed>
date: <YYYY-MM-DD>
status: <complete | partial - reason | brief refuted - the claim, and the evidence that refutes it>
---

## Findings
<the scoped output, in the format the parent expects>

## Sources
- <URL> - <what it supports>   (real quotes < 15 words, one per source; paraphrase the rest)

## Notes for orchestrator
<assumptions made, gaps, anything flagged [UNVERIFIED]>
```

**Rules:** one job per agent · minimum context in · no side effects outside scope · if a task needs more than ~2 prior records as input, re-decompose. The parent integrates from records, never from raw sub-agent context.

**Two rules that keep a record a summary rather than a second context:**

- **Cap it at 150 lines.** A record past that is not a summary of the work, it is the work again, and the parent's context pays for it twice. A phase that cannot report inside the cap was scoped too wide.
- **Point, do not characterise.** Name artifacts by path - the diff, the output file, the failing test - rather than describing them. "A whole-file prefilter was added for performance" carries none of the detail that made such a change wrong once; the diff path does. A record that characterises an artifact without giving its path goes back to the agent rather than being integrated.
