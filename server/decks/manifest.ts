import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeToneMarkedPinyin } from '../../scripts/lib/canonical-words.ts';

/**
 * Deck manifest loader for the diet deck distribution (SPECS/diet-deck-distribution.md).
 *
 * The manifest pins the deck set and the word -> deck assignments for the
 * Mandarin corpus. It is an optional local artifact: when the file is absent
 * the loader returns null and diet admission keeps its legacy behavior.
 */

export const DEFAULT_DECK_MANIFEST_PATH = fileURLToPath(
  new URL('./mandarin-decks-v1.json', import.meta.url),
);

export type DeckManifestHskTag = {
  version: string;
  level: number;
};

export type DeckManifestDeck = {
  id: string;
  order: number;
  hsk: DeckManifestHskTag | null;
  stratum: number | null;
  size: number;
};

export type DeckManifest = {
  meta: { manifestVersion: number } & Record<string, unknown>;
  /** Decks sorted by ascending `order`. */
  decks: DeckManifestDeck[];
  /** `${hanzi}|${pinyinNormalized}` -> deck id. */
  assignments: Record<string, string>;
};

const manifestCache = new Map<string, DeckManifest | null>();

/** Load and cache the manifest; returns null when the file does not exist. */
export function loadDeckManifest(filePath: string = DEFAULT_DECK_MANIFEST_PATH): DeckManifest | null {
  if (manifestCache.has(filePath)) {
    return manifestCache.get(filePath) ?? null;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      manifestCache.set(filePath, null);
      return null;
    }
    throw error;
  }

  const manifest = parseDeckManifest(JSON.parse(raw));
  manifestCache.set(filePath, manifest);
  return manifest;
}

/** Validate a parsed manifest payload. Present-but-malformed fails loudly. */
export function parseDeckManifest(value: unknown): DeckManifest {
  if (!isPlainRecord(value)) {
    throw new Error('Deck manifest must be a JSON object.');
  }

  const meta = value.meta;
  if (!isPlainRecord(meta) || meta.manifestVersion !== 1) {
    throw new Error('Deck manifest meta.manifestVersion must be 1.');
  }

  if (!Array.isArray(value.decks) || value.decks.length === 0) {
    throw new Error('Deck manifest decks must be a non-empty array.');
  }

  const decks: DeckManifestDeck[] = value.decks.map((entry, index) => {
    if (!isPlainRecord(entry)) {
      throw new Error(`Deck manifest deck at index ${index} must be an object.`);
    }
    if (typeof entry.id !== 'string' || entry.id.trim().length === 0) {
      throw new Error(`Deck manifest deck at index ${index} is missing a non-empty string id.`);
    }
    if (!Number.isInteger(entry.order) || (entry.order as number) < 0) {
      throw new Error(`Deck manifest deck "${entry.id}" has an invalid order.`);
    }
    if (entry.hsk !== null && entry.hsk !== undefined && !isHskTag(entry.hsk)) {
      throw new Error(`Deck manifest deck "${entry.id}" has an invalid hsk tag.`);
    }
    if (entry.stratum !== null && entry.stratum !== undefined && !Number.isInteger(entry.stratum)) {
      throw new Error(`Deck manifest deck "${entry.id}" has an invalid stratum.`);
    }
    if (!Number.isInteger(entry.size) || (entry.size as number) < 0) {
      throw new Error(`Deck manifest deck "${entry.id}" has an invalid size.`);
    }
    return {
      id: entry.id,
      order: entry.order as number,
      hsk: (entry.hsk ?? null) as DeckManifestHskTag | null,
      stratum: (entry.stratum ?? null) as number | null,
      size: entry.size as number,
    };
  });

  decks.sort((left, right) => left.order - right.order);

  const deckIds = new Set<string>();
  const orders = new Set<number>();
  for (const deck of decks) {
    if (deckIds.has(deck.id)) {
      throw new Error(`Deck manifest has a duplicate deck id "${deck.id}".`);
    }
    if (orders.has(deck.order)) {
      throw new Error(`Deck manifest has a duplicate deck order ${deck.order}.`);
    }
    deckIds.add(deck.id);
    orders.add(deck.order);
  }

  if (!isPlainRecord(value.assignments)) {
    throw new Error('Deck manifest assignments must be an object.');
  }
  const assignments: Record<string, string> = {};
  for (const [key, deckId] of Object.entries(value.assignments)) {
    if (typeof deckId !== 'string' || !deckIds.has(deckId)) {
      throw new Error(`Deck manifest assignment "${key}" references an unknown deck id.`);
    }
    assignments[key] = deckId;
  }

  return {
    meta: meta as DeckManifest['meta'],
    decks,
    assignments,
  };
}

/** Canonical assignment key: hanzi + normalized (tone-marked) pinyin. */
export function deckAssignmentKey(hanzi: string, pinyin: string): string {
  return `${hanzi.trim()}|${normalizeToneMarkedPinyin(pinyin)}`;
}

/** The tail deck ("beyond-hsk" expanse) is the last deck by manifest order. */
export function getTailDeckId(manifest: DeckManifest): string {
  const tail = manifest.decks[manifest.decks.length - 1];
  if (!tail) {
    throw new Error('Deck manifest invariant violated: no decks.');
  }
  return tail.id;
}

/** Join a word to its deck; words missing from assignments land in the tail deck. */
export function getDeckIdForWord(manifest: DeckManifest, hanzi: string, pinyin: string): string {
  return manifest.assignments[deckAssignmentKey(hanzi, pinyin)] ?? getTailDeckId(manifest);
}

function isHskTag(value: unknown): value is DeckManifestHskTag {
  return isPlainRecord(value)
    && typeof value.version === 'string'
    && Number.isInteger(value.level);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
