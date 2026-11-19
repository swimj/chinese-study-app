import { isReflectionModelChoice, RetiredReflectionSourceModelError, type InitialReflectionGenerationService } from '../reflection/generation.ts';
import { runHostedProviderWork, HostedProviderWorkUnavailableError } from '../hosted-runtime-controls.ts';
import { ReflectionEvidenceError } from '../reflection/evidence.ts';
import { LunaReflectionProviderError } from '../reflection/luna-provider.ts';
import { listReflectionArtifacts, listReflectionGenerationRuns, DeferredSecondOpinionError, getReflectionArtifactDetail, authorizeManualReflectionOperation, applyReflectionInvocation, deferReflectionProposal, dismissReflectionProposal, reopenReflectionProposal, replaceReflectionProposal, acceptReflectionProposal, withdrawReflectionInvocationAuthorization, upsertReflectionQualityAnnotation, clearReflectionQualityAnnotation, getReflectionQualityStats, listReflectionHelpInbox, markReflectionHelpInboxDone, deferReflectionHelpInboxItem } from '../db.ts';
import { randomUUID } from 'node:crypto';
import { type ReviewProposalRequest, type ReflectionOperation, type UpsertReflectionQualityRequest, isReflectionQualityTag, type ClearReflectionQualityRequest, type MarkReflectionHelpInboxDoneRequest } from '../../src/domain/reflection.ts';
import type { Response, Express } from 'express';
import type { ReflectionLifecycleLogger } from '../reflection/lifecycle-log.ts';
import { isReflectionNotFoundError, defaultErrorLogger, isPlainObject, isReflectionQualityClientError } from './request-helpers.ts';
import type { CreateAppOptions } from '../index.ts';

/** Retired Mandarin reflection model: generation, artifacts, proposal review, invocations, quality tags, and the Help inbox. The Mandarin cutover fence rejects these writes; the French legacy app still uses them. */
export function registerLegacyReflectionRoutes(app: Express, { reflectionLifecycleLogger, reflectionGenerationService, options }: { reflectionLifecycleLogger: ReflectionLifecycleLogger; reflectionGenerationService: InitialReflectionGenerationService; options: Pick<CreateAppOptions, 'logError'> }): void {
  app.post('/api/study-sessions/:sessionId/reflections', async (req, res) => {
    const sessionId = req.params.sessionId;
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty session id' });
      return;
    }

    const normalizedSessionId = sessionId.trim();
    const requestedModel = req.body?.model;
    if (requestedModel !== undefined && !isReflectionModelChoice(requestedModel)) {
      res.status(400).json({ error: 'Expected a supported reflection model when provided' });
      return;
    }
    const generationStartedAt = Date.now();
    reflectionLifecycleLogger.emit({
      event: 'reflection.generation_requested',
      sessionId: normalizedSessionId,
    });

    try {
      const result = await runHostedProviderWork(
        () => reflectionGenerationService.generate(sessionId, req.body, requestedModel),
      );
      reflectionLifecycleLogger.emit({
        event: 'reflection.generation_succeeded',
        sessionId: normalizedSessionId,
        artifactId: result.artifactId,
        proposalCount: result.proposalCount,
        status: result.status,
        elapsedMs: Date.now() - generationStartedAt,
      });
      res.status(result.status === 'created' ? 201 : 200).json(result);
    } catch (error) {
      if (handleHostedProviderWorkError(error, res)) return;
      if (error instanceof ReflectionEvidenceError) {
        reflectionLifecycleLogger.emit({
          event: 'reflection.generation_failed',
          sessionId: normalizedSessionId,
          failure: 'invalid_evidence',
          code: error.code,
          clientRequestId: null,
          elapsedMs: Date.now() - generationStartedAt,
        });
        res.status(error.httpStatus).json({
          error: error.message,
          code: error.code,
        });
        return;
      }
      if (error instanceof LunaReflectionProviderError) {
        reflectionLifecycleLogger.emit({
          event: 'reflection.generation_failed',
          sessionId: normalizedSessionId,
          failure: 'provider',
          code: error.code,
          clientRequestId: error.clientRequestId,
          elapsedMs: Date.now() - generationStartedAt,
        });
        res.status(error.code === 'missing_config' ? 503 : 502).json({
          error: error.message,
          code: error.code,
        });
        return;
      }
      reflectionLifecycleLogger.emit({
        event: 'reflection.generation_failed',
        sessionId: normalizedSessionId,
        failure: 'internal',
        code: null,
        clientRequestId: null,
        elapsedMs: Date.now() - generationStartedAt,
      });
      res.status(500).json({ error: 'Failed to generate reflection' });
    }
  });
  app.get('/api/reflection-artifacts', (req, res) => {
    const review = req.query?.review;
    if (review !== 'open' && review !== 'all') {
      res.status(400).json({ error: 'Expected review query parameter to be open or all' });
      return;
    }

    try {
      res.json({ artifacts: listReflectionArtifacts(review) });
    } catch {
      res.status(500).json({ error: 'Failed to load reflection artifacts' });
    }
  });
  app.get('/api/reflection-generation-runs', (_req, res) => {
    try {
      res.json({
        runs: listReflectionGenerationRuns(),
      });
    } catch {
      res.status(500).json({ error: 'Failed to load reflection generation runs' });
    }
  });
  app.post('/api/reflection-generation-runs/:runId/retry', async (req, res) => {
    const runId = req.params.runId;
    if (typeof runId !== 'string' || runId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty reflection generation run id' });
      return;
    }

    const requestedModel = req.body?.model;
    if (requestedModel !== undefined && !isReflectionModelChoice(requestedModel)) {
      res.status(400).json({ error: 'Expected a supported reflection model when provided' });
      return;
    }
    try {
      const result = await runHostedProviderWork(
        () => reflectionGenerationService.retry(runId.trim(), requestedModel),
      );
      res.status(result.status === 'created' ? 201 : 200).json(result);
    } catch (error) {
      if (handleHostedProviderWorkError(error, res)) return;
      if (isReflectionNotFoundError(error, 'Reflection generation run not found.')) {
        res.status(404).json({ error: 'Reflection generation run not found' });
        return;
      }
      if (
        error instanceof RetiredReflectionSourceModelError
        || (error instanceof Error && error.name === 'RetiredReflectionSourceModelError')
      ) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error instanceof Error && (
        error.message === 'Reflection generation run is not retryable.'
        || error.message === 'Reflection generation run is not retryable by the current flow.'
      )) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error instanceof LunaReflectionProviderError) {
        res.status(error.code === 'missing_config' ? 503 : 502).json({
          error: error.message,
          code: error.code,
        });
        return;
      }
      res.status(500).json({ error: 'Failed to retry reflection generation' });
    }
  });
  app.post('/api/deferred-reflection-second-opinions', async (req, res) => {
    const proposalIds = req.body?.proposalIds;
    const helpInboxIds = req.body?.helpInboxIds ?? [];
    const requestedModel = req.body?.model;
    if (!Array.isArray(proposalIds) || !proposalIds.every((proposalId) => typeof proposalId === 'string')) {
      res.status(400).json({ error: 'Expected an array of selected reflection proposal ids' });
      return;
    }
    if (!Array.isArray(helpInboxIds) || !helpInboxIds.every((id) => typeof id === 'string')) {
      res.status(400).json({ error: 'Expected an array of selected explanation item ids' });
      return;
    }
    if (!isReflectionModelChoice(requestedModel)) {
      res.status(400).json({ error: 'Choose a supported reflection model for the second opinion' });
      return;
    }
    const generationStartedAt = Date.now();
    reflectionLifecycleLogger.emit({
      event: 'reflection.generation_requested',
      sessionId: null,
    });
    try {
      const result = await runHostedProviderWork(
        () => reflectionGenerationService.generateDeferredSecondOpinion(proposalIds, requestedModel, helpInboxIds),
      );
      reflectionLifecycleLogger.emit({
        event: 'reflection.generation_succeeded',
        sessionId: null,
        artifactId: result.artifactId,
        proposalCount: result.proposalCount,
        status: result.status,
        elapsedMs: Date.now() - generationStartedAt,
      });
      res.status(result.status === 'created' ? 201 : 200).json(result);
    } catch (error) {
      if (error instanceof HostedProviderWorkUnavailableError) {
        reflectionLifecycleLogger.emit({
          event: 'reflection.generation_failed',
          sessionId: null,
          failure: 'internal',
          code: error.code,
          clientRequestId: null,
          elapsedMs: Date.now() - generationStartedAt,
        });
        handleHostedProviderWorkError(error, res);
        return;
      }
      if (error instanceof DeferredSecondOpinionError) {
        reflectionLifecycleLogger.emit({
          event: 'reflection.generation_failed',
          sessionId: null,
          failure: 'invalid_evidence',
          code: 'invalid_deferred_selection',
          clientRequestId: null,
          elapsedMs: Date.now() - generationStartedAt,
        });
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof LunaReflectionProviderError) {
        reflectionLifecycleLogger.emit({
          event: 'reflection.generation_failed',
          sessionId: null,
          failure: 'provider',
          code: error.code,
          clientRequestId: error.clientRequestId,
          elapsedMs: Date.now() - generationStartedAt,
        });
        res.status(error.code === 'missing_config' ? 503 : 502).json({
          error: error.message,
          code: error.code,
        });
        return;
      }
      const diagnosticId = randomUUID();
      const elapsedMs = Date.now() - generationStartedAt;
      reflectionLifecycleLogger.emit({
        event: 'reflection.generation_failed',
        sessionId: null,
        failure: 'internal',
        code: 'internal_error',
        clientRequestId: null,
        diagnosticId,
        elapsedMs,
      });
      (options.logError ?? defaultErrorLogger)('Deferred second opinion generation failed', {
        diagnosticId,
        route: '/api/deferred-reflection-second-opinions',
        status: '500',
        elapsedMs: String(elapsedMs),
        proposalCount: String(proposalIds.length),
        model: requestedModel,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: 'Failed to generate a second opinion', diagnosticId });
    }
  });
  app.get('/api/reflection-artifacts/:artifactId', (req, res) => {
    const artifactId = req.params.artifactId;
    if (typeof artifactId !== 'string' || artifactId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty reflection artifact id' });
      return;
    }

    try {
      res.json(getReflectionArtifactDetail(artifactId.trim()));
    } catch (error) {
      if (isReflectionNotFoundError(error, 'Reflection artifact not found.')) {
        res.status(404).json({ error: 'Reflection artifact not found' });
        return;
      }
      res.status(500).json({ error: 'Failed to load reflection artifact' });
    }
  });
  app.post(
    '/api/reflection-artifacts/:artifactId/items/:itemId/manual-invocations',
    (req, res) => {
      const artifactId = req.params.artifactId;
      const itemId = req.params.itemId;
      if (typeof artifactId !== 'string' || artifactId.trim().length === 0) {
        res.status(400).json({ error: 'Expected non-empty reflection artifact id' });
        return;
      }
      if (typeof itemId !== 'string' || itemId.trim().length === 0) {
        res.status(400).json({ error: 'Expected non-empty reflection item id' });
        return;
      }
      const request = readAuthorizeManualReflectionOperationRequest(req.body);
      if (request === null) {
        res.status(400).json({ error: 'Expected a valid manual reflection invocation request' });
        return;
      }

      try {
        const authorized = authorizeManualReflectionOperation({
          artifactId: artifactId.trim(),
          itemId: itemId.trim(),
          operation: request.operation,
        });
        const invocation = authorized.invocation.application.state.kind === 'pending'
          ? applyReflectionInvocation(authorized.invocation.invocation.invocationId)
          : authorized.invocation;
        res.json({
          invocation: invocation.invocation,
          application: invocation.application,
        });
      } catch (error) {
        if (
          isReflectionNotFoundError(error, 'Reflection artifact not found.')
          || isReflectionNotFoundError(error, 'Reflection item not found.')
        ) {
          res.status(404).json({
            error: error.message.replace(/\.$/, ''),
          });
          return;
        }
        if (isReflectionReviewClientError(error)) {
          res.status(400).json({ error: error.message });
          return;
        }
        res.status(500).json({ error: 'Failed to authorize manual reflection operation' });
      }
    },
  );
  app.post('/api/reflection-proposals/:proposalId/review', (req, res) => {
    const proposalId = req.params.proposalId;
    if (typeof proposalId !== 'string' || proposalId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty reflection proposal id' });
      return;
    }
    const request = readReviewProposalRequest(req.body);
    if (request === null) {
      res.status(400).json({ error: 'Expected a valid reflection proposal review action' });
      return;
    }

    try {
      if (request.action === 'defer') {
        const review = deferReflectionProposal(proposalId.trim());
        res.json({ review, invocation: null, application: null });
        return;
      }
      if (request.action === 'dismiss') {
        const review = dismissReflectionProposal(
          proposalId.trim(),
          request.reason,
        );
        res.json({ review, invocation: null, application: null });
        return;
      }
      if (request.action === 'reopen') {
        const review = reopenReflectionProposal(proposalId.trim());
        res.json({ review, invocation: null, application: null });
        return;
      }

      const accepted = request.action === 'replace'
        ? replaceReflectionProposal({
          proposalId: proposalId.trim(),
          operation: request.operation,
        })
        : acceptReflectionProposal({
        proposalId: proposalId.trim(),
        operation: request.operation,
      });
      const invocation = accepted.invocation.application.state.kind === 'pending'
        ? applyReflectionInvocation(accepted.invocation.invocation.invocationId)
        : accepted.invocation;
      res.json({
        review: accepted.review,
        invocation: invocation.invocation,
        application: invocation.application,
      });
    } catch (error) {
      if (isReflectionNotFoundError(error, 'Reflection proposal not found.')) {
        res.status(404).json({ error: 'Reflection proposal not found' });
        return;
      }
      if (isReflectionReviewClientError(error)) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to review reflection proposal' });
    }
  });
  app.post(
    '/api/reflection-invocations/:invocationId/withdraw-authorization',
    (req, res) => {
      const invocationId = req.params.invocationId;
      if (typeof invocationId !== 'string' || invocationId.trim().length === 0) {
        res.status(400).json({ error: 'Expected non-empty reflection invocation id' });
        return;
      }
      if (
        req.body !== undefined
        && (!isPlainObject(req.body) || Object.keys(req.body).length !== 0)
      ) {
        res.status(400).json({ error: 'Expected an empty request body' });
        return;
      }

      try {
        const invocation = withdrawReflectionInvocationAuthorization(invocationId.trim());
        res.json({
          invocation: invocation.invocation,
          application: invocation.application,
        });
      } catch (error) {
        if (isReflectionNotFoundError(error, 'Reflection invocation not found.')) {
          res.status(404).json({ error: 'Reflection invocation not found' });
          return;
        }
        if (
          error instanceof Error
          && error.message.startsWith('Invalid operation application transition:')
        ) {
          res.status(400).json({ error: error.message });
          return;
        }
        res.status(500).json({ error: 'Failed to withdraw reflection authorization' });
      }
    },
  );
  app.put('/api/reflection-quality', (req, res) => {
    const request = readUpsertReflectionQualityRequest(req.body);
    if (request === null) {
      res.status(400).json({ error: 'Expected a valid reflection quality annotation upsert' });
      return;
    }
    try {
      res.json(upsertReflectionQualityAnnotation(request));
    } catch (error) {
      if (isReflectionQualityNotFoundError(error)) {
        res.status(404).json({ error: error.message.replace(/\.$/, '') });
        return;
      }
      if (isReflectionQualityClientError(error)) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to upsert reflection quality annotation' });
    }
  });
  app.delete('/api/reflection-quality', (req, res) => {
    const request = readClearReflectionQualityRequest(req.body);
    if (request === null) {
      res.status(400).json({ error: 'Expected a valid reflection quality clear request' });
      return;
    }
    try {
      res.json(clearReflectionQualityAnnotation(request));
    } catch (error) {
      if (isReflectionQualityNotFoundError(error)) {
        res.status(404).json({ error: error.message.replace(/\.$/, '') });
        return;
      }
      if (isReflectionQualityClientError(error)) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to clear reflection quality annotation' });
    }
  });
  app.get('/api/reflection-quality-stats', (_req, res) => {
    try {
      res.json(getReflectionQualityStats());
    } catch {
      res.status(500).json({ error: 'Failed to load reflection quality stats' });
    }
  });
  app.get('/api/reflection-help-inbox', (_req, res) => {
    try {
      res.json({ entries: listReflectionHelpInbox() });
    } catch {
      res.status(500).json({ error: 'Failed to load reflection help inbox' });
    }
  });
  app.delete('/api/reflection-help-inbox', (req, res) => {
    const request = readMarkReflectionHelpInboxDoneRequest(req.body);
    if (request === null) {
      res.status(400).json({ error: 'Expected a valid reflection help inbox done request' });
      return;
    }
    try {
      res.json(markReflectionHelpInboxDone(request));
    } catch (error) {
      if (isReflectionQualityNotFoundError(error)) {
        res.status(404).json({ error: error.message.replace(/\.$/, '') });
        return;
      }
      if (isReflectionQualityClientError(error)) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to mark reflection help inbox item done' });
    }
  });
  app.post('/api/reflection-help-inbox/defer', (req, res) => {
    const request = readMarkReflectionHelpInboxDoneRequest(req.body);
    if (request === null) {
      res.status(400).json({ error: 'Expected a valid reflection help item' });
      return;
    }
    try {
      res.json(deferReflectionHelpInboxItem(request));
    } catch (error) {
      if (isReflectionQualityNotFoundError(error)) {
        res.status(404).json({ error: error.message.replace(/\.$/, '') });
        return;
      }
      res.status(500).json({ error: 'Failed to defer reflection help item' });
    }
  });
}

function readReviewProposalRequest(value: unknown): ReviewProposalRequest | null {
  if (!isPlainObject(value) || typeof value.action !== 'string') {
    return null;
  }
  const keys = Object.keys(value).sort();

  switch (value.action) {
    case 'defer':
      return keys.length === 1 && keys[0] === 'action'
        ? { action: 'defer' }
        : null;
    case 'dismiss': {
      const allowedKeys = new Set(['action', 'reason']);
      if (
        !keys.every((key) => allowedKeys.has(key))
        || !keys.includes('reason')
        || (value.reason !== null && typeof value.reason !== 'string')
      ) {
        return null;
      }
      return { action: 'dismiss', reason: value.reason };
    }
    case 'reopen':
      return keys.length === 1 && keys[0] === 'action'
        ? { action: 'reopen' }
        : null;
    case 'accept':
    case 'replace':
      if (
        keys.length !== 2
        || keys[0] !== 'action'
        || keys[1] !== 'operation'
        || !isPlainObject(value.operation)
      ) {
        return null;
      }
      return {
        action: value.action,
        operation: value.operation as ReflectionOperation,
      };
    default:
      return null;
  }
}

function isReflectionReviewClientError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  return (
    error.message.startsWith('Cannot authorize ')
    || error.message.startsWith('Invalid proposal review transition:')
    || error.message.startsWith('Reflection operation references unknown word ')
    || error.message.startsWith('No reflection operation registration for ')
    || error.message === 'A revised proposal acceptance must preserve operation kind and version.'
    || error.message === 'A replacement proposal must change operation kind or version.'
    || error.message === 'Manual authorization is only available for explanation-only reflection items.'
    || isReflectionQualityClientError(error)
  );
}

function readAuthorizeManualReflectionOperationRequest(
  value: unknown,
): { operation: ReflectionOperation } | null {
  if (!isPlainObject(value) || !isPlainObject(value.operation)) {
    return null;
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'operation') {
    return null;
  }
  return { operation: value.operation as ReflectionOperation };
}

function readUpsertReflectionQualityRequest(value: unknown): UpsertReflectionQualityRequest | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => !['artifactId', 'itemId', 'tags', 'note'].includes(key))) {
    return null;
  }
  if (
    typeof value.artifactId !== 'string'
    || value.artifactId.trim().length === 0
    || typeof value.itemId !== 'string'
    || value.itemId.trim().length === 0
    || !Array.isArray(value.tags)
    || value.tags.length === 0
    || !value.tags.every((tag) => isReflectionQualityTag(tag))
  ) {
    return null;
  }
  const note = value.note === undefined ? undefined : value.note;
  if (note !== undefined && note !== null && typeof note !== 'string') {
    return null;
  }
  return note === undefined
    ? {
        artifactId: value.artifactId.trim(),
        itemId: value.itemId.trim(),
        tags: value.tags,
      }
    : {
        artifactId: value.artifactId.trim(),
        itemId: value.itemId.trim(),
        tags: value.tags,
        note,
      };
}

function readClearReflectionQualityRequest(value: unknown): ClearReflectionQualityRequest | null {
  return readItemLocatorRequest(value);
}

function readMarkReflectionHelpInboxDoneRequest(
  value: unknown,
): MarkReflectionHelpInboxDoneRequest | null {
  return readItemLocatorRequest(value);
}

function readItemLocatorRequest(value: unknown): { artifactId: string; itemId: string } | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 2
    || keys[0] !== 'artifactId'
    || keys[1] !== 'itemId'
    || typeof value.artifactId !== 'string'
    || value.artifactId.trim().length === 0
    || typeof value.itemId !== 'string'
    || value.itemId.trim().length === 0
  ) {
    return null;
  }
  return {
    artifactId: value.artifactId.trim(),
    itemId: value.itemId.trim(),
  };
}

function isReflectionQualityNotFoundError(error: unknown): error is Error {
  return error instanceof Error && (
    error.message === 'Reflection artifact not found.'
    || error.message === 'Reflection item not found.'
  );
}

function handleHostedProviderWorkError(error: unknown, res: Response): boolean {
  if (!(error instanceof HostedProviderWorkUnavailableError)) return false;
  res.status(503).json({ error: error.message, code: error.code });
  return true;
}
