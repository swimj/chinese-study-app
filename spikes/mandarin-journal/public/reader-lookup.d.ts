type AuthoredLookup = {
  anchor: { surface: 'read'; ownerId: string; startId: string; endId: string; startOffset: number; endOffset: number; quote: string };
  pinyin: string;
  gloss: string;
};
export function passageLookups(owner: string, block: string, text: string): AuthoredLookup[];
export function characterLookup(term: AuthoredLookup, offset: number): AuthoredLookup | undefined;
