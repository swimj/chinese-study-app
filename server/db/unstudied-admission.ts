export type UnstudiedStashCandidate = {
  id: string;
  overlayUpdatedAt: string;
  isTop: boolean;
  isRequired: boolean;
};

export type UnstudiedAdmissionInput = {
  stash: UnstudiedStashCandidate[];
  dietIds: string[];
  remainingQuota: number;
  seedSource: string;
  /** Fraction of the remaining quota offered to stash; defaults to 0.5. */
  stashRatio?: number;
};

export type UnstudiedStashAdmissionPlan = {
  selectedStashIds: string[];
  /** Diet slots after the actual selected stash contribution is known. */
  dietDemand: number;
};

export function splitRemainingUnstudiedQuota(
  remainingQuota: number,
  stashRatio: number = DEFAULT_STASH_RATIO,
): {
  stashSlots: number;
  dietSlots: number;
} {
  if (!Number.isInteger(remainingQuota) || remainingQuota < 0) {
    throw new Error(`Expected non-negative integer remaining unstudied quota, received ${String(remainingQuota)}`);
  }
  assertStashRatio(stashRatio);

  const stashSlots = Math.floor(remainingQuota * stashRatio);
  return {
    stashSlots,
    dietSlots: remainingQuota - stashSlots,
  };
}

export const DEFAULT_STASH_RATIO = 0.5;

function assertStashRatio(stashRatio: number): void {
  if (typeof stashRatio !== 'number' || !Number.isFinite(stashRatio) || stashRatio < 0 || stashRatio > 1) {
    throw new Error(`Expected stash ratio in [0, 1], received ${String(stashRatio)}`);
  }
}

export function buildUnstudiedAdmissionSeedSource(studyDayKey: string, remainingQuota: number): string {
  if (!Number.isInteger(remainingQuota) || remainingQuota < 0) {
    throw new Error(`Expected non-negative integer remaining unstudied quota, received ${String(remainingQuota)}`);
  }

  return `unstudied-admission:${studyDayKey}:${remainingQuota}`;
}

export function selectAdmittedUnstudiedWordIds(input: UnstudiedAdmissionInput): string[] {
  const stashPlan = planUnstudiedStashAdmission(input);
  const stashById = indexStashCandidates(input.stash);
  assertDisjointPools(stashById, input.dietIds);

  const selectedStashIds = new Set(stashPlan.selectedStashIds);
  const selectedDietIds = input.dietIds.slice(0, stashPlan.dietDemand);
  const selectedDietIdSet = new Set(selectedDietIds);

  const requiredBypass = input.stash
    .filter((candidate) => (
      candidate.isRequired
      && !selectedStashIds.has(candidate.id)
      && !selectedDietIdSet.has(candidate.id)
    ))
    .sort(compareStashNewestFirst);

  return [
    ...stashPlan.selectedStashIds,
    ...selectedDietIds,
    ...requiredBypass.map((candidate) => candidate.id),
  ];
}

/**
 * Select stash once under the established policy, then expose the actual diet
 * demand. Callers that load diet candidates use this plan before apportioning
 * deck targets so a full stash does not distort the diet mix.
 */
export function planUnstudiedStashAdmission(input: Pick<UnstudiedAdmissionInput, 'stash' | 'remainingQuota' | 'seedSource' | 'stashRatio'>): UnstudiedStashAdmissionPlan {
  const { stashSlots } = splitRemainingUnstudiedQuota(input.remainingQuota, input.stashRatio ?? DEFAULT_STASH_RATIO);
  indexStashCandidates(input.stash);

  const tops = input.stash
    .filter((candidate) => candidate.isTop)
    .sort(compareStashNewestFirst);
  const selectedTops = tops.slice(0, stashSlots);

  const nonTops = input.stash
    .filter((candidate) => !candidate.isTop)
    .sort(compareIdAsc);
  const shuffledNonTops = seededShuffle(nonTops, input.seedSource);
  const selectedNonTops = shuffledNonTops.slice(0, Math.max(0, stashSlots - selectedTops.length));

  const selectedStash = [...selectedTops, ...selectedNonTops];
  return {
    selectedStashIds: selectedStash.map((candidate) => candidate.id),
    dietDemand: input.remainingQuota - selectedStash.length,
  };
}

// --- Deck-based diet sampling (SPECS/diet-deck-distribution.md §2.4) ----------

/**
 * Split diet demand across weighted decks with largest-remainder rounding.
 * Only decks with positive weight receive a target.
 */
export function planDeckDietTargets(
  demand: number,
  weights: Record<string, number>,
  orderedDeckIds: string[],
): Map<string, number> {
  if (!Number.isInteger(demand) || demand < 0) {
    throw new Error(`Expected non-negative integer diet demand, received ${String(demand)}`);
  }

  const targets = new Map<string, number>();
  const weighted = orderedDeckIds
    .map((deckId) => ({ deckId, weight: weights[deckId] ?? 0 }))
    .filter((entry) => entry.weight > 0);
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) {
    return targets;
  }

  const remainders: Array<{ deckId: string; remainder: number }> = [];
  let assigned = 0;
  for (const entry of weighted) {
    const exact = (demand * entry.weight) / totalWeight;
    const floor = Math.floor(exact);
    targets.set(entry.deckId, floor);
    assigned += floor;
    remainders.push({ deckId: entry.deckId, remainder: exact - floor });
  }

  // Largest remainder first; ties break to the earlier deck for determinism.
  remainders.sort((left, right) => right.remainder - left.remainder);
  for (let index = 0; index < demand - assigned; index += 1) {
    const entry = remainders[index % remainders.length];
    if (!entry) {
      throw new Error('Deck diet target invariant violated: no remainder entry.');
    }
    targets.set(entry.deckId, (targets.get(entry.deckId) ?? 0) + 1);
  }
  return targets;
}

export type DeckDietSelectionInput = {
  /** deck id -> target draw count (weighted decks only). */
  targets: Map<string, number>;
  /**
   * Load one deck's candidate ids on demand. The selector never asks for a
   * successor while already-loaded decks satisfy the limit.
   */
  loadCandidatesForDeck: (deckId: string) => string[];
  /** Successor deck ids in spill order, used when weighted decks under-fill. */
  spillDeckIds: string[];
  seedSource: string;
  /** Maximum words to return (the remaining quota). */
  limit: number;
};

/**
 * Seeded diet draw across decks: uniform sample within each deck toward its
 * target, then spill into successor decks in order when the weighted set
 * under-fills. Deterministic for a given seed source and candidate sets.
 */
export function selectDeckDietWordIds(input: DeckDietSelectionInput): string[] {
  if (!Number.isInteger(input.limit) || input.limit < 0) {
    throw new Error(`Expected non-negative integer diet limit, received ${String(input.limit)}`);
  }

  const selected: string[] = [];
  const selectedIds = new Set<string>();
  const take = (deckId: string, count: number): void => {
    const candidates = input.loadCandidatesForDeck(deckId);
    const shuffled = seededShuffle([...candidates].sort(), `${input.seedSource}:deck:${deckId}`);
    for (const id of shuffled) {
      if (selected.length >= input.limit || count <= 0) {
        break;
      }
      if (selectedIds.has(id)) {
        throw new Error(`Deck diet invariant violated: word "${id}" selected twice (deck "${deckId}").`);
      }
      selectedIds.add(id);
      selected.push(id);
      count -= 1;
    }
  };

  for (const [deckId, target] of input.targets) {
    if (selected.length >= input.limit) {
      break;
    }
    if (target > 0) {
      take(deckId, target);
    }
  }

  for (const deckId of input.spillDeckIds) {
    if (selected.length >= input.limit) {
      break;
    }
    take(deckId, input.limit - selected.length);
  }

  return selected;
}

function indexStashCandidates(stash: UnstudiedStashCandidate[]): Map<string, UnstudiedStashCandidate> {
  const stashById = new Map<string, UnstudiedStashCandidate>();

  for (const candidate of stash) {
    assertNonEmptyString(candidate.id, 'Unstudied stash candidate is missing an id.');
    assertNonEmptyString(candidate.overlayUpdatedAt, `Unstudied stash candidate "${candidate.id}" is missing overlayUpdatedAt.`);

    if (stashById.has(candidate.id)) {
      throw new Error(`Unstudied admission invariant violated: duplicate stash candidate "${candidate.id}".`);
    }

    stashById.set(candidate.id, candidate);
  }

  return stashById;
}

function assertDisjointPools(stashById: Map<string, UnstudiedStashCandidate>, dietIds: string[]): void {
  const seenDietIds = new Set<string>();

  for (const dietId of dietIds) {
    assertNonEmptyString(dietId, 'Unstudied diet candidate is missing an id.');

    if (seenDietIds.has(dietId)) {
      throw new Error(`Unstudied admission invariant violated: duplicate diet candidate "${dietId}".`);
    }

    if (stashById.has(dietId)) {
      throw new Error(`Unstudied admission invariant violated: word "${dietId}" is in both stash and diet.`);
    }

    seenDietIds.add(dietId);
  }
}

function compareStashNewestFirst(left: UnstudiedStashCandidate, right: UnstudiedStashCandidate): number {
  const updatedAtDelta = right.overlayUpdatedAt.localeCompare(left.overlayUpdatedAt);
  if (updatedAtDelta !== 0) {
    return updatedAtDelta;
  }

  return left.id.localeCompare(right.id);
}

function compareIdAsc(left: UnstudiedStashCandidate, right: UnstudiedStashCandidate): number {
  return left.id.localeCompare(right.id);
}

function seededShuffle<T>(items: T[], seedSource: string): T[] {
  const shuffled = [...items];
  const rng = createSeededRng(seedSource);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const current = shuffled[index];
    const swapped = shuffled[swapIndex];
    if (current === undefined || swapped === undefined) {
      throw new Error('Unstudied admission invariant violated: shuffle index was empty.');
    }

    shuffled[index] = swapped;
    shuffled[swapIndex] = current;
  }

  return shuffled;
}

function createSeededRng(seedSource: string): () => number {
  assertNonEmptyString(seedSource, 'Unstudied admission seed source must be a nonempty string.');

  let state = hashSeedSource(seedSource);
  if (state === 0) {
    state = 0x9e3779b9;
  }

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function hashSeedSource(seedSource: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < seedSource.length; index += 1) {
    hash ^= seedSource.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function assertNonEmptyString(value: string, message: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(message);
  }
}
