# French Priority Alias First Cut Plan

## Context

The French reading corpus database already contains canonical `words` rows and a
`word_lookup_aliases` table populated from the corpus build. The first
application change is intentionally tactical: make the existing add-priority
flow alias-compatible for French, while deferring the richer candidate-selection
UX.

Related plan:

- `SPECS/french-reading-corpus-compatibility-plan.md`

## Scope

Update the priority add flow so a submitted French surface form can resolve to
canonical unstudied word rows through `word_lookup_aliases`.

In this first cut:

- Exact canonical lookup still runs first.
- If exact canonical matches are found, add all matching unstudied rows.
- Next, when the backend study profile is French, try alias lookup.
  Note that we perform alias lookup unconditionally, even if an exact
  canonical match was found. We don't want an accidental canonical match to
  mask an alias of the actual word the user intends to study.
- If alias matches are found, add all matching unstudied canonical rows.
- If no exact or alias matches are found, preserve the current not-found
  response.
- Do not add candidate-selection UI or API response shapes yet.

This preserves the current "add all, prune unwanted rows later" workflow and
keeps the implementation easy to reason about.

## Backend Profile Guard

Add a backend study profile config that is explicit but narrow.

Suggested config:

- CLI flag: `--study-profile=french`
- environment variable: `APP_STUDY_PROFILE=french`
- default: `mandarin`

This should live in `server/config.ts`, alongside the existing `mode`,
`data-dir`, `seed-data`, and `port` parsing.

Valid values for now:

- `mandarin`
- `french`

The backend should not broadly branch on this profile. The intended first use is
only to decide whether the add-priority lookup may consult
`word_lookup_aliases`.

Update scripts/docs where useful:

- Add `--study-profile=french` to the French backend command in `package.json`.
- Include the profile in `/api/status` only if helpful for debugging.

## Lookup Normalization

Do lookup normalization in the backend, not the frontend.

Reason:

- The backend owns the database lookup contract.
- The alias table was populated with a corpus-import normalization policy.
- Frontend production-answer normalization is configurable UX behavior and is
  not the same contract as corpus lookup.

Add a small backend helper matching the corpus import policy:

```text
NFC normalize
trim
lowercase
normalize curly/backtick/acute apostrophes to straight apostrophe
collapse internal whitespace
preserve accents
```

This mirrors `normalizeFrenchLookupText` in `scripts/build-french-corpus.ts`.

## DB Behavior

Refactor `addUnstudiedUserPriorityByHanzi` in `server/db.ts` into two
conceptual steps:

1. Resolve target text to unstudied word ids.
2. Apply the existing user-priority add behavior to those ids.

Resolution policy:

1. Trim submitted text.
2. Exact match `words.hanzi = submittedText` for `status = 'unstudied'` and
   collect those word ids.
3. If backend profile is `french`, normalize submitted text with the backend
   lookup helper.
4. For French, query `word_lookup_aliases.normalized_alias = normalizedText`,
   joined to `words`, constrained to `words.status = 'unstudied'`, and collect
   those canonical word ids too.
5. For non-French profiles, skip alias lookup even if alias rows exist.
6. Deduplicate the combined exact and alias word ids, because a submitted value
   may exact-match one canonical row while also alias-matching another, and a
   word may have multiple alias rows for the same normalized alias through
   different relation/source combinations.
7. If the combined set is empty, preserve the current not-found behavior.
8. Return all matched word ids ordered predictably, preferably by source group
   then word priority descending and created-at ascending. Suggested source
   order is exact canonical matches first, then alias matches.

Priority mutation policy should remain the current add behavior:

- Set `bump_count` to at least `1`.
- Preserve stronger existing priority state.
- Preserve existing `required_for_next_session` unless the request requires it.
- Keep excluding non-unstudied words.

## Schema Handling

The French generated DB already contains `word_lookup_aliases`, but the app
schema currently does not create it.

For this first cut, add lightweight schema support in `server/db.ts`:

- `CREATE TABLE IF NOT EXISTS word_lookup_aliases (...)`
- `CREATE INDEX IF NOT EXISTS idx_word_lookup_aliases_normalized_alias ...`
- include `tags_json TEXT NOT NULL DEFAULT '[]'`, matching the current generated
  DB
- use `PRIMARY KEY (normalized_alias, word_id, source)` so relation remains
  metadata rather than part of alias identity

This keeps dev/test DBs able to exercise alias behavior without relying on an
external import script.

Do not require `word_lookup_aliases` rows for Mandarin behavior.

## API Behavior

Keep the existing endpoint:

- `POST /api/priority/unstudied/add-by-hanzi`

Keep the existing successful response shape:

```ts
{
  addedCount: number;
  words: PriorityWord[];
  unstudiedTotalCount: number;
}
```

No candidate response is needed in this round.

The endpoint name can remain `add-by-hanzi` for now to avoid broad churn, even
though UI labels already make the displayed action profile-specific.

## Frontend Behavior

No candidate chooser in this round.

The existing priority page can keep calling `addUnstudiedPriorityByHanzi`.
Search notice copy can remain generic:

- `Added N matching word(s) for "...".`

Because the backend returns all added `PriorityWord` rows, the existing merge
logic should continue to work.

## Tests

Add focused tests under `tests/user-priority.test.ts` or a new nearby test file.

Recommended cases:

1. Exact canonical target still adds all matching unstudied rows.
2. French backend profile includes alias matches even when the submitted value
   also exact-matches an unstudied canonical row.
3. French backend profile deduplicates a word that is reachable through both
   exact and alias lookup.
4. French backend profile resolves a single alias to its canonical unstudied
   word.
5. French backend profile resolves an ambiguous alias and adds all matching
   unstudied canonical rows.
6. Alias lookup excludes non-unstudied canonical rows.
7. Default/Mandarin backend profile does not consult aliases, even if alias rows
   exist.
8. Alias lookup normalization handles case, apostrophe variants, and collapsed
   whitespace while preserving accents.

Minimum verification:

```sh
npm test -- tests/user-priority.test.ts
```

If the test runner does not support file arguments reliably, run:

```sh
npm test
```

## Deferred Work

- Candidate-selection API response.
- Candidate-selection overlay or hover UI.
- Applying the same candidate chooser to Mandarin duplicate canonical matches.
- Renaming the endpoint or client function away from `hanzi`.
- Accent-insensitive lookup keys.
- Broader backend profile-aware behavior outside add-priority alias lookup.

## Open Questions

- Should `/api/status` expose `studyProfile` for debugging startup mistakes?
- Should exact canonical duplicates eventually use the same candidate chooser as
  ambiguous aliases?
- Should alias candidates include relation/tags in future API responses, or is
  canonical word metadata enough?
