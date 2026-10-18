---
repo: fieldkit-app
front: fieldkit
path: fronts/fieldkit/fieldkit-app
remote: private origin on the founder's account
trust: yours
tracker: tasks
base_branch: main
branch_convention: "feat/<kebab-slug> (observed: feat/t-001-offline-sync)"
write_posture: "branch-from-base OK; never add/commit/push unless the founder asks"
build: "pnpm build"
test: "pnpm test"
run: "pnpm dev"
key_dirs: "src/sync (merge + REST client), src/db (SQLite), src/ui"
gotchas: "field devices are old Androids - bundle size and battery are real budgets, not aspirations"
---

# fieldkit-app - repo context (spoke)

> The one repo of the fieldkit front: an offline-first field-data app, local-first
> storage on SQLite, sync over a small REST API. Moved into the front's folder,
> `fronts/fieldkit/`, at liftoff (hub: [_front.md](./_front.md)).

## Layout / where things live
- Node 20 (per `package.json` engines); tests via vitest.
- `main` is stable; active work is the offline-sync conflict handling (T-001,
  branch `feat/t-001-offline-sync`).

## How to work in it
- Known constraint: field devices are old Androids - bundle size and battery are
  budgets to measure against.
- The git rule applies: the branch-first carve-out only. One record per
  dispatched task.

_Up: the front hub `_front.md` (beside this file) · the portfolio picture `_command/mental-model.md` · the rules `framework/CONSTITUTION.md` from the portfolio root_
