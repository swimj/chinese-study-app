import type { BootstrapRevealSnapshot } from '../../domain/word-content/reveal';
import type { SentenceCharacterPresentation } from '../../domain/card-characters';
import { ProductionSupplementAside } from './ProductionSupplementAside';

/** Both eligible exercise types render the exact served post-reveal snapshot. */
export function BootstrapSourceReveal({ reveal, sentenceCharacterPresentation }: {
  reveal: BootstrapRevealSnapshot;
  sentenceCharacterPresentation: SentenceCharacterPresentation;
}) {
  return <ProductionSupplementAside supplement={reveal} sentenceCharacterPresentation={sentenceCharacterPresentation} />;
}
