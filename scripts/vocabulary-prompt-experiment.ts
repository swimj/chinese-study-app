import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { wordContentFixtures } from '../src/features/introduction-lab/samples.ts';
import { prepareExperiment, recordExperimentResponse, recordExperimentReview } from '../server/word-content-lab/vocabulary-experiments/archive.ts';
import type { ExperimentInput } from '../server/word-content-lab/vocabulary-experiments/contracts.ts';
import { renderExperimentComparison } from '../server/word-content-lab/vocabulary-experiments/preview.ts';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  archive: { type: 'string', default: '/tmp/vocabulary-prompt-experiments' },
  role: { type: 'string', default: 'general_exercises' }, sample: { type: 'string', default: '报备' },
  input: { type: 'string' }, prompt: { type: 'string' }, variant: { type: 'string', default: 'candidate-v1' },
  model: { type: 'string', default: 'not-selected' }, provider: { type: 'string', default: 'not-selected' },
  reasoning: { type: 'string' }, 'max-output-tokens': { type: 'string', default: '16000' },
  run: { type: 'string' }, output: { type: 'string' }, origin: { type: 'string', default: 'manual_import' },
  runs: { type: 'string' }, html: { type: 'string' }, 'note-file': { type: 'string' },
  author: { type: 'string', default: 'Justin' }, 'exercise-id': { type: 'string' },
  decision: { type: 'string', default: 'keep_exploring' },
} });
const root = path.resolve(values.archive);
function required(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`Expected --${flag}.`);
  return value;
}

async function main(): Promise<void> {
  if (positionals[0] === 'prepare') {
    let input: ExperimentInput;
    if (values.input) input = JSON.parse(await readFile(values.input, 'utf8')) as ExperimentInput;
    else {
      const fixture = wordContentFixtures.find(({ content }) => content.word.hanzi === values.sample);
      if (!fixture) throw new Error('Unknown sample. Use --input for another retained case.');
      if (values.role === 'bootstrap') input = { role: 'bootstrap', word: { ...fixture.content.word, guidance: '' } };
      else if (values.role === 'introduction' || values.role === 'general_exercises') input = { role: values.role, content: fixture.content };
      else if (values.role === 'teaching_exercises') input = { role: values.role, content: fixture.content, introduction: fixture.teaching };
      else throw new Error('Unknown authoring role.');
    }
    const candidate = input.role === 'teaching_exercises' ? 'teaching-exercises' : 'general-exercises';
    const defaultPrompt = input.role === 'bootstrap' || input.role === 'introduction'
      ? new URL(`../server/word-content/prompts/${input.role === 'bootstrap' ? 'bootstrap' : 'teaching'}.md`, import.meta.url)
      : new URL(`../server/word-content-lab/vocabulary-experiments/prompts/${candidate}-v1.md`, import.meta.url);
    const request = await prepareExperiment(root, {
      variant: values.variant, input,
      prompt: { name: input.role, version: values.variant, text: await readFile(values.prompt ?? defaultPrompt, 'utf8') },
      settings: { provider: values.provider, model: values.model, reasoningEffort: values.reasoning ?? null,
        maxOutputTokens: Number(values['max-output-tokens']), temperature: null },
    });
    console.log(JSON.stringify({ id: request.id, request: path.join(root, request.id, 'request.json'), modelCallMade: false }));
  } else if (positionals[0] === 'record') {
    if (values.origin !== 'fixture' && values.origin !== 'manual_import') throw new Error('CLI records fixture or manual_import output; use the injected transport runner for actual calls.');
    const result = await recordExperimentResponse(root, required(values.run, 'run'), {
      origin: values.origin, rawText: await readFile(required(values.output, 'output'), 'utf8'),
      resolvedModel: null, providerRequestId: null, finishReason: null, usage: null, cost: null,
    });
    console.log(JSON.stringify({ status: result.status, structuralErrors: result.validation?.structuralErrors ?? [] }));
  } else if (positionals[0] === 'compare') {
    const html = await renderExperimentComparison(root, required(values.runs, 'runs').split(','));
    const output = path.resolve(required(values.html, 'html'));
    await writeFile(output, html, { flag: 'wx', mode: 0o600 });
    console.log(output);
  } else if (positionals[0] === 'review') {
    const decision = values.decision;
    if (decision !== 'keep_exploring' && decision !== 'promising' && decision !== 'revise' && decision !== 'reject') throw new Error('Unknown review decision.');
    const id = await recordExperimentReview(root, required(values.run, 'run'), {
      author: values.author, scope: values['exercise-id'] ? 'exercise' : 'pool',
      exerciseId: values['exercise-id'] ?? null, decision,
      note: await readFile(required(values['note-file'], 'note-file'), 'utf8'),
    });
    console.log(id);
  } else throw new Error('Usage: vocabulary-prompt-experiment.ts prepare|record|compare|review [options]. No command makes a model call.');
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Experiment failed.'); process.exitCode = 1; });
