export type SessionDebriefInventoryItem = { word: string; pinyin: string };
export type SessionDebriefNote = { text: string; refs: string[]; followUp: string | null };
export type SessionDebriefResult = { notes: SessionDebriefNote[] };
export type SessionDebriefInput = {
  schemaVersion: 'session_debrief_input.v1';
  sessionDate: string;
  interests: string[];
  items: Array<SessionDebriefInventoryItem & { ref: string }>;
};
export type SessionDebrief = {
  sessionId: string;
  completedAt: string;
  exerciseCount: number;
  status: 'queued' | 'running' | 'ready' | 'failed';
  notes: SessionDebriefNote[] | null;
  error: string | null;
  attemptCount: number;
};

export class SessionDebriefInputError extends Error {}

export function validateDebriefInterests(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 1000) {
    throw new SessionDebriefInputError('Expected debriefInterests text of at most 1000 characters');
  }
}

export function validateDebriefInventory(value: unknown): asserts value is SessionDebriefInventoryItem[] {
  if (!Array.isArray(value) || value.length > 1000) {
    throw new SessionDebriefInputError('Expected debriefInventory array of at most 1000 exercises');
  }
  for (const item of value) {
    if (!isRecord(item) || Object.keys(item).some((key) => key !== 'word' && key !== 'pinyin')
      || typeof item.word !== 'string' || !item.word.trim()
      || typeof item.pinyin !== 'string') {
      throw new SessionDebriefInputError('Expected each debrief exercise to contain nonempty word and string pinyin text');
    }
  }
}

export function validateSessionDebriefResult(value: unknown, input: SessionDebriefInput): asserts value is SessionDebriefResult {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.notes) || value.notes.length > 3) {
    throw new Error('Invalid debrief result');
  }
  const refs = new Set(input.items.map((item) => item.ref));
  for (const note of value.notes) {
    if (!isRecord(note) || Object.keys(note).length !== 3
      || typeof note.text !== 'string' || !note.text.trim() || note.text.length > 5000
      || !Array.isArray(note.refs) || note.refs.length === 0
      || note.refs.some((ref) => typeof ref !== 'string' || !refs.has(ref))
      || new Set(note.refs).size !== note.refs.length
      || !(note.followUp === null || (typeof note.followUp === 'string' && !!note.followUp.trim() && note.followUp.length <= 1000))) {
      throw new Error('Invalid debrief note or reference');
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
