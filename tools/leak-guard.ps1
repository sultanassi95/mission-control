param(
  [string]$TermList = (Join-Path $PSScriptRoot "leak-guard.terms.txt"),
  [string]$Payload
)
$ErrorActionPreference = "Stop"

# PreToolUse hook. Reads the hook payload as JSON on stdin (or -Payload for
# tests), scans the outward-artifact text inside tool_input, and exits 2 to
# block when a deny-list term appears. Exit 0 allows. Never calls a model and
# never reads repo files.

if (-not $Payload) { $Payload = [Console]::In.ReadToEnd() }
if (-not $Payload) { exit 0 }

try { $hook = $Payload | ConvertFrom-Json -ErrorAction Stop }
catch {
  # Fail open, but never silently: a malformed payload once made this hook
  # allow everything while its tests still passed.
  [Console]::Error.WriteLine("leak-guard: payload did not parse as JSON, allowing")
  exit 0
}

# A publishing command, tolerant of global flags between the binary and the
# subcommand. `git -c k=v commit` and `git -C dir commit` are ordinary, and an
# adjacency-only pattern misses both. Segment separators stop the scan leaking
# across a chained command.
$gitPublish = '(?i)\bgit\b[^;&|]*?\b(commit|tag)\b'
$ghPublish  = '(?i)\bgh\b[^;&|]*?\b(pr|issue|release)\b[^;&|]*?\b(create|edit|comment|review)\b'
# The message lives in a file the hook cannot see. `-F -` is fine: that body
# arrives inline in the command.
$fileBorne  = '(?i)(--file=|--body-file|--notes-file|--fill\b|--fill-first\b)|(-F|--file)\s+(?!-\s|-$)\S+'
# Tracker and wiki WRITES. A read or a search is not scanned, so a JQL query
# mentioning a deny-list word is not blocked.
$outwardTool = '(?i)^mcp__.*(add|create|edit|update|post|append).*(comment|issue|page|worklog|description|ticket)'

$text = $null
$fileBorneHit = $false
if ($hook.tool_name -eq 'Bash') {
  $cmd = [string]$hook.tool_input.command
  if ($cmd -and (($cmd -match $gitPublish) -or ($cmd -match $ghPublish))) {
    $text = $cmd
    if ($cmd -match $fileBorne) { $fileBorneHit = $true }
  }
}
elseif ($hook.tool_name -match $outwardTool) {
  $text = ($hook.tool_input | ConvertTo-Json -Depth 12 -Compress)
}
if (-not $text) { exit 0 }

if ($fileBorneHit) {
  [Console]::Error.WriteLine(@(
    "leak-guard BLOCKED this outward artifact: its text comes from a file.",
    "",
    "  A file-borne message (-F FILE, --file=, --body-file, --notes-file, --fill)",
    "  cannot be checked, so it is refused rather than waved through.",
    "",
    "  Inline it with -m, or pipe it in with -F - and a heredoc."
  ) -join [Environment]::NewLine)
  exit 2
}

if (-not (Test-Path $TermList)) {
  [Console]::Error.WriteLine("leak-guard: term list not found at $TermList")
  exit 2
}

$hits = New-Object System.Collections.Generic.List[string]
foreach ($line in (Get-Content -LiteralPath $TermList -Encoding utf8)) {
  $pattern = $line.Trim()
  if (-not $pattern -or $pattern.StartsWith('#')) { continue }
  # The list is hand-edited, so a bad pattern must not take the hook down.
  try { $m = [regex]::Match($text, $pattern, 'IgnoreCase') }
  catch { [Console]::Error.WriteLine("leak-guard: skipping unparseable pattern: $pattern"); continue }
  if ($m.Success) { $hits.Add("$pattern  ->  matched '$($m.Value)'") }
}

if ($hits.Count -gt 0) {
  $msg = @("leak-guard BLOCKED this outward artifact: process vocabulary found.", "")
  foreach ($h in $hits) { $msg += "  $h" }
  $msg += @("", "Rewrite so the text records the CHANGE, not how the work was run.", "Deny-list: $TermList")
  [Console]::Error.WriteLine(($msg -join [Environment]::NewLine))
  exit 2
}
exit 0
