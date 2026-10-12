<#
.SYNOPSIS
  Build a signed Pry installer and the updater manifest (latest.json).

.DESCRIPTION
  1. Points TAURI_SIGNING_PRIVATE_KEY at the updater private key file (the
     Tauri CLI accepts a path or the key text; a path keeps the key out of the
     environment dump). The key has no password.
  2. Runs `cargo tauri build --ci` in src-tauri, then restores Cargo.toml's
     original bytes (the build rewrites its line endings).
  3. Writes latest.json next to the installer with version, notes (that
     version's CHANGELOG.md section), pub_date and the windows-x86_64 entry.
  4. Prints the `gh release create` command. It does not run it.

  See docs/releasing.md.

.PARAMETER KeyPath
  Updater private key. Default: $HOME\.tauri\pry-updater.key

.PARAMETER SkipBuild
  Reuse the installer and .sig already in target\release\bundle\nsis and only
  write latest.json.
#>
param(
  [string]$KeyPath = (Join-Path $HOME '.tauri\pry-updater.key'),
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tauriDir = Join-Path $root 'src-tauri'

$conf = Get-Content (Join-Path $tauriDir 'tauri.conf.json') -Raw | ConvertFrom-Json
$version = $conf.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "tauri.conf.json version '$version' is not plain semver" }
$tag = "v$version-alpha"
Write-Host "Pry $version (tag $tag)"

$nsisDir = Join-Path $tauriDir 'target\release\bundle\nsis'
$installerName = "Pry_${version}_x64-setup.exe"
$installer = Join-Path $nsisDir $installerName
$sigFile = "$installer.sig"

if (-not $SkipBuild) {
  if (-not (Test-Path $KeyPath)) { throw "Updater private key not found at the given -KeyPath" }
  # Never print these values.
  $env:TAURI_SIGNING_PRIVATE_KEY = $KeyPath
  # Empty password. PowerShell drops an env var set to '', so `--ci` is what
  # makes the CLI use an empty password instead of prompting.
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
  # The build rewrites Cargo.toml's line endings. Put the exact bytes back
  # afterwards (same effect as `git checkout -- src-tauri/Cargo.toml` on a
  # clean tree, without throwing away uncommitted edits).
  $cargoToml = Join-Path $tauriDir 'Cargo.toml'
  $cargoBytes = [System.IO.File]::ReadAllBytes($cargoToml)
  Push-Location $tauriDir
  try {
    cargo tauri build --ci
    if ($LASTEXITCODE -ne 0) { throw "cargo tauri build failed ($LASTEXITCODE)" }
  } finally {
    Pop-Location
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
    [System.IO.File]::WriteAllBytes($cargoToml, $cargoBytes)
  }
}

if (-not (Test-Path $installer)) { throw "Installer not found: $installer" }
if (-not (Test-Path $sigFile)) { throw "Signature not found: $sigFile (was TAURI_SIGNING_PRIVATE_KEY set and bundle.createUpdaterArtifacts true?)" }

# Notes: the "## <version>" section of CHANGELOG.md, without its heading.
$changelog = Get-Content (Join-Path $root 'CHANGELOG.md')
$notes = New-Object System.Collections.Generic.List[string]
$inSection = $false
foreach ($line in $changelog) {
  if ($line -match '^## ') {
    if ($inSection) { break }
    if ($line.Trim() -eq "## $version") { $inSection = $true }
    continue
  }
  if ($inSection) { $notes.Add($line) }
}
if (-not $inSection) { Write-Warning "CHANGELOG.md has no '## $version' section; notes will be empty" }

$manifest = [ordered]@{
  version   = $version
  notes     = ($notes -join "`n").Trim()
  pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    'windows-x86_64' = [ordered]@{
      signature = (Get-Content $sigFile -Raw).Trim()
      url       = "https://github.com/BeargleIndustries/pry/releases/download/$tag/$installerName"
    }
  }
}
$latest = Join-Path $nsisDir 'latest.json'
$json = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($latest, $json, (New-Object System.Text.UTF8Encoding $false))

$hash = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLower()
Write-Host ""
Write-Host "Installer : $installer"
Write-Host "SHA256    : $hash"
Write-Host "Manifest  : $latest"
Write-Host ""
Write-Host "Check the build, then publish with (not run):"
Write-Host ""
Write-Host "  gh release create $tag ``"
Write-Host "    `"$installer`" ``"
Write-Host "    `"$latest`" ``"
Write-Host "    --title `"Pry $version-alpha`" --notes-file <notes.md> --latest"
Write-Host ""
Write-Host "Attach latest.json to every release from now on. The app reads"
Write-Host "releases/latest/download/latest.json, and GitHub's 'latest' skips releases"
Write-Host "marked pre-release, so don't tick that box."
