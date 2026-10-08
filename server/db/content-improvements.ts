import { randomUUID } from 'node:crypto';
import { CONTENT_QUALITY_KINDS, type ContentQualityKind } from '../../src/domain/content-quality.ts';
import {
  ImprovementAccessError, ImprovementConflictError, ImprovementInputError,
  improvementObject, improvementText, parseImprovementDraft,
  type ImprovementCase, type ImprovementCheck,
} from '../../src/domain/content-improvement.ts';
import { config, getDb } from './connection.ts';
import { isOperatorSubject, parseOperatorAllowlist } from '../operator-access.ts';
import { readImprovementSource, validateImprovementContent, applyImprovementContent } from './content-improvement-adapters.ts';

function authorize(actor: string): void {
  if (!isOperatorSubject(actor, parseOperatorAllowlist(), config.authMode)) throw new ImprovementAccessError('Operator access required.');
}
function transaction<T>(operation: () => T): T {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try { const result = operation(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function read(id: string): ImprovementCase {
  const row = getDb().prepare('SELECT case_json FROM content_improvement_cases WHERE id=?').get(id) as {case_json: string} | undefined;
  if (!row) throw new ImprovementInputError('Content improvement case not found.');
  return JSON.parse(row.case_json) as ImprovementCase;
}
function persist(item: ImprovementCase, actor: string): ImprovementCase {
  getDb().prepare(`INSERT INTO content_improvement_cases VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,status=excluded.status,case_json=excluded.case_json,updated_at=excluded.updated_at`)
    .run(item.id, item.revision, item.status, item.source.kind, item.source.sourceId, JSON.stringify(item), item.updatedAt);
  getDb().prepare('INSERT INTO content_improvement_revisions VALUES (?,?,?,?,?)')
    .run(item.id, item.revision, actor, item.updatedAt, JSON.stringify(item));
  return item;
}
function editable(id: string, expectedRevision: unknown): ImprovementCase {
  if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1) throw new ImprovementInputError('Expected a positive revision number.');
  const item = read(id);
  if (item.revision !== expectedRevision) throw new ImprovementConflictError('This draft changed. Reload it before continuing; your unsaved text has not been applied.');
  if (item.status !== 'draft') throw new ImprovementConflictError('This case is already resolved. Start a new case for further work.');
  return item;
}
function next(item: ImprovementCase, actor: string): ImprovementCase {
  return { ...item, revision: item.revision + 1, updatedAt: new Date().toISOString(), updatedBy: actor };
}
function keys(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new ImprovementInputError('Unexpected request field.');
}
export function getImprovementCase(id: string, actor: string): ImprovementCase { authorize(actor); return read(id); }
export function listImprovementCases(value: unknown, actor: string): {items: ImprovementCase[]; total: number} {
  authorize(actor);
  const input = improvementObject(value);
  keys(input, ['status', 'limit', 'offset']);
  if (Object.values(input).some(value => typeof value !== 'string' && typeof value !== 'number')) throw new ImprovementInputError('Expected scalar queue filters.');
  const status = input.status ?? 'draft';
  if (!['draft', 'applied', 'closed'].includes(String(status))) throw new ImprovementInputError('Invalid case status.');
  const limit = Number(input.limit ?? 25), offset = Number(input.offset ?? 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) throw new ImprovementInputError('Invalid pagination.');
  const rows = getDb().prepare('SELECT case_json FROM content_improvement_cases WHERE status=? ORDER BY updated_at DESC,id LIMIT ? OFFSET ?')
    .all(String(status), limit, offset) as {case_json:string}[];
  const total = getDb().prepare('SELECT count(*) n FROM content_improvement_cases WHERE status=?').get(String(status)) as {n:number};
  return {items:rows.map(row => JSON.parse(row.case_json) as ImprovementCase),total:total.n};
}
export function createImprovementCase(value: unknown, actor: string): ImprovementCase {
  authorize(actor);
  const input = improvementObject(value);
  keys(input, ['kind', 'sourceId', 'contentKey', 'id']);
  if (!CONTENT_QUALITY_KINDS.includes(input.kind as ContentQualityKind)) throw new ImprovementInputError('Invalid content kind.');
  const sourceId = improvementText(input.sourceId, 'Source ID', true);
  const kind = input.kind as ContentQualityKind;
  const id = input.id === undefined ? randomUUID() : improvementText(input.id, 'Case ID', true);
  if (id.length > 250 || sourceId.length > 500) throw new ImprovementInputError('Identifier is too long.');
  return transaction(() => {
    const existing = getDb().prepare('SELECT id FROM content_improvement_cases WHERE id=?').get(id);
    if (existing) {
      const item = read(id);
      if (item.source.kind !== kind || item.source.sourceId !== sourceId || (item.flagged?.contentKey ?? null) !== (input.contentKey ?? null)) throw new ImprovementConflictError('Case ID already belongs to another selection.');
      return item;
    }
    const source = readImprovementSource(kind, sourceId);
    let flagged: ImprovementCase['flagged'] = null;
    if (input.contentKey !== undefined) {
      const contentKey = improvementText(input.contentKey, 'Content key', true);
      const row = getDb().prepare('SELECT content_json,provenance_json FROM content_quality_items WHERE content_key=? AND kind=? AND source_id=?')
        .get(contentKey, kind, sourceId) as {content_json:string;provenance_json:string} | undefined;
      if (!row) throw new ImprovementInputError('The flagged snapshot does not match this content.');
      flagged = {contentKey,content:JSON.parse(row.content_json),provenance:JSON.parse(row.provenance_json)};
    }
    const now = new Date().toISOString();
    return persist({id,revision:1,status:'draft',source,flagged,createdAt:now,updatedAt:now,updatedBy:actor,
      diagnosis:'',rationale:'',generalLesson:'',proposalOrigin:'operator',proposed:source.editable,outcome:null,resolution:null},actor);
  });
}
export function saveImprovementCase(id: string, value: unknown, actor: string): ImprovementCase {
  authorize(actor);
  const input = improvementObject(value), fields = parseImprovementDraft(input);
  return transaction(() => persist({...next(editable(id,input.expectedRevision),actor),...fields},actor));
}
function check(item: ImprovementCase): ImprovementCheck {
  const currentSource = readImprovementSource(item.source.kind,item.source.sourceId);
  const validation = validateImprovementContent(currentSource,item.proposed);
  if (!item.diagnosis.trim()) validation.errors.push('Record what should improve in Diagnosis.');
  if (!item.rationale.trim()) validation.errors.push('Record why the revision is better in Rationale.');
  return {...validation,revision:item.revision,sourceChanged:currentSource.fingerprint !== item.source.fingerprint,currentSource};
}
export function validateImprovementCase(id: string, value: unknown, actor: string): ImprovementCheck {
  authorize(actor); const input = improvementObject(value); keys(input,['expectedRevision']);
  return transaction(() => check(editable(id,input.expectedRevision)));
}
export function applyImprovementCase(id: string, value: unknown, actor: string): ImprovementCase {
  authorize(actor); const input = improvementObject(value); keys(input,['expectedRevision','approve','acceptAnswerSpaceChange']);
  if (input.approve !== true || typeof input.acceptAnswerSpaceChange !== 'boolean') throw new ImprovementInputError('Explicit approval and answer-space acknowledgement are required.');
  return transaction(() => {
    const item = editable(id,input.expectedRevision);
    improvementText(item.diagnosis,'Diagnosis',true); improvementText(item.rationale,'Why this is better',true);
    const checked = check(item);
    if (checked.sourceChanged) throw new ImprovementConflictError('Production content or its eligibility changed. Start a new case from current content before applying.');
    if (checked.errors.length) throw new ImprovementInputError(checked.errors.join('\n'));
    if (checked.answerSpaceChanged && !input.acceptAnswerSpaceChange) throw new ImprovementInputError('Review and explicitly accept the changed answer space.');
    const updated = next(item,actor);
    const outcome = applyImprovementContent(checked.currentSource,item.proposed,{actorId:actor,caseId:id,now:updated.updatedAt});
    const appliedSource = outcome.replacementSourceId === null ? undefined : readImprovementSource(item.source.kind,outcome.replacementSourceId);
    return persist({...updated,status:'applied',outcome:{...outcome,appliedSource},resolution:'Correction approved and applied'},actor);
  });
}
export function closeImprovementCase(id: string, value: unknown, actor: string): ImprovementCase {
  authorize(actor); const input = improvementObject(value); keys(input,['expectedRevision','resolution']);
  const resolution = improvementText(input.resolution,'Resolution',true);
  return transaction(() => persist({...next(editable(id,input.expectedRevision),actor),status:'closed',resolution},actor));
}
export function getImprovementHistory(id: string, actor: string): ImprovementCase[] {
  authorize(actor); read(id);
  return (getDb().prepare('SELECT case_json FROM content_improvement_revisions WHERE case_id=? ORDER BY revision').all(id) as {case_json:string}[])
    .map(row => JSON.parse(row.case_json) as ImprovementCase);
}
