<!--
  Term (T30): a glossary word with a dotted underline. Hover or keyboard focus
  shows its plain-language definition from $lib/glossary; Escape hides it.
  The definition is always in the DOM (hidden when closed) and linked with
  aria-describedby, so screen readers read it on focus. The tooltip uses
  position: fixed, so panels with overflow don't clip it; placePopup puts it
  below the word, flips it above near the bottom of the window, keeps it inside
  the window and off occupied areas (the experiment guide, the update banner).
  It never takes focus. z-[70] sits above FirstTimeTip (z-60) and dialogs (z-50).
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { lookupTerm } from '$lib/glossary';
  import { placePopup, type Placement } from '$lib/popup/place';
  import { placementAttrs, viewportSize } from '$lib/popup/measure';
  import { occupied } from '$lib/popup/occupied.svelte';

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
  let tipEl: HTMLSpanElement | null = $state(null);
  let hovered = $state(false);
  let focused = $state(false);
  let dismissed = $state(false);
  /** Current placement; null until measured, or when there's nowhere to put it. */
  let pos = $state<Placement | null>(null);

  const open = $derived(entry !== null && (hovered || focused) && !dismissed);

  function place() {
    if (!anchor || !tipEl) return;
    const r = anchor.getBoundingClientRect();
    const next = placePopup({
      target: r.width || r.height ? r : null,
      size: { w: tipEl.offsetWidth || MAX_W, h: tipEl.offsetHeight || EST_H },
      viewport: viewportSize(),
      preferred: 'bottom',
      previousSide: pos?.side,
      previousMode: pos?.mode,
      gap: GAP,
      edgePad: EDGE,
      avoid: occupied.rects(),
    });
    // A glossary tooltip is never shown without its word on screen.
    pos = next.mode === 'fallback' ? null : next;
  }

  function show(kind: 'hover' | 'focus') {
    dismissed = false;
    if (kind === 'hover') hovered = true;
    else focused = true;
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

  // Place once the tooltip is laid out (it has to be visible to measure), then
  // follow scrolling and resizing while it's open.
  $effect(() => {
    if (!open || !tipEl) {
      pos = null;
      return;
    }
    untrack(place);
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
    data-tour="glossary-term"
    tabindex="0"
    aria-describedby={tipId}
    class="cursor-help underline decoration-dotted decoration-zinc-500 underline-offset-2 focus:outline-none focus-visible:rounded-sm focus-visible:ring-1 focus-visible:ring-indigo-400"
    {@attach listeners}
    role="term"
  >{#if children}{@render children()}{:else}{entry.term}{/if}</span><span
    bind:this={tipEl}
    id={tipId}
    role="tooltip"
    data-popup="term"
    class="pointer-events-none fixed z-[70] rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-left text-xs font-normal normal-case leading-snug tracking-normal text-zinc-200 shadow-xl {open ? 'block' : 'hidden'}"
    style:left="{pos?.left ?? 0}px"
    style:top="{pos?.top ?? 0}px"
    style:max-width="{Math.min(MAX_W, (typeof window === 'undefined' ? MAX_W + EDGE * 2 : window.innerWidth) - EDGE * 2)}px"
    style:visibility={pos ? 'visible' : 'hidden'}
    {...placementAttrs(pos, null)}
  >{entry.definition}</span>
{:else}
  {#if children}{@render children()}{:else}{key}{/if}
{/if}
