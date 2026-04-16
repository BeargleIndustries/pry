use super::{errors::BootstrapError, events::*};
use futures_util::StreamExt;
use std::path::Path;
use tokio::io::AsyncWriteExt;

// Pinned python-build-standalone release.
// https://github.com/astral-sh/python-build-standalone/releases
// Decision: using 3.12.7+20250918 (install_only Windows MSVC build). If the
// exact release no longer exists at build/ship time, update these three
// constants to the newest `install_only-pc-windows-msvc` tarball.
const PBS_VERSION: &str = "3.12.13";
#[allow(dead_code)]
const PBS_RELEASE_TAG: &str = "20260408";
const PBS_ARCHIVE: &str = "cpython-3.12.13+20260408-x86_64-pc-windows-msvc-install_only.tar.gz";
const PBS_URL: &str = "https://github.com/astral-sh/python-build-standalone/releases/download/20260408/cpython-3.12.13%2B20260408-x86_64-pc-windows-msvc-install_only.tar.gz";
// SHA256 of the pinned python-build-standalone tarball (M2 fix).
// Verified: sha256(cpython-3.12.13+20260408-x86_64-pc-windows-msvc-install_only.tar.gz)
const PBS_SHA256: &str = "99bbc3828c25409e747de9a491616685d17b855ae359d0fbf6ab51d2b4cd7e61";

pub async fn download_and_extract(
    emit: &Emitter,
    runtime_dir: &Path,
) -> Result<(), BootstrapError> {
    emit.stage(
        BootstrapStage::DownloadingPbs,
        format!("downloading Python {} ({})...", PBS_VERSION, PBS_ARCHIVE),
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .user_agent(concat!("pry/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| BootstrapError::Download(e.to_string()))?;

    let resp = client
        .get(PBS_URL)
        .send()
        .await
        .map_err(|e| BootstrapError::Download(e.to_string()))?;

    if !resp.status().is_success() {
        return Err(BootstrapError::Download(format!("HTTP {}", resp.status())));
    }

    let total = resp.content_length().unwrap_or(0);
    let tmp_path = runtime_dir.join("pbs.tar.gz");
    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| BootstrapError::Io(e.to_string()))?;

    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| BootstrapError::Download(e.to_string()))?;
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|e| BootstrapError::Io(e.to_string()))?;
        downloaded += chunk.len() as u64;
        let pct = if total > 0 { downloaded as f64 / total as f64 } else { -1.0 };
        let _ = pct; // used by emit impl if it computes progress fraction
        emit.bytes(
            BootstrapStage::DownloadingPbs,
            if total > 0 {
                format!(
                    "{:.1}MB / {:.1}MB",
                    downloaded as f64 / 1_000_000.0,
                    total as f64 / 1_000_000.0
                )
            } else {
                format!("{:.1}MB (size unknown)", downloaded as f64 / 1_000_000.0)
            },
            downloaded,
            total,
        );
    }
    file.flush()
        .await
        .map_err(|e| BootstrapError::Io(e.to_string()))?;
    drop(file);

    let actual = format!("{:x}", hasher.finalize());
    if actual != PBS_SHA256 {
        return Err(BootstrapError::ChecksumMismatch {
            expected: PBS_SHA256.to_string(),
            actual,
        });
    }

    // Extract tar.gz on a blocking thread (tar crate is sync).
    emit.stage(BootstrapStage::ExtractingPbs, "extracting Python runtime...");
    let tmp_path_clone = tmp_path.clone();
    let runtime_dir_clone = runtime_dir.to_path_buf();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let file = std::fs::File::open(&tmp_path_clone).map_err(|e| e.to_string())?;
        let gz = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(gz);
        archive.unpack(&runtime_dir_clone).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| BootstrapError::Extract(e.to_string()))?
    .map_err(BootstrapError::Extract)?;

    // python-build-standalone extracts into a `python/` subdirectory — move its
    // contents up one level so `runtime_dir/python.exe` is the canonical path.
    let py_subdir = runtime_dir.join("python");
    if py_subdir.exists() {
        let mut entries = tokio::fs::read_dir(&py_subdir)
            .await
            .map_err(|e| BootstrapError::Io(e.to_string()))?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| BootstrapError::Io(e.to_string()))?
        {
            let src = entry.path();
            let dst = runtime_dir.join(entry.file_name());
            tokio::fs::rename(&src, &dst)
                .await
                .map_err(|e| BootstrapError::Io(format!("move {}: {}", src.display(), e)))?;
        }
        let _ = tokio::fs::remove_dir_all(&py_subdir).await;
    }

    let _ = tokio::fs::remove_file(&tmp_path).await;

    emit.progress(BootstrapStage::ExtractingPbs, "python runtime ready", 1.0);
    Ok(())
}
