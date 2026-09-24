# Local word introduction lab

The lab exercises the full authoring and presentation path for the
[word content model](word-content-model.md): lexical input → bootstrap content
→ pinned teaching package → paced introduction → deterministic rehearsal.
It is a development preview, with no study-session coverage, graduation,
review reflection, or learner-progress writes.

## Run locally

```bash
npm run dev:intro-lab
```

Open <http://localhost:4177/intro-lab>. The command starts Vite on 4177 and the
API on 5178, using an isolated synthetic database and draft directory under
`data/intro-lab/`. Stop both with Ctrl+C. Override ports with `INTRO_LAB_PORT`
and `INTRO_LAB_API_PORT` if necessary. The ordinary app's development commands
and database are unaffected.

The six worked examples work without credentials or the API. To generate new
content, set `OPENAI_API_KEY` in the worktree's ignored `.env` or export it into
the launching shell. `OPENAI_BASE_URL` is optional. Credentials stay on the
backend. If this machine needs the repository’s existing local provider proxy,
set `APP_USE_LOCAL_PROVIDER_PROXY=true` as documented in `.env.example`.
To load an existing environment file without copying it:

```bash
node --env-file=/absolute/path/to/.env --import tsx scripts/dev-introduction-lab.ts
```

## Suggested walkthrough

1. Open 报备 from the samples. Advance one beat at a time with Space or the
   visible next button. Earlier beats remain available; go back when useful.
2. Finish the introduction and try its rehearsal. Try an alternative answer,
   then the taught expression. This is a constrained drill, not a judgment that
   every other completion would be bad Chinese.
3. Try 不堪 or 为所欲为 to inspect the light grammar/literary parsing rhythm.
4. Save a sample, reload the page, and reopen the saved draft. Inspect or export
   its source content separately from the teaching player.
5. With credentials configured, enter a new word, its pronunciation and optional
   guidance. Bootstrap it, inspect the uses and examples, then generate teaching.
   The teaching stage uses that exact saved content. Retry either stage as a new
   draft when needed.

## Persistence and compatibility

Each saved draft is an immutable JSON envelope with a server-generated ID,
UTC creation time, origin, word content, and optional teaching package. A
bootstrap draft has no teaching yet. Authoring teaching creates another draft
that retains the exact content identity and supplies a new package identity;
it does not overwrite the bootstrap. Import validates the complete model and
references before saving. These files are local authoring drafts, not published
shared study content.

The archive lives at `<APP_DATA_DIR>/word-content-workbench/`. The launch script
sets `APP_DATA_DIR` through an explicit argument to `data/intro-lab/`. There is
no migration of the study tables. Existing cues and supplements keep their
current representation; the model's compatibility adapters remain the bridge
for explicit review integration.

The development page is selected before mounting the live app and its study
controllers. The backend routes additionally require dev mode, trusted-local
authentication, Mandarin, and `APP_WORD_CONTENT_WORKBENCH=1`. They are not a
hosted publishing API. Provider output must pass schema and domain validation
before it becomes a saved draft. Teaching generation selects a target occurrence;
server code computes the actual Unicode spans rather than asking a model to
count characters. For generated rehearsal, the app supplies the exact response
instruction and uses no extra cloze frame; the provider authors the cue only.
Generated rehearsal stimuli are rejected if they expose the target answer; the player also hides answer-bearing surrounding
content during recall. Import preserves authored content after model validation.

## What this prototype settles and leaves open

The lab makes content identity, source references, immutable package assembly,
paced navigation, and constrained response matching concrete. Player position
and responses are temporary preview state. Reopening a package starts a fresh
preview; completion awards no study credit.

Shared publication/storage, learner-package association, resume across learning
days, recognition reveal integration, and learning/graduation policy remain the
next integration layer. None requires changing the existing word lifecycle just
to represent a teaching package. See the
[owning spec](../SPECS/word-bootstrap-and-introduction.md) for those policy seams.
