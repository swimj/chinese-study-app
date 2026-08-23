import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from './connection.ts';
import { getDb } from './connection.ts';

const learnerContext = new AsyncLocalStorage<string>();

export function runWithLearnerId<T>(learnerId: string, operation: () => T): T {
  const normalizedLearnerId = learnerId.trim();
  if (normalizedLearnerId.length === 0) {
    throw new Error('Expected non-empty learner id');
  }
  return learnerContext.run(normalizedLearnerId, operation);
}

export function requireLearnerId(): string {
  const learnerId = learnerContext.getStore()
    ?? (config.authMode === 'trusted_local' ? config.learnerId : '');
  if (learnerId.trim().length === 0) {
    throw new Error('Learner context is required');
  }
  return learnerId;
}

export function installLearnerContextSqlFunction(): void {
  getDb().function('current_learner_id', { deterministic: false }, requireLearnerId);
}
