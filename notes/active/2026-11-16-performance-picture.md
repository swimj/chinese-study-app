# Performance picture: production findings and working direction

status: active
type: research
created: 2026-11-16
retire-when: the performance strategy (priority, compatibility with rearchitecture, delivery order) is decided and recorded elsewhere
related:
  - docs/ops/hosted-observability.md
  - docs/evaluation/trials/2026-11-07-session-composition.md
  - docs/private-beta-service-boundary.md

Working memory for a holistic look at performance. Part 1 records what one
read-only look at hosted production showed on 2026-11-16. Parts 2 and 3 record
the direction discussed afterwards for session composition and background work.
Nothing here is a committed plan; priority, compatibility and delivery order are
still to be worked out once Justin's broader product shifts are on the table.

The thread connecting all three parts: average compute demand is low, but the
machine cannot burst. Work that scales with everything a learner has, done while
the learner waits, is the problem. The remedies are to make hot-path work scale
with what is actually needed, and to spend idle time deliberately.

## Part 1: What production shows

Inputs: the request flight recorder (about 90 minutes of requests, one hour of
10-second samples) and aggregate SQLite queries (sizes and counts, no learner
content). Heavy routes have few samples.

### Runtime shape

- One Node process. `node:sqlite` `DatabaseSync` runs every statement on the main
  thread over one connection, shared by requests and five in-process polling
  workers. SQL time is event-loop time.
- Fly `shared-cpu-1x`, 988 MB RAM, one vCPU. Sustained CPU allocation is about
  6–7% of a core. Burst balance accrues while usage is below that, up to roughly
  8 minutes of CPU time; throttling starts when the balance reaches zero. Idle
  machine CPU is reportedly 2–3%, a large share of the sustained allowance; the
  app process alone sampled at about 1%.
- `app.db` 1.32 GB, WAL 42 MB. Pragmas: `cache_size` 2 MB (default), `mmap_size`
  0, `synchronous` FULL, WAL mode. `ANALYZE` has never run (no `sqlite_stat1`).
- About 1,300 `.prepare(` call sites and no statement cache.
- The schema was shaped for understandability and by agent choices validated in
  small tests, not for load. Expect more issues than this pass found.

### Measured request costs

| Route | Samples | Typical local time | Statements | Main cost |
| --- | ---: | ---: | ---: | --- |
| Session composition, as run by session start | 20 | 2.5 s (max 7.3 s) | ~37,800 | Review-schedule query 3.4 s, pure-cue query 0.9 s, then thousands of per-word gate lookups |
| `POST …/completion/close` | 1 | 6.2 s | 15,065 | 2.3 s in `BEGIN IMMEDIATE`; single-row updates ~0.5 s each; 749 KB response |
| `GET /api/vocabulary/statistics` | 3 | 8.1 s | 128 | One query, run 28 times, reading completion JSON blobs (4.0 s) |
| `GET /api/vocabulary/progress` | 3 | 2.4 s | 18 | Every learner word joined to the dictionary (1.3 s) |
| `POST …/next`, `…/commands` | ~140 each | 30–40 ms | 40–70 | Fine |

- Background SQLite held the event loop for 40 s, 28 s and 27 s in three samples,
  with process CPU at 5–8%. The responsible job is not identified.
- The composition figures were sampled on a read-only path that ran the same
  composition as start; start itself has not been sampled.
- Polling endpoints (attention, badges, intake) are about 1,075 of 2,000 retained
  requests; p50 3–40 ms, maxima 3–12 s from queuing behind the blocked loop.

### Stall cause: open between two explanations

Process CPU of 5–8% during the long stalls matches the throttled baseline, so an
exhausted burst balance explains them at least as well as disk waits (database
larger than RAM, 2 MB cache). Both may contribute. Fly's CPU balance and throttle
series for the same timestamps would settle it.

### Where the bytes are

- About 460 MB in ~70 rows each of `vocabulary_sessions.context_json` (129 MB),
  `vocabulary_session_completions.input_json` (141 MB) and
  `vocabulary_post_session_dispatches.evidence_json` (165 MB): roughly 2 MB per
  session per copy, 6–7 MB of growth per completed session. Smaller sessions
  would shrink these directly.
- `model_invocations`: 154 MB in 9,616 rows.

### Dictionary-sized learner state

- `lexical_words` has 129,282 rows. The dogfood learner has 122,537
  `learner_words` rows, of which 7,982 are in study (7,978 practice, 4 solidify).
- Of the 114,555 unstudied rows, 114,192 were created on 2026-04-11, outside the
  stash, with no intended use and not dismissed: an artifact of an earlier import
  or data model. Each has a default `learner_word_schedules` row and a legacy
  `learner_word_state` row. Only a few hundred have anything else attached.
  Other learners do not have this bulk.
- Any query scoped only by learner scans this set to find the studied words.
- A one-time migration to delete the trivial associations (keeping the
  dictionary and any row with an attachment) is being drafted as its own pull
  request. It is independent of the changes below and needs the schema release
  procedure to deploy.

### Database-level fixes, deferred

More memory than the database, `cache_size`, `mmap`, `synchronous=NORMAL` and
`ANALYZE` are independent of schema and application structure and unlikely to
clash with a rearchitecture. Deduplicating the session blobs depends on the
session direction. All wait for the prioritized picture; product-touching work
ranks above them, though they may be pulled forward as low-hanging fruit.

## Part 2: Session composition

### What it does today

1. One query loads every practice or maintain schedule row for the learner, with
   no due filter (`server/vocabulary/review-selection.ts`). The existing due
   index is unused. For production review, interval, ease, enabled flag and
   recheck time live inside `scheduler_state_json` and are parsed per row; last
   practised and next eligible are real columns. Pure cues keep interval and
   strong-cue state in JSON too.
2. Dueness is computed in JavaScript from interval and last-studied time.
3. Every due word passes through content gates costing several queries each.
4. The survivors are sorted by urgency (elapsed time over interval). All of
   them are admitted: the 1,000-item cap only bounds post-session payloads and
   is never reached. The dogfood due set is about 300, of which a timed day
   serves 60–70, so roughly 300 words are gated and retained to serve 65.
5. Pure cues follow the same shape: load all schedules, check every cue, select.
   Session start also adopts pure cues, inserting a schedule row for each
   eligible shared cue the learner lacks. Composition therefore writes.

In one 5.6 s composition sample the two scans took 4.4 s and the ~37,800 gate
statements 1.2 s. Reading too many rows is the large cost; gates are the smaller.

### Direction: tier 1 first, then measure

Tier 1 needs no caching and no new correctness model.

- Every time condition on a review objective is a "timestamp has passed" test
  and all are ANDed, so one derived due time per objective is exact: the latest
  of next-due, last-studied plus interval, post-compensation recheck, and the
  word-level 6-hour cooldown. All are written at closure or by lapse
  compensation. The cooldown lives in its own table and is live for few words,
  so it can be filtered on the due rows instead of folded in.
- Skills: production schedules and the recognition and contextual-selection
  states are separate tables. Each needs an indexed due time; the best due skill
  per word is chosen in memory as today.
- Solidify already fits: next eligible is the start of the next UTC day, filtered
  by mode, ordered by date added.
- Pure cues: fragile cues are a due-time filter. Strong cues use a daily
  probability roll over all strong cues, which is cheap at real sizes (378
  schedules, 201 strong for the dogfood learner). The measured 0.9 s is the
  surrounding query: a content-eligibility subquery, JSON parsing, and a
  reconciliation check on every cue instead of only the selected ones. The
  policy can stay.
- Scheduler fields that queries filter or order on need to be real columns.
- Ordering by urgency cannot come from an index, but sorting a due set of this
  size in memory is negligible. Urgency itself is open to change; it belongs to
  a "study everything past a threshold" model Justin is moving away from.

The larger saving is admitting less. The intended shape is an ordered list of
likely-useful items, identifiers only, treated as a fuzzy estimate. Content and
every eligibility check are read fresh at true session start for the items
actually pulled, in ordered chunks sized to what the learner's time allows, with
more pulled in as the pool nears exhaustion. Once a session binds an item's
content it keeps it for that session, as undo and replay require.

How timed selection (pressing items, bucket weights, rests, passed-over
counting) should work over such a structure is to be re-derived from first
principles, not carried over from the current due-queue implementation.

Tier 2, only if tier 1 leaves too much cost, is caching gate verdicts ahead of
time. Working position: cached verdicts are hints revalidated at start, as the
teaching reserve's are. An alternative to consider is a small lookaside stash of
invalidated words that drains back to empty as reconciliation settles. This is
engineering, not product, and product changes may retire or simplify some gates
first.

### Gate inventory

| Gate | Owner | Changes when |
| --- | --- | --- |
| Mode, dismissed | Learner | Closure, learner action |
| Schedule: interval, last studied, enabled, post-compensation recheck, recency guard | Learner | Closure, lapse compensation |
| Skill enablement and relevance | Learner | Rare settings changes |
| Learner sense inclusions and exclusions | Learner | Learner action |
| "Not for me" content deactivations | Learner | Learner action |
| Sense inventory established but empty | Shared | Sense reconciliation |
| Sense content reconciliation pending | Shared | Transient during content replacement |
| Default-useful senses, including explicitly empty | Shared | Operator review, model selection |
| Production proxied (shared pure cue plus targeted cue exist) | Shared | Content published or retired |
| Exercise pool: active, scope, answer words eligible, baseline and fallback rules | Shared | Operator repair, generation |
| Contrast choices all studied, eligible, not reconciling | Cross-word | Any choice word's state changes |
| Pure cues: adoption, schedule, linked words not reconciling, cap | Mixed | Closure, content changes |
| New words: reserve readiness, daily quota | Mixed | Already a hint; quota depends on local day |

If verdicts are ever cached, difficulty follows ownership. Learner-owned gates
have one writer and change at closure. Shared gates fan out to every learner
with the word, which is where invalidation gets hard. Cross-word gates are the
most awkward. Time-dependent state should be stored as timestamps, not booleans.

### Longer-term shape

Justin's model: prepare session material in idle time, as a reserve for the
session itself, so a visit is a near-constant read. Precompute which words are
candidates; bind current content at start for only the chosen slice, so operator
improvements need no invalidation. This also serves smaller and more thematic
sessions, where slower, more deliberate selection is affordable in the
background but not while the learner waits. A prepared themed plan is perishable
(a completed session changes what is due), so it too should be a hint
revalidated at start. Closure is the natural preparation trigger; word adds,
operator content changes and day rollover are the others.

### Open

- Whether pure-cue adoption should stay a write inside session start or move to
  closure or the background.
- Which gates upcoming product changes retire or simplify.

## Part 3: Background work and scheduling

### Problem

Idle compute is plentiful on average but background and foreground share one
event loop and one burst balance, and the sustained allowance is about 6.5% of a
small machine. Today's background work is ad hoc: five loops wake on timers
(three at 500 ms, others at 5 s and 30 s) and run SQL to find nothing; in the
sampled idle hour that was a median of about 50 ms of SQL per 10 s. There is no
notion of priority, so preparation for a learner days away competes equally with
work an operator is waiting on. The measured 27–40 s stalls were background work.
Adding more background work without changing this makes the hot path worse.

### What the app can know

- Its own CPU time via `process.cpuUsage()`, attributable per job.
- Whole-machine CPU from `/proc/stat`, including Litestream.
- The burst balance, modelled locally as a token bucket from those numbers. Fly
  may also publish balance and throttle metrics; names and in-machine
  availability are unverified.
- Event-loop delay, already sampled by the flight recorder.

### Direction

1. One scheduler in place of the polling loops: enqueueing wakes it, and a
   single timer covers the earliest future deadline. Idle costs nothing.
2. Priority and a needed-by time on every job: someone is waiting now; needed
   for the learner's next visit; maintenance with no deadline.
3. Small slices that yield, off the request thread and connection.
4. A CPU budget for the lowest tiers: run only while the modelled balance is
   above a reserve and no learner is recently active. Keep this a simple token
   bucket.

Items 1–3 are worth doing at any machine size; item 4 exists only because of the
CPU ceiling, and machine size is itself a dial. Provider calls are waiting, not
CPU: meter local work (SQL, JSON), not jobs in flight.

The scheduler's own overhead is an in-memory priority queue. Its real cost is
migration: each worker has its own claim, retry and restart-recovery logic. Move
workers one at a time, keep their existing durable job tables, and let the
scheduler decide only when and in what order work runs. The session-reserve idea
in part 2 needs this; without it, preparation becomes another ad hoc loop.
