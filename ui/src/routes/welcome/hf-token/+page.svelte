<script lang="ts">
  import { goto } from '$app/navigation';
  import { ArrowLeft, ExternalLink, Key } from 'lucide-svelte';
  import { saveHfToken } from '$lib/tauri';

  let token = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);

  async function save() {
    const trimmed = token.trim();
    if (!trimmed) {
      error = 'Paste a token first.';
      return;
    }
    if (!/^hf_[A-Za-z0-9]{20,}$/.test(trimmed)) {
      error = 'That doesn\'t look like a valid HuggingFace token (expected hf_… with at least 20 characters).';
      return;
    }
    saving = true;
    error = null;
    try {
      await saveHfToken(trimmed);
      goto('/welcome/downloading');
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  function back() {
    goto('/welcome/preset');
  }
</script>

<div class="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-8 backdrop-blur">
  <div class="mb-1 font-mono text-xs uppercase tracking-widest text-indigo-400">step 04b</div>
  <h2 class="mb-2 text-2xl font-semibold text-zinc-100">HuggingFace access</h2>
  <p class="mb-6 text-sm text-zinc-400">
    Gemma is a gated model. Google asks you to accept the license before downloading, which means
    Pry needs your HuggingFace token to pull the weights on your behalf. The token stays on your
    machine.
  </p>

  <!-- Instructions -->
  <div class="mb-6 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 text-sm">
    <div class="flex items-start gap-3">
      <div class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 font-mono text-xs text-white">
        1
      </div>
      <div class="text-zinc-300">
        Accept the Gemma license on HuggingFace (requires an account).
        <a
          href="https://huggingface.co/google/gemma-2-2b"
          target="_blank"
          rel="noopener"
          class="ml-1 inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
        >
          huggingface.co/google/gemma-2-2b <ExternalLink class="h-3 w-3" />
        </a>
      </div>
    </div>
    <div class="flex items-start gap-3">
      <div class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 font-mono text-xs text-white">
        2
      </div>
      <div class="text-zinc-300">
        Create a read token.
        <a
          href="https://huggingface.co/settings/tokens"
          target="_blank"
          rel="noopener"
          class="ml-1 inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
        >
          huggingface.co/settings/tokens <ExternalLink class="h-3 w-3" />
        </a>
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
      HuggingFace token
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
    <button
      onclick={save}
      disabled={saving || !token.trim()}
      class="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {saving ? 'Saving…' : 'Save & continue'}
    </button>
  </div>
</div>
