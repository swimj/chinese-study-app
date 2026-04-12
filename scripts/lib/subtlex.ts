import { execFileSync } from 'node:child_process';
import { canonicalJoinKey, fuzzyJoinKey } from './canonical-words.ts';

export type SubtlexPosRow = {
  wordForm: string;
  pos: string;
  count: number;
};

export type SubtlexEntry = {
  lemma: string;
  lemmaCount: number;
  posRows: SubtlexPosRow[];
  sourceKey: string;
};

export function readSubtlexFile(filePath: string): string {
  return execFileSync('iconv', ['-f', 'GB18030', '-t', 'UTF-8', filePath], {
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
  });
}

export function parseSubtlex(contents: string): SubtlexEntry[] {
  const entries: SubtlexEntry[] = [];
  const lines = contents.split(/\r?\n/).map((line) => line.replace(/\t+$/, ''));

  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    index += 1;

    if (!line || line.startsWith('"Total word count:') || line.startsWith('Lemma\t')) {
      continue;
    }

    const columns = line.split('\t');
    if (columns.length < 4 || columns[2] !== '-' || columns[3] !== '-') {
      continue;
    }

    const lemma = columns[0];
    const lemmaCount = Number.parseInt(columns[1], 10);
    const posRows: SubtlexPosRow[] = [];

    while (index < lines.length) {
      const posLine = lines[index].trim();

      if (!posLine) {
        index += 1;
        break;
      }

      const posColumns = posLine.split('\t');
      if (posColumns.length < 5 || posColumns[0] !== '@') {
        break;
      }

      posRows.push({
        wordForm: posColumns[2],
        pos: posColumns[3],
        count: Number.parseInt(posColumns[4], 10),
      });
      index += 1;
    }

    entries.push({
      lemma,
      lemmaCount,
      posRows,
      sourceKey: lemma,
    });
  }

  return entries;
}

export function subtlexExactKey(hanzi: string): string {
  return canonicalJoinKey(hanzi, '');
}

export function subtlexFuzzyKey(hanzi: string): string {
  return fuzzyJoinKey(hanzi, '');
}
