import type { VocabularyContentProposal, VocabularyImprovementResultInput, VocabularyProposalOperation } from '../../src/domain/vocabulary-reflection.ts';
import { getDb } from './connection.ts';
import { getVocabularyProposal, saveVocabularyProposal, vocabularyProposalCoverageChanged } from './vocabulary-reflection.ts';
import { VocabularyReflectionConflict } from './vocabulary-case-reviews.ts';
import { resolveVocabularySenseCoverage, setVocabularyDefaultUsefulSenses } from './vocabulary-sense-coverage.ts';

/** Keep authored items for a narrower selection, preserving an intended source replacement. */
export function restrictRepertoireOperations(operations:VocabularyProposalOperation[],wordId:string,selected:readonly string[]):VocabularyProposalOperation[] {
  const kept=operations.filter(operation=>{
    if(operation.strategy==='retire')return false;
    const targets=operation.content.words.filter(word=>word.wordId===wordId&&word.relation==='target');
    if(!targets.length||targets.some(word=>!word.senseId))throw new VocabularyReflectionConflict('Repertoire items require explicit target senses before narrowing');
    return targets.every(word=>selected.includes(word.senseId!));
  }).map(operation=>structuredClone(operation));
  if(!kept.length)throw new VocabularyReflectionConflict('No proposed exercises remain. Dismiss the proposal or generate a new repertoire.');
  for(const removed of operations.filter(operation=>operation.strategy==='replace'&&!kept.some(item=>item.operationKey===operation.operationKey))){
    if(removed.strategy!=='replace')continue;
    if(kept.some(item=>item.strategy!=='create'&&item.sourceContentId===removed.sourceContentId))continue;
    const index=kept.findIndex(item=>item.strategy==='create'&&JSON.stringify(item.scope)===JSON.stringify(removed.scope));
    if(index<0)throw new VocabularyReflectionConflict('Narrowing cannot preserve the reviewed source replacement; revise the proposal explicitly.');
    kept[index]={...kept[index]!,strategy:'replace',sourceContentId:removed.sourceContentId,expectedVersion:removed.expectedVersion};
  }
  return kept;
}

type RepertoireRevision = {proposal: VocabularyContentProposal; selectionOnly: boolean};
function samePlacement(a:VocabularyProposalOperation,b:VocabularyProposalOperation):boolean {
  return a.strategy===b.strategy&&(a.strategy==='create'||b.strategy==='create'||(a.sourceContentId===b.sourceContentId&&a.expectedVersion===b.expectedVersion));
}
/** Selection revisions hide operations; manual edits still replace or remove authored items. */
export function retainedRepertoireOperations(revisions:readonly RepertoireRevision[]):VocabularyProposalOperation[] {
  const pool=new Map<string,VocabularyProposalOperation>();
  let previous:VocabularyContentProposal|null=null;
  for(const {proposal,selectionOnly} of revisions){
    if(!selectionOnly){
      const currentKeys=new Set(proposal.operations.map(operation=>operation.operationKey));
      for(const operation of previous?.operations??[])if(!currentKeys.has(operation.operationKey))pool.delete(operation.operationKey);
      for(const operation of proposal.operations){
        const retained=pool.get(operation.operationKey),prior=previous?.operations.find(item=>item.operationKey===operation.operationKey);
        // A selection may move source replacement to a surviving exercise. Keep
        // that projection out of the retained pool unless the operator changed it.
        if(retained&&prior&&samePlacement(operation,prior)){
          const {strategy:_strategy,...content}=operation;
          const {sourceContentId:_source,expectedVersion:_version,...withoutSource}=content as typeof content&{sourceContentId?:string;expectedVersion?:number};
          pool.set(operation.operationKey,retained.strategy==='create'?{...withoutSource,strategy:'create'}:
            {...withoutSource,strategy:retained.strategy,sourceContentId:retained.sourceContentId,expectedVersion:retained.expectedVersion});
        }else pool.set(operation.operationKey,structuredClone(operation));
      }
    }
    previous=proposal;
  }
  return [...pool.values()];
}
function retainedOperations(proposal:VocabularyContentProposal):VocabularyProposalOperation[] {
  const rows=getDb().prepare(`SELECT h.snapshot_json, r.proposal_version AS selected_version
    FROM proposal_revision_history h LEFT JOIN vocabulary_repertoire_revisions r
      ON r.proposal_id=h.proposal_id AND r.proposal_version=h.version
    WHERE h.proposal_id=? AND h.version<=? ORDER BY h.version`).all(proposal.proposalId,proposal.version) as {snapshot_json:string;selected_version:number|null}[];
  if(!rows.length)throw new Error('Proposal revision history is missing');
  return retainedRepertoireOperations(rows.map(row=>({proposal:JSON.parse(row.snapshot_json) as VocabularyContentProposal,selectionOnly:row.selected_version!==null})));
}

/** Save the shared policy and its proposal selection as one optimistic transaction. */
export function saveRepertoireWordDefaults(proposalId:string,expectedVersion:number,expectedWordVersion:number,includedSenseIds:string[],actorId:string) {
  const db=getDb();db.exec('SAVEPOINT repertoire_defaults');
  try {
    const proposal=getVocabularyProposal(proposalId,actorId);
    if(proposal.version!==expectedVersion)throw new VocabularyReflectionConflict('Proposal version changed; reload before saving');
    const row=db.prepare(`SELECT j.result_json FROM content_proposals p JOIN vocabulary_reflection_jobs j ON j.job_id=p.assessment_job_id WHERE p.proposal_id=?`).get(proposalId) as {result_json:string|null}|undefined;
    const admission=row?.result_json?(JSON.parse(row.result_json) as {input:VocabularyImprovementResultInput}).input.admission:undefined;
    if(admission?.outcome!=='repertoire_bootstrap')throw new VocabularyReflectionConflict('Only an assessed repertoire can update word defaults and its proposal together');
    const coverage=setVocabularyDefaultUsefulSenses(admission.wordId,expectedWordVersion,includedSenseIds,actorId);
    const revised=reviseRepertoireToWordDefaults(proposalId,expectedVersion,actorId);
    db.exec('RELEASE repertoire_defaults');return {proposal:revised,coverage};
  }catch(error){db.exec('ROLLBACK TO repertoire_defaults; RELEASE repertoire_defaults');throw error;}
}

/** Explicit editorial revision; no model call, source mutation, or automatic application. */
export function reviseRepertoireToWordDefaults(proposalId:string,expectedVersion:number,actorId:string):VocabularyContentProposal {
  const db=getDb();db.exec('SAVEPOINT repertoire_revision');
  try {
    const proposal=getVocabularyProposal(proposalId,actorId);
    if(proposal.version!==expectedVersion)throw new VocabularyReflectionConflict('Proposal version changed; reload before revising');
    const row=db.prepare(`SELECT j.result_json FROM content_proposals p JOIN vocabulary_reflection_jobs j ON j.job_id=p.assessment_job_id WHERE p.proposal_id=?`).get(proposalId) as {result_json:string|null}|undefined;
    const admission=row?.result_json?(JSON.parse(row.result_json) as {input:VocabularyImprovementResultInput}).input.admission:undefined;
    if(admission?.outcome!=='repertoire_bootstrap'||!admission.generationScope?.selectionEstablished)throw new VocabularyReflectionConflict('Only an assessed repertoire can be narrowed to word defaults');
    if(vocabularyProposalCoverageChanged(proposal))throw new VocabularyReflectionConflict('Source or inventory changed; reassess before revising the repertoire');
    const selection=resolveVocabularySenseCoverage(admission.wordId);
    if(!selection.selectionEstablished)throw new VocabularyReflectionConflict('Select word defaults before revising the repertoire');
    const narrowed=db.prepare('SELECT sense_ids_json FROM vocabulary_repertoire_revisions WHERE proposal_id=? AND proposal_version<=? ORDER BY proposal_version DESC LIMIT 1').get(proposalId,expectedVersion) as {sense_ids_json:string}|undefined;
    const previousScope=narrowed?JSON.parse(narrowed.sense_ids_json) as string[]:admission.generationScope.senseIds;
    const pool=retainedOperations(proposal);
    const generated=new Set(pool.flatMap(operation=>operation.content.words.filter(word=>word.wordId===admission.wordId&&word.relation==='target').map(word=>word.senseId)));
    if(selection.includedSenseIds.some(id=>!previousScope.includes(id)&&!generated.has(id)))throw new VocabularyReflectionConflict('Selected senses have no retained exercises; reassess to generate the expanded repertoire');
    const operations=restrictRepertoireOperations(pool,admission.wordId,selection.includedSenseIds);
    const result=saveVocabularyProposal(proposalId,expectedVersion,{caseId:proposal.caseId??undefined,operations,bases:proposal.bases,
      rationale:proposal.rationale},actorId);
    db.prepare('INSERT INTO vocabulary_repertoire_revisions(proposal_id,proposal_version,sense_ids_json) VALUES (?,?,?)').run(proposalId,result.version,JSON.stringify(selection.includedSenseIds));
    db.exec('RELEASE repertoire_revision');return result;
  }catch(error){db.exec('ROLLBACK TO repertoire_revision; RELEASE repertoire_revision');throw error;}
}
