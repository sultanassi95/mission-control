# Changelog

All notable changes to the framework and skills. Cloners: after
`git pull upstream main`, read the entries since your last pull - doctrine
changes should never reach you silently.

## Unreleased (pre-publish)

- 2026-09-03: Phase 8 closes the loop it was already pointing at. The tracker
  ticket is transitioned to review (transitions discovered, not assumed); the
  report carries lesson candidates (a handoff buffer for /debrief, writing to
  no lesson store), the decisions taken (deviation ids, stops and their
  resolutions, /adr proposals for settled forks - founder-gated), and a
  zero-untracked-loose-ends rule: every pending item has an id or a stated
  reason it does not. (MC-025)

- 2026-09-03: Phase 7 closes two small honesty gaps: the reconcile step
  re-verdicts acceptance criteria that changed after Phase 5 ran, and the
  freshly opened PR's mergeable state is read and reported (conflicting paths
  named; rebasing a reviewed branch stays the founder's call). (MC-023)

- 2026-09-03: Phase 5's specialty reviewer slots become named lenses
  (silent-failure, test-coverage, type-design) dispatched as prompts on
  weak-tool agents with the diff file - never the stock full-toolset agents
  against a live tree. Risk class now trumps line count: auth, secrets,
  input-parsing and boundary diffs get a security-lens pass at any size.
  Real-but-out-of-scope findings must persist (ticket or new tracker item),
  and a non-trivial polish commit gets one bounded re-pass. (MC-020)

- 2026-09-03: Phase 4 stops trusting its own machinery. A red check must be
  proven to have APPLIED (failure message matches the root cause; every new
  check broken once and restored; injections self-report and are asserted);
  per-commit green lands as literal output in the record with an orchestrator
  spot-check on longer stacks; merge-back conflicts get a protocol (trivial =
  resolve and note, semantic = re-dispatch rebased); and deviations are logged
  to the project register before a unit's merge is accepted. (MC-019)

- 2026-09-03: Phase 3 grows its missing protocols. A dirty tree is a
  stop-with-inventory (never an unasked stash - the files may be the founder's
  in-flight work); switching the shared checkout is flagged when a dev server
  watches it (the shared-stack rule applies from the FIRST switch); and
  `--base <branch>` / a spoke `integration_branch` supports stacked and epic
  bases with the same --no-track + upstream proof. (MC-018)

- 2026-09-03: Phase 1 made honest and probe-bound. The task path no longer
  describes mid-run alignment that autonomy forbids - the investigator returns
  a proposed approach plus explicit forks (genuine forks stop, trivial ones
  are settled on the record). Both paths verify a requested mechanism against
  ground truth before adopting it, data-path work resolves one real identifier
  and probes one item before bulk, Phase 2 verifies the Phase-1 record landed,
  and the default investigator is a read-only explorer. (MC-014)

- 2026-09-03: every mission-flow run now surfaces itself as a per-phase
  session task list (P0-P8, one task per phase, refreshed per ticket, one
  fresh list per epic child) - the founder's real-time window into an
  autonomous run is doctrine, not habit. (MC-027)

- 2026-09-03: work is probed for prior delivery before anyone investigates it.
  Phase 1's first move on both paths searches the base branch's history for
  the ticket key and feature terms (a hit is a stop-with-evidence), and
  /triage's deep dial runs the same scan per intake item. On two real epics,
  3 of 8 tickets were already delivered before work started. (MC-015)

- 2026-09-03: Phase 6 hardened four ways: prove the artifact under test is the
  edited source (and error-path harnesses prove fidelity + firing); the
  terminal assertion is the one the ticket DECLARED at Phase 2, swapped only
  by logged deviation; bulk changes verify by reconciliation (probe one
  before, reconcile count + bytes after - exit 0 is not completeness); and
  deploy-path diffs run the deploy path's own dry checks before the PR exists.
  Incidents: learning/08, /11, /15, /16; the hydrate-secret silent exit. (MC-024)

- 2026-09-03: Phase 2 gains four gates. Dedup first: an issue already tracked
  is extended, never re-filed. Criteria are evidence-typed at write time and
  the ticket declares its terminal assertion (executed at Phase 6). Tickets
  under an output-declaring parent name the outputs they claim, so a phase
  split across tickets cannot silently drop its remainder. And `--parent <key>`
  files small work under its epic or parent task directly. (MC-016)
- 2026-09-03: Phase 0 speaks /triage's intake vocabulary - five kinds, with
  decision-for-founder and info-only as explicit exits - announces its
  classification with a one-line rationale, and owns mid-flow reclassification
  (same ticket, switched discipline). Phase 1 is renamed **Investigate**: the
  phase investigates; /triage triages. The name collision was found while
  teaching the flow. (MC-013)

- 2026-07-29: The instance is local, and it is now enforced rather than
  described. `_command/` was documented as gitignored in `task-board.md` and in
  the spoke template while `.gitignore` re-included it with a negation, so an
  operator's instance - doctrine overlay, founder profile, spokes for
  confidential fronts, boards, learning log - was untracked but not ignored, one
  `git add -A` from a commit in a public repo. The negation is gone and the
  exclusion is restated below the allowlist, where a stray negation cannot undo
  it. **If you were relying on this repo to version your `_command/`, it no
  longer does: keep it in a private repo of your own** (`CONSTITUTION.md`, the
  git rule). Ticket payload rules move from three names
  (`**/tasks/*/samples/` and siblings) to the folder-contents idiom
  `**/tasks/*/*` plus negations for `ticket.md` and `scripts/`, because a named
  list failed open on the first payload directory nobody thought of. New gate
  `tools/check-ignores.ps1` asserts both properties on file paths rather than
  directory names, and `/preflight` step 6 runs it.
  **`scripts/` is no longer tracked either** and the Tracked column that implied
  otherwise is gone: `_command/` means `_command/`. Each project now keeps a
  `scripts.md` record naming every script it still has and why, linked from the
  front hub's Repo map (`framework/kit/templates/_scripts.template.md`).
- 2026-07-24: Liftoff conventions distilled into the foundation (the staging
  record `liftoff-conventions.md` is retired). Front placement
  (register / move / copy) + the gitignored `fronts/` container and the
  `yours | partnered | employer | stakeholder` trust taxonomy now live in
  `task-board.md`; the generic Definition-of-Done floor (incl. a
  production-execution-reality clause) is in `engineering-standard.md` (which
  the ticket template + task-board already reference); liftoff-by-derivation
  (pre-fill from a lived-in instance, confirm beats answer, stakes verbatim) is
  in `LIFTOFF.md` Stage 1. Ticket-as-folder + filestorage, one-tracker-per-
  project, and gates/no-self-approval/git-rule were already in the foundation.
- 2026-07-24: mission-flow + debrief hardened - mission-flow gains a Phase-1
  "real telemetry first" step and a Phase-1/2 production-execution-reality
  check, and a firm Phase-6 integration+e2e QA gate (not skipped under
  `--auto`); debrief Step 2 now reconciles the tracker (Jira / GitHub / native
  board), not just the local files.

- 2026-07-19: The thinking dial. Judgment-set skills (briefing, triage,
  mission-flow, map-front, retro, promote-learnings, learn-from-session,
  as-built, adr, doc-voice) accept `--thinking <low|medium|high|max>` -
  the routing grid's effort dial surfaced per invocation: deliberation
  depth in the session, literal effort on dispatches, defaults from the
  roles presets; it cannot re-dial the harness's session effort (a large
  mismatch is surfaced, never fought), and `low` thins deliberation,
  never discipline. Standing default recorded at liftoff Stage 3.
- 2026-07-19: Universal dials. Every varying skill now accepts
  `--spend <lean|standard|deep>` (what the invocation may cost - each
  skill defines its tiers; lean also steps dispatches one routing tier
  down, within ceilings; mission-flow's `--deep-review` becomes an alias
  for `--spend deep`) and `--verbosity <quiet|normal|narrated>` (how
  much the agent talks; narration only - gates, evidence, and reports
  are exempt at every tier). Standing defaults are captured at liftoff:
  the Stage-3 cost posture maps to the spend default, and Stage 1 now
  asks the concrete verbosity question. Precedence: flag > standing
  preference > framework default.
- 2026-07-19: License set to PolyForm Noncommercial 1.0.0 (personal and
  noncommercial use free; commercial rights reserved). Clean switch:
  nothing was ever distributed under the earlier draft license.
- 2026-07-19: Machine profiles. Every instance now carries
  `_command/machine.local.md` - an auto-detected, gitignored, PER-MACHINE
  platform contract (OS, shell dialect, path style, tool inventory,
  absent-tools list, preferences), written at liftoff Stage 4, imported
  into every session, injected into every dispatch header, and
  regenerated by any session that finds it missing or OS-mismatched
  (preflight heals it explicitly). New doctrine `framework/platform.md`
  carries the contract rules + a per-OS pitfall crib. Built against real
  failures: wrong slash styles, PowerShell-vs-bash dialect breaks, and
  commands assuming tools the machine does not have.
- 2026-07-19: Front dependency maps. New skill `map-front` (18 total):
  detect-first mapping of a front's inter-project dependency graph at a
  chosen depth (1 structural / 2 interface surfaces / 3 call-site
  consumption, per project) into a single-source `_map.md`; spokes and
  hub point at it. mission-flow now names the blast radius (impacted
  dependents) in tickets and PR bodies for mapped fronts; triage notes
  dependents on filed tasks; preflight checks map presence + freshness;
  scoped debriefs keep edges honest. Built for fronts where many
  projects intersect and one change can make or break others.
- 2026-07-19: Scale disciplines (the big-portfolio review). The global
  board is now a pure index (one line per front, from the new
  fronts-board template) mapping to each front's own context; the
  narrative moved into a bounded hub Status block (max 5 lines,
  debrief-maintained); size caps stated in doctrine and enforced by
  preflight. Portfolio-wide skills gained uniform `--front` /
  `--project` scope flags (scoped debriefs never touch today.md - the
  consolidating debrief owns it, which is also the parallel-sessions
  convention). New skill `retire-front` (17 total): founder-gated
  archiving with history intact. Briefing gained the rotation rule (not
  every front, every day); liftoff gained the incremental path for big
  portfolios; cross-front changes, dated founder-gated items,
  pointers-not-payloads for confidential spokes, and the OSS archetype
  documented.
- 2026-07-19: Adoption review applied (a cold Staff+ user walk-through).
  Upstream pulls can no longer clobber your operating CLAUDE.md
  (`.gitattributes` merge=ours + the one-time config line, stated at
  liftoff and in the README); liftoff and new-front now ask each
  project's `tracker:` (detect-then-confirm); the README states the
  enforcement model, the platform support, and the multi-machine story;
  `framework/examples/` ships a filled fictional front (hub, spoke,
  board, two tasks); task files never delete (they age off the board
  view); learn-from-session gains a no-auto-memory fallback; records
  scoped to dispatched sub-agents only; skill-shadowing note added.
- 2026-07-19: Task boards + the portfolio tree. New doctrine
  `framework/task-board.md`: per-project work queues at
  `_command/portfolio/<front>/[<project>/]tasks/` - one file per task
  (the truth), a derived `_board.md` view, seven states, one tracker per
  project. `_command/portfolio/` replaces `_command/projects/` as the
  management tree (per-project housing inside multi-project fronts; the
  promotion rule lives in the new-front skill). Task + board templates
  added to the kit; triage/mission-flow/briefing/debrief/preflight/
  new-front/LIFTOFF hooked to the boards.
- 2026-07-19: Workspace review applied. Doctrine: precedence order and
  default-session sections added to the CONSTITUTION; kickoff-era ghost
  references repaired across kit doctrine; deviations scope generalized
  beyond numbered phases; the "commit after approval" line rewritten to
  route through the git rule; routing-ceilings-cap-presets stated in
  roles.md. Workflows: skills now ship at `.claude/skills/`
  (auto-discovered on clone, updated by pull); LIFTOFF fills the new
  portfolio CLAUDE.md template and seeds `_command/learning/`; the
  detect-first front procedure is canonical in the new-front skill.
  Tools: reference-checker (`tools/check-refs.ps1`) joins the promote
  gate; leak-sweep gains the model-pin rule.
- 2026-07-14: v1 built: framework, LIFTOFF zero-paste onboarding,
  sixteen skills, leak-sweep publish gate (TDD, 18 tests).
