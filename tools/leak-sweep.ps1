# leak-sweep.ps1 - PowerShell twin of leak-sweep.sh. Keep the two in step:
# the rules, the targets, where the deny-list is read from and the exit codes.
# Only the shell twin runs on macOS and Linux, so a change here is checked by
# reading it against leak-sweep.sh.
#
# promote reads the operator's deny-list from the instance,
# _command/leak-sweep.private.txt beside this tools/ folder (gitignored with
# the rest of _command/), or from -PrivateList, or from the file
# LEAK_SWEEP_PRIVATE_LIST names, for a run from a clone or worktree with no
# instance of its own. With no list it exits 2: a sweep that never checked the
# operator's own names is not clean.
param(
  # $Mode is FIRST so `leak-sweep.ps1 promote` selects a mode. With $Path first,
  # that bound "promote" to a path which does not exist: zero files, exit 0, and
  # `leak-sweep.ps1 instance` reported Mode=promote because $Mode never got it.
  [ValidateSet("promote", "instance")][string]$Mode = "promote",
  [string[]]$Path,
  [string]$PrivateList,
  [string]$Root = (Split-Path $PSScriptRoot -Parent)
)
$ErrorActionPreference = "Stop"

if (-not $PrivateList) {
  $PrivateList = if ($env:LEAK_SWEEP_PRIVATE_LIST) { $env:LEAK_SWEEP_PRIVATE_LIST } else { Join-Path (Split-Path $PSScriptRoot -Parent) "_command/leak-sweep.private.txt" }
}
# Where the list used to live; read never, named in the error so a list left
# there is moved rather than silently skipped.
$legacyList = Join-Path $PSScriptRoot "leak-sweep.private.txt"

# Generic rule families. Ship publicly; contain NO private terms.
$rules = @(
  @{ Name = "windows-user-path"; Pattern = '[A-Za-z]:\\Users\\(?!<)[^\\ "]+' },
  @{ Name = "unix-home-path";    Pattern = '/(home|Users)/(?!<)[A-Za-z0-9_.-]+' },
  @{ Name = "email";             Pattern = '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' },
  @{ Name = "aws-access-key";    Pattern = 'AKIA[0-9A-Z]{16}' },
  @{ Name = "github-token";      Pattern = 'gh[pousr]_[A-Za-z0-9]{20,}' },
  @{ Name = "generic-secret";    Pattern = '(?i)(api[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*\S+' },
  @{ Name = "aws-account-id";    Pattern = '\b\d{12}\b' },
  @{ Name = "legacy-name";       Pattern = '(?i)\bpmc\b' },
  @{ Name = "model-pin";         Pattern = '(?i)\b(opus|sonnet|haiku|gpt|gemini|claude)[ -]?[0-9]+(\.[0-9]+)?\b|(?i)claude-[a-z]+-[0-9]' }
)
$defaultPromoteTargets = @("framework", ".claude\skills", "README.md", "LIFTOFF.md", "CLAUDE.md", "CHANGELOG.md")
$defaultInstanceTargets = @("_command", "CLAUDE.md")

if ($Mode -eq "instance") {
  # Instance mode guards a PRIVATE instance: leftover template placeholders and
  # live secrets. The generic identity rules above and the deny-list guard the
  # PUBLIC repo only - an instance legitimately contains its own founder's
  # paths and email, and names the fronts and the employer the deny-list keeps
  # out of what ships.
  #
  # It reads a different tree for the same reason. Pointed at framework/ it
  # reported the kit templates' deliberate <PLACEHOLDER-...> blanks as leaks
  # while never opening _command/ at all. The brace token is a bare identifier;
  # `[^}]+` also matched Mermaid's hexagon node syntax ({{"label"}}), so every
  # diagram-first doc carrying one read as an unfilled blank.
  # A live credential is never legitimate in an instance, so the secret rules
  # stay on alongside the placeholder rule; only the identity ones drop.
  $rules = @(
    @{ Name = "leftover-placeholder"; Pattern = '<PLACEHOLDER[^>]*>|\{\{[A-Za-z0-9_.-]+\}\}|TODO-INIT' },
    @{ Name = "aws-access-key";       Pattern = 'AKIA[0-9A-Z]{16}' },
    @{ Name = "github-token";         Pattern = 'gh[pousr]_[A-Za-z0-9]{20,}' },
    @{ Name = "generic-secret";       Pattern = '(?i)(api[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*\S+' }
  )
}

if (-not $Path) {
  $Path = if ($Mode -eq "instance") { $defaultInstanceTargets } else { $defaultPromoteTargets }
}

$privateTerms = @()
if ($Mode -eq "promote") {
  # A missing list used to pass with PrivateTerms=0, so the operator's own
  # names went unchecked while the sweep reported clean. An empty list is a
  # choice someone made; a missing one is not.
  $listLines = $null
  if (Test-Path -LiteralPath $PrivateList -PathType Leaf) {
    try { $listLines = @(Get-Content -LiteralPath $PrivateList -ErrorAction Stop) } catch { $listLines = $null }
  }
  if ($null -eq $listLines) {
    [Console]::Error.WriteLine("LEAK-SWEEP ERROR: no private deny-list at '$PrivateList', so the operator's own names cannot be checked.")
    if (Test-Path -LiteralPath $legacyList -PathType Leaf) {
      [Console]::Error.WriteLine("  A list sits at the old path '$legacyList': move it into the instance, to the path above.")
    } else {
      [Console]::Error.WriteLine("  Create it with one term per line ('#' starts a comment), or set LEAK_SWEEP_PRIVATE_LIST to a list elsewhere.")
    }
    exit 2
  }
  # Matched without regard to case, as -match always is: a name is the same
  # name capitalised.
  $privateTerms = @($listLines | Where-Object { $_ -and $_ -notmatch '^\s*#' } | ForEach-Object { $_.Trim() })
}

$exemptMarker = 'MC-LEAK-EXEMPT:'
$hits = New-Object System.Collections.Generic.List[string]
$targets = @()
$missing = @()
foreach ($p in $Path) {
  $full = Join-Path $Root $p
  $found = @()
  if (Test-Path $full -PathType Container) {
    $found = @(Get-ChildItem $full -Recurse -File | Where-Object {
      $_.FullName -notmatch '\\(node_modules|\.git|\.docs-viewer-cache)(\\|$)' -and
      $_.Name -ne 'leak-sweep.private.txt'
    })
    if ($found.Count -eq 0) { $missing += "$p (empty)" }
  } elseif (Test-Path $full) {
    $found = @(Get-Item $full)
  } else {
    $missing += "$p (absent)"
  }
  $targets += $found
}

# A target that is not there was not checked, so it cannot be reported clean.
# Per target, not just globally: instance mode reads _command/ + CLAUDE.md, and a
# globally-non-empty check passes on CLAUDE.md alone while _command/ is missing
# or misnamed, which is the state liftoff step 5 exists to catch.
if ($missing.Count -gt 0) {
  [Console]::Error.WriteLine("LEAK-SWEEP ERROR: mode=$Mode target(s) not scanned under '$Root': $($missing -join ', ')")
  exit 2
}

# $targets is built as a real array above, so Count is trustworthy here. Kept as
# a backstop for the whole-set case.
if ($targets.Count -eq 0) {
  # Not Write-Error: $ErrorActionPreference is Stop, which would make it
  # terminating and never reach the exit code this contract promises.
  [Console]::Error.WriteLine("LEAK-SWEEP ERROR: no files under '$Root' for mode=$Mode (targets: $($Path -join ' ')).")
  exit 2
}

foreach ($file in @($targets)) {
  $rel = $file.FullName.Substring($Root.Length).TrimStart('\')
  $lineNo = 0
  foreach ($line in [System.IO.File]::ReadLines($file.FullName)) {
    $lineNo++
    if ($line -like "*$exemptMarker*") { continue }
    foreach ($r in $rules) {
      foreach ($m in [regex]::Matches($line, $r.Pattern)) {
        $hits.Add(("{0}:{1}: [{2}] {3}" -f $rel, $lineNo, $r.Name, $m.Value))
      }
    }
    foreach ($t in $privateTerms) {
      if ($line -match ('\b' + [regex]::Escape($t) + '\b')) { $hits.Add(("{0}:{1}: [private-term] {2}" -f $rel, $lineNo, $t)) }
    }
  }
}

if ($hits.Count -gt 0) {
  $hits | ForEach-Object { Write-Output $_ }
  Write-Output ("LEAK-SWEEP FAILED: {0} hit(s). Mode={1}." -f $hits.Count, $Mode)
  exit 1
}
if ($Mode -eq "promote") {
  Write-Output ("LEAK-SWEEP CLEAN: 0 hits across {0} file(s). Mode={1}. PrivateTerms={2} from {3}." -f $targets.Count, $Mode, $privateTerms.Count, $PrivateList)
} else {
  Write-Output ("LEAK-SWEEP CLEAN: 0 hits across {0} file(s). Mode={1}. The deny-list is for what ships, so this mode does not read it." -f $targets.Count, $Mode)
}
exit 0
