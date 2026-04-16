use super::{errors::BootstrapError, events::*};
use std::os::windows::process::CommandExt;
use std::path::Path;
use tokio::process::Command;

pub async fn create(emit: &Emitter, runtime_dir: &Path) -> Result<(), BootstrapError> {
    emit.stage(BootstrapStage::CreatingVenv, "creating virtual environment...");

    // python-build-standalone ships python.exe at the root of runtime_dir after the move.
    let python_exe = runtime_dir.join("python.exe");
    if !python_exe.exists() {
        return Err(BootstrapError::Venv(format!(
            "python.exe not found at {}",
            python_exe.display()
        )));
    }

    let venv_dir = runtime_dir.join("venv");
    let venv_dir_str = venv_dir.to_str().ok_or_else(|| {
        BootstrapError::Internal(format!(
            "venv path not valid UTF-8: {}",
            venv_dir.display()
        ))
    })?;
    let output = Command::new(&python_exe)
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

pub fn venv_python(runtime_dir: &Path) -> std::path::PathBuf {
    runtime_dir.join("venv").join("Scripts").join("python.exe")
}

pub fn venv_pip(runtime_dir: &Path) -> std::path::PathBuf {
    runtime_dir.join("venv").join("Scripts").join("pip.exe")
}
