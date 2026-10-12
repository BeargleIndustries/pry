<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { ArrowLeft, ExternalLink, Key, Loader2 } from 'lucide-svelte';
  import { hasHfToken, saveHfToken } from '$lib/tauri';
  import { GEMMA_LICENSE_URL, HF_TOKENS_URL, openExternal } from '$lib/hf-gate';

  let token = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);
  let tokenSaved = $state(false);

  // Opened from the app's model switcher (?next=app): return there afterwards
  // instead of continuing onboarding.
  const fromApp = $derived($page.url.searchParams.get('next') === 'app');

  onMount(async () => {
    try {
      tokenSaved = await hasHfToken();
    } catch {
      tokenSaved = false;
    }
  });

  function next() {
    goto(fromApp ? '/' : '/welcome/downloading');
  }

  async function save() {
    const trimmed = token.trim();
    if (!trimmed) {
      error = 'Paste a token first.';
      return;
    }
    if (!/^hf_[A-Za-z0-9]{20,}$/.test(trimmed)) {
      error = 'That doesn\'t look like a valid Hugging Face token (expected hf_… with at least 20 characters).';
      return;
    }
    saving = true;
    error = null;
    try {
      await saveHfToken(trimmed);
      next();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  function back() {
    goto(fromApp ? '/' : '/welcome/preset');
  }
</script>

<div class="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-8 backdrop-blur">
  <div class="mb-1 font-mono text-xs uppercase tracking-widest text-indigo-400">step 04b</div>
  <h2 class="mb-2 text-2xl font-semibold text-zinc-100">Hugging Face access</h2>
  <p class="mb-6 text-sm text-zinc-400">
    Gemma needs permission before you can download it. Google asks you to accept its license on Hugging Face before downloading,
    and Pry needs your Hugging Face token to download the weights on your behalf. The token stays on
    this computer.
  </p>
  {#if tokenSaved}
    <p class="mb-4 text-sm text-green-400">
      A token is already saved. Paste a new one below to replace it, or keep the saved one.
    </p>
  {/if}

  <!-- Instructions -->
  <div class="mb-6 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 text-sm">
    <div class="flex items-start gap-3">
      <div class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 font-mono text-xs text-white">
        1
      </div>
      <div class="text-zinc-300">
        Accept the Gemma license on Hugging Face, in your own browser (requires a free account).
        <button
          type="button"
          onclick={() => openExternal(GEMMA_LICENSE_URL)}
          class="ml-1 inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
        >
          huggingface.co/google/gemma-2-2b <ExternalLink class="h-3 w-3" />
        </button>
      </div>
    </div>
    <div class="flex items-start gap-3">
      <div class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 font-mono text-xs text-white">
        2
      </div>
      <div class="text-zinc-300">
        Create a read token.
        <button
          type="button"
          onclick={() => openExternal(HF_TOKENS_URL)}
          class="ml-1 inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
        >
          huggingface.co/settings/tokens <ExternalLink class="h-3 w-3" />
        </button>
      </div>
    </div>
    <div class="flex items-start gap-3">
      <div class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 font-mono text-xs text-white">
        3
      </div>
      <div class="text-zinc-300">Paste it below.</div>
    </div>
  </div>

  <!-- Token input -->
  <label class="mb-6 block">
    <span class="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
      <Key class="h-3.5 w-3.5" />
      Hugging Face token
    </span>
    <input
      type="password"
      bind:value={token}
      placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      class="w-full rounded-lg border border-zinc-800 bg-black/40 px-4 py-3 font-mono text-sm text-zinc-100 placeholder:text-zinc-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
    />
  </label>

  {#if error}
    <div class="mb-4 rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">
      {error}
    </div>
  {/if}

  <div class="flex items-center justify-between border-t border-zinc-800 pt-6">
    <button
      onclick={back}
      class="inline-flex items-center gap-2 rounded-lg bg-zinc-800 px-5 py-2 text-sm text-zinc-300 transition hover:bg-zinc-700"
    >
      <ArrowLeft class="h-4 w-4" /> Back
    </button>
    {#if tokenSaved && !token.trim()}
    <button
      onclick={next}
      class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white transition hover:bg-indigo-500"
    >
      Keep the saved token
    </button>
    {:else}
    <button
      onclick={save}
      disabled={saving || !token.trim()}
      class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {#if saving}
        <Loader2 class="h-4 w-4 animate-spin" /> Saving and restarting Pry's engine…
      {:else}
        Save & continue
      {/if}
    </button>
    {/if}
  </div>
</div>
