<!--
  SpineStrip (plan T3 "Sidebar"): the tool's spine, in order, with the
  lesson's boxes lit (front matter `spine`, a range when it names two or
  more) and any `:spine{mask=box|a..b}` in this section shown as one "?"
  until a later section reveals it (N8). `lesson:spine` pointers highlight
  the strip (or one box) in place, without an arrow.
-->
<script lang="ts">
  import { lessonsCopy } from './copy';

  interface Props {
    spine: { id: string; label: string }[];
    lit: string[];
    masks?: string[];
    highlight?: boolean;
    highlightBox?: string | null;
  }

  let { spine, lit, masks = [], highlight = false, highlightBox = null }: Props = $props();

  /** The lesson's boxes, lit as a range from the first named to the last. */
  const litSet = $derived.by(() => {
    const idx = lit.map((id) => spine.findIndex((s) => s.id === id)).filter((i) => i >= 0);
    if (idx.length === 0) return new Set<string>();
    const lo = Math.min(...idx);
    const hi = Math.max(...idx);
    return new Set(spine.slice(lo, hi + 1).map((s) => s.id));
  });

  /** Boxes behind a mask: one box, or `a..b` as one range. */
  const masked = $derived.by(() => {
    const groups: string[][] = [];
    for (const m of masks) {
      const [a, b] = m.split('..');
      const i = spine.findIndex((s) => s.id === a);
      const j = b ? spine.findIndex((s) => s.id === b) : i;
      if (i < 0 || j < 0) continue;
      groups.push(spine.slice(Math.min(i, j), Math.max(i, j) + 1).map((s) => s.id));
    }
    return groups;
  });

  type Cell = { key: string; label: string; lit: boolean; mask: boolean; ids: string[] };
  const cells = $derived.by(() => {
    const out: Cell[] = [];
    let k = 0;
    while (k < spine.length) {
      const s = spine[k];
      const g = masked.find((grp) => grp[0] === s.id);
      if (g) {
        out.push({ key: `mask-${s.id}`, label: '?', lit: g.some((id) => litSet.has(id)), mask: true, ids: g });
        k += g.length;
      } else {
        out.push({ key: s.id, label: s.label, lit: litSet.has(s.id), mask: false, ids: [s.id] });
        k++;
      }
    }
    return out;
  });
</script>

<ol
  class="flex flex-wrap items-center gap-1 rounded-md p-1 {highlight && !highlightBox ? 'pry-lesson-inplace' : ''}"
  aria-label={lessonsCopy.spineLabel}
  data-lesson-spine
>
  {#each cells as c, i (c.key)}
    <li
      class="rounded border px-1.5 py-0.5 text-[10px] leading-tight {c.lit
        ? 'border-indigo-500/60 bg-indigo-950/60 text-indigo-200'
        : 'border-zinc-800 bg-zinc-900 text-zinc-400'} {highlightBox && c.ids.includes(highlightBox) ? 'pry-lesson-inplace' : ''}"
      data-spine-box={c.ids.join(' ')}
      aria-current={c.lit ? 'step' : undefined}
    >
      {c.label}
    </li>
    {#if i < cells.length - 1}<li aria-hidden="true" class="text-[10px] text-zinc-700">›</li>{/if}
  {/each}
</ol>
