use super::events::*;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use tokio::process::Command;

/// Minimum Windows NVIDIA driver for each CUDA runtime the torch wheels bundle.
/// Source: CUDA 12.8 Update 1 release notes, Table 3 ("CUDA Toolkit and
/// Corresponding Driver Versions"), https://docs.nvidia.com/cuda/archive/12.8.1/cuda-toolkit-release-notes/index.html
/// CUDA 12.8 GA >= 572.30, CUDA 12.4 GA >= 551.61 (Windows).
pub const MIN_DRIVER_CU128: (u32, u32) = (572, 30);
pub const MIN_DRIVER_CU124: (u32, u32) = (551, 61);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CudaVariant {
    /// torch 2.7.1, CUDA 12.8: the default for NVIDIA GPUs, and the only one
    /// with kernels for Blackwell (RTX 50xx, compute capability 12.x).
    Cu128,
    /// torch 2.5.1, CUDA 12.4: legacy, for drivers 551.61..572.30 and for
    /// installs made before 0.2.0 (kept so they don't re-download).
    Cu124,
    /// torch 2.7.1 CPU build.
    Cpu,
}

impl CudaVariant {
    /// Stable id used in venv folder names and `runtime.json.variant`.
    pub fn id(&self) -> &'static str {
        match self {
            Self::Cu128 => "cu128",
            Self::Cu124 => "cu124",
            Self::Cpu => "cpu",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "cu128" => Some(Self::Cu128),
            "cu124" => Some(Self::Cu124),
            "cpu" => Some(Self::Cpu),
            _ => None,
        }
    }

    pub fn is_gpu(&self) -> bool {
        !matches!(self, Self::Cpu)
    }

    pub fn wheel_tag(&self) -> &'static str {
        match self {
            Self::Cu128 => "cu128 (NVIDIA GPU)",
            Self::Cu124 => "cu124 (NVIDIA GPU, older driver)",
            Self::Cpu => "cpu (no GPU / fallback)",
        }
    }

    pub fn pip_index_url(&self) -> &'static str {
        match self {
            Self::Cu128 => "https://download.pytorch.org/whl/cu128",
            Self::Cu124 => "https://download.pytorch.org/whl/cu124",
            Self::Cpu => "https://download.pytorch.org/whl/cpu",
        }
    }

    /// Public torch version for this variant. Keep in sync with the
    /// constraints files (sidecar/tests/test_constraints.py checks them).
    pub fn torch_version(&self) -> &'static str {
        match self {
            Self::Cu124 => "2.5.1",
            Self::Cu128 | Self::Cpu => "2.7.1",
        }
    }

    /// The `torch-*.dist-info` folder a correct install of this variant leaves
    /// in site-packages (the pytorch.org Windows wheels carry a local tag).
    /// Recorded in `runtime.json.expected_torch_dist_info` at build time.
    pub fn expected_torch_dist_info(&self) -> String {
        format!("torch-{}+{}.dist-info", self.torch_version(), self.id())
    }

    /// Pin the local version tag explicitly. A plain `torch==X` also matches
    /// the untagged PyPI wheel, which is a CPU build on Windows (T3a replay:
    /// experiments/2026-10-11-torch-swap).
    pub fn torch_spec(&self) -> String {
        format!("torch=={}+{}", self.torch_version(), self.id())
    }
}

/// What the GPU probe found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GpuProbe {
    /// The build a fresh install on this machine should use.
    pub variant: CudaVariant,
    /// A GPU needs CUDA >= 12.8 kernels (Blackwell, compute capability 12.x):
    /// a cu124 engine can't run on it, so existing cu124 installs must update.
    pub needs_cu128: bool,
}

impl GpuProbe {
    pub const CPU: Self = Self { variant: CudaVariant::Cpu, needs_cu128: false };
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

pub async fn cuda_variant(emit: &Emitter) -> GpuProbe {
    let (probe, msg) = detect_cuda_variant().await;
    emit.log(msg);
    probe
}

/// Same probe as `cuda_variant`, without emitting to the UI (used by the
/// background re-probe after startup).
pub async fn detect_cuda_variant() -> (GpuProbe, String) {
    let Some(smi) = find_nvidia_smi() else {
        return (GpuProbe::CPU, "nvidia-smi not found — selecting CPU wheel".into());
    };

    // compute_cap needs a recent nvidia-smi; fall back to the driver alone.
    let mut stdout = None;
    for query in ["--query-gpu=driver_version,compute_cap", "--query-gpu=driver_version"] {
        let out = Command::new(&smi)
            .args([query, "--format=csv,noheader"])
            .creation_flags(0x08000000)
            .output()
            .await;
        if let Ok(out) = out {
            if out.status.success() {
                stdout = Some(String::from_utf8_lossy(&out.stdout).into_owned());
                break;
            }
        }
    }
    match stdout {
        Some(s) => select_variant(&s),
        None => (
            GpuProbe::CPU,
            "nvidia-smi present but query failed — falling back to CPU wheel".into(),
        ),
    }
}

/// "617.14" -> (617, 14).
fn parse_driver(s: &str) -> Option<(u32, u32)> {
    let (major, minor) = s.trim().split_once('.')?;
    Some((major.parse().ok()?, minor.split('.').next()?.parse().ok()?))
}

/// Pick the build from `nvidia-smi` CSV rows (`driver[, compute_cap]`, one per GPU).
fn select_variant(csv: &str) -> (GpuProbe, String) {
    let rows: Vec<Vec<&str>> = csv
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.split(',').map(str::trim).collect())
        .collect();
    let Some(driver_str) = rows.first().and_then(|r| r.first()).copied() else {
        return (GpuProbe::CPU, "nvidia-smi listed no GPUs — selecting CPU wheel".into());
    };
    let needs_cu128 = rows.iter().any(|r| {
        r.get(1)
            .and_then(|cc| cc.split('.').next())
            .and_then(|major| major.parse::<u32>().ok())
            .is_some_and(|major| major >= 12)
    });
    let Some(driver) = parse_driver(driver_str) else {
        return (
            GpuProbe::CPU,
            format!("unreadable NVIDIA driver version {driver_str:?} — selecting CPU wheel"),
        );
    };
    let variant = if driver >= MIN_DRIVER_CU128 {
        CudaVariant::Cu128
    } else if driver >= MIN_DRIVER_CU124 && !needs_cu128 {
        CudaVariant::Cu124
    } else {
        return (
            GpuProbe::CPU,
            format!(
                "NVIDIA driver {driver_str} is too old for GPU support (needs {}.{} or newer) — \
                 selecting CPU wheel; update the driver to use the GPU",
                MIN_DRIVER_CU128.0, MIN_DRIVER_CU128.1
            ),
        );
    };
    (
        GpuProbe { variant, needs_cu128 },
        format!("detected NVIDIA driver {driver_str} — selecting {} wheel", variant.id()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pick(csv: &str) -> GpuProbe {
        select_variant(csv).0
    }

    #[test]
    fn new_driver_gets_cu128() {
        assert_eq!(pick("617.14, 8.9\n"), GpuProbe { variant: CudaVariant::Cu128, needs_cu128: false });
        assert_eq!(pick("572.30, 8.6"), GpuProbe { variant: CudaVariant::Cu128, needs_cu128: false });
    }

    #[test]
    fn older_driver_gets_cu124() {
        assert_eq!(pick("566.36, 8.9").variant, CudaVariant::Cu124);
        assert_eq!(pick("551.61").variant, CudaVariant::Cu124);
    }

    #[test]
    fn too_old_driver_gets_cpu() {
        assert_eq!(pick("537.58, 8.6"), GpuProbe::CPU);
    }

    #[test]
    fn blackwell_needs_cu128() {
        assert_eq!(pick("580.88, 12.0"), GpuProbe { variant: CudaVariant::Cu128, needs_cu128: true });
        // Any GPU in a multi-GPU box counts.
        assert!(pick("580.88, 8.9\n580.88, 12.0\n").needs_cu128);
    }

    #[test]
    fn unparseable_output_gets_cpu() {
        assert_eq!(pick(""), GpuProbe::CPU);
        assert_eq!(pick("N/A, 8.9"), GpuProbe::CPU);
    }

    #[test]
    fn torch_specs_carry_local_tags() {
        assert_eq!(CudaVariant::Cu128.torch_spec(), "torch==2.7.1+cu128");
        assert_eq!(CudaVariant::Cu124.torch_spec(), "torch==2.5.1+cu124");
        assert_eq!(CudaVariant::Cpu.torch_spec(), "torch==2.7.1+cpu");
        assert_eq!(CudaVariant::Cu128.expected_torch_dist_info(), "torch-2.7.1+cu128.dist-info");
    }
}
