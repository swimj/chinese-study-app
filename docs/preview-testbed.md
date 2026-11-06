# Preview testbed

Use this front door to choose, launch, and reset a contributor preview. It is
independent of any evaluator: Justin, a developer, or a browser evaluator can
open the same URL. The catalog covers representative operator review tasks;
existing specialist fixtures remain available through the [testing map](testing.md).

## Launch and choose

After the [contributor setup](scripts.md#contributor-setup-and-local-checks):

```sh
npm run testbed -- list
npm run testbed -- start word
```

The command prints a browsable `/testbed` catalog, a preview URL, and a local
`handoff.md`. Open the preview URL as printed. Ports are allocated per run; use
`--port=4210` when a stable frontend port is helpful. An occupied port fails
rather than connecting to another worktree. Each command starts one scenario;
use another command for a concurrent scenario.

| Archetype | Use it for | What runs | What it cannot establish |
| --- | --- | --- | --- |
| `presentation` | Compact layout and component exploration | Production review page, injected in-memory API | App entry, routing, HTTP or persistence |
| `app-simulated` | Navigation, compact/full review, failures and transitions | Actual `App` → operator route → shell → review page, injected in-memory API | Authentication, HTTP validation, persistence, provider results |
| `real-backend` | Saving, reload durability and applying a proposal | Actual frontend, HTTP application, SQLite and approval journal/worker | Hosted authentication, provider generation, generated assessment/repertoire semantics absent from this seed |

`card` is the presentation view. `word`, `pure-cue`, `teaching`, `repertoire`,
`repertoire-failure`, `attention`, `attention-failure`, and `empty` exercise the
application. The generated catalog describes their starting states and limits.
The pure-cue scenario starts with a word comparison followed by a pure cue.
Repertoire includes an ungenerated sense for explicit reassessment and a
separate admission-failure scenario. Attention covers default selection,
standalone proposals, failures and pagination.

Simulated routes use the actual root at `/operator/improvement`; fixture API
methods replace transport. Unsupported requests throw visible errors. Other
operator destinations are not populated by this scenario. The launcher serves
the fixture entry on operator routes, including reload; it does not alter
production routing. Use `&narrow=1&largeText=1` on simulated preview URLs for
a 480px container with enlarged text. To operate the fixture's synthetic job
controls, remove `hideControls=1` or `clean=1`. Those controls are test machinery,
not product UI. Applying in a simulated scenario can leave an approval queued;
that does not prove the database application succeeded.

## Real Save/Apply scenario

```sh
npm run testbed -- start persist
```

At the operator entry, inspect the deployment exercise proposal in Awaiting review. Edit the proposed text, save, reload, and reopen the proposal
to check durability. Apply the saved revision and inspect the resulting state.
The source exercise, encounter, failed assessment, and manual proposal are
synthetic; subsequent saves, optimistic version checks, and approval/application
are real. `operator-fixture.json` in the disposable data directory records
identities for coordinator-side persistence inspection.

The launcher reuses `prepare-vocabulary-fixtures.ts`, which builds on the UI
annotation seed and vocabulary practice fixtures, then adds this operator case.
`prepare-ui-fixtures.ts` remains the older annotation/session exploration route;
it is not the operator Save/Apply fixture. Both existing builders claim fresh
directories instead of resetting unknown data. No valued database is copied.

Provider work is disabled in the fixture database. The testbed backend starts
only the normal HTTP application and approval worker; it does not start provider
runtimes. Child processes receive an allowlisted environment without inherited
application settings or provider credentials. Vite ignores repository `.env`
files. Authentication is explicitly trusted-local and listeners bind to loopback.

## Sense reconciliation scenario

```sh
npm run testbed -- start reconciliation
```

The actual `/operator/reconciliation` route opens a synthetic 挂钩 case: three
canonical senses imported from an original teaching source and a replacement
teaching document with four unmapped uses. The case includes failed post-teaching
practice and an active learner requesting content. Compare uses, save/reload a
linguistic resolution, inspect missing-handler blockers, and apply a supported
existing-sense resolution through the real backend.

Provider work remains disabled and provider runtimes are absent. Application and
pending replacement are real persisted behavior; replacement generation does not
complete in this preview. The fixture does not establish linguistic correctness,
provider reliability, or production repair readiness. `reconciliation-fixture.json`
records synthetic identities for coordinator-side checks. Reload preserves edits;
stop and relaunch for a fresh directory and database, as in the Save/Apply scenario.

## Reset, cleanup, and evidence

For simulated fixtures, reload the printed preview URL to restore in-memory
state. For the real backend, reload preserves saves. Stop with Ctrl-C and repeat
the launch command to reset into a new directory and origin. The starting content
and scenario are maintained; generated identities and relative dates vary by run.
Every run retains its handoff and logs in a uniquely named system temporary
`chinese-study-testbed-*` directory; real runs also retain the database and
journal there. After stopping, remove only that run's disposable directory if
its evidence is no longer useful. There is no command that deletes an arbitrary
user-supplied data directory, and no global port/process cleanup.

A consumer handoff contains the URL, scenario and archetype, starting situation,
real/simulated boundary, reset and cleanup instructions, and limitations. Task
purpose and expected consequences can be added in ordinary Markdown.

Report validation compactly:

> Scenario and revision: … · Fixture level: … · Tasks actually attempted: …
> Observed results and evidence: … · Simulated behavior: … · Untested limits: …

Compilation and deterministic tests are separate evidence. A successful mock
save does not establish SQLite durability; a populated shell does not establish
that every sidebar destination works.

## Extend a scenario

For a one-off task, adapt the closest existing fixture and give its consumer the
same handoff fields. No new scenario language is required. Keep fixture-only
changes outside production entry points. When a case deserves retention, add
its typed entry to [the catalog](../scripts/testbed/catalog.ts), reuse or extend
the fixture that owns the state, and document its reset and limits. Add focused
behavior coverage where the new setup or transition can fail. Generated databases,
logs, and routine screenshots stay outside source control; a concise curated
pilot record can live with the relevant procedure.
