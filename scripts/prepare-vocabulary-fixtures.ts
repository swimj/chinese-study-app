import fs from 'node:fs';
import path from 'node:path';
import { readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';
import { buildUiAnnotationSeed } from '../server/seeds/ui-annotation-data.ts';

// A new directory is mandatory; no hosted or existing development database is modified.
const args=readStrictArguments(['data-dir']);
const dataDir=path.resolve(requireArgument(args,'data-dir'));
fs.mkdirSync(path.dirname(dataDir),{recursive:true});fs.mkdirSync(dataDir);
const now=new Date(),seedPath=path.join(dataDir,'vocabulary-fixture-seed.json');
fs.writeFileSync(seedPath,JSON.stringify(buildUiAnnotationSeed(now),null,2));
Object.assign(process.env,{APP_MODE:'dev',APP_AUTH_MODE:'trusted_local',APP_STUDY_PROFILE:'mandarin',
  APP_LEARNER_ID:'dev-learner',APP_DATA_DIR:dataDir,APP_SEED_DATA_PATH:seedPath,APP_INCLUDE_DEV_CONTRAST_SEED:'true'});
const {getDb,closeDbConnection}=await import('../server/db/connection.ts');
try {
  const {prepareUiAnnotationFixtures}=await import('../server/seeds/ui-annotations.ts');
  const manifest=prepareUiAnnotationFixtures(now);
  const {runWithLearnerId}=await import('../server/db/learner-context.ts');
  const {addVocabularyWord,changeVocabularyMode}=await import('../server/db/vocabulary-learners.ts');
  const {importLegacyVocabulary}=await import('../server/db/vocabulary-import.ts');
  const {setHostedServiceControl}=await import('../server/db/hosted-operations.ts');
  setHostedServiceControl({key:'provider_work_enabled',enabled:false,actorId:'vocabulary-fixture'});
  const db=getDb();db.exec('BEGIN IMMEDIATE');
  try {
    importLegacyVocabulary(db);
    runWithLearnerId('dev-learner',()=>{
      for(const wordId of [...manifest.words.introduction,...manifest.words.learning,manifest.words.review]){
        const value=addVocabularyWord(wordId);
        const mode=manifest.words.learning.includes(wordId)?'solidify':wordId===manifest.words.review?'practice':'unstudied';
        if(mode!=='unstudied')changeVocabularyMode(wordId,mode,value.stateVersion);
        db.prepare('UPDATE learner_word_schedules SET next_eligible_at=NULL WHERE learner_id=? AND word_id=?').run('dev-learner',wordId);
      }
    });
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  fs.writeFileSync(path.join(dataDir,'fixture-manifest.json'),JSON.stringify(manifest,null,2));
  console.log(JSON.stringify({dataDir,providerWorkEnabled:false,...manifest},null,2));
}finally{closeDbConnection();}
