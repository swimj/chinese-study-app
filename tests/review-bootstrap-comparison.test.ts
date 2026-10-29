import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  comparisonWordsFromSource, normalizedComparisonCues, renderComparisonHtml, sha256,
  type ComparisonReport,
} from '../scripts/lib/review-bootstrap-comparison.ts';
import { runComparison } from '../scripts/review-bootstrap-comparison.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';

function source() {
  const entries = wordContentFixtures.slice(0, 5);
  return {
    model: 'old-model', providerTransport: 'local_proxy', promptHashes: { review: 'old-sha' },
    selectedWords: entries.map(({ content }) => content.word.wordId),
    encounters: entries.map(({ content }) => ({
      wordId: content.word.wordId, hanzi: content.word.hanzi,
      response: { contents: [{ content }] },
      stages: [{ stage: 'review', elapsedMs: 1000 }],
      cues: [{ cueId: 'old', cueType: 'circumstance', text: '<script>alert(1)</script>',
        answers: [content.word.hanzi], supplement: null }],
    })),
  };
}

test('five source documents and old cue latency are carried into a comparison without mutation', () => {
  const input = source();
  const before = JSON.stringify(input);
  const parsed = comparisonWordsFromSource(input);
  assert.equal(parsed.words.length, 5);
  assert.equal(parsed.words[0]!.sourceContentId, wordContentFixtures[0]!.content.id);
  assert.equal(parsed.words[0]!.oldReviewLatencyMs, 1000);
  assert.equal(parsed.words[0]!.sourceContentSha256, sha256(JSON.stringify(parsed.words[0]!.sourceContent)));
  assert.equal(JSON.stringify(input), before);
  assert.throws(() => comparisonWordsFromSource({ ...input, selectedWords: input.selectedWords.slice(0, 4) }), /five distinct/);
});

test('new cues use worker validation and HTML keeps answers hidden and escapes old/new text', () => {
  const content = wordContentFixtures[0]!.content;
  const newCues = normalizedComparisonCues({ exercises: [{
    id: 'new', cueType: 'minimal_context',
    stimulus: { kind: 'example_cloze', exampleId: 'property', occurrenceIndexes: [0], frame: null },
    supplement: null,
  }] }, content);
  assert.match(newCues[0]!.text, /____/);
  assert.deepEqual(newCues[0]!.answers, [content.word.hanzi]);
  assert.throws(() => normalizedComparisonCues({ exercises: [{
    id: 'bad', cueType: 'circumstance',
    stimulus: { kind: 'direct_text', text: `Say ${content.word.hanzi}` }, supplement: null,
  }] }, content), /exposes its target answer/);
  const report: ComparisonReport = {
    schemaVersion: 1, sourceReport: 'source.json', sourceReportSha256: 'source-sha',
    sourceModel: 'old', currentModel: 'new', sourceTransport: 'local_proxy', currentTransport: 'not_run',
    sourceReviewPromptSha256: 'old-sha', currentReviewPromptSha256: 'new-sha', mode: 'offline',
    startedAt: '2026-10-01T00:00:00.000Z', finishedAt: null,
    words: [{ ...comparisonWordsFromSource(source()).words[0]!, current: {
      status: 'valid', elapsedMs: 900, cues: newCues,
    } }],
  };
  const html = renderComparisonHtml(report);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<details><summary>Reveal answer and supplement<\/summary>/);
  assert.match(html, /Old review · 1\.0 s/);
  assert.match(html, /New review · 0\.9 s/);
});

test('offline runner writes and rerenders an isolated comparison without model configuration', async () => {
  const root = mkdtempSync(join(tmpdir(), 'review-comparison-test-'));
  try {
    const sourcePath = join(root, 'source', 'report.json');
    const outputDir = join(root, 'output');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(root, 'source'));
    writeFileSync(sourcePath, JSON.stringify(source()));
    const first = await runComparison([`--source-report=${sourcePath}`, `--output-dir=${outputDir}`]);
    assert.equal(first.mode, 'offline');
    assert.ok(first.words.every((word) => word.current.status === 'not_run'));
    assert.match(readFileSync(join(outputDir, 'comparison.html'), 'utf8'), /Review cue comparison/);
    const second = await runComparison([`--source-report=${sourcePath}`, `--output-dir=${outputDir}`]);
    assert.deepEqual(second, first);
    await assert.rejects(runComparison([`--source-report=${sourcePath}`, `--output-dir=${join(root, 'source')}`]), /isolated/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
