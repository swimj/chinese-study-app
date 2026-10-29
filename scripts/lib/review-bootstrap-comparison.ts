import { createHash } from 'node:crypto';
import { normalizeReviewExercises } from '../../server/word-content/review-authoring.ts';
import { materializeExercise } from '../../src/domain/word-content/materialize.ts';
import { parseWordContent } from '../../src/domain/word-content/validation.ts';
import type { WordContentDocument } from '../../src/domain/word-content/types.ts';

export type ComparisonCue = {
  id: string;
  cueType: string;
  text: string;
  answers: string[];
  supplement: { englishFrame: string; exampleSentence: string; exampleTranslation: string } | null;
};
export type ComparisonWord = {
  wordId: string;
  hanzi: string;
  sourceContentId: string;
  sourceContentSha256: string;
  sourceContent: WordContentDocument;
  oldReviewLatencyMs: number | null;
  oldCues: ComparisonCue[];
  oldError: string | null;
  current: {
    status: 'not_run' | 'valid' | 'invalid' | 'error';
    elapsedMs: number | null;
    cues: ComparisonCue[];
    rawOutput?: unknown;
    rawText?: string;
    validationError?: string;
    error?: string;
  };
};
export type ComparisonReport = {
  schemaVersion: 1;
  sourceReport: string;
  sourceReportSha256: string;
  sourceModel: string;
  currentModel: string;
  sourceTransport: string;
  currentTransport: string;
  sourceReviewPromptSha256: string;
  currentReviewPromptSha256: string;
  mode: 'offline' | 'live';
  startedAt: string;
  finishedAt: string | null;
  words: ComparisonWord[];
};

type SourceReport = {
  model: string;
  providerTransport: string;
  promptHashes: { review: string };
  selectedWords: string[];
  encounters: Array<{
    wordId: string; hanzi: string; error?: string | null;
    stages?: Array<{ stage: string; elapsedMs?: number }>;
    reviewFollowup?: { stages?: Array<{ stage: string; elapsedMs?: number }> };
    response?: { contents?: Array<{ content: unknown }> };
    cues?: unknown[];
  }>;
};

function object(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} must be text.`);
  return value;
}
function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(`${name} must be text list.`);
  return value;
}
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function oldCue(value: unknown): ComparisonCue {
  const cue = object(value, 'Old cue');
  const supplement = cue.supplement === null || cue.supplement === undefined ? null : object(cue.supplement, 'Old supplement');
  return {
    id: text(cue.cueId, 'Old cue ID'), cueType: text(cue.cueType, 'Old cue type'),
    text: text(cue.text, 'Old cue text'), answers: stringArray(cue.answers, 'Old answers'),
    supplement: supplement ? {
      englishFrame: typeof supplement.englishFrame === 'string' ? supplement.englishFrame : '',
      exampleSentence: typeof supplement.exampleSentence === 'string' ? supplement.exampleSentence : '',
      exampleTranslation: typeof supplement.exampleTranslation === 'string' ? supplement.exampleTranslation : '',
    } : null,
  };
}
function reviewLatency(encounter: SourceReport['encounters'][number]): number | null {
  const stage = encounter.stages?.find((item) => item.stage === 'review')
    ?? encounter.reviewFollowup?.stages?.find((item) => item.stage === 'review');
  return typeof stage?.elapsedMs === 'number' && Number.isFinite(stage.elapsedMs) ? stage.elapsedMs : null;
}

/** Parse exactly the five saved, immutable bootstrap documents. No generation or database access. */
export function comparisonWordsFromSource(value: unknown): {
  sourceModel: string; sourceTransport: string; sourceReviewPromptSha256: string; words: ComparisonWord[];
} {
  const source = object(value, 'Source report') as unknown as SourceReport;
  const selected = stringArray(source.selectedWords, 'Selected words');
  if (selected.length !== 5 || new Set(selected).size !== 5 || !Array.isArray(source.encounters)) {
    throw new Error('Source report must contain five distinct selected words and encounters.');
  }
  const words = selected.map((selectedWord): ComparisonWord => {
    const matches = source.encounters.filter((entry) => entry.wordId === selectedWord || entry.hanzi === selectedWord);
    if (matches.length !== 1) throw new Error(`Expected one encounter for ${selectedWord}.`);
    const encounter = matches[0]!;
    const wordId = encounter.wordId;
    const contents = encounter.response?.contents;
    if (!Array.isArray(contents) || contents.length < 1) throw new Error(`Saved bootstrap content missing for ${wordId}.`);
    const sourceContent = parseWordContent(contents[0]!.content);
    if (sourceContent.word.wordId !== wordId || sourceContent.word.hanzi !== encounter.hanzi) {
      throw new Error(`Saved bootstrap identity mismatch for ${wordId}.`);
    }
    const oldCues = Array.isArray(encounter.cues) ? encounter.cues.map(oldCue) : [];
    return {
      wordId, hanzi: encounter.hanzi, sourceContentId: sourceContent.id,
      sourceContentSha256: sha256(JSON.stringify(sourceContent)), sourceContent,
      oldReviewLatencyMs: reviewLatency(encounter), oldCues,
      oldError: encounter.error ?? null,
      current: { status: 'not_run', elapsedMs: null, cues: [] },
    };
  });
  return {
    sourceModel: text(source.model, 'Source model'),
    sourceTransport: text(source.providerTransport, 'Source transport'),
    sourceReviewPromptSha256: text(source.promptHashes?.review, 'Source review prompt SHA'),
    words,
  };
}

/** Validate exactly as the worker does, then materialize the learner-visible cues. */
export function normalizedComparisonCues(raw: unknown, content: WordContentDocument): ComparisonCue[] {
  const authored = normalizeReviewExercises(raw, content, (localId) => `comparison:${content.word.wordId}:${localId}`);
  return authored.map(({ exercise, cueType, supplement }) => {
    const snapshot = materializeExercise(exercise, [content]);
    const example = supplement?.kind === 'example'
      ? content.examples.find((entry) => entry.id === supplement.example.exampleId) : null;
    if (supplement?.kind === 'example' && !example) throw new Error('Validated supplement source is missing.');
    return {
      id: exercise.id, cueType, text: snapshot.stimulus.text,
      answers: exercise.acceptedAnswers.map((answer) => answer.hanzi),
      supplement: supplement?.kind === 'example' && example ? {
        englishFrame: supplement.englishFrame,
        exampleSentence: example.text, exampleTranslation: example.translation,
      } : null,
    };
  });
}

export function escapeHtml(value: unknown): string {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function cueHtml(cue: ComparisonCue): string {
  const supplement = cue.supplement ? `<p>${escapeHtml(cue.supplement.englishFrame)}</p>
    <p lang="zh-Hans">${escapeHtml(cue.supplement.exampleSentence)}</p>
    <p>${escapeHtml(cue.supplement.exampleTranslation)}</p>` : '<p>No supplement</p>';
  return `<article class="cue"><span class="cue-type">${escapeHtml(cue.cueType)}</span>
    <p class="stimulus">${escapeHtml(cue.text)}</p>
    <details><summary>Reveal answer and supplement</summary>
      <p>Answer: ${escapeHtml(cue.answers.join(' / '))}</p>${supplement}</details></article>`;
}
function timeLabel(ms: number | null): string {
  return ms === null ? 'Unavailable' : `${(ms / 1000).toFixed(1)} s`;
}
function wordHtml(word: ComparisonWord): string {
  const old = word.oldCues.length ? word.oldCues.map(cueHtml).join('') : '<p>No validated old cues.</p>';
  const fresh = word.current.cues.length ? word.current.cues.map(cueHtml).join('')
    : `<p>${word.current.status === 'not_run' ? 'New review not run (offline validation).' : 'No validated new cues.'}</p>`;
  const issue = word.current.validationError ?? word.current.error;
  return `<section class="word"><header><h2>${escapeHtml(word.hanzi)}</h2>
    <p><code>${escapeHtml(word.wordId)}</code> · Source <code>${escapeHtml(word.sourceContentId)}</code></p>
    <p>New status: <strong>${escapeHtml(word.current.status)}</strong>${issue ? ` · ${escapeHtml(issue)}` : ''}</p>
    ${word.oldError ? `<p>Original run issue: ${escapeHtml(word.oldError)}</p>` : ''}</header>
    <div class="columns"><div><h3>Old review · ${timeLabel(word.oldReviewLatencyMs)}</h3>${old}</div>
    <div><h3>New review · ${timeLabel(word.current.elapsedMs)}</h3>${fresh}</div></div></section>`;
}
export function renderComparisonHtml(report: ComparisonReport): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Word review comparison</title><style>
  :root{font-family:system-ui,sans-serif;color:#17211d;background:#f6f6f0}body{max-width:1200px;margin:0 auto;padding:2rem}
  h1,h2,h3{margin:.2rem 0 1rem}.meta,.word{background:white;border:1px solid #d5ddd5;border-radius:12px;padding:1.2rem;margin:1rem 0}
  .columns{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.columns>div{min-width:0}.cue{background:#f6f8f5;border-radius:8px;padding:.9rem;margin:.6rem 0}
  .cue-type{font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:#4d675b}.stimulus{white-space:pre-wrap;line-height:1.5}
  details{border-top:1px solid #d5ddd5;padding-top:.6rem}summary{cursor:pointer}code{overflow-wrap:anywhere}
  @media(max-width:700px){.columns{grid-template-columns:1fr}body{padding:.7rem}}</style></head><body>
  <h1>Review cue comparison</h1><p>Five saved bootstrap documents, reused unchanged. Answers and supplements stay behind each reveal control.</p>
  <section class="meta"><p>Mode: ${escapeHtml(report.mode)} · Source model: ${escapeHtml(report.sourceModel)} · New model: ${escapeHtml(report.currentModel)}</p>
  <p>Transport: ${escapeHtml(report.sourceTransport)} → ${escapeHtml(report.currentTransport)}</p>
  <p>Old review prompt SHA-256: <code>${escapeHtml(report.sourceReviewPromptSha256)}</code><br>
  New review prompt SHA-256: <code>${escapeHtml(report.currentReviewPromptSha256)}</code><br>
  Source report SHA-256: <code>${escapeHtml(report.sourceReportSha256)}</code></p></section>
  ${report.words.map(wordHtml).join('\n')}</body></html>`;
}
