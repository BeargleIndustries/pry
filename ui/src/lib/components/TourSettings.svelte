<!--
  Settings drawer section: restart the tour, reset the first-time tips, or both.
-->
<script lang="ts">
  import { tutorialState } from '$lib/tutorial/tutorial-store.svelte';
  import { tourUi } from '$lib/tutorial/tour-steps';
  import { resetAllTips } from '$lib/tips/coordinate';

  interface Props {
    /** Called after the tour starts, e.g. to close the drawer. */
    onTourStarted?: () => void;
  }

  let { onTourStarted }: Props = $props();
  let allReset = $state(false);

  function restartTour() {
    allReset = false;
    tutorialState.restart();
    onTourStarted?.();
  }

  function resetTips() {
    allReset = false;
    resetAllTips();
  }

  function resetEverything() {
    resetAllTips();
    tutorialState.resetProgress();
    allReset = true;
  }
</script>

<div class="mt-8 border-t border-zinc-800 pt-5" data-tour="settings-tour">
  <p class="mb-3 text-[10px] font-medium uppercase tracking-widest text-zinc-500">{tourUi.settingsHeading}</p>

  {#each [
    { label: tourUi.settingsRestart, help: tourUi.settingsRestartHelp, button: tourUi.settingsRestartButton, run: restartTour },
    { label: tourUi.settingsTips, help: tourUi.settingsTipsHelp, button: tourUi.settingsTipsButton, run: resetTips },
    { label: tourUi.settingsAll, help: tourUi.settingsAllHelp, button: tourUi.settingsAllButton, run: resetEverything },
  ] as row (row.label)}
    <div class="mb-4 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <p class="text-sm text-zinc-300">{row.label}</p>
        <p class="text-xs text-zinc-500">{row.help}</p>
      </div>
      <button
        onclick={row.run}
        class="shrink-0 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-indigo-600 hover:text-indigo-300"
      >{row.button}</button>
    </div>
  {/each}
  {#if allReset}
    <p role="status" class="text-xs text-emerald-400">{tourUi.settingsAllDone}</p>
  {/if}
</div>
