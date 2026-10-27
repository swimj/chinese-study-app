import { getDb } from '../db/connection.ts';
import { requireLearnerId } from '../db/learner-context.ts';
import { enqueueSessionDebrief } from '../db/session-debrief.ts';
import { emitBackendEvent } from '../db/vocabulary-content.ts';
import type { VocabularyContent } from '../../src/domain/vocabulary-content.ts';
import type { VocabularySessionProjection } from '../../src/domain/vocabulary-session.ts';
import { MAX_SESSION_ITEMS } from '../../src/domain/session-limits.ts';
import type { SessionDebriefInventoryItem } from '../../src/domain/session-debrief.ts';

/** Actual presented encounters, including incomplete work, are the inventory boundary.
 * A pure cue contributes one inventory row containing its accepted member set. It
 * never fabricates a selected word, sense target, completion or successful recall. */
export function vocabularyConnectionsInventory(projection:VocabularySessionProjection):SessionDebriefInventoryItem[] {
  const result:SessionDebriefInventoryItem[]=[];
  for(const encounter of projection.encounters) {
    let ids:string[];
    if(encounter.wordId!==null&&encounter.snapshot.kind!=='contrast')ids=[encounter.wordId];
    else {
      const row=getDb().prepare('SELECT snapshot_json FROM content_revision_history WHERE content_id=? AND version=?')
        .get(encounter.snapshot.contentId,encounter.snapshot.contentVersion) as {snapshot_json:string}|undefined;
      if(!row)throw new Error('Connections requires the exact retained pure-cue source');
      const content=JSON.parse(row.snapshot_json) as VocabularyContent;
      if(content.kind!=='exercise')throw new Error('Connections exercise requires an authored answer contract');
      if(encounter.snapshot.kind==='contrast') {
        const criteria=encounter.snapshot.assessment?.criteria;
        const correct=criteria!==null&&typeof criteria==='object'&&!Array.isArray(criteria)?criteria.correctWordId:null;
        if(typeof correct!=='string'||!content.answers.some(answer=>answer.wordId===correct))throw new Error('Connections contrast requires its actual authored target');
        ids=[correct];
      }else {
        if(content.exerciseType!=='pure_cue')throw new Error('Independent Connections encounter must be a pure cue');
        ids=content.answers.map(answer=>answer.wordId);
      }
    }
    const words=ids.map(id=>{
      const word=getDb().prepare('SELECT hanzi,pinyin FROM lexical_words WHERE id=?').get(id) as {hanzi:string;pinyin:string}|undefined;
      if(!word||!word.hanzi.trim())throw new Error('Connections word identity is unavailable');return word;
    });
    if(words.length)result.push({word:words.map(word=>word.hanzi).join(' / '),pinyin:words.map(word=>word.pinyin??'').join(' / ')});
  }
  return result;
}
/** Called under the source learner context inside the new completion transaction.
 * This writes only immutable Connections input; the existing worker calls providers later. */
export function enqueueVocabularyConnections(sessionId:string,completionId:string,projection:VocabularySessionProjection,completedAt:string):void {
  const learnerId=requireLearnerId();
  const source=getDb().prepare(`SELECT session_id,report_json,status FROM vocabulary_session_completions WHERE completion_id=? AND learner_id=?`)
    .get(completionId,learnerId) as {session_id:string;report_json:string;status:string}|undefined;
  if(!source||source.status!=='closed'||source.session_id!==sessionId||source.report_json!==JSON.stringify(projection)) {
    throw new Error('Connections requires the exact closed vocabulary completion');
  }
  const encountered=vocabularyConnectionsInventory(projection);
  // The retained completion keeps every encounter. Bound only the existing
  // Connections provider input, so an unusually long session still closes.
  const inventory=encountered.slice(0,MAX_SESSION_ITEMS);
  enqueueSessionDebrief(sessionId,completedAt,inventory,completedAt,{kind:'vocabulary',completionId});
  emitBackendEvent({name:'vocabulary.connections.enqueued',learnerId,sessionId,entityKind:'completion',entityId:completionId,
    data:{inventoryCount:inventory.length,encounteredCount:encountered.length,omittedCount:encountered.length-inventory.length,inputVersion:'session_debrief_input.v1'},occurredAt:completedAt});
}
