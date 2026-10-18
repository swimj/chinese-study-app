import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { projectExperimentInput } from './contracts.ts';
import { readExperiment, type ExperimentRequest, type ExperimentResult } from './archive.ts';

export type ComparisonGuide = {
  title: string;
  question: string;
  context: string;
  takeaway: string;
  back: { label: string; href: string };
  previous?: { label: string; href: string };
  next?: { label: string; href: string };
  versions: Record<string, { label: string; description: string }>;
  examples: Array<{ runId: string; exerciseId: string; label: string; observation: string }>;
};

function escape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
const pre = (text: string) => `<pre>${escape(text)}</pre>`;
const cardId = (runId: string, exerciseId: string) => `card-${runId}-${encodeURIComponent(exerciseId)}`;
const link = (label: string, href: string) => `<a href="${escape(href)}">${escape(label)}</a>`;
const roleLabels = { bootstrap: 'Source word and uses', introduction: 'Teaching introduction',
  teaching_exercises: 'Recall after teaching', general_exercises: 'Unprimed practice' };

function runView(request: ExperimentRequest, result: ExperimentResult | null, guide?: ComparisonGuide): string {
  const intro = request.input.role === 'teaching_exercises'
    ? projectExperimentInput(request.input) as { deliveredIntroduction: { beats: Array<{ parts: Array<{ text: string }> }> } } : null;
  const version = guide?.versions[request.id];
  const cards = result?.validation?.preview?.cards ?? [];
  return `<section class="version" id="run-${request.id}"><header><h2>${escape(version?.label ?? request.variant)}</h2>
    ${version ? `<p>${escape(version.description)}</p>` : ''}
    <p class="label">${escape(request.variant)} · ${escape(roleLabels[request.input.role])} · ${cards.length} exercises</p></header>
    ${intro ? `<details><summary>What the learner was shown</summary>${intro.deliveredIntroduction.beats.map((beat) => pre(beat.parts.map((part) => part.text).join('\n'))).join('')}</details>` : ''}
    ${cards.map((card, index) => {
      const focus = guide?.examples.find((example) => example.runId === request.id && example.exerciseId === card.id);
      const use = request.input.role === 'bootstrap' ? null
        : request.input.content.uses.find((use) => use.id === card.sourceUseId);
      return `<article id="${escape(cardId(request.id, card.id))}" class="${focus ? 'spotlight' : ''}">
        ${focus ? `<p class="focus-label">${escape(focus.label)}</p><p class="observation">${escape(focus.observation)}</p>` : ''}
        <p class="label">Exercise ${index + 1}${use ? ` · ${escape(use.label)}` : ''}</p>${pre(card.cue)}
        <details><summary>Reveal answer and note</summary>${pre(card.answer)}${card.teachingNote ? pre(card.teachingNote) : ''}</details>
        ${focus ? '<a class="return-link" href="#reading-guide">Back to reading guide ↑</a>' : ''}</article>`;
    }).join('')}
    ${(result?.validation?.preview?.introductionBeats ?? []).map((parts) => `<article>${pre(parts.join('\n'))}</article>`).join('')}
    ${result?.validation?.structuralErrors.length ? `<h3>Structural issues</h3>${pre(result.validation.structuralErrors.join('\n'))}` : ''}
    <details><summary>Prompt and run details</summary><p>${escape(request.settings.model)} · ${escape(result?.status ?? 'prepared; no output')} · ${escape(result?.observation?.origin ?? 'no call recorded')}</p>${pre(request.prompt.text)}${pre(request.userPrompt)}${pre(result?.observation?.rawText ?? '')}</details>
  </section>`;
}

/** A static local preview; no remote scripts, assets, requests, or generated HTML execution. */
export async function renderExperimentComparison(root: string, ids: readonly string[], guide?: ComparisonGuide): Promise<string> {
  if (!ids.length) throw new Error('Select at least one run.');
  const runs = await Promise.all(ids.map(async (id) => {
    const request = await readExperiment(root, id);
    let result: ExperimentResult | null;
    try { result = JSON.parse(await readFile(path.join(root, id, 'result.json'), 'utf8')) as ExperimentResult; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      result = null;
    }
    if (result && result.requestId !== id) throw new Error('Result names another request.');
    return { request, result };
  }));
  if (guide) for (const example of guide.examples) {
    if (!runs.some(({ request, result }) => request.id === example.runId
      && result?.validation?.preview?.cards.some((card) => card.id === example.exerciseId))) {
      throw new Error('Reading guide names an absent example.');
    }
  }
  const navigation = guide ? `<nav class="navigation" aria-label="Review navigation">${link('← ' + guide.back.label, guide.back.href)}<span>${guide.previous ? link('Previous: ' + guide.previous.label, guide.previous.href) : ''}${guide.next ? link('Next: ' + guide.next.label + ' →', guide.next.href) : ''}</span></nav>` : '';
  const title = guide?.title ?? 'Vocabulary prompt comparison';
  const readingGuide = guide ? `<section class="reading-guide" id="reading-guide"><h2>${escape(guide.question)}</h2><p>${escape(guide.context)}</p><h3>Start with these examples</h3><ol>${guide.examples.map((example) => `<li>${link(example.label, '#' + cardId(example.runId, example.exerciseId))}<br><span>${escape(example.observation)}</span></li>`).join('')}</ol><p class="takeaway"><strong>My reading:</strong> ${escape(guide.takeaway)}</p><p>Then browse the complete pools below. The colored cards are the examples above. Answer disclosures let you inspect the cue before its answer; prompt details are at the end of each version.</p></section>` : '';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(title)}</title><style>
  *{box-sizing:border-box}html{scroll-padding-top:1rem}body{font:18px/1.5 system-ui,sans-serif;margin:0 auto;padding:1.5rem 2rem;max-width:90rem;color:#202622;background:#f5f4ee}h1{font-size:1.8rem}h2{font-size:1.35rem}h3{font-size:1.1rem}a{color:#245e40;text-underline-offset:.2em}a:focus-visible,summary:focus-visible{outline:3px solid #367958;outline-offset:3px}.navigation,.version-links{display:flex;flex-wrap:wrap;justify-content:space-between;gap:1rem}.navigation span{display:flex;flex-wrap:wrap;gap:1rem}.reading-guide{max-width:65rem;padding:1.25rem 1.5rem;background:#e7ede2;border:1px solid #aabca1;border-radius:.5rem;margin:1.5rem 0}.reading-guide li{margin:.8rem 0}.reading-guide li span{color:#445344}.takeaway{border-top:1px solid #b6c6b0;padding-top:1rem}.runs{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,26rem),1fr));gap:2rem}.version{min-width:0}.version header{border-bottom:2px solid #a6b4a3;padding-bottom:.5rem}article,details{background:white;border:1px solid #c5cbbf;border-radius:.5rem;padding:1rem;margin:1rem 0}article:target{outline:3px solid #4a7d58;outline-offset:3px}.spotlight{border-left:5px solid #537b45}.focus-label{font-weight:700;color:#365930;margin-top:0}.observation{font-size:1rem;background:#eef3e9;padding:.65rem;border-radius:.3rem}.return-link{font-size:.9rem}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:.5rem 0}.label{font-size:.9rem;color:#4c584e}summary{cursor:pointer}.footnote{color:#526052;font-size:.95rem;margin:2rem 0}@media(max-width:600px){body{padding:1rem}.reading-guide{padding:1rem}.runs{gap:1.25rem}}
  </style><body>${navigation}<h1>${escape(title)}</h1>${readingGuide}<nav class="version-links" aria-label="Prompt versions">${runs.map(({ request }) => link(guide?.versions[request.id]?.label ?? request.variant, '#run-' + request.id)).join('')}</nav><main class="runs">${runs.map(({ request, result }) => runView(request, result, guide)).join('')}</main><p class="footnote">Generated drafts and Codex editorial judgments. Structural checks do not establish linguistic quality or learning effectiveness. Source-use labels are authoring claims to inspect.</p>${navigation}</body></html>`;
}
