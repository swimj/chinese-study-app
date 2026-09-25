# Structured review content and compatibility

Ordinary review can use bootstrap examples without inheriting the teaching
package's target-rehearsal contract. A separate review authoring call receives
only the immutable bootstrap document and authors one to three targeted-review
exercises. At least one is a contextual cloze or circumstance prompt. A natural
teaching sentence is not automatically a fair review cloze: the author must
supply a meaningful frame or choose another exercise. Definition cues may refer
to an exact example as a post-reveal supplement.

## Preparation and ordinary serving

Preparing/opening a word introduction also prepares its review content. Existing
completed bootstrap and teaching stages are reused. The review stage has its own
shared per-word readiness and expiring claim, so concurrent learners do not
create duplicate cues. Once prepared, retry never resurrects a cue retired by
reflection. Review failure leaves the introduction usable; a later prepare
retries only the missing review work.

Publication inserts structured content and its compatibility projection in one
transaction. Generated cues enter the existing shared-trial registry under an
explicit application publication policy. No reflection invocation or learner
approval is fabricated. Ordinary session composition selects them through the
existing active-cue path instead of falling back to corpus dictionary meanings.
Recognition reveals can also use eligible bootstrap uses/examples. Existing
legacy cues remain in the pool; there is no rewrite of past material.

The new reviewer still answers a normal review task. Rejections produce ordinary
review evidence; reflection can replace the cue or promote a shared axis using
its existing authorization rules. The pinned teaching package remains unchanged.
Withdrawing bootstrap content excludes dependent cues/supplements from future
serving, while retaining canonical records and historical cue identities.

## Canonical records and projections

Migration `0013_review_content_records` introduces:

- `scoped_review_content_records`: append-only canonical records, each keyed to
  a durable production cue, supplement, or pure cue. Records contain core
  `ContentExercise` objects and exact `WordContentDocument`/`ExampleRef` sources.
- `review_content_records`: caller-visible view inheriting the owning cue or
  supplement's existing sharing boundary. Private reflection examples remain
  private; publishing a cue makes its corresponding canonical record available.
- `word_review_preparation`: shared review-stage readiness and recoverable lease.

Bootstrap records pin the shared source document and retain its exact snapshot.
Reflection supplements embed their own small source document; they do not become
shared bootstrap content merely because their representation is the same.

Production cue IDs still own lifecycle, retirement, attempt evidence and
reflection references. Existing cue/supplement tables contain the materialized
projection consumed by those systems. Reads rematerialize canonical content when
present and check its agreement with the projection; old rows without canonical
content remain readable. New reflection effects therefore stop growing the set
of **legacy-only authored content**, even though compatibility tables still grow.
Canonical cue answer forms are also used for serving and attempt validation, so
later dictionary spelling edits cannot silently change an authored exercise's
accepted response.

Targeted cues and supplements are immutable. A pure cue's accepted set can grow,
so an extension adds a new immutable exercise ID and canonical revision while
retaining the existing pure-cue schedule identity and historical served answers.

## Reflection boundary

The proposal JSON, staged generation wire, editor, authorization and effect refs
remain compatible. On applying a new cue repair, its text becomes a first-class
`direct_text` targeted-review exercise. Applying a supplement creates an exact
example source. Pure-cue promotion/extension records the corresponding pure-review
exercise and accepted forms.

This is an application/storage conversion, not a new model-facing structured
cloze proposal format. Existing cloze strings are kept opaque; the system does
not guess missing spans or reconstruct source sentences. Adding model-authored
structured cloze drafts later will need a versioned proposal wire and editor
support. Historical proposals need no reinterpretation to use the current bridge.
Contrast clusters, meaning edits and non-content reflection operations keep
their existing domain models.

## Later convergence

The remaining migration can be bounded to legacy-only records. Structured
records already retain source identity and intent, and their projection can
later be removed when lifecycle/evidence readers accept the canonical identity
directly. No bulk legacy parsing, sentence deduplication, or scheduler redesign
is required in this slice.

Use the standard [offline migration procedure](ops/schema-migrations.md) with a
backup and stopped application. Migration 0013 preserves existing data, including
0012's introduction records. It does not run provider calls during migration.
For words bootstrapped before this stage existed, reopening **Prepare
introduction** authors only the missing review content.
