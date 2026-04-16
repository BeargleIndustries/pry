pub mod crash;
pub mod custom_models;
pub mod error;
pub mod hf_auth;
pub mod sidecar;
pub mod hardware;
pub mod presets_compat;
pub mod bootstrap;

use std::sync::Arc;
use tauri::{Manager, Runtime, State};
use tokio::sync::Mutex;

use error::AppError;
use sidecar::SidecarHandle;

type SidecarState = Arc<Mutex<Option<SidecarHandle>>>;

#[tauri::command]
async fn sidecar_url(state: State<'_, SidecarState>) -> Result<String, AppError> {
    let arc: &Arc<Mutex<Option<SidecarHandle>>> = state.inner();
    let guard = arc.lock().await;
    match &*guard {
        Some(h) => Ok(h.base_url.clone()),
        None => Err(AppError::Sidecar("not running".into())),
    }
}

#[tauri::command]
async fn sidecar_stderr(state: State<'_, SidecarState>) -> Result<Vec<String>, AppError> {
    let arc: &Arc<Mutex<Option<SidecarHandle>>> = state.inner();
    let guard: tokio::sync::MutexGuard<'_, Option<SidecarHandle>> = arc.lock().await;
    match &*guard {
        Some(h) => {
            let h: &SidecarHandle = h;
            Ok(h.stderr_snapshot())
        }
        None => Err(AppError::Sidecar("not running".into())),
    }
}

/// Open the webview devtools window. Gated by the pry-crate `devtools` Cargo
/// feature (default-on). Built with `--no-default-features` the command still
/// compiles but returns an error so the frontend can surface a warning rather
/// than crash.
#[tauri::command]
async fn open_devtools(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(feature = "devtools")]
    {
        window.open_devtools();
        Ok(())
    }
    #[cfg(not(feature = "devtools"))]
    {
        let _ = window;
        Err("DevTools not available in this build".to_string())
    }
}

// ── Phase 5a: hardware probe commands ────────────────────────────────────────

/// Run the hardware probe, persist the result to %APPDATA%/Pry/hardware.json,
/// and return the report.
#[tauri::command]
fn probe_hardware() -> Result<hardware::HardwareReport, AppError> {
    let report = hardware::probe()
        .map_err(|e| AppError::Hardware(format!("{e:#}")))?;
    if let Err(e) = persist_hardware_report(&report) {
        tracing::warn!("failed to persist hardware report: {e}");
    }
    Ok(report)
}

/// Evaluate all presets in sidecar/presets.json against the provided hardware report.
#[tauri::command]
fn evaluate_presets(
    hw: hardware::HardwareReport,
) -> Result<Vec<presets_compat::PresetCompatibility>, AppError> {
    let sidecar_dir = sidecar::find_sidecar_dir()
        .map_err(|e| AppError::Presets(format!("{e:#}")))?;
    let presets_json = presets_compat::load_presets_json(&sidecar_dir)
        .map_err(|e| AppError::Presets(format!("{e:#}")))?;
    Ok(presets_compat::evaluate_all(&hw, &presets_json))
}

/// Return the persisted hardware report from disk, or None if not yet probed.
#[tauri::command]
fn cached_hardware_report() -> Result<Option<hardware::HardwareReport>, AppError> {
    let path = hardware_json_path()
        .map_err(|e| AppError::Hardware(format!("{e:#}")))?;
    if !path.exists() {
        return Ok(None);
    }
    let contents = std::fs::read_to_string(&path)?;  // io::Error → AppError::Io via From
    let report: hardware::HardwareReport = serde_json::from_str(&contents)?;  // serde → AppError::Presets via From
    Ok(Some(report))
}

// ── Phase 5a helpers ──────────────────────────────────────────────────────────

fn hardware_json_path() -> anyhow::Result<std::path::PathBuf> {
    // data_local_dir (%LOCALAPPDATA%) — see bootstrap::runtime_dir for rationale.
    let config_dir = dirs::data_local_dir()
        .ok_or_else(|| anyhow::anyhow!("could not determine local data directory"))?;
    let pry_dir = config_dir.join("Pry");
    std::fs::create_dir_all(&pry_dir)?;
    Ok(pry_dir.join("hardware.json"))
}

fn persist_hardware_report(report: &hardware::HardwareReport) -> anyhow::Result<()> {
    let path = hardware_json_path()?;
    let json = serde_json::to_string_pretty(report)?;
    std::fs::write(&path, json)?;
    tracing::info!("hardware report persisted to {}", path.display());
    Ok(())
}


pub fn run() {
    // Global panic hook — writes a crash log for ANY panic anywhere in the process
    // (including early setup-hook failures that would otherwise kill the app
    // without trace). Runs before the default hook so the original stderr dump
    // is still printed in dev builds.
    let default_panic_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let detail = format!("{info}");
        tracing::error!("panic: {detail}");
        if let Err(e) = crash::record_crash("panic", &detail) {
            tracing::warn!("failed to write panic crash log: {e}");
        }
        default_panic_hook(info);
    }));

    tauri::Builder::default()
        .setup(|app| {
            // Step A — resolve sidecar resource directory FIRST, before any
            // sidecar launch attempt. `find_sidecar_dir` / `locate_sidecar_source`
            // honor PRY_SIDECAR_DIR, and the launch path below needs this set.
            // Tauri 2 bundles `../sidecar/*` resources under `resource_dir/_up_/sidecar/`.
            if let Ok(resource_dir) = app.path().resource_dir() {
                let candidates = [
                    resource_dir.join("_up_").join("sidecar"),
                    resource_dir.join("sidecar"),
                    resource_dir.clone(),
                ];
                for candidate in &candidates {
                    if candidate.join("presets.json").exists()
                        || candidate.join("pyproject.toml").exists()
                    {
                        tracing::info!(
                            "bundled sidecar resources resolved to {}",
                            candidate.display()
                        );
                        // SAFETY: This is the Tauri setup hook, which runs on the
                        // main thread before the Tokio worker pool is started and
                        // before any other thread can call std::env::var. The
                        // write is therefore race-free on all platforms.
                        // On Windows, SetEnvironmentVariableW is additionally
                        // thread-safe per Win32 contract, making this doubly safe.
                        #[allow(unused_unsafe)]
                        unsafe {
                            std::env::set_var("PRY_SIDECAR_DIR", candidate);
                            std::env::set_var("PRY_SIDECAR_SOURCE", candidate);
                        }
                        break;
                    }
                }
            }

            // Step B — if runtime is ready, launch the sidecar in the BACKGROUND.
            // H1 fix: previously we used `tauri::async_runtime::block_on` inside
            // the sync setup closure, which panics on some Tauri 2.x versions
            // when setup runs on a Tokio worker thread ("cannot start a runtime
            // from within a runtime"). Spawning into the ambient runtime is the
            // supported pattern. The frontend already tolerates the sidecar
            // being briefly unavailable after startup — `sidecar_url` returns
            // `Sidecar("not running")` and callers poll `runtime_status`.
            let state: SidecarState = Arc::new(Mutex::new(None));
            app.manage(state.clone());

            if bootstrap::is_runtime_current() {
                let state_for_launch = state.clone();
                let app_handle_for_launch = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    match sidecar::launch_with_app(Some(app_handle_for_launch)).await {
                        Ok(handle) => {
                            tracing::info!("sidecar launched on {}", handle.base_url);
                            *state_for_launch.lock().await = Some(handle);
                        }
                        Err(e) => {
                            let detail = format!("{e:#}");
                            tracing::error!("sidecar launch failed: {detail}");
                            if let Err(log_err) =
                                crash::record_crash("sidecar launch (background)", &detail)
                            {
                                tracing::warn!("failed to write crash log: {log_err}");
                            }
                            // State stays None; frontend shows error state.
                        }
                    }
                });
            } else {
                tracing::info!(
                    "runtime not current (either not ready or sidecar package \
                    out of date) — skipping sidecar launch; frontend onboarding \
                    will invoke bootstrap_runtime_command to sync + launch"
                );
            }

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            sidecar_url,
            sidecar_stderr,
            probe_hardware,
            evaluate_presets,
            cached_hardware_report,
            bootstrap::bootstrap_runtime_command,
            bootstrap::runtime_status,
            crash::copy_diagnostic,
            crash::list_crash_logs,
            custom_models::validate_custom_model,
            custom_models::add_custom_model,
            custom_models::list_custom_models,
            custom_models::remove_custom_model,
            hf_auth::save_hf_token,
            hf_auth::has_hf_token,
            hf_auth::clear_hf_token,
            open_devtools,
        ])
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // H1 fix: block_on panics when called from within a Tokio
                // worker thread ("cannot start a runtime from within a
                // runtime"). Shutdown is best-effort fire-and-forget, so
                // spawn is correct here.
                let app = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<SidecarState>();
                    let arc: &Arc<Mutex<Option<SidecarHandle>>> = state.inner();
                    let mut guard: tokio::sync::MutexGuard<'_, Option<SidecarHandle>> = arc.lock().await;
                    let taken: Option<SidecarHandle> = guard.take();
                    if let Some(mut h) = taken {
                        let h: &mut SidecarHandle = &mut h;
                        if let Err(e) = h.shutdown().await {
                            tracing::warn!("sidecar shutdown error: {e}");
                        }
                    }
                });
            }
        });
}
