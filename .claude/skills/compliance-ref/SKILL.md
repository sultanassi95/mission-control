---
name: compliance-ref
description: >-
  Binds, lists, or removes a per-front profile block (compliance or quality)
  in that front's hub - the founder's command for declaring the standards a
  front answers to, e.g. /compliance-ref --add --front <name> --standards
  soc2 --monitor <collector>. mission-flow reads whatever the block declares;
  fronts declaring nothing pay nothing. Use whenever the founder types
  /compliance-ref or asks to declare, inspect, or remove a front's compliance
  or quality standards.
---

# compliance-ref

The founder's writer for per-front profile blocks. The framework stays
vendor-free by construction: standard and vendor names live only in instance
data this skill writes into `_command/portfolio/<front>/_front.md`, never in
`framework/` or a skill's own text.

## Grammar

```
/compliance-ref --add    --front <name> [--profile compliance|quality]
                         --standards <a,b,...> [--monitor <name>]
                         [--evidence <surface,...>]
/compliance-ref --list   [--front <name>]
/compliance-ref --remove --front <name> [--profile compliance|quality]
```

`--profile` defaults to `compliance`.

## Behaviour

- **--add** writes the block below into the named front's hub, after
  `## Cross-repo constraints`. Idempotent: an existing block of the same
  profile is REPLACED, never duplicated. Read the written block back and show
  it. An unknown front stops with the list of known fronts.
- **--list** prints each front's profile blocks verbatim (scoped by `--front`
  when given).
- **--remove** deletes the named block and shows the removed text.
- Founder-gated by construction: only the founder runs this skill. It edits
  the instance hub only - never `framework/`, never a project repo.

## The block it writes

```
## Compliance profile        <- or: ## Quality profile
- standards: <soc2, ...>     # names the control families P5's trigger widens to
- monitor: <collector>       # the product sampling evidence; sets where P7 evidence lands
- evidence_surface: <github-prs, jira>
```

## Schema notes

- **standards -> control families.** `soc2` maps to: access control,
  encryption, audit logging, data retention, sensitive-data paths. A new
  standard added to the schema documents its families here.
- **A monitor is a collector, not a standard.** The two are different kinds -
  one is what an auditor certifies against, the other is a product watching
  the repos - and they are never merged into one list.
- **Quality profile keys** (readers land with the quality-lens ticket):
  `tokens_source`, `perf_budgets`, `a11y_contract`, `telemetry_idiom`,
  `docs_surface`.
- **A secret never enters a profile.** A profile names mechanisms and
  surfaces, never values or credentials.
