# Session reflection workflow capture

status: active
type: research
created: 2026-07-06
retire-by: 2026-07-20
related:
  - notes/archive/2026-07-21-handle-registry-v0-task-spec.md (reflection exemplars and handle inventory input)
  - PLANS/agentic-roadmap-glm-5.2.md (session-evidence bundle pre-spike)

## 2026-07-30 review supersession

The initial integrated dogfood run superseded this research note's field-level
recommendation to expose attempt shape and production-management metadata to
the model. The accepted steel-thread contract is now recorded in
`PLANS/initial-reflection-steel-thread.md`: attempt ids remain validation-only
supplement references, while the provider bundle omits attempt rows, derived
attempt summaries, production relevance, and bad-prompt notes. The older schema
excerpts below remain as research chronology, not current implementation
authority.

## Approach

Conversational capture of what the user actually does after a study session (including selective excerpts from manual LLM chat), rather than a raw paste archive. Output: a structured gist feeding the session-evidence bundle design spike.

## Synthesis for next implementation block

This note has done its research job: it captured the current manual workflow,
the user-visible pain, and enough judgment exemplars to steer a first product
slice. The immediate goal is not to preserve the manual intake/LLM workflow; it
is to build a low-toil reflection loop that can observe a session, explain
notable mistakes, and propose small confirmable adjustments.

### Immediate decisions

1. **Treat reflection as an evidence-backed judgment function.** The product
   should pass session evidence into a reflection step that returns
   observations plus optional proposed adjustments. The reflection result is not
   a new durable backlog by default.
2. **Use flexible reflection items, not a universal word-pair schema.** Most M0
   items will be production mistakes shaped like target + submitted word, but
   the bundle should also support session-scoped notes without a wrong answer.
3. **Capture prompt-as-shown, raw response, and attempt shape explicitly.**
   These are small fields with large diagnostic value. Do not rely on future
   reconstruction when the session already knows what the learner saw and typed.
4. **Add or design for two session-flow affordances:** a "no clue" production
   path, and ephemeral session-scoped item notes. Both improve reflection input
   quality more than another intake triage affordance would.
5. **Keep remediation proposal-based in M0.** The system may suggest prompt
   repair, answer-class acceptance, suppression, contrast enrichment, or no
   change, but user confirmation should remain the application boundary for
   content/policy changes.
6. **Treat "prompt repair" as broader cue repair.** A production prompt should
   not have to express every relevant distinction through a longer English
   gloss. The product should distinguish compact glosses from recall cues:
   anchor glosses, clozes, minimal context, register/domain hints, or other
   triangulation aids that make exact production fair without bloating the
   definition.
7. **Model accepted answer space separately from cues.** Sometimes several
   words are good enough answers for the same cue. The response should be an
   answer class or accepted alternate, not forced prompt narrowing or automatic
   contrast practice.
8. **Separate cue repair from distinction practice.** Prompt-overlap mistakes
   can reveal both an unfair cue and a real learner need to understand the
   Chinese distinction. Fixing the cue makes future grading fair; contrast or
   contextual practice helps the learner acquire the distinction directly.
9. **Allow temporary distinction work.** Some contrast/content proposals should
   be finite remediation episodes rather than permanent cluster commitments:
   short contrast bursts, contextual examples, or cloze practice with a later
   review/retire/keep decision.
10. **Treat production as one vocabulary-depth tool, not a sacred skill.**
   Definition-based production often functions as active recall and memory
   scaffolding. It is useful when it adds dimensions to vocabulary knowledge,
   but the product may improve the cue, widen accepted answers, route to
   contextual/contrast work, or suppress production when exact recall from a
   gloss is not the right exercise.
11. **Do not make production a dictionary-triangulation puzzle.** A production
   cue can be technically unambiguous because several unrelated gloss fragments
   jointly identify the word, while still being unnatural for the production
   skill we want to train. Near term: tolerate this where it is not blocking the
   common flow, but let reflection propose narrower learner-relevant cues when
   the prompt feels overloaded.
12. **Do not require a single remediation philosophy.** Many cases admit more
   than one plausible next step. During dogfooding, it is acceptable to vary
   among plausible interventions or present a ranked short list, then let user
   reaction and future study evidence decide what was actually useful.
13. **Evaluate judgment quality before silence quality.** Initially review every
   production lapse and tolerate noise. The first bar is whether classifications
   and proposals feel sane, cited, and actionable. Later, tune when reflection
   should stay quiet.
14. **Preserve the research examples as calibration/eval material, not training
   data.** They are not for ML fine-tuning in the near term. They are examples
   for prompt shaping, manual QA, regression scenarios, and product vocabulary.

### How to use the examples

The examples should be treated as a lossy calibration set, not a corpus that
needs exhaustive annotation. User color is most valuable when it records
information the system cannot infer:

- what the user felt while answering, such as uncertainty, overactive recency,
  or "I knew this only by training memory"
- whether a distinction feels high-value or low-value for the user's current
  level
- whether the user's preferred intervention is lightweight explanation, contrast
  practice, prompt repair, answer acceptance, or no action
- whether repeated exposure has already shown this is a persistent confusion

General feedback across examples is enough when it changes product policy or
prompting style. Attach notes to a specific example only when the extra color
would change that example's verdict, priority, or proposed remediation.

### Implementation handoff

The next concrete artifact should be a session-evidence bundle design plus a
small reflection-output contract. It should specify:

- input item variants: production mistake, session-note item, and placeholders
  for future contrast-selection signals
- deterministic enrichment sources: prompt/cue-as-shown, stored meanings, matched
  submitted word, contrast/content state, production suppression/bad-prompt
  flags, and recent attempt summaries
- output shape: verdict, confidence/uncertainty, cited evidence, optional user
  observation, and zero or more proposed adjustment handles
- handle vocabulary: no change, repair production cue, accept
  alternate/answer class, suppress production, create/extend contrast content,
  add temporary distinction burst, add cloze/contextual cue, add lightweight
  explanation/gist
- dogfooding feedback capture: accepted, dismissed, deferred, edited, or
  "useful observation but no product action"

The implementation block should not try to solve automatic effectiveness
measurement. For M0, effectiveness is dogfooding feedback plus later ordinary
study evidence. The system should store enough structure that later analysis
can ask whether an accepted intervention reduced repeated mistakes, but it does
not need to automatically prove that before shipping the first loop.

### Proposed initial bundle schema

> **Refinement status (2026-07-11):** This is the source schema and product
> rationale captured from the workflow research. The reconciled implementation
> design, including M0-now versus later boundaries verified against the code,
> lives in [2026-07-10-session-evidence-bundle-design.md](2026-07-10-session-evidence-bundle-design.md).
> Preserve this section as the research baseline; use the later note for the
> active input contract.

The POC schema should be intentionally boring: a session-level envelope plus a
list of reflection items. It should carry enough evidence for grounded
judgment, but avoid modeling every future teaching mode as separate durable
infrastructure.

```ts
type SessionReflectionBundleV0 = {
  schemaVersion: 'session_reflection_bundle.v0';
  generatedAt: string;
  session: {
    sessionId: string;
    startedAt: string | null;
    endedAt: string | null;
    studyProfile: 'mandarin' | 'french';
  };
  items: ReflectionInputItemV0[];
};

type ReflectionInputItemV0 =
  | ProductionMistakeReflectionItemV0
  | SessionNoteReflectionItemV0
  | ContrastSelectionReflectionItemV0;

type ReflectionItemSourceV0 =
  | 'production_mistake'
  | 'session_note'
  | 'contrast_selection';

type ReflectionSourceActionKindV0 =
  | 'recognition'
  | 'production'
  | 'contrast_selection';

type ReflectionItemBaseV0<
  TSource extends ReflectionItemSourceV0,
  TActionKind extends ReflectionSourceActionKindV0 | null,
> = {
  itemId: string;
  source: TSource;
  sourceActionKind: TActionKind;
  sessionActionId: string | null;
  occurredAt: string | null;
  targetWord: ReflectionWordSnapshotV0;
  sessionNote: string | null;
  recentHistory: ReflectionRecentHistoryV0 | null;
  existingContent: ReflectionExistingContentV0;
};

type ProductionMistakeReflectionItemV0 =
  ReflectionItemBaseV0<'production_mistake', 'production'> & {
    cuesAsShown: ReflectionCueSnapshotV0[];
    rawResponse: string;
    submittedWord: ReflectionWordSnapshotV0 | null;
    responseKind: 'matched_known_word' | 'no_clue' | 'unmatched_text';
    attemptShape: {
      firstResponseOutcome: 'incorrect' | 'no_clue';
      resolution:
        | 'recalled_later'
        | 'management_action'
        | 'session_ended'
        | 'unknown';
      terminalRating: 'forgot' | 'hard' | 'good' | 'easy' | null;
      attemptCountForAction: number;
      managementAction:
        | 'dismissed'
        | 'suppressed_production'
        | 'marked_bad_prompt'
        | null;
    };
  };

type SessionNoteReflectionItemV0 =
  ReflectionItemBaseV0<
    'session_note',
    ReflectionSourceActionKindV0 | null
  > & {
    cuesAsShown: ReflectionCueSnapshotV0[];
    relatedWords: ReflectionWordSnapshotV0[];
  };

type ContrastSelectionReflectionItemV0 =
  ReflectionItemBaseV0<'contrast_selection', 'contrast_selection'> & {
    promptAsShown: {
      promptId: string;
      promptText: string;
      explanationShown: string | null;
      choiceWords: ReflectionWordSnapshotV0[];
      selectedWordId: string | null;
      promptTargetWordId: string;
    };
    outcome: 'correct' | 'incorrect';
    reflectionSignal:
      | 'clear_now'
      | 'still_shaky'
      | 'want_more_practice'
      | null;
  };

type ReflectionCueSnapshotV0 = {
  cueId: string | null;
  cueType: 'definition_gloss' | 'cloze' | 'minimal_context' | 'other';
  displayOrder: number;
  text: string;
  displayedMeanings: string[];
};

type ReflectionWordSnapshotV0 = {
  wordId: string;
  hanzi: string;
  pinyin: string;
  meanings: string[];
  production: {
    relevance: 'normal' | 'suppressed' | 'bad_prompt';
    notes: string[];
  };
};

type ReflectionExistingContentV0 = {
  contrastClusters: Array<{
    clusterId: string;
    title: string | null;
    memberWordIds: string[];
    promptCount: number;
    notes: string[];
  }>;
  knownAcceptedAlternates: Array<{
    cueId: string | null;
    acceptedWordIds: string[];
    note: string | null;
  }>;
};

type ReflectionRecentHistoryV0 = {
  lookbackDays: number;
  targetWordId: string;
  relatedWordId: string | null;
  targetWordSummary: string;
  relatedWordSummary: string | null;
  directionalConfusionCount: number;
  bidirectionalConfusionCount: number;
};
```

**Schema notes:**

- History is keyed by word ids. `targetWordId` is always present; `relatedWordId`
  is the submitted/selected/explicitly-related word when there is one. Keep both
  directional and bidirectional confusion counts because "I answered B for A"
  and "these two words are mutually unstable" are related but not identical
  signals.
- `source` means why the item entered reflection. `sourceActionKind` means what
  kind of study action produced the evidence. They overlap for production
  mistakes and contrast-selection reflections, but session notes can attach to
  recognition, production, contrast selection, or no concrete action.
- The generic base type is used to avoid TypeScript's confusing intersection
  pattern where a variant repeats a base field with a narrower literal type.
- `cuesAsShown` is an ordered list because production can layer cues: a compact
  gloss plus a cloze, minimal context, register hint, or other triangulation
  aid.
- `production_cue_overloaded` is a cue-design diagnosis, not a judgment that
  the learner ought to train the meta-skill of triangulating every loose gloss
  fragment. It means the prompt may be technically identifiable but unnatural or
  too dictionary-shaped for production. Common remediations are to narrow the
  production cue to a learner-relevant sense, add a cloze/contextual cue, or
  move broad meaning-spread exposure to recognition/reference.

**POC item inclusion rule:**

```
production mistakes
  ∪ production "no clue" events
  ∪ items with explicit session-scoped notes
  ∪ contrast-selection items with "still shaky" / "want more practice"
```

Contrast-selection items can be omitted from the first code slice if the UI does
not yet expose a useful reflection signal; the schema reserves a place for them
without requiring the first implementation to populate them.

**Output contract:**

```ts
type SessionReflectionResultV0 = {
  schemaVersion: 'session_reflection_result.v0';
  bundleSchemaVersion: 'session_reflection_bundle.v0';
  generatedAt: string;
  itemResults: ReflectionItemResultV0[];
};

type ReflectionItemResultV0 = {
  itemId: string;
  verdict:
    | 'legitimate_lapse'
    | 'content_symptom'
    | 'positive_signal'
    | 'uncertain';
  diagnosisTags: Array<
    | 'prompt_overlap_low_semantic_similarity'
    | 'valid_or_near_valid_alternate'
    | 'production_cue_overloaded'
    | 'form_or_sound_interference'
    | 'overactive_recent_word'
    | 'ordinary_retrieval_noise'
  >;
  learnerObservation: string | null;
  evidence: Array<{
    source: 'cue' | 'response' | 'word_gloss' | 'history' | 'existing_content' | 'session_note';
    summary: string;
  }>;
  proposals: ReflectionProposalV0[];
};

type ReflectionProposalV0 = {
  proposalId: string;
  kind:
    | 'no_change'
    | 'repair_production_cue'
    | 'accept_alternate_answer'
    | 'suppress_production'
    | 'create_or_extend_contrast_content'
    | 'temporary_distinction_burst'
    | 'add_cloze_or_contextual_cue'
    | 'add_lightweight_explanation';
  priority: 'low' | 'medium' | 'high';
  rationale: string;
  targetWordIds: string[];
  draft: ReflectionProposalDraftV0 | null;
};

type ReflectionProposalDraftV0 =
  | {
      suggestedCues: Array<{
        cueType: 'definition_gloss' | 'cloze' | 'minimal_context' | 'other';
        text: string;
      }>;
    }
  | {
      cueId: string | null;
      acceptedWordIds: string[];
      note: string | null;
    }
  | {
      title: string | null;
      memberWordIds: string[];
      temporary: boolean;
      reviewAfterDays: number | null;
      promptDrafts: Array<{
        targetWordId: string;
        promptText: string;
        explanation: string | null;
      }>;
    }
  | {
      text: string;
    };
```

Reflection proposals are suggestions, not automatic mutations. The first UI can
treat `draft` as inspectable data and route only the few implemented proposal
kinds to concrete handlers. A proposal with `draft: null` is still useful when
the reflection can name the direction of action but should not invent content
yet.

**Keep out of M0 unless a case proves it is needed:**

- full raw session timeline
- token-level gloss-fragment modeling
- durable pair objects for every mistake
- automatic effectiveness scoring
- model chain-of-thought or hidden analysis text

**Notes for later consideration:**

- Optional English usage/vibe blurb: a short learner-facing explanation that is
  more specific than a gloss and describes the kind of context where the word
  naturally comes up. This is not needed for most words, but may help some
  learners when a compact gloss and one or two cues still do not carry the word's
  flavor.
- Longer-term production sense model: keep broad reference meanings for
  recognition, reading, listening, compounds, and etymological intuition, but let
  production sample a primary learner-relevant gloss or gloss class. A word may
  eventually have multiple production-relevant sense groups with different cue
  stacks and accepted answer spaces. This should wait until the common
  reflection loop proves the need; M0 should not build full sense modeling.

## Research trail

The sections below preserve the rougher conversational capture and judgment
examples. They remain useful as calibration material, but the synthesis above is
the intentionally lossy handoff for immediate implementation work.

### Round 1 — in-session → intake → LLM thread

**In-session (before session ends)**

- Production mistake → optional **"mark for intake"**: captures target word + incorrect submission as open intake item.
- Production **correct** can still be marked for intake → appears as **singleton** (no wrong answer attached).
  - Typical reason: guessed among similar glosses; wants deeper contrast study later.
  - User retains mental context of which similar words the English gloss evoked.
  - May **immediately** drop similar-meaning words into an ongoing LLM thread to revisit during proper reflection.

**Post-session → intake page**

- User is usually **very behind on intake** → focuses only on **new items** from the session just finished.
- Intake page sorts by **frequency then recency** (already helpful).
- First pass per item: read definitions for each pair.
  - If definitions clearly different → pause, internalize, usually **dismiss**.
  - Rare keep: homophones or persistent confusion → keep for further content enrichment.

**Ongoing LLM thread (top-level standing prompt)**

- Submits lists of words believed close in definition → wants contrast/analysis.
- Single word submission → wants fuller definition (checks whether app dictionary gloss is lacking).

**Decisions flowing from LLM output**

- Judge gloss quality → may **mark bad production prompt**.
- Subjective rarity/utility judgment → may **stop production training** on a word (too rare / not useful at current level).
- May **add contrast selection exercises**:
  - Usually new group.
  - Sometimes add to existing group if user remembers one exists (memory-dependent; has forgotten and had to merge groups).
- Requests **选词填空题** when multiple words → typically ~5 problems.
  - Uses problems for immediate learning.
  - Adds good tests as prompts in cluster editing page.
- Copies per-word **gist/narrowing** from LLM into contrast cluster word entries, e.g. 才干/才能/能力 with register/context/scenario/pairing notes.

**Example LLM output copied into cluster:**

```
才干：实战经验/做事干练/职场管理用"才干"（Competence/Ability to handle affairs）。
才能：天赋才华/智慧特长/艺术科研用"才能"（Talent/Gift）。
能力：通用本领/能不能做/中性描述用"能力"（Ability/Capacity）
```

### Round 2 — gaps, scope, future card types

**Singleton mark-for-intake (correct but uncertain)**

- Only ~5–10% of marks are singletons (correct answer, still marked).
- Mental pressure at mark time is strong → user doesn't think they forget the similar words they were weighing.

**Session-level stats / attempt history**

- **Never pasted** today. Reflection is per-word on intake page, not per-session.
- User acknowledges session stats *could* be useful later when reflection informs session workload/budget analysis.
- Ignored now because: (a) no ability to process it manually, (b) unclear what actionable lever exists even if something were noticed.

**Card types beyond production**

- Production is main trigger **because that's what's built**, not because it's inherently the only reflection surface.
- Contrast selection has latent potential, e.g.:
  - Mark a particular pair within a cluster as tricky
  - Flag a sentence as tricky → want more examples stressing the semantic boundary it straddles
- User is uncertain on concrete UX for these.

**LLM standing prompt**

- Actual prompt: **"帮我生成一些选词填空"**
- LLM inferred pattern: provide basic differentiation info before the fill-in problems when given a list of similar words.
- Possibly emergent from chat history (user was happy with early outputs → model matched pattern); user unsure of exact mechanism.

### Round 3 — skip conditions, intake actions

**When reflection is skipped**

- Skip when **short on time** during/after session.
- Usually catches up later same day or next day for **glaring mistakes** or **obvious bad production prompts** (stored meanings).
- **Heavy labor** (not the quick pass): reading detailed differences, deciding if worth adding to training, judging/copying/pasting exercises into clusters.

**Intake-page actions (all supported in app today)**

- Create contrast groups
- Mark bad production prompt
- Mark production irrelevant (suppress production)
- Dismiss item without further work
- Underlying logic likely reusable as handle implementations later

**Production-irrelevant example**

- Single hanzi mainly known as surnames or used in transliteration (e.g. 俞 "Yu (surname)").
- User values **recognition** only; production feels unnatural or spoiled by gloss.

### Round 4 — reframe: outcome over current workflow

**User correction on gist v1**

- v1 overindexed on smoothing the **current manual flow** (intake queue, mark-for-intake, backlog triage).
- Those are **means**, not the design target. Intake backlog size is a **symptom of toil** — if agentic reflection still manifests as a large user backlog, the product has failed.
- **Actual abstract problem:**

  ```
  {production mistake metadata} → {reflect observations to user, offer adjustments if appropriate}
  ```

- **Ultimate outcome:** judgments on session mistakes (and rarely, specially flagged correct items) to determine:
  - **Legitimate lapse** — learning content is fine; mistake is normal study noise.
  - **Content symptom** — mistake reveals bad/missing/misleading content → offer remediation.
- Do **not** design around persistent intake queue or in-session manual marking as permanent architecture.

### Round 5 — minimal input, enrichment, session co-design

**Typical mistake shape (~80%)**

- Submitted word's presented English gloss is at least fairly easy to confuse with target.
- **Minimal input:** `(target word, submitted word)` — user believes this gets pretty far for judgment.

**Enrichment layers** (deterministic expand + model can gather more):

1. Glosses stored/served for both words (deterministic)
2. Existing contrast-selection or other content for both words (deterministic)
3. Recent study history for holistic view of user's patterns with these words
4. Broader usage context, tones, etc. — deterministic lookup and/or LLM knowledge

Manual experience: enriched pair is already sufficient for judgment.

**M0 evaluation stance**

- Start by reviewing **every lapse** (developer-as-user tolerates noise).
- Use volume of output to evaluate and tune judgment thresholds over time.
- Not optimizing for silence on legitimate lapses yet — calibration first.

**Session ↔ reflection co-design** (we control both flows)

Constraints are architectural / user-behavior / deeply technical — **not** implementation-bound. Declarative mode: propose session-flow changes if they improve the whole loop.

1. **"No clue" production path** — today user must submit something to progress (often dummy `不` or random keystrokes when stumped). Need explicit "don't want to guess" signal — better for product UX *and* reflection (dummy submissions pollute mistake metadata).
2. **Session-scoped item notes** — new concept: meta-thought the user attaches to an item *during this session only* (distinct from persistent per-word personal notes in current product). Optional on any item.

**Initial reflection input heuristic:**

```
all production mistakes in session
  ∪ items with explicit session notes
```

**Mindset:** keep big-picture view of what's possible; session capture and reflection are one system, not reflection bolted onto frozen session UX.

### Round 6 — bundle field confirmations, exemplars next

**Confirmed bundle fields beyond `(target, submitted)`:**

- **Prompt-as-shown** — include explicitly. May be derivable from persisted `show_on_production_prompt` per meaning row (modulo future evolution of that column), but should be materialized in bundle for clarity.
- **Raw response text** — include; minor cases but cheap.
- **Attempt shape** — include; reflection model should consume per-word summary stats (loose plan exists anyway).

**Next:** user to supply judgment exemplars — real cases manually judged — to guide base intuition and prompting (not model training).

**Terminology:** "core pair" = analytic label for the common production-mistake path, not required bundle input format. Reflection items can be pair-shaped, single-word + note, etc.


### Target (what we're designing for)

Post-session reflection is a **judgment function** over study outcomes:

```
{session reflection inputs}  →  {observations for user, proposed adjustments}
```

**Initial input heuristic (M0):**

```
all production mistakes in session
  ∪ items with explicit session-scoped notes
```

Session-scoped notes = new concept: ephemeral meta-thought per item during this session (not the persistent per-word note in today's product). Session flow and reflection are **co-designed** — we can change what the session captures if it improves the whole loop.

For each input item, the agent classifies:

| Verdict | Meaning | User-facing implication |
| --- | --- | --- |
| **Legitimate lapse** | Content is adequate; mistake is normal forgetting/confusion worth studying | Observation optional; no content change |
| **Content symptom** | Mistake is plausibly caused or worsened by bad/missing/misleading study content | Explain why; propose remediation the user can accept/reject |

Today's intake queue, mark-for-intake, and LLM copy/paste are manual workarounds — not the architecture to preserve. Success = **toil goes away**. A persistent reflection backlog as steady state is a product failure, not a design assumption.

### Common case: the "core pair" (~80% of production mistakes)

Most production mistakes involve a submitted word whose **presented English gloss** is fairly confusable with the target's gloss. We use **core pair** as **analytic vocabulary** for this common path:

```
(target word, submitted word) + enrichment → judgment
```

**Not a strict bundle schema.** The pair describes how analysis usually proceeds; it is not the required input shape for every reflection item. Bundle inputs should be **flexible and typed** as the reflection surface expands.

**Example input shapes (non-exhaustive):**

| Shape | When |
| --- | --- |
| Production mistake | target + submitted (+ prompt-as-shown, raw response, …) |
| Single word + session note | User flagged an item with subjective thoughts — no mistake, no pair |
| *(Future)* contrast-selection miss | target pair within cluster, tricky sentence, etc. |
| *(Future)* flagged-correct / uncertain | target + optional confusions noted |

The bundle spike should define a **reflection item** abstraction that carries whatever evidence applies, not assume every item is a word pair.

### Enrichment layers (bundle composition)

Enrichment wraps whatever the input shape is — often a pair, sometimes not.

**Common fields on production-mistake items:**

| Field | Notes |
| --- | --- |
| `targetWordId` | Always for word-anchored items |
| `submittedWordId` / `rawResponse` | When a production mistake (nullable) |
| `promptDisplayedMeanings[]` | Gloss subset user saw; may derive from `show_on_production_prompt` at assembly time |
| `sessionNote` | User's ephemeral meta-thought — can appear **without** a submitted word |
| `attemptShape` | Per-action / per-word summary stats; reflection is a consumer |

**Deterministic expansion** (when relevant words are known):

| Layer | Source | Purpose |
| --- | --- | --- |
| Stored glosses | Word store | Full meaning context beyond prompt-as-shown |
| Contrast & content state | Word/cluster store | Clusters, prompts, gists, flags, production enabled/disabled |
| Per-word study history / summary stats | Attempt events | Trajectory, repeat confusion |
| Linguistic depth | Lookup and/or LLM | Register, collocation, tone when in-app data is thin |

Known gap today: production `response` and prompt-as-shown not persisted on attempt commit — co-design fix needed.


### Session-flow changes to enable better reflection

Not bolt-on constraints — intentional co-design:

| Change | Why |
| --- | --- |
| **"No clue" / skip-guess on production** | Today stumped users submit dummy answers (`不`, random keys) to progress — pollutes mistake metadata and hides true confusion signal |
| **Session-scoped item notes** | User can attach ephemeral meta-thought to any item during study; pulls non-mistake items into reflection when user has something to say |
| *(Future)* flagged-correct / uncertain-right | Rare; session notes may cover much of this without a dedicated flag |

Mark-for-intake becomes unnecessary if mistakes are observable from attempt events and session notes capture explicit user intent.

Correct answers can still be reflection-worthy when the learner reports that the response came from training memory rather than a robust semantic distinction. These should enter reflection through session-scoped notes or a future flagged-correct/uncertain-right affordance, not through the lapse pipeline.

### M0 evaluation stance

- Developer-as-user: **review every lapse** initially — tolerate noise while calibrating judgment quality.
- Feedback loop: volume + user reaction tunes when to speak vs stay silent on legitimate lapses.
- Not optimizing for low noise yet; optimizing for **judgment correctness** first.

### How to treat user-provided judgments

The user's manual interpretation is valuable evidence, not a gold label. Capture both:

- the user's **felt confusion / bias / uncertainty** while answering
- the user's proposed diagnosis or remediation
- a language-aware product interpretation, which may agree, disagree, or ask for more context

This matters because the user is also a learner. Their uncertainty can be the most important signal even when their proposed linguistic explanation is incomplete or wrong.

### Remediation types (outcome vocabulary)

When verdict is **content symptom**, proposed adjustments (future handles):

| Remediation | When | Example |
| --- | --- | --- |
| No change needed | Legitimate lapse, or definitions clearly distinct | More exposure |
| Fix bad production prompt | Gloss/stimulus misleading for production; English overlap hides intensity, register, grammar, or context | Collapsed English gloss; anchor cue cleanup |
| Accept alternate / answer class | Submitted known word is a valid or near-valid answer; exact production from English cue is underdetermined | 难怪 / 怪不得 for "no wonder" |
| Suppress production | Word shouldn't be produced at this level/mode | Surname hanzi 俞 — recognition only |
| Enrich contrast content | Real confusion, insufficient disambiguation content; often preferred for learning semantic boundaries because contextual examples wire in distinctions more strongly than better glosses alone | Register-narrow gists; 选词填空 prompts; 吃惊/震撼 |
| Create or extend contrast group | Semantic, structural, sound, or form similarity is slowing acquisition and needs targeted differentiation | 才干/才能/能力; 舍不得/恨不得 |
| (Future) More boundary examples | Tricky sentence straddles semantic line | Contrast-selection not built yet |

Subjective judgments (rarity, level fit, production naturalness) are first-class dispositions the user confirms.

### Legitimate lapse can still be product-relevant

Some mistakes are legitimate lapses rather than content symptoms, but still suggest a useful **training progression** observation: the learner's basic recall may be present but brittle, and later contextual/example-based practice may help make the word sense robust.

Do not collapse this into "bad prompt" or "needs contrast group" unless the evidence supports that. Possible future product action: after basic recall stabilizes, introduce richer context, example sentences, or minimal-context production to strengthen natural usage.

The target word is the obvious subject of the reflection item, but the submitted word can also be product-relevant when it resolves to a known word. A wrong submission may reveal that the submitted word is overactive, underspecified, or also lacking robust contextual grounding. Reflection and proposed follow-up should be able to mention or adjust either word, while still citing which action produced the evidence.

Do not over-pathologize every substitution between broadly related words. Sometimes the wrong answer is merely from the same abstract semantic neighborhood, while the actual word meanings are far enough apart that no prompt/content intervention is warranted from one miss. In those cases, reflection can simply note "plausible retrieval noise" or stay quiet once calibration moves beyond review-every-lapse mode.

### Valid alternate is not the same as useful contrast

Some production "mistakes" are really **underspecified cue** problems: the submitted known word is acceptable or close enough that an exact-answer failure is not strong evidence of ordinary forgetting. These should be content symptoms, but the remediation may be to accept the alternate, revise the English cue, or change the answer/grading model for that item.

Do not automatically create a contrast drill just because two words overlap. A contrast group is useful when the distinction matters for the learner's level and can be trained with contexts. If the distinction is tiny, optional, or not visible from the app's cue, reflection should be allowed to say "this may not be worth training right now."

Do not automatically suppress production either. Sometimes the learner successfully reached a good member of the answer space, and the useful product action is to credit that as a positive production habit while recording the exact target mismatch as a prompt-modeling issue.

### Gloss overlap can hide a real usage mismatch

Some mistakes are not valid alternates, but the English cue still made the wrong answer tempting. This often happens when several Chinese words share gloss fragments like "shock," "support," "handle," "serious," or "suitable," while differing in intensity, register, grammar, collocation, or event shape.

Reflection should be able to say: "your answer makes sense from the English prompt, but the Chinese words are not actually interchangeable." Gloss/gist cleanup can help make the prompt less misleading and make future direct production fair. But for reinforcing a semantic boundary, contrast selection is often the preferred learning intervention: grappling with contextual examples can wire in the distinction much more strongly than encoding increasingly precise English glosses. The system should consider both, but should not give gloss repair primacy when the user's goal is to internalize usage.

Note for this capture: the development repo only has a small test/dev slice of gloss data. Real study glosses live outside the repository, so exemplar interpretation should rely on the supplied case details rather than repo search.

Multi-gloss prompts need special care. If a prompt shows several English gloss fragments, the submitted answer may be tempting because it matches one fragment but still invalid for the intended target's full sense bundle. Reflection should be able to identify "matched one cue fragment" separately from "fully acceptable answer." This points toward per-sense or per-cue answer classes where appropriate, but also toward diagnosing weak **sense triangulation**: the learner has not yet learned how the gloss fragments jointly constrain the word.

Contrast selection can be useful for sense triangulation. A few contextual choices may flesh out how multiple English glosses converge on the target word better than another gloss rewrite would. But this carries an overtraining risk: if prompts are too artificial or too narrowly keyed to the dictionary distinction, the learner may get better at the drill without gaining broadly useful language instinct. Prefer light, context-rich contrast bursts and watch whether later ordinary production/recognition improves.

Long gloss lists may need an anchor. When one or two glosses carry the target's core usage distinction, the prompt should make those anchors salient instead of leaving the learner to average across every English fragment. Otherwise generic fragments like "combine," "compose," "standard," or "logo" can overpower the sense that actually distinguishes the word.

### Production cues may need answer classes

Definition-based production is not always one gloss -> one word. Some prompts naturally map to a small class of valid or near-valid target words. The product may eventually need a many-to-many model between production cues/glosses and acceptable answers, separate from contrast clusters.

Potential future handle:

- create or extend a **production answer class** for a cue/gloss
- attach target words that should be accepted for that cue
- optionally store a short subtlety note explaining differences inside the class

This differs from suppressing production: the system can still train the valuable habit of reaching for an appropriate expression. It also differs from contrast training: subtle connotation notes may be learner-interesting even when no immediate scheduling or drill change is warranted. Much later, high-level learners could opt into refining exercises that distinguish members of an answer class.

### Contrast can target form interference, not just semantic overlap

Contrast practice is useful when words are genuinely competing in the learner's mind. That competition may come from meaning overlap, but it can also come from similar structure, sound, character shape, rhythm, or phrase pattern.

Some pairs are **clearly different in meaning** yet still slow to acquire because the learner's retrieval system keeps blending them. In these cases, reflection should not frame the issue as a bad prompt or valid alternate. A few targeted contrast rounds may solidify the distinction, after which ordinary SRS spacing can naturally reduce the burden as confidence improves.

### How the user does this today (reference only)

Manual pipeline approximating the target function — see conversation notes rounds 1–3. Key pain: labor is in **judging lapse vs symptom and applying fixes**, not queues per se.

### Bundle spike implications

**Design for:**

- Flexible **reflection items** with typed input shapes (production mistake, word + session note, …) — not a universal pair schema.
- Deterministic enrichment from glosses, content state, attempt history where applicable.
- Lapse vs symptom classification with cited evidence.
- Structured, confirmable adjustment proposals — not a backlog UI.
- Session notes as first-class input, including without a mistake pair.

**Do not design for:**

- Persistent intake queue as agent output surface.
- In-session manual marking as permanent capture.
- Large reflection backlog as normal operation.
- Preserving dummy-guess submissions as meaningful mistake signal (session UX should fix this).

**Open questions for bundle spike:**

- What attempt-event fields give us production mistake evidence cleanly today?
- How complete are gloss + contrast-cluster lookups for arbitrary word pairs?
- What study-history window/context helps disambiguate one-off lapse vs persistent confusion?
- Session note schema: free text only, or structured tags later?

### Deferred (not M0 reflection core)

- Session-level workload/budget analysis from aggregate patterns.
- Contrast-selection in-session reflection (tricky pair, tricky sentence).
- Tuning silence rate on legitimate lapses (after judgment calibration).

### Judgment exemplars

*(Manual cases the user has judged — guides prompting intuition, not training data.)*

Capture format per example:

```
Target / prompt-as-shown → submitted (raw)
Verdict: lapse | symptom
Why: …
Remediation (if symptom): …
```

---

*(examples below)*

### Example 1 — 概括 → 提要

```
Target / prompt-as-shown -> submitted (raw)
概括 / to summarize; to generalize; briefly; in broad outline -> 提要
Submitted word gloss: summary; abstract
```

**User interpretation:** likely a legitimate lapse, not a content failure. 提要 is relatively new to the user, both in real life and in SRS, so it was cognitively "available." The user saw "to summarize; to generalize" and jumped quickly to 提要. User uncertainty: maybe 提要 is noun-only, though Mandarin noun/verb boundaries can be fluid.

**Language/product read:** treat as a **legitimate lapse with robustness signal**, not an immediate remediation case. The prompt is plausibly fair: 概括 is the target verb-like action "to summarize / generalize," while 提要 is at least strongly noun-like as "summary / abstract" in the user's stored gloss. The mistake reveals a brittle lexical boundary and recency/new-word bias more than an obviously bad production prompt.

**Product-model signal:** reflection should preserve learner-state explanations like "newly learned submitted word was overactive" and "part of speech / usage-role boundary felt unclear." The useful action may be no content change now, but later contextual examples or minimal-context production once basic recall is stable. This should not be target-only: both 概括 and the submitted known word 提要 may deserve similar robustness-building treatment.

**Remediation:** no immediate content change. Possible future progression handle: schedule or generate contextual examples that force the learner to use 概括 and/or 提要 naturally, rather than only recalling from English glosses.

### Example 2 — 难怪 → 怪不得

```
Target / prompt-as-shown -> submitted (raw)
难怪 / (it's) no wonder (that...); (it's) not surprising (that) -> 怪不得
Submitted word gloss: no wonder!; so that's why!
```

**User interpretation:** maybe these are almost fully interchangeable. If there are native-speaker-salient differences, the user does not know what they are, how to train them, or whether they matter at the user's current level.

**Language/product read:** treat as a **content symptom: underdetermined prompt / valid alternate**, not a simple lapse. 难怪 and 怪不得 are virtually interchangeable for the "no wonder / so that's why" usage, with only subtle native-speaker connotation preferences. The supplied English cue does not encode a clear distinction, so deeming 怪不得 simply wrong is too harsh. There may be usage-shape differences worth mentioning later, but they are not recoverable from this production prompt.

**Product-model signal:** reflection needs a lane for exact-answer failures where the submitted answer is acceptable. The right action may be to create or extend a production answer class: one cue/gloss can accept multiple words. This preserves the positive skill signal, because instinctively reaching for either 难怪 or 怪不得 is useful. This is not automatically a contrast-content request: if the distinction is too slight or low-value for the learner now, forcing a contrast drill may add toil without much learning value.

**Remediation:** accept 怪不得 as a valid answer for this cue, likely by attaching both 难怪 and 怪不得 to the same production answer class. Optional learner-facing note: they are nearly interchangeable, with subtle connotation differences that can be mentioned without changing session scheduling. Much later, optional refinement exercises could distinguish them for high-level learners.

### Example 3 — 舍不得 / 恨不得

```
Target / prompt-as-shown -> submitted (raw)
舍不得 / to hate to do sth; to hate to part with; to begrudge -> 恨不得
Submitted word gloss: wishing one could do sth; to hate to be unable; itching to do sth
```

**User interpretation:** clearly different meanings, but the pair has been slow to acquire because of similarity in structure, sound, and general phrase shape. User lightly leans toward a small number of contrast exercises: a few rounds might solidify the distinction, then ordinary SRS spacing can take over and lighten the load as confidence improves.

**Language/product read:** treat as a **content symptom: contrast-worthy form/structure interference**, not a bad prompt and not a valid alternate. 舍不得 is about reluctance to part with something or reluctance to do something because of attachment/cost; 恨不得 is about intensely wishing one could do something immediately. The semantic difference is real and useful, but the surface similarity makes retrieval interference plausible.

**Product-model signal:** contrast groups should not be limited to near-synonym clusters. Reflection should be able to propose contrast practice for pairs whose meanings are distinct but whose form, sound, structure, or phrase rhythm causes persistent learner confusion. The desired intervention can be intentionally light: a short contrast burst, then let SRS time dilation reduce future appearances if performance stabilizes.

**Remediation:** create or extend a contrast group for 舍不得 / 恨不得 with a few targeted prompts that force the different desire/reluctance frames. Suggested handle shape: `create_or_extend_contrast_group` plus an optional low-intensity / short-burst scheduling hint.

**Quick related pairs in this lane:**

- **必需 / 必须** — same sound, semantically adjacent, but not grammatically interchangeable. Good example of a contrast where the learner needs grammatical-role separation, not just meaning separation.
- **考查 / 考察** — same sound, roughly similar broad semantic area, grammatically interchangeable as verbs, but different usage contexts. Good example of a contrast where context/collocation carries the useful distinction.
- **擅长 / 善于** — similar sound and similar learner-facing glosses, but native-speaker usage distinctions can be salient. Good example of a pair where English gloss overlap may hide a real usage distinction.

Product signal from the set: a contrast suggestion should be able to name the likely interference axis (`same sound`, `similar phrase shape`, `grammar role`, `usage context`, `gloss overlap`) and propose a small number of prompts targeted to that axis.

### Example 4 — 吃惊 → 震撼

```
Target / prompt-as-shown -> submitted (raw)
吃惊 / to be startled; to be shocked; to be amazed -> 震撼
Submitted word gloss: to shake; to shock; to stun; shocking; stunning; shock
```

**User interpretation:** open question; curious what this case means.

**Language/product read:** likely a **content symptom: gloss overlap hides intensity/register/context**, not a clean valid alternate. 吃惊 is the ordinary "be surprised / startled" reaction. 震撼 is much stronger: to shake or deeply shock/stun, often used for powerful emotional impact, spectacle, news, art, history, etc. The English words "shocked" and "amazed" overlap enough that the submitted answer is understandable from the prompt, but in Chinese the words are not generally interchangeable.

**Product-model signal:** reflection needs a distinction between "submitted answer is acceptable" and "submitted answer is explainable because the English cue was too broad." A language-aware reflection could say: "your answer followed the English gloss, but 震撼 carries a much stronger impact/awe sense." The product response should not stop at better gloss text if the user's real need is semantic boundary reinforcement.

**Remediation:** prefer a small contrast set that separates ordinary surprise from strong emotional impact; also revise the prompt/gist for 吃惊 toward "to be surprised/startled" and reserve "deeply shocked/stunned/awe-struck" for 震撼 so future direct production is fair. The learning value is expected to come mainly from contextual contrast, not from perfecting English glosses.

### Example 5 — 在意 / 介意

```
Target / prompt-as-shown -> submitted (raw)
在意 / to care about; to mind -> 介意
Submitted word gloss: to care about; to take offense; to mind
```

**User interpretation:** high-value case. User's gut says there is a real difference, but would want an LLM or native speaker to help articulate and train it.

**Language/product read:** likely a **content symptom: high-value semantic boundary hidden by English gloss overlap**. Both can map to "mind/care," but they are not interchangeable. 在意 is broader: to care about, be concerned with, pay attention to, or be emotionally affected by something. 介意 is narrower and more interactional: to mind/object to something, be bothered by it, or take offense. Rough intuition: 我不在意 can mean "I don't care / it doesn't matter to me"; 我不介意 means "I don't mind / I have no objection."

**Product-model signal:** this is a strong example where contrast selection is likely more valuable than gloss polishing alone. The English overlap is real, but the distinction matters for natural usage and can be taught efficiently with context choices. Reflection should be able to recognize "user highly values this boundary" as a prioritization signal.

**Remediation:** create or extend a contrast group for 在意 / 介意 with prompts contrasting indifference/concern vs objection/offense. A short note on the member entries would be useful: 在意 = care/pay attention/be concerned; 介意 = mind/object/take offense. Keep prompts context-rich and practical.

### Example 6 — 落成 → 建成

```
Target / prompt-as-shown -> submitted (raw)
落成 / to complete a construction project -> 建成
Submitted word gloss: to establish; to build
```

**User interpretation:** not supplied yet.

**Language/product read:** likely a **content symptom: underdetermined construction-completion cue / near-valid alternate**. 建成 is very plausible for "complete a construction project": it means to finish building or have built something. 落成 is narrower and more formal, often used for the completion or completion-and-opening/inauguration of a building or construction project. If the prompt only says "to complete a construction project," 建成 may be acceptable, or at least close enough that marking it simply wrong feels too harsh.

**Product-model signal:** answer classes may need to be cue-specific and register-aware. A broad cue like "complete a construction project" can reasonably point to multiple construction-completion verbs. If the intended target is 落成, the prompt likely needs an anchor such as "formal completion/opening of a building/project" rather than just completion.

**Remediation:** either accept 建成 for the broad cue or revise the cue for 落成 toward "be completed / formally opened (of a building or construction project)" so grading is fair. If the learner wants the boundary, use a small contrast set to separate 建成 as ordinary completion of construction from 落成 as formal project/building completion.

### Example 7 — 给（jǐ） → 供应

```
Target / prompt-as-shown -> submitted (raw)
给（jǐ） / to supply; to provide -> 供应
Submitted word gloss: to supply; to provide (goods, services etc)
```

**User interpretation:** not supplied yet.

**Language/product read:** likely a **content symptom: underdetermined cue / context-specific near alternate**. 供应 is very plausible for "to supply; to provide," especially when goods, services, resources, or provisioning are involved. 给（jǐ） is broader and more general as "supply/provide/give," and the pinyin distinction from 给（gěi）matters. Without a context or an anchor gloss, the prompt does not clearly distinguish the general verb from the more provisioning-flavored 供应.

**Product-model signal:** prompts for polyphonic or broad words may need stronger anchors and sometimes explicit pinyin/context evidence. The bundle should preserve pinyin-as-shown when it is part of the prompt disambiguation. Reflection should be able to propose a cue split: broad `give/provide` sense vs goods/services supply sense.

**Remediation:** either accept 供应 for some supply/provide cues, or revise the cue for 给（jǐ） to include a broader/general-provide anchor so grading is fair. If the goal is to learn the jǐ reading and its boundary with provisioning verbs, prefer contextual examples or contrast prompts using 给/供给/供应-style contexts rather than relying on a bare English gloss.

### Example 8 — 习以为常 / 习惯

```
Reflection item shape
Correct production + session note / flagged-correct uncertainty

Target / prompt-as-shown
习以为常 / accustomed to; used to
Related word raised by user: 习惯
```

**User interpretation:** got the item right via training memory, but does not know how 习以为常 differs from 习惯.

**Language/product read:** treat as a **correct answer with unresolved semantic boundary**, not a lapse. 习惯 is broad: to be used to, to get accustomed to, habit/custom. 习以为常 is more idiomatic and means becoming so used to something that one regards it as normal/common and no longer surprising. Rough contrast: 我习惯早起 = I am used to getting up early; 对这种噪音已经习以为常 = I have grown used to this noise and treat it as normal.

**Product-model signal:** reflection should not only respond to failures. A correct answer can reveal brittle knowledge when the learner explicitly flags uncertainty. The action is explanation/contrast enrichment, not grading repair.

**Remediation:** add a note or contrast prompt distinguishing broad habit/accustomedness (`习惯`) from normalized-as-unsurprising idiomatic familiarity (`习以为常`). This could be a lightweight explanation rather than scheduled practice unless the user values the distinction or repeats the uncertainty.

### Example 9 — 规范 → 指标

```
Target / prompt-as-shown -> submitted (raw)
规范 / norm; standard; specification; regulation; rule; within the rules; to fix rules; to regulate; to specify -> 指标
Submitted word gloss: (production) target; quota; index; indicator; sign; signpost; (computing) pointer
```

**User interpretation:** likely a true lapse. The words are vaguely in the same broad semantic ballpark, but still far apart.

**Language/product read:** treat as a **legitimate lapse / semantic-neighborhood retrieval error**, not a content symptom from one occurrence. 规范 points toward norms, standards, rules, and regulating/specifying behavior. 指标 points toward measurable indicators, quotas, targets, or indices. They can both live around "standards/measurement/administration" in a learner's mental map, but they are not close enough that the prompt is obviously unfair or the submitted word should be accepted.

**Product-model signal:** reflection needs a low-drama lane for wrong submissions that are explainable but not product-actionable. The submitted word's semantic neighborhood can explain the lapse without implying bad content, answer-class modeling, or contrast content. Repetition could change that judgment, but a one-off should probably stay as ordinary study evidence.

**Remediation:** no immediate content change. Let normal SRS/review handle it unless repeated attempts show a persistent 规范 / 指标 confusion pattern.

### Example 10 — 熏制 / 烤制

```
Target / prompt-as-shown -> submitted (raw)
熏制 / [not captured] -> 烤制
Submitted word gloss: [not captured]
```

**User interpretation:** clear lapse.

**Language/product read:** treat as a **legitimate lapse** from one occurrence. Both words are cooking/preparation process terms and may be nearby in memory, but smoking/curing and roasting/baking/grilling are distinct enough that no immediate content action is implied without repeated evidence.

**Product-model signal:** keep calibration examples where reflection should do little or nothing. Even when two submitted/target words share a domain, a single miss may be ordinary retrieval noise rather than a cue problem or contrast-content opportunity.

**Remediation:** no immediate content change.

### Example 11 — 物品 → 产品

```
Target / prompt-as-shown -> submitted (raw)
物品 / articles; goods -> 产品
Submitted word gloss: goods; merchandise; product
```

**User interpretation:** not supplied yet.

**Language/product read:** likely a **content symptom or light lapse: gloss overlap hides category boundary**. 产品 is a product, merchandise, or produced good; 物品 is broader: item, object, article, or goods in the sense of things. The shared "goods" gloss makes 产品 understandable, but the words are not fully interchangeable.

**Product-model signal:** another anchor-gloss case. A production cue for 物品 probably needs "item/object/article" as the anchor, while 产品 anchors on "product/merchandise." If the prompt shows only "articles; goods," the learner may not know whether the intended word is broad thing/item or commercial product.

**Remediation:** prefer a tiny contrast set distinguishing general things/items from produced/commercial goods; also foreground anchor glosses so future direct production is fair: 物品 = "item; object; article"; 产品 = "product; merchandise."

### Example 12 — 商标 → 标志

```
Target / prompt-as-shown -> submitted (raw)
商标 / trademark; logo -> 标志
Submitted word gloss: sign; mark; symbol; logo; to symbolize; to indicate; to mark
```

**User interpretation:** not supplied yet.

**Language/product read:** likely a **content symptom: weak sense triangulation from a multi-gloss cue**. Assuming "trademark; logo" is accurate for 商标, 标志 should not simply be accepted: a native speaker would not treat 标志 as "trademark." The mistake is still explainable because 标志 matches the "logo/sign/symbol" part of the cue space, but the full prompt should have constrained the answer toward the commercial/legal brand-mark sense.

**Product-model signal:** reflection needs to reason at the cue-fragment or sense level. This is not exactly the same as 难怪/怪不得, where both words can satisfy the same cue. Here, one gloss fragment invites the submitted word, while the full gloss bundle distinguishes the target. The revealed weakness may be the learner's ability to triangulate multiple glosses into a precise word sense, not simply a bad cue or a valid alternate.

**Remediation:** prefer a light, context-rich contrast set that fleshes out 商标 as trademark/brand mark vs 标志 as general sign/symbol/logo; also revise the production cue for 商标 toward "trademark; brand mark" so future direct production is fair. Keep the contrast prompts practical to avoid overtraining the dictionary distinction rather than useful language behavior.

### Example 13 — 合成 → 组合

```
Target / prompt-as-shown -> submitted (raw)
合成 / to compose; to constitute; compound; synthesis; mixture; synthetic -> 组合
Submitted word gloss: to assemble; to combine; to compose; combination; association; set; compilation; (math.) combinatorial
```

**User interpretation:** not supplied yet.

**Language/product read:** likely a **content symptom: weak sense triangulation / broad gloss overlap**. 组合 is a very understandable submission from "to compose / combine / combination." But 合成 carries a stronger sense of synthesis: combining components into a new whole, compound, synthetic product, or composited result. 组合 is more about arranging/combining items as a group or combination; it does not by itself carry the same synthesis/compound/synthetic force.

**Product-model signal:** this reinforces the need for anchor glosses. A long prompt containing both generic overlap ("compose") and distinguishing anchors ("synthesis," "compound," "synthetic") can invite the learner to pick a broad neighbor instead of triangulating the target's core sense. Reflection should diagnose whether the learner missed the anchor, not simply mark the submitted word as a near synonym.

**Remediation:** prefer a light contrast set separating 合成 as synthesis/new whole from 组合 as arrangement/combination/grouping; also revise the cue/gist for 合成 to foreground "synthesize; synthetic; form by combining parts" and de-emphasize generic "compose" unless context is supplied.

### Example 14 — 四周 → 四处

```
Target / prompt-as-shown -> submitted (raw)
四周 / all around -> 四处
Submitted word gloss: all over the place; everywhere and all directions
```

**User interpretation:** not supplied yet.

**Language/product read:** likely a **content symptom: spatial gloss overlap hides reference-frame distinction**. 四周 means around/surrounding a reference point or on all sides. 四处 means everywhere, in various places, all over, or in all directions. The submitted word is understandable from "all around," but it shifts from a surrounding perimeter/reference-frame idea to a dispersed-everywhere idea.

**Product-model signal:** anchor glosses are not only about technical senses; they can capture spatial frame. A cue like "all around" may need an anchor such as "on all sides / surrounding" for 四周, while 四处 anchors on "everywhere / all over / in various places." Reflection should be able to name this interference axis as reference-frame vs dispersion.

**Remediation:** add a tiny contrast set: "people stood around the house" -> 四周, versus "looked everywhere for it" -> 四处. Also foreground anchor glosses for the two words so future direct production is fair.

### Example 15 — 失望 → 灰心

```
Target / prompt-as-shown -> submitted (raw)
失望 / disappointed; to lose hope; to despair -> 灰心
Submitted word gloss: to lose heart; to be discouraged
```

**User interpretation:** not supplied yet.

**Language/product read:** likely a **content symptom: emotional gloss overlap hides stance/action-readiness distinction**. 失望 is disappointment or loss of hope, often toward an outcome, person, situation, or expectation. 灰心 is losing heart / becoming discouraged, often emphasizing motivation dropping and not wanting to continue. The submitted word is understandable from "lose hope/despair," but it shifts from disappointment about something to discouragement in one's will to keep going.

**Product-model signal:** contrast suggestions should be able to name an emotional/psychological interference axis, not just concrete semantic categories. Here the useful axis is disappointment/evaluation vs discouragement/motivation. English glosses like "despair," "lose hope," and "discouraged" can overlap heavily even when the Chinese words profile different mental states.

**Remediation:** prefer a small contrast set separating "I was disappointed in the result/person" from "I got discouraged and wanted to give up." Also foreground anchor glosses: 失望 = "disappointed; hopes not met"; 灰心 = "discouraged; lose heart to continue."
