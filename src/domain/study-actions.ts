import type { BootstrapRevealSnapshot } from './word-content/reveal';
import type { ContentExerciseSnapshot, WordContentDocument } from './word-content/types';
import type { Word } from '../types';
import {
  assertTargetedCueAcceptsOnlyOwner,
  type AcceptedCueAnswer,
  type TargetedCueFormat,
} from './cues';

export type StudySkillId = 'recognition' | 'production' | 'contextual_selection';

export type StudyActionKind =
  | 'recognition'
  | 'production'
  | 'contrast_selection';

export type StudyContentRef =
  | { type: 'contrast_prompt'; id: string }
  | { type: 'example_sentence'; id: string }
  | { type: 'production_cue'; taskId: string; cueId: string };

export type ProductionCueType = TargetedCueFormat;

export type ProductionCueSupplementSnapshot = {
  supplementId: string;
  englishFrame: string;
  exampleSentence: string;
  exampleTranslation: string;
};

export type ProductionExerciseSnapshot = {
  taskId: string;
  cueId: string | null;
  cueType: ProductionCueType;
  text: string;
  acceptedAnswers: ProductionAnswerWord[];
  supplement: ProductionCueSupplementSnapshot | null;
  /** Frozen word teaching shown only after the response. */
  bootstrapReveal?: BootstrapRevealSnapshot;
};

export type ProductionAnswerWord = AcceptedCueAnswer;

/**
 * Word-owned production remains a target-word assessment. The array shape is
 * retained in served evidence, but a live snapshot must contain exactly the
 * one answer owned by its scheduled target.
 */
export function assertStrictTargetOnlyProductionSnapshot(
  production: Pick<ProductionExerciseSnapshot, 'acceptedAnswers'>,
  targetWordId: string,
): void {
  assertTargetedCueAcceptsOnlyOwner(production, targetWordId);
}

export type ContrastCluster = {
  id: string;
  title: string;
  note: string;
};

export type ContrastClusterMember = {
  clusterId: string;
  wordId: string;
  nuanceNote: string;
  displayOrder: number | null;
};

export type ContrastPrompt = {
  id: string;
  clusterId: string;
  targetWordId: string;
  promptText: string;
  explanation: string;
};

export type ContrastSelectionChoice = {
  word: Word;
  nuanceNote: string;
};

export type ContrastSelectionContent = {
  clusterId: string;
  clusterTitle: string;
  clusterNote: string;
  scheduledWordId: string;
  promptTargetWordId: string;
  prompt: ContrastPrompt;
  choices: ContrastSelectionChoice[];
};

export type LearningRehearsalSnapshot = ContentExerciseSnapshot & {
  readonly packageId: string;
  readonly wordContentId: string;
};

export type SessionStudyItem = {
  sessionActionId: string;
  actionKind: StudyActionKind;
  targetWordId: string;
  sampledSkillIds: StudySkillId[];
  contentRef: StudyContentRef | null;
  intervalHours: number;
  word: Word;
  contrastSelection: ContrastSelectionContent | null;
  production: ProductionExerciseSnapshot | null;
  /** Frozen target rehearsal, separate from review cues and reflection evidence. */
  rehearsal?: LearningRehearsalSnapshot;
  wordContent?: WordContentDocument;
  bootstrapReveal?: BootstrapRevealSnapshot;
  /** Existing eligible teaching shown only after a recognition review is revealed. */
  recognitionSupplement?: ProductionCueSupplementSnapshot;
};

// 'deprioritized' unused currently, saved for future enrichment
export type WordSkillRelevanceState = 'normal' | 'deprioritized' | 'suppressed';
