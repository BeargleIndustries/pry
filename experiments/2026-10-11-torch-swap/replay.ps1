<#
.SYNOPSIS
  T3a: replay Pry's bootstrap pip steps 1-5 (src-tauri/src/bootstrap/pip.rs) in a
  scratch runtime and record, per step, what pip resolves for torch.

.DESCRIPTION
  For each step N (1..5):
    (i)   pip install --dry-run --report <scratch>\step-N.full.json <args>
          -> trimmed copy saved as <experiment>\step-N.json (variant cu124) or
             <experiment>\cpu\step-N.json (variant cpu)
    (ii)  the real install, full log in <scratch>\step-N.log
    (iii) snapshot of torch / transformer_lens / sae_lens / sympy / pry_sidecar dist-info
          names, plus a pip freeze, in <scratch>\after-step-N.*
  A summary (summary-<variant>.txt) is written to the experiment dir.

  Never touches %LOCALAPPDATA%\Pry\runtime except to COPY the PBS interpreter
  files (python.exe, Lib, DLLs, ...) out of it. Use -DownloadPbs to fetch and
  SHA256-verify the exact tarball from pbs.rs instead.

.PARAMETER Variant
  cu124 (default) or cpu. Selects the torch index exactly like probe.rs.

.PARAMETER Fixed
  Replays the T3 bootstrapper exactly as pip.rs `pip_command_for_step` builds it:
    - pip invoked as `venv\Scripts\python.exe -m pip`,
    - `-c src-tauri\resources\constraints-runtime-<variant>.txt` on every step
      (NOT PIP_CONSTRAINT: whitespace-split, breaks on paths with spaces),
    - `--extra-index-url <torch index>` on every step,
    - step 1 = `--no-cache-dir torch==2.5.1+<variant>`,
    - step 4 = the current requirements-runtime.txt, step 5 = the current sidecar\.
  Throws unless the torch dist-info is torch-2.5.1+<variant>.dist-info after
  every step. Outputs go to .\fixed-<variant>\ and summary-fixed-<variant>.txt.

.EXAMPLE
  pwsh -File replay.ps1 -Variant cu124
  pwsh -File replay.ps1 -Variant cpu -SkipDryRun
  pwsh -File replay.ps1 -Fixed -Variant cu124 -DownloadPbs -SkipDryRun
#>
[CmdletBinding()]
param(
    [ValidateSet('cu124', 'cpu')]
    [string]$Variant = 'cu124',
    [switch]$Fixed,
    [string]$Scratch = (Join-Path $env:TEMP "pry-replay\$Variant"),
    [switch]$DownloadPbs,
    [switch]$SkipDryRun,
    # Experiment-only (used to produce freeze-cu124.txt): passes `-c <file>` to every step
    # and adds --extra-index-url <torch index> to steps 2-5. Outputs go to .\constrained-<variant>\.
    [string]$ConstraintFile
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($Fixed -and $ConstraintFile) { throw '-Fixed uses the repo constraints file; do not combine with -ConstraintFile.' }

# --- constants mirrored from the repo -------------------------------------------------
$ExpDir   = $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $ExpDir '..\..')).Path
$Tag      = if ($Fixed) { "fixed-$Variant" } elseif ($ConstraintFile) { "constrained-$Variant" } else { $Variant }
$OutDir   = if ($Tag -eq 'cu124') { $ExpDir } else { Join-Path $ExpDir $Tag }
if ($ConstraintFile) {
    # NOT $env:PIP_CONSTRAINT: pip splits that env var on whitespace, so a path with a space
    # (this repo, or a user profile like C:\Users\John Smith) fails with Errno 13. See README.
    $ConstraintFile = (Resolve-Path $ConstraintFile).Path
    if ($PSBoundParameters.Keys -notcontains 'Scratch') { $Scratch = Join-Path $env:TEMP "pry-replay\$Tag" }
}
if ($Fixed) {
    $ConstraintFile = (Resolve-Path (Join-Path $RepoRoot "src-tauri\resources\constraints-runtime-$Variant.txt")).Path
    if ($PSBoundParameters.Keys -notcontains 'Scratch') { $Scratch = Join-Path $env:TEMP "pry-replay\$Tag" }
}
New-Item -ItemType Directory -Force $OutDir | Out-Null

# pbs.rs
$PbsUrl    = 'https://github.com/astral-sh/python-build-standalone/releases/download/20260408/cpython-3.12.13%2B20260408-x86_64-pc-windows-msvc-install_only.tar.gz'
$PbsSha256 = '99bbc3828c25409e747de9a491616685d17b855ae359d0fbf6ab51d2b4cd7e61'
# probe.rs
$TorchIndex = @{ cu124 = 'https://download.pytorch.org/whl/cu124'; cpu = 'https://download.pytorch.org/whl/cpu' }[$Variant]
$TorchSpec  = if ($Fixed) { "torch==2.5.1+$Variant" } else { 'torch==2.5.1' }   # T3: tagged spec
$ExpectedTorch = "torch-2.5.1+$Variant.dist-info"

$PryRuntime = Join-Path $env:LOCALAPPDATA 'Pry\runtime'

# --- 1. scratch interpreter -----------------------------------------------------------
if (Test-Path $Scratch) { Remove-Item -Recurse -Force $Scratch }
New-Item -ItemType Directory -Force $Scratch | Out-Null
$PyRoot = Join-Path $Scratch 'python'

if ($DownloadPbs -or -not (Test-Path (Join-Path $PryRuntime 'python.exe'))) {
    $tgz = Join-Path $Scratch 'pbs.tar.gz'
    Write-Host "downloading PBS -> $tgz"
    Invoke-WebRequest -Uri $PbsUrl -OutFile $tgz
    $sha = (Get-FileHash -Algorithm SHA256 $tgz).Hash.ToLower()
    if ($sha -ne $PbsSha256) { throw "PBS sha256 mismatch: $sha" }
    tar -xzf $tgz -C $Scratch   # extracts to .\python
    if ($LASTEXITCODE) { throw 'tar failed' }
} else {
    Write-Host "copying PBS interpreter from $PryRuntime (read-only; venv and markers excluded)"
    New-Item -ItemType Directory -Force $PyRoot | Out-Null
    $exclude = 'venv', 'venvs', 'active.json', 'active.json.tmp', 'pbs-staging', 'ready.marker', 'requirements-extras.txt', 'sidecar.hash'
    Get-ChildItem $PryRuntime | Where-Object { $exclude -notcontains $_.Name } |
        ForEach-Object { Copy-Item -Recurse -Force $_.FullName $PyRoot }
}
$BasePy = Join-Path $PyRoot 'python.exe'
& $BasePy --version

# --- 2. venv --------------------------------------------------------------------------
$Venv = Join-Path $Scratch 'venv'
& $BasePy -m venv $Venv
if ($LASTEXITCODE) { throw 'venv failed' }
$VenvPy = Join-Path $Venv 'Scripts\python.exe'
# Pre-T3 pip.rs ran Scripts\pip.exe; T3/T4 run `<venv python> -m pip`.
$Pip   = if ($Fixed) { $VenvPy } else { Join-Path $Venv 'Scripts\pip.exe' }
$PipPrefix = if ($Fixed) { @('-m', 'pip') } else { @() }
$Site  = Join-Path $Venv 'Lib\site-packages'
$pipVer = (& $Pip @PipPrefix --version) -join ' '
Write-Host "pip: $pipVer"

# step 4 input: the embedded requirements file, written next to the venv like pip.rs does
$ReqPath = Join-Path $Scratch 'requirements-extras.txt'
Copy-Item (Join-Path $RepoRoot 'src-tauri\resources\requirements-runtime.txt') $ReqPath
# step 5 input: a copy of the sidecar source (pip builds in-tree; keep the repo untouched)
$SidecarCopy = Join-Path $Scratch 'sidecar'
New-Item -ItemType Directory -Force $SidecarCopy | Out-Null
Get-ChildItem (Join-Path $RepoRoot 'sidecar') | Where-Object { $_.Name -notin '.venv', 'build', 'dist', '.pytest_cache' } |
    ForEach-Object { Copy-Item -Recurse -Force $_.FullName $SidecarCopy }

# string keys: an [ordered] dict indexed with an [int] is positional, not by key
$Steps = [ordered]@{
    '1' = @('install', '--index-url', $TorchIndex, '--extra-index-url', 'https://pypi.org/simple', $TorchSpec)
    '2' = @('install', 'transformer-lens>=2.11,<3')
    '3' = @('install', 'sae-lens>=5.0,<6')
    '4' = @('install', '-r', $ReqPath)
    '5' = @('install', $SidecarCopy)
}
if ($Fixed) {
    # Exactly pip.rs pip_command_for_step: install -c <file> --extra-index-url <torch index> <step args>
    $common = @('install', '-c', $ConstraintFile, '--extra-index-url', $TorchIndex)
    $Steps['1'] = $common + @('--no-cache-dir', $TorchSpec)
    $Steps['2'] = $common + @('transformer-lens>=2.11,<3')
    $Steps['3'] = $common + @('sae-lens>=5.0,<6')
    $Steps['4'] = $common + @('-r', $ReqPath)
    $Steps['5'] = $common + @($SidecarCopy)
} elseif ($ConstraintFile) {
    foreach ($k in '1', '2', '3', '4', '5') { $Steps[$k] = $Steps[$k] + @('-c', $ConstraintFile) }
    foreach ($k in '2', '3', '4', '5') { $Steps[$k] = $Steps[$k] + @('--extra-index-url', $TorchIndex) }
}

$Watch = 'torch', 'transformer_lens', 'transformer-lens', 'sae_lens', 'sae-lens', 'sympy', 'pry_sidecar', 'pry-sidecar', 'numpy'

function Get-Snapshot {
    Get-ChildItem $Site -Directory -Filter '*.dist-info' |
        Where-Object { $_.Name -match '^(torch|transformer_lens|sae_lens|sympy|pry_sidecar|numpy)-' } |
        ForEach-Object { $_.Name } | Sort-Object
}

function Save-TrimmedReport([string]$full, [string]$trimmed) {
    $r = Get-Content -Raw $full | ConvertFrom-Json
    $items = foreach ($i in @($r.install)) {
        $name = $i.metadata.name
        $rd = @($i.metadata.PSObject.Properties['requires_dist'] ? $i.metadata.requires_dist : @())
        [ordered]@{
            name      = $name
            version   = $i.metadata.version
            requested = $i.requested
            url       = $i.download_info.url
            # keep the dependency edges that can drag torch / TL around
            requires_torch_or_tl = @($rd | Where-Object { $_ -match '^(torch|transformer[-_]lens|sae[-_]lens|sympy)\b' })
        }
    }
    [ordered]@{
        pip_version = $r.pip_version
        environment = @{ python_full_version = $r.environment.python_full_version }
        install_count = @($r.install).Count
        install = @($items)
    } | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 $trimmed
}

$summary = [System.Collections.Generic.List[string]]::new()
$summary.Add("variant=$Variant  $pipVer  python=$(& $VenvPy -c 'import sys;print(sys.version.split()[0])')")
$summary.Add("before: " + ((Get-Snapshot) -join ', '))

foreach ($n in $Steps.Keys) {
    $a = $Steps[$n]
    Write-Host "`n=== step $n : pip $($a -join ' ')"
    if (-not $SkipDryRun) {
        $full = Join-Path $Scratch "step-$n.full.json"
        $dry = @($a[0], '--dry-run', '--report', $full) + $a[1..($a.Count - 1)]
        & $Pip @PipPrefix @dry 2>&1 | ForEach-Object { "$_" } | Set-Content -Encoding utf8 (Join-Path $Scratch "step-$n.dryrun.log")
        if ($LASTEXITCODE) { throw "dry-run step $n failed (see step-$n.dryrun.log)" }
        Save-TrimmedReport $full (Join-Path $OutDir "step-$n.json")
        $r = Get-Content -Raw $full | ConvertFrom-Json
        $hits = @($r.install) | Where-Object { $Watch -contains $_.metadata.name.ToLower() } |
            ForEach-Object { "$($_.metadata.name)==$($_.metadata.version) <- $($_.download_info.url)" }
        $summary.Add("step $n dry-run would install: " + ($(if ($hits) { $hits -join ' | ' } else { '(no watched pkgs)' })))
    }
    $log = Join-Path $Scratch "step-$n.log"
    & $Pip @PipPrefix @a 2>&1 | ForEach-Object { "$_" } | Set-Content -Encoding utf8 $log
    if ($LASTEXITCODE) { throw "step $n failed (see $log)" }
    $snap = Get-Snapshot
    $snap | Set-Content (Join-Path $Scratch "after-step-$n.distinfo.txt")
    & $Pip @PipPrefix freeze --all 2>$null | Set-Content (Join-Path $Scratch "after-step-$n.freeze.txt")
    $summary.Add("step $n after: " + ($snap -join ', '))
    if ($Fixed) {
        $torch = @($snap | Where-Object { $_ -like 'torch-*' })
        if ($torch.Count -ne 1 -or $torch[0] -ne $ExpectedTorch) {
            $summary | Set-Content -Encoding utf8 (Join-Path $ExpDir "summary-$Tag.txt")
            throw "FIXED REPLAY FAILED: after step $n torch dist-info is '$($torch -join ', ')', expected $ExpectedTorch"
        }
        $summary.Add("step $n check: $ExpectedTorch OK")
    }
    $uninst = Select-String -Path $log -Pattern '^\s*(Attempting uninstall|Successfully uninstalled)' | ForEach-Object { $_.Line.Trim() }
    if ($uninst) { $summary.Add("step $n uninstalls: " + ($uninst -join ' | ')) }
}

# --- sizes ----------------------------------------------------------------------------
function Get-DirBytes([string]$p) { (Get-ChildItem -Recurse -Force -File $p | Measure-Object Length -Sum).Sum }
$venvBytes = Get-DirBytes $Venv
$pyBytes   = (Get-DirBytes $PyRoot)
$summary.Add(('size: venv={0:N2} GiB  pbs-interpreter={1:N2} GiB  ({2} / {3} bytes)' -f ($venvBytes / 1GB), ($pyBytes / 1GB), $venvBytes, $pyBytes))

$summaryPath = Join-Path $ExpDir "summary-$Tag.txt"
$summary | Set-Content -Encoding utf8 $summaryPath
Write-Host "`n--- summary ($summaryPath)"
$summary | ForEach-Object { Write-Host $_ }
