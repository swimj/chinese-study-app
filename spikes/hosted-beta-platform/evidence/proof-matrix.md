# SWI-46 proof matrix

Record only sanitized observations here. Email addresses, provider subject and
session identifiers, tokens, credentials, raw provider logs, and sentinel
contents belong nowhere in tracked evidence.

| Gate | Expected observation | Status | UTC evidence window | Sanitized observation |
| --- | --- | --- | --- | --- |
| Fly topology | One Machine and one encrypted 1 GB Volume in `sin` | Pass | 2026-08-20 01:49–03:03 | Primary Machine healthy in `sin`; exactly one encrypted 1 GB source Volume. A separate no-volume restore Machine ran briefly and stopped. |
| Restricted enrollment | Public sign-up unavailable; invitation required | Pass | 2026-08-20 01:39–03:00 | Clerk development instance configured as Invite-only; sign-in UI exposed no public enrollment path. |
| Pending invitation revoke | Revoked pending link cannot create a session | Pass | 2026-08-20 02:00–02:55 | Invitation A was created then revoked while pending; human retry confirmed the revoked flow failed and did not create a session. |
| Invitation acceptance | Invited test identity can sign in and access `/api/me` | Pass | 2026-08-20 02:00–02:55 | Invitation B completed password creation and sign-in; protected account probe returned 200 with a stable enabled local account. |
| User sign-out | Signed-out request receives `401 AUTH_REQUIRED` | Pass | 2026-08-20 02:50–03:00 | User-initiated sign-out returned the browser to the login view; the protected endpoint independently returned 401 without a session. |
| Provider session revoke | Fresh request after provider revocation receives 401 | Pass | 2026-08-20 02:55–03:01 | Backend revoked two active provider sessions; the authenticated browser was forced back to login after refresh/token reconciliation. |
| Provider user disable | Provider ban prevents future sign-in and revokes all sessions | Not exercised | — | The sanitized CLI implements ban/unban, but this transition was not run before the Clerk development instance was deleted. It is not evidence for local account disablement. |
| Local account disable | Valid provider session receives `403 ACCOUNT_DISABLED` | Pass | 2026-08-20 02:50–03:00 | With the provider session still valid, the protected account probe returned stable 403 `ACCOUNT_DISABLED`. |
| Local account re-enable | Same still-valid provider session regains access | Pass | 2026-08-20 02:50–03:00 | Re-enabling locally restored 200 access without another login and preserved the same local account mapping. |
| WAL persistence | Synthetic sentinel survives Machine restart and a separate deploy | Partial | 2026-08-20 02:00–02:07 | WAL mode verified; sentinel remained present with full SQLite integrity after a Machine restart. The run did not separately record a sentinel lookup across a later `fly deploy`, so that narrow deploy-path check remains proof debt. |
| Continuous backup | Forced sync reports local/remote transaction agreement | Pass | 2026-08-20 02:00–02:25 | Forced syncs reported matching local/remote transaction IDs, including post-migration transaction 9; S3 later restored transaction 15. |
| Clean restore | Independent target passes full integrity and sentinel lookup | Pass | 2026-08-20 03:02–03:03 | Separate 256 MB Machine with no Volume restored from S3, passed full integrity, verified schema v2 and sentinel, and exited 0. |
| Maintenance gate | Writes receive `503 MAINTENANCE_MODE` while quiesced | Pass (live + local hardening) | 2026-08-20 02:10–04:15 | Persisted maintenance mode was visible live. Post-run review moved each maintenance check inside the same write transaction as account/sentinel creation and migration; focused tests verify stable rejection without relying on an HTTP preflight. |
| Harmless migration | Maintenance-only migration reaches schema version 2 | Pass | 2026-08-20 02:10–02:25 | Live migration first refused outside maintenance, then applied and validated schema v2 while maintenance was active. |
| Pre-reopen rollback boundary | Identified v1 recovery point can replace a closed v2 database before writes reopen | Pass (bounded rehearsal) | 2026-08-20 02:05–04:15 | Live pre-migration S3 restore passed full integrity, retained schema v1, and contained the sentinel after the source reached v2. A post-run focused rehearsal replaced the closed v2 database and sidecars with that v1 copy, started the matching v1 schema, smoked a write, and only then reopened maintenance. The replacement step was local, not repeated on the deleted Fly app. |
| Platform observability | Content-free storage, backup age, migration, auth failure, contention, latency, and app-error signals are obtainable | Pass (live + post-run hardening) | 2026-08-20 03:01–04:25 | Live metrics exposed database/WAL sizes, schema v2, maintenance, transaction latency/count, contention, and application errors without content. Post-run hardening added an integrated auth-failure counter and Litestream `last_sync_at` availability/age; parser and redaction behavior are focused-tested but those new series were not sampled before teardown. Restore success remains the sanitized integrity/schema/sentinel result from each isolated drill. |
| Provider/reflection observability | Provider failures, token usage, and estimated reflection cost can be inspected without ordinary content logging | Repository-proven; not hosted-live | — | The disposable harness did not execute reflection/provider work. Existing product run ledgers and focused generation-isolation/pricing tests record concluded failures, token usage, pricing snapshots, and estimated cost. Re-verify this product path when Slice 2 runs behind hosted auth. |
| Cost | Actual accrued Fly and S3 cost remains below the $3 one-off cap | Pass (bounded) | 2026-08-20 01:49–03:03 | About 1.25 hours of one shared 512 MB Machine plus a 10-second 256 MB restore, one 1 GB Volume, and about 21 KB across 34 S3 versions. Conservative published-price bound remains well below $0.05; provider billing may lag. |

Provider semantics must remain separate: invitation revocation, current-session
revocation, provider-level user disablement, and local application disablement
are not interchangeable transitions.

## Teardown

Infrastructure teardown completed on 2026-08-20 UTC after explicit human
confirmation. The disposable Fly application was destroyed; a follow-up lookup
returned app-not-found. All 34 S3 object versions and 14 delete markers were
deleted before the bucket; a follow-up lookup returned 404. The dedicated IAM
access key, inline policy, and user were deleted; a follow-up lookup returned
NoSuchEntity. The human then deleted the Clerk development application from
the dashboard, removing its test users, sessions, invitations, and instance
keys.
