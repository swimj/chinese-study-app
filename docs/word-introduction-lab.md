# Local word introduction lab

Use the lab to preview the content a learner would see: a word's selected
meanings and examples, a paced introduction, and exercises for recalling it.
This guide covers launching the local preview, generating or importing drafts,
and understanding how they are saved and retried. Preview navigation and
responses remain temporary; they award no study credit.

The lab uses the [word content representation](word-content-representation.md)
and shared provider, with a local draft workflow. The
[generation guide](word-content-generation.md) explains the application's shared
publication path, and [serving](word-content-serving.md) explains live study
integration.

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
   Generating a package calls teaching and then practice from that exact saved
   content. A successful bootstrap or complete package is saved as a new draft;
   retrying never overwrites the source draft.

## Persistence and compatibility

Each saved draft is an immutable JSON envelope with a server-generated ID,
UTC creation time, origin, word content, and optional teaching package. A
bootstrap draft has no teaching yet. The generate-teaching action creates
another draft containing both teaching beats and practice rehearsals, retaining
the exact content identity and supplying a new package identity.

The [lab service](../server/word-content-lab/service.ts) validates teaching before
calling practice, then validates and materializes their assembly before saving.
A failure reports the failing stage and saves no partial package. The lab does
not persist individual successful components: retrying package generation calls
teaching again, then practice. The shared application's
[component-retention mechanism](word-content-generation.md#retaining-work-without-exposing-a-partial-lesson)
has a different recovery path because it must preserve background work across
worker restarts.

Import validates the complete model and references before saving. These files
are local authoring drafts, separate from published shared study content.

The archive lives at `<APP_DATA_DIR>/word-content-workbench/`. The launch script
sets `APP_DATA_DIR` through an explicit argument to `data/intro-lab/`. There is a
separate synthetic application database under that directory; launching the lab
does not modify the ordinary development or hosted study database.

The development page is selected before mounting the live app and its study
controllers. The backend routes require dev mode, trusted-local authentication,
Mandarin, and `APP_WORD_CONTENT_WORKBENCH=1`. Saving a lab draft does not publish
or import it into shared application content.

## Inspecting generated content

Teaching receives the full bootstrap document; practice receives its word and
selected uses/notes without structured examples or example IDs. Practice authors
direct cues or Mandarin phrase clozes with English frames. The app supplies the
target-rehearsal answer contract and stores an empty instruction. The
[generation explanation](word-content-generation.md#authoring-and-validation)
describes that division and its validation limits.

The lab rejects generated rehearsals that expose an accepted Chinese answer
form. Its player hides answer-bearing surrounding content during recall.
Imported drafts preserve authored content after representation/reference
validation, including source-example clozes supported by older packages and
samples. Reopening a package starts a fresh preview.

To inspect the synthetic examples without running the lab or calling a provider,
use the [word-content inspection commands](scripts.md#inspect-word-content-fixtures).
They show the source objects and their frozen presentations separately from
player behavior.
