#!/usr/bin/env node
// Popup audit driver (dev-only; not part of any build). Node >= 22, no deps:
// uses the built-in fetch and WebSocket to talk CDP to a running Pry window.
//
// 1. Build the UI with the audit compiled in, then the app:
//      cd ui && VITE_POPUP_AUDIT=1 npm run build
//      cd src-tauri && cargo build --features tauri/custom-protocol
//    (or run `cargo tauri dev`, where the audit is always available).
// 2. Start it with a scratch WebView2 profile and CDP on a port:
//      WEBVIEW2_USER_DATA_FOLDER=<scratch dir>
//      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333
// 3. node scripts/dev/popup-audit.mjs [--port 9333] [--sizes 1280x800,1024x700]
//      [--out popup-audit.json] [--shots <dir>]
//
// For each size it emulates the viewport (Emulation.setDeviceMetricsOverride),
// loads `/?popupAudit=1`, waits for the in-page audit's PASS line and saves
// window.__popupAudit. Exit code is non-zero if any size has FAIL > 0 or
// SKIP > 0, or never finished.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1] ?? 'true']);
    return acc;
  }, []),
);
const PORT = Number(args.port ?? 9333);
const SIZES = (args.sizes ?? '1280x800,1024x700,960x700,740x700').split(',').map((s) => s.split('x').map(Number));
const OUT = resolve(args.out ?? 'popup-audit.json');
const SHOTS = args.shots ? resolve(args.shots) : null;
const TIMEOUT_MS = Number(args.timeout ?? 40 * 60 * 1000);
const GUIDE_TOUR_SIZES = new Set(['1024x700', '740x700']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageTarget() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find((t) => t.type === 'page' && /tauri\.localhost|localhost/.test(t.url)) ?? list.find((t) => t.type === 'page');
  if (!page) throw new Error(`no page target on port ${PORT}`);
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
        const { resolve: ok, reject: no } = pending.get(msg.id);
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
          return new Promise((ok, no) => pending.set(mid, { resolve: ok, reject: no }));
        },
        close: () => ws.close(),
      });
  });
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

async function shot(cdp, file) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, file), Buffer.from(data, 'base64'));
  console.log(`  screenshot ${file}`);
}

async function main() {
  const page = await pageTarget();
  const base = new URL(page.url);
  base.pathname = '/';
  base.search = '';
  base.hash = '';
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // The audit runs on a scratch WebView2 profile: mark onboarding done so the
  // app opens the main window (GPT-2 small) instead of the welcome screens.
  await evaluate(
    cdp,
    `localStorage.setItem('pry:onboarding_done','true');` +
      `localStorage.getItem('pry:active_preset') || localStorage.setItem('pry:active_preset','gpt2-small'); true`,
  );

  const results = [];
  let failed = false;
  for (const [w, h] of SIZES) {
    const key = `${w}x${h}`;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    const url = new URL(base);
    url.searchParams.set('popupAudit', '1');
    if (GUIDE_TOUR_SIZES.has(key)) url.searchParams.set('guideTour', '1');
    console.log(`[${key}] ${url.href}`);
    await cdp.send('Page.navigate', { url: url.href });
    await sleep(3000);
    const end = Date.now() + TIMEOUT_MS;
    let line = null;
    while (Date.now() < end) {
      try {
        line = await evaluate(cdp, 'window.__popupAudit?.line ?? null');
      } catch {
        line = null; // page mid-navigation
      }
      if (line) break;
      await sleep(3000);
    }
    if (!line) {
      const at = await evaluate(cdp, 'window.__popupAuditProgress ?? null').catch(() => null);
      console.log(`POPUP AUDIT PASS 0 / FAIL 1 / SKIP 0 @ ${key} (timed out at ${at})`);
      results.push({ size: key, line: null, error: 'timed out' });
      failed = true;
      continue;
    }
    const report = await evaluate(cdp, 'JSON.parse(JSON.stringify(window.__popupAudit))');
    results.push({ size: key, ...report });
    console.log(line + (report.error ? `  (error: ${report.error})` : ''));
    for (const r of report.records.filter((x) => !x.pass)) {
      console.log(`  FAIL ${r.phase}/${r.kind}/${r.id} mode=${r.mode} side=${r.side}: ${r.failures.join('; ')}`);
    }
    const m = /PASS (\d+) \/ FAIL (\d+) \/ SKIP (\d+)/.exec(line);
    if (!m || Number(m[2]) > 0 || Number(m[3]) > 0) failed = true;

    // Evidence screenshots: one anchored step at 1280, an inset step, the sheet at 740.
    if (SHOTS) {
      const showStep = async (id) => evaluate(cdp, `window.__popupAuditShow?.(${JSON.stringify(id)})`, true);
      if (key === '1280x800') {
        await showStep('basics.run');
        await shot(cdp, 'popup-1280.png');
      }
      const inset = report.records.find((r) => r.kind === 'tour' && r.mode === 'inset' && r.phase === 'main');
      if (inset && !results.some((x) => x.insetShot)) {
        await showStep(inset.id);
        await shot(cdp, 'popup-inset.png');
        results.at(-1).insetShot = inset.id;
      }
      if (w < 760) {
        await showStep('basics.run');
        await shot(cdp, `popup-${w}-sheet.png`);
      }
      await evaluate(cdp, 'window.__popupAuditShow?.(null)', true);
    }
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  cdp.close();
  writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`saved ${OUT}`);
  console.log(results.map((r) => r.line ?? `timed out @ ${r.size}`).join('\n'));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
