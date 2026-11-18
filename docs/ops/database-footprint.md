# Production database footprint

## Remaining opportunities

Identical model output schemas account for about **2.35 MB** of repeated text.
Model-call transcripts and improvement checkpoints take more space, and we
currently keep them available for investigating content decisions.

| Remaining option | What it would buy | Current decision |
| --- | --- | --- |
| Share identical model output schemas | 4,982 calls carry 2.64 MB of schema text. The 395 distinct texts occupy 0.29 MB, a gross difference of 2.35 MB before references and indexes. | Small follow-up if call volume makes this worthwhile. Keep the exact schema for each historical call. |
| Move finished model conversations out of SQLite | Across 6,495 terminal calls, saved request bodies occupy 17.77 MB and responses 9.05 MB. The app could keep each call’s receipt, timing, usage and cost while an investigator retrieves its transcript separately. | Deferred. Keep the per-call evidence available for provenance and cost repair. Replacing repeated exercise text with version references would also require proving that the exact input sent to the provider can be reconstructed. |
| Move content-improvement jobs’ working papers elsewhere | Across 2,129 checkpoints, saved inputs occupy 13.12 MB and results 6.12 MB. Retries look up a result by its input hash. Some checkpoints also record operator choices that the case queue still displays. | Keep them. They explain how a content decision was reached, and the remaining inputs are small enough to retain. |

Model provenance and stage checkpoints have different readers. The cost backfill checks the captured model, service tier and cache setting. The stage cache returns saved results and invocation links, while the case queue reads operator decisions. [Cost backfill](../../server/db/model-invocation-cost-backfill.ts) · [Improvement stages](../../server/vocabulary/improvement-admission.ts) · [Case queue](../../server/db/vocabulary-case-queue.ts)

### Where the space is now

At **21:19 UTC on November 18, 2026**, production was on migration 0082. Its database had **694.90 MB in use** and **132.63 MB free for reuse** in its **827.53 MB** SQLite database. SQLite can use the free pages for future writes. Compaction would return them to the filesystem. The backup policy calls for five scheduled six-hour Fly copies and one compressed S3 copy every twelve hours. Returning free pages to the filesystem would also shrink future uncompressed Fly copies. The S3 size depends on compression. [Hosted backups](hosted-backups.md)

| Tables, including their indexes | Allocated MB |
| --- | ---: |
| Shared dictionary words and meanings | 88.69 |
| Current content items and revision history | 67.79 |
| Session action log and served encounters | 51.29 |
| Earlier-runtime study attempt events | 46.07 |
| Model invocations | 43.39 |
| Vocabulary completion revisions | 42.31 |
| Production tasks | 38.42 |
| Backend events | 30.92 |
| Learner meaning preferences | 27.60 |
| Reflection session receipts and copied reports | 25.00 |
| Content-improvement stages | 21.54 |
| Other allocated pages | 211.87 |

Large tables serve different purposes. Historical grading can resolve an older content revision. Earlier study attempts and served encounters still supply learning evidence. Backend events drive operations including retry accounting and idempotency. Trimming any of those needs an inventory of the readers and of the records eligible for removal. The shared dictionary and current exercises are reusable teaching content.

## History of the reductions

The original November 17 snapshot measured **1,344.11 MB**, including **477.63 MB** across session contexts, completions and dispatches. The November 9 spike was a deliberate bulk generation job, accounting for 1,359 model calls that day. Low learner traffic could still produce substantial growth because each session and generation job saved large repeated inputs.

| Change | Evidence |
| --- | --- |
| **0076 · Remove untouched imported learner-word associations.** Protected studied, stashed, dismissed and attached words, and kept the shared dictionary. | Production pruning receipts counted 114,033 associations, 114,033 schedules and 114,033 default legacy-state rows removed. [PR #553](https://github.com/swimj/chinese-study-app/pull/553) |
| **0079 · Keep one frozen session context.** Completion attempts and dispatches refer to the owning session. | On a retained backup, all 87 embedded contexts matched their parents. The migration freed 262.52 MB of pages for reuse. [PR #567](https://github.com/swimj/chinese-study-app/pull/567) |
| **0080 · Store authored system prompts in a retained Git archive.** Invocations, captured requests and content-improvement checkpoints reference the original instructions. | The rehearsal reproduced all 6,358 invocation records and 2,127 checkpoints and freed 139.48 MB of pages. [PR #568](https://github.com/swimj/chinese-study-app/pull/568) |
| **0081 · Keep a reference on each post-session dispatch.** The worker reads the closed report and reconciliation can reconstruct the original evidence. | All 43 original dispatch envelopes reconstructed byte for byte on a retained backup. The dispatch table fell from 42.09 MB to 0.17 MB. [PR #570](https://github.com/swimj/chinese-study-app/pull/570) |
| **0082 · Trim the exercise pool after successful closure.** A closed session keeps its frozen word labels, served cards, acknowledged actions and final report. The full pool remains available during play and recovery. | Rehearsal reduced closed context payload from 136.23 MB to 3.74 MB. Production now holds 3.74 MB across 43 closed sessions. [PR #573](https://github.com/swimj/chinese-study-app/pull/573) |
| **0083 · Keep one acknowledged action log.** Each closure attempt records the sequence it finished on. An attempt can recover its precise input even if the learner undid Finish and continued. | On a restored production backup, all 44 action lists matched exactly, including the cancelled attempt’s 135-action prefix. The migration freed 17.10 MB of pages for reuse. The compacted database fell from 694.86 MB to 677.72 MB. The production snapshot above predates this change. [PR #575](https://github.com/swimj/chinese-study-app/pull/575) |
| **0084 · Keep one final report per vocabulary completion.** Each reflection ingestion receipt points to the closed report used to create its cases. | On the restored backup, all 43 reports (24.92 MB) matched byte for byte. Starting at 0083, the migration freed another 24.86 MB of pages for reuse. The compacted database fell from 677.72 MB to 652.74 MB. [PR #577](https://github.com/swimj/chinese-study-app/pull/577) |

The 43 receipts represent **43 finished vocabulary sessions**. Of those, 40
had exercise-improvement cases, with 818 such cases and 892 improvement jobs
in total. A receipt keeps the session's processing timestamp and lets a
retry find the cases already created, even when that list is empty. Each case
keeps its own encounter evidence. The legacy bulk reflection system records its
runs separately. [Reflection ingestion](../../server/db/vocabulary-reflection.ts)

All MB above are decimal. The footprint table uses a read-only SQLite snapshot, page counts and `dbstat` grouped by table with its indexes. Candidate sizes count UTF-8 field bytes. The history records individual backup rehearsals and production observations on different dates, so adding those figures does not yield a physical file-size change. [Offline migration procedures](schema-migrations.md) · [Original November 17 footprint investigation](https://chatgpt.com/space/page_f032caa759088191a52ef40b14744ebc)
