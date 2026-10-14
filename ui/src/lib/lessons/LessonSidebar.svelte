<!--
  LessonSidebar (plan T3 "Sidebar", Settled 3, D2, D3): Lessons docked beside
  the app, never over it. Implements the runner's `Presenter` (contract.ts)
  through SidebarModel; draws the rendered step (render.ts) with plain markup
  (no raw HTML anywhere), points at the app per D3 (ring + inner-edge tick +
  short arrow only within 160px; in-place highlight for targets inside the
  sidebar), and carries the honesty box pinned at the bottom.

  Tool-neutral: the tool's anchors, views and spine come in as props.
-->
<script module lang="ts">
  import type { PointerTarget, Presenter, PresenterCommand, RenderedStep } from './registry/contract';

  type Nav = { index: number; total: number; canBack: boolean };

  /** Presenter state. The runner attaches one; the component draws it. */
  export class SidebarModel implements Presenter {
    step = $state.raw<RenderedStep | null>(null);
    nav = $state<Nav>({ index: 0, total: 0, canBack: false });
    pointers = $state<PointerTarget[]>([]);
    #handlers: ((c: PresenterCommand) => void)[] = [];

    show(step: RenderedStep, nav: Nav): void {
      this.step = step;
      this.nav = nav;
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

    clear(): void {
      this.step = null;
      this.pointers = [];
    }
  }
</script>

<script lang="ts">
  import type { Component } from 'svelte';
  import { X, PanelLeftClose, PanelRightClose, ChevronLeft, ChevronRight } from 'lucide-svelte';
  import Pointer from '../components/Pointer.svelte';
  import { occupied, OCCUPIED, tipHold } from '../popup/occupied.svelte';
  import type { AnchorDef, ViewDef } from './registry/contract';
  import type { RNode, RenderedBlock } from './render';
  import { planPointer, type PointerPlan, type Side } from './runner/pointer';
  import type { RunnerCommand } from './runner/runner.svelte';
  import { lessonsCopy as c } from './copy';
  import SpineStrip from './SpineStrip.svelte';
  import LessonRail from './LessonRail.svelte';
  import LessonPicker, { type PickerItem } from './LessonPicker.svelte';

  interface Props {
    model: SidebarModel;
    anchors: Record<string, AnchorDef>;
    views: Record<string, ViewDef>;
    spine: { id: string; label: string }[];
    captures: () => Record<string, unknown>;
    /** Runs a tool action (an anchor's `reveal`, "Open it"). */
    runAction: (name: string, args: unknown) => Promise<void>;
    /** What the `highlight` action asked to point at (seq bumps per call). */
    highlight?: { anchors: string[]; seq: number } | null;
    side: Side;
    width: number;
    railed: boolean;
    picker: PickerItem[] | null;
    pending?: number;
    onPick: (id: string) => void;
    onReview?: () => void;
    onAllLessons: () => void;
    onResize: (width: number) => void;
    onCollapse: () => void;
    onExpand: () => void;
    onClose: () => void;
  }

  let {
    model,
    anchors,
    views,
    spine,
    captures,
    runAction,
    highlight = null,
    side,
    width,
    railed,
    picker,
    pending = 0,
    onPick,
    onReview,
    onAllLessons,
    onResize,
    onCollapse,
    onExpand,
    onClose,
  }: Props = $props();

  const step = $derived(model.step);
  const nav = $derived(model.nav);
  const send = (cmd: RunnerCommand) => model.command({ commit: cmd });

  // ---- Local drafts: a choice or text before "Commit" ----
  let picks = $state<Record<string, number>>({});
  let texts = $state<Record<string, string>>({});
  let honestyOpen = $state(false);

  // ---- Focus the section heading on navigation (not on first open) ----
  let root: HTMLElement | null = $state(null);
  let heading: HTMLElement | null = $state(null);
  let lastIndex: number | null = null;
  $effect(() => {
    const i = nav.index;
    const id = step?.lesson.id;
    if (!heading || !id) return;
    if (lastIndex !== null && lastIndex !== i) heading.focus({ preventScroll: false });
    lastIndex = i;
  });

  // ---- Occupied: tips never cover the sidebar ----
  $effect(() => {
    if (!root) return;
    return occupied.registerElement(OCCUPIED.lessonSidebar, root);
  });

  // ---- Keys: Alt+Left/Right = Back/Next; F6 cycles header, sidebar, app (order follows the side) ----
  function onKeydown(e: KeyboardEvent) {
    if (!step || !e.altKey) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      model.command('back');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      model.command('next');
    }
  }
  $effect(() => {
    function onWindowKey(e: KeyboardEvent) {
      if (e.key !== 'F6' || !root) return;
      const header = document.querySelector<HTMLElement>('header');
      const main = document.querySelector<HTMLElement>('[data-lessons-main]');
      const order = (side === 'left' ? [header, root, main] : [header, main, root]).filter((x): x is HTMLElement => !!x);
      const at = order.findIndex((r) => r.contains(document.activeElement));
      const next = order[(at + (e.shiftKey ? order.length - 1 : 1) + order.length) % order.length];
      e.preventDefault();
      const focusable = next.querySelector<HTMLElement>('[data-lesson-heading], button, input, textarea, [tabindex]') ?? next;
      if (!focusable.hasAttribute('tabindex') && focusable === next) next.setAttribute('tabindex', '-1');
      focusable.focus();
    }
    window.addEventListener('keydown', onWindowKey);
    return () => window.removeEventListener('keydown', onWindowKey);
  });

  // ---- Drag handle on the inner edge ----
  let drag: { x: number; w: number } | null = null;
  function onHandleDown(e: PointerEvent) {
    drag = { x: e.clientX, w: width };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onHandleMove(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    onResize(side === 'right' ? drag.w - dx : drag.w + dx);
  }
  function onHandleUp() {
    drag = null;
  }
  function onHandleKey(e: KeyboardEvent) {
    const step16 = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowLeft') onResize(width + (side === 'right' ? step16 : -step16));
    else if (e.key === 'ArrowRight') onResize(width + (side === 'right' ? -step16 : step16));
    else return;
    e.preventDefault();
  }

  // ---- `highlight` action: point at each anchor in turn ----
  let lastSeq = -1;
  $effect(() => {
    const h = highlight;
    if (!h || h.seq === lastSeq || !step) return;
    lastSeq = h.seq;
    model.clearPointer();
    if (h.anchors.length === 1) model.point({ anchor: h.anchors[0] });
    else h.anchors.forEach((a, i) => model.point({ anchor: a }, i));
  });

  // ---- Pointers (D3), re-planned as the app moves ----
  let plans = $state<(PointerPlan | null)[]>([]);
  const visible = (el: HTMLElement | null) => !!el && el.isConnected && el.getClientRects().length > 0;
  $effect(() => {
    const targets = model.pointers;
    if (!root || railed || !step) {
      plans = [];
      tipHold.set([]);
      return;
    }
    const plan = () => {
      const sb = root!.getBoundingClientRect();
      const env = {
        anchors,
        side,
        sidebar: { left: sb.left, top: sb.top, width: sb.width, height: sb.height },
        rectOf: (el: HTMLElement) => {
          if (!visible(el)) return null;
          const r = el.getBoundingClientRect();
          return r.width === 0 && r.height === 0 ? null : { left: r.left, top: r.top, width: r.width, height: r.height };
        },
        inSidebar: (el: HTMLElement) => !!root?.contains(el),
        runnerEl: (kind: 'spine' | 'step' | 'image', id: string | null) => {
          if (kind === 'spine') return root!.querySelector<HTMLElement>('[data-lesson-spine]');
          if (kind === 'step') return root!.querySelector<HTMLElement>(`[data-step-id="${CSS.escape(id ?? '')}"]`);
          return root!.querySelector<HTMLElement>(`[data-image-id="${CSS.escape(id ?? '')}"]`);
        },
      };
      const next = targets.map((t) => planPointer(t, env));
      if (JSON.stringify(next.map(sig)) !== JSON.stringify(plans.map(sig))) plans = next;
      tipHold.set(next.flatMap((p) => (p && p.kind === 'ring' && p.el ? [p.el] : [])));
    };
    plan();
    const timer = setInterval(plan, 250);
    return () => {
      clearInterval(timer);
      tipHold.set([]);
    };
  });

  function sig(p: PointerPlan | null): unknown {
    if (!p) return null;
    if (p.kind === 'ring') return [p.anchor, Math.round(p.rect.left), Math.round(p.rect.top), Math.round(p.rect.width), Math.round(p.rect.height), p.tick.y | 0, !!p.arrow];
    if (p.kind === 'hidden') return [p.anchor, 'hidden'];
    return [p.kind, p.target, p.id, !!p.el];
  }

  const spineHighlight = $derived(plans.find((p) => p?.kind === 'in-place' && p.target === 'spine') as Extract<PointerPlan, { kind: 'in-place' }> | undefined);
  const hiddenPlans = $derived(plans.filter((p): p is Extract<PointerPlan, { kind: 'hidden' }> => p?.kind === 'hidden'));
  const activeIndex = $derived(plans.length - 1);

  function viewComponent(name: string): Component<any> | null {
    return (views[name]?.component as Component<any>) ?? null;
  }

  function choose(key: string, i: number) {
    picks = { ...picks, [key]: i };
  }

  function commit(b: RenderedBlock) {
    const choice = picks[b.key];
    const text = texts[b.key];
    send({ type: 'answer', step: b.key, ...(choice !== undefined ? { choice } : {}), ...(text ? { text } : {}) });
  }
</script>

{#snippet nodes(list: RNode[])}{#each list as n, i (i)}{@render node(n)}{/each}{/snippet}

{#snippet node(n: RNode)}
  {#if n.t === 'text'}{n.text}{:else if n.t === 'p'}<p class="mt-2 first:mt-0">{@render nodes(n.children)}</p>
  {:else if n.t === 'em'}<em>{@render nodes(n.children)}</em>
  {:else if n.t === 'strong'}<strong class="font-semibold text-zinc-100">{@render nodes(n.children)}</strong>
  {:else if n.t === 'code'}<code class="rounded bg-zinc-800 px-1 text-[12px] text-zinc-100">{n.text}</code>
  {:else if n.t === 'pre'}<pre class="mt-2 overflow-x-auto rounded bg-zinc-900 p-2 text-[12px] text-zinc-200">{n.text}</pre>
  {:else if n.t === 'ul'}<ul class="mt-2 list-disc pl-5">{@render nodes(n.children)}</ul>
  {:else if n.t === 'ol'}<ol class="mt-2 list-decimal pl-5">{@render nodes(n.children)}</ol>
  {:else if n.t === 'li'}<li>{@render nodes(n.children)}</li>
  {:else if n.t === 'h3'}<h3 class="mt-3 text-sm font-semibold text-zinc-100">{@render nodes(n.children)}</h3>
  {:else if n.t === 'h4'}<h4 class="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">{@render nodes(n.children)}</h4>
  {:else if n.t === 'blockquote'}<blockquote class="mt-2 border-l-2 border-zinc-700 pl-3 text-zinc-400">{@render nodes(n.children)}</blockquote>
  {:else if n.t === 'hr'}<hr class="my-3 border-zinc-800" />
  {:else if n.t === 'br'}<br />
  {:else if n.t === 'table'}<table class="mt-2 text-xs"><tbody>{@render nodes(n.children)}</tbody></table>
  {:else if n.t === 'tr'}<tr>{@render nodes(n.children)}</tr>
  {:else if n.t === 'td'}<td class="border border-zinc-800 px-2 py-1">{@render nodes(n.children)}</td>
  {:else if n.t === 'link'}<button type="button" class="text-indigo-300 underline decoration-dotted underline-offset-2 hover:text-indigo-200" title={n.href} onclick={() => send({ type: 'link', href: n.href })}>{@render nodes(n.children)}</button>
  {:else if n.t === 'image'}<img src={n.src} alt={n.alt} class="mt-2 max-w-full rounded" />
  {:else if n.t === 'look'}<button type="button" class="font-medium text-indigo-300 hover:text-indigo-200" onclick={() => send({ type: 'look', at: n.at as PointerTarget[] })}>{@render nodes(n.children)}</button>
  {:else if n.t === 'earlier'}<span class="rounded bg-zinc-800/80 px-1 {n.state === 'answer' ? 'text-zinc-100' : 'italic text-zinc-400'}" data-earlier={n.state}>{n.text}</span>
  {:else if n.t === 'refutes'}<span class="text-amber-200">{@render nodes(n.children)}</span>
  {:else if n.t === 'slot'}<span class="font-mono text-[12px] text-emerald-300" data-slot={n.name}>{n.text}</span>{#if n.expect}<span class="ml-1 text-[10px] text-zinc-500">({n.expect})</span>{/if}
  {/if}
{/snippet}

{#snippet stepId(b: RenderedBlock)}
  {#if step?.authorMode && b.stepId}<span class="ml-2 font-mono text-[10px] text-zinc-600">{c.stepId(b.stepId)}</span>{/if}
{/snippet}

{#snippet block(b: RenderedBlock)}
  <section class="mt-4 text-sm leading-relaxed text-zinc-300" data-step-id={b.stepId ?? b.key} data-step-kind={b.kind}>
    {@render stepId(b)}
    {#if b.kind === 'fold'}
      <details class="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2">
        <summary class="cursor-pointer text-xs font-medium text-zinc-300">{b.title}</summary>
        {@render nodes(b.body)}
        {#each b.children as child (child.key)}{@render block(child)}{/each}
      </details>
    {:else}
      {#if b.analogy}
        <div class="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
          <p>{@render nodes(b.analogy.like)}</p>
          <p class="mt-1 text-zinc-400">{@render nodes(b.analogy.because)}</p>
          <p class="mt-2 text-xs text-amber-200/90"><span class="font-medium">{c.analogyBreaks}:</span> {@render nodes(b.analogy.breaks)}</p>
        </div>
      {:else if b.simplification}
        <aside class="rounded-md border border-dashed border-zinc-700 p-3 text-zinc-400"><p class="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{c.simplification}</p>{@render nodes(b.body)}</aside>
      {:else}
        {@render nodes(b.body)}
      {/if}
      {#if b.image}<img src={b.image.src} alt={b.image.alt} class="mt-2 max-w-full rounded" data-image-id={b.stepId ?? b.key} />{/if}
      {#if b.asserts}{#each b.asserts as line, i (i)}<p class="mt-2">{@render nodes(line)}</p>{/each}{/if}

      {#if b.ask}
        {@const a = b.ask}
        {#if a.question}<p class="mt-1">{@render nodes(a.question)}</p>{/if}
        {#if a.hidden.length}
          <p class="mt-2 text-xs text-zinc-500" role="status">{c.hiddenUntilAnswer}: {a.hidden.join(', ')}</p>
        {/if}
        {#if a.choices}
          <div class="mt-2 flex flex-col gap-1" role="group" aria-label={c.yourAnswer}>
            {#each a.choices as ch (ch.index)}
              {@const on = a.locked ? ch.picked : picks[b.key] === ch.index}
              <button
                type="button"
                disabled={a.locked}
                aria-pressed={on}
                onclick={() => choose(b.key, ch.index)}
                class="rounded-md border px-3 py-1.5 text-left text-sm {on ? 'border-indigo-500 bg-indigo-950/60 text-indigo-100' : 'border-zinc-800 text-zinc-300 hover:border-zinc-600'} disabled:cursor-default"
              >{@render nodes(ch.text)}</button>
            {/each}
          </div>
        {/if}
        {#if a.free && !a.locked}
          <textarea bind:value={texts[b.key]} rows="2" aria-label={c.writeHere} placeholder={c.writeHere} class="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"></textarea>
        {:else if a.free && a.answer}
          <p class="mt-2 rounded-md bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200">{a.answer}</p>
        {/if}
        {#if a.pick}
          <p class="mt-2 text-xs text-zinc-400">{a.picked ? c.picked(a.picked) : c.pickInApp}</p>
          {#if !a.locked}<button type="button" onclick={() => send({ type: 'pick', step: b.key })} class="mt-1 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800">{c.pickInApp}</button>{/if}
        {/if}
        {#if !a.locked}
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onclick={() => commit(b)} class="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500">{c.commit}</button>
            {#if a.canSkip}<button type="button" onclick={() => send({ type: 'skip', step: b.key })} class="text-xs text-zinc-400 hover:text-zinc-200">{c.justShowMe}</button>{/if}
          </div>
        {/if}
        <div aria-live="polite">
          {#if a.feedback}<p class="mt-2 rounded-md bg-zinc-900 px-3 py-2 text-sm text-zinc-200">{@render nodes(a.feedback)}</p>{/if}
          {#if a.onSkip}<p class="mt-2 text-sm text-zinc-300">{@render nodes(a.onSkip)}</p>{/if}
          {#if a.modelAnswer}<p class="mt-2 text-sm text-zinc-300"><span class="font-medium text-zinc-200">{c.modelAnswer}:</span> {@render nodes(a.modelAnswer)}</p>{/if}
        </div>
      {/if}

      {#if b.act}
        <div class="mt-2 flex items-center gap-2">
          <button
            type="button"
            onclick={() => send({ type: 'do', step: b.key })}
            disabled={b.act.state === 'running'}
            class="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {#if b.act.state === 'running'}<span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent align-[-2px]" aria-hidden="true"></span>{/if}
            {c.doIt}
          </button>
          {#if b.act.state === 'done'}<span class="text-xs text-emerald-400">✓ {c.done}</span>{/if}
        </div>
        {#if b.act.message}<p class="mt-1 text-xs text-red-400" role="alert">{b.act.message}</p>{/if}
      {/if}

      {#if b.observe}
        {@const o = b.observe}
        {#if o.journal}
          {#if o.revealed && o.note}<p class="mt-2 rounded-md bg-zinc-900 px-2 py-1.5">{o.note}</p>{:else}
            <textarea bind:value={texts[b.key]} rows="2" aria-label={c.observeNote} placeholder={c.observeNote} class="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"></textarea>
            <button type="button" onclick={() => send({ type: 'note', step: b.key, text: texts[b.key] ?? '' })} class="mt-1 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800">{c.saveNote}</button>
          {/if}
        {:else if !o.revealed}
          <button type="button" disabled={o.waiting} onclick={() => send({ type: 'show', step: b.key })} class="mt-2 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-40">{c.showApp}</button>
        {/if}
        <div aria-live="polite" data-check-result>
          {#if o.result}
            <p class="mt-2 rounded-md px-3 py-2 text-sm {o.result.agrees === true ? 'bg-emerald-950/40 text-emerald-200' : o.result.agrees === false ? 'bg-amber-950/40 text-amber-200' : 'bg-zinc-900 text-zinc-400'}" data-binding={o.result.binding}>{o.result.text}</p>
          {/if}
          {#each o.asserts as line, i (i)}<p class="mt-2">{@render nodes(line)}</p>{/each}
        </div>
      {/if}

      {#if b.columns}
        <div class="mt-2 grid gap-2" style:grid-template-columns="repeat({b.columns.length}, minmax(0, 1fr))">
          {#each b.columns as col, i (i)}
            <div class="min-w-0 rounded-md border border-zinc-800 bg-zinc-950 p-2 text-xs">
              {#if col.kind === 'read'}
                <p class="font-medium text-zinc-400">{col.label}</p>
                <p class="mt-1 break-words font-mono text-zinc-200">{col.value}</p>
              {:else if col.kind === 'text'}
                {@render nodes(col.text)}
              {:else}
                {@const View = viewComponent(col.view)}
                {#if View}<View args={col.args} captures={captures()} />{/if}
              {/if}
            </div>
          {/each}
        </div>
        {#if b.asserts}{#each b.asserts as line, i (i)}<p class="mt-2">{@render nodes(line)}</p>{/each}{/if}
        {#if b.sameQuestion}
          <p class="mt-2 text-xs font-medium text-zinc-300">{b.sameQuestion}</p>
          <textarea bind:value={texts[b.key]} rows="2" aria-label={b.sameQuestion} class="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"></textarea>
          <button type="button" onclick={() => send({ type: 'same', step: b.key, text: texts[b.key] ?? '' })} class="mt-1 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800">{c.saveNote}</button>
        {/if}
      {/if}

      {#if b.explainResult}
        {@const r = b.explainResult}
        <div class="mt-2 rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
          {#each r.supports as s, i (i)}<p class="mt-1 first:mt-0"><span class="font-medium text-zinc-200">{c.supports}:</span> {@render nodes(s)}</p>{/each}
          {#each r.leavesOpen as s, i (i)}<p class="mt-1"><span class="font-medium text-zinc-200">{c.leavesOpen}:</span> {@render nodes(s)}</p>{/each}
          {#if r.skeptic}<p class="mt-2 text-zinc-400">{@render nodes(r.skeptic.says)} {@render nodes(r.skeptic.check)}</p>{/if}
          {#each r.limits as s, i (i)}<p class="mt-1 text-xs text-zinc-500"><span class="font-medium">{c.limits}:</span> {@render nodes(s)}</p>{/each}
          {#each r.asserts as line, i (i)}<p class="mt-2">{@render nodes(line)}</p>{/each}
        </div>
      {/if}

      {#if b.transfer}
        <div class="mt-2 rounded-md border border-indigo-900/60 bg-indigo-950/20 p-3">
          <p class="text-xs font-medium text-indigo-200">{c.transferPrompt}</p>
          <p class="mt-1 font-mono text-[12px] text-zinc-100">{b.transfer.prompt}</p>
          <p class="mt-2 text-xs text-zinc-400"><span class="font-medium">{c.expectIfHolds}:</span> {@render nodes(b.transfer.expect)}</p>
          {#each b.transfer.limits as s, i (i)}<p class="mt-1 text-xs text-zinc-500"><span class="font-medium">{c.limits}:</span> {@render nodes(s)}</p>{/each}
          {#each b.children as child (child.key)}{@render block(child)}{/each}
        </div>
      {/if}

      {#if b.task}
        {@const t = b.task}
        <div class="mt-2 rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
          {#if t.changeArgs}
            {#each t.changeArgs as arg (arg.name)}
              <label class="mt-1 block text-xs text-zinc-400">{arg.name}
                <input value={arg.value} oninput={(e) => send({ type: 'task-args', step: b.key, args: { [arg.name]: (e.currentTarget as HTMLInputElement).value } })} class="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-[12px] text-zinc-100 focus:border-indigo-500 focus:outline-none" />
              </label>
            {/each}
          {/if}
          {#if t.needsPrediction}
            <label class="mt-2 block text-xs text-zinc-400">{c.predictRun}
              <input value={t.prediction} oninput={(e) => send({ type: 'task-predict', step: b.key, text: (e.currentTarget as HTMLInputElement).value })} class="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none" />
            </label>
          {/if}
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" disabled={!t.canRun} onclick={() => send({ type: 'task-run', step: b.key })} class="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40">{c.runIt}</button>
            <button type="button" onclick={() => send({ type: 'task-check', step: b.key })} class="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800">{c.checkIt}</button>
            {#if t.canReset}<button type="button" onclick={() => send({ type: 'task-reset', step: b.key })} class="text-xs text-zinc-400 hover:text-zinc-200">{c.startOver}</button>{/if}
            {#if t.maxRuns !== null}<span class="text-[11px] text-zinc-500">{c.runsLeft(Math.max(0, t.maxRuns - t.runs))}</span>{/if}
          </div>
          <div aria-live="polite" data-check-result>
            {#if t.message}<p class="mt-2 text-sm {t.met ? 'text-emerald-300' : 'text-zinc-300'}">{t.message}</p>{/if}
          </div>
        </div>
      {/if}

      {#if b.chain}
        {@const ch = b.chain}
        {#if ch.prompt}<p class="mt-1">{@render nodes(ch.prompt)}</p>{/if}
        {#if !ch.written && !ch.skipped}
          <textarea bind:value={texts[b.key]} rows="4" aria-label={c.writeHere} placeholder={c.writeHere} class="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"></textarea>
          <div class="mt-1 flex items-center gap-2">
            <button type="button" onclick={() => send({ type: 'chain', step: b.key, text: texts[b.key] ?? '' })} class="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500">{c.commit}</button>
            {#if ch.nudging}
              <span class="text-xs text-amber-200" role="status">{c.chainNudge}</span>
              <button type="button" onclick={() => send({ type: 'chain-skip', step: b.key })} class="text-xs text-zinc-400 hover:text-zinc-200">{c.skipAnyway}</button>
            {:else}
              <button type="button" onclick={() => send({ type: 'chain-skip', step: b.key })} class="text-xs text-zinc-400 hover:text-zinc-200">{c.justShowMe}</button>
            {/if}
          </div>
        {:else}
          {#if ch.text}<p class="mt-2 rounded-md bg-zinc-900 px-2 py-1.5 text-zinc-200">{ch.text}</p>{/if}
          <p class="mt-2 text-sm" aria-live="polite"><span class="font-medium text-zinc-200">{c.modelAnswer}:</span> {@render nodes(ch.modelAnswer)}</p>
        {/if}
        {#if b.asserts && (ch.written || ch.skipped)}{#each b.asserts as line, i (i)}<p class="mt-2 text-xs text-zinc-500">{@render nodes(line)}</p>{/each}{/if}
      {/if}

      {#if b.kind !== 'transfer'}
        {#each b.children as child (child.key)}{@render block(child)}{/each}
      {/if}
    {/if}
  </section>
{/snippet}

<div class="flex h-full min-h-0 flex-shrink-0 {side === 'left' ? 'flex-row' : 'flex-row-reverse'}" style:width="{railed ? 44 : width + 6}px" data-lesson-side={side}>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={root}
    role="complementary"
    aria-label={c.title}
    class="pry-lesson-sidebar flex h-full min-h-0 flex-col bg-zinc-950 {side === 'left' ? 'border-r' : 'border-l'} border-zinc-800"
    style:width="{railed ? 44 : width}px"
    data-lesson-sidebar
    data-testid="lesson-sidebar"
    onkeydown={onKeydown}
  >
    {#if railed}
      <LessonRail title={step?.lesson.title ?? null} onExpand={onExpand} />
    {:else}
      <header class="flex flex-shrink-0 items-start gap-2 border-b border-zinc-800 px-3 py-2">
        <div class="min-w-0 flex-1">
          <p class="text-[10px] font-semibold uppercase tracking-widest text-indigo-400">{c.title}</p>
          {#if step}
            <p class="truncate text-sm font-medium text-zinc-100" title={step.lesson.title}>{step.lesson.title}</p>
            <p class="text-[11px] text-zinc-500">{c.minutes(step.lesson.minutes)}{#if step.lesson.draft} · {c.draft}{/if}</p>
          {/if}
        </div>
        {#if step}<button type="button" onclick={onAllLessons} class="rounded-md px-1.5 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">{c.allLessons}</button>{/if}
        <button type="button" onclick={onCollapse} aria-label={c.collapse} title={c.collapse} class="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
          {#if side === 'right'}<PanelRightClose class="h-4 w-4" />{:else}<PanelLeftClose class="h-4 w-4" />{/if}
        </button>
        <button type="button" onclick={onClose} aria-label={c.toggleCloseTitle} title={c.toggleCloseTitle} class="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"><X class="h-4 w-4" /></button>
      </header>

      {#if !step}
        <div class="min-h-0 flex-1 overflow-y-auto">
          <LessonPicker items={picker ?? []} {pending} {onPick} {onReview} />
        </div>
      {:else}
        <div class="flex-shrink-0 border-b border-zinc-800 px-3 py-2">
          <SpineStrip spine={spine} lit={step.lesson.spine} masks={step.spineMasks} highlight={!!spineHighlight} highlightBox={spineHighlight?.id ?? null} />
          <details class="mt-1">
            <summary class="cursor-pointer text-[11px] text-zinc-400">{c.sections} ({step.index + 1}/{step.total})</summary>
            <ol class="mt-1 flex flex-col gap-0.5">
              {#each step.sections as s, i (s.id)}
                <li>
                  <button type="button" onclick={() => send({ type: 'goto', section: i })} aria-current={s.current ? 'step' : undefined} class="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-[11px] {s.current ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900'}">
                    <span class="w-3 text-emerald-400" aria-hidden="true">{s.visited && !s.current ? '✓' : ''}</span>
                    <span class="truncate">{s.title}</span>
                    {#if s.depth === 'optional'}<span class="text-[10px] text-zinc-600">{c.optional}</span>{/if}
                  </button>
                </li>
              {/each}
            </ol>
          </details>
        </div>

        {#if step.banner}
          <div class="flex flex-shrink-0 items-center gap-2 border-b border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200" role="status">
            <span class="flex-1">{c.modelBanner(step.banner.model)}</span>
            <button type="button" onclick={() => send({ type: 'switch-model' })} class="rounded-md border border-amber-700 px-2 py-0.5 hover:bg-amber-900/40">{c.switchTo(step.banner.model)}</button>
          </div>
        {/if}
        {#if step.drift}
          <div class="flex flex-shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-400" role="status" data-testid="lesson-drift">
            <span class="flex-1">{c.drift}</span>
            <button type="button" onclick={() => send({ type: 'fix-drift' })} class="rounded-md border border-zinc-700 px-2 py-0.5 text-zinc-200 hover:bg-zinc-800">{c.driftFix}</button>
          </div>
        {/if}
        {#if step.busy}
          <p class="flex-shrink-0 border-b border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-400" role="status">{step.busy}</p>
        {/if}
        {#if step.error}<p class="flex-shrink-0 border-b border-red-900/60 px-3 py-1.5 text-[11px] text-red-300" role="alert">{step.error}</p>{/if}
        {#each hiddenPlans as h (h.anchor)}
          <div class="flex flex-shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-400">
            <span class="flex-1">{c.pointerHidden(h.label)}</span>
            {#if h.reveal}<button type="button" onclick={() => runAction(h.reveal!.action, h.reveal!.args)} class="rounded-md border border-zinc-700 px-2 py-0.5 text-zinc-200 hover:bg-zinc-800">{c.openIt}</button>{/if}
          </div>
        {/each}

        <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {#if step.authorMode && step.authorNotes.length}
            <div class="mb-3 rounded-md border border-zinc-800 p-2 text-[11px] text-zinc-500">
              <p class="font-medium text-zinc-400">{c.authorNotes}</p>
              <ul class="mt-1 list-disc pl-4">{#each step.authorNotes as n, i (i)}<li>{n}</li>{/each}</ul>
            </div>
          {/if}
          {#if step.authorMode}<button type="button" onclick={() => send({ type: 'rerun-setup' })} class="mb-2 rounded-md border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-900">{c.rerunSetup}</button>{/if}
          {#if step.coldEntry}
            <div class="mb-3 rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-sm text-zinc-300">
              <p class="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{c.coldEntry}</p>
              {@render nodes(step.coldEntry)}
            </div>
          {/if}
          <h2 bind:this={heading} tabindex="-1" class="text-base font-semibold text-zinc-100 focus:outline-none" data-lesson-heading>{step.section.title}</h2>
          {#each step.blocks as b (b.key)}{@render block(b)}{/each}
        </div>

        <footer class="flex-shrink-0 border-t border-zinc-800">
          {#if step.honesty}
            {@const h = step.honesty}
            <div class="px-3 pt-2 text-[11px] text-zinc-400" data-testid="honesty-box" aria-label={c.honesty} role="note">
              <div class={honestyOpen ? '' : 'line-clamp-2'}>
                {#each h.leavesOpen as s, i (i)}<p><span class="font-medium text-zinc-300">{c.leavesOpen}:</span> {@render nodes(s)}</p>{/each}
                {#if h.skeptic}<p><span class="font-medium text-zinc-300">{c.skeptic}:</span> {@render nodes(h.skeptic)}</p>{/if}
                {#each h.limits as s, i (i)}<p><span class="font-medium text-zinc-300">{c.limits}:</span> {@render nodes(s)}</p>{/each}
              </div>
              <button type="button" onclick={() => (honestyOpen = !honestyOpen)} aria-expanded={honestyOpen} class="mt-0.5 text-[11px] text-indigo-300 hover:text-indigo-200">{honestyOpen ? c.showLess : c.showMore}</button>
            </div>
          {/if}
          <div class="flex items-center justify-between gap-2 px-3 py-2">
            <button type="button" onclick={() => model.command('back')} disabled={!nav.canBack} class="flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"><ChevronLeft class="h-3.5 w-3.5" />{c.back}</button>
            <span class="text-[11px] text-zinc-500">{nav.index + 1} / {nav.total}</span>
            <button type="button" onclick={() => model.command('next')} class="flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500">{nav.index + 1 >= nav.total ? c.finish : c.next}<ChevronRight class="h-3.5 w-3.5" /></button>
          </div>
        </footer>
      {/if}
    {/if}
  </div>
  {#if !railed}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={c.resizeHandle}
      aria-valuenow={width}
      tabindex="0"
      class="w-1.5 flex-shrink-0 cursor-col-resize bg-zinc-900 hover:bg-indigo-900/60 focus:bg-indigo-900/60 focus:outline-none"
      onpointerdown={onHandleDown}
      onpointermove={onHandleMove}
      onpointerup={onHandleUp}
      onkeydown={onHandleKey}
      data-testid="lesson-resize"
    ></div>
  {/if}
</div>

{#each plans as p, i (i)}
  {#if p && p.kind === 'ring'}
    <Pointer target={p.el} arrowFrom={i === activeIndex ? (p.arrow?.from ?? null) : null} arrowTo={i === activeIndex ? (p.arrow?.to ?? null) : null} tick={i === activeIndex ? p.tick : null} z={45} />
  {:else if p && p.kind === 'in-place' && p.el && p.target !== 'spine'}
    <Pointer target={p.el} z={45} />
  {/if}
{/each}

<style>
  :global(.pry-lesson-inplace) {
    outline: 2px solid rgb(129 140 248);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: no-preference) {
    .pry-lesson-sidebar :global(details > summary) {
      transition: color 120ms ease;
    }
  }
</style>
