import type { Word } from '../../types';

/** Shared visual language for old stages and new vocabulary modes. */
export function StudyStageIcon({ status }: { status: Word['status'] }) {
  return status === 'review' ? null : <svg className="study-stage-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {status === 'unstudied' ? <><path d="M12 21v-9M12 15C5 15 3 11 3 6c6 0 9 3 9 9ZM12 11c0-5 3-8 9-8 0 5-3 8-9 8Z" /></> : <><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" /></>}
    </svg>;
}
