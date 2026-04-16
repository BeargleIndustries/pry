use serde::Serialize;
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

pub struct Emitter {
    handle: AppHandle,
}

impl Emitter {
    pub fn new(handle: AppHandle) -> Self {
        Self { handle }
    }

    pub fn handle_clone(&self) -> AppHandle {
        self.handle.clone()
    }

    pub fn stage(&self, stage: BootstrapStage, msg: impl Into<String>) {
        let _ = self.handle.emit(
            "bootstrap:progress",
            BootstrapEvent {
                stage,
                message: msg.into(),
                progress: -1.0,
                bytes_downloaded: None,
                bytes_total: None,
            },
        );
    }

    pub fn progress(&self, stage: BootstrapStage, msg: impl Into<String>, pct: f32) {
        let _ = self.handle.emit(
            "bootstrap:progress",
            BootstrapEvent {
                stage,
                message: msg.into(),
                progress: pct,
                bytes_downloaded: None,
                bytes_total: None,
            },
        );
    }

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
        let _ = self.handle.emit("bootstrap:log", line.into());
    }
}
