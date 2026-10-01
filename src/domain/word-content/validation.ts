import type { AcceptedCueAnswer } from '../cues';
import type {
  ClozeBlank, ContentExercise, ContentStimulus, ExampleRef, ExerciseContract,
  TeachingPackage, TeachingPart, WordContentDocument,
} from './types';

type RecordValue = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function object(value: unknown, path: string, keys: readonly string[]): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, 'expected object');
  }
  const record = value as RecordValue;
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) fail(`${path}.${key}`, 'required property');
  }
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) fail(`${path}.${key}`, 'unknown property');
  }
  return record;
}

function kind(value: unknown, path: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, 'expected object');
  }
  return (value as RecordValue).kind;
}

function string(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    return fail(path, allowEmpty ? 'expected string' : 'expected nonempty string');
  }
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : string(value, path);
}

function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return fail(path, 'expected nonnegative safe integer');
  }
  return value;
}

function array<T>(
  value: unknown, path: string, parse: (entry: unknown, path: string) => T, min = 0,
): T[] {
  if (!Array.isArray(value) || value.length < min) {
    return fail(path, `expected array with at least ${min} entries`);
  }
  return value.map((entry, index) => parse(entry, `${path}[${index}]`));
}

function literal<T extends string | number>(value: unknown, expected: T, path: string): T {
  if (value !== expected) fail(path, `expected ${expected}`);
  return expected;
}

export function assertUniqueIds(ids: readonly string[], path: string): void {
  if (new Set(ids).size !== ids.length) fail(path, 'duplicate identity');
}

/** Parsed documents and materializations own their data; never freeze caller objects. */
export function freezeContent<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeContent(child);
    Object.freeze(value);
  }
  return value;
}

export function parseWordContent(value: unknown): WordContentDocument {
  const root = object(value, '$', ['schemaVersion', 'id', 'word', 'uses', 'examples']);
  const word = object(root.word, '$.word', ['wordId', 'hanzi', 'traditional', 'pinyin']);
  const result: WordContentDocument = {
    schemaVersion: literal(root.schemaVersion, 1, '$.schemaVersion'),
    id: string(root.id, '$.id'),
    word: {
      wordId: string(word.wordId, '$.word.wordId'),
      hanzi: string(word.hanzi, '$.word.hanzi'),
      traditional: nullableString(word.traditional, '$.word.traditional'),
      pinyin: string(word.pinyin, '$.word.pinyin'),
    },
    uses: array(root.uses, '$.uses', (value, path) => {
      const use = object(value, path, ['id', 'label', 'notes', 'exampleIds']);
      return {
        id: string(use.id, `${path}.id`), label: string(use.label, `${path}.label`),
        notes: array(use.notes, `${path}.notes`, string),
        exampleIds: array(use.exampleIds, `${path}.exampleIds`, string, 1),
      };
    }, 1),
    examples: array(root.examples, '$.examples', (value, path) => {
      const example = object(value, path, ['id', 'text', 'translation', 'pronunciation']);
      return {
        id: string(example.id, `${path}.id`), text: string(example.text, `${path}.text`),
        translation: string(example.translation, `${path}.translation`),
        pronunciation: nullableString(example.pronunciation, `${path}.pronunciation`),
      };
    }, 1),
  };
  assertUniqueIds(result.uses.map((use) => use.id), '$.uses');
  assertUniqueIds(result.examples.map((example) => example.id), '$.examples');
  const examples = new Set(result.examples.map((example) => example.id));
  for (const use of result.uses) {
    assertUniqueIds(use.exampleIds, `$.uses.${use.id}.exampleIds`);
    for (const id of use.exampleIds) {
      if (!examples.has(id)) fail(`$.uses.${use.id}`, `unknown example ${id}`);
    }
  }
  return freezeContent(result);
}

function parseExampleRef(value: unknown, path: string): ExampleRef {
  const ref = object(value, path, ['contentId', 'exampleId']);
  return {
    contentId: string(ref.contentId, `${path}.contentId`),
    exampleId: string(ref.exampleId, `${path}.exampleId`),
  };
}

function parseBlank(value: unknown, path: string): ClozeBlank {
  const blank = object(value, path, ['start', 'end', 'expectedText']);
  const start = integer(blank.start, `${path}.start`);
  const end = integer(blank.end, `${path}.end`);
  if (end <= start) fail(path, 'blank end must follow start');
  return { start, end, expectedText: string(blank.expectedText, `${path}.expectedText`) };
}

function stimulus(value: unknown, path: string): ContentStimulus {
  if (kind(value, path) === 'direct_text') {
    const direct = object(value, path, ['kind', 'text']);
    return { kind: 'direct_text', text: string(direct.text, `${path}.text`) };
  }
  if (kind(value, path) === 'example_cloze') {
    const cloze = object(value, path, ['kind', 'example', 'blanks', 'frame']);
    const blanks = array(cloze.blanks, `${path}.blanks`, parseBlank, 1);
    for (let index = 1; index < blanks.length; index += 1) {
      if (blanks[index].start < blanks[index - 1].end) {
        fail(`${path}.blanks`, 'must be ordered and non-overlapping');
      }
    }
    return {
      kind: 'example_cloze', example: parseExampleRef(cloze.example, `${path}.example`),
      blanks, frame: nullableString(cloze.frame, `${path}.frame`),
    };
  }
  return fail(`${path}.kind`, 'unknown stimulus kind');
}

export function parseContentStimulus(value: unknown): ContentStimulus {
  return freezeContent(stimulus(value, '$'));
}

function contract(value: unknown, path: string): ExerciseContract {
  const type = kind(value, path);
  if (type === 'target_rehearsal' || type === 'targeted_review') {
    const target = object(value, path, ['kind', 'wordId']);
    return { kind: type, wordId: string(target.wordId, `${path}.wordId`) };
  }
  if (type === 'pure_review') {
    const pure = object(value, path, ['kind', 'axisNote']);
    return { kind: type, axisNote: string(pure.axisNote, `${path}.axisNote`) };
  }
  return fail(`${path}.kind`, 'unknown exercise contract');
}

function answer(value: unknown, path: string): AcceptedCueAnswer {
  const item = object(value, path, ['wordId', 'hanzi', 'traditional']);
  return {
    wordId: string(item.wordId, `${path}.wordId`),
    hanzi: string(item.hanzi, `${path}.hanzi`),
    traditional: nullableString(item.traditional, `${path}.traditional`),
  };
}

function exercise(value: unknown, path: string): ContentExercise {
  const item = object(value, path, [
    'id', 'responseMode', 'contract', 'instruction', 'stimulus', 'acceptedAnswers',
  ]);
  const intent = contract(item.contract, `${path}.contract`);
  const result: ContentExercise = {
    id: string(item.id, `${path}.id`),
    responseMode: literal(item.responseMode, 'hanzi_entry', `${path}.responseMode`),
    contract: intent,
    instruction: string(item.instruction, `${path}.instruction`, intent.kind !== 'target_rehearsal'),
    stimulus: stimulus(item.stimulus, `${path}.stimulus`),
    acceptedAnswers: array(item.acceptedAnswers, `${path}.acceptedAnswers`, answer, 1),
  };
  assertUniqueIds(result.acceptedAnswers.map((entry) => entry.wordId), `${path}.acceptedAnswers`);
  if (intent.kind !== 'pure_review'
    && (result.acceptedAnswers.length !== 1 || result.acceptedAnswers[0].wordId !== intent.wordId)) {
    fail(`${path}.acceptedAnswers`, 'target contract must accept exactly its owner');
  }
  if (result.stimulus.kind === 'example_cloze') {
    const forms = new Set(result.acceptedAnswers.flatMap((entry) => [entry.hanzi, entry.traditional]));
    for (const blank of result.stimulus.blanks) {
      if (!forms.has(blank.expectedText)) {
        fail(`${path}.stimulus.blanks`, 'hidden text must be a frozen accepted answer form');
      }
    }
    const blanks = result.stimulus.blanks;
    if (!result.acceptedAnswers.some((entry) => blanks.every((blank) => (
      blank.expectedText === entry.hanzi || blank.expectedText === entry.traditional
    )))) {
      fail(`${path}.stimulus.blanks`, 'one response must fill every blank with the same word');
    }
  }
  return result;
}

export function parseContentExercise(value: unknown): ContentExercise {
  return freezeContent(exercise(value, '$'));
}

function part(value: unknown, path: string): TeachingPart {
  switch (kind(value, path)) {
    case 'text': {
      const item = object(value, path, ['kind', 'text']);
      return { kind: 'text', text: string(item.text, `${path}.text`) };
    }
    case 'example': {
      const item = object(value, path, ['kind', 'exampleId', 'field']);
      const field = item.field;
      if (field !== 'sentence' && field !== 'translation' && field !== 'pronunciation') {
        return fail(`${path}.field`, 'unknown example field');
      }
      return { kind: 'example', exampleId: string(item.exampleId, `${path}.exampleId`), field };
    }
    case 'use_note': {
      const item = object(value, path, ['kind', 'useId', 'noteIndex']);
      return {
        kind: 'use_note', useId: string(item.useId, `${path}.useId`),
        noteIndex: integer(item.noteIndex, `${path}.noteIndex`),
      };
    }
    default: return fail(`${path}.kind`, 'unknown teaching part');
  }
}

export function parseTeachingPackage(value: unknown): TeachingPackage {
  const root = object(value, '$', ['schemaVersion', 'id', 'wordContentId', 'beats', 'rehearsals']);
  const result: TeachingPackage = {
    schemaVersion: literal(root.schemaVersion, 1, '$.schemaVersion'),
    id: string(root.id, '$.id'),
    wordContentId: string(root.wordContentId, '$.wordContentId'),
    beats: array(root.beats, '$.beats', (value, path) => {
      const beat = object(value, path, ['id', 'parts']);
      return { id: string(beat.id, `${path}.id`), parts: array(beat.parts, `${path}.parts`, part, 1) };
    }, 1),
    rehearsals: array(root.rehearsals, '$.rehearsals', exercise, 1),
  };
  assertUniqueIds(result.beats.map((beat) => beat.id), '$.beats');
  assertUniqueIds(result.rehearsals.map((item) => item.id), '$.rehearsals');
  for (const rehearsal of result.rehearsals) {
    if (rehearsal.contract.kind !== 'target_rehearsal') {
      fail('$.rehearsals', 'teaching packages contain only target_rehearsal exercises');
    }
    if (rehearsal.stimulus.kind === 'example_cloze'
      && rehearsal.stimulus.example.contentId !== result.wordContentId) {
      fail('$.rehearsals', 'example must belong to the pinned word content');
    }
  }
  return freezeContent(result);
}
