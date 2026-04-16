<script lang="ts">
  import { Cpu } from 'lucide-svelte';
  import type { HardwareReport } from '$lib/tauri';

  let { report }: { report: HardwareReport } = $props();

  const usedPct = $derived(
    report.vram_used_mb != null ? Math.round((report.vram_used_mb / report.vram_total_mb) * 100) : null
  );

  const barColor = $derived(
    usedPct == null ? 'bg-zinc-600' :
    usedPct < 50   ? 'bg-emerald-500' :
    usedPct < 80   ? 'bg-yellow-400' :
                     'bg-red-500'
  );

  const vendorChip = $derived.by(() => {
    const v = report.vendor.toLowerCase();
    if (v.includes('nvidia')) return { label: 'nvidia', cls: 'bg-green-900 text-green-300 border-green-700' };
    if (v.includes('amd'))    return { label: 'amd',    cls: 'bg-red-900 text-red-300 border-red-700' };
    if (v.includes('intel'))  return { label: 'intel',  cls: 'bg-blue-900 text-blue-300 border-blue-700' };
    return { label: 'cpu-only', cls: 'bg-zinc-800 text-zinc-400 border-zinc-600' };
  });

  function fmtMb(mb: number): string {
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
  }
</script>

<div class="mb-6 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
  <!-- Header row -->
  <div class="mb-3 flex items-center gap-3">
    <Cpu class="h-5 w-5 shrink-0 text-indigo-400" />
    <span class="flex-1 truncate text-base font-semibold text-zinc-100">{report.gpu_name}</span>
    <span class="rounded border px-2 py-0.5 text-xs font-medium {vendorChip.cls}">
      {vendorChip.label}
    </span>
  </div>

  <!-- VRAM bar -->
  <div class="mb-3">
    <div class="mb-1 flex items-center justify-between text-xs text-zinc-500">
      <span>VRAM</span>
      {#if usedPct != null}
        <span>{fmtMb(report.vram_used_mb!)} / {fmtMb(report.vram_total_mb)} · {usedPct}%</span>
      {:else}
        <span>{fmtMb(report.vram_total_mb)} total <span class="text-zinc-600">(usage unavailable)</span></span>
      {/if}
    </div>
    <div class="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
      <div
        class="h-full rounded-full transition-all {barColor}"
        style="width: {usedPct ?? 0}%"
      ></div>
    </div>
  </div>

  <!-- Stats grid -->
  <div class="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
    {#if report.driver_version}
      <div class="flex gap-1.5">
        <span class="text-zinc-600">Driver</span>
        <span class="text-zinc-400">{report.driver_version}</span>
      </div>
    {/if}
    {#if report.cuda_driver}
      <div class="flex gap-1.5">
        <span class="text-zinc-600">CUDA</span>
        <span class="text-zinc-400">{report.cuda_driver}</span>
      </div>
    {/if}
    <div class="flex gap-1.5">
      <span class="text-zinc-600">Backend</span>
      <span class="text-zinc-400">{report.backend}</span>
    </div>
    <div class="flex gap-1.5">
      <span class="text-zinc-600">OS</span>
      <span class="truncate text-zinc-400">{report.os}</span>
    </div>
  </div>

  <!-- Warnings -->
  {#if report.probe_warnings.length > 0}
    <div class="mt-3 space-y-0.5 border-t border-zinc-800 pt-3">
      {#each report.probe_warnings as w}
        <p class="text-xs text-yellow-500">⚠ {w}</p>
      {/each}
    </div>
  {/if}
</div>
