import type { VocabularySessionPreview } from '../../domain/vocabulary-study-api';

export type VocabularyHomePreviewState = {
  status: 'loading' | 'ready' | 'error'; preview: VocabularySessionPreview | null; error: string | null;
};
export const INITIAL_VOCABULARY_HOME_PREVIEW: VocabularyHomePreviewState = { status: 'loading', preview: null, error: null };

/** A settings change/disposal invalidates late responses before they can restore an old count or seed. */
export function createVocabularyHomePreviewLoader(fetchPreview: () => Promise<VocabularySessionPreview>,
  onChange: (state: VocabularyHomePreviewState) => void) {
  let generation = 0;
  let disposed = false;
  let lastReady:VocabularySessionPreview|null=null;
  return {
    async reload(options:{background?:boolean}={}): Promise<VocabularySessionPreview | null> {
      const current = ++generation;
      if (disposed) return null;
      if(!options.background||lastReady===null)onChange(INITIAL_VOCABULARY_HOME_PREVIEW);
      try {
        const preview = await fetchPreview();
        if (disposed || current !== generation) return null;
        lastReady=preview;
        onChange({ status: 'ready', preview, error: null });
        return preview;
      } catch (reason) {
        if (!disposed && current === generation) onChange({ status: options.background&&lastReady!==null?'ready':'error', preview: options.background?lastReady:null,
          error: reason instanceof Error ? reason.message : 'The ready count could not be loaded.' });
        return null;
      }
    },
    dispose() { disposed = true; generation++; },
  };
}
