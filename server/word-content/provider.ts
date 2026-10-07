import { createHash } from 'node:crypto';
import { invalidateInvocation } from '../llm/invocation-ledger.ts';
import { readFile } from 'node:fs/promises';
import type { WordBootstrapInput } from '../../src/domain/word-content/application.ts';
import type { WordContentDocument } from '../../src/domain/word-content/types.ts';
import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import { validateJsonSchema } from '../llm/json-schema-validator.ts';
import { createOpenAiCompatibleAdapter } from '../llm/openai-compatible.ts';
import { fetchImplementationForProvider } from '../llm/proxy-fetch.ts';
import { isOutputTruncationFinishReason } from '../llm/types.ts';
import type { FetchImplementation } from '../llm/http.ts';

export const WORD_INTRODUCTION_MODEL = 'gpt-5.6-luna';
const TIMEOUT_MS = 180_000;
const MAX_OUTPUT_TOKENS = 16_000;

export type WordGenerationOptions = { onInvocation?: (id: string | null | undefined) => void };

/** Keep validation accounting separate from publication and storage failures. */
export function validateWordProviderOutput<T>(invocationId: string | null | undefined, validate: () => T): T {
  try { return validate(); }
  catch (error) { invalidateInvocation(invocationId); throw error; }
}

export type WordIntroductionProvider = {
  readonly model: string;
  isConfigured(): boolean;
  generateBootstrap(input: WordBootstrapInput, options?: WordGenerationOptions): Promise<unknown>;
  generateTeaching(content: WordContentDocument, options?: WordGenerationOptions): Promise<unknown>;
  generatePractice(content: WordContentDocument, options?: WordGenerationOptions): Promise<unknown>;
  generationKey(stage: 'teaching' | 'practice'): Promise<string>;
  generateReview(content: WordContentDocument, options?: WordGenerationOptions): Promise<unknown>;
};

const string: JsonSchema = { type: 'string' };
const nullableString: JsonSchema = { type: ['string', 'null'] };
const integer: JsonSchema = { type: 'integer' };
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
const array = (items: JsonSchema, minItems = 0): JsonSchema => ({ type: 'array', items, minItems });
const oneOfKinds = (kind: string, properties: Record<string, JsonSchema>): JsonSchema => (
  object({ kind: { type: 'string', enum: [kind] }, ...properties })
);

const bootstrapSchema = object({
  uses: array(object({
    id: string,
    label: string,
    notes: array(string),
    exampleIds: array(string, 1),
  }), 1),
  examples: array(object({
    id: string,
    text: string,
    translation: string,
    pronunciation: nullableString,
  }), 1),
});

const teachingPartSchema: JsonSchema = { anyOf: [
  oneOfKinds('text', { text: string }),
  oneOfKinds('example', { exampleId: string, field: { type: 'string', enum: ['sentence', 'translation', 'pronunciation'] } }),
  oneOfKinds('use_note', { useId: string, noteIndex: integer }),
] };
const teachingSchema = object({
  beats: array(object({ id: string, parts: array(teachingPartSchema, 1) }), 1),
});
const practiceSchema = object({
  rehearsals: array(object({ id: string, stimulus: { anyOf: [
    oneOfKinds('direct_text', { text: string }),
    oneOfKinds('phrase_cloze', { frame: string, text: string }),
  ] } }), 1),
});

/** Practice uses lexical notes but not teaching sentences or their lookup IDs. */
export function practiceInput(content: WordContentDocument) {
  const { examples: _examples, ...source } = content;
  return { ...source, uses: content.uses.map(({ exampleIds: _exampleIds, ...use }) => use) };
}

const reviewSchema = object({
  exercises: {
    type: 'array', minItems: 1, maxItems: 3,
    items: object({
      id: string,
      cueType: { type: 'string', enum: ['definition_gloss', 'minimal_context', 'circumstance'] },
      stimulus: { anyOf: [
        oneOfKinds('direct_text', { text: string }),
        oneOfKinds('example_cloze', { exampleId: string, occurrenceIndexes: array(integer, 1), frame: nullableString }),
      ] },
      supplement: { anyOf: [
        { type: 'null' }, object({ exampleId: string, englishFrame: string }),
      ] },
    }),
  },
});

function schemaFor(stage: 'bootstrap' | 'teaching' | 'practice' | 'review'): JsonSchema {
  return stage === 'bootstrap' ? bootstrapSchema : stage === 'teaching' ? teachingSchema : stage === 'practice' ? practiceSchema : reviewSchema;
}

export function createWordIntroductionProvider(options: {
  environment?: NodeJS.ProcessEnv;
  fetchImplementation?: FetchImplementation;
  /** Local diagnostics hook; never receives request headers or credentials. */
  onRawText?: (stage: 'bootstrap' | 'teaching' | 'practice' | 'review', rawText: string) => void;
} = {}): WordIntroductionProvider {
  const environment = options.environment ?? process.env;
  const adapter = createOpenAiCompatibleAdapter({
    id: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    apiKeyEnvironmentVariable: 'OPENAI_API_KEY',
    structuredOutputMode: 'json_schema',
    maxTokensField: 'max_completion_tokens',
    fetchImplementation: options.fetchImplementation ?? fetchImplementationForProvider('openai', TIMEOUT_MS),
  });
  async function generate(
    stage: 'bootstrap' | 'teaching' | 'practice' | 'review', input: WordBootstrapInput | WordContentDocument,
    generationOptions: WordGenerationOptions = {},
  ): Promise<unknown> {
    const apiKey = environment.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error('Introduction generation is not configured.');
    const schema = schemaFor(stage);
    const prompt = await readFile(new URL(`./prompts/${stage}.md`, import.meta.url), 'utf8');
    const result = await adapter.run({
      model: WORD_INTRODUCTION_MODEL,
      reasoningEffort: 'high',
      systemPrompt: prompt,
      userPrompt: JSON.stringify(stage === 'practice' ? practiceInput(input as WordContentDocument) : input),
      outputSchemaName: `intro_lab_${stage}_${stage === 'teaching' ? 'v2' : 'v1'}`,
      outputSchema: schema,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: null,
      timeoutMs: TIMEOUT_MS,
      cachePrompt: true,
    }, {
      apiKey,
      baseUrl: environment.OPENAI_BASE_URL?.trim() || null,
    });
    generationOptions.onInvocation?.(result.invocationId);
    options.onRawText?.(stage, result.rawText);
    return validateWordProviderOutput(result.invocationId, () => {
      if (isOutputTruncationFinishReason(result.finishReason)) {
        throw new Error('Introduction generation output was truncated.');
      }
      let parsed: unknown;
      try { parsed = JSON.parse(result.rawText); }
      catch { throw new Error('Introduction generation returned invalid JSON.'); }
      if (validateJsonSchema(parsed, schema).length > 0) {
        throw new Error('Introduction generation returned an invalid structure.');
      }
      return parsed;
    });
  }
  return {
    model: WORD_INTRODUCTION_MODEL,
    isConfigured: () => Boolean(environment.OPENAI_API_KEY?.trim()),
    generateBootstrap: (input, generationOptions) => generate('bootstrap', input, generationOptions),
    generateTeaching: (content, generationOptions) => generate('teaching', content, generationOptions),
    generatePractice: (content, generationOptions) => generate('practice', content, generationOptions),
    generationKey: async (stage) => createHash('sha256').update(JSON.stringify({
      prompt: await readFile(new URL(`./prompts/${stage}.md`, import.meta.url), 'utf8'),
      schema: schemaFor(stage), model: WORD_INTRODUCTION_MODEL, reasoning: 'high',
      maxOutputTokens: MAX_OUTPUT_TOKENS, inputVersion: stage === 'practice' ? 'without-examples-v1' : 'full-v1',
    })).digest('hex'),
    generateReview: (content, generationOptions) => generate('review', content, generationOptions),
  };
}
