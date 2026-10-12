import type { ImprovementContent } from '../domain/content-improvement';
import type { ContentExercise } from '../domain/word-content';
import { parseTeachingPackage, parseWordContent, materializeTeachingPackage } from '../domain/word-content';

function packageFields(proposed: ImprovementContent): Record<string, unknown> & { rehearsals: ContentExercise[] } {
  const pkg = proposed.package;
  if (!pkg || typeof pkg !== 'object' || !('rehearsals' in pkg) || !Array.isArray(pkg.rehearsals)) throw new Error('Expected package rehearsals.');
  return pkg as Record<string, unknown> & { rehearsals: ContentExercise[] };
}

/** Package proposals keep their full canonical shape; focus changes only the selected rehearsal. */
export function rehearsalFocus(proposed: ImprovementContent, sourceId: string) {
  const pkg = packageFields(proposed);
  const id = sourceId.slice(sourceId.lastIndexOf('/') + 1);
  const rehearsal = pkg.rehearsals.find(item => item.id === id);
  if (!rehearsal) throw new Error('Selected rehearsal is missing from its package.');
  return rehearsal;
}

export function replaceFocusedRehearsal(proposed: ImprovementContent, sourceId: string, value: unknown): ImprovementContent {
  const original = rehearsalFocus(proposed, sourceId);
  const pkg = packageFields(proposed);
  // The canonical parser checks edits on save/validation; retain every other authored field here.
  return { ...proposed, package: { ...pkg, rehearsals: pkg.rehearsals.map(item => item.id === original.id ? value : item) } };
}

export function focusedRehearsalPreview(value: unknown, sourceId: string): unknown {
  if (!value || typeof value !== 'object') throw new Error('Expected a package preview.');
  const record = value as Record<string, unknown>;
  const content = parseWordContent(record.content);
  const snapshot = record.snapshot ?? materializeTeachingPackage(parseTeachingPackage(record.package), [content]);
  if (!snapshot || typeof snapshot !== 'object' || !('rehearsals' in snapshot) || !Array.isArray(snapshot.rehearsals)) throw new Error('Expected rehearsal snapshots.');
  const id = sourceId.slice(sourceId.lastIndexOf('/') + 1);
  const exercise = snapshot.rehearsals.find(item => item.exerciseId === id);
  if (!exercise) throw new Error('Selected rehearsal preview is missing.');
  return exercise;
}
