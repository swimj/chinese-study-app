import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  IntroductionDraft, IntroductionLabStatus, IntroductionLexicalInput,
} from '../../src/domain/word-content/lab.ts';
import type {
  ContentStimulus, TeachingPackage, WordContentDocument,
} from '../../src/domain/word-content/types.ts';
import { materializeTeachingPackage } from '../../src/domain/word-content/materialize.ts';
import { parseTeachingPackage, parseWordContent } from '../../src/domain/word-content/validation.ts';
import { createIntroductionLabProvider, type IntroductionLabProvider } from './provider.ts';

export class IntroductionLabError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'IntroductionLabError';
  }
}

export type IntroductionLabService = {
  status(): IntroductionLabStatus;
  listDrafts(): Promise<IntroductionDraft[]>;
  bootstrap(input: unknown): Promise<IntroductionDraft>;
  generateTeaching(draftId: string): Promise<IntroductionDraft>;
  importDraft(input: unknown): Promise<IntroductionDraft>;
};

type RecordValue = Record<string, unknown>;
const DRAFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown, name: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as RecordValue;
}

function exactKeys(value: RecordValue, keys: readonly string[], name: string): void {
  const actual = Object.keys(value);
  if (actual.some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${name} has unsupported or missing fields.`);
  }
}

function lexicalInput(value: unknown): IntroductionLexicalInput {
  const input = record(value, 'Lexical input');
  exactKeys(input, ['hanzi', 'traditional', 'pinyin', 'guidance'], 'Lexical input');
  if (typeof input.hanzi !== 'string' || input.hanzi.trim().length === 0 || input.hanzi.length > 40
    || (input.traditional !== null && (typeof input.traditional !== 'string'
      || input.traditional.trim().length === 0 || input.traditional.length > 40))
    || typeof input.pinyin !== 'string' || input.pinyin.trim().length === 0 || input.pinyin.length > 120
    || typeof input.guidance !== 'string' || input.guidance.length > 2_000) {
    throw new Error('Expected bounded hanzi, traditional, pinyin, and guidance fields.');
  }
  return {
    hanzi: input.hanzi.trim(),
    traditional: input.traditional === null ? null : input.traditional.trim(),
    pinyin: input.pinyin.trim(),
    guidance: input.guidance.trim(),
  };
}

function generatedContent(value: unknown, input: IntroductionLexicalInput): WordContentDocument {
  const wire = record(value, 'Bootstrap result');
  exactKeys(wire, ['uses', 'examples'], 'Bootstrap result');
  return parseWordContent({
    schemaVersion: 1,
    id: `content-lab:${randomUUID()}`,
    word: {
      wordId: `word-lab:${randomUUID()}`,
      hanzi: input.hanzi,
      traditional: input.traditional,
      pinyin: input.pinyin,
    },
    uses: wire.uses,
    examples: wire.examples,
  });
}

function occurrenceSpans(text: string, target: string): Array<{ start: number; end: number; expectedText: string }> {
  const points = Array.from(text);
  const targetPoints = Array.from(target);
  const found: Array<{ start: number; end: number; expectedText: string }> = [];
  for (let index = 0; index <= points.length - targetPoints.length; index += 1) {
    if (targetPoints.every((point, offset) => points[index + offset] === point)) {
      found.push({ start: index, end: index + targetPoints.length, expectedText: target });
    }
  }
  return found;
}

function normalizeStimulus(value: unknown, content: WordContentDocument): ContentStimulus {
  const stimulus = record(value, 'Rehearsal stimulus');
  if (stimulus.kind === 'direct_text') {
    exactKeys(stimulus, ['kind', 'text'], 'Direct stimulus');
    return { kind: 'direct_text', text: stimulus.text as string };
  }
  if (stimulus.kind !== 'example_cloze') throw new Error('Unsupported rehearsal stimulus.');
  exactKeys(stimulus, ['kind', 'exampleId', 'occurrenceIndexes', 'frame'], 'Cloze stimulus');
  if (typeof stimulus.exampleId !== 'string' || !Array.isArray(stimulus.occurrenceIndexes)
    || stimulus.occurrenceIndexes.length === 0 || stimulus.occurrenceIndexes.length > 4) {
    throw new Error('Cloze needs an example and one to four occurrence indexes.');
  }
  const example = content.examples.find((candidate) => candidate.id === stimulus.exampleId);
  if (example === undefined) throw new Error('Cloze names an unknown source example.');
  const occurrences = occurrenceSpans(example.text, content.word.hanzi);
  let previous = -1;
  const blanks = stimulus.occurrenceIndexes.map((value: unknown) => {
    if (!Number.isSafeInteger(value) || (value as number) <= previous || (value as number) >= occurrences.length) {
      throw new Error('Cloze occurrence indexes must be ordered, unique, and in range.');
    }
    previous = value as number;
    return occurrences[value as number]!;
  });
  return {
    kind: 'example_cloze',
    example: { contentId: content.id, exampleId: example.id },
    blanks,
    frame: stimulus.frame as string | null,
  };
}

function generatedTeaching(value: unknown, content: WordContentDocument): TeachingPackage {
  const wire = record(value, 'Teaching result');
  exactKeys(wire, ['beats', 'rehearsals'], 'Teaching result');
  if (!Array.isArray(wire.rehearsals)) throw new Error('Teaching rehearsals must be an array.');
  const rehearsals = wire.rehearsals.map((raw, index) => {
    const item = record(raw, `Rehearsal ${index}`);
    exactKeys(item, ['id', 'stimulus'], `Rehearsal ${index}`);
    return {
      id: item.id,
      responseMode: 'hanzi_entry',
      contract: { kind: 'target_rehearsal', wordId: content.word.wordId },
      instruction: 'Recall the expression you just met. Enter only that expression in Chinese characters, not the whole sentence.',
      stimulus: normalizeStimulus(item.stimulus, content),
      acceptedAnswers: [{
        wordId: content.word.wordId,
        hanzi: content.word.hanzi,
        traditional: content.word.traditional,
      }],
    };
  });
  return parseTeachingPackage({
    schemaVersion: 1,
    id: `teaching-lab:${randomUUID()}`,
    wordContentId: content.id,
    beats: wire.beats,
    rehearsals,
  });
}

function validatedDraft(value: unknown, id: string): IntroductionDraft {
  const raw = record(value, 'Archived draft');
  exactKeys(raw, ['id', 'createdAt', 'origin', 'content', 'teaching'], 'Archived draft');
  if (raw.id !== id || typeof raw.createdAt !== 'string' || Number.isNaN(Date.parse(raw.createdAt))
    || (raw.origin !== 'generated' && raw.origin !== 'imported' && raw.origin !== 'sample')) {
    throw new Error('Archived draft identity or metadata is invalid.');
  }
  const content = parseWordContent(raw.content);
  const teaching = raw.teaching === null ? null : parseTeachingPackage(raw.teaching);
  if (teaching !== null) materializeTeachingPackage(teaching, [content]);
  return { id, createdAt: raw.createdAt, origin: raw.origin, content, teaching };
}

export function createIntroductionLabService(options: {
  dataDir: string;
  provider?: IntroductionLabProvider;
  now?: () => Date;
  newId?: () => string;
}): IntroductionLabService {
  const archiveDir = path.join(options.dataDir, 'word-content-workbench');
  const provider = options.provider ?? createIntroductionLabProvider();
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  let generationBusy = false;
  let archiveTail: Promise<void> = Promise.resolve();

  async function serializeArchive<T>(task: () => Promise<T>): Promise<T> {
    const previous = archiveTail;
    let release!: () => void;
    archiveTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await task(); }
    finally { release(); }
  }

  async function save(
    content: WordContentDocument, teaching: TeachingPackage | null,
    origin: IntroductionDraft['origin'],
  ): Promise<IntroductionDraft> {
    const id = newId();
    if (!DRAFT_ID.test(id)) throw new Error('Draft ID generator must return a UUID.');
    const draft: IntroductionDraft = {
      id, createdAt: now().toISOString(), origin, content, teaching,
    };
    return serializeArchive(async () => {
      await mkdir(archiveDir, { recursive: true, mode: 0o700 });
      for (const existing of await listStored()) {
        if (existing.content.id === content.id
          && JSON.stringify(existing.content) !== JSON.stringify(content)) {
          throw new IntroductionLabError(409, 'Content ID already names a different archived document.');
        }
        if (teaching !== null && existing.teaching?.id === teaching.id
          && JSON.stringify(existing.teaching) !== JSON.stringify(teaching)) {
          throw new IntroductionLabError(409, 'Teaching ID already names a different archived package.');
        }
      }
      const temporaryPath = path.join(archiveDir, `.${id}.${randomUUID()}.tmp`);
      const finalPath = path.join(archiveDir, `${id}.json`);
      try {
        await writeFile(temporaryPath, `${JSON.stringify(draft, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        // Publish a complete file without replacing a prior draft of the same ID.
        await link(temporaryPath, finalPath);
      } finally {
        await unlink(temporaryPath).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        });
      }
      return validatedDraft(draft, id);
    });
  }

  async function load(id: string): Promise<IntroductionDraft> {
    if (!DRAFT_ID.test(id)) throw new IntroductionLabError(400, 'Invalid draft ID.');
    let source: string;
    try { source = await readFile(path.join(archiveDir, `${id}.json`), 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new IntroductionLabError(404, 'Draft not found.');
      }
      throw error;
    }
    return validatedDraft(JSON.parse(source), id);
  }

  async function listStored(): Promise<IntroductionDraft[]> {
    let names: string[];
    try { names = await readdir(archiveDir); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const drafts = await Promise.all(names.filter((name) => (
      name.endsWith('.json') && DRAFT_ID.test(name.slice(0, -5))
    )).map((name) => load(name.slice(0, -5))));
    return drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async function withGeneration<T>(task: () => Promise<T>): Promise<T> {
    if (!provider.isConfigured()) throw new IntroductionLabError(503, 'Introduction generation is not configured.');
    if (generationBusy) throw new IntroductionLabError(409, 'Introduction generation is already in progress.');
    generationBusy = true;
    try { return await task(); }
    finally { generationBusy = false; }
  }

  return {
    status: () => ({ generationAvailable: provider.isConfigured(), model: provider.model }),
    listDrafts: listStored,
    async bootstrap(raw) {
      let input: IntroductionLexicalInput;
      try { input = lexicalInput(raw); }
      catch { throw new IntroductionLabError(400, 'Expected bounded lexical input.'); }
      return withGeneration(async () => {
        let output: unknown;
        try { output = await provider.generateBootstrap(input); }
        catch { throw new IntroductionLabError(502, 'Bootstrap provider request failed.'); }
        let content: WordContentDocument;
        try { content = generatedContent(output, input); }
        catch { throw new IntroductionLabError(502, 'Bootstrap output failed validation.'); }
        return save(content, null, 'generated');
      });
    },
    async generateTeaching(draftId) {
      const source = await load(draftId);
      return withGeneration(async () => {
        let output: unknown;
        try { output = await provider.generateTeaching(source.content); }
        catch { throw new IntroductionLabError(502, 'Teaching provider request failed.'); }
        let teaching: TeachingPackage;
        try {
          teaching = generatedTeaching(output, source.content);
          const snapshot = materializeTeachingPackage(teaching, [source.content]);
          const forms = [source.content.word.hanzi, source.content.word.traditional]
            .filter((form): form is string => form !== null);
          if (snapshot.rehearsals.some((exercise) => forms.some((form) => (
            exercise.instruction.includes(form) || exercise.stimulus.text.includes(form)
          )))) throw new Error('Generated rehearsal exposes its target answer.');
        } catch {
          throw new IntroductionLabError(502, 'Teaching output failed validation.');
        }
        return save(source.content, teaching, 'generated');
      });
    },
    async importDraft(raw) {
      let content: WordContentDocument;
      let teaching: TeachingPackage | null;
      let origin: 'sample' | 'imported';
      try {
        const input = record(raw, 'Import');
        if (Object.keys(input).some((key) => !['content', 'teaching', 'origin'].includes(key))
          || !Object.hasOwn(input, 'content')) throw new Error('Invalid import fields.');
        origin = input.origin === undefined ? 'imported'
          : input.origin === 'sample' || input.origin === 'imported' ? input.origin
            : (() => { throw new Error('Invalid import origin.'); })();
        content = parseWordContent(input.content);
        teaching = input.teaching === undefined || input.teaching === null
          ? null : parseTeachingPackage(input.teaching);
        if (teaching !== null) materializeTeachingPackage(teaching, [content]);
      } catch { throw new IntroductionLabError(400, 'Imported content or teaching is invalid.'); }
      return save(content, teaching, origin);
    },
  };
}
