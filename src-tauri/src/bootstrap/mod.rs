//! First-run bootstrapper: downloads python-build-standalone, creates managed
//! venvs, installs pinned ML deps. Streams progress to the Tauri webview via
//! `bootstrap:progress` and `bootstrap:log` events.
//!
//! Runtime layout (versioned venvs behind `active.json`) lives in `layout`.
//! Every interpreter / pip path resolves through that pointer.

use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex as StdMutex;
use std::time::Duration;
use tauri::AppHandle;

mod errors;
mod events;
pub mod layout;
mod logs;
mod pbs;
pub mod pip;
mod probe;
mod venv;

pub use errors::BootstrapError;
#[allow(unused_imports)]
pub use events::{BootstrapEvent, BootstrapStage};
pub use probe::CudaVariant;

pub fn runtime_dir() -> anyhow::Result<PathBuf> {
    // Debug builds only: install/test into a scratch runtime instead of the
    // real one (e.g. an end-to-end engine build without touching the user's).
    #[cfg(debug_assertions)]
    if let Ok(dir) = std::env::var("PRY_RUNTIME_DIR") {
        return Ok(PathBuf::from(dir));
    }
    // Use data_local_dir (%LOCALAPPDATA%) rather than config_dir (%APPDATA%/Roaming)
    // so multi-GB torch wheels don't get OneDrive/enterprise-synced for users with
    // roaming profiles.
    let base = dirs::data_local_dir()
        .ok_or_else(|| anyhow::anyhow!("could not resolve local data dir"))?;
    Ok(base.join("Pry").join("runtime"))
}

/// Interpreter of the venv `active.json` points at (regardless of health).
pub fn runtime_python() -> anyhow::Result<PathBuf> {
    let rt = runtime_dir()?;
    let (_, dir) = layout::active_venv(&rt)
        .ok_or_else(|| anyhow::anyhow!("no active runtime venv"))?;
    Ok(layout::venv_python(&dir))
}

/// Interpreter of the active venv, only when its health allows running the
/// sidecar (Ok / UpdateAvailable). Used by `sidecar::find_python`.
pub fn active_runtime_python() -> anyhow::Result<PathBuf> {
    if !is_runtime_ready() {
        anyhow::bail!("managed runtime is missing or broken");
    }
    runtime_python()
}

pub fn runtime_health() -> layout::HealthReport {
    match runtime_dir() {
        Ok(rt) => layout::runtime_health(&rt),
        Err(_) => layout::HealthReport {
            health: layout::RuntimeHealth::Missing,
            reason: "no local data dir",
            venv_dir: None,
            current_variant: None,
            schema: 0,
        },
    }
}

/// Ok or UpdateAvailable. Filesystem reads only (safe on the startup gate).
pub fn is_runtime_ready() -> bool {
    runtime_health().health.is_usable()
}

/// One-time legacy migration (`venv\` -> `active.json = {"venv":"venv"}`).
/// Called from the setup hook before the startup gate.
pub fn startup_migrate() {
    let Ok(rt) = runtime_dir() else { return };
    match layout::migrate_legacy(&rt) {
        Ok(true) => tracing::info!("migrated legacy runtime venv to active.json pointer"),
        Ok(false) => {}
        Err(e) => tracing::warn!("legacy runtime migration failed: {e}"),
    }
}

/// Compute a SHA256 over the bundled sidecar source files. The result is
/// stable across identical installer builds and changes whenever any
/// `pry_sidecar/*.py`, `presets.json`, or `pyproject.toml` changes.
pub fn bundle_hash() -> anyhow::Result<String> {
    let bundle_dir = pip::locate_sidecar_source()
        .map_err(|e| anyhow::anyhow!("could not locate sidecar bundle: {e}"))?;

    let mut files: Vec<std::path::PathBuf> = vec![
        bundle_dir.join("pyproject.toml"),
        bundle_dir.join("presets.json"),
    ];

    // Enumerate pry_sidecar/*.py
    let pkg_dir = bundle_dir.join("pry_sidecar");
    if pkg_dir.exists() {
        for entry in std::fs::read_dir(&pkg_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("py") {
                files.push(path);
            }
        }
    }

    // Sort for determinism across filesystems
    files.sort();

    let mut hasher = Sha256::new();
    for file in &files {
        if let Ok(bytes) = std::fs::read(file) {
            if let Some(name) = file.file_name().and_then(|s| s.to_str()) {
                hasher.update(name.as_bytes());
                hasher.update(b":");
            }
            hasher.update(&bytes);
            hasher.update(b"\n");
        }
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn read_trimmed(p: &Path) -> Option<String> {
    std::fs::read_to_string(p)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Hash of the pry_sidecar package installed in the active venv. Each venv
/// keeps its own `sidecar.hash`; the legacy venv's marker lived at the root.
pub fn installed_sidecar_hash() -> Option<String> {
    let rt = runtime_dir().ok()?;
    let (rel, dir) = layout::active_venv(&rt)?;
    read_trimmed(&dir.join(layout::SIDECAR_HASH_FILE)).or_else(|| {
        (rel == layout::LEGACY_VENV)
            .then(|| read_trimmed(&rt.join(layout::SIDECAR_HASH_FILE)))
            .flatten()
    })
}

fn write_sidecar_hash(venv_dir: &Path) {
    match bundle_hash() {
        Ok(hash) => {
            if let Err(e) = std::fs::write(venv_dir.join(layout::SIDECAR_HASH_FILE), hash) {
                tracing::warn!("failed to write sidecar hash marker: {e}");
            }
        }
        Err(e) => tracing::warn!("bundle hash unavailable, marker not written: {e}"),
    }
}

pub fn sidecar_needs_reinstall() -> bool {
    match (bundle_hash().ok(), installed_sidecar_hash()) {
        (Some(bundled), Some(installed)) => bundled != installed,
        (Some(_), None) => true,  // no marker -> needs install
        (None, _) => false,        // no bundle -> can't reinstall (dev mode)
    }
}

pub fn is_runtime_current() -> bool {
    is_runtime_ready() && !sidecar_needs_reinstall()
}

// ── In-process coordination ──────────────────────────────────────────────────

/// Venv folders being built right now; GC must not delete them.
static BUILDING: once_cell::sync::Lazy<StdMutex<HashSet<PathBuf>>> =
    once_cell::sync::Lazy::new(|| StdMutex::new(HashSet::new()));
/// Result of the background GPU re-probe (None until it finishes).
static PROBED: StdMutex<Option<probe::GpuProbe>> = StdMutex::new(None);
/// Set while a fresh install or an engine update is running (shared guard).
static UPDATING: AtomicBool = AtomicBool::new(false);

/// Exclusive token for runtime-building work: a fresh install
/// (`bootstrap_runtime`) and an engine update (`runtime_update`) can never
/// run concurrently. Released on drop.
struct RuntimeJob;
impl RuntimeJob {
    fn acquire() -> Option<Self> {
        (!UPDATING.swap(true, Ordering::SeqCst)).then_some(Self)
    }
}
impl Drop for RuntimeJob {
    fn drop(&mut self) {
        UPDATING.store(false, Ordering::SeqCst);
    }
}

const BUSY_MESSAGE: &str = "Pry is already installing or updating its engine.";

fn is_building(p: &Path) -> bool {
    BUILDING
        .lock()
        .map(|s| s.contains(p))
        .unwrap_or(true)
}

struct BuildGuard(PathBuf);
impl BuildGuard {
    fn new(p: PathBuf) -> Self {
        if let Ok(mut s) = BUILDING.lock() {
            s.insert(p.clone());
        }
        Self(p)
    }
}
impl Drop for BuildGuard {
    fn drop(&mut self) {
        if let Ok(mut s) = BUILDING.lock() {
            s.remove(&self.0);
        }
    }
}

// ── Build pipeline ───────────────────────────────────────────────────────────

/// Extract PBS flat into `runtime\` unless a complete interpreter is already
/// there. A half-extracted one (python.exe without marker) is re-extracted
/// in place; venv folders are never touched.
async fn ensure_pbs(emit: &events::Emitter, rt: &Path) -> Result<(), BootstrapError> {
    if layout::pbs_complete(rt) {
        return Ok(());
    }
    pbs::download_and_extract(emit, rt).await
}

/// Post-install verification of a freshly built venv; returns its manifest.
///
/// 1. The `torch-*.dist-info` folder must be the tagged build for `variant`
///    (hard fail otherwise: that is the T3a CPU-torch swap).
/// 2. One `python -c` records `torch.version.cuda` / `cuda.is_available()`.
///    On a GPU build, CUDA being unavailable is a warning only (driver issue).
async fn verify_build(
    emit: &events::Emitter,
    venv_dir: &Path,
    variant: CudaVariant,
) -> Result<layout::RuntimeManifest, BootstrapError> {
    emit.stage(BootstrapStage::InstallingExtras, "verifying the PyTorch install...");
    let expected = variant.expected_torch_dist_info();
    let actual = layout::torch_dist_info(venv_dir);
    emit.log(format!(
        "verify: torch dist-info = {}, expected {expected}",
        actual.as_deref().unwrap_or("<none>")
    ));
    if actual.as_deref() != Some(expected.as_str()) {
        return Err(BootstrapError::PipInstall(format!(
            "the installed PyTorch build is not the expected one (found {}, expected {expected})",
            actual.as_deref().unwrap_or("none")
        )));
    }

    const PROBE: &str = "import json, torch; print(json.dumps({'version': torch.__version__, \
                         'cuda': torch.version.cuda, 'available': torch.cuda.is_available()}))";
    let out = tokio::process::Command::new(layout::venv_python(venv_dir))
        .args(["-c", PROBE])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .await
        .map_err(|e| BootstrapError::PipInstall(format!("could not run the PyTorch check: {e}")))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        emit.log(format!("verify: import torch failed: {stderr}"));
        return Err(BootstrapError::PipInstall(format!(
            "PyTorch was installed but fails to import: {}",
            stderr.lines().last().unwrap_or("unknown error")
        )));
    }
    let info: serde_json::Value = stdout
        .lines()
        .rev()
        .find_map(|l| serde_json::from_str(l.trim()).ok())
        .ok_or_else(|| BootstrapError::PipInstall(format!("unexpected PyTorch check output: {stdout}")))?;
    let cuda = info["cuda"].as_str().map(str::to_string);
    let available = info["available"].as_bool();
    emit.log(format!(
        "verify: torch {} cuda={} available={}",
        info["version"].as_str().unwrap_or("?"),
        cuda.as_deref().unwrap_or("none"),
        available.map_or("?".into(), |b| b.to_string())
    ));
    if variant.is_gpu() && available != Some(true) {
        emit.log(
            "warning: the CUDA build of PyTorch is installed but no usable GPU was found. \
             Pry will run on the CPU until the NVIDIA driver is fixed.",
        );
    }

    Ok(layout::RuntimeManifest {
        schema: layout::RUNTIME_SCHEMA_VERSION,
        variant: variant.id().to_string(),
        expected_torch_dist_info: expected,
        torch_dist_info: actual,
        cuda,
        cuda_available: available,
        constraints_sha256: layout::bundled_constraints_sha256(variant),
        built_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Record the error in the persisted log and point the user at it.
fn with_log_path(emit: &events::Emitter, e: BootstrapError) -> BootstrapError {
    emit.log(format!("ERROR: {e}"));
    let Some(p) = emit.log_path() else { return e };
    let note = |s: String| format!("{s}\nFull install log: {}", p.display());
    match e {
        BootstrapError::Download(s) => BootstrapError::Download(note(s)),
        BootstrapError::Extract(s) => BootstrapError::Extract(note(s)),
        BootstrapError::Venv(s) => BootstrapError::Venv(note(s)),
        BootstrapError::PipInstall(s) => BootstrapError::PipInstall(note(s)),
        BootstrapError::Antivirus(s) => BootstrapError::Antivirus(note(s)),
        BootstrapError::Io(s) => BootstrapError::Io(note(s)),
        BootstrapError::Internal(s) => BootstrapError::Internal(note(s)),
        other => other,
    }
}

/// Build a complete venv in `venvs\<id>\` from `runtime\python.exe`: disk
/// check, venv, deps, verify, `runtime.json`, sidecar hash. Does NOT flip the
/// pointer; the caller commits. Returns the pointer value (`venvs/<id>`) and
/// the `BuildGuard` that keeps GC away from the folder: hold it until the
/// commit is done, so GC can't race the build->commit window. On failure the
/// folder is removed best-effort (and is unreferenced garbage for GC otherwise).
async fn build_venv(
    emit: &events::Emitter,
    rt: &Path,
    variant: CudaVariant,
    free_bytes: impl Fn(&Path) -> std::io::Result<u64>,
) -> Result<(String, BuildGuard), BootstrapError> {
    layout::ensure_free_space(rt, variant, free_bytes)?;

    let id = layout::new_venv_id(rt, variant, chrono::Utc::now());
    let dir = layout::venvs_root(rt).join(&id);
    let guard = BuildGuard::new(dir.clone());

    let result: Result<(), BootstrapError> = async {
        tokio::fs::create_dir_all(layout::venvs_root(rt))
            .await
            .map_err(|e| BootstrapError::Io(format!("mkdir venvs: {e}")))?;
        venv::create(emit, &layout::base_python(rt), &dir).await?;
        let py = layout::venv_python(&dir);
        pip::install_runtime_deps(emit, &dir, &py, variant).await?;
        let manifest = verify_build(emit, &dir, variant).await?;
        layout::write_manifest(&dir, &manifest)
            .map_err(|e| BootstrapError::Io(format!("write runtime.json: {e}")))?;
        write_sidecar_hash(&dir);
        Ok(())
    }
    .await;

    if let Err(e) = result {
        tracing::warn!("venv build {id} failed: {e}");
        if let Err(rm) = tokio::fs::remove_dir_all(&dir).await {
            tracing::warn!("could not remove failed build {}: {rm} (GC will retry)", dir.display());
        }
        return Err(e);
    }
    Ok((format!("{}/{id}", layout::VENVS_DIR), guard))
}

/// Plain-language message for the UI.
fn user_message(e: &BootstrapError) -> String {
    match e {
        BootstrapError::DiskSpaceInsufficient { needed_mb, available_mb } => format!(
            "Pry needs about {:.1} GB free to update its engine; you have {:.1} GB.",
            *needed_mb as f64 / 1000.0,
            *available_mb as f64 / 1000.0
        ),
        other => format!("{other:#}"),
    }
}

pub async fn bootstrap_runtime(app: AppHandle) -> Result<(), BootstrapError> {
    let emit = events::Emitter::new(app.clone());

    emit.stage(
        BootstrapStage::Probing,
        "checking hardware and runtime state...",
    );

    let rt = runtime_dir().map_err(|e| BootstrapError::Internal(e.to_string()))?;
    if let Err(e) = layout::migrate_legacy(&rt) {
        tracing::warn!("legacy runtime migration failed: {e}");
    }
    if layout::runtime_health(&rt).health.is_usable() {
        emit.stage(BootstrapStage::Ready, "runtime already installed");
        return Ok(());
    }

    // Same exclusive guard as runtime_update: never build two venvs at once.
    let Some(_job) = RuntimeJob::acquire() else {
        return Err(BootstrapError::Internal(BUSY_MESSAGE.into()));
    };

    // An install is actually happening: persist everything to a log file.
    let emit = events::Emitter::with_log(app.clone());
    install_fresh(&emit, &rt).await.map_err(|e| with_log_path(&emit, e))
}

async fn install_fresh(emit: &events::Emitter, rt: &Path) -> Result<(), BootstrapError> {
    // Probe CUDA to decide wheel variant.
    let cuda_variant = probe::cuda_variant(emit).await.variant;

    // No up-front wipe: a Missing/Broken runtime gets a new venv beside
    // whatever is there; the pointer only moves once the new one is verified.
    tokio::fs::create_dir_all(rt)
        .await
        .map_err(|e| BootstrapError::Io(format!("mkdir: {e}")))?;

    ensure_pbs(emit, rt).await?;
    let (rel, _build_guard) = build_venv(emit, rt, cuda_variant, layout::free_bytes).await?;
    layout::commit_active(rt, &rel)
        .map_err(|e| BootstrapError::Io(format!("activate venv: {e}")))?;

    emit.stage(BootstrapStage::Ready, "runtime installed and ready");
    Ok(())
}

#[tauri::command]
pub async fn bootstrap_runtime_command(app: AppHandle) -> Result<(), String> {
    use std::sync::Arc;
    use tauri::Manager;
    use tokio::sync::Mutex;

    // Clone the Arc out of managed state BEFORE any await. Holding a
    // `State<'_, T>` guard across an await point breaks `Send` and Tauri
    // command futures must be Send.
    let state_arc: Arc<Mutex<Option<crate::sidecar::SidecarHandle>>> = {
        let state =
            app.state::<Arc<Mutex<Option<crate::sidecar::SidecarHandle>>>>();
        state.inner().clone()
    };

    bootstrap_runtime(app.clone())
        .await
        .map_err(|e| user_message(&e))?;

    // If the bundled sidecar source differs from what's installed in the
    // active venv (e.g. the user upgraded the installer and only Python files
    // changed), reinstall just the pry_sidecar package. This runs even
    // when bootstrap_runtime early-returned because the base runtime
    // was already ready.
    if is_runtime_ready() && sidecar_needs_reinstall() {
        tracing::info!(
            "bundled sidecar source differs from installed — reinstalling package"
        );
        let emit = events::Emitter::with_log(app.clone());
        let rt = runtime_dir().map_err(|e| format!("runtime_dir: {e}"))?;
        let report = layout::runtime_health(&rt);
        let venv_dir = report
            .venv_dir
            .ok_or_else(|| "sidecar reinstall: no active venv".to_string())?;
        let variant = report
            .current_variant
            .as_deref()
            .and_then(CudaVariant::from_id)
            .unwrap_or(CudaVariant::Cpu);
        pip::reinstall_sidecar_package(&emit, &venv_dir, &layout::venv_python(&venv_dir), variant)
            .await
            .map_err(|e| format!("sidecar reinstall: {:#}", with_log_path(&emit, e)))?;
        write_sidecar_hash(&venv_dir);
    }

    // M6 fix: Hold the SidecarState lock across the entire launch so
    // concurrent calls to `bootstrap_runtime_command` (e.g. a frontend
    // double-click) serialize. The tokio::sync::Mutex is already the
    // single ownership point for all live SidecarHandle references, so
    // this gives us the "launch lock" behavior without a second mutex.
    let mut guard = state_arc.lock().await;
    // If a stale sidecar is still running with old code (from the setup
    // hook), stop it so the relaunch picks up the freshly-reinstalled
    // package.
    if let Some(mut old_handle) = guard.take() {
        tracing::info!("stopping previous sidecar before post-bootstrap relaunch");
        if let Err(e) = old_handle.shutdown().await {
            tracing::warn!("shutdown of previous sidecar failed: {e}");
        }
    }

    // Bootstrap completed — spawn the sidecar now. Before this point the setup
    // hook skipped the launch because the runtime wasn't ready; this is the
    // first moment `sidecar::launch()` can find the managed Python.
    let handle = crate::sidecar::launch_with_app(Some(app.clone()))
        .await
        .map_err(|e| format!("sidecar launch after bootstrap: {e:#}"))?;

    tracing::info!("post-bootstrap sidecar launched on {}", handle.base_url);

    *guard = Some(handle);
    drop(guard);
    // Upgrades from older installs always come through here (the sidecar
    // package changed), so the GPU re-probe and GC must start here too, not
    // only from the startup gate.
    spawn_post_launch_tasks(app, true);
    Ok(())
}

#[tauri::command]
pub fn runtime_status() -> Result<bool, String> {
    Ok(is_runtime_current())
}

/// What the UI needs to pick between onboarding and the short "Updating
/// Pry…" path (P2-10). Filesystem reads only, no process spawns.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RuntimeReadiness {
    /// The active runtime can run the sidecar (health Ok / UpdateAvailable).
    pub usable: bool,
    /// The bundled sidecar package differs from the installed one; running
    /// `bootstrap_runtime_command` will resync it.
    pub needs_sidecar_sync: bool,
    /// "missing" | "broken" | "update_available" | "ok"
    pub health: layout::RuntimeHealth,
}

#[tauri::command]
pub fn runtime_readiness() -> Result<RuntimeReadiness, String> {
    let health = runtime_health().health;
    Ok(RuntimeReadiness {
        usable: health.is_usable(),
        needs_sidecar_sync: sidecar_needs_reinstall(),
        health,
    })
}

// ── Updates ──────────────────────────────────────────────────────────────────

fn current_update_status() -> layout::RuntimeUpdateStatus {
    let probed = PROBED.lock().ok().and_then(|g| *g);
    layout::compute_update_status(&runtime_health(), probed, UPDATING.load(Ordering::SeqCst))
}

/// `{state, current_variant, target_variant, download_mb, required_free_gb, ...}`.
/// Filesystem reads only; `target_variant` is null until the GPU re-probe ends.
#[tauri::command]
pub fn runtime_update_status() -> Result<layout::RuntimeUpdateStatus, String> {
    Ok(current_update_status())
}

/// Background work after the startup sidecar launch: GPU re-probe (emits
/// `runtime:update-available` when an update applies) and, if the sidecar is
/// up, GC of unreferenced venvs (3 attempts over ~30 s, log-only).
pub fn spawn_post_launch_tasks(app: AppHandle, sidecar_running: bool) {
    tauri::async_runtime::spawn(async move {
        use tauri::Emitter as _;
        let (probed, msg) = probe::detect_cuda_variant().await;
        tracing::info!("background GPU re-probe: {msg}");
        if let Ok(mut g) = PROBED.lock() {
            *g = Some(probed);
        }
        let status = current_update_status();
        if status.state == "update_available" && status.target_variant.is_some() {
            let _ = app.emit("runtime:update-available", &status);
        }
    });

    if !sidecar_running {
        return;
    }
    let Ok(rt) = runtime_dir() else { return };
    tauri::async_runtime::spawn_blocking(move || {
        let delays = [Duration::from_secs(5), Duration::from_secs(25)];
        let report = layout::gc_unreferenced(&rt, &delays, &is_building);
        for p in &report.deleted {
            tracing::info!("runtime GC: removed {}", p.display());
        }
        for (p, e) in &report.failed {
            tracing::warn!("runtime GC: could not remove {} ({e}); will retry next launch", p.display());
        }
    });
}

/// Why an engine update did not complete. `kind` tells the UI what is running:
/// - `busy`: another install/update holds the guard; nothing changed.
/// - `not_started`: the new venv failed to build/verify; the current engine
///   was never stopped and the pointer never moved.
/// - `rolled_back`: the new engine failed to start; the pointer was restored
///   and the previous engine was relaunched successfully.
/// - `restart_required`: the new engine failed to start and the previous one
///   could not be relaunched (or the pointer could not be restored).
#[derive(Debug, Clone, serde::Serialize)]
pub struct RuntimeUpdateError {
    pub kind: &'static str,
    pub message: String,
    pub log_path: Option<String>,
}

/// Build a new venv for the target variant beside the active one, flip the
/// pointer, then restart the sidecar from it. If the new engine fails to
/// start, the pointer is rolled back and the old engine relaunched.
#[tauri::command]
pub async fn runtime_update(app: AppHandle) -> Result<(), RuntimeUpdateError> {
    use std::sync::Arc;
    use tauri::Manager;
    use tokio::sync::Mutex;

    let fail = |kind, message: String, emit: Option<&events::Emitter>| {
        if let Some(e) = emit {
            e.log(format!("ERROR ({kind}): {message}"));
        }
        RuntimeUpdateError {
            kind,
            message,
            log_path: emit.and_then(|e| e.log_path()).map(|p| p.display().to_string()),
        }
    };

    let Some(_job) = RuntimeJob::acquire() else {
        return Err(fail("busy", BUSY_MESSAGE.into(), None));
    };

    let state_arc: Arc<Mutex<Option<crate::sidecar::SidecarHandle>>> = {
        let state =
            app.state::<Arc<Mutex<Option<crate::sidecar::SidecarHandle>>>>();
        state.inner().clone()
    };

    let emit = events::Emitter::with_log(app.clone());
    let rt = runtime_dir()
        .map_err(|e| fail("not_started", format!("runtime_dir: {e}"), Some(&emit)))?;
    if !layout::pbs_complete(&rt) {
        return Err(fail(
            "not_started",
            "Pry's Python runtime is missing. Restart Pry to reinstall it.".into(),
            Some(&emit),
        ));
    }

    emit.stage(BootstrapStage::Probing, "checking your graphics card...");
    let probed = probe::cuda_variant(&emit).await;
    if let Ok(mut g) = PROBED.lock() {
        *g = Some(probed);
    }
    let current = layout::runtime_health(&rt).current_variant;
    let variant = layout::target_variant(current.as_deref(), probed);

    // Keep the build guard until the commit/rollback is settled so GC can't
    // touch the new folder in between.
    let (rel, _build_guard) = build_venv(&emit, &rt, variant, layout::free_bytes)
        .await
        .map_err(|e| fail("not_started", user_message(&e), Some(&emit)))?;

    // Same launch lock as bootstrap_runtime_command: nobody can launch a
    // sidecar between the pointer flip and the (re)launch.
    let mut guard = state_arc.lock().await;
    if let Some(mut old) = guard.take() {
        tracing::info!("stopping sidecar before relaunch from updated venv");
        if let Err(e) = old.shutdown().await {
            tracing::warn!("shutdown of previous sidecar failed: {e}");
        }
    }

    let outcome = layout::commit_with_rollback(&rt, &rel, || {
        crate::sidecar::launch_with_app(Some(app.clone()))
    })
    .await;

    let start_error = match outcome {
        layout::CommitOutcome::Committed(handle) => {
            tracing::info!("sidecar relaunched from {rel} on {}", handle.base_url);
            let base_url = handle.base_url.clone();
            *guard = Some(handle);
            drop(guard);
            emit.stage(BootstrapStage::Ready, "engine updated");
            // New engine, empty registry: the UI must reload the model (code:B6).
            crate::emit_restarted(&app, &base_url);
            return Ok(());
        }
        layout::CommitOutcome::RollbackFailed { error, rollback_error } => {
            return Err(fail(
                "restart_required",
                format!(
                    "The new engine failed to start ({error:#}) and the previous one could not \
                     be restored ({rollback_error}). Please restart Pry."
                ),
                Some(&emit),
            ));
        }
        layout::CommitOutcome::NotCommitted { error } => format!("could not switch engines: {error}"),
        layout::CommitOutcome::RolledBack { error, previous } => {
            emit.log(format!("rolled back active.json to {previous:?}"));
            format!("the new engine failed to start: {error:#}")
        }
    };

    // Pointer names the previous venv again: relaunch it.
    match crate::sidecar::launch_with_app(Some(app.clone())).await {
        Ok(handle) => {
            tracing::info!("previous engine relaunched on {}", handle.base_url);
            let base_url = handle.base_url.clone();
            *guard = Some(handle);
            drop(guard);
            crate::emit_restarted(&app, &base_url);
            Err(fail(
                "rolled_back",
                format!("The engine update didn't finish ({start_error})."),
                Some(&emit),
            ))
        }
        Err(e) => Err(fail(
            "restart_required",
            format!(
                "The engine update didn't finish ({start_error}), and the previous engine \
                 failed to restart ({e:#}). Please restart Pry."
            ),
            Some(&emit),
        )),
    }
}

#[cfg(test)]
mod tests {
    /// T10: every `sidecar/pry_sidecar/*.py` must be bundled by a
    /// `tauri.conf.json` resource entry (explicit path or a `*.py` glob), or
    /// installed builds ship an incomplete sidecar package.
    #[test]
    fn tauri_resources_cover_every_sidecar_module() {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let conf: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(manifest.join("tauri.conf.json")).unwrap(),
        )
        .unwrap();
        let resources: Vec<&str> = conf["bundle"]["resources"]
            .as_array()
            .expect("bundle.resources must be an array")
            .iter()
            .filter_map(|v| v.as_str())
            .collect();

        let pkg = manifest.join("../sidecar/pry_sidecar");
        let mut modules: Vec<String> = std::fs::read_dir(&pkg)
            .unwrap()
            .flatten()
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| n.ends_with(".py"))
            .collect();
        modules.sort();
        assert!(modules.iter().any(|m| m == "main.py"), "sidecar package not found");

        for m in &modules {
            let explicit = format!("../sidecar/pry_sidecar/{m}");
            let covered = resources.iter().any(|r| {
                *r == explicit
                    || *r == "../sidecar/pry_sidecar/*.py"
                    || *r == "../sidecar/pry_sidecar/*"
                    || *r == "../sidecar/pry_sidecar/**/*"
            });
            assert!(covered, "{m} is not bundled by tauri.conf.json resources");
        }
    }
}
