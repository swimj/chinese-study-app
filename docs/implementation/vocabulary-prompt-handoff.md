# Vocabulary authoring experiments

This handoff explains the isolated prompt experiment surface for the vocabulary
build. It lets Justin and implementers compare authoring variants against retained
inputs before choosing production prompts. The authoring targets come from the
[first-delivery plan](../../notes/active/2026-10-16-vocabulary-first-deliverable-plan.md#content-authoring-and-prompt-evaluation).

## Current experiment boundary

The harness lives in `server/word-content-lab/vocabulary-experiments/` and has no
application database, publication, learner-scheduling, or credential access.
The experiment code does not write production prompts or introduction-lab routes.
Teaching/general prompt files in this directory are retained trial variants; the
editorial findings below identify the strongest next review candidates.

Four roles have separate retained inputs:

| Role | Input and editorial purpose |
| --- | --- |
| `bootstrap` | Lexical forms and optional guidance; selected uses and examples |
| `introduction` | Full bootstrap document; existing learner-advanced beat style |
| `teaching_exercises` | Full bootstrap document plus the exact delivered introduction, materialized to displayed text with its source references |
| `general_exercises` | Full bootstrap document; varied Solidify/Practice repertoire without introduction priming |

Bootstrap and introduction experiments default to copies of the production prompt
text captured when preparing the run. Teaching exercises reinforce what was
actually taught; general authoring can explore a generous set, including small
wording variations. Neither role has a maximum exercise count or deduplication
filter. No experiment changes core reflection reasoning.

## Integration contract

`projectExperimentInput()` produces the actual model input, retained verbatim as
`userPrompt`. An introduction must name the supplied source document. Its beats
are validated and resolved before a request is saved. The experiment input keeps
the original source alongside the rendered teaching for later comparison.

Exercise output is:

```json
{
  "exercises": [{
    "id": "local-exercise-id",
    "sourceUseId": null,
    "stimulus": { "kind": "direct_text", "text": "A learner-visible English cue." },
    "teachingNote": null
  }]
}
```

A `phrase_cloze` stimulus instead has `frame` and `text`, containing one `____`
blank for the entire target. `sourceUseId` is one exact source-use ID or null.
It is an authoring claim to inspect, not a global sense ID or proof of semantic
alignment. Production adapters remain responsible for identity resolution and
sense policy. `teachingNote` is optional post-answer material, represented by null
when absent. The adapter supplies exact target answer forms; the model does not
author accepted lexical membership. This experimental wire format is separate
from production exercise types and can be adapted after editorial trials.

Structural checks validate shape, local references, unique exercise IDs, blank
form, and visible Chinese answer leakage using the existing authoring guards.
They do not establish natural Mandarin, fair evocation, pinyin leakage, lesson
coverage, or learning effectiveness. Those require inspection and later encounters.
The existing strict JSON Schema validator supplies only the structural layer.

## Retained runs

Each UUID directory contains:

- `request.json`: role, variant, complete source input, exact prompt and hash,
  projected user input and hash, schema, projection version, model/settings, UTC time.
- `result.json`: exact returned text, output origin, provider/model/request metadata,
  finish reason, supplied usage/cost, structural validation and preview, or a
  bounded provider-failure outcome. Invalid and truncated output remains inspectable.
- `reviews/<uuid>.json`: separate attributed pool/exercise review notes and editorial
  disposition. Reviews do not mutate generated output or declare learning efficacy.

Requests are saved before transport. Atomic non-overwriting publication protects
completed files; another attempt gets another run directory. Earlier success is
retained when a subsequent stage fails. Failed transport keeps its request and a
bounded failure code; raw exceptions are excluded because they can contain secrets.
A request without a result is incomplete work, not evidence of a safe retry or
zero provider cost. Keep projection/schema v1 stable for existing archives; a
changed contract needs a new versioned reader.

`executeExperiment()` accepts an injected transport callback. It receives only the
retained request and returns raw text plus explicit response metadata. This is the
integration seam for the existing backend provider infrastructure. It performs no
automatic retry. A caller using live transport must supply the actual model and
settings, retain the returned identifiers/usage, and keep credentials outside the
archive. Live batches are coordinated with Justin. The first authorized editorial trial
completed 21 calls; its scope and findings are recorded below.

## Offline CLI

Commands run without provider credentials or backend initialization:

```bash
node --import tsx scripts/vocabulary-prompt-experiment.ts prepare \
  --role=general_exercises --sample=报备 --variant=general-v1 \
  --archive=/tmp/vocabulary-prompt-experiments

node --import tsx scripts/vocabulary-prompt-experiment.ts prepare \
  --role=teaching_exercises --sample=报备 --variant=teaching-v1 \
  --archive=/tmp/vocabulary-prompt-experiments
```

Preparation prints the UUID and request path and makes no model call. Existing
introduction-lab samples supply fixed source cases; `--input=/path/to/input.json`
accepts another complete role-specific input. `--prompt` overrides prompt text.
Set `--provider`, `--model`, `--reasoning`, and `--max-output-tokens` when preparing
an intended live variant; unspecified provider/model remain explicitly unknown.

Record a previously obtained raw JSON output with its origin:

```bash
node --import tsx scripts/vocabulary-prompt-experiment.ts record \
  --run=RUN_UUID --output=/tmp/output.json --origin=manual_import

node --import tsx scripts/vocabulary-prompt-experiment.ts compare \
  --runs=RUN_UUID,OTHER_RUN_UUID --html=/tmp/vocabulary-comparison.html

node --import tsx scripts/vocabulary-prompt-experiment.ts review \
  --run=RUN_UUID --note-file=/tmp/review.txt --decision=revise
```

Use `--origin=fixture` for synthetic test output. The CLI never guesses missing
provider identity, request IDs, spend or usage. A live call uses the injected
runner to retain those facts. `review` defaults to pool scope; `--exercise-id`
records a note for a specific returned exercise. Use the same archive option on
all commands when overriding the default directory.

The comparison HTML is a local static preview with answer disclosures, displayed
teaching context, raw prompt/input/output, and explicit output-origin labels.
Model-authored markup is escaped; it loads no external assets or scripts. This is
an authoring preview, not verification of the production session layout. Review
records are retained for scripting; this first preview does not provide a review
editor or render the separate review files.

## Verification and next editorial pass

The focused tests cover exact teaching input, broad/near-duplicate pools, unknown
use rejection, answer leakage, retained invalid/truncated/failed attempts,
non-overwriting results, independent review records, and escaped previews. No
provider spending, prompt effectiveness, or production publication is implied.

Start with a small side-by-side comparison using the same retained sources and
settings. Judge teaching with its introduction, and general practice both as
individual cues and as a pool. Keep observations as attributed notes rather than
requiring automatic editorial scores. The experiment framework follows the
[official evaluation workflow](https://developers.openai.com/api/docs/guides/evaluation-best-practices#design-your-eval-process),
while the app-specific criteria come from the delivery plan.


## Authorized live trials and editorial findings

The [live runner](../../scripts/vocabulary-prompt-trial.ts) uses the existing
OpenAI-compatible transport and requires an explicit `--allow-provider-calls`
flag. Load credentials through the existing environment mechanism. It reserves a
unique batch name before calling; rerunning that name fails rather than silently
spending again. It stops a batch after a provider failure. Successful raw provider
bodies, timeout/cache settings, normalized usage and repository-based cost estimates
are retained alongside each immutable request/result. It never installs the app
ledger or publishes generated content. `--input-directory` supplies retained
role-specific JSON inputs for controlled introduction-scope tests.

```bash
node --env-file=/absolute/path/to/.env --import tsx scripts/vocabulary-prompt-trial.ts \
  --archive=/tmp/vocabulary-prompt-trials --samples=报备,泡沫,不堪 \
  --variant=general-v4-trial --role=general_exercises \
  --prompt=server/word-content-lab/vocabulary-experiments/prompts/general-exercises-v4.md \
  --allow-provider-calls
```

The first trial used `gpt-5.6-luna`, high reasoning, and fixed introduction-lab
sources. There were 21 completed calls across a compact baseline, four general
variants and two teaching variants, yielding 163 draft exercises. All completed
outputs passed the structural checks. One earlier sandbox-blocked request is
retained separately as failed; it has unknown usage/cost. The completed calls'
repository-based cost estimate totals $0.0421, not verified billing.

General **v4** and teaching **v2** are the recommended next editorial-review
candidates. Broader v1 generated many options but lost short conceptual anchors;
v2 restored them. Softer answer-scope language in v3 still allowed whole-state
English cues for a smaller constructional contribution. V4 chooses the answer
scope first: standalone meanings can use direct cues, while a target supplying
part of a larger construction gets context that isolates that contribution.
It produced ten construction clozes for 不堪 while preserving direct anchors
and context alternatives for 报备 and 泡沫. These are observations from individual
runs, not proof of robustness or learner benefit.

Teaching v2 practised familiar construction patterns directly. Both teaching
variants respected a deliberately restricted 报备 introduction: the full source
included partner usage, but the delivered introduction covered only formal
notification, and neither output exercised the untaught use.

Expansion still needs light editorial curation. Some new collocations deserve
review, and a v3 为所欲为 cue used an artificial four-character-expression clue.
Do not infer quality from count, use-ID validity, or schema acceptance. Avoid a
hard format quota or aggressive deduplication policy based on this small pass.

The [detailed findings](../../server/word-content-lab/vocabulary-experiments/findings-2026-10-17.md)
retain exact examples, limitations and next suggestions. Full local request,
response and attributed-review records are in
`/tmp/vocabulary-prompt-trials-20261017/`; the preview pack is at
`http://127.0.0.1:4389/vocabulary-trial-findings.html` while its local server runs.
Preserve this archive for subsequent comparisons. No production prompt has been
selected or applied by this experiment chat.

## Guided review pack

Rebuild the findings overview and its five linked comparison pages from the
retained trial archive without making model calls:

```bash
node --import tsx scripts/vocabulary-prompt-review-pack.ts \
  --archive=/tmp/vocabulary-prompt-trials-20261017 \
  --output=/tmp/vocabulary-prompts-demo
```

The default reading route covers plain cues (泡沫), answer scope (不堪), and
teaching scope (报备). Each page states the review question, explains its selected
versions, links to highlighted exercises, and provides previous/next/overview
navigation. Additional comparisons and the version key are available from the
overview. Full pools follow the reading guide; prompt and run metadata remain
inside disclosures. The renderer checks that highlighted exercise references
exist, so a stale guide fails rather than producing broken example links.
