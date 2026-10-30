import type { VocabularyContentDraft,VocabularyJson } from '../../domain/vocabulary-content';
import type { VocabularyProposalDraft,VocabularyProposalOperation,VocabularySenseLabel } from '../../domain/vocabulary-reflection';

export type EditableCue={kind:'direct_text';text:string}|{kind:'phrase_cloze';frame:string;text:string};
function object(value:VocabularyJson):Record<string,VocabularyJson>|null{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value:null;}
export function editableCue(content:VocabularyContentDraft):EditableCue|null {
  const body=object(content.body);if(!body)return null;
  const stimulus=body.stimulus===undefined?null:object(body.stimulus);
  if(stimulus?.kind==='phrase_cloze'&&typeof stimulus.frame==='string'&&typeof stimulus.text==='string')return {kind:'phrase_cloze',frame:stimulus.frame,text:stimulus.text};
  if(stimulus?.kind==='direct_text'&&typeof stimulus.text==='string')return {kind:'direct_text',text:stimulus.text};
  // Other structured stimulus kinds require their own authoring contract.
  if(body.stimulus!==undefined)return null;
  return typeof body.prompt==='string'?{kind:'direct_text',text:body.prompt}:null;
}
export function updateCue(content:VocabularyContentDraft,cue:EditableCue):VocabularyContentDraft {
  const previous=editableCue(content);if(!previous)throw new Error('This cue needs the full authored draft editor');
  if(previous.kind!==cue.kind)throw new Error('Structured cue editing preserves the stimulus kind');
  const body=object(content.body)!;
  return {...content,body:{...body,prompt:cue.kind==='phrase_cloze'?`${cue.frame}\n${cue.text}`:cue.text,...(body.stimulus===undefined?{}:{stimulus:{...cue}})}};
}
export function operationScope(operation:VocabularyProposalOperation):string{return operation.scope.kind==='shared'?'Shared content':`Private content · learner ${operation.scope.learnerId}`;}
export function operationAnswers(operation:VocabularyProposalOperation):string {
  return operation.content.kind==='exercise'?operation.content.answers.map(answer=>answer.acceptedForms.join(' / ')).join(' · '):'';
}
export function selectedOperations(operations:readonly VocabularyProposalOperation[],excluded:ReadonlySet<string>):VocabularyProposalOperation[]{return operations.filter(operation=>!excluded.has(operation.operationKey));}
export function toggleOperation(excluded:ReadonlySet<string>,key:string):Set<string>{const next=new Set(excluded);if(next.has(key))next.delete(key);else next.add(key);return next;}
export function readableSenseProse(text:string,senses:readonly VocabularySenseLabel[]):string {
  // Match complete IDs and observed shortened UUIDs. Ambiguous prefixes remain unchanged.
  const references=new Map<string,string|null>();
  for(const sense of senses)for(const key of [sense.senseId,...(/^[0-9a-f]{8}-/i.test(sense.senseId)?[sense.senseId.slice(0,8)]:[])]) {
    const previous=references.get(key);references.set(key,previous===undefined||previous===sense.label?sense.label:null);
  }
  const keys=[...references.keys()].sort((a,b)=>b.length-a.length);if(!keys.length)return text;
  const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const expression=new RegExp(`(?<![\\w-])(?:${keys.map(escape).join('|')})(?![\\w-])`,'g');
  return text.replace(expression,id=>references.get(id)??id);
}
export type OperationGroup={key:string;label:string;operations:VocabularyProposalOperation[]};
export function groupOperations(operations:readonly VocabularyProposalOperation[],senses:readonly VocabularySenseLabel[]):OperationGroup[] {
  const labels=new Map(senses.map(sense=>[sense.senseId,sense.label]));const groups=new Map<string,OperationGroup>();
  for(const operation of operations){
    const ids=operation.content.words.filter(word=>word.relation==='target'&&word.senseId).map(word=>word.senseId!);
    const key=ids.length?[...ids].sort().join('|'):'unmapped';
    if(!groups.has(key))groups.set(key,{key,label:ids.length?ids.map(id=>labels.get(id)??'Sense label unavailable').join(' · '):'General practice',operations:[]});
    groups.get(key)!.operations.push(operation);
  }
  return [...groups.values()];
}
export function sourceConsequences(operations:readonly VocabularyProposalOperation[],excluded:ReadonlySet<string>):{sourceContentId:string;retired:boolean}[] {
  const sources=new Map<string,boolean>();
  for(const operation of operations)if(operation.strategy==='replace'||operation.strategy==='retire')sources.set(operation.sourceContentId,!excluded.has(operation.operationKey));
  return [...sources].map(([sourceContentId,retired])=>({sourceContentId,retired}));
}

/** A hand-edited draft must support every field used by the compact renderer. */
export function editableProposalDraft(value:unknown):value is VocabularyProposalDraft {
  const record=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
  const list=(value:unknown,valid:(entry:unknown)=>boolean):boolean=>Array.isArray(value)&&Array.from(value).every(valid);
  const string=(value:unknown):value is string=>typeof value==='string';
  const positive=(value:unknown):boolean=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
  const item=record(value);if(!item||!string(item.rationale)||!Array.isArray(item.operations))return false;
  if(item.bases!==undefined&&!list(item.bases,value=>{const base=record(value);return !!base&&string(base.contentId)&&positive(base.expectedVersion);}))return false;
  return list(item.operations,value=>{
    const op=record(value);if(!op||!string(op.operationKey)||!string(op.rationale)||!['create','update_existing','replace','retire'].includes(String(op.strategy)))return false;
    if(op.strategy!=='create'&&(!string(op.sourceContentId)||!positive(op.expectedVersion)))return false;
    const scope=record(op.scope),content=record(op.content);if(!scope||!content||!['shared','learner'].includes(String(scope.kind))||(scope.kind==='learner'&&!string(scope.learnerId)))return false;
    if(!('body' in content)||!list(content.words,value=>{const word=record(value);return !!word&&string(word.wordId)&&['target','context'].includes(String(word.relation))&&(word.senseId==null||string(word.senseId));}))return false;
    if(content.kind==='introduction')return list(content.teachingExercises,value=>{const binding=record(value);return !!binding&&string(binding.exerciseId)&&positive(binding.exerciseVersion);});
    return content.kind==='exercise'&&list(content.answers,value=>{const answer=record(value);return !!answer&&string(answer.wordId)&&list(answer.acceptedForms,string);});
  });
}

/** Explicit bases also express assessment evidence; item toggles do not erase that evidence. */
export function selectedProposalDraft(draft:VocabularyProposalDraft,excluded:ReadonlySet<string>):VocabularyProposalDraft {
  return {...draft,operations:selectedOperations(draft.operations,excluded)};
}

export function consequentialContentChanges(source:VocabularyContentDraft|null,result:VocabularyContentDraft):string[] {
  if(!source)return [];
  const before=object(source.body)??{},after=object(result.body)??{},changed:string[]=[];
  const differs=(left:unknown,right:unknown)=>JSON.stringify(left)!==JSON.stringify(right);
  if(differs(source.kind==='exercise'?source.assessment:null,result.kind==='exercise'?result.assessment:null))changed.push('answer criteria');
  if(differs(before.reveal,after.reveal))changed.push('reveal');
  if(differs(source.kind==='exercise'?source.answers:null,result.kind==='exercise'?result.answers:null))changed.push('expected answers');
  if(differs(before.instruction,after.instruction))changed.push('instructions');
  return changed;
}
