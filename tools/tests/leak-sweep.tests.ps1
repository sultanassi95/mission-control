$ErrorActionPreference = "Stop"
$toolsDir  = Split-Path $PSScriptRoot -Parent
$sweep     = Join-Path $toolsDir "leak-sweep.ps1"
$fixtures  = Join-Path $PSScriptRoot "fixtures"
$dirty     = Join-Path $fixtures "dirty"
$clean     = Join-Path $fixtures "clean"
$privList  = Join-Path $PSScriptRoot "test-private.txt"
"Zoltan" | Set-Content $privList -Encoding utf8

$failures = @()
function Assert($name, $cond) {
  if ($cond) { Write-Output "PASS  $name" } else { Write-Output "FAIL  $name"; $script:failures += $name }
}

$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $sweep -Root $dirty -Path @(".") -Mode promote -PrivateList $privList
Assert "dirty promote exits 1"             ($LASTEXITCODE -eq 1)
Assert "flags email"                       (($out | Select-String '\[email\]').Count -ge 1)
Assert "flags windows path"                (($out | Select-String '\[windows-user-path\]').Count -ge 1)
Assert "flags unix home path"              (($out | Select-String '\[unix-home-path\]').Count -ge 1)
Assert "flags aws access key"              (($out | Select-String '\[aws-access-key\]').Count -ge 1)
Assert "flags generic secret"              (($out | Select-String '\[generic-secret\]').Count -ge 1)
Assert "flags aws account id"              (($out | Select-String '\[aws-account-id\]').Count -ge 1)
Assert "flags github token"                (($out | Select-String '\[github-token\]').Count -ge 1)
Assert "flags legacy name pmc"             (($out | Select-String '\[legacy-name\]').Count -ge 1)
Assert "flags version-pinned model"        (($out | Select-String '\[model-pin\]').Count -ge 2)
Assert "flags private term Zoltan"         (($out | Select-String '\[private-term\] Zoltan').Count -ge 1)
Assert "exempt line not flagged"           (($out | Select-String 'exempt\.md').Count -eq 0)
Assert "placeholder not flagged (promote)" (($out | Select-String '\[leftover-placeholder\]').Count -eq 0)

$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $sweep -Root $dirty -Path @(".") -Mode instance -PrivateList $privList
Assert "instance flags placeholder"        (($out | Select-String '\[leftover-placeholder\]').Count -ge 3)
Assert "instance skips identity rules"     (($out | Select-String '\[email\]|\[windows-user-path\]|\[unix-home-path\]|\[aws-account-id\]').Count -eq 0)
Assert "instance still flags secrets"      (($out | Select-String '\[aws-access-key\]|\[github-token\]|\[generic-secret\]').Count -ge 3)
Assert "instance still flags private term" (($out | Select-String '\[private-term\] Zoltan').Count -ge 1)

$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $sweep -Root $clean -Path @(".") -Mode promote -PrivateList $privList
Assert "clean promote exits 0"             ($LASTEXITCODE -eq 0)

$wb = Join-Path $fixtures "wb"; New-Item -ItemType Directory -Force $wb | Out-Null
"We use NestJS for the API." | Set-Content (Join-Path $wb "wb.md") -Encoding utf8
"nest" | Set-Content $privList -Encoding utf8
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $sweep -Root $wb -Path @(".") -Mode promote -PrivateList $privList
Assert "NestJS not flagged for term nest"  ($LASTEXITCODE -eq 0)

Remove-Item $privList -Force; Remove-Item $wb -Recurse -Force
if ($failures.Count -gt 0) { Write-Output "TESTS FAILED: $($failures -join ', ')"; exit 1 }
Write-Output "ALL LEAK-SWEEP TESTS PASSED"; exit 0
