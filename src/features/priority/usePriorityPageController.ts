import { useRef, useState } from 'react';
import type { AppPageKey } from '../../components/AppChrome';
import {
  acceptIntakeTriageAssessment,
  addUnstudiedPriorityByHanzi,
  dismissIntakeTriageAssessment,
  dismissWordFromStudy,
  fetchTopUnstudiedPriorityWords,
  fetchUnstudiedPriorityWords,
  runIntakeTriageAdvisor,
  updateWordUserPriority,
} from '../../services/api';
import { studyProfile } from '../../study-profile';
import type { IntakeTriagePriorityWord, IntakeTriageRunReceipt, PriorityWord } from '../../types';
import { applyPriorityPatch, sortPriorityWords, sortStashManageWords } from './priority-page-model';

export type PriorityPageControllerOptions = {
  currentPage: AppPageKey;
  setCurrentPage: (page: AppPageKey) => void;
  setError: (message: string | null) => void;
};

export type PriorityPageController = {
  isLoading: boolean;
  rows: PriorityWord[];
  triageRows: IntakeTriagePriorityWord[];
  analysisCandidateCount: number;
  advisorGenerating: boolean;
  advisorRunReceipt: IntakeTriageRunReceipt | null;
  advisorUpdatingAssessmentId: string | null;
  searchHanzi: string;
  requireAddedMatches: boolean;
  searchNotice: string | null;
  searchSubmitting: boolean;
  highlightedWordIds: string[];
  updatingWordId: string | null;
  bulkDismissSubmitting: boolean;
  priorityBatchSubmitting: boolean;
  setSearchHanzi: (value: string) => void;
  setRequireAddedMatches: (value: boolean) => void;
  clearHighlights: () => void;
  openPage: () => Promise<void>;
  submitSearch: () => Promise<void>;
  moveToTop: (wordId: string) => Promise<void>;
  bumpAgain: (wordId: string) => Promise<void>;
  requireForNextSession: (wordIds: string[], requiredForNextSession: boolean) => Promise<void>;
  moveSelectedToTop: (wordIds: string[]) => Promise<void>;
  moveSelectedToStash: (wordIds: string[]) => Promise<void>;
  bumpSelectedAgain: (wordIds: string[]) => Promise<void>;
  removeSelected: (wordIds: string[]) => Promise<void>;
  remove: (wordId: string) => Promise<void>;
  dismissFromTriage: (wordId: string) => Promise<void>;
  bulkDismissFromTriage: (wordIds: string[]) => Promise<void>;
  runAdvisor: () => Promise<void>;
  acceptAdvisorAssessment: (assessmentId: string) => Promise<void>;
  dismissAdvisorAssessment: (assessmentId: string) => Promise<void>;
};

export function usePriorityPageController({
  currentPage,
  setCurrentPage,
  setError,
}: PriorityPageControllerOptions): PriorityPageController {
  const [isLoading, setIsLoading] = useState(false);
  const [rows, setRows] = useState<PriorityWord[]>([]);
  const [triageRows, setTriageRows] = useState<IntakeTriagePriorityWord[]>([]);
  const [analysisCandidateCount, setAnalysisCandidateCount] = useState(0);
  const [advisorGenerating, setAdvisorGenerating] = useState(false);
  const [advisorRunReceipt, setAdvisorRunReceipt] = useState<IntakeTriageRunReceipt | null>(null);
  const [advisorUpdatingAssessmentId, setAdvisorUpdatingAssessmentId] = useState<string | null>(null);
  const [searchHanzi, setSearchHanzi] = useState('');
  const [requireAddedMatches, setRequireAddedMatches] = useState(false);
  const [searchSubmitting, setSearchSubmitting] = useState(false);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [highlightedWordIds, setHighlightedWordIds] = useState<string[]>([]);
  const [updatingWordId, setUpdatingWordId] = useState<string | null>(null);
  const [bulkDismissSubmitting, setBulkDismissSubmitting] = useState(false);
  const [priorityBatchSubmitting, setPriorityBatchSubmitting] = useState(false);
  const rowsRef = useRef<PriorityWord[]>([]);
  const batchSubmittingRef = useRef(false);
  const searchSubmittingRef = useRef(false);
  rowsRef.current = rows;

  async function openPage(): Promise<void> {
    if (currentPage === 'priority') {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [priorityWordsResponse, triageWordsResponse] = await Promise.all([
        fetchUnstudiedPriorityWords(),
        fetchTopUnstudiedPriorityWords(50),
      ]);
      setRows(sortStashManageWords(priorityWordsResponse.words));
      setTriageRows(sortPriorityWords(triageWordsResponse.words));
      setAnalysisCandidateCount(triageWordsResponse.analysisCandidateCount);
      setSearchNotice(null);
      setHighlightedWordIds([]);
      setCurrentPage('priority');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshTriage(): Promise<void> {
    const response = await fetchTopUnstudiedPriorityWords(50);
    setTriageRows(sortPriorityWords(response.words));
    setAnalysisCandidateCount(response.analysisCandidateCount);
  }

  async function updateWordPriority(
    wordId: string,
    patch: {
      bumpDelta?: number;
      forceTop?: boolean;
      reset?: boolean;
      requiredForNextSession?: boolean;
    },
  ): Promise<void> {
    setUpdatingWordId(wordId);
    setError(null);

    try {
      const updatedWord = await updateWordUserPriority(wordId, patch);
      setRows((current) => {
        if (patch.reset) {
          return current.filter((entry) => entry.word.id !== updatedWord.word.id);
        }

        return mergePriorityWord(current, updatedWord);
      });
      if (patch.bumpDelta || patch.forceTop || patch.requiredForNextSession) {
        setTriageRows((current) => current.filter((entry) => entry.word.id !== wordId));
      }
      setSearchNotice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setUpdatingWordId(null);
    }
  }

  async function submitSearch(): Promise<void> {
    if (searchSubmittingRef.current) {
      return;
    }

    const normalizedHanzi = searchHanzi.trim();
    if (normalizedHanzi.length === 0) {
      setSearchNotice(`${studyProfile.labels.targetSearchPlaceholder}.`);
      return;
    }

    searchSubmittingRef.current = true;
    setSearchSubmitting(true);
    setSearchHanzi('');
    setError(null);

    try {
      const response = await addUnstudiedPriorityByHanzi(normalizedHanzi, requireAddedMatches);
      setRows((current) => {
        const byId = new Map(current.map((entry) => [entry.word.id, entry]));
        for (const word of response.words) {
          byId.set(word.word.id, word);
        }

        return sortStashManageWords([...byId.values()]);
      });
      setHighlightedWordIds(response.words.map((word) => word.word.id));
      setSearchNotice(`Added ${response.addedCount} matching word${response.addedCount === 1 ? '' : 's'} for "${normalizedHanzi}".`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setSearchNotice(message);
      setHighlightedWordIds([]);
      setSearchHanzi((current) => (current.length === 0 ? normalizedHanzi : current));
    } finally {
      searchSubmittingRef.current = false;
      setSearchSubmitting(false);
    }
  }

  async function dismissFromTriage(wordId: string): Promise<void> {
    setUpdatingWordId(wordId);
    setError(null);

    try {
      const row = triageRows.find((entry) => entry.word.id === wordId);
      const recommendation = row?.intakeTriage;
      if (recommendation?.kind === 'recommendation' && recommendation.judgment === 'defer_active_study') {
        await acceptIntakeTriageAssessment(recommendation.assessmentId);
      } else {
        await dismissWordFromStudy(wordId);
      }
      setRows((current) => current.filter((entry) => entry.word.id !== wordId));
      await refreshTriage();
      setSearchNotice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setUpdatingWordId(null);
    }
  }

  async function bulkDismissFromTriage(wordIds: string[]): Promise<void> {
    const uniqueWordIds = [...new Set(wordIds)];
    if (uniqueWordIds.length === 0) {
      return;
    }

    setBulkDismissSubmitting(true);
    setError(null);

    try {
      await Promise.all(uniqueWordIds.map((wordId) => {
        const recommendation = triageRows.find((entry) => entry.word.id === wordId)?.intakeTriage;
        return recommendation?.kind === 'recommendation' && recommendation.judgment === 'defer_active_study'
          ? acceptIntakeTriageAssessment(recommendation.assessmentId)
          : dismissWordFromStudy(wordId);
      }));
      const dismissedIds = new Set(uniqueWordIds);
      setRows((current) => current.filter((entry) => !dismissedIds.has(entry.word.id)));
      await refreshTriage();
      setSearchNotice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBulkDismissSubmitting(false);
    }
  }

  async function runAdvisor(): Promise<void> {
    setAdvisorGenerating(true);
    setAdvisorRunReceipt(null);
    setError(null);
    try {
      const receipt = await runIntakeTriageAdvisor();
      setAdvisorRunReceipt(receipt);
      await refreshTriage();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setAdvisorGenerating(false);
    }
  }

  async function updateAdvisorAssessment(
    assessmentId: string,
    action: (id: string) => Promise<void>,
  ): Promise<void> {
    setAdvisorUpdatingAssessmentId(assessmentId);
    setError(null);
    try {
      await action(assessmentId);
      await refreshTriage();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setAdvisorUpdatingAssessmentId(null);
    }
  }

  async function batchUpdateWordPriority(
    wordIds: string[],
    patch: {
      bumpDelta?: number;
      forceTop?: boolean;
      reset?: boolean;
      requiredForNextSession?: boolean;
    },
  ): Promise<void> {
    const uniqueWordIds = [...new Set(wordIds)];
    if (uniqueWordIds.length === 0 || batchSubmittingRef.current) {
      return;
    }

    batchSubmittingRef.current = true;
    setPriorityBatchSubmitting(true);
    setError(null);
    const snapshot = rowsRef.current;
    const overlayUpdatedAt = new Date().toISOString();
    setRows((current) => {
      if (patch.reset) {
        return current.filter((entry) => !uniqueWordIds.includes(entry.word.id));
      }

      return sortStashManageWords(current.map((entry) => (
        uniqueWordIds.includes(entry.word.id)
          ? applyPriorityPatch(entry, patch, overlayUpdatedAt)
          : entry
      )));
    });

    try {
      const updatedWords = await Promise.all(uniqueWordIds.map((wordId) => updateWordUserPriority(wordId, patch)));
      const updatedById = new Map(updatedWords.map((word) => [word.word.id, word]));

      setRows((current) => {
        if (patch.reset) {
          return current.filter((entry) => !updatedById.has(entry.word.id));
        }

        return sortStashManageWords(current.map((entry) => updatedById.get(entry.word.id) ?? entry));
      });
      if (patch.bumpDelta || patch.forceTop || patch.requiredForNextSession !== undefined) {
        setTriageRows((current) => current.filter((entry) => !updatedById.has(entry.word.id)));
      }
      setSearchNotice(null);
    } catch (err) {
      setRows(snapshot);
      setError(err instanceof Error ? err.message : 'Unknown error');
      throw err;
    } finally {
      batchSubmittingRef.current = false;
      setPriorityBatchSubmitting(false);
    }
  }

  return {
    isLoading,
    rows,
    triageRows,
    analysisCandidateCount,
    advisorGenerating,
    advisorRunReceipt,
    advisorUpdatingAssessmentId,
    searchHanzi,
    requireAddedMatches,
    searchNotice,
    searchSubmitting,
    highlightedWordIds,
    updatingWordId,
    bulkDismissSubmitting,
    priorityBatchSubmitting,
    setSearchHanzi: (value: string) => setSearchHanzi(value),
    setRequireAddedMatches,
    clearHighlights: () => setHighlightedWordIds([]),
    openPage,
    submitSearch,
    moveToTop: (wordId: string) => updateWordPriority(wordId, { forceTop: true }),
    bumpAgain: (wordId: string) => updateWordPriority(wordId, { bumpDelta: 1 }),
    requireForNextSession: (wordIds: string[], requiredForNextSession: boolean) =>
      batchUpdateWordPriority(wordIds, { requiredForNextSession }),
    moveSelectedToTop: (wordIds: string[]) => batchUpdateWordPriority(wordIds, { forceTop: true }),
    moveSelectedToStash: (wordIds: string[]) => batchUpdateWordPriority(wordIds, { forceTop: false, bumpDelta: 1 }),
    bumpSelectedAgain: (wordIds: string[]) => batchUpdateWordPriority(wordIds, { bumpDelta: 1 }),
    removeSelected: (wordIds: string[]) => batchUpdateWordPriority(wordIds, { reset: true }),
    remove: (wordId: string) => updateWordPriority(wordId, { reset: true }),
    dismissFromTriage,
    bulkDismissFromTriage,
    runAdvisor,
    acceptAdvisorAssessment: (assessmentId) =>
      updateAdvisorAssessment(assessmentId, acceptIntakeTriageAssessment),
    dismissAdvisorAssessment: (assessmentId) =>
      updateAdvisorAssessment(assessmentId, dismissIntakeTriageAssessment),
  };
}

function mergePriorityWord(rows: PriorityWord[], updatedWord: PriorityWord): PriorityWord[] {
  if (!rows.some((entry) => entry.word.id === updatedWord.word.id)) {
    throw new Error(`Invariant violated: updated priority word "${updatedWord.word.id}" is missing from the current rows.`);
  }

  return sortStashManageWords(rows.map((entry) => (entry.word.id === updatedWord.word.id ? updatedWord : entry)));
}
