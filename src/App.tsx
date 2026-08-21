import { useEffect, useState } from 'react';
import type { BackendStatus } from './services/api';
import {
  clearReflectionQuality,
  fetchReflectionArtifactDetail,
  fetchReflectionArtifacts,
  fetchReflectionGenerationRuns,
  fetchReflectionQualityStats,
  fetchStatus,
  reviewReflectionProposal,
  retryReflectionGenerationRun,
  updateDailyNewWordLimit,
  upsertReflectionQuality,
  withdrawReflectionAuthorization,
  fetchReflectionHelpInbox,
  markReflectionHelpInboxDone,
} from './services/api';
import { AppChrome, type AppPageKey } from './components/AppChrome';
import { PersonalNotesEditorOverlay } from './features/session/PersonalNotesEditorOverlay';
import { useStudySession } from './features/session/useStudySession';
import { usePriorityPageController } from './features/priority/usePriorityPageController';
import { HomePage } from './pages/HomePage';
import { PriorityPage } from './pages/PriorityPage';
import { ReflectionsPage } from './pages/ReflectionsPage';
import { useReflectionPageController } from './features/reflection/useReflectionPageController';
import { useContentDiagnosticsController } from './features/content/useContentDiagnosticsController';
import { ContentDiagnosticsPage } from './pages/ContentDiagnosticsPage';

const APP_VERSION = __APP_VERSION__;

function App() {
  const [currentPage, setCurrentPage] = useState<AppPageKey>('home');
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const studySession = useStudySession({
    setError,
    onSessionEnded: reloadDashboard,
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
    onAcceptedProposal: studySession.refreshSessionPrefetch,
    api: {
      listArtifacts: fetchReflectionArtifacts,
      listGenerationRuns: fetchReflectionGenerationRuns,
      retryGenerationRun: retryReflectionGenerationRun,
      getArtifact: fetchReflectionArtifactDetail,
      reviewProposal: reviewReflectionProposal,
      withdrawAuthorization: withdrawReflectionAuthorization,
      upsertQuality: upsertReflectionQuality,
      clearQuality: clearReflectionQuality,
      getQualityStats: fetchReflectionQualityStats,
      listHelpInbox: fetchReflectionHelpInbox,
      markHelpInboxDone: markReflectionHelpInboxDone,
    },
  });
  const contentPage = useContentDiagnosticsController({ currentPage, setCurrentPage, setError });

  useEffect(() => {
    async function loadData() {
      try {
        await reloadDashboard();
        void studySession.prefetchSession().catch(() => undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    }

    loadData();
  }, []);

  async function reloadDashboard() {
    const statusResponse = await fetchStatus();
    setBackendStatus(statusResponse);
  }

  async function saveDailyNewWordLimit(dailyNewWordLimit: number) {
    try {
      await studySession.prefetchSession();
    } catch {
      // A failed prefetch is settled too, so it can no longer race the refresh below.
    }

    const policy = await updateDailyNewWordLimit(dailyNewWordLimit);
    setBackendStatus((currentStatus) => currentStatus
      ? {
          ...currentStatus,
          dailyNewWordLimit: policy.dailyNewWordLimit,
        }
      : currentStatus);
    void studySession.refreshSessionPrefetch().catch(() => undefined);
  }

  const sessionActive = currentPage === 'home' && studySession.homePageProps.sessionStarted;

  return (
    <AppChrome
      currentPage={currentPage}
      error={error}
      version={APP_VERSION}
      sessionActive={sessionActive}
      priorityPageLoading={priorityPage.isLoading}
      reflectionPageLoading={reflectionPage.isLoading}
      contentPageLoading={contentPage.isLoading}
      onOpenHomePage={() => setCurrentPage('home')}
      onOpenPriorityPage={() => void priorityPage.openPage()}
      onOpenReflectionsPage={() => void reflectionPage.openPage()}
      onOpenContentPage={() => void contentPage.openPage()}
    >
      {currentPage === 'home' ? (
        <HomePage
          backendStatus={backendStatus}
          onSaveDailyNewWordLimit={saveDailyNewWordLimit}
          {...studySession.homePageProps}
        />
      ) : currentPage === 'priority' ? (
        <PriorityPage
          rows={priorityPage.rows}
          triageRows={priorityPage.triageRows}
          searchHanzi={priorityPage.searchHanzi}
          requireAddedMatches={priorityPage.requireAddedMatches}
          searchNotice={priorityPage.searchNotice}
          searchSubmitting={priorityPage.searchSubmitting}
          jumpRequestWordId={priorityPage.jumpRequestWordId}
          onSearchHanziChange={priorityPage.setSearchHanzi}
          onRequireAddedMatchesChange={priorityPage.setRequireAddedMatches}
          onSearchSubmit={() => void priorityPage.submitSearch()}
          onJumpHandled={priorityPage.clearJumpRequest}
          updatingWordId={priorityPage.updatingWordId}
          priorityBatchSubmitting={priorityPage.priorityBatchSubmitting}
          onRequireForNextSession={(wordIds, requiredForNextSession) =>
            priorityPage.requireForNextSession(wordIds, requiredForNextSession)
          }
          onMoveSelectedToTop={priorityPage.moveSelectedToTop}
          onBumpSelectedAgain={priorityPage.bumpSelectedAgain}
          onRemoveSelected={priorityPage.removeSelected}
          bulkDismissSubmitting={priorityPage.bulkDismissSubmitting}
          analysisCandidateCount={priorityPage.analysisCandidateCount}
          advisorGenerating={priorityPage.advisorGenerating}
          advisorRunReceipt={priorityPage.advisorRunReceipt}
          advisorUpdatingAssessmentId={priorityPage.advisorUpdatingAssessmentId}
          onDismissFromTriage={(wordId) => void priorityPage.dismissFromTriage(wordId)}
          onBulkDismissFromTriage={(wordIds) => void priorityPage.bulkDismissFromTriage(wordIds)}
          onRunAdvisor={() => void priorityPage.runAdvisor()}
          onAcceptAdvisorAssessment={(assessmentId) => void priorityPage.acceptAdvisorAssessment(assessmentId)}
          onDismissAdvisorAssessment={(assessmentId) => void priorityPage.dismissAdvisorAssessment(assessmentId)}
        />
      ) : currentPage === 'reflections' ? (
        <ReflectionsPage controller={reflectionPage} />
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
