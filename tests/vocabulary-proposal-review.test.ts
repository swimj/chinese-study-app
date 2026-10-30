import { vocabularyPhraseClozeError } from '../src/domain/vocabulary-production-coverage.ts';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {VocabularyProposalOperation,VocabularySenseLabel} from '../src/domain/vocabulary-reflection.ts';
import {editableProposalDraft,selectedProposalDraft,consequentialContentChanges,editableCue,updateCue,groupOperations,readableSenseProse,selectedOperations,toggleOperation,sourceConsequences} from '../src/features/vocabulary-operator/proposal-review.ts';
const senses:VocabularySenseLabel[]=[{senseId:'12345678-1111-4000-8000-111111111111',wordId:'word',label:'formal correspondence'},{senseId:'23456789-1111-4000-8000-111111111111',wordId:'word',label:'envelope'}];
function operation(key='first'):VocabularyProposalOperation{return {operationKey:key,strategy:'replace',sourceContentId:'source',expectedVersion:1,scope:{kind:'shared'},rationale:'Faithful repair',content:{contentId:`content-${key}`,kind:'exercise',payloadVersion:1,body:{prompt:'A letter',reveal:{note:'Retain this editorial note'},source:{kind:'original'}},accessScope:'shared',availability:'active',originKind:'human',exerciseType:'definition',skill:'production',exerciseRole:'general',assessment:{match:'exact'},words:[{wordId:'word',relation:'target',senseId:senses[0]!.senseId}],answers:[{wordId:'word',acceptedForms:['函']}]}};}
test('grouping keeps one readable heading per sense and preserves unmapped practice',()=>{
 const first=operation(),second=operation('second'),third=operation('third');third.content.words=[{wordId:'word',relation:'target'}];
 assert.deepEqual(groupOperations([first,second,third],senses).map(group=>({label:group.label,keys:group.operations.map(item=>item.operationKey)})),[{label:'formal correspondence',keys:['first','second']},{label:'General practice',keys:['third']}]);
});
test('known sense identifiers become readable prose without ambiguous or incidental replacements',()=>{
 assert.equal(readableSenseProse(`Map ${senses[0]!.senseId} and 23456789.`,senses),'Map formal correspondence and envelope.');
 assert.equal(readableSenseProse('Token x12345678 and 12345678-extra.',senses),'Token x12345678 and 12345678-extra.');
 assert.equal(readableSenseProse('12345678',[...senses,{senseId:'12345678-2222-4000-8000-222222222222',wordId:'word',label:'other'}]),'12345678');
 assert.equal(readableSenseProse('Use a+b.',[{senseId:'a+b',wordId:'word',label:'exact match'}]),'Use exact match.');
});
test('inclusion toggles preserve edited drafts, restore them, and expose source retention',()=>{
 const edited={...operation(),content:updateCue(operation().content,{kind:'direct_text',text:'Edited cue'})};const pool=[edited];
 const excluded=toggleOperation(new Set(),'first');assert.deepEqual(selectedOperations(pool,excluded),[]);assert.deepEqual(sourceConsequences(pool,excluded),[{sourceContentId:'source',retired:false}]);
 assert.equal(editableCue(selectedOperations(pool,toggleOperation(excluded,'first'))[0]!.content)?.text,'Edited cue');
 assert.deepEqual(sourceConsequences(pool,new Set()),[{sourceContentId:'source',retired:true}]);
});
test('structured cue editing synchronizes rendered prompt and preserves authored metadata',()=>{
 const original=operation().content;
 const legacy=updateCue(original,{kind:'direct_text',text:'Edited legacy prompt'});assert.deepEqual(legacy.body,{...(original.body as object),prompt:'Edited legacy prompt'});assert.equal(Object.hasOwn(legacy.body as object,'stimulus'),false);
 const cloze={...original,body:{prompt:'Old frame\n旧____',stimulus:{kind:'phrase_cloze',frame:'Old frame',text:'旧____'},reveal:{note:'Keep'},source:{kind:'original'}}};
 const edited=updateCue(cloze,{kind:'phrase_cloze',frame:'A formal letter',text:'请查收此____。'});
 assert.deepEqual(edited.body,{prompt:'A formal letter\n请查收此____。',stimulus:{kind:'phrase_cloze',frame:'A formal letter',text:'请查收此____。'},reveal:{note:'Keep'},source:{kind:'original'}});
 assert.deepEqual(editableCue(edited),{kind:'phrase_cloze',frame:'A formal letter',text:'请查收此____。'});assert.throws(()=>updateCue(edited,{kind:'direct_text',text:'Kind change'}),/preserves the stimulus kind/);
 const unsupported={...original,body:{prompt:'Original',stimulus:{kind:'example_cloze',exampleId:'example'}}};assert.equal(editableCue(unsupported),null);assert.throws(()=>updateCue(unsupported,{kind:'direct_text',text:'Changed'}),/full authored/);
});

test('malformed hand-edited drafts fall back before compact rendering',()=>{
 const draft={rationale:'Review',operations:[operation()]};assert.equal(editableProposalDraft(draft),true);
 for(const content of [null,1,[],{kind:'exercise',body:{},answers:[]},{...operation().content,words:null},{...operation().content,words:[null]}])assert.equal(editableProposalDraft({...draft,operations:[{...operation(),content}]}),false);
 for(const scope of [null,'shared',[],{kind:'learner'}])assert.equal(editableProposalDraft({...draft,operations:[{...operation(),scope}]}),false);
 assert.equal(editableProposalDraft({...draft,operations:[{...operation(),expectedVersion:'1'}]}),false);
 assert.equal(editableProposalDraft({...draft,operations:Array(1)}),false);
});
test('phrase cloze editing requires exactly one blank without rejecting legacy prompts',()=>{
 for(const text of ['没有空格','____ 和 ____','________','_____','___ ____'])assert.match(vocabularyPhraseClozeError({stimulus:{kind:'phrase_cloze',text}})!,/exactly one/);
 assert.equal(vocabularyPhraseClozeError({stimulus:{kind:'phrase_cloze',frame:'A letter',text:'此____已收到。'}}),null);
 assert.equal(vocabularyPhraseClozeError({prompt:'Legacy unstructured cue'}),null);
});
test('the compact review signals answer criteria and reveal changes when the cue is unchanged',()=>{
 const source=operation().content;assert.equal(source.kind,'exercise');if(source.kind!=='exercise')throw new Error('Expected exercise fixture');
 const result={...source,assessment:{match:'semantic'},body:{...(source.body as object),reveal:{note:'New learning explanation'}}};
 assert.deepEqual(consequentialContentChanges(source,result),['answer criteria','reveal']);assert.deepEqual(consequentialContentChanges(null,result),[]);
});
test('excluding a source operation preserves explicit assessment evidence bases',()=>{
 const draft={rationale:'Retain the assessed source as evidence',operations:[operation(),{...operation('extra'),strategy:'create' as const}],bases:[{contentId:'source',expectedVersion:1}]};
 const selected=selectedProposalDraft(draft,new Set(['first']));assert.deepEqual(selected.operations.map(op=>op.operationKey),['extra']);assert.deepEqual(selected.bases,draft.bases);
});
