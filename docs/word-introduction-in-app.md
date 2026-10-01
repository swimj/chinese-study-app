# Shared word introductions and early learning

The Mandarin application uses the immutable [word content model](word-content-model.md)
for shared preparation, paced first encounters, and constrained early rehearsal.
The [lab](word-introduction-lab.md) remains a separate local authoring sandbox.

## Learner flow

**My Words → Prepare introduction** requests shared background preparation and
polls readiness; opening is a separate exact-package association. The learner
never needs to approve content quality or publication. New Mandarin words enter
a session only with a ready teaching/source snapshot.
Space advances a complete teaching beat; private reflection questions do not
require answers. Rehearsal asks for the taught expression in hanzi.

Inside a first encounter, the player shows teaching beats only. Finishing the
walkthrough returns to the ordinary session scheduler for interleaved recognition
and production: each direction needs three consecutive `Good` ratings, with a
non-`Good` rating resetting only that direction. Recognition reveals the curated
source material; production selects the package rehearsal at its current streak
modulo the rehearsal count. This preserves word-level coverage rather than
requiring every authored exercise. Weighted interleaving can still select the
same word consecutively, especially when other work runs out.
Completing both streaks commits the word through the usual deferred commit/Undo
path. Finishing the walkthrough alone grants no study credit. Opening or completing a lesson
in My Words only records navigation, not study credit. A previously completed
navigation marker does not silently grant credit in a later study session.
The session walkthrough has no skip-to-cards button or Escape bypass. Normal
session controls remain available for leaving; leaving does not complete teaching.
Standalone My Words introductions retain their Back button. Unprepared new words are omitted
at session entry; established learning words retain their existing fallback.

Learning keeps the existing recognition + production coverage and first-try
success rules. An eligible package whose introduction this learner has completed supplies the production rehearsal and
curated recognition material. The production choice rotates by UTC study-day
ordinal modulo the package's rehearsal count; retries/fetches on that day keep
the same choice. There is no per-example mastery ledger. Three consecutive
successful study sessions graduate the word; calendar-day adjacency is irrelevant.
Review uses independently authored bootstrap-backed cues through its existing
reflection and scheduling paths; see [structured review content](structured-review-content.md). Exact package,
content and exercise identities remain frozen in the active session and Undo
snapshot. Learning commits still persist the existing word-level success result;
this prototype adds no durable per-rehearsal attempt ledger.

## Storage and concurrency

Migration `0016_word_introduction_content` adds:

| Table | Responsibility |
| --- | --- |
| `word_content_documents` | Immutable lexical snapshot, selected uses, examples and notes |
| `word_teaching_packages` | Immutable paced lesson + rehearsal definitions, exact content FK |
| `word_introduction_preparation` | One shared readiness/active-generation slot per word |
| `learner_word_introduction_events` | Private append-only package opened/completed markers |

Direct definitions/situations remain `direct_text` stimuli in package JSON;
there is no separate definition or sentence table. Example identities remain
local to an immutable content document. Legacy cue and supplement tables are
unchanged; no backfill converts or removes their data.

Migration `0018_word_preparation_work` adds shared operational work, attempt
history, and attributable operator retry events. Migration `0019` adds `learner_word_preparation_reserve` membership and durable
`learner_word_reserve_requests`, and clamps existing daily limits above 20 in all
profiles. Only Mandarin uses the preparation reserve.
The reserve targets twice each learner's configured limit (at most 40), counting
queued, ready and failed candidates. Failed slots stay reserved to prevent
unbounded replacement spending. App entry, priority/settings changes, and durable
first-study commits reconcile it; composition and abandonment do not consume it.
Shared generation is reused across accounts and never writes private pins.

The in-process worker polls every five seconds, with two concurrent stages.
Each stage uses the existing five-minute shared generation lease; the work journal
records attempts rather than granting a competing publication claim. Publication
is atomic and stale lease owners cannot publish. Restart recovery recognizes
already-published success or consumes the interrupted attempt. Three failed
attempts exhaust the shared word/stage budget, with increasing retry delays.
Successful earlier stages survive. Operator retry resets the budget with an
actor audit. Provider-wide failures back off the worker; maintenance/provider
controls pause work without spending attempts. Shutdown drains active work.

Session entry waits at most 30 seconds total, then admits ready candidates within
the existing stash/diet quotas. Compute quotas before readiness filtering; words
still preparing do not transfer stash demand to diet. Top priority is best effort.
A reduced or empty new-word set is valid. When no other study work exists, the UI
explains preparation and offers waiting again or returning later. The complete
lesson snapshot travels in the payload, so study neither generates nor fetches
missing introduction content mid-session.

The existing shared publication registry accepts `word_content` and
`teaching_package`. Application-authorized validated results immediately enter
`shared_trial`, with an attributable automatic-publication event and no learner
identity in shared authored content. Generation uses stored lexical fields only;
HTTP callers cannot inject private notes, identities or lexical overrides.

Quarantine/retirement removes material from future eligibility. A withdrawn
source also withdraws its package from serving. Private pins are not silently
swapped. Prepared-but-withdrawn content stays unavailable until an explicit
future correction policy replaces it; ordinary requests do not regenerate it.
Historical immutable payloads remain stored.

## Code and API

- `server/word-content/`: shared authoring normalization, provider, service and routes.
- `server/db/word-introductions.ts`: shared persistence and private association.
- `server/db/preparation-work.ts`: shared work journal, retries and operator diagnostics.
- `server/word-content/preparation-worker.ts`: bounded backend worker lifecycle.
- `server/db/word-reserve.ts`: stable learner membership and reconciliation requests.
- `server/word-content/session-preparation.ts`: bounded entry wait and prepared payload.
- `server/word-content/preparation-runtime.ts`: backend worker integration.
- `src/features/word-introduction/`: app workspace, using the lab's shared player.
- `src/features/session/`: entry preparation and frozen introduction/learning snapshots.

Authenticated Mandarin endpoints:

- `GET /api/words/:wordId/introduction`: eligible library, learner selection/completion,
  generation availability, pending state and terminal preparation-unavailable flag.
- `POST /api/words/:wordId/introduction/prepare`, body `{}`: enqueue/reuse shared
  bootstrap and teaching; return current state for polling, without a private pin.
- `POST /api/words/:wordId/introduction/open`, body `{ "packageId": "..." }`:
  privately associate the exact eligible prepared package, without generation.
- `POST /api/words/:wordId/introduction/complete`, body `{ "packageId": "..." }`:
  idempotent private navigation completion of the exact opened eligible package.

Provider credentials stay backend-owned. Configuration and maintenance controls
use the same provider infrastructure as the lab/reflection. Repeated failures appear on the operator
page rather than exposing provider internals to everyday learners.

## Local verification and migration

`npm run dev:intro-lab` starts both the regular app at `http://localhost:4177/`
and authoring lab at `/intro-lab`, with an isolated database and archive under
`data/intro-lab/`. The lab's existing JSON drafts are preserved, not automatically
published or imported into shared application content.

Existing databases require the ordinary offline migration procedure:

```sh
npm run db:migrate -- --database=/absolute/path/app.db --status=true
# Stop the application/workers and take a restorable backup first.
npm run db:migrate -- --database=/absolute/path/app.db --confirm-app-stopped=true
npm run db:migrate -- --database=/absolute/path/app.db --status=true
```

Fresh databases apply the migration automatically during initialization. Existing
startup deliberately does not silently migrate. See [schema migrations](ops/schema-migrations.md)
for the full backup and deployment procedure. This feature does not itself deploy
or migrate the hosted production database.

Review generation is requested asynchronously after a first-study commit, not
when a lesson is prepared or opened. Migration 0017's canonical review records
and claims remain in use. Review failures preserve teaching and ordinary fallback.
All migrations preserve compatible authored content; no bulk regeneration or
prompt changes are part of the reserve implementation.

The existing operator allowlist protects `GET /api/operator/word-preparation/failures`
and `POST /api/operator/word-preparation/:workId/retry` (body `{}`). Diagnostics
identify shared words/stages and attempt histories without learner evidence or
provider response bodies. Retrying withdrawn content does not authorize
regeneration; its publication disposition must first be resolved.
