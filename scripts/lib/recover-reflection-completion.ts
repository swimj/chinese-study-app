import { createHash } from 'node:crypto';
import {
  normalizeSessionReflectionResultV7,
  stripLegacySourceAttemptIdsFromReflectionWire,
  validateSessionReflectionResultV7,
  type SessionReflectionBundleV4,
  type SessionReflectionResultV7Wire,
} from '../../src/domain/reflection.ts';
import { parseStoredSessionReflectionBundle } from '../../src/domain/reflection-evidence.ts';
import {
  SESSION_REFLECTION_RESULT_V7_WIRE_SCHEMA_NAME,
  sessionReflectionResultV7WireSchema,
} from '../../src/domain/reflection-result-schema.ts';
import { validateJsonSchemaIssues } from '../../server/llm/json-schema-validator.ts';
import {
  getReflectionArtifactBySessionAndFlow,
  INITIAL_REFLECTION_FLOW_VERSION,
  materializeReflectionArtifact,
} from '../../server/db/reflections.ts';

export type RecoverReflectionCompletionInput = {
  bundle: unknown;
  result: unknown;
  generatedAt: string;
  provider: string;
  model: string;
  promptVersion: string;
};

export type RecoverReflectionCompletionResult = {
  status: 'created' | 'already_imported';
  artifactId: string;
  sourceSessionId: string;
  proposalCount: number;
  helpInboxCount: number;
};

/**
 * Script-only operator recovery for a provider response captured after a
 * process died between the provider hand-off and artifact materialization.
 * This module is deliberately outside the runtime server tree: the CLI below
 * is the only intended caller. It follows the production V7 normalization and
 * validation path before using the normal immutable artifact/help-inbox writer.
 */
export function recoverReflectionCompletion(
  input: RecoverReflectionCompletionInput,
): RecoverReflectionCompletionResult {
  const bundle = parseStoredSessionReflectionBundle(input.bundle);
  if (bundle.schemaVersion !== 'session_reflection_bundle.v4') {
    throw new Error('Recovery accepts only a session_reflection_bundle.v4 evidence bundle.');
  }
  const wire = stripLegacySourceAttemptIdsFromReflectionWire(input.result);
  const schemaIssues = validateJsonSchemaIssues(wire, sessionReflectionResultV7WireSchema);
  if (schemaIssues.length > 0) {
    throw new Error(
      `Recovery result does not satisfy ${SESSION_REFLECTION_RESULT_V7_WIRE_SCHEMA_NAME}:\n${schemaIssues.join('\n')}`,
    );
  }

  const normalized = normalizeSessionReflectionResultV7(
    wire as SessionReflectionResultV7Wire,
    bundle,
  );
  const contractErrors = validateSessionReflectionResultV7(normalized, bundle);
  if (contractErrors.length > 0) {
    throw new Error(`Recovery result violates the reflection contract:\n${contractErrors.join('\n')}`);
  }

  const existing = getReflectionArtifactBySessionAndFlow(
    bundle.session.sessionId,
    INITIAL_REFLECTION_FLOW_VERSION,
  );
  if (existing !== null) {
    if (!matchesRecoveredPayload(existing, bundle, normalized)) {
      throw new Error(
        'A different reflection artifact already exists for this session and flow; recovery will not replace it.',
      );
    }
    return recoveryResult('already_imported', existing);
  }

  const artifactId = `recovered-reflection-${payloadFingerprint(bundle, normalized).slice(0, 32)}`;
  const materialized = materializeReflectionArtifact({
    artifactId,
    sourceSessionId: bundle.session.sessionId,
    reflectionFlowVersion: INITIAL_REFLECTION_FLOW_VERSION,
    generatedAt: input.generatedAt,
    provider: input.provider,
    model: input.model,
    promptVersion: input.promptVersion,
    evidenceBundle: bundle,
    result: normalized,
  });
  return recoveryResult('created', materialized.artifact);
}

function matchesRecoveredPayload(
  artifact: ReturnType<typeof getReflectionArtifactBySessionAndFlow> extends infer T ? Exclude<T, null> : never,
  bundle: SessionReflectionBundleV4,
  result: ReturnType<typeof normalizeSessionReflectionResultV7>,
): boolean {
  return payloadFingerprint(artifact.evidenceBundle, artifact.result) === payloadFingerprint(bundle, result);
}

function payloadFingerprint(bundle: unknown, result: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify({ bundle, result }))
    .digest('hex');
}

function recoveryResult(
  status: RecoverReflectionCompletionResult['status'],
  artifact: {
    artifactId: string;
    sourceSessionId: string | null;
    proposals: unknown[];
    helpInbox: unknown[];
  },
): RecoverReflectionCompletionResult {
  if (artifact.sourceSessionId === null) throw new Error('Recovered artifact unexpectedly has no source session.');
  return {
    status,
    artifactId: artifact.artifactId,
    sourceSessionId: artifact.sourceSessionId,
    proposalCount: artifact.proposals.length,
    helpInboxCount: artifact.helpInbox.length,
  };
}
