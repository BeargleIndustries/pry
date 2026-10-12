import type { HardwareReport } from './tauri';

/**
 * The hardware report as the model picker should see it: live GPU use minus
 * what Pry's own engine holds, since switching models unloads the current one
 * first. Without this a 12 GB card running GPT-2 could rate a 6.5 GB model
 * "Insufficient" because of GPT-2's own memory.
 */
export function withoutEngineMemory(hw: HardwareReport, engineReservedMb: number | null | undefined): HardwareReport {
  if (!engineReservedMb || engineReservedMb <= 0 || hw.vram_used_mb == null) return hw;
  return { ...hw, vram_used_mb: Math.max(0, hw.vram_used_mb - engineReservedMb) };
}
