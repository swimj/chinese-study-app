# Testing map

Run full suite: `npm test` (Node test runner, `tests/*.test.ts`).

## By domain

| Test file | Domain | Imports |
| --- | --- | --- |
| `session-composition.test.ts` | Session payload / scheduling composition | Dynamic `server/db.ts` |
| `session-completion.test.ts` | Session completion commits | Dynamic `server/db.ts` |
| `session-bucket-scheduler.test.ts` | Bucket ordering helpers | `src/domain/study-actions.ts` |
| `session-bucket-state.test.ts` | In-session bucket state | `src/domain/study-actions.ts` |
| `session-selectors.test.ts` | Session UI selectors | `src/features/session/session-selectors.ts` |
| `study-actions.test.ts` | Study action adapters / event derivation | `src/domain/study-actions.ts` |
| `study-attempt-events.test.ts` | Attempt event persistence | Dynamic `server/db.ts` |
| `study-management.test.ts` | Suppress / bad-prompt / management actions | Dynamic `server/db.ts` |
| `study-scheduler-state.test.ts` | Scheduler invariants | Dynamic `server/db.ts` |
| `contrast-content.test.ts` | Contrast clusters and prompts | Dynamic `server/db.ts` |
| `reflection-domain.test.ts` | V3 result/operation validation, registry, exact/revised classification, lifecycle transitions | `src/domain/reflection.ts` |
| `reflection-evidence-validation.test.ts` | Strict supplement/full-bundle shapes, validation-only attempt links, retired attempt/management metadata rejection, and initial-milestone evidence boundary | `src/domain/reflection-evidence.ts` |
| `session-reflection-evidence.test.ts` | Raw production response persistence, evidence accumulation, accepted-attempt links, Undo/drop behavior | Session state + `session-reflection-evidence.ts` |
| `reflection-evidence-enrichment.test.ts` | Completed-session/attempt verification, managed-action exclusion, read-only durable context enrichment, and stable twenty-five-item initial cap | `server/reflection/evidence.ts` with temporary SQLite fixtures |
| `reflection-provider.test.ts` | Pinned Luna request, lazy credentials, production prompt, strict output validation, sanitized failures, and retained truncation metadata | `server/reflection/luna-provider.ts` with injected fetch |
| `reflection-generation.test.ts` | Prelookup idempotency, provider/materialization/run metadata, included/eligible counts, in-process coalescing, exact saved-bundle failure retry | `server/reflection/generation.ts` with injected dependencies |
| `reflection-generation-isolation.test.ts` | Real enrichment/provider failures preserve completed session, summary, and attempt state while recording available run usage | Reflection generation stack + temporary SQLite |
| `reflection-run-pricing.test.ts` | Pinned token-category pricing math, partial usage handling, and unknown-rate unavailability | `server/reflection/run-pricing.ts` |
| `reflection-store.test.ts` | Seven-table schema, retained failed-run bundles/retryability, immutable run-price reconstruction, atomic artifact/review persistence, queue/detail, review/invocation lifecycle | Dynamic `server/db.ts` |
| `reflection-application.test.ts` | Suppression/contrast adapters, effect attribution, already/stale/failed/unsupported outcomes, recovery | Dynamic `server/db.ts` |
| `reflection-persistence-reload.test.ts` | Queue/detail/review/application/effect reconstruction across fresh Node processes | Shared temporary `APP_DATA_DIR` |
| `reflection-api.test.ts` | Generation statuses/errors, queue/detail, compact generation run log/retry, strict independent proposal review, quality tag upsert/stats, Help inbox Done, apply/withdraw, startup recovery | `server/index.ts` registered Express route handlers + temporary SQLite |
| `reflection-quality.test.ts` | Item quality tag-set upsert, multi-tag coexistence, model-arm disposition + tag stats | `server/db/reflection-quality.ts` + temporary SQLite |
| `reflection-help-inbox.test.ts` | Explanation-only Help inbox seed at materialize, Done delete, independence from proposal disposition, 404 | `server/db/reflection-help-inbox.ts` + temporary SQLite |
| `session-finalization.test.ts` | Explicit Finish boundary, commit-before-summary ordering, reflection isolation/retry and stale-response guards | `session-finalization.ts` |
| `reflection-page-model.test.ts` | Item/proposal grouping, help-queue cards from Help inbox membership, deep draft edits for four operations, support and validation presentation | `reflection-page-model.ts` |
| `reflection-operation-editor.test.ts` | Compact V2 cue-change list, hidden restated Hanzi field, and accepted-word chips | `ReflectionOperationEditor.tsx` |
| `reflections-page-run-log.test.ts` | Empty, unavailable-cost, and priced run-log rendering states | `ReflectionsPage.tsx` server render |
| `reflection-verification-fixture.test.ts` | Reflection-focused dev seed plus direct SQLite assertions for supported effects, unsupported authorization, and withdrawal | Disposable dev database seeded from `server/seeds/reflection-dev.json` |
| `llm-provider-runner.test.ts` | Spike compatibility shims, provider adapters, fixtures, current V3 validation/viewer behavior | `spikes/llm-provider/` |
| `user-priority.test.ts` | User priority patches | Dynamic `server/db.ts` |
| `priority-aliases.test.ts` | French alias lookup | Dynamic `server/db.ts` |
| `word-meanings.test.ts` | Word meanings CRUD | Dynamic `server/db.ts` |
| `dev-db-bootstrap.test.ts` | Dev DB bootstrap | Dynamic `server/db.ts` |
| `study-profile.test.ts` | Study profile helpers | `src/study-profile.ts` |
| `canonical-words.test.ts` | Canonical wordlist scripts | `scripts/lib/canonical-words.ts` |
| `cc-cedict.test.ts` | CC-CEDICT parsing | `scripts/lib/cc-cedict.ts` |
| `subtlex.test.ts` | SUBTLEX parsing | `scripts/lib/subtlex.ts` |

## When changing…

| Area | Run first |
| --- | --- |
| Session composition / SQL scheduling | `session-composition.test.ts` |
| Session end / word lifecycle commits | `session-completion.test.ts` |
| Contrast content | `contrast-content.test.ts` |
| Study management / suppression | `study-management.test.ts` |
| Priority / aliases | `user-priority.test.ts`, `priority-aliases.test.ts` |
| Frontend session state only | `session-selectors.test.ts`, `session-bucket-state.test.ts` |
| Reflection contracts / validation | `reflection-domain.test.ts`, `reflection-evidence-validation.test.ts` |
| Reflection evidence / finalization | `session-reflection-evidence.test.ts`, `session-finalization.test.ts`, `reflection-evidence-enrichment.test.ts` |
| Reflection provider / generation | `reflection-provider.test.ts`, `reflection-generation.test.ts`, `reflection-generation-isolation.test.ts` |
| Reflection persistence / application | `reflection-store.test.ts`, `reflection-application.test.ts`, `reflection-persistence-reload.test.ts`, `reflection-quality.test.ts`, `reflection-help-inbox.test.ts` |
| Reflection HTTP / review UI model | `reflection-api.test.ts`, `reflection-page-model.test.ts`, `reflection-operation-editor.test.ts`, `reflections-page-run-log.test.ts` |
| Schema or bootstrap | `dev-db-bootstrap.test.ts` + any db-touching tests above |

Tests that dynamic-import `server/db.ts` set `APP_MODE=study` and `APP_DATA_DIR` to a temp directory before import.

The reflection API suite invokes the actual handlers registered in Express
without binding a TCP port, which keeps the automated suite compatible with
restricted sandboxes. Provider tests inject transport responses and never
require real credentials or external network access. The steel-thread
demonstration still requires a separate manual study-mode run with a real
completed session and `OPENAI_API_KEY`; secrets must not enter fixtures, logs,
or artifacts.

## Reflection verification fixture

`server/seeds/reflection-dev.json` is a small disposable Mandarin fixture for
hands-on reflection verification. Its backend command deliberately disables the
unrelated general Mandarin dev-contrast seed, leaving a six-item review queue:
recognition-only surname `俞`, `难怪` / `怪不得`, `吃惊` / `震撼`, and `在意` /
`介意`, plus two ordinary review items.

Start it against a temporary directory:

```bash
verify_dir=$(mktemp -d /private/tmp/reflection-verify.XXXXXX)
npm run reset:reflection-verification -- --data-dir="$verify_dir"
npm run dev:reflection:backend -- --data-dir="$verify_dir" --port=5181
VITE_API_BASE=http://127.0.0.1:5181 npm run dev:frontend -- --port=4181
```

Run the reset command again between walkthroughs to discard the prior session,
artifact, review, and application state before restarting the backend. It
requires an explicit non-default data directory and refuses the workspace or
normal `data/` directory.

For a deterministic review-page walkthrough, stop the backend, seed the
fixture artifact, then restart the same backend command:

```bash
npm run seed:reflection-review-fixture -- --data-dir="$verify_dir"
```

That artifact contains independently reviewable suppression, contrast-creation,
cue-repair, and alternate-acceptance proposals. It is local fixture content,
not provider output. Use a fresh temporary directory without that command for a
real-provider generation pass; set `OPENAI_API_KEY` privately in the backend
environment and do not place it in a fixture or log. Live OpenAI calls go
through the local HTTP CONNECT proxy at `127.0.0.1:7897` (same as the LLM
spike); keep that proxy running for a real-provider pass.

After either manual path, inspect persisted state without starting the app or
writing to SQLite:

```bash
npm run report:reflection-state -- --data-dir="$verify_dir"
```

The report intentionally omits evidence bodies, raw learner responses, and
provider output. It shows artifact/provider metadata, proposal disposition and
application state, effect references, suppressed definition-production words,
and contrast clusters. Run it before and after a backend restart to confirm the
same durable state is reconstructed.

### Reflection lifecycle logs

The backend writes one newline-delimited JSON event to its normal stdout for
each reflection boundary. No prompts, learner responses, provider responses, or
credentials are logged. The events are:

| Event | Meaning |
| --- | --- |
| `reflection.summary_recorded` | Finish saved the completed-review summary. |
| `reflection.generation_requested` | The reflection endpoint received a request. |
| `reflection.provider_started` | Durable evidence formed a bundle and the provider request is about to begin. |
| `reflection.generation_succeeded` | An artifact was materialized. |
| `reflection.generation_failed` | The endpoint failed; `failure` is `invalid_evidence`, `provider`, or `internal`, and `code` is a safe reflection error code when available. Provider failures also include `clientRequestId`. |

Every event includes `at` and `sessionId`; completion/failure events include
`elapsedMs`. In a manual run, read the terminal running
`dev:reflection:backend`. A timeout should produce `provider_started`, followed
about 180 seconds later by `generation_failed` with `failure: "provider"` and
`code: "upstream_failure"`.

For provider failures only, the backend also appends an allowlisted local JSON
record to `reflection-provider-diagnostics.jsonl` beside `app.db` in the active
data directory. It records correlation and classification data: the session and
client request IDs, failure kind, safe error and cause names/codes, and, for HTTP
failures, the status, OpenAI `x-request-id`, and processing-time header. It never
writes request or response bodies, error or cause messages, stacks, or API keys.
Treat the file as private because it still contains local session identifiers.
The `clientRequestId` is sent to OpenAI as `X-Client-Request-Id`, so it can also
be supplied to OpenAI Support if a transport failure gives no server-generated
request ID.
