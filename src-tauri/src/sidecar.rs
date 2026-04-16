// sidecar.rs — Phase 2: full sidecar lifecycle manager
//
// Phase 8.3: Python resolution uses managed-runtime-first strategy:
//   1. Managed venv:  %LOCALAPPDATA%/Pry/runtime/venv/Scripts/python.exe
//   2. Env override:  PRY_PYTHON_OVERRIDE
//   3. System Python: which python / python3  (DEV MODE fallback)
//
// In managed-runtime mode pry_sidecar is pip-installed into the venv's
// site-packages by the bootstrap pip step, so `python -m pry_sidecar.main`
// resolves it directly via sys.path. Dev-mode (SystemPath) sets cwd=sidecar_dir
// so the local source tree is importable.
//
//! Concurrency note:
//!   SidecarState = Arc<tokio::sync::Mutex<Option<SidecarHandle>>>
//!     — uses tokio::sync::Mutex because Tauri commands hold the guard
//!     across .await points (e.g. while the sidecar spawns or heartbeats)
//!     and std::sync::Mutex would deadlock the tokio runtime.
//!   stderr ring buffer uses std::sync::Mutex
//!     — held only briefly in the producer/consumer sync paths, never
//!     across awaits. Cheaper than tokio::sync::Mutex.
//!   If you need to touch either, keep to this rule: hold-across-await →
//!     tokio::sync::Mutex; otherwise → std::sync::Mutex.

use anyhow::{anyhow, Context};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use std::sync::Mutex;
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};

#[cfg(target_os = "windows")]
use windows::Win32::{
    Foundation::HANDLE,
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    },
    System::Threading::GetCurrentProcess,
};

pub struct SidecarHandle {
    pub port: u16,
    pub base_url: String,
    child: Option<Child>,
    #[cfg(target_os = "windows")]
    job: Option<HANDLE>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    pub stderr_buffer: Arc<Mutex<VecDeque<String>>>,
}

// SAFETY: HANDLE is `*mut c_void` and thus !Send/!Sync by default. We assert
// Send+Sync for SidecarHandle because:
//   1. The handle is written exactly once in `launch()` before the value
//      crosses any thread boundary.
//   2. It is read exactly once in `Drop::drop` via `CloseHandle`, which is
//      thread-safe per Win32.
//   3. No other code path touches `self.job`.
// The Tokio Mutex wrapping SidecarHandle in lib.rs serializes all other
// access. If a future change adds a second read site, re-audit this impl.
#[cfg(target_os = "windows")]
unsafe impl Send for SidecarHandle {}
#[cfg(target_os = "windows")]
unsafe impl Sync for SidecarHandle {}

impl SidecarHandle {
    pub async fn shutdown(&mut self) -> anyhow::Result<()> {
        // Signal heartbeat loop to stop
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }

        if let Some(child) = self.child.as_mut() {
            if let Some(pid) = child.id() {
                // On Windows: taskkill /T kills the process tree
                #[cfg(target_os = "windows")]
                {
                    tracing::info!("sidecar: sending taskkill /T to pid {pid}");
                    // M3 fix: log taskkill outcome instead of silently dropping it,
                    // and run the blocking call on a dedicated blocking thread so
                    // we don't stall the reactor if taskkill hangs or is missing.
                    let pid_str = pid.to_string();
                    let kill_result = tokio::task::spawn_blocking(move || {
                        std::process::Command::new("taskkill")
                            .args(["/PID", &pid_str, "/T", "/F"])
                            .output()
                    })
                    .await;
                    match kill_result {
                        Ok(Ok(out)) if out.status.success() => {
                            tracing::debug!("taskkill succeeded for pid {pid}");
                        }
                        Ok(Ok(out)) => {
                            let stderr = String::from_utf8_lossy(&out.stderr);
                            tracing::warn!(
                                "taskkill failed for pid {pid}: status {} stderr: {}",
                                out.status,
                                stderr
                            );
                        }
                        Ok(Err(e)) => {
                            tracing::warn!("taskkill spawn failed for pid {pid}: {e}");
                        }
                        Err(e) => {
                            tracing::warn!("taskkill join error for pid {pid}: {e}");
                        }
                    }
                }

                #[cfg(not(target_os = "windows"))]
                {
                    tracing::info!("sidecar: sending SIGTERM to pid {pid}");
                    unsafe {
                        libc::kill(pid as i32, libc::SIGTERM);
                    }
                }
            }

            // Wait up to 5s for graceful exit
            match timeout(Duration::from_secs(5), child.wait()).await {
                Ok(Ok(status)) => tracing::info!("sidecar exited with {status}"),
                Ok(Err(e)) => tracing::warn!("sidecar wait error: {e}"),
                Err(_) => {
                    tracing::warn!("sidecar did not exit within 5s, force-killing");
                    let _ = child.kill().await;
                }
            }
        }

        self.child = None;
        Ok(())
    }

    pub fn stderr_snapshot(&self) -> Vec<String> {
        // M1 fix: recover from poisoned mutex instead of panicking. The stderr
        // buffer is append-only data; poisoning is fully recoverable.
        let buf = self
            .stderr_buffer
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        buf.iter().cloned().collect()
    }
}

impl Drop for SidecarHandle {
    fn drop(&mut self) {
        // M2 fix: signal heartbeat shutdown before touching the child so the
        // heartbeat loop doesn't log spurious health misses after drop.
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }

        // M2/M3 fix: do NOT call the blocking `taskkill` here. `Drop` may run
        // on the Tokio runtime thread and blocking it for ~100-500ms stalls
        // the reactor. Rely on (a) the async shutdown() path having already
        // run during exit, and (b) the Windows Job Object's KILL_ON_JOB_CLOSE
        // flag (set in create_job_object) which reaps the process tree
        // automatically when the HANDLE is closed below.
        if let Some(child) = self.child.as_mut() {
            let _ = child.start_kill();
        }

        // Close Job Object handle — because JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE is set,
        // closing the handle kills all processes assigned to the job.
        #[cfg(target_os = "windows")]
        if let Some(handle) = self.job.take() {
            unsafe {
                let _ = windows::Win32::Foundation::CloseHandle(handle);
            }
        }
    }
}

/// Indicates where the Python executable came from.
#[derive(Debug)]
pub enum PythonSource {
    /// %APPDATA%/Pry/runtime/venv/Scripts/python.exe — managed installer runtime
    ManagedRuntime,
    /// PRY_PYTHON_OVERRIDE env var — advanced user escape hatch
    EnvOverride,
    /// which::which("python"/"python3") — dev-mode fallback
    SystemPath,
}

/// Find the Python executable using managed-runtime-first resolution.
///
/// Priority:
///   1. Managed venv  (bootstrap::is_runtime_ready() + venv path exists)
///   2. PRY_PYTHON_OVERRIDE env var
///   3. System PATH  (dev mode — cargo tauri dev without managed runtime)
fn find_python() -> anyhow::Result<(PathBuf, PythonSource)> {
    // 1. Managed runtime
    if crate::bootstrap::is_runtime_ready() {
        if let Ok(runtime_dir) = crate::bootstrap::runtime_dir() {
            let venv_python = runtime_dir.join("venv").join("Scripts").join("python.exe");
            if venv_python.exists() {
                return Ok((venv_python, PythonSource::ManagedRuntime));
            }
        }
    }

    // 2. Env var override
    if let Ok(p) = std::env::var("PRY_PYTHON_OVERRIDE") {
        let path = std::path::PathBuf::from(p);
        if path.exists() {
            return Ok((path, PythonSource::EnvOverride));
        }
    }

    // 3. System Python (dev fallback)
    if let Ok(p) = which::which("python") {
        return Ok((p, PythonSource::SystemPath));
    }
    if let Ok(p) = which::which("python3") {
        return Ok((p, PythonSource::SystemPath));
    }

    anyhow::bail!(
        "no Python found: managed runtime not ready, PRY_PYTHON_OVERRIDE not set, \
        and no python/python3 on PATH"
    )
}

/// Locate the sidecar directory containing `pry_sidecar/main.py`.
///
/// Resolution order:
///   1. PRY_SIDECAR_DIR env var (dev/CI override)
///   2. %APPDATA%/Pry/runtime/pry_sidecar/ (managed runtime — copied by bundler)
///   3. Walk up from exe looking for sidecar/pry_sidecar/main.py (dev layout)
///
/// Note: in managed-runtime mode pry_sidecar may instead be installed as a pip
/// package into the venv (see TODO in module header). In that case this function
/// is not used for the cwd — only for dev-mode spawning.
pub fn find_sidecar_dir() -> anyhow::Result<PathBuf> {
    // 1. Env var override (useful in dev and CI)
    if let Ok(dir) = std::env::var("PRY_SIDECAR_DIR") {
        let p = PathBuf::from(&dir);
        if p.join("pry_sidecar").join("main.py").exists() {
            tracing::info!("sidecar: using PRY_SIDECAR_DIR={dir}");
            return Ok(p);
        }
        tracing::warn!("PRY_SIDECAR_DIR={dir} set but pry_sidecar/main.py not found there");
    }

    // 2. Managed runtime copy (bundler places pry_sidecar here)
    if let Some(config) = dirs::data_local_dir() {
        let runtime_sidecar = config.join("Pry").join("runtime").join("pry_sidecar");
        if runtime_sidecar.join("main.py").exists() {
            tracing::info!("sidecar: found managed runtime sidecar at {}", runtime_sidecar.display());
            // Return the parent so callers can do sidecar_dir/pry_sidecar/main.py
            return Ok(runtime_sidecar.parent().unwrap().to_path_buf());
        }
    }

    // 3. Walk up from current exe looking for sidecar/pry_sidecar/main.py
    // Dev layout: target/debug/pry.exe → ../../sidecar/
    // Installed layout: resources/sidecar/ (adjacent to exe)
    //
    // H4 fix: bumped from 6 to 8 levels to cover deeper installed layouts
    // (e.g. Chocolatey / Program Files with nested vendor dirs). The setup
    // hook in lib.rs is the primary resolution path via PRY_SIDECAR_DIR;
    // this walk-up is a fallback for dev mode and off-the-beaten-path installs.
    const WALK_UP_LIMIT: usize = 8;
    let exe = std::env::current_exe().context("could not get current exe path")?;
    let mut dir = exe.parent().map(|p| p.to_path_buf()).unwrap_or_default();

    for _ in 0..WALK_UP_LIMIT {
        let candidate = dir.join("sidecar");
        if candidate.join("pry_sidecar").join("main.py").exists() {
            tracing::info!("sidecar: found sidecar dir at {}", candidate.display());
            return Ok(candidate);
        }
        // Also check the Tauri 2 bundler's _up_/sidecar layout one level down.
        let bundled = dir.join("_up_").join("sidecar");
        if bundled.join("pry_sidecar").join("main.py").exists()
            || bundled.join("main.py").exists()
        {
            tracing::info!("sidecar: found bundled sidecar at {}", bundled.display());
            return Ok(bundled);
        }
        match dir.parent() {
            Some(p) => dir = p.to_path_buf(),
            None => break,
        }
    }

    tracing::debug!(
        "find_sidecar_dir: no candidate matched. Dev override: set PRY_SIDECAR_DIR \
        to a directory containing pry_sidecar/main.py."
    );
    Err(anyhow!(
        "Could not locate sidecar resources. This usually means the installer \
        bundle is incomplete — please reinstall Pry."
    ))
}

/// Create a Windows Job Object with kill-on-job-close so the sidecar dies
/// if Pry.exe is killed from Task Manager (not just when it exits gracefully).
#[cfg(target_os = "windows")]
fn create_job_object() -> anyhow::Result<HANDLE> {
    unsafe {
        let job = CreateJobObjectW(None, None)
            .context("CreateJobObjectW failed")?;

        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        if let Err(e) = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) {
            let _ = windows::Win32::Foundation::CloseHandle(job);
            return Err(anyhow::Error::from(e).context("SetInformationJobObject failed"));
        }

        Ok(job)
    }
}

/// RAII guard for a Windows Job Object HANDLE.
/// Closes the handle on drop unless ownership has been transferred via `take()`.
#[cfg(target_os = "windows")]
struct JobGuard(Option<HANDLE>);

// SAFETY: HANDLE is `*mut c_void` and thus !Send/!Sync by default. The Win32
// kernel object it refers to is thread-safe for the calls we make on it
// (`CloseHandle`, `AssignProcessToJobObject`, `TerminateJobObject`). JobGuard
// is only ever owned by a single task at a time (created in `launch()`,
// moved into the success or error branch, never shared). This matches the
// justification for `unsafe impl Send for SidecarHandle`.
#[cfg(target_os = "windows")]
unsafe impl Send for JobGuard {}

// Compile-time assertion: if JobGuard ever picks up a non-Send field, this
// fails to compile so we notice before runtime.
#[cfg(target_os = "windows")]
const _: fn() = || {
    fn assert_send<T: Send>() {}
    assert_send::<JobGuard>();
};

#[cfg(target_os = "windows")]
impl JobGuard {
    fn new(handle: HANDLE) -> Self {
        Self(Some(handle))
    }

    /// Transfer ownership out of the guard, preventing Drop from closing it.
    fn take(mut self) -> HANDLE {
        self.0.take().expect("JobGuard already taken")
    }
}

#[cfg(target_os = "windows")]
impl Drop for JobGuard {
    fn drop(&mut self) {
        if let Some(h) = self.0.take() {
            unsafe { let _ = windows::Win32::Foundation::CloseHandle(h); }
        }
    }
}

#[cfg(target_os = "windows")]
fn assign_to_job(job: HANDLE, child: &Child) -> anyhow::Result<()> {
    let pid = child.id().ok_or_else(|| anyhow!("child has no PID"))?;
    unsafe {
        // Open the child process handle with the minimum rights needed by
        // AssignProcessToJobObject: PROCESS_SET_QUOTA | PROCESS_TERMINATE.
        let proc = windows::Win32::System::Threading::OpenProcess(
            windows::Win32::System::Threading::PROCESS_SET_QUOTA
                | windows::Win32::System::Threading::PROCESS_TERMINATE,
            false,
            pid,
        )
        .context("OpenProcess failed for sidecar pid")?;

        let result = AssignProcessToJobObject(job, proc).context("AssignProcessToJobObject failed");
        let _ = windows::Win32::Foundation::CloseHandle(proc);
        result?;
    }
    Ok(())
}

/// Backwards-compatible wrapper — launches without crash event emission.
pub async fn launch() -> anyhow::Result<SidecarHandle> {
    launch_with_app(None).await
}

/// Launch the sidecar. If `app_handle` is provided, the heartbeat loop will
/// emit `sidecar:crashed` events so the UI can react (H2 fix).
pub async fn launch_with_app(app_handle: Option<tauri::AppHandle>) -> anyhow::Result<SidecarHandle> {
    let port = portpicker::pick_unused_port()
        .ok_or_else(|| anyhow!("no free port available"))?;

    tracing::info!("sidecar: picked port {port}");

    let (python, python_source) = find_python()?;

    tracing::info!("sidecar using Python from {:?}: {}", python_source, python.display());

    // Resolve the working directory based on Python source.
    //   ManagedRuntime: pry_sidecar is pip-installed into the venv's
    //     site-packages; there is no source tree on disk next to the exe.
    //     cwd just needs to exist — we use the runtime root.
    //   SystemPath: dev mode — sidecar source tree must be found via walk-up.
    //   EnvOverride: honor PRY_SIDECAR_DIR if set, else fall back to runtime_dir.
    let sidecar_dir: PathBuf = match python_source {
        PythonSource::ManagedRuntime => crate::bootstrap::runtime_dir()
            .map_err(|e| anyhow!("runtime_dir: {e}"))?,
        PythonSource::SystemPath => {
            find_sidecar_dir().map_err(|e| anyhow!("find_sidecar_dir: {e}"))?
        }
        PythonSource::EnvOverride => find_sidecar_dir().or_else(|_| {
            crate::bootstrap::runtime_dir()
                .map_err(|e| anyhow!("runtime_dir fallback: {e}"))
        })?,
    };

    // Build the child process
    let mut cmd = Command::new(&python);
    cmd.args(["-m", "pry_sidecar.main"]);
    cmd.current_dir(&sidecar_dir);
    cmd.env("PRY_PORT", port.to_string());
    cmd.env("PYTHONUNBUFFERED", "1");

    // Pass through optional HuggingFace env vars
    for var in &["HF_HOME", "HF_HUB_ENABLE_HF_TRANSFER"] {
        if let Ok(val) = std::env::var(var) {
            cmd.env(var, val);
        }
    }

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    // Windows-specific: no console window
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().with_context(|| {
        format!(
            "failed to spawn sidecar: python={} cwd={}",
            python.display(),
            sidecar_dir.display()
        )
    })?;

    // Windows Job Object — assign child before it can spawn sub-processes
    #[cfg(target_os = "windows")]
    let job_guard: Option<JobGuard> = {
        match create_job_object() {
            Ok(job) => {
                let guard = JobGuard::new(job);
                if let Err(e) = assign_to_job(job, &child) {
                    tracing::warn!("sidecar: job object assign failed (non-fatal): {e}");
                }
                Some(guard)
            }
            Err(e) => {
                tracing::warn!("sidecar: job object creation failed (non-fatal): {e}");
                None
            }
        }
    };

    // Capture stdout to detect READY sentinel
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("child stdout not piped"))?;

    // Capture stderr into a capped ring buffer (64KB ≈ ~600 lines of 100 chars)
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("child stderr not piped"))?;

    let stderr_buffer: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
    let stderr_buf_clone = stderr_buffer.clone();

    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        const STDERR_BUFFER_BYTES: usize = 64 * 1024;
        let mut total_bytes: usize = 0;
        while let Ok(Some(line)) = reader.next_line().await {
            tracing::debug!("sidecar stderr: {}", line);
            // Feed into crash diagnostic tail
            crate::crash::record_line(line.clone());
            let line_len = line.len() + 1; // +1 for the newline
            // M1 fix: recover from poisoned mutex instead of panicking.
            let mut buf = stderr_buf_clone
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            buf.push_back(line);
            total_bytes += line_len;
            // Trim from front until we're within the byte cap (keep at least one line)
            while total_bytes > STDERR_BUFFER_BYTES && buf.len() > 1 {
                if let Some(popped) = buf.pop_front() {
                    total_bytes -= popped.len() + 1;
                }
            }
        }
    });

    // Wait for READY sentinel with 60s timeout
    let expected_sentinel = format!("READY {port}");

    let mut stdout_reader = BufReader::new(stdout).lines();
    let sentinel_task = tokio::spawn(async move {
        while let Ok(Some(line)) = stdout_reader.next_line().await {
            tracing::debug!("sidecar stdout: {}", line);
            if line.trim() == expected_sentinel {
                return Ok(stdout_reader);
            }
        }
        Err(anyhow!("sidecar stdout closed before READY sentinel"))
    });

    let ready_result = timeout(Duration::from_secs(60), sentinel_task).await;

    let stdout_after_ready = match ready_result {
        Err(_elapsed) => {
            // Timeout — job_guard drops here, closing the HANDLE
            let _ = child.kill().await;
            return Err(anyhow!(
                "sidecar failed to start within 60s — see troubleshooting: \
                Windows Defender may have quarantined python.exe; \
                check %APPDATA%/Pry/runtime/ and add it as an AV exclusion. \
                Also ensure Python 3.10+ is installed and on PATH."
            ));
        }
        Ok(Err(join_err)) => {
            // Sentinel task panicked — job_guard drops here
            let _ = child.kill().await;
            return Err(anyhow!("sidecar sentinel task panicked: {join_err}"));
        }
        Ok(Ok(Err(e))) => {
            // Sentinel reader error — job_guard drops here
            let _ = child.kill().await;
            return Err(e.context("sidecar did not emit READY sentinel"));
        }
        Ok(Ok(Ok(reader))) => {
            tracing::info!("sidecar: READY on port {port}");
            reader
        }
    };

    // Drain stdout for the child's lifetime. Without this the OS pipe buffer (~64 KB on
    // Windows) fills up and the child blocks on write, hanging the sidecar after a few
    // minutes of uvicorn/model-loading output.
    tokio::spawn(async move {
        let mut drain_reader = stdout_after_ready;
        loop {
            match drain_reader.next_line().await {
                Ok(Some(line)) => tracing::debug!("[sidecar stdout] {}", line),
                Ok(None) => break, // EOF — child closed stdout
                Err(e) => {
                    tracing::warn!("sidecar stdout read error: {e}");
                    break;
                }
            }
        }
    });

    // Heartbeat loop
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    let base_url = format!("http://127.0.0.1:{port}");
    let health_url = format!("{base_url}/health");
    let stderr_for_heartbeat = stderr_buffer.clone();
    let heartbeat_app = app_handle.clone();

    tokio::spawn(async move {
        use tauri::Emitter;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .user_agent(concat!("pry/", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_default();
        let mut misses: u8 = 0;

        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    tracing::info!("sidecar: heartbeat loop shutting down");
                    return;
                }
                // 10s heartbeat interval (was 2s). The faster rate was causing
                // Python's asyncio event loop to get buried in
                // ConnectionResetError exception handlers every beat, starving
                // the SSE /load generator and hanging the frontend on
                // "Starting download…". 10s is still responsive enough to
                // detect a truly dead sidecar within 30s (3 misses × 10s).
                _ = tokio::time::sleep(Duration::from_secs(10)) => {
                    match client.get(&health_url).timeout(Duration::from_secs(5)).send().await {
                        Ok(resp) if resp.status().is_success() => {
                            misses = 0;
                        }
                        other => {
                            misses += 1;
                            tracing::warn!("sidecar heartbeat miss {misses}/3: {:?}", other.err());

                            if misses >= 3 {
                                // H2 fix: emit a crash event so the UI can react
                                // instead of the task dying silently. Also capture
                                // the stderr tail for the payload.
                                let snapshot: Vec<String> = {
                                    // M1: recover from poisoned mutex
                                    let buf = stderr_for_heartbeat
                                        .lock()
                                        .unwrap_or_else(|e| e.into_inner());
                                    buf.iter().rev().take(20).cloned().collect()
                                };
                                tracing::error!(
                                    "SIDECAR CRASHED — emitting sidecar:crashed event. \
                                    Last stderr tail:\n{}",
                                    snapshot.join("\n")
                                );
                                if let Some(app) = &heartbeat_app {
                                    let payload = serde_json::json!({
                                        "stderr_tail": snapshot,
                                        "reason": "3 consecutive health misses",
                                    });
                                    if let Err(e) = app.emit("sidecar:crashed", payload) {
                                        tracing::warn!("failed to emit sidecar:crashed: {e}");
                                    }
                                }
                                return;
                            }
                        }
                    }
                }
            }
        }
    });

    Ok(SidecarHandle {
        port,
        base_url,
        child: Some(child),
        #[cfg(target_os = "windows")]
        job: job_guard.map(|g| g.take()),
        shutdown_tx: Some(shutdown_tx),
        stderr_buffer,
    })
}
