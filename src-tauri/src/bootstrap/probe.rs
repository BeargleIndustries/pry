use super::events::*;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use tokio::process::Command;

pub const TORCH_VERSION: &str = "2.5.1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CudaVariant {
    Cu124,
    Cpu,
}

impl CudaVariant {
    /// Stable id used in venv folder names and `runtime.json.variant`.
    pub fn id(&self) -> &'static str {
        match self {
            Self::Cu124 => "cu124",
            Self::Cpu => "cpu",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "cu124" => Some(Self::Cu124),
            "cpu" => Some(Self::Cpu),
            _ => None,
        }
    }

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

    /// The `torch-*.dist-info` folder a correct install of this variant leaves
    /// in site-packages (the pytorch.org Windows wheels carry a local tag).
    /// Recorded in `runtime.json.expected_torch_dist_info` at build time.
    pub fn expected_torch_dist_info(&self) -> String {
        format!("torch-{TORCH_VERSION}+{}.dist-info", self.id())
    }

    pub fn torch_spec(&self) -> &'static str {
        // Pin the local version tag explicitly. A plain `torch==2.5.1` also
        // matches the untagged PyPI wheel, which is a CPU build on Windows
        // (T3a replay: experiments/2026-10-11-torch-swap). Keep in sync with
        // TORCH_VERSION and the constraints files.
        match self {
            Self::Cu124 => "torch==2.5.1+cu124",
            Self::Cpu => "torch==2.5.1+cpu",
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
    let (variant, msg) = detect_cuda_variant().await;
    emit.log(msg);
    variant
}

/// Same probe as `cuda_variant`, without emitting to the UI (used by the
/// background re-probe after startup).
pub async fn detect_cuda_variant() -> (CudaVariant, String) {
    let Some(smi) = find_nvidia_smi() else {
        return (CudaVariant::Cpu, "nvidia-smi not found — selecting CPU wheel".into());
    };

    let output = Command::new(&smi)
        .args(["--query-gpu=driver_version", "--format=csv,noheader"])
        .creation_flags(0x08000000)
        .output()
        .await;

    match output {
        Ok(out) if out.status.success() => {
            let driver = String::from_utf8_lossy(&out.stdout).trim().to_string();
            (
                CudaVariant::Cu124,
                format!("detected NVIDIA driver {driver} — selecting cu124 wheel"),
            )
        }
        _ => (
            CudaVariant::Cpu,
            "nvidia-smi present but query failed — falling back to CPU wheel".into(),
        ),
    }
}
