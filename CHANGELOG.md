# Changelog

All notable changes to the framework and skills. Cloners: after
`git pull upstream main`, read the entries since your last pull - doctrine
changes should never reach you silently.

## Unreleased (pre-publish)

- 2026-10-17: the shipped `CLAUDE.md` is never edited in your clone (MC-104).
  LIFTOFF Stage 4 used to rewrite it into your operating instructions, which
  left a tracked file with a local edit: the first pull that updated it was
  refused, and stashing the edit to get the pull through put every later
  session back on the first-flight bootstrap without a word. Stage 4 now
  writes the operating instructions to `_command/CLAUDE.operating.md`,
  gitignored with the rest of `_command/`, and the shipped `CLAUDE.md`
  imports it on its last line. Imports resolve from the folder of the file
  that holds them, so the operating file's six imports read
  `@../framework/...` for the doctrine and plain sibling paths for the
  instance files. `/preflight` check 1 follows the chain and fails on a
  local edit of `CLAUDE.md`. `.gitattributes` (`CLAUDE.md merge=ours`) is
  gone: a merge driver acts only when both sides committed a change to the
  file, so it never covered the uncommitted edit, and with nothing edited
  locally it has nothing left to do. The fieldkit repro script sends its
  JSON with a `Content-Type` header.

  If you lifted off before this, move your operating text once, BEFORE you
  pull this change (the pull is refused while `CLAUDE.md` carries your
  edit). From the portfolio root:

  ```bash
  test -e _command/CLAUDE.operating.md || cp CLAUDE.md _command/CLAUDE.operating.md
  sed -i.bak -e 's|^@framework/|@../framework/|' -e 's|^@_command/|@|' _command/CLAUDE.operating.md && rm _command/CLAUDE.operating.md.bak
  grep -n '^@' _command/CLAUDE.operating.md   # every import must now resolve from _command/
  git fetch upstream
  git merge-base --is-ancestor HEAD upstream/main && git restore CLAUDE.md && git merge --ff-only upstream/main
  ```

  The first line never overwrites an operating file already in place, so
  the block is safe to run again. The two rewrites cover the six imports
  LIFTOFF wrote; an import you added yourself needs the same change by
  hand: `../` in front of a path from the portfolio root, `_command/`
  dropped from a path inside it. The last line puts the shipped
  `CLAUDE.md` back only when your branch fast-forwards to `upstream/main`;
  if it has commits of its own, the line stops before changing anything,
  so merge those by hand and run it again. On Windows, run the block in
  Git Bash, or make the copy and the import edits by hand.

  If a pull already replaced your `CLAUDE.md` because you stashed your
  edit to get it through, your text is in the stash. Find its entry with
  `git stash list`, write it out with
  `git show 'stash@{0}:CLAUDE.md' > _command/CLAUDE.operating.md` (your
  entry's number in place of 0), run the `sed` and `grep` lines, and stop
  there. If you committed your own `CLAUDE.md`, run the
  first three lines, merge as usual, then take the shipped file back with
  `git checkout upstream/main -- CLAUDE.md` and commit it.

  Then open a fresh session at the portfolio root and ask which files its
  instructions came from: the answer names `_command/CLAUDE.operating.md`
  and its six imports. A session opened in a folder below the portfolio
  root, such as a front's repo, loads them only once you approve imports
  from outside its folder.

- 2026-10-17: the fleet skill and `framework/remote-access.md` describe the
  fleet as it now runs (MC-123). The fleet approves its own Controller
  spawns and messages under auto mode and logs each approval, so Flight no
  longer leaves auto mode to staff. A decision sent from the app reaches
  Flight as a prompt with a one-time code to pass back; the skill says how
  long a GO, NO-GO or Retry card stays held and how undelivered and held
  decisions are retried or cleared. The commands table gains `retry`, and
  the guard section lists the clone rules.

- 2026-10-16: a message from Flight in the app names the Controllers it is
  about (MC-129). When its first line is a marker, call signs in bold
  joined by a middle dot, each call sign shows as a chip beside FLIGHT and
  the marker leaves the text. Each live Controller holds one of eight
  colours, kept per call sign across reloads and sessions, and every call
  sign the app draws on Consoles, Poll and Loops is a chip in that colour.

- 2026-10-16: every front is a folder holding its repos, `fronts/<front>/<repo>`,
  even when it has only one (MC-130). `/new-front` and LIFTOFF used to move a
  repo so that it became the front's folder (`mv <path> ./fronts/<front>`),
  which left a second repo for that front nowhere to go; they now offer
  `mkdir -p ./fronts/<front> && mv <path> ./fronts/<front>/<repo>`, and the
  spoke's `path:` reads `fronts/<front>/<repo>`. A front with no repo is its
  folder alone. Worktrees for front work stay inside the front's folder.
  `/preflight` step 2 runs the new `tools/check-fronts.sh`, which reports a
  front folder that is itself a repo and a worktree at the top of `fronts/`,
  with the commands that fix each. If you onboarded fronts before this, run
  `/preflight`: moving them is yours to do, and a moved repo's linked
  worktrees need `git worktree repair`.

- 2026-10-16: a Controller may clone its own front's repositories (MC-126).
  The source is a literal github.com URL, HTTPS or SSH, whose owner a
  spoke of that front names in its `remote:` line (the exact forms are in
  the fleet skill), and the clone lands at `fronts/<front>/<REPO>`.
  Options are taken by exact spelling from a short list; everything else,
  `-c` and `--template` included, is refused. A console staffed before
  this change has no owners recorded and clones nothing until it is
  staffed again. `/console call`, `go` and `no-go` take the message or
  note whole, so words that start with two dashes reach the Controller.
  The guard reads a `$(cat <<'EOF' ... EOF)` substitution where the shell
  reads it and allows one only as a double-quoted git commit, tag, notes
  or merge message or a gh title or body. On a line that names git or gh
  it refuses setting a variable that git reads for its config or runs as
  a program, such as `HOME`, `PATH` or a `GIT_*` name.

- 2026-10-16: the app opens on a profile that is running (MC-120). It used
  to restore the last profile chosen on the device, even one whose session
  had stopped. It now names and connects to none until the first listing,
  then opens the remembered profile when it runs, else the profile whose
  server holds the front door, else the first listed, and says so in one
  line when the remembered one was not running. The profile switcher
  shows only while two or more profiles run.

- 2026-10-16: a GO or NO-GO for a Controller that was stood down or
  dismissed is held instead of sent (MC-122); it used to resume the old
  agent. The decision waits for the next Controller staffed under that
  call sign, which receives it with the report it answers. `/console poll`
  and the app show it as held, and `/console dismiss-gate` clears it.
  Under auto mode the fleet approves its own messages only to a staffed
  console.

- 2026-10-16: the console skill is now `fleet` (`.claude/skills/fleet/SKILL.md`,
  MC-121). The skill and the mission-fleet mod's `/console` command shared one
  name, so the engine refused the mod's command at every session start, and a
  typed `/console go <id>` could load the skill's text instead of running: the
  decision never reached its Controller. `/console` now belongs to the mod
  alone, and `/fleet` loads the guide. If you copied the skills into
  `~/.claude/skills/`, delete the old `console` folder there, or the clash
  stays.

- 2026-10-16: a decision the Poll could not deliver can be retried or
  dismissed (MC-119). Its card used to stay red for good, quoting the
  engine's refusal. It now says why in one plain sentence, keeps the
  engine's words behind Technical details, and offers Retry while the
  Controller that raised it is staffed, and Dismiss. In a session,
  `/console retry <id>` sends the decision again and
  `/console dismiss-gate <id>` clears it.

- 2026-10-15 (night): the spend recorder (MC-069), a Claude Code mod at
  `tools/mods/spend-recorder` that records the model, effort and token usage
  of every model call, per session and per agent, in the plugin's store (the
  last 30 sessions). `/spend-log` shows this session's table, and `/spend`
  now reads it through the recorder's `spend` tool, so its tally carries
  measured tokens instead of estimates wherever the recorder was loaded.

- 2026-10-15 (evening): a shell twin of the reference checker (MC-110.1).
  `tools/check-refs.sh`, with `tools/check-refs.py`, checks every repo path a
  Markdown doc names under `framework/`, `.claude/skills/`, `kit/` and
  `tools/`, and every relative Markdown link, against the files on disk, on a
  machine without PowerShell. Links inside code, links in the instance
  templates and gitignored paths are not counted as broken. It takes files or
  folders (default: every tracked `.md`) and exits 1 with `file:line` per
  broken reference. The docs sweep (MC-110) brings the root, tools and app
  docs up to date.

- 2026-10-15 (later still): the standup report opens with a two-minute talk
  track (MC-109). The timeline grouped by repo reads well and speaks badly, so
  the talk track regroups the same items by what the work did: a one-sentence
  headline, two to five groups by kind of work (largest first, each naming the
  repos it spans), then the asks and who acts. Counts are exact, the talk track
  covers exactly the timeline's items, and its counts equal the counts strip.

- 2026-10-15 (later): the Mission Control App, the fleet's control surface
  (`tools/app`, MC-098..MC-100, MC-105..MC-108). A Node standard-library
  server, switched on by the founder's `/console app` (then kept running in
  every session of that profile), serves a web app on
  127.0.0.1 and hands the founder's actions to the mission-fleet mod. Four
  tabs: Flight (the conversation, with Flight's replies rendered as markdown and
  a `/` command picker), Consoles (call, retune or stand down a Controller),
  Poll (go and no-go with a note) and Loops (filterable traffic). Built
  only from its own tokens, with the design-token ratchet held at zero
  (`tools/app/DESIGN.md`), installable as a home-screen web app, light and
  dark. A desktop layout (from 1024 px) adds a navigation rail and card
  columns. Access: one token kept owner-only in `~/.mission-control/app-token` and
  shared by every profile's server, or over `tailscale serve` the signed-in
  Tailscale identity of the machine's owner, plus a Host allowlist, a
  same-origin check on every POST and a strict CSP. One front door serves every
  Claude profile (MC-106): each profile's server registers and the one holding
  port 4777 routes `/p/<profile>/` to the others, with a profile switcher in the
  header and one shared token. Photos (MC-107): a camera button scales the
  photo on the device and the session opens it by path. Answering Flight's
  questions (MC-108): while the app runs, a question Flight asks lands as a
  card with its options, an Other box and text or number inputs, with a phone
  alert; at the machine, `/console answer <n|text>` answers it. Also: gates
  whose Controller stood down say so and can be dismissed (`/console
  dismiss-gate <id>`); the app stays running for as long as Flight does (a
  supervisor restarts it with backoff; `/console app stop` ends it); replies the
  saved transcript dropped are restored; Claude Code's own notices show as a
  quiet line, not as the founder; the phone keyboard stays open while typing.

- 2026-10-15: the console fleet (MC-092, children MC-093..MC-103). A Claude
  Code mod, `tools/mods/mission-fleet`, adds `/console` and a console tool for
  Flight, the orchestrator session. `/console staff <front> [--project <p>]
  [--model] [--effort] [--budget]` starts a kept-alive Controller as the
  `mission-fleet:controller` agent type, in its front's repo, cold-started from
  the front hub, spokes and progress log; `list`, `call`, `retune` (model and
  effort from the next request, for that console only), `poll`, `loops`, `go` and
  `nogo` (the founder's alone), `stand-down` (a dated handoff, then the end),
  `dismiss` (the end, nothing written) and `app` complete the verbs. Each
  Controller's own sub-agents are its back room, held to the budget stated at
  staffing. A guard refuses, for Controllers and back rooms, unpinned git and gh
  calls, pushes to base or deploy branches, force pushes, deletions, stash, PR
  merges, writes to Flight's files and the Claude CLI; it is a text guard, not a
  sandbox, so base branches also need server-side branch protection. Every
  report is recorded as loop traffic; a "blocked on you" line opens one go/no-go
  gate per console and a `contract:` line opens an advisory for the fronts whose
  dependency map names it. A new gate sends the founder an alert, and a PR a
  Controller names is watched every ten minutes, waking the Controller on a
  change in state, reviews, comments or checks. The mod ships 47 tests, run
  with `claude plugin test tools/mods/mission-fleet`. New: the console skill
  (renamed `fleet` on 2026-10-16, now `.claude/skills/fleet/SKILL.md`), the
  Controller clause in the constitution, and `framework/remote-access.md`, the
  runbook for reaching the app from a phone through `tailscale serve` only,
  never a public tunnel.

- 2026-10-11 (later still): `/product-flow` after its first dry run (MC-091).
  A tabletop run of a sample idea through every instruction found eleven
  defects, fixed here. The founder reviews the design at a new gate between
  Design and Architect, so there are five gates, four when launch is on deploy
  day, and gates are named rather than numbered. A product's epics stack, each
  on the one before with its own PR the founder merges, replacing a merge
  grant the instance's permissions deny. `/design-new` gains `--local` and
  `--stack-neutral`. The budget is in tokens, measured from dispatched agents'
  reports; the product id is the front's name; a resume never passes an
  unanswered gate; every gate has a yes-with-changes path; an existing
  product's front hands off to epic-flow; `/retro` proposes the learn run;
  epic-flow merges main into an epic stacked on a squash-merged one.

- 2026-10-11 (later): a third delivery altitude, `/product-flow` (MC-084,
  children MC-085..090). It takes an idea, a vision or a problem from framing
  through research, positioning, design, architecture, build, verification,
  deploy, beta and launch, with a separate learn run weeks later, and stops at
  four gates placed at irreversibility and money: the bet, the blueprint,
  deploy and go-public. Before the blueprint, forks are recorded and taken; after
  it, the run stops only on epic-flow's list, a tripped kill criterion or the
  spend ledger. Four playbooks hold the sub-phases; the kit gains the product
  brief and gate-pack templates; epic-flow takes a parent-locked face as its E0
  lock and treats a migration implementing a parent-approved data model as
  settled. The constitution names three altitudes, the authority note names
  the product grants, and the continuity stack and task board register the
  product folder.

- 2026-10-11 (later): the design standard gets its skills (MC-078, children
  MC-079..083), a sixth group in the skills index. `/design-new` designs a
  product from scratch and, in comp mode, one new view; `/design-adopt` derives
  a front's DESIGN.md from its code, ratchets it at today's counts and, in
  change mode, follows a token or component change to every view;
  `/design-review` judges a product, a proposal, a diff or a whole epic, every
  finding naming its source and element, with a content and localization lens;
  `/design-artifact` makes pages, decks and reports for the audience named,
  local by default for confidential content. mission-flow states UI-shaped in
  Phase 0 and calls the skills in Phases 1 and 5; epic-flow calls them at E1,
  E2 and E8. Three guards: they act only on the named front, only for
  UI-shaped work, and the design lens on a new view or component is never
  waived by a spend dial.

- 2026-10-11: the portfolio gains a design layer (MC-071, children MC-072..077).
  `framework/design-standard.md` owns six principles, the adopted stack with one
  source per layer (the usability heuristics, WCAG 2.2 AA, Laws of UX,
  Refactoring UI, the two mobile platform guides for behaviour only, the DTCG
  token format with Atomic Design, the GOV.UK process model), the DESIGN.md
  contract with a six-state matrix, and the gates; the kit gains its template.
  roles.md routes design direction and the design review lens. mission-flow
  designs UI-shaped tickets before building them: Phase 1 reads the front's
  DESIGN.md and carries a comp and the state-matrix row, Phase 5 adds a design
  lens whose findings name their source, Phase 6 renders each touched view at
  its shipping sizes, themes and states and runs axe; the ticket template gains
  the matching line. `tools/token-lint` ratchets raw design values outside a
  front's token files: counts may only fall. The skills' own generated pages
  get `.claude/skills/DESIGN.md`, and the standup report takes its palette,
  with every contrast pair now at 5.25:1 or more in both themes.

- 2026-10-10 (evening): epic-flow gains `--auto`. The invocation locks an
  existing plan (an epic folder, or child tickets already in the tracker) and
  approves landing every child on the epic branch, pushing it, and opening the
  epic PR; the base merge stays outside the grant. The runner gets an explicit
  list of what stops a locked run and what never does (a child landing, a
  summary, a restated plan, a question the lock answers), with one LANDED line
  per child between them. Branches are named by shape: a feature epic on its
  capability, a batch epic on its origin and kind, never on the areas it
  touches. The skills README names epic-flow's branch grant beside
  mission-flow's. The status-after-pipe guard now checks only the statement
  before each status read, after its first live run blocked a command whose
  pipe and status read were unrelated.

- 2026-10-10 (later): the harness and model generation shift, planned as an
  epic (MC-060) and landed one commit per fragment on the same branch as the
  promotion pass. The routing grid now asks for effort on every dispatch
  (defaults differ by model generation and harness version), names the Agent
  tool's effort parameter and the workflow agents' env pin, and replaces the
  blanket deny of the one-call fan-out tool with a narrow admission: model and
  effort on every agent call, a budget ceiling, the sizing heads-up, or it
  stays denied. roles and the skills README speak in tiers and gain xhigh.
  Two settings hooks join the leak guard, each with a test suite: a
  PreToolUse guard that blocks a status read after a pipe into a pager, and a
  UserPromptSubmit injector that prints a front's hub and spoke into context
  when a flow names the front. A prompt audit over the whole surface found it
  clean on every greppable signal and landed four medium rewrites. The
  identity header carries the three guidance lines (grounded progress, no
  tidying, autonomy), and mission-flow gains a clause on keeping agents alive
  across follow-ups instead of re-briefing them. Two mods (a sub-agent git
  guard on tool checks, a spend recorder) wait on Claude Code 2.1.292.

- 2026-10-10: a promotion pass over the learning log and memory landed its
  artifact halves - the rule written while its file still emits the defect
  changes nothing. Five changes, one commit each (MC-054, children
  MC-055..059). The Definition of Done gains a Reachability proven item (a
  unit obtained the way production obtains it, a named writer per value read,
  remote-parsed strings executed against the service) and asks the red run to
  name its assertion with the break shown applied; mission-flow Phase 6 carries
  the live-path checks, Phase 4 the four instruments that lie green (a status
  read after a pipe, a red counted not read, a gate that repairs its input, a
  rewritten test never re-broken), Phase 1 a step zero that reads the hub, the
  spoke and the repo's own agent file before the first design decision, Phase 2
  a write-access stop and same-turn assignment, Phase 7 a comment on another
  reporter's ticket rather than a rewrite, Phase 8 tracker keys over fragment
  numbers; epic-flow assigns at filing and transitions a child as it starts;
  the record schema gains the brief contract - goal, constraints, mechanism as
  belief with its check - and `brief refuted` as a record outcome.

- 2026-09-09: the documentation surface is reconciled with the 2026-09-02/09
  burst, which had shipped two skills, a tool, a template and eighteen tickets
  of flow hardening while leaving every top-level doc untouched. A scan of all
  79 tracked docs found `epic-flow` and `compliance-ref` appearing ZERO times
  in README, the skills index, LIFTOFF, the CONSTITUTION, task-board,
  continuity-stack, and the generated operating CLAUDE.md - so a cloner could
  not discover half of what shipped. Corrected: the skill count (18 -> 20) and
  the outcome ("merged-ready PR" -> checks-green); both altitudes named
  wherever delivery is described; the Definition-of-Done floor now requires the
  proving command to be DECLARED when the ticket is written rather than chosen
  once the code exists; the continuity stack gains the three layers it did not
  know about (the deviations register, the epic folder, the lesson-candidate
  buffer); task-board documents the epic folder, the fragment brief as the
  state machine, the EPIC size class and the coverage gate; the kit inventory
  lists the task and epic-fragment templates; the shipped fieldkit example was
  teaching the pre-change ticket shape and now matches the template; and nine
  skills name the callers the burst gave them. Reconciled as an epic
  (MC-043, children MC-044..049) - the doc surface was the first thing
  epic-flow planned that was not itself.

- 2026-09-03: every mission-flow phase now names its skills roster in place -
  what implements the phase (yours or CLI-shipped), where "none" is the honest
  entry - plus a consolidated deny-list with reasons (the attribution-trailer
  commit commands; the integration-question re-opener) and the MC-020 caution
  (stock reviewer agents' toolsets vs the diff-file rule). The demo deck's
  strips mirror the rosters by rule. (MC-026)

- 2026-09-03: the invalidation re-plan cycle is live - invalidated fragments
  stop their lane, E3'/E4'/E6' re-plan and re-lock only the changed subtree,
  and already-squashed work reverts on the epic branch (revert, never rebase),
  logged as a deviation. epic-flow is now STUB-free: the tool finished itself
  as its own first epic (MC-038..041 = MC-017.1..4). (MC-041)

- 2026-09-03: --decide minor is operational - the real-time announcement line,
  the decide_log entry shape in the brief's frontmatter, and E8's enumeration
  with per-decision /adr proposals (founder-gated). (MC-040)

- 2026-09-03: epic-flow's E8 close is live - coverage against shipped
  artifacts (mechanical where a script can assert, an explicit manual line
  where it cannot), the cross-fragment principles pass over the whole epic
  diff, the terminal assertion executed literally, the epic PR as review
  index with the child batch transition at merge, /as-built promotion, and
  the closing tally. (MC-039)

- 2026-09-03: epic-flow's E7 runner is live - epic-branch lifecycle with an
  explicit push grant scoped to that branch, serial child execution with the
  three overrides, squash-per-fragment with CI watched per push, base-drift
  merges (never rebase), and the no-PR child Phase 8 (park in review, batch
  Done at the epic merge). mission-flow Phase 2 gains the epic-child pointer
  mode. Shipped BY the first epic run itself (MC-038 = MC-017.1). (MC-038)

- 2026-09-03: --spend lean's cap is arithmetically satisfiable again: it caps
  the CORRECTNESS batch at one reviewer; the principles and conformance passes
  may run inline under lean; and risk-triggered lenses (security, declared
  compliance families) are never waived by a spend dial. (MC-037)

- 2026-09-03: /triage speaks epic. The size column gains EPIC (the correct
  shape is several tickets) and step 4 hands /epic-flow invocations for those
  items instead of filing them as single L tasks - one classification
  language from inbox to epic. (MC-036)

- 2026-09-03: lesson candidates become durable and gain their reader. Phase 8
  appends them to the ticket's evidence log as it reports (terminal output
  does not survive compaction; the file does), and /debrief's lessons step
  reads the day's touched ticket folders and feeds the candidates into
  learn-from-session's critique gate - same gate, no special treatment.
  (MC-035)

- 2026-09-03: three small hardenings - the negative control's break/red/restore
  output has a stated home (the unit's record), deploy-path dry checks carry
  the cloud-access clause telemetry already had, and the skill's own
  description now ends at a checks-green PR, where MC-022 moved the finish
  line. (MC-034)

- 2026-09-03: Phase 0 completes its verdict set. Epic-sized is a live exit to
  /epic-flow (the "until then" clause outlived its truth by one hour); all
  three exits announce with rationale shapes; and the per-phase task list is
  created on a flow-entering verdict only, so exits strand nothing. (MC-032)

- 2026-09-03: four contradictions found by a full-document pass are
  reconciled. The delivered probe is orchestrator-run before any dispatch and
  the investigator's default type follows the path's duties (the read-only
  universal default could not run the phase's own commands); the exhaustive
  stop lists now name the delivered-probe hit and the dirty tree; Phase 5's
  sizing statement lives in the orchestrator's output, never the record; the
  conformance record is both-paths and placed there. (MC-033)

- 2026-09-03: epic-flow E0 gains its docs-viewer mechanics: reuse-or-generate
  at the front's portfolio dir (the viewer is root-pinned; the proven pattern
  is generating it where the docs live), report the URL into 00-face.md, and
  leave the server running at every stage exit. (MC-031, parent MC-017)

- 2026-09-03: tools/epic-coverage lands - the mechanical E4 gate. Unclaimed
  declared outputs and over-claims (one output owned twice) exit 1; undeclared
  claims warn (a stale architecture doc is a plan edit, not a block). Ships
  with executable tests including BOTH negative controls, each proven able to
  fail. (MC-030, parent MC-017)

- 2026-09-03: epic-flow lands in planning mode - the altitude above
  mission-flow for work bigger than one ticket. Gated stages E0-E6 (face,
  evidence audit with an epic-scale already-delivered scan, SOLID-checked
  lo-fi architecture with reuse-first as a gate, fragmentation cut by SRP/ISP/
  OCP/DRY, a mechanical coverage gate, walking-skeleton sequencing, the
  founder tree lock), diagram-first documents with lock status headers, and a
  fragment-brief kit template. Execution (E7/E8) is stubbed honestly and lands
  with the next build units. (MC-029, parent MC-017)

- 2026-09-03: the project a flow runs in is now the design reference across
  the SDLC. Phase 1 records what the project already does for every touched
  surface (reference order: this project -> the front's sibling projects for
  new projects -> the declared quality profile as tie-break); Phase 5 runs a
  conformance lens whose findings must name the concrete component, pattern,
  or idiom bypassed; Phase 2 requires new critical paths to name their
  telemetry as a criterion; Phase 6 verifies declared perf budgets and a11y
  contracts. Deviating from the reference is a stated decision, never a
  default. (MC-028)

- 2026-09-03: compliance becomes per-front configuration, bound by command.
  The new compliance-ref skill writes a profile block (standards -> control
  families, monitor -> evidence surface) into a front's hub - idempotent,
  founder-run, framework stays vendor-free. mission-flow reads it: Phase 5's
  risk trigger widens to the declared control families, Phase 6 gates
  dependency vulnerabilities on the DELTA (new high/critical red; inherited
  findings reported, never blocking), and Phase 7 aligns PR evidence with what
  the declared monitor samples. Fronts declaring nothing pay nothing. (MC-021)

- 2026-09-03: **doctrine change, founder-approved:** the autonomy carve-out
  now expires at checks-green, not at the open PR. Phase 7 watches the PR's
  checks bounded (30-minute default, timeout reports); a red caused by the
  diff gets exactly one re-entry into the Phase 4-6 loop; infra/flake reds and
  second reds become founder-gated items. An integration branch once sat red
  for five days unnoticed (AI-1814). (MC-022)

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
  sixteen skills, leak-sweep publish gate (test-driven).
