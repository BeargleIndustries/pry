//! Custom models (T32): user-added HuggingFace models, persisted to
//! `%LOCALAPPDATA%\Pry\custom_models.json` and reloaded at startup
//! (`list_custom_models`).
//!
//! Real validation happens in the sidecar (`POST /custom-models/validate`):
//! it fetches the repo's config.json, checks the architecture against
//! TransformerLens and estimates the parameter count and memory. The UI then
//! asks `evaluate_custom_model` for the same Comfortable / Tight / CpuOk /
//! Insufficient verdict presets get (`presets_compat::evaluate_preset`), and
//! `add_custom_model` stores the model with those numbers.

use std::path::{Path, PathBuf};
use serde::{Serialize, Deserialize};

use crate::hardware::HardwareReport;
use crate::presets_compat::{self, PresetCompatibility};

// KEEP IN SYNC: ui/src/lib/tauri.ts::CustomPreset
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CustomPreset {
    pub id: String,           // HF repo id (TransformerLens' spelling)
    pub display_name: String,
    pub architecture: String, // config.json architecture, e.g. GPTNeoXForCausalLM
    pub added_at: String,     // ISO-8601
    pub sae_available: bool,  // always false: no feature dictionary for custom models
    // Added in 0.3.x (T32); absent in lists saved by 0.2.x.
    #[serde(default)]
    pub n_params: Option<u64>,
    #[serde(default)]
    pub params_label: Option<String>,
    #[serde(default)]
    pub vram_estimate_mb: Option<u64>,
    #[serde(default)]
    pub cpu_ok: bool,
}

/// What the sidecar's validation found, passed to `add_custom_model`.
// KEEP IN SYNC: ui/src/lib/tauri.ts::CustomModelDetails
#[derive(Debug, Clone, Default, Deserialize)]
pub struct CustomModelDetails {
    pub architecture: Option<String>,
    pub n_params: Option<u64>,
    pub params_label: Option<String>,
    pub vram_estimate_mb: Option<u64>,
    #[serde(default)]
    pub cpu_ok: bool,
}

/// HF model IDs are `org/name` or a bare name (e.g. `gpt2`). Characters allowed:
/// ASCII letters, digits, dot, dash, underscore. Exactly one slash maximum.
fn is_valid_hf_id_format(hf_id: &str) -> bool {
    if hf_id.is_empty() || hf_id.len() > 200 { return false; }
    let slash_count = hf_id.chars().filter(|c| *c == '/').count();
    if slash_count > 1 { return false; }
    hf_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '/' || c == '.' || c == '-' || c == '_')
}

fn custom_models_path() -> anyhow::Result<PathBuf> {
    // data_local_dir (%LOCALAPPDATA%) — see bootstrap::runtime_dir for rationale.
    let base = dirs::data_local_dir()
        .ok_or_else(|| anyhow::anyhow!("could not resolve local data dir"))?;
    let dir = base.join("Pry");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("custom_models.json"))
}

fn load_from(path: &Path) -> anyhow::Result<Vec<CustomPreset>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(path)?;
    let models: Vec<CustomPreset> = serde_json::from_str(&content)
        .map_err(|e| anyhow::anyhow!("custom_models.json is corrupt: {e}. \
            File preserved at {}; fix by hand or delete to reset.", path.display()))?;
    Ok(models)
}

fn save_to(path: &Path, models: &[CustomPreset]) -> anyhow::Result<()> {
    let json = serde_json::to_string_pretty(models)?;
    crate::bootstrap::layout::write_file_atomic(path, json.as_bytes())?;
    Ok(())
}

/// Build the stored entry for `hf_id` (format check only; the sidecar has
/// already done the real check).
fn new_preset(hf_id: &str, details: CustomModelDetails) -> Result<CustomPreset, String> {
    let trimmed = hf_id.trim();
    if trimmed.is_empty() {
        return Err("Type a model name first.".into());
    }
    if !is_valid_hf_id_format(trimmed) {
        return Err(
            "That doesn't look like a HuggingFace model name. Names look like \
             'organization/model-name', using letters, digits, '.', '-' and '_'.".into(),
        );
    }
    let display_name = trimmed.split('/').next_back().unwrap_or(trimmed).to_string();
    Ok(CustomPreset {
        id: trimmed.to_string(),
        display_name,
        architecture: details.architecture.unwrap_or_else(|| "unknown".into()),
        added_at: chrono::Utc::now().to_rfc3339(),
        sae_available: false,
        n_params: details.n_params,
        params_label: details.params_label,
        vram_estimate_mb: details.vram_estimate_mb,
        cpu_ok: details.cpu_ok,
    })
}

/// Add to the list at `path`, deduping by id (case-insensitive, like HF).
fn add_to(path: &Path, preset: CustomPreset) -> Result<CustomPreset, String> {
    let mut all = load_from(path).map_err(|e| e.to_string())?;
    if all.iter().any(|p| p.id.eq_ignore_ascii_case(&preset.id)) {
        return Err(format!("{} is already in your custom models.", preset.id));
    }
    all.push(preset.clone());
    save_to(path, &all).map_err(|e| e.to_string())?;
    Ok(preset)
}

fn remove_from(path: &Path, hf_id: &str) -> Result<(), String> {
    let mut all = load_from(path).map_err(|e| e.to_string())?;
    all.retain(|p| p.id != hf_id);
    save_to(path, &all).map_err(|e| e.to_string())
}

/// Format-only check, kept for callers that want a quick answer before the
/// sidecar round-trip.
#[tauri::command]
pub fn validate_custom_model(hf_id: String) -> Result<CustomPreset, String> {
    new_preset(&hf_id, CustomModelDetails::default())
}

/// Hardware verdict for a custom model, from the sidecar's memory estimate.
/// Same thresholds and CpuOk rule as presets (`presets_compat`).
#[tauri::command]
pub fn evaluate_custom_model(
    hf_id: String,
    vram_estimate_mb: u64,
    cpu_ok: bool,
    hw: HardwareReport,
) -> PresetCompatibility {
    presets_compat::evaluate_preset(&hf_id, vram_estimate_mb, None, true, cpu_ok, &hw)
}

#[tauri::command]
pub fn add_custom_model(
    hf_id: String,
    details: Option<CustomModelDetails>,
) -> Result<CustomPreset, String> {
    let preset = new_preset(&hf_id, details.unwrap_or_default())?;
    let path = custom_models_path().map_err(|e| e.to_string())?;
    add_to(&path, preset)
}

#[tauri::command]
pub fn list_custom_models() -> Result<Vec<CustomPreset>, String> {
    let path = custom_models_path().map_err(|e| e.to_string())?;
    load_from(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_custom_model(hf_id: String) -> Result<(), String> {
    let path = custom_models_path().map_err(|e| e.to_string())?;
    remove_from(&path, &hf_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::presets_compat::Compatibility;

    fn temp_list(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pry-t32-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("custom_models.json");
        let _ = std::fs::remove_file(&path);
        path
    }

    fn pythia_details() -> CustomModelDetails {
        CustomModelDetails {
            architecture: Some("GPTNeoXForCausalLM".into()),
            n_params: Some(162_322_944),
            params_label: Some("162M".into()),
            vram_estimate_mb: Some(2000),
            cpu_ok: true,
        }
    }

    // The list persists to disk and a fresh load (as at startup) returns it.
    #[test]
    fn custom_list_persists_and_reloads() {
        let path = temp_list("persist");
        assert!(load_from(&path).unwrap().is_empty());

        let pythia = new_preset("EleutherAI/pythia-160m-deduped", pythia_details()).unwrap();
        add_to(&path, pythia.clone()).unwrap();
        add_to(&path, new_preset("gpt2", CustomModelDetails::default()).unwrap()).unwrap();

        let reloaded = load_from(&path).unwrap();
        assert_eq!(reloaded.len(), 2);
        assert_eq!(reloaded[0], pythia);
        assert_eq!(reloaded[0].display_name, "pythia-160m-deduped");
        assert_eq!(reloaded[0].vram_estimate_mb, Some(2000));
        assert!(reloaded[0].cpu_ok);
        assert!(!reloaded[0].sae_available);
        assert_eq!(reloaded[1].architecture, "unknown");

        // Duplicates are refused, whatever the case.
        assert!(add_to(&path, new_preset("eleutherai/PYTHIA-160m-deduped", pythia_details()).unwrap()).is_err());
        assert_eq!(load_from(&path).unwrap().len(), 2);

        remove_from(&path, "gpt2").unwrap();
        let after = load_from(&path).unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].id, "EleutherAI/pythia-160m-deduped");
        let _ = std::fs::remove_file(&path);
    }

    // Lists saved before T32 (no size fields) still load.
    #[test]
    fn old_list_format_still_loads() {
        let path = temp_list("old");
        std::fs::write(&path, r#"[{"id":"gpt2","display_name":"gpt2","architecture":"gpt2",
            "added_at":"2026-04-13T00:00:00Z","sae_available":false}]"#).unwrap();
        let list = load_from(&path).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].vram_estimate_mb, None);
        assert!(!list[0].cpu_ok);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn corrupt_list_is_an_error_not_a_wipe() {
        let path = temp_list("corrupt");
        std::fs::write(&path, "not json").unwrap();
        assert!(load_from(&path).unwrap_err().to_string().contains("corrupt"));
        assert!(add_to(&path, new_preset("gpt2", CustomModelDetails::default()).unwrap()).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "not json");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn bad_names_rejected() {
        assert!(new_preset("  ", CustomModelDetails::default()).is_err());
        assert!(new_preset("a/b/c", CustomModelDetails::default()).is_err());
        assert!(new_preset("has space/x", CustomModelDetails::default()).is_err());
        assert_eq!(new_preset(" gpt2 ", CustomModelDetails::default()).unwrap().id, "gpt2");
    }

    // Custom models get the same verdicts as presets, CpuOk included.
    #[test]
    fn verdict_reuses_preset_logic() {
        let gpu = HardwareReport {
            gpu_name: "NVIDIA GeForce RTX 4070 SUPER".into(),
            vram_total_mb: 12288,
            vram_used_mb: Some(500),
            vendor: "nvidia".into(),
            cuda_driver: Some("12.4".into()),
            vram_source: crate::hardware::VramSource::Nvml,
            backend: "nvml".into(),
            driver_version: None,
            probe_warnings: vec![],
            probed_at: "2026-10-11T00:00:00Z".into(),
            os: "windows".into(),
            system_ram_mb: Some(32768),
        };
        let r = evaluate_custom_model("EleutherAI/pythia-160m-deduped".into(), 2000, true, gpu.clone());
        assert_eq!(r.verdict, Compatibility::Comfortable);
        assert_eq!(r.preset_id, "EleutherAI/pythia-160m-deduped");
        assert!(r.enabled);

        let big = evaluate_custom_model("x/big".into(), 30000, false, gpu.clone());
        assert_eq!(big.verdict, Compatibility::Insufficient);

        let mut cpu = gpu;
        cpu.vendor = "cpu".into();
        cpu.vram_total_mb = 0;
        cpu.vram_used_mb = None;
        let small = evaluate_custom_model("gpt2".into(), 2000, true, cpu.clone());
        assert_eq!(small.verdict, Compatibility::CpuOk);
        let not_cpu = evaluate_custom_model("x/mid".into(), 6500, false, cpu);
        assert_eq!(not_cpu.verdict, Compatibility::Insufficient);
    }
}
