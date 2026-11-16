/** Learner-facing add-word cards. Private command snapshots never cross this boundary. */
export type VocabularyIntakeCardState = 'proposed' | 'sense-proposed' | 'added' | 'preparing' | 'ready' | 'already-studying';
export type VocabularyIntakeSense = {
  senseId: string; label: string; notes: string[]; isDefault: boolean;
  disposition: 'default' | 'active' | 'excluded';
};
export type VocabularyIntakeSelection = {
  senseIds: string[]; includeProposedSense: boolean; targetSenseId: string | null;
};
export type VocabularyIntakeCard = {
  id: string; version: number; wordId: string; hanzi: string; pinyin: string;
  state: VocabularyIntakeCardState; senses: VocabularyIntakeSense[];
  selection: VocabularyIntakeSelection; defaultsEstablished: boolean;
  addedSenseId?: string;
  proposedSense: {label: string; notes: string[]} | null;
  versions: {learner: number | null; catalog: number; selection: number};
  actions: Array<'add' | 'add_sense' | 'undo' | 'change_senses'>;
  presets: Array<{label: string; selection: VocabularyIntakeSelection}>;
  attention: string | null;
};
export type VocabularyIntakeTurn = {
  id: string; userText: string; assistantText: string;
  status: 'running' | 'complete' | 'failed'; cardIds: string[];
};
export type VocabularyIntakeHistory = {
  conversationId: string; turns: VocabularyIntakeTurn[]; cards: VocabularyIntakeCard[];
  before: string | null;
};
export type VocabularyIntakeProgress = 'checking' | 'looking_up' | 'preparing_reply';
export type VocabularyIntakeStreamEvent =
  | {type: 'progress'; stage: VocabularyIntakeProgress}
  | {type: 'completion'; assistantText: string; cards: VocabularyIntakeCard[]}
  | {type: 'done'; turnId: string}
  | {type: 'error'; message: string; retryWithNewId?: boolean};
export type VocabularyIntakeCommand =
  | {type: 'add' | 'set_senses'; selection: VocabularyIntakeSelection}
  | {type: 'undo'}
  | {type: 'add_sense'};
export type VocabularyIntakeCommandRequest = {
  clientActionId: string; expectedVersion: number;
  versions: VocabularyIntakeCard['versions']; command: VocabularyIntakeCommand;
};
