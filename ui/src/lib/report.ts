// Shareable HTML report (T27): turns notebook entries into one self-contained
// .html file. Inline CSS only: no scripts, fonts, images or other network
// loads, and a Content-Security-Policy that blocks them anyway. The only links
// are the ones the app already shows: Neuronpedia feature pages and experiment
// card citations.
//
// Every piece of user or model text goes through escapeHtml. Tokens and notes
// can contain anything, including HTML.
import type { NotebookEntry } from './notebook';
import { neuronpediaUrl } from './preset-display';
import { isNamedFeature } from './feature-label';
import { pct, quoteToken } from './readouts';
import type { AblateResponse, FeatureHit } from './types';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only plain http(s) links make it into the report. */
function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

function link(url: string, text: string): string {
  const safe = safeUrl(url);
  if (!safe) return escapeHtml(text);
  return `<a href="${escapeHtml(safe)}" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
}

/** Anchor id for an entry; ids come from a file, so keep only safe characters. */
function anchorId(entry: NotebookEntry, i: number): string {
  const clean = entry.id.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return `entry-${clean || i}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function para(text: string | null | undefined): string {
  return text ? `<p>${escapeHtml(text)}</p>` : '';
}

const CSS = `
:root { color-scheme: light dark; --bg:#fafafa; --fg:#18181b; --muted:#52525b; --line:#d4d4d8; --card:#fff; --accent:#4f46e5; --code:#f4f4f5; }
@media (prefers-color-scheme: dark) { :root { --bg:#09090b; --fg:#f4f4f5; --muted:#a1a1aa; --line:#3f3f46; --card:#18181b; --accent:#a5b4fc; --code:#27272a; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
main { max-width:780px; margin:0 auto; padding:32px 16px 64px; }
h1 { font-size:1.6rem; margin:0 0 4px; }
h2 { font-size:1.25rem; margin:0 0 4px; }
h3 { font-size:1rem; margin:24px 0 6px; }
a { color:var(--accent); }
.muted { color:var(--muted); font-size:.9rem; }
article { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:20px; margin:24px 0; }
.prompt { white-space:pre-wrap; word-break:break-word; background:var(--code); border-radius:6px; padding:10px 12px; font-family:ui-monospace,Consolas,monospace; font-size:.95rem; }
.note { white-space:pre-wrap; word-break:break-word; border-left:3px solid var(--accent); padding:4px 12px; }
table { border-collapse:collapse; width:100%; font-size:.92rem; }
th, td { text-align:left; padding:5px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--muted); font-weight:600; }
code { font-family:ui-monospace,Consolas,monospace; background:var(--code); padding:0 4px; border-radius:4px; }
footer { margin-top:40px; }
`;

function predictionsTable(preds: { token: string; probability: number; rank: number }[] | undefined): string {
  if (!preds || preds.length === 0) return '';
  const rows = [...preds]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 10)
    .map((p) => `<tr><td>${p.rank}</td><td><code>${escapeHtml(quoteToken(p.token))}</code></td><td>${escapeHtml(pct(p.probability))}</td></tr>`)
    .join('');
  return `<table><thead><tr><th>Rank</th><th>Next word</th><th>Chance</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function featureLabel(hit: FeatureHit): string {
  const label = hit.description?.trim();
  return isNamedFeature(hit) && label ? escapeHtml(label) : '<span class="muted">no label yet</span>';
}

function featuresSection(entry: NotebookEntry): string {
  const r = entry.run.response;
  const last = r.tokens[r.tokens.length - 1];
  const feats = r.sae_features.find((f) => f.token_index === last?.index);
  if (!feats && !entry.readouts.features) return '';
  const layer = entry.run.saeLayer ?? r.sae_layer_used;
  const display = {
    neuronpedia_model_id: entry.model.neuronpediaModelId,
    neuronpedia_release_suffix: entry.model.neuronpediaReleaseSuffix,
  };
  const rows = feats
    ? [...feats.top_k]
        .sort((a, b) => b.activation - a.activation)
        .slice(0, 10)
        .map((h) => {
          const url = neuronpediaUrl(display, layer, h.id);
          const more = url ? link(url, 'Neuronpedia') : '<span class="muted">none</span>';
          return `<tr><td>#${h.id}</td><td>${featureLabel(h)}</td><td>${h.activation.toFixed(2)}</td><td>${more}</td></tr>`;
        })
        .join('')
    : '';
  const table = rows
    ? `<table><thead><tr><th>Feature</th><th>Label</th><th>Strength</th><th>More</th></tr></thead><tbody>${rows}</tbody></table>`
    : '';
  const heading = last ? `Features on the last word, ${escapeHtml(quoteToken(last.text))} (layer ${layer})` : 'Features';
  return `<h3>${heading}</h3>${para(entry.readouts.features)}${table}<p class="muted">Features are patterns a separate tool (a sparse autoencoder) found inside the model. Labels come from Neuronpedia and are best guesses, not certainties.</p>`;
}

function topOf(preds: { token: string; probability: number; rank: number }[]): string {
  const top = [...preds].sort((a, b) => a.rank - b.rank)[0];
  return top ? `${quoteToken(top.token)} (${pct(top.probability)})` : 'nothing';
}

function ablationLine(label: string, r: AblateResponse | null): string {
  if (!r) return '';
  return `<li>${escapeHtml(`${label}: the top guess was ${topOf(r.original_predictions)} before and ${topOf(r.ablated_predictions)} after.`)}</li>`;
}

function otherRuns(entry: NotebookEntry): string {
  const run = entry.run;
  const items: string[] = [];
  if (run.steerResponse) {
    const s = run.steerResponse;
    items.push(
      `<li>${escapeHtml(`Steering: feature #${s.feature_id} turned to strength ${s.alpha}.`)}<br>` +
        `<span class="muted">Before:</span> ${escapeHtml(s.original_generation)}<br>` +
        `<span class="muted">After:</span> ${escapeHtml(s.steered_generation)}</li>`,
    );
  }
  items.push(ablationLine('Knocking out attention heads', run.headAblateResponse));
  items.push(ablationLine('Knocking out features', run.featureAblateResponse));
  if (run.patchResponse) {
    const p = run.patchResponse;
    const top = [...p.components]
      .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
      .slice(0, 3)
      .map((c) => `${c.name} (${c.effect.toFixed(2)})`);
    items.push(
      `<li>${escapeHtml(
        `Swap & Compare (${p.patch_type}): "${p.clean_prompt}" predicts ${quoteToken(p.clean_predicted_token)}; ` +
          `"${p.corrupted_prompt}" predicts ${quoteToken(p.corrupted_predicted_token)}.` +
          (top.length ? ` Parts with the biggest effect when swapped: ${top.join(', ')}.` : ''),
      )}</li>`,
    );
  }
  if (run.circuitResponse) {
    const c = run.circuitResponse;
    const names = [...c.nodes]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 5)
      .map((n) => (n.type === 'mlp' ? `MLP ${n.layer}` : `head ${n.layer}.${n.head}`));
    items.push(
      `<li>${escapeHtml(
        `Key parts: ${c.nodes.length} parts passed the threshold` +
          (names.length ? `; the strongest were ${names.join(', ')}.` : '.') +
          ' This list does not show how the parts connect.',
      )}</li>`,
    );
  }
  const shown = items.filter(Boolean);
  if (shown.length === 0) return '';
  return `<h3>Other experiments in this run</h3><ul>${shown.join('')}</ul>`;
}

function experimentSection(entry: NotebookEntry): string {
  const exp = entry.experiment;
  if (!exp) return '';
  const cites = exp.citations.map((c) => `<li>${link(c.url, c.label)}</li>`).join('');
  return `<h3>From the experiment card "${escapeHtml(exp.title)}"</h3>${cites ? `<p>What researchers found is described in:</p><ul>${cites}</ul>` : ''}`;
}

function entrySection(entry: NotebookEntry, i: number): string {
  const r = entry.readouts;
  const charts = [
    r.attention ? `<li><strong>Attention.</strong> ${escapeHtml(r.attention)}</li>` : '',
    r.logitLens ? `<li><strong>Logit Lens.</strong> ${escapeHtml(r.logitLens)}</li>` : '',
    r.dla ? `<li><strong>Why (DLA).</strong> ${escapeHtml(r.dla)}</li>` : '',
  ].filter(Boolean);
  return [
    `<article id="${anchorId(entry, i)}">`,
    `<h2>${escapeHtml(entry.title)}</h2>`,
    `<p class="muted">${escapeHtml(formatDate(entry.createdAt))} · ${escapeHtml(entry.model.name)}</p>`,
    `<h3>Prompt</h3><div class="prompt">${escapeHtml(entry.prompt)}</div>`,
    entry.note.trim() ? `<h3>Notes</h3><div class="note">${escapeHtml(entry.note)}</div>` : '',
    `<h3>What the model guessed next</h3>`,
    para(r.predictions),
    predictionsTable(entry.run.response.top_predictions),
    charts.length ? `<h3>What the charts showed</h3><ul>${charts.join('')}</ul>` : '',
    featuresSection(entry),
    otherRuns(entry),
    experimentSection(entry),
    `</article>`,
  ].join('\n');
}

export interface ReportOptions {
  generatedAt?: Date;
  /** Page title; defaults to the entry title (one entry) or "Pry lab notebook". */
  title?: string;
}

/** A complete, self-contained HTML document for one or more notebook entries. */
export function buildReport(entries: NotebookEntry[], opts: ReportOptions = {}): string {
  const generatedAt = opts.generatedAt ?? new Date();
  const title = opts.title ?? (entries.length === 1 ? entries[0].title : 'Pry lab notebook');
  const toc =
    entries.length > 1
      ? `<nav><h3>In this report</h3><ol>${entries
          .map((e, i) => `<li><a href="#${anchorId(e, i)}">${escapeHtml(e.title)}</a> <span class="muted">${escapeHtml(formatDate(e.createdAt))}</span></li>`)
          .join('')}</ol></nav>`
      : '';
  const body = entries.length
    ? entries.map(entrySection).join('\n')
    : '<p>This notebook has no saved runs yet.</p>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="generator" content="Pry">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header>
<h1>${escapeHtml(title)}</h1>
<p class="muted">A report from Pry, made ${escapeHtml(formatDate(generatedAt.toISOString()))}. Every number here was computed on the author's own computer.</p>
</header>
${toc}
${body}
<footer class="muted">
<p>How to read this: the sentences are plain-language summaries of Pry's charts. Attention shows where a word looks, not what the model relies on. "Why (DLA)" shows direct pushes only, so the parts don't add up to the final score. Feature labels are best guesses.</p>
<p>This file is self-contained. It loads nothing from the internet; the links above only open if you click them.</p>
</footer>
</main>
</body>
</html>
`;
}

/** File name for a saved report, e.g. `pry-report-2026-10-11T12-00-00-000Z.html`. */
export function reportFileName(now: Date = new Date()): string {
  return `pry-report-${now.toISOString().replace(/[:.]/g, '-')}.html`;
}
