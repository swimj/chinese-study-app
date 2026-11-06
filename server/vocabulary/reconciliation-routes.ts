import type { Express, Request, Response } from 'express';
import { createOperatorAllowlistMiddleware } from '../operator-access.ts';
import { getSenseContentReconciliationWorkspace, listSenseContentReconciliationWords, saveSenseContentReconciliation,
  applySenseContentReconciliation, retrySenseContentReconciliation } from '../db/sense-content-reconciliation.ts';
import type { SenseContentReconciliationSave } from '../../src/domain/sense-content-reconciliation.ts';

class InvalidRequest extends Error {}
function object(value:unknown,keys:string[]):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw new InvalidRequest('Expected an object with supported fields');
  return value as Record<string,unknown>;
}
function text(value:unknown):string {if(typeof value!=='string'||!value.trim())throw new InvalidRequest('Expected nonempty text');return value;}
function version(value:unknown):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)throw new InvalidRequest('Expected a positive version');return value;}
export function registerSenseContentReconciliationRoutes(app:Express,options:{wake?:()=>void}={}):void {
  const base='/api/operator/vocabulary/reconciliation',gate=createOperatorAllowlistMiddleware();
  const handle=(work:(req:Request,actor:string)=>unknown)=>(req:Request,res:Response)=>{
    try{res.json(work(req,res.locals.operatorSubject as string));}
    catch(error){
      const status=error instanceof InvalidRequest?400:error instanceof Error&&'status' in error&&typeof error.status==='number'?error.status:500;
      res.status(status).json({error:status===500?'Sense reconciliation failed.':error instanceof Error?error.message:'Sense reconciliation failed.'});
    }
  };
  app.get(base,gate,handle((_req,actor)=>listSenseContentReconciliationWords(actor)));
  app.get(`${base}/:wordId`,gate,handle((req,actor)=>getSenseContentReconciliationWorkspace(text(req.params.wordId),actor)));
  app.post(`${base}/:wordId`,gate,handle((req,actor)=>{
    const input=object(req.body,['expectedVersion','status','draft','refreshSource']);
    if(input.expectedVersion!==null)version(input.expectedVersion);
    if(input.status!=='draft'&&input.status!=='resolved')throw new InvalidRequest('Expected draft or resolved status');
    if(input.refreshSource!==undefined&&typeof input.refreshSource!=='boolean')throw new InvalidRequest('Expected a source refresh flag');
    // Domain validation owns the full linguistic decision and reference checks.
    return saveSenseContentReconciliation(text(req.params.wordId),input as SenseContentReconciliationSave,actor);
  }));
  app.post(`${base}/:wordId/apply`,gate,handle((req,actor)=>{
    const input=object(req.body,['expectedVersion','planFingerprint']);
    const result=applySenseContentReconciliation(text(req.params.wordId),{expectedVersion:version(input.expectedVersion),planFingerprint:text(input.planFingerprint)},actor);
    options.wake?.();return result;
  }));
  app.post(`${base}/:wordId/retry`,gate,handle((req,actor)=>{
    object(req.body??{},[]);const result=retrySenseContentReconciliation(text(req.params.wordId),actor);options.wake?.();return result;
  }));
}
