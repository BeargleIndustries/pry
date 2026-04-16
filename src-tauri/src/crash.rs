//! Crash logging with path/username sanitization and clipboard export.
//! No network telemetry — logs live only on the user's machine and can be
//! manually shared via the Settings screen's "Copy diagnostic" button.

use std::path::PathBuf;
use std::sync::Mutex;
use std::collections::VecDeque;
use once_cell::sync::Lazy;
use chrono::Utc;
use regex::Regex;

const MAX_LOG_BYTES: usize = 1024 * 1024; // 1MB per log file
const MAX_LOG_FILES: usize = 10;          // keep last 10 crash logs
const MAX_BUFFER_LINES: usize = 500;      // in-memory tail for diagnostic export

static IN_MEMORY_TAIL: Lazy<Mutex<VecDeque<String>>> = Lazy::new(|| {
    Mutex::new(VecDeque::with_capacity(MAX_BUFFER_LINES))
});

// Compiled once at first use — avoids recompilation on every sanitize() call.
static HF_TOKEN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"hf_[a-zA-Z0-9]{20,}").expect("HF_TOKEN_RE is valid")
});
static BEARER_TOKEN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"Bearer\s+[a-zA-Z0-9._~+/=\-]{20,}").expect("BEARER_TOKEN_RE is valid")
});

pub fn logs_dir() -> anyhow::Result<PathBuf> {
    // data_local_dir (%LOCALAPPDATA%) — see bootstrap::runtime_dir for rationale.
    let base = dirs::data_local_dir()
        .ok_or_else(|| anyhow::anyhow!("could not resolve local data dir"))?;
    let dir = base.join("Pry").join("logs");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn record_line(line: impl Into<String>) {
    let line = line.into();
    // Recover from poisoned mutex (e.g. a panic in another thread while holding
    // the lock) so the log tail survives crash cascades — consistent with how
    // bootstrap/pip.rs handles its stderr tail mutex.
    let mut buf = IN_MEMORY_TAIL.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    buf.push_back(line);
    while buf.len() > MAX_BUFFER_LINES {
        buf.pop_front();
    }
}

pub fn record_crash(context: &str, detail: &str) -> anyhow::Result<PathBuf> {
    let dir = logs_dir()?;
    let filename = format!("crash-{}.log", Utc::now().format("%Y%m%d-%H%M%S"));
    let path = dir.join(filename);

    let mut content = String::new();
    content.push_str(&format!("[Pry crash report — {}]\n", Utc::now().to_rfc3339()));
    content.push_str(&format!("Context: {context}\n\n"));
    content.push_str("=== OS ===\n");
    content.push_str(&format!("{}\n\n", os_info::get()));
    content.push_str("=== Detail ===\n");
    content.push_str(detail);
    content.push_str("\n\n=== Log tail (last 500 lines) ===\n");
    {
        let buf = IN_MEMORY_TAIL.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        for line in buf.iter() {
            content.push_str(line);
            content.push('\n');
        }
    }

    let sanitized = sanitize(&content);
    let capped = if sanitized.len() > MAX_LOG_BYTES {
        format!("{}\n[... truncated at {} bytes ...]", &sanitized[..MAX_LOG_BYTES], MAX_LOG_BYTES)
    } else {
        sanitized
    };

    std::fs::write(&path, capped)?;
    rotate_old_logs(&dir)?;
    Ok(path)
}

/// Strip username from paths and other identifying tokens.
fn sanitize(input: &str) -> String {
    let mut out = input.to_string();

    // Username from environment
    if let Ok(username) = std::env::var("USERNAME") {
        if !username.is_empty() && username.len() > 2 {
            out = out.replace(&username, "<user>");
        }
    }

    // Common profile paths
    if let Ok(profile) = std::env::var("USERPROFILE") {
        out = out.replace(&profile, "<profile>");
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        out = out.replace(&appdata, "<appdata>");
    }
    if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
        out = out.replace(&localappdata, "<localappdata>");
    }

    // HuggingFace tokens look like "hf_" followed by alphanumerics
    out = HF_TOKEN_RE.replace_all(&out, "<hf_token>").to_string();

    // Bearer tokens
    out = BEARER_TOKEN_RE.replace_all(&out, "Bearer <token>").to_string();

    out
}

fn rotate_old_logs(dir: &std::path::Path) -> anyhow::Result<()> {
    let mut entries: Vec<_> = std::fs::read_dir(dir)?
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().starts_with("crash-"))
        .collect();
    entries.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
    while entries.len() > MAX_LOG_FILES {
        let oldest = entries.remove(0);
        let _ = std::fs::remove_file(oldest.path());
    }
    Ok(())
}

/// Get the in-memory log tail as a single sanitized string, for the Copy Diagnostic button.
pub fn diagnostic_snapshot() -> String {
    let mut content = String::new();
    content.push_str(&format!("[Pry diagnostic — {}]\n", Utc::now().to_rfc3339()));
    content.push_str(&format!("OS: {}\n\n", os_info::get()));
    content.push_str("=== Log tail ===\n");
    {
        let buf = IN_MEMORY_TAIL.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        for line in buf.iter() {
            content.push_str(line);
            content.push('\n');
        }
    }
    sanitize(&content)
}

#[tauri::command]
pub fn copy_diagnostic() -> Result<String, String> {
    Ok(diagnostic_snapshot())
}

#[tauri::command]
pub fn list_crash_logs() -> Result<Vec<String>, String> {
    let dir = logs_dir().map_err(|e| e.to_string())?;
    let mut entries: Vec<_> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().starts_with("crash-"))
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    entries.sort();
    entries.reverse(); // newest first
    Ok(entries)
}
