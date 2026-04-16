<script lang="ts">
  import { Lock } from 'lucide-svelte';
  import type { PresetCompatibility, Verdict } from '$lib/tauri';

  let {
    compatibilities,
    activePresetId = null,
    onSwitch = undefined,
  }: {
    compatibilities: PresetCompatibility[];
    activePresetId?: string | null;
    onSwitch?: (presetId: string) => void;
  } = $props();

  const DISPLAY_NAMES: Record<string, string> = {
    'gpt2-small':  'GPT-2 small · 124M · flagship',
    'pythia-410m': 'Pythia-410M',
    'pythia-1.4b': 'Pythia-1.4B',
    'gemma-2-2b':  'Gemma-2-2B · power user',
    'gemma-2-9b':  'Gemma-2-9B · stretch',
  };

  interface Badge { label: string; cls: string }
  function badge(v: Verdict): Badge {
    if (v === 'Comfortable') return { label: '✅ Comfortable', cls: 'bg-green-900/60 text-green-300 border-green-700' };
    if (v === 'Tight')       return { label: '⚠️ Tight',       cls: 'bg-yellow-900/60 text-yellow-300 border-yellow-700' };
    return                          { label: '❌ Insufficient', cls: 'bg-red-900/60 text-red-300 border-red-700' };
  }

  function needsLock(c: PresetCompatibility): boolean {
    return c.notes.some(n => n.toLowerCase().includes('huggingface') || n.toLowerCase().includes('license'));
  }

  function isComingSoon(c: PresetCompatibility): boolean {
    return c.verdict === 'Insufficient' &&
      c.notes.some(n => n.toLowerCase().includes('pending') || n.toLowerCase().includes('disabled'));
  }

  function fmtHeadroom(mb: number): string {
    const abs = Math.abs(mb);
    const s = abs >= 1024 ? `${(abs / 1024).toFixed(1)} GB` : `${abs} MB`;
    return mb >= 0 ? `+${s} headroom` : `-${s} over`;
  }
</script>

<div class="mb-6 space-y-2">
  <p class="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Preset Compatibility</p>
  {#each compatibilities as c (c.preset_id)}
    {@const b = badge(c.verdict)}
    {@const locked = needsLock(c)}
    {@const comingSoon = isComingSoon(c)}
    <div class="rounded-md border border-zinc-800 bg-zinc-900/70 px-4 py-3">
      <div class="flex items-center gap-2">
        <span class="flex-1 text-sm font-medium {comingSoon ? 'text-zinc-500' : 'text-zinc-200'}">
          {DISPLAY_NAMES[c.preset_id] ?? c.preset_id}
        </span>
        {#if locked}
          <Lock class="h-3.5 w-3.5 text-zinc-500" />
        {/if}
        <span class="rounded border px-2 py-0.5 text-xs {b.cls}">{b.label}</span>
        <span class="text-xs {c.headroom_mb >= 0 ? 'text-zinc-500' : 'text-red-500/70'}">{fmtHeadroom(c.headroom_mb)}</span>
        {#if c.preset_id === activePresetId}
          <span class="rounded border border-green-700 bg-green-900/60 px-2 py-0.5 text-xs text-green-300">Active</span>
        {/if}
        {#if onSwitch && c.verdict !== 'Insufficient' && c.preset_id !== activePresetId}
          <button
            type="button"
            onclick={() => onSwitch?.(c.preset_id)}
            class="rounded-md border border-indigo-700 bg-indigo-900/40 px-2 py-0.5 text-xs text-indigo-200 hover:bg-indigo-800/60"
          >
            Switch
          </button>
        {/if}
      </div>
      {#if c.notes.length > 0}
        <div class="mt-1.5 space-y-0.5">
          {#each c.notes as note}
            <p class="text-xs {comingSoon ? 'text-zinc-600 italic' : 'text-zinc-500'}">{note}</p>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>
