import type { VocabularyJson } from './vocabulary-content.ts';

function object(value: VocabularyJson): Record<string, VocabularyJson> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** Enriching a dictionary fallback's explanation does not author a targeted prompt. */
export function isVocabularyDefinitionFallback(content: { body: VocabularyJson }): boolean {
  const source = object(object(content.body).source);
  return source.kind === 'dictionary_baseline'
    || (source.kind === 'production_cue_supplement' && source.cueId === null);
}

/** An explicit prompt rewrite has authored provenance; retain the dictionary source as ancestry. */
export function vocabularyAuthoredPromptBody(previous: VocabularyJson, next: VocabularyJson): VocabularyJson {
  const before = object(previous), after = object(next);
  if (!isVocabularyDefinitionFallback({ body: previous }) || !isVocabularyDefinitionFallback({ body: next })
    || typeof before.prompt !== 'string' || typeof after.prompt !== 'string'
    || before.prompt.trim() === after.prompt.trim()) return next;
  return { ...after, source: { kind: 'authored_prompt', previous: after.source } };
}
