import assert from 'node:assert/strict';
import { test } from 'node:test';
import { materializeTeachingPackage } from '../src/domain/word-content/materialize.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';
import { getRehearsalInstruction } from '../src/features/rehearsal-presentation.ts';

const fixture = wordContentFixtures[0];
const exercise = materializeTeachingPackage(fixture.teaching, [fixture.content]).rehearsals[0];

test('empty rehearsal framing yields no instruction', () => {
  const base = Object.freeze({ ...exercise, instruction: '' });
  assert.equal(getRehearsalInstruction(base), '');
  assert.equal(base.instruction, '');
});

test('old snapshots suppress only the exact generic preamble without mutating content', () => {
  const instruction = 'Recall the expression you just met. Enter only that expression in Chinese characters, not the whole sentence.';
  const old = Object.freeze({ ...exercise, instruction });
  assert.equal(getRehearsalInstruction(old), '');
  assert.equal(old.instruction, instruction);
  const custom = { ...old, instruction: `${instruction} Focus on the register.` };
  assert.equal(getRehearsalInstruction(custom), custom.instruction);
});

