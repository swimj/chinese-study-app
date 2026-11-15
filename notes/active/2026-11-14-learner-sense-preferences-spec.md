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

Nothing here is settled. The [decisions](#decisions-for-justin) section lists
what Justin needs to choose; the rest describes the design that follows from
the recommended options. No application code has been written.

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
| Matches no listed sense | Defaults selected, nothing highlighted | See [decision 6](#decisions-for-justin) |
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
| Unmapped and fallback production exercises | Served regardless of sense | Unchanged | They carry no sense to filter on. |
| Answer reveal | Shows mapped sense | Unchanged | It already shows the right thing. |
| Teaching introduction | Shared document over the captured selection | **Hides excluded uses; adds taken-up senses as dictionary-style entries** | See [decision 7](#decisions-for-justin). |
| Teaching exercises | Bound to the introduction | Skips exercises mapped to an excluded sense, if at least one recognition and one production exercise remain | Keeps the existing completeness rule (`server/vocabulary/teaching-readiness.ts:35-44`). |
| General exercise authoring demand | Driven by the shared selection | **Also driven by senses a learner has taken up** | Otherwise a taken-up sense has nothing to practise. See [decision 9](#decisions-for-justin). |
| Recognition | Word level | Deferred | It has no sense binding today. |
| Contrast | Word level | Deferred | Same. |
| Pure cues | Shared selection | Deferred | Accepted answers are shared content; per-learner qualification is a separate policy. |
| Production proxy coverage | Shared selection | Deferred | The contract derives it from the shared repertoire (`SPECS/vocabulary-learning.md:97-101`). |
| Scheduling and mode | Word level | Unchanged | The whiteboard leaves sense-level scheduling open. |
| Retained sessions | Frozen | Unchanged | Required by the architecture contract. |

One known edge from deferring proxy coverage: if a learner excludes the only
sense that has targeted cues, their cues are filtered while the word is still
treated as covered by targeted content. The first PR needs a test that shows
what the learner is then served.

### A new sense on a word already in Practice or Maintain

The whiteboard's answer is a sense-specific override that gives the new sense
teaching while the word stays in its mode. That needs sense-level state this
deliverable does not introduce. The smaller proposal:

- The panel is the teaching moment: it shows the sense's label and notes, and
  the learner's sentence when there is one.
- Taking up a sense requests the existing temporary refresh, which changes
  scheduling without changing mode (`SPECS/vocabulary-learning.md:63`).
- While the refresh is active, selection prefers exercises mapped to the new
  sense.
- If no exercise for that sense exists yet, authoring demand is recorded and
  the word continues as before until content arrives.

This is [decision 8](#decisions-for-justin).

### What this needs from teaching, and what it leaves alone

Needed:

- The introduction can omit a use, and can show a sense that has no authored
  use as a plain dictionary-style entry. The whiteboard already calls the
  dictionary-style sense and example list the baseline teaching material
  (`notes/active/2026-10-15-vocabulary-model-whiteboard.md:182`).

Left alone:

- The shared introduction document, its authoring, and its coherence with its
  exercises.
- The beat sequence, back-navigation and recap.
- All-or-nothing teaching completion.
- Composable beats assembled per sense. That is the better long-term answer to
  a taken-up sense and is welcome, but it is a teaching redesign, not a
  prerequisite here.

## Data and migration

`learner_senses` is sufficient for the model above. It stores exactly the two
dispositions the model needs, and "no row" carries the third.

What it lacks, and how each gap can be covered without a schema change:

| Gap | Cover |
| --- | --- |
| When and where a choice was made | Backend events, the pattern `addVocabularyWord` already uses (`server/db/vocabulary-learners.ts:90-91`) |
| History of changes | The same events |
| Whether the learner has reviewed the word at all | `learner_words.scope_established_at`, already present |
| The context sentence | `learner_words.intended_use_text`, already present |
| Bootstrap requested by an add | A queued row in the existing `vocabulary_sense_readiness` table |
| The resolved target sense | Computed when the panel opens and written only on confirm |

So the deliverable can ship with **no migration**, which keeps it on the
application-only upgrade route (`docs/ops/hosted-beta-deployment.md:85`).

What a migration would add, if wanted:

- `created_at`, `updated_at` and `source` columns on `learner_senses`.
- A table recording each target-sense resolution, so the result survives a
  closed panel and can be audited against its model invocation.

Either makes the release schema-changing, with the quiesce, recovery-point and
rehearsal procedure. This is [decision 10](#decisions-for-justin).

Ownership: `learner_senses` is already registered as learner-private
(`server/db/ownership-manifest.ts:85`). New reads and writes must go through the
learner context and be covered by an isolation test.

## Delivery

A Graphite stack of four PRs. The first three are what the reading interface
needs; the fourth is what makes a taken-up sense worth choosing.

| PR | Contents | Learner-visible |
| --- | --- | --- |
| 1. Scope model | Contract text; effective-scope resolver in `server/db/`; read and write commands with version checks; `GET` and `PUT` for a word's senses; serving filter switched to effective scope | No |
| 2. Sense panel | The panel on stash and My Words rows for established inventories; confirm, reset to default; pending and unavailable states | Yes |
| 3. Add-time flow | Add accepts a context sentence; bootstrap requested on add; target-sense resolution and its prompt; highlighted target | Yes |
| 4. Follow-through | Authoring demand from taken-up senses; introduction omits excluded uses and lists taken-up senses; refresh and preference on Practice and Maintain words | Yes |

Contract changes land with PR 1: a learner-scope section in
`SPECS/vocabulary-learning.md`, a fourth record beside the three in
`SPECS/vocabulary-architecture.md`, and the frontier's content assumption.

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
- Composition and completion coverage, per the testing map, for the teaching
  changes in PR 4.

### Evaluation

- A preview-testbed scenario with words in each panel state.
- Independent UI evaluation of the two flows: add from search, and add with a
  target sense.
- Rendered checks: a one-sense word, a 16-sense word, labels and notes at their
  length limits, the pending and failed states, a narrow panel, enlarged text,
  and keyboard-only use.
- A prompt comparison for target resolution on real sentences, including
  sentences that match no listed sense.

## Decisions for Justin

| # | Decision | Options | Evidence | Recommendation |
| --- | --- | --- | --- | --- |
| 1 | What a confirmation stores | (a) Only deviations from the defaults shown. (b) A row for every sense shown, so the whole choice is sticky. (c) Deviations, plus the target sense as taken up even when it is a default. | Shared defaults keep changing through operator review and reconciliation. Sticky rows cut a learner off from those corrections; no rows at all lets the sense they came for be dropped later. | (c) |
| 2 | Defaults unknown when the panel opens | (a) Wait for the default-selection call. (b) Show every sense unselected. (c) Treat every active sense as selected. | Serving already has a rule for unknown defaults: exclusion-based eligibility (`SPECS/vocabulary-architecture.md:236`). The panel has no equivalent. | (a), using the same pending state as bootstrap |
| 3 | Excluding every sense | (a) Allowed; the word stops mapped production for this learner. (b) Not allowed; at least one sense stays. | Dismissal and production suppression already express "stop studying this" (`SPECS/vocabulary-learning.md:103-116`). | (b) |
| 4 | When an add triggers bootstrap | (a) Every add. (b) Only adds with a context sentence, or when the learner opens the panel. (c) Never; wait for the reserve. | It is the same model call the reserve would make later, so (a) costs extra only for words that never reach teaching. Latency is unmeasured. | (b), after measuring latency from hosted invocation records |
| 5 | Whether the panel opens by itself after a search add | (a) Opens. (b) Stays closed behind a control on the row. | Search adds have no target sense, and batch adds would open several panels. | (b) for search; open automatically only when a caller supplies a context |
| 6 | The sentence matches no listed sense | (a) Record an operator finding and follow defaults. (b) Let the learner create a private sense. (c) Add a canonical sense automatically. | The inventory is shared and operator-governed; the selector cannot create senses (`SPECS/vocabulary-architecture.md:219`). The contract defines no private-content authoring. | (a), keeping the sentence |
| 7 | Teaching a taken-up sense on an unstudied word | (a) Regenerate the introduction for the learner's set. (b) Show the shared introduction plus the sense as a dictionary-style entry. (c) Ignore it in teaching; it appears only in later practice. | The introduction is one shared document. A learner who added the word for that sense would otherwise not see it taught. | (b) |
| 8 | A new sense on a Practice or Maintain word | (a) A sense-level mode override, as the whiteboard sketches. (b) Temporary refresh plus a selection preference. (c) No special handling. | Sense-level scheduling is an open whiteboard question. Refresh already exists and leaves mode alone. | (b) |
| 9 | Shared authoring demand from a learner's taken-up sense | (a) Allowed; the content is shared and carries no learner reference. (b) Not allowed; only the shared selection drives authoring. | The implementation guide says general authoring trusts selected senses "including specialized learning needs" (`docs/vocabulary-learning.md:608`). Without it a taken-up sense has no exercises. | (a), through the existing preparation path and its operator review |
| 10 | Schema | (a) No migration; events carry history. (b) Add timestamps, source and a resolution table. | (a) qualifies for the application-only route. (b) is easier to audit and query. | (a) first; revisit if the events prove awkward to read |

## Not verified

- The real latency and failure rate of sense bootstrap. The hosted invocation
  records for the `sense_inventory` step would answer it.
- How many stashed words in the hosted database lack an established inventory.
- Whether teaching exercises are reliably mapped to senses. The exclusion rule
  for teaching exercises depends on it.
- The details of how proactive repertoire demand is recorded
  (`server/db/proactive-repertoire.ts`), which PR 4 extends.
- Whether the stash and My Words rows have room for the panel; the page
  components were not read in detail.

## Out of scope

- Sense-level scheduling, modes or graduation.
- Learner-authored senses or private content.
- Per-learner pure-cue qualification and proxy coverage.
- Recognition and contrast by sense.
- Composable teaching beats.
- The reading interface itself.
