/** Call-local references keep canonical persistence identities out of model prose. */
export function vocabularySenseReferences(canonicalIds:readonly string[]) {
  const ids=[...new Set(canonicalIds)],aliases=new Map(ids.map((id,index)=>[id,`s${index+1}`]));
  const canonical=new Map([...aliases].map(([id,alias])=>[alias,id]));
  return {
    alias(id:string):string {const result=aliases.get(id);if(!result)throw new Error('Unregistered canonical sense reference');return result;},
    canonical(alias:string):string {const result=canonical.get(alias);if(!result)throw new Error('Unknown call-local sense reference');return result;},
  };
}

/** Only reference fields change; labels, authored content IDs and lexical IDs retain their meaning. */
export function projectVocabularySenseReferences(input:unknown) {
  const ids:string[]=[];
  function visit(value:unknown,translate?:(id:string)=>string):unknown {
    if(Array.isArray(value))return value.map(item=>visit(item,translate));
    if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value).map(([key,item])=>{
      if((key==='senseId'||key==='sourceUseId')&&typeof item==='string'){
        if(!translate)ids.push(item);
        return [key,translate?translate(item):item];
      }
      if((key==='senseIds'||key==='includedSenseIds'||key==='excludedSenseIds'||key==='defaultUsefulSenseIds')&&Array.isArray(item)){
        return [key,item.map(id=>{if(typeof id!=='string')throw new Error('Invalid sense reference');if(!translate)ids.push(id);return translate?translate(id):id;})];
      }
      return [key,visit(item,translate)];
    }));
  }
  visit(input);
  const references=vocabularySenseReferences(ids);
  return {input:visit(input,id=>references.alias(id)),references};
}
