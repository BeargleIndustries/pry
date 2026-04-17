<script lang="ts">
  export interface TabDef {
    id: string;
    label: string;
    icon?: string;
    /** Tooltip shown on hover — use for expanded plain-language descriptions. */
    title?: string;
  }

  interface Props {
    tabs: TabDef[];
    activeTab?: string;
    onTabChange?: (id: string) => void;
    children: import('svelte').Snippet<[string]>;
  }

  let { tabs, activeTab = $bindable(), onTabChange, children }: Props = $props();

  // Default to first tab if none set
  let internal = $state(tabs[0]?.id ?? '');
  const current = $derived(activeTab ?? internal);

  function select(id: string) {
    internal = id;
    activeTab = id;
    onTabChange?.(id);
  }

  function onTabKey(e: KeyboardEvent) {
    const idx = tabs.findIndex((t) => t.id === current);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = (idx + 1) % tabs.length;
      select(tabs[next].id);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = (idx - 1 + tabs.length) % tabs.length;
      select(tabs[prev].id);
    }
  }
</script>

<div class="flex h-full flex-col">
  {#if tabs.length > 1}
    <div
      role="tablist"
      aria-label="Panel tabs"
      onkeydown={onTabKey}
      class="flex flex-shrink-0 gap-4 border-b border-zinc-800 px-3"
    >
      {#each tabs as tab (tab.id)}
        {@const isActive = current === tab.id}
        <button
          type="button"
          role="tab"
          aria-selected={isActive}
          tabindex={isActive ? 0 : -1}
          onclick={() => select(tab.id)}
          title={tab.title}
          class="relative -mb-px border-b-2 px-1 py-1.5 text-xs transition-colors"
          class:border-indigo-400={isActive}
          class:text-indigo-300={isActive}
          class:border-transparent={!isActive}
          class:text-zinc-500={!isActive}
          class:hover:text-zinc-300={!isActive}
        >
          {tab.label}
        </button>
      {/each}
    </div>
  {/if}
  <div class="flex-1 overflow-y-auto">
    {@render children(current)}
  </div>
</div>
