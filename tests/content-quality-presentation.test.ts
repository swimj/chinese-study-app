import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentQualityTextBlocks } from '../src/pages/content-quality-presentation.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContentQualityBreakdowns } from '../src/pages/ContentQualityPanel.tsx';

test('quality inspection shows teaching order, rendered rehearsal and accepted forms without repeating source text', () => {
  const blocks = contentQualityTextBlocks({
    packageId: 'internal-package-id',
    beats: [{ id: 'beat', parts: [{ text: 'Teaching text', source: { kind: 'text', text: 'Teaching text' } }] }],
    rehearsals: [{ exerciseId: 'internal-exercise-id', instruction: 'Fill the gap',
      stimulus: { text: 'Rendered ____', source: { text: 'Unrendered source' } },
      acceptedAnswers: [{ wordId: 'internal-word-id', hanzi: '你好', traditional: null }],
    }],
  });
  assert.deepEqual(blocks, [
    { label: 'Teaching beat 1 · Part 1 · Text', text: 'Teaching text' },
    { label: 'Rehearsal 1 · Instruction', text: 'Fill the gap' },
    { label: 'Rehearsal 1 · Prompt · Text', text: 'Rendered ____' },
    { label: 'Rehearsal 1 · Accepted answer 1 · Answer', text: '你好' },
  ]);
});

test('quality inspection handles each cue family and supplements, preserving text safely as text', () => {
  assert.deepEqual(contentQualityTextBlocks({ cueText: '<script>example</script>', cueType: 'cloze' }), [
    { label: 'Cue', text: '<script>example</script>' },
  ]);
  assert.deepEqual(contentQualityTextBlocks({ stimulus: 'Pure cue', axisNote: 'Distinction', teachingNote: 'Note' }).map(b => b.text), ['Pure cue', 'Distinction', 'Note']);
  assert.deepEqual(contentQualityTextBlocks({ prompt_text: 'Choose', explanation: 'Because' }).map(b => b.text), ['Choose', 'Because']);
  assert.deepEqual(contentQualityTextBlocks({ english_frame: 'Frame', example_sentence: '例子', example_translation: 'Example' }).map(b => b.text), ['Frame', '例子', 'Example']);
  assert.deepEqual(contentQualityTextBlocks(null), []);
});

test('source breakdown distinguishes rating coverage from negative share and labels unknown models', () => {
  const html = renderToStaticMarkup(createElement(ContentQualityBreakdowns, { groups: [{
    kind: 'production_cue', source: 'reflection', model: null,
    totals: { exposures: 90, learnerContentPairs: 10, up: 3, down: 1, ratedLearners: 4, coverage: 0.4 },
  }] }));
  assert.match(html, /Session reflection/);
  assert.match(html, /Unknown \/ not recorded/);
  assert.match(html, /40\.0%/);
  assert.match(html, /25\.0%/);
  assert.match(html, /across every page/);
  const unrated = renderToStaticMarkup(createElement(ContentQualityBreakdowns, { groups: [{
    kind: 'supplement', source: 'production supplement', model: 'test-model',
    totals: { exposures: 2, learnerContentPairs: 1, up: 0, down: 0, ratedLearners: 0, coverage: 0 },
  }] }));
  assert.match(unrated, /0\.0%/);
  assert.match(unrated, /<td>—<\/td>/);
});
