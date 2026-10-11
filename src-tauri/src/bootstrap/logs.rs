//! Persisted bootstrap logs: `%LOCALAPPDATA%\Pry\logs\bootstrap-<UTC>.log`,
//! newest `KEEP_LOGS` kept. Every pip line / stage message goes here via
//! `Emitter::with_log`, so a failed install can be diagnosed after the fact.

use std::path::{Path, PathBuf};

pub const KEEP_LOGS: usize = 5;
const PREFIX: &str = "bootstrap-";
const SUFFIX: &str = ".log";

pub fn logs_dir() -> std::io::Result<PathBuf> {
    dirs::data_local_dir()
        .map(|d| d.join("Pry").join("logs"))
        .ok_or_else(|| std::io::Error::other("could not resolve local data dir"))
}

/// Create `logs\bootstrap-<UTC>.log` and prune older ones.
pub fn open_bootstrap_log() -> std::io::Result<(PathBuf, std::fs::File)> {
    open_log_in(&logs_dir()?, chrono::Utc::now(), KEEP_LOGS)
}

pub fn open_log_in(
    dir: &Path,
    now: chrono::DateTime<chrono::Utc>,
    keep: usize,
) -> std::io::Result<(PathBuf, std::fs::File)> {
    std::fs::create_dir_all(dir)?;
    let stamp = now.format("%Y%m%dT%H%M%SZ");
    let mut path = dir.join(format!("{PREFIX}{stamp}{SUFFIX}"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{PREFIX}{stamp}-{n}{SUFFIX}"));
        n += 1;
    }
    let file = std::fs::File::create(&path)?;
    prune(dir, keep);
    Ok((path, file))
}

/// Delete all but the newest `keep` bootstrap logs (names sort by UTC time).
/// Only touches files named `bootstrap-*.log`.
pub fn prune(dir: &Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut logs: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with(PREFIX) && n.ends_with(SUFFIX))
        })
        .collect();
    logs.sort();
    let excess = logs.len().saturating_sub(keep);
    for old in &logs[..excess] {
        if let Err(e) = std::fs::remove_file(old) {
            tracing::warn!("could not prune old bootstrap log {}: {e}", old.display());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn keeps_newest_five_and_ignores_other_files() {
        let dir = std::env::temp_dir().join(format!("pry-t3-logs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("crash-1.log"), b"x").unwrap();

        let mut paths = Vec::new();
        for minute in 0..7 {
            let now = chrono::Utc.with_ymd_and_hms(2026, 10, 12, 15, minute, 0).unwrap();
            let (p, _f) = open_log_in(&dir, now, KEEP_LOGS).unwrap();
            paths.push(p);
        }
        let mut left: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(left.len(), 6, "{left:?}");
        assert!(left.contains(&"crash-1.log".to_string()));
        assert!(!paths[0].exists() && !paths[1].exists());
        assert!(paths[6].exists());
        assert_eq!(
            paths[6].file_name().unwrap().to_str().unwrap(),
            "bootstrap-20261012T150600Z.log"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
