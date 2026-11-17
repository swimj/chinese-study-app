# Custom senses and vocabulary intake evaluation

This record explains the evidence for private sense choices, exact-set teaching,
and the Stash/Chat intake flow. All learner data was synthetic. No production
migration, merge, deployment or hosted learner observation participated.

## Automated and rendered checks

The integrated suite passed 2,890 tests, with five existing skips and one existing
todo (2,896 total). Server typechecking and the production frontend build passed.
Coverage includes populated migration and rollback, cross-learner isolation,
exact-source reuse, independent preparation leases, default compatibility,
retained sessions, completed-lesson warmups, shared repertoire demand, command
replay, stale versions, Undo, deferred matching and real authenticated HTTP/SSE.

The full run initially found five failures in two old HTTP fixtures that inserted
all columns positionally. Named-column inserts now exercise the defaulted
teaching-set migration column; both affected suites and the subsequent full run
passed. Independent backend review also found and corrected wrong-source default
reuse, premature default aliases, reconciliation retiring unrelated custom
lessons, and recognition snapshots taking the wrong introduction.

A fresh `gpt-6-luna` evaluator received the [goal brief](2026-11-15-custom-senses/ui-brief.md),
not implementation instructions. Native browser tools were unavailable and the
first preview processes had ended; those attempts reached no learner task. After
the coordinator restarted Vite and an isolated headless Chrome profile, the
evaluator used CDP DOM/input/screenshot operations. It reported no source, test
or direct API reads. The coordinator does not have a complete tool-activity trace
to independently certify that report. Injected repository instructions remained
available; fresh context is not a technical isolation boundary.

The evaluator completed bare add/Undo, context selection/reset, a proposed
larger expression, explicit new-sense Add and learner-only Undo, deferred
ambiguity resolved from Outstanding outside chat, and adding a sense to a word
already in Practice. Stale-save and failed-save recovery worked. Keyboard
submission, draft preservation and exact transcript scroll restoration worked.
The one-sense and sixteen-sense cases, expanded notes and long labels remained
usable in the approximately 480px content panel at 125% text. No confirmed
functional defect emerged. The sticky composer covers part of a long card at a
time; its remaining controls were reachable by scrolling.

The fixture uses the actual application components with synthetic HTTP/SSE and
preparation. Search retention was not independently verified: the evaluator
found the Add by hanzi field and verified its draft persisted, but did not find
a separate search field. A separate inventory-unavailable variant and a direct
My Words check immediately after the new-sense Undo were not completed.

Selected [ready](2026-11-15-custom-senses/task1-ready.png),
[outstanding](2026-11-15-custom-senses/outstanding-after-finish.png),
[keyboard](2026-11-15-custom-senses/narrow-keyboard-ready.png),
[long-note](2026-11-15-custom-senses/narrow-long-note-open.png) and
[stale-save](2026-11-15-custom-senses/stale-save.png) screenshots retain the visible
results. The implementation agent separately verified the real operator panel
with synthetic report data: lazy loading, retry, empty/unknown/partial cost,
large counts, keyboard expansion and horizontal table scrolling at 480px and
125% text. See its [operator screenshot](2026-11-15-custom-senses/operator-narrow.png).

## Flatter presentation check

A CSS-only follow-up removes the nested chat/card/row frames and filled status
badges. The mode toggle uses an underline; secondary actions remain semantic
buttons styled as text, with visible keyboard focus and at least 44px button
height at standard text size. Add, Send and recovery actions retain emphasis.

The coordinator inspected the actual components with the same synthetic fixture
at a 760px viewport, including 125% text and a 496px chat panel. Long sense labels
and expanded notes wrapped without page or dialog horizontal overflow. The
sense preset changed the checked selection, and Tab navigation reached the
secondary controls with a visible outline. The production build and all four
existing intake UI tests passed. This was a focused coordinator check, not a
repeat of the independent task evaluation above. Earlier screenshots document
the initial presentation; current views are [chat](2026-11-15-custom-senses/flat-chat.png),
[outstanding](2026-11-15-custom-senses/flat-outstanding.png), and
[enlarged notes](2026-11-15-custom-senses/flat-narrow-notes.png).

## Live chat model comparison

The [retained comparison](2026-11-15-custom-senses/model-comparison.json) and
[compressed exact evidence](2026-11-15-custom-senses/provider-evidence.tar.gz)
contain 22 bounded variants and 320 chat provider requests, including three
rejected transport requests. The original scope expanded to compare models and
reasoning levels after Justin requested a latency/quality comparison. Variants
retain exact rendered prompts, schemas, input fixtures, provider requests and
responses, tool events, state before/after, settings, latency and usage. Temporary
SQLite databases are excluded from the archive; the exported records retain the
relevant evidence. No credential was copied into these artifacts.

Initial Chat Completions trials rejected tool calls with reasoning enabled for
newer models. The implementation now uses the official OpenAI SDK and Responses,
with `store: false`, complete output-item continuation, strict function schemas,
no automatic SDK retries and the existing bounded domain tool loop. Reflection
keeps its existing transports. The adapter's usage accounting supports both
Responses and Chat Completions token fields.

The prompt preserves lexical ownership, the distinction between inventory and
useful defaults, uncertainty, and the full linguistic examples from
`sense-inventory.md` and `default-useful-selection.md` at `ec4d6d00`. Adaptations
replace inventory/default enumeration with tool actions and cards. Live failures
motivated explicit requested-spelling and proposal instructions, English prose,
and avoiding promises such as “I'll add it” before a proposal is accepted.
Lookup now returns canonical senses, defaults and learner state together, removing
two redundant model round trips. Prompt hashes separate these revisions; results
from different revisions are not pooled as a model benchmark.

| Final-contract variant | Cases | Median turn | Observed consequence |
| --- | ---: | ---: | --- |
| GPT-5.4 nano, low reasoning | 4 | 3.49 s | Invented an unlooked-up identifier for the redirect; server rejected it |
| GPT-5.4 mini, low reasoning | 4 | 2.87 s | Omitted the card for a context add and a redirect |
| GPT-6 Luna, no reasoning | 12 | 2.79 s | Omitted cards and recommended no checked sense in the no-default case |
| GPT-6 Luna, low reasoning | 12 | 3.71 s | Correct core adds; omitted advisory phrase and fixed-expression proposal cards |
| GPT-6 Luna, medium reasoning | 6 | 5.49 s | Did not fix those missing proposals |
| **GPT-6 Sol, low reasoning** | **12** | **2.75 s** | **Correct actionable outcomes and acceptable lexical explanations in coordinator review** |

GPT-4.1 mini was also screened on the earlier contract. It was fast but missed
most required actions. Sol's final twelve-case run used 29 provider requests;
the slowest turn was 4.92 seconds. A six-case follow-up with the same final
prompt had a 2.96-second median. These are local wall-clock observations from
small, mostly single-draw fixtures, with provider prompt caching and network
variation. They are not percentile/SLA, statistical reliability, mobile-network
or hosted-load evidence. GPT-6 Sol with low reasoning is the selected chat
configuration; smaller candidates did not clear the observed action-quality bar.

The automated scorer reports 11/12 for the selected run because it expected
接发球 for a request explicitly about the receiving player. Sol proposed
接发球方 and correctly distinguished the player/side from the return action.
The coordinator accepts this as a better lexical match; the original expected
value and failed check remain in the evidence. The same issue occurs in some
other variants. This is an editorial judgment, not a silently rewritten gold
answer. The two initially held-out cases (过时不候 and material 泡沫) were later
used for follow-up comparisons and are no longer held out for those runs.

## Teaching and deferred matching

A six-request live authoring comparison generated one default chemical 蒸馏
lesson and one exact chemical-plus-AI lesson through the actual preparation
worker. Both published coherently into the synthetic database with separate
source/package identities. The custom lesson taught both uses with distinct
natural examples and rehearsals; the default lesson stayed chemical-only. The
coordinator judged both acceptable. Authoring prompts were unchanged; inputs
contained canonical senses only, with no private context. One word and one draw
per set provide bounded evidence, not a general teaching-quality estimate.

The runner and exact teaching inputs/outputs are retained in the archive.
Three additional live deferred-matching calls used GPT-6 Luna with low reasoning
through the actual worker. For 打, the sentence 她打了我一拳。 selected the striking
sense; bare 打 and an unsupported claim that 打 names a red color both retained
defaults and produced attention for learner choice. The exact calls and card
outcomes are retained in the archive. Deterministic tests separately cover
leases, stale-result guards and fallback behavior.

## Reproduction and limits

The retained [chat runner](2026-11-15-custom-senses/intake-runner.mts) and
[teaching runner](2026-11-15-custom-senses/teaching-runner.mts) use migrated temporary
databases. Run from the repository root with `node --env-file=<private-env-path>
--import tsx <runner>`. Chat requires `--execute --variant=<new-unique-name>
--cases=full --model=gpt-6-sol --reasoning=low`; `--dry-run` seeds without calls.
Teaching requires `--execute`. For the
[matching runner](2026-11-15-custom-senses/matching-runner.mts), pass `--execute`
and `--input-db="/path/to/chat-run/database/app.db"` with the synthetic database
from a completed `full-sol-low` chat trial. Matching works on a copy. Each runner
reserves a new output directory under the system temporary directory. On macOS
or Linux, set `TMPDIR` to an existing directory to choose where it writes.
Chat and teaching manifests record the base revision and prompt hashes. The chat
manifest also records working-file status. Exact requests establish the call
contract even when the base revision preceded final integration.

No hosted migration rehearsal, production restore exercise, Clerk browser
session, real learner data or real-provider browser end-to-end test ran. The
browser fixtures, actual HTTP tests, domain tests and live model trials establish
different parts of the flow; none alone proves deployed behavior.
