import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { materializeTeachingPackage } from '../src/domain/word-content/materialize.js';
import {
  adaptLegacyProductionSnapshot,
  adaptTargetedReviewExercise,
  toProductionExerciseSnapshot,
} from '../src/domain/word-content/review-compat.js';
import {
  parseContentExercise,
  parseTeachingPackage,
  parseWordContent,
} from '../src/domain/word-content/validation.js';
import {
  authoredDefinitionFixture,
  authoredDefinitionMetadata,
  authoredReviewFixture,
  authoredReviewMetadata,
  legacyReviewFixture,
  wordContentFixtures,
} from '../tests/fixtures/word-content.js';

/** The report is intentionally local and pure: no database, provider, or learner state. */
export function buildWordContentReport() {
  const fixtures = wordContentFixtures.map(({ content, teaching }) => ({
    content: parseWordContent(content),
    teaching: parseTeachingPackage(teaching),
  }));
  const contents = fixtures.map(({ content }) => content);
  const introductions = fixtures.map(({ content, teaching }) => ({
    word: content.word,
    contentId: content.id,
    uses: content.uses,
    examples: content.examples,
    package: materializeTeachingPackage(teaching, contents),
  }));

  const legacy = adaptLegacyProductionSnapshot(legacyReviewFixture, legacyReviewFixture.acceptedAnswers[0]!.wordId);
  const authored = adaptTargetedReviewExercise(
    parseContentExercise(authoredReviewFixture),
    contents,
    authoredReviewMetadata,
  );
  const authoredDefinition = adaptTargetedReviewExercise(
    parseContentExercise(authoredDefinitionFixture),
    contents,
    authoredDefinitionMetadata,
  );
  return {
    introductions,
    reviewCoexistence: {
      legacy,
      legacyRoundTrip: toProductionExerciseSnapshot(legacy),
      authored,
      authoredForExistingReview: toProductionExerciseSnapshot(authored),
      authoredDefinition,
      authoredDefinitionForExistingReview: toProductionExerciseSnapshot(authoredDefinition),
    },
  };
}

type WordContentReport = ReturnType<typeof buildWordContentReport>;

function sourceLabel(source: WordContentReport['introductions'][number]['package']['beats'][number]['parts'][number]['source']): string {
  if (source.kind === 'text') return 'authored';
  if (source.kind === 'example') return `example:${source.exampleId}.${source.field}`;
  return `use:${source.useId}.notes[${source.noteIndex}]`;
}

export function renderWordContentReport(report: WordContentReport): string {
  const lines: string[] = [];
  for (const entry of report.introductions) {
    lines.push(`${entry.word.hanzi} (${entry.word.pinyin}) — ${entry.contentId} / ${entry.package.packageId}`);
    for (const use of entry.uses) {
      lines.push(`  use ${use.id}: ${use.label} [${use.exampleIds.join(', ')}]`);
    }
    for (const beat of entry.package.beats) {
      lines.push(`  ${beat.id}`);
      for (const part of beat.parts) {
        lines.push(`    [${sourceLabel(part.source)}] ${part.text}`);
      }
    }
    for (const exercise of entry.package.rehearsals) {
      const answerForms = exercise.acceptedAnswers.map((answer) => (
        answer.traditional && answer.traditional !== answer.hanzi
          ? `${answer.hanzi}/${answer.traditional}`
          : answer.hanzi
      ));
      lines.push(`  rehearsal ${exercise.exerciseId} (${exercise.contract.kind}, ${exercise.responseMode})`);
      lines.push(`    instruction: ${exercise.instruction}`);
      lines.push(`    stimulus: ${exercise.stimulus.text}`);
      lines.push(`    source: ${JSON.stringify(exercise.stimulus.source)}`);
      lines.push(`    accepted: ${answerForms.join(', ')}`);
    }
    lines.push('');
  }
  const { legacy, authored, authoredDefinition } = report.reviewCoexistence;
  lines.push('Review coexistence');
  lines.push(`  legacy ${legacy.review.taskId}/${legacy.review.cueId}: ${legacy.exercise.stimulus.text}`);
  lines.push(`    supplement ${legacy.review.supplement?.supplementId ?? 'none'}: ${legacy.review.supplement?.exampleSentence ?? ''}`);
  lines.push(`  authored ${authored.review.taskId}/${authored.review.cueId}: ${authored.exercise.stimulus.text}`);
  lines.push(`    source: ${JSON.stringify(authored.exercise.stimulus.source)}`);
  lines.push(`    cue type: ${authored.review.cueType}; supplement: none`);
  lines.push(`  authored definition ${authoredDefinition.review.taskId}/${authoredDefinition.review.cueId}: ${authoredDefinition.exercise.stimulus.text}`);
  lines.push(`    supplement ${authoredDefinition.review.supplement?.supplementId ?? 'none'}: ${authoredDefinition.review.supplement?.exampleSentence ?? ''}`);
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const mode = process.argv[2];
  if (mode !== undefined && mode !== '--json') {
    console.error('Usage: node --import tsx scripts/inspect-word-content.ts [--json]');
    process.exitCode = 2;
  } else {
    try {
      const report = buildWordContentReport();
      console.log(mode === '--json' ? JSON.stringify(report, null, 2) : renderWordContentReport(report));
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  }
}
