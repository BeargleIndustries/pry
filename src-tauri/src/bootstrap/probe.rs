use super::events::*;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use tokio::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CudaVariant {
    Cu124,
    Cpu,
}

impl CudaVariant {
    pub fn wheel_tag(&self) -> &'static str {
        match self {
            Self::Cu124 => "cu124 (NVIDIA GPU)",
            Self::Cpu => "cpu (no GPU / fallback)",
        }
    }

    pub fn pip_index_url(&self) -> &'static str {
        match self {
            Self::Cu124 => "https://download.pytorch.org/whl/cu124",
            Self::Cpu => "https://download.pytorch.org/whl/cpu",
        }
    }

    pub fn torch_spec(&self) -> &'static str {
        // The pytorch.org wheel index encodes the CUDA variant in the wheel URL,
        // not in the package version string. pip_index_url() already points to
        // the correct index, so the plain version works for both variants.
        match self {
            Self::Cu124 => "torch==2.5.1",
            Self::Cpu => "torch==2.5.1",
        }
    }
}

fn find_nvidia_smi() -> Option<PathBuf> {
    if let Ok(p) = which::which("nvidia-smi") {
        return Some(p);
    }
    let candidates = [
        r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe",
        r"C:\Windows\System32\nvidia-smi.exe",
    ];
    for c in candidates {
        let p = std::path::Path::new(c);
        if p.exists() {
            return Some(p.to_path_buf());
        }
    }
    None
}

pub async fn cuda_variant(emit: &Emitter) -> CudaVariant {
    let Some(smi) = find_nvidia_smi() else {
        emit.log("nvidia-smi not found — selecting CPU wheel");
        return CudaVariant::Cpu;
    };

    let output = Command::new(&smi)
        .args(["--query-gpu=driver_version", "--format=csv,noheader"])
        .creation_flags(0x08000000)
        .output()
        .await;

    match output {
        Ok(out) if out.status.success() => {
            let driver = String::from_utf8_lossy(&out.stdout).trim().to_string();
            emit.log(format!(
                "detected NVIDIA driver {driver} — selecting cu124 wheel"
            ));
            CudaVariant::Cu124
        }
        _ => {
            emit.log("nvidia-smi present but query failed — falling back to CPU wheel");
            CudaVariant::Cpu
        }
    }
}
