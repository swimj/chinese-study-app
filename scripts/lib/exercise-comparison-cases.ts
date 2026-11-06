import type {ExerciseFidelityCase} from './exercise-fidelity-cases.ts';

export const COMPARISON_FIDELITY_CASES=['comparison-原因-缘故','comparison-有关-关于','comparison-稠密-密集','comparison-声调-拼音','comparison-框-筐','comparison-违反-违法','comparison-遭到-遭受','comparison-犹豫-readability'];

/** Synthetic cases: review expectations are hypotheses, never provider input or gold labels. */
export function exerciseComparisonCases():ExerciseFidelityCase[] {
  const records:Array<[string,string,string,string,string,string,string,string,string]>=[
    ['原因','yuányīn','reason; cause','reason or cause of an event','what caused something to happen: 这是什么____？','缘故','yuángù','reason; cause','A compact shared reason task is useful; teaching can distinguish common patterns without a contrast puzzle.'],
    ['有关','yǒuguān','concerning; related to','concerning a topic or having a relation to it','concerning the exam arrangements: ____考试安排的通知已经发出。','关于','guānyú','about; concerning','A notice about arrangements permits shared practice; an independent 有关 relational predicate can add useful practice.'],
    ['稠密','chóumì','dense; densely populated','dense distribution of people or things','densely populated: 这一带人口很____。','密集','mìjí','dense; concentrated','Population density offers overlap; optional 密集 scheduling practice should earn its own place.'],
    ['声调','shēngdiào','tone; lexical pitch pattern','pitch pattern distinguishing syllables in Mandarin','The way a Chinese syllable is pronounced.','拼音','pīnyīn','pinyin; Mandarin phonetic spelling','The pitch distinction is missing from the served cue; repair the local intention without shared pitch/spelling practice.'],
    ['框','kuàng','frame; border','frame surrounding a picture','the border around a photograph: 照片外面有一个木____。','筐','kuāng','basket','Retain fair frame practice; a basket is a different referent.'],
    ['违反','wéifǎn','violate; contravene','act contrary to a rule or agreement','to break a rule or law','违法','wéifǎ','break the law; be illegal','Related English glosses do not establish shared syntax; consider natural object-taking versus predicative use.'],
    ['遭到','zāodào','suffer; be subjected to','be subjected to an adverse action or response','be subjected to criticism: 这个决定____了不少批评。','遭受','zāoshòu','suffer; undergo','Natural overlap can be acknowledged without requiring a shared referral merely to represent every overlap.'],
    ['犹豫','yóuyù','hesitate','hesitate because one cannot decide','When faced with two possible choices, you keep weighing the advantages and drawbacks of each, imagine what might happen afterward, delay making a decision, and reconsider the options again.','犹豫','yóuyù','hesitate','A correct answer plus a substantive readability reaction can justify a compact local repair; no distinct response candidate.'],
  ];
  return records.map(([hanzi,pinyin,meaning,label,prompt,response,responsePinyin,responseMeaning,reviewExpectation],index)=>{
    const word={wordId:`comparison-word-${index+1}`,hanzi,traditional:hanzi,pinyin,meaning};
    const candidate={wordId:`comparison-response-${index+1}`,hanzi:response,traditional:response,pinyin:responsePinyin,meaning:responseMeaning};
    const sense={senseId:`comparison-sense-${index+1}`,wordId:word.wordId,version:1,status:'active',description:{label,notes:[]}};
    const source={contentId:`comparison-source-${index+1}`,version:1,kind:'exercise',exerciseType:'word',skill:'production',exerciseRole:'general',accessScope:'shared',availability:'active',body:{prompt},words:[{wordId:word.wordId,relation:'target',senseId:sense.senseId}],answers:[{wordId:word.wordId,acceptedForms:[hanzi]}]};
    const correct=response===hanzi;
    return {name:COMPARISON_FIDELITY_CASES[index]!,kind:'single',targetForms:[hanzi],sourceId:source.contentId,reviewExpectation,input:{word,wordId:word.wordId,senses:[sense],intendedSense:sense,sourceContent:source,catalog:{wordId:word.wordId,version:1},
      admission:{outcome:'single_sense',senseIds:[sense.senseId],rationale:`The authored task targets ${label}.`},responseCandidates:correct?[]:[candidate],
      evidence:{sourceContent:source,words:correct?[word]:[word,candidate],encounters:[{encounterId:`comparison-encounter-${index+1}`,wordId:word.wordId,purpose:'general',mode:'practice',served:{contentId:source.contentId,contentVersion:1,body:{prompt},assessment:{acceptedAnswers:[hanzi]}},responses:[{actionId:`comparison-answer-${index+1}`,response,outcome:correct?'accepted':'rejected',effective:true}],reactions:[{reaction:'review',...(correct?{comment:'The prompt takes too long to understand.'}:{})}],skipped:false,presentationUndone:false}]}}};
  });
}
