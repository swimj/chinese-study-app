import type { ModelInvocationRow } from '../../src/domain/model-invocations.ts';
import { finishModelInvocation, invalidateModelInvocation, recordModelInvocationSpend, startModelInvocation,
  finishServiceModelInvocation, invalidateServiceModelInvocation, recordServiceModelInvocationSpend, startServiceModelInvocation,
  recordModelInvocationResponseSnapshot, recordServiceModelInvocationResponseSnapshot, type ModelInvocationStart } from '../db/model-invocations.ts';
import { priceInvocationUsage } from './invocation-pricing.ts';
import type { JsonValue } from './types.ts';

type Invocation = ModelInvocationStart;
let enabled = false;

/** Enable for the application; standalone provider experiments stay independent of its database. */
export function installModelInvocationLedger(): void { enabled = true; }

export function beginInvocation(input: Invocation): string | null {
  return enabled ? startModelInvocation(input) : null;
}

export function beginServiceInvocation(input: Invocation & { serviceId: string; requestingLearnerId?: string }): string | null {
  return enabled ? startServiceModelInvocation(input) : null;
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Read accounting independently of content parsing, including refusals and malformed choices. */
export function recordInvocationResponse(id: string | null, input: Invocation, response: JsonValue, serviceId?: string): void {
  if (id === null) return;
  if (serviceId === undefined) recordModelInvocationResponseSnapshot(id, response);
  else recordServiceModelInvocationResponseSnapshot(id, serviceId, response);
  const recordSpend = (input: Parameters<typeof recordModelInvocationSpend>[1]) => serviceId === undefined
    ? recordModelInvocationSpend(id, input) : recordServiceModelInvocationSpend(id, serviceId, input);
  recordSpend(priceInvocationUsage({ provider: input.provider, model: input.model,
    usage: object(response).usage, reportedAt: new Date().toISOString() }));
}
export function concludeInvocation(id: string | null, status: Exclude<ModelInvocationRow['status'], 'running'>, latencyMs: number): void {
  if (id !== null) finishModelInvocation(id, status, latencyMs);
}

export function invalidateInvocation(id: string | null | undefined): void {
  if (id != null) invalidateModelInvocation(id);
}

export function recordServiceInvocationResponse(id: string | null, serviceId: string, input: Invocation, response: JsonValue): void {
  recordInvocationResponse(id, input, response, serviceId);
}
export function concludeServiceInvocation(id: string | null, serviceId: string, status: Exclude<ModelInvocationRow['status'], 'running'>, latencyMs: number): void {
  if (id !== null) finishServiceModelInvocation(id, serviceId, status, latencyMs);
}
export function invalidateServiceInvocation(id: string | null | undefined, serviceId: string): void {
  if (id != null) invalidateServiceModelInvocation(id, serviceId);
}
