import { CLIENT_TRANSPORT_INCIDENT_MAX_BATCH_SIZE, isClientTransportIncident } from '../../src/domain/client-incidents.ts';
import { requireLearnerId, getContentDiagnostics } from '../db.ts';
import type { ContentDiagnosticKind } from '../../src/domain/content-diagnostics.ts';
import type { ClientIncidentDiagnosticSink } from '../client-incident-diagnostics.ts';
import { defaultErrorLogger, readPositiveIntegerFromQuery } from './request-helpers.ts';
import type { CreateAppOptions } from '../index.ts';
import type { Express } from 'express';

/** Client incident reports and learner content diagnostics. */
export function registerDiagnosticsRoutes(app: Express, { clientIncidentDiagnosticSink, options }: { clientIncidentDiagnosticSink: ClientIncidentDiagnosticSink; options: Pick<CreateAppOptions, 'logError'> }): void {
  app.post('/api/client-incidents', (req, res) => {
    const incidents = req.body?.incidents;
    if (
      !Array.isArray(incidents)
      || incidents.length < 1
      || incidents.length > CLIENT_TRANSPORT_INCIDENT_MAX_BATCH_SIZE
      || incidents.some((incident) => !isClientTransportIncident(incident))
    ) {
      res.status(400).json({ error: 'Expected a valid client incident batch' });
      return;
    }

    try {
      const learnerId = requireLearnerId();
      for (const incident of incidents) {
        clientIncidentDiagnosticSink.record({ learnerId, incident });
      }
      res.status(204).send();
    } catch (error) {
      (options.logError ?? defaultErrorLogger)('Failed to record client incident diagnostics', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(500).json({ error: 'Failed to record client incident diagnostics' });
    }
  });
  app.get('/api/content-diagnostics', (req, res) => {
    const kind = req.query?.kind;
    const query = req.query?.q;
    const limit = readPositiveIntegerFromQuery(req.query?.limit, 50);
    if (!isContentDiagnosticKind(kind)) {
      res.status(400).json({ error: 'Expected kind to be word, contrast_cluster, or production_cue' });
      return;
    }
    if (typeof query !== 'string' || query.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty string q query parameter' });
      return;
    }
    if (limit === null) {
      res.status(400).json({ error: 'Expected positive integer limit query parameter' });
      return;
    }
    try {
      res.json(getContentDiagnostics({ kind, query, limit }));
    } catch {
      res.status(500).json({ error: 'Failed to load content diagnostics' });
    }
  });
}

function isContentDiagnosticKind(value: unknown): value is ContentDiagnosticKind {
  return value === 'word' || value === 'contrast_cluster' || value === 'production_cue';
}
