<script lang="ts">
  import { Lock } from 'lucide-svelte';
  import type { PresetCompatibility, Verdict } from '$lib/tauri';
  import {
    displayName,
    isPickable,
    needsHfToken,
    statusInfo,
    visibleNotes,
    type VerdictTone,
  } from '$lib/preset-display';

  let {
    compatibilities,
    activePresetId = null,
    onSwitch = undefined,
    title = 'Preset Compatibility',
    switchLabel = 'Switch',
    onRemove = undefined,
    disabled = false,
  }: {
    compatibilities: PresetCompatibility[];
    activePresetId?: string | null;
    onSwitch?: (presetId: string) => void;
    title?: string;
    switchLabel?: string;
    /** Custom models (T32): show a Remove button on each row. */
    onRemove?: (presetId: string) => void;
    /** Switch buttons are off while a model is loading or switching. */
    disabled?: boolean;
  } = $props();

  const TONE: Record<VerdictTone, { glyph: string; cls: string }> = {
    good: { glyph: '✅', cls: 'bg-green-900/60 text-green-300 border-green-700' },
    warn: { glyph: '⚠️', cls: 'bg-yellow-900/60 text-yellow-300 border-yellow-700' },
    cpu:  { glyph: '🖥️', cls: 'bg-sky-900/60 text-sky-300 border-sky-700' },
    bad:  { glyph: '❌', cls: 'bg-red-900/60 text-red-300 border-red-700' },
    soon: { glyph: '⏳', cls: 'bg-zinc-800 text-zinc-400 border-zinc-700' },
  };

  interface Badge { label: string; cls: string }
  function badge(c: PresetCompatibility): Badge {
    const info = statusInfo(c);
    const t = TONE[info.tone];
    return { label: `${t.glyph} ${info.short}`, cls: t.cls };
  }

  function subtitle(c: PresetCompatibility): string {
    const d = c.display;
    if (!d) return '';
    return [d.params, d.recommended ? 'recommended' : null].filter(Boolean).join(' · ');
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
  <p class="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</p>
  {#each compatibilities as c (c.preset_id)}
    {@const b = badge(c)}
    {@const locked = needsHfToken(c)}
    {@const sub = subtitle(c)}
    {@const comingSoon = isComingSoon(c)}
    <div class="rounded-md border border-zinc-800 bg-zinc-900/70 px-4 py-3">
      <div class="flex items-center gap-2">
        <span class="flex-1 text-sm font-medium {comingSoon ? 'text-zinc-500' : 'text-zinc-200'}">
          {displayName(c)}{#if sub}<span class="font-normal text-zinc-500"> · {sub}</span>{/if}
        </span>
        {#if locked}
          <Lock class="h-3.5 w-3.5 text-zinc-500" />
        {/if}
        <span class="rounded border px-2 py-0.5 text-xs {b.cls}">{b.label}</span>
        <span class="text-xs {c.headroom_mb >= 0 ? 'text-zinc-500' : 'text-red-500/70'}">{fmtHeadroom(c.headroom_mb)}</span>
        {#if c.preset_id === activePresetId}
          <span class="rounded border border-green-700 bg-green-900/60 px-2 py-0.5 text-xs text-green-300">Active</span>
        {/if}
        {#if onSwitch && isPickable(c) && c.preset_id !== activePresetId}
          <button
            type="button"
            onclick={() => onSwitch?.(c.preset_id)}
            {disabled}
            class="rounded-md border border-indigo-700 bg-indigo-900/40 px-2 py-0.5 text-xs text-indigo-200 hover:bg-indigo-800/60 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {switchLabel}
          </button>
        {/if}
        {#if onRemove && c.preset_id !== activePresetId}
          <button
            type="button"
            onclick={() => onRemove?.(c.preset_id)}
            aria-label="Remove {displayName(c)}"
            class="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 hover:border-red-700 hover:text-red-300"
          >
            Remove
          </button>
        {/if}
      </div>
      {#if visibleNotes(c).length > 0}
        <div class="mt-1.5 space-y-0.5">
          {#each visibleNotes(c) as note}
            <p class="text-xs {comingSoon ? 'text-zinc-600 italic' : 'text-zinc-500'}">{note}</p>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>
