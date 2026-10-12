<script lang="ts">
  // Plain-language summary shown at the top of a panel (T21). The live region
  // stays mounted even when empty, so screen readers announce new text politely.
  // `contents` keeps the empty wrapper out of the parent's flex gap.
  interface Props {
    text: string | null;
  }

  let { text }: Props = $props();
</script>

<div class="contents" role="status" aria-live="polite" aria-atomic="true">
  {#if text}
    <p
      class="rounded-md border border-indigo-900/50 bg-indigo-950/30 px-3 py-2 text-xs leading-relaxed text-zinc-300"
    >
      <span class="sr-only">In plain words: </span>{text}
    </p>
  {/if}
</div>
