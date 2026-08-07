import type { JsonSchemaValidationIssue } from '../llm/json-schema-validator.ts';

export type ReflectionDiagnosticPhase =
  | 'provider_transport'
  | 'truncation'
  | 'json_parse'
  | 'structural_schema'
  | 'domain_validation';

export type ReflectionDiagnosticIssue = {
  path: string;
  code: string;
  message: string;
  valueType: string | null;
};

export type ReflectionGenerationDiagnostic = {
  schemaVersion: 'reflection_generation_diagnostic.v1';
  phase: ReflectionDiagnosticPhase;
  issues: ReflectionDiagnosticIssue[];
  rejectedOutput: string | null;
};

export const MAX_REJECTED_OUTPUT_CHARS = 4_000;

export function schemaIssuesToDiagnostics(
  issues: JsonSchemaValidationIssue[],
): ReflectionDiagnosticIssue[] {
  return issues.slice(0, 50).map((issue) => ({ ...issue }));
}

export function textIssuesToDiagnostics(messages: string[]): ReflectionDiagnosticIssue[] {
  return messages.slice(0, 50).map((message) => {
    const separator = message.indexOf(': ');
    return {
      path: separator < 0 ? '$' : message.slice(0, separator),
      code: 'domain_contract',
      message: separator < 0 ? message : message.slice(separator + 2),
      valueType: null,
    };
  });
}

/** Dogfood diagnostics retain output verbatim; only bound its size. */
export function boundRejectedOutput(value: string | null): string | null {
  if (value === null) return null;
  return value.length <= MAX_REJECTED_OUTPUT_CHARS
    ? value
    : `${value.slice(0, MAX_REJECTED_OUTPUT_CHARS)}\n[…truncated…]`;
}
