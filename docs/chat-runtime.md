# Learner chat runtime

This guide explains the backend primitives used to implement bounded learner
chat exchanges. The runtime has no HTTP route, learner surface, vocabulary tool
or model prompt of its own. Those integrations supply their own product policy.
The [service boundary](private-beta-service-boundary.md#data-ownership) owns
privacy and provider disclosure; the [sense-preferences build spec](../notes/active/2026-11-14-learner-sense-preferences-spec.md)
defines the first intended consumer.

`server/llm/chat-types.ts` defines messages, function tools and the streaming
provider interface. `chat-openai-responses.ts` uses the official OpenAI SDK for the Responses API
and its typed streaming events. Requests use `store: false`; each tool round
passes the complete prior output items, including encrypted reasoning, alongside
the matching function results. Tool choice is required. Provider text is retained
for diagnostics but is not streamed as learner prose.
Incomplete or refused responses never execute tools.
Each model iteration receives its own invocation-ledger entry, with the turn ID
as workflow attribution. Response snapshots retain observed chunks and usage,
including partial evidence on failures. Existing structured-output jobs keep
their own transport. The stream has a byte bound and a request deadline; an
external cancellation is recorded as failure rather than a provider timeout.

`server/chat/tool-loop.ts` has a fixed read-tool list and one terminal output
schema. It validates every call in a batch before dispatch, bounds iterations
and calls, and requires completion to be the only call in its batch. A response
without a tool call fails rather than silently completing. Domain ID validation
belongs in the output handler. No partial arguments become visible results.
Backend progress events describe checking, lookup and reply preparation; they
are transient and are never saved as conversational prose.

`server/chat/conversation.ts` connects the loop to durable storage. A client turn
identity is accepted once; reuse with different input conflicts, and reuse of a
failed turn never starts a hidden retry. The synchronous completion handler runs
inside a savepoint with the domain effects, a versioned completion event and the
completed turn status. The event stores an explanation and optional card ID;
answer-only turns use the same boundary. Provider work stays outside the
transaction. The card must belong to this conversation and be attached to the
completing turn. Publication follows commit; a disconnected observer cannot
roll back the result or cause repeated effects on retry.

New turns carry a completion-required marker. History and model context expose
only their saved terminal explanation, including after recovery. Legacy prose
remains readable. Recovery accepts terminal receipts for new attempts and keeps
the old card-based recovery rule only for legacy attempts. Existing opaque event
JSON holds these records without a schema migration. Later card edits retain
earlier explanations on their original conversational turns.

`server/db/learner-chat.ts` requires learner context for every read and write.
Conversation, turn, event, card and command links carry the same learner key in
the schema. Each learner has one continuous conversation per surface. Turns
retain their input and terminal outcome; ordered events retain the displayed
exchange. Cards have opaque JSON bodies and optimistic versions. Surface-filtered
card listing uses a stable `(created_at,id)` cursor, so an outstanding-card view
can read the same records as the transcript. Domain status, deferred matching,
and Undo snapshots belong in the vocabulary adapter's private card body.

A normal card action uses `runChatCardCommand`: it checks a durable action ID,
request fingerprint and expected card version, then calls a synchronous domain
operation and saves the next card plus receipt in one savepoint. Repeated
requests return the original result without repeating effects. Savepoints compose
with a caller's transaction; no provider call belongs inside them. Automatic
adds use the same transaction boundary around learner effects and card creation.
Learner/catalog/selection version checks remain the domain adapter's responsibility.

Focused fake-provider and isolated-database checks are in `tests/chat-core.test.ts`,
`tests/chat-responses.test.ts`, `tests/chat-ledger.test.ts`, `tests/learner-chat.test.ts` and
`tests/chat-migration.test.ts`. They establish transport, ownership, transaction
and replay behavior. They do not establish linguistic quality, live-provider
latency, or rendered UI behavior.
