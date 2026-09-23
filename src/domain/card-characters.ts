export const CHARACTER_PRESENTATIONS = ['simplified', 'traditional', 'both'] as const;

export type CharacterPresentation = (typeof CHARACTER_PRESENTATIONS)[number];

export const DEFAULT_CHARACTER_PRESENTATION: CharacterPresentation = 'simplified';

export type CardCharacterForms = {
  hanzi: string;
  traditional: string | null;
};

export function isCharacterPresentation(value: unknown): value is CharacterPresentation {
  return value === 'simplified' || value === 'traditional' || value === 'both';
}

export function assertCharacterPresentation(value: unknown): asserts value is CharacterPresentation {
  if (!isCharacterPresentation(value)) {
    throw new Error('Expected characterPresentation to be "simplified", "traditional", or "both"');
  }
}

/** Stored hanzi/traditional only. Missing or identical traditional falls back to hanzi. */
export function formatCardCharacters(
  forms: CardCharacterForms,
  presentation: CharacterPresentation,
): string {
  const traditional = distinctTraditional(forms);
  if (presentation === 'traditional') {
    return traditional ?? forms.hanzi;
  }
  if (presentation === 'both' && traditional !== null) {
    return `${forms.hanzi} / ${traditional}`;
  }
  return forms.hanzi;
}

function distinctTraditional(forms: CardCharacterForms): string | null {
  if (forms.traditional === null) {
    return null;
  }
  const traditional = forms.traditional.trim();
  if (traditional.length === 0 || traditional === forms.hanzi) {
    return null;
  }
  return traditional;
}
