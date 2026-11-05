import type { VocabularyCaseQueueItem } from '../../src/domain/vocabulary-case-queue';
export function caseReviewFixture(index = 1): VocabularyCaseQueueItem {
  const caseId = `case-${String(index).padStart(3, '0')}`, proposalId = `proposal-${index}`;
  return {
    caseId, version: 1, state: 'open', createdAt: `2026-11-01T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`, resolvedAt: null,
    kind: 'exercise_improvement', learnerId: 'fixture-learner', wordId: 'word', wordLabel: index % 3 === 0 ? '密集' : '报备', contentId: 'source',
    approvalState: null, approvalRequestId: null, currentProposalId: proposalId, currentAssessment: { jobId: `job-${index}-1`, sequence: 1 },
    frozen: false, activeJob: null, latestJob: { jobId: `job-${index}-1`, sequence: 1, status: 'succeeded', error: null, advisory: false },
    assessment: { jobId: `job-${index}-1`, sequence: 1, origin: 'automatic', models: [{ invocationId: 'invocation', stage: 'single_improvement', provider: 'openai', model: 'gpt-6-sol', resolvedModel: null }], outcome: 'single_sense', scopeLabel: 'Advance reporting', diagnosis: 'The learner’s answer is natural. Clarify the intended advance-reporting meaning without treating a reasonable answer as a learner mistake.' },
    served: [{ encounterId: `encounter-${index}`, presentedAt: '2026-10-31T23:00:00.000Z', contentId: 'source', contentVersion: 1, kind: 'production', role: 'general', prompt: 'Before taking leave, you should ____ your supervisor.', choices: [], acceptedAnswers: ['报备'], responses: [{ actionId: 'response', text: '报告', outcome: 'rejected', undone: false }], reactions: [{ actionId: 'reaction', feedback: 'unfair', comment: '报告 seems natural here.', undone: false }], skipped: false, presentationUndone: false }],
    proposal: { proposalId, version: 1, status: 'awaiting_review', authorKind: 'service', isCurrent: true, rationale: `Proposal ${index}: make the advance-reporting context explicit.`, operations: [{ operationKey: 'repair', strategy: 'update_existing', learningRole: 'source_repair', scopeLabel: 'Shared', groupLabel: 'Advance reporting', prompt: 'Give advance notice for the official record: 出差前，请先向主管____。', acceptedAnswers: ['报备'], rationale: 'The official-record context distinguishes 报备 from a general report.', sourceContentId: 'source', expectedVersion: 1, otherChanges: [] }] },
    alternatives: [], alternativeCount: 0, sources: [{ contentId: 'source', version: 1, expectedVersion: 1, prompt: 'Before taking leave, you should ____ your supervisor.', acceptedAnswers: ['报备'], availability: 'active' }], advisoryOpinion: null, stale: false, requiresDetails: false, needsDecision: false, finding: null,
    reassessment: { eligible: true, reason: null, source: { contentId: 'source', assessedVersion: 1, currentVersion: 1 } },
  };
}
