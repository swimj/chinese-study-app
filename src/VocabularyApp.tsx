import { DEFAULT_INTRODUCTION_SPACING, type StudyIntroductionOrder } from './domain/introduction-order';
import { useWhatsNewCatalog } from './features/attention/useWhatsNewCatalog';
import { useEffect, useState } from 'react';
import {
  DEFAULT_CHARACTER_PRESENTATION,
  type CharacterPresentation,
  type SentenceCharacterPresentation,
} from './domain/card-characters';
import type { BackendStatus } from './services/api';
import { fetchStatus, fetchVocabularyAttention, updateDailyNewWordLimit, updateDebriefInterests, updateUnstudiedAdmissionSource,
 updateCharacterPresentation, updateSentenceCharacterPresentation, updateStudyIntroductionOrder, flushPendingClientTransportIncidents } from './services/api';
import { useVocabularyStudy } from './features/vocabulary-study/useVocabularyStudy';
import { VocabularyStudy } from './features/vocabulary-study/VocabularyStudy';
import { VocabularyHomePage } from './pages/VocabularyHomePage';
import { VocabularyWordsPage } from './pages/VocabularyWordsPage';
import { VocabularyFeedbackPage } from './pages/VocabularyFeedbackPage';
import { VocabularyOperatorPage } from './pages/VocabularyOperatorPage';
import './features/vocabulary-study/pages.css';
import { AppChrome, NestedNav, type AppPageKey } from './components/AppChrome';
import { AboutPage, type AboutView } from './pages/AboutPage';
import { usePriorityPageController } from './features/priority/usePriorityPageController';
import { PriorityPage } from './pages/PriorityPage';
import { useContentDiagnosticsController } from './features/content/useContentDiagnosticsController';
import { ContentDiagnosticsPage } from './pages/ContentDiagnosticsPage';
import { OperatorUsagePulsePage } from './pages/OperatorUsagePulsePage';
import { useAttentionBadges } from './features/attention/useAttentionBadges';

const OPERATOR_USAGE_HASH = '#operator-usage';

function readInitialPage(): AppPageKey {
  if (typeof window === 'undefined') return 'home';
  return window.location.hash === '#operator-vocabulary' ? 'operator-vocabulary' : window.location.hash === OPERATOR_USAGE_HASH ? 'operator-usage' : 'home';
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
  const homeUpdatesCollapsedKey = `home-updates-collapsed:v1:${accountScope}`;
  const [homeUpdatesCollapsed, setHomeUpdatesCollapsed] = useState(() => {
    try { return window.localStorage.getItem(homeUpdatesCollapsedKey) === 'true'; }
    catch { return false; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(homeUpdatesCollapsedKey, String(homeUpdatesCollapsed)); }
    catch { /* Storage restrictions must not prevent toggling updates. */ }
  }, [homeUpdatesCollapsedKey, homeUpdatesCollapsed]);
  const [wordsView, setWordsView] = useState<'stash' | 'my-words'>('stash');
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attention = useAttentionBadges();
  const updatesCatalog = useWhatsNewCatalog();
  const [feedbackAttention,setFeedbackAttention]=useState({unseenCount:0,hasFailure:false,generating:false});
  async function refreshFeedbackAttention(){setFeedbackAttention(await fetchVocabularyAttention());}
  useEffect(()=>{void refreshFeedbackAttention().catch(()=>undefined);const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refreshFeedbackAttention().catch(()=>undefined);},5000);return()=>window.clearInterval(timer);},[]);
  const studySession = useVocabularyStudy({ onSessionEnded: reloadDashboard });
  const priorityPage = usePriorityPageController({
    currentPage,
    setCurrentPage,
    setError,
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
      if (window.location.hash === '#operator-vocabulary') setCurrentPage('operator-vocabulary');
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

  async function saveSessionSettings(settings: {
    dailyNewWordLimit?: number;
    studyIntroductionOrder?: StudyIntroductionOrder;
    studyIntroductionSpacing?: number;
    unstudiedAdmissionSource?: BackendStatus['unstudiedAdmissionSource'];
    characterPresentation?: CharacterPresentation;
    sentenceCharacterPresentation?: SentenceCharacterPresentation;
    debriefInterests?: string;
  }) {
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

    const introductionSettings = settings.studyIntroductionOrder !== undefined || settings.studyIntroductionSpacing !== undefined
      ? await updateStudyIntroductionOrder(
          settings.studyIntroductionOrder ?? backendStatus?.studyIntroductionOrder ?? (backendStatus?.studyNewWordsFirst ? 'first' : 'random'),
          settings.studyIntroductionSpacing ?? backendStatus?.studyIntroductionSpacing ?? DEFAULT_INTRODUCTION_SPACING,
        )
      : null;

    let debriefInterests = settings.debriefInterests;
    if (debriefInterests !== undefined) {
      debriefInterests = (await updateDebriefInterests(debriefInterests)).debriefInterests;
    }

    if (!introductionSettings && !policy && characterPresentation === undefined && sentenceCharacterPresentation === undefined && debriefInterests === undefined) {
      return;
    }

    const nextPolicy = policy;
    const nextPresentation = characterPresentation;
    const nextSentencePresentation = sentenceCharacterPresentation;
    const nextInterests = debriefInterests;
    setBackendStatus((currentStatus) => currentStatus
      ? {
          ...currentStatus,
          ...(introductionSettings ? { ...introductionSettings, studyNewWordsFirst: introductionSettings.studyIntroductionOrder === 'first' } : {}),
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

  }

  const sessionActive = studySession.active;
  async function leaveCompletedSessionThen(navigate: () => void | Promise<void>) { await navigate(); }
  return (
    <AppChrome
      currentPage={currentPage}
      gettingStartedUnseen={gettingStartedUnseen}
      guideToStash={guideToStash}
      onOpenGettingStarted={() => void leaveCompletedSessionThen(() => {
        setAboutView('getting-started');
        setCurrentPage('about');
      })}
      error={error ?? studySession.error}
      serviceBanner={backendStatus?.serviceBanner ?? null}
      sessionActive={sessionActive}
      priorityPageLoading={priorityPage.isLoading}
      reflectionPageLoading={false}
      contentPageLoading={contentPage.isLoading}
      reflectionUnseenCount={feedbackAttention.unseenCount}
      hasUnseenReflectionFailure={feedbackAttention.hasFailure}
      reflectionGenerating={feedbackAttention.generating}
      onOpenHomePage={() => void leaveCompletedSessionThen(() => setCurrentPage('home'))}
      onOpenPriorityPage={() => void leaveCompletedSessionThen(() => {
        if (guideToStash) setWordsView('stash');
        return priorityPage.openPage();
      })}
      onOpenReflectionsPage={() => void leaveCompletedSessionThen(() => setCurrentPage('reflections'))}
      onOpenContentPage={() => void leaveCompletedSessionThen(() => contentPage.openPage())}
      onOpenAboutPage={() => void leaveCompletedSessionThen(() => setCurrentPage('about'))}
      onSignOut={onSignOut}
    >
      {currentPage === 'home' ? (
        <VocabularyHomePage
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
          active={studySession.active} busy={studySession.busy} onStart={() => void studySession.start()}
          studySurface={<VocabularyStudy controller={studySession} hideStartButton characterPresentation={backendStatus?.characterPresentation ?? DEFAULT_CHARACTER_PRESENTATION} sentenceCharacterPresentation={backendStatus?.sentenceCharacterPresentation ?? 'simplified'}/> }
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
          {wordsView === 'my-words' ? <VocabularyWordsPage /> : (
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
        <VocabularyFeedbackPage onChanged={()=>void refreshFeedbackAttention().catch(()=>undefined)} />
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
        <><p><a href="#operator-vocabulary" onClick={()=>setCurrentPage('operator-vocabulary')}>Vocabulary content review</a></p><ContentDiagnosticsPage
          data={contentPage.data}
          kind={contentPage.kind}
          query={contentPage.query}
          isLoading={contentPage.isLoading}
          onQueryChange={contentPage.setQuery}
          onSelectKind={(kind) => void contentPage.selectKind(kind)}
          onSearch={() => void contentPage.submitSearch()}
        /></>
      ) : currentPage === 'operator-vocabulary' ? (
        <VocabularyOperatorPage />
      ) : currentPage === 'operator-usage' ? (
        <OperatorUsagePulsePage legacyContentEditing={false} />
      ) : null}

    </AppChrome>
  );
}

export default App;
