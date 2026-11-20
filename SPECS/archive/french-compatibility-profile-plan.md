# French Compatibility Profile Plan

## Context

The current app is a Mandarin study app, but the core learning model is mostly a target-language vocabulary scheduler:

- `unstudied`, `learning`, and `review` word lifecycle
- recognition and production directions
- direction-specific review intervals
- frontend-owned live session state
- backend-owned durable study state

For a French trial, the goal is not to create a general multilingual product or a special long-lived branch. The goal is to let a French-compatible corpus use the existing study flow while staying on the normal mainline code path.

## Compatibility Goal

Support Mandarin and French through a small frontend boot-time profile:

```bash
VITE_STUDY_PROFILE=mandarin npm run dev:frontend
VITE_STUDY_PROFILE=french npm run dev:frontend
```

The backend, database schema, scheduler, and API contract should remain unaware of the selected profile.

Internally, existing field names can keep their current meanings:

- `word.hanzi` means target-language term
- `word.pinyin` means pronunciation or auxiliary note
- `word.meaning` and `word.meanings` mean source-language glosses
- `recognition` means target to source
- `production` means source to target

## Non-Goals

- Do not rename database columns.
- Do not introduce a polished profile-selection UI.
- Do not introduce a broad i18n framework.
- Do not add French-specific study actions.
- Do not require a special branch for French use.
- Do not make the backend aware of profile selection.

## Implementation Plan

### 1. Add a frontend study profile module

Create a frontend-only module such as `src/study-profile.ts`.

It should define:

- a default `mandarin` profile
- an alternate `french` profile
- labels for target, source, auxiliary, and study directions
- default production matching options
- a selected profile resolved from `import.meta.env.VITE_STUDY_PROFILE`

Sketch:

```ts
type StudyProfileId = 'mandarin' | 'french';

type ProductionMatchOptions = {
  ignoreCase: boolean;
  ignoreAccents: boolean;
  normalizeApostrophes: boolean;
  trimEdgePunctuation: boolean;
  collapseWhitespace: boolean;
  ignoreHyphenSpacing: boolean;
};

type StudyProfile = {
  id: StudyProfileId;
  labels: {
    target: string;
    source: string;
    auxiliary: string;
    recognitionDirection: string;
    productionDirection: string;
    productionInput: string;
    submitProductionInput: string;
    addByTarget: string;
    targetRecallIncorrect: string;
  };
  defaultProductionMatchOptions: ProductionMatchOptions;
};
```

The selected profile should fall back to Mandarin if the environment variable is missing or unknown.

### 2. Replace user-visible Mandarin labels at UI edges

Update visible copy in session and priority surfaces to use the active profile.

Examples:

- `Hanzi` -> profile target label
- `Pinyin` -> profile auxiliary label
- `Hanzi -> Meaning` -> profile recognition direction label
- `Meaning -> Hanzi` -> profile production direction label
- `Type Hanzi` -> profile production input label
- `Submit Hanzi` -> profile production submit label
- `Add by hanzi` -> profile add-by-target label
- `Hanzi recall was incorrect` -> profile target-recall message

Keep internal variable names such as `activeWord.hanzi` and `productionHanziInput` unless a name is already being touched and changing it would reduce local confusion without widening the diff.

### 3. Centralize production answer normalization

Move production answer matching behind a shared helper, for example:

```ts
normalizeProductionAnswer(value, options)
```

The Mandarin profile should preserve current matching behavior.

The French profile should default to forgiving matching:

- ignore case
- ignore accents
- normalize curly apostrophes to straight apostrophes
- collapse repeated whitespace
- trim punctuation at the start and end
- preserve articles
- preserve hyphen structure by default

French defaults should avoid broad linguistic magic. In particular, do not drop articles such as `le`, `la`, `un`, or `une`, because those may carry useful gender and number information.

### 4. Add a minimal answer-matching options panel

Add an intentionally utilitarian control surface for production answer matching.

This can be a small panel or details section backed by `localStorage`. It does not need to be part of a polished settings system.

Options:

- Ignore case
- Ignore accents
- Normalize apostrophes
- Trim edge punctuation
- Collapse whitespace
- Ignore hyphen spacing

Recommended French default:

```ts
{
  ignoreCase: true,
  ignoreAccents: true,
  normalizeApostrophes: true,
  trimEdgePunctuation: true,
  collapseWhitespace: true,
  ignoreHyphenSpacing: false,
}
```

Recommended Mandarin default should preserve current behavior as closely as possible.

### 5. Keep future study actions compatible by default

Future study actions should consume profile labels only when they show target/source/auxiliary concepts to the user.

If a future action asks the user to type the target-language term, it should use the same production normalization helper.

If a future action requires French-specific content, that content can be manually populated in the corpus. The profile layer should not try to generate or infer French-specific exercises.

### 6. Add focused tests

Add tests for the normalization helper.

Coverage should include:

- Mandarin profile preserves current matching expectations.
- French matches `École` and `ecole` when accents are ignored.
- French matches `l’homme` and `l'homme` when apostrophes are normalized.
- French does not drop articles by default.
- French does not collapse hyphen-vs-space unless `ignoreHyphenSpacing` is enabled.

UI label changes can be tested lightly if there are existing seams for it, but the highest-value tests are the normalization behavior and profile fallback.

### 7. Document French setup

Add a short README section once implemented:

- import or bootstrap a French-compatible study database using the existing `words` mapping
- create `.env.local` with `VITE_STUDY_PROFILE=french`
- start the normal study backend and frontend commands
- adjust answer matching in the app if the default French strictness feels wrong

## French Corpus Assumption

This plan assumes the French corpus already exists and is imported into the current backend shape.

The expected mapping is:

- `hanzi` = French target term or phrase
- `pinyin` = pronunciation, grammatical note, or other compact auxiliary text
- `meaning` / `meanings` = English glosses
- `examples` = French examples
- `priority` = frequency rank or curated study order

No special backend corpus awareness is needed for the steady-state app.

## Development Compatibility

This work should stay compatible with ongoing mainline development by keeping the adaptation at frontend edges:

- one profile module
- shared answer normalization helper
- profile-driven labels in existing UI components
- localStorage-backed answer matching overrides

The default behavior remains Mandarin, so normal development and existing study use should not require any new configuration.
