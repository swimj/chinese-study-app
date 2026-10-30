import { VocabularySenseMappingUnavailable } from './sense-mapping-retry.ts';
import { VocabularySenseReadinessPending } from './sense-readiness.ts';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.ts';
import { runWithLearnerId } from '../db/learner-context.ts';
import { listDueVocabularySessionCompletions, closeVocabularySessionCompletion } from '../db/vocabulary-sessions.ts';
import { ingestVocabularySessionEvidence, claimVocabularyReflectionJob, recoverVocabularyReflectionJobs,
  finishVocabularyReflectionJob, failVocabularyReflectionJob, failVocabularySenseMappingCall, deferVocabularyReflectionForSense, recoverVocabularySenseDependencies, VocabularyReflectionConflict } from '../db/vocabulary-reflection.ts';
import { getHostedServiceControls } from '../db/hosted-operations.ts';
import { runHostedProviderWork, HostedProviderWorkUnavailableError } from '../hosted-runtime-controls.ts';
import type { VocabularySessionProjection } from '../../src/domain/vocabulary-session.ts';
import { createVocabularyReflectionProvider, VocabularyReflectionOutputError, type VocabularyReflectionProvider } from './reflection-provider.ts';

/** Closure/ingestion are local durable work. Provider calls are independent per case kind. */
export function createVocabularyProcessingWorker(options:{provider?:VocabularyReflectionProvider;now?:()=>number;pollMs?:number;
  controls?:()=>{maintenanceMode:boolean;providerWorkEnabled:boolean};providerWork?:<T>(work:()=>Promise<T>)=>Promise<T>;
  onError?:(error:unknown)=>void}={}) {
  const provider=options.provider??createVocabularyReflectionProvider(),now=options.now??Date.now;
  const controls=options.controls??getHostedServiceControls,providerWork=options.providerWork??runHostedProviderWork;
  const iso=()=>new Date(now()).toISOString();
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
  const flights=new Map<'learner_feedback'|'exercise_improvement',Promise<boolean>>();
  function localWork():boolean {
    if(stopped||controls().maintenanceMode)return false;
    let changed=false;
    for(const completion of listDueVocabularySessionCompletions(iso())) {
      const learner=getDb().prepare('SELECT disabled_at FROM learners WHERE learner_id=?').get(completion.learnerId) as {disabled_at:string|null}|undefined;
      if(!learner||learner.disabled_at!==null)continue;
      try{runWithLearnerId(completion.learnerId,()=>closeVocabularySessionCompletion(completion.sessionId,completion.completionId,iso()));changed=true;}
      catch{options.onError?.(new Error('Vocabulary completion failed'));}
    }
    const expired=getDb().prepare(`UPDATE vocabulary_post_session_dispatches SET status='failed',active_token=NULL,expires_at=NULL,
      last_error='ingestion_interrupted' WHERE status='running' AND expires_at<=?`).run(iso());
    changed||=expired.changes>0;
    const senseRecovered=recoverVocabularySenseDependencies(iso());changed=senseRecovered>0||changed;
    const recovered=recoverVocabularyReflectionJobs(iso());changed=recovered>0||changed;
    const dispatches=getDb().prepare(`SELECT d.* FROM vocabulary_post_session_dispatches d JOIN learners l ON l.learner_id=d.learner_id
      WHERE d.status='queued' AND l.disabled_at IS NULL ORDER BY d.created_at,d.dispatch_id`).all() as {
        dispatch_id:string;learner_id:string;completion_id:string;evidence_json:string}[];
    for(const dispatch of dispatches) {
      const token=randomUUID();
      const claimed=getDb().prepare(`UPDATE vocabulary_post_session_dispatches SET status='running',active_token=?,expires_at=?
        WHERE dispatch_id=? AND status='queued'`).run(token,new Date(now()+60_000).toISOString(),dispatch.dispatch_id);
      if(claimed.changes!==1)continue;
      try {
        const evidence=JSON.parse(dispatch.evidence_json) as {projection:VocabularySessionProjection};
        const cases=ingestVocabularySessionEvidence(dispatch.learner_id,dispatch.completion_id,evidence.projection,iso());
        getDb().prepare(`UPDATE vocabulary_post_session_dispatches SET status='succeeded',active_token=NULL,expires_at=NULL,
          last_error=NULL,result_json=? WHERE dispatch_id=? AND active_token=?`).run(JSON.stringify({caseIds:cases}),dispatch.dispatch_id,token);
      }catch{getDb().prepare(`UPDATE vocabulary_post_session_dispatches SET status='failed',active_token=NULL,expires_at=NULL,
        last_error='evidence_ingestion_failed' WHERE dispatch_id=? AND active_token=?`).run(dispatch.dispatch_id,token);}
      changed=true;
    }
    return changed;
  }
  async function runKind(kind:'learner_feedback'|'exercise_improvement'):Promise<boolean> {
    try{return await providerWork(async()=>{
      if(stopped||controls().maintenanceMode||!controls().providerWorkEnabled||!provider.isConfigured())return false;
      const work=claimVocabularyReflectionJob({kind,now:iso(),leaseMs:30*60_000});
      if(!work)return false;
      try {
        const canPublish=()=>{
          const state=controls();
          if(stopped||state.maintenanceMode||!state.providerWorkEnabled)return false;
          const lease=getDb().prepare(`SELECT 1 FROM vocabulary_reflection_jobs j JOIN reflection_cases c ON c.case_id=j.case_id
            JOIN learners l ON l.learner_id=c.learner_id WHERE j.job_id=? AND j.status='running'
            AND j.lease_token=? AND j.lease_expires_at>? AND l.disabled_at IS NULL`).get(work.jobId,work.leaseToken,iso());
          return !!lease;
        };
        const result=await provider.run(work,{canPublish});
        if(result.kind!==work.kind)throw new VocabularyReflectionOutputError('Reflection result kind mismatch');
        // A maintenance window freezes domain mutations even if an earlier call returns.
        const learner=getDb().prepare('SELECT disabled_at FROM learners WHERE learner_id=?').get(work.learnerId) as {disabled_at:string|null}|undefined;
        if(!canPublish()||!learner||learner.disabled_at!==null) {
          failVocabularyReflectionJob(work.jobId,work.leaseToken,'provider_result_deferred',iso(),iso());return true;
        }
        finishVocabularyReflectionJob(work.jobId,work.leaseToken,result,iso());
      }catch(error){
        // Expired leases have already been fenced as unknown outcome. Never revive them.
        try{
          if(error instanceof VocabularySenseReadinessPending)deferVocabularyReflectionForSense(work.jobId,work.leaseToken,error.retryAt,iso());
          else if(error instanceof VocabularySenseMappingUnavailable)failVocabularySenseMappingCall(work.jobId,work.leaseToken,iso());
          else failVocabularyReflectionJob(work.jobId,work.leaseToken,error instanceof VocabularyReflectionConflict?'source_conflict':error instanceof VocabularyReflectionOutputError?'invalid_output':'provider_failed',iso(),iso());
        }
        catch(stale){if(!(stale instanceof VocabularyReflectionConflict))throw stale;}
      }
      return true;
    });}catch(error){if(error instanceof HostedProviderWorkUnavailableError)return false;throw error;}
  }
  async function step():Promise<boolean> {
    const localChanged=localWork();
    if(stopped||controls().maintenanceMode||!controls().providerWorkEnabled||!provider.isConfigured())return Promise.resolve(localChanged);
    const started:Promise<boolean>[]=[];
    for(const kind of ['learner_feedback','exercise_improvement'] as const) {
      if(flights.has(kind))continue;
      const flight=runKind(kind).finally(()=>{flights.delete(kind);});flights.set(kind,flight);started.push(flight);
    }
    return Promise.allSettled(started).then(results=>{
      let changed=localChanged;
      for(const result of results)if(result.status==='fulfilled')changed||=result.value;else options.onError?.(new Error('Vocabulary processing worker failed'));
      return changed;
    });
  }
  function wake():void {
    if(stopped)return;
    if(timer)clearTimeout(timer);
    // Timer cadence continues local finalization while a provider call is in flight.
    timer=setTimeout(wake,options.pollMs??500);timer.unref();
    void step().catch(()=>options.onError?.(new Error('Vocabulary processing worker failed')));
  }
  return {step,wake,async stop(){stopped=true;if(timer)clearTimeout(timer);await Promise.allSettled([...flights.values()]);}};
}
