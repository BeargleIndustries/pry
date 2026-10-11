use serde::Serialize;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter as _};

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BootstrapStage {
    Probing,
    Cleaning,
    DownloadingPbs,
    ExtractingPbs,
    CreatingVenv,
    InstallingTorch,
    InstallingTransformerLens,
    InstallingSaeLens,
    InstallingExtras,
    Ready,
}

#[derive(Debug, Clone, Serialize)]
pub struct BootstrapEvent {
    pub stage: BootstrapStage,
    pub message: String,
    pub progress: f32, // 0.0-1.0, -1.0 for indeterminate
    pub bytes_downloaded: Option<u64>,
    pub bytes_total: Option<u64>,
}

/// Emits bootstrap events to the webview and, when built `with_log`, tees
/// every stage/progress/log line to the persisted bootstrap log file.
#[derive(Clone)]
pub struct Emitter {
    handle: AppHandle,
    log_file: Option<Arc<Mutex<std::fs::File>>>,
    log_path: Option<PathBuf>,
}

impl Emitter {
    pub fn new(handle: AppHandle) -> Self {
        Self { handle, log_file: None, log_path: None }
    }

    /// Emitter that also writes to a new `logs\bootstrap-<UTC>.log` (keeping
    /// the newest few). Falls back to events-only if the log can't be opened.
    pub fn with_log(handle: AppHandle) -> Self {
        match super::logs::open_bootstrap_log() {
            Ok((path, file)) => Self {
                handle,
                log_file: Some(Arc::new(Mutex::new(file))),
                log_path: Some(path),
            },
            Err(e) => {
                tracing::warn!("could not open bootstrap log: {e}");
                Self::new(handle)
            }
        }
    }

    pub fn log_path(&self) -> Option<&Path> {
        self.log_path.as_deref()
    }

    fn tee(&self, line: &str) {
        if let Some(f) = &self.log_file {
            let mut f = f.lock().unwrap_or_else(|e| e.into_inner());
            let _ = writeln!(f, "{} {line}", chrono::Utc::now().format("%H:%M:%S"));
        }
    }

    pub fn stage(&self, stage: BootstrapStage, msg: impl Into<String>) {
        let message = msg.into();
        self.tee(&format!("[{stage:?}] {message}"));
        let _ = self.handle.emit(
            "bootstrap:progress",
            BootstrapEvent {
                stage,
                message,
                progress: -1.0,
                bytes_downloaded: None,
                bytes_total: None,
            },
        );
    }

    pub fn progress(&self, stage: BootstrapStage, msg: impl Into<String>, pct: f32) {
        let message = msg.into();
        self.tee(&format!("[{stage:?}] {message} ({:.0}%)", pct * 100.0));
        let _ = self.handle.emit(
            "bootstrap:progress",
            BootstrapEvent {
                stage,
                message,
                progress: pct,
                bytes_downloaded: None,
                bytes_total: None,
            },
        );
    }

    /// Byte-level download ticks go to the UI only (too chatty for the log).
    pub fn bytes(
        &self,
        stage: BootstrapStage,
        msg: impl Into<String>,
        downloaded: u64,
        total: u64,
    ) {
        let pct = if total > 0 {
            downloaded as f32 / total as f32
        } else {
            -1.0
        };
        let _ = self.handle.emit(
            "bootstrap:progress",
            BootstrapEvent {
                stage,
                message: msg.into(),
                progress: pct,
                bytes_downloaded: Some(downloaded),
                bytes_total: Some(total),
            },
        );
    }

    pub fn log(&self, line: impl Into<String>) {
        let line = line.into();
        self.tee(&line);
        let _ = self.handle.emit("bootstrap:log", line);
    }
}
