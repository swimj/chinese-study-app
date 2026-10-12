import type { SessionCompletion } from '../../domain/session-completion';
import { validateDebriefInventory } from '../../domain/session-debrief';
import { parseSessionReflectionEvidenceSupplement, parseSessionReflectionEvidenceSupplementV2 } from '../../domain/reflection-evidence';
import { parseContentExercise, parseTeachingPackage, parseWordContent } from '../../domain/word-content/validation';
import { isStudyIntroductionOrder, isStudyIntroductionSpacing } from '../../domain/introduction-order';
import type { BucketSessionState } from '../../lib/session-state';
import type { DeferredSessionCommit } from './session-commit';
import { cloneBucketSessionState } from './session-state-copy';
import type { SessionSummary } from './session-summary';
import type { LearnerRequestedReflectionAccumulator, SessionReflectionEvidenceAccumulator } from './session-reflection-evidence';
import type { SessionUiSnapshot, SessionUndoSnapshot } from './useStudySession';

export type CompletionRecoverySnapshot = {
  version: 1;
  revisionId: string;
  sessionState: BucketSessionState;
  sessionSummary: SessionSummary;
  pendingSessionCommit: DeferredSessionCommit | null;
  lastUndoSnapshot: SessionUndoSnapshot | null;
  ui: SessionUiSnapshot;
  reflectionEvidence: SessionReflectionEvidenceAccumulator;
  learnerRequests: LearnerRequestedReflectionAccumulator;
  ratingRequests: LearnerRequestedReflectionAccumulator;
  pureEvidence: boolean;
};

/** A tab-local completion snapshot is optional input, never authoritative study state. */
export function readCompletionRecovery(raw: string, completion: SessionCompletion): CompletionRecoverySnapshot | null {
  try {
    const value: unknown = JSON.parse(raw);
    const root = record(value);
    requireCondition(root.version === 1 && root.revisionId === completion.revisionId);
    requireCondition(completion.status === 'pending' || completion.status === 'failed');
    state(root.sessionState, completion.sessionId, true);
    summary(root.sessionSummary, completion.sessionId, true);
    requireCondition(record(root.sessionSummary).completedAt === completion.completedAt);
    ui(root.ui);
    evidence(root.reflectionEvidence, false);
    evidence(root.learnerRequests, true);
    evidence(root.ratingRequests, true);
    requireCondition(typeof root.pureEvidence === 'boolean');
    if (root.lastUndoSnapshot !== null) {
      const undo = record(root.lastUndoSnapshot);
      state(undo.sessionState, completion.sessionId, false);
      requireCondition(record(undo.sessionState).phase !== 'completed');
      summary(undo.sessionSummary, completion.sessionId, false);
      ui(undo.ui);
      evidence(undo.reflectionEvidence, false);
      requireCondition(undo.introductionWordId === undefined || text(undo.introductionWordId));
    }
    commit(root.pendingSessionCommit, completion.sessionId, root.lastUndoSnapshot);
    // All consumers receive a validated JSON tree; no React setters or mutable refs run here.
    return value as CompletionRecoverySnapshot;
  } catch { return null; }
}

type JsonRecord = Record<string, unknown>;
function requireCondition(condition: unknown): asserts condition { if (!condition) throw new Error('Invalid completion recovery'); }
function record(value: unknown): JsonRecord {
  requireCondition(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as JsonRecord;
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function nullableText(value: unknown) { return value === null || typeof value === 'string'; }
function number(value: unknown) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function count(value: unknown) { return number(value) && Number.isInteger(value); }
function strings(value: unknown) { return Array.isArray(value) && value.every((entry) => typeof entry === 'string'); }
function date(value: unknown) { return text(value) && Number.isFinite(Date.parse(value)); }
function array(value: unknown): unknown[] { requireCondition(Array.isArray(value)); return value; }
function values(value: unknown) { return Object.values(record(value)); }
function skills(value: unknown) {
  requireCondition(strings(value) && (value as string[]).length > 0
    && (value as string[]).every((skill) => ['recognition', 'production', 'contextual_selection'].includes(skill)));
}

function summary(value: unknown, sessionId: string, completed: boolean) {
  const item = record(value);
  requireCondition(item.sessionId === sessionId && date(item.startedAt)
    && (completed ? date(item.completedAt) : item.completedAt === null)
    && number(item.activeDurationMs) && ['natural', 'drain'].includes(String(item.completionMode)));
  for (const field of ['initialQueueLength', 'answeredCount', 'completedReviewActions', 'completedPureCueActions',
    'lapsedPureCueActions', 'lapsedReviewActions', 'completedLearningWords', 'correctDayLearningWords', 'completedUnstudiedWords']) {
    requireCondition(count(item[field]));
  }
  requireCondition(strings(item.lapsedReviewLabels) && strings(item.lapsedReviewActionIds));
  validateDebriefInventory(item.debriefInventory);
}

function word(value: unknown) {
  const item = record(value);
  requireCondition(text(item.id) && text(item.hanzi) && nullableText(item.traditional)
    && typeof item.pinyin === 'string' && typeof item.meaning === 'string'
    && strings(item.meanings) && strings(item.examples) && typeof item.personalNotes === 'string'
    && ['unstudied', 'learning', 'review'].includes(String(item.status))
    && number(item.priority) && count(item.learningStreak) && date(item.createdAt)
    && nullableText(item.lastLearningSuccessOn) && nullableText(item.lastLearningCoveredOn));
}

function answer(value: unknown) {
  const item = record(value);
  requireCondition(text(item.wordId) && text(item.hanzi) && nullableText(item.traditional));
}
function production(value: unknown) {
  const item = record(value);
  requireCondition(text(item.taskId) && nullableText(item.cueId) && text(item.text) && text(item.cueType));
  const answers = array(item.acceptedAnswers);
  requireCondition(answers.length > 0);
  answers.forEach(answer);
  if (item.supplement !== null) {
    const supplement = record(item.supplement);
    requireCondition(text(supplement.supplementId) && typeof supplement.englishFrame === 'string'
      && typeof supplement.exampleSentence === 'string' && typeof supplement.exampleTranslation === 'string');
  }
}
function rehearsal(value: unknown) {
  const item = record(value);
  const stimulus = record(item.stimulus);
  requireCondition(text(item.packageId) && text(item.wordContentId) && text(stimulus.text)
    && ['mandarin', 'french'].includes(String(item.matchingProfile)));
  parseContentExercise({ id: item.exerciseId, responseMode: item.responseMode, contract: item.contract,
    instruction: item.instruction, stimulus: stimulus.source, acceptedAnswers: item.acceptedAnswers });
}
function introduction(value: unknown, wordId: string) {
  const item = record(value);
  requireCondition(item.wordId === wordId && nullableText(item.selectedPackageId)
    && typeof item.completed === 'boolean' && typeof item.generationAvailable === 'boolean' && typeof item.model === 'string');
  array(item.contents).forEach((entry) => { const saved = record(entry); requireCondition(date(saved.createdAt)); parseWordContent(saved.content); });
  array(item.packages).forEach((entry) => { const saved = record(entry); requireCondition(date(saved.createdAt)); parseTeachingPackage(saved.teaching); });
}
function studyItem(value: unknown) {
  const item = record(value);
  requireCondition(text(item.sessionActionId));
  if (item.itemType === 'pure_cue_production') {
    const snapshot = record(item.snapshot);
    requireCondition(['fragile', 'strong'].includes(String(item.tier)) && text(snapshot.snapshotId)
      && text(snapshot.pureCueId) && date(snapshot.servedAt) && text(snapshot.stimulus)
      && typeof snapshot.axisNote === 'string' && typeof snapshot.teachingNote === 'string');
    array(snapshot.acceptedAnswers).forEach(answer);
    requireCondition((snapshot.acceptedAnswers as unknown[]).length > 0);
    return;
  }
  requireCondition(['recognition', 'production', 'contrast_selection'].includes(String(item.actionKind))
    && text(item.targetWordId) && number(item.intervalHours));
  skills(item.sampledSkillIds);
  word(item.word);
  requireCondition(record(item.word).id === item.targetWordId);
  if (item.contentRef !== null) record(item.contentRef);
  if (item.production !== null) production(item.production);
  if (item.wordContent !== undefined) parseWordContent(item.wordContent);
  if (item.rehearsal !== undefined) rehearsal(item.rehearsal);
  if (item.contrastSelection !== null) {
    const contrast = record(item.contrastSelection);
    record(contrast.prompt);
    array(contrast.choices).forEach((choice) => { const entry = record(choice); requireCondition(typeof entry.nuanceNote === 'string'); word(entry.word); });
  }
}

function state(value: unknown, sessionId: string, completed: boolean) {
  const item = record(value);
  requireCondition(item.sessionId === sessionId && ['active', 'draining', 'completed'].includes(String(item.phase))
    && (!completed || item.phase === 'completed') && count(item.answeredCount) && strings(item.startedActionIds));
  Object.entries(record(item.introductions)).forEach(([wordId, library]) => introduction(library, wordId));
  const scheduler = record(item.scheduler);
  array(scheduler.reviewQueue).forEach(studyItem);
  array(scheduler.learningPool).forEach(word);
  array(scheduler.unstudiedPool).forEach(word);
  const policy = record(scheduler.policy);
  const weights = record(policy.bucketWeights);
  requireCondition(['review', 'learning', 'unstudied'].every((key) => number(weights[key]))
    && count(scheduler.rngState) && count(scheduler.introductionExercisesRemaining));
  requireCondition((policy.studyNewWordsFirst === undefined || typeof policy.studyNewWordsFirst === 'boolean')
    && (policy.studyIntroductionOrder === undefined || isStudyIntroductionOrder(policy.studyIntroductionOrder))
    && (policy.studyIntroductionSpacing === undefined || isStudyIntroductionSpacing(policy.studyIntroductionSpacing)));
  if (scheduler.learningContent !== undefined) values(scheduler.learningContent).forEach(parseWordContent);
  if (scheduler.learningRehearsals !== undefined) values(scheduler.learningRehearsals).forEach(rehearsal);
  if (scheduler.unstudiedTeaching !== undefined) values(scheduler.unstudiedTeaching).forEach((entry) => {
    const teaching = record(entry); parseWordContent(teaching.content); array(teaching.rehearsals).forEach(rehearsal);
  });
  if (scheduler.activeUnit !== null) {
    const active = record(scheduler.activeUnit);
    if (active.type === 'unstudied_intro') word(active.word);
    else { requireCondition(active.type === 'study' && ['review', 'learning', 'unstudied'].includes(String(active.bucket))); studyItem(active.item); }
  }
  requireCondition(!completed || scheduler.activeUnit === null);
  const progress = record(item.progress);
  for (const entry of values(progress.learning)) {
    const learning = record(entry);
    for (const name of ['coveredSkills', 'firstTryGood', 'attempts']) {
      const pair = record(learning[name]);
      requireCondition(['recognition', 'production'].every((key) => name === 'attempts' ? count(pair[key]) : typeof pair[key] === 'boolean'));
    }
  }
  for (const entry of values(progress.unstudied)) {
    const unstudied = record(entry);
    const streaks = record(unstudied.successStreaks);
    requireCondition(typeof unstudied.introComplete === 'boolean' && count(streaks.recognition) && count(streaks.production));
  }
  for (const entry of values(item.reviewProgress)) {
    const review = record(entry);
    requireCondition(count(review.failureCount) && count(review.reinforcementStreak));
    array(review.attempts).forEach((event) => attempt(event, sessionId));
  }
  for (const entry of values(item.pureCueReviewProgress)) {
    const pure = record(entry);
    requireCondition(count(pure.failureCount) && count(pure.reinforcementStreak));
    array(pure.events).forEach(pureEvent);
  }
  // Reuse the exact clone traversal that Undo runs; missing nested collections fail here.
  cloneBucketSessionState(value as BucketSessionState);
}

function attempt(value: unknown, sessionId: string) {
  const item = record(value);
  requireCondition(item.sessionId === sessionId && text(item.id) && date(item.occurredAt)
    && text(item.sessionActionId) && text(item.targetWordId) && count(item.sessionEventSequence)
    && count(item.actionAttemptSequence) && ['recognition', 'production', 'contrast_selection'].includes(String(item.actionKind))
    && ['correct', 'incorrect'].includes(String(item.outcome)) && nullableText(item.response)
    && [null, 'forgot', 'hard', 'good', 'easy'].includes(item.rating as string | null));
  skills(item.sampledSkillIds);
  record(item.metadata);
  if (item.contentRef !== null) record(item.contentRef);
}
function pureEvent(value: unknown) {
  const item = record(value);
  requireCondition(text(item.eventId) && date(item.occurredAt) && nullableText(item.response)
    && nullableText(item.submittedWordId) && ['accepted', 'rejected'].includes(String(item.outcome))
    && ['forgot', 'hard', 'good', 'easy'].includes(String(item.rating)));
}

function ui(value: unknown) {
  const item = record(value);
  requireCondition(strings(item.deskAgainKeys) && typeof item.answerRevealed === 'boolean'
    && typeof item.productionHanziInput === 'string' && nullableText(item.productionHanziError)
    && nullableText(item.productionSubmittedResponse) && nullableText(item.contrastSelectedWordId)
    && ['idle', 'await-supplement', 'await-rating', 'await-next'].includes(String(item.productionUiPhase))
    && (item.completedReinforcementStreak === null || count(item.completedReinforcementStreak)));
  if (item.productionResponseResolution !== null) {
    const resolution = record(item.productionResponseResolution);
    requireCondition(nullableText(resolution.submittedText) && ['accepted_anchor', 'rejected'].includes(String(resolution.result)));
  }
  if (item.pureCueResponseResolution !== null) {
    const resolution = record(item.pureCueResponseResolution);
    requireCondition(['accepted', 'rejected'].includes(String(resolution.outcome)) && nullableText(resolution.submittedWordId));
  }
  if (item.frozenContrastCard !== null) {
    const card = record(item.frozenContrastCard); studyItem(card.item);
    requireCondition(text(card.selectedWordId) && count(card.reviewedCount) && count(card.queuedCount));
  }
  if (item.frozenPureCueCard !== null) {
    const card = record(item.frozenPureCueCard); studyItem(card.item);
    requireCondition(nullableText(card.attemptedResponse) && count(card.reviewedCount) && count(card.queuedCount));
  }
  if (item.frozenProductionCard !== null) {
    const card = record(item.frozenProductionCard);
    for (const field of ['targetWordId', 'sessionActionId', 'fallbackPrompt', 'answerPinyin', 'answerText', 'personalNotes', 'example']) requireCondition(typeof card[field] === 'string');
    requireCondition(strings(card.sampledSkillIds) && strings(card.promptDisplayedMeanings) && strings(card.allMeanings)
      && count(card.reviewedCount) && count(card.queuedCount) && number(card.intervalHours) && nullableText(card.attemptedHanzi));
    const forms = record(card.answerForms); requireCondition(text(forms.hanzi) && nullableText(forms.traditional));
    if (card.production !== undefined && card.production !== null) production(card.production);
    if (card.wordContent !== undefined) parseWordContent(card.wordContent);
    if (card.rehearsal !== undefined) rehearsal(card.rehearsal);
  }
}

function evidence(value: unknown, requested: boolean) {
  const accumulator = record(value);
  // Live accumulators can hold a captured cue whose final attempts remain deferred.
  // Validate that shape using the domain parser with synthetic IDs only for empty lists.
  const items = array(accumulator.items).map((entry, index) => {
    const item = record(entry);
    requireCondition(strings(item.attemptIds));
    return { ...item, attemptIds: (item.attemptIds as string[]).length ? item.attemptIds : [`recovery-pending-${index}`] };
  });
  const normalized = { ...accumulator, items };
  if (requested) parseSessionReflectionEvidenceSupplementV2(normalized);
  else parseSessionReflectionEvidenceSupplement(normalized);
}

function commit(value: unknown, sessionId: string, undoValue: unknown) {
  if (value === null) return;
  const item = record(value);
  requireCondition(undoValue !== null);
  const undo = record(undoValue);
  const active = record(record(record(undo.sessionState).scheduler).activeUnit);
  if (item.type === 'commit-learning-word-session' || item.type === 'commit-unstudied-word-session') {
    requireCondition(text(item.wordId));
    const target = active.type === 'unstudied_intro' ? record(active.word).id : record(active.item).targetWordId;
    requireCondition(item.wordId === target);
    if (item.type === 'commit-learning-word-session') requireCondition(typeof item.success === 'boolean');
    return;
  }
  requireCondition(item.sessionId === sessionId && text(item.sessionActionId)
    && item.sessionActionId === record(active.item).sessionActionId);
  if (item.type === 'commit-review-action-session') {
    requireCondition(text(item.targetWordId) && item.targetWordId === record(active.item).targetWordId
      && count(item.failureCount) && ['recognition', 'production'].includes(String(item.actionKind))
      && [null, 'hard', 'good', 'easy'].includes(item.terminalRating as string | null));
    skills(item.sampledSkillIds); array(item.events).forEach((event) => attempt(event, sessionId));
  } else if (item.type === 'commit-contrast-selection-action-session') {
    requireCondition(text(item.targetWordId) && item.targetWordId === record(active.item).targetWordId
      && item.actionKind === 'contrast_selection' && text(item.selectedWordId) && text(item.promptTargetWordId)
      && strings(item.choiceWordIds) && typeof item.practiceMore === 'boolean' && ['forgot', 'hard', 'good', 'easy'].includes(String(item.rating)));
    skills(item.sampledSkillIds); attempt(item.event, sessionId);
  } else if (item.type === 'commit-pure-cue-production-session') {
    requireCondition(text(item.attemptId) && text(item.snapshotId)); array(item.events).forEach(pureEvent);
  } else requireCondition(false);
  requireCondition(item.reinforcementSkipped === undefined || typeof item.reinforcementSkipped === 'boolean');
}
