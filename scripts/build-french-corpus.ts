import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';

type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2';

type FlelexRow = {
  word: string;
  tag: string;
  level: CefrLevel;
  levelFrequency: number;
  totalFrequency: number;
  priority: number;
};

type KaikkiForm = {
  form?: string;
  tags?: string[];
};

type KaikkiSound = {
  ipa?: string;
};

type KaikkiSense = {
  glosses?: string[];
  tags?: string[];
};

type KaikkiEntry = {
  word?: string;
  lang_code?: string;
  pos?: string;
  senses?: KaikkiSense[];
  forms?: KaikkiForm[];
  sounds?: KaikkiSound[];
};

type FrenchCorpusWord = {
  id: string;
  word: string;
  pos: string;
  auxiliary: string;
  meanings: string[];
  priority: number;
  prioritySource: FrenchPrioritySource;
  aliases: FrenchCorpusAlias[];
  sourceKeys: {
    kaikki: string;
    flelex?: string;
  };
};

type FrenchPrioritySource =
  | {
    source: 'FLELex';
    cefrLevel: CefrLevel;
    flelexTag: string;
    levelFrequency: number;
    totalFrequency: number;
  }
  | {
    source: 'dictionary-default';
  };

type FrenchCorpusAlias = {
  aliasText: string;
  normalizedAlias: string;
  relation: string;
  source: 'kaikki';
  tags: string[];
};

type MutableCorpusWord = {
  word: string;
  pos: string;
  ipa: string | null;
  meaningSet: Set<string>;
  senseTags: Set<string>;
  aliasesByKey: Map<string, FrenchCorpusAlias>;
  priority: number;
  prioritySource: FrenchPrioritySource;
  sourceKeys: {
    kaikki: string;
    flelex?: string;
  };
};

type CorpusOutput = {
  meta: {
    generatedAt: string;
    kaikkiPath: string;
    flelexPath: string;
    scannedKaikkiLines: number;
    skippedEntries: number;
    flelexA1B2Rows: number;
    flelexMatchedWords: number;
    dictionaryDefaultWords: number;
    wordCount: number;
    aliasCount: number;
    priorityPolicy: {
      flelexA1B2: string;
      dictionaryDefault: number;
    };
    notes: string[];
  };
  words: FrenchCorpusWord[];
};

const DEFAULT_KAIKKI_PATH = 'data/sources/kaikki.org-dictionary-French.jsonl';
const DEFAULT_FLELEX_PATH = 'data/sources/FleLex_TT.csv';
const DEFAULT_OUTPUT_PATH = 'data/french-corpus.json';
const DICTIONARY_DEFAULT_PRIORITY = 1_000;
const CEFR_LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2'];
const PRIORITY_BANDS: Record<CefrLevel, number> = {
  A1: 900_000,
  A2: 800_000,
  B1: 700_000,
  B2: 600_000,
};

const FLELEX_POS_TO_KAIKKI = new Map<string, Set<string>>([
  ['ADJ', new Set(['adj'])],
  ['ADV', new Set(['adv'])],
  ['DET', new Set(['det', 'article'])],
  ['KON', new Set(['conj'])],
  ['NOM', new Set(['noun'])],
  ['NUM', new Set(['num'])],
  ['PRO', new Set(['pron'])],
  ['PRP', new Set(['prep', 'prep_phrase'])],
  ['VER', new Set(['verb'])],
]);

const SKIP_ENTRY_TAGS = new Set([
  'abbreviation',
  'archaic',
  'eye-dialect',
  'misspelling',
  'nonstandard',
  'obsolete',
  'rare',
]);

const SKIP_ALIAS_TAGS = new Set([
  'alternative',
  'canonical',
  'determiner',
  'emphatic',
  'inflection-template',
  'multiword-construction',
  'possessive',
  'table-tags',
]);

const argv = process.argv.slice(2);
const options = parseArgs(argv);
const cwd = process.cwd();
const kaikkiPath = path.resolve(cwd, options.kaikkiPath ?? DEFAULT_KAIKKI_PATH);
const flelexPath = path.resolve(cwd, options.flelexPath ?? DEFAULT_FLELEX_PATH);
const outputPath = path.resolve(cwd, options.outputPath ?? DEFAULT_OUTPUT_PATH);

async function main() {
  const flelexRows = parseFlelexRows(fs.readFileSync(flelexPath, 'utf8'));
  const flelexByWord = groupFlelexRowsByWord(flelexRows);
  const corpusByKey = new Map<string, MutableCorpusWord>();
  const matchedFlelexKeys = new Set<string>();
  let scannedKaikkiLines = 0;
  let skippedEntries = 0;

  const input = fs.createReadStream(kaikkiPath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    scannedKaikkiLines += 1;
    if (line.trim().length === 0) {
      continue;
    }

    const entry = JSON.parse(line) as KaikkiEntry;
    if (!isUsefulFrenchEntry(entry)) {
      skippedEntries += 1;
      continue;
    }

    const meanings = collectMeanings(entry.senses ?? []);
    if (meanings.length === 0) {
      skippedEntries += 1;
      continue;
    }

    const word = entry.word?.trim() ?? '';
    const pos = entry.pos?.trim() ?? '';
    const key = buildEntryKey(word, pos);
    const flelex = findBestFlelexMatch(entry, flelexByWord);
    if (flelex) {
      matchedFlelexKeys.add(`${normalizeFrenchLookupText(flelex.word)}\t${flelex.tag}`);
    }

    const existing = corpusByKey.get(key);
    if (!existing) {
      corpusByKey.set(key, {
        word,
        pos,
        ipa: findIpa(entry.sounds ?? []),
        meaningSet: new Set(meanings),
        senseTags: new Set((entry.senses ?? []).flatMap((sense) => sense.tags ?? [])),
        aliasesByKey: collectAliases(word, entry.forms ?? []),
        priority: flelex?.priority ?? DICTIONARY_DEFAULT_PRIORITY,
        prioritySource: flelex ? buildFlelexPrioritySource(flelex) : { source: 'dictionary-default' },
        sourceKeys: {
          kaikki: key,
          ...(flelex ? { flelex: `${flelex.word}\t${flelex.tag}` } : {}),
        },
      });
      continue;
    }

    mergeMutableWord(existing, {
      meanings,
      senseTags: (entry.senses ?? []).flatMap((sense) => sense.tags ?? []),
      aliasesByKey: collectAliases(word, entry.forms ?? []),
      ipa: findIpa(entry.sounds ?? []),
      flelex,
    });
  }

  const words = [...corpusByKey.values()]
    .map(finalizeCorpusWord)
    .sort((left, right) => {
      if (right.priority !== left.priority) {
        return right.priority - left.priority;
      }
      return left.word.localeCompare(right.word, 'fr') || left.pos.localeCompare(right.pos, 'fr');
    });

  const aliasCount = words.reduce((total, word) => total + word.aliases.length, 0);
  const output: CorpusOutput = {
    meta: {
      generatedAt: new Date().toISOString(),
      kaikkiPath,
      flelexPath,
      scannedKaikkiLines,
      skippedEntries,
      flelexA1B2Rows: flelexRows.length,
      flelexMatchedWords: words.filter((word) => word.prioritySource.source === 'FLELex').length,
      dictionaryDefaultWords: words.filter((word) => word.prioritySource.source === 'dictionary-default').length,
      wordCount: words.length,
      aliasCount,
      priorityPolicy: {
        flelexA1B2: 'A1 900000+, A2 800000+, B1 700000+, B2 600000+, ordered by descending FLELex level frequency',
        dictionaryDefault: DICTIONARY_DEFAULT_PRIORITY,
      },
      notes: [
        'Broad French corpus built from Kaikki French Wiktionary extraction with FLELex A1-B2 priority overlay.',
        'Dictionary-only entries are kept studyable at a low default priority.',
        'Aliases are extracted from Kaikki forms for later add-word lookup support.',
        'Some archaic, obsolete, rare, misspelling, and template-like entries are filtered conservatively.',
        `Matched ${matchedFlelexKeys.size} distinct FLELex word/tag keys during source processing.`,
      ],
    },
    words,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        outputPath,
        wordCount: output.meta.wordCount,
        aliasCount: output.meta.aliasCount,
        flelexMatchedWords: output.meta.flelexMatchedWords,
        dictionaryDefaultWords: output.meta.dictionaryDefaultWords,
        scannedKaikkiLines,
        skippedEntries,
        sample: words.slice(0, 5).map((word) => ({
          word: word.word,
          pos: word.pos,
          priority: word.priority,
          prioritySource: word.prioritySource,
          aliasCount: word.aliases.length,
        })),
      },
      null,
      2,
    ),
  );
}

function parseArgs(args: string[]) {
  const parsed: {
    kaikkiPath?: string;
    flelexPath?: string;
    outputPath?: string;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--kaikki') {
      parsed.kaikkiPath = readArgValue(args, index);
      index += 1;
    } else if (arg === '--flelex') {
      parsed.flelexPath = readArgValue(args, index);
      index += 1;
    } else if (arg === '--output') {
      parsed.outputPath = readArgValue(args, index);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function readArgValue(args: string[], index: number): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Expected value after ${args[index]}`);
  }
  return value;
}

function parseFlelexRows(contents: string): FlelexRow[] {
  const [headerLine, ...lines] = contents.trim().split(/\r?\n/);
  const headers = headerLine.split('\t');
  const indexByHeader = new Map(headers.map((header, index) => [header, index]));
  const rows: Array<Omit<FlelexRow, 'priority'>> = [];

  for (const line of lines) {
    const columns = line.split('\t');
    const word = readColumn(columns, indexByHeader, 'word').trim();
    const tag = readColumn(columns, indexByHeader, 'tag').trim();
    const totalFrequency = Number.parseFloat(readColumn(columns, indexByHeader, 'freq_total'));

    for (const level of CEFR_LEVELS) {
      const levelFrequency = Number.parseFloat(readColumn(columns, indexByHeader, `freq_${level}`));
      if (levelFrequency > 0) {
        rows.push({ word, tag, level, levelFrequency, totalFrequency });
        break;
      }
    }
  }

  const rowsByLevel = new Map<CefrLevel, Array<Omit<FlelexRow, 'priority'>>>();
  for (const row of rows) {
    const levelRows = rowsByLevel.get(row.level) ?? [];
    levelRows.push(row);
    rowsByLevel.set(row.level, levelRows);
  }

  const prioritizedRows: FlelexRow[] = [];
  for (const level of CEFR_LEVELS) {
    const levelRows = rowsByLevel.get(level) ?? [];
    levelRows.sort((left, right) => {
      if (right.levelFrequency !== left.levelFrequency) {
        return right.levelFrequency - left.levelFrequency;
      }
      return left.word.localeCompare(right.word, 'fr');
    });

    levelRows.forEach((row, index) => {
      prioritizedRows.push({
        ...row,
        priority: PRIORITY_BANDS[level] + (levelRows.length - index),
      });
    });
  }

  return prioritizedRows;
}

function readColumn(columns: string[], indexByHeader: Map<string, number>, header: string): string {
  const index = indexByHeader.get(header);
  if (index === undefined) {
    throw new Error(`FLELex file is missing expected column "${header}"`);
  }
  return columns[index] ?? '';
}

function groupFlelexRowsByWord(rows: FlelexRow[]): Map<string, FlelexRow[]> {
  const grouped = new Map<string, FlelexRow[]>();
  for (const row of rows) {
    const key = normalizeFrenchLookupText(row.word);
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }

  for (const group of grouped.values()) {
    group.sort((left, right) => right.priority - left.priority);
  }

  return grouped;
}

function isUsefulFrenchEntry(entry: KaikkiEntry): boolean {
  if (entry.lang_code !== 'fr' || !entry.word?.trim() || !entry.pos?.trim()) {
    return false;
  }

  if (entry.pos === 'character' || entry.pos === 'romanization') {
    return false;
  }

  return (entry.senses ?? []).some((sense) => !shouldSkipSense(sense));
}

function findBestFlelexMatch(entry: KaikkiEntry, flelexByWord: Map<string, FlelexRow[]>): FlelexRow | null {
  const rows = flelexByWord.get(normalizeFrenchLookupText(entry.word ?? ''));
  if (!rows || rows.length === 0) {
    return null;
  }

  const posCompatibleRows = rows.filter((row) => isFlelexPosCompatibleWithKaikki(row.tag, entry.pos ?? ''));
  if (posCompatibleRows.length > 0) {
    return posCompatibleRows[0];
  }

  const hasKnownFlelexPos = rows.some((row) => FLELEX_POS_TO_KAIKKI.has(row.tag.split(':')[0]));
  return hasKnownFlelexPos ? null : rows[0] ?? null;
}

function isFlelexPosCompatibleWithKaikki(flelexTag: string, kaikkiPos: string): boolean {
  const primaryTag = flelexTag.split(':')[0];
  const compatiblePos = FLELEX_POS_TO_KAIKKI.get(primaryTag);
  return compatiblePos?.has(kaikkiPos) ?? false;
}

function collectMeanings(senses: KaikkiSense[]): string[] {
  const meanings = new Set<string>();
  for (const sense of senses) {
    if (shouldSkipSense(sense)) {
      continue;
    }

    for (const gloss of sense.glosses ?? []) {
      const cleanGloss = gloss.trim();
      if (cleanGloss.length > 0) {
        meanings.add(cleanGloss);
      }
    }
  }
  return [...meanings].slice(0, 8);
}

function shouldSkipSense(sense: KaikkiSense): boolean {
  return (sense.tags ?? []).some((tag) => SKIP_ENTRY_TAGS.has(tag));
}

function collectAliases(word: string, forms: KaikkiForm[]): Map<string, FrenchCorpusAlias> {
  const canonical = normalizeFrenchLookupText(word);
  const aliases = new Map<string, FrenchCorpusAlias>();

  for (const form of forms) {
    const aliasText = form.form?.trim();
    if (!aliasText) {
      continue;
    }

    const tags = form.tags ?? [];
    const normalizedAlias = normalizeFrenchLookupText(aliasText);
    if (normalizedAlias.length === 0 || normalizedAlias === canonical || shouldSkipAlias(aliasText, tags)) {
      continue;
    }

    aliases.set(normalizedAlias, {
      aliasText,
      normalizedAlias,
      relation: inferAliasRelation(tags),
      source: 'kaikki',
      tags,
    });
  }

  return aliases;
}

function shouldSkipAlias(aliasText: string, tags: string[]): boolean {
  if (tags.some((tag) => SKIP_ALIAS_TAGS.has(tag))) {
    return true;
  }

  if (aliasText.includes('+')) {
    return true;
  }

  if (/^(conditional|future|imperfect|simple imperative)\b/i.test(aliasText)) {
    return true;
  }

  return false;
}

function inferAliasRelation(tags: string[]): string {
  if (tags.includes('plural')) {
    return 'plural_form';
  }
  if (tags.includes('feminine')) {
    return 'feminine_form';
  }
  if (tags.includes('infinitive')) {
    return 'infinitive_form';
  }
  if (tags.includes('participle')) {
    return 'participle_form';
  }
  return tags.length > 0 ? 'inflected_form' : 'form';
}

function findIpa(sounds: KaikkiSound[]): string | null {
  return sounds.find((sound) => sound.ipa)?.ipa ?? null;
}

function mergeMutableWord(
  existing: MutableCorpusWord,
  patch: {
    meanings: string[];
    senseTags: string[];
    aliasesByKey: Map<string, FrenchCorpusAlias>;
    ipa: string | null;
    flelex: FlelexRow | null;
  },
) {
  for (const meaning of patch.meanings) {
    existing.meaningSet.add(meaning);
  }

  for (const tag of patch.senseTags) {
    existing.senseTags.add(tag);
  }

  for (const [key, alias] of patch.aliasesByKey) {
    existing.aliasesByKey.set(key, alias);
  }

  existing.ipa ??= patch.ipa;

  if (patch.flelex && patch.flelex.priority > existing.priority) {
    existing.priority = patch.flelex.priority;
    existing.prioritySource = buildFlelexPrioritySource(patch.flelex);
    existing.sourceKeys.flelex = `${patch.flelex.word}\t${patch.flelex.tag}`;
  }
}

function buildFlelexPrioritySource(flelex: FlelexRow): FrenchPrioritySource {
  return {
    source: 'FLELex',
    cefrLevel: flelex.level,
    flelexTag: flelex.tag,
    levelFrequency: flelex.levelFrequency,
    totalFrequency: flelex.totalFrequency,
  };
}

function finalizeCorpusWord(word: MutableCorpusWord): FrenchCorpusWord {
  const meanings = [...word.meaningSet].slice(0, 8);
  return {
    id: makeFrenchWordId(word.word, word.pos),
    word: word.word,
    pos: word.pos,
    auxiliary: buildAuxiliaryNote(word.pos, word.senseTags, word.ipa),
    meanings,
    priority: word.priority,
    prioritySource: word.prioritySource,
    aliases: [...word.aliasesByKey.values()].sort((left, right) =>
      left.normalizedAlias.localeCompare(right.normalizedAlias, 'fr'),
    ),
    sourceKeys: word.sourceKeys,
  };
}

function buildAuxiliaryNote(pos: string, senseTags: Set<string>, ipa: string | null): string {
  const parts = [displayPos(pos)];
  if (senseTags.has('masculine')) {
    parts.unshift('masculine');
  } else if (senseTags.has('feminine')) {
    parts.unshift('feminine');
  }
  if (ipa) {
    parts.push(ipa);
  }
  return parts.filter(Boolean).join('; ');
}

function displayPos(pos: string): string {
  const labels: Record<string, string> = {
    adj: 'adjective',
    adv: 'adverb',
    article: 'article',
    conj: 'conjunction',
    det: 'determiner',
    noun: 'noun',
    num: 'number',
    prep: 'preposition',
    pron: 'pronoun',
    verb: 'verb',
  };
  return labels[pos] ?? pos;
}

function buildEntryKey(word: string, pos: string): string {
  return `${normalizeFrenchLookupText(word)}\t${pos}`;
}

function makeFrenchWordId(word: string, pos: string): string {
  const hash = createHash('sha1').update(`${normalizeFrenchLookupText(word)}\t${pos}`).digest('hex').slice(0, 8);
  return `fr:${slugifyFrench(word)}:${pos}:${hash}`;
}

function slugifyFrench(value: string): string {
  const slug = normalizeFrenchLookupText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.length > 0 ? slug : Buffer.from(value).toString('hex');
}

function normalizeFrenchLookupText(value: string): string {
  return value
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
