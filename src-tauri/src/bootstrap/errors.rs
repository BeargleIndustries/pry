use thiserror::Error;

#[derive(Debug, Error, serde::Serialize)]
#[serde(tag = "kind", content = "detail")]
pub enum BootstrapError {
    #[error("download failed: {0}")]
    Download(String),

    #[error("extraction failed: {0}")]
    Extract(String),

    #[error("venv creation failed: {0}")]
    Venv(String),

    #[error("pip install failed: {0}")]
    PipInstall(String),

    #[error("disk space insufficient: {needed_mb}MB required, {available_mb}MB available")]
    DiskSpaceInsufficient { needed_mb: u64, available_mb: u64 },

    #[error("checksum mismatch: expected {expected}, got {actual}")]
    ChecksumMismatch { expected: String, actual: String },

    #[error("antivirus interference detected: {0}")]
    Antivirus(String),

    #[error("io error: {0}")]
    Io(String),

    #[error("internal: {0}")]
    Internal(String),
}
