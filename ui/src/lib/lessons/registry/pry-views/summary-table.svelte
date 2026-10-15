<script lang="ts">
  // P3.6's three-tool summary: one row per tool, with what it measures and the
  // lesson's own values. The rows come from the step's arguments.
  interface Props {
    args: { rows?: { tool: string; measures?: string; result?: string }[]; [key: string]: unknown };
  }

  let { args }: Props = $props();

  const rows = $derived(Array.isArray(args.rows) ? args.rows : []);
</script>

<table class="w-full border-collapse rounded-md border border-zinc-800 bg-zinc-950 text-left text-xs text-zinc-300">
  <tbody>
    {#each rows as row (row.tool)}
      <tr class="border-b border-zinc-800 last:border-0">
        <th class="p-2 font-semibold text-zinc-200">{row.tool}</th>
        <td class="p-2">{row.measures ?? ''}</td>
        <td class="p-2 text-zinc-400">{row.result ?? ''}</td>
      </tr>
    {/each}
  </tbody>
</table>
