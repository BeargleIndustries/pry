<!--
  LessonRail (plan D2): the 44px strip Lessons collapses to on its outer edge,
  when the learner shrinks it or a window resize leaves the workspace under
  640px. One button opens it again.
-->
<script lang="ts">
  import { GraduationCap } from 'lucide-svelte';
  import { lessonsCopy } from './copy';

  interface Props {
    title?: string | null;
    onExpand: () => void;
  }

  let { title = null, onExpand }: Props = $props();
</script>

<div class="flex h-full w-full flex-col items-center gap-3 bg-zinc-950 py-3" data-testid="lesson-rail">
  <button
    type="button"
    onclick={onExpand}
    aria-label={lessonsCopy.expand}
    title={lessonsCopy.expand}
    class="rounded-md p-1.5 text-indigo-300 hover:bg-zinc-800 hover:text-indigo-200"
  >
    <GraduationCap class="h-5 w-5" />
  </button>
  {#if title}
    <span class="pry-rail-title select-none text-[11px] text-zinc-400" aria-hidden="true">{title}</span>
  {/if}
</div>

<style>
  .pry-rail-title {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    max-height: 60vh;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
