import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentQualityTextBlocks } from '../src/pages/content-quality-presentation.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContentQualityPanel } from '../src/pages/ContentQualityPanel.tsx';

test('historical quality view does not mount the retired editor', () => {
  const html = renderToStaticMarkup(createElement(ContentQualityPanel));
  assert.match(html,/historical content ratings/);
  assert.doesNotMatch(html,/href="#operator-vocabulary"/);
  assert.doesNotMatch(html,/id="content-improvement-workspace"|Open content by source ID|Apply approved revision/);
});

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

test('definition fallback inspection shows the exact prompt without exposing internal source IDs', () => {
  assert.deepEqual(contentQualityTextBlocks({wordId: 'word', promptText: 'to understand; to be clear', displayedMeanings: []}), [{label: 'Prompt', text: 'to understand; to be clear'}]);
});
