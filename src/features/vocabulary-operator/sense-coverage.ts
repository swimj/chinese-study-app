import type { VocabularySenseLabel } from '../../domain/vocabulary-reflection';
import type { VocabularySenseCoverageWorkspace } from '../../domain/vocabulary-sense-coverage';
import type { VocabularyContentProposal } from '../../domain/vocabulary-reflection';
export function scopeAffectsProposal(proposal:VocabularyContentProposal,scope:'case'|'word',caseId:string,wordId:string):boolean {
  return scope==='case'?proposal.caseId===caseId:proposal.operations.some(operation=>operation.content.words.some(word=>word.wordId===wordId));
}
export function coverageImpact(workspace:VocabularySenseCoverageWorkspace,selected:readonly string[]):number {
  // Unknown defaults preserve existing serving; only explicit edits determine subsequent selection.
  const previouslySelected=workspace.word.defaultUsefulSenseIds??workspace.senses.filter(sense=>sense.status==='active'&&!workspace.word.excludedSenseIds.includes(sense.senseId)).map(sense=>sense.senseId);
  return previouslySelected.filter(id=>!selected.includes(id)).reduce((count,id)=>count+(workspace.productionExerciseCounts?.[id]??0),0);
}

/** A scope response replaces labels for its word while preserving other proposal targets. */
export function mergeSenseLabels(previous:readonly VocabularySenseLabel[],wordId:string,current:readonly VocabularySenseLabel[]):VocabularySenseLabel[] {
  return [...previous.filter(sense=>sense.wordId!==wordId),...current];
}

export function scopeBlocksNavigation(saving:boolean,hasDraft:boolean):boolean{return saving||hasDraft;}
