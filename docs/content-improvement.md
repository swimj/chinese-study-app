# Operator content improvement

This guide describes the retained revision-checked operator API for correcting
older study content, including validation, application effects, and retained
evidence. The content quality panel shows historical ratings; it no longer
provides a correction editor. The operator panel's Content improvement tab handles
vocabulary reflection review separately.

## Review and application

An authenticated operator or agent can create a correction case through the API
from a content kind and source ID, optionally attaching an exact rated snapshot.
The snapshot is evidence about what was served, not permission to overwrite
newer material. Saved drafts retain diagnosis, proposed content, rationale,
origin, actor, and time without changing study content.

Before application, inspect the validated preview and expected answers and
record the problem and why the revision is better. Application requires explicit
approval of the saved revision and an additional acknowledgement for changed
answer space. Validation runs again in the application transaction; stale
revisions or changed source/dependency state reject the write. A case can also
be closed without changing content.

The transaction saves accepted evidence with the correction. Original content,
rated snapshots, feedback, and prior draft revisions remain available. A resolved
case cannot be edited; start another case for further changes. Corrections do not
regrade previous attempts, compensate lapses, reset progress, or modify already
served exercise snapshots.

## Content boundaries

Shared corrections affect future selection for all eligible learners. Private
content retains its original owner and does not become shared through an
operator correction. Operator authorization is required for all correction reads
and writes, including the domain entry points. The API exposes authored
material and correction evidence, not learner responses or reflection bundles.

Production cues, supplements, and contrast prompts use replacement identities.
A production cue's learner activation preference remains separate from its
replacement and publication records. Corrections copy that preference to the
successor while retaining the original history. Serving and the Content Bin
derive effective cue availability through the same typed policy: replacement takes
precedence, withdrawn or unpublished shared cues are unavailable, and a pinned
canonical source must remain published. Eligible shared cues default to active
unless the learner has deactivated them; private cues require activation.
The bin displays the reason for unavailability and the replacement cue ID, and
word-level active counts use the same effective state. Database readers load
availability facts in batches; the policy applies their precedence without
querying storage or changing the retained records.

A contrast correction replaces one prompt without withdrawing its cluster.
Pure-cue corrections preserve cue identity, axis and accepted membership, with
attributed before/after repair evidence; this preserves scheduling identity.
Changes to a pure cue's answer membership belong to its existing dedicated
membership workflow.

An introduction or rehearsal correction produces a coherent new content/package
revision. Existing learner pins stay on the old package; new unpinned selections
use its successor. Correcting a source example does not silently revise other
packages or review exercises that pin the old source document. Quarantine and
retirement remain separate publication decisions.

## Agent API

All routes live under `/api/operator/content-improvements`, use the existing
operator authentication/allowlist, and return JSON. Agents must use an
authenticated operator session. There is no unauthenticated agent
backdoor and no provider invocation or automatic generation in this workflow.

| Method and suffix | Contract |
| --- | --- |
| `GET /` | List cases by `status=draft|applied|closed`, `limit` (1–100), and `offset`; returns `{items,total}`. |
| `POST /` | Create from `{kind,sourceId,contentKey? ,id?}`. Optional client-generated `id` makes creation safely retryable for the same selection. |
| `GET /:id` | Read the saved case, source snapshot, proposal, rationale and outcome. |
| `PUT /:id` | Save `{expectedRevision,diagnosis,rationale,generalLesson,proposalOrigin,proposed}`. Origin is `agent` or `operator`; proposed fields depend on content kind. |
| `POST /:id/validate` | Send `{expectedRevision}`; returns errors, materialized preview, source drift and answer-space change. |
| `POST /:id/apply` | Send `{expectedRevision,approve:true,acceptAnswerSpaceChange:boolean}` only after explicit operator approval of that revision. |
| `POST /:id/close` | Send `{expectedRevision,resolution}` to close without application. |
| `GET /:id/history` | Read all immutable saved revisions, including accepted evidence. |

Invalid input returns 400, operator denial 403, and concurrency/state conflicts
409. After an uncertain application response, read the case to determine whether
it applied; do not create another correction as a retry. A repeated application
request cannot apply the same case twice. Machine validation checks structural
and domain correctness; it does not certify natural language quality or pedagogy.

Agent tooling should read the source's `editable` object rather than inventing
identities or answer fields. Package/source JSON is a canonical authored
representation with strict parsers and exact references. The server creates
replacement identities at application. Preserve diagnosis and rationale in the
operator's terms and leave speculative general lessons explicitly tentative.

## Evidence for generation improvement

A resolved case retains original material and available provenance, proposed and
accepted content, diagnosis, rationale, proposal origin, approving actor, and
application outcome. This supports reviewing several corrections together to
identify a pattern and evaluate a narrowly scoped generation change against
repaired examples, unseen similar examples, and already-good controls.

Correcting an item does not require a prompt change. Recording a possible lesson
does not establish a general rule or trigger model-provider work. Improved
future generation does not automatically rewrite existing content. The
API implements evidence capture for this second loop, not an automated
prompt optimizer or evaluation service.

## Delivery and migration

The correction workflow uses versioned schema migrations for correction drafts, immutable
revision evidence and content-specific replacement/repair records. Deploy via
the [offline migration procedure](ops/schema-migrations.md), with stopped writers
and a verified backup. The app-only hosted upgrade route is insufficient.
Implementation and review publication do not apply any correction or migrate
production.
