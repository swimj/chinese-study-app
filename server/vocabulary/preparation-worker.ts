import { getDb } from '../db/connection.ts';
import { getHostedServiceControls } from '../db/hosted-operations.ts';
import { HostedProviderWorkUnavailableError,runHostedProviderWork } from '../hosted-runtime-controls.ts';
import { createVocabularyPracticePreparation,type VocabularyPracticeProvider } from './preparation.ts';

/** Shared preparation follows actual admitted session demand, not every word in the corpus.
 * This query does not claim learner authority or publish private session evidence. */
function activeSessionDemand(): string[] {
  const rows=getDb().prepare(`SELECT DISTINCT w.word_id FROM vocabulary_sessions s
    JOIN learners l ON l.learner_id=s.learner_id JOIN json_each(s.context_json,'$.words') member
    JOIN learner_words w ON w.learner_id=s.learner_id AND w.word_id=json_extract(member.value,'$.wordId')
    WHERE s.status='active' AND l.disabled_at IS NULL AND w.mode!='unstudied' AND w.dismissed_at IS NULL
    ORDER BY w.word_id LIMIT 100`).all() as Array<{word_id:string}>;
  return rows.map((row)=>row.word_id);
}
/** Durable general-pool authoring. Only worker dispatch awaits providers; live sessions keep using ready content.
 * Provider calls are fenced by hosted controls; late returns cannot publish during maintenance or shutdown. */
export function createVocabularyPracticeWorker(options: {
  provider?: VocabularyPracticeProvider;
  now?: () => number;
  concurrency?: number;
  pollMs?: number;
  demand?: () => string[];
  controls?: () => { maintenanceMode: boolean; providerWorkEnabled: boolean };
  providerWork?: <T>(work:()=>Promise<T>)=>Promise<T>;
  onError?: (error:unknown)=>void;
} = {}) {
  const now=options.now??Date.now,controls=options.controls??getHostedServiceControls;
  const providerWork=options.providerWork??runHostedProviderWork,demand=options.demand??activeSessionDemand;
  const concurrency=options.concurrency??1,pollMs=options.pollMs??5_000;
  if(!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>3)throw new Error('Practice preparation concurrency must be 1–3');
  if(!Number.isSafeInteger(pollMs)||pollMs<10)throw new Error('Invalid preparation poll interval');
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,stepping:Promise<boolean>|null=null,draining:Promise<void>|null=null;
  function allowed():boolean {const state=controls();return !stopped&&!state.maintenanceMode&&state.providerWorkEnabled;}
  const preparation=createVocabularyPracticePreparation({provider:options.provider,now:()=>new Date(now()).toISOString(),canPublish:allowed});
  async function process(workId:string):Promise<boolean> {
    try {
      return await providerWork(async()=>{
        if(!allowed()||!preparation.isConfigured())return false;
        const token=preparation.claim(workId);if(!token)return false;
        try{await preparation.run(workId,token);}
        catch{options.onError?.(new Error('Vocabulary practice preparation failed; inspect its durable job and invocation'));}
        return true;
      });
    }catch(error){if(error instanceof HostedProviderWorkUnavailableError)return false;throw error;}
  }
  async function runStep():Promise<boolean> {
    if(stopped||controls().maintenanceMode)return false;
    preparation.recoverExpired();
    for(const wordId of demand())preparation.ensure(wordId);
    if(!allowed()||!preparation.isConfigured())return false;
    const batch=preparation.listQueued(concurrency);
    const results=await Promise.allSettled(batch.map((work)=>process(work.workId)));
    let changed=false;
    for(const result of results) {
      if(result.status==='fulfilled')changed=result.value||changed;
      else options.onError?.(new Error('Vocabulary practice worker could not dispatch queued work'));
    }
    return changed;
  }
  function step():Promise<boolean> {
    if(stepping)return stepping;
    stepping=runStep().finally(()=>{stepping=null;});return stepping;
  }
  function drain():Promise<void> {
    if(draining)return draining;
    draining=(async()=>{while(!stopped&&await step()){/* Only queued work; failed calls remain failed. */}})().finally(()=>{draining=null;});
    return draining;
  }
  function wake():void {
    if(stopped)return;
    if(timer)clearTimeout(timer);timer=undefined;
    void drain().catch(()=>options.onError?.(new Error('Vocabulary practice worker failed'))).finally(()=>{
      if(!stopped&&timer===undefined){timer=setTimeout(wake,pollMs);timer.unref();}
    });
  }
  return {
    step,drain,wake,
    /** Optional explicit demand seam for the caller that already knows a word; it does not start a provider synchronously. */
    ensure(wordId:string){if(stopped||controls().maintenanceMode)return null;const work=preparation.ensure(wordId);wake();return work;},
    async stop():Promise<void>{stopped=true;if(timer)clearTimeout(timer);timer=undefined;await stepping;await draining;},
  };
}
