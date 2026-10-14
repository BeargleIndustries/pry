#!/usr/bin/env node
// Sidecar call tracer (dev-only; not part of any build). Node >= 22, no deps:
// uses the built-in fetch and WebSocket to talk CDP to a running Pry window
// (debug build, scratch WebView2 profile, CDP on a port).
//
//   node scripts/dev/sidecar-trace.mjs [--port 9333] [--label 0.3.8]
//     [--out <file>]   (default .omc/evidence/pry-learning-2026-10-12/sidecar-trace-<label>.json)
//
// Turns on the CDP Network domain, reloads the page at 1280x800 and drives a
// scripted session: load (whatever the page sends on start-up until the model
// is ready), Run twice on the default prompt, Attention, Logit Lens, Why (DLA),
// Swap test (Run swap test), Steering (Run Steered). Every HTTP request to the
// sidecar (127.0.0.1 / localhost, any port but CDP's) is recorded with its step,
// method, path and parsed request body. Headers are not recorded (they carry
// the session token).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1] ?? 'true']);
    return acc;
  }, []),
);
const PORT = Number(args.port ?? 9333);
const LABEL = args.label ?? JSON.parse(readFileSync(join(REPO, 'ui', 'package.json'), 'utf8')).version;
const OUT = resolve(args.out ?? join(REPO, '.omc', 'evidence', 'pry-learning-2026-10-12', `sidecar-trace-${LABEL}.json`));
const STEP_TIMEOUT_MS = Number(args.timeout ?? 15 * 60 * 1000);
const QUIET_MS = 2500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageTarget() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find((t) => t.type === 'page' && /tauri\.localhost/.test(t.url)) ?? list.find((t) => t.type === 'page');
  if (!page) throw new Error(`no page target on port ${PORT}`);
  if (/localhost:5173/.test(page.url)) throw new Error(`page is ${page.url}: that is a dev server, not a debug build`);
  return page;
}

function connect(wsUrl, onEvent) {
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
      } else if (msg.method) {
        onEvent(msg.method, msg.params);
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

const calls = [];
const byId = new Map();
const inflight = new Set();
let step = 'load';
let lastActivity = Date.now();
const t0 = Date.now();

function isSidecar(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(u.hostname) && Number(u.port) !== PORT;
  } catch {
    return false;
  }
}

function parseBody(s) {
  if (s == null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function onEvent(method, p) {
  if (method === 'Network.requestWillBeSent') {
    if (!isSidecar(p.request.url) || p.request.method === 'OPTIONS') return;
    const u = new URL(p.request.url);
    const rec = {
      t: Date.now() - t0,
      step,
      method: p.request.method,
      endpoint: u.pathname,
      query: u.search || undefined,
      body: parseBody(p.request.postData),
      hasPostData: !!p.request.hasPostData,
    };
    calls.push(rec);
    byId.set(p.requestId, rec);
    inflight.add(p.requestId);
    lastActivity = Date.now();
  } else if (method === 'Network.responseReceived' && byId.has(p.requestId)) {
    byId.get(p.requestId).status = p.response.status;
  } else if ((method === 'Network.loadingFinished' || method === 'Network.loadingFailed') && byId.has(p.requestId)) {
    if (method === 'Network.loadingFailed') byId.get(p.requestId).failed = p.errorText;
    if (inflight.delete(p.requestId)) lastActivity = Date.now();
  }
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

async function waitFor(cdp, expression, what) {
  const end = Date.now() + STEP_TIMEOUT_MS;
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

// Idle = no sidecar request in flight and none started or finished for QUIET_MS.
async function settle(what) {
  const end = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < end) {
    if (inflight.size === 0 && Date.now() - lastActivity > QUIET_MS) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for sidecar calls to finish (${what})`);
}

const RUN_BTN = `[...document.querySelectorAll('[data-tour="run-button"]')].find((b) => b.offsetParent !== null)`;
const runReady = `(() => { const b = ${RUN_BTN}; return !!b && !b.disabled; })()`;
const clickTab = (label) =>
  `(() => { const t = [...document.querySelectorAll('[role="tab"]')].find((e) => e.offsetParent !== null && e.textContent.trim() === ${JSON.stringify(label)}); if (!t) return false; t.click(); return true; })()`;
const clickButton = (label) =>
  `(() => { const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && e.textContent.trim() === ${JSON.stringify(label)}); if (!b || b.disabled) return false; b.click(); return true; })()`;
// Fill an empty input with its placeholder through the native setter so Svelte's bind:value sees it.
const fillFromPlaceholder = (sel) =>
  `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; if (!el.value) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, el.placeholder); el.dispatchEvent(new Event('input', { bubbles: true })); } return el.value; })()`;

async function act(cdp, name, expression) {
  step = name;
  const ok = await evaluate(cdp, expression);
  if (!ok) throw new Error(`step "${name}": control not found or disabled`);
  console.log(`[${name}]`);
  await sleep(500);
  await settle(name);
}

async function main() {
  const page = await pageTarget();
  const cdp = await connect(page.webSocketDebuggerUrl, onEvent);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable', { maxPostDataSize: 1 << 20 });
  const href = await evaluate(cdp, 'location.href');
  if (/localhost:5173/.test(href)) throw new Error(`page is ${href}: refusing`);
  console.log(`page ${href}`);
  await evaluate(
    cdp,
    `localStorage.setItem('pry:onboarding_done','true');` +
      `localStorage.getItem('pry:active_preset') || localStorage.setItem('pry:active_preset','gpt2-small'); true`,
  );
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  try {
    step = 'load';
    await cdp.send('Page.navigate', { url: new URL('/', await evaluate(cdp, 'location.href')).href });
    await sleep(2000);
    await waitFor(cdp, runReady, 'GPT-2 small to load');
    await settle('load');
    console.log('[load]');

    for (const n of [1, 2]) {
      await act(cdp, `run-${n}`, `(() => { const b = ${RUN_BTN}; if (!b || b.disabled) return false; b.click(); return true; })()`);
      await waitFor(cdp, runReady, `run ${n} to finish`);
      await settle(`run-${n}`);
    }
    await act(cdp, 'attention', clickTab('Attention'));
    await act(cdp, 'logit-lens', clickTab('Logit Lens'));
    await act(cdp, 'dla', clickTab('Why (DLA)'));
    step = 'swap-test';
    await evaluate(cdp, clickTab('Swap test'));
    await sleep(500);
    await settle('swap-test tab');
    await evaluate(cdp, fillFromPlaceholder('#patch-clean'));
    await evaluate(cdp, fillFromPlaceholder('#patch-corrupted'));
    await sleep(1500);
    await settle('swap-test inputs');
    await waitFor(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && e.textContent.trim() === 'Run swap test'); return !!b && !b.disabled; })()`, 'Run swap test to enable');
    await act(cdp, 'swap-test', clickButton('Run swap test'));
    step = 'steer';
    await evaluate(cdp, clickTab('Steering'));
    await sleep(500);
    await settle('steering tab');
    await waitFor(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && e.textContent.trim() === 'Run Steered'); return !!b && !b.disabled; })()`, 'Run Steered to enable');
    await act(cdp, 'steer', clickButton('Run Steered'));
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  }

  // Fill in bodies CDP did not inline.
  for (const [id, rec] of byId) {
    if (rec.hasPostData && rec.body == null) {
      const r = await cdp.send('Network.getRequestPostData', { requestId: id }).catch(() => null);
      if (r) rec.body = parseBody(r.postData);
    }
    delete rec.hasPostData;
  }
  cdp.close();

  const summary = {};
  for (const c of calls) summary[`${c.step} ${c.method} ${c.endpoint}`] = (summary[`${c.step} ${c.method} ${c.endpoint}`] ?? 0) + 1;
  const out = { label: LABEL, recordedAt: new Date().toISOString(), page: href, viewport: '1280x800', calls, summary };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(Object.entries(summary).map(([k, v]) => `${v}x ${k}`).join('\n'));
  console.log(`saved ${OUT}: ${calls.length} calls`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
