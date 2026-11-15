import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  VocabularyIntakeCard,
  VocabularyIntakeCommand,
  VocabularyIntakeCommandRequest,
  VocabularyIntakeSelection,
  VocabularyIntakeTurn,
  VocabularyIntakeProgress,
} from '../../domain/vocabulary-intake';
import {
  ApiRequestError,
  commandVocabularyIntakeCard,
  fetchOutstandingVocabularyIntakeCards,
  fetchVocabularyIntakeAttention,
  fetchVocabularyIntakeCard,
  fetchVocabularyIntakeHistory,
  streamVocabularyIntakeTurn,
} from '../../services/api';
import { intakeSelectionFitsCard } from './sense-selection';

type CardRecord = { card: VocabularyIntakeCard; readOrder: number };
type CardEdit = {
  status: 'saving' | 'failed' | 'stale';
  request: VocabularyIntakeCommandRequest;
  refreshed?: boolean;
};

type ComposeTurn = VocabularyIntakeTurn & { error: string | null; progress?: VocabularyIntakeProgress };

function mergeTurns(first: VocabularyIntakeTurn[], second: VocabularyIntakeTurn[]): VocabularyIntakeTurn[] {
  const turns = new Map(first.map(turn => [turn.id, turn]));
  for (const turn of second) turns.set(turn.id, turn);
  return [...turns.values()];
}

export function useVocabularyIntake(chatVisible: boolean, outstandingVisible: boolean) {
  const [records, setRecords] = useState<Record<string, CardRecord>>({});
  const [drafts, setDrafts] = useState<Record<string, VocabularyIntakeSelection>>({});
  const [edits, setEdits] = useState<Record<string, CardEdit>>({});
  const [attentionCount, setAttentionCount] = useState(0);
  const [outstandingIds, setOutstandingIds] = useState<string[] | null>(null);
  const [outstandingError, setOutstandingError] = useState(false);
  const [turns, setTurns] = useState<VocabularyIntakeTurn[]>([]);
  const [composeTurn, setComposeTurn] = useState<ComposeTurn | null>(null);
  const [draft, setDraft] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [before, setBefore] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<'initial' | 'earlier' | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [latestRevision, setLatestRevision] = useState(0);
  const [stashRevision, setStashRevision] = useState(0);
  const scroll = useRef({ top: 0, atEnd: true });
  const lifetime = useRef<AbortController | null>(null);
  const activeTurn = useRef(false);
  const turnRequest = useRef<{ clientTurnId: string; text: string } | null>(null);
  const readingLatest = useRef(false);
  const readingEarlier = useRef(false);
  const readingAttention = useRef(false);
  const readingOutstanding = useRef(false);
  const saving = useRef(new Set<string>());
  const readOrder = useRef(0);
  const recordsRef = useRef(records);
  recordsRef.current = records;

  useLayoutEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => {
      controller.abort();
      lifetime.current = null;
      readingLatest.current = false;
      readingEarlier.current = false;
      readingAttention.current = false;
      readingOutstanding.current = false;
    };
  }, []);

  const mergeCards = useCallback((cards: VocabularyIntakeCard[], order: number) => {
    if (!cards.length) return;
    setRecords(current => {
      const next = { ...current };
      for (const card of cards) {
        const existing = current[card.id];
        if (!existing || card.version > existing.card.version
          || (order >= existing.readOrder && card.version === existing.card.version)) {
          next[card.id] = { card, readOrder: order };
        }
      }
      return next;
    });
  }, []);

  const refreshAttention = useCallback(async () => {
    const signal = lifetime.current?.signal;
    if (!signal || readingAttention.current) return;
    readingAttention.current = true;
    try {
      const { count } = await fetchVocabularyIntakeAttention(signal);
      if (!signal.aborted) setAttentionCount(count);
    } catch {
      // Preserve the last acknowledged count until the next poll.
    } finally {
      if (!signal.aborted) readingAttention.current = false;
    }
  }, []);

  const refreshOutstanding = useCallback(async () => {
    const signal = lifetime.current?.signal;
    if (!signal || readingOutstanding.current) return;
    readingOutstanding.current = true;
    const order = ++readOrder.current;
    try {
      const { cards } = await fetchOutstandingVocabularyIntakeCards(signal);
      if (signal.aborted) return;
      mergeCards(cards, order);
      setOutstandingIds(cards.map(card => card.id));
      setOutstandingError(false);
    } catch {
      if (!signal.aborted) setOutstandingError(true);
    } finally {
      if (!signal.aborted) readingOutstanding.current = false;
    }
  }, [mergeCards]);

  const refreshCard = useCallback(async (id: string, signal: AbortSignal) => {
    const order = ++readOrder.current;
    const card = await fetchVocabularyIntakeCard(id, signal);
    if (!signal.aborted) mergeCards([card], order);
    return card;
  }, [mergeCards]);

  const refreshLatest = useCallback(async (initial: boolean) => {
    const signal = lifetime.current?.signal;
    if (!signal || readingLatest.current || activeTurn.current) return;
    readingLatest.current = true;
    const order = ++readOrder.current;
    try {
      const page = await fetchVocabularyIntakeHistory(null, signal);
      if (signal.aborted) return;
      mergeCards(page.cards, order);
      if (!turnRequest.current) setTurns(current => mergeTurns(current, page.turns));
      if (initial) {
        setBefore(page.before);
        setInitialized(true);
        setHistoryError(null);
      }
      const latestIds = new Set(page.cards.map(card => card.id));
      const earlierPreparing = Object.values(recordsRef.current)
        .filter(({ card }) => card.state === 'preparing' && !latestIds.has(card.id));
      await Promise.allSettled(earlierPreparing.map(({ card }) => refreshCard(card.id, signal)));
    } catch {
      if (!signal.aborted && initial) setHistoryError('initial');
    } finally {
      if (!signal.aborted) readingLatest.current = false;
    }
  }, [mergeCards, refreshCard]);

  useEffect(() => {
    const refresh = () => {
      void refreshAttention();
      if (chatVisible) void refreshLatest(!initialized);
      if (outstandingVisible) void refreshOutstanding();
    };
    refresh();
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const timer = window.setInterval(refreshIfVisible, 5000);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [chatVisible, initialized, outstandingVisible, refreshAttention, refreshLatest, refreshOutstanding]);

  async function loadEarlier() {
    const signal = lifetime.current?.signal;
    if (!signal || !before || readingEarlier.current) return;
    readingEarlier.current = true;
    setLoadingEarlier(true);
    setHistoryError(null);
    const order = ++readOrder.current;
    try {
      const page = await fetchVocabularyIntakeHistory(before, signal);
      if (signal.aborted) return;
      setTurns(current => mergeTurns(page.turns, current));
      mergeCards(page.cards, order);
      setBefore(page.before);
    } catch {
      if (!signal.aborted) setHistoryError('earlier');
    } finally {
      if (!signal.aborted) {
        readingEarlier.current = false;
        setLoadingEarlier(false);
      }
    }
  }

  async function send(retry = false) {
    const signal = lifetime.current?.signal;
    const text = draft.trim();
    if (!signal || activeTurn.current || !initialized) return;
    if (!retry && (turnRequest.current || !text)) return;
    const request = retry ? turnRequest.current : { clientTurnId: crypto.randomUUID(), text };
    if (!request) return;
    turnRequest.current = request;
    activeTurn.current = true;
    const pending: ComposeTurn = {
      id: request.clientTurnId, userText: request.text, assistantText: '', cardIds: [], status: 'running', error: null,
    };
    if (!retry) {
      setDraft('');
      setLatestRevision(revision => revision + 1);
    }
    setComposeTurn(pending);
    let turn = pending;
    try {
      await streamVocabularyIntakeTurn(request, event => {
        if (signal.aborted) return;
        if (event.type === 'error') {
          if (event.retryWithNewId === true) turnRequest.current = { ...request, clientTurnId: crypto.randomUUID() };
          throw new Error(event.message);
        }
        if (event.type === 'progress') {
          turn = { ...turn, progress: event.stage };
          setComposeTurn(turn);
        } else if (event.type === 'completion') {
          mergeCards(event.cards, ++readOrder.current);
          if (event.cards.some(card => card.state !== 'proposed' && card.state !== 'already-studying')) {
            setStashRevision(revision => revision + 1);
          }
          turn = { ...turn, assistantText: event.assistantText, progress: undefined, cardIds: event.cards.map(card => card.id) };
          setComposeTurn(turn);
        } else {
          const completed: VocabularyIntakeTurn = {
            id: event.turnId, userText: turn.userText, assistantText: turn.assistantText,
            cardIds: turn.cardIds, status: 'complete',
          };
          setTurns(current => mergeTurns(current, [completed]));
          setComposeTurn(null);
          turnRequest.current = null;
        }
      }, signal);
    } catch {
      if (!signal.aborted) setComposeTurn({ ...turn, status: 'failed', error: 'The reply could not finish. Try again.' });
    } finally {
      if (!signal.aborted) {
        activeTurn.current = false;
        void refreshAttention();
        if (outstandingVisible) void refreshOutstanding();
        if (!turnRequest.current) void refreshLatest(false);
      }
    }
  }

  function stopRetrying() {
    setComposeTurn(null);
    turnRequest.current = null;
    void refreshLatest(false);
  }

  function updateDraft(id: string, selection?: VocabularyIntakeSelection) {
    setDrafts(current => {
      const next = { ...current };
      if (selection) next[id] = selection;
      else delete next[id];
      return next;
    });
  }

  function updateEdit(id: string, edit?: CardEdit) {
    setEdits(current => {
      const next = { ...current };
      if (edit) next[id] = edit;
      else delete next[id];
      return next;
    });
  }

  async function reloadCard(id: string, edit: CardEdit, keepChoices: boolean) {
    const signal = lifetime.current?.signal;
    if (!signal || saving.current.has(id)) return;
    saving.current.add(id);
    updateEdit(id, { ...edit, status: 'saving', refreshed: false });
    try {
      await refreshCard(id, signal);
      if (signal.aborted) return;
      if (keepChoices) {
        updateEdit(id, { ...edit, status: 'stale', refreshed: true });
      } else {
        updateEdit(id);
        updateDraft(id);
      }
      void refreshLatest(false);
      if (outstandingVisible) void refreshOutstanding();
    } catch {
      if (!signal.aborted) updateEdit(id, { ...edit, status: 'stale', refreshed: false });
    } finally {
      saving.current.delete(id);
    }
  }

  async function runCommand(card: VocabularyIntakeCard, request: VocabularyIntakeCommandRequest) {
    const signal = lifetime.current?.signal;
    if (!signal || saving.current.has(card.id)) return;
    saving.current.add(card.id);
    const edit: CardEdit = { status: 'saving', request };
    updateEdit(card.id, edit);
    let stale = false;
    try {
      const updated = await commandVocabularyIntakeCard(card.id, request, signal);
      if (signal.aborted) return;
      mergeCards([updated], ++readOrder.current);
      setStashRevision(revision => revision + 1);
      updateDraft(card.id);
      updateEdit(card.id);
      void refreshAttention();
      if (outstandingVisible) void refreshOutstanding();
    } catch (error) {
      if (signal.aborted) return;
      stale = error instanceof ApiRequestError && error.status === 409;
      if (!stale) updateEdit(card.id, { ...edit, status: 'failed' });
    } finally {
      saving.current.delete(card.id);
    }
    if (stale) await reloadCard(card.id, edit, true);
  }

  function command(card: VocabularyIntakeCard, next: VocabularyIntakeCommand) {
    return runCommand(card, {
      clientActionId: crypto.randomUUID(),
      expectedVersion: card.version,
      versions: card.versions,
      command: next,
    });
  }

  function select(card: VocabularyIntakeCard, selection: VocabularyIntakeSelection) {
    if (!intakeSelectionFitsCard(card, selection)) return;
    if (card.state === 'proposed') updateDraft(card.id, selection);
    else void command(card, { type: 'set_senses', selection });
  }

  function discardEdit(id: string) {
    updateDraft(id);
    updateEdit(id);
  }

  return {
    records, drafts, edits, attentionCount, outstandingIds, outstandingError,
    turns, composeTurn, draft, setDraft, initialized, before, historyError, loadingEarlier, latestRevision, stashRevision, scroll,
    retryHistory: () => refreshLatest(true), refreshOutstanding, loadEarlier, send, stopRetrying,
    select, command, discardEdit,
    retryCommand: (card: VocabularyIntakeCard, edit: CardEdit) => runCommand(card, edit.request),
    reloadCard,
  };
}

export type VocabularyIntakeController = ReturnType<typeof useVocabularyIntake>;
