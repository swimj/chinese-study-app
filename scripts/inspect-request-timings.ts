import { readStrictArguments } from './lib/hosted-runtime.ts';
import { readMetricsPort, requestTimingsPath } from '../server/observability.ts';

const args = readStrictArguments(['port', 'limit', 'route', 'min-local-ms', 'since']);
const port = readMetricsPort(args.get('port') ?? process.env.APP_METRICS_PORT);
if (port === null) throw new Error('Set --port=<metrics port> or APP_METRICS_PORT; the recorder runs only with the metrics listener.');

const query = new URLSearchParams({ limit: args.get('limit') ?? '20' });
const route = args.get('route');
if (route) query.set('route', route);
const minLocalMs = args.get('min-local-ms');
if (minLocalMs) query.set('minLocalMs', minLocalMs);
const since = args.get('since');
if (since) query.set('since', since);

const response = await fetch(`http://127.0.0.1:${port}${requestTimingsPath}?${query}`);
const body = await response.text();
if (!response.ok) throw new Error(`Request timing read failed with HTTP ${response.status}: ${body}`);
console.log(JSON.stringify({ status: 'ok', ...JSON.parse(body) as object }, null, 2));
