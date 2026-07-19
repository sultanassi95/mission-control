# Verify the Terminal Artifact, Not the Green Checkpoints

```mermaid
flowchart LR
  A["stage events: complete x5 OK"] --> B["index built: true OK"]
  B --> C["status list: 5 done OK"]
  C --> D["...yet the search finds 1 of 5 items"]
  classDef ok fill:#14532d,color:#fff
  classDef bad fill:#7f1d1d,color:#fff
  class A,B,C ok
  class D bad
```

## Lesson: A pipeline can report success at every checkpoint while most of its work silently failed in a non-terminal stage. Trust the final artifact the user consumes, not intermediate event counts.

**Context:** A clean-slate end-to-end of a five-item ingestion pipeline feeding a search index.

**What happened:** Every surfaced signal said success: completion events fired for all five items, the index reported built, the per-item status list showed five done. **But search returned only one item, no matter the query.** The failures lived in non-terminal queues (a retry-exhausted stage; a job killed by a network error) whose partial output never propagated an "incomplete" signal. Four of five items were silently dropped at two different stages. Intermediate counts even tempted a "3 of 5" conclusion; the terminal store's actual point count proved it was 1 of 5.

**Transferable rule:** When a pipeline claims done, **query the thing the user will actually consume** (the search index, the rendered file, the row in the database), broken down by the unit that can partially fail. A green checkpoint is a *promise*, not a *receipt*. A non-terminal-stage failure with no completeness signal is a product bug, not an ops blip: the durable fix is (a) mark the unit terminally `failed` rather than leaving it looking done, and (b) expose an "X usable / Y total" signal downstream. The cost of the discipline was four read-only queries; the payoff was the difference between reporting a false green and reporting the truth.

Boundary corollary: copies and coordinate systems bite at integration seams (an export double-trimmed because two source branches emitted different coordinate systems consumed identically; a dependency was a copy, not a symlink, so a rebuild never reached the runtime). Both invisible to unit tests; both only surfaced by driving the real artifact end to end.

**Confidence:** high   ·   **Promote?** yes
