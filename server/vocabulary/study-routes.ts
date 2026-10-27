import { getVocabularyWordsCollection } from '../db/vocabulary-words.ts';
import type { Express, Request, Response } from 'express';
import { startVocabularyStudy, previewVocabularyStudy, getVocabularyStudy, nextVocabularyExercise, commandVocabularyStudy } from './study.ts';
import { stageVocabularySessionCompletion, getVocabularySessionCompletion, cancelVocabularySessionCompletion,
  closeVocabularySessionCompletion, getCurrentVocabularyPendingCompletionSessionId, VocabularySessionInputError, VocabularySessionConflictError,
  VocabularySessionNotFoundError } from '../db/vocabulary-sessions.ts';
import { changeVocabularyMode, addVocabularyWord, requestVocabularyRefresh, listVocabularyLearnerWords, dismissVocabularyWord,
  VocabularyStateConflict, VocabularyStateInputError, VocabularyStateNotFoundError } from '../db/vocabulary-learners.ts';
import type { VocabularyStudyCommand } from '../../src/domain/vocabulary-study-api.ts';
import type { VocabularyWordMode } from '../../src/domain/vocabulary-session.ts';
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new VocabularySessionInputError('Expected an object');
  return value as Record<string,unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new VocabularySessionInputError('Expected a valid identifier');
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new VocabularySessionInputError('Expected a nonnegative integer');
  return value;
}
function mode(value: unknown): VocabularyWordMode {
  if (!['unstudied','solidify','practice','maintain'].includes(String(value))) throw new VocabularySessionInputError('Unknown mode');
  return value as VocabularyWordMode;
}
export function parseVocabularyPreviewSeed(value:unknown):string|undefined {
  if(value===undefined)return undefined;
  if(typeof value!=='string'||value.length!==36||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new VocabularySessionInputError('Invalid session preview seed');
  }
  return value;
}
export function parseVocabularyStudyCommand(value: unknown): VocabularyStudyCommand {
  const b = record(value); const type = text(b.type);
  switch(type) {
    case 'response':
      if (b.response !== null && (typeof b.response !== 'string' || b.response.length > 4000)) throw new VocabularySessionInputError('Invalid response');
      if (b.selfAssessment !== undefined && b.selfAssessment !== 'accepted' && b.selfAssessment !== 'rejected') throw new VocabularySessionInputError('Invalid recognition rating');
      return {type,response:b.response as string|null,...(b.selfAssessment ? {selfAssessment:b.selfAssessment as 'accepted'|'rejected'}:{}),...(b.selectedWordId===undefined?{}:{selectedWordId:text(b.selectedWordId)})};
    case 'feedback':
      if (!['positive','negative','comment','withdrawn'].includes(String(b.feedback)) || (b.comment !== undefined && (typeof b.comment !== 'string' || b.comment.length > 8000))) throw new VocabularySessionInputError('Invalid reaction');
      return {type,feedback:b.feedback as 'positive'|'negative'|'comment'|'withdrawn',...(b.comment !== undefined ? {comment:b.comment as string}:{})};
    case 'skip':
      if (b.scope !== undefined && b.scope !== 'exercise' && b.scope !== 'word') throw new VocabularySessionInputError('Invalid skip scope');
      return {type,scope:b.scope as 'exercise'|'word'|undefined};
    case 'mode': return {type,mode:mode(b.mode),...(b.wordId === undefined ? {} : {wordId:text(b.wordId)})};
    case 'more': return {type,...(b.wordId === undefined ? {} : {wordId:text(b.wordId)})};
    case 'requeue': return {type,wordId:text(b.wordId)};
    case 'enough': case 'undo': case 'resume': case 'finishForNow': case 'finishImmediately': return {type};
    default: throw new VocabularySessionInputError('Unsupported vocabulary command');
  }
}
export function registerVocabularyStudyRoutes(app: Express, wake: () => void = () => {}): void {
  const handle = (fn: (req:Request) => unknown) => (req:Request,res:Response) => {
    try { const result=fn(req); wake(); res.json(result); }
    catch(error) {
      const status=error instanceof VocabularySessionInputError || error instanceof VocabularyStateInputError ? 400
        : error instanceof VocabularySessionConflictError || error instanceof VocabularyStateConflict ? 409
        : error instanceof VocabularySessionNotFoundError || error instanceof VocabularyStateNotFoundError ? 404 : 500;
      if (status===500) console.error('Vocabulary operation failed',error);
      res.status(status).json({error:status===500?'This study action could not be saved. Please retry.':(error as Error).message});
    }
  };
  app.get('/api/vocabulary/session-preview',handle(()=>previewVocabularyStudy()));
  app.post('/api/vocabulary/sessions',handle(req=>startVocabularyStudy({previewSeed:parseVocabularyPreviewSeed(record(req.body??{}).previewSeed)})));
  app.get('/api/vocabulary/sessions/:id',handle(req=>getVocabularyStudy(req.params.id)));
  app.post('/api/vocabulary/sessions/:id/next',handle(req=>{
    const b=record(req.body); if(b.another!==undefined&&typeof b.another!=='boolean') throw new VocabularySessionInputError('Invalid another flag');
    return nextVocabularyExercise(req.params.id,text(b.clientActionId),{...(b.wordId===undefined?{}:{wordId:text(b.wordId)}),...(b.another===undefined?{}:{another:b.another as boolean})});
  }));
  app.post('/api/vocabulary/sessions/:id/commands',handle(req=>{
    const b=record(req.body);return commandVocabularyStudy(req.params.id,text(b.clientActionId),parseVocabularyStudyCommand(b.command));
  }));
  app.post('/api/vocabulary/sessions/:id/completion',handle(req=>{const b=record(req.body);return stageVocabularySessionCompletion(req.params.id,integer(b.throughSequence),undefined,b.activeDurationMs===undefined?{}:{activeDurationMs:integer(b.activeDurationMs)});}));
  app.get('/api/vocabulary/sessions/:id/completion',handle(req=>getVocabularySessionCompletion(req.params.id)));
  app.post('/api/vocabulary/sessions/:id/completion/cancel',handle(req=>cancelVocabularySessionCompletion(req.params.id,text(record(req.body).completionId))));
  app.post('/api/vocabulary/sessions/:id/completion/close',handle(req=>closeVocabularySessionCompletion(req.params.id,text(record(req.body).completionId))));
  app.get('/api/vocabulary/completion/current',handle(()=>{
    const sessionId=getCurrentVocabularyPendingCompletionSessionId();
    return sessionId?getVocabularyStudy(sessionId):null;
  }));
  app.get('/api/vocabulary/words',handle(()=>({words:listVocabularyLearnerWords()})));
  app.get('/api/vocabulary/word-collection',handle(req=>{
    const {view='recent',q='',mode:filters='',lapses='0',limit='50',offset='0'}=req.query;
    if((view!=='recent'&&view!=='personal'&&view!=='deck') || typeof q!=='string' || typeof filters!=='string'
      || (lapses!=='0'&&lapses!=='1') || typeof limit!=='string' || !/^\d+$/.test(limit)
      || typeof offset!=='string' || !/^\d+$/.test(offset)) throw new VocabularyStateInputError('Invalid word collection filters');
    return getVocabularyWordsCollection({view,query:q,modes:filters?filters.split(',').map(mode):[],recentLapses:lapses==='1',limit:Number(limit),offset:Number(offset)});
  }));
  app.post('/api/vocabulary/words/:id',handle(req=>addVocabularyWord(req.params.id)));
  app.post('/api/vocabulary/words/:id/mode',handle(req=>{const b=record(req.body);return changeVocabularyMode(req.params.id,mode(b.mode),integer(b.expectedVersion));}));
  app.post('/api/vocabulary/words/:id/refresh',handle(req=>requestVocabularyRefresh(req.params.id)));
  app.post('/api/vocabulary/words/:id/dismiss',handle(req=>dismissVocabularyWord(req.params.id)));
}
