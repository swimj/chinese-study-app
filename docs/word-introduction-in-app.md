# Shared word introductions and early learning

The Mandarin application uses the immutable [word content model](word-content-model.md)
for shared preparation, paced first encounters, and constrained early rehearsal.
The [lab](word-introduction-lab.md) remains a separate local authoring sandbox.

## Learner flow

**My Words → Prepare introduction** prepares and opens a lesson in one action.
The learner never needs to approve the content's quality or publication. New
unstudied Mandarin words also offer the lesson inside the study session.
Space advances a complete teaching beat; private reflection questions do not
require answers. Rehearsal asks for the taught expression in hanzi.

Completing the package inside an active first encounter completes that word
unit through the usual deferred commit/Undo path. Opening or completing a lesson
in My Words only records navigation, not study credit. A previously completed
navigation marker does not silently grant credit in a later study session.
Unavailable content and explicit skips retain the ordinary card path.

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

Migration `0012_word_introduction_content` adds:

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

Each stage claims a five-minute lease before provider work. Claims are atomic
across callers/processes using the shared database. Finishing validates ownership
and publishes the document plus its readiness pointer in one transaction. A
stale worker cannot publish after its lease expires. Failures release ownership;
teaching failure retains bootstrap. Waiting requests poll readiness and reuse
work already running, with a bounded wait. The per-process three-word limit is
an additional resource bound, not the concurrency authority.

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
- `src/features/word-introduction/`: app workspace, using the lab's shared player.
- `src/features/session/`: introduction gate and learning snapshot runtime.

Authenticated Mandarin endpoints:

- `GET /api/words/:wordId/introduction`: eligible library, learner selection/completion,
  generation availability and terminal preparation-unavailable flag.
- `POST /api/words/:wordId/introduction/prepare`, body `{}`: reuse or prepare both
  stages, publish validated results, and privately pin the selected package.
- `POST /api/words/:wordId/introduction/complete`, body `{ "packageId": "..." }`:
  idempotent private navigation completion of the exact opened eligible package.

Provider credentials stay backend-owned. Configuration and maintenance controls
use the same provider infrastructure as the lab/reflection. Preparation can take
several minutes; failure is recoverable and ordinary study remains available.

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

Opening/preparing an introduction now also prepares independent ordinary-review
exercises. Review-generation failure is non-blocking and reported in the lesson;
reopening retries it. Migration 0013 adds canonical review records and review
preparation claims on top of 0012; it preserves existing introduction data.
