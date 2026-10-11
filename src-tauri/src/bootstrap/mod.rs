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
mod pbs;
pub mod pip;
mod probe;
mod venv;

pub use errors::BootstrapError;
#[allow(unused_imports)]
pub use events::{BootstrapEvent, BootstrapStage};
pub use probe::CudaVariant;

pub fn runtime_dir() -> anyhow::Result<PathBuf> {
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
static PROBED: StdMutex<Option<CudaVariant>> = StdMutex::new(None);
static UPDATING: AtomicBool = AtomicBool::new(false);

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
/// T3 HOOK: run `<venv python> -c "import torch, json; ..."` here to fill
/// `cuda` (and warn when `cuda.is_available()` is false on a cu124 wheel).
fn verify_build(
    emit: &events::Emitter,
    venv_dir: &Path,
    variant: CudaVariant,
) -> Result<layout::RuntimeManifest, BootstrapError> {
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
    Ok(layout::RuntimeManifest {
        schema: layout::RUNTIME_SCHEMA_VERSION,
        variant: variant.id().to_string(),
        expected_torch_dist_info: expected,
        torch_dist_info: actual,
        cuda: None,
        constraints_sha256: layout::bundled_constraints_sha256(variant),
        built_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Build a complete venv in `venvs\<id>\` from `runtime\python.exe`: disk
/// check, venv, deps, verify, `runtime.json`, sidecar hash. Does NOT flip the
/// pointer; the caller commits with `layout::commit_active`. Returns the
/// pointer value (`venvs/<id>`). On failure the folder is removed best-effort
/// (and is unreferenced garbage for GC otherwise).
async fn build_venv(
    emit: &events::Emitter,
    rt: &Path,
    variant: CudaVariant,
    free_bytes: impl Fn(&Path) -> std::io::Result<u64>,
) -> Result<String, BootstrapError> {
    layout::ensure_free_space(rt, variant, free_bytes)?;

    let id = layout::new_venv_id(rt, variant, chrono::Utc::now());
    let dir = layout::venvs_root(rt).join(&id);
    let _guard = BuildGuard::new(dir.clone());

    let result: Result<(), BootstrapError> = async {
        tokio::fs::create_dir_all(layout::venvs_root(rt))
            .await
            .map_err(|e| BootstrapError::Io(format!("mkdir venvs: {e}")))?;
        venv::create(emit, &layout::base_python(rt), &dir).await?;
        let py = layout::venv_python(&dir);
        pip::install_runtime_deps(emit, rt, &dir, &py, variant).await?;
        let manifest = verify_build(emit, &dir, variant)?;
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
    Ok(format!("{}/{id}", layout::VENVS_DIR))
}

fn commit(rt: &Path, rel: &str) -> Result<(), BootstrapError> {
    layout::commit_active(rt, rel).map_err(|e| BootstrapError::Io(format!("activate venv: {e}")))
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

    // Probe CUDA to decide wheel variant.
    let cuda_variant = probe::cuda_variant(&emit).await;

    // No up-front wipe: a Missing/Broken runtime gets a new venv beside
    // whatever is there; the pointer only moves once the new one is verified.
    tokio::fs::create_dir_all(&rt)
        .await
        .map_err(|e| BootstrapError::Io(format!("mkdir: {e}")))?;

    ensure_pbs(&emit, &rt).await?;
    let rel = build_venv(&emit, &rt, cuda_variant, layout::free_bytes).await?;
    commit(&rt, &rel)?;

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
        let emit = events::Emitter::new(app.clone());
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
        pip::reinstall_sidecar_package(&emit, &rt, &layout::venv_python(&venv_dir), variant)
            .await
            .map_err(|e| format!("sidecar reinstall: {e:#}"))?;
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
    Ok(())
}

#[tauri::command]
pub fn runtime_status() -> Result<bool, String> {
    Ok(is_runtime_current())
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
        let (variant, msg) = probe::detect_cuda_variant().await;
        tracing::info!("background GPU re-probe: {msg}");
        if let Ok(mut g) = PROBED.lock() {
            *g = Some(variant);
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

/// Build a new venv for the target variant beside the active one, flip the
/// pointer, then restart the sidecar from it. The active venv is untouched
/// unless every step succeeds.
#[tauri::command]
pub async fn runtime_update(app: AppHandle) -> Result<(), String> {
    use std::sync::Arc;
    use tauri::Manager;
    use tokio::sync::Mutex;

    if UPDATING.swap(true, Ordering::SeqCst) {
        return Err("An engine update is already running.".into());
    }
    struct ResetUpdating;
    impl Drop for ResetUpdating {
        fn drop(&mut self) {
            UPDATING.store(false, Ordering::SeqCst);
        }
    }
    let _reset = ResetUpdating;

    let state_arc: Arc<Mutex<Option<crate::sidecar::SidecarHandle>>> = {
        let state =
            app.state::<Arc<Mutex<Option<crate::sidecar::SidecarHandle>>>>();
        state.inner().clone()
    };

    let emit = events::Emitter::new(app.clone());
    let rt = runtime_dir().map_err(|e| format!("runtime_dir: {e}"))?;
    if !layout::pbs_complete(&rt) {
        return Err("Pry's Python runtime is missing. Restart Pry to reinstall it.".into());
    }

    emit.stage(BootstrapStage::Probing, "checking your graphics card...");
    let probed = probe::cuda_variant(&emit).await;
    if let Ok(mut g) = PROBED.lock() {
        *g = Some(probed);
    }
    let current = layout::runtime_health(&rt).current_variant;
    let variant = layout::target_variant(current.as_deref(), probed);

    let rel = build_venv(&emit, &rt, variant, layout::free_bytes)
        .await
        .map_err(|e| user_message(&e))?;

    // Same launch lock as bootstrap_runtime_command: nobody can launch a
    // sidecar between the pointer flip and the relaunch.
    let mut guard = state_arc.lock().await;
    commit(&rt, &rel).map_err(|e| user_message(&e))?;
    if let Some(mut old) = guard.take() {
        tracing::info!("stopping sidecar before relaunch from updated venv");
        if let Err(e) = old.shutdown().await {
            tracing::warn!("shutdown of previous sidecar failed: {e}");
        }
    }
    let handle = crate::sidecar::launch_with_app(Some(app.clone()))
        .await
        .map_err(|e| format!("The engine was updated but failed to start: {e:#}"))?;
    tracing::info!("sidecar relaunched from {rel} on {}", handle.base_url);
    *guard = Some(handle);

    emit.stage(BootstrapStage::Ready, "engine updated");
    Ok(())
}
