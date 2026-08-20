import { createHash } from 'node:crypto';

export type IntakeTriageLexicalSnapshot = {
  hanzi: string;
  traditional: string | null;
  pinyin: string;
  meanings: string[];
  examples: string[];
};

export function fingerprintIntakeTriageLexicalSnapshot(snapshot: IntakeTriageLexicalSnapshot): string {
  return createHash('sha256').update(JSON.stringify({
    hanzi: snapshot.hanzi,
    traditional: snapshot.traditional,
    pinyin: snapshot.pinyin,
    meanings: snapshot.meanings,
    examples: snapshot.examples,
  })).digest('hex');
}
