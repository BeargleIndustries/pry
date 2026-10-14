#!/usr/bin/env node
// Layout geometry recorder and differ (dev-only; not part of any build).
// Node >= 22, no deps: uses the built-in fetch and WebSocket to talk CDP to a
// running Pry window (debug build, scratch WebView2 profile, CDP on a port).
//
// Record (default):
//   node scripts/dev/geometry.mjs [--port 9333] [--sizes 1280x800,1024x700]
//     [--label 0.3.8] [--out-dir .omc/evidence/pry-learning-2026-10-12]
//     [--no-run]
//   For each size: emulate the viewport, reload, wait for the model to load,
//   press Run once on the default prompt, wait for the run to settle, then save
//   the bounding rects of `header`, the prompt input, the prompt row, the
//   workspace columns, and every [data-tour] / [data-tip] element to
//   <out-dir>/geometry-<label>-<W>x<H>.json.
//
// Diff:
//   node scripts/dev/geometry.mjs --diff <baseline.json> [--current <file.json>]
//     [--allowed scripts/dev/geometry-allowed-additions.json] [--tolerance 0.5]
//   Without --current, records the baseline's size live first (as above) and
//   diffs that. Prints per-element deltas, elements added vs the baseline,
//   elements removed. Exit code 1 when:
//     - an added element is not in the allowed-additions file (a missing file
//       counts as empty). Allowed additions pass whether present or absent and
//       are never position-checked;
//     - a baseline element moved/resized beyond the tolerance, or disappeared,
//       and is not in RECT_ALLOW below.
//   STRUCTURAL elements (header box, prompt row, workspace columns) can never
//   be allow-listed.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

// Plan Step 0: off-mode rects that may change in 0.4.0, each with its reason.
const RECT_ALLOW = {
  'prompt-input': 'header row gains lessons-toggle',
  'run-button': 'header row gains lessons-toggle',
  'export-button': 'header row gains lessons-toggle',
  'notebook-button': 'header row gains lessons-toggle',
  'predictions-panel': 'everything-else row',
  'settings-tour': 'removed',
  'experiments-button': 're-purposed',
};
const STRUCTURAL = new Set(['header', 'prompt-row', 'workspace-left', 'workspace-right', 'workspace']);

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1] ?? 'true']);
    return acc;
  }, []),
);
const PORT = Number(args.port ?? 9333);
const OUT_DIR = resolve(args['out-dir'] ?? join(REPO, '.omc', 'evidence', 'pry-learning-2026-10-12'));
const LABEL = args.label ?? JSON.parse(readFileSync(join(REPO, 'ui', 'package.json'), 'utf8')).version;
const TOL = Number(args.tolerance ?? 0.5);
const ALLOWED_FILE = resolve(args.allowed ?? join(HERE, 'geometry-allowed-additions.json'));
const LOAD_TIMEOUT_MS = Number(args.timeout ?? 15 * 60 * 1000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageTarget() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find((t) => t.type === 'page' && /tauri\.localhost/.test(t.url)) ?? list.find((t) => t.type === 'page');
  if (!page) throw new Error(`no page target on port ${PORT}`);
  if (/localhost:5173/.test(page.url)) throw new Error(`page is ${page.url}: that is a dev server, not a debug build`);
  return page;
}

function connect(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { ok, no } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) no(new Error(`${msg.error.message} ${msg.error.data ?? ''}`));
        else ok(msg.result);
      }
    };
    ws.onerror = (e) => rej(e.error ?? new Error('websocket error'));
    ws.onopen = () =>
      res({
        send(method, params = {}) {
          const mid = ++id;
          ws.send(JSON.stringify({ id: mid, method, params }));
          return new Promise((ok, no) => pending.set(mid, { ok, no }));
        },
        close: () => ws.close(),
      });
  });
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

async function waitFor(cdp, expression, what, timeoutMs = LOAD_TIMEOUT_MS) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      if (await evaluate(cdp, expression)) return;
    } catch {
      // page mid-navigation
    }
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const RUN_BTN = `[...document.querySelectorAll('[data-tour="run-button"]')].find((b) => b.offsetParent !== null)`;

// Collected in the page. Keys are the anchor name; a repeated name gets "#2", "#3".
const COLLECT = `(() => {
  const r2o = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const visible = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2), visible };
  };
  const out = {};
  const put = (key, el, extra) => {
    let k = key, n = 1;
    while (out[k]) k = key + '#' + ++n;
    out[k] = { ...r2o(el), tag: el.tagName.toLowerCase(), ...extra };
  };
  const header = document.querySelector('header');
  if (header) put('header', header, { kind: 'structural' });
  const input = [...document.querySelectorAll('[data-tour="prompt-input"]')].find((e) => e.offsetParent !== null);
  if (input) put('prompt-row', input.parentElement, { kind: 'structural' });
  const sep = document.querySelector('.cursor-col-resize');
  if (sep) {
    if (sep.previousElementSibling) put('workspace-left', sep.previousElementSibling, { kind: 'structural' });
    if (sep.nextElementSibling) put('workspace-right', sep.nextElementSibling, { kind: 'structural' });
  } else {
    const tl = document.querySelector('[role="tablist"][aria-label="Analysis panels"]');
    if (tl?.parentElement) put('workspace', tl.parentElement, { kind: 'structural' });
  }
  for (const el of document.querySelectorAll('[data-tour], [data-tip]')) {
    const tour = el.getAttribute('data-tour');
    const tip = el.getAttribute('data-tip');
    const attrs = [tour !== null && 'data-tour', tip !== null && 'data-tip'].filter(Boolean);
    if (tour !== null) put(tour, el, { kind: 'anchor', attrs });
    if (tip !== null && tip !== tour) put(tip, el, { kind: 'anchor', attrs });
  }
  return out;
})()`;

async function record(cdp, w, h, { run = true } = {}) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: new URL('/', await evaluate(cdp, 'location.href')).href });
  await sleep(2000);
  await waitFor(cdp, `!!document.querySelector('header')`, 'the main window');
  // Model loaded = a visible, enabled Run button.
  await waitFor(cdp, `(() => { const b = ${RUN_BTN}; return !!b && !b.disabled; })()`, 'GPT-2 small to load');
  if (run) {
    await evaluate(cdp, `${RUN_BTN}.click(); true`);
    await sleep(500);
    await waitFor(cdp, `(() => { const b = ${RUN_BTN}; return !!b && !b.disabled && !!document.querySelector('[data-tour="token-strip"]'); })()`, 'the run to finish');
    await sleep(3000); // let auto-fetched panels and layout settle
  }
  const elements = await evaluate(cdp, COLLECT);
  const meta = await evaluate(
    cdp,
    `({ href: location.href, innerWidth, innerHeight, preset: localStorage.getItem('pry:active_preset'), prompt: ([...document.querySelectorAll('[data-tour="prompt-input"]')].find((e) => e.offsetParent !== null) || {}).value, popups: [...document.querySelectorAll('[data-popup]')].filter((e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; }).map((e) => e.dataset.popup + ':' + (e.dataset.stepId ?? '')) })`,
  );
  return { label: LABEL, size: `${w}x${h}`, recordedAt: new Date().toISOString(), state: run ? 'loaded+run' : 'loaded', meta, elements };
}

async function withPage(fn) {
  const page = await pageTarget();
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  const href = await evaluate(cdp, 'location.href');
  if (/localhost:5173/.test(href)) throw new Error(`page is ${href}: refusing`);
  console.log(`page ${href}`);
  // Scratch profile: skip onboarding and use GPT-2 small (as popup-audit does).
  await evaluate(
    cdp,
    `localStorage.setItem('pry:onboarding_done','true');` +
      `localStorage.getItem('pry:active_preset') || localStorage.setItem('pry:active_preset','gpt2-small'); true`,
  );
  try {
    return await fn(cdp);
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    cdp.close();
  }
}

const baseName = (k) => k.replace(/#\d+$/, '');

function loadAllowed() {
  if (!existsSync(ALLOWED_FILE)) return new Set();
  const j = JSON.parse(readFileSync(ALLOWED_FILE, 'utf8'));
  const list = Array.isArray(j) ? j : j.allowed ?? j.names ?? j.additions ?? [];
  return new Set(list.map((x) => (typeof x === 'string' ? x : x.id ?? x.name)));
}

function diff(base, cur) {
  const allowed = loadAllowed();
  const b = base.elements;
  const c = cur.elements;
  let failed = false;
  const lines = [];
  console.log(`diff ${base.label}@${base.size} -> ${cur.label}@${cur.size}  (tolerance ${TOL}px, ${allowed.size} allowed additions from ${existsSync(ALLOWED_FILE) ? ALLOWED_FILE : 'missing file = empty'})`);
  for (const [k, r0] of Object.entries(b)) {
    const r1 = c[k];
    const name = baseName(k);
    const allow = !STRUCTURAL.has(name) && RECT_ALLOW[name];
    if (!r1) {
      const bad = !allow;
      failed ||= bad;
      lines.push(`${bad ? 'FAIL' : 'ok  '} removed ${k}${allow ? `  [allowed: ${allow}]` : ''}`);
      continue;
    }
    const d = { dx: r1.x - r0.x, dy: r1.y - r0.y, dw: r1.w - r0.w, dh: r1.h - r0.h };
    const moved = Object.values(d).some((v) => Math.abs(v) > TOL) || r0.visible !== r1.visible;
    const fmt = Object.entries(d).map(([n, v]) => `${n}=${v >= 0 ? '+' : ''}${v.toFixed(1)}`).join(' ');
    if (!moved) {
      lines.push(`ok   same    ${k}`);
    } else {
      const bad = !allow;
      failed ||= bad;
      lines.push(`${bad ? 'FAIL' : 'ok  '} moved   ${k}  ${fmt}${r0.visible !== r1.visible ? ` visible ${r0.visible}->${r1.visible}` : ''}${allow ? `  [allowed: ${allow}]` : ''}`);
    }
  }
  const added = Object.keys(c).filter((k) => !(k in b));
  for (const k of added) {
    const ok = allowed.has(baseName(k));
    failed ||= !ok;
    lines.push(`${ok ? 'ok  ' : 'FAIL'} added   ${k}${ok ? '  [allowed addition]' : '  [not in allowed additions]'}`);
  }
  const absent = [...allowed].filter((n) => !Object.keys(c).some((k) => baseName(k) === n));
  console.log(lines.join('\n'));
  console.log(`added ${added.length}: ${added.join(', ') || '-'}`);
  if (absent.length) console.log(`allowed additions absent in this state (fine): ${absent.join(', ')}`);
  console.log(failed ? 'GEOMETRY DIFF FAIL' : 'GEOMETRY DIFF PASS');
  return !failed;
}

async function main() {
  if (args.diff) {
    const base = JSON.parse(readFileSync(resolve(args.diff), 'utf8'));
    let cur;
    if (args.current) {
      cur = JSON.parse(readFileSync(resolve(args.current), 'utf8'));
    } else {
      const [w, h] = base.size.split('x').map(Number);
      cur = await withPage((cdp) => record(cdp, w, h, { run: base.state !== 'loaded' }));
      mkdirSync(OUT_DIR, { recursive: true });
      let out = join(OUT_DIR, `geometry-${LABEL}-${w}x${h}.json`);
      if (out === resolve(args.diff)) out = out.replace(/\.json$/, '-current.json'); // never overwrite the baseline
      writeFileSync(out, JSON.stringify(cur, null, 2));
      console.log(`saved ${out}`);
    }
    process.exit(diff(base, cur) ? 0 : 1);
  }
  const sizes = (args.sizes ?? '1280x800,1024x700').split(',').map((s) => s.split('x').map(Number));
  mkdirSync(OUT_DIR, { recursive: true });
  await withPage(async (cdp) => {
    for (const [w, h] of sizes) {
      const rec = await record(cdp, w, h, { run: args['no-run'] !== 'true' });
      const out = join(OUT_DIR, `geometry-${LABEL}-${w}x${h}.json`);
      writeFileSync(out, JSON.stringify(rec, null, 2));
      console.log(`saved ${out}: ${Object.keys(rec.elements).length} elements (${rec.meta.innerWidth}x${rec.meta.innerHeight})`);
    }
  });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
