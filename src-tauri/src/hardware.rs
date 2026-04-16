//! hardware.rs — Phase 5a full hardware probe
//!
//! Probe order:
//!   1. NVML (nvidia-only, live VRAM usage, exact CUDA driver version)
//!   2. DXGI (Windows, all vendors, driver-reported VRAM, no live usage)
//!   3. CPU-only fallback (no GPU detected)
//!
//! Windows note: nvml-wrapper calls nvmlInit_v2 which loads nvml.dll at runtime.
//! If the DLL is not in PATH (common on fresh Windows installs without NVIDIA
//! driver, or if only CUDA toolkit is installed without the display driver), init
//! will fail with NvmlError::DriverNotLoaded. This is expected and handled by
//! falling through to the DXGI path.
//!
//! Why DXGI over wgpu-hal for cross-vendor fallback:
//!   - wgpu-hal requires unsafe + reaching into backend-specific adapter types
//!   - DXGI is a stable Win32 API available on all Windows 8+ systems
//!   - DXGI_ADAPTER_DESC1.DedicatedVideoMemory matches Device Manager and is
//!     accurate for NVIDIA, AMD, and Intel Arc discrete GPUs
//!   - wgpu's public surface (adapter.limits()) does NOT expose VRAM at all;
//!     max_buffer_size is a buffer limit, not VRAM
//!
//! TODO(v2): multi-GPU support — currently picks device 0 from NVML and the
//! adapter with the most DedicatedVideoMemory from DXGI. Add device-selection
//! API when needed.

use anyhow::Context;
use serde::{Deserialize, Serialize};

// ── Public types ──────────────────────────────────────────────────────────────

// KEEP IN SYNC: ui/src/lib/tauri.ts::VramSource
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VramSource {
    /// Live reading from NVML — accurate to within a few MB
    Nvml,
    /// Driver-reported static value from DXGI — accurate but not live usage
    Dxgi,
    /// No GPU detected; VRAM is 0
    None,
}

// KEEP IN SYNC: ui/src/lib/tauri.ts::HardwareReport
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareReport {
    // ── Original surface (DO NOT RENAME/RETYPE) ───────────────────────────
    pub gpu_name: String,
    pub vram_total_mb: u64,
    pub vram_used_mb: Option<u64>,
    pub vendor: String,
    pub cuda_driver: Option<String>,

    // ── Extended fields (Phase 5a additions) ─────────────────────────────
    /// Where the VRAM number came from
    pub vram_source: VramSource,
    /// Which probe backend succeeded: "nvml" | "dxgi" | "cpu"
    pub backend: String,
    /// Display driver version string (e.g. "552.44") when available
    pub driver_version: Option<String>,
    /// Non-fatal warnings surfaced to the UI
    pub probe_warnings: Vec<String>,
    /// ISO-8601 timestamp of when the probe ran
    pub probed_at: String,
    /// OS description (e.g. "windows 11")
    pub os: String,
}

// ── Entry point ───────────────────────────────────────────────────────────────

/// Run the hardware probe and return a HardwareReport.
/// Never returns Err — errors are folded into the cpu-only fallback.
pub fn probe() -> anyhow::Result<HardwareReport> {
    let now = chrono::Utc::now().to_rfc3339();
    let os = detect_os();

    // Path 1: NVML (NVIDIA only, Windows + Linux)
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        match probe_nvml(&now, &os) {
            Ok(report) => return Ok(report),
            Err(e) => tracing::debug!("NVML probe failed (expected on non-NVIDIA): {e}"),
        }
    }

    // Path 2: DXGI (Windows, all vendors)
    #[cfg(target_os = "windows")]
    {
        match probe_dxgi(&now, &os) {
            Ok(report) => return Ok(report),
            Err(e) => tracing::debug!("DXGI probe failed: {e}"),
        }
    }

    // Path 3: CPU-only fallback
    Ok(cpu_only_report(now, os))
}

// ── NVML path ─────────────────────────────────────────────────────────────────

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn probe_nvml(now: &str, os: &str) -> anyhow::Result<HardwareReport> {
    use nvml_wrapper::Nvml;

    let nvml = Nvml::init().context("nvml init")?;

    // TODO(v2): iterate all devices for multi-GPU support
    let device = nvml.device_by_index(0).context("no NVML device at index 0")?;

    let gpu_name = device.name().context("device name")?;
    let mem = device.memory_info().context("memory info")?;
    let vram_total_mb = mem.total / (1024 * 1024);
    let vram_used_mb = mem.used / (1024 * 1024);

    // Compute capability is informational only — not in the report
    if let Ok(cc) = device.cuda_compute_capability() {
        tracing::info!("CUDA compute capability: {}.{}", cc.major, cc.minor);
    }

    // CUDA driver version: integer like 12040 → "12.4"
    let cuda_driver = nvml
        .sys_cuda_driver_version()
        .ok()
        .map(|v| format!("{}.{}", v / 1000, (v % 1000) / 10));

    // Display driver version string (e.g. "552.44")
    let driver_version = nvml.sys_driver_version().ok();

    Ok(HardwareReport {
        gpu_name,
        vram_total_mb,
        vram_used_mb: Some(vram_used_mb),
        vendor: "nvidia".into(),
        cuda_driver,
        vram_source: VramSource::Nvml,
        backend: "nvml".into(),
        driver_version,
        probe_warnings: vec![],
        probed_at: now.to_string(),
        os: os.to_string(),
    })
}

// ── DXGI path (Windows, cross-vendor) ────────────────────────────────────────

#[cfg(target_os = "windows")]
fn probe_dxgi(now: &str, os: &str) -> anyhow::Result<HardwareReport> {
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
    };

    // SAFETY: DXGI COM calls are safe to invoke from any thread after CoInitialize
    // (Tauri initialises COM for us). All pointers come from Windows APIs and are
    // valid for the duration of this function.
    unsafe {
        let factory: IDXGIFactory1 =
            CreateDXGIFactory1().context("CreateDXGIFactory1 failed")?;

        let mut best: Option<windows::Win32::Graphics::Dxgi::DXGI_ADAPTER_DESC1> = None;

        let mut i = 0u32;
        loop {
            let adapter = match factory.EnumAdapters1(i) {
                Ok(a) => a,
                Err(_) => break, // DXGI_ERROR_NOT_FOUND — end of adapter list
            };
            i += 1;

            let desc = match adapter.GetDesc1() {
                Ok(d) => d,
                Err(_) => continue,
            };

            // Skip software/WARP renderers
            if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
                continue;
            }

            // Prefer adapter with most dedicated VRAM (discrete GPU heuristic)
            if best.is_none()
                || desc.DedicatedVideoMemory > best.as_ref().unwrap().DedicatedVideoMemory
            {
                best = Some(desc);
            }
        }

        let desc = best.context("no suitable DXGI adapter found")?;

        // Decode GPU name from UTF-16 wide string
        let name_end = desc
            .Description
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(desc.Description.len());
        let gpu_name = String::from_utf16_lossy(&desc.Description[..name_end])
            .trim()
            .to_string();

        let vram_total_mb = (desc.DedicatedVideoMemory / (1024 * 1024)) as u64;

        // PCI vendor ID → string
        let vendor = match desc.VendorId {
            0x10DE => "nvidia",
            0x1002 => "amd",
            0x8086 => "intel",
            _ => "unknown",
        }
        .to_string();

        let warnings = vec![format!(
            "VRAM ({vram_total_mb} MB) is reported-by-driver via DXGI, not a live usage \
             reading. Actual available VRAM may differ. For live usage, an NVIDIA GPU with \
             driver installed is required."
        )];

        Ok(HardwareReport {
            gpu_name,
            vram_total_mb,
            vram_used_mb: None, // DXGI has no live usage API
            vendor,
            cuda_driver: None,  // NVML failed so CUDA driver version is unknown
            vram_source: VramSource::Dxgi,
            backend: "dxgi".into(),
            driver_version: None,
            probe_warnings: warnings,
            probed_at: now.to_string(),
            os: os.to_string(),
        })
    }
}

// ── CPU-only fallback ─────────────────────────────────────────────────────────

fn cpu_only_report(now: String, os: String) -> HardwareReport {
    HardwareReport {
        gpu_name: "none".into(),
        vram_total_mb: 0,
        vram_used_mb: None,
        vendor: "cpu".into(),
        cuda_driver: None,
        vram_source: VramSource::None,
        backend: "cpu".into(),
        driver_version: None,
        probe_warnings: vec![
            "No GPU detected. Generation will run on CPU and will be slow.".into(),
        ],
        probed_at: now,
        os,
    }
}

// ── OS detection ─────────────────────────────────────────────────────────────

fn detect_os() -> String {
    // H5/L3 fix: use os_info crate instead of shelling out to `cmd /C ver`.
    // The subprocess call was costing 50-300ms per hardware probe and losing
    // version info on the fallback path. os_info::get() is a single syscall
    // and works consistently across Windows/Linux/macOS.
    os_info::get().to_string()
}
