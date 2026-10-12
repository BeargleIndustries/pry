use super::{errors::BootstrapError, events::*};
use std::os::windows::process::CommandExt;
use std::path::Path;
use tokio::process::Command;

/// Create a venv at `venv_dir` from the shared PBS interpreter `base_python`
/// (`runtime\python.exe`). Venv paths come from `layout`; nothing here builds one.
pub async fn create(
    emit: &Emitter,
    base_python: &Path,
    venv_dir: &Path,
) -> Result<(), BootstrapError> {
    emit.stage(BootstrapStage::CreatingVenv, "creating virtual environment...");

    if !base_python.exists() {
        return Err(BootstrapError::Venv(format!(
            "python.exe not found at {}",
            base_python.display()
        )));
    }

    let venv_dir_str = venv_dir.to_str().ok_or_else(|| {
        BootstrapError::Internal(format!(
            "venv path not valid UTF-8: {}",
            venv_dir.display()
        ))
    })?;
    let output = Command::new(base_python)
        .args(["-m", "venv", venv_dir_str])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .await
        .map_err(|e| BootstrapError::Venv(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(BootstrapError::Venv(format!(
            "venv exit code {}: {}",
            output.status, stderr
        )));
    }

    emit.progress(BootstrapStage::CreatingVenv, "venv created", 1.0);
    Ok(())
}
