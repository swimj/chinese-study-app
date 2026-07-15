# Session-evidence bundle design (M0)

status: active
type: research
created: 2026-07-10
retire-by: 2026-07-24
related:
  - TASKS.md (Ready — session-evidence bundle design spike)
  - PLANS/agentic-roadmap-glm-5.2.md (M0 session-evidence bundle spike)
  - notes/active/2026-07-06-session-reflection-workflow.md
  - notes/active/2026-07-10-session-lifecycle-code-verification.md
  - SPECS/study-action-model.md

## Decision

This note refines—not replaces—the July 6 workflow capture. The input shape
is a **session-level bundle containing reflection items**, where each item has
word-level context and an ordered list of the attempts for its source action:

```text
completed session
  -> SessionReflectionBundleV0
       -> ReflectionInputItemV0[]
            -> target/related word context + prompt/cue as shown
            -> ordered attempts for that item’s action
```

The first prototype sends one bounded batch of qualifying items from a session
to one reflection call. This preserves cross-word discoveries—such as two
similar words clashing during the same session—while the inclusion rule keeps
the prompt small. The implementation may split an unusually large session into
several batches later without changing the item model.

The bundle is an application/LLM input contract, not a database entity. The
frontend collects live facts that would otherwise disappear; the backend
validates and enriches them, then calls the LLM using server-side credentials.
M0 neither persists bundles nor exposes a bundle-read endpoint.

## Scope boundary

This document owns the reflection **input** model and its M0 delivery boundary.
It deliberately does not define detailed result/proposal or handle payloads.
The next handle-registry task owns the constrained operations, proposal
lifecycle, and detailed initial handle schemas.

Evidence belongs to its source session. This does not require the learner to
consume its resulting remediation immediately: once reflection artifacts exist,
their proposals may be deferred and processed alongside artifacts from later
sessions.

## M0 delivery path

```text
React session controller
  - records the initial prompt/cue as shown, raw response, ordered action
    attempts, and optional session notes
  - after normal completion or happy-path drain, POSTs the eligible items

Express backend
  - checks session/action identity and enriches words/content/policy state
  - constructs the session bundle and calls the LLM with server-only credentials
  - returns a structured reflection result

React reflection UI
  - M0 shows or skips the result; later artifact UI can defer it
```

The frontend must not call the LLM provider directly: provider credentials
belong on the backend. The backend may query the persistence layer for
enrichment, but that does not make the bundle a stored database object.

M0 is best-effort for natural completion and ordinary happy-path drain only.
Navigation-away recovery and replayable reflection are explicitly deferred;
they must never affect the correctness of study commits or scheduler state.

## Input schema

All timestamps are UTC ISO-8601 strings. `itemId` is stable only within the
bundle. `attemptId` is the client-stable attempt-event id when one exists;
future non-review attempt paths may initially use a client-generated id until
they acquire the same durable event support.

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
  targetWord: ReflectionWordSnapshotV0 | null;
  sessionNote: string | null;
  existingContent: ReflectionExistingContentV0;
};

type ProductionMistakeReflectionItemV0 =
  ReflectionItemBaseV0<'production_mistake', 'production'> & {
    targetWord: ReflectionWordSnapshotV0;
    cuesAsShown: ReflectionCueSnapshotV0[];
    rawResponse: string | null;
    submittedWord: ReflectionWordSnapshotV0 | null;
    responseKind: 'matched_known_word' | 'no_clue' | 'unmatched_text';
    attempts: ReflectionActionAttemptV0[];
    attemptShape: ReflectionAttemptShapeV0;
  };

type SessionNoteReflectionItemV0 =
  ReflectionItemBaseV0<'session_note', ReflectionSourceActionKindV0 | null> & {
    cuesAsShown: ReflectionCueSnapshotV0[];
    relatedWords: ReflectionWordSnapshotV0[];
    linkedAttemptId: string | null;
  };

type ContrastSelectionReflectionItemV0 =
  ReflectionItemBaseV0<'contrast_selection', 'contrast_selection'> & {
    targetWord: ReflectionWordSnapshotV0;
    promptAsShown: {
      promptId: string;
      promptText: string;
      explanationShown: string | null;
      choiceWords: ReflectionWordSnapshotV0[];
      promptTargetWordId: string;
    };
    attempts: ReflectionActionAttemptV0[];
    reflectionSignal: 'clear_now' | 'still_shaky' | 'want_more_practice' | null;
  };

type ReflectionActionAttemptV0 = {
  attemptId: string;
  occurredAt: string;
  actionAttemptSequence: number;
  outcome: 'correct' | 'incorrect';
  rating: 'forgot' | 'hard' | 'good' | 'easy' | null;
  response: string | null;
  // For production this is typed text (null for no-clue).
  // For contrast selection it is the selected word id.
};

type ReflectionAttemptShapeV0 = {
  firstResponseOutcome: 'incorrect' | 'no_clue';
  resolution: 'recalled_later' | 'management_action' | 'session_ended' | 'unknown';
  terminalRating: 'forgot' | 'hard' | 'good' | 'easy' | null;
  attemptCountForAction: number;
  managementAction:
    | 'dismissed'
    | 'suppressed_production'
    | 'marked_bad_prompt'
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
```

## Schema rules

- `items` is a batch from one session, not a universal word-pair model.
  Production mistakes are normally target + submitted response; a session note
  may be linked to an action, several related words, or neither.
- `cuesAsShown` is deliberately ordered. M0 normally supplies one
  `definition_gloss` entry, but the shape already admits a later cloze,
  minimal-context, or register cue without a migration.
- Prompt/cue and contrast content are captured only from the **initial**
  attempt. The ordered `attempts` list records later responses and ratings but
  does not duplicate the prompt on every row.
- A contrast choice is an attempt `response` containing the selected word id.
  It is not duplicated inside `promptAsShown`.
- The attempt list is the grounded evidence. `attemptShape` is a small,
  deterministic convenience summary so the model need not infer terminal state
  from ratings alone.
- Meaning rows do have stable ids in the current database, but the rendered
  production prompt currently carries text. M0 captures the text actually
  shown; `cueId` remains nullable until cue identity is a real product model.
- `knownAcceptedAlternates` is correctly shaped but initially empty: accepted
  answer classes do not yet exist. Keeping the field makes that absence legible
  instead of indistinguishable from unqueried data.
- The `no_clue` variants remain reserved in the item shape, but M0 bundle
  assembly excludes ordinary no-clue events. They are usually direct forgetting
  evidence with no clear reflection action. A learner may still elevate a
  recurring or surprising pattern through an explicit `session_note` item.

## M0 priority and verified gaps

| Area | M0 decision | Current evidence / required work |
| --- | --- | --- |
| Session batch and item inclusion | Implement now. Include production mistakes with a typed response, session notes, and contrast items only when a user selects `still_shaky` or `want_more_practice`. Exclude ordinary no-clue events. | Current session completion is a workable hook after deferred commits flush. |
| Production raw response and attempts | Implement now. Send typed response plus ordered attempts for the source action. | Current review attempt type/table has `response`, but the standard builder writes `null`; production input is otherwise only in frozen UI state. |
| Initial prompt/cue as shown | Implement now. Capture one definition-gloss cue in M0. | Current UI has displayed text; it is not durable. |
| Session-note control | Implement now, subject to ordinary dogfooding adjustment. | No session-note UI/state model exists yet. M0 does not need a separate no-clue reflection control. |
| Word snapshots and current policy/content | Enrich now where cheap: target/submitted word, production suppression, bad-prompt feedback, and existing contrast membership. | These states already live in existing word, study-management, and contrast content surfaces. |
| Contrast signal | Reserve and implement only with the explicit learner signal above. | Attempt events already retain selected word id and choice ids; UI does not yet collect the reflection signal. |
| Accepted alternates | Reserve as empty data only. | No answer-class model exists. |
| Recent history / confusion counts | Omit. | Review attempts are only partial history; learning/unstudied flows bypass attempt events, so an apparently complete history would mislead. |
| Durable prompt/contrast snapshots and replay | Defer. | Needed before stored/replayable artifacts, not for an in-memory M0 completion flow. |
| Bundle persistence or `GET` bundle endpoint | Defer. | M0 needs a POST to submit live evidence and a backend enrichment/call path, not a stored bundle. |

## Integrity and lifecycle rules

1. The backend accepts a bundle supplement only for the stated completed
   session and validates every supplied `sessionActionId`/attempt id against
   the session where durable events exist.
2. Client-supplied prompt text, typed response, and note text are evidence of
   what the learner saw or entered; they are never used to alter scheduler
   state.
3. The reflection path starts after the final pending study commit is flushed.
   A failed or abandoned reflection must leave study completion unchanged.
4. M0 drops an in-progress reflection on navigation or interruption. Later
   replay requires durable snapshots and a reflection-artifact store.

## Deferred decisions handed to later work

- Detailed reflection-result schema, proposal payloads, allowed handles, and
  disposition lifecycle belong to the handle-registry V0 task.
- Durable reflection artifacts and deferred-remediation UI belong to the
  subsequent artifact-store/reflection work. Their existence is compatible
  with this per-session evidence source.
- Recent-history summaries, answer classes, multiple production cue stacks,
  learning/unstudied attempt events, and persistent prompt/contrast snapshots
  are correct model extensions but nonessential to the first prototype.
