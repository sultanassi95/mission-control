# <front> - dependency map

> Single source of inter-project dependency truth for this front.
> Written by /map-front; edges updated (or marked stale) by scoped
> /debrief when a contract surface changes; freshness checked by
> /preflight. Spokes and the hub POINT here - never duplicate.

**Mapped:** depth 1: <YYYY-MM-DD> · depth 2: <date or "-"> · depth 3: <project: date, or "-">

```mermaid
flowchart LR
  A["<project-a>"] -->|api| B["<project-b>"]
```

## Edges

| From (dependent) | To (dependency) | Kind | Over | Confidence | Surfaces (depth 2) |
|---|---|---|---|---|---|
| <project-a> | <project-b> | api | <one line: what rides this edge> | detected \| confirmed | <endpoints / exports / schemas - depth 2 only> |

Example row: `beeline-site | beeline-crm | api | invoice read endpoints | confirmed | GET /api/invoices, GET /api/invoices/:id`

## Depth-3 consumption (per project, only where run)

### <project>
- <dependent> uses: <exact functions / endpoints / types>

## Cross-front edges (manual)

| From | To | Kind | Over |
|---|---|---|---|
| <other-front>/<project> | <project-here> | library | <one line> |
