import type { ReactNode, Ref } from 'react';
import type { SessionDeskHandle } from '../session/SessionDesk';

/** Presentation contracts only. Eligibility and learning effects belong to the controller. */
export type VocabularyMode = 'unstudied' | 'solidify' | 'practice' | 'maintain';
export type VocabularyControl = { visible: boolean; enabled: boolean; reason?: string; shortcut?: string };
export type VocabularyModeChoice = {
  value: VocabularyMode;
  label: string;
  description: string;
  enabled: boolean;
};
export type VocabularyWordDisplay = { id: string; hanzi: string; pinyin: string; meaning: string };
export type VocabularySessionHistoryWord = {
  /** Include only words whose identity is safe to display. */
  word: VocabularyWordDisplay;
  status: 'covered' | 'left' | 'open';
  active: boolean;
  queued?: boolean;
  canResume: boolean;
};
export type VocabularyWordOutcome = {
  word: VocabularyWordDisplay;
  detail: string;
  group?: 'new' | 'graduated' | 'covered' | 'unfinished';
  canPractise: boolean;
  canDismiss: boolean;
  mode?: VocabularyMode;
  modeLabel?: string;
  modeChoices?: VocabularyModeChoice[];
};
export type VocabularyCompletionView = {
  status: 'saving' | 'pending' | 'closed' | 'failed';
  remainingSeconds: number | null;
  keepOpen?: boolean;
  elapsedLabel: string;
  covered: number;
  encountered: number;
  outcomes: VocabularyWordOutcome[];
  feedback: Array<{ id: string; title: string; body: ReactNode }>;
  canCancel: boolean;
  canUndo: boolean;
  canReturnHome: boolean;
};
export type VocabularySessionViewProps = {
  phase: 'active' | 'finishing' | 'completed';
  mode: VocabularyMode | null;
  modeLabel: string;
  modeChoices: VocabularyModeChoice[];
  /** Supply only identity safe to display now. A concealed production target must be null. */
  visibleWord: VocabularyWordDisplay | null;
  teachingContent?: ReactNode;
  recallProgress?: Array<{ key: string; label: string; count: number; total: number }>;
  cardMotion?: { ref: Ref<SessionDeskHandle>; confirmingPrimary: boolean };
  stopWord?: VocabularyControl;
  onStopWord?: () => void;
  onShowShortcuts?: () => void;
  presentation: {
    key: string;
    kind: 'introduction' | 'warmup' | 'exercise' | 'empty';
    label: string;
    recognition?: boolean;
    prompt: ReactNode;
    supportingContent?: ReactNode;
  };
  response: {
    visible: boolean;
    value: string;
    placeholder: string;
    disabled: boolean;
    revealed: boolean;
    assessment: 'accepted' | 'rejected' | 'unassessed';
    answer: ReactNode;
    /** Rating controls remain reachable while long reveal content scrolls. */
    revealActions?: ReactNode;
    message?: string;
    /** Completed-word continuation sits beside the word-level controls. */
    primaryPlacement?: 'response' | 'footer';
    primaryLabel: string;
    primaryEnabled: boolean;
    shortcuts?: string[];
  };
  /** Covered words in this session, most recently used first. Do not truncate older entries. */
  history?: VocabularySessionHistoryWord[];
  wordWork?: { extraPractice: boolean; enoughLabel?: string };
  progress: { encountered: number; covered: number; remaining: number; elapsedLabel: string };
  controls: Record<'skip' | 'another' | 'enough' | 'more' | 'undo' | 'finishForNow' | 'finishImmediately' | 'changeMode', VocabularyControl>;
  reactionInput: {
    open?: boolean;
    visible: boolean;
    reaction: 'helpful' | 'not-helpful' | null;
    comment: string;
    status: 'idle' | 'saving' | 'saved';
  };
  completion: VocabularyCompletionView | null;
  busy: boolean;
  error: string | null;
  onResponseChange: (value: string) => void;
  onPrimary: () => void;
  onSkip: () => void;
  onAnother: () => void;
  onEnough: () => void;
  onMore: () => void;
  onUndo: () => void;
  onFinishForNow: () => void;
  /** Invoked only after the learner accepts the unfinished-word warning. */
  onFinishImmediately: () => void;
  /** Legacy adapter callback; live cards show mode as a label, not a switch. */
  onModeChange: (mode: VocabularyMode) => void;
  onWordModeChange?: (wordId: string, mode: VocabularyMode) => void;
  onReaction: (reaction: 'helpful' | 'not-helpful' | null) => void;
  onReactionOpenChange?: (open: boolean) => void;
  onCommentChange: (comment: string) => void;
  onCommentSubmit: () => void;
  onKeepSummaryOpen?: () => void;
  onCancelCompletion: () => void;
  onRetryCompletion: () => void;
  onReturnHome: () => void;
  onPractiseWord: (wordId: string, source?: HTMLElement) => void;
  onDismissWord: (wordId: string) => void;
};
