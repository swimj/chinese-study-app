export type MarkReflectionInboxSeenRequest =
  | { kind: 'proposal'; proposalId: string }
  | { kind: 'explanation'; artifactId: string; itemId: string };
