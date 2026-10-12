<script lang="ts">
  // Shown in place of a feature panel (Features, Steering) when the loaded
  // model is a custom one with no feature dictionary (T32).
  import { NO_SAE_MESSAGE } from '$lib/custom-models';

  interface Props {
    /** What the panel would have shown, e.g. "Features" or "Steering". */
    panel: string;
  }

  let { panel }: Props = $props();
</script>

<div class="rounded-md border border-zinc-800 bg-zinc-900/60 px-4 py-3" role="status">
  <p class="text-sm text-zinc-300">Not available for this model: {panel}.</p>
  <p class="mt-1 text-xs text-zinc-500">{NO_SAE_MESSAGE}</p>
  <p class="mt-2 text-xs text-zinc-500">
    Attention, Predictions, Logit Lens, Why (DLA), Swap &amp; Compare and Key parts all work. To see features,
    switch to one of Pry's built-in models.
  </p>
</div>
