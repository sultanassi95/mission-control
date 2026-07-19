param(
  [string]$Root = (Split-Path $PSScriptRoot -Parent)
)
# check-refs: every framework/, .claude/skills/, kit/ path named in a shipped
# doc must exist on disk. Prevention infrastructure for the "prose references
# a removed artifact" defect family. Exit 0 clean / 1 with file: ref lines.
$ErrorActionPreference = "Stop"
$targets = @("framework", ".claude\skills", "README.md", "LIFTOFF.md", "CLAUDE.md", "CHANGELOG.md")
$pattern = '(?<![\w/-])((?:framework|\.claude/skills|kit)/[A-Za-z0-9_./-]+\.(?:md|ps1|sh|template))'
$broken = New-Object System.Collections.Generic.List[string]
$files = foreach ($t in $targets) {
  $full = Join-Path $Root $t
  if (Test-Path $full -PathType Container) { Get-ChildItem $full -Recurse -File -Filter *.md }
  elseif (Test-Path $full) { Get-Item $full }
}
$checked = 0
foreach ($f in @($files)) {
  $rel = $f.FullName.Substring($Root.Length).TrimStart('\')
  $fileDir = Split-Path $f.FullName -Parent
  foreach ($m in ([regex]::Matches([System.IO.File]::ReadAllText($f.FullName), $pattern))) {
    $ref = $m.Groups[1].Value
    if ($ref -match '<|>') { continue }
    $checked++
    # kit/ refs resolve relative to framework/ (doctrine cross-links) or the file's own dir
    $candidates = @((Join-Path $Root ($ref -replace '/', '\'))) +
      $(if ($ref.StartsWith('kit/')) { @((Join-Path $Root ("framework\" + ($ref -replace '/', '\'))), (Join-Path $fileDir ($ref -replace '/', '\'))) } else { @() })
    if (-not ($candidates | Where-Object { Test-Path $_ })) { $broken.Add("${rel}: $ref") }
  }
}
if ($broken.Count -gt 0) {
  $broken | Sort-Object -Unique | ForEach-Object { Write-Output $_ }
  Write-Output ("CHECK-REFS FAILED: {0} broken reference(s), {1} checked." -f $broken.Count, $checked)
  exit 1
}
Write-Output ("CHECK-REFS CLEAN: {0} references checked, all resolve." -f $checked)
exit 0
