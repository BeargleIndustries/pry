<!--
  Settings > Lessons (plan T3): sidebar side, author mode, lessons waiting for
  the learner's OK, add / open folder / reload / authoring guide / linter
  command, and per user lesson its declared and granted permissions with
  Revoke, "Check this lesson" (full strict + copy lint) and Remove.
  Tool-neutral: every action comes in as a prop.
-->
<script module lang="ts">
  import type { Permissions } from './grants';

  export interface UserLessonRow {
    id: string;
    title: string;
    declared: Permissions;
    granted: Permissions;
    error: string | null;
  }
</script>

<script lang="ts">
  import { lessonsCopy as c } from './copy';
  import type { Side } from './layout';

  interface Props {
    side: Side;
    onSide: (s: Side) => void;
    authorMode: boolean;
    onAuthorMode: (on: boolean) => void;
    pending: number;
    onReview: () => void;
    userLessons: UserLessonRow[];
    onAdd?: () => void;
    onOpenFolder?: () => void;
    onReload?: () => void;
    onGuide?: () => void;
    onCopyLinter?: () => Promise<void> | void;
    onRevoke: (id: string) => void;
    onCheck: (id: string) => Promise<string[]>;
    onRemove: (id: string) => void;
  }

  let {
    side,
    onSide,
    authorMode,
    onAuthorMode,
    pending,
    onReview,
    userLessons,
    onAdd,
    onOpenFolder,
    onReload,
    onGuide,
    onCopyLinter,
    onRevoke,
    onCheck,
    onRemove,
  }: Props = $props();

  let checks = $state<Record<string, string[]>>({});
  let copied = $state(false);

  const words = (p: Permissions) => {
    const out: string[] = [];
    for (const x of p.download ?? []) out.push(c.permDownload(x));
    for (const x of p.network ?? []) out.push(c.permNetwork(x));
    for (const x of p.external ?? []) out.push(c.permExternal(x));
    for (const x of p.cost ?? []) out.push(c.permCost(x));
    return out;
  };

  async function check(id: string) {
    checks = { ...checks, [id]: await onCheck(id) };
  }

  async function copy() {
    await onCopyLinter?.();
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<section class="mb-6" data-testid="settings-lessons" aria-labelledby="settings-lessons-heading">
  <h3 id="settings-lessons-heading" class="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">{c.settingsHeading}</h3>

  <div class="mb-3">
    <p id="lessons-side-label" class="text-sm text-zinc-200">{c.sideLabel}</p>
    <div class="mt-1 inline-flex rounded-md border border-zinc-700 p-0.5" role="radiogroup" aria-labelledby="lessons-side-label">
      {#each [['left', c.sideLeft], ['right', c.sideRight]] as [value, label] (value)}
        <button
          type="button"
          role="radio"
          aria-checked={side === value}
          onclick={() => onSide(value as Side)}
          class="rounded px-3 py-1 text-xs {side === value ? 'bg-indigo-600 text-white' : 'text-zinc-300 hover:bg-zinc-800'}"
        >{label}</button>
      {/each}
    </div>
    <p class="mt-1 text-xs text-zinc-400">{c.sideHint}</p>
  </div>

  <label class="mb-3 flex items-start gap-2 text-sm text-zinc-200">
    <input type="checkbox" checked={authorMode} onchange={(e) => onAuthorMode((e.currentTarget as HTMLInputElement).checked)} class="mt-1 accent-indigo-500" />
    <span>{c.authorMode}<span class="block text-xs text-zinc-400">{c.authorModeHint}</span></span>
  </label>

  {#if pending > 0}
    <button type="button" onclick={onReview} class="mb-3 w-full rounded-md border border-amber-700/60 bg-amber-950/40 px-3 py-2 text-left text-xs text-amber-200 hover:bg-amber-900/40">
      {c.needsOk(pending)} · {c.review}
    </button>
  {/if}

  <div class="mb-3 flex flex-wrap gap-2">
    {#if onAdd}<button type="button" onclick={onAdd} class="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800">{c.addLesson}</button>{/if}
    {#if onOpenFolder}<button type="button" onclick={onOpenFolder} class="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800">{c.openFolder}</button>{/if}
    {#if onReload}<button type="button" onclick={onReload} class="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800">{c.reload}</button>{/if}
    {#if onGuide}<button type="button" onclick={onGuide} class="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800">{c.authoringGuide}</button>{/if}
    {#if onCopyLinter}<button type="button" onclick={copy} class="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800">{copied ? c.copied : c.copyLinter}</button>{/if}
  </div>

  <p class="text-xs font-medium text-zinc-300">{c.yourLessons}</p>
  {#if userLessons.length === 0}
    <p class="mt-1 text-xs text-zinc-400">{c.noUserLessons}</p>
  {/if}
  <ul class="mt-1 flex flex-col gap-2">
    {#each userLessons as l (l.id)}
      <li class="rounded-md border border-zinc-800 p-2 text-xs text-zinc-300">
        <p class="font-medium text-zinc-200">{l.title}</p>
        {#if l.error}<p class="mt-0.5 break-words font-mono text-[11px] text-zinc-400">{l.error}</p>{/if}
        <p class="mt-1 text-zinc-400">{c.asksFor}: {words(l.declared).join('; ') || c.nothingGated}</p>
        <p class="text-zinc-400">{c.allowed}: {words(l.granted).join('; ') || c.nothingGated}</p>
        <div class="mt-1.5 flex flex-wrap gap-2">
          <button type="button" onclick={() => onRevoke(l.id)} class="rounded border border-zinc-700 px-2 py-0.5 hover:bg-zinc-800">{c.revoke}</button>
          <button type="button" onclick={() => check(l.id)} class="rounded border border-zinc-700 px-2 py-0.5 hover:bg-zinc-800">{c.checkLesson}</button>
          <button type="button" onclick={() => onRemove(l.id)} class="rounded border border-red-900/70 px-2 py-0.5 text-red-300 hover:bg-red-950/40">{c.removeLesson}</button>
        </div>
        {#if checks[l.id]}
          <div class="mt-1.5" aria-live="polite">
            {#if checks[l.id].length === 0}<p class="text-emerald-300">{c.checkClean}</p>{:else}
              <p class="text-amber-200">{c.checkProblems(checks[l.id].length)}</p>
              <ul class="mt-0.5 list-disc pl-4 font-mono text-[11px] text-zinc-400">{#each checks[l.id] as p, i (i)}<li>{p}</li>{/each}</ul>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</section>
