//! Application-level error type for Tauri commands.
//!
//! Single flat enum; do NOT split into domain-specific enums until
//! the command surface grows beyond ~10 commands. Per architect
//! recommendation in ralplan iteration 2 of code-review-cleanup.

use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "detail")]
pub enum AppError {
    #[error("sidecar: {0}")]
    Sidecar(String),

    #[error("hardware: {0}")]
    Hardware(String),

    #[error("presets: {0}")]
    Presets(String),

    #[error("io: {0}")]
    Io(String),
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(format!("{e:#}"))
    }
}

// M7 fix: `From<anyhow::Error>` removed. All anyhow conversions at Tauri
// command boundaries must now use an explicit `.map_err(|e| AppError::<Kind>(..))`
// so the error kind is accurate in the UI. The io::Error and serde_json::Error
// impls below still cover the common `?`-through-std paths.

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Presets(format!("{e:#}"))
    }
}
