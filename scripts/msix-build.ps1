#Requires -Version 5.1
<#
  Builds an MSIX package via @choochmeque/tauri-windows-bundle.
  If the repo path contains spaces, maps it with SUBST to a free drive letter so
  msixbundle-cli gets paths without embedded spaces.

  Prerequisites: npm install, Rust, `cargo install msixbundle-cli` (Cargo bin used automatically).

  Output: src-tauri/target/msix/
#>
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemainingArguments
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$cargoBin = Join-Path (Join-Path $HOME ".cargo") "bin"
if (Test-Path $cargoBin) {
  $env:PATH = "$cargoBin;$env:PATH"
}

$msixOk = (Get-Command msixbundle-cli -ErrorAction SilentlyContinue) -or (Test-Path (Join-Path $cargoBin "msixbundle-cli.exe"))
if (-not $msixOk) {
  Write-Error @"
msixbundle-cli not found on PATH or under $cargoBin.
Install once:  cargo install msixbundle-cli --locked
This script prepends '$cargoBin' to PATH when that folder exists.
"@
}

$cli = Join-Path $repoRoot "node_modules\@choochmeque\tauri-windows-bundle\dist\cli.js"
if (-not (Test-Path $cli)) {
  Write-Error "Run npm install first (missing tauri-windows-bundle CLI at $cli)"
}

function Invoke-MsixCli {
  param([string]$WorkingDirectory)
  $prev = Get-Location
  try {
    Set-Location -LiteralPath $WorkingDirectory
    if (-not (Test-Path "src-tauri\tauri.conf.json")) {
      Write-Error "MSIX build expected src-tauri\tauri.conf.json under $(Get-Location)"
    }
    & node $cli build @RemainingArguments
    return $LASTEXITCODE
  }
  finally {
    Set-Location -LiteralPath $prev
  }
}

$hasSpaces = $repoRoot -match "\s"
if (-not $hasSpaces) {
  exit (Invoke-MsixCli $repoRoot)
}

$driveLetter = $null
foreach ($ch in "QRVWXYZUNMLKJIHGFEDCBA".ToCharArray()) {
  $candidate = "${ch}:"
  if (-not (Test-Path $candidate)) {
    $driveLetter = $ch
    break
  }
}
if ($null -eq $driveLetter) {
  Write-Error "No free drive letter for SUBST. Free a drive or clone the repo to a path without spaces."
}

$substTarget = $driveLetter + ":\"
subst "${driveLetter}:" $repoRoot
try {
  exit (Invoke-MsixCli $substTarget)
}
finally {
  subst "${driveLetter}:" /d
}
