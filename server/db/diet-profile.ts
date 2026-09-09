import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import {
  loadDeckManifest,
  type DeckManifest,
} from '../decks/manifest.ts';
import type { DietIntakePlacementRunMetadata } from '../diet/intake-placement-provider.ts';

/**
 * Learner diet profile (SPECS/diet-deck-distribution.md §2.3).
 *
 * The profile is a versioned JSON value in the `learner_settings` key-value
 * store under `diet_profile`. When unset, the effective profile defaults to
 * 100% weight on the first deck by manifest order. Deck machinery is never
 * user-visible; nudges are the learner's coarse steering signal and operator
 * jumps happen through scripts/set-diet-deck.ts (no HTTP endpoint).
 */

export const DIET_PROFILE_SETTING_KEY = 'diet_profile';
export const DIET_PROFILE_VERSION = 1;
/** Fixed weight quantum shifted by one nudge. Internal, never user-visible. */
export const DIET_NUDGE_QUANTUM = 0.1;

export const STASH_DIET_SPLIT_SETTING_KEY = 'stash_diet_split';
export const DEFAULT_STASH_DIET_SPLIT = 0.5;

export type DietProvenanceActor = 'intake' | 'learner-nudge' | 'operator';

export type DietProvenanceEntry = {
  actor: DietProvenanceActor;
  at: string;
  note?: string;
};

export type DietSelfSelect =
  | 'complete-beginner'
  | 'some-basics'
  | 'intermediate'
  | 'advanced-or-heritage';

export const DIET_SELF_SELECT_VALUES: readonly DietSelfSelect[] = [
  'complete-beginner',
  'some-basics',
  'intermediate',
  'advanced-or-heritage',
];

export type DietIntakeAnswer = {
  prompt: string;
  answer: string;
};

export type DietIntakeRecord = {
  answers: DietIntakeAnswer[];
  selfSelect: DietSelfSelect | null;
  at: string;
  assessment?: {
    nextLearningLevel: 1 | 2 | 3 | 4 | 5 | 6;
    rationale: string;
    provider: DietIntakePlacementRunMetadata;
  };
};

export type DietProfile = {
  version: typeof DIET_PROFILE_VERSION;
  /** deck id -> weight; weights over known decks normalize to 1. */
  weights: Record<string, number>;
  provenance: DietProvenanceEntry[];
  updatedAt: string;
  intake?: DietIntakeRecord;
};

export type DietNudgeDirection = 'easier' | 'harder';

export class DietManifestUnavailableError extends Error {
  constructor() {
    super('The deck manifest is not available on this installation.');
    this.name = 'DietManifestUnavailableError';
  }
}

export class UnknownDietDeckError extends Error {
  constructor(deckId: string) {
    super(`Unknown deck id "${deckId}".`);
    this.name = 'UnknownDietDeckError';
  }
}

export class DietProfileChangedDuringAssessmentError extends Error {
  constructor() {
    super('The diet profile changed while the intake assessment was running.');
    this.name = 'DietProfileChangedDuringAssessmentError';
  }
}

// --- Pure transitions -------------------------------------------------------

/** Default when unset: 100% weight on the first deck by manifest order. */
export function createDefaultDietProfile(manifest: DeckManifest, now: string): DietProfile {
  const first = manifest.decks[0];
  if (!first) {
    throw new Error('Deck manifest invariant violated: no decks.');
  }
  return {
    version: DIET_PROFILE_VERSION,
    weights: { [first.id]: 1 },
    provenance: [],
    updatedAt: now,
  };
}

/**
 * Effective weights over known decks: unknown (stale) deck ids are dropped,
 * and an empty result falls back to the first deck. Used by nudges and by
 * deck-aware diet admission.
 */
export function resolveEffectiveDietWeights(
  profile: DietProfile,
  manifest: DeckManifest,
): Record<string, number> {
  const knownDeckIds = new Set(manifest.decks.map((deck) => deck.id));
  const effective: Record<string, number> = {};
  for (const [deckId, weight] of Object.entries(profile.weights)) {
    if (knownDeckIds.has(deckId) && typeof weight === 'number' && weight > 0) {
      effective[deckId] = weight;
    }
  }
  if (Object.keys(effective).length === 0) {
    const first = manifest.decks[0];
    if (!first) {
      throw new Error('Deck manifest invariant violated: no decks.');
    }
    effective[first.id] = 1;
  }
  return effective;
}

/**
 * Shift one weight quantum across the adjacent-deck boundary in the nudge
 * direction. Edge-drain semantics: 'harder' drains the lowest-order weighted
 * deck into its successor, 'easier' drains the highest-order weighted deck
 * into its predecessor — so nudges are directional and reversible (an
 * 'easier' nudge undoes a 'harder' one). Clamped at the ends: a nudge past
 * the first/last deck is a no-op and records no provenance.
 */
export function applyDietNudge(
  profile: DietProfile,
  manifest: DeckManifest,
  direction: DietNudgeDirection,
  now: string,
): { profile: DietProfile; changed: boolean } {
  const weights = resolveEffectiveDietWeights(profile, manifest);
  const orderedDecks = manifest.decks;

  const weightedIndices = orderedDecks
    .map((deck, index) => ({ index, weight: weights[deck.id] ?? 0 }))
    .filter((entry) => entry.weight > 0);
  const sourceEntry = direction === 'harder' ? weightedIndices[0] : weightedIndices[weightedIndices.length - 1];
  if (!sourceEntry) {
    throw new Error('Diet profile invariant violated: no weighted deck.');
  }

  const targetIndex = sourceEntry.index + (direction === 'harder' ? 1 : -1);
  const source = orderedDecks[sourceEntry.index];
  const target = orderedDecks[targetIndex];
  if (!source || !target) {
    return { profile, changed: false };
  }

  const moved = Math.min(DIET_NUDGE_QUANTUM, weights[source.id] ?? 0);
  const nextWeights: Record<string, number> = { ...weights };
  nextWeights[source.id] = (nextWeights[source.id] ?? 0) - moved;
  nextWeights[target.id] = (nextWeights[target.id] ?? 0) + moved;

  return {
    profile: {
      ...profile,
      weights: normalizeWeights(nextWeights),
      provenance: [...profile.provenance, { actor: 'learner-nudge', at: now, note: direction }],
      updatedAt: now,
    },
    changed: true,
  };
}

/**
 * Provisional v1 placement mapping (SPECS/diet-deck-distribution.md §2.11):
 * a coarse self-select maps onto the first deck of an HSK target level
 * (beginner → L1, some basics → L2, intermediate → L4, advanced/heritage →
 * L6). When no deck carries the target level (small manifests), walk DOWN to
 * the nearest lower level — under-placement is safer than over-placement
 * because nudges and spill correct upward. Without a self-select the learner
 * starts on the first deck. The tail deck is never a placement target.
 */
export function mapSelfSelectToDeckId(manifest: DeckManifest, selfSelect: DietSelfSelect | null): string {
  const decks = manifest.decks;
  if (decks.length === 0) {
    throw new Error('Deck manifest invariant violated: no decks.');
  }

  const targetLevel: number | null = selfSelect === null || selfSelect === 'complete-beginner'
    ? null
    : selfSelect === 'some-basics'
      ? 2
      : selfSelect === 'intermediate'
        ? 4
        : 6;

  if (targetLevel === null) {
    return decks[0]!.id;
  }
  for (let level = targetLevel; level >= 1; level -= 1) {
    const deck = decks.find((candidate) => candidate.hsk?.version === '2.0' && candidate.hsk.level === level);
    if (deck) {
      return deck.id;
    }
  }
  return decks[0]!.id;
}

/** Map a provider-selected next HSK learning level without exposing deck machinery. */
export function mapNextLearningLevelToDeckId(
  manifest: DeckManifest,
  nextLearningLevel: 1 | 2 | 3 | 4 | 5 | 6,
): string {
  if (!Number.isInteger(nextLearningLevel) || nextLearningLevel < 1 || nextLearningLevel > 6) {
    throw new Error('Diet intake next learning level must be an integer from 1 through 6.');
  }
  const decks = manifest.decks;
  if (decks.length === 0) throw new Error('Deck manifest invariant violated: no decks.');
  for (let level = nextLearningLevel; level >= 1; level -= 1) {
    const deck = decks.find((candidate) => candidate.hsk?.version === '2.0' && candidate.hsk.level === level);
    if (deck) return deck.id;
  }
  throw new Error('Deck manifest has no HSK 2.0 deck available for intake placement.');
}

/**
 * Store raw natural-language intake answers plus the resulting initial
 * placement. Intake answers are profile evidence, never study actions.
 * Placement (re)initializes the weights at 100% on the placed deck; prior
 * provenance is retained.
 */
export function applyDietIntake(
  current: DietProfile | null,
  manifest: DeckManifest,
  input: { answers: DietIntakeAnswer[]; selfSelect: DietSelfSelect | null },
  now: string,
): DietProfile {
  const deckId = mapSelfSelectToDeckId(manifest, input.selfSelect);
  return {
    version: DIET_PROFILE_VERSION,
    weights: { [deckId]: 1 },
    provenance: [
      ...(current?.provenance ?? []),
      {
        actor: 'intake',
        at: now,
        note: input.selfSelect ? `self-select: ${input.selfSelect}` : 'intake without self-select',
      },
    ],
    updatedAt: now,
    intake: {
      answers: input.answers,
      selfSelect: input.selfSelect,
      at: now,
    },
  };
}

export function applyAssessedDietIntake(
  current: DietProfile | null,
  manifest: DeckManifest,
  input: {
    answers: DietIntakeAnswer[];
    level: 1 | 2 | 3 | 4 | 5 | 6;
    rationale: string;
    provider: DietIntakePlacementRunMetadata;
  },
  now: string,
): DietProfile {
  const deckId = mapNextLearningLevelToDeckId(manifest, input.level);
  return {
    version: DIET_PROFILE_VERSION,
    weights: { [deckId]: 1 },
    provenance: [
      ...(current?.provenance ?? []),
      { actor: 'intake', at: now, note: 'provider-assessed initial placement' },
    ],
    updatedAt: now,
    intake: {
      answers: input.answers,
      selfSelect: null,
      at: now,
      assessment: {
        nextLearningLevel: input.level,
        rationale: input.rationale,
        provider: input.provider,
      },
    },
  };
}

/** Operator jump: 100% weight on a chosen deck (concierge correction). */
export function applyOperatorDietJump(
  current: DietProfile | null,
  manifest: DeckManifest,
  deckId: string,
  note: string | null,
  now: string,
): DietProfile {
  if (!manifest.decks.some((deck) => deck.id === deckId)) {
    throw new UnknownDietDeckError(deckId);
  }
  return {
    version: DIET_PROFILE_VERSION,
    weights: { [deckId]: 1 },
    provenance: [
      ...(current?.provenance ?? []),
      { actor: 'operator', at: now, ...(note ? { note } : {}) },
    ],
    updatedAt: now,
    ...(current?.intake ? { intake: current.intake } : {}),
  };
}

// --- Persistence ------------------------------------------------------------

/** The stored profile, or null when unset. Corrupt values fail loudly. */
export function getStoredDietProfile(): DietProfile | null {
  const raw = readStoredDietProfileJson();
  return raw === null ? null : parseDietProfile(JSON.parse(raw));
}

/** Exact stored JSON used to reject an asynchronous assessment that went stale. */
export function snapshotStoredDietProfile(): string | null {
  return readStoredDietProfileJson();
}

function readStoredDietProfileJson(): string | null {
  const row = getDb()
    .prepare(`
      SELECT value_json
      FROM learner_settings
      WHERE learner_id = ? AND setting_key = ?
    `)
    .get(requireLearnerId(), DIET_PROFILE_SETTING_KEY) as { value_json: string } | undefined;

  return row?.value_json ?? null;
}

export function saveDietProfile(profile: DietProfile): DietProfile {
  getDb().prepare(`
    INSERT INTO learner_settings (
      learner_id,
      setting_key,
      value_json,
      updated_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(learner_id, setting_key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(requireLearnerId(), DIET_PROFILE_SETTING_KEY, JSON.stringify(profile), profile.updatedAt);
  return profile;
}

/**
 * The learner's stash share of the remaining unstudied quota (SPECS
 * §2.4), stored as a JSON number in learner_settings. Defaults to 0.5.
 * Stored but not user-visible in v1; invalid values fail loudly.
 */
export function getStashDietSplit(): number {
  const row = getDb()
    .prepare(`
      SELECT value_json
      FROM learner_settings
      WHERE learner_id = ? AND setting_key = ?
    `)
    .get(requireLearnerId(), STASH_DIET_SPLIT_SETTING_KEY) as { value_json: string } | undefined;

  if (!row) {
    return DEFAULT_STASH_DIET_SPLIT;
  }
  const value: unknown = JSON.parse(row.value_json);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Invalid ${STASH_DIET_SPLIT_SETTING_KEY} setting: expected a JSON number in [0, 1].`);
  }
  return value;
}

/** Stored profile when present, otherwise the manifest-order default (not persisted). */
export function getDietProfile(manifest: DeckManifest | null = loadDeckManifest()): DietProfile | null {
  const stored = getStoredDietProfile();
  if (stored) {
    return stored;
  }
  if (!manifest) {
    return null;
  }
  return createDefaultDietProfile(manifest, new Date().toISOString());
}

// --- Learner/operator-facing operations -------------------------------------

export function nudgeDietProfile(
  direction: DietNudgeDirection,
  manifest: DeckManifest | null = loadDeckManifest(),
): { profile: DietProfile; changed: boolean } {
  if (!manifest) {
    throw new DietManifestUnavailableError();
  }
  const now = new Date().toISOString();
  const current = getStoredDietProfile() ?? createDefaultDietProfile(manifest, now);
  const result = applyDietNudge(current, manifest, direction, now);
  if (result.changed) {
    saveDietProfile(result.profile);
  }
  return result;
}

export function recordDietIntake(
  input: { answers: DietIntakeAnswer[]; selfSelect: DietSelfSelect | null },
  manifest: DeckManifest | null = loadDeckManifest(),
): DietProfile {
  if (!manifest) {
    throw new DietManifestUnavailableError();
  }
  const profile = applyDietIntake(getStoredDietProfile(), manifest, input, new Date().toISOString());
  return saveDietProfile(profile);
}

export function recordAssessedDietIntakeIfUnchanged(
  input: {
    answers: DietIntakeAnswer[];
    level: 1 | 2 | 3 | 4 | 5 | 6;
    rationale: string;
    provider: DietIntakePlacementRunMetadata;
    at: string;
  },
  beforeSnapshot: string | null,
  manifest: DeckManifest | null = loadDeckManifest(),
): DietProfile {
  if (!manifest) throw new DietManifestUnavailableError();
  const database = getDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const currentSnapshot = readStoredDietProfileJson();
    if (currentSnapshot !== beforeSnapshot) throw new DietProfileChangedDuringAssessmentError();
    const current = currentSnapshot === null ? null : parseDietProfile(JSON.parse(currentSnapshot));
    const profile = applyAssessedDietIntake(current, manifest, input, input.at);
    saveDietProfile(profile);
    database.exec('COMMIT');
    return profile;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function setOperatorDietDeck(
  deckId: string,
  note: string | null = null,
  manifest: DeckManifest | null = loadDeckManifest(),
): DietProfile {
  if (!manifest) {
    throw new DietManifestUnavailableError();
  }
  const profile = applyOperatorDietJump(getStoredDietProfile(), manifest, deckId, note, new Date().toISOString());
  return saveDietProfile(profile);
}

// --- Validation ---------------------------------------------------------------

export function parseDietProfile(value: unknown): DietProfile {
  if (!isPlainRecord(value)) {
    throw new Error('Diet profile must be a JSON object.');
  }
  if (value.version !== DIET_PROFILE_VERSION) {
    throw new Error(`Diet profile version must be ${DIET_PROFILE_VERSION}.`);
  }
  if (!isPlainRecord(value.weights)) {
    throw new Error('Diet profile weights must be an object.');
  }
  const weights: Record<string, number> = {};
  for (const [deckId, weight] of Object.entries(value.weights)) {
    if (typeof deckId !== 'string' || deckId.length === 0 || typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
      throw new Error('Diet profile weights must map deck ids to non-negative finite numbers.');
    }
    weights[deckId] = weight;
  }
  if (!Array.isArray(value.provenance)) {
    throw new Error('Diet profile provenance must be an array.');
  }
  const provenance: DietProvenanceEntry[] = value.provenance.map((entry, index) => {
    if (!isPlainRecord(entry)
      || (entry.actor !== 'intake' && entry.actor !== 'learner-nudge' && entry.actor !== 'operator')
      || typeof entry.at !== 'string'
      || (entry.note !== undefined && typeof entry.note !== 'string')) {
      throw new Error(`Diet profile provenance entry at index ${index} is invalid.`);
    }
    return entry.note === undefined
      ? { actor: entry.actor, at: entry.at }
      : { actor: entry.actor, at: entry.at, note: entry.note };
  });
  if (typeof value.updatedAt !== 'string') {
    throw new Error('Diet profile updatedAt must be a string.');
  }

  let intake: DietIntakeRecord | undefined;
  if (value.intake !== undefined) {
    if (!isPlainRecord(value.intake)
      || !Array.isArray(value.intake.answers)
      || !value.intake.answers.every((answer) => isPlainRecord(answer)
        && typeof answer.prompt === 'string'
        && typeof answer.answer === 'string')
      || (value.intake.selfSelect !== null && !isDietSelfSelect(value.intake.selfSelect))
      || typeof value.intake.at !== 'string'
      || (value.intake.assessment !== undefined && !isValidDietIntakeAssessment(value.intake.assessment))) {
      throw new Error('Diet profile intake record is invalid.');
    }
    intake = {
      answers: value.intake.answers.map((answer) => ({ prompt: answer.prompt as string, answer: answer.answer as string })),
      selfSelect: value.intake.selfSelect as DietSelfSelect | null,
      at: value.intake.at,
      ...(value.intake.assessment === undefined ? {} : { assessment: value.intake.assessment as DietIntakeRecord['assessment'] }),
    };
  }

  return {
    version: DIET_PROFILE_VERSION,
    weights,
    provenance,
    updatedAt: value.updatedAt,
    ...(intake ? { intake } : {}),
  };
}

function isValidDietIntakeAssessment(value: unknown): boolean {
  if (!isPlainRecord(value)
    || typeof value.nextLearningLevel !== 'number'
    || !Number.isInteger(value.nextLearningLevel)
    || value.nextLearningLevel < 1 || value.nextLearningLevel > 6
    || typeof value.rationale !== 'string'
    || !isPlainRecord(value.provider)) return false;
  const provider = value.provider;
  return typeof provider.provider === 'string'
    && typeof provider.modelConfig === 'string'
    && typeof provider.providerModel === 'string'
    && typeof provider.promptVersion === 'string'
    && typeof provider.clientRequestId === 'string'
    && (typeof provider.responseId === 'string' || provider.responseId === null)
    && (typeof provider.finishReason === 'string' || provider.finishReason === null)
    && isNormalizedTokenUsage(provider.usage);
}

function isNormalizedTokenUsage(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  return ['inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'outputTokens', 'reasoningTokens', 'totalTokens']
    .every((key) => value[key] === null || (typeof value[key] === 'number' && Number.isFinite(value[key])));
}

export function isDietSelfSelect(value: unknown): value is DietSelfSelect {
  return typeof value === 'string' && (DIET_SELF_SELECT_VALUES as readonly string[]).includes(value);
}

function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  const entries = Object.entries(weights).filter(([, weight]) => weight > 1e-9);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) {
    throw new Error('Diet profile invariant violated: weights sum to zero.');
  }
  return Object.fromEntries(entries.map(([deckId, weight]) => [deckId, weight / total]));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
