/** Shared, side-effect-free interpretation of the authoritative vocabulary session log. */
export const VOCABULARY_SESSION_PROTOCOL_VERSION = 1 as const;
export const VOCABULARY_SESSION_POLICY = {
  version: 'vocabulary-session.v1',
  /** Responses, including rejected responses, cover work; coverage is not recall success. */
  productionResponsesToCover: 2,
  solidifyCleanCoveredSessionsToRecommendPractice: 3,
  /** Maintain promotion is deliberately disabled in the first delivery. */
  practiceCleanCoveredSessionsToRecommendMaintain: Infinity,
} as const;

export type VocabularyWordMode = 'unstudied' | 'solidify' | 'practice' | 'maintain';
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
  teachingRequirements?: VocabularyTeachingRequirements;
};
export type VocabularySessionInitialContext = {
  sessionId: string;
  words: readonly VocabularySessionWordContext[];
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
  | { kind: 'response'; payload: { encounterId: string; response: string | null; outcome: 'accepted' | 'rejected'; selfAssessment?: 'accepted' | 'rejected'; helpUsed?: boolean } }
  | { kind: 'feedback'; payload: { encounterId: string; feedback: 'positive' | 'negative' | 'comment'; comment?: string } }
  | { kind: 'teaching_complete'; payload: { wordId: string } }
  | { kind: 'word_wrap'; payload: { wordId: string; reason: 'enough' | 'policy' } }
  | { kind: 'word_more'; payload: { wordId: string } }
  | { kind: 'word_skip'; payload: { wordId: string } }
  | { kind: 'exercise_skip'; payload: { encounterId: string } }
  | { kind: 'mode_change'; payload: { wordId: string; mode: VocabularyWordMode } }
  | { kind: 'finish_for_now'; payload: Record<string, never> }
  | { kind: 'finish_immediately'; payload: Record<string, never> }
  | { kind: 'undo'; payload: { undoesActionId: string } };
export type VocabularySessionAction = VocabularySessionActionPayload & {
  protocolVersion: typeof VOCABULARY_SESSION_PROTOCOL_VERSION;
  actionId: string;
  clientActionId: string;
  sequence: number;
  occurredAt: string;
};
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
  feedback: Extract<VocabularySessionAction, { kind: 'feedback' }>[];
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
  productionResponses: number;
  successfulProductionResponses: number;
  covered: boolean;
  successfulRecall: boolean;
  teachingCompleted: boolean;
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
  pureCueOutcomes: { contentId: string; contentVersion: number; encounterIds: string[]; acceptedResponses: number; rejectedResponses: number; covered: boolean }[];
  coveredWordIds: string[];
  uncoveredWordIds: string[];
  undoneActionIds: string[];
  latestUndoableActionId: string | null;
};

const UNDOABLE_KINDS = new Set<VocabularySessionAction['kind']>([
  'response', 'teaching_complete', 'word_wrap', 'word_more', 'word_skip', 'exercise_skip', 'mode_change',
  'finish_for_now', 'finish_immediately',
]);
function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Vocabulary session invariant violated: ${message}`);
}

export function recommendVocabularyMode(mode: VocabularyWordMode, cleanCoveredSessions: number): VocabularyWordMode | null {
  invariant(Number.isInteger(cleanCoveredSessions) && cleanCoveredSessions >= 0, 'invalid clean session count');
  if (mode === 'solidify' && cleanCoveredSessions >= VOCABULARY_SESSION_POLICY.solidifyCleanCoveredSessionsToRecommendPractice) return 'practice';
  return null;
}

/** The latest effective transition alone is undoable; feedback and presentation do not erase that scope. */
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
      undone.add(latestUndoable); latestUndoable = null;
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
      appliedUndone.add(action.payload.undoesActionId);
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
  for (const encounter of result.encounters) {
    if (encounter.snapshot.schedulingScope !== 'pure_cue') continue;
    let outcome = result.pureCueOutcomes.find((entry) => entry.contentId === encounter.snapshot.contentId);
    if (!outcome) {
      outcome = { contentId: encounter.snapshot.contentId, contentVersion: encounter.snapshot.contentVersion, encounterIds: [], acceptedResponses: 0, rejectedResponses: 0, covered: false };
      result.pureCueOutcomes.push(outcome);
    }
    outcome.encounterIds.push(encounter.encounterId);
    for (const response of encounter.responses) {
      if (response.payload.outcome === 'accepted') outcome.acceptedResponses++;
      else outcome.rejectedResponses++;
    }
    outcome.covered ||= encounter.responses.length > 0;
  }
  // Original observations survive Undo; only their effective contribution changes.
  result.encounters = prefix.filter((action): action is Extract<VocabularySessionAction, { kind: 'presentation' }> => action.kind === 'presentation')
    .map((presentation) => {
      const effective = result.encounters.find((encounter) => encounter.encounterId === presentation.payload.encounterId);
      invariant(effective, 'presentation evidence lost');
      const observed = observations.get(effective.encounterId);
      invariant(observed, 'missing original presentation context');
      return { ...effective, mode: observed.mode, workNumber: observed.workNumber, effectiveResponses: [...effective.responses],
        responses: prefix.filter((action): action is Extract<VocabularySessionAction, { kind: 'response' }> => action.kind === 'response' && action.payload.encounterId === effective.encounterId),
        feedback: prefix.filter((action): action is Extract<VocabularySessionAction, { kind: 'feedback' }> => action.kind === 'feedback' && action.payload.encounterId === effective.encounterId),
      };
    });
  for (const word of Object.values(result.words)) {
    if (!word.admitted) continue;
    (word.covered ? result.coveredWordIds : result.uncoveredWordIds).push(word.wordId);
    const clean = word.covered && word.successfulRecall && !word.hasRejectedResponse;
    word.recommendedMode = word.explicitModeChoice === null && clean
      ? recommendVocabularyMode(word.mode, (context.words.find((entry) => entry.wordId === word.wordId)?.cleanCoveredSessions ?? 0) + 1)
      : null;
  }
  return result;
}

function emptyProjection(context: VocabularySessionInitialContext, sequence: number): VocabularySessionProjection {
  const words: VocabularySessionProjection['words'] = {};
  for (const word of context.words) {
    invariant(word.wordId.trim() && !words[word.wordId], 'duplicate or empty word context');
    if (word.teachingRequirements) {
      invariant(word.teachingRequirements.minimumRecognitionResponses >= 0 && Number.isInteger(word.teachingRequirements.minimumRecognitionResponses), 'invalid teaching recognition requirement');
      invariant(word.teachingRequirements.minimumProductionResponses >= 0 && Number.isInteger(word.teachingRequirements.minimumProductionResponses), 'invalid teaching production requirement');
    }
    words[word.wordId] = { wordId: word.wordId, initialMode: word.mode, mode: word.mode, explicitModeChoice: null,
      admitted: false, workNumber: 0, workStatus: 'not_started', productionResponses: 0, successfulProductionResponses: 0,
      covered: false, successfulRecall: false, teachingCompleted: false, hasRejectedResponse: false, recommendedMode: null };
  }
  return { sessionId: context.sessionId, protocolVersion: VOCABULARY_SESSION_PROTOCOL_VERSION,
    policyVersion: VOCABULARY_SESSION_POLICY.version, throughSequence: sequence, phase: 'active', finishReason: null,
    words, encounters: [], pureCueOutcomes: [], coveredWordIds: [], uncoveredWordIds: [], undoneActionIds: [], latestUndoableActionId: null };
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
  invariant(state.phase !== 'completed' || action.kind === 'feedback', 'cannot mutate a completed session');
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
        state.encounters.push({ encounterId, wordId: null, workNumber: 1, presentedActionId: action.actionId, presentedAt: action.occurredAt, mode: null, snapshot, responses: [], effectiveResponses: [], feedback: [], skipped: false, presentationUndone: false });
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
      invariant(replaying || snapshot.role !== 'teaching' || word.mode === 'unstudied', 'teaching role requires unstudied mode');
      invariant(replaying || snapshot.role !== 'priming' || word.mode === 'solidify', 'priming requires Solidify mode');
      invariant(replaying || snapshot.role !== 'general' || word.mode !== 'unstudied', 'unstudied work requires teaching');
      state.encounters.push({ encounterId, wordId, workNumber: word.workNumber, presentedActionId: action.actionId,
        presentedAt: action.occurredAt, mode: word.mode, snapshot, responses: [], effectiveResponses: [], feedback: [], skipped: false, presentationUndone: false });
      return;
    }
    case 'response': {
      const encounter = encounterFor(action.payload.encounterId);
      const word = encounter.wordId === null ? null : wordFor(encounter.wordId);
      invariant(word === null || (word.workStatus === 'open' && encounter.workNumber === word.workNumber), 'response belongs to closed word work');
      invariant(encounter.snapshot.kind !== 'introduction' && !encounter.skipped, 'cannot answer introduction or skipped exercise');
      invariant(encounter.responses.length === 0, 'another response requires a fresh encounter');
      invariant(action.payload.selfAssessment === undefined || encounter.snapshot.kind === 'recognition', 'self assessment requires recognition');
      invariant(action.payload.selfAssessment === undefined || action.payload.selfAssessment === action.payload.outcome, 'self assessment outcome mismatch');
      encounter.responses.push(action);
      if (word === null) return;
      if (action.payload.outcome === 'rejected') word.hasRejectedResponse = true;
      if (encounter.snapshot.kind === 'production' && encounter.snapshot.role === 'general') {
        word.productionResponses++;
        if (action.payload.outcome === 'accepted') word.successfulProductionResponses++;
        if (word.productionResponses >= VOCABULARY_SESSION_POLICY.productionResponsesToCover) {
          word.covered = true;
          word.successfulRecall ||= word.successfulProductionResponses >= VOCABULARY_SESSION_POLICY.productionResponsesToCover;
        }
      }
      return;
    }
    case 'feedback': encounterFor(action.payload.encounterId).feedback.push(action); return;
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
      const teaching = state.encounters.filter((entry) => entry.wordId === word.wordId && entry.workNumber === word.workNumber && entry.snapshot.role === 'teaching');
      invariant(teaching.some((entry) => entry.snapshot.kind === 'introduction' && entry.snapshot.contentId === requirement.introductionContentId), 'required introduction was not presented');
      const successful = teaching.filter((entry) => !entry.skipped && entry.responses.some((response) => response.payload.outcome === 'accepted'));
      invariant(requirement.requiredExerciseContentIds.every((id) => successful.some((entry) => entry.snapshot.contentId === id)), 'required teaching exercise was not completed');
      invariant(successful.filter((entry) => entry.snapshot.kind === 'recognition').length >= requirement.minimumRecognitionResponses, 'recognition teaching requirement unmet');
      invariant(successful.filter((entry) => entry.snapshot.kind === 'production').length >= requirement.minimumProductionResponses, 'production teaching requirement unmet');
      word.teachingCompleted = true; word.covered = true; word.successfulRecall = true; word.mode = 'solidify'; word.workStatus = 'wrapped'; return;
    }
    case 'word_wrap': {
      const word = wordFor(action.payload.wordId);
      invariant(word.admitted && word.workStatus === 'open', 'cannot wrap unopened word');
      invariant(word.mode !== 'unstudied', 'incomplete teaching must be skipped, not wrapped');
      invariant(action.payload.reason !== 'policy' || word.productionResponses >= VOCABULARY_SESSION_POLICY.productionResponsesToCover, 'default covering requirement unmet');
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
      word.workNumber++; word.workStatus = 'open'; word.productionResponses = 0; word.successfulProductionResponses = 0; return;
    }
    case 'mode_change': {
      const word = wordFor(action.payload.wordId);
      invariant(word.admitted, 'session mode choice requires an encountered word');
      word.mode = action.payload.mode; word.explicitModeChoice = action.payload.mode; return;
    }
    case 'finish_for_now': invariant(state.phase === 'active', 'finish requested outside active phase'); state.phase = 'finishing'; return;
    case 'finish_immediately': invariant(state.phase === 'finishing', 'immediate finish requires finishing phase'); state.phase = 'completed'; state.finishReason = 'finish_immediately'; return;
    case 'undo': throw new Error('Vocabulary session invariant violated: Undo must be interpreted by replay');
  }
}

function settleFinishedWork(state: VocabularySessionProjection): void {
  if (state.phase !== 'finishing') return;
  const openWord = Object.values(state.words).some((word) => word.admitted && word.workStatus === 'open');
  const pendingPureCue = state.encounters.some((encounter) => encounter.snapshot.schedulingScope === 'pure_cue' && !encounter.skipped && encounter.responses.length === 0);
  if (!openWord && !pendingPureCue) { state.phase = 'completed'; state.finishReason = 'wrapped_up'; }
}
