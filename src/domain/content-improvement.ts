import type { ContentQualityKind } from './content-quality';

/** Authored fields are interpreted and strictly validated by the content-kind adapter. */
export type ImprovementContent = Record<string, unknown>;
export type ImprovementSource = {
  kind: ContentQualityKind;
  sourceId: string;
  title: string;
  scope: 'shared' | 'private';
  fingerprint: string;
  provenance?: { source: string; model: string | null };
  editable: ImprovementContent;
  preview: unknown;
  impact: string[];
};
export type ImprovementValidation = {
  errors: string[];
  preview: unknown;
  answerSpaceChanged: boolean;
};
export type ImprovementOutcome = {
  replacementSourceId: string | null;
  summary: string;
  appliedSource?: ImprovementSource;
};
export type ImprovementDraftFields = {
  diagnosis: string;
  rationale: string;
  generalLesson: string;
  proposalOrigin: 'operator' | 'agent';
  proposed: ImprovementContent;
};
export type ImprovementCase = ImprovementDraftFields & {
  id: string;
  revision: number;
  status: 'draft' | 'applied' | 'closed';
  source: ImprovementSource;
  flagged: { contentKey: string; content: unknown; provenance: unknown } | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  outcome: ImprovementOutcome | null;
  resolution: string | null;
};
export type ImprovementCheck = ImprovementValidation & {
  revision: number;
  sourceChanged: boolean;
  currentSource: ImprovementSource;
};
export class ImprovementInputError extends Error {}
export class ImprovementConflictError extends Error {}
export class ImprovementAccessError extends Error {}

export function improvementObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ImprovementInputError('Expected an object.');
  return value as Record<string, unknown>;
}
export function improvementText(value: unknown, label: string, required = false): string {
  if (typeof value !== 'string' || value.length > 20000 || (required && !value.trim())) {
    throw new ImprovementInputError(`${label} must be ${required ? 'nonempty ' : ''}text (at most 20,000 characters).`);
  }
  return value;
}
export function parseImprovementDraft(value: unknown): ImprovementDraftFields {
  const input = improvementObject(value);
  const keys = ['diagnosis', 'rationale', 'generalLesson', 'proposalOrigin', 'proposed', 'expectedRevision'];
  if (Object.keys(input).some(key => !keys.includes(key))) throw new ImprovementInputError('Unexpected draft field.');
  if (input.proposalOrigin !== 'agent' && input.proposalOrigin !== 'operator') throw new ImprovementInputError('Expected proposal origin: agent or operator.');
  const proposed = improvementObject(input.proposed);
  if (JSON.stringify(proposed).length > 200000) throw new ImprovementInputError('Proposed content is too large.');
  return {
    diagnosis: improvementText(input.diagnosis, 'Diagnosis'), rationale: improvementText(input.rationale, 'Rationale'),
    generalLesson: improvementText(input.generalLesson, 'Possible general lesson'), proposalOrigin: input.proposalOrigin, proposed,
  };
}
