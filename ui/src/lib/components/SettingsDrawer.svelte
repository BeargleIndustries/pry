<script lang="ts">
  import { X } from 'lucide-svelte';
  import { fly, fade } from 'svelte/transition';
  import type { Snippet } from 'svelte';

  let {
    open,
    onClose,
    children,
  }: {
    open: boolean;
    onClose: () => void;
    children?: Snippet;
  } = $props();

  // Esc closes the drawer
  $effect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Lock body scroll while drawer is open
  $effect(() => {
    if (!open) return;
    if (typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  });
</script>

{#if open}
  <!-- Backdrop (z-30) -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-30 bg-black/50"
    transition:fade={{ duration: 150 }}
    onclick={onClose}
  ></div>

  <!-- Drawer panel (z-40) -->
  <div
    class="fixed inset-y-0 right-0 z-40 flex w-full max-w-[440px] flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl"
    transition:fly={{ x: 440, duration: 200 }}
    aria-label="Settings"
    role="dialog"
    aria-modal="true"
  >
    <header class="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
      <h2 class="text-base font-semibold text-zinc-100">Settings</h2>
      <button
        onclick={onClose}
        aria-label="Close settings"
        class="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      >
        <X class="h-4 w-4" />
      </button>
    </header>
    <div class="flex-1 overflow-y-auto px-5 py-5">
      {@render children?.()}
    </div>
  </div>
{/if}
