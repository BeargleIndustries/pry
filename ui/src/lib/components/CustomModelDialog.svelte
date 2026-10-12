<script lang="ts">
  // Add a custom Hugging Face model (T32). "Check" asks Pry's engine to fetch
  // the model's settings file, confirm TransformerLens can load it and
  // estimate its size; the verdict uses the same rules as the built-in models.
  import { addCustomModel, evaluateCustomModel, saveHfToken } from '$lib/tauri';
  import type { CustomPreset, HardwareReport, PresetCompatibility } from '$lib/tauri';
  import { checkCustomModel, CustomModelCheckError, type CustomModelCheck } from '$lib/sidecar';
  import { CUSTOM_MODEL_MISSING, CUSTOM_MODEL_WORKS, looksLikeHfId } from '$lib/custom-models';
  import { verdictInfo, visibleNotes } from '$lib/preset-display';
  import { friendlyError } from '$lib/errors';

  interface Props {
    open: boolean;
    hardware: HardwareReport | null;
    onClose: () => void;
    onAdded: (preset: CustomPreset) => void;
  }

  let { open, hardware, onClose, onAdded }: Props = $props();

  let hfId = $state('');
  let checking = $state(false);
  let adding = $state(false);
  let error = $state<string | null>(null);
  let gated = $state(false);
  let check = $state<CustomModelCheck | null>(null);
  let verdict = $state<PresetCompatibility | null>(null);
  let token = $state('');
  let savingToken = $state(false);

  const checkedName = $derived(check?.hf_id ?? hfId.trim());
  const canAdd = $derived(
    !!check?.supported && (verdict ? verdictInfo(verdict.verdict).pickable : !hardware),
  );

  function reset() {
    error = null;
    gated = false;
    check = null;
    verdict = null;
  }

  function handleClose() {
    hfId = '';
    token = '';
    reset();
    onClose();
  }

  async function handleCheck() {
    if (checking) return;
    const name = hfId.trim();
    reset();
    if (!looksLikeHfId(name)) {
      error = "That doesn't look like a Hugging Face model name. Names look like 'organization/model-name', for example EleutherAI/pythia-160m-deduped.";
      return;
    }
    checking = true;
    try {
      const result = await checkCustomModel(name);
      check = result;
      if (result.supported && result.vram_estimate_mb != null && hardware) {
        verdict = await evaluateCustomModel(result.hf_id, result.vram_estimate_mb, result.cpu_ok, hardware);
      }
    } catch (e) {
      if (e instanceof CustomModelCheckError) {
        error = e.message;
        gated = e.gated;
      } else {
        error = friendlyError(e instanceof Error ? e.message : String(e)).message;
      }
    } finally {
      checking = false;
    }
  }

  async function handleSaveToken() {
    const t = token.trim();
    if (!/^hf_[A-Za-z0-9]{20,}$/.test(t)) {
      error = "That doesn't look like a Hugging Face token (they start with hf_ and are at least 20 characters).";
      return;
    }
    savingToken = true;
    try {
      // Restarts Pry's engine so it picks up the token; then check again.
      await saveHfToken(t);
      token = '';
      await handleCheck();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      savingToken = false;
    }
  }

  async function handleAdd() {
    if (adding || !check?.supported) return;
    adding = true;
    try {
      const preset = await addCustomModel(check.hf_id, {
        architecture: check.architecture,
        n_params: check.n_params,
        params_label: check.params_label,
        vram_estimate_mb: check.vram_estimate_mb,
        cpu_ok: check.cpu_ok,
      });
      onAdded(preset);
      handleClose();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      adding = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !checking) handleCheck();
  }

  // Escape closes from anywhere in the dialog, not just the input.
  function onWindowKeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') handleClose();
  }

  const TONE_CLS: Record<string, string> = {
    good: 'border-green-700 bg-green-900/40 text-green-300',
    warn: 'border-yellow-700 bg-yellow-900/40 text-yellow-300',
    cpu: 'border-sky-700 bg-sky-900/40 text-sky-300',
    bad: 'border-red-700 bg-red-900/40 text-red-300',
    soon: 'border-zinc-700 bg-zinc-800 text-zinc-400',
  };
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if open}
  <!-- Backdrop: click outside closes; Escape is handled on window. -->
  <div
    role="presentation"
    class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-8"
    onclick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
  >
    <!-- Dialog card -->
    <div
      class="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-model-title"
    >
      <h2 id="custom-model-title" class="mb-2 text-base font-semibold text-zinc-100">
        Add a model from Hugging Face
      </h2>
      <p class="mb-4 text-xs text-zinc-400">
        Pry can open other text-generating models that TransformerLens (the library Pry uses to look inside
        models) knows how to load. They come without a feature dictionary, so some panels won't work.
      </p>

      <!-- What works / what doesn't -->
      <div class="mb-4 grid grid-cols-1 gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-xs sm:grid-cols-2" data-tip="custom-model-verdict">
        <div>
          <p class="mb-1 font-medium text-zinc-300">Works</p>
          <ul class="list-disc space-y-0.5 pl-4 text-zinc-400">
            {#each CUSTOM_MODEL_WORKS as item}<li>{item}</li>{/each}
          </ul>
        </div>
        <div>
          <p class="mb-1 font-medium text-zinc-300">Needs a feature dictionary (not available)</p>
          <ul class="list-disc space-y-0.5 pl-4 text-zinc-500">
            {#each CUSTOM_MODEL_MISSING as item}<li>{item}</li>{/each}
          </ul>
        </div>
      </div>

      <!-- Input -->
      <label for="hf-model-id" class="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
        Hugging Face model name
      </label>
      <div class="mb-1.5 flex gap-2">
        <!-- Moving focus into a dialog when it opens is the expected dialog
             behaviour (WAI-ARIA dialog pattern), so a11y_autofocus is a false positive here. -->
        <!-- svelte-ignore a11y_autofocus -->
        <input
          id="hf-model-id"
          type="text"
          bind:value={hfId}
          oninput={reset}
          onkeydown={handleKeydown}
          placeholder="e.g. EleutherAI/pythia-160m-deduped"
          autofocus
          class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          onclick={handleCheck}
          disabled={checking || !hfId.trim()}
          class="shrink-0 rounded-md border border-indigo-700 bg-indigo-900/40 px-3 py-2 text-sm text-indigo-200 hover:bg-indigo-800/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {#if checking}
            <span class="inline-flex items-center gap-1.5">
              <span class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-200 border-t-transparent"></span>
              Checking…
            </span>
          {:else}
            Check
          {/if}
        </button>
      </div>
      <p class="mb-4 text-xs text-zinc-500">
        The part after huggingface.co/ in the model's web address. Checking downloads only its small settings file.
      </p>

      <!-- Result -->
      {#if check}
        <div class="mb-4 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs" role="status">
          <p class="font-mono text-zinc-200">{checkedName}</p>
          <p class="mt-0.5 text-zinc-500">
            {check.architecture}{#if check.params_label} · about {check.params_label} parameters{/if}{#if check.n_layers} · {check.n_layers} layers{/if}
          </p>
          {#if !check.supported}
            <p class="mt-1.5 text-red-400">{check.message}</p>
          {:else if verdict}
            {@const info = verdictInfo(verdict.verdict)}
            <p class="mt-1.5">
              <span class="rounded border px-2 py-0.5 {TONE_CLS[info.tone]}">{info.label}</span>
              <span class="ml-1 text-zinc-500">needs about {Math.ceil((check.vram_estimate_mb ?? 0) / 100) / 10} GB of memory</span>
            </p>
            {#each visibleNotes(verdict) as note}
              <p class="mt-1 text-zinc-500">{note}</p>
            {/each}
          {:else}
            <p class="mt-1.5 text-zinc-400">{check.message}</p>
          {/if}
        </div>
      {/if}

      <!-- Error (plain language), with the token step for gated models -->
      {#if error}
        <div class="mb-4 rounded-md border border-red-800 bg-red-950/40 px-3 py-2" role="alert">
          <p class="text-xs text-red-400">{error}</p>
        </div>
      {/if}
      {#if gated}
        <div class="mb-4 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-400">
          <p class="mb-1 font-medium text-zinc-300">Give Pry a Hugging Face access token</p>
          <ol class="mb-2 list-decimal space-y-0.5 pl-4">
            <li>On huggingface.co, sign in and accept the model's terms on its page.</li>
            <li>Go to Settings → Access Tokens on huggingface.co and create a token with "Read" access.</li>
            <li>Paste it below. Pry keeps it on this computer and restarts its engine to use it.</li>
          </ol>
          <div class="flex gap-2">
            <label for="hf-token" class="sr-only">Hugging Face access token</label>
            <input
              id="hf-token"
              type="password"
              bind:value={token}
              placeholder="hf_…"
              autocomplete="off"
              class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
            />
            <button
              onclick={handleSaveToken}
              disabled={savingToken || !token.trim()}
              class="shrink-0 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
            >
              {savingToken ? 'Saving…' : 'Save and check again'}
            </button>
          </div>
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
          disabled={!canAdd || adding}
          title={check?.supported ? '' : 'Check the model first'}
          class="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {adding ? 'Adding…' : 'Add model'}
        </button>
      </div>
    </div>
  </div>
{/if}
