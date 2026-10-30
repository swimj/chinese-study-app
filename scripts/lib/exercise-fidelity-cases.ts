import type { GeneralExerciseSource } from '../../server/vocabulary/general-exercise-authoring.ts';

export type ExerciseFidelityCase={name:string;kind:'single'|'general'|'mapping';input:Record<string,unknown>;targetForms:string[];sourceId?:string;generalSource?:GeneralExerciseSource};
export const DEFAULT_FIDELITY_CASES=['single-贸','single-得以','single-簋','general-贸','general-得以','general-簋'];
const word=(hanzi:string,pinyin:string,meaning:string)=>({wordId:`word-${hanzi}`,hanzi,traditional:hanzi,pinyin,meaning});
function single(hanzi:string,pinyin:string,meaning:string,label:string,notes:string[],prompt:string,traditional=hanzi):ExerciseFidelityCase {
  const w={...word(hanzi,pinyin,meaning),traditional},forms=[...new Set([hanzi,traditional])],sense={senseId:`sense-${hanzi}-1`,wordId:w.wordId,version:1,status:'active',description:{label,notes}};
  const source={contentId:`source-${hanzi}`,version:1,kind:'exercise',exerciseType:'word',skill:'production',exerciseRole:'general',accessScope:'shared',availability:'active',body:{prompt},words:[{wordId:w.wordId,relation:'target',senseId:sense.senseId}],answers:[{wordId:w.wordId,acceptedForms:forms}]};
  return {name:`single-${hanzi}`,kind:'single',targetForms:forms,sourceId:source.contentId,input:{word:w,wordId:w.wordId,senses:[sense],intendedSense:sense,sourceContent:source,catalog:{wordId:w.wordId,version:1},
    admission:{outcome:'single_sense',senseIds:[sense.senseId],rationale:`The authored task targets ${label}.`},evidence:{sourceContent:source,words:[w],encounters:[{encounterId:`encounter-${hanzi}`,wordId:w.wordId,purpose:'general',mode:'practice',served:{contentId:source.contentId,contentVersion:1,body:{prompt},assessment:{acceptedAnswers:forms}},responses:[{actionId:`answer-${hanzi}`,response:hanzi,outcome:'accepted',effective:true}],reactions:[{reaction:'review'}],skipped:false,presentationUndone:false}]}}};
}

/** Synthetic lexical fixtures; no hosted learner records or private comments. */
export function exerciseFidelityCases():ExerciseFidelityCase[] {
  const singles=[
    single('他','tā','he; him; other; another','bound form: other, another',['Used as a bound form in 他人, 他日, 他处 to mean other or another.'],'请尊重____人的隐私。'),
    single('有所','yǒusuǒ','to some extent','to some extent',['Contributes a limited or unspecified degree before a verb.'],'to some extent: 情况____改善。'),
    single('适用','shìyòng','to be applicable','be applicable or suitable for use',['Used of a rule, method or policy applying to a situation.'],'to be applicable'),
    single('笏','hù','ceremonial court tablet','ceremonial tablet held by court officials',['Intentionally selected by the operator for an interest in historical court vocabulary.'],'A ceremonial tablet held by officials at imperial court.'),
  ];
  const general=singles.filter(c=>c.name==='single-笏'||c.name==='single-他').map(c=>{
    const w=c.input.word as ReturnType<typeof word>,sense=c.input.intendedSense as {senseId:string;description:{label:string;notes:string[]}};
    const source:GeneralExerciseSource={word:w,uses:[{id:sense.senseId,label:sense.description.label,notes:sense.description.notes,exampleIds:[]}],examples:[]};
    return {name:`general-${w.hanzi}`,kind:'general' as const,targetForms:c.targetForms,input:{role:'general_exercises',content:source},generalSource:source};
  });
  const w=word('查询','cháxún','to look up information; to inquire about something; to query');w.traditional='查詢';
  const ids=['fb57f552-2ef8-4df3-b2a9-701e0cb0e732','9fef2d9f-eb72-4137-9219-c7fbf70b6dca','0ecddfec-b78c-40bc-8c8a-f937baf3b1ab'];
  const labels=['look up information','inquire about something','query'],notes=['Consult a source, system or record to find information.','Ask about or investigate the status or details of something.','Search or retrieve records in a computer or database system.'];
  const senses=ids.map((senseId,i)=>({senseId,wordId:w.wordId,version:1,status:'active',description:{label:labels[i],notes:[notes[i]]}}));
  const sourceContent={contentId:'source-mapper-查询',version:1,kind:'exercise',exerciseType:'definition_gloss',exerciseRole:'general',skill:'production',accessScope:'shared',availability:'active',body:{prompt:'to look up information; to inquire about something; to query'},words:[{wordId:w.wordId,relation:'target'}],answers:[{wordId:w.wordId,acceptedForms:['查询','查詢']}]};
  // Held out from the worked examples; keep experimental failure evidence rather
  // than encoding a required linguistic decision into the fixtures.
  const heldout=[
    {hanzi:'贸',traditional:'貿',pinyin:'mào',meaning:'trade; exchange goods',label:'trade or exchange goods',notes:['Selected exact character target in the trade sense. In present-day Mandarin this contribution occurs in larger lexical items such as 贸易, 商贸, and 经贸. The selected sense is needed; do not switch to the rash/reckless sense.'],prompt:'trade between two countries: 两国____易往来频繁。',example:'两国贸易往来频繁。',translation:'The two countries trade frequently.'},
    {hanzi:'得以',traditional:'得以',pinyin:'déyǐ',meaning:'to be able to; to have the opportunity to',label:'be able to do something because conditions permit',notes:['Occurs before a verb phrase when circumstances make an action possible.'],prompt:'finally able to leave hospital after treatment: 经过治疗，他终于____出院。',example:'经过治疗，他终于得以出院。',translation:'After treatment, he was finally able to leave hospital.'},
    {hanzi:'簋',traditional:'簋',pinyin:'guǐ',meaning:'ancient ritual food vessel',label:'round ritual vessel for grain offerings',notes:['A round ancient bronze vessel used for grain offerings in rituals; deliberately selected for a learner studying archaeology.'],prompt:'A round ancient bronze vessel used to hold grain offerings in rituals.',example:'这件青铜簋用于盛放祭祀用的谷物。',translation:'This bronze gui vessel was used to hold grain for ritual offerings.'},
    {hanzi:'泞',traditional:'濘',pinyin:'nìng',meaning:'muddy; mud',label:'muddy ground or mud',notes:['Selected muddy-ground sense. In present-day Mandarin this contribution normally occurs in the larger word 泥泞. The exact single-character target remains selected; do not silently change the answer to 泥泞.'],prompt:'The road is muddy after rain: 雨后，道路泥____。',example:'雨后，道路泥泞。',translation:'After the rain, the road is muddy.'},
  ].flatMap(item=>{
    const local=single(item.hanzi,item.pinyin,item.meaning,item.label,item.notes,item.prompt,item.traditional);
    const source:GeneralExerciseSource={word:{...word(item.hanzi,item.pinyin,item.meaning),traditional:item.traditional},uses:[{id:`sense-${item.hanzi}-1`,label:item.label,notes:item.notes,exampleIds:['e1']}],
      examples:[{id:'e1',text:item.example,translation:item.translation,pronunciation:null}]};
    return [local,{name:`general-${item.hanzi}`,kind:'general' as const,targetForms:local.targetForms,input:{role:'general_exercises',content:source},generalSource:source}];
  });
  return [...singles,...general,...heldout,{name:'mapper-查询',kind:'mapping',targetForms:['查询','查詢'],input:{word:w,wordId:w.wordId,catalog:{wordId:w.wordId,version:1},senses,sourceContent}}];
}
