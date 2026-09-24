import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { matchServedCueAnswer } from '../src/domain/cues.js';
import {
  materializeTeachingPackage,
  resolveContentExerciseResponse,
} from '../src/domain/word-content/materialize.js';
import {
  parseContentExercise,
  parseTeachingPackage,
  parseWordContent,
} from '../src/domain/word-content/validation.js';
import { buildWordContentReport, renderWordContentReport } from '../scripts/inspect-word-content.js';
import {
  authoredReviewFixture,
  wordContentFixtures,
} from './fixtures/word-content.js';

describe('six worked word introductions', () => {
  test('validate after JSON round trip and render every pinned introduction', () => {
    assert.equal(wordContentFixtures.length, 6);
    const contents = wordContentFixtures.map(({ content }) => (
      parseWordContent(JSON.parse(JSON.stringify(content)))
    ));
    const words = wordContentFixtures.map(({ teaching }, index) => {
      const parsed = parseTeachingPackage(JSON.parse(JSON.stringify(teaching)));
      const snapshot = materializeTeachingPackage(parsed, contents);
      assert.equal(snapshot.wordContentId, contents[index].id);
      assert.equal(snapshot.wordId, contents[index].word.wordId);
      assert.ok(snapshot.beats.length >= 5);
      assert.ok(snapshot.beats.every((beat) => beat.parts.length > 0));
      assert.ok(snapshot.beats.flatMap((beat) => beat.parts).some((part) => part.source.kind === 'example'));
      assert.ok(snapshot.rehearsals.length > 0);
      for (const rehearsal of snapshot.rehearsals) {
        assert.equal(rehearsal.contract.kind, 'target_rehearsal');
        assert.deepEqual(rehearsal.acceptedAnswers.map((answer) => answer.wordId), [snapshot.wordId]);
        assert.equal(resolveContentExerciseResponse(rehearsal, contents[index].word.hanzi).outcome, 'accepted');
        assert.equal(resolveContentExerciseResponse(rehearsal, '完全不同的回答').outcome, 'rejected');
      }
      return contents[index].word.hanzi;
    });
    assert.deepEqual(words, ['报备', '藤椒', '泡沫', '不堪', '石沉大海', '为所欲为']);
  });

  test('private thinking remains a navigation beat without submitted answer or mastery claim', () => {
    const report = buildWordContentReport();
    const privateQuestions = report.introductions.flatMap((entry) => entry.package.beats)
      .filter((beat) => beat.parts.some((part) => part.text.includes('?')));
    assert.ok(privateQuestions.length >= 4);
    for (const beat of privateQuestions) {
      assert.deepEqual(Object.keys(beat).sort(), ['id', 'parts']);
    }
    const prose = renderWordContentReport(report);
    assert.match(prose, /Review coexistence/);
    assert.match(prose, /example:property\.sentence/);
    assert.match(prose, /use:relationship\.notes\[0\]/);
  });

  test('structured cloze blanks the selected occurrence while source text stays intact', () => {
    const report = buildWordContentReport();
    const byWord = new Map(report.introductions.map((entry) => [entry.word.hanzi, entry]));
    const baobei = byWord.get('报备')!;
    const exercise = baobei.package.rehearsals[0]!;
    assert.equal(exercise.stimulus.text, '你得先向物业____朋友的车牌号。');
    assert.equal(baobei.examples[0]!.text, '你得先向物业报备朋友的车牌号。');
    assert.deepEqual(exercise.stimulus.source, wordContentFixtures[0].teaching.rehearsals[0].stimulus);

    const weisuoyuwei = byWord.get('为所欲为')!;
    assert.equal(weisuoyuwei.package.rehearsals[0]!.stimulus.text, '他以为自己是老板，就可以____。');
    assert.equal(resolveContentExerciseResponse(weisuoyuwei.package.rehearsals[0]!, '為所欲為').outcome, 'accepted');
  });

  test('direct text is also an explicit target rehearsal, without cloze derivation', () => {
    const tengjiao = buildWordContentReport().introductions.find((entry) => entry.word.hanzi === '藤椒')!;
    const rehearsal = tengjiao.package.rehearsals[0]!;
    assert.equal(rehearsal.stimulus.source.kind, 'direct_text');
    assert.ok(!rehearsal.stimulus.text.includes('藤椒'));
    assert.equal(resolveContentExerciseResponse(rehearsal, '藤椒').outcome, 'accepted');
  });

  test('legacy and authored review remain separately identified from rehearsal', () => {
    const { introductions, reviewCoexistence } = buildWordContentReport();
    const baobeiRehearsal = introductions[0]!.package.rehearsals[0]!;
    assert.equal(reviewCoexistence.legacy.origin, 'legacy');
    assert.equal(reviewCoexistence.authored.origin, 'content');
    assert.equal(reviewCoexistence.authored.exercise.contract.kind, 'targeted_review');
    assert.equal(reviewCoexistence.authored.review.cueType, 'minimal_context');
    assert.equal(reviewCoexistence.authored.review.supplement, null);
    assert.notEqual(reviewCoexistence.authored.exercise.exerciseId, baobeiRehearsal.exerciseId);
    assert.deepEqual(reviewCoexistence.legacyRoundTrip.supplement, reviewCoexistence.legacy.review.supplement);
    assert.equal(reviewCoexistence.authoredDefinition.review.cueType, 'definition_gloss');
    assert.equal(reviewCoexistence.authoredDefinition.review.supplement?.exampleSentence, wordContentFixtures[0]!.content.examples[1]!.text);
    assert.equal(reviewCoexistence.authoredDefinitionForExistingReview.supplement?.exampleSentence, wordContentFixtures[0]!.content.examples[1]!.text);
    assert.equal(reviewCoexistence.authoredForExistingReview.cueId, 'review-cue-baobei');
    assert.equal(matchServedCueAnswer(reviewCoexistence.authoredForExistingReview, '報備')?.wordId, 'word-baobei');
  });

  test('broken content pin, reference, and code-point cloze span fail before report', () => {
    const { content, teaching } = wordContentFixtures[0]!;
    const validContent = parseWordContent(content);
    const wrongPin = { ...teaching, wordContentId: 'content-not-found' };
    assert.throws(() => materializeTeachingPackage(wrongPin, [validContent]), /example must belong to the pinned word content/);

    const directPackage = wordContentFixtures[1]!.teaching;
    assert.throws(
      () => materializeTeachingPackage({ ...directPackage, wordContentId: 'content-not-found' }, [validContent]),
      /Missing pinned word content/,
    );

    const wrongReference = {
      ...teaching,
      beats: teaching.beats.map((beat, index) => index === 1
        ? { ...beat, parts: [{ kind: 'example' as const, exampleId: 'missing', field: 'sentence' as const }] }
        : beat),
    };
    assert.throws(() => materializeTeachingPackage(wrongReference, [validContent]), /Unknown example/);

    const firstRehearsal = teaching.rehearsals[0]!;
    if (firstRehearsal.stimulus.kind !== 'example_cloze') throw new Error('Fixture must be cloze');
    const wrongSpan = {
      ...firstRehearsal,
      stimulus: {
        ...firstRehearsal.stimulus,
        blanks: [{ ...firstRehearsal.stimulus.blanks[0]!, start: 7 }],
      },
    };
    assert.throws(() => materializeTeachingPackage({ ...teaching, rehearsals: [wrongSpan] }, [validContent]), /Cloze span does not match/);

    const changedAnswer = {
      ...firstRehearsal,
      contract: { kind: 'targeted_review' as const, wordId: content.word.wordId },
    };
    assert.throws(() => materializeTeachingPackage({ ...teaching, rehearsals: [changedAnswer] }, [validContent]), /target_rehearsal|pinned word identity/);
    assert.equal(parseContentExercise(authoredReviewFixture).contract.kind, 'targeted_review');
  });
});
