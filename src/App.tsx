import { useEffect, useState } from 'react';
import type { BackendStatus } from './services/api';
import { fetchStatus } from './services/api';
import { AppChrome, type AppPageKey } from './components/AppChrome';
import { PersonalNotesEditorOverlay } from './features/session/PersonalNotesEditorOverlay';
import { useStudySession } from './features/session/useStudySession';
import { usePriorityPageController } from './features/priority/usePriorityPageController';
import { useClusterPageController } from './features/contrast/useClusterPageController';
import { useIntakePageController } from './features/contrast/useIntakePageController';
import { HomePage } from './pages/HomePage';
import { PriorityPage } from './pages/PriorityPage';
import { IntakePage } from './pages/IntakePage';

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
    setError,
  });
  const intakePage = useIntakePageController({
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

  async function refreshContrastManagementState() {
    await clusterPage.loadData();
  }

  const sessionActive = currentPage === 'home' && studySession.homePageProps.sessionStarted;

  return (
    <AppChrome
      currentPage={currentPage}
      error={error}
      version={APP_VERSION}
      sessionActive={sessionActive}
      priorityPageLoading={priorityPage.isLoading}
      intakePageLoading={intakePage.isLoading}
      onOpenHomePage={() => setCurrentPage('home')}
      onOpenPriorityPage={() => void priorityPage.openPage()}
      onOpenIntakePage={() => void (async () => {
        await clusterPage.loadData();
        await intakePage.openPage();
      })()}
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
      ) : currentPage === 'intake' ? (
        <IntakePage
          words={intakePage.words}
          selectedWordIndex={intakePage.selectedWordIndex}
          isSaving={intakePage.isSaving}
          onSelectWordIndex={intakePage.selectWordIndex}
          onResolveWord={async (targetWordId) => {
            await intakePage.resolveWord(targetWordId);
            await refreshContrastManagementState();
          }}
          onSuppressProduction={async (targetWordId) => {
            await intakePage.suppressProduction(targetWordId);
            await refreshContrastManagementState();
          }}
          onReportBadPrompt={async (input) => {
            await intakePage.reportBadPrompt(input);
            await refreshContrastManagementState();
          }}
          onCreateClusterForWord={async (input) => {
            await intakePage.createClusterForWord(input);
            await refreshContrastManagementState();
          }}
          clusters={clusterPage.clusters}
          selectedClusterId={clusterPage.selectedClusterId}
          wordSearchResults={clusterPage.wordSearchResults}
          isSavingCluster={clusterPage.isSavingPrompt}
          onSelectCluster={clusterPage.selectCluster}
          onSearchWords={clusterPage.searchWords}
          onCreateCluster={clusterPage.createCluster}
          onUpdateCluster={clusterPage.updateCluster}
          onAddMember={clusterPage.addMember}
          onUpdateMember={clusterPage.updateMember}
          onRemoveMember={clusterPage.removeMember}
          onCreatePrompt={clusterPage.createPrompt}
          onUpdatePrompt={clusterPage.updatePrompt}
          onResolvePromptFeedback={clusterPage.resolvePromptFeedback}
          onDeletePrompt={clusterPage.deletePrompt}
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
