//! HuggingFace token storage via Windows Credential Manager.
//! Used by the Gemma preset gating flow in Phase 5b onboarding.

use anyhow::anyhow;

const CRED_TARGET: &str = "pry:huggingface";

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use windows::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CRED_FLAGS, CRED_PERSIST_ENTERPRISE,
        CRED_TYPE_GENERIC, CREDENTIALW,
    };
    use windows::Win32::Foundation::{FILETIME, ERROR_NOT_FOUND};
    use windows::core::PWSTR;

    fn to_wide_null(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn save(token: &str) -> anyhow::Result<()> {
        let target = to_wide_null(CRED_TARGET);
        let mut token_bytes = token.as_bytes().to_vec();
        let cred = CREDENTIALW {
            Flags: CRED_FLAGS(0),
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(target.as_ptr() as *mut u16),
            Comment: PWSTR::null(),
            LastWritten: FILETIME::default(),
            CredentialBlobSize: u32::try_from(token_bytes.len()).map_err(|_| anyhow!("token too large"))?,
            CredentialBlob: token_bytes.as_mut_ptr(),
            // M8 fix: CRED_PERSIST_LOCAL_MACHINE persists the cred for ALL
            // users on the machine — leaks Brad's HF token to every local
            // account. CRED_PERSIST_ENTERPRISE scopes to the current user
            // (and syncs with roaming profile if enabled), which is the
            // correct choice for a personal-use token.
            Persist: CRED_PERSIST_ENTERPRISE,
            AttributeCount: 0,
            Attributes: std::ptr::null_mut(),
            TargetAlias: PWSTR::null(),
            UserName: PWSTR::null(),
        };
        // SAFETY: CredWriteW copies the CredentialBlob before returning
        // (Win32 contract). `token_bytes` remains valid and exclusively owned
        // for the duration of this call. After CredWriteW returns, the pointer
        // is not retained by the OS — `cred` and `token_bytes` are both
        // dropped normally at end of scope.
        unsafe {
            CredWriteW(&cred, 0).map_err(|e| anyhow!("CredWriteW: {e}"))?;
        }
        Ok(())
    }

    pub fn load() -> anyhow::Result<Option<String>> {
        let target = to_wide_null(CRED_TARGET);
        let mut cred_ptr: *mut CREDENTIALW = std::ptr::null_mut();
        let result = unsafe {
            CredReadW(
                PWSTR(target.as_ptr() as *mut u16),
                CRED_TYPE_GENERIC,
                0,
                &mut cred_ptr,
            )
        };
        match result {
            Ok(()) => unsafe {
                if cred_ptr.is_null() {
                    return Ok(None);
                }
                let cred = &*cred_ptr;
                let bytes = std::slice::from_raw_parts(
                    cred.CredentialBlob,
                    cred.CredentialBlobSize as usize,
                );
                let parsed = String::from_utf8(bytes.to_vec());
                CredFree(cred_ptr as *const _); // always free before returning
                let token = parsed.map_err(|e| anyhow!("credential blob not utf8: {e}"))?;
                Ok(Some(token))
            },
            Err(e) => {
                // ERROR_NOT_FOUND (0x490 / 1168) means no credential stored — that's Ok(None).
                // Any other error (e.g. access denied, corrupted store) should propagate.
                if e.code() == windows::core::HRESULT::from_win32(ERROR_NOT_FOUND.0) {
                    Ok(None)
                } else {
                    Err(anyhow!("CredReadW: {e}"))
                }
            }
        }
    }

    pub fn delete() -> anyhow::Result<()> {
        let target = to_wide_null(CRED_TARGET);
        unsafe {
            CredDeleteW(PWSTR(target.as_ptr() as *mut u16), CRED_TYPE_GENERIC, 0)
                .map_err(|e| anyhow!("CredDeleteW: {e}"))?;
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod windows_impl {
    use super::*;
    pub fn save(_token: &str) -> anyhow::Result<()> {
        Err(anyhow!("HF token storage only supported on Windows in v1"))
    }
    pub fn load() -> anyhow::Result<Option<String>> {
        Ok(None)
    }
    pub fn delete() -> anyhow::Result<()> {
        Ok(())
    }
}

/// The saved HuggingFace token, if any. Used at sidecar launch to set
/// `HF_TOKEN` in the child env (never in this process's env).
pub fn load_token() -> anyhow::Result<Option<String>> {
    windows_impl::load()
}

fn validate_token(token: &str) -> Result<(), String> {
    let t = token.trim();
    if t.is_empty() {
        return Err("token cannot be empty".into());
    }
    if t.len() > 1000 {
        return Err("token suspiciously long (>1000 chars)".into());
    }
    if !t.starts_with("hf_") {
        return Err(
            "HuggingFace tokens start with 'hf_' — this doesn't look like one".into(),
        );
    }
    Ok(())
}

/// Save the token, then restart the engine (if one is running) so it picks
/// the token up.
#[tauri::command]
pub async fn save_hf_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
    validate_token(&token)?;
    windows_impl::save(token.trim()).map_err(|e| format!("{e:#}"))?;
    restart_engine_after_token_change(&app).await
}

#[tauri::command]
pub fn has_hf_token() -> Result<bool, String> {
    windows_impl::load()
        .map(|o| o.is_some())
        .map_err(|e| format!("{e:#}"))
}

/// Delete the token, then restart the engine (if one is running) so it no
/// longer has it.
#[tauri::command]
pub async fn clear_hf_token(app: tauri::AppHandle) -> Result<(), String> {
    windows_impl::delete().map_err(|e| format!("{e:#}"))?;
    restart_engine_after_token_change(&app).await
}

async fn restart_engine_after_token_change(app: &tauri::AppHandle) -> Result<(), String> {
    match crate::restart_sidecar_if_running(app).await {
        Ok(_) => Ok(()),
        Err(e) => Err(format!(
            "Your HuggingFace token was updated, but Pry's engine failed to restart: {e}"
        )),
    }
}
