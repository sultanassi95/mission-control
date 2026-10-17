# leak-sweep.ps1 - PowerShell twin of leak-sweep.sh. Keep the two in step:
# the rules, the files each mode reads, where the deny-list is read from and
# the exit codes. CI runs this twin's tests on Windows; on macOS and Linux a
# change here is checked by reading it against leak-sweep.sh.
#
# promote with no -Path reads every file that ships: in a git work tree, each
# file git tracks and each new one it would add (untracked and not ignored);
# outside one, every file under the root but .git and the instance
# (_command/). It skips binary files, vendored or generated ones, and the test
# fixtures that plant a leak on purpose ($promoteSkip below). -Path names the
# files or folders to read instead, all of them.
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
$defaultInstanceTargets = @("_command", "CLAUDE.md")

# Files promote does not read: not written here, or planted on purpose. In
# step with skip_in_promote in leak-sweep.sh, and matched with case (-clike),
# as bash's case statement matches. Paths use forward slashes.
$promoteSkip = @(
  # vendored or generated
  'node_modules/*', '*/node_modules/*', 'vendor/*', '*/vendor/*', '.docs-viewer-cache/*', '*/.docs-viewer-cache/*',
  '*/.claude-plugin/types/*', '*.min.js', '*.min.css',
  'package-lock.json', '*/package-lock.json', 'pnpm-lock.yaml', '*/pnpm-lock.yaml', 'yarn.lock', '*/yarn.lock',
  # the leaks the sweep's own tests plant, one per rule
  'tools/tests/fixtures/dirty/*',
  # an operator's list, wherever it was left
  'leak-sweep.private.txt', '*/leak-sweep.private.txt'
)
function Test-PromoteSkip([string]$rel) {
  foreach ($p in $promoteSkip) { if ($rel -clike $p) { return $true } }
  return $false
}

# A file with a NUL byte is binary; a file with nothing but line breaks holds
# no text. Neither is read line by line (grep -Iq . in leak-sweep.sh).
function Test-HoldsText([string]$full) {
  $bytes = [System.IO.File]::ReadAllBytes($full)
  if ([Array]::IndexOf($bytes, [byte]0) -ge 0) { return $false }
  foreach ($b in $bytes) { if ($b -ne 10) { return $true } }
  return $false
}

# The files git lists under $root, relative and with forward slashes, or $null
# outside a git work tree. git's own stderr ("not a git repository") becomes a
# terminating error record under "Stop" in Windows PowerShell 5.1, so the
# preference is relaxed inside this function only.
function Get-GitListing([string]$root) {
  $ErrorActionPreference = "Continue"
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return $null }
  $inside = & git -C $root rev-parse --is-inside-work-tree 2>$null
  if ($LASTEXITCODE -ne 0 -or "$inside" -ne "true") { return $null }
  $raw = @(& git -C $root ls-files -z --cached --others --exclude-standard) -join "`n"
  if ($LASTEXITCODE -ne 0) {
    [Console]::Error.WriteLine("LEAK-SWEEP ERROR: git ls-files exit $LASTEXITCODE under '$root'.")
    exit 2
  }
  return ,@($raw -split "`0" | Where-Object { $_ })
}

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

# promote with no -Path reads every file that ships; instance mode and an
# explicit -Path read the named targets.
$fullListing = ($Mode -eq "promote") -and (-not $Path)
if (-not $Path -and $Mode -eq "instance") { $Path = $defaultInstanceTargets }
# One spelling of the root, so each file's path below it is cut in the right place.
if (Test-Path -LiteralPath $Root -PathType Container) { $Root = (Resolve-Path -LiteralPath $Root).ProviderPath.TrimEnd('\', '/') }

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
# What promote listed but did not read, counted so the clean line says so.
$listed = ""
$notByName = 0; $notBinary = 0; $notDeleted = 0
if ($fullListing) {
  if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    [Console]::Error.WriteLine("LEAK-SWEEP ERROR: no folder at '$Root' for mode=$Mode.")
    exit 2
  }
  $rels = Get-GitListing $Root
  if ($null -ne $rels) {
    $listed = "every file git lists"
  } else {
    $listed = "every file under the root"
    $rels = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Force | ForEach-Object {
      $_.FullName.Substring($Root.Length).TrimStart('\', '/') -replace '\\', '/'
    } | Where-Object { -not ($_ -ceq '.git' -or $_ -clike '.git/*' -or $_ -clike '_command/*') })
  }
  foreach ($rel in $rels) {
    if (Test-PromoteSkip $rel) { $notByName++; continue }
    $full = Join-Path $Root $rel
    # Tracked, but deleted in this work tree.
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { $notDeleted++; continue }
    if (-not (Test-HoldsText $full)) { $notBinary++; continue }
    $targets += Get-Item -LiteralPath $full -Force
  }
}
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
  $what = if ($fullListing) { $listed } else { "targets: $($Path -join ' ')" }
  [Console]::Error.WriteLine("LEAK-SWEEP ERROR: no files under '$Root' for mode=$Mode ($what).")
  exit 2
}

foreach ($file in @($targets)) {
  $rel = $file.FullName.Substring($Root.Length).TrimStart('\', '/')
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
  $scope = ""
  if ($fullListing) {
    $scope = ", $listed; not read: $notBinary binary or empty, $notByName skipped by name"
    if ($notDeleted -gt 0) { $scope += ", $notDeleted deleted from the work tree" }
  }
  Write-Output ("LEAK-SWEEP CLEAN: 0 hits across {0} file(s){1}. Mode={2}. PrivateTerms={3} from {4}." -f $targets.Count, $scope, $Mode, $privateTerms.Count, $PrivateList)
} else {
  Write-Output ("LEAK-SWEEP CLEAN: 0 hits across {0} file(s). Mode={1}. The deny-list is for what ships, so this mode does not read it." -f $targets.Count, $Mode)
}
exit 0
