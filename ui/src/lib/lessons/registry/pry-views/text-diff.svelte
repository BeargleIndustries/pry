<script lang="ts">
  // Two captured texts side by side with the changed tokens marked. A capture
  // is the `result` readout taken at its do step; the text is its Watch it
  // write text, or its steered text when it captured a steering run.
  import { diffTokens } from '../../../token-diff';
  import type { PrySource } from '../pry-readouts';

  interface Props {
    args: { a: string; b: string };
    /** Captures by name, as the runner stores them. */
    captures?: Record<string, PrySource | undefined>;
  }

  let { args, captures = {} }: Props = $props();

  function textOf(src: PrySource | undefined): string | null {
    if (!src) return null;
    return src.writeIt?.generation ?? src.steer?.steered_generation ?? null;
  }

  const left = $derived(textOf(captures[args.a]));
  const right = $derived(textOf(captures[args.b]));
  const diff = $derived(left !== null && right !== null ? diffTokens(left, right) : null);
</script>

<section class="grid grid-cols-2 gap-3 rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
  {#if !diff}
    <p class="col-span-2 text-zinc-500">Both texts show here once both steps have run.</p>
  {:else}
    {#each [{ name: args.a, side: diff.left }, { name: args.b, side: diff.right }] as col (col.name)}
      <div class="flex flex-col gap-1">
        <p class="font-semibold text-zinc-200">{col.name}</p>
        <p class="whitespace-pre-wrap leading-relaxed">
          {#each col.side as t, i (i)}<span class={t.changed ? 'rounded bg-amber-900/50 text-amber-200' : ''}>{t.text}</span>{/each}
        </p>
      </div>
    {/each}
  {/if}
</section>
