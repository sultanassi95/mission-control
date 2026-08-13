param(
  [string]$TermList = (Join-Path $PSScriptRoot "leak-guard.terms.txt"),
  [string]$Payload
)
$ErrorActionPreference = "Stop"

# PreToolUse hook. Reads the hook payload as JSON on stdin (or -Payload for
# tests), scans only the outward-artifact text inside tool_input, and exits 2
# to block when a deny-list term appears. Exit 0 means allow. Never calls a
# model and never reads the repo.

if (-not $Payload) { $Payload = [Console]::In.ReadToEnd() }
if (-not $Payload) { exit 0 }

try { $hook = $Payload | ConvertFrom-Json } catch { exit 0 }

# The commands that actually publish something. A `git status` is never scanned.
$outwardCommand = '(?i)git\s+(commit|tag\s+-[am])|gh\s+(pr|issue)\s+(create|edit|comment|review)|gh\s+release\s+create'

$text = $null
if ($hook.tool_name -eq 'Bash') {
  $cmd = [string]$hook.tool_input.command
  if ($cmd -and $cmd -match $outwardCommand) { $text = $cmd }
}
elseif ($hook.tool_name -match 'omment|reate.*ssue|pdate.*age') {
  # Tracker and wiki MCP tools: scan the whole input, it is all outward text.
  $text = ($hook.tool_input | ConvertTo-Json -Depth 12 -Compress)
}
if (-not $text) { exit 0 }

if (-not (Test-Path $TermList)) {
  [Console]::Error.WriteLine("leak-guard: term list not found at $TermList")
  exit 2
}

$hits = New-Object System.Collections.Generic.List[string]
foreach ($line in (Get-Content -LiteralPath $TermList -Encoding utf8)) {
  $pattern = $line.Trim()
  if (-not $pattern -or $pattern.StartsWith('#')) { continue }
  $m = [regex]::Match($text, $pattern, 'IgnoreCase')
  if ($m.Success) { $hits.Add("$pattern  ->  matched '$($m.Value)'") }
}

if ($hits.Count -gt 0) {
  $msg = @()
  $msg += "leak-guard BLOCKED this outward artifact: process vocabulary found."
  $msg += ""
  foreach ($h in $hits) { $msg += "  $h" }
  $msg += ""
  $msg += "Rewrite so the text records the CHANGE, not how the work was run."
  $msg += "Deny-list: $TermList"
  [Console]::Error.WriteLine(($msg -join [Environment]::NewLine))
  exit 2
}
exit 0
