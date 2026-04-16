import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauri } from "./is-tauri";

export type BootstrapStage =
  | "probing"
  | "cleaning"
  | "downloading_pbs"
  | "extracting_pbs"
  | "creating_venv"
  | "installing_torch"
  | "installing_transformer_lens"
  | "installing_sae_lens"
  | "installing_extras"
  | "ready";

export interface BootstrapProgressEvent {
  stage: BootstrapStage;
  message: string;
  progress: number;
  bytes_downloaded?: number;
  bytes_total?: number;
}

export const STAGE_LABELS: Record<BootstrapStage, string> = {
  probing: "Probing environment",
  cleaning: "Cleaning up",
  downloading_pbs: "Downloading Python runtime",
  extracting_pbs: "Extracting Python runtime",
  creating_venv: "Creating virtual environment",
  installing_torch: "Installing PyTorch",
  installing_transformer_lens: "Installing TransformerLens",
  installing_sae_lens: "Installing SAE Lens",
  installing_extras: "Installing extras",
  ready: "Ready",
};

export const STAGE_ORDER: BootstrapStage[] = [
  "probing",
  "cleaning",
  "downloading_pbs",
  "extracting_pbs",
  "creating_venv",
  "installing_torch",
  "installing_transformer_lens",
  "installing_sae_lens",
  "installing_extras",
  "ready",
];

export async function onBootstrapProgress(
  handler: (ev: BootstrapProgressEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<BootstrapProgressEvent>("bootstrap:progress", (e) => handler(e.payload));
}

export async function onBootstrapLog(
  handler: (line: string) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<string>("bootstrap:log", (e) => handler(e.payload));
}

export function fmtBytes(n: number | undefined): string {
  if (n == null) return "";
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}
