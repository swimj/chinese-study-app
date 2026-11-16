import { randomUUID } from 'node:crypto';
import { getDb } from './connection.ts';
import { runWithLearnerId } from './learner-context.ts';
import { getChatCard, updateChatCard, withChatTransaction } from './learner-chat.ts';
import { completeIntakeContextMatch, intakeBody, intakeJson } from './vocabulary-intake.ts';
import { VOCABULARY_INTAKE_SURFACE } from './vocabulary-intake-pending.ts';
import { resolveVocabularyLearnerSenseScope } from './vocabulary-learner-senses.ts';
import { getSharedIntroductionLexicalWord } from './word-introductions.ts';
import { requestWordReserveReconciliation } from './word-reserve.ts';
import type { VocabularySense } from '../../src/domain/vocabulary-content.ts';

export type VocabularyIntakeMatchWork = {
  cardId: string;
  learnerId: string;
  token: string;
  word: { wordId: string; hanzi: string; pinyin: string };
  context: string;
  senses: VocabularySense[];
  catalogVersion: number;
  selectionVersion: number;
};

function finishWithoutMatch(card: NonNullable<ReturnType<typeof getChatCard>>, attention?: string): void {
  updateChatCard(card.id, card.version, intakeJson(completeIntakeContextMatch(card, null, attention)));
  requestWordReserveReconciliation();
}

/** A lease protects active matches across dispatchers. Expired leases resolve to an attention state. */
export function claimVocabularyIntakeMatch(now: string): VocabularyIntakeMatchWork | null {
  return withChatTransaction(() => {
    const row = getDb().prepare(`SELECT c.learner_id AS learnerId,c.id AS cardId
      FROM learner_chat_cards c JOIN learner_chat_conversations v ON v.learner_id=c.learner_id AND v.id=c.conversation_id
      LEFT JOIN learner_words w ON w.learner_id=c.learner_id AND w.word_id=json_extract(c.body_json,'$.wordId')
      LEFT JOIN vocabulary_sense_readiness sr ON sr.word_id=w.word_id
      LEFT JOIN vocabulary_word_sense_coverage sc ON sc.word_id=w.word_id
      LEFT JOIN vocabulary_default_selection_readiness dr ON dr.word_id=w.word_id
      LEFT JOIN vocabulary_word_catalogs cat ON cat.word_id=w.word_id
      WHERE v.surface=? AND json_type(c.body_json,'$.pending')='object'
        AND (w.word_id IS NULL OR w.in_stash=0 OR w.dismissed_at IS NOT NULL
          OR w.state_version<>json_extract(c.body_json,'$.pending.expectedLearnerVersion')
          OR json_extract(c.body_json,'$.pending.lease.expiresAt')<=?
          OR (json_extract(c.body_json,'$.pending.lease') IS NULL AND
            (sr.status='failed' OR dr.status='failed' OR
              (sc.default_useful_sense_ids_json IS NOT NULL AND cat.senses_established_at IS NOT NULL))))
      ORDER BY c.created_at,c.id LIMIT 1`).get(VOCABULARY_INTAKE_SURFACE, now) as { learnerId: string; cardId: string } | undefined;
    if (!row) return null;
    return runWithLearnerId(row.learnerId, () => {
      const card = getChatCard(row.cardId)!;
      const body = intakeBody(card), pending = body.pending!;
      const scope = resolveVocabularyLearnerSenseScope(body.wordId);
      if (scope.stateVersion !== pending.expectedLearnerVersion || pending.lease ||
        !scope.inventoryEstablished || !scope.selectionEstablished || !scope.senses.length || !body.context) {
        finishWithoutMatch(card, 'The context match could not finish. The word is saved and will follow shared defaults when available.');
        return null;
      }
      const token = randomUUID();
      const expiresAt = new Date(Date.parse(now) + 120_000).toISOString();
      updateChatCard(card.id, card.version, intakeJson({ ...body, pending: { ...pending, lease: { token, expiresAt } } }));
      const lexical = getSharedIntroductionLexicalWord(body.wordId)!;
      return { ...row, token, word: { wordId: lexical.wordId, hanzi: lexical.hanzi, pinyin: lexical.pinyin },
        context: body.context, senses: scope.senses, catalogVersion: scope.catalogVersion, selectionVersion: scope.selectionVersion };
    });
  });
}
export function finishVocabularyIntakeMatch(work: VocabularyIntakeMatchWork, targetSenseId: string | null, now: string): void {
  runWithLearnerId(work.learnerId, () => withChatTransaction(() => {
    const card = getChatCard(work.cardId);
    if (!card || intakeBody(card).pending?.lease?.token !== work.token) return;
    const lease = intakeBody(card).pending!.lease!;
    const scope = resolveVocabularyLearnerSenseScope(work.word.wordId);
    if (lease.expiresAt <= now || scope.catalogVersion !== work.catalogVersion || scope.selectionVersion !== work.selectionVersion) {
      finishWithoutMatch(card);
      return;
    }
    updateChatCard(card.id, card.version, intakeJson(completeIntakeContextMatch(card, targetSenseId)));
    requestWordReserveReconciliation();
  }));
}
