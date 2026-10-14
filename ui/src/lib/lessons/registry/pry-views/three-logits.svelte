<script lang="ts">
  // Clean, corrupted and patched logits for the selected Swap test cell on one
  // line, with the share formula worked through.
  import { pryUi } from '../pry-state.svelte';
  import { shareOf } from '../pry-readouts';

  const cell = $derived(pryUi.patching.selectedComponent);
  const share = $derived(cell ? shareOf(cell) : undefined);
  const f = (v: number) => v.toFixed(2);
</script>

<section class="flex flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
  {#if !cell}
    <p class="text-zinc-500">Pick a square in the Swap test grid to see its three logits.</p>
  {:else}
    <p class="font-mono">
      clean {f(cell.clean_logit)} · corrupted {f(cell.corrupted_logit)} · patched {f(cell.patched_logit)}
    </p>
    <p class="font-mono text-zinc-400">
      share = (patched − corrupted) ÷ (clean − corrupted) = ({f(cell.patched_logit)} − {f(cell.corrupted_logit)}) ÷ ({f(cell.clean_logit)} − {f(cell.corrupted_logit)}){#if share !== undefined} = {f(share)}{/if}
    </p>
  {/if}
</section>
