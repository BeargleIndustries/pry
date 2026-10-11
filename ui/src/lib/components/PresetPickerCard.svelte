<script lang="ts">
  import { Lock, Download, Check, X, Cpu } from 'lucide-svelte';
  import type { PresetCompatibility } from '$lib/tauri';
  import { displayName, isPickable, statusInfo, visibleNotes, type VerdictTone } from '$lib/preset-display';

  interface Props {
    compat: PresetCompatibility;
    locked?: boolean;
    onpick: (id: string) => void;
  }

  let { compat, locked = false, onpick }: Props = $props();

  const name = $derived(displayName(compat));
  const subtitle = $derived(compat.display?.blurb ?? '');
  const sizeLabel = $derived(compat.display?.size_label ?? '');
  const flagship = $derived(compat.display?.recommended ?? false);

  const TONE_CLS: Record<VerdictTone, string> = {
    good: 'text-emerald-400',
    warn: 'text-yellow-400',
    cpu: 'text-sky-400',
    bad: 'text-red-400',
    soon: 'text-zinc-500',
  };

  const verdict = $derived(statusInfo(compat));
  const disabled = $derived(!isPickable(compat));
</script>

<button
  onclick={() => onpick(compat.preset_id)}
  disabled={disabled}
  class="group relative w-full overflow-hidden rounded-xl border p-5 text-left transition-all
    {flagship
      ? 'border-indigo-600/60 bg-gradient-to-br from-indigo-950/60 via-zinc-900 to-zinc-900 shadow-[0_0_40px_-12px_rgba(99,102,241,0.5)] hover:border-indigo-500 hover:shadow-[0_0_48px_-8px_rgba(99,102,241,0.7)]'
      : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-900'}
    disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-zinc-800"
>
  {#if flagship}
    <div class="absolute right-4 top-4 rounded bg-indigo-600 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white">
      recommended
    </div>
  {/if}

  <div class="mb-2 flex items-center gap-2">
    {#if locked}
      <Lock class="h-4 w-4 text-zinc-500" />
    {/if}
    <h3 class="text-lg font-semibold text-zinc-100">{name}</h3>
    {#if sizeLabel}
      <span class="font-mono text-xs text-zinc-500">· {sizeLabel}</span>
    {/if}
  </div>

  {#if subtitle}
    <p class="mb-3 text-sm text-zinc-400">{subtitle}</p>
  {/if}

  <div class="flex items-center gap-4 text-xs">
    <span class="inline-flex items-center gap-1 {TONE_CLS[verdict.tone]}">
      {#if verdict.tone === 'cpu'}
        <Cpu class="h-3.5 w-3.5" />
      {:else if verdict.pickable}
        <Check class="h-3.5 w-3.5" />
      {:else}
        <X class="h-3.5 w-3.5" />
      {/if}
      {verdict.label}
    </span>
    {#if !disabled}
      <span class="inline-flex items-center gap-1 font-medium text-indigo-400 opacity-0 transition-opacity group-hover:opacity-100">
        <Download class="h-3.5 w-3.5" /> click to download
      </span>
    {/if}
  </div>

  {#if visibleNotes(compat).length > 0}
    <div class="mt-2 space-y-0.5 text-[11px] text-zinc-500">
      {#each visibleNotes(compat) as note}
        <div>· {note}</div>
      {/each}
    </div>
  {/if}
</button>
