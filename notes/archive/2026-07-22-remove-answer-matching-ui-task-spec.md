# Remove the production answer-matching control surface

status: archived
type: work-bundle
created: 2026-07-22
retire-when: the answer-matching cleanup is implemented or deliberately declined
related:
  - SPECS/french-compatibility-profile-plan.md
  - SPECS/study-action-model.md

## Outcome

Remove the home-page **Answer matching** panel and its user-configurable
localStorage overrides. French production is deprioritized, so this utilitarian
settings surface should no longer occupy the overview page.

Keep the shared, profile-default production normalization used when a learner
submits a typed production answer. It is a small, isolated capability with a
clear future use, and retaining it preserves the current Mandarin whitespace
behavior without retaining a visible settings system.

## Scope

- Remove the Answer matching section, option controls, and related CSS from
  `HomeOverviewPanel`.
- Remove now-unused props and callback plumbing through `HomePage` and
  `useStudySession`.
- Remove browser-localStorage read/write/reset behavior and its UI-only option
  state. Typed production answers should instead use the active profile's
  `defaultProductionMatchOptions` directly.
- Retain `ProductionMatchOptions`, per-profile defaults, and
  `normalizeProductionAnswer`, because the production submission path still
  uses them.
- Remove or update the README statement that advertises the home-page answer
  matching panel.
- Add one `TASKS.md` **Debt** item stating that profile-specific configurable
  French production matching is deferred; trigger it when French production is
  again an active product direction. This is a reminder to reconsider the
  retained normalizer/defaults, not a request to restore the old panel.

## Read first

- `README.md` (French try-out section)
- `SPECS/french-compatibility-profile-plan.md` (normalization and panel history)
- `SPECS/study-action-model.md` (production-action context)
- `src/study-profile.ts`
- `src/features/session/useStudySession.ts`
- `src/pages/HomePage.tsx`
- `src/pages/HomeOverviewPanel.tsx`
- `tests/study-profile.test.ts`

## Done when

- The overview page contains no Answer matching panel, checkboxes, or reset
  control.
- No production matching preference is read from or written to browser
  localStorage.
- Production answer evaluation continues to normalize both entered and expected
  answers through the active profile defaults.
- Mandarin's existing whitespace-insensitive production matching remains
  covered by a focused test; retained French normalization tests remain valid.
- The README no longer promises a home-page answer-matching panel.
- The deferred French configurability is captured in `TASKS.md` Debt with the
  stated trigger condition.
- Relevant focused tests and `npm run build` pass.

## Non-goals

- Do not remove production study actions, profile labels, or French profile
  support generally.
- Do not change the default normalization rules or introduce a replacement
  settings page.
- Do not redesign typed-answer evaluation, aliases, answer classes, or
  scheduling.
- Do not make database, API, or data-artifact changes.

## Dependencies and overlap

Independent of the current reflection/handle-registry focus. It touches the
home overview and production-session controller, so revalidate overlap with
any active front-page cleanup before dispatch.

## Execution constraints

Implement in an isolated worktree from current `HEAD`. Keep the diff limited
to this cleanup, focused tests, README copy, and the one required Debt entry.
Do not edit existing catalog entries.

## Stop / ask

Stop for direction if removing localStorage overrides exposes another active
consumer outside the home-page settings flow, or if preserving default
normalization would conflict with a current production contract. Otherwise,
retain the small helper/default layer as specified rather than expanding this
task into a French-feature redesign.
