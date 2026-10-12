import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCompletionRecovery, type CompletionRecoverySnapshot } from '../src/features/session/completion-recovery.ts';
import { createBucketSessionState, markActiveSessionUnitStarted, rateActiveSessionUnit, rateActiveContrastSelectionUnit } from '../src/lib/session-state.ts';
import { createSessionSummary } from '../src/features/session/session-summary.ts';
import { createLearnerRequestedReflectionAccumulator, createSessionReflectionEvidenceAccumulator } from '../src/features/session/session-reflection-evidence.ts';
import type { SessionCompletion } from '../src/domain/session-completion.ts';
import type { SessionStudyItem } from '../src/domain/study-actions.ts';
import type { SessionUiSnapshot } from '../src/features/session/useStudySession.ts';
import { materializeExercise } from '../src/domain/word-content/materialize.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';

const completedAt = '2026-10-12T00:00:00.000Z';
const completion: SessionCompletion = { sessionId: 's', revisionId: 'r', status: 'pending',
  completedAt, closeAt: '2026-10-12T00:00:15.000Z', serverNow: completedAt, canUndo: true,
  report: { newWords: [], graduatedWords: [] }, error: null };
function fixture(kind: 'recognition' | 'production' | 'contrast' = 'recognition'): CompletionRecoverySnapshot {
  const item: SessionStudyItem = { sessionActionId: 'review/w/recognition', actionKind: 'recognition',
    targetWordId: 'w', sampledSkillIds: ['recognition'], contentRef: null, intervalHours: 24,
    production: null, contrastSelection: null,
    word: { id: 'w', hanzi: '学', traditional: '學', pinyin: 'xué', meaning: 'learn', meanings: ['learn'],
      examples: [], personalNotes: '', status: 'review', priority: 100, createdAt: completedAt,
      learningStreak: 0, lastLearningSuccessOn: null, lastLearningCoveredOn: null } };
  if (kind === 'production') {
    item.actionKind = 'production';
    item.sampledSkillIds = ['production'];
    item.production = { taskId: 'task', cueId: null, cueType: 'minimal_context', text: 'to learn',
      acceptedAnswers: [{ wordId: 'w', hanzi: '学', traditional: '學' }],
      supplement: { supplementId: 'supplement', englishFrame: 'to learn', exampleSentence: '我学中文。', exampleTranslation: 'I learn Chinese.' } };
  } else if (kind === 'contrast') {
    item.actionKind = 'contrast_selection';
    item.sampledSkillIds = ['contextual_selection'];
    item.contrastSelection = { clusterId: 'cluster', clusterTitle: '学 / 看', clusterNote: '', scheduledWordId: 'w', promptTargetWordId: 'w',
      prompt: { id: 'prompt', clusterId: 'cluster', targetWordId: 'w', promptText: '我____中文。', explanation: 'Choose learn.' },
      choices: [{ word: item.word, nuanceNote: '' }, { word: { ...item.word, id: 'other', hanzi: '看' }, nuanceNote: '' }] };
  }
  const before = markActiveSessionUnitStarted(createBucketSessionState({ sessionId: 's',
    buckets: { review: [item], learning: [], unstudied: [] }, seed: 1 }));
  const transition = kind === 'contrast' ? rateActiveContrastSelectionUnit({ state: before, selectedWordId: 'w', rating: 'good', practiceMore: false })
    : rateActiveSessionUnit(before, 'good', kind === 'production' ? { response: '学', productionResponse: { submittedText: '学', result: 'accepted_anchor' } } : {});
  assert.equal(transition.state.phase, 'completed');
  assert.notEqual(transition.commit.type, 'none');
  const ui: SessionUiSnapshot = { deskAgainKeys: [], answerRevealed: true,
    productionHanziInput: '', productionHanziError: null, productionSubmittedResponse: null,
    productionResponseResolution: null, pureCueResponseResolution: null, productionUiPhase: 'idle',
    frozenProductionCard: null, frozenPureCueCard: null, contrastSelectedWordId: null,
    frozenContrastCard: null, completedReinforcementStreak: null };
  if (kind === 'production') {
    ui.productionResponseResolution = { submittedText: '学', result: 'accepted_anchor' };
    ui.productionSubmittedResponse = '学';
    ui.productionUiPhase = 'await-rating';
    ui.frozenProductionCard = { sessionActionId: item.sessionActionId, targetWordId: 'w', actionKind: 'production',
      sampledSkillIds: ['production'], contentRef: null, attemptedHanzi: '学', status: 'review', reviewedCount: 0,
      queuedCount: 1, promptDisplayedMeanings: ['learn'], fallbackPrompt: 'learn', answerPinyin: 'xué',
      answerText: '学', answerForms: { hanzi: '学', traditional: '學' }, allMeanings: ['learn'],
      personalNotes: '', intervalHours: 24, example: '', production: item.production };
  } else if (kind === 'contrast') {
    ui.frozenContrastCard = { item, selectedWordId: 'w', reviewedCount: 0, queuedCount: 1 };
  }
  const summary = createSessionSummary({ sessionId: 's', startedAt: completedAt, initialQueueLength: 1 });
  return { version: 1, revisionId: 'r', sessionState: transition.state,
    sessionSummary: { ...summary, completedAt, answeredCount: 1, completedReviewActions: 1 },
    pendingSessionCommit: transition.commit.type === 'none' ? null : transition.commit,
    lastUndoSnapshot: { sessionState: before, sessionSummary: summary, ui,
      reflectionEvidence: createSessionReflectionEvidenceAccumulator() }, ui,
    reflectionEvidence: createSessionReflectionEvidenceAccumulator(), learnerRequests: createLearnerRequestedReflectionAccumulator(),
    ratingRequests: createLearnerRequestedReflectionAccumulator(), pureEvidence: false };
}
function read(value: unknown, authoritative = completion) { return readCompletionRecovery(JSON.stringify(value), authoritative); }

test('generated completed bucket state and final Undo snapshot survive a JSON roundtrip', () => {
  const snapshot = fixture();
  assert.deepEqual(read(snapshot), JSON.parse(JSON.stringify(snapshot)));
});

test('real production and contrast transitions plus frozen card UI accept their actual serialized contracts', () => {
  for (const kind of ['production', 'contrast'] as const) {
    const snapshot = fixture(kind);
    assert.deepEqual(read(snapshot), JSON.parse(JSON.stringify(snapshot)), kind);
  }
});

test('generated learning state restores its authored rehearsal and optional teaching content', () => {
  const base = fixture();
  const authored = wordContentFixtures[0];
  const word = { ...((base.lastUndoSnapshot!.sessionState.scheduler.activeUnit as { type: 'study'; item: SessionStudyItem }).item.word),
    id: authored.content.word.wordId, hanzi: authored.content.word.hanzi, traditional: authored.content.word.traditional,
    pinyin: authored.content.word.pinyin, status: 'learning' as const };
  const rehearsal = { ...materializeExercise(authored.teaching.rehearsals[0], [authored.content]),
    packageId: authored.teaching.id, wordContentId: authored.content.id };
  let current = createBucketSessionState({ sessionId: 's', seed: 1, buckets: { review: [], learning: [word], unstudied: [],
    learningRehearsals: { [word.id]: rehearsal }, learningContent: { [word.id]: authored.content },
    introductions: { [word.id]: { wordId: word.id,
      contents: [{ createdAt: completedAt, content: authored.content }], packages: [{ createdAt: completedAt, teaching: authored.teaching }],
      selectedPackageId: authored.teaching.id, completed: true, generationAvailable: true, model: 'fixture' } } } });
  current.scheduler.unstudiedTeaching = { [word.id]: { content: authored.content, rehearsals: [rehearsal] } };
  for (let step = 0; step < 2; step++) {
    const before = markActiveSessionUnitStarted(current);
    const transition = rateActiveSessionUnit(before, 'good', { response: word.hanzi,
      productionResponse: { submittedText: word.hanzi, result: 'accepted_anchor' } });
    current = transition.state;
    if (current.phase === 'completed') {
      base.sessionState = current;
      base.pendingSessionCommit = transition.commit.type === 'none' ? null : transition.commit;
      base.lastUndoSnapshot!.sessionState = before;
      assert.ok(read(base));
      const corrupt = structuredClone(base);
      const active = corrupt.lastUndoSnapshot!.sessionState.scheduler.activeUnit as { type: 'study'; item: SessionStudyItem };
      assert.ok(active.item.rehearsal);
      active.item.rehearsal = { ...active.item.rehearsal, stimulus: { text: 'wrong', source: { kind: 'direct_text', text: '' } } };
      assert.equal(read(corrupt), null);
      const corruptIntroduction = structuredClone(base);
      delete (corruptIntroduction.sessionState.introductions[word.id] as Partial<typeof corruptIntroduction.sessionState.introductions[string]>).packages;
      assert.equal(read(corruptIntroduction), null);
      return;
    }
  }
  assert.fail('Learning word did not complete');
});

test('recovery rejects missing/obsolete versions, stale identities, completed Undo state and closed authoritative revisions', () => {
  const base = fixture();
  const mutations: Array<(value: CompletionRecoverySnapshot) => void> = [
    (value) => { delete (value as Partial<CompletionRecoverySnapshot>).version; },
    (value) => { value.revisionId = 'old'; },
    (value) => { value.sessionState.sessionId = 'other'; },
    (value) => { value.sessionSummary.sessionId = 'other'; },
    (value) => { value.sessionState.phase = 'active'; },
    (value) => { value.sessionSummary.completedAt = '2026-10-11T00:00:00Z'; },
    (value) => { value.lastUndoSnapshot!.sessionState.sessionId = 'other'; },
    (value) => { value.lastUndoSnapshot!.sessionSummary!.sessionId = 'other'; },
    (value) => { value.lastUndoSnapshot!.sessionState.phase = 'completed'; },
  ];
  for (const mutate of mutations) { const value = structuredClone(base); mutate(value); assert.equal(read(value), null); }
  assert.equal(read({ ...base, version: 2 }), null);
  assert.equal(read(base, { ...completion, status: 'closed', canUndo: false }), null);
});

test('corrupt UI, missing state collections, malformed summary and accumulators reject the entire snapshot without mutation', () => {
  for (const patch of [
    { ui: null }, { ui: { ...fixture().ui, deskAgainKeys: {} } },
    { ui: { ...fixture().ui, frozenProductionCard: {} } },
    { sessionState: { ...fixture().sessionState, scheduler: {} } },
    { sessionState: { ...fixture().sessionState, reviewProgress: { wrong: {} } } },
    { sessionSummary: { ...fixture().sessionSummary, activeDurationMs: -1 } },
    { reflectionEvidence: { schemaVersion: 'old', items: [] } },
    { learnerRequests: null }, { ratingRequests: { schemaVersion: 'session_reflection_evidence_supplement.v2' } },
  ]) {
    const value = { ...fixture(), ...patch };
    const original = structuredClone(value);
    assert.equal(read(value), null);
    assert.deepEqual(value, original);
  }
  assert.equal(readCompletionRecovery('{', completion), null);
  assert.equal(readCompletionRecovery('null', completion), null);
});

test('deferred commits must belong to this session and the undoable final action', () => {
  const base = fixture();
  assert.ok(base.pendingSessionCommit?.type === 'commit-review-action-session');
  for (const patch of [{ sessionId: 'other' }, { sessionActionId: 'other' }, { targetWordId: 'other' }, { events: [{}] }]) {
    assert.equal(read({ ...base, pendingSessionCommit: { ...base.pendingSessionCommit, ...patch } }), null);
  }
  assert.equal(read({ ...base, lastUndoSnapshot: null }), null);
  assert.ok(read({ ...base, lastUndoSnapshot: null, pendingSessionCommit: null }));
});

test('valid deferred reflection capture permits empty accepted-attempt IDs without modifying them', () => {
  const base = fixture();
  base.reflectionEvidence.items.push({ itemId: 'mistake', sessionActionId: 'review/w/production', targetWordId: 'w',
    cuesAsShown: [{ cueId: null, cueType: 'definition_gloss', displayOrder: 0, text: 'learn', displayedMeanings: ['learn'] }],
    rawResponse: 'wrong', responseKind: 'typed', attemptIds: [] });
  const result = read(base);
  assert.ok(result);
  assert.deepEqual(result.reflectionEvidence.items[0].attemptIds, []);
});

test('server-pending expired and failed completions remain recoverable without changing the deadline', () => {
  assert.ok(read(fixture(), { ...completion, serverNow: '2026-10-12T00:00:16.000Z', canUndo: false }));
  assert.ok(read(fixture(), { ...completion, status: 'failed', canUndo: false, error: 'Retry' }));
});
