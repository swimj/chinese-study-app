import { readFile } from 'node:fs/promises';
import type { IntroductionLexicalInput } from '../../src/domain/word-content/lab.ts';
import type { WordContentDocument } from '../../src/domain/word-content/types.ts';
import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import { validateJsonSchema } from '../llm/json-schema-validator.ts';
import { createOpenAiCompatibleAdapter } from '../llm/openai-compatible.ts';
import { fetchImplementationForProvider } from '../llm/proxy-fetch.ts';
import { isOutputTruncationFinishReason } from '../llm/types.ts';
import type { FetchImplementation } from '../llm/http.ts';

export const INTRO_LAB_MODEL = 'gpt-5.6-luna';
const TIMEOUT_MS = 180_000;
const MAX_OUTPUT_TOKENS = 16_000;

export type IntroductionLabProvider = {
  readonly model: string;
  isConfigured(): boolean;
  generateBootstrap(input: IntroductionLexicalInput): Promise<unknown>;
  generateTeaching(content: WordContentDocument): Promise<unknown>;
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
const teachingStimulusSchema: JsonSchema = { anyOf: [
  oneOfKinds('direct_text', { text: string }),
  // Rehearsal already has a separate instruction; no extra frame is needed here.
  oneOfKinds('example_cloze', { exampleId: string, occurrenceIndexes: array(integer, 1), frame: { type: 'null' } }),
] };
const teachingSchema = object({
  beats: array(object({ id: string, parts: array(teachingPartSchema, 1) }), 1),
  rehearsals: array(object({
    id: string,
    stimulus: teachingStimulusSchema,
  }), 1),
});

export function createIntroductionLabProvider(options: {
  environment?: NodeJS.ProcessEnv;
  fetchImplementation?: FetchImplementation;
} = {}): IntroductionLabProvider {
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
    stage: 'bootstrap' | 'teaching', input: IntroductionLexicalInput | WordContentDocument,
  ): Promise<unknown> {
    const apiKey = environment.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error('Introduction generation is not configured.');
    const schema = stage === 'bootstrap' ? bootstrapSchema : teachingSchema;
    const prompt = await readFile(new URL(`./prompts/${stage}.md`, import.meta.url), 'utf8');
    const result = await adapter.run({
      model: INTRO_LAB_MODEL,
      reasoningEffort: 'high',
      systemPrompt: prompt,
      userPrompt: JSON.stringify(input),
      outputSchemaName: `intro_lab_${stage}_v1`,
      outputSchema: schema,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: null,
      timeoutMs: TIMEOUT_MS,
      cachePrompt: true,
    }, {
      apiKey,
      baseUrl: environment.OPENAI_BASE_URL?.trim() || null,
    });
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
  }
  return {
    model: INTRO_LAB_MODEL,
    isConfigured: () => Boolean(environment.OPENAI_API_KEY?.trim()),
    generateBootstrap: (input) => generate('bootstrap', input),
    generateTeaching: (content) => generate('teaching', content),
  };
}
