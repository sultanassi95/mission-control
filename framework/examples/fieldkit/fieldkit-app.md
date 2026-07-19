# fieldkit-app - project spoke

**Path:** `./fieldkit-app` (portfolio root; moved in at liftoff)

## Git-memory
- **base_branch:** main
- **branch_convention:** feat/<kebab-slug> (observed: `feat/t-001-offline-sync`)
- **remote:** private origin on the founder's account
- **tracker:** tasks (the native board in `./tasks/`)

## Deep context (from the liftoff scan)
- Node 20 (per `package.json` engines); tests via vitest; local-first
  storage on SQLite, sync over a small REST API.
- `main` is stable; active work is the offline-sync conflict handling
  (T-001, branch `feat/t-001-offline-sync`).
- Known constraint: field devices are old Androids - bundle size and
  battery are real budgets, not aspirations.

## Sub-agent identity header (dispatch with this)
front: fieldkit · project: ./fieldkit-app · trust: founder-owned ·
base: main · convention: feat/<slug> · the git rule applies (branch-first
carve-out only) · one record per dispatched task.
