import type {VocabularyAssessmentReview,VocabularySenseLabel} from '../../domain/vocabulary-reflection';
const stages:Record<string,string>={sense_mapping:'Sense mapping',single_improvement:'Exercise improvement',pure_cue_promotion:'Pure cue promotion',pure_cue_improvement:'Pure cue improvement',repertoire:'Repertoire',exercise_improvement:'Exercise improvement'};
const outcomes={single_sense:'Single sense → exercise improvement',laundry_list:'Multiple senses → repertoire',unmappable:'Intended sense unresolved',inventory_gap:'Possible inventory gap',needs_coverage:'Useful sense selection needed',no_senses_requested:'No senses selected'};
export function AssessmentReview({assessment,senses,operator=false}:{assessment:VocabularyAssessmentReview|null|undefined;senses:VocabularySenseLabel[];operator?:boolean}) {
  if(!assessment&&!operator)return null;
  const admission=assessment?.admission,scope=admission?.generationScope;
  const labels=(scope?.senseIds??admission?.senseIds??[]).map(id=>senses.find(sense=>sense.senseId===id)?.label??id);
  return <section aria-label="Assessment provenance" className="vocabulary-assessment-review">
    <p className="vocabulary-operator-meta">{operator?'Operator correction':assessment?.origin==='unavailable'?'Assessment provenance unavailable':assessment?.origin==='identity_resolution'?'Operator lexical resolution → promotion':assessment?.origin==='reassessment'?'Operator reassessment':'Automatic assessment'}</p>
    {assessment?.models.map(model=><p className="vocabulary-operator-meta" key={model.invocationId}><strong>{stages[model.stage]??model.stage}</strong> · {model.resolvedModel??model.model} · {model.provider}</p>)}
    {admission&&<><p><strong>{outcomes[admission.outcome]}</strong>{labels.length>0?` · ${labels.join(' / ')}`:''}</p>{scope&&<p className="vocabulary-operator-meta">Scope: {scope.source.kind==='mapped_source'?'mapped source':scope.source.kind==='review_override'?'review selection':'word defaults'}</p>}<details><summary>Sense mapping rationale</summary><p>{admission.rationale}</p></details></>}
  </section>;
}
