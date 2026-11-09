import { createHash } from 'node:crypto';
import { clozePromptParts, directCueContainsAcceptedForm } from '../../src/domain/cloze-prompt.ts';
import type { VocabularyContent, VocabularyJson } from '../../src/domain/vocabulary-content.ts';
import type { VocabularyProposalDraft, VocabularyProposalOperation } from '../../src/domain/vocabulary-reflection.ts';
import { config, getDb } from './connection.ts';
import { readHostedServiceControl } from './hosted-operations.ts';
import { getVocabularyContentForMaintenance, getVocabularySenseCatalog, getVocabularySenses } from './vocabulary-content.ts';
import { applyVocabularyProposal, approveVocabularyProposal, createVocabularyProposal } from './vocabulary-reflection.ts';
import { resolveVocabularySenseCoverage } from './vocabulary-sense-coverage.ts';
import { isVocabularySessionWordEligible } from './vocabulary-sense-eligibility.ts';
import { isOperatorSubject, parseOperatorAllowlist } from '../operator-access.ts';

type Exercise = Extract<VocabularyContent, { kind: 'exercise' }>;
type Version = { contentId: string; expectedVersion: number };
type RecordValue = Record<string, unknown>;

function fields(value: unknown, label: string, allowed?: string[]): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected ${label} object`);
  const result = value as RecordValue;
  if (allowed && Object.keys(result).some(key => !allowed.includes(key))) {
    throw new Error(`Unexpected field in ${label}`);
  }
  return result;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`Expected nonempty trimmed ${label}`);
  return value;
}

function version(value: RecordValue): Version {
  const expectedVersion = value.expectedVersion;
  if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error('Expected positive content version');
  }
  return { contentId: text(value.contentId, 'content ID'), expectedVersion };
}

function activeSharedExercise(base: Version): Exercise {
  const content = getVocabularyContentForMaintenance(base.contentId);
  if (content?.version !== base.expectedVersion) throw new Error(`Stale content base ${base.contentId}`);
  if (content.kind !== 'exercise' || content.exerciseRole !== 'general' || content.skill !== 'production'
    || content.accessScope !== 'shared' || content.availability !== 'active') {
    throw new Error(`Expected active shared general production exercise ${base.contentId}`);
  }
  return content;
}

function checkedPrompt(value: unknown, answers: Exercise['answers']): string {
  const prompt = text(value, 'stimulus');
  if (directCueContainsAcceptedForm(prompt, answers.flatMap(answer => answer.acceptedForms))) {
    throw new Error('Stimulus exposes an accepted answer');
  }
  return prompt;
}

function editableBody(source: Exercise, edit: RecordValue): VocabularyJson {
  const body = fields(source.body, 'source body') as Record<string, VocabularyJson>;
  const reveal = fields(body.reveal, 'source reveal') as Record<string, VocabularyJson>;
  const change: Record<string, VocabularyJson> = {};
  if (edit.axis !== undefined) change.axisNote = text(edit.axis, 'axis');
  if (edit.teachingNote !== undefined) change.teachingNote = text(edit.teachingNote, 'teaching note');
  const prompt = edit.stimulus === undefined ? undefined : checkedPrompt(edit.stimulus, source.answers);
  if ((prompt === undefined || body.prompt === prompt) && Object.entries(change).every(([key, value]) => reveal[key] === value)) {
    throw new Error('Pure cue edit must change the content');
  }
  if (prompt !== undefined && fields(body.stimulus, 'source stimulus').kind !== 'direct_text') {
    throw new Error('Stimulus editing requires a direct-text source');
  }
  return { ...body, ...(prompt === undefined ? {} : { prompt, stimulus: { kind: 'direct_text', text: prompt } }),
    reveal: { ...reveal, ...change } };
}

function buildPlan(input: unknown, actorId: string) {
  if (!isOperatorSubject(actorId, parseOperatorAllowlist(), config.authMode)) throw new Error('Operator access required');
  const manifest = fields(input, 'manifest', ['rationale', 'changes']);
  const rationale = text(manifest.rationale, 'batch rationale');
  if (!Array.isArray(manifest.changes) || !manifest.changes.length) throw new Error('Expected a nonempty changes array');
  const operations: VocabularyProposalOperation[] = [];
  const targets: unknown[] = [];
  const seenSources = new Set<string>();
  const scope = { kind: 'shared' } as const;
  type Overlap = { proposalId: string; proposalVersion: number; expectedVersion: number; status: string; applying: number };
  const overlaps: (Overlap & { contentId: string })[] = [];
  const pending = getDb().prepare(`SELECT p.proposal_id AS proposalId, p.version AS proposalVersion,
      b.expected_content_version AS expectedVersion, p.status,
      EXISTS(SELECT 1 FROM vocabulary_case_reviews r WHERE r.current_proposal_id=p.proposal_id AND r.approval_state='pending') AS applying
    FROM proposal_content_bases b JOIN content_proposals p USING(proposal_id)
    WHERE b.content_id = ? AND p.status IN ('draft', 'awaiting_review', 'approved')
    ORDER BY p.proposal_id`);

  for (const raw of manifest.changes) {
    const row = fields(raw, 'cue change', ['contentId', 'expectedVersion', 'rationale', 'edit', 'split']);
    const base = version(row);
    const source = activeSharedExercise(base);
    if (source.exerciseType !== 'pure_cue' || seenSources.has(base.contentId)) throw new Error('Expected a distinct pure cue');
    seenSources.add(base.contentId);
    for (const overlap of pending.all(base.contentId) as Overlap[]) {
      if (overlap.status === 'approved' || overlap.applying) throw new Error(`Approval already recorded for ${base.contentId}`);
      overlaps.push({ contentId: base.contentId, ...overlap });
    }
    const reason = text(row.rationale, 'cue rationale');
    const common = { sourceContentId: base.contentId, expectedVersion: base.expectedVersion, scope, rationale: reason, operationKey: base.contentId };
    if ((row.edit === undefined) === (row.split === undefined)) throw new Error('Expected either edit or split');
    if (row.edit !== undefined) {
      operations.push({ ...common, strategy: 'update_existing', content: { ...source,
        body: editableBody(source, fields(row.edit, 'edit', ['axis', 'stimulus', 'teachingNote'])) } });
      continue;
    }
    if (!Array.isArray(row.split) || source.answers.length < 2 || row.split.length !== source.answers.length) {
      throw new Error('Split must cover every accepted member');
    }
    operations.push({ ...common, strategy: 'retire', content: source });
    const members = new Map(source.answers.map(answer => [answer.wordId, answer]));
    for (const rawTarget of row.split) {
      const target = fields(rawTarget, 'split target', ['wordId', 'stimulus', 'teachingNote', 'senseId']);
      const wordId = text(target.wordId, 'member word ID');
      const answer = members.get(wordId);
      if (!answer || !isVocabularySessionWordEligible(wordId)) {
        throw new Error(`Expected an eligible, distinct source member: ${wordId}`);
      }
      members.delete(wordId);
      const catalog = getVocabularySenseCatalog(wordId);
      const coverage = resolveVocabularySenseCoverage(wordId);
      const senseId = target.senseId === undefined ? null : text(target.senseId, 'sense ID');
      if (senseId === null && catalog.establishedAt !== null) {
        throw new Error(`New targeted exercise needs a sense for established inventory: ${wordId}`);
      }
      if (senseId !== null && (!getVocabularySenses(wordId).some(sense => sense.senseId === senseId && sense.status === 'active')
        || (coverage.selectionEstablished ? !coverage.includedSenseIds.includes(senseId) : coverage.word.excludedSenseIds.includes(senseId)))) {
        throw new Error(`New targeted exercise needs an eligible sense: ${wordId}`);
      }
      const prompt = checkedPrompt(target.stimulus, [answer]);
      const teachingNote = text(target.teachingNote, 'target teaching note');
      targets.push({ source: base.contentId, wordId, coverage: coverage.fingerprint, catalog });
      operations.push({ strategy: 'create', scope, operationKey: `${base.contentId}/${wordId}`, rationale: reason,
        content: { kind: 'exercise', payloadVersion: 1, accessScope: 'shared', availability: 'active',
          originKind: 'human', authorKind: 'operator', authorId: actorId, exerciseType: clozePromptParts(prompt).length > 1 ? 'cloze' : 'definition_gloss',
          skill: 'production', exerciseRole: 'general',
          body: { prompt, instruction: '', stimulus: { kind: 'direct_text', text: prompt },
            reveal: { teachingNote }, source: { kind: 'operator_pure_cue_split', contentId: source.contentId, version: source.version } },
          assessment: { responseMode: 'hanzi_entry', matchingProfile: 'mandarin' },
          words: [{ wordId, relation: 'target', senseId }], answers: [answer] } });
    }
  }
  const proposal: VocabularyProposalDraft = { rationale, operations };
  const digest = createHash('sha256').update(JSON.stringify({ actorId, proposal, targets, overlaps })).digest('hex');
  return { digest, proposal, targets, overlaps };
}

export function maintainPureCues(input: unknown, actorId: string, confirmPlan?: string) {
  const db = getDb();
  db.exec(confirmPlan === undefined ? 'BEGIN' : 'BEGIN IMMEDIATE');
  try {
    if (confirmPlan !== undefined) {
      if (!readHostedServiceControl('maintenance_mode').enabled || readHostedServiceControl('provider_work_enabled').enabled) {
        throw new Error('Apply requires maintenance mode and disabled provider work');
      }
      const previous = db.prepare('SELECT application_id FROM proposal_applications WHERE idempotency_key=?')
        .get(`pure-cue-maintenance/${confirmPlan}`) as { application_id: string } | undefined;
      if (previous) throw new Error(`Maintenance plan already applied as ${previous.application_id}`);
    }
    const plan = buildPlan(input, actorId);
    if (confirmPlan === undefined) {
      db.exec('COMMIT');
      return { status: 'preview' as const, ...plan };
    }
    if (plan.digest !== confirmPlan) throw new Error('Maintenance plan changed; preview again');
    const at = new Date().toISOString();
    for (const operation of plan.proposal.operations) {
      if (operation.strategy === 'create') {
        for (const word of operation.content.words) {
          if (word.senseId != null) word.senseMappingEstablishedAt = at;
        }
      }
    }
    const proposal = createVocabularyProposal(plan.proposal, actorId);
    const reviewId = approveVocabularyProposal(proposal.proposalId, proposal.version, actorId, { maintenancePlan: plan.digest });
    const receipt = applyVocabularyProposal(proposal.proposalId, proposal.version, reviewId, `pure-cue-maintenance/${plan.digest}`, actorId);
    db.exec('COMMIT');
    return { status: 'applied' as const, digest: plan.digest, receipt };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
