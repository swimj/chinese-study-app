// The record: an append-only log of what the learner did (events), separate
// interpretations of those events (judgments), and the things the learner is
// training (targets). The journal blob still holds pieces and interface state;
// these tables sit beside it in the same SQLite file and commit with it.
import type { DatabaseSync } from 'node:sqlite';

/** Kinds of learner activity. Production kinds carry the learner's own language. */
export type EventKind = 'chat' | 'ask' | 'annotation' | 'answer' | 'addWord' | 'capture' | 'reflect';
/**
 * Events the judgment reads: language the tutor has already responded to. Chat
 * lines are read through their reflection, which carries the learner's lines
 * from that stretch and the takeaways they were shown.
 */
export const productionKinds: readonly EventKind[] = ['reflect', 'ask', 'annotation', 'answer'];

export type NewEvent = {
  id: string;
  /** ISO time, or null for history converted from journals that kept no time. */
  at: string | null;
  kind: EventKind;
  surface: string;
  /** The piece, thread or card the event happened on. */
  ref?: string;
  /** The learner's words, verbatim. */
  text: string;
  /** What the learner was responding to: a prompt, a quoted passage, the partner's last line. */
  context?: Record<string, unknown>;
  /** Target forms the exercise intended, if any. */
  targets?: string[];
};
export type RecordedEvent = Required<Omit<NewEvent, 'ref'>> & { ref: string | null; seq: number };

export type TargetKind = 'word' | 'expression' | 'construction';
export type TargetOrigin = 'saved' | 'imported' | 'noticed';
export type HostedSummary = {
  mode: string;
  inStash: boolean;
  dismissed: boolean;
  addedAt: string | null;
  lastPractisedAt: string | null;
  dueAt: string | null;
  intervalHours: number | null;
  /** Production recall answers in the hosted app. */
  attempts: number;
  incorrect: number;
  lastIncorrectAt: string | null;
  /** The learner's latest wrong answers, newest first: often a confusable word. */
  recentMistakes: string[];
};
export type Target = {
  id: number;
  form: string;
  kind: TargetKind;
  gloss: string | null;
  pinyin: string | null;
  origin: TargetOrigin;
  createdAt: string;
  hosted: HostedSummary | null;
};

export type JudgmentRecord = { id: string; eventId: string; at: string; source: string; body: unknown };

export function createRecordTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS record_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events(
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      at TEXT,
      kind TEXT NOT NULL,
      surface TEXT NOT NULL,
      ref TEXT,
      text TEXT NOT NULL,
      context_json TEXT NOT NULL DEFAULT '{}',
      targets_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS judgments(
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id),
      at TEXT NOT NULL,
      source TEXT NOT NULL,
      body_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS judgments_event ON judgments(event_id, source);
    CREATE TABLE IF NOT EXISTS targets(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      gloss TEXT,
      pinyin TEXT,
      origin TEXT NOT NULL,
      created_at TEXT NOT NULL,
      hosted_json TEXT
    );`);
}

/** Whether a database file has the record tables yet (readers must not create them). */
export function hasRecord(db: DatabaseSync) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='events'").get();
}

export function appendEvent(db: DatabaseSync, e: NewEvent) {
  db.prepare(
    'INSERT OR IGNORE INTO events(id,at,kind,surface,ref,text,context_json,targets_json) VALUES (?,?,?,?,?,?,?,?)',
  ).run(e.id, e.at, e.kind, e.surface, e.ref ?? null, e.text, JSON.stringify(e.context ?? {}), JSON.stringify(e.targets ?? []));
}

export function addJudgment(db: DatabaseSync, j: JudgmentRecord) {
  db.prepare('INSERT INTO judgments(id,event_id,at,source,body_json) VALUES (?,?,?,?,?)').run(
    j.id, j.eventId, j.at, j.source, JSON.stringify(j.body),
  );
}

function eventFrom(row: Record<string, unknown>): RecordedEvent {
  return {
    seq: Number(row.seq),
    id: String(row.id),
    at: row.at === null ? null : String(row.at),
    kind: String(row.kind) as EventKind,
    surface: String(row.surface),
    ref: row.ref === null ? null : String(row.ref),
    text: String(row.text),
    context: JSON.parse(String(row.context_json)),
    targets: JSON.parse(String(row.targets_json)),
  };
}

export function events(db: DatabaseSync): RecordedEvent[] {
  return db.prepare('SELECT * FROM events ORDER BY seq').all().map(eventFrom);
}

/**
 * The newest production event since `since` without a judgment from `source`.
 * Converted history predates `since` and is never sent to the model.
 */
export function nextUnjudged(db: DatabaseSync, source: string, since: string): RecordedEvent | undefined {
  const marks = productionKinds.map(() => '?').join(',');
  const row = db
    .prepare(
      `SELECT * FROM events e WHERE kind IN (${marks}) AND at >= ?
         AND NOT EXISTS (SELECT 1 FROM judgments j WHERE j.event_id = e.id AND j.source = ?)
         AND NOT (kind = 'answer' AND json_extract(context_json, '$.kind') = 'choice')
       ORDER BY seq DESC LIMIT 1`,
    )
    .get(...productionKinds, since, source);
  return row ? eventFrom(row) : undefined;
}

export function judgments(db: DatabaseSync): JudgmentRecord[] {
  return db
    .prepare('SELECT * FROM judgments ORDER BY at')
    .all()
    .map((row) => ({
      id: String(row.id),
      eventId: String(row.event_id),
      at: String(row.at),
      source: String(row.source),
      body: JSON.parse(String(row.body_json)),
    }));
}

/** Model judgments made today, for the daily limit. */
export function judgedToday(db: DatabaseSync, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const row = db.prepare("SELECT count(*) n FROM judgments WHERE source LIKE 'model:%' AND substr(at,1,10) = ?").get(day);
  return Number(row?.n ?? 0);
}

function targetFrom(row: Record<string, unknown>): Target {
  return {
    id: Number(row.id),
    form: String(row.form),
    kind: String(row.kind) as TargetKind,
    gloss: row.gloss === null ? null : String(row.gloss),
    pinyin: row.pinyin === null ? null : String(row.pinyin),
    origin: String(row.origin) as TargetOrigin,
    createdAt: String(row.created_at),
    hosted: row.hosted_json ? (JSON.parse(String(row.hosted_json)) as HostedSummary) : null,
  };
}

export function targets(db: DatabaseSync): Target[] {
  return db.prepare('SELECT * FROM targets ORDER BY id').all().map(targetFrom);
}

/**
 * Adds a target, or fills in what an existing one with the same form lacks.
 * Identity is the exact form for now; the agent will own merging later.
 */
export function upsertTarget(
  db: DatabaseSync,
  t: { form: string; kind?: TargetKind; gloss?: string | null; pinyin?: string | null; origin: TargetOrigin; at: string; hosted?: HostedSummary },
) {
  const form = t.form.trim();
  if (!form) throw new Error('A target needs a form');
  db.prepare(
    `INSERT INTO targets(form,kind,gloss,pinyin,origin,created_at,hosted_json) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(form) DO UPDATE SET
       origin = CASE WHEN excluded.origin = 'saved' THEN 'saved' ELSE targets.origin END,
       gloss = coalesce(targets.gloss, excluded.gloss),
       pinyin = coalesce(targets.pinyin, excluded.pinyin),
       hosted_json = coalesce(excluded.hosted_json, targets.hosted_json)`,
  ).run(form, t.kind ?? 'word', t.gloss ?? null, t.pinyin ?? null, t.origin, t.at, t.hosted ? JSON.stringify(t.hosted) : null);
}

/** Forms of known targets that occur in a text, longest first. Single characters are too ambiguous to match. */
export function formsIn(text: string, forms: Iterable<string>) {
  const found: string[] = [];
  for (const form of forms) if (form.length > 1 && text.includes(form)) found.push(form);
  return found.sort((a, b) => b.length - a.length).slice(0, 20);
}

export function meta(db: DatabaseSync, key: string) {
  const row = db.prepare('SELECT value FROM record_meta WHERE key=?').get(key);
  return row ? String(row.value) : undefined;
}
export function setMeta(db: DatabaseSync, key: string, value: string) {
  db.prepare('INSERT INTO record_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}
