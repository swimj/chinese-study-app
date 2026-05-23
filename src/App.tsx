import { useEffect, useState } from 'react';
import type { BackendStatus } from './services/api';
import { fetchStatus } from './services/api';
import { AppChrome, type AppPageKey } from './components/AppChrome';
import { PersonalNotesEditorOverlay } from './features/session/PersonalNotesEditorOverlay';
import { useStudySession } from './features/session/useStudySession';
import { usePriorityPageController } from './features/priority/usePriorityPageController';
import { useClusterPageController } from './features/contrast/useClusterPageController';
import { HomePage } from './pages/HomePage';
import { PriorityPage } from './pages/PriorityPage';
import { ClusterManagementPage } from './pages/ClusterManagementPage';

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
  const clusterPage = useClusterPageController({
    currentPage,
    setCurrentPage,
    setError,
  });

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

  return (
    <AppChrome
      currentPage={currentPage}
      error={error}
      version={APP_VERSION}
      priorityPageLoading={priorityPage.isLoading}
      clusterPageLoading={clusterPage.isLoading}
      onOpenHomePage={() => setCurrentPage('home')}
      onOpenPriorityPage={() => void priorityPage.openPage()}
      onOpenClusterPage={() => void clusterPage.openPage()}
    >
      {currentPage === 'home' ? (
        <HomePage backendStatus={backendStatus} {...studySession.homePageProps} />
      ) : currentPage === 'priority' ? (
        <PriorityPage
          rows={priorityPage.rows}
          triageRows={priorityPage.triageRows}
          unstudiedTotalCount={priorityPage.unstudiedTotalCount}
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
          onDismissFromTriage={(wordId) => void priorityPage.dismissFromTriage(wordId)}
          onBulkDismissFromTriage={(wordIds) => void priorityPage.bulkDismissFromTriage(wordIds)}
        />
      ) : (
        <ClusterManagementPage
          clusters={clusterPage.clusters}
          selectedClusterId={clusterPage.selectedClusterId}
          isSavingPrompt={clusterPage.isSavingPrompt}
          onSelectCluster={clusterPage.selectCluster}
          onCreatePrompt={clusterPage.createPrompt}
          onUpdatePrompt={clusterPage.updatePrompt}
        />
      )}

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
