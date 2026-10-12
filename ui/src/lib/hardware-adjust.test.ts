import { describe, expect, it } from 'vitest';
import { withoutEngineMemory } from './hardware-adjust';
import type { HardwareReport } from './tauri';

const hw = { vram_used_mb: 2800, vram_total_mb: 12282 } as unknown as HardwareReport;

describe('withoutEngineMemory', () => {
  it("subtracts the engine's own GPU memory from live use", () => {
    expect(withoutEngineMemory(hw, 1600).vram_used_mb).toBe(1200);
  });
  it('never goes below zero', () => {
    expect(withoutEngineMemory(hw, 9999).vram_used_mb).toBe(0);
  });
  it('leaves the report alone when nothing is loaded or usage is unknown', () => {
    expect(withoutEngineMemory(hw, null)).toBe(hw);
    expect(withoutEngineMemory(hw, 0)).toBe(hw);
    const unknown = { ...hw, vram_used_mb: null } as unknown as HardwareReport;
    expect(withoutEngineMemory(unknown, 1600)).toBe(unknown);
  });
});
