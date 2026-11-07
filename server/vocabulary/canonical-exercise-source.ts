import type { GeneralExerciseSource } from './general-exercise-authoring.ts';
import type { VocabularySense } from '../../src/domain/vocabulary-content.ts';

/** Canonical evidence shared by reflection and post-reconciliation authoring. */
export function canonicalExerciseSource(word: GeneralExerciseSource['word'], senses: Pick<VocabularySense,'senseId'|'description'>[]): GeneralExerciseSource {
  const authoringSource:GeneralExerciseSource={word,
    uses:senses.map(sense=>{
      const description=sense.description;
      if(typeof description==='string'&&description.trim())return {id:sense.senseId,label:description,notes:[],exampleIds:[]};
      if(!description||typeof description!=='object'||Array.isArray(description)||typeof description.label!=='string'
        ||(description.notes!==undefined&&(!Array.isArray(description.notes)||description.notes.some(note=>typeof note!=='string'))))throw new Error('Sense lacks authoring evidence');
      return {id:sense.senseId,label:description.label,notes:(description.notes??[]) as string[],exampleIds:[]};
    }),examples:[]};
  // Imported inventories retain useful example evidence; generated inventories legitimately have none.
  const examples:Array<GeneralExerciseSource['examples'][number]>=[];
  authoringSource.uses.forEach((use,index)=>{
    const description=senses[index]!.description;
    if(!description||typeof description!=='object'||Array.isArray(description)||!Array.isArray(description.examples))return;
    for(const [exampleIndex,value] of description.examples.entries()){
      if(!value||typeof value!=='object')throw new Error('Invalid sense example evidence');
      const example=value as Record<string,unknown>;
      if(typeof example.text!=='string'||typeof example.translation!=='string'
        ||(example.pronunciation!==null&&typeof example.pronunciation!=='string'))throw new Error('Invalid sense example evidence');
      const id=`${use.id}:example:${exampleIndex+1}`;
      examples.push({id,text:example.text,translation:example.translation,pronunciation:example.pronunciation});
      (use.exampleIds as string[]).push(id);
    }
  });
  return {...authoringSource,examples};
}
