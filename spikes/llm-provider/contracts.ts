import type {
  ReflectionDiagnosisTagV1,
  ReflectionOperation,
  ReflectionProposalV1,
  SessionReflectionBundleV1,
  SessionReflectionResultV4,
} from '../../src/domain/reflection.js';

export type {
  AcceptProductionAlternateOperationV1,
  ContrastSelectionReflectionItemV1,
  CreateContrastClusterOperationV1,
  ProductionMistakeReflectionItemV1,
  ReflectionClarifyingQuestionV1,
  ReflectionCueSnapshotV0,
  ReflectionDiagnosisTagV1,
  ReflectionExistingContentV0,
  ReflectionInputItemV1,
  ReflectionItemResultV1,
  ReflectionOperation,
  ReflectionProposalV1,
  ReflectionUnhandledNeedV1,
  ReflectionWordSnapshotV1,
  RepairProductionCueOperationV1,
  SessionNoteReflectionItemV1,
  SessionReflectionBundleV1,
  SessionReflectionResultV4,
  StudyProfileV0,
  SuppressDefinitionProductionOperationV1,
} from '../../src/domain/reflection.js';

// Compatibility names retained for the provider-spike fixtures.
export type ReflectionDiagnosisTagV0 = ReflectionDiagnosisTagV1;
export type ReflectionOperationV1 = ReflectionOperation;
export type ReflectionHandleOperationV0 = ReflectionOperation;
export type ReflectionHandleKindV0 = ReflectionOperation['kind'];
export type ReflectionHandleProposalV0 = ReflectionProposalV1;
export type ReflectionItemResultV0 = import('../../src/domain/reflection.js').ReflectionItemResultV1;

export type FixtureReadinessV0 = 'ready' | 'provisional' | 'blocked';

export type ProposalProfileV0 = {
  requiredKinds: ReflectionHandleKindV0[];
  allowedKinds: ReflectionHandleKindV0[];
  description: string;
};

export type ReflectionProviderFixtureV0 = {
  fixtureVersion: 'reflection_provider_fixture.v0';
  fixtureId: string;
  source:
    | {
        kind: 'workflow_appendix';
        document: 'notes/active/2026-07-06-session-reflection-workflow.md';
        appendixExample: number;
        title: string;
      }
    | {
        kind: 'user_supplied_stress_case';
        suppliedAt: string;
        title: string;
      };
  readiness: FixtureReadinessV0;
  readinessNotes: string[];
  inputBundle: SessionReflectionBundleV1;
  referenceResult: SessionReflectionResultV4 | null;
  evaluation: {
    mode?: 'scored' | 'exploratory';
    requiredDiagnosisTags: ReflectionDiagnosisTagV0[];
    forbiddenDiagnosisTags: ReflectionDiagnosisTagV0[];
    acceptableProposalProfiles: ProposalProfileV0[];
    questionPolicy: 'none_expected' | 'allowed' | 'required';
    unhandledNeedPolicy?: 'none_expected' | 'allowed' | 'required';
    requiredJudgments: string[];
    forbiddenJudgments: string[];
  };
};
