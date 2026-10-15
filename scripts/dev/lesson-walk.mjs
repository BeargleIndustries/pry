#!/usr/bin/env node
// Lessons walk driver (plan T8 step 4; dev-only, not part of any build).
// Node >= 22, no deps: CDP over the built-in fetch and WebSocket.
//
// Needs the debug build with the audit hooks compiled in (same as popup-audit.mjs):
//   cd ui && VITE_POPUP_AUDIT=1 npm run build
//   cd src-tauri && cargo build --features tauri/custom-protocol
// started with a scratch PRY_RUNTIME_DIR, a scratch WEBVIEW2_USER_DATA_FOLDER and
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333.
//
//   node scripts/dev/lesson-walk.mjs --out <evidence dir> [--port 9333]
//        [--lessons pry.p1-1,pry.p1-2] [--skip-walk --pid <pry.exe pid>] [--skip-user] [--appdata <dir>]
//
// Walk (every bundled sidebar lesson, from index order):
//   back-<id>.json                 section 1 on entry, then Next, then Back: the tool
//                                  snapshot, the rendered blocks and the slot strings
//                                  on screen, with `equal` (Back == forward entry).
//   carry-<id>.png                 the lesson's first explain-result section opened
//                                  directly, with nothing run before it.
//   lesson-<id>-s<n>-1280.png      every section at 1280x800, its steps driven
//                                  (predicts answered with the first choice or a
//                                  short guess, do steps run, a transfer's prompt
//                                  typed and run, observes shown).
//   lesson-<id>-1024.png           the first explain-result section at 1024x700.
//   slots in each section: author mode on, the value on screen against the expected
//   value shown beside it, within the slot's tolerance (recorded as mismatches).
// User lessons (--appdata = the app's data folder, %APPDATA%\com.beargle.pry). The
// harness build never reads that folder, so run this part (--skip-walk) on a plain
// debug build (`npm run build`, no VITE_POPUP_AUDIT); it drives the UI by its buttons:
//   lesson-install-permissions.png "Add a lesson..." with the community sample (Windows'
//                                  folder dialog answered by pick-folder.ps1; needs --pid).
//   hot-reload.png                 an image added to the installed lesson on disk.
//   lesson-error.png, lesson-check.png  a broken lesson in the picker, then
//                                  Settings > Lessons > Check this lesson.
//   lesson-blocked.png             the network grant revoked, the step that needs it.
// README screenshots: --readme <dir> [--tour-step step-4] [--predict-at <lesson>:<section>]
//   [--lesson-at <lesson>:<section>] [--check-at <lesson>:<section>] writes the docs/screenshots set at 1280x800 (harness build).
// walk-manifest.json: every screenshot with innerWidth x innerHeight, slot results,
// errors seen. Exit 1 on a Back mismatch, a slot mismatch or a missing screenshot.

import { writeFileSync, mkdirSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1] ?? 'true']);
    return acc;
  }, []),
);
const PORT = Number(args.port ?? 9333);
const OUT = resolve(args.out ?? 'lesson-walk');
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const APPDATA = args.appdata ? resolve(args.appdata) : join(process.env.APPDATA ?? '', 'com.beargle.pry');
const SAMPLE = join(REPO, 'docs', 'lessons', 'examples', 'community-sample', 'community.first-token');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageTarget() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find((t) => t.type === 'page' && /tauri\.localhost/.test(t.url)) ?? list.find((t) => t.type === 'page');
  if (!page) throw new Error(`no page target on port ${PORT}`);
  if (/localhost:5173/.test(page.url)) throw new Error('page is on localhost:5173 (not this app)');
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

let cdp;
async function ev(expression, awaitPromise = true) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expression, timeout = 15 * 60 * 1000, every = 500) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await ev(expression)) return true;
    } catch {
      /* mid-navigation */
    }
    await sleep(every);
  }
  return false;
}

const manifest = { started: new Date().toISOString(), shots: [], slots: [], slotMismatches: [], checks: [], checkMismatches: [], back: [], errors: [], notes: [] };
const expected = [];

async function snap(file) {
  expected.push(file);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, file), Buffer.from(data, 'base64'));
  const size = await ev('({ w: window.innerWidth, h: window.innerHeight })');
  manifest.shots.push({ file, innerWidth: size.w, innerHeight: size.h, bytes: Buffer.from(data, 'base64').length });
  console.log(`  ${file} ${size.w}x${size.h}`);
}

async function setSize(w, h) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
}

/** In-page helpers, installed after every navigation. */
const HELPERS = String.raw`
window.__t8 = (() => {
  const L = () => window.__pryLessons;
  const A = () => L().app();
  const R = () => A().runner;
  const flat = (steps) => steps.flatMap((s) => [s, ...flat(s.children ?? [])]);
  const has = (steps, kind) => flat(steps).some((s) => s.kind === kind);
  const settled = () => { const r = R(); return !!r && !r.entering && !r.busy; };
  const until = async (fn, ms = 120000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
  const slotsOnScreen = () => [...document.querySelectorAll('[data-lesson-sidebar] [data-slot]')].map((el) => ({
    name: el.getAttribute('data-slot'), text: el.textContent.trim(),
    beside: el.nextElementSibling && !el.nextElementSibling.hasAttribute('data-slot') ? el.nextElementSibling.textContent.trim() : null,
  }));
  return {
    settled,
    async open(id, sectionId = null) {
      await L().open('right');
      const ok = await L().openLesson(id, sectionId);
      await until(() => !!document.querySelector('[data-lesson-sidebar] [data-lesson-heading]'), 30000);
      await until(settled);
      return ok;
    },
    close() { L().close(); return true; },
    sections() { return R().lesson.sections.map((s) => ({ id: s.id, er: has(s.steps, 'explain-result') })); },
    async goto(i) { await R().goto(i); await until(settled); return R().index; },
    async next() { await R().next(); await until(settled); return R().index; },
    async back() { await R().back(); await until(settled); return R().index; },
    state() {
      const r = R();
      return { snap: L().snapshot(), blocks: JSON.parse(JSON.stringify(r.render().blocks)), slots: slotsOnScreen().map((s) => [s.name, s.text]) };
    },
    error() { return R().error ?? null; },
    /** The check results on screen (observe checks against the lesson's recorded value, the learner's prediction, a run). */
    checks() { return [...document.querySelectorAll('[data-lesson-sidebar] [data-check-result]')].map((el) => ({ step: el.closest('[data-step-id]')?.getAttribute('data-step-id') ?? null, text: el.textContent.trim().replace(/\s+/g, ' ') })); },
    /** Drives the current section: predicts, questions, do steps, observes, tasks. */
    async drive() {
      const r = R();
      const sec = r.section;
      const log = [];
      // A transfer step names a prompt the learner types and runs: the driver does that before its observe.
      let typed = null;
      for (const s of flat(sec.steps)) {
        if (s.kind === 'transfer' && typeof s.fields.prompt === 'string') { typed = { prompt: s.fields.prompt, ran: false }; continue; }
        if (s.kind === 'observe' && typed && !typed.ran) {
          try { await A().runAction('set_prompt', { prompt: typed.prompt }); await A().runAction('run', {}); log.push('typed:' + typed.prompt); } catch (e) { log.push('typed:err ' + (e && e.message)); }
          typed.ran = true;
          await until(settled, 120000);
        }
        if (!['predict', 'question', 'recall', 'do', 'observe', 'task'].includes(s.kind)) continue;
        try { if (!r.whenHolds(s)) { log.push(s.kind + ':when-off'); continue; } } catch {}
        const key = r.keyOf(sec, s);
        try {
          if (s.kind === 'predict' || s.kind === 'question' || s.kind === 'recall') {
            const choices = s.fields.choices ?? [];
            if (choices.length) await r.answer(key, { choice: 0 });
            else if (s.fields.pick) await r.skipStep(key);
            else await r.answer(key, { text: 'My guess' });
          } else if (s.kind === 'do') await r.doStep(key);
          else if (s.kind === 'observe') await r.showObserve(key);
          else if (s.kind === 'task') { await r.taskRun(key); await r.taskCheck(key); }
          log.push(s.kind + ':ok');
        } catch (e) { log.push(s.kind + ':err ' + (e && e.message)); }
        await until(settled, 120000);
      }
      return log;
    },
    /** Scrolls the sidebar to the explain-result (or the last observe result) so the screenshot shows it. */
    scrollToResult() {
      const side = document.querySelector('[data-lesson-sidebar]');
      if (!side) return null;
      const el = side.querySelector('[data-step-kind="explain-result"]') ?? [...side.querySelectorAll('[data-check-result]')].at(-1) ?? null;
      if (el) el.scrollIntoView({ block: 'center' });
      return el ? el.getAttribute('data-step-kind') ?? 'check-result' : null;
    },
    /** Author mode on: the slot value on screen beside its expected value, and the runner's numbers. */
    async slotCheck() {
      const app = A(); const r = R(); const sec = r.section;
      app.setAuthorMode(true);
      await new Promise((res) => setTimeout(res, 300));
      const shown = slotsOnScreen();
      const defs = { ...(r.lesson.meta.slots ?? {}), ...(sec.slots ?? {}) };
      const rec = r.slotRecord(sec);
      app.setAuthorMode(false);
      await new Promise((res) => setTimeout(res, 150));
      const out = [];
      const seen = new Set();
      for (const s of shown) {
        if (seen.has(s.name)) continue; seen.add(s.name);
        const d = defs[s.name] ?? {}; const v = rec[s.name] ?? { live: null, expect: null };
        let ok = null; let why = '';
        const tolFor = (e) => (typeof d.tolerance === 'number' ? d.tolerance : Math.max(1e-3, Math.abs(e) * 1e-3));
        // Expected values are recorded to 4-5 significant figures: numbers inside lists and records match within tolerance.
        const near = (got, want) => {
          if (typeof want === 'number') return typeof got === 'number' && Math.abs(got - want) <= tolFor(want);
          if (Array.isArray(want)) return Array.isArray(got) && got.length >= want.length && want.every((w, i) => near(got[i], w));
          if (want && typeof want === 'object') return !!got && typeof got === 'object' && Object.entries(want).every(([k, w]) => near(got[k], w));
          return got === want;
        };
        if (d.formula || v.expect === null || v.expect === 'learner' || v.expect === 'pending') { why = 'no recorded expect'; }
        else if (v.live === null || v.live === undefined) { why = 'no live value yet (the slot shows its placeholder until the learner runs it)'; }
        else { ok = near(v.live, v.expect); why = typeof v.expect === 'number' ? 'tol ' + tolFor(v.expect) : 'within tolerance per number'; }
        out.push({ name: s.name, onScreen: s.text, besideOnScreen: s.beside, live: v.live, expect: v.expect, ok, why });
      }
      return out;
    },
  };
})(); true`;

async function freshPage(w, h) {
  await setSize(w, h);
  const page = await pageTarget();
  const base = new URL(page.url);
  base.pathname = '/';
  base.search = '';
  base.hash = '';
  // First-time tips marked seen, so a tip from the app's tip system doesn't sit over every screenshot.
  const tips = [...readFileSync(join(REPO, 'ui', 'src', 'lib', 'tips', 'tips-registry.ts'), 'utf8').matchAll(/^\s+id: ['"]([a-zA-Z0-9.:_-]+)['"]/gm)].map((m) => m[1]);
  await ev(`${JSON.stringify(tips)}.forEach((t) => localStorage.setItem('pry:tip_seen:' + t, 'true')); true`);
  await ev(`localStorage.setItem('pry:onboarding_done','true'); localStorage.setItem('pry:tutorial_seen','true'); localStorage.getItem('pry:active_preset') || localStorage.setItem('pry:active_preset','gpt2-small'); true`);
  await cdp.send('Page.navigate', { url: base.href });
  await sleep(3000);
  if (!(await waitFor('window.__pryLessons?.loaded?.() === true'))) throw new Error('the model never loaded');
  await sleep(1000);
  await ev(HELPERS);
}

async function lessonIds() {
  const idx = readFileSync(join(REPO, 'ui', 'src', 'lessons', 'index.yaml'), 'utf8');
  const ids = [...idx.matchAll(/id:\s*(pry\.p\d-\d)/g)].map((m) => m[1]);
  const uniq = [...new Set(ids)];
  return args.lessons ? uniq.filter((x) => args.lessons.split(',').includes(x)) : uniq;
}

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function walk() {
  const ids = await lessonIds();
  console.log(`walking ${ids.length} lessons`);
  await freshPage(1280, 800);
  const firstEr = {};
  for (const id of ids) {
    console.log(`[${id}]`);
    // Back into section 1 equals the forward entry.
    await ev('window.__t8.close()');
    await ev(`window.__t8.open(${JSON.stringify(id)})`);
    const secs = await ev('window.__t8.sections()');
    await ev(`window.__t8.goto(0)`);
    await sleep(800);
    const forward = await ev('window.__t8.state()');
    await ev('window.__t8.next()');
    await sleep(800);
    await ev('window.__t8.back()');
    await sleep(800);
    const backed = await ev('window.__t8.state()');
    const equal = { snapshot: deepEqual(forward.snap, backed.snap), blocks: deepEqual(forward.blocks, backed.blocks), slots: deepEqual(forward.slots, backed.slots) };
    const allEqual = equal.snapshot && equal.blocks && equal.slots;
    writeFileSync(join(OUT, `back-${id}.json`), JSON.stringify({ lesson: id, section: secs[0].id, equal: allEqual, parts: equal, forward, back: backed }, null, 2));
    manifest.back.push({ lesson: id, section: secs[0].id, equal: allEqual, parts: equal });
    console.log(`  back-${id}.json equal=${allEqual}`);

    // Carry: the first explain-result section entered directly.
    const er = secs.findIndex((s) => s.er);
    firstEr[id] = er;
    if (er >= 0) {
      await ev('window.__t8.close()');
      await ev(`window.__t8.open(${JSON.stringify(id)}, ${JSON.stringify(secs[er].id)})`);
      await sleep(1500);
      await snap(`carry-${id}.png`);
      const err = await ev('window.__t8.error()');
      if (err) manifest.errors.push({ where: `carry ${id}/${secs[er].id}`, error: err });
    } else manifest.notes.push(`${id}: no explain-result section`);

    // Every section at 1280, driven.
    await ev('window.__t8.close()');
    await ev(`window.__t8.open(${JSON.stringify(id)})`);
    for (let i = 0; i < secs.length; i++) {
      await ev(`window.__t8.goto(${i})`);
      const log = await ev('window.__t8.drive()');
      const err = await ev('window.__t8.error()');
      if (err) manifest.errors.push({ where: `${id}/${secs[i].id}`, error: err });
      if (log.some((x) => x.includes(':err'))) manifest.errors.push({ where: `${id}/${secs[i].id}`, drive: log });
      for (const c of await ev('window.__t8.checks()')) {
        manifest.checks.push({ lesson: id, section: secs[i].id, ...c });
        if (/^The app shows something different from what the lesson expected/.test(c.text)) manifest.checkMismatches.push({ lesson: id, section: secs[i].id, ...c });
      }
      const slots = await ev('window.__t8.slotCheck()');
      for (const s of slots) {
        manifest.slots.push({ lesson: id, section: secs[i].id, ...s });
        if (s.ok === false) manifest.slotMismatches.push({ lesson: id, section: secs[i].id, ...s });
      }
      await ev('window.__t8.scrollToResult()');
      await sleep(1000);
      await snap(`lesson-${id}-s${i + 1}-1280.png`);
    }
  }

  // One section per lesson at 1024x700.
  await freshPage(1024, 700);
  for (const id of ids) {
    const er = Math.max(0, firstEr[id] ?? 0);
    await ev('window.__t8.close()');
    await ev(`window.__t8.open(${JSON.stringify(id)})`);
    await ev(`window.__t8.goto(${er})`);
    await ev('window.__t8.drive()');
    await ev('window.__t8.scrollToResult()');
    await sleep(1000);
    await snap(`lesson-${id}-1024.png`);
  }
  await ev('window.__t8.close()');
}

// ---------------------------------------------------------------------------
// User lessons: install, hot reload, broken lesson, revoked grant
// ---------------------------------------------------------------------------

const BROKEN = `---
format: 1
id: community.broken
title: "A lesson with a mistake in it"
tool: pry
summary: "This one has a typo in a directive, on purpose."
minutes: 2
model: gpt2-small
baseline: { prompt: "The cat sat on the" }
---

## Start {id=start}

:::explian{id=intro}
This directive name is misspelled.
:::
`;

// The harness build (VITE_POPUP_AUDIT=1) never touches the user-lesson folder,
// so this part runs on a plain debug build and drives the UI by its buttons
// (no __pryLessons hooks there).
const DOM = String.raw`
window.__t8u = (() => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (fn()) return true; } catch {} await wait(200); } return false; };
  const btn = (root, re) => [...(root ?? document).querySelectorAll('button')].find((b) => re.test(b.textContent.trim()));
  const side = () => document.querySelector('[data-lesson-sidebar]');
  return {
    until,
    async lessonsOpen() {
      if (!side()) document.querySelector('[data-tour="lessons-toggle"]')?.click();
      return until(() => !!side());
    },
    async picker() {
      await this.lessonsOpen();
      if (!document.querySelector('[data-testid="lesson-picker"]')) btn(side(), /^All lessons$/)?.click();
      return until(() => !!document.querySelector('[data-testid="lesson-picker"]'));
    },
    async pick(id) {
      await this.picker();
      const b = document.querySelector('[data-testid="lesson-picker"] [data-lesson-id="' + id + '"]');
      if (!b) return false;
      b.click();
      return until(() => !document.querySelector('[data-testid="lesson-picker"]'));
    },
    async settings() {
      if (!document.querySelector('[data-testid="settings-lessons"]')) document.querySelector('[data-tour="settings-button"]')?.click();
      const ok = await until(() => !!document.querySelector('[data-testid="settings-lessons"]'));
      document.querySelector('[data-testid="settings-lessons"]')?.scrollIntoView({ block: 'start' });
      return ok;
    },
    closeSettings() { const b = document.querySelector('[aria-label="Settings"] button[aria-label^="Close"], [aria-label="Close settings"]'); if (b) b.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; },
    clickIn(sel, re) { const b = btn(document.querySelector(sel), re); if (!b) return false; b.click(); return true; },
    userRow(re) { return [...document.querySelectorAll('[data-testid="settings-lessons"] li')].find((li) => re.test(li.textContent)) ?? null; },
    text(sel) { return document.querySelector(sel)?.innerText ?? null; },
    async nextUntil(re, max = 8) {
      for (let i = 0; i < max; i++) {
        if (re.test(side()?.querySelector('[data-lesson-heading]')?.textContent ?? '') || re.test(side()?.innerText ?? '')) return true;
        btn(side(), /^Next/)?.click();
        await wait(1500);
      }
      return re.test(side()?.innerText ?? '');
    },
  };
})(); true`;

async function plainPage(w, h) {
  await setSize(w, h);
  const page = await pageTarget();
  const base = new URL(page.url);
  base.pathname = '/';
  base.search = '';
  base.hash = '';
  const tips = [...readFileSync(join(REPO, 'ui', 'src', 'lib', 'tips', 'tips-registry.ts'), 'utf8').matchAll(/^\s+id: ['"]([a-zA-Z0-9.:_-]+)['"]/gm)].map((m) => m[1]);
  await ev(`${JSON.stringify(tips)}.forEach((t) => localStorage.setItem('pry:tip_seen:' + t, 'true')); localStorage.setItem('pry:onboarding_done','true'); localStorage.setItem('pry:tutorial_seen','true'); localStorage.getItem('pry:active_preset') || localStorage.setItem('pry:active_preset','gpt2-small'); true`);
  await cdp.send('Page.navigate', { url: base.href });
  await sleep(4000);
  // No audit hooks here: "loaded" = the model chip shows and the Run button is enabled.
  await waitFor(`!!document.querySelector('[data-tour="lessons-toggle"]') && !document.body.innerText.includes('Loading GPT-2')`, 10 * 60 * 1000, 1000);
  await sleep(1500);
  await ev(DOM);
}

async function userLessons() {
  const installed = join(APPDATA, 'lessons', 'community.first-token');
  if (!args.pid) throw new Error('--pid <pry.exe process id> is needed to answer the folder dialog');
  manifest.notes.push(`user lessons: app data ${APPDATA}; "Add a lesson..." with the real folder dialog, answered by scripts/dev/pick-folder.ps1 with ${SAMPLE}`);

  await plainPage(1280, 800);
  await ev('window.__t8u.lessonsOpen()');
  await sleep(1500);
  // "Add a lesson...": the click opens Windows' folder dialog (modal, so the click isn't awaited);
  // pick-folder.ps1 types the sample folder into it and presses Select Folder.
  await ev('window.__t8u.settings()');
  const clicked = await ev(`(() => { const b = [...document.querySelectorAll('[data-testid="settings-lessons"] button')].find((x) => /^Add a lesson/.test(x.textContent.trim())); if (!b) return false; setTimeout(() => b.click(), 50); return true; })()`);
  if (!clicked) manifest.errors.push({ where: 'install', error: 'no "Add a lesson..." button' });
  const picked0 = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(HERE, 'pick-folder.ps1'), '-procId', String(args.pid), '-folder', SAMPLE], { encoding: 'utf8' });
  manifest.notes.push(`folder dialog: ${picked0.trim().replace(/\s+/g, ' ')}`);
  const sheet = await waitFor(`!!document.querySelector('[data-testid="lesson-install"]')`, 20000, 250);
  await sleep(1000);
  if (!sheet) manifest.errors.push({ where: 'install', error: 'install sheet never opened', settings: await ev(`window.__t8u.text('[data-testid="settings-lessons"]')`) });
  await snap('lesson-install-permissions.png');
  manifest.notes.push(`install sheet: ${JSON.stringify(await ev(`window.__t8u.text('[data-testid="lesson-install"]')`))}`);
  const approved = await ev(`window.__t8u.clickIn('[data-testid="lesson-install"]', /^Allow all$/)`);
  manifest.notes.push(`install approved (Allow all): ${approved}`);
  await sleep(2000);
  await ev('window.__t8u.closeSettings()');
  await sleep(800);

  // Hot reload: the installed lesson open, an image added to it on disk.
  const picked = await ev(`window.__t8u.pick('community.first-token')`);
  manifest.notes.push(`community.first-token opened from the picker: ${picked}`);
  await sleep(2500);
  if (!existsSync(join(installed, 'lesson.md'))) manifest.errors.push({ where: 'hot-reload', error: `not installed at ${installed}` });
  else {
    mkdirSync(join(installed, 'images'), { recursive: true });
    copyFileSync(join(REPO, 'src-tauri', 'icons', '128x128.png'), join(installed, 'images', 'pry-icon.png'));
    const md = readFileSync(join(installed, 'lesson.md'), 'utf8');
    const withImage = md.replace(
      /(:::explain\{id=intro\}[\s\S]*?)\n:::/,
      `$1\n\n\`\`\`yaml\nimage: images/pry-icon.png\nalt: "Pry's icon, added while the lesson was open to show hot reload."\n\`\`\`\n:::`,
    );
    if (withImage === md) manifest.errors.push({ where: 'hot-reload', error: 'could not add the image block' });
    writeFileSync(join(installed, 'lesson.md'), withImage);
    // In place first (the open section re-renders), then by reopening it from the picker.
    const inPlace = await waitFor(`!!document.querySelector('[data-lesson-sidebar] img[alt^="Pry"]')`, 8000, 300);
    manifest.notes.push(`hot reload: image shown in the open lesson without reopening it: ${inPlace}`);
    if (!inPlace) {
      manifest.errors.push({ where: 'hot-reload', error: 'the open lesson did not re-render after its file changed (the picker did pick up the change)' });
      await ev(`window.__t8u.pick('community.first-token')`);
      await waitFor(`!!document.querySelector('[data-lesson-sidebar] img[alt^="Pry"]')`, 10000, 300);
    }
    await sleep(800);
    const img = await ev(`(() => { const i = document.querySelector('[data-lesson-sidebar] img[alt^="Pry"]'); if (!i) return null; i.scrollIntoView({ block: 'center' }); return { naturalWidth: i.naturalWidth, complete: i.complete, src: i.src.slice(0, 40) }; })()`);
    manifest.notes.push(`hot reload image: ${JSON.stringify(img)}`);
    if (!img) manifest.errors.push({ where: 'hot-reload', error: 'image not in the sidebar after reopening' });
    else if (!img.naturalWidth) manifest.errors.push({ where: 'hot-reload', error: `image element present but not drawn (naturalWidth 0, ${img.src})` });
    await sleep(800);
    await snap('hot-reload.png');
  }

  // A broken lesson dropped into the lessons folder: the picker shows its error.
  mkdirSync(join(APPDATA, 'lessons', 'community.broken'), { recursive: true });
  writeFileSync(join(APPDATA, 'lessons', 'community.broken', 'lesson.md'), BROKEN);
  await sleep(2500);
  await ev('window.__t8u.picker()');
  await sleep(1000);
  const errShown = await ev(`(() => { const li = [...document.querySelectorAll('[data-testid="lesson-picker"] li')].find((x) => /community\\.broken|mistake in it/.test(x.textContent)); li?.scrollIntoView({ block: 'center' }); return li ? li.innerText.trim() : null; })()`);
  manifest.notes.push(`broken lesson in the picker: ${JSON.stringify(errShown)}`);
  if (!errShown) manifest.errors.push({ where: 'lesson-error', error: 'community.broken not in the picker' });
  await sleep(600);
  await snap('lesson-error.png');
  // Settings > Lessons > Check this lesson.
  await ev('window.__t8u.settings()');
  const checked = await ev(`(() => { const li = window.__t8u.userRow(/community\\.broken|mistake in it/); const b = li && [...li.querySelectorAll('button')].find((x) => /^Check this lesson$/.test(x.textContent.trim())); if (!b) return false; b.click(); return true; })()`);
  if (!checked) manifest.errors.push({ where: 'lesson-check', error: 'no Check this lesson button for community.broken' });
  await waitFor(`!!window.__t8u.userRow(/community\\.broken|mistake in it/)?.querySelector('[aria-live]')`, 15000, 300);
  await ev(`window.__t8u.userRow(/community\\.broken|mistake in it/)?.scrollIntoView({ block: 'center' }); true`);
  await sleep(800);
  await snap('lesson-check.png');
  manifest.notes.push(`check result: ${JSON.stringify(await ev(`window.__t8u.userRow(/community\\.broken|mistake in it/)?.innerText ?? null`))}`);

  // Revoke the sample's grant in Settings, then run the step that needs the network.
  const revoked = await ev(`(() => { const li = window.__t8u.userRow(/first guess has a space|community\\.first-token/); const b = li && [...li.querySelectorAll('button')].find((x) => /^Revoke$/.test(x.textContent.trim())); if (!b) return false; b.click(); return true; })()`);
  if (!revoked) manifest.errors.push({ where: 'lesson-blocked', error: 'no Revoke button for community.first-token' });
  await sleep(1500);
  manifest.notes.push(`after revoke: ${JSON.stringify(await ev(`window.__t8u.userRow(/first guess has a space|community\\.first-token/)?.innerText ?? null`))}`);
  await ev('window.__t8u.closeSettings()');
  await sleep(800);
  // The install sheet may come back up asking again: leave it unanswered.
  await ev(`window.__t8u.clickIn('[data-testid="lesson-install"]', /^Don.t allow$/) || true`);
  await sleep(800);
  await ev(`window.__t8u.pick('community.first-token')`);
  await sleep(2000);
  const reached = await ev(`window.__t8u.nextUntil(/Look it up/)`);
  if (!reached) manifest.errors.push({ where: 'lesson-blocked', error: 'never reached the "Look it up" section' });
  await ev(`window.__t8u.clickIn('[data-lesson-sidebar]', /^Do it$/)`);
  await sleep(2500);
  const blockedText = await ev(`(() => { const s = document.querySelector('[data-lesson-sidebar]'); const el = [...s.querySelectorAll('*')].find((x) => /needs a permission/.test(x.textContent) && x.children.length === 0); el?.scrollIntoView({ block: 'center' }); return el ? el.textContent.trim() : null; })()`);
  if (!blockedText) manifest.errors.push({ where: 'lesson-blocked', error: 'no blocked message shown' });
  manifest.notes.push(`blocked message: ${JSON.stringify(blockedText)}`);
  await sleep(600);
  await snap('lesson-blocked.png');
}

// ---------------------------------------------------------------------------
// README screenshots (--readme <dir>): the app's panels with Lessons off, driven
// through the same tool actions lessons use, plus the sidebar and the tour.
// ---------------------------------------------------------------------------

const IOI = 'When Mary and John went to the store, John gave a drink to';

async function act(name, a = {}) {
  await ev(`window.__pryLessons.app().runAction(${JSON.stringify(name)}, ${JSON.stringify(a)}).then(() => true)`);
  await sleep(1200);
}

async function readmeShots(dir) {
  mkdirSync(dir, { recursive: true });
  const shotTo = async (file) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(dir, file), Buffer.from(data, 'base64'));
    const size = await ev('`${window.innerWidth}x${window.innerHeight}`');
    console.log(`  ${file} ${size}`);
  };
  const runPrompt = async (p) => {
    await ev(`window.__pryTour.run(${JSON.stringify(p)}).then(() => true)`);
    await sleep(2500);
  };
  // Scrolls only the panel's own scroller (scrollIntoView would also scroll the page).
  const scrollTo = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; let p = el.parentElement; while (p && !(p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement; if (p) p.scrollTop += el.getBoundingClientRect().bottom - p.getBoundingClientRect().bottom + 24; window.scrollTo(0, 0); document.scrollingElement.scrollTop = 0; return !!p; })()`);
  await freshPage(1280, 800);
  // The Lessons app is made on first open; the panel shots run its tool actions with the sidebar closed.
  await ev(`window.__pryLessons.open('right').then(() => true)`);
  await sleep(800);
  await ev('window.__t8.close()');

  await runPrompt('The cat sat on the');
  await act('open_panel', { panel: 'attention' });
  await act('open_panel', { panel: 'predictions' });
  await shotTo('attention.png');

  await runPrompt('Michael Jordan played the sport of');
  await act('open_panel', { panel: 'logit-lens' });
  await act('run_logit_lens');
  await sleep(1500);
  await shotTo('logit-lens.png');

  await runPrompt(IOI);
  await act('open_panel', { panel: 'dla' });
  await act('run_dla', { answer: ' Mary', contrast: ' John' });
  await sleep(1500);
  await scrollTo('[data-tour="dla-total-line"]');
  await sleep(800);
  await shotTo('why-dla.png');

  await act('open_panel', { panel: 'circuit' });
  await act('run_circuit');
  await sleep(1500);
  await shotTo('key-parts.png');

  await act('open_panel', { panel: 'patching' });
  await act('run_patching', { clean: IOI, corrupted: 'When Mary and John went to the store, Mary gave a drink to', type: 'head' });
  await sleep(2000);
  await shotTo('swap-test.png');

  await runPrompt('The doctor told the nurse she would');
  await act('open_panel', { panel: 'attention' });
  await act('open_panel', { panel: 'features' });
  await sleep(1500);
  await shotTo('features.png');

  await act('set_compare_mode', { on: true });
  await act('set_compare', { a: 'The doctor said that', b: 'The nurse said that' });
  await act('run_compare');
  await sleep(2500);
  await shotTo('compare.png');
  await act('set_compare_mode', { on: false });

  // The quick tour, on a run.
  await runPrompt(IOI);
  await act('open_panel', { panel: 'attention' });
  await ev(`window.__pryTour.start(${JSON.stringify(args['tour-step'] ?? 'step-4')})`);
  await sleep(2500);
  await shotTo('quick-tour.png');
  await ev('window.__pryTour.close(); true');
  await sleep(800);

  // Lessons: a predict step not yet answered, then a lesson mid-section with a check result.
  const [pl, ps] = (args['predict-at'] ?? 'pry.p1-1:s3-1').split(':');
  await ev(`window.__t8.open(${JSON.stringify(pl)}, ${JSON.stringify(ps)})`);
  await sleep(1500);
  await scrollTo('[data-lesson-sidebar] [data-step-kind="predict"]');
  await sleep(800);
  await shotTo('lesson-predict.png');
  const [ll, ls] = (args['lesson-at'] ?? 'pry.p1-1:s3-2').split(':');
  await ev('window.__t8.close()');
  await ev(`window.__t8.open(${JSON.stringify(ll)}, ${JSON.stringify(ls)})`);
  await ev('window.__t8.drive()');
  await sleep(1200);
  await shotTo('lessons.png');
  const [cl, cs] = (args['check-at'] ?? 'pry.p2-2:s3-5').split(':');
  await ev('window.__t8.close()');
  await ev(`window.__t8.open(${JSON.stringify(cl)}, ${JSON.stringify(cs)})`);
  await ev('window.__t8.drive()');
  await sleep(1200);
  await ev(`(() => { const el = [...document.querySelectorAll('[data-lesson-sidebar] [data-check-result]')].at(-1); el?.scrollIntoView({ block: 'center' }); return !!el; })()`);
  await sleep(800);
  await shotTo('lesson-check.png');
  await ev('window.__t8.close()');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const page = await pageTarget();
  cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  if (args.readme) {
    await readmeShots(resolve(args.readme));
    cdp.close();
    process.exit(0);
  }
  if (args['skip-walk'] !== 'true') await walk();
  if (args['skip-user'] !== 'true') await userLessons();
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  manifest.finished = new Date().toISOString();
  const missing = expected.filter((f) => !existsSync(join(OUT, f)));
  const backBad = manifest.back.filter((b) => !b.equal);
  const manifestFile = join(OUT, args['manifest'] ?? 'walk-manifest.json');
  let prior = null;
  if (existsSync(manifestFile)) try { prior = JSON.parse(readFileSync(manifestFile, 'utf8')); } catch { prior = null; }
  // A partial run (--skip-walk / --skip-user / --lessons) merges into the manifest already there.
  if (prior && (args['skip-walk'] === 'true' || args['skip-user'] === 'true' || args.lessons)) {
    const files = new Set(manifest.shots.map((s) => s.file));
    manifest.shots = [...prior.shots.filter((s) => !files.has(s.file)), ...manifest.shots];
    const backIds = new Set(manifest.back.map((b) => b.lesson));
    manifest.back = [...prior.back.filter((b) => !backIds.has(b.lesson)), ...manifest.back];
    const slotIds = new Set(manifest.slots.map((s) => s.lesson));
    manifest.slots = [...prior.slots.filter((s) => !slotIds.has(s.lesson)), ...manifest.slots];
    manifest.slotMismatches = [...prior.slotMismatches.filter((s) => !slotIds.has(s.lesson)), ...manifest.slotMismatches];
    manifest.checks = [...(prior.checks ?? []).filter((s) => !slotIds.has(s.lesson)), ...manifest.checks];
    manifest.checkMismatches = [...(prior.checkMismatches ?? []).filter((s) => !slotIds.has(s.lesson)), ...manifest.checkMismatches];
    if (prior.analysis) manifest.analysis = prior.analysis;
    manifest.errors = [...prior.errors, ...manifest.errors];
    manifest.notes = [...prior.notes, ...manifest.notes];
  }
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  const checked = manifest.slots.filter((s) => s.ok !== null).length;
  console.log(`WALK SHOTS ${manifest.shots.length} (missing ${missing.length}) / BACK EQUAL ${manifest.back.length - backBad.length}/${manifest.back.length} / SLOTS OK ${checked - manifest.slotMismatches.length}/${checked} (mismatch ${manifest.slotMismatches.length}) / CHECKS vs lesson DIFFER ${manifest.checkMismatches.length}/${manifest.checks.length} / ERRORS ${manifest.errors.length}`);
  cdp.close();
  process.exit(missing.length || backBad.length || manifest.slotMismatches.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
