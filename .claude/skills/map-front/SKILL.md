---
name: map-front
description: >-
  Maps a front's inter-project dependency graph at a founder-chosen depth
  and writes it to the front's _map.md - so a change to one project can
  never blindside its dependents. Detect-first with a STOP gate; depth 1
  is cheap structure, depth 2 names the contract surfaces per edge, depth
  3 is call-site consumption for one project. Use whenever a front has
  multiple intersecting projects and the founder says "map the front",
  "who depends on this", "blast radius", or types /map-front.
---

# Map Front

At scale the dangerous question is not "what is project A?" (the spoke
answers that) but **"if I change A, who feels it?"** This skill builds
the answer once and keeps it consultable: `/mission-flow` reads it before
work ships, `/triage` notes dependents on filed tasks, `/preflight`
checks it stays fresh.

## Invocation

`/map-front --front <name> [--depth 1|2|3] [--project <name>]`

State the honest cost BEFORE scanning, from the table:

| Depth | Name | Maps | Cost at ~30 projects |
|---|---|---|---|
| **1** (default) | Structural | Project-to-project edges: who depends on whom, edge kind (`library / api / data / build-artifact / deploy`), one line "over what" | one session, cheap |
| **2** | Interface | Per edge, the contract surfaces it rides on: exports, endpoints, schemas/tables, queues, env contracts | moderate - reads interface files per edge |
| **3** | Consumption | Exact call sites: which functions/endpoints/types of the target each dependent actually uses | expensive - **requires `--project`**; maps ONE project's inbound + outbound, never a whole front |

Re-running at a higher depth ENRICHES the map (confirmed edges keep
their confirmations); same depth refreshes. Every edge carries
`confidence: detected | confirmed`; the map header carries `mapped:`
dates per depth.

**Dials:** `--spend` maps coarsely onto depth (lean = depth 1, standard
= depth 1 + the confirmations pass, deep = depth 2); `--depth` remains
the precise control and wins when both are given. `--thinking` (default
medium - edge inference) and `--verbosity` per the universal grammar.

## Procedure

1. **Read the front** - hub, every spoke - so the scan knows the project
   set and each project's location (moved-in or registered-in-place).
2. **Scan, read-only, per depth.** Depth 1 sources: manifests (sibling
   package deps), lockfiles, compose/infra files, API base URLs in
   config, shared schema or proto paths, build scripts consuming another
   project's artifacts. Depth 2: open the interface files behind each
   depth-1 edge and list the surfaces. Depth 3 (one project): import and
   call-site scan across its dependents.
3. **Present the draft** - the graph + edge table, each edge marked
   `detected` with its evidence (the manifest line, the config URL).
   **STOP: the founder confirms, corrects, or adds edges the scan cannot
   see** (runtime coupling, conventions, planned dependencies).
   Confirmed edges flip to `confidence: confirmed`.
4. **Write:**
   - `_command/portfolio/<front>/_map.md` from
     `framework/kit/templates/_map.template.md` - the single source.
   - Each spoke's two pointer sections (`Depends on` / `Depended on by`)
     - one line each, naming counterparts and linking the map. The
     spoke's identity header gains: `dependents: <N> inbound - check
     _map.md before changing contracts`.
   - One link line in the hub if absent.
5. **Report:** node and edge counts, confirmed vs detected, any cycle
   (cycles are findings, not errors - name them), and the suggested next
   step ("depth 2 on the 4 edges into the engine" beats "depth 2
   everywhere").

## Rules

- **Single source:** edges live in `_map.md` ONLY; spokes and hub point.
  No narrative in the map - edges and surfaces; the WHY of a dependency
  belongs in the spoke if it matters.
- **Cross-front edges** (a library another front consumes) are recorded
  with a `<front>/` prefix on the counterpart - added manually at the
  STOP gate; the scan stays within the front.
- **Staleness is visible:** a scoped `/debrief` that changed a mapped
  contract surface updates the edge or marks it `stale: <date>`. The map
  never silently lies; `/preflight` flags a map older than ~30 days or
  older than the front's last structural change.
- Non-git and registered-in-place projects map identically - the scan
  follows the spoke's recorded path.
