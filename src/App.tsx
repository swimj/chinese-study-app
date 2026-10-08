import { useWhatsNewCatalog } from './features/attention/useWhatsNewCatalog';
import { useEffect, useState } from 'react';
import {
  DEFAULT_CHARACTER_PRESENTATION,
  type CharacterPresentation,
  type SentenceCharacterPresentation,
} from './domain/card-characters';
import type { BackendStatus } from './services/api';
import {
  clearReflectionQuality,
  fetchReflectionArtifactDetail,
  fetchReflectionArtifacts,
  fetchReflectionGenerationRuns,
  fetchReflectionQualityStats,
  fetchStatus,
  nudgeDiet,
  reviewReflectionProposal,
  retryReflectionGenerationRun,
  generateDeferredReflectionSecondOpinion,
  updateDailyNewWordLimit,
  updateDebriefInterests,
  updateUnstudiedAdmissionSource,
  updateCharacterPresentation,
  updateSentenceCharacterPresentation,
  updateStudyNewWordsFirst,
  upsertReflectionQuality,
  withdrawReflectionAuthorization,
  fetchReflectionHelpInbox,
  markReflectionHelpInboxDone,
  deferReflectionHelpInboxItem,
  authorizeManualReflectionOperation,
  flushPendingClientTransportIncidents,
} from './services/api';
import { AppChrome, NestedNav, type AppPageKey } from './components/AppChrome';
import { AboutPage, type AboutView } from './pages/AboutPage';
import { MyWordsPage } from './pages/MyWordsPage';
import { useMyWordsController } from './features/words/useMyWordsController';
import { PersonalNotesEditorOverlay } from './features/session/PersonalNotesEditorOverlay';
import { useStudySession } from './features/session/useStudySession';
import { sessionHidesAppChrome } from './features/session/session-finalization';
import { usePriorityPageController } from './features/priority/usePriorityPageController';
import { HomePage } from './pages/HomePage';
import { PriorityPage } from './pages/PriorityPage';
import { ReflectionsPage } from './pages/ReflectionsPage';
import { useReflectionPageController } from './features/reflection/useReflectionPageController';
import { useContentDiagnosticsController } from './features/content/useContentDiagnosticsController';
import { ContentDiagnosticsPage } from './pages/ContentDiagnosticsPage';
import { OperatorUsagePulsePage } from './pages/OperatorUsagePulsePage';
import { useAttentionBadges } from './features/attention/useAttentionBadges';

const OPERATOR_USAGE_HASH = '#operator-usage';

function readInitialPage(): AppPageKey {
  if (typeof window === 'undefined') return 'home';
  return window.location.hash === OPERATOR_USAGE_HASH ? 'operator-usage' : 'home';
}

function App({ onSignOut, accountScope = 'trusted-local' }: { onSignOut?: () => Promise<void>; accountScope?: string }) {
  const gettingStartedKey = `getting-started-seen:v1:${accountScope}`;
  const [gettingStartedUnseen, setGettingStartedUnseen] = useState(() => {
    try { return window.localStorage.getItem(gettingStartedKey) !== 'true'; }
    catch { return true; }
  });
  const stashVisitedKey = `getting-started-stash-seen:v1:${accountScope}`;
  const [stashUnseen, setStashUnseen] = useState(() => {
    try { return window.localStorage.getItem(stashVisitedKey) !== 'true'; }
    catch { return true; }
  });
  const guideToStash = !gettingStartedUnseen && stashUnseen;
  const settingsVisitedKey = `getting-started-settings-seen:v1:${accountScope}`;
  const [settingsUnseen, setSettingsUnseen] = useState(() => {
    try { return window.localStorage.getItem(settingsVisitedKey) !== 'true'; }
    catch { return true; }
  });
  const guideToSettings = !gettingStartedUnseen && !stashUnseen && settingsUnseen;
  const [currentPage, setCurrentPage] = useState<AppPageKey>(readInitialPage);
  const [aboutView, setAboutView] = useState<AboutView>('getting-started');
  const [selectedUpdateId, setSelectedUpdateId] = useState<string | null>(null);
  const [homeUpdatesCollapsed, setHomeUpdatesCollapsed] = useState(false);
  const [wordsView, setWordsView] = useState<'stash' | 'my-words'>('stash');
  const myWords = useMyWordsController(currentPage === 'priority' && wordsView === 'my-words');
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attention = useAttentionBadges();
  const updatesCatalog = useWhatsNewCatalog();
  const studySession = useStudySession({
    setError,
    onSessionEnded: reloadDashboard,
    onReflectionGenerated: attention.refresh,
    sessionSurfaceVisible: currentPage === 'home',
    studyNewWordsFirst: backendStatus?.studyNewWordsFirst ?? false,
    characterPresentation: backendStatus?.characterPresentation ?? DEFAULT_CHARACTER_PRESENTATION,
  });
  const priorityPage = usePriorityPageController({
    currentPage,
    setCurrentPage,
    setError,
  });
  const reflectionPage = useReflectionPageController({
    currentPage,
    setCurrentPage,
    setError,
    onAcceptedProposal: async () => {
      studySession.invalidateSessionPrefetch();
      await reloadDashboard();
    },
    onHelpQueueChanged: attention.refresh,
    api: {
      listArtifacts: fetchReflectionArtifacts,
      listGenerationRuns: fetchReflectionGenerationRuns,
      retryGenerationRun: retryReflectionGenerationRun,
      generateDeferredSecondOpinion: generateDeferredReflectionSecondOpinion,
      getArtifact: fetchReflectionArtifactDetail,
      reviewProposal: reviewReflectionProposal,
      withdrawAuthorization: withdrawReflectionAuthorization,
      upsertQuality: upsertReflectionQuality,
      clearQuality: clearReflectionQuality,
      getQualityStats: fetchReflectionQualityStats,
      listHelpInbox: fetchReflectionHelpInbox,
      markHelpInboxDone: markReflectionHelpInboxDone,
      deferHelpInboxItem: deferReflectionHelpInboxItem,
      authorizeManualOperation: authorizeManualReflectionOperation,
    },
  });
  const contentPage = useContentDiagnosticsController({ currentPage, setCurrentPage, setError });

  useEffect(() => {
    async function loadData() {
      try {
        await reloadDashboard();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    }

    loadData();
  }, []);

  useEffect(() => {
    if (currentPage === 'operator-usage') {
      if (window.location.hash !== OPERATOR_USAGE_HASH) {
        window.location.hash = OPERATOR_USAGE_HASH;
      }
      return;
    }
    if (window.location.hash === OPERATOR_USAGE_HASH) {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  }, [currentPage]);

  useEffect(() => {
    function onHashChange() {
      if (window.location.hash === OPERATOR_USAGE_HASH) {
        setCurrentPage('operator-usage');
      }
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const flush = () => {
      void flushPendingClientTransportIncidents().catch(() => undefined);
    };
    flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, []);

  useEffect(() => {
    if (currentPage !== 'home' || studySession.sessionStarted) {
      return;
    }

    // Proposal acceptance only invalidates the cache. Prefetch when Home is
    // shown, which is when the learner may start a session.
    void studySession.prefetchSession().catch(() => undefined);
  }, [currentPage, studySession.sessionStarted]);

  useEffect(() => {
    if (currentPage !== 'about' || aboutView !== 'getting-started') return;
    setGettingStartedUnseen(false);
    try { window.localStorage.setItem(gettingStartedKey, 'true'); }
    catch { /* Optional browser storage must not block the guide. */ }
  }, [currentPage, aboutView, gettingStartedKey]);

  useEffect(() => {
    if (!guideToStash || currentPage !== 'priority' || wordsView !== 'stash') return;
    setStashUnseen(false);
    try { window.localStorage.setItem(stashVisitedKey, 'true'); }
    catch { /* Optional browser storage must not block Words. */ }
  }, [guideToStash, currentPage, wordsView, stashVisitedKey]);

  async function reloadDashboard() {
    const statusResponse = await fetchStatus();
    setBackendStatus(statusResponse);
  }

  async function nudgeDietAndRefresh(direction: 'easier' | 'harder') {
    await nudgeDiet(direction);
    // A nudge shifts the diet distribution for future compositions.
    void studySession.refreshSessionPrefetch().catch(() => undefined);
  }

  async function saveSessionSettings(settings: {
    dailyNewWordLimit?: number;
    studyNewWordsFirst?: boolean;
    unstudiedAdmissionSource?: BackendStatus['unstudiedAdmissionSource'];
    characterPresentation?: CharacterPresentation;
    sentenceCharacterPresentation?: SentenceCharacterPresentation;
    debriefInterests?: string;
  }) {
    const policyRequested = settings.dailyNewWordLimit !== undefined
      || settings.unstudiedAdmissionSource !== undefined;
    if (policyRequested) {
      try {
        await studySession.prefetchSession();
      } catch {
        // A failed prefetch is settled too, so it can no longer race the refresh below.
      }
    }

    let policy: {
      dailyNewWordLimit: number;
      unstudiedAdmissionSource: BackendStatus['unstudiedAdmissionSource'];
    } | null = null;
    if (settings.dailyNewWordLimit !== undefined) {
      policy = await updateDailyNewWordLimit(settings.dailyNewWordLimit);
    }
    if (settings.unstudiedAdmissionSource !== undefined) {
      policy = await updateUnstudiedAdmissionSource(settings.unstudiedAdmissionSource);
    }

    let characterPresentation = settings.characterPresentation;
    if (settings.characterPresentation !== undefined) {
      const saved = await updateCharacterPresentation(settings.characterPresentation);
      characterPresentation = saved.characterPresentation;
    }

    let sentenceCharacterPresentation = settings.sentenceCharacterPresentation;
    if (settings.sentenceCharacterPresentation !== undefined) {
      const saved = await updateSentenceCharacterPresentation(settings.sentenceCharacterPresentation);
      sentenceCharacterPresentation = saved.sentenceCharacterPresentation;
    }

    let studyNewWordsFirst = settings.studyNewWordsFirst;
    if (studyNewWordsFirst !== undefined) {
      studyNewWordsFirst = (await updateStudyNewWordsFirst(studyNewWordsFirst)).studyNewWordsFirst;
    }

    let debriefInterests = settings.debriefInterests;
    if (debriefInterests !== undefined) {
      debriefInterests = (await updateDebriefInterests(debriefInterests)).debriefInterests;
    }

    if (studyNewWordsFirst === undefined && !policy && characterPresentation === undefined && sentenceCharacterPresentation === undefined && debriefInterests === undefined) {
      return;
    }

    const nextStudyNewWordsFirst = studyNewWordsFirst;
    const nextPolicy = policy;
    const nextPresentation = characterPresentation;
    const nextSentencePresentation = sentenceCharacterPresentation;
    const nextInterests = debriefInterests;
    setBackendStatus((currentStatus) => currentStatus
      ? {
          ...currentStatus,
          ...(nextStudyNewWordsFirst !== undefined ? { studyNewWordsFirst: nextStudyNewWordsFirst } : {}),
          ...(nextPolicy
            ? {
                dailyNewWordLimit: nextPolicy.dailyNewWordLimit,
                unstudiedAdmissionSource: nextPolicy.unstudiedAdmissionSource,
              }
            : {}),
          ...(nextPresentation !== undefined ? { characterPresentation: nextPresentation } : {}),
          ...(nextSentencePresentation !== undefined ? { sentenceCharacterPresentation: nextSentencePresentation } : {}),
          ...(nextInterests !== undefined ? { debriefInterests: nextInterests } : {}),
        }
      : currentStatus);
    if (policyRequested) {
      void studySession.refreshSessionPrefetch().catch(() => undefined);
    }
  }

  const sessionActive = sessionHidesAppChrome({
    sessionStarted: studySession.sessionStarted,
    sessionPhase: studySession.homePageProps.sessionPhase,
    finalizationKind: studySession.homePageProps.sessionFinalization.kind,
  });

  async function leaveCompletedSessionThen(navigate: () => void | Promise<void>) {
    const allowed = await studySession.finishCompletedSessionIfLeaving();
    if (!allowed) {
      return;
    }
    await navigate();
  }

  return (
    <AppChrome
      currentPage={currentPage}
      gettingStartedUnseen={gettingStartedUnseen}
      guideToStash={guideToStash}
      onOpenGettingStarted={() => void leaveCompletedSessionThen(() => {
        setAboutView('getting-started');
        setCurrentPage('about');
      })}
      error={error}
      serviceBanner={backendStatus?.serviceBanner ?? null}
      sessionActive={sessionActive}
      priorityPageLoading={priorityPage.isLoading}
      reflectionPageLoading={reflectionPage.isLoading}
      contentPageLoading={contentPage.isLoading}
      reflectionUnseenCount={attention.reflectionUnseenCount}
      hasUnseenReflectionFailure={attention.hasUnseenReflectionFailure}
      reflectionGenerating={
        studySession.sessionReflectionGenerating
        || reflectionPage.generationRetryStatus?.state === 'generating'
        || reflectionPage.deferredSecondOpinionStatus === 'generating'
      }
      onOpenHomePage={() => setCurrentPage('home')}
      onOpenPriorityPage={() => void leaveCompletedSessionThen(() => {
        if (guideToStash) setWordsView('stash');
        return priorityPage.openPage();
      })}
      onOpenReflectionsPage={() => void leaveCompletedSessionThen(() => reflectionPage.openPage())}
      onRefreshReflections={() => void reflectionPage.refresh()}
      onOpenContentPage={() => void leaveCompletedSessionThen(() => contentPage.openPage())}
      onOpenAboutPage={() => void leaveCompletedSessionThen(() => setCurrentPage('about'))}
      onSignOut={onSignOut
        ? async () => {
            const allowed = await studySession.finishCompletedSessionIfLeaving();
            if (!allowed) {
              return;
            }
            await onSignOut();
          }
        : undefined}
    >
      {currentPage === 'home' ? (
        <HomePage
          guideToSettings={guideToSettings}
          onSettingsOpened={() => {
            if (!guideToSettings) return;
            setSettingsUnseen(false);
            try { window.localStorage.setItem(settingsVisitedKey, 'true'); }
            catch { /* Optional browser storage must not block settings. */ }
          }}
          updatesCatalog={updatesCatalog}
          unseenPostIds={attention.whatsNewUnseenPostIds}
          onUnseenBadgeVisible={attention.acknowledgeWhatsNewBadge}
          updatesCollapsed={homeUpdatesCollapsed}
          onToggleUpdatesCollapsed={() => setHomeUpdatesCollapsed(collapsed => !collapsed)}
          onOpenUpdate={(id) => { setSelectedUpdateId(id); setAboutView('whats-new'); setCurrentPage('about'); }}
          onViewAllUpdates={() => { setSelectedUpdateId(null); setAboutView('whats-new'); setCurrentPage('about'); }}
          backendStatus={backendStatus}
          onSaveSessionSettings={saveSessionSettings}
          onNudgeDiet={nudgeDietAndRefresh}
          {...studySession.homePageProps}
        />
      ) : currentPage === 'priority' ? (
        <>
          <NestedNav>
            <nav className="reflection-view-rail" aria-label="Words views">
              {([['stash', 'Stash'], ['my-words', 'My words']] as const).map(([key, label]) => (
                <button type="button" key={key}
                  className={`reflection-view-rail-tab${wordsView === key ? ' active' : ''}`}
                  aria-current={wordsView === key ? 'page' : undefined}
                  onClick={() => setWordsView(key)}>{label}</button>
              ))}
            </nav>
          </NestedNav>
          {wordsView === 'my-words' ? <MyWordsPage {...myWords} /> : (
            <PriorityPage
              rows={priorityPage.rows}
              searchHanzi={priorityPage.searchHanzi}
              searchNotice={priorityPage.searchNotice}
              searchSubmitting={priorityPage.searchSubmitting}
              matchChoices={priorityPage.matchChoices}
              selectedMatchIds={priorityPage.selectedMatchIds}
              highlightedWordIds={priorityPage.highlightedWordIds}
              onSearchHanziChange={priorityPage.setSearchHanzi}
              onSearchSubmit={() => void priorityPage.submitSearch()}
              onToggleMatchSelection={priorityPage.toggleMatchSelection}
              onConfirmMatchSelection={() => void priorityPage.confirmMatchSelection()}
              onCancelMatchSelection={priorityPage.cancelMatchSelection}
              onHighlightsHandled={priorityPage.clearHighlights}
              priorityBatchSubmitting={priorityPage.priorityBatchSubmitting}
              onMoveSelectedToTop={priorityPage.moveSelectedToTop}
              onMoveSelectedToStash={priorityPage.moveSelectedToStash}
              onRemoveSelected={priorityPage.removeSelected}
            />
          )}
        </>
      ) : currentPage === 'reflections' ? (
        <ReflectionsPage
          controller={reflectionPage}
          hasUnseenReflectionFailure={attention.hasUnseenReflectionFailure}
          onAcknowledgeFailedReflectionRuns={attention.acknowledgeFailedReflectionRuns}
          onHelpCardDisplayed={(request) => void attention.markHelpCardSeen(request)}
        />
      ) : currentPage === 'about' ? (
        <AboutPage
          updatesCatalog={updatesCatalog}
          view={aboutView}
          onWhatsNewRead={attention.acknowledgeWhatsNew}
          selectedPostId={selectedUpdateId}
          onViewAllUpdates={() => setSelectedUpdateId(null)}
          onSelectView={(view) => {
            setSelectedUpdateId(null);
            setAboutView(view);
          }}
        />
      ) : currentPage === 'content' ? (
        <ContentDiagnosticsPage
          data={contentPage.data}
          kind={contentPage.kind}
          query={contentPage.query}
          isLoading={contentPage.isLoading}
          onQueryChange={contentPage.setQuery}
          onSelectKind={(kind) => void contentPage.selectKind(kind)}
          onSearch={() => void contentPage.submitSearch()}
        />
      ) : currentPage === 'operator-usage' ? (
        <OperatorUsagePulsePage />
      ) : null}

      {studySession.personalNotesEditor.open ? (
        <div className="definition-editor-modal-backdrop" role="presentation">
          <PersonalNotesEditorOverlay
            inputRef={studySession.personalNotesEditor.inputRef}
            value={studySession.personalNotesEditor.value}
            isSaving={studySession.personalNotesEditor.isSaving}
            error={studySession.personalNotesEditor.error}
            canSubmit={studySession.personalNotesEditor.canSubmit}
            onChange={studySession.personalNotesEditor.onChange}
            onCancel={studySession.personalNotesEditor.onCancel}
            onSave={studySession.personalNotesEditor.onSave}
          />
        </div>
      ) : null}
    </AppChrome>
  );
}

export default App;
