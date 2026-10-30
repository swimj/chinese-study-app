import { useState } from 'react';
import type { VocabularyCaseWorkspace,VocabularyReassessmentModel } from './api';
export function PureCueIdentityResolution({options,disabled,onSubmit}:{options:NonNullable<VocabularyCaseWorkspace['pureCueIdentityOptions']>;disabled:boolean;onSubmit:(model:VocabularyReassessmentModel,selections:{form:string;wordId:string}[])=>void}) {
  const [choices,setChoices]=useState<Record<string,string>>({});
  const [model,setModel]=useState<VocabularyReassessmentModel>('openai:gpt-6-sol-high');
  const selections=options.map(option=>({form:option.form,wordId:option.choices.length===1?option.choices[0]!.wordId:choices[option.form]??''}));
  return <fieldset disabled={disabled} className="vocabulary-pure-cue-identities"><legend>Resolve candidate identities</legend>
    {options.map(option=><div key={option.form}><strong>{option.form}</strong>{option.choices.length===0?<p>No matching dictionary entry. Reassess or close this assessment.</p>:option.choices.length===1?<p>{option.choices[0]!.pinyin} — {option.choices[0]!.meaning}</p>:<label>Dictionary entry for {option.form}<select aria-label={`Dictionary entry for ${option.form}`} value={choices[option.form]??''} onChange={event=>setChoices({...choices,[option.form]:event.target.value})}><option value="">Choose an entry</option>{option.choices.map(word=><option key={word.wordId} value={word.wordId}>{word.hanzi} · {word.pinyin} · {word.wordId}</option>)}</select><p>{option.choices.find(word=>word.wordId===choices[option.form])?.meaning}</p></label>}</div>)}
    <label>Promotion model<select value={model} onChange={event=>setModel(event.target.value as VocabularyReassessmentModel)}><option value="openai:gpt-6-sol-high">GPT-6 Sol high</option><option value="openai:gpt-5.6-luna-high">Luna high</option><option value="zai:glm-5.3-flash-high">GLM-5.3 Flash high</option></select></label>
    <button disabled={disabled||selections.some(item=>!item.wordId)} onClick={()=>onSubmit(model,selections)}>Queue promotion assessment</button>
  </fieldset>;
}
