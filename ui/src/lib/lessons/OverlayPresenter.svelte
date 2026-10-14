<!--
  OverlayPresenter: draws an overlay lesson (the quick tour) as one card per
  H2 section over the app, implementing the runner's `Presenter` interface
  (contract.ts). Card shell and placement are DrivenTutorial's, Pry-free: the
  tool's anchors and a way to run an action (for an anchor's `reveal`) come in
  as props, so nothing here imports Pry code.

  A section with no `:look` is a centred card. `point(target, seq)` with a
  `seq` adds the next pointer of a sequence (`at=[a, b]`): earlier ones keep
  their ring, the card follows the latest. A pointed anchor that isn't on
  screen (a tab hidden at 1024 wide) runs its `reveal` once, then is found.
-->
<script module lang="ts">
  import type { Section } from './format/schema';
  import type { AnchorDef, PointerTarget, Presenter, PresenterCommand, RenderedStep } from './registry/contract';

  export const TOUR_SEEN_KEY = 'pry:tutorial_seen';

  export const overlayUi = {
    cardLabel: 'Quick tour',
    stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
    back: 'Back',
    next: 'Next',
    done: 'Done',
    skip: 'Skip tour',
    skipHint: 'The Help menu brings the tour back whenever you want.',
  };

  type Nav = { index: number; total: number; canBack: boolean };

  /** True when any prose in the section carries a `:look` pointer. */
  export function hasLook(section: Section): boolean {
    const walk = (steps: Section['steps']): boolean =>
      steps.some((s) => s.prose.some((p) => p.inline.some((n) => n.type === 'look')) || walk(s.children));
    return walk(section.steps);
  }

  /** Presenter state. The component wraps one; tests drive it directly. */
  export class OverlayModel implements Presenter {
    section = $state<Section | null>(null);
    nav = $state<Nav>({ index: 0, total: 0, canBack: false });
    pointers = $state<PointerTarget[]>([]);
    #handlers: ((c: PresenterCommand) => void)[] = [];

    show(step: RenderedStep, nav: Nav): void {
      this.section = step.section;
      this.nav = nav;
      this.pointers = [];
    }

    point(target: PointerTarget, seq?: number): void {
      this.pointers = seq === undefined ? [target] : [...this.pointers.slice(0, seq), target];
    }

    clearPointer(): void {
      this.pointers = [];
    }

    onCommand(cb: (c: PresenterCommand) => void): void {
      this.#handlers.push(cb);
    }

    command(c: PresenterCommand): void {
      for (const h of this.#handlers) h(c);
    }

    /** "Skip tour", Escape and Done all leave the tour; leaving marks it seen. */
    leave(c: 'skip' | 'next'): void {
      try {
        localStorage.setItem(TOUR_SEEN_KEY, 'true');
      } catch {
        /* storage unavailable */
      }
      this.command(c);
    }
  }
</script>

<script lang="ts">
  import Pointer from '../components/Pointer.svelte';
  import { arrowShown, DEFAULT_SHEET_BELOW, placePopup, type Placement, type RectLike } from '../popup/place';
  import { occupied, OCCUPIED } from '../popup/occupied.svelte';

  interface Props {
    model?: OverlayModel;
    /** The tool's anchors (ToolActionSet.anchors). */
    anchors?: Record<string, AnchorDef>;
    /** Runs a tool action by name; used for an anchor's `reveal`. */
    runAction?: (name: string, args: unknown) => Promise<void>;
  }

  let { model = new OverlayModel(), anchors = {}, runAction }: Props = $props();

  export function show(step: RenderedStep, nav: Nav) {
    model.show(step, nav);
  }
  export function point(target: PointerTarget, seq?: number) {
    model.point(target, seq);
  }
  export function clearPointer() {
    model.clearPointer();
  }
  export function onCommand(cb: (c: PresenterCommand) => void) {
    model.onCommand(cb);
  }

  const section = $derived(model.section);
  const nav = $derived(model.nav);
  const isFinal = $derived(nav.index >= nav.total - 1);
  const centred = $derived(!!section && model.pointers.length === 0 && !hasLook(section));

  /** Prose split into text and inline pieces; `:look` shows its label. */
  type Piece = { kind: 'text' | 'look' | 'code'; text: string };
  const paragraphs = $derived.by(() => {
    if (!section) return [] as Piece[][];
    const out: Piece[][] = [];
    const walk = (steps: Section['steps']) => {
      for (const s of steps) {
        for (const p of s.prose) {
          const pieces: Piece[] = [];
          let at = 0;
          for (const n of p.inline) {
            if (n.start > at) pieces.push({ kind: 'text', text: p.text.slice(at, n.start) });
            const label = n.label ?? (n.type === 'slot' ? `{${n.name}}` : p.text.slice(n.start, n.end));
            pieces.push({ kind: n.type === 'look' ? 'look' : n.type === 'code' ? 'code' : 'text', text: label });
            at = n.end;
          }
          if (at < p.text.length) pieces.push({ kind: 'text', text: p.text.slice(at) });
          out.push(pieces);
        }
        walk(s.children);
      }
    };
    walk(section.steps);
    return out;
  });

  // ---- Find each pointed anchor; re-find it if it re-renders ----
  let found = $state<(HTMLElement | null)[]>([]);

  const visible = (el: HTMLElement | null): el is HTMLElement => !!el && el.isConnected && el.getClientRects().length > 0;

  $effect(() => {
    const targets = model.pointers;
    const revealed = new Set<string>();
    let els: (HTMLElement | null)[] = [];
    const locate = (t: PointerTarget): HTMLElement | null => {
      if (!('anchor' in t)) return null;
      const def = anchors[t.anchor];
      if (!def) return null;
      const el = def.locate(t.args);
      if (visible(el)) return el;
      // Hidden (a narrow window's other tab): reveal once, the next pass finds it.
      if (def.reveal && runAction && !revealed.has(t.anchor)) {
        revealed.add(t.anchor);
        runAction(def.reveal.action, def.reveal.args).catch((e) => console.warn('overlay reveal error', e));
      }
      return null;
    };
    const find = () => {
      const next = targets.map((t, i) => (visible(els[i]) ? els[i] : locate(t)));
      if (next.length !== els.length || next.some((el, i) => el !== els[i])) {
        els = next;
        found = next;
      }
    };
    find();
    const timer = setInterval(find, 250);
    return () => {
      clearInterval(timer);
      found = [];
    };
  });

  /** The pointer the card follows: the latest of a sequence. */
  const activeIndex = $derived(model.pointers.length - 1);
  const activeEl = $derived(found[activeIndex] ?? null);
  const activeDef = $derived.by(() => {
    const t = model.pointers[activeIndex];
    return t && 'anchor' in t ? anchors[t.anchor] : undefined;
  });

  $effect(() => {
    const el = activeEl;
    if (!el) return;
    const instant = window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.innerWidth < DEFAULT_SHEET_BELOW;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: instant ? 'auto' : 'smooth' });
  });

  // ---- Card placement (placePopup), as DrivenTutorial ----
  let cardEl: HTMLDivElement | null = $state(null);
  let placed = $state<Placement | null>(null);

  function rectOf(el: HTMLElement | null): RectLike | null {
    if (!visible(el)) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  $effect(() => {
    if (!section || centred) {
      placed = null;
      return;
    }
    let prev: Placement | null = null; // hysteresis is per step
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!cardEl) return;
      const t = rectOf(activeEl);
      const [fx, fy] = activeDef?.focus ?? [0.5, 0.5];
      const next = placePopup({
        target: t,
        focus: t ? { x: t.left + t.width * fx, y: t.top + t.height * fy } : undefined,
        size: { w: cardEl.offsetWidth, h: cardEl.offsetHeight },
        viewport: { w: window.innerWidth, h: window.innerHeight },
        preferred: 'bottom',
        previousSide: prev?.side,
        previousMode: prev?.mode,
        avoid: occupied.rects([OCCUPIED.tourCard]),
        sheetBelow: DEFAULT_SHEET_BELOW,
        large: activeDef?.large === true,
      });
      prev = next;
      if (
        !placed ||
        placed.mode !== next.mode ||
        Math.round(placed.top) !== Math.round(next.top) ||
        Math.round(placed.left) !== Math.round(next.left) ||
        Math.round(placed.width) !== Math.round(next.width) ||
        placed.caretEdge !== next.caretEdge ||
        Math.round(placed.caret) !== Math.round(next.caret)
      ) {
        placed = next;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

  $effect(() => {
    if (!cardEl) return;
    return occupied.registerElement(OCCUPIED.tourCard, cardEl);
  });

  /** Arrow only when short (rule 6); the ring always shows. */
  const showArrow = $derived(arrowShown(placed));

  $effect(() => {
    if (!section) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      model.leave('skip');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function handleNext() {
    if (isFinal) model.leave('next');
    else model.command('next');
  }
</script>

{#if section}
  {#each found as el, i (i)}
    {#if el}
      <Pointer
        target={el}
        arrowFrom={i === activeIndex && showArrow ? placed?.arrowFrom : null}
        arrowTo={i === activeIndex && showArrow ? placed?.arrowTo : null}
        focusRing={i === activeIndex && placed?.mode === 'inset' && !placed.arrowExempt}
        z={49}
      />
    {/if}
  {/each}
  <div
    bind:this={cardEl}
    class="pry-overlay-card fixed z-50 flex flex-col rounded-lg border border-zinc-700 bg-zinc-900/95 shadow-2xl backdrop-blur {placed?.mode === 'sheet' ? 'max-h-[45vh]' : 'w-[400px] max-w-[calc(100vw-2rem)]'} {centred ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2' : ''}"
    style:top={centred ? null : `${placed?.top ?? 0}px`}
    style:left={centred ? null : `${placed?.left ?? 0}px`}
    style:width={placed?.mode === 'sheet' ? `${placed.width}px` : null}
    style:visibility={centred || placed ? 'visible' : 'hidden'}
    role="dialog"
    aria-label={overlayUi.cardLabel}
    data-testid="overlay-card"
    data-popup="tour"
    data-step-id={section.id}
    data-placement={centred ? 'centred' : (placed?.mode ?? 'pending')}
    data-pointer-count={model.pointers.length}
  >
    {#if !centred && placed?.caretEdge}
      <span class="pry-card-caret pry-card-caret-{placed.caretEdge}" style:--caret="{placed.caret}px" aria-hidden="true"></span>
    {/if}
    <div class="flex flex-shrink-0 items-start justify-between gap-2 border-b border-zinc-800 px-4 py-2">
      <div class="min-w-0">
        <p class="text-[10px] font-semibold uppercase tracking-widest text-indigo-400">{overlayUi.stepOf(nav.index + 1, nav.total)}</p>
        <p class="truncate text-sm font-medium text-zinc-100">{section.title}</p>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
      {#each paragraphs as pieces, p (p)}
        <p class="text-sm leading-relaxed text-zinc-200 {p > 0 ? 'mt-2' : ''}">
          {#each pieces as piece, k (k)}{#if piece.kind === 'look'}<span class="font-medium text-indigo-300">{piece.text}</span>{:else if piece.kind === 'code'}<code class="rounded bg-zinc-800 px-1 text-[12px]">{piece.text}</code>{:else}{piece.text}{/if}{/each}
        </p>
      {/each}
    </div>

    <div class="flex flex-shrink-0 items-center justify-between gap-2 border-t border-zinc-800 px-4 py-2">
      <button
        type="button"
        onclick={() => model.leave('skip')}
        title={overlayUi.skipHint}
        class="text-[11px] text-zinc-500 hover:text-zinc-300"
        data-testid="overlay-skip"
      >
        {overlayUi.skip}
      </button>
      <div class="flex items-center gap-2">
        <button
          type="button"
          onclick={() => model.command('back')}
          disabled={!nav.canBack}
          class="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {overlayUi.back}
        </button>
        <button
          type="button"
          onclick={handleNext}
          class="rounded bg-indigo-500 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-400"
        >
          {isFinal ? overlayUi.done : overlayUi.next}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  @media (prefers-reduced-motion: no-preference) {
    .pry-overlay-card {
      transition: top 150ms ease, left 150ms ease;
    }
  }
  .pry-card-caret {
    position: absolute;
    width: 12px;
    height: 12px;
    background: rgb(24 24 27);
    border: 1px solid rgb(63 63 70); /* zinc-700 */
    transform: rotate(45deg);
    pointer-events: none;
  }
  .pry-card-caret-top { top: -7px; left: calc(var(--caret) - 6px); border-right: none; border-bottom: none; }
  .pry-card-caret-bottom { bottom: -7px; left: calc(var(--caret) - 6px); border-left: none; border-top: none; }
  .pry-card-caret-left { left: -7px; top: calc(var(--caret) - 6px); border-right: none; border-top: none; }
  .pry-card-caret-right { right: -7px; top: calc(var(--caret) - 6px); border-left: none; border-bottom: none; }
</style>
