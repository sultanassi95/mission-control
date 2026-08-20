param(
  # $Mode is FIRST so `leak-sweep.ps1 promote` selects a mode. With $Path first,
  # that bound "promote" to a path which does not exist: zero files, exit 0, and
  # `leak-sweep.ps1 instance` reported Mode=promote because $Mode never got it.
  [ValidateSet("promote", "instance")][string]$Mode = "promote",
  [string[]]$Path,
  [string]$PrivateList = (Join-Path $PSScriptRoot "leak-sweep.private.txt"),
  [string]$Root = (Split-Path $PSScriptRoot -Parent)
)
$ErrorActionPreference = "Stop"

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
  # Instance mode guards a PRIVATE instance: leftover template placeholders +
  # the operator's deny-list (if present). The generic identity rules above
  # guard the PUBLIC repo only - an instance legitimately contains its own
  # founder's paths and email.
  #
  # It reads a different tree for the same reason. Pointed at framework/ it
  # reported the kit templates' deliberate <PLACEHOLDER-...> blanks as leaks
  # while never opening _command/ at all. The brace token is a bare identifier;
  # `[^}]+` also matched Mermaid's hexagon node syntax ({{"label"}}), so every
  # diagram-first doc carrying one read as an unfilled blank.
  $rules = @(@{ Name = "leftover-placeholder"; Pattern = '<PLACEHOLDER[^>]*>|\{\{[A-Za-z0-9_.-]+\}\}|TODO-INIT' })
}

if (-not $Path) {
  $Path = if ($Mode -eq "instance") { $defaultInstanceTargets } else { $defaultPromoteTargets }
}

$privateTerms = @()
if (Test-Path $PrivateList) {
  $privateTerms = Get-Content $PrivateList | Where-Object { $_ -and $_ -notmatch '^\s*#' } | ForEach-Object { $_.Trim() }
}

$exemptMarker = 'MC-LEAK-EXEMPT:'
$hits = New-Object System.Collections.Generic.List[string]
$targets = foreach ($p in $Path) {
  $full = Join-Path $Root $p
  if (Test-Path $full -PathType Container) {
    Get-ChildItem $full -Recurse -File | Where-Object {
      $_.FullName -notmatch '\\(node_modules|\.git|\.docs-viewer-cache)(\\|$)' -and
      $_.Name -ne 'leak-sweep.private.txt'
    }
  } elseif (Test-Path $full) { Get-Item $full }
}

# A sweep that opened nothing is not a clean sweep.
if (@($targets).Count -eq 0) {
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
Write-Output ("LEAK-SWEEP CLEAN: 0 hits across {0} file(s). Mode={1}. PrivateTerms={2}." -f @($targets).Count, $Mode, $privateTerms.Count)
exit 0
