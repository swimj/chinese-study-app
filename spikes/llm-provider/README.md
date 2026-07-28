# LLM Provider Spike

This directory contains provisional code and data for comparing reflection-model
providers before any provider is integrated into the application.

The source contracts are:

- [`SPECS/reflection-proposals-and-handles.md`](../../SPECS/reflection-proposals-and-handles.md)
- [`notes/active/2026-07-10-session-evidence-bundle-design.md`](../../notes/active/2026-07-10-session-evidence-bundle-design.md)

The first fixture corpus is derived from the judgment exemplars in
[`notes/active/2026-07-06-session-reflection-workflow.md`](../../notes/active/2026-07-06-session-reflection-workflow.md).
Those judgments are calibration evidence, not immutable gold labels.

## Layout

- `contracts.ts` mirrors the accepted V1 bundle and V4 result contracts and defines the
  spike-only fixture/evaluation envelope.
- `fixtures/workflow-appendix.ts` contains one fixture for each appendix case.
- `fixtures/stress-cases.ts` contains separately sourced cases that probe
  ambiguous or policy-dependent judgments not covered cleanly by the appendix.
- `prompts/` holds versioned prompt drafts separately from runner code.
- `runner/` contains the provider-neutral run contract, strict output schema,
  local validators, model registry, CLI, and provider adapters.
- `viewer/` contains a localhost-only artifact index and dynamic comparison UI.
- `validate-fixtures.ts` checks structural invariants that do not require an LLM.
- `gaps.md` records missing fields, missing evaluation categories, and limits in
  the source evidence.

## Fixture interpretation

Each fixture has a readiness value:

- `ready`: suitable for the initial provider comparison.
- `provisional`: runnable, but the source judgment admits materially different
  acceptable outputs. The evaluation constraints describe the allowed range.
- `blocked`: retained for corpus accounting, but not suitable for a provider run
  until a missing source field is supplied.

An evaluation mode further distinguishes ordinary scored fixtures from
`exploratory` stress cases. Exploratory cases still have required core judgments,
but permit multiple defensible handle combinations so they can reveal useful
differences among models rather than manufacture a single gold policy.

`referenceResult` is one acceptable structured response. It is not intended for
exact-string comparison. `evaluation` carries the narrower semantic constraints
that a human or later grader should apply.

The fixture contract enforces one `itemResult` for every input item and no result
for an unknown item. Cross-item observations are deliberately deferred; every
appendix fixture currently contains exactly one reflection item.

## Validation

Run:

```bash
node --import tsx spikes/llm-provider/validate-fixtures.ts
```

This validates fixture ids, bundle/result version pairing, one-to-one item
coverage, evidence references, proposal grouping, and basic operation
references. It does not attempt to validate Mandarin judgments.

## Provider runner

The runner currently includes these adapters:

| Provider | Environment variable | Output constraint |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | strict JSON Schema |
| Anthropic | `ANTHROPIC_API_KEY` | native JSON Schema |
| Google Gemini | `GEMINI_API_KEY` | Interactions API JSON Schema |
| DeepSeek | `DEEPSEEK_API_KEY` | JSON-object mode plus local schema validation |
| ZAI | `ZAI_API_KEY` | JSON-object mode plus local schema validation |

OpenAI, DeepSeek, and ZAI share transport code, but remain separate adapters
because their supported response formats, token fields, and request parameters
differ.
Anthropic and Gemini use their native APIs. Adding another provider requires a
new `ProviderAdapter`; it does not change fixtures or the run-artifact contract.

ZAI uses its general OpenAI-compatible endpoint
`https://api.z.ai/api/paas/v4`, not the coding-plan endpoint intended for coding
tools. JSON-object providers receive the result JSON Schema as a stable suffix
to the system message because they do not enforce the schema during decoding;
the runner still validates their output locally.

List the installed adapters and fixtures:

```bash
npm run spike:llm -- --list-providers
npm run spike:llm -- --list-models
npm run spike:llm -- --list-fixtures
```

Preview the exact prompt, input bundle, and output schema without an API key:

```bash
npm run spike:llm -- \
  --provider openai \
  --model MODEL_ID \
  --fixture ex02-to \
  --system-prompt-file spikes/llm-provider/prompts/PROMPT_FILE \
  --dry-run
```

For a live run, export the adapter's environment variable and remove
`--dry-run`. Alternatively, put keys in the ignored root `.env` and use
`npm run spike:llm:env -- ...`. Never pass a key as a command-line argument.

Successful and failed live calls both write a JSON run artifact under
`artifacts/llm-provider/runs/` by default. Each artifact records:

- provider, model configuration id, raw provider model, and reasoning level
- the model id returned by the provider
- prompt, input, and schema hashes
- latency and finish status
- normalized input, cached-input, cache-write, output, reasoning, and total
  tokens when exposed
- raw response text and the provider's raw JSON response
- strict-schema and bundle-reference validation failures

Provider finish reasons that indicate an incomplete output (for example,
`length` or `max_tokens`) are recorded as `output_truncated` before JSON or
schema validation. The raw partial response is retained for inspection, but it
is not exposed as a validated `parsedResult`.

The output directory is gitignored and may contain study evidence. API keys and
request headers are never written to artifacts.

Prompt caching is requested by default. Anthropic receives an explicit cache
breakpoint on the system prompt; OpenAI, Gemini, DeepSeek, and ZAI use their
automatic or implicit prefix caches. Use `--no-prompt-cache` to disable the
explicit request where the adapter supports doing so. Cache hits remain
best-effort and must be confirmed from the recorded usage fields.

The runner does not send `referenceResult`, `evaluation`, readiness notes, or
fixture source metadata. It sends only the selected `inputBundle` as compact
JSON, following the supplied system prompt.

## Incremental runs and dynamic comparison

The checked-in registry contains the shortlisted model configurations. `--models`
is a batch convenience: it performs the same independent call once per model
configuration, in the requested order, and writes one raw artifact per call.

```bash
npm run spike:llm:env -- \
  --models gpt-5.6-terra-high,gpt-5.6-terra-xhigh,gpt-5.4-mini-xhigh,glm-5.2-max \
  --fixture ex02-to \
  --system-prompt-file spikes/llm-provider/prompts/PROMPT_FILE
```

The command runs models sequentially and continues after provider or validation
failures. It does not create a comparison report or copy model output into a
second format.

Start the local viewer separately:

```bash
npm run spike:llm:view
```

Then open `http://127.0.0.1:4180`. The viewer recursively indexes valid run
artifacts under `artifacts/llm-provider/`, so it also finds older flat or nested
artifacts. It supports:

- filtering by fixture, one or more models, prompt hash, and run status
- selecting any runs for the same fixture, including runs created at different
  times or from different prompt revisions
- field-oriented comparisons of summaries, diagnoses, explanations, proposals,
  questions, and unhandled needs
- token and latency metadata, per-run estimated token cost at the listed model rates, raw-artifact inspection, and fixture evaluation
  guidance
- current validation recalculated from the saved raw model text against the
  checked-in contract
- automatic discovery of new artifacts and comparison selections encoded in
  the page URL
- confirmed deletion of individual runs into an unindexed `.trash/` directory

Fixture evaluation constraints appear only after the outputs in
the viewer; they are never included in a provider request. Apart from explicitly
moving a deleted run into `.trash/`, the viewer treats run artifacts as immutable
and does not perform automatic semantic scoring. Current validation is computed
in memory when the artifact index is read; it does not rewrite or migrate the
artifact.

The server binds only to `127.0.0.1`. Override its port or artifact root when
needed:

```bash
npm run spike:llm:view -- --port 4181 --artifacts-dir /absolute/path
```
