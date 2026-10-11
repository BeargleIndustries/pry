<script lang="ts">
  // T31: explains the two setup steps a gated model (Gemma) needs before
  // Pry can download it. Pry only links to Hugging Face; the user accepts
  // Google's license in their own browser.
  import { onMount } from 'svelte';
  import { Check, ExternalLink, Key } from 'lucide-svelte';
  import { hasHfToken } from '$lib/tauri';
  import { health } from '$lib/sidecar';
  import { GEMMA_LICENSE_URL, openExternal, type GateStep } from '$lib/hf-gate';

  interface Props {
    /** Model name, e.g. "Gemma 2 2B". */
    name: string;
    /** The step a failed load said is missing, if any. */
    missing?: GateStep | null;
    /** Go to the Hugging Face token step. */
    onAddToken: () => void;
  }

  let { name, missing = null, onAddToken }: Props = $props();

  // null while checking. Rust's saved-token check is the source of truth; the
  // engine's /health flag is the fallback outside Tauri.
  let tokenSaved = $state<boolean | null>(null);

  onMount(async () => {
    try {
      tokenSaved = await hasHfToken();
      if (!tokenSaved) tokenSaved = (await health()).hf_token_present ?? false;
    } catch {
      try {
        tokenSaved = (await health()).hf_token_present ?? false;
      } catch {
        tokenSaved = false;
      }
    }
  });

  const licenseFlag = $derived(missing === 'license');
  const tokenFlag = $derived(missing === 'token');
</script>

<div class="space-y-3 text-sm" data-testid="license-gate">
  <p class="text-zinc-300">
    {name} is made by Google. Before anyone can download it, Google asks you to accept its license on
    Hugging Face, the site that hosts the model. Pry can't do this for you: it happens in your own browser,
    with your own free Hugging Face account. Then Pry needs a Hugging Face token so it can download the
    model on your behalf. The token stays on this computer.
  </p>

  <ol class="space-y-2">
    <li
      class="flex items-start gap-3 rounded-lg border p-3 {licenseFlag
        ? 'border-amber-600 bg-amber-950/30'
        : 'border-zinc-800 bg-zinc-950/40'}"
    >
      <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 font-mono text-xs text-white">1</span>
      <div class="flex-1 text-zinc-300">
        <div>Accept Google's Gemma license on Hugging Face (sign in or make a free account first).</div>
        {#if licenseFlag}
          <div class="mt-1 text-amber-300">This is the step that's missing: your token works, but the license isn't accepted yet.</div>
        {/if}
        <button
          type="button"
          onclick={() => openExternal(GEMMA_LICENSE_URL)}
          class="mt-1.5 inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
        >
          Open huggingface.co/google/gemma-2-2b in your browser <ExternalLink class="h-3 w-3" />
        </button>
        <div class="mt-1 text-xs text-zinc-500">Pry can't see whether you've accepted it. If you haven't, the download stops and Pry tells you.</div>
      </div>
    </li>
    <li
      class="flex items-start gap-3 rounded-lg border p-3 {tokenFlag
        ? 'border-amber-600 bg-amber-950/30'
        : 'border-zinc-800 bg-zinc-950/40'}"
    >
      <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 font-mono text-xs text-white">2</span>
      <div class="flex-1 text-zinc-300">
        <div>Give Pry a Hugging Face read token.</div>
        {#if tokenFlag}
          <div class="mt-1 text-amber-300">This is the step that's missing: Pry has no token, or Hugging Face didn't accept the saved one.</div>
        {/if}
        <div class="mt-1 flex items-center gap-3">
          {#if tokenSaved === null}
            <span class="text-xs text-zinc-500">Checking for a saved token…</span>
          {:else if tokenSaved}
            <span class="inline-flex items-center gap-1 text-xs text-green-400"><Check class="h-3 w-3" /> A token is saved.</span>
          {:else}
            <span class="text-xs text-zinc-500">No token saved yet.</span>
          {/if}
          <button
            type="button"
            onclick={onAddToken}
            class="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
          >
            <Key class="h-3 w-3" /> {tokenSaved ? 'Replace token' : 'Add token'}
          </button>
        </div>
      </div>
    </li>
  </ol>
</div>
