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
};

export function splitRemainingUnstudiedQuota(remainingQuota: number): {
  stashSlots: number;
  dietSlots: number;
} {
  if (!Number.isInteger(remainingQuota) || remainingQuota < 0) {
    throw new Error(`Expected non-negative integer remaining unstudied quota, received ${String(remainingQuota)}`);
  }

  const stashSlots = Math.floor(remainingQuota / 2);
  return {
    stashSlots,
    dietSlots: remainingQuota - stashSlots,
  };
}

export function buildUnstudiedAdmissionSeedSource(studyDayKey: string, remainingQuota: number): string {
  if (!Number.isInteger(remainingQuota) || remainingQuota < 0) {
    throw new Error(`Expected non-negative integer remaining unstudied quota, received ${String(remainingQuota)}`);
  }

  return `unstudied-admission:${studyDayKey}:${remainingQuota}`;
}

export function selectAdmittedUnstudiedWordIds(input: UnstudiedAdmissionInput): string[] {
  const { stashSlots, dietSlots } = splitRemainingUnstudiedQuota(input.remainingQuota);
  const stashById = indexStashCandidates(input.stash);
  assertDisjointPools(stashById, input.dietIds);

  const tops = input.stash
    .filter((candidate) => candidate.isTop)
    .sort(compareStashNewestFirst);
  const selectedTops = tops.slice(0, stashSlots);

  const selectedTopIds = new Set(selectedTops.map((candidate) => candidate.id));
  const nonTops = input.stash
    .filter((candidate) => !candidate.isTop)
    .sort(compareIdAsc);
  const shuffledNonTops = seededShuffle(nonTops, input.seedSource);
  const selectedNonTops = shuffledNonTops.slice(0, Math.max(0, stashSlots - selectedTops.length));

  const selectedStash = [...selectedTops, ...selectedNonTops];
  const selectedStashIds = new Set(selectedStash.map((candidate) => candidate.id));
  const unfilledStashSlots = stashSlots - selectedStash.length;
  const selectedDietIds = input.dietIds.slice(0, dietSlots + unfilledStashSlots);
  const selectedDietIdSet = new Set(selectedDietIds);

  const requiredBypass = input.stash
    .filter((candidate) => (
      candidate.isRequired
      && !selectedStashIds.has(candidate.id)
      && !selectedDietIdSet.has(candidate.id)
    ))
    .sort(compareStashNewestFirst);

  return [
    ...selectedStash.map((candidate) => candidate.id),
    ...selectedDietIds,
    ...requiredBypass.map((candidate) => candidate.id),
  ];
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
