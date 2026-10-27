import type { BootstrapRevealSnapshot } from './word-content/reveal';
import type { WordContentDocument } from './word-content/types';

/** Shared, side-effect-free interpretation of the authoritative vocabulary session log. */
export const VOCABULARY_SESSION_PROTOCOL_VERSION = 1 as const;
export const VOCABULARY_SESSION_POLICY = {
  version: 'vocabulary-session.v5',
  interveningExercisesBeforeWordReturn: 2,
  /** Compatibility constant; word coverage is determined by the mode-specific skill policy below. */
  productionResponsesToCover: 1,
  solidifyCleanCoveredSessionsToRecommendPractice: 3,
  /** Maintain promotion is deliberately disabled in the first delivery. */
  practiceCleanCoveredSessionsToRecommendMaintain: Infinity,
} as const;

export type VocabularySolidifySkill = 'recognition' | 'production';
export type VocabularySkill = 'recognition' | 'production' | 'contextual_selection';
export type VocabularySkillProgress = { acceptedResponses: number; rejectedResponses: number; consecutiveAccepted: number };
export type VocabularyWordMode = 'unstudied' | 'solidify' | 'practice' | 'maintain';
export type VocabularyReactionKind = 'positive' | 'negative' | 'comment' | 'withdrawn';
export type VocabularySessionJson = null | boolean | number | string | VocabularySessionJson[] | { [key: string]: VocabularySessionJson };
export type VocabularyTeachingRequirements = {
  introductionContentId: string;
  requiredExerciseContentIds: readonly string[];
  minimumRecognitionResponses: number;
  minimumProductionResponses: number;
};
export type VocabularySessionWordContext = {
  wordId: string;
  mode: VocabularyWordMode;
  cleanCoveredSessions?: number;
  /** Frozen learner choice to remain in Solidify until a later explicit mode change. */
  automaticPromotionPaused?: boolean;
  /** Scheduling can admit recognition without admitting the production objective. */
  selectedSkill?: VocabularySkill;
  /** Frozen enabled recall directions; omitted legacy contexts practise both. */
  solidifySkills?: readonly VocabularySolidifySkill[];
  recognitionOnly?: boolean;
  contextualOnly?: boolean;
  teachingRequirements?: VocabularyTeachingRequirements;
};
export type VocabularySessionInitialContext = {
  sessionId: string;
  words: readonly VocabularySessionWordContext[];
  /** Frozen review order interleaves independent cues with selected word objectives. */
  reviewOrder?: readonly { kind: 'word' | 'pure_cue'; id: string }[];
  composition?: { introductionOrder: 'random' | 'first' | 'paced'; introductionSpacing: number };
};

/** Snapshots contain the served material, never a mutable content lookup. */
export type VocabularyEncounterSnapshot = {
  contentId: string;
  contentVersion: number;
  kind: 'introduction' | 'recognition' | 'production' | 'contrast';
  role: 'teaching' | 'priming' | 'general';
  body: {
    prompt: string;
    answer?: string;
    explanation?: string;
    choices?: readonly { id: string; text: string }[];
    /** Additional rendered structure, retained exactly for content kinds with richer material. */
    material?: VocabularySessionJson;
    /** Exact published source used for the introduction recap. */
    teachingSource?: VocabularySessionJson;
    /** Post-answer lexical and mapped-sense facts frozen when this encounter is served. */
    revealWords?: readonly {
      wordId: string; hanzi: string; traditional: string | null; pinyin: string; meaning: string;
      sense?: { senseId: string; version: number; description: VocabularySessionJson };
    }[];
    bootstrapReveal?: BootstrapRevealSnapshot;
    wordReference?: WordContentDocument;
  };
  assessment: {
    acceptedAnswers: readonly string[];
    criteria?: VocabularySessionJson;
  } | null;
  /** Pure cues retain an independent schedule; answer words never gain word credit. */
  schedulingScope?: 'word' | 'pure_cue';
  selectedThroughWordId?: string | null;
  senseIds?: readonly string[];
  mappingSnapshot?: VocabularySessionJson;
};

type VocabularySessionActionPayload =
  | { kind: 'presentation'; payload: { encounterId: string; wordId: string | null; snapshot: VocabularyEncounterSnapshot } }
  | { kind: 'response'; payload: { encounterId: string; response: string | null; outcome: 'accepted' | 'rejected'; selfAssessment?: 'accepted' | 'rejected'; selectedWordId?: string; helpUsed?: boolean } }
  /** Learner reaction. Protocol v1 retains its historical `feedback` wire spelling. */
  | { kind: 'feedback'; payload: { encounterId: string; feedback: VocabularyReactionKind; comment?: string } }
  | { kind: 'teaching_complete'; payload: { wordId: string } }
  | { kind: 'word_wrap'; payload: { wordId: string; reason: 'enough' | 'policy' } }
  | { kind: 'word_more'; payload: { wordId: string } }
  | { kind: 'word_skip'; payload: { wordId: string } }
  | { kind: 'exercise_skip'; payload: { encounterId: string } }
  | { kind: 'exercise_exclude'; payload: { encounterId: string } }
  | { kind: 'mode_change'; payload: { wordId: string; mode: VocabularyWordMode } }
  | { kind: 'resume'; payload: Record<string, never> }
  | { kind: 'finish_for_now'; payload: Record<string, never> }
  | { kind: 'finish_immediately'; payload: Record<string, never> }
  | { kind: 'undo'; payload: { undoesActionId: string } };
export type VocabularySessionAction = VocabularySessionActionPayload & {
  protocolVersion: typeof VOCABULARY_SESSION_PROTOCOL_VERSION;
  actionId: string;
  clientActionId: string;
  sequence: number;
  occurredAt: string;
  /** Trusted command provenance makes multi-action command retries unambiguous. */
  commandInput?: VocabularySessionJson;
  /** Server-generated companion actions belong to the same learner transition. */
  transitionId?: string;
};
export type VocabularyReactionAction = Extract<VocabularySessionAction, { kind: 'feedback' }>;
export type VocabularyEncounterEvidence = {
  encounterId: string;
  wordId: string | null;
  workNumber: number;
  presentedActionId: string;
  presentedAt: string;
  mode: VocabularyWordMode | null;
  snapshot: VocabularyEncounterSnapshot;
  /** Includes undone responses: evidence is never deleted by Undo. */
  responses: Extract<VocabularySessionAction, { kind: 'response' }>[];
  /** Only these responses contribute to finalization; responses above preserve all observations. */
  effectiveResponses: Extract<VocabularySessionAction, { kind: 'response' }>[];
  /** Persisted v1 reaction history; use the reaction accessors outside log projection. */
  feedback: VocabularyReactionAction[];
  /** Persisted v1 effective reactions. This is not app-generated learner feedback. */
  effectiveFeedback: VocabularyReactionAction[];
  skipped: boolean;
  presentationUndone: boolean;
};
export type VocabularySessionWordProjection = {
  wordId: string;
  initialMode: VocabularyWordMode;
  mode: VocabularyWordMode;
  explicitModeChoice: VocabularyWordMode | null;
  admitted: boolean;
  workNumber: number;
  workStatus: 'not_started' | 'open' | 'wrapped' | 'skipped';
  selectedSkill: VocabularySkill;
  solidifySkills: readonly VocabularySolidifySkill[];
  skillProgress: Record<VocabularySkill, VocabularySkillProgress>;
  teachingIntroductionPresented: boolean;
  /** Session-wide evidence survives a request for more work. */
  solidifyRecallCompleted: boolean;
  productionResponses: number;
  successfulProductionResponses: number;
  covered: boolean;
  successfulRecall: boolean;
  teachingCompleted: boolean;
  /** A mode reset stops current work; a fresh session must establish new teaching requirements. */
  teachingDeferred: boolean;
  hasRejectedResponse: boolean;
  recommendedMode: VocabularyWordMode | null;
};
export type VocabularySessionProjection = {
  sessionId: string;
  protocolVersion: typeof VOCABULARY_SESSION_PROTOCOL_VERSION;
  policyVersion: typeof VOCABULARY_SESSION_POLICY.version;
  throughSequence: number;
  phase: 'active' | 'finishing' | 'completed';
  finishReason: 'finish_immediately' | 'wrapped_up' | null;
  words: Record<string, VocabularySessionWordProjection>;
  encounters: VocabularyEncounterEvidence[];
  excludedContentIds: string[];
  pureCueOutcomes: { contentId: string; contentVersion: number; encounterIds: string[]; acceptedResponses: number; rejectedResponses: number; consecutiveAccepted: number; covered: boolean }[];
  coveredWordIds: string[];
  uncoveredWordIds: string[];
  undoneActionIds: string[];
  latestUndoableActionId: string | null;
};

const UNDOABLE_KINDS = new Set<VocabularySessionAction['kind']>([
  'response', 'teaching_complete', 'word_wrap', 'word_more', 'word_skip', 'exercise_skip', 'exercise_exclude', 'mode_change',
  'finish_for_now', 'finish_immediately', 'resume',
]);
function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Vocabulary session invariant violated: ${message}`);
}

export function recommendVocabularyMode(mode: VocabularyWordMode, cleanCoveredSessions: number): VocabularyWordMode | null {
  invariant(Number.isInteger(cleanCoveredSessions) && cleanCoveredSessions >= 0, 'invalid clean session count');
  if (mode === 'solidify' && cleanCoveredSessions >= VOCABULARY_SESSION_POLICY.solidifyCleanCoveredSessionsToRecommendPractice) return 'practice';
  return null;
}

/** Teaching completion and work in other modes do not count toward Solidify graduation. */
export function isCleanSolidifySession(word: VocabularySessionWordProjection): boolean {
  return word.initialMode === 'solidify' && word.mode === 'solidify' && !word.teachingCompleted
    && word.covered && word.successfulRecall && !word.hasRejectedResponse
    && word.solidifySkills.includes('recognition') && word.solidifySkills.includes('production')
    && word.solidifyRecallCompleted;
}

/** Pending objectives in the current work cycle; persisted flags supply defaults for old logs. */
export function getPendingVocabularySkills(word: VocabularySessionWordProjection): VocabularySkill[] {
  if (word.mode === 'unstudied') return (['recognition', 'production'] as const)
    .filter((skill) => word.skillProgress[skill].consecutiveAccepted < 3);
  if (word.mode === 'solidify') return word.solidifySkills
    .filter((skill) => word.skillProgress[skill].acceptedResponses < 1);
  const progress = word.skillProgress[word.selectedSkill];
  return progress.consecutiveAccepted >= (progress.rejectedResponses > 0 ? 3 : 1) ? [] : [word.selectedSkill];
}

export function isVocabularyTeachingComplete(word: VocabularySessionWordProjection): boolean {
  return word.mode === 'unstudied' && !word.teachingDeferred && word.teachingIntroductionPresented
    && getPendingVocabularySkills(word).length === 0;
}

/** Enough marks coverage separately and never supplies successful recall evidence. */
export function isVocabularyWordReadyToCover(word: VocabularySessionWordProjection): boolean {
  return word.mode === 'unstudied' ? isVocabularyTeachingComplete(word) : getPendingVocabularySkills(word).length === 0;
}

function emptySkillProgress(): Record<VocabularySkill, VocabularySkillProgress> {
  return { recognition: { acceptedResponses: 0, rejectedResponses: 0, consecutiveAccepted: 0 },
    production: { acceptedResponses: 0, rejectedResponses: 0, consecutiveAccepted: 0 },
    contextual_selection: { acceptedResponses: 0, rejectedResponses: 0, consecutiveAccepted: 0 } };
}

/** The latest effective transition alone is undoable; reactions and presentation do not erase that scope. */
export function latestVocabularyUndoableActionId(actions: readonly VocabularySessionAction[]): string | null {
  let latest: string | null = null;
  for (const action of actions) {
    if (action.kind === 'undo') {
      invariant(action.payload.undoesActionId === latest, 'Undo must reference the latest undoable transition');
      latest = null;
    } else if (UNDOABLE_KINDS.has(action.kind)) latest = action.actionId;
  }
  return latest;
}

/**
 * The caller validates ownership and immutable served snapshots. Persistence owns duplicate
 * client IDs. This reducer validates ordering and domain references; it performs no learning writes.
 * throughSequence freezes exactly an acknowledged prefix, including its Undo records.
 */
export function projectVocabularySession(
  context: VocabularySessionInitialContext,
  actions: readonly VocabularySessionAction[],
  options: { throughSequence?: number } = {},
): VocabularySessionProjection {
  invariant(context.sessionId.trim(), 'missing session ID');
  const throughSequence = options.throughSequence ?? actions.length;
  invariant(Number.isInteger(throughSequence) && throughSequence >= 0, 'invalid frozen sequence');
  const prefix = actions.filter((action) => action.sequence <= throughSequence);
  invariant(prefix.length === throughSequence, 'frozen sequence is not an acknowledged contiguous boundary');
  const ids = new Set<string>();
  const clients = new Set<string>();
  const undone = new Set<string>();
  let latestUndoable: string | null = null;
  for (const [index, action] of prefix.entries()) {
    invariant(action.protocolVersion === VOCABULARY_SESSION_PROTOCOL_VERSION, 'unsupported protocol version');
    invariant(action.sequence === index + 1, 'actions must be ordered and contiguous');
    invariant(action.actionId.trim() && !ids.has(action.actionId), 'duplicate or empty action ID');
    invariant(action.clientActionId.trim() && !clients.has(action.clientActionId), 'duplicate or empty client action ID');
    invariant(Number.isFinite(Date.parse(action.occurredAt)), 'invalid action timestamp');
    ids.add(action.actionId); clients.add(action.clientActionId);
    if (action.kind === 'undo') {
      invariant(latestUndoable !== null && action.payload.undoesActionId === latestUndoable, 'Undo must reference the latest undoable transition');
      for (const id of undoTargets(prefix.slice(0, index), latestUndoable)) undone.add(id);
      latestUndoable = null;
    } else if (UNDOABLE_KINDS.has(action.kind)) latestUndoable = action.actionId;
  }

  // Validate each action in the state in which it was originally accepted, then
  // replay its effective prefix after Undo. This rejects malformed actions even when undone.
  let result = emptyProjection(context, 0);
  const observations = new Map<string, VocabularyEncounterEvidence>();
  const accepted: VocabularySessionAction[] = [];
  const appliedUndone = new Set<string>();
  for (const action of prefix) {
    if (action.kind === 'undo') {
      for (const id of undoTargets(accepted, action.payload.undoesActionId)) appliedUndone.add(id);
      result = replay(context, accepted, appliedUndone);
    } else {
      applyAction(result, action, context);
      if (action.kind === 'presentation') {
        const observed = result.encounters.at(-1);
        invariant(observed, 'missing observed presentation');
        observations.set(observed.encounterId, observed);
      }
      accepted.push(action);
      settleFinishedWork(result);
    }
  }
  result.throughSequence = throughSequence;
  result.undoneActionIds = [...undone];
  result.latestUndoableActionId = latestUndoable;
  result.pureCueOutcomes = projectPureCueOutcomes(result.encounters);
  // Original observations survive Undo; only their effective contribution changes.
  result.encounters = prefix.filter((action): action is Extract<VocabularySessionAction, { kind: 'presentation' }> => action.kind === 'presentation')
    .map((presentation) => {
      const effective = result.encounters.find((encounter) => encounter.encounterId === presentation.payload.encounterId);
      const observed = observations.get(presentation.payload.encounterId);
      invariant(observed, 'missing original presentation context');
      const evidence = effective ?? observed;
      const reactions = prefix.filter((action): action is VocabularyReactionAction => action.kind === 'feedback' && action.payload.encounterId === evidence.encounterId);
      return { ...evidence, effectiveFeedback: effectiveVocabularyReactions(reactions), mode: observed.mode, workNumber: observed.workNumber, presentationUndone: !effective, effectiveResponses: [...(effective?.responses ?? [])],
        responses: prefix.filter((action): action is Extract<VocabularySessionAction, { kind: 'response' }> => action.kind === 'response' && action.payload.encounterId === evidence.encounterId),
        feedback: prefix.filter((action): action is Extract<VocabularySessionAction, { kind: 'feedback' }> => action.kind === 'feedback' && action.payload.encounterId === evidence.encounterId),
      };
    });
  for (const word of Object.values(result.words)) {
    if (!word.admitted) continue;
    (word.covered ? result.coveredWordIds : result.uncoveredWordIds).push(word.wordId);
    const initial = context.words.find((entry) => entry.wordId === word.wordId);
    word.recommendedMode = word.explicitModeChoice === null && !initial?.automaticPromotionPaused && isCleanSolidifySession(word)
      ? recommendVocabularyMode(word.mode, (initial?.cleanCoveredSessions ?? 0) + 1)
      : null;
  }
  return result;
}

function emptyProjection(context: VocabularySessionInitialContext, sequence: number): VocabularySessionProjection {
  const words: VocabularySessionProjection['words'] = {};
  for (const word of context.words) {
    invariant(word.wordId.trim() && !words[word.wordId], 'duplicate or empty word context');
    if (word.solidifySkills !== undefined) {
      invariant(word.solidifySkills.length > 0
        && word.solidifySkills.every((skill) => skill === 'recognition' || skill === 'production')
        && new Set(word.solidifySkills).size === word.solidifySkills.length, 'invalid Solidify skill configuration');
    }
    if (word.teachingRequirements) {
      invariant(word.teachingRequirements.minimumRecognitionResponses >= 0 && Number.isInteger(word.teachingRequirements.minimumRecognitionResponses), 'invalid teaching recognition requirement');
      invariant(word.teachingRequirements.minimumProductionResponses >= 0 && Number.isInteger(word.teachingRequirements.minimumProductionResponses), 'invalid teaching production requirement');
    }
    words[word.wordId] = { wordId: word.wordId, initialMode: word.mode, mode: word.mode, explicitModeChoice: null,
      admitted: false, workNumber: 0, workStatus: 'not_started',
      selectedSkill: word.selectedSkill ?? (word.contextualOnly ? 'contextual_selection' : word.recognitionOnly ? 'recognition' : 'production'),
      solidifySkills: [...(word.solidifySkills ?? ['recognition', 'production'])],
      skillProgress: emptySkillProgress(), teachingIntroductionPresented: false, solidifyRecallCompleted: false, productionResponses: 0, successfulProductionResponses: 0,
      covered: false, successfulRecall: false, teachingCompleted: false, teachingDeferred: false, hasRejectedResponse: false, recommendedMode: null };
  }
  return { sessionId: context.sessionId, protocolVersion: VOCABULARY_SESSION_PROTOCOL_VERSION,
    policyVersion: VOCABULARY_SESSION_POLICY.version, throughSequence: sequence, phase: 'active', finishReason: null,
    words, encounters: [], excludedContentIds: [], pureCueOutcomes: [], coveredWordIds: [], uncoveredWordIds: [], undoneActionIds: [], latestUndoableActionId: null };
}
function replay(context: VocabularySessionInitialContext, actions: readonly VocabularySessionAction[], undone: ReadonlySet<string>) {
  const result = emptyProjection(context, 0);
  for (const action of actions) if (!undone.has(action.actionId)) {
    applyAction(result, action, context, true);
    settleFinishedWork(result);
  }
  return result;
}
function applyAction(state: VocabularySessionProjection, action: VocabularySessionAction, context: VocabularySessionInitialContext, replaying = false): void {
  invariant(state.phase !== 'completed' || action.kind === 'feedback' || action.kind === 'resume', 'cannot mutate a completed session');
  const wordFor = (wordId: string) => {
    const word = state.words[wordId]; invariant(word, `unknown word ${wordId}`); return word;
  };
  const encounterFor = (encounterId: string) => {
    const encounter = state.encounters.find((entry) => entry.encounterId === encounterId);
    invariant(encounter, `unknown encounter ${encounterId}`); return encounter;
  };
  switch (action.kind) {
    case 'presentation': {
      const { encounterId, wordId, snapshot } = action.payload;
      invariant(snapshot.schedulingScope !== 'pure_cue' || wordId === null, 'pure cues cannot credit a word schedule');
      if (wordId === null) {
        invariant(snapshot.schedulingScope === 'pure_cue' && snapshot.role === 'general' && snapshot.kind === 'production' && snapshot.assessment !== null, 'independent encounters require a general pure cue');
        invariant(state.phase === 'active' || state.encounters.some((entry) => entry.snapshot.schedulingScope === 'pure_cue' && entry.snapshot.contentId === snapshot.contentId), 'cannot admit a pure cue while finishing');
        invariant(encounterId.trim() && !state.encounters.some((entry) => entry.encounterId === encounterId), 'duplicate or empty encounter');
        state.encounters.push({ encounterId, wordId: null, workNumber: 1, presentedActionId: action.actionId, presentedAt: action.occurredAt, mode: null, snapshot, responses: [], effectiveResponses: [], feedback: [], effectiveFeedback: [], skipped: false, presentationUndone: false });
        return;
      }
      const word = wordFor(wordId);
      invariant(encounterId.trim() && !state.encounters.some((entry) => entry.encounterId === encounterId), 'duplicate or empty encounter');
      if (!word.admitted) {
        invariant(state.phase === 'active', 'cannot admit a new word while finishing');
        word.admitted = true; word.workNumber = 1; word.workStatus = 'open';
      }
      invariant(replaying || word.workStatus === 'open', 'returning to a word requires word_more');
      invariant(snapshot.contentId.trim() && Number.isInteger(snapshot.contentVersion) && snapshot.contentVersion > 0, 'invalid content identity');
      invariant(snapshot.kind === 'introduction' ? snapshot.assessment === null : snapshot.assessment !== null, 'assessment does not match presentation kind');
      invariant(replaying || snapshot.role !== 'teaching' || (word.mode === 'unstudied' && !word.teachingDeferred), 'teaching role requires current teaching requirements');
      invariant(replaying || snapshot.role !== 'priming' || word.mode === 'solidify', 'priming requires Solidify mode');
      invariant(replaying || snapshot.role !== 'general' || word.mode !== 'unstudied', 'unstudied work requires teaching');
      if (snapshot.role === 'teaching' && snapshot.kind === 'introduction'
        && snapshot.contentId === context.words.find((entry) => entry.wordId === wordId)?.teachingRequirements?.introductionContentId) word.teachingIntroductionPresented = true;
      state.encounters.push({ encounterId, wordId, workNumber: word.workNumber, presentedActionId: action.actionId,
        presentedAt: action.occurredAt, mode: word.mode, snapshot, responses: [], effectiveResponses: [], feedback: [], effectiveFeedback: [], skipped: false, presentationUndone: false });
      return;
    }
    case 'response': {
      const encounter = encounterFor(action.payload.encounterId);
      const word = encounter.wordId === null ? null : wordFor(encounter.wordId);
      invariant(word === null || (word.workStatus === 'open' && encounter.workNumber === word.workNumber), 'response belongs to closed word work');
      invariant(encounter.snapshot.kind !== 'introduction' && !encounter.skipped, 'cannot answer introduction or skipped exercise');
      invariant(encounter.responses.length === 0, 'another response requires a fresh encounter');
      invariant(action.payload.selectedWordId === undefined || encounter.snapshot.kind === 'contrast', 'word choice requires contrast');
      invariant(encounter.snapshot.kind !== 'contrast' || typeof action.payload.selectedWordId === 'string', 'contrast requires selected word identity');
      invariant(action.payload.selfAssessment === undefined || encounter.snapshot.kind === 'recognition', 'self assessment requires recognition');
      invariant(action.payload.selfAssessment === undefined || action.payload.selfAssessment === action.payload.outcome, 'self assessment outcome mismatch');
      encounter.responses.push(action);
      if (word === null) return;
      if (action.payload.outcome === 'rejected') word.hasRejectedResponse = true;
      if (encounter.snapshot.kind === 'production' && encounter.snapshot.role === 'general') {
        word.productionResponses++;
        if (action.payload.outcome === 'accepted') word.successfulProductionResponses++;
      }
      if ((word.mode === 'unstudied' && encounter.snapshot.role === 'teaching')
        || (word.mode !== 'unstudied' && encounter.snapshot.role === 'general')) {
        const skill: VocabularySkill = encounter.snapshot.kind === 'contrast' ? 'contextual_selection' : encounter.snapshot.kind;
        const progress = word.skillProgress[skill];
        if (action.payload.outcome === 'accepted') {
          progress.acceptedResponses++; progress.consecutiveAccepted++;
        } else {
          progress.rejectedResponses++; progress.consecutiveAccepted = 0;
        }
        if (word.mode !== 'unstudied' && isVocabularyWordReadyToCover(word)) {
          word.covered = true; word.successfulRecall = true;
          if (word.mode === 'solidify' && word.skillProgress.recognition.acceptedResponses > 0
            && word.skillProgress.production.acceptedResponses > 0) word.solidifyRecallCompleted = true;
        }
      }
      return;
    }
    case 'feedback': {
      if (replaying && !state.encounters.some((entry) => entry.encounterId === action.payload.encounterId)) return;
      encounterFor(action.payload.encounterId).feedback.push(action); return;
    }
    case 'exercise_exclude': {
      const encounter = encounterFor(action.payload.encounterId);
      invariant(encounter.snapshot.role !== 'teaching' && encounter.snapshot.kind !== 'introduction' && encounter.snapshot.kind !== 'recognition', 'exercise does not support another way');
      if (!state.excludedContentIds.includes(encounter.snapshot.contentId)) state.excludedContentIds.push(encounter.snapshot.contentId);
      return;
    }
    case 'exercise_skip': {
      const encounter = encounterFor(action.payload.encounterId);
      const word = encounter.wordId === null ? null : wordFor(encounter.wordId);
      invariant((word === null || (word.workStatus === 'open' && encounter.workNumber === word.workNumber)) && !encounter.skipped, 'exercise is not open');
      encounter.skipped = true; return;
    }
    case 'teaching_complete': {
      const word = wordFor(action.payload.wordId);
      const requirement = context.words.find((entry) => entry.wordId === word.wordId)?.teachingRequirements;
      invariant(word.admitted && word.workStatus === 'open' && word.mode === 'unstudied' && requirement, 'teaching completion requires open teaching and requirements');
      invariant(isVocabularyTeachingComplete(word), 'teaching skill streak or introduction requirement unmet');
      word.teachingCompleted = true; word.covered = true; word.successfulRecall = true; word.mode = 'solidify'; word.workStatus = 'wrapped'; return;
    }
    case 'word_wrap': {
      const word = wordFor(action.payload.wordId);
      invariant(word.admitted && word.workStatus === 'open', 'cannot wrap unopened word');
      invariant(word.mode !== 'unstudied', 'incomplete teaching must be skipped, not wrapped');
      invariant(action.payload.reason !== 'policy' || isVocabularyWordReadyToCover(word), 'default covering requirement unmet');
      word.covered = true; word.workStatus = 'wrapped'; return;
    }
    case 'word_skip': {
      const word = wordFor(action.payload.wordId);
      invariant(word.admitted && word.workStatus === 'open', 'cannot skip unopened word');
      word.workStatus = 'skipped'; return;
    }
    case 'word_more': {
      const word = wordFor(action.payload.wordId);
      invariant(word.admitted && (word.workStatus === 'wrapped' || word.workStatus === 'skipped'), 'more requires previously stopped work');
      invariant(word.mode !== 'unstudied' || !word.teachingDeferred, 'reset teaching starts in a fresh session');
      word.workNumber++; word.workStatus = 'open'; word.productionResponses = 0; word.successfulProductionResponses = 0;
      word.skillProgress = emptySkillProgress(); word.teachingIntroductionPresented = false; return;
    }
    case 'mode_change': {
      const word = wordFor(action.payload.wordId);
      invariant(word.admitted, 'session mode choice requires an encountered word');
      if (action.payload.mode === 'unstudied' && word.mode !== 'unstudied') {
        word.teachingDeferred = true;
        if (word.workStatus === 'open') word.workStatus = 'skipped';
      } else if (action.payload.mode !== 'unstudied') word.teachingDeferred = false;
      word.mode = action.payload.mode; word.explicitModeChoice = action.payload.mode; return;
    }
    case 'resume': invariant(state.phase === 'completed', 'resume requires completed work and cancellation of its pending revision'); state.phase = 'active'; state.finishReason = null; return;
    case 'finish_for_now': invariant(state.phase === 'active', 'finish requested outside active phase'); state.phase = 'finishing'; return;
    case 'finish_immediately': invariant(state.phase === 'finishing', 'immediate finish requires finishing phase'); state.phase = 'completed'; state.finishReason = 'finish_immediately'; return;
    case 'undo': throw new Error('Vocabulary session invariant violated: Undo must be interpreted by replay');
  }
}

/** Effective responses remain ordered by the log even when encounters overlap. */
function projectPureCueOutcomes(encounters: readonly VocabularyEncounterEvidence[]): VocabularySessionProjection['pureCueOutcomes'] {
  const outcomes: VocabularySessionProjection['pureCueOutcomes'] = [];
  for (const encounter of encounters) {
    if (encounter.snapshot.schedulingScope !== 'pure_cue') continue;
    let outcome = outcomes.find((entry) => entry.contentId === encounter.snapshot.contentId);
    if (!outcome) {
      outcome = { contentId: encounter.snapshot.contentId, contentVersion: encounter.snapshot.contentVersion,
        encounterIds: [], acceptedResponses: 0, rejectedResponses: 0, consecutiveAccepted: 0, covered: false };
      outcomes.push(outcome);
    }
    outcome.encounterIds.push(encounter.encounterId);
  }
  for (const { encounter, response } of encounters.filter((entry) => entry.snapshot.schedulingScope === 'pure_cue')
    .flatMap((encounter) => encounter.responses.map((response) => ({encounter, response})))
    .sort((a,b) => a.response.sequence - b.response.sequence)) {
    const outcome = outcomes.find((entry) => entry.contentId === encounter.snapshot.contentId);
    invariant(outcome, 'missing pure cue outcome');
    if (response.payload.outcome === 'accepted') {
      outcome.acceptedResponses++; outcome.consecutiveAccepted++;
    } else {
      outcome.rejectedResponses++; outcome.consecutiveAccepted = 0;
    }
    outcome.covered ||= outcome.consecutiveAccepted >= (outcome.rejectedResponses > 0 ? 3 : 1);
  }
  return outcomes;
}

function settleFinishedWork(state: VocabularySessionProjection): void {
  if (state.phase !== 'finishing') return;
  const openWord = Object.values(state.words).some((word) => word.admitted && word.workStatus === 'open');
  const pendingPureCue = projectPureCueOutcomes(state.encounters).some((outcome) => !outcome.covered
    && !state.excludedContentIds.includes(outcome.contentId)
    && !state.encounters.some((encounter) => outcome.encounterIds.includes(encounter.encounterId) && encounter.skipped));
  if (!openWord && !pendingPureCue) { state.phase = 'completed'; state.finishReason = 'wrapped_up'; }
}

function undoTargets(actions: readonly VocabularySessionAction[], targetId: string): string[] {
  const target = actions.find((action) => action.actionId === targetId);
  invariant(target, 'missing Undo target');
  if (!target.transitionId) return [targetId];
  return actions.filter((action) => action.transitionId === target.transitionId && action.kind !== 'feedback' && action.kind !== 'undo').map((action) => action.actionId);
}

/** Comments accumulate; reaction changes replace the current disposition without deleting history. */
export function effectiveVocabularyReactions(reactions: readonly VocabularyReactionAction[]): VocabularyReactionAction[] {
  const latestReaction = reactions.filter((action) => action.payload.feedback !== 'comment').at(-1);
  return reactions.filter((action) => action.payload.feedback === 'comment' || (action === latestReaction && action.payload.feedback !== 'withdrawn'));
}

/** Read reaction history without spreading historical persistence names into callers. */
export function getVocabularyEncounterReactions(encounter: VocabularyEncounterEvidence): VocabularyReactionAction[] {
  return encounter.feedback;
}
export function getEffectiveVocabularyEncounterReactions(encounter: VocabularyEncounterEvidence): VocabularyReactionAction[] {
  return encounter.effectiveFeedback ?? effectiveVocabularyReactions(encounter.feedback);
}
