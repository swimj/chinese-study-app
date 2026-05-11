import { useEffect, useState } from 'react';
import type { BackendStatus } from './services/api';
import { fetchStatus } from './services/api';
import { AppChrome, type AppPageKey } from './components/AppChrome';
import { PersonalNotesEditorOverlay } from './features/session/PersonalNotesEditorOverlay';
import { useStudySession } from './features/session/useStudySession';
import { usePriorityPageController } from './features/priority/usePriorityPageController';
import { useWordsPageController } from './features/words/useWordsPageController';
import { HomePage } from './pages/HomePage';
import { PriorityPage } from './pages/PriorityPage';
import { WordsPage } from './pages/WordsPage';

const APP_VERSION = __APP_VERSION__;

function App() {
  const [currentPage, setCurrentPage] = useState<AppPageKey>('home');
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const studySession = useStudySession({
    setError,
    onSessionEnded: reloadDashboard,
  });
  const wordsPage = useWordsPageController({
    currentPage,
    setCurrentPage,
    setError,
  });
  const priorityPage = usePriorityPageController({
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
      wordsPageLoading={wordsPage.isLoading}
      priorityPageLoading={priorityPage.isLoading}
      onOpenHomePage={() => setCurrentPage('home')}
      onOpenWordsPage={() => void wordsPage.openPage()}
      onOpenPriorityPage={() => void priorityPage.openPage()}
    >
      {currentPage === 'home' ? (
        <HomePage backendStatus={backendStatus} {...studySession.homePageProps} />
      ) : currentPage === 'words' ? (
        <WordsPage
          rows={wordsPage.rows}
          currentPage={wordsPage.pageNumber}
          totalPages={wordsPage.totalPages}
          totalItems={wordsPage.totalItems}
          pageSize={wordsPage.pageSize}
          onPreviousPage={wordsPage.previousPage}
          onNextPage={wordsPage.nextPage}
        />
      ) : (
        <PriorityPage
          rows={priorityPage.rows}
          triageRows={priorityPage.triageRows}
          unstudiedTotalCount={priorityPage.unstudiedTotalCount}
          searchHanzi={priorityPage.searchHanzi}
          searchNotice={priorityPage.searchNotice}
          searchSubmitting={priorityPage.searchSubmitting}
          dailyNewWordLimit={backendStatus?.dailyNewWordLimit ?? 2}
          jumpRequestWordId={priorityPage.jumpRequestWordId}
          onSearchHanziChange={priorityPage.setSearchHanzi}
          onSearchSubmit={() => void priorityPage.submitSearch()}
          onJumpHandled={priorityPage.clearJumpRequest}
          updatingWordId={priorityPage.updatingWordId}
          onMoveToTop={(wordId) => void priorityPage.moveToTop(wordId)}
          onBumpAgain={(wordId) => void priorityPage.bumpAgain(wordId)}
          onRemove={(wordId) => void priorityPage.remove(wordId)}
          bulkDismissSubmitting={priorityPage.bulkDismissSubmitting}
          onDismissFromTriage={(wordId) => void priorityPage.dismissFromTriage(wordId)}
          onBulkDismissFromTriage={(wordIds) => void priorityPage.bulkDismissFromTriage(wordIds)}
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
