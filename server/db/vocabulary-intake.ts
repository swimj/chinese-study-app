import { resolveLearnerTeachingSetKey } from './learner-teaching.ts';
import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import { attachChatCardToTurn, ChatConflictError, createChatCard, getChatCard, getOrCreateChatConversation, listChatCards,
  runChatCardCommand, withChatTransaction, type ChatCard } from './learner-chat.ts';
import { createVocabularySense, emitBackendEvent, getVocabularySenses } from './vocabulary-content.ts';
import { getVocabularyLearnerWord, getVocabularyWordSchedule, VocabularyStateInputError, type VocabularyLearnerWord } from './vocabulary-learners.ts';
import { resolveVocabularyLearnerSenseScope, takeUpVocabularyLearnerSense, writeVocabularyLearnerSenseScope, type VocabularyLearnerSenseScope } from './vocabulary-learner-senses.ts';
import { addVocabularyStashByHanzi } from './vocabulary-stash.ts';
import { getSharedIntroductionLexicalWord } from './word-introductions.ts';
import { requestWordReserveReconciliation } from './word-reserve.ts';
import { hasPendingVocabularyIntakeMatch, VOCABULARY_INTAKE_SURFACE } from './vocabulary-intake-pending.ts';
import { teachingReady } from '../vocabulary/teaching-readiness.ts';
import { validateVocabularySenseInventory } from '../vocabulary/sense-inventory-contract.ts';
import type { JsonValue } from '../llm/types.ts';
import type { VocabularyIntakeCard, VocabularyIntakeCommandRequest, VocabularyIntakeSelection } from '../../src/domain/vocabulary-intake.ts';

type SenseDraft = NonNullable<VocabularyIntakeCard['proposedSense']>;
type Priority = { bump_count: number; force_top: number; priority_tier: number; required_for_next_session: number; updated_at: string };
type Undo = {
  word: VocabularyLearnerWord | null;
  senses: { sense_id: string; disposition: 'active' | 'excluded' }[];
  priority: Priority | null;
  after: { learnerVersion: number; scheduleVersion: number; priority: Priority | null; recordedAt: string };
};
type Pending = { expectedLearnerVersion: number; lease: { token: string; expiresAt: string } | null };
export type IntakeCardBody = {
  wordId: string;
  proposal: boolean;
  proposalKind?: 'sense';
  addedSenseId?: string;
  enrollmentAddedAt: string | null;
  selection: VocabularyIntakeSelection;
  proposedSense: SenseDraft | null;
  context: string | null;
  pending: Pending | null;
  undo: Undo | null;
  attention: string | null;
};
export type IntakeCardDraft = {
  wordId: string;
  selection: VocabularyIntakeSelection;
  proposedSense: SenseDraft | null;
  context: string | null;
  decision: 'bare' | 'context_match' | 'inventory_pending' | 'proposal' | 'correction' | 'larger_expression' | 'existing';
  requestedLexeme: string | null;
};

export class VocabularyIntakeNotFound extends Error {}
export const intakeConversationId = () => getOrCreateChatConversation(VOCABULARY_INTAKE_SURFACE);
export const intakeBody = (card: ChatCard) => card.body as unknown as IntakeCardBody;
export const intakeJson = (body: IntakeCardBody) => body as unknown as JsonValue;
const notMatched = 'Your context could not be matched to one sense. Shared defaults are in use when available.';

export function isVocabularyIntakeEnrolled(word: VocabularyLearnerWord | null): boolean {
  return !!word && word.dismissedAt === null && (word.inStash || word.mode !== 'unstudied');
}
function priority(wordId: string): Priority | null {
  return (getDb().prepare(`SELECT bump_count,force_top,priority_tier,required_for_next_session,updated_at
    FROM learner_owned_user_word_priority WHERE learner_id=? AND word_id=?`).get(requireLearnerId(), wordId) as Priority | undefined) ?? null;
}
function versions(scope: VocabularyLearnerSenseScope): VocabularyIntakeCard['versions'] {
  return { learner: scope.stateVersion, catalog: scope.catalogVersion, selection: scope.selectionVersion };
}
function assertSelection(selection: VocabularyIntakeSelection, scope: VocabularyLearnerSenseScope, draft: SenseDraft | null): void {
  const active = new Set(scope.senses.map(sense => sense.senseId));
  if (selection.senseIds.length > 16 || new Set(selection.senseIds).size !== selection.senseIds.length ||
    selection.senseIds.some(id => !active.has(id)) || (selection.targetSenseId !== null && !selection.senseIds.includes(selection.targetSenseId)) ||
    (selection.includeProposedSense && draft === null)) {
    throw new VocabularyStateInputError('Select active senses belonging to this word');
  }
}
function newSenseConflict(wordId: string, draft: SenseDraft): string | null {
  const existing = getVocabularySenses(wordId).filter(sense => sense.status === 'active');
  if (existing.some(sense => senseLabel(sense.description).trim().toLowerCase() === draft.label.trim().toLowerCase())) {
    return 'This sense is already in the inventory. Ask chat to show the word and choose the existing sense.';
  }
  return existing.length >= 16 ? 'The inventory already has 16 senses. This proposal cannot be added.' : null;
}

function checkNewSense(wordId: string, draft: SenseDraft): void {
  try { validateVocabularySenseInventory({ senses: [{ ...draft, defaultUseful: false }] }); }
  catch { throw new VocabularyStateInputError('The proposed sense is incomplete'); }
  const conflict = newSenseConflict(wordId, draft);
  if (conflict) throw new VocabularyStateInputError(conflict);
}
function senseLabel(description: JsonValue): string {
  if (typeof description === 'string') return description;
  return description && !Array.isArray(description) && typeof description === 'object' && typeof description.label === 'string'
    ? description.label : 'Sense';
}
function senseNotes(description: JsonValue): string[] {
  if (!description || typeof description !== 'object' || Array.isArray(description)) return [];
  if (typeof description.notes === 'string') return [description.notes];
  return Array.isArray(description.notes) ? description.notes.filter((note): note is string => typeof note === 'string') : [];
}
function prerequisiteAttention(wordId: string, scope: VocabularyLearnerSenseScope, allowEmptyInventory = false): string | null {
  const db = getDb();
  const failed = db.prepare("SELECT 1 FROM vocabulary_sense_readiness WHERE word_id=? AND status='failed'").get(wordId);
  if (failed && !scope.inventoryEstablished) return 'The sense inventory needs review.';
  const defaults = db.prepare("SELECT 1 FROM vocabulary_default_selection_readiness WHERE word_id=? AND status='failed'").get(wordId);
  if (defaults && !scope.selectionEstablished) return 'The shared default senses need review before this selection can be saved.';
  if (!allowEmptyInventory && scope.inventoryEstablished && scope.senses.length === 0) return 'The inventory has no study senses.';
  return null;
}
function teachingAttention(wordId: string): string | null {
  const key = resolveLearnerTeachingSetKey(wordId);
  if (!key) return null;
  const result = getDb().prepare(`SELECT 1 FROM word_preparation_work
    WHERE word_id=? AND teaching_set_key=? AND stage IN ('bootstrap','teaching') AND status='paused' AND last_error IS NOT NULL LIMIT 1`)
    .get(wordId,key);
  return result ? 'Lesson preparation needs review.' : null;
}
function undoAvailable(wordId: string, undo: Undo): boolean {
  const learnerId = requireLearnerId();
  const word = getVocabularyLearnerWord(wordId);
  if (!word || word.stateVersion !== undo.after.learnerVersion || word.mode !== 'unstudied' ||
    getVocabularyWordSchedule(wordId)?.stateVersion !== undo.after.scheduleVersion ||
    JSON.stringify(priority(wordId)) !== JSON.stringify(undo.after.priority)) return false;
  // An encounter can already be retained before its schedule effects commit at session close.
  const db = getDb();
  return !db.prepare(`SELECT 1 FROM encounter_words w JOIN exercise_encounters e USING(learner_id,encounter_id)
    WHERE w.learner_id=? AND w.word_id=? AND w.role IN ('target','selected_through') AND e.presented_at>=? LIMIT 1`)
    .get(learnerId, wordId, undo.after.recordedAt)
    && !db.prepare(`SELECT 1 FROM vocabulary_sessions s,json_each(s.context_json,'$.words') w
      WHERE s.learner_id=? AND s.started_at>=? AND json_extract(w.value,'$.wordId')=? LIMIT 1`)
      .get(learnerId, undo.after.recordedAt, wordId);
}
function rollbackEnrollment(wordId: string, undo: Undo): void {
  if (!undoAvailable(wordId, undo)) throw new ChatConflictError('The word changed after the add. Reload its card.');
  const db = getDb(), learnerId = requireLearnerId();
  db.prepare('DELETE FROM learner_senses WHERE learner_id=? AND word_id=?').run(learnerId, wordId);
  if (undo.word) {
    db.prepare(`UPDATE learner_words SET in_stash=?,intended_use_text=?,scope_established_at=?,dismissed_at=?,state_version=state_version+1
      WHERE learner_id=? AND word_id=?`).run(+undo.word.inStash, undo.word.intendedUseText, undo.word.scopeEstablishedAt, undo.word.dismissedAt, learnerId, wordId);
    for (const sense of undo.senses) db.prepare('INSERT INTO learner_senses(learner_id,word_id,sense_id,disposition) VALUES (?,?,?,?)')
      .run(learnerId, wordId, sense.sense_id, sense.disposition);
  } else {
    db.prepare('DELETE FROM learner_word_schedules WHERE learner_id=? AND word_id=?').run(learnerId, wordId);
    db.prepare('DELETE FROM learner_words WHERE learner_id=? AND word_id=?').run(learnerId, wordId);
  }
  if (undo.priority) {
    const p = undo.priority;
    db.prepare(`INSERT INTO learner_owned_user_word_priority(learner_id,word_id,bump_count,force_top,priority_tier,required_for_next_session,updated_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(learner_id,word_id) DO UPDATE SET bump_count=excluded.bump_count,force_top=excluded.force_top,
      priority_tier=excluded.priority_tier,required_for_next_session=excluded.required_for_next_session,updated_at=excluded.updated_at`)
      .run(learnerId, wordId, p.bump_count, p.force_top, p.priority_tier, p.required_for_next_session, p.updated_at);
  } else db.prepare('DELETE FROM learner_owned_user_word_priority WHERE learner_id=? AND word_id=?').run(learnerId, wordId);
  requestWordReserveReconciliation();
  emitBackendEvent({ name: 'vocabulary.intake.add_undone', learnerId, actorKind: 'learner', actorId: learnerId, entityKind: 'word', entityId: wordId, data: {} });
}
function writeSelection(wordId: string, selection: VocabularyIntakeSelection, scope: VocabularyLearnerSenseScope): VocabularyLearnerSenseScope {
  return writeVocabularyLearnerSenseScope(wordId, {
    senseIds: selection.senseIds, targetSenseId: selection.targetSenseId, expectedStateVersion: scope.stateVersion!,
    expectedCatalogVersion: scope.catalogVersion, expectedSelectionVersion: scope.selectionVersion,
    surface: VOCABULARY_INTAKE_SURFACE,
  });
}
function createIntakeSense(wordId: string, draft: SenseDraft): string {
  checkNewSense(wordId, draft);
  const sense = createVocabularySense({ wordId, description: {
    label: draft.label.trim(), notes: draft.notes.map(note => note.trim()), source: { kind: 'learner_intake' },
  } }, { kind: 'service', id: VOCABULARY_INTAKE_SURFACE });
  emitBackendEvent({ name: 'vocabulary.intake.finding', entityKind: 'word', entityId: wordId,
    data: { kind: 'new_sense', senseId: sense.senseId } });
  return sense.senseId;
}

function enroll(body: IntakeCardBody, initialScope: VocabularyLearnerSenseScope): IntakeCardBody {
  let scope = initialScope;
  const wordId = body.wordId;
  const lexical = getSharedIntroductionLexicalWord(wordId)!;
  const before = getVocabularyLearnerWord(wordId);
  if (isVocabularyIntakeEnrolled(before)) throw new ChatConflictError('This word is already in your vocabulary');
  assertSelection(body.selection, scope, body.proposedSense);
  if (!scope.inventoryEstablished && scope.senses.length > 0) throw new VocabularyStateInputError('Wait for inventory review');
  if (scope.inventoryEstablished && (!scope.selectionEstablished || (!body.selection.senseIds.length && !body.selection.includeProposedSense))) {
    throw new VocabularyStateInputError(scope.selectionEstablished ? 'Choose at least one sense' : 'Wait for the shared default senses');
  }
  const learnerId = requireLearnerId(), db = getDb();
  const originalSenses = db.prepare('SELECT sense_id,disposition FROM learner_senses WHERE learner_id=? AND word_id=? ORDER BY sense_id')
    .all(learnerId, wordId) as Undo['senses'];
  const originalPriority = priority(wordId);
  const selection = { ...body.selection };
  if (selection.includeProposedSense && body.proposedSense) {
    const draft = body.proposedSense;
    if (!scope.inventoryEstablished) throw new VocabularyStateInputError('Wait for the sense inventory');
    const senseId = createIntakeSense(wordId, draft);
    selection.senseIds = [...selection.senseIds, senseId];
    selection.targetSenseId = senseId;
    selection.includeProposedSense = false;
  }
  addVocabularyStashByHanzi(lexical.hanzi, false, [wordId], body.context);
  if (before && body.context !== null && body.context !== before.intendedUseText) {
    db.prepare('UPDATE learner_words SET intended_use_text=?,state_version=state_version+1 WHERE learner_id=? AND word_id=?')
      .run(body.context, learnerId, wordId);
  }
  scope = resolveVocabularyLearnerSenseScope(wordId);
  if (selection.senseIds.length) scope = writeSelection(wordId, selection, scope);
  const learnerVersion = scope.stateVersion!;
  const undo: Undo = {
    word: before, senses: originalSenses, priority: originalPriority,
    after: { learnerVersion, scheduleVersion: getVocabularyWordSchedule(wordId)!.stateVersion,
      priority: priority(wordId), recordedAt: new Date().toISOString() },
  };
  return { ...body, proposal: false, enrollmentAddedAt: getVocabularyLearnerWord(wordId)!.addedAt, selection, proposedSense: null, undo, attention: null,
    pending: !scope.inventoryEstablished && body.context ? { expectedLearnerVersion: learnerVersion, lease: null } : null };
}

export function saveVocabularyIntakeCard(turnId: string, draft: IntakeCardDraft, allowAutomatic: boolean): ChatCard {
  return withChatTransaction(() => {
    const lexical = getSharedIntroductionLexicalWord(draft.wordId);
    if (!lexical) throw new VocabularyStateInputError('Unknown word');
    const scope = resolveVocabularyLearnerSenseScope(draft.wordId);
    assertSelection(draft.selection, scope, draft.proposedSense);
    if (draft.proposedSense) {
      if (!scope.inventoryEstablished || draft.decision !== 'proposal') throw new VocabularyStateInputError('A new sense must be proposed against an established inventory');
      checkNewSense(draft.wordId, draft.proposedSense);
    }
    let body: IntakeCardBody = { wordId: draft.wordId, proposal: true, enrollmentAddedAt: null, selection: draft.selection,
      proposedSense: draft.proposedSense, context: draft.context, pending: null, undo: null, attention: null };
    if (isVocabularyIntakeEnrolled(getVocabularyLearnerWord(draft.wordId))) {
      if (draft.proposedSense && !draft.selection.includeProposedSense) throw new VocabularyStateInputError('Select the proposed new sense');
      body = { ...body, proposal: !!draft.proposedSense,
        ...(draft.proposedSense ? { proposalKind: 'sense' as const } : {}),
        selection: { senseIds: scope.includedSenseIds, targetSenseId: null, includeProposedSense: !!draft.proposedSense } };
    } else if (allowAutomatic && !draft.proposedSense) {
      const selected = [...scope.defaultSenseIds ?? []];
      if (draft.selection.targetSenseId && !selected.includes(draft.selection.targetSenseId)) selected.push(draft.selection.targetSenseId);
      const choice = { ...draft.selection, senseIds: selected, includeProposedSense: false };
      const known = scope.inventoryEstablished && !!scope.defaultSenseIds?.length;
      const missing = !scope.inventoryEstablished && scope.senses.length === 0;
      if ((known && (draft.decision === 'bare' || (draft.decision === 'context_match' && choice.targetSenseId && draft.context))) ||
        (missing && draft.decision === 'inventory_pending')) body = enroll({ ...body, selection: choice }, scope);
    }
    if (draft.decision === 'larger_expression' && draft.requestedLexeme) {
      emitBackendEvent({ name: 'vocabulary.intake.finding', entityKind: 'word', entityId: draft.wordId,
        data: { kind: 'redirect', requestedLexeme: draft.requestedLexeme } });
    }
    return createChatCard(turnId, intakeJson(body));
  });
}

export function projectVocabularyIntakeCard(card: ChatCard): VocabularyIntakeCard {
  const body = intakeBody(card);
  const lexical = getSharedIntroductionLexicalWord(body.wordId)!;
  const word = getVocabularyLearnerWord(body.wordId);
  const scope = resolveVocabularyLearnerSenseScope(body.wordId);
  const enrolled = isVocabularyIntakeEnrolled(word);
  const pending = enrolled && body.pending !== null && body.pending.expectedLearnerVersion === word?.stateVersion;
  const active = new Set(scope.senses.map(sense => sense.senseId));
  const target = body.selection.targetSenseId;
  const senseProposed = body.proposal && body.proposalKind === 'sense' && body.proposedSense !== null;
  const proposed = !senseProposed && !enrolled && body.proposal;
  const ownEnrollment = enrolled && body.undo && body.undo.after.learnerVersion === word?.stateVersion;
  const attention = (ownEnrollment ? body.attention : null) ?? prerequisiteAttention(body.wordId,scope) ??
    (enrolled && word?.mode === 'unstudied' ? teachingAttention(body.wordId) : null);
  const senseAttention = senseProposed ? !enrolled ? 'This word is no longer in your vocabulary.'
    : prerequisiteAttention(body.wordId, scope, true)
      ?? (!scope.selectionEstablished ? 'Default senses are being prepared.'
        : hasPendingVocabularyIntakeMatch(body.wordId) ? 'Wait for the earlier context match to finish.'
        : newSenseConflict(body.wordId, body.proposedSense!)) : null;
  const selected = proposed ? body.selection.senseIds.filter(id => active.has(id)) : scope.includedSenseIds;
  const state: VocabularyIntakeCard['state'] = senseProposed ? 'sense-proposed' : !enrolled ? 'proposed'
    : word?.mode !== 'unstudied' ? 'already-studying' : 'added';
  const selection = { senseIds: selected, includeProposedSense: senseProposed || (proposed && body.selection.includeProposedSense),
    targetSenseId: target && selected.includes(target) ? target : null };
  const actions: VocabularyIntakeCard['actions'] = [];
  if (proposed && ((!scope.inventoryEstablished && active.size === 0) ||
    (scope.selectionEstablished && (selected.length > 0 || body.proposedSense !== null || active.size > 0)))) actions.push('add');
  if (senseProposed && enrolled && scope.inventoryEstablished && scope.selectionEstablished && !senseAttention) actions.push('add_sense');
  if (!senseProposed && enrolled && body.undo && undoAvailable(body.wordId, body.undo)) actions.push('undo');
  if (!senseProposed && enrolled && scope.inventoryEstablished && scope.selectionEstablished && scope.senses.length > 0 && !pending) actions.push('change_senses');
  const presets: VocabularyIntakeCard['presets'] = [];
  if (!senseProposed && selection.targetSenseId && selected.length > 1) presets.push({ label: 'Only the context sense',
    selection: { senseIds: [selection.targetSenseId], includeProposedSense: false, targetSenseId: selection.targetSenseId } });
  if (!senseProposed && selection.includeProposedSense && selected.length > 0) presets.push({ label: 'Only the proposed sense',
    selection: { senseIds: [], includeProposedSense: true, targetSenseId: null } });
  return { id: card.id, version: card.version, wordId: body.wordId, hanzi: lexical.hanzi, pinyin: lexical.pinyin, state,
    senses: scope.senses.map(sense => ({ senseId: sense.senseId, label: senseLabel(sense.description), notes: senseNotes(sense.description),
      isDefault: scope.defaultSenseIds?.includes(sense.senseId) ?? false,
      disposition: scope.choices.find(choice => choice.senseId === sense.senseId)?.disposition ?? 'default' })),
    selection, defaultsEstablished: scope.selectionEstablished, proposedSense: proposed || senseProposed ? body.proposedSense : null,
    ...(body.addedSenseId && active.has(body.addedSenseId) ? { addedSenseId: body.addedSenseId } : {}),
    versions: versions(scope), actions, presets, attention: senseProposed ? senseAttention : proposed || (enrolled && !pending && word?.mode === 'unstudied') ? attention : null };
}

export function getVocabularyIntakeCard(id: string): ChatCard {
  const card = getChatCard(id);
  if (!card || !getDb().prepare('SELECT 1 FROM learner_chat_conversations WHERE learner_id=? AND id=? AND surface=?')
    .get(requireLearnerId(), card.conversationId, VOCABULARY_INTAKE_SURFACE)) throw new VocabularyIntakeNotFound('Card not found');
  return card;
}
export function listVocabularyIntakeCards(outstanding: boolean): VocabularyIntakeCard[] {
  const results: VocabularyIntakeCard[] = [];
  for (let page = listChatCards(VOCABULARY_INTAKE_SURFACE, undefined, 100); page.length;) {
    for (const card of page) {
      const projected = projectVocabularyIntakeCard(card);
      const awaitingPreparation = projected.state === 'added'
        && (hasPendingVocabularyIntakeMatch(projected.wordId) || !teachingReady(projected.wordId));
      if (!outstanding || ((projected.state === 'proposed' || projected.state === 'sense-proposed') && intakeBody(card).proposal) ||
        awaitingPreparation || projected.attention !== null) results.push(projected);
    }
    page = page.length === 100 ? listChatCards(VOCABULARY_INTAKE_SURFACE, page.at(-1), 100) : [];
  }
  return results.reverse();
}
export function runVocabularyIntakeCommand(cardId: string, request: VocabularyIntakeCommandRequest): VocabularyIntakeCard {
  getVocabularyIntakeCard(cardId);
  const stored = runChatCardCommand({ cardId, clientActionId: request.clientActionId, expectedVersion: request.expectedVersion,
    request: request as unknown as JsonValue, apply: card => {
      const body = intakeBody(card), wordId = body.wordId;
      const scope = resolveVocabularyLearnerSenseScope(wordId);
      const current = versions(scope);
      if (current.learner !== request.versions.learner || current.catalog !== request.versions.catalog || current.selection !== request.versions.selection) {
        throw new ChatConflictError('Word or senses changed. Reload the card before saving.');
      }
      const command = request.command;
      const word = getVocabularyLearnerWord(wordId);
      if (command.type === 'undo') {
        if (!body.undo) throw new ChatConflictError('This add cannot be undone');
        rollbackEnrollment(wordId, body.undo);
        return intakeJson({ ...body, proposal: true, enrollmentAddedAt: null, undo: null, pending: null, attention: null });
      }
      if (command.type === 'add_sense') {
        if (!body.proposal || body.proposalKind !== 'sense' || !body.proposedSense || !isVocabularyIntakeEnrolled(word)) {
          throw new ChatConflictError('This sense proposal is no longer available');
        }
        if (!scope.inventoryEstablished || !scope.selectionEstablished) throw new VocabularyStateInputError('Wait for the sense inventory and defaults');
        if (hasPendingVocabularyIntakeMatch(wordId)) throw new ChatConflictError('Wait for the earlier context match to finish.');
        const senseId = createIntakeSense(wordId, body.proposedSense);
        const next = resolveVocabularyLearnerSenseScope(wordId);
        const updated = takeUpVocabularyLearnerSense(wordId, senseId, {
          expectedStateVersion: next.stateVersion!, expectedCatalogVersion: next.catalogVersion,
          expectedSelectionVersion: next.selectionVersion, surface: VOCABULARY_INTAKE_SURFACE,
        });
        return intakeJson({ ...body, proposal: false, proposedSense: null, addedSenseId: senseId, undo: null, pending: null, attention: null,
          selection: { senseIds: updated.includedSenseIds, targetSenseId: null, includeProposedSense: false } });
      }
      if (command.type === 'add') {
        if (!body.proposal || body.proposalKind === 'sense' || isVocabularyIntakeEnrolled(word)) throw new ChatConflictError('This proposal is no longer available');
        return intakeJson(enroll({ ...body, selection: command.selection }, scope));
      }
      if (body.proposal && body.proposalKind === 'sense') throw new ChatConflictError('Confirm Add sense before changing its selection');
      if (!isVocabularyIntakeEnrolled(word)) throw new ChatConflictError('The word is no longer in your vocabulary');
      if (body.pending?.expectedLearnerVersion === word?.stateVersion) throw new ChatConflictError('Wait for the context match');
      assertSelection(command.selection, scope, null);
      writeSelection(wordId, command.selection, scope);
      return intakeJson({ ...body, selection: command.selection, pending: null, undo: null, attention: null });
    } });
  // Use the latest durable card if another action followed the replayed receipt.
  return projectVocabularyIntakeCard(getVocabularyIntakeCard(stored.id));
}

export type IntakeCardRevision = {
  cardId: string;
  action: 'set_senses' | 'undo' | 'revise_proposal';
  selection: VocabularyIntakeSelection | null;
  proposedSense: SenseDraft | null;
  context: string | null;
};

/** The model supplies intent; versions and authority come from the server's pre-generation snapshot. */
export function reviseVocabularyIntakeCard(turnId: string, snapshot: VocabularyIntakeCard,
  revision: IntakeCardRevision): ChatCard {
  return withChatTransaction(() => {
    if (revision.cardId !== snapshot.id) throw new VocabularyStateInputError('Unexpected card');
    const card = getVocabularyIntakeCard(snapshot.id), body = intakeBody(card);
    const scope = resolveVocabularyLearnerSenseScope(body.wordId), current = versions(scope);
    if (card.version !== snapshot.version || current.learner !== snapshot.versions.learner
      || current.catalog !== snapshot.versions.catalog || current.selection !== snapshot.versions.selection) {
      throw new ChatConflictError('The card changed while this reply was being prepared. Review it and send a new message.');
    }
    if (revision.action !== 'revise_proposal' && (revision.proposedSense !== null || revision.context !== null)) {
      throw new VocabularyStateInputError('This action cannot replace a proposal');
    }
    if (revision.action === 'undo') {
      if (revision.selection !== null || !snapshot.actions.includes('undo')) throw new ChatConflictError('This add cannot be undone');
      runVocabularyIntakeCommand(snapshot.id, { clientActionId: `${turnId}:revision`, expectedVersion: snapshot.version,
        versions: snapshot.versions, command: { type: 'undo' } });
    } else {
      const selection = revision.selection;
      if (!selection || (!selection.senseIds.length && !selection.includeProposedSense)) {
        throw new VocabularyStateInputError('Choose at least one sense');
      }
      if (snapshot.state === 'sense-proposed') {
        if (revision.action !== 'revise_proposal' || !revision.proposedSense || !selection.includeProposedSense
          || !isVocabularyIntakeEnrolled(getVocabularyLearnerWord(body.wordId))) throw new VocabularyStateInputError('Confirm Add sense before selecting it; this proposal only revises the new meaning');
        checkNewSense(body.wordId, revision.proposedSense);
        const proposed = [revision.proposedSense.label, ...revision.proposedSense.notes].join(' ');
        if ([body.context, revision.context].some(context => context && context.length > 16 && proposed.includes(context))) {
          throw new VocabularyStateInputError('Shared sense notes require a general example');
        }
        runChatCardCommand({ cardId: card.id, clientActionId: `${turnId}:revision`, expectedVersion: snapshot.version,
          request: revision as unknown as JsonValue, apply: () => intakeJson({ ...body, proposedSense: revision.proposedSense,
            context: revision.context ?? body.context }) });
      } else if (snapshot.state === 'proposed' && body.proposal && !isVocabularyIntakeEnrolled(getVocabularyLearnerWord(body.wordId))) {
        const proposedSense = revision.action === 'revise_proposal' ? revision.proposedSense : body.proposedSense;
        assertSelection(selection, scope, proposedSense);
        if (proposedSense) {
          if (!scope.inventoryEstablished) throw new VocabularyStateInputError('Wait for the sense inventory');
          checkNewSense(body.wordId, proposedSense);
          const proposed = [proposedSense.label, ...proposedSense.notes].join(' ');
          if ([body.context, revision.context].some(context => context && context.length > 16 && proposed.includes(context))) {
            throw new VocabularyStateInputError('Shared sense notes require a general example');
          }
        }
        runChatCardCommand({ cardId: card.id, clientActionId: `${turnId}:revision`, expectedVersion: snapshot.version,
          request: revision as unknown as JsonValue, apply: () => intakeJson({ ...body, selection, proposedSense,
            context: revision.context ?? body.context }) });
      } else {
        if (revision.action !== 'set_senses' || !snapshot.actions.includes('change_senses')) {
          throw new VocabularyStateInputError('This card does not support that change');
        }
        runVocabularyIntakeCommand(snapshot.id, { clientActionId: `${turnId}:revision`, expectedVersion: snapshot.version,
          versions: snapshot.versions, command: { type: 'set_senses', selection } });
      }
    }
    return attachChatCardToTurn(turnId, snapshot.id);
  });
}

export function completeIntakeContextMatch(card: ChatCard, targetSenseId: string | null, attention = notMatched): IntakeCardBody {
  const body = intakeBody(card), word = getVocabularyLearnerWord(body.wordId);
  if (!body.pending || !isVocabularyIntakeEnrolled(word) || body.pending.expectedLearnerVersion !== word?.stateVersion) {
    return { ...body, pending: null };
  }
  const scope = resolveVocabularyLearnerSenseScope(body.wordId);
  if (!targetSenseId || !scope.selectionEstablished || !scope.senses.some(sense => sense.senseId === targetSenseId)) {
    return { ...body, pending: null, attention };
  }
  const selection = { senseIds: [...new Set([...(scope.defaultSenseIds ?? []), targetSenseId])],
    includeProposedSense: false, targetSenseId };
  const learnerVersion = writeSelection(body.wordId, selection, scope).stateVersion!;
  const undo = body.undo ? { ...body.undo, after: { ...body.undo.after, learnerVersion } } : null;
  return { ...body, pending: null, attention: null, selection, undo };
}

export function listVocabularyIntakeFindings(): unknown[] {
  return getDb().prepare(`SELECT event_id AS id,entity_id AS wordId,occurred_at AS createdAt,data_json AS data
    FROM backend_events WHERE name='vocabulary.intake.finding' ORDER BY occurred_at DESC,event_id DESC LIMIT 100`).all()
    .map(({ data, ...row }) => ({ ...row, finding: JSON.parse(String(data)) }));
}

/** My Words and chat read the same pending match and current teaching readiness. */
export function getVocabularyIntakePreparationStatus(wordId: string): 'preparing' | 'ready' | 'needs-attention' {
  if (hasPendingVocabularyIntakeMatch(wordId)) return 'preparing';
  const word = getVocabularyLearnerWord(wordId);
  const learner = requireLearnerId();
  const attention = word && getDb().prepare(`SELECT 1 FROM learner_chat_cards c
    JOIN learner_chat_conversations v ON v.learner_id=c.learner_id AND v.id=c.conversation_id
    WHERE c.learner_id=? AND v.surface=? AND json_extract(c.body_json,'$.wordId')=?
      AND json_extract(c.body_json,'$.undo.after.learnerVersion')=?
      AND json_extract(c.body_json,'$.attention') IS NOT NULL LIMIT 1`).get(learner,VOCABULARY_INTAKE_SURFACE,wordId,word.stateVersion);
  if (attention || prerequisiteAttention(wordId,resolveVocabularyLearnerSenseScope(wordId)) || teachingAttention(wordId)) return 'needs-attention';
  return teachingReady(wordId) ? 'ready' : 'preparing';
}
