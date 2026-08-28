import type { ProductionCueType } from './study-actions';
import type { Word } from '../types';

export type ContentDiagnosticKind = 'word' | 'contrast_cluster' | 'production_cue';

export type WordDiagnosticItem = {
  kind: 'word';
  id: string;
  word: Word;
  contrastClusters: Array<{
    clusterId: string;
    title: string;
    nuanceNote: string;
  }>;
  productionTask: {
    taskId: string;
    cueCount: number;
    activeCueCount: number;
  } | null;
};

export type ContrastClusterDiagnosticItem = {
  kind: 'contrast_cluster';
  id: string;
  title: string;
  note: string;
  members: Array<{
    word: Word;
    nuanceNote: string;
    displayOrder: number | null;
  }>;
  prompts: Array<{
    id: string;
    targetWordId: string;
    promptText: string;
    explanation: string;
  }>;
};

export type ProductionCueDiagnosticItem = {
  kind: 'production_cue';
  id: string;
  taskId: string;
  anchorWord: Word;
  cueType: ProductionCueType;
  text: string;
  acceptedWords: Word[];
  createdAt: string;
  active: boolean;
  attribution: {
    origin: 'reflection' | 'manual';
    invocationId: string | null;
  };
  evidence: {
    attemptCount: number;
    acceptedAnchorCount: number;
    acceptedNonAnchorCount: number;
    rejectedCount: number;
    activeJudgmentCount: number;
    updatedAt: string;
  } | null;
};

export type ContentDiagnosticItem =
  | WordDiagnosticItem
  | ContrastClusterDiagnosticItem
  | ProductionCueDiagnosticItem;

export type ContentDiagnosticsResponse = {
  kind: ContentDiagnosticKind;
  query: string;
  limit: number;
  hasMore: boolean;
  items: ContentDiagnosticItem[];
};
