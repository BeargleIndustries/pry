//! First-run bootstrapper: downloads python-build-standalone, creates managed
//! venv, installs pinned ML deps. Streams progress to the Tauri webview via
//! `bootstrap:progress` and `bootstrap:log` events.

use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::AppHandle;

mod errors;
mod events;
mod pbs;
pub mod pip;
mod probe;
mod venv;

pub use errors::BootstrapError;
#[allow(unused_imports)]
pub use events::{BootstrapEvent, BootstrapStage};

pub fn runtime_dir() -> anyhow::Result<PathBuf> {
    // Use data_local_dir (%LOCALAPPDATA%) rather than config_dir (%APPDATA%/Roaming)
    // so multi-GB torch wheels don't get OneDrive/enterprise-synced for users with
    // roaming profiles.
    let base = dirs::data_local_dir()
        .ok_or_else(|| anyhow::anyhow!("could not resolve local data dir"))?;
    Ok(base.join("Pry").join("runtime"))
}

pub fn runtime_python() -> anyhow::Result<PathBuf> {
    Ok(venv::venv_python(&runtime_dir()?))
}

pub fn ready_marker_path() -> anyhow::Result<PathBuf> {
    Ok(runtime_dir()?.join("ready.marker"))
}

pub fn is_runtime_ready() -> bool {
    ready_marker_path().ok().map(|p| p.exists()).unwrap_or(false)
        && runtime_python().ok().map(|p| p.exists()).unwrap_or(false)
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

pub fn sidecar_hash_marker_path() -> anyhow::Result<PathBuf> {
    Ok(runtime_dir()?.join("sidecar.hash"))
}

/// Read the hash of the currently-installed sidecar package from the marker file.
pub fn installed_sidecar_hash() -> Option<String> {
    sidecar_hash_marker_path()
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
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

pub async fn bootstrap_runtime(app: AppHandle) -> Result<(), BootstrapError> {
    let emit = events::Emitter::new(app.clone());

    emit.stage(
        BootstrapStage::Probing,
        "checking hardware and runtime state...",
    );

    if is_runtime_ready() {
        emit.stage(BootstrapStage::Ready, "runtime already installed");
        return Ok(());
    }

    // Probe CUDA to decide wheel variant.
    let cuda_variant = probe::cuda_variant(&emit).await;

    // Clean up any half-installed runtime dir.
    let runtime_dir =
        runtime_dir().map_err(|e| BootstrapError::Internal(e.to_string()))?;
    if runtime_dir.exists() {
        emit.stage(
            BootstrapStage::Cleaning,
            "removing previous incomplete install...",
        );
        tokio::fs::remove_dir_all(&runtime_dir)
            .await
            .map_err(|e| BootstrapError::Io(format!("cleanup: {e}")))?;
    }
    tokio::fs::create_dir_all(&runtime_dir)
        .await
        .map_err(|e| BootstrapError::Io(format!("mkdir: {e}")))?;

    // Download + extract python-build-standalone.
    pbs::download_and_extract(&emit, &runtime_dir).await?;

    // Create venv.
    venv::create(&emit, &runtime_dir).await?;

    // pip install deps.
    pip::install_runtime_deps(&emit, &runtime_dir, cuda_variant).await?;

    // Mark ready.
    let marker =
        ready_marker_path().map_err(|e| BootstrapError::Internal(e.to_string()))?;
    tokio::fs::write(&marker, chrono::Utc::now().to_rfc3339())
        .await
        .map_err(|e| BootstrapError::Io(format!("marker: {e}")))?;

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
        .map_err(|e| format!("{e:#}"))?;

    // If the bundled sidecar source differs from what's installed in the
    // venv (e.g. the user upgraded the installer and only Python files
    // changed), reinstall just the pry_sidecar package. This runs even
    // when bootstrap_runtime early-returned because the base runtime
    // was already ready.
    if is_runtime_ready() && sidecar_needs_reinstall() {
        tracing::info!(
            "bundled sidecar source differs from installed — reinstalling package"
        );
        let emit = events::Emitter::new(app.clone());
        let runtime_dir_path =
            runtime_dir().map_err(|e| format!("runtime_dir: {e}"))?;
        pip::reinstall_sidecar_package(&emit, &runtime_dir_path)
            .await
            .map_err(|e| format!("sidecar reinstall: {e:#}"))?;
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
