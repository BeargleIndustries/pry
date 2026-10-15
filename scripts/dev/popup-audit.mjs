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
//
// The quick tour (plan T7b): every run walks all 12 steps of `pry.quick-tour`
// (the overlay lesson) after the fixed prompt has run, and checks the run
// survives the tour.
//   --skip-tour        leave out the tour pass.
//   --tour-shots <dir> screenshots of every tour step at 1280x800 and 1024x700
//                      after a run (quick-tour-<stepId>-<w>.png), plus steps 3-8 at
//                      1024x700 on a fresh launch before any Run
//                      (quick-tour-<stepId>-empty-1024.png).
//
// Lessons (plan T3):
//   Every run adds the learning-mode pass: the Lessons sidebar open beside the
//   app on both sides at 1280x800 and 1024x700, on the right at 960x700 and
//   740x700. Each checks that no tip covers `lesson-sidebar`, the honesty box
//   is in the viewport on explain-result steps, and no drawn arrow is over 160px.
//   --a11y             axe-core 4.10.2 (scripts/dev/vendor/axe.min.js) over the
//                      sidebar on pry.p1-1 and over Settings > Lessons at 1280x800;
//                      saves the sidebar's accessibility tree to --a11y-tree.
//                      Exit 1 on any serious or critical violation, an unnamed
//                      control, or a check result outside a live region.
//   --lesson-shots <dir>  the T3 evidence screenshots.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const SKIP_TOUR = args['skip-tour'] === 'true';
/** Learning-mode pass sides per size (plan T3 acceptance). */
const LESSON_SIDES = { '1280x800': 'both', '1024x700': 'both', '960x700': 'right', '740x700': 'right' };
const HERE = dirname(fileURLToPath(import.meta.url));

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

  if (args.a11y === 'true') {
    const code = await a11yMode(cdp, base);
    cdp.close();
    process.exit(code);
  }
  if (args['lesson-shots']) {
    const code = await lessonShots(cdp, base, resolve(args['lesson-shots']));
    cdp.close();
    process.exit(code);
  }
  if (args['tour-shots']) {
    const code = await tourShots(cdp, base, resolve(args['tour-shots']));
    cdp.close();
    process.exit(code);
  }

  const results = [];
  let failed = false;
  for (const [w, h] of SIZES) {
    const key = `${w}x${h}`;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    const url = new URL(base);
    url.searchParams.set('popupAudit', '1');
    if (SKIP_TOUR) url.searchParams.set('skipTour', '1');
    url.searchParams.set('lessons', LESSON_SIDES[key] ?? 'right');
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
        await showStep('step-2');
        await shot(cdp, 'popup-1280.png');
      }
      const inset = report.records.find((r) => r.kind === 'tour' && r.mode === 'inset' && r.phase === 'main');
      if (inset && !results.some((x) => x.insetShot)) {
        await showStep(inset.id);
        await shot(cdp, 'popup-inset.png');
        results.at(-1).insetShot = inset.id;
      }
      if (w < 760) {
        await showStep('step-2');
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


// ---------------------------------------------------------------------------
// Lessons (plan T3): --a11y and --lesson-shots
// ---------------------------------------------------------------------------

async function waitForExpr(cdp, expression, timeout = 15 * 60 * 1000, every = 1000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await evaluate(cdp, expression, true)) return true;
    } catch {
      /* page mid-navigation */
    }
    await sleep(every);
  }
  return false;
}

async function openApp(cdp, base, w, h) {
  if (w) await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  else await cdp.send('Emulation.clearDeviceMetricsOverride');
  await cdp.send('Page.navigate', { url: base.href });
  await sleep(3000);
  if (!(await waitForExpr(cdp, 'window.__pryLessons?.loaded?.() === true'))) throw new Error('the model never loaded');
  await sleep(1000);
}

async function openLesson(cdp, side, sectionId = null) {
  await evaluate(cdp, `window.__pryLessons.open(${JSON.stringify(side)}).then(() => window.__pryLessons.openLesson('pry.p1-1', ${JSON.stringify(sectionId)}))`, true);
  await waitForExpr(cdp, `!!document.querySelector('[data-lesson-sidebar] [data-lesson-heading]')`, 30000, 250);
  await sleep(1500);
}

const INTERACTIVE = new Set(['button', 'textbox', 'checkbox', 'radio', 'link', 'combobox', 'slider', 'spinbutton', 'switch', 'tab', 'menuitem', 'separator']);

/** The sidebar's accessibility subtree, as indented "role \"name\"" lines, and its unnamed controls. */
async function sidebarTree(cdp) {
  await cdp.send('DOM.enable');
  await cdp.send('Accessibility.enable');
  const doc = await cdp.send('DOM.getDocument', { depth: 0 });
  const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[data-lesson-sidebar]' });
  if (!q.nodeId) return { lines: ['(no sidebar)'], unnamed: ['sidebar'], controls: 0 };
  const d = await cdp.send('DOM.describeNode', { nodeId: q.nodeId });
  const full = await cdp.send('Accessibility.getFullAXTree');
  const byId = new Map(full.nodes.map((n) => [n.nodeId, n]));
  const root = full.nodes.find((n) => n.backendDOMNodeId === d.node.backendNodeId);
  const lines = [];
  const unnamed = [];
  let controls = 0;
  const walk = (n, depth) => {
    if (!n) return;
    const role = n.role?.value ?? '';
    const name = (n.name?.value ?? '').replace(/\s+/g, ' ').trim();
    const shown = !n.ignored && role && role !== 'none' && role !== 'generic' && role !== 'InlineTextBox' && role !== 'StaticText';
    if (shown) {
      lines.push(`${'  '.repeat(depth)}${role}${name ? ` "${name.slice(0, 140)}"` : ''}`);
      if (INTERACTIVE.has(role)) {
        controls++;
        if (!name) unnamed.push(`${role} (backend ${n.backendDOMNodeId})`);
      }
    }
    for (const id of n.childIds ?? []) walk(byId.get(id), shown ? depth + 1 : depth);
  };
  walk(root, 0);
  return { lines, unnamed, controls };
}

async function axeOn(cdp, selector) {
  return evaluate(
    cdp,
    `axe.run(document.querySelector(${JSON.stringify(selector)}), { resultTypes: ['violations'] }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) })))`,
    true,
  );
}

async function a11yMode(cdp, base) {
  await openApp(cdp, base, 1280, 800);
  await openLesson(cdp, 'right');
  const drove = await evaluate(cdp, 'window.__pryLessons.driveObserve()', true);
  await sleep(1500);
  await evaluate(cdp, `${readFileSync(join(HERE, 'vendor', 'axe.min.js'), 'utf8')};true`);
  const version = await evaluate(cdp, 'axe.version');
  const side = await axeOn(cdp, '[data-lesson-sidebar]');
  const live = await evaluate(
    cdp,
    `(() => { const el = document.querySelector('[data-lesson-sidebar] [data-check-result] p'); if (!el) return { found: false }; const r = el.closest('[aria-live]'); return { found: true, text: el.textContent.trim(), live: r ? r.getAttribute('aria-live') : null }; })()`,
  );
  const tree = await sidebarTree(cdp);
  const treeFile = resolve(args['a11y-tree'] ?? 'a11y-tree-p1-1.txt');
  writeFileSync(treeFile, `# Lessons sidebar on pry.p1-1, 1280x800, after one observe is shown\n${tree.lines.join('\n')}\n`);
  await evaluate(cdp, 'window.__pryLessons.close(); window.__pryLessons.openSettings(); true');
  await waitForExpr(cdp, `!!document.querySelector('[data-testid="settings-lessons"]')`, 10000, 250);
  await evaluate(cdp, `document.querySelector('[data-testid="settings-lessons"]').scrollIntoView(); true`);
  await sleep(800);
  const settings = await axeOn(cdp, '[data-testid="settings-lessons"]');
  await cdp.send('Emulation.clearDeviceMetricsOverride');

  const bad = (vs) => vs.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const lines = [
    `A11Y axe ${version} sidebar pry.p1-1: serious/critical ${bad(side).length} (all ${side.length})`,
    `A11Y axe ${version} settings-lessons: serious/critical ${bad(settings).length} (all ${settings.length})`,
    `A11Y sidebar controls named: ${tree.controls - tree.unnamed.length}/${tree.controls}`,
    `A11Y check result in live region: ${live.found && live.live === 'polite' ? `yes (aria-live=polite: "${live.text}")` : `no (${JSON.stringify(live)}; observe driven: ${drove})`}`,
    `A11Y tree saved ${treeFile}`,
  ];
  for (const v of [...side, ...settings]) lines.push(`  ${v.impact} ${v.id}: ${v.help} (${v.nodes} node(s): ${v.targets.join(' | ')})`);
  for (const u of tree.unnamed) lines.push(`  unnamed ${u}`);
  console.log(lines.join('\n'));
  if (OUT) writeFileSync(OUT, JSON.stringify({ version, sidebar: side, settings, live, unnamed: tree.unnamed, controls: tree.controls }, null, 2));
  const ok = bad(side).length === 0 && bad(settings).length === 0 && tree.unnamed.length === 0 && live.found && live.live === 'polite';
  return ok ? 0 : 1;
}

async function lessonShots(cdp, base, dir) {
  mkdirSync(dir, { recursive: true });
  const snap = async (file) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(dir, file), Buffer.from(data, 'base64'));
    const size = await evaluate(cdp, '`${window.innerWidth}x${window.innerHeight}`');
    console.log(`  screenshot ${file} ${size}`);
  };
  // 1280: right, then left.
  await openApp(cdp, base, 1280, 800);
  await openLesson(cdp, 'right', 's3-2');
  await snap('sidebar-open-1280.png');
  await evaluate(cdp, 'window.__pryLessons.close(); true');
  await openLesson(cdp, 'left', 's3-2');
  await snap('sidebar-open-left-1280.png');
  await evaluate(cdp, 'window.__pryLessons.close(); true');
  // 1024: tabbed, then the rail, then a pointer at a closed tab.
  await openApp(cdp, base, 1024, 700);
  await openLesson(cdp, 'right', 's3-2');
  await snap('sidebar-open-1024.png');
  await evaluate(cdp, 'window.__pryLessons.collapse(true); true');
  await sleep(800);
  await snap('sidebar-rail-1024.png');
  await evaluate(cdp, 'window.__pryLessons.collapse(false); true');
  await sleep(800);
  await evaluate(cdp, `window.__pryLessons.pointHidden('dla-waterfall'); true`);
  await sleep(1200);
  await snap('pointer-hidden-target.png');
  await evaluate(cdp, 'window.__pryLessons.close(); true');
  // The install sheet.
  await openLesson(cdp, 'right');
  await evaluate(cdp, 'window.__pryLessons.showInstall(); true');
  await sleep(800);
  await snap('lesson-install-permissions.png');
  // Widen: the real window, no emulation.
  await openApp(cdp, base, 0, 0);
  await evaluate(cdp, 'window.__pryLessons.setWindowSize(1024, 700)', true);
  await sleep(1500);
  await openLesson(cdp, 'right', 's3-2');
  await sleep(1000);
  const shown = await evaluate(cdp, 'window.__pryLessons.widenVisible()');
  await snap('widen-before-1024.png');
  let code = 0;
  if (!shown) {
    console.log('  widen button not shown (monitor too small?)');
    code = 1;
  } else {
    await evaluate(cdp, 'window.__pryLessons.widen()', true);
    await sleep(2000);
    await snap('widen-after.png');
    const split = await evaluate(cdp, `!!document.querySelector('[data-lessons-main] [data-tour="left-tab-strip"], [data-lessons-main] [data-tip="left-tab-strip"]')`);
    console.log(`  after widen: ${await evaluate(cdp, '`${window.innerWidth}x${window.innerHeight}`')}, split ${split}`);
  }
  await evaluate(cdp, 'window.__pryLessons.close(); window.__pryLessons.setWindowSize(1280, 800)', true);
  return code;
}

// ---------------------------------------------------------------------------
// The quick tour (plan T7b): --tour-shots
// ---------------------------------------------------------------------------

const IOI = 'When Mary and John went to the store, John gave a drink to';

async function tourShots(cdp, base, dir) {
  mkdirSync(dir, { recursive: true });
  const snap = async (file) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(dir, file), Buffer.from(data, 'base64'));
    const size = await evaluate(cdp, '`${window.innerWidth}x${window.innerHeight}`');
    console.log(`  screenshot ${file} ${size}`);
  };
  const fresh = async (w, h) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    // The tour is started by the driver, not by the first-launch auto-start.
    await evaluate(cdp, `localStorage.setItem('pry:tutorial_seen','true'); true`);
    await cdp.send('Page.navigate', { url: base.href });
    await sleep(3000);
    if (!(await waitForExpr(cdp, 'window.__pryTour?.loaded?.() === true'))) throw new Error('the model never loaded');
    await sleep(1500);
  };
  const show = async (id) => {
    await evaluate(cdp, `window.__pryTour.start(${JSON.stringify(id)})`, true);
    const ok = await waitForExpr(cdp, `document.querySelector('[data-testid="overlay-card"]')?.getAttribute('data-step-id') === ${JSON.stringify(id)}`, 10000, 200);
    await sleep(1500);
    return ok;
  };
  let missing = 0;
  // Steps 3-8 on a fresh launch, before any Run: each must read correctly empty.
  await fresh(1024, 700);
  const ran = await evaluate(cdp, `!!document.querySelector('[data-tour="token-strip"] [data-token-index]')`);
  console.log(`  fresh launch, before any Run (tokens on screen: ${ran})`);
  for (let n = 3; n <= 8; n++) {
    if (!(await show(`step-${n}`))) missing++;
    await snap(`quick-tour-step-${n}-empty-1024.png`);
  }
  await evaluate(cdp, 'window.__pryTour.close(); true');
  // Every step after a run, at both sizes.
  for (const [w, h] of [[1280, 800], [1024, 700]]) {
    await fresh(w, h);
    await evaluate(cdp, `window.__pryTour.run(${JSON.stringify(IOI)})`, true);
    await sleep(1500);
    for (let n = 1; n <= 12; n++) {
      if (!(await show(`step-${n}`))) missing++;
      await snap(`quick-tour-step-${n}-${w}.png`);
    }
    await evaluate(cdp, 'window.__pryTour.close(); true');
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  console.log(`TOUR SHOTS ${missing === 0 ? 'OK' : `MISSING ${missing}`}`);
  return missing === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
