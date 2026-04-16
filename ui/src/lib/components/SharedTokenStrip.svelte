<script lang="ts">
  import type { TokenInfo } from '$lib/types';

  interface Props {
    tokens: TokenInfo[];
    focusTokenIndex: number | undefined;
    onTokenFocus: (index: number) => void;
  }

  let { tokens, focusTokenIndex, onTokenFocus }: Props = $props();

  function displayToken(text: string): string {
    return text.startsWith(' ') ? '\u00b7' + text.slice(1) : text;
  }
</script>

<div class="flex h-9 items-center gap-1.5 overflow-x-auto whitespace-nowrap py-1">
  {#each tokens as token}
    <button
      onclick={() => onTokenFocus(token.index)}
      class={[
        'flex-shrink-0 rounded px-2 py-1 font-mono text-xs transition-all',
        token.index === focusTokenIndex
          ? 'border border-indigo-500 bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/50'
          : 'border border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100',
      ].join(' ')}
    >
      {displayToken(token.text)}
    </button>
  {/each}
</div>
