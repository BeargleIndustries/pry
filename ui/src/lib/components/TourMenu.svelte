<!--
  The header's ? button: take the quick tour, or open Lessons.
-->
<script module lang="ts">
  export const tourMenuUi = {
    menuButton: 'Help and tour',
    takeTour: 'Take the tour',
    openLessons: 'Open Lessons',
  };
</script>

<script lang="ts">
  import { CircleHelp } from 'lucide-svelte';

  interface Props {
    /** Starts the quick tour from step 1. */
    onTour: () => void;
    onLessons: () => void;
  }

  let { onTour, onLessons }: Props = $props();

  let open = $state(false);

  function pick(go: () => void) {
    open = false;
    go();
  }

  function onKey(e: KeyboardEvent) {
    if (open && e.key === 'Escape') open = false;
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="relative">
  <button
    onclick={() => (open = !open)}
    aria-label={tourMenuUi.menuButton}
    data-tour="header-help"
    aria-expanded={open}
    aria-haspopup="menu"
    class="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
  >
    <CircleHelp class="h-4 w-4" />
  </button>
  {#if open}
    <!-- Click-outside catcher; Escape closes the menu too. -->
    <div role="presentation" class="fixed inset-0 z-40" onclick={() => (open = false)}></div>
    <div
      class="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
      role="menu"
      data-testid="tour-menu"
    >
      <button
        type="button"
        role="menuitem"
        onclick={() => pick(onTour)}
        class="w-full px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
      >{tourMenuUi.takeTour}</button>
      <button
        type="button"
        role="menuitem"
        onclick={() => pick(onLessons)}
        class="w-full px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
      >{tourMenuUi.openLessons}</button>
    </div>
  {/if}
</div>
