# Learner sense preferences — build spec

status: active
type: handoff
created: 2026-11-14
retire-when: the decisions below are settled and the first PR is open, or the design is declined
related:
  - SPECS/vocabulary-learning.md
  - SPECS/vocabulary-architecture.md
  - STABILITY_FRONTIER.md
  - notes/active/2026-10-15-vocabulary-model-whiteboard.md

Build spec for letting a learner choose which senses of a word they study. It
is a setup deliverable ahead of the reading interface: a learner who adds a
word because of one sentence should be able to confirm the senses they want,
with the sense they met highlighted. It is also useful alone, because today
every learner studies the same shared selection.

Three points of direction are [settled](#settled-with-justin-2026-11-14). The
[decisions](#decisions-for-justin) section lists what Justin still needs to
choose; where a section depends on an open decision it says so. No application
code has been written.

## Goal and stance

- A learner can take up or exclude senses of a word. Their choice changes which
  sense-mapped work they are served; it changes nothing for other learners.
- Shared content stays shared. The canonical inventory and the default useful
  selection keep their current operator authority. A learner choice is private
  state layered on the shared default.
- Adding a word never waits on a model. The confirmation refines an add that
  has already happened.
- Scheduling and mode stay at word level in this deliverable.
- Retained sessions and history are untouched.

## Settled with Justin (2026-11-14)

1. **Teaching is authored per sense set.** A teaching package covers a word and
   a specific set of senses, and is shared by every learner with that set. The
   default set keeps today's package. A learner-chosen sense is never tacked on
   to another set's package as a bare definition, and an excluded default sense
   is not taught, because it is not in the learner's set. One coherent package
   per set keeps the bridging between senses that current teaching does well.
2. **Repertoire bootstrap looks for missing senses across sets.** Demand for
   general exercises covers senses that learners have taken up, not only the
   shared defaults. A learner excluding a sense never deletes or retires an
   exercise, because content is shared.
3. **Session composition considers the learner's sense set** as well as the
   shared default. Composition is expected to move toward working from a
   snapshot of learner state, so finer-grained reasoning there is acceptable.

Per-learner generated teaching, which could use what is known about the
learner, was considered and set aside for now. It would be the first
learner-private authored content, it cannot be improved by other learners'
reactions or operator repair, and it would test two changes at once.

## Current state (verified in code on 2026-11-14)

### What exists for learner scope

| Fact | Evidence |
| --- | --- |
| `learner_senses` holds one row per learner and sense with `disposition` `active` or `excluded`. Its key is `(learner_id, sense_id)`; it references `learner_words` and `senses`. It has no timestamps, source or history. | `server/db/migrations/0041_vocabulary_learner_state.sql:15-24` |
| No runtime code reads or writes `learner_senses`. The only references are a reconciliation dependency report, the ownership manifest, and tests that insert rows to prove they are preserved. | `server/db/sense-inventory-reconciliation-report.ts:120`; `server/db/ownership-manifest.ts:85`; `tests/bulk-repertoire-apply.test.ts:198-209`; `tests/sense-inventory-reconciliation-apply.test.ts:48,278` |
| `learner_words.scope_established_at` is read into the learner word record and never written. | `server/db/migrations/0041_vocabulary_learner_state.sql:11`; `server/db/vocabulary-learners.ts:59` |
| `addVocabularyWord` accepts an `intendedUseText` and stores it, but neither caller passes one. | `server/db/vocabulary-learners.ts:73-91`; `server/vocabulary/study-routes.ts:105`; `server/db/vocabulary-stash.ts:13-20` |
| Sense reconciliation treats learner sense rows as preserved history and does not block on them. | `server/db/sense-inventory-reconciliation-apply.ts:58`; `server/db/sense-content-reconciliation.ts:52` |
| The whiteboard describes the intended model: learning scope as learner–sense relationships, a stash entry with optional intended senses, and sense-specific overrides. It leaves open what scheduling belongs at sense level and what overrides specify. | `notes/active/2026-10-15-vocabulary-model-whiteboard.md:104-131,397-398` |

### How shared sense selection works today

| Fact | Evidence |
| --- | --- |
| Three shared records: the canonical inventory, the default useful selection (null means unknown, `[]` means explicitly none), and a per-call invocation scope. | `SPECS/vocabulary-architecture.md:197-212` |
| The selection is stored per word in `vocabulary_word_sense_coverage` with a version and immutable history. Only operator or service actors can write it. | `server/db/migrations/0062_vocabulary_sense_coverage.sql:1-25`; `server/db/vocabulary-sense-coverage.ts:44-61` |
| `resolveVocabularySenseCoverage` returns the active senses in the selection, and `selectionEstablished` is false while defaults are unknown. | `server/db/vocabulary-sense-coverage.ts:21-28` |
| General practice serving filters sense-mapped production exercises by that shared selection. Unmapped exercises and non-production skills pass through. | `server/db/vocabulary-content.ts:276-288` |
| Production proxy coverage and pure-cue maintenance also read the shared selection. | `server/vocabulary/production-coverage.ts:30-34`; `server/db/pure-cue-maintenance.ts:124-130` |
| Recognition selection, composition and contrast use only the empty-inventory eligibility rule; they have no other sense awareness. | `server/vocabulary/review-selection.ts:1`; `server/vocabulary/composition.ts:1`; `server/db/vocabulary-sense-eligibility.ts:3-16` |
| A teaching introduction is one shared document authored against the selection captured at preparation. Later selection changes do not retarget it. | `server/word-content/shared-preparation.ts:37-50`; `SPECS/vocabulary-architecture.md:233-240` |
| The introduction renders its uses as a list, one block per use. | `src/features/word-introduction/WordIntroductionExperience.tsx:160` |
| Each served encounter retains the sense its exercise was mapped to. | `server/vocabulary/study.ts:141` |
| The answer reveal shows the mapped sense when there is one. This is the only place a learner sees a sense today. | `SPECS/vocabulary-learning.md:231-234`; `server/vocabulary/reveal-snapshot.ts:28-30` |

### How teaching is keyed today

| Fact | Evidence |
| --- | --- |
| A word has exactly one current bootstrap document and teaching package: `word_introduction_preparation` is keyed by `word_id` alone. | `server/db/migrations/0016_word_introduction_content.sql:96-110` |
| Preparation work is unique per word and stage. | `server/db/migrations/0018_word_preparation_work.sql:2-15` |
| Several documents and packages per word can be stored; only one is current. | `server/db/migrations/0016_word_introduction_content.sql:68-87`; `server/db/word-introductions.ts:577-581` |
| The bootstrap document is authored against the shared selection captured at that moment. | `server/word-content/shared-preparation.ts:37-50` |
| Teaching readiness is resolved from the word alone, for the reserve and for composition. | `server/vocabulary/teaching-readiness.ts:35-47`; `server/vocabulary/preparation-reserve.ts:28-31`; `server/vocabulary/study.ts:233` |
| Repertoire demand computes missing senses from the shared selection only. | `server/db/proactive-repertoire.ts:59-90` |
| Coverage changes never imply retiring an exercise. | `SPECS/vocabulary-architecture.md:280` |

### How an inventory comes to exist

| Fact | Evidence |
| --- | --- |
| `ensureVocabularySenses` establishes an inventory with one model call: `gpt-6-luna`, high reasoning effort, 8,000 output tokens, a 180-second timeout. | `server/vocabulary/sense-readiness.ts:20-22,53-55` |
| The call runs under a five-minute lease with at most three attempts per cycle, retrying after 30 and 60 seconds. | `server/vocabulary/sense-readiness.ts:98,122-123` |
| The same call returns `defaultUseful` per sense, and those become the shared defaults when none exist. | `server/vocabulary/sense-inventory-contract.ts:5-13`; `server/vocabulary/sense-readiness.ts:157-164` |
| An inventory holds at most 16 senses; a label can be 600 characters and a note 1,600. | `server/vocabulary/sense-inventory-contract.ts:7,22-24` |
| A partial, unestablished inventory raises an operator-review error instead of generating. | `server/vocabulary/sense-readiness.ts:94,110` |
| Only teaching-reserve members request bootstrap work. The reserve holds about twice the daily new-word limit, capped at 40. A word stashed outside the reserve has no inventory until it nears admission. | `docs/vocabulary-learning.md:508-511,531-532` |
| Unknown defaults for an established inventory are resolved by a second model call with the same model and timeout. | `server/vocabulary/default-useful-selection.ts:22,31,52` |
| A sense-mapping prompt already exists for binding exercises to senses. | `server/vocabulary/reflection-prompts/sense-mapping.md`; `server/vocabulary/sense-mapping-retry.ts` |

### The add flow today

| Fact | Evidence |
| --- | --- |
| Stash search posts hanzi to `add-by-hanzi`, which adds matching unstudied words and creates learner word state in one transaction. | `server/index.ts:634-678`; `server/db/vocabulary-stash.ts:13-20` |
| When several lexical words match, the client asks the learner to choose among them before adding. | `src/features/priority/usePriorityPageController.ts:30,61,147-191` |
| Learner word writes carry a `state_version` and reject a stale expected version. | `server/db/vocabulary-learners.ts:125-128` |

## Learner-visible model

For each word a learner studies, every active sense is in one of three states:

| State | Meaning | Stored as |
| --- | --- | --- |
| Following the default | The learner has not chosen. The sense is studied if the shared selection includes it. | No row |
| Taken up | The learner wants it, whatever the shared selection says. | `active` |
| Excluded | The learner does not want it, whatever the shared selection says. | `excluded` |

The learner's **effective scope** is: active senses that are taken up, plus
active senses in the shared selection that are not excluded.

What the learner can do:

- See the word's senses (label and notes) with the effective scope marked.
- Take up a sense outside the shared selection.
- Exclude a sense inside it.
- Return a sense to following the default.

Consequences of later shared changes:

| Shared change | Effect on a learner |
| --- | --- |
| A sense is added to the inventory | Follows the default until the learner chooses. |
| A sense is retired | Leaves every effective scope. The row is kept as history. |
| The default selection changes | Applies to senses the learner is following; taken-up and excluded senses keep the learner's choice. |
| A sense is replaced by reconciliation | The choice does not move to the replacement. The frontier requires that identity-bound relationships do not silently transfer (`STABILITY_FRONTIER.md:86-90`). |
| The inventory becomes empty | The word is ineligible for sessions for everyone, as today (`SPECS/vocabulary-learning.md:20-25`). |

How much of a confirmation is stored as explicit rows is
[decision 1](#decisions-for-justin). Whether a learner may exclude every sense
is [decision 3](#decisions-for-justin).

## Add-word confirmation flow

The add itself is unchanged and immediate. The confirmation is a panel attached
to the word just added.

### States of the panel

| Word's shared state | What the learner sees | What happens |
| --- | --- | --- |
| Inventory and defaults established | The senses, with defaults selected and the target sense highlighted and selected | Confirm writes the scope. |
| Inventory established, defaults unknown | A pending state | The existing default-selection call runs; the panel fills when it lands. |
| No inventory | The dictionary gloss and a pending state | Sense bootstrap is requested for this word ahead of the reserve order. |
| Inventory established and empty | The existing ineligible state | No panel. |
| Bootstrap failed or needs operator review | The word stays stashed and follows defaults | Nothing blocks. The choice is offered once the inventory exists. |

"Briefly bootstrap" depends on a call configured for high reasoning effort with
a 180-second timeout. Its real latency has not been measured for this spec. The
flow therefore never waits for it:

- The learner can leave at any point. The word is already stashed.
- The same panel is reachable later from the word's row in the stash and in My
  Words, so a choice missed at add time is not lost.
- While the panel is open the client polls. How long it shows the pending state
  before settling into "available later" should be set from measured latency.

Whether every add triggers a bootstrap, or only adds that carry a context or an
opened panel, is [decision 4](#decisions-for-justin).

### Target sense from a caller

A caller such as the reader supplies the sentence and the span of the word in
it. The add stores the sentence in `intended_use_text`, the column that already
exists for this.

Resolving the sentence to a canonical sense needs the inventory, so it runs
after bootstrap. It is one small model call over the word's senses and the
sentence, with three outcomes:

| Outcome | Panel | Record |
| --- | --- | --- |
| Matches a sense | That sense is highlighted and selected, in addition to the defaults | Written as taken up on confirm |
| Matches no listed sense | Defaults selected, nothing highlighted | See [decision 9](#decisions-for-justin) |
| Unclear | Defaults selected, nothing highlighted | The sentence is kept |

The prompt should descend from the existing sense-mapping prompt and follow
[prompt development](../../docs/prompt-development.md). Model output is
untrusted: the returned sense must be an active sense of that word or the
result is discarded.

### From stash search

The same panel with no target. Defaults are selected and nothing is
highlighted. When several lexical words match, the existing word choice comes
first and the panel applies to each chosen word. Whether the panel opens by
itself after a search add is [decision 5](#decisions-for-justin).

### Writing the scope

- Confirm sends the chosen sense IDs with the learner word's `state_version`
  and the catalog and selection versions the panel showed.
- A stale version is rejected and the panel reloads.
- The write sets `scope_established_at` and emits a backend event carrying the
  before and after scope and the surface it came from.
- Every sense ID must be an active sense of that word. A violation is a client
  contract error and fails loudly.

## Downstream effects

| Consumer | Today | This deliverable | Why |
| --- | --- | --- | --- |
| Mapped general production serving | Shared selection | **Uses effective scope** | This is where a learner's choice is felt. |
| Teaching package | One current package per word, over the shared selection | **One package per word and sense set; a learner is taught from their set's package** | Settled point 1. |
| Teaching readiness, reserve and composition | Resolved from the word | **Resolved from the word and the learner's set** | Settled point 3. |
| General exercise authoring demand | Missing senses within the shared selection | **Missing senses across the shared selection and every taken-up sense** | Settled point 2. |
| Exercise retirement | Never implied by coverage changes | Unchanged; a learner exclusion never retires content | Settled point 2. |
| Unmapped and fallback production exercises | Served regardless of sense | Unchanged | They carry no sense to filter on. |
| Answer reveal | Shows mapped sense | Unchanged | It already shows the right thing. |
| Recognition | Word level | Deferred | It has no sense binding today. |
| Contrast | Word level | Deferred | Same. |
| Pure cues | Shared selection | Deferred | Accepted answers are shared content; per-learner qualification is a separate policy. |
| Production proxy coverage | Shared selection | Deferred | The contract derives it from the shared repertoire (`SPECS/vocabulary-learning.md:97-101`). |
| Scheduling and mode | Word level | Unchanged | The whiteboard leaves sense-level scheduling open. |
| Retained sessions | Frozen | Unchanged | Required by the architecture contract. |

One known edge from deferring proxy coverage: if a learner excludes the only
sense that has targeted cues, their cues are filtered while the word is still
treated as covered by targeted content. The scope-model PR needs a test that
shows what the learner is then served.

### Teaching per sense set

- A set is the learner's effective scope for the word at the time teaching is
  prepared: a sorted list of active sense IDs.
- The default set is the shared selection. Its package is today's package, and
  learners who follow the defaults see no change.
- A learner whose set differs is taught from a package authored for that set.
  The first learner with a given set causes it to be authored; later learners
  with the same set reuse it.
- Each package is authored as a whole, with its own bootstrap document,
  introduction and teaching exercises, so it can bridge its senses.
- Packages are shared content. They carry no learner reference, and they stay
  inside the existing publication, reaction and repair paths.
- A word with a non-default set is not teaching-ready for that learner until
  its package exists. It waits in the stash, as any unprepared word does.
- Teaching completion stays all-or-nothing, and teaching history records which
  package was used, as it does today.

What must change in the code to support this:

- Preparation state and work are keyed by word today. They need a set
  dimension, which is a schema change.
- The bootstrap step captures the shared selection. It needs to accept a
  requested set.
- Teaching readiness, the reserve and composition take the learner's set.
- Compatibility checks that ask "is this the word's current package" become
  "is this the current package for this set".

What stays as it is: the beat sequence, back-navigation and recap; the
authoring prompts, apart from receiving a different set of senses; the rule
that a package needs at least one production and one recognition exercise.

### A sense changed after the word has been taught

Per-set teaching answers the unstudied case. It does not by itself answer what
happens when a learner takes up a sense on a word already in Solidify,
Practice or Maintain, or excludes one. This is
[decision 7](#decisions-for-justin).

## Data and migration

The work splits in two.

**Scope model, panel and add-time flow need no migration.** `learner_senses`
stores exactly the two dispositions the model needs, and "no row" carries the
third. Its gaps can be covered with what exists:

| Gap | Cover |
| --- | --- |
| When and where a choice was made | Backend events, the pattern `addVocabularyWord` already uses (`server/db/vocabulary-learners.ts:90-91`) |
| History of changes | The same events |
| Whether the learner has reviewed the word at all | `learner_words.scope_established_at`, already present |
| The context sentence | `learner_words.intended_use_text`, already present |
| Bootstrap requested by an add | A queued row in the existing `vocabulary_sense_readiness` table |
| The resolved target sense | Computed when the panel opens and written only on confirm |

That part can ship on the application-only upgrade route
(`docs/ops/hosted-beta-deployment.md:85`).

**Per-set teaching needs a migration.** Preparation state and work gain a set
key, and existing rows become the default set for their word. This is a
schema-changing release with the quiesce, recovery-point and rehearsal
procedure. It must preserve every existing package, its publication record and
all teaching history.

Whether the scope-model part should also take a migration for timestamps and a
resolution record is [decision 8](#decisions-for-justin).

Ownership: `learner_senses` is already registered as learner-private
(`server/db/ownership-manifest.ts:85`). New reads and writes must go through the
learner context and be covered by an isolation test.

## Delivery

A Graphite stack of five PRs. The first three are what the reading interface
needs to offer the confirmation; the last two make a custom set fully real.

| PR | Contents | Learner-visible | Migration |
| --- | --- | --- | --- |
| 1. Scope model | Contract text; effective-scope resolver in `server/db/`; read and write commands with version checks; `GET` and `PUT` for a word's senses; general serving filter switched to effective scope | No | No |
| 2. Sense panel | The panel on stash and My Words rows for established inventories; confirm, reset to default; pending and unavailable states | Yes | No |
| 3. Add-time flow | Add accepts a context sentence; bootstrap requested on add; target-sense resolution and its prompt; highlighted target | Yes | No |
| 4. Repertoire demand across sets | Missing-sense demand includes taken-up senses; no retirement from exclusion | No | No |
| 5. Teaching per set | Set-keyed preparation, reserve readiness and composition; authoring for a requested set | Yes | Yes |

Between PR 1 and PR 5, a learner with a non-default set on an unstudied word
has no package for it. How that interim behaves is
[decision 6](#decisions-for-justin).

Contract changes land with PR 1 and PR 5: a learner-scope section in
`SPECS/vocabulary-learning.md`, a fourth record beside the three in
`SPECS/vocabulary-architecture.md`, the per-set teaching rule, and the
frontier's content assumption.

### Tests

- Resolver: unknown defaults, explicit none, a selected set; each crossed with
  no rows, taken-up, excluded, and a retired sense.
- Serving: an excluded sense's mapped production exercise is not served; a
  taken-up sense's is; unmapped exercises are unaffected.
- The proxy-coverage edge described above.
- A retained session composed before a scope change is unchanged.
- Isolation: one learner's scope is invisible to another and does not change
  what the other is served.
- Version conflicts on confirm.
- Reconciliation still preserves learner sense rows.
- Add with a context stores the sentence; a failed bootstrap leaves the word
  stashed and following defaults.
- Target resolution rejects a sense that is not an active sense of the word.
- Demand: a taken-up sense with no exercise creates demand; an exclusion
  creates none and retires nothing.
- Per-set teaching: two learners with the same set share one package; a
  learner on the default set is unaffected by another learner's set; a word
  whose set package is missing is not admitted; the migration preserves
  existing packages and history.
- Composition and completion coverage, per the testing map, for PR 5.

### Evaluation

- A preview-testbed scenario with words in each panel state.
- Independent UI evaluation of the two flows: add from search, and add with a
  target sense.
- Rendered checks: a one-sense word, a 16-sense word, labels and notes at their
  length limits, the pending and failed states, a narrow panel, enlarged text,
  and keyboard-only use.
- A prompt comparison for target resolution on real sentences, including
  sentences that match no listed sense.
- A comparison of packages authored for a default set and for a custom set of
  the same word, judged for whether the custom package still bridges its
  senses.

## Decisions for Justin

| # | Decision | Options | Evidence | Recommendation |
| --- | --- | --- | --- | --- |
| 1 | What a confirmation stores | (a) Only deviations from the defaults shown. (b) A row for every sense shown, so the whole choice is sticky. (c) Deviations, plus the target sense as taken up even when it is a default. | Shared defaults keep changing through operator review and reconciliation. Sticky rows cut a learner off from those corrections; no rows at all lets the sense they came for be dropped later. | (c) |
| 2 | Defaults unknown when the panel opens | (a) Wait for the default-selection call. (b) Show every sense unselected. (c) Treat every active sense as selected. | Serving already has a rule for unknown defaults: exclusion-based eligibility (`SPECS/vocabulary-architecture.md:236`). The panel has no equivalent. | (a), using the same pending state as bootstrap |
| 3 | Excluding every sense | (a) Allowed; the word stops mapped production for this learner. (b) Not allowed; at least one sense stays. | Dismissal and production suppression already express "stop studying this" (`SPECS/vocabulary-learning.md:103-116`). A package cannot be authored for an empty set. | (b) |
| 4 | When an add triggers bootstrap | (a) Every add. (b) Only adds with a context sentence, or when the learner opens the panel. (c) Never; wait for the reserve. | It is the same model call the reserve would make later, so (a) costs extra only for words that never reach teaching. Latency is unmeasured. | (b), after measuring latency from hosted invocation records |
| 5 | Whether the panel opens by itself after a search add | (a) Opens. (b) Stays closed behind a control on the row. | Search adds have no target sense, and batch adds would open several panels. | (b) for search; open automatically only when a caller supplies a context |
| 6 | An unstudied word with a custom set before per-set teaching ships | (a) Hold PRs 2 and 3 until PR 5 is ready. (b) Ship them; such words wait in the stash until PR 5. (c) Ship them; teach from the default package meanwhile. | (c) is the tack-on experience Justin rejected. (b) lets the scope model and panel be used and judged early, at the cost of some words not being admitted. | (b) |
| 7 | A sense changed on a word already taught | (a) Taken-up sense: offer the set's introduction again, without the teaching exercises, then prefer that sense in practice. (b) Temporary refresh and a practice preference only. (c) A sense-level mode override, as the whiteboard sketches. Exclusion in every case just stops that sense's mapped practice. | A bare definition is the experience Justin rejected for unstudied words. Sense-level scheduling is an open whiteboard question. Refresh exists and leaves mode alone (`SPECS/vocabulary-learning.md:63`). | (a), with refresh; but this is a learning-policy choice with little evidence either way |
| 8 | Schema for the scope model | (a) No migration; events carry history. (b) Add timestamps, source and a resolution table. | (a) keeps PRs 1 to 4 on the application-only route. PR 5 needs a migration regardless, so (b) could ride with it. | (a) now; fold (b) into PR 5's migration if events prove awkward |
| 9 | The sentence matches no listed sense | (a) Record an operator finding and follow defaults. (b) Let the learner create a private sense. (c) Add a canonical sense automatically. | The inventory is shared and operator-governed; the selector cannot create senses (`SPECS/vocabulary-architecture.md:219`). The contract defines no private-content authoring. | (a), keeping the sentence |
| 10 | Limits on authoring packages for custom sets | (a) Author for any distinct set. (b) Author only once a set has been requested by some number of learners. (c) Cap the sets per word. | Cost per package is unmeasured. With few learners, (b) would mean custom sets never get taught. | (a), with the count and cost of custom packages reported to the operator |

## Not verified

- The real latency and failure rate of sense bootstrap, and the cost of one
  teaching package. The hosted invocation records would answer both.
- How many stashed words in the hosted database lack an established inventory.
- Whether teaching exercises are reliably mapped to senses.
- How much of the preparation pipeline assumes one package per word beyond the
  two tables and three call sites cited above. The size of PR 5 depends on it.
- Whether the stash and My Words rows have room for the panel; the page
  components were not read in detail.

## Out of scope

- Per-learner generated teaching.
- Sense-level scheduling, modes or graduation.
- Learner-authored senses or private content.
- Per-learner pure-cue qualification and proxy coverage.
- Recognition and contrast by sense.
- Session composition from a learner-state snapshot.
- The reading interface itself.
