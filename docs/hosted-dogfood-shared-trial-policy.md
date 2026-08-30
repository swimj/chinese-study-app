# Hosted Dogfood Shared-Trial Policy

At the first hosted dogfood cutover, the primary learner gives one blanket
authorization to publish **all active reusable generated content** as
`shared_trial`. This is deliberately optimistic: the hosted service will still
have only that learner at cutover, and later quality-management work is not a
launch prerequisite.

Run the report first, then apply the same command during the planned
maintenance window:

```bash
npm run backfill:dogfood-shared-trial -- \
  --data-dir=/absolute/path \
  --learner-id=dogfood-local \
  --apply=true
```

The backfill publishes learner-owned contrast clusters and active production
cues and supplements. It is idempotent: already-published rows and inactive
cues remain unchanged. New production-cue repairs already enter
`shared_trial` when their learner-authorized proposal is applied.

This policy does not publish learner state, attempt history, reflection
evidence, feedback, or personal notes. It does not require a content review,
ranking system, or remediation workflow before hosted dogfood begins. Existing
shared-content quarantine and retirement behavior remains available if it is
needed later.
