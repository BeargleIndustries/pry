// App self-update state (Tauri updater plugin). One shared instance drives the
// card on the loading screen, the banner under the header, and the Settings
// section. Checks never throw: failures (offline, GitHub down, a release with
// no latest.json) are logged to the console and otherwise silent, except for
// a manual "Check now" which reports them in Settings.

import {
  autoCheckEnabled,
  compareVersions,
  setAutoCheck,
  shouldOffer,
  skippedVersion,
  skipVersion,
  type KV,
} from './update-core';
import { UPDATE_COPY } from './update-copy';

export type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

/** The parts of the plugin's `Update` object this store uses. */
export interface UpdateHandle {
  version: string;
  currentVersion: string;
  body?: string;
  download(onEvent?: (e: DownloadEvent) => void): Promise<void>;
  install(): Promise<void>;
}

export interface UpdateDeps {
  check(): Promise<UpdateHandle | null>;
  currentVersion(): Promise<string>;
  /** Stop the Python engine cleanly before the installer runs. */
  stopSidecar(): Promise<void>;
  /** Bring the engine back if the install failed after it was stopped. */
  restartSidecar(): Promise<void>;
  relaunch(): Promise<void>;
  storage: KV | null;
  warn?(message: string, err?: unknown): void;
}

export type UpdatePhase =
  | 'idle'
  | 'available'
  | 'downloading'
  | 'stopping'
  | 'installing'
  | 'error';

export type CheckResult =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'none'; version: string }
  | { kind: 'available'; version: string; skipped: boolean }
  | { kind: 'error' };

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string;
}

export class UpdateState {
  phase = $state<UpdatePhase>('idle');
  info = $state<UpdateInfo | null>(null);
  /** Bytes received so far, and the total when the server sent one. */
  downloaded = $state(0);
  total = $state<number | null>(null);
  errorKind = $state<'download' | 'install' | null>(null);
  hiddenForSession = $state(false);
  /** Result of the last manual "Check now", shown in Settings. */
  lastCheck = $state<CheckResult>({ kind: 'idle' });
  autoCheck = $state(true);
  /** Text for the aria-live region; set when an update is found. */
  announcement = $state('');
  /** How many loading-screen cards are mounted; the header banner yields to them. */
  loadingHosts = $state(0);

  #deps: UpdateDeps;
  #update: UpdateHandle | null = null;
  #checking = false;
  #lastError = '';

  constructor(deps: UpdateDeps) {
    this.#deps = deps;
    this.autoCheck = autoCheckEnabled(deps.storage);
  }

  get busy(): boolean {
    return this.phase === 'downloading' || this.phase === 'stopping' || this.phase === 'installing';
  }

  /** Whether an update notice should be on screen at all. */
  get visible(): boolean {
    if (!this.info || this.phase === 'idle') return false;
    return this.busy || !this.hiddenForSession;
  }

  get showBanner(): boolean {
    return this.visible && this.loadingHosts === 0;
  }

  registerLoadingHost(): () => void {
    this.loadingHosts += 1;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.loadingHosts = Math.max(0, this.loadingHosts - 1);
    };
  }

  setAutoCheck(on: boolean): void {
    this.autoCheck = on;
    setAutoCheck(this.#deps.storage, on);
  }

  /** Background check at startup. Honors the toggle; never throws or reports. */
  async startupCheck(): Promise<void> {
    if (!autoCheckEnabled(this.#deps.storage)) return;
    await this.#check(false);
  }

  /** "Check now" from Settings: reports the outcome in `lastCheck`. */
  async checkNow(): Promise<void> {
    await this.#check(true);
  }

  async #check(manual: boolean): Promise<void> {
    if (this.#checking || this.busy) return;
    this.#checking = true;
    if (manual) this.lastCheck = { kind: 'checking' };
    try {
      const update = await this.#deps.check();
      if (!update) {
        if (manual) {
          let version = '';
          try {
            version = await this.#deps.currentVersion();
          } catch {
            // version unknown; the message still reads fine
          }
          this.lastCheck = { kind: 'none', version };
        }
        return;
      }
      const skipped = skippedVersion(this.#deps.storage);
      const offer = shouldOffer(update.version, update.currentVersion, skipped);
      const isSkipped = skipped !== null && compareVersions(update.version, skipped) === 0;
      if (manual) this.lastCheck = { kind: 'available', version: update.version, skipped: isSkipped };
      if (!offer) {
        // Kept so Settings can still show a skipped version on request.
        if (isSkipped) this.#update = update;
        return;
      }
      this.#show(update);
    } catch (err) {
      this.#warn('update check failed', err);
      if (manual) this.lastCheck = { kind: 'error' };
    } finally {
      this.#checking = false;
    }
  }

  #show(update: UpdateHandle): void {
    const fresh = this.info?.version !== update.version;
    this.#update = update;
    this.info = { version: update.version, currentVersion: update.currentVersion, notes: update.body ?? '' };
    this.phase = 'available';
    this.errorKind = null;
    this.hiddenForSession = false;
    if (fresh) this.announcement = UPDATE_COPY.announceFound(update.version);
  }

  /** Settings: un-skip the version found by "Check now" and show it again. */
  showSkipped(): void {
    skipVersion(this.#deps.storage, null);
    if (this.#update) this.#show(this.#update);
  }

  later(): void {
    if (this.busy) return;
    this.hiddenForSession = true;
    if (this.phase === 'error') this.phase = 'available';
  }

  skip(): void {
    if (this.busy || !this.info) return;
    skipVersion(this.#deps.storage, this.info.version);
    this.hiddenForSession = true;
    if (this.phase === 'error') this.phase = 'available';
  }

  async #download(): Promise<boolean> {
    const update = this.#update;
    if (!update) return false;
    this.phase = 'downloading';
    this.errorKind = null;
    this.downloaded = 0;
    this.total = null;
    try {
      await update.download((e) => {
        if (e.event === 'Started') this.total = e.data.contentLength ?? null;
        else if (e.event === 'Progress') this.downloaded += e.data.chunkLength;
      });
      return true;
    } catch (err) {
      this.#warn('update download failed', err);
      this.#lastError = String(err);
      this.errorKind = 'download';
      this.phase = 'error';
      return false;
    }
  }

  /**
   * Update and restart: download (with progress), stop the engine, install.
   * On Windows the installer takes over and Pry exits inside `install()`;
   * `relaunch()` covers platforms where it returns.
   */
  async install(): Promise<void> {
    if (this.busy) return;
    if (!(await this.#download())) return;
    this.phase = 'stopping';
    let stopped = false;
    try {
      await this.#deps.stopSidecar();
      stopped = true;
    } catch (err) {
      // The installer can still run; the engine's job object ends with Pry.
      this.#warn('could not stop the engine before update', err);
    }
    this.phase = 'installing';
    try {
      await this.#update!.install();
      await this.#deps.relaunch();
    } catch (err) {
      this.#warn('update install failed', err);
      this.errorKind = 'install';
      this.phase = 'error';
      if (stopped) {
        try {
          await this.#deps.restartSidecar();
        } catch (e) {
          this.#warn('could not restart the engine after a failed update', e);
        }
      }
    }
  }

  /**
   * Test hook only (exposed when built with VITE_PRY_UPDATE_TEST=1): download
   * and verify the signature, never install. Resolves to the error text, or
   * null on success.
   */
  async downloadOnly(): Promise<string | null> {
    if (!this.#update || this.busy) return 'no update to download';
    const ok = await this.#download();
    if (ok) this.phase = 'available';
    return ok ? null : this.#lastError;
  }

  #warn(message: string, err: unknown): void {
    (this.#deps.warn ?? ((m: string, e?: unknown) => console.warn(`[update] ${m}:`, e)))(message, err);
  }
}

function browserStorage(): KV | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function inTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);
}

const NOT_IN_APP = 'not running in the desktop app';

export const updates = new UpdateState({
  async check() {
    if (!inTauri()) throw new Error(NOT_IN_APP);
    const { check } = await import('@tauri-apps/plugin-updater');
    return check({ timeout: 20_000 });
  },
  async currentVersion() {
    if (!inTauri()) throw new Error(NOT_IN_APP);
    const { getVersion } = await import('@tauri-apps/api/app');
    return getVersion();
  },
  async stopSidecar() {
    if (!inTauri()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('stop_sidecar_for_update');
  },
  async restartSidecar() {
    const { restartSidecar } = await import('$lib/tauri');
    await restartSidecar();
  },
  async relaunch() {
    if (!inTauri()) return;
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  },
  storage: browserStorage(),
});

if (import.meta.env.VITE_PRY_UPDATE_TEST === '1' && typeof window !== 'undefined') {
  (window as unknown as { __pryUpdateTest: unknown }).__pryUpdateTest = {
    state: updates,
    downloadOnly: () => updates.downloadOnly(),
  };
}
