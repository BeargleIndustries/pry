<!--
  LessonPicker (plan T3): the lesson list in the sidebar. A lesson that didn't
  load lists greyed with `file:line` and its first error (loader.ts). Drafts
  show only in author mode, with a Draft badge.
-->
<script module lang="ts">
  export interface PickerItem {
    id: string;
    title: string;
    minutes: number | null;
    draft: boolean;
    source: 'bundled' | 'user';
    error: string | null;
    visited: boolean;
    finished: boolean;
  }
</script>

<script lang="ts">
  import { lessonsCopy } from './copy';

  interface Props {
    items: PickerItem[];
    pending?: number;
    onPick: (id: string) => void;
    onReview?: () => void;
  }

  let { items, pending = 0, onPick, onReview }: Props = $props();
</script>

<div class="flex flex-col gap-2 p-3" data-testid="lesson-picker">
  <h2 class="text-sm font-semibold text-zinc-100" tabindex="-1" data-lesson-heading>{lessonsCopy.pickHeading}</h2>
  {#if pending > 0 && onReview}
    <button
      type="button"
      onclick={onReview}
      class="rounded-md border border-amber-700/60 bg-amber-950/40 px-3 py-2 text-left text-xs text-amber-200 hover:bg-amber-900/40"
    >
      {lessonsCopy.needsOk(pending)}
    </button>
  {/if}
  {#if items.length === 0}
    <p class="text-xs text-zinc-400">{lessonsCopy.noLessons}</p>
  {/if}
  <ul class="flex flex-col gap-1">
    {#each items as it (it.id + it.source)}
      <li>
        {#if it.error}
          <div class="rounded-md border border-zinc-800 px-3 py-2 text-xs text-zinc-400" aria-disabled="true">
            <p class="font-medium text-zinc-400">{it.title}</p>
            <p class="mt-0.5 break-words font-mono text-[11px]">{it.error}</p>
          </div>
        {:else}
          <button
            type="button"
            onclick={() => onPick(it.id)}
            class="flex w-full items-center justify-between gap-2 rounded-md border border-zinc-800 px-3 py-2 text-left text-xs text-zinc-200 hover:border-indigo-600 hover:bg-zinc-900"
            data-lesson-id={it.id}
          >
            <span class="min-w-0">
              <span class="block truncate font-medium">{it.title}</span>
              {#if it.minutes}<span class="text-[11px] text-zinc-400">{lessonsCopy.minutes(it.minutes)}</span>{/if}
            </span>
            <span class="flex flex-shrink-0 items-center gap-1">
              {#if it.draft}<span class="rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] text-amber-200">{lessonsCopy.draft}</span>{/if}
              {#if it.finished}<span class="text-emerald-400" aria-label={lessonsCopy.done}>✓</span>{/if}
            </span>
          </button>
        {/if}
      </li>
    {/each}
  </ul>
</div>
