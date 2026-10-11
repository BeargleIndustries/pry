//! presets_compat.rs — Preset compatibility math (Phase 5a)
//!
//! Cross-references hardware probe results against sidecar/presets.json to
//! tell the UI which presets will fit, which are tight, and which won't run.
//!
//! VRAM math (per plan §7 Phase 5a):
//!   usable_vram = total - 1500 MB (OS/driver overhead) - vram_used_mb (NVML only)
//!   headroom    = usable_vram - preset.vram_estimate_mb
//!
//! Verdict thresholds:
//!   headroom >= 2000 MB  → Comfortable
//!   0 <= headroom < 2000 → Tight
//!   headroom < 0         → Insufficient
//!
//! CPU fallback (T11): when there is no usable GPU (vendor "cpu", or the GPU
//! is too small for the preset), a preset marked `cpu_ok` in presets.json is
//! `CpuOk` if system RAM >= 2x its `vram_estimate_mb`. Disabled presets are
//! always Insufficient.

use serde::Serialize;
use std::path::Path;

use crate::hardware::HardwareReport;

// ── Public types ──────────────────────────────────────────────────────────────

// KEEP IN SYNC: ui/src/lib/tauri.ts::Verdict
// NOTE: no rename_all — serde emits PascalCase variant names ("Comfortable" /
// "Tight" / "CpuOk" / "Insufficient") which is what the frontend matches on.
// The earlier snake_case rename was a silent bug that made every preset
// render as ❌.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub enum Compatibility {
    /// Fits with >2 GB headroom
    Comfortable,
    /// Fits but <2 GB headroom — warn the user
    Tight,
    /// No usable GPU, but small enough to run on the CPU (slower)
    CpuOk,
    /// Does not fit
    Insufficient,
}

// KEEP IN SYNC: ui/src/lib/tauri.ts::PresetCompatibility
#[derive(Debug, Clone, Serialize)]
pub struct PresetCompatibility {
    pub preset_id: String,
    pub verdict: Compatibility,
    /// Positive = spare VRAM; negative = over budget
    pub headroom_mb: i64,
    pub notes: Vec<String>,
    /// Passthrough of the preset's presets.json `display` block (null if absent)
    pub display: serde_json::Value,
    pub enabled: bool,
}

/// Note shown on a `CpuOk` verdict.
pub const CPU_OK_NOTE: &str = "Works on your computer (slower).";

// ── Core evaluation ───────────────────────────────────────────────────────────

/// Evaluate a single preset against the hardware report.
///
/// # Parameters
/// - `preset_id`        — identifier from presets.json (e.g. "gpt2-small")
/// - `vram_estimate_mb` — from the preset's `vram_estimate_mb` field
/// - `license_gate`     — from `license_gate` (e.g. `Some("huggingface_gemma")`)
/// - `enabled`          — from `enabled` field (absent = true)
/// - `cpu_ok`           — from `cpu_ok` field (absent = false)
/// - `hw`               — the HardwareReport from the probe
///
/// `display` is left null here; `evaluate_all` fills it from presets.json.
pub fn evaluate_preset(
    preset_id: &str,
    vram_estimate_mb: u64,
    license_gate: Option<&str>,
    enabled: bool,
    cpu_ok: bool,
    hw: &HardwareReport,
) -> PresetCompatibility {
    let mut notes: Vec<String> = vec![];
    let result = |verdict, headroom_mb, notes| PresetCompatibility {
        preset_id: preset_id.to_string(),
        verdict,
        headroom_mb,
        notes,
        display: serde_json::Value::Null,
        enabled,
    };

    // Disabled preset (e.g. Gemma, locked until its model + SAE are validated)
    if !enabled {
        notes.push("Coming soon. This model isn't available in Pry yet.".into());
        return result(Compatibility::Insufficient, 0, notes);
    }

    // License gate annotation (does not block compatibility — UI shows lock icon)
    if let Some(gate) = license_gate {
        if gate == "huggingface_gemma" {
            notes.push(
                "Requires a free HuggingFace account and Gemma license acceptance.".into(),
            );
        }
    }

    // RAM check for the CPU fallback: RAM >= 2x the preset's estimate.
    let ram_ok = hw
        .system_ram_mb
        .is_some_and(|ram| ram >= vram_estimate_mb.saturating_mul(2));

    // CPU-only: no GPU at all
    if hw.vendor == "cpu" {
        let headroom_mb = -(vram_estimate_mb as i64);
        if cpu_ok && ram_ok {
            notes.push(CPU_OK_NOTE.into());
            return result(Compatibility::CpuOk, headroom_mb, notes);
        }
        notes.push(cpu_fallback_refusal(cpu_ok, vram_estimate_mb, hw));
        return result(Compatibility::Insufficient, headroom_mb, notes);
    }

    // VRAM math
    const OS_DRIVER_OVERHEAD_MB: u64 = 1500;
    let live_used = hw.vram_used_mb.unwrap_or(0);

    let usable_vram = hw
        .vram_total_mb
        .saturating_sub(OS_DRIVER_OVERHEAD_MB)
        .saturating_sub(live_used);

    let headroom_mb = usable_vram as i64 - vram_estimate_mb as i64;

    // Note if VRAM figure is driver-reported (not live)
    if hw.vram_used_mb.is_none() {
        notes.push(format!(
            "VRAM estimate uses driver-reported total ({} MB) without live usage data. \
             Actual headroom may be lower if other apps are using the GPU.",
            hw.vram_total_mb
        ));
    }

    let verdict = if headroom_mb >= 2000 {
        Compatibility::Comfortable
    } else if headroom_mb >= 0 {
        Compatibility::Tight
    } else if cpu_ok && ram_ok {
        // GPU too small for this preset: fall back to the CPU.
        notes.push(CPU_OK_NOTE.into());
        Compatibility::CpuOk
    } else {
        Compatibility::Insufficient
    };

    result(verdict, headroom_mb, notes)
}

/// Why a preset can't run on a machine without a usable GPU.
fn cpu_fallback_refusal(cpu_ok: bool, vram_estimate_mb: u64, hw: &HardwareReport) -> String {
    if !cpu_ok {
        return "GPU required. This model is too large to run on the CPU.".into();
    }
    match hw.system_ram_mb {
        Some(ram) => format!(
            "Not enough memory to run on the CPU: needs {} MB of RAM, this computer has {ram} MB.",
            vram_estimate_mb.saturating_mul(2)
        ),
        None => "Couldn't read this computer's memory size, so CPU mode isn't offered.".into(),
    }
}

// ── JSON loader ───────────────────────────────────────────────────────────────

/// Load and parse `sidecar/presets.json` from the given directory.
pub fn load_presets_json(sidecar_dir: &Path) -> anyhow::Result<serde_json::Value> {
    let path = sidecar_dir.join("presets.json");
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| anyhow::anyhow!("failed to read {}: {e}", path.display()))?;
    let val: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|e| anyhow::anyhow!("failed to parse presets.json: {e}"))?;
    Ok(val)
}

// ── Batch evaluation ──────────────────────────────────────────────────────────

/// Evaluate all presets in the parsed presets.json against the hardware report.
pub fn evaluate_all(hw: &HardwareReport, presets_json: &serde_json::Value) -> Vec<PresetCompatibility> {
    let presets = match presets_json.get("presets").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => return vec![],
    };

    presets
        .iter()
        .filter_map(|p| {
            let id = p.get("id")?.as_str()?;
            let vram_estimate_mb = p.get("vram_estimate_mb")?.as_u64()?;
            let license_gate = p.get("license_gate").and_then(|v| v.as_str());
            // `enabled` defaults to true if absent; `cpu_ok` to false
            let enabled = p.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
            let cpu_ok = p.get("cpu_ok").and_then(|v| v.as_bool()).unwrap_or(false);

            let mut compat =
                evaluate_preset(id, vram_estimate_mb, license_gate, enabled, cpu_ok, hw);
            compat.display = p.get("display").cloned().unwrap_or(serde_json::Value::Null);
            Some(compat)
        })
        .collect()
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::{HardwareReport, VramSource};

    /// Fake RTX 4070 Super: 12 288 MB total, 500 MB used (NVML live reading)
    fn fake_4070_super() -> HardwareReport {
        HardwareReport {
            gpu_name: "NVIDIA GeForce RTX 4070 SUPER".into(),
            vram_total_mb: 12288,
            vram_used_mb: Some(500),
            vendor: "nvidia".into(),
            cuda_driver: Some("12.4".into()),
            vram_source: VramSource::Nvml,
            backend: "nvml".into(),
            driver_version: Some("552.44".into()),
            probe_warnings: vec![],
            probed_at: "2026-04-13T00:00:00Z".into(),
            os: "windows".into(),
            system_ram_mb: Some(32768),
        }
    }

    /// CPU-only (no GPU)
    fn fake_cpu_only() -> HardwareReport {
        HardwareReport {
            gpu_name: "none".into(),
            vram_total_mb: 0,
            vram_used_mb: None,
            vendor: "cpu".into(),
            cuda_driver: None,
            vram_source: VramSource::None,
            backend: "cpu".into(),
            driver_version: None,
            probe_warnings: vec!["No GPU detected.".into()],
            probed_at: "2026-04-13T00:00:00Z".into(),
            os: "windows".into(),
            system_ram_mb: Some(32768),
        }
    }

    // usable = 12288 - 1500 - 500 = 10288 MB
    // headroom vs gpt2-small (1800 MB) = 10288 - 1800 = 8488 → Comfortable
    #[test]
    fn test_gpt2_small_comfortable() {
        let hw = fake_4070_super();
        let result = evaluate_preset("gpt2-small", 1800, None, true, false, &hw);
        assert_eq!(result.verdict, Compatibility::Comfortable);
        assert_eq!(result.headroom_mb, 8488);
    }

    // headroom vs a mid-size preset (6000 MB) = 10288 - 6000 = 4288 → Comfortable
    #[test]
    fn test_mid_size_preset_comfortable() {
        let hw = fake_4070_super();
        let result = evaluate_preset("mid-size-preset", 6000, None, true, false, &hw);
        assert_eq!(result.verdict, Compatibility::Comfortable);
        assert_eq!(result.headroom_mb, 4288);
    }

    // Gemma-2-2B: enabled=false → Insufficient regardless of VRAM
    #[test]
    fn test_gemma_2_2b_disabled_insufficient() {
        let hw = fake_4070_super();
        let result = evaluate_preset("gemma-2-2b", 8000, Some("huggingface_gemma"), false, false, &hw);
        assert_eq!(result.verdict, Compatibility::Insufficient);
        assert!(result.notes.iter().any(|n| n.contains("Coming soon")));
    }

    // If gemma-2-2b were enabled: usable=10288, estimate=8000, headroom=2288 → Comfortable
    #[test]
    fn test_gemma_2_2b_enabled_comfortable_hypothetical() {
        let hw = fake_4070_super();
        let result = evaluate_preset("gemma-2-2b", 8000, Some("huggingface_gemma"), true, false, &hw);
        assert_eq!(result.verdict, Compatibility::Comfortable);
        assert_eq!(result.headroom_mb, 2288);
        // License gate note is present
        assert!(result.notes.iter().any(|n| n.contains("HuggingFace")));
    }

    // Gemma-2-9B: usable=10288, estimate=18000, headroom=-7712 → Insufficient
    #[test]
    fn test_gemma_2_9b_insufficient() {
        let hw = fake_4070_super();
        let result = evaluate_preset("gemma-2-9b", 18000, Some("huggingface_gemma"), true, false, &hw);
        assert_eq!(result.verdict, Compatibility::Insufficient);
        assert!(result.headroom_mb < 0);
    }

    // CPU-only: small cpu_ok presets run on the CPU; large ones are Insufficient
    #[test]
    fn test_cpu_only_small_presets_cpu_ok() {
        let hw = fake_cpu_only(); // 32 GB RAM
        for (id, vram) in [("gpt2-small", 1800u64), ("pythia-70m", 1200)] {
            let result = evaluate_preset(id, vram, None, true, true, &hw);
            assert_eq!(result.verdict, Compatibility::CpuOk, "{id} should be CpuOk on CPU-only");
            assert!(result.notes.iter().any(|n| n == CPU_OK_NOTE));
            assert!(result.enabled);
        }
        let big = evaluate_preset("gemma-2-9b", 18000, None, true, false, &hw);
        assert_eq!(big.verdict, Compatibility::Insufficient);
        assert!(big.notes.iter().any(|n| n.contains("GPU required")));
    }

    // RAM must be >= 2x the estimate: 3000 MB RAM < 2 * 1800 → Insufficient
    #[test]
    fn test_cpu_only_ram_too_low_insufficient() {
        let mut hw = fake_cpu_only();
        hw.system_ram_mb = Some(3000);
        let result = evaluate_preset("gpt2-small", 1800, None, true, true, &hw);
        assert_eq!(result.verdict, Compatibility::Insufficient);
        assert!(result.notes.iter().any(|n| n.contains("Not enough memory")));

        // Exactly 2x is enough
        hw.system_ram_mb = Some(3600);
        let result = evaluate_preset("gpt2-small", 1800, None, true, true, &hw);
        assert_eq!(result.verdict, Compatibility::CpuOk);

        // Unknown RAM: CPU mode isn't offered
        hw.system_ram_mb = None;
        let result = evaluate_preset("gpt2-small", 1800, None, true, true, &hw);
        assert_eq!(result.verdict, Compatibility::Insufficient);
    }

    // Disabled presets stay Insufficient even when cpu_ok and RAM is plentiful
    #[test]
    fn test_cpu_only_disabled_preset_stays_insufficient() {
        let hw = fake_cpu_only();
        let result = evaluate_preset("gemma-2-2b", 8000, Some("huggingface_gemma"), false, true, &hw);
        assert_eq!(result.verdict, Compatibility::Insufficient);
        assert!(!result.enabled);
        assert!(result.notes.iter().any(|n| n.contains("Coming soon")));
    }

    // GPU too small for the preset: cpu_ok preset falls back to CpuOk
    // 2048 MB card, 0 used → usable 548; gpt2-small 1800 → headroom -1252
    #[test]
    fn test_small_gpu_falls_back_to_cpu_ok() {
        let mut hw = fake_4070_super();
        hw.vram_total_mb = 2048;
        hw.vram_used_mb = Some(0);
        let result = evaluate_preset("gpt2-small", 1800, None, true, true, &hw);
        assert_eq!(result.verdict, Compatibility::CpuOk);
        assert_eq!(result.headroom_mb, -1252);
        let not_cpu_ok = evaluate_preset("gpt2-small", 1800, None, true, false, &hw);
        assert_eq!(not_cpu_ok.verdict, Compatibility::Insufficient);
    }

    // A GPU that fits never reports CpuOk, even for cpu_ok presets
    #[test]
    fn test_fitting_gpu_ignores_cpu_ok() {
        let hw = fake_4070_super();
        let result = evaluate_preset("gpt2-small", 1800, None, true, true, &hw);
        assert_eq!(result.verdict, Compatibility::Comfortable);
    }

    #[test]
    fn test_cpu_ok_serializes_as_pascal_case() {
        assert_eq!(serde_json::to_value(Compatibility::CpuOk).unwrap(), "CpuOk");
    }

    // evaluate_all passes `display` through and tolerates missing fields
    #[test]
    fn test_evaluate_all_display_passthrough_and_defaults() {
        let json = serde_json::json!({ "presets": [
            { "id": "gpt2-small", "vram_estimate_mb": 1800, "cpu_ok": true,
              "display": { "name": "GPT-2 small", "n_layers": 12, "recommended": true } },
            { "id": "bare", "vram_estimate_mb": 1200 },
            { "id": "off", "vram_estimate_mb": 8000, "enabled": false, "cpu_ok": true }
        ]});
        let out = evaluate_all(&fake_cpu_only(), &json);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].verdict, Compatibility::CpuOk);
        assert_eq!(out[0].display["name"], "GPT-2 small");
        assert!(out[1].display.is_null());
        assert_eq!(out[1].verdict, Compatibility::Insufficient); // cpu_ok absent = false
        assert!(out[1].enabled);
        assert!(!out[2].enabled);
        assert_eq!(out[2].verdict, Compatibility::Insufficient);
        let v = serde_json::to_value(&out[1]).unwrap();
        assert!(v.get("display").unwrap().is_null());
        assert_eq!(v["enabled"], true);
    }

    // The real presets.json parses and every preset is evaluated
    #[test]
    fn test_real_presets_json_evaluates() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../sidecar");
        let json = load_presets_json(&dir).unwrap();
        let n = json["presets"].as_array().unwrap().len();
        let out = evaluate_all(&fake_4070_super(), &json);
        assert_eq!(out.len(), n);
        // T31: Gemma 2 2B is enabled and fits a 12 GB card (bf16); 9B stays off.
        let by_id = |id: &str| out.iter().find(|c| c.preset_id == id).unwrap();
        let g2 = by_id("gemma-2-2b");
        assert!(g2.enabled);
        assert_eq!(g2.verdict, Compatibility::Comfortable);
        assert!(g2.notes.iter().any(|n| n.contains("HuggingFace")));
        assert!(!by_id("gemma-2-9b").enabled);
    }

    // Tight: fake a GPU with just barely enough VRAM
    // GPU: 8000 MB total, 500 used → usable = 8000 - 1500 - 500 = 6000
    // preset estimate = 5000 → headroom = 1000 → Tight
    #[test]
    fn test_tight_verdict() {
        let mut hw = fake_4070_super();
        hw.vram_total_mb = 8000;
        hw.vram_used_mb = Some(500);
        let result = evaluate_preset("some-preset", 5000, None, true, false, &hw);
        assert_eq!(result.verdict, Compatibility::Tight);
        assert_eq!(result.headroom_mb, 1000);
    }

    // AMD GPU via DXGI fallback — vram_used_mb is None (no live usage data).
    // usable = 20480 - 1500 - 0 = 18980; headroom vs 1800 = 17180 → Comfortable
    // Also verifies that a driver-reported-VRAM note is emitted.
    #[test]
    fn test_amd_gpu_dxgi_fallback_no_live_vram() {
        let hw = HardwareReport {
            gpu_name: "AMD Radeon RX 7900 XT".into(),
            vram_total_mb: 20480,
            vram_used_mb: None,
            vendor: "amd".into(),
            cuda_driver: None,
            vram_source: VramSource::Dxgi,
            backend: "dxgi".into(),
            driver_version: Some("31.0.21001.45".into()),
            probe_warnings: vec!["VRAM value is reported-by-driver".into()],
            probed_at: "2026-04-13T00:00:00Z".into(),
            os: "windows 11".into(),
            system_ram_mb: Some(32768),
        };
        let compat = evaluate_preset("gpt2-small", 1800, None, true, false, &hw);
        assert_eq!(compat.verdict, Compatibility::Comfortable);
        assert_eq!(compat.headroom_mb, 17180);
        // Should warn that live usage data is unavailable
        assert!(
            compat.notes.iter().any(|n| n.contains("driver-reported") || n.contains("live usage")),
            "expected driver-reported VRAM note, got: {:?}", compat.notes
        );
        assert!(
            compat.notes.iter().all(|n| !n.contains("  ")),
            "note has a run of spaces: {:?}", compat.notes
        );
    }

    // CPU-only with the fake_cpu_only helper already covers multiple presets,
    // but this test explicitly checks the note text and headroom sign.
    #[test]
    fn test_cpu_only_note_and_negative_headroom() {
        let hw = fake_cpu_only();
        let compat = evaluate_preset("gpt2-small", 1800, None, true, false, &hw);
        assert_eq!(compat.verdict, Compatibility::Insufficient);
        assert!(compat.headroom_mb < 0);
        assert!(
            compat.notes.iter().any(|n| n.contains("GPU required")),
            "expected 'GPU required' note, got: {:?}", compat.notes
        );
    }

    // Exact 2000 MB headroom is the Comfortable boundary (headroom >= 2000).
    // total=12288, used=Some(0) → usable = 12288 - 1500 - 0 = 10788
    // estimate = 8788 → headroom = 2000 → Comfortable (not Tight)
    #[test]
    fn test_exact_2000_mb_headroom_is_comfortable() {
        let mut hw = fake_4070_super();
        hw.vram_used_mb = Some(0);
        let compat = evaluate_preset("boundary-preset", 8788, None, true, false, &hw);
        assert_eq!(
            compat.verdict, Compatibility::Comfortable,
            "headroom of exactly 2000 MB should be Comfortable, got {:?} (headroom={})",
            compat.verdict, compat.headroom_mb
        );
        assert_eq!(compat.headroom_mb, 2000);
    }

    // 1999 MB headroom — just below the Comfortable threshold → Tight.
    // total=12288, used=Some(0) → usable=10788; estimate=8789 → headroom=1999
    #[test]
    fn test_1999_mb_headroom_is_tight() {
        let mut hw = fake_4070_super();
        hw.vram_used_mb = Some(0);
        let compat = evaluate_preset("boundary-preset", 8789, None, true, false, &hw);
        assert_eq!(
            compat.verdict, Compatibility::Tight,
            "headroom of 1999 MB should be Tight, got {:?} (headroom={})",
            compat.verdict, compat.headroom_mb
        );
        assert_eq!(compat.headroom_mb, 1999);
    }

    // License-gated preset that fits hardware: verdict = Comfortable AND license note present.
    // Uses the same setup as test_gemma_2_2b_enabled_comfortable_hypothetical but checks
    // explicitly for the HuggingFace note (complements the existing test with clearer intent).
    #[test]
    fn test_license_gated_preset_comfortable_with_note() {
        let hw = fake_4070_super();
        // usable = 10288, estimate = 8000, headroom = 2288 → Comfortable
        let compat = evaluate_preset("gemma-2-2b", 8000, Some("huggingface_gemma"), true, false, &hw);
        assert_eq!(compat.verdict, Compatibility::Comfortable);
        assert!(
            compat.notes.iter().any(|n| n.contains("HuggingFace") || n.contains("license")),
            "expected HuggingFace license note, got: {:?}", compat.notes
        );
        // Verdict is Comfortable — license gate is informational only, not a blocker
        assert!(compat.headroom_mb > 0);
    }
}
