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
