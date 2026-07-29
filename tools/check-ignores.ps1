param(
  [string]$Root = (Split-Path $PSScriptRoot -Parent)
)
$ErrorActionPreference = "Stop"

# Assert that the ignore rules deliver what the docs promise. The rules are the
# only thing git obeys, so a doc that claims a path is ignored proves nothing:
# _command/ was documented as gitignored in two places while `.gitignore` held an
# explicit negation that tracked it, and the private instance of a public repo sat
# one `git add -A` from being published.
#
# Every entry below is a FILE path, never a bare directory. A directory-only
# pattern (one ending in `/`) cannot match a path git is unable to resolve as a
# directory, so asking about a bare directory name gives an answer that flips
# depending on whether it happens to exist on disk. That is precisely how the
# original defect stayed invisible.

# Must be ignored. If any of these becomes trackable, private material can be
# committed from a clone of a public repo.
$mustIgnore = @(
  # the operator's instance, in full: doctrine, spokes, boards, continuity
  "_command/CONSTITUTION.local.md",
  "_command/daily/today.md",
  "_command/mental-model.md",
  "_command/founder-profile.md",
  "_command/machine.local.md",
  "_command/learning/01-a-lesson.md",
  "_command/portfolio/acme/_front.md",
  "_command/portfolio/acme/api/api.md",
  # a ticket folder inside the instance is instance state too, with NO exceptions:
  # the record and the scripts are as local as the payload, which is why a project
  # keeps a scripts.md record instead of relying on git to remember them
  "_command/portfolio/acme/api/tasks/T-001-a-ticket/ticket.md",
  "_command/portfolio/acme/api/tasks/T-001-a-ticket/scripts/local_stack.py",
  "_command/portfolio/acme/api/tasks/T-001-a-ticket/scripts/repro.sh",
  "_command/portfolio/acme/api/tasks/T-001-a-ticket/samples/input.bin",
  "_command/portfolio/acme/api/scripts.md",
  # ticket payloads anywhere, including a name nobody thought to enumerate
  "framework/examples/fieldkit/tasks/T-001-offline-sync-conflict-merge/samples/input.bin",
  "framework/examples/fieldkit/tasks/T-001-offline-sync-conflict-merge/artifacts/dump.log",
  "framework/examples/fieldkit/tasks/T-001-offline-sync-conflict-merge/screenshots/qa.png",
  "framework/examples/fieldkit/tasks/T-001-offline-sync-conflict-merge/dumps/heap.bin",
  "framework/examples/fieldkit/tasks/T-001-offline-sync-conflict-merge/logs/run.log",
  # retired payload location, kept ignored for instances whose spokes still name it
  ".tickets/T-001-a-ticket/samples/old.bin",
  # operator-local and generated
  "tools/leak-sweep.private.txt",
  "node_modules/pkg/index.js",
  ".docs-viewer-cache/diagram.svg",
  ".claude/settings.local.json",
  # anything else placed at the root is outside the allowlist
  "fronts/some-project/README.md",
  "scratch/notes.md"
)

# Must stay trackable. If any of these becomes ignored, the product stops shipping
# part of itself, and a fresh clone is missing doctrine or a skill.
$mustTrack = @(
  "framework/CONSTITUTION.md",
  "framework/task-board.md",
  "framework/engineering-standard.md",
  "framework/kit/templates/_task.template.md",
  # the board is a direct child of tasks/, so no tasks/<ID>/ rule may reach it
  "framework/examples/fieldkit/tasks/_board.md",
  # the two tracked names inside a ticket folder
  "framework/examples/fieldkit/tasks/T-001-offline-sync-conflict-merge/ticket.md",
  "framework/examples/fieldkit/tasks/T-001-offline-sync-conflict-merge/scripts/repro-sync-conflict.sh",
  "tools/leak-sweep.ps1",
  "tools/check-ignores.ps1",
  ".claude/skills/mission-flow/SKILL.md",
  "CLAUDE.md",
  "README.md",
  "LIFTOFF.md",
  "CHANGELOG.md",
  "LICENSE",
  ".gitignore"
)

function Test-Ignored([string]$relative) {
  # check-ignore reports the deciding pattern, and reports negations too, so its
  # exit code cannot answer this on its own: a path whose last match is "!..." is
  # NOT ignored even though a pattern matched. Decide on the pattern text. The
  # non-greedy prefix anchors on <source>:<line>:, so a pattern containing a colon
  # survives, and a "!" can only ever be character zero of a negation.
  #
  # stderr is deliberately NOT redirected. Redirecting a native command's stderr
  # on this platform wraps each line in an ErrorRecord, which under
  # $ErrorActionPreference = Stop turns a wrong -Root into an opaque .NET failure
  # instead of the message below (framework/platform.md). Exit 0 means a pattern
  # matched, 1 means none did, anything higher is git failing to answer at all.
  $output = & git -C $Root check-ignore -v --no-index -- $relative
  if ($LASTEXITCODE -gt 1) {
    throw "git check-ignore could not evaluate '$relative' under -Root '$Root'."
  }
  if (-not $output) { return $false }
  $pattern = ((@($output)[0]) -split "`t")[0] -replace '^.*?:\d+:', ''
  return -not $pattern.StartsWith('!')
}

function Get-TrackedPaths {
  # quotePath off, or git C-quotes any non-ASCII path and wraps it in literal
  # double quotes, which check-ignore would then read as part of the filename and
  # resolve against the root allowlist instead of the real leading directory.
  return @(& git -c core.quotePath=false -C $Root ls-files)
}

$failures = New-Object System.Collections.Generic.List[string]

foreach ($path in $mustIgnore) {
  if (-not (Test-Ignored $path)) {
    $failures.Add("NOT IGNORED but must be: $path")
  }
}
foreach ($path in $mustTrack) {
  if (Test-Ignored $path) {
    $failures.Add("IGNORED but must stay trackable: $path")
  }
}

# A tracked file the rules would ignore is a trap rather than an error: it stays
# tracked in this clone because the index wins, so nothing looks wrong, while a
# fresh clone that ever removes and re-adds it loses it silently.
$tracked = Get-TrackedPaths
foreach ($path in $tracked) {
  if (Test-Ignored $path) {
    $failures.Add("TRACKED but the rules would ignore it: $path")
  }
}

if ($failures.Count -gt 0) {
  $failures | ForEach-Object { Write-Output $_ }
  Write-Output ("CHECK-IGNORES FAILED: {0} problem(s)." -f $failures.Count)
  exit 1
}
# The two lists brace each other, which is why this gate needs no test of its own:
# a verdict function stuck at $false fails every must-ignore entry, stuck at $true
# fails every must-track entry, and a wrong -Root now throws rather than reporting
# a clean run. There is no way for it to pass while asserting nothing.
Write-Output (
  "CHECK-IGNORES CLEAN: {0} must-ignore, {1} must-track, {2} tracked file(s) verified." -f
    $mustIgnore.Count, $mustTrack.Count, $tracked.Count
)
exit 0
