<script lang="ts">
  // The embedding reader (TN-1, N3): two token positions side by side, the
  // count of matching numbers, rows split into embedding and positional
  // embedding when `split`, cosine similarity only beside the lists it
  // compares. A sidebar view only; no app panel. Reads pryUi.embedding, which
  // show_embedding fills.
  import { isHidden, pryUi, type EmbeddingSide } from '../pry-state.svelte';
  import { cosine, matchCount } from '../pry-readouts';

  /** How many numbers of each list are printed. */
  const SHOWN = 8;

  const emb = $derived(pryUi.embedding);
  const hidden = $derived(isHidden('embedding-values'));

  function vec(side: EmbeddingSide, part: 'embed' | 'pos' | 'sum'): number[] | null {
    const p = side.response.positions[0];
    if (!p) return null;
    if (part === 'embed') return p.embed;
    if (!p.pos_embed) return null;
    if (part === 'pos') return p.pos_embed;
    return p.embed.map((v, i) => v + (p.pos_embed as number[])[i]);
  }

  const rows = $derived.by(() => {
    if (!emb) return [];
    const parts: { label: string; part: 'embed' | 'pos' | 'sum' }[] = emb.split
      ? [
          { label: 'embedding', part: 'embed' },
          { label: 'positional embedding', part: 'pos' },
        ]
      : [{ label: 'embedding + positional embedding', part: 'sum' }];
    return parts.flatMap(({ label, part }) => {
      const a = vec(emb.a, part);
      const b = vec(emb.b, part);
      if (!a || !b) return [];
      return [{ label, a, b, matches: matchCount(a, b), total: Math.min(a.length, b.length), cos: cosine(a, b) }];
    });
  });

  const fmt = (v: number) => (v >= 0 ? ' ' : '') + v.toFixed(4);
  const where = (s: EmbeddingSide) => `"${s.token}" at position ${s.position} in "${s.prompt}"`;
</script>

<section class="flex flex-col gap-3 rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300" data-tour="embedding-view">
  {#if !emb}
    <p class="text-zinc-500">The two lists show here once the step runs.</p>
  {:else}
    <div class="flex flex-col gap-0.5 text-zinc-400">
      <p><span class="font-semibold text-zinc-300">A</span> {where(emb.a)}</p>
      <p><span class="font-semibold text-zinc-300">B</span> {where(emb.b)}</p>
    </div>
    <div class="flex flex-col gap-3" data-tour="embedding-values" data-lesson-hidden={hidden || undefined}>
      {#each rows as row (row.label)}
        <div class="flex flex-col gap-1">
          <p class="font-semibold text-zinc-200">{row.label}</p>
          <div class="flex items-start gap-3">
            <div class="flex min-w-0 flex-1 flex-col gap-0.5 font-mono text-[11px] text-zinc-400">
              <p class="truncate">A: {row.a.slice(0, SHOWN).map(fmt).join(' ')} …</p>
              <p class="truncate">B: {row.b.slice(0, SHOWN).map(fmt).join(' ')} …</p>
            </div>
            <p class="shrink-0 text-[11px] text-zinc-500">cosine similarity {row.cos.toFixed(3)}</p>
          </div>
          <p class="text-zinc-200">{row.matches} of {row.total} numbers match</p>
        </div>
      {/each}
    </div>
  {/if}
</section>
