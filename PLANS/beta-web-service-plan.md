# Beta Web Service Plan

Status: draft planning document.

This document sketches the scope of work needed to turn the current
local-browser-first study app into an initial hosted beta service.

It is a plan, not a product or architecture spec. It should evolve as the
implementation path becomes clearer.

Related documents:

- [`study-action-model.md`](/Users/jw/dev/chinese-study-app/SPECS/study-action-model.md)
- [`learning-review-model.md`](/Users/jw/dev/chinese-study-app/SPECS/learning-review-model.md)
- [`session-covering-criteria.md`](/Users/jw/dev/chinese-study-app/SPECS/session-covering-criteria.md)

## 1. Goal

Enable a small number of external beta users to use the app as a real hosted
web service.

The target is not broad public launch or revenue-readiness. The target is a
credible private beta where:

- users have isolated accounts and study state
- shared learning content can be reused across users
- the app runs on hosted infrastructure
- data is backed up and recoverable
- releases can be deployed intentionally
- the system is supportable when early users encounter issues

## 2. Major Workstreams

### Workstream A: User Model And Tenancy

This is the deepest product/data modeling shift.

The main question:

> What belongs to the user, and what belongs to the shared learning system?

Likely categories:

- shared content:
  - base word corpus
  - public seed clusters
  - canonical contrast prompts
  - study profiles or starter packs
- per-user learner state:
  - word status
  - word-skill state
  - word admission state
  - attempt events
  - learning coverage
  - priorities
  - notes
  - dismissals/suppression state
  - user settings
- user-authored content:
  - private clusters
  - private prompts
  - personal notes
  - user-specific content feedback
- admin-owned content:
  - curated clusters/prompts
  - seed corpora
  - beta user/account management

Early design questions:

1. Which current tables are shared content?
2. Which current tables need `user_id`?
3. Which tables need both shared and user-owned variants?
4. How should user-created content relate to curated shared content?
5. What admin powers are necessary for private beta?

### Workstream B: Database And Persistence Migration

SQLite is still useful for local development and personal/offline workflows,
but a hosted multi-user beta likely needs Postgres sooner rather than later.

Reasons:

- concurrent writes
- managed backups
- hosted operational tooling
- schema migrations
- standard deployment patterns
- clearer multi-user boundaries

The migration should avoid accumulating serious beta data on a schema that
does not yet express tenancy.

Early design questions:

1. Should local development continue supporting SQLite, or should development
   move fully to Postgres?
2. What migration tool/process should own schema changes?
3. How should existing local study data be migrated into a hosted user account?
4. Which schema changes should happen before switching database engines?
5. How should shared seed content be loaded and versioned?

### Workstream C: Authentication And Account Lifecycle

The first beta auth model should be small and boring.

Minimum likely needs:

- sign in
- sign out
- invite-only user creation
- secure session/cookie handling
- password reset or magic-link equivalent
- per-user settings
- admin ability to view/manage beta users

Non-goals for the first beta unless the plan changes:

- billing
- teams/organizations
- public self-serve signup
- complex role hierarchy

Early design questions:

1. Should beta use password auth, magic links, or a managed auth provider?
2. How are invites created and accepted?
3. What user settings are required at account creation?
4. What study profile/corpus should a new user receive by default?
5. What should admin account management include?

### Workstream D: Deployment And Runtime Architecture

The first hosted architecture should prioritize managed, boring infrastructure
over cleverness.

Runtime pieces:

- frontend hosting
- backend API hosting
- managed database
- secrets/env config
- database migrations
- logs
- backups
- health checks
- deploy/rollback process
- domain and TLS

Early design questions:

1. Which cloud provider and deployment platform should be used?
2. Should frontend and backend deploy separately or as one service?
3. How should environment configuration be managed?
4. What is the minimum rollback story?
5. What health checks are needed before inviting users?

### Workstream E: Data Migration And New User Onboarding

This is likely to matter more than it first appears.

The app needs a clear path for:

- creating a new user
- assigning a study profile
- seeding shared content visibility
- initializing per-user word state
- initializing per-user skill state
- importing or migrating existing personal study data
- supporting starter packs for early testers

The current study-profile direction may become a useful primitive here.

Early design questions:

1. What is the smallest useful new-user bootstrap flow?
2. Should users start with all corpus words unstudied, a curated subset, or a
   placement/intake flow?
3. How should existing personal study databases be imported?
4. Are study profiles global, per-user, or both?
5. How should beta users recover if onboarding chooses the wrong starting data?

### Workstream F: Beta Operations And Trust

Even a small private beta needs basic operational maturity.

Minimum likely needs:

- tested backup and restore
- request/error logging
- admin diagnostics
- user/content feedback path
- basic privacy/data deletion posture
- release notes or changelog discipline
- support workflow for user issues

Early design questions:

1. What data must be backed up, how often, and how do we test restore?
2. What logs are useful without collecting unnecessary sensitive data?
3. What admin diagnostics are needed for session/scheduler support?
4. How can users report bad prompts or confusing behavior?
5. What is the lightweight privacy/delete/export posture for private beta?

## 3. Suggested Sequencing

### Phase 1: Service Architecture Spec

Create the architecture/product specs needed before implementation.

Outputs:

- user/tenancy model spec
- shared vs per-user content/state map
- hosted deployment assumptions
- initial beta non-goals

Purpose:

- prevent auth/database/deployment work from drifting in different directions
- identify which current tables need ownership boundaries

### Phase 2: Postgres And Tenancy Foundation

Introduce the database and schema foundations for multi-user state.

Outputs:

- Postgres-ready schema plan
- migration process
- `user_id` boundaries for learner-state tables
- shared-content seed/load approach
- local development decision: SQLite compatibility or Postgres-only

Purpose:

- avoid collecting beta data before the ownership model is clear
- make later auth work connect to durable user-owned state

### Phase 3: Auth And User Bootstrap

Add accounts and per-user initialization.

Outputs:

- invite-only beta account flow
- sign in / sign out
- per-user backend request context
- new-user study bootstrap
- basic user settings

Purpose:

- make multi-user isolation real
- let early users start studying without manual database surgery

### Phase 4: Hosted Deployment

Put the app on managed infrastructure.

Outputs:

- deployed frontend
- deployed backend
- managed database
- environment/secrets setup
- migrations in deploy flow
- logs and health check
- backup/restore procedure

Purpose:

- make the app accessible outside the developer machine
- establish a repeatable release path

### Phase 5: Beta Admin And Support Layer

Add just enough operational surface to support real users.

Outputs:

- admin user list
- account enable/disable or invite management
- basic study-state diagnostics
- content feedback review path
- simple support/debug procedures

Purpose:

- make early beta feedback actionable
- reduce the chance that user issues require unsafe direct database edits

### Phase 6: Private Beta Hardening

Run the service like a small real product before widening access.

Outputs:

- hosted personal account dogfooding
- backup restore drill
- release checklist
- privacy/delete/export posture
- first small tester cohort

Purpose:

- verify the full loop before inviting more users

## 4. Initial Non-Goals

- public self-serve launch
- billing or subscriptions
- team/org accounts
- large-scale observability stack
- complex content marketplace/community workflow
- mobile apps
- native offline sync
- automatic content-generation pipeline

## 5. Cross-Cutting Risks

### Shared vs User-Owned Content

This is the most important modeling risk.

If the boundary is wrong, later features such as private clusters, curated
prompt libraries, content feedback, and account migration will become awkward.

### Database Migration Timing

Moving to Postgres too late risks accumulating real beta data in a shape that
is painful to migrate.

Moving too early may slow product iteration if the local workflow becomes
heavier than necessary.

### Operational Surface Area

The first beta does not need enterprise operations, but it does need enough
data safety and support tooling that user trust is not fragile.

### Scope Creep

Auth, cloud, and admin work can expand endlessly.

The beta target should stay small:

> a few real users can study safely, provide feedback, and keep their data.

## 6. Immediate Next Questions

1. What is the exact shared-vs-user-owned table map for the current schema?
   See the reviewable
   [`hosted-beta tenancy table map`](./hosted-beta-tenancy-table-map.md).
2. Should the first hosted beta preserve SQLite for local dev, or standardize
   development on Postgres?
3. What auth approach is best for a small invite-only beta?
4. Which cloud/deployment option minimizes operational burden while preserving
   data safety?
5. What is the smallest onboarding path that makes early-user feedback useful?
