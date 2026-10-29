import { ensureVocabularyDefaultUsefulSelection } from '../vocabulary/default-useful-selection.ts';
import { getVocabularySenseCatalog,getVocabularySenses } from '../db/vocabulary-content.ts';
import { ensureVocabularySenses,VocabularySenseSelectionRequired } from '../vocabulary/sense-readiness.ts';
import { resolveVocabularySenseCoverage } from '../db/vocabulary-sense-coverage.ts';
import { getDb } from '../db/connection.ts';
import { linkVocabularyInvocationSense } from '../db/vocabulary-provenance.ts';
import { randomUUID } from 'node:crypto';
import { preparationProviderFailure } from './provider-failure.ts';
export { WordPreparationProviderError } from './provider-failure.ts';
import {
  getSharedIntroductionLexicalWord, getSharedWordIntroductionContent,
  claimSharedWordIntroductionStage,
  finishSharedWordIntroductionBootstrap, finishSharedWordIntroductionTeaching,
  releaseSharedWordIntroductionStage,
  getSharedWordIntroductionComponent, saveSharedWordIntroductionComponent,
} from '../db/word-introductions.ts';
import {
  claimSharedWordReviewPreparation, finishSharedWordReviewPreparation,
  releaseSharedWordReviewPreparation,
} from '../db/review-content.ts';
import { isSharedWordPreparationReady, type WordPreparationStage } from '../db/preparation-work.ts';
import { normalizeWordContent, normalizeTeachingBeats, normalizePracticeRehearsals } from './authoring.ts';
import { normalizeReviewExercises } from './review-authoring.ts';
import { createWordIntroductionProvider, validateWordProviderOutput, type WordIntroductionProvider,type TeachingCoherenceSource } from './provider.ts';

const SERVICE_ID = 'vocabulary-shared-authoring';
function linkSourceSenses(invocationId: string | null | undefined,contentId: string): void {
  if (invocationId == null) return;
  const senses = getDb().prepare('SELECT sense_id,imported_sense_version FROM legacy_sense_imports WHERE source_content_id=?').all(contentId) as Array<{ sense_id: string; imported_sense_version: number }>;
  for (const sense of senses) linkVocabularyInvocationSense({ invocationId,senseId: sense.sense_id,senseVersion: sense.imported_sense_version,role: 'input' },
    { kind: 'service',id: SERVICE_ID });
}
/** No learner context or private writes: background generation publishes only shared content. */
export function createSharedWordPreparation(provider: WordIntroductionProvider = createWordIntroductionProvider(),options:{ensureSenses?:typeof ensureVocabularySenses;canPublish?:()=>boolean}={}) {
  function assertPublication(){if(options.canPublish&&!options.canPublish())throw new Error('Shared authoring publication is currently blocked');}
  async function prepareBootstrapSenses(wordId:string,workflowId:string){
    const ready=await (options.ensureSenses??ensureVocabularySenses)(wordId,{workflowId,canPublish:options.canPublish});
    await ensureVocabularyDefaultUsefulSelection(wordId,{workflowId,canPublish:options.canPublish});
    const coverage=resolveVocabularySenseCoverage(wordId);
    if(!coverage.selectionEstablished)throw new VocabularySenseSelectionRequired('Default useful senses are unknown; operator selection or the explicit legacy cutover is required.');
    if(!coverage.includedSenseIds.length)throw new VocabularySenseSelectionRequired('No useful senses are selected; teaching preparation requires operator disposition.');
    const canonicalSenses=ready.senses.filter(sense=>coverage.includedSenseIds.includes(sense.senseId)).map(sense=>{
      const description=sense.description;
      if(!description||typeof description!=='object'||Array.isArray(description)||typeof description.label!=='string'||!Array.isArray(description.notes)||description.notes.some(note=>typeof note!=='string'))throw new VocabularySenseSelectionRequired('Canonical senses need operator-authored labels and notes before enrichment.');
      return {senseId:sense.senseId,label:description.label,notes:description.notes as string[]};
    });
    return {ready,coverage,canonicalSenses,senseVersions:ready.senses.filter(sense=>coverage.includedSenseIds.includes(sense.senseId)).map(sense=>({senseId:sense.senseId,version:sense.version}))};
  }
  function validatePreparedSource(wordId:string){
    const content=getSharedWordIntroductionContent(wordId);if(!content)throw new VocabularySenseSelectionRequired('Prepared source is unavailable; operator disposition required.');
    const mappings=getDb().prepare('SELECT source_use_id,sense_id,imported_sense_version FROM legacy_sense_imports WHERE source_content_id=?').all(content.id) as {source_use_id:string;sense_id:string;imported_sense_version:number}[];
    const currentSenses=new Map(getVocabularySenses(wordId).map(sense=>[sense.senseId,sense]));
    if(content.uses.some(use=>{const mapping=mappings.find(mapping=>mapping.source_use_id===use.id);return !mapping||currentSenses.get(mapping.sense_id)?.version!==mapping.imported_sense_version;}))throw new VocabularySenseSelectionRequired('Prepared source sense versions changed; operator source reconciliation is required.');
    const represented=content.uses.map(use=>mappings.find(mapping=>mapping.source_use_id===use.id)!);
    if(!represented.length||represented.some(mapping=>currentSenses.get(mapping.sense_id)?.status!=='active')||new Set(represented.map(mapping=>mapping.sense_id)).size!==content.uses.length)throw new VocabularySenseSelectionRequired('Prepared source must map each active canonical sense exactly once.');
    return {sourceContentId:content.id,senseVersions:represented.map(mapping=>({senseId:mapping.sense_id,version:mapping.imported_sense_version})),catalogVersion:getVocabularySenseCatalog(wordId).version};
  }
  return {
    validatePreparedSource,prepareBootstrapSenses,
    isConfigured: () => provider.isConfigured(),
    source: getSharedWordIntroductionContent,
    ready: isSharedWordPreparationReady,
    claim(wordId: string, stage: WordPreparationStage, token: string, now: string, expiresAt: string) {
      if (stage === 'review') {
        const content = getSharedWordIntroductionContent(wordId);
        if (!content) throw new Error('Eligible bootstrap required before review');
        return claimSharedWordReviewPreparation(wordId, content.id, token, now, expiresAt);
      }
      return claimSharedWordIntroductionStage(wordId, stage, token, now, expiresAt);
    },
    release(wordId: string, stage: WordPreparationStage, token: string) {
      if (stage === 'review') releaseSharedWordReviewPreparation(wordId, token);
      else releaseSharedWordIntroductionStage(wordId, token);
    },
    async generate(wordId: string, stage: WordPreparationStage, token: string): Promise<void> {
      let invocationId: string | null | undefined;
      const generationOptions = { workflowId: token,invocationActor: { kind: 'service' as const,serviceId: SERVICE_ID },onInvocation: (id: string | null | undefined) => { invocationId = id; } };
      if (stage === 'bootstrap') {
        const lexical = getSharedIntroductionLexicalWord(wordId);
        if (!lexical) throw new Error('Lexical word missing');
        const selected=await prepareBootstrapSenses(wordId,token);
        let output: unknown;
        try {
          output = await provider.generateBootstrap({ hanzi: lexical.hanzi, traditional: lexical.traditional,
            pinyin: lexical.pinyin,canonicalSenses:selected.canonicalSenses, guidance: `Corpus meanings: ${lexical.meanings.join('; ')}`.slice(0, 2_000) }, generationOptions);
        } catch (error) { throw preparationProviderFailure(error); }
        const content = validateWordProviderOutput(invocationId, () => {
          if(!output||typeof output!=='object'||!('uses' in output)||!Array.isArray(output.uses))throw new Error('Canonical enrichment requires uses');
          const seen=new Set<string>();
          const uses=output.uses.map((use:unknown)=>{
            if(!use||typeof use!=='object'||!('id' in use)||typeof use.id!=='string')throw new Error('Canonical enrichment requires use identity');
            const canonical=selected.canonicalSenses.find(sense=>sense.senseId===use.id);
            if(!canonical||seen.has(use.id))throw new Error('Enrichment may not add, merge or duplicate canonical senses');seen.add(use.id);
            return {...use,label:canonical.label,notes:canonical.notes};
          });
          if(seen.size!==selected.canonicalSenses.length)throw new Error('Enrichment must include every selected canonical sense');
          return normalizeWordContent({...output,uses}, { wordId, hanzi: lexical.hanzi, traditional: lexical.traditional, pinyin: lexical.pinyin }, `word-content:${randomUUID()}`);
        },SERVICE_ID);
        assertPublication();
        finishSharedWordIntroductionBootstrap(wordId, token, content, provider.model,invocationId,{catalogVersion:selected.ready.catalog.version,senseVersions:selected.senseVersions,senseIds:selected.canonicalSenses.map(sense=>sense.senseId)});
        return;
      }
      const content = getSharedWordIntroductionContent(wordId);
      if (!content) throw new Error('Eligible bootstrap content unavailable');
      const sourceScope=validatePreparedSource(wordId);
      const assertSource=()=>{if(getSharedWordIntroductionContent(wordId)?.id!==sourceScope.sourceContentId||getVocabularySenseCatalog(wordId).version!==sourceScope.catalogVersion)throw new Error('Canonical source or catalog changed during teaching preparation');};
      if (stage === 'teaching') {
        const keys = { teaching: await provider.generationKey('teaching'),practice: '' };
        let delivered: TeachingCoherenceSource | undefined;
        async function component(part: 'teaching' | 'practice') {
          const existing = getSharedWordIntroductionComponent(wordId, token, content!.id, part, keys[part]);
          if (existing) return existing.payload;
          let componentInvocation: string | null | undefined;
          const options = { workflowId: token,invocationActor: { kind: 'service' as const,serviceId: SERVICE_ID },teaching: part === 'practice' ? delivered : undefined,onInvocation: (id: string | null | undefined) => { componentInvocation = id; } };
          let output: unknown;
          try {
            output = await (part === 'teaching' ? provider.generateTeaching(content!, options) : provider.generatePractice(content!, options));
          } catch (error) { throw preparationProviderFailure(error); }
          linkSourceSenses(componentInvocation,content!.id);
          const payload = validateWordProviderOutput(componentInvocation, () => part === 'teaching'
            ? { beats: normalizeTeachingBeats(output, content!) }
            : { rehearsals: normalizePracticeRehearsals(output, content!) },SERVICE_ID);
          assertPublication();assertSource();
          saveSharedWordIntroductionComponent(wordId, token, { contentId: content!.id, stage: part,
            generationKey: keys[part], payload, model: provider.model, invocationId: componentInvocation ?? null });
          return payload;
        }
        // Preserve a successful introduction across exercise failure. Exercises consume exactly these beats.
        await component('teaching');
        const lesson = getSharedWordIntroductionComponent(wordId, token, content.id, 'teaching', keys.teaching)!;
        delivered = { id: `introduction-component:${content.id}:${keys.teaching}`,wordContentId: content.id,
          beats: (lesson.payload as { beats: import('../../src/domain/word-content/types.ts').TeachingPackage['beats'] }).beats };
        keys.practice = await provider.generationKey('practice',delivered);
        await component('practice');
        const practice = getSharedWordIntroductionComponent(wordId, token, content.id, 'practice', keys.practice)!;
        // Components were normalized before storage; package parsing/materialization revalidates their assembly.
        const teaching = { schemaVersion: 1 as const, id: `word-teaching:${randomUUID()}`, wordContentId: content.id,
          beats: (lesson.payload as { beats: import('../../src/domain/word-content/types.ts').TeachingPackage['beats'] }).beats,
          rehearsals: (practice.payload as { rehearsals: import('../../src/domain/word-content/types.ts').TeachingPackage['rehearsals'] }).rehearsals };
        assertPublication();assertSource();
        finishSharedWordIntroductionTeaching(wordId, token, teaching, provider.model, keys);
      } else {
        let output: unknown;
        try { output = await provider.generateReview(content, generationOptions); }
        catch (error) { throw preparationProviderFailure(error); }
        linkSourceSenses(invocationId,content.id);
        const batch = randomUUID();
        const exercises = validateWordProviderOutput(invocationId, () => normalizeReviewExercises(output, content, (id) => `word-review:${batch}:${id}`),SERVICE_ID);
        assertPublication();assertSource();
        finishSharedWordReviewPreparation(wordId, token, exercises, provider.model,invocationId);
      }
    },
  };
}
