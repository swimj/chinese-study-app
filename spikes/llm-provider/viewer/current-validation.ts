import { createHash } from 'node:crypto';
import type { SessionReflectionResultV2 } from '../contracts.js';
import { validateResultAgainstBundle } from '../runner/result-validator.js';
import {
  SESSION_REFLECTION_RESULT_SCHEMA_NAME,
  sessionReflectionResultSchema,
} from '../runner/result-schema.js';
import { validateJsonSchema } from '../runner/schema-validator.js';
import type { ReflectionRunArtifactV0, ReflectionRunStatus } from '../runner/types.js';

export type CurrentRunValidation = {
  contractName: string;
  outputSchemaSha256: string;
  status: ReflectionRunStatus;
  validationErrors: string[];
};

const currentOutputSchemaSha256 = createHash('sha256')
  .update(JSON.stringify(sessionReflectionResultSchema))
  .digest('hex');

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function validateRunArtifactAgainstCurrentContract(
  artifact: ReflectionRunArtifactV0,
): CurrentRunValidation {
  const base = {
    contractName: SESSION_REFLECTION_RESULT_SCHEMA_NAME,
    outputSchemaSha256: currentOutputSchemaSha256,
  };
  const rawText = artifact.response.rawText;
  if (rawText === null) {
    return {
      ...base,
      status: 'provider_error',
      validationErrors: [artifact.response.providerError ?? 'Provider did not return response text.'],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    return {
      ...base,
      status: 'invalid_json',
      validationErrors: [`Response is not valid JSON: ${errorMessage(error)}`],
    };
  }

  const schemaErrors = validateJsonSchema(parsed, sessionReflectionResultSchema);
  if (schemaErrors.length > 0) {
    return { ...base, status: 'schema_invalid', validationErrors: schemaErrors };
  }

  const contractErrors = validateResultAgainstBundle(
    parsed as SessionReflectionResultV2,
    artifact.inputBundle,
  );
  return {
    ...base,
    status: contractErrors.length === 0 ? 'success' : 'contract_invalid',
    validationErrors: contractErrors,
  };
}
