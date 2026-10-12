<!--
  The header's ? button: start the tour over, continue it, or jump to a chapter.
-->
<script lang="ts">
  import { CircleHelp } from 'lucide-svelte';
  import { tutorialState } from '$lib/tutorial/tutorial-store.svelte';
  import { tourUi } from '$lib/tutorial/tour-steps';

  let open = $state(false);
  const resumeAt = $derived(tutorialState.resumeAt);
  const chapters = $derived(tutorialState.chapterList);

  function toggle() {
    if (!open) tutorialState.refresh();
    open = !open;
  }

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
    onclick={toggle}
    aria-label={tourUi.menuButton}
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
      class="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
      role="menu"
      data-testid="tour-menu"
    >
      <button
        type="button"
        role="menuitem"
        onclick={() => pick(() => tutorialState.start())}
        class="w-full px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
      >{tourUi.menuStart}</button>
      {#if resumeAt}
        <button
          type="button"
          role="menuitem"
          onclick={() => pick(() => tutorialState.resume())}
          class="w-full px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
        >
          {tourUi.menuContinue}
          <span class="block text-[11px] text-zinc-500">
            {tourUi.chapterOf(resumeAt.chapter + 1, chapters.length)}: {chapters[resumeAt.chapter]?.title}
          </span>
        </button>
      {/if}
      <p class="mt-1 border-t border-zinc-800 px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-widest text-zinc-500">
        {tourUi.menuChapters}
      </p>
      {#each chapters as c, i (c.id)}
        <button
          type="button"
          role="menuitem"
          onclick={() => pick(() => tutorialState.goToChapter(i))}
          class="flex w-full items-baseline gap-2 px-3 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-800"
        >
          <span class="w-4 text-right tabular-nums text-zinc-500">{i + 1}</span>
          <span class="flex-1">{c.title}</span>
          {#if tutorialState.isCompleted(c.id)}
            <span class="text-emerald-400" aria-label={tourUi.menuDone}>✓</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
