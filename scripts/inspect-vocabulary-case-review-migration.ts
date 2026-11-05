import { DatabaseSync } from 'node:sqlite';
import { inspectVocabularyCaseReviewMigration } from '../server/db/vocabulary-case-review-migration.ts';

const target=process.argv[2];
if(!target)throw new Error('Usage: node --import tsx scripts/inspect-vocabulary-case-review-migration.ts /absolute/path/app.db');
const db=new DatabaseSync(target,{readOnly:true});
try{
  const report=inspectVocabularyCaseReviewMigration(db);
  console.log(JSON.stringify({...report,caseCount:report.cases.length,
    activeConflicts:report.cases.filter(item=>item.activeJobIds.length>1).map(item=>item.caseId),
    retainedAlternatives:report.cases.filter(item=>item.unresolvedProposalIds.length>1).map(item=>item.caseId)},null,2));
}finally{db.close();}
