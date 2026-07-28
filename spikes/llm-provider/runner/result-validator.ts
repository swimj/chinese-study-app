import {
  validateSessionReflectionResult,
} from '../../../src/domain/reflection.js';
import type {
  SessionReflectionBundleV1,
  SessionReflectionResultV4,
} from '../contracts.js';

export function validateResultAgainstBundle(
  result: SessionReflectionResultV4,
  bundle: SessionReflectionBundleV1,
): string[] {
  return validateSessionReflectionResult(result, bundle);
}
