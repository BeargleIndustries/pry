# Releasing Pry

Pry checks `https://github.com/BeargleIndustries/pry/releases/latest/download/latest.json`
when it starts (unless the user turned that off in Settings). The manifest names the new
version and points at a signed installer. The app refuses any installer whose signature
doesn't match the public key in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).

## Keys

- Private key: `%USERPROFILE%\.tauri\pry-updater.key` (no password). Never commit, copy or
  paste it anywhere. Losing it means existing installs can't verify future updates, so keep
  a backup somewhere safe and offline.
- Public key: `%USERPROFILE%\.tauri\pry-updater.key.pub`, already in `tauri.conf.json`.

## Steps

1. Bump the version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and
   `ui/package.json`, and add a `## X.Y.Z` section to `CHANGELOG.md`. That section becomes
   the update notes users see (the first few lines show in the update card).
2. Merge to `master`, tag `vX.Y.Z-alpha`.
3. Build:

   ```powershell
   pwsh -File scripts/release.ps1
   ```

   It sets `TAURI_SIGNING_PRIVATE_KEY` to the key path, runs `cargo tauri build --ci`
   (the `--ci` flag makes the CLI accept the empty password without prompting), restores
   `src-tauri/Cargo.toml`, and writes
   `src-tauri/target/release/bundle/nsis/latest.json` next to the installer and its `.sig`.
   Use `-SkipBuild` to only regenerate `latest.json`.
4. Smoke the release binary as usual.
5. Run the `gh release create` command the script prints. Attach both the installer and
   `latest.json`. Don't mark the release as a pre-release: GitHub's `latest` URL skips
   those, and the app would not see it.

## Notes

- Releases before 0.3.7 have no `latest.json`. Their 404 is treated like being offline:
  silent, logged to the console only.
- The update replaces the app only. The Python engine in `%LOCALAPPDATA%\Pry\runtime`,
  downloaded models, the notebook and settings are left alone. If the new version ships a
  different sidecar package, Pry's existing "Updating Pry" step reinstalls it on first launch.
- Before the installer runs, the app stops the engine through the same shutdown path it
  uses on exit (`stop_sidecar_for_update` in `src-tauri/src/lib.rs`), so no `python.exe`
  holds files open. On Windows the installer runs in passive mode, closes Pry, installs,
  and reopens it.
