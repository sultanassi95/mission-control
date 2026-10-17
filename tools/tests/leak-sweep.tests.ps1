$ErrorActionPreference = "Stop"
$toolsDir  = Split-Path $PSScriptRoot -Parent
$sweep     = Join-Path $toolsDir "leak-sweep.ps1"
$fixtures  = Join-Path $PSScriptRoot "fixtures"
$dirty     = Join-Path $fixtures "dirty"
$clean     = Join-Path $fixtures "clean"
$privList  = Join-Path $PSScriptRoot "test-private.txt"
"Zoltan" | Set-Content $privList -Encoding utf8
# A list named in the caller's environment would stand in for the ones these
# cases name or leave missing; the case that needs the override sets it.
Remove-Item Env:LEAK_SWEEP_PRIVATE_LIST -ErrorAction SilentlyContinue

$failures = @()
function Assert($name, $cond) {
  if ($cond) { Write-Output "PASS  $name" } else { Write-Output "FAIL  $name"; $script:failures += $name }
}

# Runs a copy of the sweep in a child process and returns its exit code and its
# output, stderr included. Windows PowerShell 5.1 turns redirected native
# stderr into error records, which "Stop" would make terminating, so the
# preference is relaxed inside this function only.
function Sweep([string]$script, [string[]]$sweepArgs) {
  $ErrorActionPreference = "Continue"
  $lines = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $script @sweepArgs 2>&1 | ForEach-Object { "$_" })
  return @{ Code = $LASTEXITCODE; Text = ($lines -join "`n") }
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
Assert "flags the legacy name"(($out | Select-String '\[legacy-name\]').Count -ge 1)
Assert "flags version-pinned model"        (($out | Select-String '\[model-pin\]').Count -ge 2)
Assert "flags private term Zoltan"         (($out | Select-String '\[private-term\] Zoltan').Count -ge 1)
Assert "exempt line not flagged"           (($out | Select-String 'exempt\.md').Count -eq 0)
Assert "placeholder not flagged (promote)" (($out | Select-String '\[leftover-placeholder\]').Count -eq 0)

$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $sweep -Root $dirty -Path @(".") -Mode instance -PrivateList $privList
Assert "instance flags placeholder"        (($out | Select-String '\[leftover-placeholder\]').Count -ge 3)
Assert "instance skips identity rules"     (($out | Select-String '\[email\]|\[windows-user-path\]|\[unix-home-path\]|\[aws-account-id\]').Count -eq 0)
Assert "instance still flags secrets"      (($out | Select-String '\[aws-access-key\]|\[github-token\]|\[generic-secret\]').Count -ge 3)
Assert "instance does not read the deny-list" (($out | Select-String '\[private-term\]').Count -eq 0)

$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $sweep -Root $clean -Path @(".") -Mode promote -PrivateList $privList
Assert "clean promote exits 0"             ($LASTEXITCODE -eq 0)
Assert "clean line names the list it read" (($out | Select-String -SimpleMatch "PrivateTerms=1 from $privList").Count -eq 1)

# Where the deny-list is read from. Each case runs a copy of the sweep in its
# own folder, so the instance beside that copy's tools/ folder and the old
# tools/ path are the test's own, never the repo's.
$sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ("leak-sweep-tests-" + [guid]::NewGuid().ToString("N"))
function Portfolio([string]$name) {
  $p = Join-Path $sandbox $name
  New-Item -ItemType Directory -Force (Join-Path $p "tools") | Out-Null
  New-Item -ItemType Directory -Force (Join-Path $p "_command") | Out-Null
  Copy-Item $sweep (Join-Path $p "tools\leak-sweep.ps1")
  return $p
}

$p = Portfolio "missing"
$r = Sweep (Join-Path $p "tools\leak-sweep.ps1") @("-Root", $clean, "-Path", ".", "-Mode", "promote")
Assert "NEGATIVE CONTROL: no deny-list, so promote exits 2" ($r.Code -eq 2)
Assert "no deny-list: the error names the path it looked at" ($r.Text.Contains("no private deny-list at '" + (Join-Path $p "_command/leak-sweep.private.txt") + "'"))

$p = Portfolio "legacy"
"Zoltan" | Set-Content (Join-Path $p "tools\leak-sweep.private.txt") -Encoding utf8
$r = Sweep (Join-Path $p "tools\leak-sweep.ps1") @("-Root", $dirty, "-Path", ".", "-Mode", "promote")
Assert "a list at the old tools/ path is not read: exit 2"  ($r.Code -eq 2)
Assert "a list at the old tools/ path: the error says move it" ($r.Text.Contains("sits at the old path"))

$p = Portfolio "instance"
"Zoltan" | Set-Content (Join-Path $p "_command\leak-sweep.private.txt") -Encoding utf8
$r = Sweep (Join-Path $p "tools\leak-sweep.ps1") @("-Root", $dirty, "-Path", ".", "-Mode", "promote")
Assert "the list in the instance is read by default"  (($r.Code -eq 1) -and $r.Text.Contains("[private-term] Zoltan"))

$p = Portfolio "override"
$env:LEAK_SWEEP_PRIVATE_LIST = $privList
$r = Sweep (Join-Path $p "tools\leak-sweep.ps1") @("-Root", $dirty, "-Path", ".", "-Mode", "promote")
Remove-Item Env:LEAK_SWEEP_PRIVATE_LIST
Assert "LEAK_SWEEP_PRIVATE_LIST names a list outside the instance" (($r.Code -eq 1) -and $r.Text.Contains("[private-term] Zoltan"))

# promote with no -Path reads every file that ships, not a list of folders. A
# list once left tools/ unread, so real names in its tests and comments passed.
# The portfolios are plain folders, so git stops looking above the sandbox.
$env:GIT_CEILING_DIRECTORIES = $sandbox
$p = Portfolio "full"
"Zoltan" | Set-Content (Join-Path $p "_command\leak-sweep.private.txt") -Encoding utf8
New-Item -ItemType Directory -Force (Join-Path $p "tools\mods\demo") | Out-Null
@("test('x', () => {", "  expect(seat('console-zoltan')).toBe(1)", "})") | Set-Content (Join-Path $p "tools\mods\demo\demo.test.ts") -Encoding utf8
$r = Sweep (Join-Path $p "tools\leak-sweep.ps1") @("-Mode", "promote")
Assert "no -Path: a term in tools/ fails by file, line and term" (($r.Code -eq 1) -and $r.Text.Contains("demo.test.ts:2: [private-term] Zoltan"))

$p = Portfolio "instance-unread"
"Zoltan" | Set-Content (Join-Path $p "_command\leak-sweep.private.txt") -Encoding utf8
@("# Hub", "The Zoltan front.") | Set-Content (Join-Path $p "_command\hub.md") -Encoding utf8
$r = Sweep (Join-Path $p "tools\leak-sweep.ps1") @("-Mode", "promote")
Assert "no -Path: promote does not read the instance" (($r.Code -eq 0) -and $r.Text.Contains("every file under the root"))

$p = Portfolio "binary"
"Zoltan" | Set-Content (Join-Path $p "_command\leak-sweep.private.txt") -Encoding utf8
[System.IO.File]::WriteAllBytes((Join-Path $p "tools\shot.png"), [byte[]](80, 78, 71, 0, 90, 111, 108, 116, 97, 110, 10))
$r = Sweep (Join-Path $p "tools\leak-sweep.ps1") @("-Mode", "promote")
Assert "no -Path: a binary file is not read, and the clean line counts it" (($r.Code -eq 0) -and $r.Text.Contains("not read: 1 binary or empty, 0 skipped by name"))

$p = Portfolio "planted"
"Zoltan" | Set-Content (Join-Path $p "_command\leak-sweep.private.txt") -Encoding utf8
New-Item -ItemType Directory -Force (Join-Path $p "tools\tests\fixtures\dirty") | Out-Null
"Planted: Zoltan." | Set-Content (Join-Path $p "tools\tests\fixtures\dirty\planted.md") -Encoding utf8
$r = Sweep (Join-Path $p "tools\leak-sweep.ps1") @("-Mode", "promote")
Assert "no -Path: the fixtures that plant a leak are skipped, and counted" (($r.Code -eq 0) -and $r.Text.Contains("0 binary or empty, 1 skipped by name"))

# Each case below mirrors one in leak-sweep.tests.sh. A letter outside ASCII is
# built from its code point so this file stays ASCII, and the asserts match on
# file and line, which print the same in any console code page.
$utf8 = New-Object System.Text.UTF8Encoding $false
$p = Portfolio "wide"
[System.IO.File]::WriteAllText((Join-Path $p "_command\leak-sweep.private.txt"), ("zo" + [char]0x00EB + "`n"), $utf8)
[System.IO.File]::WriteAllText((Join-Path $p "tools\u.md"), ("# Tools`nBuilt at ZO" + [char]0x00CB + "`n"), $utf8)
$r = Sweep (Join-Path $p "tools\leak-sweep.ps1") @("-Mode", "promote")
Assert "no -Path: a term outside ASCII matches whatever its case" (($r.Code -eq 1) -and $r.Text.Contains("u.md:2: [private-term]"))

$p = Portfolio "padded"
[System.IO.File]::WriteAllText((Join-Path $p "_command\leak-sweep.private.txt"), "  Zoltan `r`n", $utf8)
"The Zoltan report." | Set-Content (Join-Path $p "tools\c.md") -Encoding utf8
$r = Sweep (Join-Path $p "tools\leak-sweep.ps1") @("-Mode", "promote")
Assert "no -Path: a padded term in a list saved with Windows line endings still matches" (($r.Code -eq 1) -and $r.Text.Contains("c.md:1: [private-term] Zoltan"))

$p = Portfolio "marker"
"Zoltan" | Set-Content (Join-Path $p "_command\leak-sweep.private.txt") -Encoding utf8
"seat: Zoltan  MC-LEAK-EXEMPT: test data" | Set-Content (Join-Path $p "tools\m.md") -Encoding utf8
$r = Sweep (Join-Path $p "tools\leak-sweep.ps1") @("-Mode", "promote")
Assert "no -Path: the exempt marker never hides a deny-list term" (($r.Code -eq 1) -and $r.Text.Contains("m.md:1: [private-term] Zoltan"))

$p = Portfolio "shipped-list"
"Zoltan" | Set-Content (Join-Path $p "_command\leak-sweep.private.txt") -Encoding utf8
New-Item -ItemType Directory -Force (Join-Path $p "docs") | Out-Null
"Zoltan" | Set-Content (Join-Path $p "docs\leak-sweep.private.txt") -Encoding utf8
$r = Sweep (Join-Path $p "tools\leak-sweep.ps1") @("-Mode", "promote")
Assert "no -Path: a deny-list among the files that ship fails the sweep" (($r.Code -eq 1) -and $r.Text.Contains("leak-sweep.private.txt: [private-list]"))

$p = Portfolio "addresses"
"Zoltan" | Set-Content (Join-Path $p "_command\leak-sweep.private.txt") -Encoding utf8
@("git@github.com:acme/widgets.git", "ssh://deploy@git.example.org/acme.git", "ops@example.com, a@b.test") | Set-Content (Join-Path $p "tools\r.md") -Encoding utf8
$r = Sweep (Join-Path $p "tools\leak-sweep.ps1") @("-Mode", "promote")
Assert "no -Path: a git remote's user and the reserved example domains are not addresses" (($r.Code -eq 0) -and $r.Text.Contains("LEAK-SWEEP CLEAN"))
"Write to ops@example-mail.com." | Set-Content (Join-Path $p "tools\s.md") -Encoding utf8 # MC-LEAK-EXEMPT: a planted address
$r = Sweep (Join-Path $p "tools\leak-sweep.ps1") @("-Mode", "promote")
Assert "no -Path: an address on a domain that only resembles a reserved one is flagged" (($r.Code -eq 1) -and $r.Text.Contains("s.md:1: [email] ops@example-mail.com")) # MC-LEAK-EXEMPT: a planted address
Remove-Item Env:GIT_CEILING_DIRECTORIES

Remove-Item $sandbox -Recurse -Force

$wb = Join-Path $fixtures "wb"; New-Item -ItemType Directory -Force $wb | Out-Null
"We use NestJS for the API." | Set-Content (Join-Path $wb "wb.md") -Encoding utf8
"nest" | Set-Content $privList -Encoding utf8
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $sweep -Root $wb -Path @(".") -Mode promote -PrivateList $privList
Assert "NestJS not flagged for term nest"  ($LASTEXITCODE -eq 0)

Remove-Item $privList -Force; Remove-Item $wb -Recurse -Force
if ($failures.Count -gt 0) { Write-Output "TESTS FAILED: $($failures -join ', ')"; exit 1 }
Write-Output "ALL LEAK-SWEEP TESTS PASSED"; exit 0
