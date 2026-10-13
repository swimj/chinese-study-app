import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudyStageBadge, studyStageCardClass } from '../src/features/session/StudyStageBadge';
import { WordSourceExamples } from '../src/features/session/WordSourceExamples';
import type { SessionStudyItem } from '../src/domain/study-actions';

test('recall stages distinguish new words and Practice without relabeling review', () => {
  for (const [status, label, icon] of [['unstudied', 'New word', true], ['learning', 'Practice', true], ['review', 'Review', false]] as const) {
    const html = renderToStaticMarkup(createElement(StudyStageBadge, { status }));
    assert.ok(html.includes(label));
    assert.equal(html.includes('<svg'), icon);
    if (icon) assert.ok(html.includes('aria-hidden="true"'));
  }
  assert.equal(studyStageCardClass('review'), '');
  assert.equal(studyStageCardClass('learning'), 'is-practice-card');
  assert.equal(studyStageCardClass('unstudied'), 'is-new-word-card');
});

test('source reference pairs each use with its own translated example and honors character settings', () => {
  const content = {
    uses: [{ id: 'a', label: 'First use', exampleIds: ['one'] }, { id: 'b', label: 'Second use', exampleIds: ['two'] }],
    examples: [{ id: 'two', text: '学习中文。', translation: 'Study Chinese.' }, { id: 'one', text: '这个词。', translation: 'This word.' }],
  } as NonNullable<SessionStudyItem['wordContent']>;
  const html = renderToStaticMarkup(createElement(WordSourceExamples, { content, sentenceCharacterPresentation: 'traditional' }));
  assert.ok(html.indexOf('This word.') < html.indexOf('Study Chinese.'));
  assert.ok(html.includes('學習中文。'));
  assert.ok(html.includes('lang="zh-Hant"'));
});

test('recognition cycles one paired source use by UTC day, independent of local offset', async () => {
  const { selectRecognitionUse } = await import('../src/features/session/RecognitionSourceReveal');
  const content = {
    uses: [{ id: 'a', label: 'First use', exampleIds: ['one'] }, { id: 'b', label: 'Second use', exampleIds: ['two'] }],
    examples: [{ id: 'two', text: '学习中文。', translation: 'Study Chinese.' }, { id: 'one', text: '这个词。', translation: 'This word.' }],
  } as NonNullable<SessionStudyItem['wordContent']>;
  const first = selectRecognitionUse(content, new Date('2026-10-13T00:00:00Z'));
  assert.deepEqual(selectRecognitionUse(content, new Date('2026-10-13T23:59:59Z')), first);
  assert.deepEqual(selectRecognitionUse(content, new Date('2026-10-12T20:00:00-04:00')), first);
  const next = selectRecognitionUse(content, new Date('2026-10-14T00:00:00Z'));
  assert.notEqual(next.englishFrame, first.englishFrame);
  for (const selected of [first, next]) {
    assert.deepEqual(selected, selected.englishFrame === 'First use'
      ? { englishFrame: 'First use', exampleSentence: '这个词。', exampleTranslation: 'This word.' }
      : { englishFrame: 'Second use', exampleSentence: '学习中文。', exampleTranslation: 'Study Chinese.' });
  }
  const single = { ...content, uses: [content.uses[0]] };
  assert.deepEqual(selectRecognitionUse(single, new Date('2026-10-13Z')), selectRecognitionUse(single, new Date('2026-10-14Z')));
  assert.throws(() => selectRecognitionUse({ ...content, examples: [] }, new Date()), /no linked example/);
});
