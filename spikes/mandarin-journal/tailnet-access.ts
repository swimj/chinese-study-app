import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Profile } from './storage.ts';

const run = promisify(execFile);
const runningStatus = z.object({ BackendState: z.literal('Running'), Self: z.object({ DNSName: z.string() }) });
const dnsLabel = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const magicDnsName = new RegExp(`^${dnsLabel}\\.${dnsLabel}\\.ts\\.net$`);

export async function journalRequestOrigins(profile: Profile, port: number): Promise<Map<string, string>> {
  const origins = new Map([
    [`localhost:${port}`, `http://localhost:${port}`],
    [`127.0.0.1:${port}`, `http://127.0.0.1:${port}`],
  ]);
  if (profile !== 'live') return origins;

  try {
    const { stdout } = await run(process.env.JOURNAL_TAILSCALE_BIN || 'tailscale', ['status', '--json', '--peers=false'], {
      env: { ...process.env, TAILSCALE_BE_CLI: '1' },
      encoding: 'utf8',
      timeout: 3000,
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024,
    });
    const { Self } = runningStatus.parse(JSON.parse(stdout));
    const host = Self.DNSName.replace(/\.$/, '').toLowerCase();
    if (!magicDnsName.test(host)) throw new Error('Expected a device MagicDNS name.');
    const origin = `https://${host}`;
    origins.set(host, origin);
    console.log(`Tailscale journal origin enabled · ${origin}`);
  } catch {
    console.warn('Tailscale journal origin unavailable. Using loopback access.');
  }
  return origins;
}
