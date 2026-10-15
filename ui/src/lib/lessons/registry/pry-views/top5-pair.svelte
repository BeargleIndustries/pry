<script lang="ts">
  // Two captured top 5 lists side by side. From a knockout capture the list is
  // the knocked-out run's; otherwise it's the run's own predictions.
  import type { PrySource } from '../pry-readouts';
  import { formatProbability } from '../../slots';

  interface Props {
    args: { a: string; b: string };
    captures?: Record<string, PrySource | undefined>;
  }

  let { args, captures = {} }: Props = $props();

  function top5(src: PrySource | undefined): { token: string; prob: number }[] | null {
    if (!src) return null;
    const abl = src.headAblate ?? src.featureAblate;
    if (abl) return abl.ablated_predictions.slice(0, 5).map((p) => ({ token: p.token, prob: p.probability }));
    const p = src.response?.top_predictions;
    return p ? [...p].sort((x, y) => x.rank - y.rank).slice(0, 5).map((x) => ({ token: x.token, prob: x.probability })) : null;
  }

  const cols = $derived([
    { name: args.a, list: top5(captures[args.a]) },
    { name: args.b, list: top5(captures[args.b]) },
  ]);
  const pct = (p: number) => formatProbability(p);
</script>

<section class="grid grid-cols-2 gap-3 rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
  {#each cols as col (col.name)}
    <div class="flex flex-col gap-1">
      <p class="font-semibold text-zinc-200">{col.name}</p>
      {#if col.list}
        <ol class="flex flex-col gap-0.5 font-mono">
          {#each col.list as p, i (i)}
            <li class="flex justify-between gap-2"><span>{JSON.stringify(p.token)}</span><span class="text-zinc-400">{pct(p.prob)}</span></li>
          {/each}
        </ol>
      {:else}
        <p class="text-zinc-500">Shows here once its step has run.</p>
      {/if}
    </div>
  {/each}
</section>
