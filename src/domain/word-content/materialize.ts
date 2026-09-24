import { matchServedCueAnswer } from '../cues';
import type { StudyProfileId } from '../../study-profile';
import type {
  ContentExercise, ContentExerciseSnapshot, ContentStimulus, ExampleRef,
  MaterializedStimulus, TeachingPackage, TeachingPackageSnapshot, TeachingPart,
  WordContentDocument, WordExample,
} from './types';
import {
  assertUniqueIds, freezeContent, parseContentExercise, parseContentStimulus,
  parseTeachingPackage, parseWordContent,
} from './validation';

function catalog(contents: readonly WordContentDocument[]): Map<string, WordContentDocument> {
  const parsed = contents.map(parseWordContent);
  // Even identical duplicate IDs are ambiguous input. No last-write-wins lookup.
  assertUniqueIds(parsed.map((content) => content.id), 'word content catalog');
  return new Map(parsed.map((content) => [content.id, content]));
}

function getContent(
  contents: ReadonlyMap<string, WordContentDocument>, id: string,
): WordContentDocument {
  const content = contents.get(id);
  if (content === undefined) throw new Error(`Missing pinned word content ${id}`);
  return content;
}

function getExample(content: WordContentDocument, exampleId: string): WordExample {
  const example = content.examples.find((item) => item.id === exampleId);
  if (example === undefined) throw new Error(`Unknown example ${content.id}/${exampleId}`);
  return example;
}

export function resolveWordExample(
  ref: ExampleRef, contents: readonly WordContentDocument[],
): WordExample {
  return getExample(getContent(catalog(contents), ref.contentId), ref.exampleId);
}

function renderStimulus(
  source: ContentStimulus, contents: ReadonlyMap<string, WordContentDocument>,
): MaterializedStimulus {
  if (source.kind === 'direct_text') return { text: source.text, source };
  const example = getExample(getContent(contents, source.example.contentId), source.example.exampleId);
  const points = Array.from(example.text);
  const pieces: string[] = [];
  let cursor = 0;
  for (const blank of source.blanks) {
    if (blank.end > points.length
      || points.slice(blank.start, blank.end).join('') !== blank.expectedText) {
      throw new Error(`Cloze span does not match example ${source.example.contentId}/${example.id}`);
    }
    pieces.push(points.slice(cursor, blank.start).join(''), '____');
    cursor = blank.end;
  }
  pieces.push(points.slice(cursor).join(''));
  const cloze = pieces.join('');
  return { text: source.frame === null ? cloze : `${source.frame}\n${cloze}`, source };
}

export function materializeStimulus(
  stimulus: ContentStimulus, contents: readonly WordContentDocument[],
): MaterializedStimulus {
  return freezeContent(renderStimulus(parseContentStimulus(stimulus), catalog(contents)));
}

function exerciseSnapshot(
  exercise: ContentExercise, contents: ReadonlyMap<string, WordContentDocument>,
  profile: StudyProfileId,
): ContentExerciseSnapshot {
  if (profile !== 'mandarin' && profile !== 'french') throw new Error('Unknown matching profile');
  if (exercise.contract.kind === 'target_rehearsal' && exercise.stimulus.kind === 'example_cloze') {
    assertRehearsalWord(exercise, getContent(contents, exercise.stimulus.example.contentId));
  }
  return {
    exerciseId: exercise.id,
    responseMode: exercise.responseMode,
    matchingProfile: profile,
    contract: exercise.contract,
    instruction: exercise.instruction,
    stimulus: renderStimulus(exercise.stimulus, contents),
    acceptedAnswers: exercise.acceptedAnswers,
  };
}

function assertRehearsalWord(exercise: ContentExercise, content: WordContentDocument): void {
  const target = exercise.acceptedAnswers[0];
  if (exercise.contract.kind !== 'target_rehearsal'
    || exercise.contract.wordId !== content.word.wordId
    || target.hanzi !== content.word.hanzi || target.traditional !== content.word.traditional) {
    throw new Error(`Rehearsal ${exercise.id} must use the pinned word identity and answer forms`);
  }
}

export function materializeExercise(
  exercise: ContentExercise, contents: readonly WordContentDocument[],
  profile: StudyProfileId = 'mandarin',
): ContentExerciseSnapshot {
  return freezeContent(exerciseSnapshot(parseContentExercise(exercise), catalog(contents), profile));
}

function partText(part: TeachingPart, content: WordContentDocument): string {
  if (part.kind === 'text') return part.text;
  if (part.kind === 'use_note') {
    const use = content.uses.find((item) => item.id === part.useId);
    const note = use?.notes[part.noteIndex];
    if (note === undefined) throw new Error(`Unknown use note ${content.id}/${part.useId}/${part.noteIndex}`);
    return note;
  }
  const example = getExample(content, part.exampleId);
  const text = part.field === 'sentence' ? example.text : example[part.field];
  if (text === null) throw new Error(`No pronunciation for example ${content.id}/${example.id}`);
  return text;
}

export function materializeTeachingPackage(
  teaching: TeachingPackage, contents: readonly WordContentDocument[],
): TeachingPackageSnapshot {
  const pkg = parseTeachingPackage(teaching);
  const documents = catalog(contents);
  const content = getContent(documents, pkg.wordContentId);
  for (const rehearsal of pkg.rehearsals) {
    assertRehearsalWord(rehearsal, content);
  }
  return freezeContent({
    packageId: pkg.id,
    wordContentId: content.id,
    wordId: content.word.wordId,
    beats: pkg.beats.map((beat) => ({
      id: beat.id,
      parts: beat.parts.map((part) => ({ text: partText(part, content), source: part })),
    })),
    rehearsals: pkg.rehearsals.map((exercise) => exerciseSnapshot(exercise, documents, 'mandarin')),
  });
}

/** Matching only. This result deliberately provides no scheduler/coverage effect. */
export function resolveContentExerciseResponse(
  snapshot: ContentExerciseSnapshot, response: string | null,
): { outcome: 'accepted' | 'rejected'; submittedWordId: string | null } {
  const accepted = matchServedCueAnswer({
    acceptedAnswers: snapshot.acceptedAnswers.map((answer) => ({ ...answer })),
  }, response, snapshot.matchingProfile);
  return accepted === null
    ? { outcome: 'rejected', submittedWordId: null }
    : { outcome: 'accepted', submittedWordId: accepted.wordId };
}
