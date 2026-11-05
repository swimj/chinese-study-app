import { randomUUID } from 'node:crypto';
import type { VocabularyCaseQueueItem, VocabularyCaseQueuePage, VocabularyCaseQueueQuery, VocabularyServedReview, VocabularyOperationReview, VocabularyAssessmentSummary, VocabularyAdvisorySummary } from '../../src/domain/vocabulary-case-queue.ts';
import type { ReflectionModelChoice } from '../reflection/model-arms.ts';
import { isOperatorSubject, parseOperatorAllowlist } from '../operator-access.ts';
import { config, getDb } from './connection.ts';
import { canonicalVocabularyCaseId, VocabularyReflectionConflict } from './vocabulary-case-reviews.ts';
import { closeVocabularyCase, requestVocabularyReassessment, type ReassessmentOrigin } from './vocabulary-reflection.ts';

function authorize(actorId:string):void {
  if(!isOperatorSubject(actorId,parseOperatorAllowlist(),config.authMode))throw new Error('Operator access required');
}
const parseList=<T>(value:string|null):T[]=>value===null?[]:JSON.parse(value) as T[];
const textDiagnosis=(column:string)=>`CASE WHEN json_type(${column},'$.input.diagnosis')='text' THEN json_extract(${column},'$.input.diagnosis') ELSE coalesce(${['assessment','diagnosis','rationale'].map(key=>`CASE WHEN json_type(${column},'$.input.diagnosis.${key}')='text' THEN json_extract(${column},'$.input.diagnosis.${key}') END`).join(',')},'') END`;
const prompt=(column:string)=>`CASE WHEN json_type(${column},'$.prompt')='text' THEN json_extract(${column},'$.prompt') WHEN json_type(${column})='text' THEN json_extract(${column},'$') END`;
type Cursor={v:1;view:'review'|'history';search:string;at:string;id:string;since:string|null;until:string|null};
function validTime(value:unknown):value is string{return typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;}
function decodeCursor(raw:string,view:Cursor['view'],search:string):Cursor {
  if(raw.length>4096)throw new TypeError('Invalid case queue cursor');
  let value:Cursor;
  try{value=JSON.parse(Buffer.from(raw,'base64url').toString('utf8')) as Cursor;}catch{throw new TypeError('Invalid case queue cursor');}
  if(!value||value.v!==1||value.view!==view||value.search!==search||!validTime(value.at)||typeof value.id!=='string'||!value.id
    ||(value.since!==null&&!validTime(value.since))||(value.until!==null&&!validTime(value.until)))throw new TypeError('Invalid case queue cursor');
  if(view==='review'&&(value.since!==null||value.until!==null))throw new TypeError('Invalid case queue cursor');
  if(view==='history'&&!search&&(!value.since||!value.until))throw new TypeError('Invalid case queue cursor');
  return value;
}
/** Only this bounded identity scan touches the queue index; rich JSON is projected after LIMIT. */
export function listVocabularyCaseQueue(actorId:string,input:VocabularyCaseQueueQuery={},now=new Date().toISOString()):VocabularyCaseQueuePage {
  authorize(actorId);
  const view=input.view??'review',limit=input.limit??20,search=(input.search??'').trim();
  if(!['review','history'].includes(view)||!Number.isSafeInteger(limit)||limit<1||limit>50||search.length>200||!validTime(now))throw new TypeError('Invalid case queue query');
  if(view==='review'&&search)throw new TypeError('Search is available in case history');
  const cursor=input.cursor?decodeCursor(input.cursor,view,search):null;
  const since=cursor?.since??(view==='history'&&!search?new Date(Date.parse(now)-12*60*60*1000).toISOString():null);
  const until=cursor?.until??(view==='history'&&!search?now:null);
  if(input.direction!==undefined&&!['next','previous'].includes(input.direction)||input.edge!==undefined&&!['first','last'].includes(input.edge))throw new TypeError('Invalid case queue direction');
  const backwards=input.edge==='last'||(!input.edge&&input.direction==='previous');
  const order=view==='review'?'r.created_at':'r.resolved_at',direction=view==='review'?'ASC':'DESC';
  const where=[view==='review'?"r.state='open' AND r.approval_state IS NULL AND (r.current_job_id IS NOT NULL OR r.current_proposal_id IS NOT NULL)":"r.state='resolved' AND r.resolved_at IS NOT NULL"];
  const params:(string|number)[]=[];

  if(since&&until){where.push('r.resolved_at>=? AND r.resolved_at<=?');params.push(since,until);}
  if(search){
    const like=`%${search.replace(/[\\%_]/g,'\\$&')}%`;
    where.push(`(r.case_id LIKE ? ESCAPE '\\' OR c.word_id LIKE ? ESCAPE '\\' OR w.hanzi LIKE ? ESCAPE '\\' OR w.pinyin LIKE ? ESCAPE '\\'
      OR EXISTS(SELECT 1 FROM content_proposals sp JOIN vocabulary_case_lineage sl ON sl.member_case_id=sp.case_id WHERE sl.case_id=r.case_id AND (sp.proposal_id LIKE ? ESCAPE '\\' OR sp.rationale LIKE ? ESCAPE '\\'))
      OR EXISTS(SELECT 1 FROM json_each(c.evidence_snapshot_json) se WHERE json_extract(se.value,'$.snapshot.body.prompt') LIKE ? ESCAPE '\\'))`);
    params.push(...Array<string>(7).fill(like));
  }
  const from=`FROM vocabulary_case_reviews r ${search?'JOIN reflection_cases c ON c.case_id=r.case_id LEFT JOIN lexical_words w ON w.id=c.word_id':''} WHERE ${where.join(' AND ')}`;
  const total=(getDb().prepare(`SELECT count(*) AS total ${from}`).get(...params) as {total:number}).total;
  const compare=view==='review'?'>':'<',reverseCompare=view==='review'?'<':'>';
  const boundary=cursor&&!input.edge?` AND (${order},r.case_id) ${backwards?reverseCompare:compare} (?,?)`:'';
  const ordered=backwards?(direction==='ASC'?'DESC':'ASC'):direction;
  const rows=getDb().prepare(`SELECT r.case_id AS caseId,${order} AS at ${from}${boundary} ORDER BY ${order} ${ordered},r.case_id ${ordered} LIMIT ?`)
    .all(...params,...(boundary?[cursor!.at,cursor!.id]:[]),limit) as {caseId:string;at:string}[];
  if(backwards)rows.reverse();
  const first=rows[0],last=rows.at(-1);
  const startIndex=first?(getDb().prepare(`SELECT count(*) AS count ${from} AND (${order},r.case_id) ${reverseCompare} (?,?)`).get(...params,first.at,first.caseId) as {count:number}).count:0;
  const encode=(row:{at:string;caseId:string})=>Buffer.from(JSON.stringify({v:1,view,search,at:row.at,id:row.caseId,since,until} satisfies Cursor)).toString('base64url');
  return {items:readCards(rows),total,startIndex,anchorCursor:first?encode(first):input.cursor??null,previousCursor:first&&startIndex>0?encode(first):null,nextCursor:last&&startIndex+rows.length<total?encode(last):null};
}

export function getVocabularyCaseCard(caseId:string,actorId:string,proposalId?:string):VocabularyCaseQueueItem {
  authorize(actorId);
  const item=readCards([{caseId:canonicalVocabularyCaseId(caseId),proposalId}])[0];
  if(!item)throw new Error('Unknown vocabulary review case');
  return item;
}

type BaseRow={
  caseId:string;version:number;state:VocabularyCaseQueueItem['state'];createdAt:string;resolvedAt:string|null;
  kind:VocabularyCaseQueueItem['kind'];learnerId:string;wordId:string|null;wordLabel:string|null;contentId:string|null;
  approvalState:VocabularyCaseQueueItem['approvalState'];approvalRequestId:string|null;currentProposalId:string|null;
  currentJobId:string|null;currentSequence:number|null;activeJobId:string|null;activeSequence:number|null;activeStatus:'queued'|'running'|null;frozen:number;
  latestJobId:string|null;latestSequence:number|null;latestStatus:'queued'|'running'|'succeeded'|'failed'|null;latestError:string|null;latestAdvisory:number;
  proposalId:string|null;proposalVersion:number|null;proposalStatus:NonNullable<VocabularyCaseQueueItem['proposal']>['status']|null;authorKind:'operator'|'service'|null;rationale:string|null;
  assessmentJobId:string|null;assessmentSequence:number|null;origin:VocabularyAssessmentSummary['origin'];diagnosis:string;outcome:string|null;scopeKind:string|null;scopeSenseIds:string|null;
  sourceId:string|null;assessedVersion:number|null;sourceVersion:number|null;sourceAvailability:string|null;findingKind:string|null;findingMessage:string|null;sourceEligible:number;stale:number;needsResolution:number;
};
/** A fixed set of batch queries; no workspace/proposal hydration or per-item prepared statements. */
function readCards(wanted:{caseId:string;proposalId?:string}[]):VocabularyCaseQueueItem[] {
  if(!wanted.length)return [];
  const db=getDb(),ids=JSON.stringify(wanted);
  const rows=db.prepare(`SELECT r.case_id AS caseId,r.version,r.state,r.created_at AS createdAt,r.resolved_at AS resolvedAt,
    c.kind,c.learner_id AS learnerId,c.word_id AS wordId,w.hanzi AS wordLabel,c.content_id AS contentId,
    r.approval_state AS approvalState,r.approval_request_id AS approvalRequestId,r.current_proposal_id AS currentProposalId,
    cj.job_id AS currentJobId,cj.case_sequence AS currentSequence,
    a.job_id AS activeJobId,a.case_sequence AS activeSequence,a.status AS activeStatus,
    latest.job_id AS latestJobId,latest.case_sequence AS latestSequence,latest.status AS latestStatus,latest.last_error AS latestError,latest.second_opinion_json IS NOT NULL AS latestAdvisory,
    a.reassessment_source_job_id IS NOT NULL AND a.second_opinion_json IS NULL AS frozen,
    p.proposal_id AS proposalId,p.version AS proposalVersion,p.status AS proposalStatus,p.author_kind AS authorKind,p.rationale,
    dj.job_id AS assessmentJobId,dj.case_sequence AS assessmentSequence,
    CASE WHEN resolution.job_id IS NOT NULL THEN 'identity_resolution' WHEN dj.reassessment_source_job_id IS NOT NULL THEN 'reassessment' ELSE 'automatic' END AS origin,
    ${textDiagnosis('dj.result_json')} AS diagnosis,json_extract(dj.result_json,'$.input.admission.outcome') AS outcome,
    json_extract(dj.result_json,'$.input.admission.generationScope.source.kind') AS scopeKind,
    coalesce(json_extract(dj.result_json,'$.input.admission.generationScope.senseIds'),json_extract(dj.result_json,'$.input.admission.senseIds')) AS scopeSenseIds,
    src.content_id AS sourceId,coalesce(json_extract(cj.reassessment_source_json,'$.version'),
      CASE WHEN json_extract(cj.result_json,'$.input.admission.sourceContentId')=src.content_id THEN json_extract(cj.result_json,'$.input.admission.sourceContentVersion') END,
      json_extract(c.evidence_snapshot_json,'$[0].snapshot.contentVersion')) AS assessedVersion,src.version AS sourceVersion,src.availability AS sourceAvailability,
    CASE WHEN json_extract(cj.result_json,'$.input.pureCuePromotion.outcome')='needs_operator' THEN 'needs_operator' ELSE json_extract(cj.result_json,'$.input.admission.outcome') END AS findingKind,
    CASE WHEN json_extract(cj.result_json,'$.input.pureCuePromotion.outcome')='needs_operator' THEN json_extract(cj.result_json,'$.input.pureCuePromotion.rationale') ELSE json_extract(cj.result_json,'$.input.admission.rationale') END AS findingMessage,
    src.kind='exercise' AND src.exercise_role='general' AND src.skill='production' AND src.availability='active' AND (src.access_scope='shared' OR src.owner_learner_id=c.learner_id) AS sourceEligible,
    EXISTS(SELECT 1 FROM proposal_content_bases b LEFT JOIN content_items s ON s.content_id=b.content_id WHERE b.proposal_id=p.proposal_id AND (s.version IS NULL OR s.version!=b.expected_content_version))
      OR (p.author_kind='service' AND json_extract(dj.result_json,'$.input.admission.wordId') IS NOT NULL AND
       (coalesce(catalog.sense_catalog_version,0)!=json_extract(dj.result_json,'$.input.admission.catalogVersion') OR mapping.content_id IS NULL
        OR (json_type(dj.result_json,'$.input.admission.sourceMapping')='object' AND
          (mapping.sense_id IS NOT json_extract(dj.result_json,'$.input.admission.sourceMapping.senseId') OR mapping.sense_mapping_established_at IS NOT json_extract(dj.result_json,'$.input.admission.sourceMapping.establishedAt'))))) AS stale,
    c.kind='teaching_review' OR json_extract(cj.result_json,'$.input.admission.outcome') IN ('unmappable','inventory_gap','needs_coverage') OR json_extract(cj.result_json,'$.input.pureCuePromotion.outcome')='needs_operator' AS needsResolution
    FROM json_each(?) requested JOIN vocabulary_case_reviews r ON r.case_id=json_extract(requested.value,'$.caseId')
    JOIN reflection_cases c ON c.case_id=r.case_id LEFT JOIN lexical_words w ON w.id=c.word_id
    LEFT JOIN content_proposals p ON p.proposal_id=coalesce(json_extract(requested.value,'$.proposalId'),r.current_proposal_id)
    LEFT JOIN vocabulary_reflection_jobs cj ON cj.job_id=r.current_job_id
    LEFT JOIN vocabulary_reflection_jobs dj ON dj.job_id=CASE WHEN p.proposal_id IS NULL THEN r.current_job_id ELSE p.assessment_job_id END
    LEFT JOIN vocabulary_reflection_jobs a ON a.review_case_id=r.case_id AND a.status IN ('queued','running')
    LEFT JOIN vocabulary_reflection_jobs latest ON latest.job_id=(SELECT last.job_id FROM vocabulary_reflection_jobs last WHERE last.review_case_id=r.case_id ORDER BY last.case_sequence DESC LIMIT 1)
    LEFT JOIN vocabulary_improvement_stages resolution ON resolution.job_id=dj.job_id AND resolution.stage='pure_cue_promotion' AND resolution.input_hash='operator-pure-cue-resolution-v1'
    LEFT JOIN content_items src ON src.content_id=coalesce(json_extract(cj.reassessment_source_json,'$.contentId'),json_extract(c.evidence_snapshot_json,'$[0].snapshot.contentId'))
    LEFT JOIN vocabulary_word_catalogs catalog ON catalog.word_id=json_extract(dj.result_json,'$.input.admission.wordId')
    LEFT JOIN content_words mapping ON mapping.content_id=json_extract(dj.result_json,'$.input.admission.sourceContentId') AND mapping.word_id=json_extract(dj.result_json,'$.input.admission.wordId')
    WHERE (json_extract(requested.value,'$.proposalId') IS NULL OR EXISTS(SELECT 1 FROM vocabulary_case_lineage l WHERE l.case_id=r.case_id AND l.member_case_id=p.case_id))
    ORDER BY requested.key`).all(ids) as BaseRow[];
  if(rows.length!==wanted.length)throw new Error('Unknown vocabulary review case or proposal');
  const selected=JSON.stringify(rows.map(row=>({caseId:row.caseId,proposalId:row.proposalId,jobId:row.assessmentJobId,currentJobId:row.currentJobId})));
  const cards=new Map<string,VocabularyCaseQueueItem>(rows.map(row=>{
    const source=row.sourceEligible&&row.sourceId&&row.assessedVersion!==null&&row.sourceVersion!==null?{contentId:row.sourceId,assessedVersion:row.assessedVersion,currentVersion:row.sourceVersion}:null;
    const eligible=row.kind==='exercise_improvement'&&row.state==='open'&&!!row.currentJobId&&!!source&&!row.activeJobId&&row.approvalState!=='pending';
    const item:VocabularyCaseQueueItem={caseId:row.caseId,version:row.version,state:row.state,createdAt:row.createdAt,resolvedAt:row.resolvedAt,kind:row.kind,learnerId:row.learnerId,wordId:row.wordId,wordLabel:row.wordLabel,contentId:row.contentId,
      approvalState:row.approvalState,approvalRequestId:row.approvalRequestId,currentProposalId:row.currentProposalId,
      currentAssessment:row.currentJobId?{jobId:row.currentJobId,sequence:row.currentSequence!}:null,
      activeJob:row.activeJobId?{jobId:row.activeJobId,sequence:row.activeSequence!,status:row.activeStatus!}:null,frozen:!!row.frozen,
      latestJob:row.latestJobId?{jobId:row.latestJobId,sequence:row.latestSequence!,status:row.latestStatus!,error:row.latestError,advisory:!!row.latestAdvisory}:null,
      assessment:row.assessmentJobId?{jobId:row.assessmentJobId,sequence:row.assessmentSequence!,origin:row.origin,models:[],outcome:row.outcome,scopeLabel:null,diagnosis:row.diagnosis}:null,
      served:[],proposal:row.proposalId?{proposalId:row.proposalId,version:row.proposalVersion!,status:row.proposalStatus!,authorKind:row.authorKind!,isCurrent:row.proposalId===row.currentProposalId,rationale:row.rationale!,operations:[]}:null,
      alternatives:[],alternativeCount:0,sources:[],advisoryOpinion:null,stale:!!row.stale,requiresDetails:false,needsDecision:!!row.needsResolution,finding:row.findingKind&&['unmappable','inventory_gap','needs_coverage','needs_operator'].includes(row.findingKind)?{kind:row.findingKind as NonNullable<VocabularyCaseQueueItem['finding']>['kind'],message:row.findingMessage??''}:null,
      reassessment:{eligible,reason:eligible?null:row.state==='resolved'?'This case is resolved.':row.activeJobId?'A case job is queued or running.':row.approvalState==='pending'?'Case approval is queued or running.':!row.currentJobId?'A completed assessment is required.':row.sourceAvailability==='retired'?'The source exercise is retired.':!source?'The current source is unavailable or is not an active general production exercise.':'Only exercise improvement cases can be reassessed.',source}};
    return [row.caseId,item];
  }));
  const served=db.prepare(`SELECT c.case_id AS caseId,json_extract(e.value,'$.encounterId') AS encounterId,json_extract(e.value,'$.presentedAt') AS presentedAt,
    json_extract(e.value,'$.snapshot.contentId') AS contentId,json_extract(e.value,'$.snapshot.contentVersion') AS contentVersion,
    json_extract(e.value,'$.snapshot.kind') AS kind,json_extract(e.value,'$.snapshot.role') AS role,
    json_extract(e.value,'$.snapshot.body.prompt') AS prompt,json_extract(e.value,'$.snapshot.body.choices') AS choices,
    json_extract(e.value,'$.snapshot.assessment.acceptedAnswers') AS acceptedAnswers,
    (SELECT json_group_array(json_object('actionId',json_extract(v.value,'$.actionId'),'text',json_extract(v.value,'$.payload.response'),'outcome',json_extract(v.value,'$.payload.outcome'))) FROM json_each(e.value,'$.responses') v) AS responses,
    (SELECT json_group_array(json_extract(v.value,'$.actionId')) FROM json_each(e.value,'$.effectiveResponses') v) AS effectiveResponses,
    (SELECT json_group_array(json_object('actionId',json_extract(v.value,'$.actionId'),'feedback',json_extract(v.value,'$.payload.feedback'),'comment',json_extract(v.value,'$.payload.comment'))) FROM json_each(e.value,'$.feedback') v) AS reactions,
    CASE WHEN json_type(e.value,'$.effectiveFeedback')='array' THEN (SELECT json_group_array(json_extract(v.value,'$.actionId')) FROM json_each(e.value,'$.effectiveFeedback') v) END AS effectiveReactions,
    json_extract(e.value,'$.skipped') AS skipped,json_extract(e.value,'$.presentationUndone') AS presentationUndone
    FROM json_each(?) selected JOIN reflection_cases c ON c.case_id=json_extract(selected.value,'$.caseId'),json_each(c.evidence_snapshot_json) e
    ORDER BY c.case_id,CAST(e.key AS INTEGER)`).all(selected) as {caseId:string;encounterId:string;presentedAt:string|null;contentId:string|null;contentVersion:number|null;kind:string|null;role:string|null;prompt:string|null;choices:string|null;acceptedAnswers:string|null;responses:string;effectiveResponses:string;reactions:string;effectiveReactions:string|null;skipped:number;presentationUndone:number}[];
  for(const row of served){
    const responseIds=new Set(parseList<string>(row.effectiveResponses)),reactions=parseList<Omit<VocabularyServedReview['reactions'][number],'undone'>>(row.reactions);
    const latest=reactions.filter(r=>r.feedback!=='comment').at(-1);
    const reactionIds=new Set(row.effectiveReactions===null?reactions.filter(r=>r.feedback==='comment'||(r===latest&&r.feedback!=='withdrawn')).map(r=>r.actionId):parseList<string>(row.effectiveReactions));
    cards.get(row.caseId)!.served.push({encounterId:row.encounterId,presentedAt:row.presentedAt,contentId:row.contentId,contentVersion:row.contentVersion,kind:row.kind,role:row.role,prompt:row.prompt,choices:parseList(row.choices),acceptedAnswers:parseList(row.acceptedAnswers),
      responses:parseList<Omit<VocabularyServedReview['responses'][number],'undone'>>(row.responses).map(r=>({...r,undone:!responseIds.has(r.actionId)})),reactions:reactions.map(r=>({...r,undone:!reactionIds.has(r.actionId)})),skipped:!!row.skipped,presentationUndone:!!row.presentationUndone});
  }
  type OperationRow={caseId:string;operationKey:string;strategy:VocabularyOperationReview['strategy'];learningRole:VocabularyOperationReview['learningRole']|null;scopeKind:string;scopeLearnerId:string|null;prompt:string|null;kind:string;rationale:string;answers:string|null;words:string|null;sourceContentId:string|null;expectedVersion:number|null;criteriaChanged:number;revealChanged:number;instructionsChanged:number;additionalBody:number;stimulusKind:string|null;stimulusText:string|null;sourceAnswers:string|null};
  const operations=db.prepare(`SELECT json_extract(selected.value,'$.caseId') AS caseId,json_extract(o.value,'$.operationKey') AS operationKey,
    json_extract(o.value,'$.strategy') AS strategy,json_extract(o.value,'$.learningRole') AS learningRole,json_extract(o.value,'$.scope.kind') AS scopeKind,json_extract(o.value,'$.scope.learnerId') AS scopeLearnerId,
    CASE WHEN json_type(o.value,'$.content.body.prompt')='text' THEN json_extract(o.value,'$.content.body.prompt') WHEN json_type(o.value,'$.content.body')='text' THEN json_extract(o.value,'$.content.body') END AS prompt,json_extract(o.value,'$.content.kind') AS kind,json_extract(o.value,'$.rationale') AS rationale,
    json_extract(o.value,'$.content.answers') AS answers,json_extract(o.value,'$.content.words') AS words,json_extract(o.value,'$.sourceContentId') AS sourceContentId,json_extract(o.value,'$.expectedVersion') AS expectedVersion,
    json_extract(o.value,'$.content.body.stimulus.kind') AS stimulusKind,json_extract(o.value,'$.content.body.stimulus.text') AS stimulusText,
    EXISTS(SELECT 1 FROM json_each(o.value,'$.content.body') field WHERE field.key NOT IN ('prompt','stimulus','reveal','instruction','source')) AS additionalBody,
    CASE WHEN s.content_id IS NOT NULL THEN (SELECT json_group_array(json_object('wordId',answer.word_id,'acceptedForms',json(answer.accepted_forms_json))) FROM exercise_answer_words answer WHERE answer.exercise_id=s.content_id ORDER BY answer.word_id) END AS sourceAnswers,
    s.content_id IS NOT NULL AND s.assessment_json IS NOT json_extract(o.value,'$.content.assessment') AS criteriaChanged,
    s.content_id IS NOT NULL AND json_extract(s.body_json,'$.reveal') IS NOT json_extract(o.value,'$.content.body.reveal') AS revealChanged,
    s.content_id IS NOT NULL AND json_extract(s.body_json,'$.instruction') IS NOT json_extract(o.value,'$.content.body.instruction') AS instructionsChanged
    FROM json_each(?) selected JOIN content_proposals p ON p.proposal_id=json_extract(selected.value,'$.proposalId'),json_each(p.operations_json) o
    LEFT JOIN content_items s ON s.content_id=json_extract(o.value,'$.sourceContentId')
    ORDER BY selected.key,CAST(o.key AS INTEGER)`).all(selected) as OperationRow[];
  const senseIds=new Set<string>();
  for(const op of operations)for(const word of parseList<{relation:string;senseId?:string}>(op.words))if(word.relation==='target'&&word.senseId)senseIds.add(word.senseId);
  for(const row of rows)for(const id of parseList<string>(row.scopeSenseIds))senseIds.add(id);
  const labels=new Map((db.prepare(`SELECT sense_id AS id,CASE WHEN json_type(description_json)='text' THEN json_extract(description_json,'$') ELSE json_extract(description_json,'$.label') END AS label FROM senses WHERE sense_id IN (SELECT value FROM json_each(?))`).all(JSON.stringify([...senseIds])) as {id:string;label:string|null}[]).map(row=>[row.id,row.label??'Sense label unavailable']));
  for(const op of operations){
    const card=cards.get(op.caseId)!,groups=parseList<{relation:string;senseId?:string}>(op.words).filter(w=>w.relation==='target'&&w.senseId).map(w=>labels.get(w.senseId!)??'Sense label unavailable');
    const answers=parseList<{acceptedForms:string[]}>(op.answers).flatMap(a=>a.acceptedForms);
    card.proposal!.operations.push({operationKey:op.operationKey,strategy:op.strategy,...(op.learningRole?{learningRole:op.learningRole}:{}),scopeLabel:op.scopeKind==='shared'?'Shared content':`Private content · learner ${op.scopeLearnerId}`,groupLabel:groups.length?groups.join(' · '):'General practice',prompt:op.prompt,acceptedAnswers:answers,rationale:op.rationale,sourceContentId:op.sourceContentId,expectedVersion:op.expectedVersion,
      otherChanges:op.strategy==='retire'?[]:[...(op.criteriaChanged?['answer criteria']:[]),...(op.revealChanged?['reveal']:[]),...(op.instructionsChanged?['instructions']:[]),...(op.sourceAnswers!==null&&op.sourceAnswers!==op.answers?['expected answers']:[])]});
    const invalidCloze=op.stimulusKind==='phrase_cloze'&&(typeof op.stimulusText!=='string'||op.stimulusText.match(/_+/g)?.join('|')!=='____');
    const unsupportedStimulus=op.stimulusKind!==null&&!['direct_text','phrase_cloze'].includes(op.stimulusKind);
    if(op.strategy!=='retire'&&(op.kind!=='exercise'||op.prompt===null||op.additionalBody||invalidCloze||unsupportedStimulus))card.requiresDetails=true;
  }
  const sourceRows=db.prepare(`SELECT json_extract(selected.value,'$.caseId') AS caseId,b.content_id AS contentId,b.expected_content_version AS expectedVersion,s.version,${prompt('s.body_json')} AS prompt,s.availability,
    (SELECT json_group_array(json(a.accepted_forms_json)) FROM exercise_answer_words a WHERE a.exercise_id=b.content_id ORDER BY a.word_id) AS answers
    FROM json_each(?) selected JOIN proposal_content_bases b ON b.proposal_id=json_extract(selected.value,'$.proposalId') LEFT JOIN content_items s ON s.content_id=b.content_id ORDER BY selected.key,b.content_id`).all(selected) as {caseId:string;contentId:string;expectedVersion:number;version:number|null;prompt:string|null;availability:string|null;answers:string}[];
  for(const row of sourceRows){const card=cards.get(row.caseId)!;card.sources.push({contentId:row.contentId,expectedVersion:row.expectedVersion,version:row.version,prompt:row.prompt,availability:row.availability,acceptedAnswers:parseList<string[]>(row.answers).flat()});}
  for(const row of rows){const assessment=cards.get(row.caseId)!.assessment;if(assessment){const names=parseList<string>(row.scopeSenseIds).map(id=>labels.get(id)??'Sense label unavailable');assessment.scopeLabel=names.length?names.join(' / '):null;}}
  const modelRows=db.prepare(`SELECT DISTINCT json_extract(selected.value,'$.caseId') AS caseId,m.id AS invocationId,coalesce(m.step_name,'exercise_improvement') AS stage,m.provider,m.model,m.resolved_model AS resolvedModel
    FROM json_each(?) selected JOIN vocabulary_reflection_jobs j ON j.job_id=json_extract(selected.value,'$.jobId')
    LEFT JOIN content_proposals p ON p.proposal_id=json_extract(selected.value,'$.proposalId')
    LEFT JOIN vocabulary_improvement_stages resolution ON resolution.job_id=j.job_id AND resolution.stage='pure_cue_promotion' AND resolution.input_hash='operator-pure-cue-resolution-v1'
    LEFT JOIN vocabulary_reflection_jobs parent ON parent.job_id=json_extract(resolution.result_json,'$.sourceJobId'),
    json_each(json_array(json_extract(j.result_json,'$.input.admission.invocationId'),json_extract(parent.result_json,'$.input.invocationId'),json_extract(parent.result_json,'$.input.proposal.invocationId'),json_extract(j.result_json,'$.input.invocationId'),json_extract(j.result_json,'$.input.proposal.invocationId'),json_extract(j.result_json,'$.input.pureCuePromotion.invocationId'),p.invocation_id)) invocation
    JOIN model_invocations m ON m.id=invocation.value`).all(selected) as ({caseId:string}&VocabularyAssessmentSummary['models'][number])[];
  for(const {caseId,...model} of modelRows)cards.get(caseId)!.assessment?.models.push(model);
  const alternatives=db.prepare(`WITH alternatives AS (SELECT json_extract(selected.value,'$.caseId') AS caseId,p.proposal_id AS proposalId,p.version,p.status,p.rationale,
      row_number() OVER(PARTITION BY l.case_id ORDER BY p.created_at,p.proposal_id) AS position,count(*) OVER(PARTITION BY l.case_id) AS total
    FROM json_each(?) selected JOIN vocabulary_case_lineage l ON l.case_id=json_extract(selected.value,'$.caseId') JOIN content_proposals p ON p.case_id=l.member_case_id
    WHERE p.status NOT IN ('closed','applied') AND p.proposal_id IS NOT json_extract(selected.value,'$.proposalId'))
    SELECT * FROM alternatives WHERE position<=20 ORDER BY caseId,position`).all(selected) as ({caseId:string;position:number;total:number}&VocabularyCaseQueueItem['alternatives'][number])[];
  for(const {caseId,position:_position,total,...alternative} of alternatives){const card=cards.get(caseId)!;card.alternatives.push(alternative);card.alternativeCount=total;}
  const opinions=db.prepare(`SELECT json_extract(selected.value,'$.caseId') AS caseId,coalesce(opinion.request_id,json_extract(j.second_opinion_json,'$.requestId')) AS requestId,j.job_id AS jobId,j.case_sequence AS sequence,j.status,j.attempt_number AS attemptNumber,j.last_error AS error,json_extract(j.result_json,'$.input.secondOpinion') AS result
    FROM json_each(?) selected LEFT JOIN content_proposals p ON p.proposal_id=json_extract(selected.value,'$.proposalId')
    LEFT JOIN vocabulary_second_opinions opinion ON opinion.proposal_id=p.proposal_id AND opinion.proposal_version=p.version
    JOIN vocabulary_reflection_jobs j ON j.job_id=coalesce(opinion.job_id,CASE WHEN p.proposal_id IS NULL THEN
      (SELECT candidate.job_id FROM vocabulary_reflection_jobs candidate JOIN vocabulary_reflection_jobs current ON current.job_id=json_extract(selected.value,'$.currentJobId')
        WHERE candidate.review_case_id=json_extract(selected.value,'$.caseId') AND candidate.case_sequence>current.case_sequence AND candidate.second_opinion_json IS NOT NULL AND json_extract(candidate.second_opinion_json,'$.proposal') IS NULL ORDER BY candidate.case_sequence DESC LIMIT 1) END)`).all(selected) as (Omit<VocabularyAdvisorySummary,'result'>&{caseId:string;result:string|null})[];
  for(const {caseId,result,...opinion} of opinions)cards.get(caseId)!.advisoryOpinion={...opinion,result:result?JSON.parse(result) as VocabularyAdvisorySummary['result']:null};
  return wanted.map(w=>cards.get(w.caseId)!);
}

/** Case-version comparison and its operation share a write transaction; no stale-card TOCTOU. */
function changeCase<T>(caseId:string,expectedVersion:number,actorId:string,work:(id:string)=>T):T {
  authorize(actorId);
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)throw new TypeError('Expected positive case version');
  const db=getDb(),nested=db.isTransaction,point=`case_review_${randomUUID().replaceAll('-','')}`;
  db.exec(nested?`SAVEPOINT ${point}`:'BEGIN IMMEDIATE');
  try{
    const id=canonicalVocabularyCaseId(caseId),row=db.prepare('SELECT version FROM vocabulary_case_reviews WHERE case_id=?').get(id) as {version:number}|undefined;
    if(!row)throw new Error('Unknown vocabulary review case');
    if(row.version!==expectedVersion)throw new VocabularyReflectionConflict('Case review changed; refresh before acting');
    const result=work(id);db.exec(nested?`RELEASE ${point}`:'COMMIT');return result;
  }catch(error){db.exec(nested?`ROLLBACK TO ${point}`:'ROLLBACK');if(nested)db.exec(`RELEASE ${point}`);throw error;}
}
export function resolveVocabularyCaseReview(caseId:string,expectedVersion:number,actorId:string,reason=''):VocabularyCaseQueueItem {
  return changeCase(caseId,expectedVersion,actorId,id=>{
    const proposal=getDb().prepare("SELECT 1 FROM content_proposals p JOIN vocabulary_case_lineage l ON l.member_case_id=p.case_id WHERE l.case_id=? AND p.status NOT IN ('closed','applied') LIMIT 1").get(id);
    if(proposal)throw new VocabularyReflectionConflict('Review or dismiss outstanding proposals before marking the case Done');
    closeVocabularyCase(id,actorId,reason);return getVocabularyCaseCard(id,actorId);
  });
}
export function reassessVocabularyCaseReview(caseId:string,expectedVersion:number,actorId:string,modelChoice:ReflectionModelChoice,expectedContentVersion:number,origin:ReassessmentOrigin={kind:'case'}):{caseId:string;jobId:string;item:VocabularyCaseQueueItem} {
  return changeCase(caseId,expectedVersion,actorId,id=>{const result=requestVocabularyReassessment(id,actorId,modelChoice,expectedContentVersion,origin);return {...result,item:getVocabularyCaseCard(id,actorId)};});
}
