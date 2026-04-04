import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

type JsonObject = Record<string, unknown>;

type SourceWord = {
  userWordId: number;
  wordId: number;
  status: string;
  baseStatus: string;
  opinyin: string;
  spinyin: string;
  simplified: string;
  traditional: string;
  english: string;
  interval: number;
  daysSinceLastReview: number;
  daysOverdue: number;
  strength: number;
  lifetimeFailTotal: number;
  lifetimeSuccessTotal: number;
  isHard: boolean;
  longestPeriodRemembered: number;
  retentionRate: number;
  snoozed: boolean;
  snoozeExpiresIn: unknown;
  masteryOverride: boolean;
  dateLearned: string;
  isFormerLeech: boolean;
};

type Word = {
  id: string;
  hanzi: string;
  pinyin: string;
  meaning: string;
  examples: string[];
  status: "unstudied" | "learning" | "review" | "mature";
  availableAt: string;
  priority: number;
  createdAt: string;
};

type ReviewItem = {
  id: string;
  wordId: string;
  direction: "forward" | "reverse";
  status: "unstudied" | "learning" | "review" | "mature";
  intervalDays: number;
  lastReviewedAt: string | null;
  nextDueAt: string | null;
  easeFactor: number;
};

type DatabaseSchema = {
  words: Word[];
  reviewItems: ReviewItem[];
};

type ExportRecord = {
  id: string;
  hanzi: string;
  pinyin: string;
  meanings: string[];
  intervalDays: number;
  lastReviewedAt: string;
  nextDueAt: string;
  sourceEntryCount: number;
  mergedSourceWordIds: number[];
};

const DEFAULT_INPUT = "tmp/hack-chinese-words.rtf";
const DEFAULT_OUTPUT = "data/hack-chinese-migration.json";
const DEFAULT_SNAPSHOT = new Date().toISOString();

function loadDocument(inputPath: string): string {
  if (inputPath.endsWith(".rtf")) {
    return execFileSync("textutil", ["-convert", "txt", "-stdout", inputPath], {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
  }

  return execFileSync("cat", [inputPath], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
}

function decodeReactProps(rawDocument: string): JsonObject {
  const marker = 'data-react-class="UserWords" data-react-props="';
  const start = rawDocument.indexOf(marker);

  if (start === -1) {
    throw new Error('Could not find `data-react-class="UserWords"` in the input file.');
  }

  const propsStart = start + marker.length;
  const propsEnd = rawDocument.indexOf('" data-react-cache-id=', propsStart);

  if (propsEnd === -1) {
    throw new Error("Found `UserWords`, but could not locate the end of `data-react-props`.");
  }

  const encodedProps = rawDocument.slice(propsStart, propsEnd);

  return JSON.parse(
    encodedProps
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">"),
  );
}

function collectSourceWords(props: JsonObject): SourceWord[] {
  const maybeWords = props.userWordsObject;

  if (!maybeWords || typeof maybeWords !== "object" || Array.isArray(maybeWords)) {
    throw new Error("Could not find `userWordsObject` inside the `UserWords` react props.");
  }

  return Object.values(maybeWords).filter((value): value is SourceWord => {
    const isWord =
      !!value &&
      typeof value === "object" &&
      "simplified" in value &&
      "opinyin" in value &&
      "status" in value &&
      "interval" in value &&
      "daysSinceLastReview" in value;

    if (!isWord) {
      return false;
    }

    return value.status !== "blocked";
  });
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeWordIdPart(value: string): string {
  return [...value].map((char) => {
    if (/[\p{Letter}\p{Number}]/u.test(char)) {
      return char;
    }

    return `u${char.codePointAt(0)?.toString(16)}`;
  }).join("");
}

function makeWordId(hanzi: string, pinyin: string): string {
  const pinyinSlug = escapeWordIdPart(pinyin.normalize("NFC").replace(/\s+/g, "_")) || "no-pinyin";
  const hanziSlug = escapeWordIdPart(hanzi);
  return `hc-${hanziSlug}-${pinyinSlug}`;
}

function subtractDays(isoTimestamp: string, days: number): string {
  const date = new Date(isoTimestamp);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function addDays(isoTimestamp: string, days: number): string {
  const date = new Date(isoTimestamp);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function trim(value: string) {
  return value.trim();
}

function mapStatus(intervalDays: number): Word["status"] {
  if (intervalDays >= 21) {
    return "mature";
  }

  if (intervalDays >= 7) {
    return "review";
  }

  return "learning";
}

function compareEntries(a: SourceWord, b: SourceWord): number {
  if (a.daysSinceLastReview !== b.daysSinceLastReview) {
    return a.daysSinceLastReview - b.daysSinceLastReview;
  }

  if (a.interval !== b.interval) {
    return b.interval - a.interval;
  }

  if (a.retentionRate !== b.retentionRate) {
    return b.retentionRate - a.retentionRate;
  }

  return b.wordId - a.wordId;
}

function mergeMeanings(entries: SourceWord[]): string[] {
  return [...new Set(entries.map((entry) => trim(entry.english)).filter(Boolean))];
}

function buildExportRecords(sourceWords: SourceWord[], snapshotAt: string): ExportRecord[] {
  const grouped = new Map<string, SourceWord[]>();

  for (const entry of sourceWords) {
    const hanzi = trim(entry.simplified);
    const pinyin = trim(entry.opinyin);
    const key = `${hanzi}\t${pinyin}`;
    const group = grouped.get(key) ?? [];
    group.push(entry);
    grouped.set(key, group);
  }

  return [...grouped.entries()]
    .map(([key, entries]) => {
      const [hanzi, pinyin] = key.split("\t");
      const sortedEntries = [...entries].sort(compareEntries);
      const chosen = sortedEntries[0];
      const intervalDays = Math.max(1, Math.round(chosen.interval));
      const lastReviewedAt = subtractDays(snapshotAt, chosen.daysSinceLastReview);
      const nextDueAt = addDays(lastReviewedAt, intervalDays);

      return {
        id: makeWordId(hanzi, pinyin),
        hanzi,
        pinyin,
        meanings: mergeMeanings(entries),
        intervalDays,
        lastReviewedAt,
        nextDueAt,
        sourceEntryCount: entries.length,
        mergedSourceWordIds: entries.map((entry) => entry.wordId).sort((a, b) => a - b),
      };
    })
    .sort((a, b) => a.hanzi.localeCompare(b.hanzi, "zh-Hans-CN") || a.pinyin.localeCompare(b.pinyin));
}

function buildDatabaseSchema(records: ExportRecord[], snapshotAt: string): DatabaseSchema {
  const words: Word[] = records.map((record, index) => {
    const status = mapStatus(record.intervalDays);

    return {
      id: record.id,
      hanzi: record.hanzi,
      pinyin: record.pinyin,
      meaning: record.meanings.join("; "),
      examples: [],
      status,
      availableAt: record.lastReviewedAt,
      priority: records.length - index,
      createdAt: snapshotAt,
    };
  });

  const reviewItems: ReviewItem[] = records.flatMap((record) => {
    const status = mapStatus(record.intervalDays);

    return [
      {
        id: `${record.id}-forward`,
        wordId: record.id,
        direction: "forward",
        status,
        intervalDays: record.intervalDays,
        lastReviewedAt: record.lastReviewedAt,
        nextDueAt: record.nextDueAt,
        easeFactor: 2.5,
      },
      {
        id: `${record.id}-reverse`,
        wordId: record.id,
        direction: "reverse",
        status,
        intervalDays: record.intervalDays,
        lastReviewedAt: record.lastReviewedAt,
        nextDueAt: record.nextDueAt,
        easeFactor: 2.5,
      },
    ];
  });

  return { words, reviewItems };
}

function parseArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  const inputArg = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : DEFAULT_INPUT;
  const outputArg = parseArgValue("--out") ?? DEFAULT_OUTPUT;
  const snapshotAt = parseArgValue("--snapshot") ?? DEFAULT_SNAPSHOT;

  const snapshotDate = new Date(snapshotAt);
  if (Number.isNaN(snapshotDate.getTime())) {
    throw new Error(`Invalid --snapshot timestamp: ${snapshotAt}`);
  }

  const inputPath = path.resolve(process.cwd(), inputArg);
  const outputPath = path.resolve(process.cwd(), outputArg);
  const outputDir = path.dirname(outputPath);

  const rawDocument = loadDocument(inputPath);
  const props = decodeReactProps(rawDocument);
  const sourceWords = collectSourceWords(props);
  const records = buildExportRecords(sourceWords, snapshotDate.toISOString());
  const schema = buildDatabaseSchema(records, snapshotDate.toISOString());

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        meta: {
          source: inputPath,
          snapshotAt: snapshotDate.toISOString(),
          sourceEntryCount: sourceWords.length,
          exportedWordCount: records.length,
          duplicateGroupsMerged: records.filter((record) => record.sourceEntryCount > 1).length,
        },
        records,
        words: schema.words,
        reviewItems: schema.reviewItems,
      },
      null,
      2,
    ),
  );

  console.log(
    JSON.stringify(
      {
        outputPath,
        snapshotAt: snapshotDate.toISOString(),
        sourceEntryCount: sourceWords.length,
        exportedWordCount: records.length,
        duplicateGroupsMerged: records.filter((record) => record.sourceEntryCount > 1).length,
        sample: records.slice(0, 5),
      },
      null,
      2,
    ),
  );
}

main();
