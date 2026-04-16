use super::{errors::BootstrapError, events::*, probe::CudaVariant, venv};
use std::os::windows::process::CommandExt;
use std::path::Path;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

// Embedded at compile time — the canonical runtime requirements.
const REQUIREMENTS_BASE: &str = include_str!("../../resources/requirements-runtime.txt");

pub async fn install_runtime_deps(
    emit: &Emitter,
    runtime_dir: &Path,
    cuda_variant: CudaVariant,
) -> Result<(), BootstrapError> {
    let pip = venv::venv_pip(runtime_dir);
    if !pip.exists() {
        return Err(BootstrapError::PipInstall(format!(
            "pip not found at {}",
            pip.display()
        )));
    }

    // 1. Install torch from the right index.
    emit.stage(
        BootstrapStage::InstallingTorch,
        format!("installing torch ({})", cuda_variant.wheel_tag()),
    );

    let torch_index = cuda_variant.pip_index_url();
    let torch_spec = cuda_variant.torch_spec();

    stream_pip_install(
        emit,
        &pip,
        &[
            "install",
            "--index-url",
            torch_index,
            "--extra-index-url",
            "https://pypi.org/simple",
            torch_spec,
        ],
        BootstrapStage::InstallingTorch,
    )
    .await?;

    // 2. transformer-lens
    emit.stage(
        BootstrapStage::InstallingTransformerLens,
        "installing transformer-lens...",
    );
    stream_pip_install(
        emit,
        &pip,
        &["install", "transformer-lens>=2.11,<3"],
        BootstrapStage::InstallingTransformerLens,
    )
    .await?;

    // 3. sae-lens
    emit.stage(BootstrapStage::InstallingSaeLens, "installing sae-lens...");
    stream_pip_install(
        emit,
        &pip,
        &["install", "sae-lens>=5.0,<6"],
        BootstrapStage::InstallingSaeLens,
    )
    .await?;

    // 4. extras from embedded requirements-runtime.txt
    emit.stage(BootstrapStage::InstallingExtras, "installing extras...");
    let req_path = runtime_dir.join("requirements-extras.txt");
    tokio::fs::write(&req_path, REQUIREMENTS_BASE)
        .await
        .map_err(|e| BootstrapError::Io(e.to_string()))?;
    let req_path_str = req_path.to_str().ok_or_else(|| {
        BootstrapError::Internal(format!(
            "requirements path not valid UTF-8: {}",
            req_path.display()
        ))
    })?;
    stream_pip_install(
        emit,
        &pip,
        &["install", "-r", req_path_str],
        BootstrapStage::InstallingExtras,
    )
    .await?;

    // 5. Install the local pry_sidecar package so `python -m pry_sidecar.main` works.
    emit.stage(BootstrapStage::InstallingExtras, "installing pry_sidecar package...");
    let sidecar_source = locate_sidecar_source()?;
    stream_pip_install(
        emit,
        &pip,
        &["install", sidecar_source.to_str().ok_or_else(|| BootstrapError::Internal("sidecar path not utf8".into()))?],
        BootstrapStage::InstallingExtras,
    )
    .await?;

    // 6. Write initial sidecar hash marker so subsequent bootstraps recognize
    //    the install as current and only reinstall pry_sidecar when source changes.
    if let Ok(hash) = super::bundle_hash() {
        if let Ok(marker) = super::sidecar_hash_marker_path() {
            if let Err(e) = tokio::fs::write(&marker, &hash).await {
                tracing::warn!("failed to write initial sidecar hash marker: {e}");
            }
        }
    }

    emit.progress(
        BootstrapStage::InstallingExtras,
        "all runtime deps installed",
        1.0,
    );
    Ok(())
}

/// Re-install the local `pry_sidecar` package from the bundled source
/// (used when the bundle hash differs from the installed marker). Uses
/// `--force-reinstall --no-deps` so only the pry_sidecar package is
/// touched — torch, transformer-lens, and sae-lens are NOT reinstalled.
pub async fn reinstall_sidecar_package(
    emit: &Emitter,
    runtime_dir: &Path,
) -> Result<(), BootstrapError> {
    emit.stage(BootstrapStage::InstallingExtras, "updating sidecar package...");

    let pip = venv::venv_pip(runtime_dir);
    if !pip.exists() {
        return Err(BootstrapError::PipInstall(format!(
            "venv pip not found at {}",
            pip.display()
        )));
    }

    let sidecar_source = locate_sidecar_source()?;
    let src_str = sidecar_source.to_str().ok_or_else(|| {
        BootstrapError::Internal(format!(
            "sidecar source path not utf8: {}",
            sidecar_source.display()
        ))
    })?;

    stream_pip_install(
        emit,
        &pip,
        &["install", "--force-reinstall", "--no-deps", src_str],
        BootstrapStage::InstallingExtras,
    )
    .await?;

    // Write the new hash marker
    let new_hash = super::bundle_hash()
        .map_err(|e| BootstrapError::Internal(format!("bundle_hash: {e}")))?;
    let marker_path = super::sidecar_hash_marker_path()
        .map_err(|e| BootstrapError::Internal(format!("marker_path: {e}")))?;
    tokio::fs::write(&marker_path, &new_hash)
        .await
        .map_err(|e| BootstrapError::Io(format!("write sidecar hash marker: {e}")))?;

    emit.progress(
        BootstrapStage::InstallingExtras,
        "sidecar package updated",
        1.0,
    );
    Ok(())
}

pub fn locate_sidecar_source() -> Result<std::path::PathBuf, BootstrapError> {
    // 1. Explicit env var (set by tauri-build or a wrapper script).
    if let Ok(p) = std::env::var("PRY_SIDECAR_SOURCE") {
        let path = std::path::PathBuf::from(p);
        if path.join("pyproject.toml").exists() {
            return Ok(path);
        }
    }

    // 2. Walk up from current_exe looking for sidecar/pyproject.toml.
    //    Dev mode: target/debug/pry.exe → ../../sidecar/
    if let Ok(exe) = std::env::current_exe() {
        let mut cur = exe.parent().map(|p| p.to_path_buf());
        while let Some(d) = cur {
            let candidate = d.join("sidecar");
            if candidate.join("pyproject.toml").exists() {
                return Ok(candidate);
            }
            cur = d.parent().map(|p| p.to_path_buf());
        }
    }

    // 3. Installer-shipped builds: resources/sidecar/ next to the exe.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let resource = parent.join("resources").join("sidecar");
            if resource.join("pyproject.toml").exists() {
                return Ok(resource);
            }
        }
    }

    Err(BootstrapError::Internal(
        "could not locate sidecar source tree for pip install. Set PRY_SIDECAR_SOURCE env var.".into(),
    ))
}

async fn stream_pip_install(
    emit: &Emitter,
    pip: &Path,
    args: &[&str],
    _stage: BootstrapStage,
) -> Result<(), BootstrapError> {
    use std::sync::{Arc, Mutex};
    use std::collections::VecDeque;

    let mut cmd = Command::new(pip);
    cmd.args(args);
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| BootstrapError::PipInstall(e.to_string()))?;

    let stdout = child.stdout.take()
        .ok_or_else(|| BootstrapError::PipInstall("no stdout pipe on child (Stdio::piped not set)".into()))?;
    let stderr = child.stderr.take()
        .ok_or_else(|| BootstrapError::PipInstall("no stderr pipe on child (Stdio::piped not set)".into()))?;

    // M5 fix: tail the last ~100 stderr lines so we can scan for AV/permission
    // patterns on failure. Cheap bounded ring buffer so we don't balloon memory
    // on a runaway pip install.
    const STDERR_TAIL: usize = 100;
    let stderr_tail: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));

    let emit_out = Emitter::new(emit.handle_clone());
    let stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            emit_out.log(line);
        }
    });
    let emit_err = Emitter::new(emit.handle_clone());
    let stderr_tail_clone = stderr_tail.clone();
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            emit_err.log(format!("[stderr] {line}"));
            let mut buf = stderr_tail_clone
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            buf.push_back(line);
            while buf.len() > STDERR_TAIL {
                buf.pop_front();
            }
        }
    });

    let status = child
        .wait()
        .await
        .map_err(|e| BootstrapError::PipInstall(e.to_string()))?;
    let _ = tokio::try_join!(stdout_task, stderr_task);

    if !status.success() {
        // M5 fix: scan the captured stderr tail for known-AV/permission patterns
        // and surface a typed `Antivirus` error so the UI can show a targeted
        // remediation hint instead of a generic pip failure.
        let tail = {
            let buf = stderr_tail.lock().unwrap_or_else(|e| e.into_inner());
            buf.iter().cloned().collect::<Vec<_>>().join("\n")
        };
        let tail_lower = tail.to_lowercase();
        let av_hit = tail_lower.contains("access is denied")
            || tail_lower.contains("operation did not complete successfully")
            || tail_lower.contains("winerror 5")
            || tail_lower.contains("defender")
            || tail_lower.contains("virus")
            || tail_lower.contains("oserror: [errno 13]")
            || tail_lower.contains("permission denied");
        if av_hit {
            return Err(BootstrapError::Antivirus(format!(
                "pip exit {}; Windows Defender or another AV likely quarantined a wheel. \
                 Add %LOCALAPPDATA%\\Pry\\runtime\\ as an exclusion and retry. Tail:\n{}",
                status, tail
            )));
        }
        return Err(BootstrapError::PipInstall(format!(
            "pip exit {}\n{}",
            status, tail
        )));
    }
    Ok(())
}
