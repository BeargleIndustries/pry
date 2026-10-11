<!--
  Term (T30): a glossary word with a dotted underline. Hover or keyboard focus
  shows its plain-language definition from $lib/glossary; Escape hides it.
  The definition is always in the DOM (hidden when closed) and linked with
  aria-describedby, so screen readers read it on focus. The tooltip uses
  position: fixed, so panels with overflow don't clip it; it flips above the
  word near the bottom of the window and is clamped to the window's sides.
  It never takes focus. z-[70] sits above FirstTimeTip (z-60) and dialogs (z-50).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { lookupTerm } from '$lib/glossary';

  interface Props {
    /** Glossary key or alias, e.g. "attention-head" or "head". */
    key: string;
    children?: Snippet;
  }

  let { key, children }: Props = $props();

  const uid = $props.id();
  const tipId = `term-${uid}`;
  const entry = $derived(lookupTerm(key));

  const MAX_W = 256;
  const EST_H = 96;
  const GAP = 6;
  const EDGE = 8;

  let anchor: HTMLSpanElement | null = $state(null);
  let hovered = $state(false);
  let focused = $state(false);
  let dismissed = $state(false);
  let pos = $state<{ left: number; top?: number; bottom?: number; width: number }>({ left: 0, top: 0, width: MAX_W });

  const open = $derived(entry !== null && (hovered || focused) && !dismissed);

  function place() {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(MAX_W, vw - EDGE * 2);
    const left = Math.max(EDGE, Math.min(r.left, vw - width - EDGE));
    pos =
      r.bottom + GAP + EST_H > vh && r.top - GAP - EST_H > 0
        ? { left, bottom: vh - r.top + GAP, width }
        : { left, top: r.bottom + GAP, width };
  }

  function show(kind: 'hover' | 'focus') {
    dismissed = false;
    if (kind === 'hover') hovered = true;
    else focused = true;
    place();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      dismissed = true;
      // Only this tooltip closes; a surrounding dialog stays open.
      e.stopPropagation();
    }
  }

  function listeners(el: HTMLElement) {
    const on: [string, EventListener][] = [
      ['mouseenter', () => show('hover')],
      ['mouseleave', () => (hovered = false)],
      ['focus', () => show('focus')],
      ['blur', () => (focused = false)],
      ['keydown', (e) => onKeydown(e as KeyboardEvent)],
    ];
    for (const [type, fn] of on) el.addEventListener(type, fn);
    return () => {
      for (const [type, fn] of on) el.removeEventListener(type, fn);
    };
  }

  $effect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  });
</script>

<svelte:window onkeydown={(e) => { if (hovered && !focused) onKeydown(e); }} />

{#if entry}
  <!-- Focusable so keyboard users can reach the definition. Listeners are
       attached via {@attach}; they only show or hide the definition. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <span
    bind:this={anchor}
    tabindex="0"
    aria-describedby={tipId}
    class="cursor-help underline decoration-dotted decoration-zinc-500 underline-offset-2 focus:outline-none focus-visible:rounded-sm focus-visible:ring-1 focus-visible:ring-indigo-400"
    {@attach listeners}
    role="term"
  >{#if children}{@render children()}{:else}{entry.term}{/if}</span><span
    id={tipId}
    role="tooltip"
    class="pointer-events-none fixed z-[70] rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-left text-xs font-normal normal-case leading-snug tracking-normal text-zinc-200 shadow-xl {open ? 'block' : 'hidden'}"
    style:left="{pos.left}px"
    style:top={pos.top !== undefined ? `${pos.top}px` : null}
    style:bottom={pos.bottom !== undefined ? `${pos.bottom}px` : null}
    style:max-width="{pos.width}px"
  >{entry.definition}</span>
{:else}
  {#if children}{@render children()}{:else}{key}{/if}
{/if}
