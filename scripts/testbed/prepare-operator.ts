import fs from 'node:fs';
import path from 'node:path';
import { readStrictArguments, requireArgument } from '../lib/hosted-runtime.ts';
import type { VocabularySessionAction, VocabularySessionActionPayload } from '../../src/domain/vocabulary-session.ts';
const args = readStrictArguments(['data-dir']);
const dataDir = path.resolve(requireArgument(args, 'data-dir'));
// Called only inside the launcher's newly prepared vocabulary fixture directory.
if (!fs.existsSync(path.join(dataDir, 'fixture-manifest.json'))) throw new Error('Expected prepared vocabulary fixture');
Object.assign(process.env, {APP_MODE:'study',APP_AUTH_MODE:'trusted_local',APP_OPERATOR_CLERK_USER_IDS:'trusted_local',APP_STUDY_PROFILE:'mandarin',APP_DATA_DIR:dataDir,APP_LEARNER_ID:'dev-learner'});
await import('../../server/db.ts');
const {getDb,closeDbConnection} = await import('../../server/db/connection.ts');
try {
  const {createVocabularyContent} = await import('../../server/db/vocabulary-content.ts');
  const {createVocabularyProposal,ingestVocabularySessionEvidence,claimVocabularyReflectionJob,failVocabularyReflectionJob} = await import('../../server/db/vocabulary-reflection.ts');
  const actor = {kind:'operator' as const,id:'testbed'};
  const word = getDb().prepare("SELECT id,hanzi FROM lexical_words WHERE hanzi='部署' LIMIT 1").get() as {id:string;hanzi:string};
  if (!word) throw new Error('Expected fixture word 部署');
  const source = createVocabularyContent({contentId:'testbed-source',kind:'exercise',payloadVersion:1,
    body:{prompt:'Put a software system into its intended running environment.'},accessScope:'shared',availability:'active',originKind:'human',
    exerciseType:'definition',skill:'production',exerciseRole:'general',assessment:{match:'prepared_answer_membership'},
    words:[{wordId:word.id,relation:'target'}],answers:[{wordId:word.id,acceptedForms:[word.hanzi]}]},actor);
  const {runWithLearnerId} = await import('../../server/db/learner-context.ts');
  const {createVocabularySession,appendVocabularySessionActions,stageVocabularySessionCompletion,closeVocabularySessionCompletion} = await import('../../server/db/vocabulary-sessions.ts');
  const at = new Date().toISOString();
  const completion = runWithLearnerId('dev-learner',()=>{
    const sessionId='testbed-operator-session';
    createVocabularySession({sessionId,words:[{wordId:word.id,mode:'practice'}]},at);
    const inputs: VocabularySessionActionPayload[] = [
      {kind:'presentation',payload:{encounterId:'testbed-encounter',wordId:word.id,snapshot:{contentId:source.contentId,contentVersion:1,kind:'production',role:'general',body:{prompt:'Put a software system into its intended running environment.',material:source.body},assessment:{acceptedAnswers:[word.hanzi],criteria:{match:'prepared_answer_membership'}}}}},
      {kind:'response',payload:{encounterId:'testbed-encounter',response:'安装',outcome:'rejected'}},
      {kind:'finish_for_now',payload:{}},
    ];
    const action=(input:VocabularySessionActionPayload,index:number):VocabularySessionAction=>({...input,protocolVersion:1,sequence:index+1,actionId:`testbed-${index}`,clientActionId:`testbed-${index}`,occurredAt:at});
    const actions=inputs.map(action);
    const persisted=appendVocabularySessionActions(sessionId,actions,at);
    if(persisted.projection.phase!=='completed') {
      const last=action({kind:'finish_immediately',payload:{}},actions.length);
      appendVocabularySessionActions(sessionId,[last],at);actions.push(last);
    }
    const staged=stageVocabularySessionCompletion(sessionId,actions.length,at);
    return closeVocabularySessionCompletion(sessionId,staged.completionId,new Date(Date.parse(at)+16000).toISOString());
  });
  ingestVocabularySessionEvidence('dev-learner',completion.completionId,completion.report,at);
  const job=claimVocabularyReflectionJob({kind:'exercise_improvement',now:at});
  if(!job) throw new Error('Expected review job from synthetic encounter');
  failVocabularyReflectionJob(job.jobId,job.leaseToken!,'synthetic_provider_failure',at,at);
  const {version: _version, createdAt: _createdAt, updatedAt: _updatedAt, ...draft} = source;
  const proposal = createVocabularyProposal({caseId:job.caseId,rationale:'Clarify a deployment exercise.',operations:[{
    operationKey:'clarify',strategy:'update_existing',sourceContentId:source.contentId,expectedVersion:source.version,
    scope:{kind:'shared'},rationale:'Use a concrete software deployment situation.',
    content:{...draft,body:{prompt:'After testing, deploy the new version to the server: 把新版本____到服务器上。'}},
  }]},actor.id);
  fs.writeFileSync(path.join(dataDir,'operator-fixture.json'),JSON.stringify({sourceContentId:source.contentId,proposalId:proposal.proposalId,caseId:job.caseId},null,2));
  if (getDb().prepare('PRAGMA foreign_key_check').all().length) throw new Error('Fixture foreign keys failed');
} finally {closeDbConnection();}
