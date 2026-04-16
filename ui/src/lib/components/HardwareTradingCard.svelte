<script lang="ts">
  import type { HardwareReport, PresetCompatibility } from '$lib/tauri';

  interface Props {
    report: HardwareReport;
    compatibilities: PresetCompatibility[];
  }

  let { report, compatibilities }: Props = $props();

  let canvasRef = $state<HTMLCanvasElement | undefined>(undefined);
  let exportError = $state<string | null>(null);

  $effect(() => {
    if (!canvasRef || !report) return;
    const ctx = canvasRef.getContext('2d');
    if (!ctx) return;
    drawCard(ctx, report, compatibilities);
  });

  function vendorColor(v: string): string {
    switch (v.toLowerCase()) {
      case 'nvidia': return '#76B900';
      case 'amd': return '#ED1C24';
      case 'intel': return '#0071C5';
      default: return '#3F3F46';
    }
  }

  function displayName(id: string): string {
    const names: Record<string, string> = {
      'gpt2-small': 'GPT-2 small',
      'pythia-410m': 'Pythia-410M',
      'pythia-1.4b': 'Pythia-1.4B',
      'gemma-2-2b': 'Gemma-2-2B',
      'gemma-2-9b': 'Gemma-2-9B',
    };
    return names[id] ?? id;
  }

  function drawCard(
    ctx: CanvasRenderingContext2D,
    hw: HardwareReport,
    compat: PresetCompatibility[]
  ) {
    // Background
    ctx.fillStyle = '#18181B';
    ctx.fillRect(0, 0, 1200, 630);

    // Title
    ctx.fillStyle = '#6366F1';
    ctx.font = 'bold 48px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Pry — Hardware Card', 60, 90);

    // GPU name
    ctx.fillStyle = '#FAFAFA';
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.fillText(hw.gpu_name, 60, 190);

    // Vendor chip
    ctx.fillStyle = vendorColor(hw.vendor);
    ctx.fillRect(60, 210, 120, 32);
    ctx.fillStyle = '#FAFAFA';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText(hw.vendor.toUpperCase(), 72, 232);

    // VRAM label
    ctx.fillStyle = '#A1A1AA';
    ctx.font = '20px system-ui, sans-serif';
    const vramLabel = hw.vram_used_mb != null
      ? `VRAM: ${hw.vram_used_mb}MB / ${hw.vram_total_mb}MB`
      : `VRAM: ${hw.vram_total_mb}MB (reported)`;
    ctx.fillText(vramLabel, 60, 290);

    // VRAM bar
    const barY = 310;
    const barW = 800;
    const pct = (hw.vram_used_mb ?? 0) / Math.max(hw.vram_total_mb, 1);
    ctx.fillStyle = '#3F3F46';
    ctx.fillRect(60, barY, barW, 24);
    ctx.fillStyle = pct > 0.8 ? '#EF4444' : pct > 0.5 ? '#EAB308' : '#22C55E';
    ctx.fillRect(60, barY, barW * Math.min(pct, 1), 24);

    // Stats
    ctx.fillStyle = '#A1A1AA';
    ctx.font = '18px system-ui, sans-serif';
    const stats = [
      `Driver: ${hw.driver_version ?? 'unknown'}`,
      `CUDA: ${hw.cuda_driver ?? 'n/a'}`,
      `Backend: ${hw.backend}`,
      `OS: ${hw.os}`,
    ];
    stats.forEach((s, i) =>
      ctx.fillText(s, 60 + (i % 2) * 420, 390 + Math.floor(i / 2) * 30)
    );

    // Preset badges header
    ctx.fillStyle = '#6366F1';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillText('Can run:', 60, 490);

    // Preset badges
    compat.slice(0, 5).forEach((p, i) => {
      const x = 60 + i * 220;
      const y = 510;
      const color =
        p.verdict === 'Comfortable' ? '#22C55E' :
        p.verdict === 'Tight' ? '#EAB308' : '#EF4444';
      const glyph =
        p.verdict === 'Comfortable' ? '✅' :
        p.verdict === 'Tight' ? '⚠️' : '❌';

      ctx.fillStyle = '#27272A';
      ctx.fillRect(x, y, 200, 60);

      ctx.fillStyle = color;
      ctx.font = '28px system-ui, sans-serif';
      ctx.fillText(glyph, x + 12, y + 40);

      ctx.fillStyle = '#FAFAFA';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText(displayName(p.preset_id), x + 48, y + 26);

      ctx.fillStyle = '#71717A';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(p.verdict, x + 48, y + 44);
    });

    // Footer
    ctx.fillStyle = '#52525B';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Pry v0.1.0 · ${new Date().toISOString().slice(0, 10)}`, 60, 600);
    ctx.textAlign = 'right';
    ctx.fillText('Beargle Industries', 1140, 600);
  }

  async function exportPng() {
    if (!canvasRef) return;
    exportError = null;
    canvasRef.toBlob(async (blob) => {
      try {
        if (!blob) throw new Error('toBlob returned null');
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const { save } = await import('@tauri-apps/plugin-dialog');
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        const path = await save({
          defaultPath: `pry-hardware-card-${Date.now()}.png`,
          filters: [{ name: 'PNG', extensions: ['png'] }],
        });
        if (path) {
          await writeFile(path, bytes);
        }
        exportError = null;
      } catch (e) {
        exportError = e instanceof Error ? e.message : String(e);
        console.error('exportPng failed:', e);
      }
    }, 'image/png');
  }

  async function exportJson() {
    exportError = null;
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const jsonPath = await save({
        defaultPath: `pry-hardware-card-${Date.now()}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (jsonPath) {
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        const payload = {
          report,
          compatibilities,
          pry_version: '0.1.0',
          exported_at: new Date().toISOString(),
        };
        await writeTextFile(jsonPath, JSON.stringify(payload, null, 2));
      }
      exportError = null;
    } catch (e) {
      exportError = e instanceof Error ? e.message : String(e);
      console.error('exportJson failed:', e);
    }
  }
</script>

<div class="space-y-4">
  <!-- Canvas preview (scaled down for on-screen display) -->
  <div class="overflow-hidden rounded-lg border border-zinc-700">
    <canvas
      bind:this={canvasRef}
      width={1200}
      height={630}
      style="width: 100%; height: auto; display: block;"
    ></canvas>
  </div>

  <!-- Export error -->
  {#if exportError}
    <p class="text-sm text-red-400">{exportError}</p>
  {/if}

  <!-- Export buttons -->
  <div class="flex gap-2">
    <button
      onclick={exportPng}
      class="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
    >
      Save PNG
    </button>
    <button
      onclick={exportJson}
      class="rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
    >
      Save JSON
    </button>
  </div>
</div>
