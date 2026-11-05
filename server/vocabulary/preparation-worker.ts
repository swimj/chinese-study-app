import { WordPreparationProviderError, PREPARATION_PROVIDER_BACKOFF_MS } from '../word-content/provider-failure.ts';
import { getHostedServiceControls } from '../db/hosted-operations.ts';
import { HostedProviderWorkUnavailableError,runHostedProviderWork } from '../hosted-runtime-controls.ts';
import { createVocabularyPracticePreparation,type VocabularyPracticeProvider } from './preparation.ts';

/** Durable general-pool authoring. Only worker dispatch awaits providers; live sessions keep using ready content.
 * Provider calls are fenced by hosted controls; late returns cannot publish during maintenance or shutdown. */
export function createVocabularyPracticeWorker(options: {
  provider?: VocabularyPracticeProvider;
  ensureDefaults?:NonNullable<Parameters<typeof createVocabularyPracticePreparation>[0]>['ensureDefaults'];
  now?: () => number;
  concurrency?: number;
  pollMs?: number;
  demand?: () => string[];
  controls?: () => { maintenanceMode: boolean; providerWorkEnabled: boolean };
  providerWork?: <T>(work:()=>Promise<T>)=>Promise<T>;
  onError?: (error:unknown)=>void;
} = {}) {
  const now=options.now??Date.now,controls=options.controls??getHostedServiceControls;
  const providerWork=options.providerWork??runHostedProviderWork,demand=options.demand??(()=>[]);
  const concurrency=options.concurrency??1,pollMs=options.pollMs??5_000;
  if(!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>3)throw new Error('Practice preparation concurrency must be 1–3');
  if(!Number.isSafeInteger(pollMs)||pollMs<10)throw new Error('Invalid preparation poll interval');
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,stepping:Promise<boolean>|null=null,draining:Promise<void>|null=null;
  let providerBackoffUntil = 0;
  function allowed():boolean {const state=controls();return !stopped&&!state.maintenanceMode&&state.providerWorkEnabled;}
  // Pausing new dispatch must not reject an already-running sibling's valid publication.
  function canDispatch(): boolean { return allowed() && now() >= providerBackoffUntil; }
  const preparation=createVocabularyPracticePreparation({provider:options.provider,ensureDefaults:options.ensureDefaults,now:()=>new Date(now()).toISOString(),canPublish:allowed});
  async function process(workId:string):Promise<boolean> {
    try {
      return await providerWork(async()=>{
        if(!canDispatch()||!preparation.isConfigured())return false;
        if(!await preparation.preflight(workId))return true;
        const token=preparation.claim(workId);if(!token)return false;
        try{await preparation.run(workId,token);}
        catch(error){
          if(error instanceof WordPreparationProviderError && error.providerWide) providerBackoffUntil = now() + PREPARATION_PROVIDER_BACKOFF_MS;
          options.onError?.(new Error('Vocabulary practice preparation failed; inspect its durable job and invocation'));
        }
        return true;
      });
    }catch(error){if(error instanceof HostedProviderWorkUnavailableError)return false;throw error;}
  }
  async function runStep():Promise<boolean> {
    if(stopped||controls().maintenanceMode)return false;
    preparation.recoverExpired();
    for(const wordId of demand())preparation.ensure(wordId);
    if(!canDispatch()||!preparation.isConfigured())return false;
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
    draining=(async()=>{while(!stopped&&await step()){/* Only due queued work; delayed retries wait for the next poll. */}})().finally(()=>{draining=null;});
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
