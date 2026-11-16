import type { Express, Request, Response } from 'express';
import { config } from '../db/connection.ts';
import { ChatConflictError } from '../db/learner-chat.ts';
import { getVocabularyIntakeCard, listVocabularyIntakeCards, projectVocabularyIntakeCard,
  runVocabularyIntakeCommand, VocabularyIntakeNotFound, listVocabularyIntakeFindings } from '../db/vocabulary-intake.ts';
import { VocabularyStateConflict, VocabularyStateInputError } from '../db/vocabulary-learners.ts';
import { HostedProviderWorkUnavailableError } from '../hosted-runtime-controls.ts';
import type { ChatProvider } from '../llm/chat-types.ts';
import { createOperatorAllowlistMiddleware } from '../operator-access.ts';
import type { ProviderSubjectResolver } from '../authentication.ts';
import { getVocabularyIntakeHistory, sendVocabularyIntakeTurn, vocabularyIntakeRetryWithNewId } from './intake-chat.ts';
import type { VocabularyIntakeCommand, VocabularyIntakeCommandRequest, VocabularyIntakeSelection, VocabularyIntakeStreamEvent } from '../../src/domain/vocabulary-intake.ts';

const intake = '/api/vocabulary/intake';
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new VocabularyStateInputError('Expected an object');
  return value as Record<string,unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new VocabularyStateInputError('Expected a valid identifier');
  return value;
}
function version(value: unknown, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new VocabularyStateInputError('Expected a valid version');
  return value;
}
function selection(value: unknown): VocabularyIntakeSelection {
  const input = record(value);
  if (!Array.isArray(input.senseIds) || input.senseIds.length > 16 || typeof input.includeProposedSense !== 'boolean') {
    throw new VocabularyStateInputError('Expected selected senses');
  }
  return { senseIds: input.senseIds.map(identifier), includeProposedSense: input.includeProposedSense,
    targetSenseId: input.targetSenseId === null ? null : identifier(input.targetSenseId) };
}
function commandRequest(value: unknown): VocabularyIntakeCommandRequest {
  const input = record(value), action = record(input.command), versions = record(input.versions);
  let command: VocabularyIntakeCommand;
  switch (action.type) {
    case 'undo':
    case 'add_sense': command = { type: action.type }; break;
    case 'add':
    case 'set_senses': command = { type: action.type, selection: selection(action.selection) }; break;
    default: throw new VocabularyStateInputError('Unsupported card command');
  }
  return { clientActionId: identifier(input.clientActionId), expectedVersion: version(input.expectedVersion,1), command,
    versions: { learner: versions.learner === null ? null : version(versions.learner,1),
      catalog: version(versions.catalog,0), selection: version(versions.selection,0) } };
}
function mandarinOnly(): void {
  if (config.studyProfile !== 'mandarin') throw new VocabularyIntakeNotFound('Add-word chat is not available');
}
function statusFor(error: unknown): number {
  if (error instanceof VocabularyStateInputError) return 400;
  if (error instanceof ChatConflictError || error instanceof VocabularyStateConflict) return 409;
  if (error instanceof VocabularyIntakeNotFound) return 404;
  if (error instanceof HostedProviderWorkUnavailableError) return 503;
  return 500;
}
function respondError(error: unknown, res: Response): void {
  const status = statusFor(error);
  if (status === 500) console.error('Vocabulary intake request failed');
  res.status(status).json({ error: status === 500 ? 'Add-word chat could not complete this request.' : (error as Error).message });
}

export function registerVocabularyIntakeRoutes(app: Express, options: { wake?: () => void; provider?: ChatProvider; resolveClerkProviderSubject?: ProviderSubjectResolver } = {}): void {
  const handler = (action: (req: Request) => unknown) => (req: Request, res: Response) => {
    try {
      mandarinOnly();
      res.setHeader('Cache-Control','no-store');
      res.json(action(req));
    } catch (error) { respondError(error, res); }
  };
  app.get(intake, handler(req => getVocabularyIntakeHistory(req.query.before === undefined ? undefined : identifier(req.query.before))));
  app.get(`${intake}/cards`, handler(req => {
    if (req.query.outstanding !== undefined && req.query.outstanding !== 'true') throw new VocabularyStateInputError('Expected outstanding=true');
    return { cards: listVocabularyIntakeCards(req.query.outstanding === 'true') };
  }));
  app.get(`${intake}/cards/:id`, handler(req => projectVocabularyIntakeCard(getVocabularyIntakeCard(identifier(req.params.id)))));
  app.get(`${intake}/attention`, handler(() => ({
    count: listVocabularyIntakeCards(true).filter(card => card.attention !== null || card.state === 'proposed' || card.state === 'sense-proposed').length,
  })));
  app.post(`${intake}/cards/:id/commands`, handler(req => {
    const card = runVocabularyIntakeCommand(identifier(req.params.id), commandRequest(req.body));
    if (options.wake) setImmediate(() => {
      try { options.wake?.(); } catch { console.error('Vocabulary intake worker wake failed'); }
    });
    return card;
  }));
  app.post(`${intake}/turns`, async (req, res) => {
    let text: string, clientTurnId: string;
    try {
      mandarinOnly();
      const input = record(req.body);
      clientTurnId = identifier(input.clientTurnId);
      if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4000) {
        throw new VocabularyStateInputError('Enter a message up to 4,000 characters');
      }
      text = input.text;
    } catch (error) { respondError(error,res); return; }
    res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const publish = (event: VocabularyIntakeStreamEvent) => {
      if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      const turnId = await sendVocabularyIntakeTurn({ clientTurnId, text, publish, provider: options.provider, wake: options.wake });
      publish({ type: 'done', turnId });
    } catch (error) {
      const status = statusFor(error);
      publish({ type: 'error', retryWithNewId: vocabularyIntakeRetryWithNewId(clientTurnId,text), message: status === 503 || status === 409
        ? (error as Error).message : 'This message could not be completed. Send it again to retry.' });
    } finally { if (!res.destroyed) res.end(); }
  });
  app.get('/api/operator/vocabulary/intake/findings', createOperatorAllowlistMiddleware({ resolveClerkUserId: options.resolveClerkProviderSubject }),
    handler(() => ({ findings: listVocabularyIntakeFindings() })));
}
