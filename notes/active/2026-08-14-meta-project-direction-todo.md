# Meta project direction todo

status: active
type: work-bundle
created: 2026-08-14
retire-by: 2026-09-14
related:
  - STABILITY_FRONTIER.md
  - docs/vision/

Context: reflection and cue-based production have landed in a decently stable
manner. This note is a working todo list for meta / project-direction work that
follows from that — not a Linear backlog and not a product contract.

Decision checkpoint (2026-08-15): the private-beta workshop settled the first
cohort, product-surface, reflection, onboarding, and UI boundaries. Those
accepted wave decisions and the proposed advancement test have graduated into
`STABILITY_FRONTIER.md`. Physical tenancy, account/request context, storage,
vendors, release/recovery mechanics, and bounded support access remain the
coupled decisions for the next service-boundary design. This note remains
working input for later spec reorganization and should not be cited as current
authority.

## Recommended next outcome

The next frontier should orient around:
Run a credible invite-only hosted beta for a small trusted cohort, with isolated and recoverable learner data, intentional upgrades, a coherent core experience, and enough operational visibility to support users safely.

That makes UI, tenancy, deployment, and release enabling workstreams—not competing product goals.

## Recommended focus sequence

1. Define the private-beta contract
  A short product/design focus covering cohort size, supported study profile, onboarding, supported devices, data promises, core product surface, feedback/support expectations, and launch success criteria.
  This prevents “beta-ready” from becoming an indefinitely expanding polish standard.
1. Resolve the hosted-service architecture as one coupled decision
  Tenancy, authentication, storage, deployment topology, and upgrade mechanics should be considered together. In particular, the existing [beta web-service plan](/Users/jw/dev/chinese-study-app/PLANS/beta-web-service-plan.md) assumes Postgres relatively early, but the current synchronous SQLite persistence layer makes that a substantial rewrite—not an automatic prerequisite.
  The architecture pass should explicitly compare:
  isolated service/database per learner;
  multiple learner databases behind one service;
  shared SQLite with row tenancy;
  shared Postgres with row tenancy.
  A per-learner deployment or database could be a legitimate private-beta architecture rather than an embarrassing workaround, depending on cohort size and how much shared-content operation the beta needs.
  Release and upgrade policy begins here: schema migrations, compatibility, backup, rollback, and failed-upgrade behavior must shape the first hosted persistence design.
1. Build one hosted beta steel thread
  Invite/account creation → authenticated request → learner bootstrap → study session → reflection/cue application → persistence across an intentional release.
  Use at least two identities to prove isolation. This should not require unsafe manual database surgery.
1. Run UI redesign as a bounded parallel track
  Begin design once the beta contract identifies the critical flows. Implement it in slices—shell/navigation, onboarding, study session, completion/reflection—rather than as a big-bang reskin.
  The frontend boundaries are adequate for incremental work, but several UI files and the shared stylesheet are large enough that the redesign will also require component-boundary cleanup. SWI-28 may improve the design workflow, but it is not a substitute for the actual product/interaction brief.
1. Complete the beta trust gate
  Before inviting users:
   - backup and restore drill;
   - versioned migration and rollback procedure;
   - authentication/session/security review;
   - prompt-injection and model-cost exposure controls;
   - useful error logging and support diagnostics;
   - privacy, support-access, export, and deletion posture;
   - hosted dogfooding through at least one real release.
1. Invite the first cohort and learn
  Product enhancements can then continue alongside service operation, which is the strategic benefit you are aiming for.
## Reflection prompt work
Linear currently shows SWI-25 as the sole Focus item, with no Async work active. Its current shape—commit a prompt, dogfood it for several days, then iterate—is now more naturally an Async calibration lane than the main project focus.
I recommend moving it to Async at its next clean checkpoint and making the beta contract the next Focus. Prompt quality should have a bounded “credible enough for beta” threshold, not an open-ended perfection gate. I have not changed its status.
## Important missing beta concerns
Your list is directionally complete. The additions I would carry into the beta contract are:
- new-user cold start and corpus bootstrap
- migration of existing dogfood data
- study-profile and timezone/day-boundary policy
- security and provider-cost abuse
- operational diagnostics and user feedback
- historical reflection/schema compatibility across releases
- explicit product success criteria for the cohort
Cold start is especially important: the product vision already identifies it as a structural weakness because agent value improves with accumulated learner evidence.
## What the documentation cleanup should do next
Once the beta outcome is aligned, I recommend a fairly decisive cleanup:
- Replace the obsolete cue frontier in [STABILITY_FRONTIER.md](/Users/jw/dev/chinese-study-app/STABILITY_FRONTIER.md) with the hosted-beta outcome, current gap, beta invariants, and a new advancement test.
- Graduate the completed production-task/cue decisions out of [SWI-24’s design plan](/Users/jw/dev/chinese-study-app/PLANS/swi-24-production-task-cue-contract.md) and eliminate stale gates. The canonical reflection spec still says the exact V2 schema is awaiting human orientation even though it is implemented.
- Reduce [study-action-model.md](/Users/jw/dev/chinese-study-app/SPECS/study-action-model.md) to its durable action/scheduling/evidence contract. Its completed implementation roadmap and old open questions should become history.
- Consider extracting the production-task/cue contract into its own canonical spec.
- Split [reflection-proposals-and-handles.md](/Users/jw/dev/chinese-study-app/SPECS/reflection-proposals-and-handles.md) along its two real organizing principles:
  - generic proposal/authorization/application governance;
  - the versioned operation registry.
- Tighten [learning-review-model.md](/Users/jw/dev/chinese-study-app/SPECS/learning-review-model.md) around word lifecycle semantics and remove transitional scheduling/storage language now owned elsewhere.
- Refresh the [hosted-beta tenancy map](/Users/jw/dev/chinese-study-app/PLANS/hosted-beta-tenancy-table-map.md). It inventories 18 tables; the steady schema now has roughly 30, including the complete reflection and production-cue subsystems.
- Create durable hosted-account/content-ownership behavior and hosted-service/release architecture documents only after those decisions are accepted.

The new frontier’s advancement test should involve real operation, not merely merged infrastructure: an invited non-developer can onboard and study repeatedly, two accounts are demonstrably isolated, learner data survives a release, restore has been tested, and support does not depend on improvised database edits.

The workshop settled Mandarin-only scope and the dogfood-history migration
requirement. Physical tenancy remains deliberately open for the service-boundary
design, as recorded in the frontier.
