export type StudyProfileId = 'mandarin' | 'french';

export type ProductionMatchOptions = {
  ignoreCase: boolean;
  ignoreAccents: boolean;
  normalizeApostrophes: boolean;
  trimEdgePunctuation: boolean;
  collapseWhitespace: boolean;
  removeWhitespace: boolean;
  removePunctuation: boolean;
  ignoreHyphenSpacing: boolean;
};

export type StudyProfile = {
  id: StudyProfileId;
  labels: {
    target: string;
    source: string;
    auxiliary: string;
    recognitionDirection: string;
    productionDirection: string;
    productionInput: string;
    submitProductionInput: string;
    addByTarget: string;
    targetSearchPrompt: string;
    targetSearchPlaceholder: string;
    targetRecallIncorrect: string;
  };
  defaultProductionMatchOptions: ProductionMatchOptions;
};

const exactProductionMatchOptions: ProductionMatchOptions = {
  ignoreCase: false,
  ignoreAccents: false,
  normalizeApostrophes: false,
  trimEdgePunctuation: false,
  collapseWhitespace: false,
  removeWhitespace: true,
  removePunctuation: true,
  ignoreHyphenSpacing: false,
};

const forgivingFrenchProductionMatchOptions: ProductionMatchOptions = {
  ignoreCase: true,
  ignoreAccents: true,
  normalizeApostrophes: true,
  trimEdgePunctuation: true,
  collapseWhitespace: true,
  removeWhitespace: false,
  removePunctuation: false,
  ignoreHyphenSpacing: false,
};

export const studyProfiles: Record<StudyProfileId, StudyProfile> = {
  mandarin: {
    id: 'mandarin',
    labels: {
      target: 'Hanzi',
      source: 'Meaning',
      auxiliary: 'Pinyin',
      recognitionDirection: 'Hanzi → Meaning',
      productionDirection: 'Meaning → Hanzi',
      productionInput: 'Type Hanzi',
      submitProductionInput: 'Submit Hanzi',
      addByTarget: 'Add by hanzi',
      targetSearchPrompt: 'Search by hanzi to add matching unstudied words to the priority list.',
      targetSearchPlaceholder: 'Enter hanzi and submit',
      targetRecallIncorrect: 'Hanzi recall was incorrect.',
    },
    defaultProductionMatchOptions: exactProductionMatchOptions,
  },
  french: {
    id: 'french',
    labels: {
      target: 'French',
      source: 'English',
      auxiliary: 'Pronunciation / notes',
      recognitionDirection: 'French → English',
      productionDirection: 'English → French',
      productionInput: 'Type French',
      submitProductionInput: 'Submit French',
      addByTarget: 'Add by French term',
      targetSearchPrompt: 'Search by French term to add matching unstudied words to the priority list.',
      targetSearchPlaceholder: 'Enter French term and submit',
      targetRecallIncorrect: 'French recall was incorrect.',
    },
    defaultProductionMatchOptions: forgivingFrenchProductionMatchOptions,
  },
};

export const studyProfile = resolveStudyProfile(getConfiguredStudyProfileId());

export function normalizeProductionAnswer(value: string, options: ProductionMatchOptions): string {
  return normalizeProductionAnswerWithProfile(value, options, studyProfile.id);
}

export function normalizeProductionAnswerForProfile(
  value: string,
  profileId: StudyProfileId,
): string {
  return normalizeProductionAnswerWithProfile(
    value,
    studyProfiles[profileId].defaultProductionMatchOptions,
    profileId,
  );
}

function normalizeProductionAnswerWithProfile(
  value: string,
  options: ProductionMatchOptions,
  profileId: StudyProfileId,
): string {
  let normalized = value.trim();

  if (options.normalizeApostrophes) {
    normalized = normalized.replace(/[’‘`´]/g, "'");
  }

  if (options.trimEdgePunctuation) {
    normalized = normalized.replace(/^[\s.,!?;:()[\]{}"']+|[\s.,!?;:()[\]{}"']+$/g, '');
  }

  if (options.ignoreCase) {
    normalized = normalized.toLocaleLowerCase(profileId === 'french' ? 'fr' : undefined);
  }

  if (options.ignoreAccents) {
    normalized = normalized.normalize('NFD').replace(/\p{Diacritic}/gu, '').normalize('NFC');
  }

  if (options.ignoreHyphenSpacing) {
    normalized = normalized.replace(/\s*[-‐‑‒–—]\s*/g, ' ');
  }

  if (options.removePunctuation) {
    normalized = normalized.replace(/[\p{P}\p{S}]+/gu, '');
  }

  if (options.removeWhitespace) {
    normalized = normalized.replace(/\s+/g, '');
  } else if (options.collapseWhitespace) {
    normalized = normalized.replace(/\s+/g, ' ');
  }

  return normalized.trim();
}

function resolveStudyProfile(profileId: string | undefined): StudyProfile {
  if (isStudyProfileId(profileId)) {
    return studyProfiles[profileId];
  }

  return studyProfiles.mandarin;
}

function isStudyProfileId(value: string | undefined): value is StudyProfileId {
  return value === 'mandarin' || value === 'french';
}

function getConfiguredStudyProfileId(): string | undefined {
  return typeof import.meta.env === 'object' ? import.meta.env.VITE_STUDY_PROFILE : undefined;
}
