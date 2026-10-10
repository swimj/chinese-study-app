import * as db from '../db.ts';
import { wordContentFixtures, authoredReviewFixture, authoredDefinitionFixture } from '../../src/features/introduction-lab/samples.ts';
import { annotationWords } from './ui-annotation-data.ts';

/** Only used by the fresh-directory fixture command, never application startup. */
export function prepareUiAnnotationFixtures(now: Date) {
  if (db.dbConfig.mode !== 'dev' || db.dbConfig.authMode !== 'trusted_local' || db.dbConfig.studyProfile !== 'mandarin') {
    throw new Error('UI annotation fixtures require trusted-local Mandarin development mode');
  }
  return db.runWithLearnerId('dev-learner', () => {
    for (const wordId of annotationWords.introduction) db.updateWordUserPriority(wordId, { forceTop: true });
    for (const wordId of [...annotationWords.learning, annotationWords.review]) {
      const fixture = wordContentFixtures.find(({ content }) => content.word.wordId === wordId);
      if (!fixture) throw new Error(`Missing teaching fixture: ${wordId}`);
      db.pinWordTeachingPackage(wordId, fixture.teaching.id);
      db.completeWordTeachingPackage(wordId, fixture.teaching.id);
    }
    const review = wordContentFixtures.find(({ content }) => content.word.wordId === annotationWords.review)!;
    const timestamp = now.toISOString();
    if (db.claimWordReviewPreparation(annotationWords.review, review.content.id, 'ui-fixture-review', timestamp,
      new Date(now.getTime() + 300_000).toISOString()) !== 'claimed') throw new Error('Review fixture is already prepared');
    db.finishWordReviewPreparation(annotationWords.review, 'ui-fixture-review', [
      { exercise: authoredReviewFixture, cueType: 'minimal_context', supplement: null },
      { exercise: authoredDefinitionFixture, cueType: 'definition_gloss', supplement: null },
    ], 'authored-dev-fixture');
    seedHomeContent(now);
    const issues = db.validateStudySchedulerStateInvariants();
    if (issues.length) throw new Error(`Fixture scheduler invariants failed: ${JSON.stringify(issues)}`);
    const buckets = db.getSessionPayload(timestamp.slice(0, 10), { random: () => 0.5 }).buckets;
    for (const wordId of annotationWords.introduction) {
      if (!buckets.unstudied.some(word => word.id === wordId) || !buckets.introductions?.[wordId]) {
        throw new Error(`Introduction fixture not served: ${wordId}`);
      }
    }
    for (const wordId of annotationWords.learning) {
      if (!buckets.learning.some(word => word.id === wordId) || !buckets.learningRehearsals?.[wordId]) {
        throw new Error(`Learning fixture not served: ${wordId}`);
      }
    }
    if (!buckets.review.some(item => item.targetWordId === annotationWords.review)) {
      throw new Error('Due review fixture not served');
    }
    return { fixtureVersion: 1, preparedAt: timestamp, learnerId: 'dev-learner', words: annotationWords,
      connectionsSessionId: 'ui-annotations-sample-session', connectionCount: 5, samplePostCount: 2 };
  });
}

function seedHomeContent(now: Date) {
  const completedAt = now.toISOString();
  const inventory = db.getWords().filter(word => word.status === 'review').slice(0, 20)
    .map(word => ({ word: word.hanzi, pinyin: word.pinyin }));
  // References below are matched by word, never by incidental seed ordering.
  const noteData = [
    ['鼓舞', '鼓舞 (gǔ wǔ) describes encouragement that lifts someone’s spirits. Think of a teammate cheering you on just before a difficult climb: 你的话给了我很大的鼓舞。'],
    ['花卉', '花卉 (huā huì) is a collective term for flowering plants. You might see it on a garden-center sign, in an exhibition title, or in writing about horticulture. In everyday conversation about a particular bouquet, 花 is usually enough.'],
    ['神态', '神态 (shén tài) directs attention to the expression and bearing that reveal someone’s mood: 她的神态很平静。 Picture the same person before and after receiving reassuring news; their face and posture tell the story.'],
    ['霸凌', '霸凌 (bà líng) refers to bullying. 校园霸凌 places it in a school setting; 网络霸凌 places it online.'],
    ['百分点', '百分点 (bǎi fēn diǎn) measures the difference between percentages. A rate rising from 20% to 25% increases by 五个百分点, or five percentage points. The relative increase is 25%. Keeping the starting value in mind helps you choose the right expression when reading a report or describing a chart.\n\nTry saying the two figures aloud before describing the change: 从百分之二十上升到百分之二十五，上升了五个百分点。'],
  ];
  const notes = noteData.map(([word, text]) => {
    const index = inventory.findIndex(item => item.word === word);
    if (index < 0) throw new Error(`Connection fixture word missing: ${word}`);
    return { text, refs: [`w${index + 1}`], followUp: null };
  });
  const sessionId = 'ui-annotations-sample-session';
  db.recordReviewSessionSummary({ sessionId, completedAt, completedReviewActionCount: inventory.length,
    failedReviewActionCount: 3, activeDurationMs: 720_000, debriefInventory: inventory });
  if (!db.claimSessionDebrief(sessionId, 'ui-fixture-debrief', completedAt, new Date(now.getTime() + 300_000).toISOString())) {
    throw new Error('Could not claim sample Connections session');
  }
  if (!db.finishSessionDebrief({ sessionId, token: 'ui-fixture-debrief', completedAt, durationMs: 0,
    result: { notes }, error: null, errorCode: null, metadata: null })) throw new Error('Could not finish sample Connections session');
  for (const post of [
    { id: 'annotation-session-connections', title: 'Connections after your study session',
      summary: 'Revisit useful connections between the words you practiced. Open the latest notes on Home, move between examples, and minimize them when you are ready to study again.',
      paragraphs: ['This is sample update content for local UI annotations.',
        'After a study session, Connections offers another way to revisit the words you practiced. Read a note, move through neighboring notes, or minimize the view to return to your Home overview.',
        'The sample session includes short and longer notes, Chinese examples, and a multi-paragraph explanation so you can inspect wrapping and navigation.'] },
    { id: 'annotation-home-updates', title: 'Catch up on recent improvements from Home',
      summary: 'Open an update preview to read the full article, or collapse the updates column to give your study overview more room.',
      paragraphs: ['This is sample update content for local UI annotations.',
        'Home brings recent updates together in one place. Select a preview to open its article, then return to your study overview whenever you are ready.'] },
  ]) db.saveWhatsNewPost({ ...post, expectedRevision: null, date: completedAt.slice(0, 10), status: 'published',
    sourceFrom: null, sourceThrough: null }, 'local-ui-fixture');
}
