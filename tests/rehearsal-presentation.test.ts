import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getActivePrompt } from '../src/features/session/session-selectors.ts';
import type { Word } from '../src/types.ts';
import { materializeTeachingPackage } from '../src/domain/word-content/materialize.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';
import { formatRehearsalPrompt, getRehearsalInstruction } from '../src/features/rehearsal-presentation.ts';

const fixture = wordContentFixtures[0];
const exercise = materializeTeachingPackage(fixture.teaching, [fixture.content]).rehearsals[0];

test('empty rehearsal framing displays the exact base cue without leading whitespace', () => {
  const base = Object.freeze({ ...exercise, instruction: '' });
  assert.equal(formatRehearsalPrompt(base), base.stimulus.text);
  assert.equal(getRehearsalInstruction(base), '');
  assert.equal(base.instruction, '');
});

test('old snapshots suppress only the exact generic preamble without mutating content', () => {
  const instruction = 'Recall the expression you just met. Enter only that expression in Chinese characters, not the whole sentence.';
  const old = Object.freeze({ ...exercise, instruction });
  assert.equal(formatRehearsalPrompt(old), old.stimulus.text);
  assert.equal(getRehearsalInstruction(old), '');
  assert.equal(old.instruction, instruction);
  const custom = { ...old, instruction: `${instruction} Focus on the register.` };
  assert.equal(formatRehearsalPrompt(custom), `${custom.instruction}\n${custom.stimulus.text}`);
});


test('study selector uses presentation copy for both new and existing rehearsal snapshots', () => {
  const word = { id: 'word' } as Word;
  for (const instruction of ['', 'Recall the expression you just met. Enter only that expression in Chinese characters, not the whole sentence.']) {
    assert.equal(getActivePrompt({
      item: {
        sessionActionId: 'learning/word/production', actionKind: 'production',
        targetWordId: word.id, sampledSkillIds: ['production'], contentRef: null,
        intervalHours: 0, word, contrastSelection: null, production: null,
        rehearsal: { ...exercise, instruction, packageId: 'package', wordContentId: 'content' },
      },
      word, promptDisplayedMeanings: [], allMeanings: [],
    }), exercise.stimulus.text);
  }
});
