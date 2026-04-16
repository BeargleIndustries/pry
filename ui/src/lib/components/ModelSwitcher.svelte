<script lang="ts">
  import { ChevronDown, Check, Loader2 } from 'lucide-svelte';
  import type { PresetCompatibility, Verdict } from '$lib/tauri';

  interface Props {
    compatibilities: PresetCompatibility[] | null;
    activePresetId: string | null;
    disabled: boolean;
    onSwitch: (presetId: string) => void;
  }

  let { compatibilities, activePresetId, disabled, onSwitch }: Props = $props();

  const DISPLAY_NAMES: Record<string, string> = {
    'gpt2-small': 'GPT-2 small',
    'pythia-410m': 'Pythia-410M',
    'pythia-1.4b': 'Pythia-1.4B',
    'gemma-2-2b': 'Gemma-2-2B',
    'gemma-2-9b': 'Gemma-2-9B',
  };

  function displayName(id: string | null): string {
    if (!id) return 'No model';
    return DISPLAY_NAMES[id] ?? id;
  }

  const loadable = $derived(
    (compatibilities ?? []).filter(
      (c) => c.verdict === 'Comfortable' || c.verdict === 'Tight',
    ),
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

  function verdictBadge(v: Verdict): { label: string; cls: string } {
    if (v === 'Comfortable')
      return { label: 'Comfortable', cls: 'bg-green-900/60 text-green-300 border-green-700' };
    return { label: 'Tight', cls: 'bg-yellow-900/60 text-yellow-300 border-yellow-700' };
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
    <span class="font-medium">{displayName(activePresetId)}</span>
    <ChevronDown class="h-3.5 w-3.5 text-zinc-400" />
  </button>

  {#if open}
    <div
      class="absolute right-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 shadow-lg"
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
            {DISPLAY_NAMES[c.preset_id] ?? c.preset_id}
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
