$ErrorActionPreference = "Stop"
$toolsDir = Split-Path $PSScriptRoot -Parent
$guard    = Join-Path $toolsDir "leak-guard.ps1"

$failures = @()
function Assert($name, $cond) {
  if ($cond) { Write-Output "PASS  $name" } else { Write-Output "FAIL  $name"; $script:failures += $name }
}

# Run the hook exactly as the harness does: payload on STDIN, in a child
# process so its exit code is observable. Passing the JSON as a command-line
# argument instead mangles the quoting and the hook silently allows everything.
$errFile = Join-Path $env:TEMP "leak-guard-test-stderr.txt"
function RunHook($payloadObj, $terms) {
  $json = $payloadObj | ConvertTo-Json -Depth 12 -Compress
  $a = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $guard)
  if ($terms) { $a += @("-TermList", $terms) }
  # stderr goes to a file, never 2>&1: on PowerShell 5.1 a native exe writing
  # to stderr under ErrorActionPreference=Stop throws NativeCommandError.
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $json | & powershell @a 2>$script:errFile | Out-Null
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  $script:stderrText = if (Test-Path $script:errFile) { (Get-Content $script:errFile -Raw) } else { "" }
  return $code
}
function Bash($cmd)  { @{ tool_name = "Bash"; tool_input = @{ command = $cmd } } }
function Mcp($body)  { @{ tool_name = "mcp__plugin_atlassian_atlassian__addCommentToJiraIssue"; tool_input = @{ commentBody = $body } } }

# --- blocks: the artifact attributes the decision to a person ---
Assert "blocks 'founder decided' in a commit" `
  ((RunHook (Bash 'git commit -m "fix(x): revert the cache, founder decided it was wrong"')) -eq 2)
Assert "block message names the matched text" `
  ($stderrText -match "matched 'founder decided'")
Assert "blocks 'per the founder' in a PR body" `
  ((RunHook (Bash 'gh pr create --title "t" --body "Scoped per the founder to one endpoint."')) -eq 2)
Assert "blocks orchestration vocabulary" `
  ((RunHook (Bash 'git commit -m "chore(x): orchestrator retries the queue"')) -eq 2)
Assert "blocks a deliberation label" `
  ((RunHook (Bash 'git commit -m "fix(x): [ASSUMPTION] the index exists"')) -eq 2)
Assert "blocks an authorship trailer" `
  ((RunHook (Bash 'git commit -m "feat(x): add thing" -m "Co-Authored-By: Claude <a@b.c>"')) -eq 2)
Assert "blocks in a tracker comment (MCP tool)" `
  ((RunHook (Mcp 'Reopened because the founder said the first approach was wrong.')) -eq 2)

# --- allows: ordinary engineering text ---
Assert "allows a clean commit" `
  ((RunHook (Bash 'git commit -m "fix(auth): reject an expired refresh token with 401"')) -eq 0)
Assert "allows a clean PR body" `
  ((RunHook (Bash 'gh pr create --title "t" --body "Adds request validation so a contract violation is a 4xx."')) -eq 0)

# --- the false-positive family the tuning rule exists for ---
Assert "allows 'delegate'"    ((RunHook (Bash 'git commit -m "refactor(api): delegate parsing to the codec"')) -eq 0)
Assert "allows 'mitigate'"    ((RunHook (Bash 'git commit -m "fix(net): mitigate the retry storm"')) -eq 0)
Assert "allows 'aggregate'"   ((RunHook (Bash 'git commit -m "feat(db): aggregate rows per tenant"')) -eq 0)
Assert "allows 'navigate'"    ((RunHook (Bash 'git commit -m "fix(ui): navigate back after save"')) -eq 0)
Assert "allows 'investigate'" ((RunHook (Bash 'git commit -m "chore: investigate flaky suite"')) -eq 0)
Assert "allows 'gateway'"     ((RunHook (Bash 'git commit -m "feat(infra): add the api gateway stage"')) -eq 0)
Assert "allows 'stub' as a word" `
  ((RunHook (Bash 'git commit -m "test(x): stub the clock in the suite"')) -eq 0)

# --- scope: only outward commands are scanned ---
Assert "ignores a non-outward git command" `
  ((RunHook (Bash 'git status --short')) -eq 0)
Assert "ignores an unrelated bash command carrying a term" `
  ((RunHook (Bash 'grep -rn "orchestrator" framework/')) -eq 0)
Assert "ignores a non-matching tool" `
  ((RunHook @{ tool_name = "Read"; tool_input = @{ file_path = "orchestrator.md" } }) -eq 0)

# --- degenerate input ---
Assert "empty payload allows" ((RunHook @{}) -eq 0)
Assert "malformed json allows" ((RunHook "not json") -eq 0)

# --- NEGATIVE CONTROLS: prove the suite can go red ---
# 1. A term list the shipped one does not contain must still block.
$tmpTerms = Join-Path $PSScriptRoot "tmp-terms.txt"
'\bcompletely-ordinary-phrase\b' | Set-Content $tmpTerms -Encoding utf8
Assert "custom term list is honoured (control)" `
  ((RunHook (Bash 'git commit -m "feat(x): a completely-ordinary-phrase here"') $tmpTerms) -eq 2)
# 2. The same text must PASS under the shipped list, or control 1 proved nothing.
Assert "that phrase passes under the shipped list (control)" `
  ((RunHook (Bash 'git commit -m "feat(x): a completely-ordinary-phrase here"')) -eq 0)
Remove-Item $tmpTerms -Force

# --- shell twin parity: the .sh is what macOS and Linux actually run ---
$sh = Join-Path $toolsDir "leak-guard.sh"
# Bind the EXECUTABLE, not the name. This file defines a helper function called
# Bash, and PowerShell resolves functions ahead of applications, so `& bash`
# here would call that helper and never launch bash: the block tests fail while
# every allow test passes vacuously on a stale $LASTEXITCODE.
$bashExe = (Get-Command bash -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1)
if ($bashExe -and (Test-Path $sh)) {
  function RunSh($cmd) {
    $payload = (@{ tool_name = "Bash"; tool_input = @{ command = $cmd } } | ConvertTo-Json -Depth 12 -Compress)
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $payload | & $script:bashExe.Source $sh 2>$script:errFile | Out-Null
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    return $code
  }
  Assert "sh twin blocks a dirty commit"   ((RunSh 'git commit -m "fix: founder decided x"') -eq 2)
  Assert "sh twin allows a clean commit"   ((RunSh 'git commit -m "fix(auth): reject expired token"') -eq 0)
  Assert "sh twin allows 'delegate'"       ((RunSh 'git commit -m "refactor: delegate parsing"') -eq 0)
  Assert "sh twin ignores git status"      ((RunSh 'git status --short') -eq 0)
} else {
  Write-Output "SKIP  shell twin parity (bash not on PATH)"
}

if ($failures.Count -gt 0) { Write-Output "TESTS FAILED: $($failures -join ', ')"; exit 1 }
Write-Output "ALL LEAK-GUARD TESTS PASSED"; exit 0
