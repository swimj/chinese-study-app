# Vocabulary learning

The vocabulary delivery separates authored content, learner mode, scheduling,
and session evidence. The first-delivery plan in
[notes](../notes/active/2026-10-16-vocabulary-first-deliverable-plan.md) owns the
release scope; the [early specification](../notes/active/2026-10-15-vocabulary-model-whiteboard.md)
explains the intended learning experience.

## Persistence foundation

`vocabulary-content.ts` owns current complete content objects and immutable full
history, including the initial and current versions. An operator or service
writer supplies explicit attribution. Update preserves identity; replacement
creates a new identity and retires the predecessor atomically. Expected versions
reject stale changes. Exact encounters can continue to reference old versions.

Content can be shared or private. Learner reads enforce the current learner's
access, while internal maintenance reads are explicit. Teaching exercises are
excluded from the general pool. Introductions bind exact teaching exercise
versions. Sense mappings connect identities and are changed explicitly; a new
content version does not automatically clear an existing mapping. Mapping and
curation changes emit transactional retained backend events.

`vocabulary-learners.ts` owns production modes and separate scheduling records.
Migration maps existing learning words to Solidify and review words to Practice,
retaining production schedule values and leaving recognition state intact.
Enrollment comes from explicit learner state and stash records, not the default
rows of the lexical `words` view. An explicit mode change does not reset schedules.
Maintain refresh gives priority for a bounded three-day window without changing
mode or erasing the existing interval.

The common provider transport records exact request/response evidence and prompt,
schema, settings and workflow metadata in the invocation ledger. Normal calls
require learner identity. Service calls opt into explicit service attribution;
learner and service mutation APIs enforce their respective owners. Operator
ledger summaries exclude prompt/response bodies. Missing historical provenance
remains unknown. Credentials and transport headers are not retained.

## Delivery boundary

The foundation tables do not independently activate the new study experience.
Session, content conversion, reflection and UI integration belong to the same
release cutover. Migration 0037 introduces content, 0038 extends provenance, and
0039 converts learner production state. Existing data requires the documented
[offline migration procedure](ops/schema-migrations.md); this is not eligible
for the app-only upgrade route. No hosted migration has been performed by this
implementation task.
