import { readPublicBackupHealth } from './hosted-backup-status.ts';
import { startConfiguredBackupSource } from './backups/source.ts';
import { registerVocabularyIntakeRoutes } from './vocabulary/intake-routes.ts';
import { createVocabularyIntakeWorker } from './vocabulary/intake-worker.ts';
import type { ChatProvider } from './llm/chat-types.ts';
import { registerVocabularyStatisticsRoutes } from './vocabulary/statistics-routes.ts';
import { registerVocabularyProgressRoutes } from './vocabulary/progress-routes.ts';
import { createVocabularyCutoverFence } from './vocabulary/cutover-routes.ts';
import { registerVocabularyStudyRoutes } from './vocabulary/study-routes.ts';
import { registerVocabularyReflectionRoutes } from './vocabulary/reflection-routes.ts';
import { registerSenseContentReconciliationRoutes } from './vocabulary/reconciliation-routes.ts';
import { listSenseContentReconciliationPracticeDemand } from './db/sense-content-reconciliation-state.ts';
import { createVocabularyProcessingWorker } from './vocabulary/processing-worker.ts';
import { getVocabularyApprovalRequests } from './vocabulary/approval-requests.ts';
import { createVocabularyPracticeWorker } from './vocabulary/preparation-worker.ts';
import { createSessionCompletionWorker } from './session-completion/worker.ts';
import { registerContentImprovementRoutes } from './content-improvement-routes.ts';
import { createFileReflectionFailureArtifactSink } from './reflection/failure-artifacts.ts';
import { installModelInvocationLedger } from './llm/invocation-ledger.ts';
import { startSessionDebriefRuntime } from './session-debrief/worker.ts';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClerkRequestAuthentication, type ProviderSubjectResolver } from './authentication.ts';
import {
  dbConfig,
  recoverPendingReflectionInvocations,
  runWithLearnerId,
  currentLearnerIdOrNull,
  getHostedServiceControls,
  readHostedServiceControl,
} from './db.ts';
import { createServiceAccessMiddleware } from './service-access.ts';
import { mountRepertoireQualityRoutes } from './operator/repertoire-quality-routes.ts';
import { startUsagePulseScheduler } from './usage-pulse-scheduler.ts';
import {
  getActiveProviderWorkCount,
  MAINTENANCE_MODE_CODE,
} from './hosted-runtime-controls.ts';
import {
  createInitialReflectionGenerationService,
  type InitialReflectionGenerationService,
} from './reflection/generation.ts';
import {
  createStdoutReflectionLifecycleLogger,
  type ReflectionLifecycleLogger,
} from './reflection/lifecycle-log.ts';
import { createFileReflectionProviderDiagnosticSink } from './reflection/provider-diagnostics.ts';
import { closeDbConnection } from './db/connection.ts';
import {
  createServiceMetrics,
  readMetricsPort,
  startMetricsServer,
  type ServiceMetrics,
} from './observability.ts';
import { readServiceOperationalMetrics } from './hosted-observability.ts';
import {
  createRequestTimingMiddleware,
  createSlowRequestLogger,
  readSlowRequestThresholdMs,
} from './request-timing.ts';
import { createRequestFlightRecorder, type RequestFlightRecorder } from './request-flight-recorder.ts';
import {
  createStudyCommitDiagnosticSink,
  type StudyCommitDiagnosticSink,
} from './study-commit-diagnostics.ts';
import {
  createClientIncidentDiagnosticSink,
  type ClientIncidentDiagnosticSink,
} from './client-incident-diagnostics.ts';
import { createIntroductionLabRouter, introductionLabEnabled } from './word-content-lab/routes.ts';
import { createWordIntroductionRouter } from './word-content/routes.ts';
import { createWordIntroductionService, type WordIntroductionService } from './word-content/service.ts';
import {
  createIntroductionLabService,
  type IntroductionLabService,
} from './word-content-lab/service.ts';
import { startWordPreparationRuntime } from './word-content/preparation-runtime.ts';
import { registerDiagnosticsRoutes } from './routes/diagnostics-routes.ts';
import { registerOperatorRoutes } from './routes/operator-routes.ts';
import { registerLearnerSettingsRoutes } from './routes/learner-settings-routes.ts';
import { registerSessionDebriefRoutes } from './routes/session-debrief-routes.ts';
import { registerWhatsNewRoutes } from './routes/whats-new-routes.ts';
import { registerAttentionRoutes } from './routes/attention-routes.ts';
import { defaultErrorLogger } from './routes/request-helpers.ts';
import { registerWordsRoutes } from './routes/words-routes.ts';
import { registerContentQualityRoutes } from './routes/content-quality-routes.ts';
import { registerLegacyStudyRoutes } from './routes/legacy-study-routes.ts';
import { registerLegacyReflectionRoutes } from './routes/legacy-reflection-routes.ts';

const port = dbConfig.port;
const defaultJsonBodyLimit = '100kb';

export type CreateAppOptions = {
  reflectionGenerationService?: InitialReflectionGenerationService;
  reflectionLifecycleLogger?: ReflectionLifecycleLogger;
  resolveClerkProviderSubject?: ProviderSubjectResolver;
  /** `undefined` follows NODE_ENV; `null` explicitly disables frontend serving. */
  frontendDistPath?: string | null;
  logError?: (message: string, metadata: Record<string, string>) => void;
  serviceMetrics?: ServiceMetrics | null;
  requestTiming?: {
    clockMs?: () => number;
    slowRequestThresholdMs?: number;
    logSlowRequest?: (line: string) => void;
    flightRecorder?: RequestFlightRecorder;
  };
  studyCommitDiagnosticSink?: StudyCommitDiagnosticSink;
  clientIncidentDiagnosticSink?: ClientIncidentDiagnosticSink;
  introductionLabService?: IntroductionLabService;
  wordIntroductionService?: WordIntroductionService;
  wakeWordPreparation?: () => void;
  canPrepareWords?: () => boolean;
  wakeSessionDebriefs?: () => void;
  wakeSessionCompletions?: () => void;
  wakeVocabulary?: () => void;
  wakeVocabularyIntake?: () => void;
  vocabularyIntakeProvider?: ChatProvider;
};

export function createApp(options: CreateAppOptions = {}) {
  installModelInvocationLedger();
  const app = express();
  const frontendDistPath = resolveFrontendDistPath(options.frontendDistPath);
  const reflectionLifecycleLogger = options.reflectionLifecycleLogger
    ?? createStdoutReflectionLifecycleLogger();
  const failureArtifactSink = createFileReflectionFailureArtifactSink(dbConfig.dataDir);
  const reflectionGenerationService = options.reflectionGenerationService
    ?? createInitialReflectionGenerationService({
      lifecycleLogger: reflectionLifecycleLogger,
      failureArtifactSink,
      providerDiagnosticSink: createFileReflectionProviderDiagnosticSink(dbConfig.dataDir),
    });
  const studyCommitDiagnosticSink = options.studyCommitDiagnosticSink
    ?? createStudyCommitDiagnosticSink(dbConfig.dataDir);
  const clientIncidentDiagnosticSink = options.clientIncidentDiagnosticSink
    ?? createClientIncidentDiagnosticSink(dbConfig.dataDir);

  const logSlowRequest = createSlowRequestLogger({
    thresholdMs: options.requestTiming?.slowRequestThresholdMs
      ?? readSlowRequestThresholdMs(process.env.APP_SLOW_REQUEST_MS),
    logLine: options.requestTiming?.logSlowRequest,
  });
  const requestTiming = createRequestTimingMiddleware({
    clockMs: options.requestTiming?.clockMs,
    onSummary: (summary) => {
      const slow = logSlowRequest(summary);
      options.serviceMetrics?.observeRequestTiming(summary, slow);
      options.requestTiming?.flightRecorder?.record(summary);
    },
  });

  app.disable('x-powered-by');
  app.use(requestTiming.begin);
  if (options.serviceMetrics) app.use(options.serviceMetrics.requestMiddleware);
  app.use(cors(dbConfig.authMode === 'clerk'
    ? {
        origin: process.env.CLERK_AUTHORIZED_PARTY,
        allowedHeaders: ['Authorization', 'Content-Type'],
      }
    : undefined));
  app.use('/api/operator/content-improvements', express.json({ limit: '512kb' }));
  app.use('/api/operator/whats-new', express.json({ limit: '1mb' }));
  app.use('/api/whats-new-attention', express.json({ limit: '160kb' }));
  app.use('/api/study-sessions/:sessionId/completion', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: defaultJsonBodyLimit }));
  app.use(requestTiming.resume);

  // Fly health checks and browser assets must remain available without a learner session.
  app.get('/healthz', (_req, res) => {
    const controls = getHostedServiceControls();
    res.json({
      status: 'ok',
      maintenanceMode: controls.maintenanceMode,
      operatorOnly: controls.operatorOnly,
      providerWorkEnabled: controls.providerWorkEnabled,
      activeProviderWorkCount: getActiveProviderWorkCount(),
    });
  });
  app.get('/backup-healthz', async (_req, res) => {
    const health = await readPublicBackupHealth();
    res.set('Cache-Control', 'no-store').status(health.status === 'ok' ? 200 : 503).json(health);
  });
  if (frontendDistPath) {
    app.use(express.static(frontendDistPath, { index: false }));
  }

  app.use('/api', requestTiming.authStarted);
  if (dbConfig.authMode === 'trusted_local') {
    app.use('/api', createServiceAccessMiddleware(() => null));
    app.use('/api', (_req, _res, next) => runWithLearnerId(dbConfig.learnerId, next));
  } else {
    app.use('/api', ...createClerkRequestAuthentication(options.resolveClerkProviderSubject));
  }
  app.use('/api', requestTiming.authFinished(currentLearnerIdOrNull));
  app.use('/api', (req, res, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
      && getHostedServiceControls().maintenanceMode
    ) {
      res.status(503).json({ error: 'The service is in maintenance mode.', code: MAINTENANCE_MODE_CODE });
      return;
    }
    next();
  });

  app.use('/api', createVocabularyCutoverFence(dbConfig.studyProfile));
  if (dbConfig.studyProfile === 'mandarin') {
    app.use('/api/words', createWordIntroductionRouter(
      options.wordIntroductionService ?? createWordIntroductionService(),
    ));
  }

  if (introductionLabEnabled(dbConfig, process.env.APP_WORD_CONTENT_WORKBENCH)) {
    app.use('/api/intro-lab', createIntroductionLabRouter(
      options.introductionLabService ?? createIntroductionLabService({ dataDir: dbConfig.dataDir }),
    ));
  }

  registerDiagnosticsRoutes(app, { clientIncidentDiagnosticSink, options });
  registerWordsRoutes(app, { options });
  registerContentQualityRoutes(app);
  registerContentImprovementRoutes(app);
  registerVocabularyStudyRoutes(app, options.wakeVocabulary);
  registerVocabularyIntakeRoutes(app, { wake: options.wakeVocabularyIntake, provider: options.vocabularyIntakeProvider,
    resolveClerkProviderSubject: options.resolveClerkProviderSubject });
  registerVocabularyStatisticsRoutes(app);
  registerVocabularyProgressRoutes(app);
  registerVocabularyReflectionRoutes(app, {wake: options.wakeVocabulary});
  registerSenseContentReconciliationRoutes(app, {wake: () => { options.wakeWordPreparation?.(); options.wakeVocabulary?.(); }});
  mountRepertoireQualityRoutes(app, dbConfig.dbPath);
  registerOperatorRoutes(app, { options });
  registerLegacyStudyRoutes(app, { options, studyCommitDiagnosticSink, reflectionLifecycleLogger });
  registerLearnerSettingsRoutes(app);
  registerSessionDebriefRoutes(app, { options });
  registerLegacyReflectionRoutes(app, { reflectionLifecycleLogger, reflectionGenerationService, options });
  registerAttentionRoutes(app);
  registerWhatsNewRoutes(app);

  if (frontendDistPath) {
    const frontendIndexPath = path.join(frontendDistPath, 'index.html');
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res, next) => {
      res.sendFile(frontendIndexPath, (error) => error ? next(error) : undefined);
    });
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const status = readHttpErrorStatus(error);
    (options.logError ?? defaultErrorLogger)('Unhandled request error', { errorName, status: String(status) });
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(status).json({
      error: status === 400
        ? 'Invalid JSON request body'
        : status === 413
          ? 'Request body too large'
          : 'Internal server error',
    });
  });

  return app;
}

function resolveFrontendDistPath(configuredPath: string | null | undefined): string | null {
  const resolvedPath = configuredPath === undefined
    ? process.env.NODE_ENV === 'production' ? path.resolve(process.cwd(), 'dist') : null
    : configuredPath === null ? null : path.resolve(configuredPath);
  if (!resolvedPath) return null;

  const indexPath = path.join(resolvedPath, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Frontend index not found at ${indexPath}`);
  }
  return resolvedPath;
}

function readHttpErrorStatus(error: unknown): number {
  if (!error || typeof error !== 'object') return 500;
  const status = 'status' in error ? error.status : undefined;
  return status === 400 || status === 413 ? status : 500;
}

export function recoverPendingReflectionApplicationsAtStartup() {
  return recoverPendingReflectionInvocations();
}

export type StartServerOptions = {
  host?: string;
  port?: number;
  app?: ReturnType<typeof createApp>;
  additionalServers?: Server[];
  closeDatabase?: () => void | Promise<void>;
  stopBackgroundWork?: () => Promise<void>;
};

export function startServer(options: StartServerOptions = {}): Server {
  const host = options.host ?? process.env.APP_HOST ?? '0.0.0.0';
  const serverPort = options.port ?? port;
  const app = options.app ?? createApp();
  const server = app.listen(serverPort, host, () => {
    console.log(`Backend server listening on http://${host}:${serverPort}`);
    console.log(`Mode: ${dbConfig.mode}`);
    console.log(`Database: ${dbConfig.dbPath}`);
  });
  installGracefulShutdown(
    server,
    options.closeDatabase ?? closeDbConnection,
    options.additionalServers ?? [],
    options.stopBackgroundWork,
  );
  return server;
}

export function installGracefulShutdown(
  server: Server,
  closeDatabase: () => void | Promise<void> = closeDbConnection,
  additionalServers: Server[] = [],
  stopBackgroundWork: () => Promise<void> = async () => {},
): () => Promise<void> {
  let shutdownPromise: Promise<void> | null = null;
  const shutdown = () => {
    shutdownPromise ??= (async () => {
      // Stop claiming immediately, while HTTP requests and active publications drain.
      const background = stopBackgroundWork();
      const closing = new Promise<void>((resolve, reject) => {
        closeServers([server, ...additionalServers], (error) => error ? reject(error) : resolve());
      });
      const results = await Promise.allSettled([background, closing]);
      await closeDatabase();
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    })();
    return shutdownPromise;
  };
  const handleSignal = () => {
    void shutdown().catch((error: unknown) => {
      defaultErrorLogger('Graceful shutdown failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', handleSignal);
  process.once('SIGINT', handleSignal);
  server.once('close', () => {
    process.removeListener('SIGTERM', handleSignal);
    process.removeListener('SIGINT', handleSignal);
  });
  return shutdown;
}

function closeServers(servers: Server[], done: (error?: Error) => void): void {
  const listeningServers = servers.filter((server) => server.listening);
  if (listeningServers.length === 0) {
    done();
    return;
  }
  let remaining = listeningServers.length;
  let firstError: Error | undefined;
  for (const server of listeningServers) {
    server.close((error) => {
      firstError ??= error;
      remaining -= 1;
      if (remaining === 0) done(firstError);
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (dbConfig.studyProfile !== 'mandarin') recoverPendingReflectionApplicationsAtStartup();
  const backupSource = startConfiguredBackupSource();
  const serviceMetrics = createServiceMetrics();
  const metricsPort = readMetricsPort(process.env.APP_METRICS_PORT);
  const flightRecorder = metricsPort === null ? null : createRequestFlightRecorder();
  const metricsServer = metricsPort === null
    ? null
    : startMetricsServer({
        metrics: serviceMetrics,
        port: metricsPort,
        readOperationalMetrics: () => readServiceOperationalMetrics(),
        flightRecorder: flightRecorder ?? undefined,
      });
  const usagePulseScheduler = startUsagePulseScheduler();
  installModelInvocationLedger();
  const wordPreparation = startWordPreparationRuntime();
  const sessionDebriefs = startSessionDebriefRuntime();
  const sessionCompletions = createSessionCompletionWorker({ wakeDebriefs: sessionDebriefs.wake,
    reflectionService: createInitialReflectionGenerationService({
      lifecycleLogger: createStdoutReflectionLifecycleLogger(),
      failureArtifactSink: createFileReflectionFailureArtifactSink(dbConfig.dataDir),
      providerDiagnosticSink: createFileReflectionProviderDiagnosticSink(dbConfig.dataDir),
    }), onError: () => console.error('Session completion worker failed') });
  if (dbConfig.studyProfile !== 'mandarin') sessionCompletions.wake();
  const vocabularyProcessing = createVocabularyProcessingWorker({onError: error => console.error(error)});
  const vocabularyPreparation = createVocabularyPracticeWorker({
    demand: listSenseContentReconciliationPracticeDemand,
    proactiveEnabled: () => readHostedServiceControl('proactive_repertoire').enabled,
    onError: error => console.error(error),
  });
  const vocabularyApprovals = getVocabularyApprovalRequests();
  if (dbConfig.studyProfile === 'mandarin') vocabularyApprovals.wake();
  const wakeVocabulary = () => { vocabularyProcessing.wake(); vocabularyPreparation.wake(); sessionDebriefs.wake(); };
  const vocabularyIntake = createVocabularyIntakeWorker({ onError: () => console.error('Vocabulary intake worker failed'),
    onChange: () => { wordPreparation.wake(); wakeVocabulary(); } });
  const wakeVocabularyIntake = () => { vocabularyIntake.wake(); wordPreparation.wake(); wakeVocabulary(); };
  if (dbConfig.studyProfile === 'mandarin') wakeVocabularyIntake();
  startServer({
    app: createApp({ serviceMetrics, requestTiming: { flightRecorder: flightRecorder ?? undefined }, wakeWordPreparation: wordPreparation.wake, canPrepareWords: wordPreparation.canPrepare, wakeSessionDebriefs: sessionDebriefs.wake, wakeSessionCompletions: sessionCompletions.wake, wakeVocabulary, wakeVocabularyIntake }),
    stopBackgroundWork: async () => { vocabularyApprovals.stop(); await Promise.all([wordPreparation.stop(), sessionDebriefs.stop(), sessionCompletions.stop(), vocabularyProcessing.stop(), vocabularyPreparation.stop(), vocabularyIntake.stop()]); },
    additionalServers: [...(metricsServer ? [metricsServer] : []), ...(backupSource ? [backupSource] : [])],
    closeDatabase: () => {
      usagePulseScheduler.stop();
      serviceMetrics.dispose();
      flightRecorder?.stop();
      closeDbConnection();
    },
  });
}
