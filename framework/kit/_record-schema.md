# Sub-agent IO Record Schema

> Every sub-agent returns **exactly one** Markdown record. It is the audit trail - the "responsible CTO who reports" made literal.

**Filename:** `records/NN-<scope>-<agent>.md` (zero-padded sequence, so the trail reads in order).

```markdown
---
task: <one line - what this agent was asked to do>
agent: <agent name>
model_used: <model x effort as dispatched + reason in 3-6 words>
effort_used: <low|medium|high|xhigh|max + reason in 3-6 words>
inputs: <exact files / sections / URLs consumed>
date: <YYYY-MM-DD>
status: <complete | partial - reason>
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
