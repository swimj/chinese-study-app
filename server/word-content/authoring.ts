import type { ContentStimulus, TeachingPackage, WordContentDocument } from '../../src/domain/word-content/types.ts';
import { materializeTeachingPackage } from '../../src/domain/word-content/materialize.ts';
import { parseTeachingPackage, parseWordContent } from '../../src/domain/word-content/validation.ts';

type RecordValue = Record<string, unknown>;

function record(value: unknown, name: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as RecordValue;
}

function exactKeys(value: RecordValue, keys: readonly string[], name: string): void {
  const actual = Object.keys(value);
  if (actual.some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${name} has unsupported or missing fields.`);
  }
}

export function normalizeWordContent(value: unknown, word: WordContentDocument['word'], id: string): WordContentDocument {
  const wire = record(value, 'Bootstrap result');
  exactKeys(wire, ['uses', 'examples'], 'Bootstrap result');
  return parseWordContent({
    schemaVersion: 1,
    id,
    word,
    uses: wire.uses,
    examples: wire.examples,
  });
}

function occurrenceSpans(text: string, target: string): Array<{ start: number; end: number; expectedText: string }> {
  const points = Array.from(text);
  const targetPoints = Array.from(target);
  const found: Array<{ start: number; end: number; expectedText: string }> = [];
  for (let index = 0; index <= points.length - targetPoints.length; index += 1) {
    if (targetPoints.every((point, offset) => points[index + offset] === point)) {
      found.push({ start: index, end: index + targetPoints.length, expectedText: target });
    }
  }
  return found;
}

function normalizeStimulus(value: unknown, content: WordContentDocument): ContentStimulus {
  const stimulus = record(value, 'Rehearsal stimulus');
  if (stimulus.kind === 'direct_text') {
    exactKeys(stimulus, ['kind', 'text'], 'Direct stimulus');
    return { kind: 'direct_text', text: stimulus.text as string };
  }
  if (stimulus.kind !== 'example_cloze') throw new Error('Unsupported rehearsal stimulus.');
  exactKeys(stimulus, ['kind', 'exampleId', 'occurrenceIndexes', 'frame'], 'Cloze stimulus');
  if (typeof stimulus.exampleId !== 'string' || !Array.isArray(stimulus.occurrenceIndexes)
    || stimulus.occurrenceIndexes.length === 0 || stimulus.occurrenceIndexes.length > 4) {
    throw new Error('Cloze needs an example and one to four occurrence indexes.');
  }
  const example = content.examples.find((candidate) => candidate.id === stimulus.exampleId);
  if (example === undefined) throw new Error('Cloze names an unknown source example.');
  const occurrences = occurrenceSpans(example.text, content.word.hanzi);
  let previous = -1;
  const blanks = stimulus.occurrenceIndexes.map((value: unknown) => {
    if (!Number.isSafeInteger(value) || (value as number) <= previous || (value as number) >= occurrences.length) {
      throw new Error('Cloze occurrence indexes must be ordered, unique, and in range.');
    }
    previous = value as number;
    return occurrences[value as number]!;
  });
  return {
    kind: 'example_cloze',
    example: { contentId: content.id, exampleId: example.id },
    blanks,
    frame: stimulus.frame as string | null,
  };
}

export function normalizeTeachingPackage(value: unknown, content: WordContentDocument, id: string): TeachingPackage {
  const wire = record(value, 'Teaching result');
  exactKeys(wire, ['beats', 'rehearsals'], 'Teaching result');
  if (!Array.isArray(wire.rehearsals)) throw new Error('Teaching rehearsals must be an array.');
  const rehearsals = wire.rehearsals.map((raw, index) => {
    const item = record(raw, `Rehearsal ${index}`);
    exactKeys(item, ['id', 'stimulus'], `Rehearsal ${index}`);
    return {
      id: item.id,
      responseMode: 'hanzi_entry',
      contract: { kind: 'target_rehearsal', wordId: content.word.wordId },
      instruction: 'Recall the expression you just met. Enter only that expression in Chinese characters, not the whole sentence.',
      stimulus: normalizeStimulus(item.stimulus, content),
      acceptedAnswers: [{
        wordId: content.word.wordId,
        hanzi: content.word.hanzi,
        traditional: content.word.traditional,
      }],
    };
  });
  const teaching = parseTeachingPackage({
    schemaVersion: 1,
    id,
    wordContentId: content.id,
    beats: wire.beats,
    rehearsals,
  });
  const snapshot = materializeTeachingPackage(teaching, [content]);
  const forms = [content.word.hanzi, content.word.traditional]
    .filter((form): form is string => form !== null);
  if (snapshot.rehearsals.some((exercise) => forms.some((form) => (
    exercise.instruction.includes(form) || exercise.stimulus.text.includes(form)
  )))) throw new Error('Generated rehearsal exposes its target answer.');
  return teaching;
}

