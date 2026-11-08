import {isDeepStrictEqual} from 'node:util';
import type {JsonSchema} from '../../src/domain/reflection-result-schema.ts';

export type FlowContract = 'baseline' | 'candidate';
export type TrialWord = {wordId:string;hanzi:string;traditional:string|null;pinyin:string;meaning:string};
export type SharedCandidate = {answers:string[];prompt:string;rationale:string;teachingNote?:string};
export type TrialSingleOutput = {summary:string;source:{decision:'keep'|'revise'|'retire';prompt:string|null};sharedExercise:SharedCandidate|null;
  additionalExercises:{answer:string;role:'refinement'|'enrichment';prompt:string;rationale:string}[]};
export type TrialIntegrationOutput = {decision:'reuse'|'extend'|'create';rationale:string;existingContentId:string|null;prompt?:string|null;semanticAxis:string|null;teachingNote:string|null};
export type PureCueFlowCase = {id:string;kind:'chain'|'integration';words:TrialWord[];sourcePrompt:string;intendedSense:string;
  comment?:string;existingCues:ReturnType<typeof cue>[];fixedCandidate?:SharedCandidate;reviewFocus:string[]};
const text:JsonSchema={type:'string'},nullable:JsonSchema={type:['string','null']};
const object=(properties:Record<string,JsonSchema>):JsonSchema=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
/** Frozen trial contracts. Baseline is 8b3f0aa1, independent of future runtime schemas. */
export function pureCueFlowSchemas(contract:FlowContract):{single:JsonSchema;integration:JsonSchema} {
  const shared=object({answers:{type:'array',items:text,minItems:2,maxItems:8},prompt:text,...(contract==='baseline'?{teachingNote:text}:{}),rationale:text});
  return {single:object({summary:text,source:object({decision:{type:'string',enum:['keep','revise','retire']},prompt:nullable}),sharedExercise:{anyOf:[{type:'null'},shared]},
    additionalExercises:{type:'array',items:object({answer:text,role:{type:'string',enum:['refinement','enrichment']},prompt:text,rationale:text})}}),
    integration:object({decision:{type:'string',enum:['reuse','extend','create']},rationale:text,existingContentId:nullable,...(contract==='candidate'?{prompt:nullable}:{}),semanticAxis:nullable,teachingNote:nullable})};
}
function word(hanzi:string,pinyin:string,meaning:string):TrialWord {return {wordId:`trial:${hanzi}`,hanzi,traditional:hanzi,pinyin,meaning};}
function cue(id:string,prompt:string,axis:string,note:string,members:TrialWord[]) {
  return {contentId:`trial-cue:${id}`,kind:'exercise',payloadVersion:1,body:{prompt,instruction:'',stimulus:{kind:'direct_text',text:prompt},reveal:{axisNote:axis,teachingNote:note}},
    exerciseType:'pure_cue',skill:'production',exerciseRole:'general',assessment:{match:'exact'},answers:members.map(w=>({wordId:w.wordId,acceptedForms:[w.hanzi]})),
    words:members.map(w=>({wordId:w.wordId,relation:'target'})),accessScope:'shared',ownerLearnerId:null,availability:'active',originKind:'model',authorKind:'service',authorId:'trial',
    version:1,createdAt:'2026-11-08T00:00:00.000Z',updatedAt:'2026-11-08T00:00:00.000Z'};
}
const scissors=[word('剪刀','jiǎndāo','scissors'),word('剪子','jiǎnzi','scissors; colloquial')];
const interrupt=[word('中断','zhōngduàn','interrupt; break off; discontinue'),word('打断','dǎduàn','interrupt; break into')];
const fashion=[word('时尚','shíshàng','fashion; fashionable style or trends'),word('服装','fúzhuāng','clothing; apparel')];
const dense=[word('稠密','chóumì','dense; closely packed'),word('密集','mìjí','dense; concentrated; closely spaced')];
const prohibition=[word('不许','bùxǔ','must not; not allow'),word('禁止','jìnzhǐ','prohibit; forbid')];
const other=[word('其他','qítā','other; additional'),word('别的','biéde','other; additional')],additional=word('另外的','lìngwàide','other; additional');
const unrelated=[word('无关','wúguān','unrelated; have nothing to do with'),word('没关系','méiguānxi','have no connection; it does not matter')];
const reason=[word('原因','yuányīn','reason; cause'),word('缘故','yuángù','reason; cause')];
/** Synthetic public-language cases. reviewFocus is for humans and is never sent to a provider. */
export function pureCueFlowCases():PureCueFlowCase[] {return [
  {id:'scissors-referent',kind:'chain',words:scissors,sourcePrompt:'A pair of scissors: 请给我一把____。',intendedSense:'The cutting tool with two pivoted blades.',existingCues:[],
    reviewFocus:['A simple shared referent is enough; nomination should not invent a narrow requesting-tools skill.','Final axis should name scissors without binding it to passing/requesting or the classifier scene.']},
  {id:'interruption-construction',kind:'chain',words:interrupt,sourcePrompt:'An interruption of our conversation: 突然响起的电话铃声____了我们的谈话。',intendedSense:'An ongoing conversation is interrupted.',existingCues:[],
    reviewFocus:['Retain the useful shared interruption construction without claiming universal synonymy.','No new target-only sentence should exclude the other word solely by collocational preference.']},
  {id:'fashion-apparel-overlap',kind:'chain',words:fashion,sourcePrompt:'Being interested in fashion or clothing and following the latest designs: 她对____很感兴趣，经常关注最新的设计。',intendedSense:'Fashion as a field, style, or trend.',existingCues:[],
    reviewFocus:['Single stage owns the judgment: fashion and apparel are related referents, not the same meaning merely because both follow 对.','A better-than-original shared sentence is not sufficient; inspect the practice the proposal builds. No integration veto should be needed.']},
  {id:'population-vs-timing',kind:'chain',words:dense,sourcePrompt:'Densely populated: 这个地区人口____。',intendedSense:'A dense distribution of population.',existingCues:[cue('dense-timing','The interviews are scheduled close together: 面试安排得很____。','Events scheduled close together in time.','密集 can describe a tightly packed schedule.',[dense[1]!])],
    reviewFocus:['Population overlap is useful; timing use must not determine the new axis or force inappropriate reuse.','Local source disposition and optional enrichment remain single-stage decisions; integration must not re-plan them.']},
  {id:'reuse-other-scene',kind:'integration',words:prohibition,sourcePrompt:'According to the rules, parking is not allowed here: 按照规定，这里____停车。',intendedSense:'Expressing that an action is prohibited.',
    fixedCandidate:{answers:['target','response_1'],prompt:'According to the rules, parking is not allowed here: 按照规定，这里____停车。',teachingNote:'不许 and 禁止 both say that the activity is not allowed; 禁止 is more formal.',rationale:'Both naturally express a prohibition on the activity.'},
    existingCues:[cue('no-smoking','Smoking is not allowed here: 这里____吸烟。','Prohibiting an action.','不许 is a direct prohibition; 禁止 is common in rules and signs.',prohibition)],
    reviewFocus:['Reuse should not require the same parking scene; the unchanged smoking cue practices the same prohibition and accepts both words.','Reuse changes no existing text.']},
  {id:'extend-retained-member',kind:'integration',words:other,sourcePrompt:'Any other questions? 你还有____问题吗？',intendedSense:'Other or additional things modifying a noun.',
    fixedCandidate:{answers:['target','response_1'],prompt:'Any other questions? 你还有____问题吗？',teachingNote:'其他 and 别的 can modify a noun meaning other or additional.',rationale:'Both express other or additional things in noun modification.'},
    existingCues:[cue('other-requests','Do you have any other requests? 你还有____要求吗？','Other or additional things, modifying a noun.','其他 and 另外的 introduce other or additional things; 另外的 includes 的.',[other[0]!,additional])],
    reviewFocus:['Extend the same instinct despite questions versus requests, retain 另外的 and every existing form.','Integrated teaching should account for 别的 without losing retained-member guidance.']},
  {id:'same-members-different-sense',kind:'integration',words:unrelated,sourcePrompt:'This matter has nothing to do with me: 这件事跟我____。',intendedSense:'A matter being unrelated to someone.',
    fixedCandidate:{answers:['target','response_1'],prompt:'This matter has nothing to do with me: 这件事跟我____。',teachingNote:'没关系 is colloquial; 无关 is more formal. Both express lack of connection here.',rationale:'Both express that the matter is unrelated to the person.'},
    existingCues:[cue('reassurance','It does not matter; do not worry: ____，别担心。','Reassuring someone that a problem does not matter.','没关系 can reassure someone after an apology.',[unrelated[1]!])],
    reviewFocus:['Create for unrelatedness rather than stretch a reassurance cue from word overlap.','Axis must retain the real unrelatedness boundary, without repeating the exact matter/person scene.']},
  {id:'fixed-construction-incompatible',kind:'integration',words:reason,sourcePrompt:'The reason or cause behind something.',intendedSense:'A reason or cause.',
    fixedCandidate:{answers:['target','response_1'],prompt:'The reason or cause behind something.',teachingNote:'原因 is broadly useful; 缘故 occurs in 不知什么缘故 and 是天气的缘故.',rationale:'Both name the reason or cause behind something; the compact meaning can be practiced directly.'},
    existingCues:[cue('analyze-reasons','Analyze the cause of the accident: 我们需要分析事故的____。','Identifying or analyzing causes.','原因 naturally combines with 分析.',[reason[0]!])],
    reviewFocus:['Inspect whether 缘故 naturally fits 分析事故的____; do not force extension merely from related labels.','Creation can use a compact reason meaning without claiming the words lack genuine overlap.']},
];}
export function singleTrialInput(fixture:PureCueFlowCase) {
  return {words:fixture.words.map((w,index)=>({ref:index===0?'target':`response_${index}`,form:w.hanzi,lexical:{hanzi:w.hanzi,traditional:w.traditional,pinyin:w.pinyin,meaning:w.meaning},canAuthorIndividual:true})),
    source:{prompt:fixture.sourcePrompt,instruction:'',postAnswer:null},intendedSense:{description:{label:fixture.intendedSense}},
    encounters:[{prompt:fixture.sourcePrompt,instruction:'',postAnswer:null,responses:[{response:fixture.words[1]!.hanzi,outcome:'rejected',effective:true}],reactions:[{reaction:'review',...(fixture.comment?{comment:fixture.comment}:{})}],skipped:false,presentationUndone:false}]};
}
function resolveRef(fixture:PureCueFlowCase,ref:string):TrialWord {const index=ref==='target'?0:Number(ref.replace(/^response_/,''));const found=fixture.words[index];if(!found)throw new Error('Unknown supplied answer reference');return found;}
export function integrationTrialInput(fixture:PureCueFlowCase,output:TrialSingleOutput,contract:FlowContract) {
  const shared=output.sharedExercise;if(!shared)throw new Error('No shared candidate to integrate');
  const candidates=shared.answers.map(ref=>resolveRef(fixture,ref));
  const sourceId=`trial-source:${fixture.id}`;
  const operations=[...(output.source.decision==='keep'?[]:[{operationKey:'source',strategy:output.source.decision==='retire'?'retire':'update_existing',sourceContentId:sourceId,expectedVersion:1,
    rationale:output.summary,content:{prompt:output.source.prompt}}]),...output.additionalExercises.map((exercise,index)=>({operationKey:`additional-${index}`,strategy:'create',learningRole:exercise.role,answer:resolveRef(fixture,exercise.answer),prompt:exercise.prompt,rationale:exercise.rationale}))];
  return {localAssessment:output.summary,localPlan:operations.length?{operations,rationale:output.summary,bases:[{contentId:sourceId,expectedVersion:1}]}:null,
    referral:{candidateWords:candidates.map(w=>w.hanzi),sharedPurpose:contract==='baseline'?shared.prompt:shared.rationale,rationale:shared.rationale,draft:{prompt:shared.prompt,...(contract==='baseline'?{teachingNote:shared.teachingNote}: {})}},
    candidates,existingCues:fixture.existingCues};
}
export function fixedSingleOutput(fixture:PureCueFlowCase,contract:FlowContract):TrialSingleOutput {
  const shared=fixture.fixedCandidate;if(!shared)throw new Error('Missing fixed candidate');
  return {summary:shared.rationale,source:{decision:'retire',prompt:null},sharedExercise:{answers:shared.answers,prompt:shared.prompt,rationale:shared.rationale,...(contract==='baseline'?{teachingNote:shared.teachingNote}:{})},additionalExercises:[]};
}
export function singleOutputErrors(fixture:PureCueFlowCase,output:TrialSingleOutput):string[] {
  const errors:string[]=[];const check=(prompt:string,refs:string[])=>{if(!prompt.trim())errors.push('Empty stimulus');for(const ref of refs){try{const w=resolveRef(fixture,ref);if([w.hanzi,w.traditional].some(form=>form&&prompt.includes(form)))errors.push('Stimulus exposes accepted answer');}catch{errors.push('Unknown supplied answer reference');}}};
  if(!output.summary.trim())errors.push('Empty summary');
  if(output.source.decision==='revise'){if(output.source.prompt===null)errors.push('Source revision lacks prompt');else check(output.source.prompt,['target']);}else if(output.source.prompt!==null)errors.push('Keep/retire must not author source prompt');
  for(const exercise of output.additionalExercises){check(exercise.prompt,[exercise.answer]);if(!exercise.rationale.trim())errors.push('Empty exercise rationale');}
  if(output.sharedExercise){const s=output.sharedExercise;if(!s.answers.includes('target')||new Set(s.answers).size!==s.answers.length)errors.push('Shared answers must include target and distinct references');check(s.prompt,s.answers);if(!s.rationale.trim())errors.push('Empty shared rationale');}
  return errors;
}
export function integrationOutputErrors(input:ReturnType<typeof integrationTrialInput>,output:TrialIntegrationOutput,contract:FlowContract):string[] {
  const errors:string[]=[];if(!output.rationale.trim())errors.push('Empty integration rationale');
  const existing=input.existingCues.find(c=>c.contentId===output.existingContentId);
  if(output.decision==='create'){
    if(output.existingContentId!==null)errors.push('Creation names an existing cue');
    const prompt=contract==='baseline'?input.referral.draft.prompt:output.prompt;
    const note=contract==='baseline'?input.referral.draft.teachingNote:output.teachingNote;
    if(!prompt?.trim()||!output.semanticAxis?.trim()||!note?.trim())errors.push('Creation needs prompt, axis and teaching');
    if(contract==='baseline'&&output.teachingNote!==null)errors.push('Baseline creation must preserve upstream note');
    if(prompt&&input.candidates.some(w=>[w.hanzi,w.traditional].some(form=>form&&prompt.includes(form))))errors.push('Created stimulus exposes accepted answer');
  }else{
    if(!existing)errors.push('Unknown existing destination');
    if(output.semanticAxis!==null||(contract==='candidate'&&output.prompt!==null))errors.push('Existing stimulus and axis must be preserved');
    if(output.decision==='reuse'){
      if(output.teachingNote!==null)errors.push('Reuse cannot edit teaching');
      if(existing&&input.candidates.some(w=>!existing.answers.some(a=>a.wordId===w.wordId)))errors.push('Reuse destination lacks incoming member');
    }else{
      if(!output.teachingNote?.trim())errors.push('Extension needs full integrated teaching');
      if(existing&&input.candidates.every(w=>existing.answers.some(a=>a.wordId===w.wordId)))errors.push('Extension adds no member');
    }
  }
  return errors;
}

/** Replays the exact archived user string; only the integration prompt may change. */
export function decodeIntegrationReplay(value:unknown,schema:JsonSchema,model:string):{input:ReturnType<typeof integrationTrialInput>;userPrompt:string} {
  if(!value||typeof value!=='object'||!('request'in value))throw new Error('Replay archive lacks request');
  const request=value.request;
  if(!request||typeof request!=='object'||!('model'in request)||request.model!==model
    ||!('outputSchema'in request)||!isDeepStrictEqual(request.outputSchema,schema)
    ||!('userPrompt'in request)||typeof request.userPrompt!=='string')throw new Error('Replay model/schema/user prompt differs from selected contract');
  const input:unknown=JSON.parse(request.userPrompt);
  if(!input||typeof input!=='object'||!('candidates'in input)||!Array.isArray(input.candidates)
    ||!('existingCues'in input)||!Array.isArray(input.existingCues)||!('referral'in input))throw new Error('Replay input lacks integration evidence');
  return {input:input as ReturnType<typeof integrationTrialInput>,userPrompt:request.userPrompt};
}
