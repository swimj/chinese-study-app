import type { VocabularyApprovalRequest, VocabularyContentProposal } from '../../domain/vocabulary-reflection';

/** A refresh must not overwrite a newer acknowledgement or worker completion. */
export function mergeApprovalRequests(current: VocabularyApprovalRequest[], incoming: VocabularyApprovalRequest[]): VocabularyApprovalRequest[] {
  const requests = new Map(current.map(item => [item.requestId, item]));
  for (const item of incoming) {
    const previous = requests.get(item.requestId);
    if (!previous || item.updatedAt >= previous.updatedAt) requests.set(item.requestId, item);
  }
  return [...requests.values()];
}

/** An acknowledged exact revision leaves review, including when it needs attention. */
export function proposalHasApprovalRequest(proposal: Pick<VocabularyContentProposal, 'proposalId' | 'version'>, requests: VocabularyApprovalRequest[]): boolean {
  return requests.some(item => item.proposalId === proposal.proposalId && item.expectedVersion === proposal.version);
}

/** Editing a new revision or resolving the proposal supersedes its failed approval. */
export function approvalNeedsAttention(request: VocabularyApprovalRequest, proposals: Pick<VocabularyContentProposal, 'proposalId' | 'version' | 'status'>[]): boolean {
  if (request.status !== 'attention') return false;
  const proposal = proposals.find(item => item.proposalId === request.proposalId);
  return !proposal || (proposal.version <= request.expectedVersion && !['applied', 'closed'].includes(proposal.status));
}
