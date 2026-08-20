import { pathToFileURL } from 'node:url';
import express, { type ErrorRequestHandler } from 'express';
import {
  createClerkMiddleware,
  createSpikeAccountMiddleware,
  requireSpikeAccount,
  type AuthenticatedSpikeRequest,
  type ProviderSubjectResolver,
} from './auth.ts';
import { renderSpikeClient } from './client.ts';
import { readLitestreamBackupStatus } from './backup.ts';
import {
  getDefaultSpikeDbPath,
  MAINTENANCE_MODE_CODE,
  MaintenanceModeError,
  openSpikeDatabase,
  type SpikeDatabase,
} from './database.ts';
import { observeApplicationError, renderPrometheusMetrics } from './metrics.ts';

export type CreatePlatformSpikeAppOptions = {
  database: SpikeDatabase;
  publishableKey: string;
  authorizedParty: string;
  resolveProviderSubject?: ProviderSubjectResolver;
};

export function createPlatformSpikeApp(options: CreatePlatformSpikeAppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb' }));

  if (!options.resolveProviderSubject) {
    app.use(createClerkMiddleware(options.publishableKey, parseAuthorizedParty(options.authorizedParty)));
  }

  app.get('/', (_request, response) => {
    response.type('html').send(renderSpikeClient(options.publishableKey));
  });

  app.get('/healthz', (_request, response) => {
    response.json({
      status: 'ok',
      schemaVersion: options.database.getSchemaVersion(),
      maintenanceMode: options.database.isMaintenanceMode(),
    });
  });

  app.get('/metrics', async (_request, response) => {
    const backupStatus = await readLitestreamBackupStatus(undefined, options.database.dbPath);
    response.type('text/plain; version=0.0.4').send(renderPrometheusMetrics(options.database.metrics, {
      dbPath: options.database.dbPath,
      schemaVersion: options.database.getSchemaVersion(),
      maintenanceMode: options.database.isMaintenanceMode(),
      backupLastSyncAt: backupStatus?.lastSyncAt ?? null,
    }));
  });

  const requireAccount = createSpikeAccountMiddleware(options.database, options.resolveProviderSubject);

  app.get('/api/me', requireAccount, (request: AuthenticatedSpikeRequest, response) => {
    const account = requireSpikeAccount(request);
    response.json({ localAccountId: account.localAccountId, enabled: account.enabled });
  });

  app.post('/api/sentinels', requireAccount, (_request, response) => {
    try {
      response.status(201).json(options.database.createSentinel());
    } catch (error) {
      if (error instanceof MaintenanceModeError) {
        response.status(503).json({ error: error.message, code: MAINTENANCE_MODE_CODE });
        return;
      }
      throw error;
    }
  });

  app.get('/api/sentinels/:sentinelId', requireAccount, (request, response) => {
    try {
      const sentinel = options.database.getSentinel(request.params.sentinelId);
      if (!sentinel) {
        response.status(404).json({ error: 'Sentinel not found.', code: 'SENTINEL_NOT_FOUND' });
        return;
      }
      response.json(sentinel);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Expected a safe sentinel id')) {
        response.status(400).json({ error: error.message, code: 'INVALID_SENTINEL_ID' });
        return;
      }
      throw error;
    }
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    observeApplicationError(options.database.metrics);
    console.error(JSON.stringify({ event: 'swi46.application_error', errorName: safeErrorName(error) }));
    response.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  };
  app.use(errorHandler);

  return app;
}

export function startPlatformSpikeServer(): void {
  const publishableKey = requireClerkPublishableKey(process.env);
  requireEnvironmentVariable('CLERK_SECRET_KEY');
  const authorizedParty = parseAuthorizedParty(requireEnvironmentVariable('CLERK_AUTHORIZED_PARTY'));
  const database = openSpikeDatabase(getDefaultSpikeDbPath());
  const port = readPort(process.env.PORT ?? '5174');
  const app = createPlatformSpikeApp({ database, publishableKey, authorizedParty });
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(JSON.stringify({ event: 'swi46.server_started', port, schemaVersion: database.getSchemaVersion() }));
  });

  const shutdown = () => {
    server.close(() => {
      database.close();
      process.exit(0);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

export function requireClerkPublishableKey(environment: NodeJS.ProcessEnv): string {
  const value = environment.CLERK_PUBLISHABLE_KEY ?? environment.VITE_CLERK_PUBLISHABLE_KEY;
  if (!value) throw new Error('Missing required environment variable: CLERK_PUBLISHABLE_KEY or VITE_CLERK_PUBLISHABLE_KEY');
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startPlatformSpikeServer();
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function readPort(rawPort: string): number {
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid PORT: ${rawPort}`);
  return port;
}

export function parseAuthorizedParty(rawValue: string): string {
  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error('CLERK_AUTHORIZED_PARTY must be an absolute HTTP(S) origin.');
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:')
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash) {
    throw new Error('CLERK_AUTHORIZED_PARTY must be an absolute HTTP(S) origin without credentials, path, query, or fragment.');
  }
  return url.origin;
}

function safeErrorName(error: unknown): string {
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name) ? error.name : 'UnknownError';
}
