<script lang="ts">
  import { validateCustomModel, addCustomModel } from '$lib/tauri';
  import type { CustomPreset } from '$lib/tauri';

  interface Props {
    open: boolean;
    onClose: () => void;
    onAdded: (preset: CustomPreset) => void;
  }

  let { open, onClose, onAdded }: Props = $props();

  let hfId = $state('');
  let validating = $state(false);
  let error = $state<string | null>(null);

  function handleClose() {
    hfId = '';
    error = null;
    onClose();
  }

  async function handleAdd() {
    // M6 fix: synchronous guard prevents two rapid clicks in the same frame
    // from both entering handleAdd before reactivity flushes validating=true
    // to the DOM and disables the button.
    if (validating) return;
    const trimmed = hfId.trim();
    if (!trimmed) {
      error = 'model ID cannot be empty';
      return;
    }
    // Basic client-side format check
    if (trimmed.includes(' ') || trimmed.includes('\n') || trimmed.length > 200) {
      error = 'invalid model ID format';
      return;
    }

    validating = true;
    error = null;
    try {
      // validate first (checks architecture whitelist)
      await validateCustomModel(trimmed);
      // then persist
      const preset = await addCustomModel(trimmed);
      hfId = '';
      onAdded(preset);
      onClose();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      validating = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') handleClose();
    if (e.key === 'Enter' && !validating) handleAdd();
  }
</script>

{#if open}
  <!-- Backdrop -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    onclick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
  >
    <!-- Dialog card -->
    <div
      class="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-model-title"
    >
      <h2 id="custom-model-title" class="mb-4 text-base font-semibold text-zinc-100">
        Add a custom HuggingFace model
      </h2>

      <!-- Input -->
      <label for="hf-model-id" class="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
        HuggingFace model ID
      </label>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="hf-model-id"
        type="text"
        bind:value={hfId}
        onkeydown={handleKeydown}
        placeholder="e.g. EleutherAI/pythia-160m"
        autofocus
        class="mb-1.5 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <p class="mb-4 text-xs text-zinc-500">
        Paste any model supported by TransformerLens. You'll get attention visualization — but no SAE features unless you also provide pretrained SAE weights.
      </p>

      <!-- Warning callout -->
      <div class="mb-5 rounded-md border border-yellow-800 bg-yellow-950/40 px-3 py-2" data-tip="custom-model-verdict">
        <p class="text-xs text-yellow-400">
          ⚠️ Custom models get attention viz only. Panel B will show an empty state.
        </p>
      </div>

      <!-- Error -->
      {#if error}
        <div class="mb-4 rounded-md border border-red-800 bg-red-950/40 px-3 py-2">
          <p class="text-xs text-red-400">{error}</p>
        </div>
      {/if}

      <!-- Buttons -->
      <div class="flex justify-end gap-2">
        <button
          onclick={handleClose}
          class="rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
        >
          Cancel
        </button>
        <button
          onclick={handleAdd}
          disabled={validating}
          class="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {#if validating}
            <span class="inline-flex items-center gap-1.5">
              <span class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
              Validating…
            </span>
          {:else}
            Add model
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
