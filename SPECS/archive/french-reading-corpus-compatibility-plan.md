# French Reading Corpus Compatibility Plan

## Context

The French profile is meant to support a reading workflow:

- A learner encounters new French words while reading.
- She records those words in the app and moves them into prioritized study.
- The app also provides default new words to study when she has not supplied her own.

This changes the corpus goal from "small French seed list" to "broad French reading lookup with a learner-priority overlay."

The database should be fairly complete for words that appear in regular French reading. A word should not be impossible to study just because it is outside a CEFR core list.

## Goals

- Build a broad French-compatible study database using the existing `words` shape.
- Keep CEFR priority as an overlay, not as the corpus boundary.
- Let inflected reading forms resolve to canonical study entries where possible.
- Keep French morphology support contained to import and add-word lookup paths.
- Avoid spreading language-specific behavior into session scheduling or review state.

## Non-Goals

- Do not rename existing `words` columns.
- Do not make the backend aware of the active frontend study profile.
- Do not require every inflected form to become its own study card.
- Do not fully rank the entire French dictionary.
- Do not block the first implementation on example sentences.

## Source Stack

### Kaikki French Wiktionary Extract

Use Kaikki as the main dictionary backbone.

Purpose:

- broad French lexical coverage
- English glosses
- parts of speech
- gender and grammar tags
- IPA or pronunciation metadata when available
- inflected forms that can become lookup aliases

Source:

- `https://kaikki.org/dictionary/French/index.html`

### FLELex / Beacco

Use FLELex as a priority overlay only.

Purpose:

- assign high default priority to learner-relevant vocabulary
- use A1-B2 for the first pass
- sort default study suggestions pedagogically rather than purely by corpus frequency

Source:

- `https://cental.uclouvain.be/cefrlex/flelex/download/`

### Lexique / OpenLexicon

Use Lexique as an optional enrichment and tie-break source.

Purpose:

- break ties inside CEFR levels
- improve frequency metadata
- sanity-check POS and lemma forms
- identify common non-FLELex words to place above the dictionary-only tail

Source:

- `https://openlexicon.fr/`

### FreeDict French-English

Use FreeDict as an optional fallback dictionary source if Kaikki entries lack usable English glosses.

Source:

- `https://github.com/freedict/fd-dictionaries/tree/master/fra-eng`

### Tatoeba

Use Tatoeba later for example sentences.

Purpose:

- populate `examples` after the core dictionary and priority import is working

Source:

- `https://tatoeba.org/en/downloads`

## Corpus Shape

Use canonical study entries in the existing `words` table.

Field mapping:

- `hanzi` = canonical French target term or phrase
- `traditional` = `null`
- `pinyin` = compact auxiliary note, such as `masculine noun`, `feminine noun`, `verb`, or IPA
- `meaning` = semicolon-joined English glosses
- `meanings` = cleaned English gloss array
- `examples` = French examples, initially empty if no source is loaded
- `status` = `unstudied`
- `priority` = CEFR-derived priority for A1-B2 terms, otherwise low default priority

Prefer lemmas as study entries rather than every inflected surface form.

Example:

- encountered form: `parlait`
- study entry: `parler`
- auxiliary note: `verb`
- meaning: `to speak; to talk`

## Lookup Alias Concept

French needs a concept Mandarin does not require heavily: surface forms from reading should be able to resolve to canonical study entries.

Add a language-neutral alias layer rather than French-specific code.

Possible table:

```sql
CREATE TABLE word_lookup_aliases (
  alias_text TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence REAL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (normalized_alias, word_id, source)
);

CREATE INDEX idx_word_lookup_aliases_normalized_alias
  ON word_lookup_aliases(normalized_alias);
```

Example aliases:

- `parlait` -> `parler`
- `étaient` -> `être`
- `mangées` -> `manger`
- `belles` -> `beau`
- `chevaux` -> `cheval`

This alias layer is useful for French, but it should remain generic enough for other future languages.

## Add-Word Lookup Flow

The current add-priority flow exact-matches `words.hanzi`.

Update it to:

1. Normalize the user-entered target text.
2. Try exact canonical match against `words.hanzi`.
3. If no canonical match is found, try `word_lookup_aliases.normalized_alias`.
4. If one unstudied canonical word matches, add priority to that word.
5. If multiple canonical words match, return candidates for the frontend to display.
6. If no candidates match, return the existing not-found response.

Ambiguous example:

- `partie` -> `partir`, feminine past participle
- `partie` -> `partie`, noun

The frontend should only need a small candidate-selection state for ambiguous alias matches. Exact matches can continue to auto-add.

## Containment Boundary

The alias concept should affect:

- corpus build/import scripts
- schema migration
- add-priority lookup endpoint
- API response for ambiguous add-word matches
- small frontend candidate chooser for ambiguous matches

It should not affect:

- scheduler logic
- session composition
- review intervals
- word lifecycle transitions
- recognition and production review actions
- study attempt event projection

The actual studied object remains the canonical `words` row.

## Extraction And Processing Flow

### 1. Parse Kaikki JSONL

Extract:

- `word`
- `pos`
- English glosses from senses
- IPA or pronunciation metadata
- forms and form tags
- grammar tags such as gender, number, plural, feminine, obsolete, archaic, rare

Filter or de-prioritize entries that are clearly not useful for regular reading, such as obsolete, archaic, or rare-only entries. Keep this filter conservative at first.

### 2. Build Canonical Entries

Create one canonical candidate per useful lemma/POS combination.

Clean meanings by:

- trimming whitespace
- removing empty glosses
- de-duplicating identical glosses
- limiting extremely long gloss lists if needed

Construct compact auxiliary notes from POS, gender, and IPA where available.

### 3. Generate Lookup Aliases

From Kaikki forms, map surface forms back to canonical entries.

Store ambiguous aliases as multiple rows. Do not discard ambiguity during import.

Normalize aliases with a French-compatible policy:

- Unicode normalize
- lowercase
- normalize curly apostrophes to straight apostrophes
- collapse whitespace
- preserve accents by default, but consider storing an accent-stripped search key later if needed

### 4. Parse FLELex / Beacco

Keep A1-B2 rows for the first priority overlay.

Normalize join keys:

- lowercase
- Unicode normalize
- normalize apostrophes
- normalize spacing conservatively
- use POS when available

### 5. Join FLELex Onto Kaikki

Primary join:

- lemma + POS

Fallback join:

- lemma only, when unambiguous or POS-compatible

Do not require every FLELex word to have a Kaikki match. Report unmatched FLELex rows so they can be inspected or imported from a fallback source.

### 6. Optional Lexique Pass

Use Lexique to:

- break ties within CEFR levels
- improve common-word ordering outside FLELex
- report common words missing from the dictionary build

### 7. Emit Import Artifacts

Emit at least:

- `data/french-corpus.json`
- `data/french-study-import.json`
- `data/french-lookup-aliases.json`
- an import report with counts, unmatched CEFR rows, ambiguous aliases, and filtered entries

The study import should match the current backend seed/import shape.

## Priority Policy

Rank A1-B2 FLELex words above the dictionary tail.

Suggested bands:

```text
A1: 900000-999999
A2: 800000-899999
B1: 700000-799999
B2: 600000-699999
Common non-FLELex Lexique words: 100000-199999
Dictionary-only words: 1000
```

The exact values are not important. The important invariant is:

- user-required words and manually boosted words can still rise to the top
- A1-B2 default suggestions appear before the dictionary tail
- dictionary-only words remain studyable

## Implementation Notes For Later

Keep this separate from the existing frontend French profile work.

Suggested implementation order:

1. Build source download locations under `data/sources/french/`.
2. Add parsing scripts for Kaikki and FLELex.
3. Emit corpus, study import, alias, and report artifacts.
4. Add the `word_lookup_aliases` schema and import path.
5. Extend add-priority lookup to use aliases.
6. Add ambiguous-candidate API response and frontend chooser.
7. Add focused tests for alias lookup and exact-match precedence.

Tests should cover:

- exact canonical target still works
- alias resolves to one canonical unstudied word
- alias ambiguity returns candidates rather than auto-adding
- aliases do not affect already-studied or non-unstudied words unless explicitly supported
- Mandarin/dev seed behavior is unchanged when no aliases exist
