# Intake Triage Advisor

Status: accepted V1 implementation contract (2026-08-20).

## 1. Product Outcome

Protect the learner's daily new-word budget by adding a manually invoked,
language-aware advisor to the unstudied-word triage view. The advisor evaluates
an exact lexical entry before it enters study and annotates entries whose
default recognition-plus-production path appears low value.

The first version remains a learner-controlled aid. Model output never changes
priority or production relevance without an explicit action on that exact
assessment.

## 2. Triage Population

The triage view shows the highest-default-priority 50 unstudied words after
excluding every explicit user priority override:

- positive bump count;
- move-to-top priority; and
- required-for-next-session state.

The manage-priority view continues to own those explicit choices. Triage is an
intake-decision queue, not a surface for comparing user overrides with default
corpus rank.

A word whose definition production has already been suppressed remains in its
default-priority position and displays that durable state. It is not sent to
the advisor again.

## 3. Invocation And Evidence

Generation is explicitly invoked from the triage view. Background generation
is deferred.

The primary action analyzes only currently visible words that lack a fresh
assessment for the active prompt version and current lexical snapshot. The UI
labels the action with the number of words that will be sent.

Each provider input entry contains only the lexical evidence needed for the
judgment:

- simplified form;
- pinyin;
- all meanings;
- examples.

User priority overrides are not model evidence because overridden words are
excluded. The app selects an exact entry, while the provider distinguishes its
reading and senses rather than judging the Hanzi surface form alone.

The app separately retains the selected stable word id and a deterministic
fingerprint of its lexical snapshot. Those application references, priority
facts, timestamps, and prompt version are not provider evidence and are not
sent. Hanzi and pinyin together uniquely identify each input entry. Every
provider assessment copies that lexical reference, preserves input order, and
is translated by the app back to its selected word.

The request is bounded to at most 50 entries. Provider failure, timeout,
truncation, invalid JSON, schema failure, or domain-contract failure creates no
assessment and has no effect on study behavior.

## 4. Learner Policy

The initial prompt optimizes for a serious intermediate learner of modern
general Mandarin. It favors independently usable modern words and treats
bound forms, surnames, narrow specialist items, register mismatch, and
lexicalized fragments skeptically.

The advisor judges the underlying lexical target assuming a well-designed cue.
A broad, awkward, or low-quality gloss list is not by itself a reason to move a
valuable word down; later cue repair owns that problem.

The prompt must not apply blanket exclusions. Common transliterations may be
useful for learning productive transliteration patterns, and literary forms may
retain real-world reading value. When evidence is ambiguous, the advisor
returns `uncertain` rather than forcing a negative recommendation.

## 5. Result Contract

Every successful provider response contains exactly one assessment for every
input word in the same order. It copies Hanzi and pinyin but repeats no
meanings, examples, or application ids. Each assessment has:

```ts
type IntakeTriageJudgment =
  | 'defer_active_study'
  | 'recognition_only'
  | 'full_study'
  | 'uncertain';

type IntakeTriageAssessmentResult = {
  hanzi: string;
  pinyin: string;
  judgment: IntakeTriageJudgment;
  rationale: string;
};
```

The rationale is a concise, nonempty explanation intended for direct display.
It is advice, not hidden application instructions.

## 6. Triage Presentation

The triage table uses the columns Word, Definition, Advisor, and Action. It
does not show bump counts or corpus-percentile rank; bumped words are already
absent from this queue.

- `defer_active_study` renders a rose **Move down** annotation and rationale.
- `recognition_only` renders an amber **Recognition only?**
  annotation, rationale, and acceptance action.
- `uncertain` renders a quiet gray **Unsure** annotation and rationale.
- `full_study` is visually quiet.
- durable accepted definition-production suppression renders **Review
  production suppressed**.

The rationale is visible inline without requiring an expand interaction.

Every visible recommendation can be dismissed. Dismissing a suggestion records
negative feedback and hides that assessment without changing word state.

## 7. Authorized Effects

### Move to bottom

Accepting `defer_active_study` applies the existing sunk priority tier to the word.
The UI calls this **Move to bottom**, not Dismiss, because the word remains
unstudied and is ranked below normal-priority words rather than being deleted
or absolutely excluded.

The row is removed from triage. The view should refill immediately when that is
straightforward; refill behavior is not a correctness condition for V1.

### Suppress definition production in review

Accepting `recognition_only` immediately records the existing
definition-production relevance suppression for the unstudied word.

This does not alter the current unstudied or learning covering rules: both
recognition and production still run during introduction and the learning
phase. When the word reaches review, existing review selection honors the
suppression without a graduation hook.

The effect suppresses the legacy definition-derived production fallback.
Future learner-authorized durable production cues may still make cue-based
production available. Recognition and contextual-selection behavior remain
unchanged.

The word stays in its default-priority position and the UI replaces the
recommendation with **Review production suppressed**.

Re-enabling definition production is not required in V1.

## 8. Persistence And Provenance

Intake triage owns records separate from reflection:

- immutable terminal generation runs with provider/model and prompt version,
  item count, app and provider request identifiers, normalized usage, a
  versioned pricing basis and estimated cost, or safe failure facts;
- immutable per-word assessments linked to their source run and content
  fingerprint; and
- one durable learner disposition per assessment, recording dismissal or
  accepted application and its effect.

Acceptance validates the current word, lexical fingerprint, unstudied status,
absence of a conflicting user priority override, assessment judgment, and
pending disposition before applying an effect. Disposition and effect are
recorded atomically. An already-satisfied production suppression is truthful
successful acceptance rather than a duplicated effect.

A changed lexical fingerprint or prompt version makes an unaccepted assessment
stale. A new prompt version may surface a recommendation previously dismissed;
the earlier rejection remains historical evidence. Accepted durable state is
not silently reversed or reinterpreted by a later run.

## 9. Architecture Boundaries

The advisor has its own evidence, provider response, generation, persistence, and UI
contracts. It does not use reflection artifact or proposal tables.

It shares only provider-neutral runtime primitives under `server/llm/` and the
existing transaction-aware domain commands for priority sinking and
definition-production suppression. The first runtime uses one fixed,
separately versioned Luna-high configuration; it does not inherit reflection's
randomized comparison arms.

Provider credentials and requests remain backend-only. Provider output is
untrusted until structural and exact lexical-reference validation succeeds.
The transient request and raw provider response are
discarded after the app translates validated assessments into durable per-word
annotations.

## 10. Hosted Generalization

For V1 the database remains the implicit single local learner boundary.
Conceptually, runs, assessments, dispositions, and applied relevance/priority
effects are learner-owned data linked to shared lexical content.

When the hosted learner-context foundation lands:

- every private read, generation, disposition, and effect must receive
  server-derived learner context;
- clients must not submit learner ids;
- uniqueness and references must be learner-scoped; and
- one learner's advice or disposition must never become global lexical truth.

The additive learner overlay is chosen to make that migration direct without
prematurely duplicating the in-flight tenancy architecture.

## 11. Explicit Non-Goals

- background or scheduled generation;
- automatic acceptance;
- changing unstudied or learning covering rules;
- absolute suppression of every possible production cue;
- re-enabling production suppression;
- repairing glosses or generating production cues;
- a generic agent-artifact platform;
- reflection model comparison, retry UI, aggregate cost dashboard, or quality dashboard;
- learned ranking or automatic priority reordering; and
- cross-learner aggregation or publication.

## 12. Verification

Focused coverage must prove:

- explicit priority overrides are excluded from triage while ordinary words
  retain default ordering;
- the provider contract requires exactly one Hanzi-and-pinyin-referenced
  assessment per input word in input order;
- exact-entry evidence distinguishes same-Hanzi readings;
- fresh assessments attach only to matching content and prompt versions;
- suggestion dismissal hides advice without changing word state;
- move-down acceptance atomically records disposition and sunk priority;
- recognition-only acceptance atomically records disposition and production
  suppression while leaving priority and lifecycle status unchanged;
- already-suppressed production is handled truthfully;
- provider/configuration/validation failures create no assessments or study
  effects;
- API responses do not expose provider secrets or rejected output; and
- the priority page renders the agreed advisor states and actions.

The initial prompt fixtures include expected move-down judgments for the
non-`zǐ` entries of `仔`, the bound `夹` entry represented through `夹肢窝`, and
the `的` entry used in `打的`; and expected keep judgments for `迈克尔` and `兹`.

Run focused tests, the full test suite, and `npm run build` before publication.
