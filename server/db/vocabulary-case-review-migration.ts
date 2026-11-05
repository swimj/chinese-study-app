import type { DatabaseSync } from 'node:sqlite';

type LegacyCase = {case_id:string;kind:string;status:string;created_at:string;learner_id:string;completion_id:string};
type LegacyJob = {job_id:string;case_id:string;status:string;created_at:string;reassessment_source_job_id:string|null;second_opinion_json:string|null;result_json:string|null};
/** Internal migration inventory; includes retained private assessment documents. */
function inventoryVocabularyCaseReviewMigration(db:DatabaseSync) {
  const cases=db.prepare("SELECT case_id,kind,status,created_at,learner_id,completion_id FROM reflection_cases WHERE kind!='learner_feedback' ORDER BY created_at,case_id").all() as LegacyCase[];
  const jobs=db.prepare("SELECT job_id,case_id,status,created_at,reassessment_source_job_id,second_opinion_json,result_json FROM vocabulary_reflection_jobs WHERE kind='exercise_improvement' ORDER BY created_at,job_id").all() as LegacyJob[];
  const byCase=new Map(cases.map(c=>[c.case_id,c])),byJob=new Map(jobs.map(j=>[j.job_id,j]));
  const parent=new Map<string,string>();
  for(const j of jobs){
    const opinion=j.second_opinion_json?JSON.parse(j.second_opinion_json) as {parentCaseId?:string;proposal?:{caseId?:string}}:null;
    const source=j.reassessment_source_job_id?byJob.get(j.reassessment_source_job_id)?.case_id:opinion?.parentCaseId??opinion?.proposal?.caseId;
    if(j.reassessment_source_job_id&&!source)throw new Error(`Missing reassessment ancestor for ${j.job_id}`);
    if(source&&source!==j.case_id){
      const a=byCase.get(source),b=byCase.get(j.case_id);
      if(!a||!b||a.learner_id!==b.learner_id||a.completion_id!==b.completion_id)throw new Error(`Invalid case lineage for ${j.job_id}`);
      parent.set(j.case_id,source);
    }
  }
  const root=(id:string):string=>{const seen=new Set<string>();while(parent.has(id)){if(seen.has(id))throw new Error('Cyclic reflection case lineage');seen.add(id);id=parent.get(id)!;}return id;};
  const groups=new Map<string,{root:LegacyCase;members:LegacyCase[];jobs:LegacyJob[]}>();
  for(const c of cases){const id=root(c.case_id);if(!groups.has(id))groups.set(id,{root:byCase.get(id)!,members:[],jobs:[]});groups.get(id)!.members.push(c);}
  for(const j of jobs)groups.get(root(j.case_id))!.jobs.push(j);
  const proposals=db.prepare('SELECT proposal_id,case_id,status,created_at FROM content_proposals ORDER BY created_at,proposal_id').all() as {proposal_id:string;case_id:string|null;status:string;created_at:string}[];
  return {groups:[...groups.values()].map(g=>({...g,proposals:proposals.filter(p=>p.case_id&&root(p.case_id)===g.root.case_id)})),
    standaloneProposalCount:proposals.filter(p=>p.case_id===null).length};
}

export function backfillVocabularyCaseReviews(db:DatabaseSync):void {
  const inventory=inventoryVocabularyCaseReviewMigration(db);
  for(const g of inventory.groups){
    const active=g.jobs.filter(j=>['queued','running'].includes(j.status));
    // Offline migration never silently cancels or combines live provider work.
    if(active.length>1)throw new Error(`Case ${g.root.case_id} has ${active.length} active jobs; finish or explicitly fail them before migration`);
    // Topological ordering prevents timestamp ties from placing a reassessment before its source.
    const remaining=[...g.jobs],ordered:LegacyJob[]=[],ids=new Set(g.jobs.map(j=>j.job_id));
    const parentJob=(j:LegacyJob):string|null=>{if(j.reassessment_source_job_id)return j.reassessment_source_job_id;const opinion=j.second_opinion_json?JSON.parse(j.second_opinion_json) as {parentCaseId?:string;proposal?:{caseId?:string}}:null;const parent=opinion?.parentCaseId??opinion?.proposal?.caseId;return parent?g.jobs.find(candidate=>candidate.case_id===parent&&!candidate.second_opinion_json)?.job_id??null:null;};
    while(remaining.length){const i=remaining.findIndex(j=>!parentJob(j)||!ids.has(parentJob(j)!)||ordered.some(s=>s.job_id===parentJob(j)));if(i<0)throw new Error('Cyclic reflection job lineage');ordered.push(remaining.splice(i,1)[0]!);}
    const pending=g.proposals.filter(p=>!['applied','closed'].includes(p.status));
    const completed=ordered.filter(j=>j.status==='succeeded'&&!j.second_opinion_json);
    const current=completed.at(-1)??null;
    const output=current?.result_json?(JSON.parse(current.result_json) as {output?:{proposalId?:string|null}}).output:null;
    const selected=pending.find(p=>p.proposal_id===output?.proposalId)??pending.at(-1)??g.proposals.find(p=>p.proposal_id===output?.proposalId)??(!current?g.proposals.at(-1):null)??null;
    const latestCase=current?g.members.find(c=>c.case_id===current.case_id)!:g.members.at(-1)!;
    const resolved=pending.length===0&&active.length===0&&(latestCase.status==='closed'||(output?.proposalId!=null&&g.proposals.some(p=>p.proposal_id===output.proposalId&&['applied','closed'].includes(p.status))));
    const closure=resolved?db.prepare(`SELECT max(occurred_at) AS at FROM backend_events WHERE entity_kind='reflection' AND entity_id IN (${[...g.members,...g.proposals].map(()=>'?').join(',')}) AND name IN ('vocabulary.reflection.admission_case_closed','vocabulary.reflection.teaching_case_closed','vocabulary.reflection.proposal_closed','vocabulary.reflection.proposal_applied')`).get(...g.members.map(c=>c.case_id),...g.proposals.map(p=>p.proposal_id)) as {at:string|null}:null;
    db.prepare('INSERT INTO vocabulary_case_reviews(case_id,state,current_job_id,current_proposal_id,created_at,resolved_at) VALUES (?,?,?,?,?,?)').run(g.root.case_id,resolved?'resolved':'open',current?.job_id??null,selected?.proposal_id??null,g.root.created_at,closure?.at??null);
    for(const c of g.members)db.prepare('INSERT INTO vocabulary_case_lineage VALUES (?,?)').run(c.case_id,g.root.case_id);
    for(const [i,j] of ordered.entries())db.prepare('UPDATE vocabulary_reflection_jobs SET review_case_id=?,case_sequence=? WHERE job_id=?').run(g.root.case_id,i+1,j.job_id);
    // The latest assessment's explicit scope becomes the editable case scope. Historical scope rows remain.
    if(current&&current.case_id!==g.root.case_id){const scope=db.prepare('SELECT version,included_sense_ids_json,updated_at FROM vocabulary_case_sense_coverage WHERE case_id=?').get(current.case_id) as {version:number;included_sense_ids_json:string|null;updated_at:string}|undefined;if(scope){const previous=db.prepare('SELECT version FROM vocabulary_case_sense_coverage WHERE case_id=?').get(g.root.case_id) as {version:number}|undefined;const version=(previous?.version??0)+1;db.prepare('INSERT INTO vocabulary_case_sense_coverage VALUES (?,?,?,?) ON CONFLICT(case_id) DO UPDATE SET version=excluded.version,included_sense_ids_json=excluded.included_sense_ids_json,updated_at=excluded.updated_at').run(g.root.case_id,version,scope.included_sense_ids_json,scope.updated_at);db.prepare("INSERT INTO vocabulary_sense_coverage_history(change_id,scope,subject_id,version,snapshot_json,actor_id,recorded_at) VALUES (?,'case',?,?,?,?,?)").run(`case-review-migration:${g.root.case_id}`,g.root.case_id,version,JSON.stringify({caseId:g.root.case_id,version,includedSenseIds:scope.included_sense_ids_json?JSON.parse(scope.included_sense_ids_json):null,sourceCaseId:current.case_id}),'schema:0066',scope.updated_at);}}
  }
}

/** Safe to print: IDs/counts only, never assessment or encounter JSON. */
export function inspectVocabularyCaseReviewMigration(db:DatabaseSync){
 const inventory=inventoryVocabularyCaseReviewMigration(db);return {standaloneProposalCount:inventory.standaloneProposalCount,cases:inventory.groups.map(g=>({caseId:g.root.case_id,memberCaseIds:g.members.map(c=>c.case_id),jobIds:g.jobs.map(j=>j.job_id),activeJobIds:g.jobs.filter(j=>['queued','running'].includes(j.status)).map(j=>j.job_id),unresolvedProposalIds:g.proposals.filter(p=>!['applied','closed'].includes(p.status)).map(p=>p.proposal_id)}))};
}
