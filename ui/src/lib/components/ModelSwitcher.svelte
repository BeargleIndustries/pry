<script lang="ts">
  import { ChevronDown, Check, Loader2 } from 'lucide-svelte';
  import type { PresetCompatibility, Verdict } from '$lib/tauri';
  import { displayName, isPickable, verdictInfo, type VerdictTone } from '$lib/preset-display';

  interface Props {
    compatibilities: PresetCompatibility[] | null;
    activePresetId: string | null;
    disabled: boolean;
    onSwitch: (presetId: string) => void;
  }

  let { compatibilities, activePresetId, disabled, onSwitch }: Props = $props();

  const loadable = $derived(
    (compatibilities ?? []).filter(isPickable),
  );

  let open = $state(false);
  let rootEl: HTMLDivElement | null = $state(null);

  function toggle() {
    if (disabled) return;
    open = !open;
  }

  function onDocClick(e: MouseEvent) {
    if (!open) return;
    const target = e.target as Node | null;
    if (rootEl && target && !rootEl.contains(target)) {
      open = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false;
  }

  $effect(() => {
    if (typeof window === 'undefined') return;
    window.addEventListener('click', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  });

  function handleRowClick(presetId: string) {
    if (disabled) return;
    if (presetId === activePresetId) {
      open = false;
      return;
    }
    open = false;
    onSwitch(presetId);
  }

  const TONE_CLS: Record<VerdictTone, string> = {
    good: 'bg-green-900/60 text-green-300 border-green-700',
    warn: 'bg-yellow-900/60 text-yellow-300 border-yellow-700',
    cpu: 'bg-sky-900/60 text-sky-300 border-sky-700',
    bad: 'bg-red-900/60 text-red-300 border-red-700',
  };

  function verdictBadge(v: Verdict): { label: string; cls: string } {
    const info = verdictInfo(v);
    return { label: info.short, cls: TONE_CLS[info.tone] };
  }
</script>

<div bind:this={rootEl} class="relative">
  <button
    type="button"
    onclick={toggle}
    disabled={disabled || loadable.length === 0}
    class="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/70 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
    data-tour="model-switcher"
    aria-haspopup="listbox"
    aria-expanded={open}
  >
    {#if disabled}
      <Loader2 class="h-3.5 w-3.5 animate-spin text-indigo-300" />
    {/if}
    <span class="font-medium">{displayName(activePresetId, compatibilities)}</span>
    <ChevronDown class="h-3.5 w-3.5 text-zinc-400" />
  </button>

  {#if open}
    <div
      class="absolute right-0 top-full z-20 mt-1 w-80 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 shadow-lg"
      role="listbox"
    >
      {#each loadable as c (c.preset_id)}
        {@const b = verdictBadge(c.verdict)}
        {@const isActive = c.preset_id === activePresetId}
        <button
          type="button"
          onclick={() => handleRowClick(c.preset_id)}
          disabled={disabled}
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
          role="option"
          aria-selected={isActive}
        >
          <span class="flex h-4 w-4 flex-none items-center justify-center">
            {#if isActive}
              <Check class="h-3.5 w-3.5 text-green-400" />
            {/if}
          </span>
          <span class="flex-1 truncate text-zinc-200">
            {displayName(c)}
          </span>
          <span class="flex-none rounded border px-1.5 py-0.5 text-[10px] {b.cls}">{b.label}</span>
        </button>
      {/each}
      {#if loadable.length === 0}
        <div class="px-3 py-2 text-xs text-zinc-500">No compatible presets.</div>
      {/if}
    </div>
  {/if}
</div>
