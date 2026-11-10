/** A proposal-specific opinion is actionable only for the exact unresolved revision it reviewed. */
export function actionableVocabularyFailureSql(job:string):string {
  return `(${job}.status='failed' AND NOT EXISTS (SELECT 1 FROM backend_events abandoned WHERE abandoned.job_id=${job}.job_id AND abandoned.name='vocabulary.reflection.reassessment_abandoned') AND (${job}.second_opinion_json IS NULL OR json_extract(${job}.second_opinion_json,'$.proposal.proposalId') IS NULL OR EXISTS (
    SELECT 1 FROM content_proposals opinion WHERE opinion.proposal_id=json_extract(${job}.second_opinion_json,'$.proposal.proposalId')
      AND opinion.version=json_extract(${job}.second_opinion_json,'$.proposal.version') AND opinion.status NOT IN ('closed','applied'))))`;
}
