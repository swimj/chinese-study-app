# Performance picture: constraints and remaining work

status: active
type: research
created: 2026-11-16
retire-when: the remaining work below is scheduled, done, or recorded in owning docs
related:
  - notes/active/2026-11-17-session-composition-streams-plan.md
  - docs/ops/hosted-observability.md
  - docs/ops/backup-cost-and-observability-plan.md
  - docs/private-beta-service-boundary.md

Working memory for the holistic performance effort that started from a read-only
look at hosted production on 2026-11-16. The first round of session composition
work is merged (see the plan note). This note keeps what is still open: the
constraints any further work must respect, what to measure next, and the
remaining directions. None of it is a committed plan; priority and order follow
Justin's broader product and architecture shifts.

The connecting thread: average compute demand is low, but the machine cannot
burst. Work that scales with everything a learner has, done while the learner
waits, is the problem. The remedies are to make hot-path work scale with what is
needed, and to spend idle time deliberately.

## Constraints

- One Node process. `node:sqlite` `DatabaseSync` runs every statement on the main
  thread over one connection, shared by requests and the in-process background
  workers. SQL time is event-loop time.
- Fly `shared-cpu-1x`, 988 MB RAM, one vCPU. Sustained CPU allocation is about
  6–7% of a core. Burst balance accrues while usage is below that, up to roughly
  8 minutes of CPU time; throttling starts when it reaches zero. Anything that
  runs above baseline spends the balance a learner's visit needs.
- The database (1.32 GB on 2026-11-16) is larger than RAM. Pragmas are defaults
  apart from WAL: `cache_size` 2 MB, `mmap_size` 0, `synchronous` FULL, and
  `ANALYZE` has never run.
- Hourly backups now copy the whole database (about 1.34 GB in 80 seconds) to a
  separate receiver. That is a recurring CPU and I/O burst on the same allowance;
  its effect on burst balance and request latency has not been measured.
- About 1,300 `.prepare(` call sites and no statement cache.
- The schema was shaped for understandability and by agent choices validated in
  small tests, not for load. Expect more issues of the kinds below.

## Measure next

Nothing from the recent changes is confirmed in production yet. Once they are
deployed, take one flight-recorder pass and compare with the 2026-11-16 baseline:

| Route or signal | Baseline (2026-11-16) | Why it matters now |
| --- | --- | --- |
| Session start | Composition sampled at 2.5 s typical, ~37,800 statements; start itself never sampled | Local fixture after the stack: ~330 ms and ~8,500 statements, which a throttled machine can still stretch to seconds |
| `POST …/completion/close` | 6.2 s, 15,065 statements; 2.3 s waiting in `BEGIN IMMEDIATE`; 749 KB response | Timed finalization is now cheap locally; the lock wait and response size are separate and unexplained |
| `GET /api/vocabulary/statistics` | 8.1 s; one query run 28 times reading completion JSON blobs (4.0 s) | Untouched |
| `GET /api/vocabulary/progress` | 2.4 s; every learner word joined to the dictionary (1.3 s) | Should fall with the learner-word cleanup; it also reads completion reports |
| Polling endpoints (attention, badges, intake) | About half of all requests; p50 3–40 ms, maxima 3–12 s | Queuing behind a blocked loop, not their own cost |
| Background stalls | Event loop held for 27–40 s at 5–8% process CPU | Cause unidentified |
| Idle machine CPU | 2–3% reported, app process about 1% | Litestream is gone; hourly backups are new; re-baseline |

The stall cause is open between an exhausted burst balance and disk waits on a
database larger than its cache. Fly's CPU balance and throttle series for the
same timestamps would settle it.

## Remaining hot paths

- **Statistics and progress** read large completion JSON per request. They need
  small summary columns or a precomputed daily summary written at closure.
- **Completion close** waited 2.3 s for the write lock, which points at another
  writer, most likely background work, holding it. It also returns a 749 KB
  response; check what the client needs.
- **Session start** still gates and binds content for every admitted item,
  about 100 for a 20-minute day. Chunked admission with top-up, or caching gate
  verdicts (below), are the next levers if measurement says start is still slow.
- **Untimed sessions** still admit up to 1,000 items with the 50/30/20 mix and
  retain the whole pool. Decide whether they remain a supported path or retire.
- **Polling** could become one cheap call, or fewer calls, once the loop no
  longer blocks.

## Storage footprint

The [production database footprint](../../docs/ops/database-footprint.md) records
the current allocation, remaining opportunities and measured session and prompt
storage reductions. See the [backup cost plan](../../docs/ops/backup-cost-and-observability-plan.md)
for the separate decision about returning to Litestream.

- Database settings (memory above database size, `cache_size`, `mmap`,
  `synchronous=NORMAL`, `ANALYZE`) are independent of schema and unlikely to
  clash with any rearchitecture. Deferred until the prioritized picture, but
  candidates to pull forward as low-hanging fruit.

## Session composition: next directions

- **Prepared session reserve.** Prepare session material in idle time so a visit
  is a near-constant read: precompute which items are candidates, and bind
  current content at start only for the chosen slice, so operator improvements
  need no invalidation. Closure is the natural trigger; word adds, operator
  content changes and day rollover are the others. A prepared plan is
  perishable, so it is a hint revalidated at start. Needs the background
  scheduler below.
- **Thematic sessions.** Slower, more deliberate selection is affordable in the
  background but not while the learner waits. Same hint-and-revalidate rule.
- **Chunked admission with top-up**, instead of binding the whole bounded pool at
  start. Requires the session log to record later admissions.
- **Caching gate verdicts**, only if start is still too slow. Working position:
  cached verdicts are hints revalidated at start, as the teaching reserve's are.
  An alternative is a small lookaside stash of invalidated words that drains to
  empty as reconciliation settles. Product changes may retire or simplify some
  gates first.
- **Pure-cue adoption** still inserts schedule rows inside session start. Decide
  whether it moves to closure or the background.

### Gate inventory

| Gate | Owner | Changes when |
| --- | --- | --- |
| Mode, dismissed | Learner | Closure, learner action |
| Schedule: interval, last studied, enabled, post-compensation check, recency guard | Learner | Closure, lapse compensation |
| Skill enablement and relevance | Learner | Rare settings changes |
| Learner sense inclusions and exclusions | Learner | Learner action |
| "Not for me" content deactivations | Learner | Learner action |
| Sense inventory established but empty | Shared | Sense reconciliation |
| Sense content reconciliation pending | Shared | Transient during content replacement |
| Default-useful senses, including explicitly empty | Shared | Operator review, model selection |
| Production proxied (shared pure cue plus targeted cue exist) | Shared | Content published or retired |
| Exercise pool: active, scope, answer words eligible, baseline and fallback rules | Shared | Operator repair, generation |
| Contrast choices all studied, eligible, not reconciling | Cross-word | Any choice word's state changes |
| Pure cues: adoption, schedule, linked words not reconciling | Mixed | Closure, content changes |
| New words: reserve readiness, daily quota | Mixed | Already a hint; quota depends on local day |

If verdicts are ever cached, difficulty follows ownership. Learner-owned gates
have one writer and change at closure. Shared gates fan out to every learner
with the word, which is where invalidation gets hard. Cross-word gates are the
most awkward. Time-dependent state should be stored as timestamps, not booleans.

## Background work and scheduling

### Problem

Background and foreground share one event loop and one burst balance, against a
sustained allowance of about 6.5% of a small machine. Background work is ad hoc:
about half a dozen loops wake on timers (some every 500 ms, others every 5 s or
30 s) and run SQL to find nothing; on 2026-11-16 that was a median of about 50 ms
of SQL per 10 s while idle. There is no notion of priority, so preparation for a
learner days away competes equally with work an operator is waiting on. The
measured 27–40 s stalls were background work. Adding background work, including
the prepared session reserve, without changing this makes the hot path worse.

### What the app can know

- Its own CPU time via `process.cpuUsage()`, attributable per job.
- Whole-machine CPU from `/proc/stat`, including the backup copy.
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
scheduler decide only when and in what order work runs.
