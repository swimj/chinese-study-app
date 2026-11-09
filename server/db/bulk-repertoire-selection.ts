import type { DatabaseSync } from 'node:sqlite';

export type BulkRepertoireWord = {
  wordId: string;
  selectedForLearnerId: string;
  beneficiaryLearnerIds: string[];
  dueAt: string | null;
};
type Candidate = { learnerId: string; wordId: string; dueAt: string | null; mode: string };
const tracked = `w.dismissed_at IS NULL AND (w.mode != 'unstudied' OR w.in_stash = 1) AND l.disabled_at IS NULL`;

// Proposed output is not yet in content_items. Include its targets, source/bases,
// and case identity, including case-less and non-current outstanding proposals.
const blockerSql = `WITH outstanding AS (
  SELECT * FROM content_proposals WHERE status IN ('draft','awaiting_review','approved')
), proposal_words AS (
  SELECT c.word_id FROM outstanding p JOIN reflection_cases c USING(case_id)
  UNION SELECT cw.word_id FROM outstanding p JOIN reflection_cases c USING(case_id)
    JOIN content_words cw ON cw.content_id=c.content_id AND cw.relation='target'
  UNION SELECT cw.word_id FROM outstanding p JOIN proposal_content_bases b USING(proposal_id)
    JOIN content_words cw ON cw.content_id=b.content_id AND cw.relation='target'
  UNION SELECT json_extract(w.value,'$.wordId') FROM outstanding p,json_each(p.operations_json) op,
    json_each(op.value,'$.content.words') w WHERE json_extract(w.value,'$.relation')='target'
  UNION SELECT cw.word_id FROM outstanding p,json_each(p.operations_json) op
    JOIN content_words cw ON cw.content_id=json_extract(op.value,'$.sourceContentId') AND cw.relation='target'
), active_job_words AS (
  SELECT c.word_id FROM vocabulary_reflection_jobs j JOIN reflection_cases c USING(case_id) WHERE j.status IN ('queued','running')
  UNION SELECT cw.word_id FROM vocabulary_reflection_jobs j JOIN reflection_cases c USING(case_id)
    JOIN content_words cw ON cw.content_id=c.content_id AND cw.relation='target' WHERE j.status IN ('queued','running')
), blockers AS (
  SELECT a.word_id,'authored_repertoire' AS reason FROM content_items c
    JOIN exercise_answer_words a ON a.exercise_id=c.content_id
    WHERE c.kind='exercise' AND c.exercise_role='general' AND c.skill='production'
      AND c.exercise_type!='contrast' AND COALESCE(json_extract(c.assessment_json,'$.responseMode'),'')!='word_choice'
      AND COALESCE(json_extract(c.body_json,'$.source.kind'),'')!='dictionary_baseline'
      AND NOT (COALESCE(json_extract(c.body_json,'$.source.kind'),'')='production_cue_supplement'
        AND json_extract(c.body_json,'$.source.cueId') IS NULL)
  UNION SELECT word_id,'outstanding_proposal' FROM proposal_words WHERE word_id IS NOT NULL
  UNION SELECT word_id,'active_reflection_job' FROM active_job_words WHERE word_id IS NOT NULL
  UNION SELECT word_id,'pending_reconciliation' FROM sense_content_reconciliations r
    WHERE status IN ('draft','resolved') OR (status='applied' AND completed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM sense_content_reconciliations newer WHERE newer.word_id=r.word_id AND newer.status='applied' AND newer.rowid>r.rowid))
  UNION SELECT word_id,'active_preparation' FROM vocabulary_sense_readiness WHERE status='running'
  UNION SELECT word_id,'active_preparation' FROM vocabulary_default_selection_readiness WHERE status='running'
  UNION SELECT word_id,'active_preparation' FROM vocabulary_practice_preparation WHERE status='running'
) SELECT word_id AS wordId,reason FROM blockers`;

/** Conservative batch eligibility: private or retired authored repertoire still counts. */
export function bulkRepertoireBlockers(db: DatabaseSync, wordId: string): string[] {
  if (!wordId.trim()) throw new Error('Bulk repertoire word ID is required');
  const reasons = (db.prepare(`${blockerSql} WHERE word_id=? ORDER BY reason`).all(wordId) as {reason:string}[]).map(row=>row.reason);
  const member=db.prepare(`SELECT 1 FROM learner_words w JOIN learners l USING(learner_id) WHERE w.word_id=? AND ${tracked} LIMIT 1`).get(wordId);
  if (!member) reasons.push('not_tracked');
  return reasons;
}

/** Round-robin unique words; exhausted learners redistribute their remaining turns. */
export function selectBulkRepertoireWords(db: DatabaseSync, limit: number, now: string): {
  words: BulkRepertoireWord[];
  trackedWordCount: number;
  eligibleWordCount: number;
  excludedWordCounts: Record<string, number>;
  learnerAllocations: Array<{learnerId:string;eligibleWordCount:number;selectedWordCount:number}>;
} {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Bulk repertoire limit must be a positive integer');
  if (!Number.isFinite(Date.parse(now))) throw new Error('Bulk repertoire selection requires a valid timestamp');
  const rows=db.prepare(`SELECT w.learner_id AS learnerId,w.word_id AS wordId,w.mode,s.next_eligible_at AS dueAt
    FROM learner_words w JOIN learners l USING(learner_id)
    LEFT JOIN learner_word_schedules s USING(learner_id,word_id) WHERE ${tracked}
    ORDER BY w.learner_id,w.word_id`).all() as Candidate[];
  const blockers=new Map<string,Set<string>>();
  for (const row of db.prepare(blockerSql).all() as {wordId:string;reason:string}[]) {
    const reasons=blockers.get(row.wordId)??new Set<string>(); reasons.add(row.reason); blockers.set(row.wordId,reasons);
  }
  const trackedIds=new Set(rows.map(row=>row.wordId));
  const excludedWordCounts:Record<string,number>={};
  for (const id of trackedIds) for (const reason of blockers.get(id)??[]) excludedWordCounts[reason]=(excludedWordCounts[reason]??0)+1;
  const eligible=rows.filter(row=>!blockers.has(row.wordId));
  for (const row of eligible) if (row.dueAt!==null&&!Number.isFinite(Date.parse(row.dueAt))) throw new Error('Invalid stored vocabulary due timestamp');
  const beneficiaries=new Map<string,string[]>(),queues=new Map<string,Candidate[]>();
  for (const row of eligible) {
    const peers=beneficiaries.get(row.wordId)??[]; peers.push(row.learnerId); beneficiaries.set(row.wordId,peers);
    const queue=queues.get(row.learnerId)??[]; queue.push(row); queues.set(row.learnerId,queue);
  }
  const effectiveDue=(row:Candidate)=>row.dueAt===null ? row.mode==='unstudied'?Infinity:Date.parse(now) : Date.parse(row.dueAt);
  for (const queue of queues.values()) queue.sort((a,b)=>{
    const aDue=effectiveDue(a),bDue=effectiveDue(b);
    if (Number.isNaN(aDue)||Number.isNaN(bDue)) throw new Error('Invalid stored vocabulary due timestamp');
    return (aDue<bDue?-1:aDue>bDue?1:0)||a.wordId.localeCompare(b.wordId);
  });
  const learnerAllocations=[...queues].map(([learnerId,queue])=>({learnerId,eligibleWordCount:queue.length,selectedWordCount:0}));
  const offsets=new Map<string,number>(),seen=new Set<string>(),words:BulkRepertoireWord[]=[];
  while (words.length<limit) {
    let changed=false;
    for (const allocation of learnerAllocations) {
      const queue=queues.get(allocation.learnerId)!; let offset=offsets.get(allocation.learnerId)??0;
      while(offset<queue.length&&seen.has(queue[offset]!.wordId)) offset++;
      const row=queue[offset]; offsets.set(allocation.learnerId,offset+1);
      if(!row) continue;
      seen.add(row.wordId); allocation.selectedWordCount++; changed=true;
      words.push({wordId:row.wordId,selectedForLearnerId:row.learnerId,beneficiaryLearnerIds:beneficiaries.get(row.wordId)!,dueAt:row.dueAt});
      if(words.length===limit) break;
    }
    if(!changed) break;
  }
  return {words,trackedWordCount:trackedIds.size,eligibleWordCount:beneficiaries.size,excludedWordCounts,learnerAllocations};
}
