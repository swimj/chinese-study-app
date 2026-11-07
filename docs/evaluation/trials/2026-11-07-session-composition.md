# Session composition: bounded work and retained material

This report records local evidence for the SWI-123–127 implementation stack. It
helps reviewers distinguish eliminated work from costs still requiring production
measurement. Fixtures use synthetic SQLite data and no provider calls. The
comparisons are not estimates of deployed Start latency.

## Review order

1. SWI-124 reuses ordinary-review flags already filtered by SQL.
2. SWI-125 rejects not-due objectives before content-dependent checks.
3. SWI-126 selects pure cues from metadata before hydrating cue-stage winners.
4. SWI-123 makes new-word admission consume the background reserve.
5. SWI-127 restricts discretionary mode changes to successful closure and retains
   only material reachable within a session.

The first three preserve admission policy. The last two implement the product
boundaries agreed during the investigation. Migration 0070 belongs to the reserve
change and requires the documented stopped-writer schema release procedure.

| Branch, from trunk to tip | Commit title |
| --- | --- |
| `codex/session-review-flags` | Reuse SQL skill eligibility during ordinary review selection |
| `codex/session-review-due` | Reject not-due review objectives before content checks |
| `codex/session-cue-hydration` | Select pure cues before loading full exercise content |
| `codex/session-background-reserve` | Make session admission consume a background-maintained teaching reserve |
| `codex/session-reachable-payload` | Fix session mode boundaries and retain only reachable material |

## Work-count comparisons

Baselines were captured with matching fixtures before each owning change. Current
assertions live in `tests/vocabulary-composition.test.ts` and
`tests/vocabulary-study.test.ts`.

| Fixture and measured work | Before | After | Preserved behavior |
| --- | ---: | ---: | --- |
| One ordinary production-review objective: duplicate flag query executions | 2 | 0 | Solidify also performs zero flag lookups after fixed-learning-skills feedback |
| 2,000 scheduled objectives: content-eligibility callbacks | 2,000 | 6 | Same three selected words |
| 300 cue candidates, five winners: full content hydrations | 600 | 5 | Same selected identities and order |
| 1,002 introduction candidates, small reserve: readiness callbacks | 1,002 | 2 | Only ready reserve members can supply new words |

The cue baseline includes a separate hydration pass in the current sense
reconciliation gate. The replacement loads relationship identities for that gate.
Those identity reads and the candidate/adoption SQL remain. Cue-stage winners can
still be discarded by the later overall capacity step, and final payload assembly
still reloads admitted cues.

Illustrative single-run timings were 15.80 → 6.70 ms for sparse review composition
and 34.63 → 6.15 ms for cue selection. These runs are not statistically robust;
the deterministic counts provide the stronger evidence. They do not isolate or
predict the whole HTTP request.

## Frozen-payload comparison

The same one-word fixture includes teaching, general exercises and curated
Maintain material. A warmup separates dictionary-baseline creation from steady
assembly. Each baseline mode serialized 10,929 bytes, with 59 content-query
preparations and 199 total statement preparations.

| Starting mode | Bytes after | Content-query preparations after | Total preparations after |
| --- | ---: | ---: | ---: |
| Unstudied | 6,975 | 31 | 84 |
| Solidify | 4,399 | 28 | 76 |
| Practice | 3,595 | 16 | 60 |
| Maintain | 2,595 | 12 | 47 |

These counters count statement preparations once, not both prepare and execute as
the production flight recorder does. Serialized bytes describe the retained
payload, not WAL traffic or physical disk-write latency. Unstudied still retains
Solidify material for More after teaching completion. Solidify keeps its existing
priming choice; automatic graduation applies at closure.

Rerun the candidate payload comparison with:

```sh
RUN_PAYLOAD_BENCHMARK=1 node --import tsx --test --test-name-pattern='measure reachable payload' tests/vocabulary-study.test.ts
```

## Reserve lifecycle and UI evidence

Migration and reserve tests cover conservative hints on upgrade, immediate newest
top admission with a 40-member cap, explicit top preparation at zero daily quota,
preserved content/jobs on eviction, empty-reserve recovery, durable restart,
single-flight asynchronous wakes, transient failures, maintenance/stop controls,
disabled learners and periodic discovery of publication without session visits.
Usable content can become ready while an old paused job remains untouched.
Composition tests cover stale hints, newest coherent teaching, frozen snapshots,
and absence of foreground planning, requests or worker wakes.

A separate source review of the reserve lifecycle found no additional correctness
issue. It did not independently execute the runtime. One learner's maintenance
pass remains synchronous; yielding between bounded learner batches does not make
that pass free of event-loop contention. Audits become due after five minutes,
and backlog can extend that delay.

The coordinator exercised `/tests/browser/vocabulary-summary-mode.html?fail=1`
and `?narrow=1&fail=1` through the real `VocabularyStudy` surface and controller,
with simulated transport. Pending and failed closure kept all mode choices
disabled. Keep summary open survived failure and retry. Successful retry enabled
the choices; mouse and keyboard choices each produced one future-state write,
zero session mode commands and zero completion cancellations. At 420px with
125% text, the long meaning wrapped and the focused mode control remained usable.
Backend tests separately establish durable effects and historical replay.

## Feedback revision

Review content checks are named `isReviewContentUsable`. New teaching and
Solidify always use recognition and production, with one word-level learning
content gate and no review enablement/relevance lookups. Authored and fallback
material tests cover disabled and suppressed review settings, both-direction
coverage, graduation, and preservation of the settings for later review.
Previously retained session subsets remain replayable. This revision reduces
Unstudied/Solidify assembly by a further 12 SQL statement preparations each;
serialized bytes and content-query counts are unchanged.

## Integrated validation and limits

The production build and all four candidate payload measurements passed. Full
Node-suite validation passed 2,664 tests, with zero failures, five skips and one
TODO, using concurrency four and local listener access. The final stack includes
upstream fixture correction #490 through base `f394382d`. The
reserve migration's rollback-test migration ID advances past migration 0070 so
the intended SQL failure is reached and rollback remains exercised.

## Remaining measurement targets

The large review/cue SQL, adoption work, selected-material assembly, JSON
serialization and content-sized session persistence remain. The 1,000-item
capacity also remains. After deployment, measure these phases, actual selected
row/payload sizes, and background contention on representative learner state.
No historical cleanup, storage redesign, provider change, or eviction-job
cancellation is part of this stack.
