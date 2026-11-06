import fs from 'node:fs';
import path from 'node:path';
import { readStrictArguments, requireArgument } from '../lib/hosted-runtime.ts';
import type { WordContentDocument } from '../../src/domain/word-content/types.ts';

const args=readStrictArguments(['data-dir']);
const dataDir=path.resolve(requireArgument(args,'data-dir'));
if(!fs.existsSync(path.join(dataDir,'fixture-manifest.json')))throw new Error('Expected prepared vocabulary fixture');
Object.assign(process.env,{APP_MODE:'study',APP_AUTH_MODE:'trusted_local',APP_OPERATOR_CLERK_USER_IDS:'trusted_local',APP_STUDY_PROFILE:'mandarin',APP_DATA_DIR:dataDir,APP_LEARNER_ID:'dev-learner'});
await import('../../server/db.ts');
const {getDb,closeDbConnection}=await import('../../server/db/connection.ts');
try {
  const {claimSharedWordIntroductionStage,finishSharedWordIntroductionBootstrap,finishSharedWordIntroductionTeaching}=await import('../../server/db/word-introductions.ts');
  const {normalizePracticeRehearsals}=await import('../../server/word-content/authoring.ts');
  const {getVocabularySenses}=await import('../../server/db/vocabulary-content.ts');
  const {getVocabularyWordSenseCoverage,writeVocabularyDefaultUsefulSenses}=await import('../../server/db/vocabulary-sense-coverage.ts');
  const {runWithLearnerId}=await import('../../server/db/learner-context.ts');
  const {addVocabularyWord}=await import('../../server/db/vocabulary-learners.ts');
  const {enqueueWordPreparation}=await import('../../server/db/preparation-work.ts');
  const {createVocabularyPracticePreparation}=await import('../../server/vocabulary/preparation.ts');
  const db=getDb(),wordId='testbed:挂钩',actor={kind:'operator' as const,id:'testbed'};
  const at=new Date().toISOString(),expires=new Date(Date.now()+300_000).toISOString();
  db.prepare(`INSERT INTO lexical_words(id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at)
    VALUES (?,?,?,?,?,?,?,1,?)`).run(wordId,'挂钩','掛鉤','guà gōu','hook; establish contact; tie one thing to another',JSON.stringify(['hook','establish contact','tie one thing to another']),'[]',at);
  runWithLearnerId('dev-learner',()=>{addVocabularyWord(wordId);enqueueWordPreparation(wordId,'teaching');});
  const original:WordContentDocument={schemaVersion:1,id:'testbed:guagou:original',
    word:{wordId,hanzi:'挂钩',traditional:'掛鉤',pinyin:'guà gōu'},
    uses:[
      {id:'physical-hook',label:'A hook for hanging things',notes:['A physical hook attached to a wall, door, or other surface.'],exampleIds:['e1']},
      {id:'make-contact',label:'Establish a working connection',notes:['Establish contact or a working relationship with a person or organization.'],exampleIds:['e2']},
      {id:'tie-to',label:'Tie one thing to another',notes:['Link pay, benefits, or an outcome to another factor.'],exampleIds:['e3']},
    ],examples:[
      {id:'e1',text:'把外套挂在门后的挂钩上。',translation:'Hang your coat on the hook behind the door.',pronunciation:null},
      {id:'e2',text:'这个项目已经与当地医院挂钩。',translation:'This project has established a connection with the local hospital.',pronunciation:null},
      {id:'e3',text:'奖金与工作表现挂钩。',translation:'The bonus is tied to job performance.',pronunciation:null},
    ]};
  function publish(content:WordContentDocument,packageId:string){
    const token=`${content.id}:bootstrap`;
    if(claimSharedWordIntroductionStage(wordId,'bootstrap',token,at,expires)!=='claimed')throw new Error('Expected fixture bootstrap claim');
    finishSharedWordIntroductionBootstrap(wordId,token,content,'synthetic-testbed');
    const teachingToken=`${content.id}:teaching`;
    if(claimSharedWordIntroductionStage(wordId,'teaching',teachingToken,at,expires)!=='claimed')throw new Error('Expected fixture teaching claim');
    finishSharedWordIntroductionTeaching(wordId,teachingToken,{schemaVersion:1,id:packageId,wordContentId:content.id,
      beats:content.uses.map((use,index)=>({id:`beat-${index}`,parts:[{kind:'use_note' as const,useId:use.id,noteIndex:0}]})),
      rehearsals:normalizePracticeRehearsals({rehearsals:[{id:'hook',stimulus:{kind:'direct_text',text:'A hook on the wall for hanging a coat.'}}]},content)},'synthetic-testbed');
  }
  publish(original,'testbed:guagou:original-package');
  const canonical=getVocabularySenses(wordId);
  if(canonical.length!==3)throw new Error('Expected three imported canonical senses');
  // Reproduce the historical compatibility refresh without mutating any retained source.
  db.prepare('UPDATE word_introduction_preparation SET content_id=NULL,package_id=NULL WHERE word_id=?').run(wordId);
  const replacement:WordContentDocument={...original,id:'testbed:guagou:replacement',uses:[
    {...original.uses[0],id:'physical',label:'Physical hook or hanger'},
    {...original.uses[1],id:'connect',label:'Get connected with an organization'},
    {...original.uses[2],id:'tie',label:'Link or tie one thing to another'},
    {id:'associate',label:'Make an everyday association',notes:['Connect two things in a judgment, sometimes when the connection is unfair or unwarranted.'],exampleIds:['e4']},
  ],examples:[...original.examples,{id:'e4',text:'别把一次迟到和他的工作态度挂钩。',translation:'Do not link being late once with his attitude toward work.',pronunciation:null}]};
  publish(replacement,'testbed:guagou:replacement-package');
  db.prepare("UPDATE word_preparation_work SET status='ready',source_content_id=CASE WHEN stage='teaching' THEN ? ELSE NULL END WHERE word_id=? AND stage IN ('bootstrap','teaching')").run(replacement.id,wordId);
  const practice=createVocabularyPracticePreparation().ensure(wordId);
  if(practice?.status!=='failed'||practice.lastError!=='source_mapping_requires_operator')throw new Error('Fixture must reproduce the unmapped-source practice failure');
  // Different failure labels on the same replaced source share one resolution.
  const columns=(db.prepare('PRAGMA table_info(vocabulary_practice_preparation)').all() as {name:string}[]).map(column=>column.name);
  for(const [id,key,error] of [
    ['testbed:mapping-duplicate','testbed:older-contract','source_mapping_requires_operator'],
    ['testbed:source-generation-failure','testbed:provider-contract','generation_failed'],
  ]) {
    db.prepare(`INSERT INTO vocabulary_practice_preparation (${columns.join(',')}) SELECT ${columns.map(column=>['work_id','generation_key','last_error'].includes(column)?'?':column).join(',')} FROM vocabulary_practice_preparation WHERE work_id=?`)
      .run(...columns.filter(column=>['work_id','generation_key','last_error'].includes(column)).map(column=>column==='work_id'?id:column==='generation_key'?key:error),practice.workId);
  }
  writeVocabularyDefaultUsefulSenses(wordId,getVocabularyWordSenseCoverage(wordId).version,canonical.map(sense=>sense.senseId),actor);
  const mappings=db.prepare('SELECT count(*) AS n FROM legacy_sense_imports WHERE source_content_id=?').get(replacement.id)!;
  if(mappings.n!==0)throw new Error('Replacement must not acquire inferred canonical mappings');
  fs.writeFileSync(path.join(dataDir,'reconciliation-fixture.json'),JSON.stringify({wordId,originalContentId:original.id,replacementContentId:replacement.id,canonicalSenseIds:canonical.map(sense=>sense.senseId),practiceWorkId:practice.workId},null,2));
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Fixture foreign keys failed');
} finally {closeDbConnection();}
