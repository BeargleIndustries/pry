use super::{errors::BootstrapError, events::*, probe::CudaVariant};
use std::path::{Path, PathBuf};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

// Embedded at compile time — the canonical runtime requirements.
const REQUIREMENTS_BASE: &str = include_str!("../../resources/requirements-runtime.txt");

/// One pip invocation in the install sequence.
#[derive(Debug, Clone)]
pub enum PipStep {
    Torch,
    TransformerLens,
    SaeLens,
    /// `-r <requirements file>`
    Extras(PathBuf),
    /// Local pry_sidecar source tree.
    Sidecar(PathBuf),
    /// `--force-reinstall --no-deps <sidecar source>` (bundle hash changed).
    ReinstallSidecar(PathBuf),
}

/// A fully specified pip process: always `<venv python> -m pip ...`.
#[derive(Debug, Clone)]
pub struct PipInvocation {
    pub program: PathBuf,
    pub args: Vec<String>,
}

/// The single builder for every pip command (pure; unit-testable).
///
/// Every step carries `-c <constraints>` and `--extra-index-url <torch index>`
/// (T3a replay: without them, step 2 pulls TL 2.18 -> PyPI torch 2.14 and step
/// 5 downgrades to the untagged CPU torch 2.5.1). Constraints go on the command
/// line, NOT via `PIP_CONSTRAINT`: pip splits that env var on whitespace, so a
/// `%LOCALAPPDATA%` path with a space in the user name would break every step.
/// The path is one argv element (no shell), so spaces are fine here.
pub fn pip_command_for_step(
    step: &PipStep,
    variant: CudaVariant,
    venv_python: &Path,
    constraints: &Path,
) -> PipInvocation {
    let s = |p: &Path| p.to_string_lossy().into_owned();
    let mut args: Vec<String> = vec![
        "-m".into(),
        "pip".into(),
        "install".into(),
        "-c".into(),
        s(constraints),
        "--extra-index-url".into(),
        variant.pip_index_url().into(),
    ];
    match step {
        PipStep::Torch => {
            // --no-cache-dir: keep the ~2.5 GB wheel out of the pip cache so an
            // update doesn't need room for a second copy. The spec carries the
            // local tag (+cu128/+cu124/+cpu), which only the torch index serves.
            args.extend(["--no-cache-dir".into(), variant.torch_spec().into()]);
        }
        PipStep::TransformerLens => args.push("transformer-lens>=2.11,<3".into()),
        PipStep::SaeLens => args.push("sae-lens>=5.0,<6".into()),
        PipStep::Extras(req) => args.extend(["-r".into(), s(req)]),
        PipStep::Sidecar(src) => args.push(s(src)),
        PipStep::ReinstallSidecar(src) => {
            args.extend(["--force-reinstall".into(), "--no-deps".into(), s(src)])
        }
    }
    PipInvocation {
        program: venv_python.to_path_buf(),
        args,
    }
}

async fn run_step(
    emit: &Emitter,
    step: PipStep,
    variant: CudaVariant,
    venv_python: &Path,
    constraints: &Path,
) -> Result<(), BootstrapError> {
    let inv = pip_command_for_step(&step, variant, venv_python, constraints);
    stream_pip_install(emit, &inv).await
}

/// Copy the variant's constraints into the venv; returns the `-c` path.
fn venv_constraints(venv_dir: &Path, variant: CudaVariant) -> Result<PathBuf, BootstrapError> {
    super::layout::write_constraints(venv_dir, variant)
        .map_err(|e| BootstrapError::Io(format!("write constraints: {e}")))
}

/// Install the full dependency set into the venv whose interpreter is
/// `venv_python`. `venv_dir` holds per-build scratch files and the
/// constraints copy used by every step.
pub async fn install_runtime_deps(
    emit: &Emitter,
    venv_dir: &Path,
    venv_python: &Path,
    cuda_variant: CudaVariant,
) -> Result<(), BootstrapError> {
    if !venv_python.exists() {
        return Err(BootstrapError::PipInstall(format!(
            "venv python not found at {}",
            venv_python.display()
        )));
    }
    let constraints = venv_constraints(venv_dir, cuda_variant)?;

    // 1. Install torch from the right index.
    emit.stage(
        BootstrapStage::InstallingTorch,
        format!("installing torch ({})", cuda_variant.wheel_tag()),
    );
    run_step(emit, PipStep::Torch, cuda_variant, venv_python, &constraints).await?;

    // 2. transformer-lens
    emit.stage(
        BootstrapStage::InstallingTransformerLens,
        "installing transformer-lens...",
    );
    run_step(emit, PipStep::TransformerLens, cuda_variant, venv_python, &constraints).await?;

    // 3. sae-lens
    emit.stage(BootstrapStage::InstallingSaeLens, "installing sae-lens...");
    run_step(emit, PipStep::SaeLens, cuda_variant, venv_python, &constraints).await?;

    // 4. extras from embedded requirements-runtime.txt
    emit.stage(BootstrapStage::InstallingExtras, "installing extras...");
    let req_path = venv_dir.join("requirements-extras.txt");
    tokio::fs::write(&req_path, REQUIREMENTS_BASE)
        .await
        .map_err(|e| BootstrapError::Io(e.to_string()))?;
    run_step(emit, PipStep::Extras(req_path), cuda_variant, venv_python, &constraints).await?;

    // 5. Install the local pry_sidecar package so `python -m pry_sidecar.main` works.
    emit.stage(BootstrapStage::InstallingExtras, "installing pry_sidecar package...");
    let sidecar_source = locate_sidecar_source()?;
    run_step(emit, PipStep::Sidecar(sidecar_source), cuda_variant, venv_python, &constraints)
        .await?;

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
/// The caller writes the new hash marker.
pub async fn reinstall_sidecar_package(
    emit: &Emitter,
    venv_dir: &Path,
    venv_python: &Path,
    variant: CudaVariant,
) -> Result<(), BootstrapError> {
    emit.stage(BootstrapStage::InstallingExtras, "updating sidecar package...");

    if !venv_python.exists() {
        return Err(BootstrapError::PipInstall(format!(
            "venv python not found at {}",
            venv_python.display()
        )));
    }
    let constraints = venv_constraints(venv_dir, variant)?;

    let sidecar_source = locate_sidecar_source()?;
    run_step(
        emit,
        PipStep::ReinstallSidecar(sidecar_source),
        variant,
        venv_python,
        &constraints,
    )
    .await?;

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

async fn stream_pip_install(emit: &Emitter, inv: &PipInvocation) -> Result<(), BootstrapError> {
    use std::sync::{Arc, Mutex};
    use std::collections::VecDeque;

    // Every line goes through `Emitter::log`, which also tees to the
    // persisted bootstrap log when the emitter has one.
    emit.log(format!("$ {} {}", inv.program.display(), inv.args.join(" ")));
    let mut cmd = Command::new(&inv.program);
    cmd.args(&inv.args);
    // Never inherit a user-level PIP_CONSTRAINT: the `-c` file is authoritative.
    cmd.env_remove("PIP_CONSTRAINT");
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

    let emit_out = emit.clone();
    let stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            emit_out.log(line);
        }
    });
    let emit_err = emit.clone();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_step_runs_python_dash_m_pip_with_constraints_and_torch_index() {
        let py = Path::new(r"C:\rt\venvs\x-cu124\Scripts\python.exe");
        // A user name with a space: must stay a single argv element.
        let cpath = Path::new(r"C:\Users\Jane Doe\AppData\Local\Pry\runtime\venvs\x\constraints.txt");
        let steps = [
            PipStep::Torch,
            PipStep::TransformerLens,
            PipStep::SaeLens,
            PipStep::Extras(PathBuf::from(r"C:\rt\req.txt")),
            PipStep::Sidecar(PathBuf::from(r"C:\src\sidecar")),
            PipStep::ReinstallSidecar(PathBuf::from(r"C:\src\sidecar")),
        ];
        for v in [CudaVariant::Cu128, CudaVariant::Cu124, CudaVariant::Cpu] {
            for step in &steps {
                let inv = pip_command_for_step(step, v, py, cpath);
                assert_eq!(inv.program, py, "{step:?}");
                assert_eq!(&inv.args[..3], ["-m", "pip", "install"], "{step:?}");
                let c = inv.args.iter().position(|a| a == "-c").expect("-c missing");
                assert_eq!(inv.args[c + 1], cpath.to_string_lossy(), "{step:?}");
                let x = inv
                    .args
                    .iter()
                    .position(|a| a == "--extra-index-url")
                    .expect("--extra-index-url missing");
                assert_eq!(inv.args[x + 1], v.pip_index_url(), "{step:?}");
                assert!(!inv.args.iter().any(|a| a.contains("PIP_CONSTRAINT")));
            }
        }
        let torch = pip_command_for_step(&PipStep::Torch, CudaVariant::Cu124, py, cpath);
        assert!(torch.args.iter().any(|a| a == "--no-cache-dir"));
        assert_eq!(torch.args.last().unwrap(), "torch==2.5.1+cu124");
        let cu128 = pip_command_for_step(&PipStep::Torch, CudaVariant::Cu128, py, cpath);
        assert_eq!(cu128.args.last().unwrap(), "torch==2.7.1+cu128");
        let cpu = pip_command_for_step(&PipStep::Torch, CudaVariant::Cpu, py, cpath);
        assert_eq!(cpu.args.last().unwrap(), "torch==2.7.1+cpu");
    }
}
