//! Custom model escape hatch — validate HF model IDs against a known-good list
//! of TransformerLens-supported architectures, persist user additions.

use std::path::PathBuf;
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomPreset {
    pub id: String,          // user-provided HF ID
    pub display_name: String,
    pub architecture: String, // gpt2, llama, pythia, etc
    pub added_at: String,     // ISO-8601
    pub sae_available: bool,  // always false for custom models for now
}

/// H3 fix: architecture detection is now a best-effort label only. We no
/// longer reject unknown prefixes — the Python side does real validation
/// when the user actually tries to load the model. Covers common orgs and
/// returns "unknown" for anything else, rather than failing the add.
fn detect_architecture_label(hf_id: &str) -> &'static str {
    let id = hf_id.to_lowercase();
    if id == "gpt2" || id.starts_with("gpt2-") { return "gpt2"; }
    if id.starts_with("eleutherai/pythia-") { return "pythia"; }
    if id.starts_with("eleutherai/gpt-neo-") { return "gpt-neo"; }
    if id.starts_with("eleutherai/gpt-j-") { return "gpt-j"; }
    if id.starts_with("meta-llama/llama-") || id.starts_with("meta-llama/meta-llama-") {
        return "llama";
    }
    if id.starts_with("mistralai/mistral-") || id.starts_with("mistralai/mixtral-") {
        return "mistral";
    }
    if id.starts_with("google/gemma-") { return "gemma"; }
    if id.starts_with("microsoft/phi-") { return "phi"; }
    if id.starts_with("qwen/") { return "qwen"; }
    if id.starts_with("stabilityai/stablelm-") { return "stablelm"; }
    if id.starts_with("huggingfaceh4/") { return "huggingfaceh4"; }
    if id.starts_with("thebloke/") { return "reupload"; }
    "unknown"
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

fn load_all() -> anyhow::Result<Vec<CustomPreset>> {
    let path = custom_models_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&path)?;
    let models: Vec<CustomPreset> = serde_json::from_str(&content)
        .map_err(|e| anyhow::anyhow!("custom_models.json is corrupt: {e}. \
            File preserved at {}; fix by hand or delete to reset.", path.display()))?;
    Ok(models)
}

fn save_all(models: &[CustomPreset]) -> anyhow::Result<()> {
    let path = custom_models_path()?;
    let json = serde_json::to_string_pretty(models)?;
    std::fs::write(&path, json)?;
    Ok(())
}

#[tauri::command]
pub fn validate_custom_model(hf_id: String) -> Result<CustomPreset, String> {
    let trimmed = hf_id.trim();
    if trimmed.is_empty() {
        return Err("model ID cannot be empty".into());
    }
    if !is_valid_hf_id_format(trimmed) {
        return Err(
            "Invalid HuggingFace model ID format. Expected: 'org/name' or 'name', \
             containing only letters, digits, '.', '-', '_'.".into(),
        );
    }

    let arch = detect_architecture_label(trimmed);
    let display_name = trimmed.split('/').next_back().unwrap_or(trimmed).to_string();

    Ok(CustomPreset {
        id: trimmed.to_string(),
        display_name,
        architecture: arch.to_string(),
        added_at: chrono::Utc::now().to_rfc3339(),
        sae_available: false,
    })
}

#[tauri::command]
pub fn add_custom_model(hf_id: String) -> Result<CustomPreset, String> {
    let preset = validate_custom_model(hf_id)?;
    let mut all = load_all().map_err(|e| e.to_string())?;
    // Dedupe by id
    if all.iter().any(|p| p.id == preset.id) {
        return Err(format!("model '{}' is already in custom models", preset.id));
    }
    all.push(preset.clone());
    save_all(&all).map_err(|e| e.to_string())?;
    Ok(preset)
}

#[tauri::command]
pub fn list_custom_models() -> Result<Vec<CustomPreset>, String> {
    load_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_custom_model(hf_id: String) -> Result<(), String> {
    let mut all = load_all().map_err(|e| e.to_string())?;
    all.retain(|p| p.id != hf_id);
    save_all(&all).map_err(|e| e.to_string())?;
    Ok(())
}
