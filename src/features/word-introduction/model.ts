import { materializeTeachingPackage, type TeachingPackageSnapshot } from '../../domain/word-content';
import type { SavedTeachingPackage, SavedWordContent, WordIntroductionResponse } from '../../domain/word-content/application';

export type SelectedIntroduction = {
  package: SavedTeachingPackage;
  content: SavedWordContent;
  snapshot: TeachingPackageSnapshot;
};

/** Selection is supplied by the server's published eligible library, never by client sorting. */
export function selectedIntroduction(library: WordIntroductionResponse): SelectedIntroduction | null {
  if (library.selectedPackageId === null) return null;
  const savedPackage = library.packages.find(({ teaching }) => teaching.id === library.selectedPackageId);
  if (!savedPackage) throw new Error('The selected introduction is missing from the published library.');
  const savedContent = library.contents.find(({ content }) => content.id === savedPackage.teaching.wordContentId);
  if (!savedContent) throw new Error('The introduction source is missing from the published library.');
  const snapshot = materializeTeachingPackage(savedPackage.teaching, [savedContent.content]);
  if (snapshot.wordId !== library.wordId) throw new Error('The introduction belongs to a different word.');
  return { package: savedPackage, content: savedContent, snapshot };
}

export function assertIntroductionWord(wordId: string, library: WordIntroductionResponse): WordIntroductionResponse {
  if (library.wordId !== wordId) throw new Error('The server returned an introduction for a different word.');
  return library;
}
